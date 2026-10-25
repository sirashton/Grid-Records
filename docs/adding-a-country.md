# Country framework: how to add a country to Grid Records

Every country page is three pieces: a **pipeline adapter** that turns the country's source into one common dataset format, a **country config** that names its fuels and presets, and a **page** that mounts the shared records tool plus whatever story is unique to that country. Records, series, yearly figures and the records UI are shared code; nothing in them is written for one country.

Each country keeps its own native time step (5, 15, 30 or 60 minutes). The shared code reads `stepMinutes` from the data and works in minutes, so nothing is resampled.

The repo copy is docs/adding-a-country.md; the project copy at /mnt/project-files/grid-records/country-framework.md is the same text.

Status: 2026-10-19. GB and NZ run on this as of the PR from the "Shared framework for all countries" thread; their records came out identical before and after (NZ's per-year bests now use NZ calendar years instead of UTC ones). Tests for the shared pieces: `test/framework.test.mjs`, which also shows a 15-minute, Berlin-time country end to end.

## 1. The dataset contract (what an adapter writes)

Two files per country under `site/data/<cc>/` (`cc` = lower-case ISO code: `nz`, `au`, `de`; GB stays at `site/data/` for now):

- `series.bin.gz`: columns of Int16, delta encoded, gzipped (`pipeline/encode.mjs`).
- `meta.json`:

```json
{
  "version": 1,
  "region": "au",
  "timeZone": "Australia/Brisbane",
  "generated": "2026-10-19T09:00:00Z",
  "startMs": 909842400000,
  "stepMinutes": 5,
  "length": 2300000,
  "columns": ["coal", "gas", "hydro", "wind", "solar", "battery", "battery_charge"],
  "missing": { "coal": [[0, 12]] },
  "lastSlot": { "coal": 2299999 },
  "base": { "...": "only present when a column's first value is over 32,767 MW" }
}
```

Rules:

- **Values are average MW over the slot**, slot `i` covering `startMs + i * stepMinutes` to the next slot, in UTC. Convert energy (MWh, kWh) to average MW in the adapter.
- **One regular grid.** `startMs` is a multiple of the step. Every column has `length` values.
- **Missing is NaN, never zero.** A period no source reported is missing. Records bridge gaps of up to 60 minutes; longer gaps end a spell, so writing zeros for missing data creates fake records.
- **Generation columns are 0 or more.** Anything that takes power off the grid goes in its own column: `battery_charge` and `pumped_storage_charge` as **negative** MW, `exports` likewise.
- **Hourly history, finer later.** Keep the finest step and let each hourly reading fill its quarter hours (an hour's average MW is each quarter's average too). `parsePublicPower(json, { fillMinutes: 60 })` in `pipeline/sources/energy-charts.mjs` does this for Poland; it never fills across a gap longer than an hour.
- **Prices** may ride along as a `price` column, with the unit in `extra.units` (Poland: EUR/MWh). `price`, `demand` and `net_<code>` (the net flow on one border, positive into the country: Denmark's `net_no`, `net_se`...) are the columns allowed either sign; config fuels never list `price` or the borders, so totals ignore them.
- **Canonical column names** (use these where they apply, add new ones only if nothing fits): `coal`, `lignite`, `gas`, `oil`, `nuclear`, `hydro`, `pumped_storage`, `pumped_storage_charge`, `wind` (or `wind_onshore` + `wind_offshore`), `solar` (or `solar_utility` + `solar_rooftop`), `geothermal`, `biomass`, `battery`, `battery_charge`, `imports`, `exports`, `other`, `demand`, `price`. Existing GB and NZ names (`storage`, `wind_emb`, `bioenergy`, `diesel`, `pn_dis`...) stay as they are; the country config maps them.
- **Write with the shared writer**, not by hand: `writeDataset(outDir, { region, timeZone, stepMinutes, startMs, length, columns, extra })` from `pipeline/core/dataset.mjs`. It checks the rules above, encodes, writes both files and returns the meta. `extra` is merged into meta for country-specific facts (coverage, unit lists, months fetched).
- **Fetching in chunks within a time budget**: `runQueue(items, fn, { concurrency, deadline })` and `stitch(chunks, { stepMinutes, columns })` from `pipeline/core/chunks.mjs`, plus `monthList` / `isStale` for monthly files. Cache parsed chunks in `.cache-<cc>/` (Actions cache) and bump a `PARSE_VERSION` to force a re-parse. `pipeline/build-nz.mjs` is the worked example.
- **Size.** The Int16 delta file is small at 30 minutes (GB 17 years is about 3 MB). At 5 minutes a 25-year history is six times the slots, so keep the column list to what the page uses: aggregate units to fuels in the adapter.

Another country on a source that already has an adapter reuses it: Poland (`pipeline/build-pl.mjs`) uses the Energy-Charts adapter with its own type map (`PL_SOURCES`) and Germany's year cache and merge, and France (`pipeline/build-fr.mjs`, `FR_SOURCES`) copies Poland. Energy-Charts can leave a single type blank, which the parser reads as zero; France drops nuclear and load readings below a floor that real output never reaches (`FLOOR_MW`).

Adapter layout: `pipeline/sources/<source>.mjs` (fetch + parse, pure functions tested in `test/<cc>.test.mjs`) and `pipeline/build-<cc>.mjs` (cache, budget, `writeDataset`). Add a step to `deploy.yml` and `ci.yml` with `continue-on-error: true` so one country failing never blocks the others.

## 2. The country config (client)

`site/js/countries/<cc>.js` exports one object; everything shared reads it.

```js
export default {
  code: 'au',
  name: 'Australia (NEM)',
  locale: 'en-AU',
  timeZone: 'Australia/Brisbane',   // years, days and chart dates use this
  dataPath: '../data/au',           // relative to the page
  live: true,                       // true when the pipeline keeps the data within hours (section 5); false if it lags weeks (NZ)
  endColumn: 'coal',                // the column whose last value marks the end of the data
  smallInMw: false,                 // true shows thresholds under 1 GW in MW (small grids)
  logScale: { min: 0.05, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50] },  // measure-over-time log axis
  fuels: {
    // key: { label, color (CSS var), columns (defaults to [key]; may be several, e.g. onshore + offshore),
    //        fossil, renewable, lowCarbon (flags the shared yearly figures use),
    //        inTotal: false (left out of total generation: batteries, charging),
    //        abs (charging columns count by size), optional (missing counts as 0),
    //        notGeneration (not offered when building a custom group) }
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, optional: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // The records tool's Measure list. gw and pct are threshold ladders.
    fossil: { label: 'Fossil fuels', members: ['coal', 'gas'], mode: 'below', gw: [20, 10, 5, 2, 1, 0], pct: [50, 20, 10, 5, 1, 0] },
    custom: { label: 'Custom group…', members: ['wind', 'solar'], mode: 'above', gw: [5, 10], pct: [50, 75], editable: true },
  },
};
```

## 3. Shared client modules

- `site/js/core/dataset.js`: `loadData(path)`, `metricSeries(data, country, members, { unit })`, `generationTotal(data, country)`, `dataEnd(data, country)`, `lastComplete`, `slotsIn(data, minutes)`, `windowPoints`, `byYear`, `yearlyEnergy`, `yearlyHoursBelow`, `dailyEnergy`, all in the country's own time zone and step.
- `site/js/core/calendar.js`: `yearStart`, `localYear`, `localDate` in any time zone.
- `site/js/records.js`: the record engine. `summarise(values, threshold, mode, { startMs, stepMinutes, timeZone, maxGapMinutes })`, `formatDuration(slots, stepMinutes)`. Spells, record progression, per-year bests (local calendar years) and the past 365 days.
- `site/js/core/records-tool.js`: `const records = createRecordsTool({ host, country })` renders the whole Records card (controls, table, record progression, longest spell per year, the measure over time) into an empty `<section class="card records-card" id="records" aria-labelledby="records-h"></section>`, before the data loads; then `records.setData(data, { end })`, and `records.update()` on resize. Pages don't copy its markup or code. Optional `series`, `seriesKey` and `hash` hooks let a page add its own setting (GB's battery source).
- `site/js/core/live-records.js`: `liveRecords(data, country)` (running spells that are records, close to one, or long streaks), `freshness`, `thresholdText`. Used by the Live records page.
- `site/js/envelope.js`: `envelopeLayers` for envelope charts in stories.
- `site/js/now-panel.js` (Right now panel): `setupNowWindows(country, onChange)` draws the time frame buttons (Live, 24 hours, 7 days, 365 days when `live`; 24 hours, 7 days, 30 days, 365 days otherwise) and `windowSlots(win, step)` turns one into slots; `agoText(ms)` says how old the data is for the line under the title, `site/js/recent.js` (recent records), `site/js/envelope.js`, `site/js/charts.js` (call `setTimeZone(country.timeZone)`).

## 4. The page

`site/<cc>/index.html` + `site/js/<cc>/app.js`. Copy `site/nz/index.html` and the top of `site/js/nz/app.js` (setup, Right now panel, `main`) for the shell (header, country switch, Right now panel, records section, story chapters). Then:

1. `setTimeZone(country.timeZone)`; `const records = createRecordsTool({ host: $('records'), country })` after `startAnalytics()`.
2. `const data = await loadData(country.dataPath)`; `records.setData(data, { end: dataEnd(data, country) })`.
3. The story: country-specific chapters in `site/js/<cc>/`, answer first (Alex's pyramid style), in the shape set out in [The story](#the-story-every-page-answers-the-same-three-questions) below. This is the part that should differ per country.
4. Add the flag to `site/flags/` and one entry to `site/js/countries/index.js` (its page, data path, flag, and `nav` if the switch label should differ from the config's name), then run `npm run nav`. That stamps the country switch onto every page, this one included, so never edit a page's `<nav class="region-nav">` by hand: `pipeline/nav.mjs` rewrites it from the list, `test/nav.test.mjs` fails while any page is out of date, and the deploy stamps it again before building. The switch stays plain HTML, so it shows with no layout shift and without scripts.

The Live records page (`site/live/`, `site/js/core/live-records.js`) reads `site/js/countries/index.js`, so a listed country is checked there with no other change: every preset and threshold in its config, for spells still running that are records or close to one. It uses the config's `live` flag and the data's end to say whether the country is live or how far behind its latest data is. `navHtml` ends every switch with the Live records button.

## 5. Live data

Every country should be as live as its sources allow. The deploy workflow already rebuilds every country every 30 minutes, so live is a matter of the adapter fetching recent data, not of the workflow.

- **Find the freshest free feed** when you pick the source. Many publishers have a complete archive that arrives late plus a rolling feed of the last days or hours (AEMO's NEMWEB Current reports, for example). Note its lag in the country config comment.
- **Archive plus recent feed:** fetch the archive as usual, then fill the gap from its end to now from the feed with `pipeline/core/recent.mjs`: `loadState` / `saveState` keep what was fetched in the Actions cache (so each run only fetches new files), `recentFrom(archiveEnd, now, maxDays)` says where to start, `prune` drops what is no longer needed, and `extend(archive, recentPiece, { stepMinutes, columns })` lays the recent slots after the archive's end (the archive always wins where both exist, so a newly published month replaces the feed's figures). Give the recent part its own small budget and fetch newest first, so a run that is short of time still brings the page up to date. Prefer a feed's daily or weekly files over hundreds of small ones, pause between requests, and stop at the first refusal (`runQueue`'s `stop` option): AEMO turned the runner away with HTTP 403 after about 1,200 quick requests. `pipeline/build-au.mjs` with `pipeline/sources/aemo-recent.mjs` is the worked example.
- **One source that is already near live** (Energy-Charts for Germany): refetch the current period each run (`build-de.mjs` refreshes the current year every 25 minutes).
- **Leave the last slot off until it is complete:** a half hour with only some of its readings reads low.
- **Set `live: true`** in the config when the data is normally within a few hours. The Right now panel then opens on Live and the Records card says "Current spell" and "past 365 days". With `live: false` it says "At the latest data".
- **Say how fresh it is:** the line under the title gives the latest data's time and `agoText`, and the note under the panel says what Live means for that source ("usually under an hour old", "about three hours behind").

Status 2026-10-19: GB live (NESO, under an hour), Australia live (AEMO 5-minute reports, under an hour), Germany live (Energy-Charts, about three hours), New Zealand not live (EMI monthly files arrive weeks late; the daily 5-minute dispatch file is about three days late, and Transpower's real-time feed needs a subscription). Western Australia not live (AEMO WA rewrites the current month's facility file each morning, so the data is up to a day old; `pipeline/build-wa.mjs`). Greece live (Energy-Charts, one to a few hours; hourly readings; `pipeline/build-gr.mjs` spaces requests 32 s apart because Energy-Charts allows about two a minute, so its history backfills over several runs). Colombia not live (XM's API adds a day at a time, about two days behind; `pipeline/build-co.mjs` refetches the current month every run and builds in its own deploy job, like Texas). Ontario live (IESO: the yearly generation-by-fuel file runs to yesterday and the hourly generator report fills today, so the data is about an hour behind; `pipeline/build-on.mjs` lays each day's report after the yearly files and builds in its own deploy job). Belgium live (Energy-Charts, a few hours behind Elia; `pipeline/build-be.mjs` spaces requests 31 s apart and builds in its own deploy job; Elia's own 15-minute open data starts only in 2020). Uruguay live (ADME's hourly SCADA summary by source, about an hour behind, from September 2018; each month takes the server about 40 s to build, so `pipeline/build-uy.mjs` backfills over several runs in its own deploy job; exports are inferred from generation plus imports minus demand). United States not live (EIA-930's six-month bulk files, no key, about a day behind, lower 48 from October 2018; `pipeline/build-us.mjs` refetches the current half-year every run and builds in its own deploy job. Each balancing authority is cleaned before the sum, and US gas ramps over 32 GW an hour are why the encoder stores a column in coarser units when it must, `meta.scale`).

## The story: every page answers the same three questions

Alex's rule (2026-10-19, from the France page): every country page is built around **the last fossil fuel on its grid**. The site exists to chart the next phase of the transition, from adding renewables to not needing fossil plants at all, so each story answers, in this order:

1. **Why does fossil power still run?** Name the fuel that is left (gas in France, coal in Poland, gas and coal in Australia) and show, from the data, when it runs: by month, by hour of day, and against net trade, demand, wind and solar. Separate what the country needs from what runs for other reasons (exports, contracts, heat, grid support), and say which is which with a source or a clear "inferred".
2. **What are the economics?** Why each plant is on at that hour: who pays it, what it is paid against (marginal cost of fuel and carbon versus the price, capacity or support contracts, must-run rules), and why the cheaper clean power is turned down or exported instead.
3. **What is coming, and when?** Dated, sourced items (closures, contracts ending, batteries, interconnectors, new reactors or wind, targets) and, for each, **which record it should move**: the spell to watch (for example "longest spell with fossil under 0.5 GW"), the floor that should fall, the battery or solar peak that should rise. End with the records to watch, so a reader can come back and see whether it happened. Where the data allows, size what would replace the remaining fossil output (for example how much battery would cover it on how many days) and say what it would not cover.

The answer comes first: the lede and "In short" answer the page's question in a sentence or two, with three supporting points that link to the chapters. Every number on the page is computed from the data by `storyFigures()` (tested) or cites a source the writer opened. The France page (`site/js/fr/story.js`) is the worked example.

## What stays country-specific

Source quirks (fuel code mapping, DST, unit lists, revisions), the story chapters and any models in them (NZ lakes, GB battery sources), and the preset ladders. Everything about how a record is counted, how a series is built from fuels, and how the records UI behaves is shared: fix it once in the shared module, not per country.
