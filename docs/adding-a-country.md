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
- **Prices** may ride along as a `price` column, with the unit in `extra.units` (Poland: EUR/MWh). `price` and `demand` are the columns allowed either sign; config fuels never list `price`, so totals ignore it.
- **Canonical column names** (use these where they apply, add new ones only if nothing fits): `coal`, `lignite`, `gas`, `oil`, `nuclear`, `hydro`, `pumped_storage`, `pumped_storage_charge`, `wind` (or `wind_onshore` + `wind_offshore`), `solar` (or `solar_utility` + `solar_rooftop`), `geothermal`, `biomass`, `battery`, `battery_charge`, `imports`, `exports`, `other`, `demand`, `price`. Existing GB and NZ names (`storage`, `wind_emb`, `bioenergy`, `diesel`, `pn_dis`...) stay as they are; the country config maps them.
- **Write with the shared writer**, not by hand: `writeDataset(outDir, { region, timeZone, stepMinutes, startMs, length, columns, extra })` from `pipeline/core/dataset.mjs`. It checks the rules above, encodes, writes both files and returns the meta. `extra` is merged into meta for country-specific facts (coverage, unit lists, months fetched).
- **Fetching in chunks within a time budget**: `runQueue(items, fn, { concurrency, deadline })` and `stitch(chunks, { stepMinutes, columns })` from `pipeline/core/chunks.mjs`, plus `monthList` / `isStale` for monthly files. Cache parsed chunks in `.cache-<cc>/` (Actions cache) and bump a `PARSE_VERSION` to force a re-parse. `pipeline/build-nz.mjs` is the worked example.
- **Size.** The Int16 delta file is small at 30 minutes (GB 17 years is about 3 MB). At 5 minutes a 25-year history is six times the slots, so keep the column list to what the page uses: aggregate units to fuels in the adapter.

Another country on a source that already has an adapter reuses it: Poland (`pipeline/build-pl.mjs`) uses the Energy-Charts adapter with its own type map (`PL_SOURCES`) and Germany's year cache and merge.

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
  live: true,                       // false if the data lags weeks (NZ): says "at the latest data" not "live"
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
- `site/js/envelope.js`: `envelopeLayers` for envelope charts in stories.
- `site/js/now-panel.js` (Right now panel), `site/js/recent.js` (recent records), `site/js/envelope.js`, `site/js/charts.js` (call `setTimeZone(country.timeZone)`).

## 4. The page

`site/<cc>/index.html` + `site/js/<cc>/app.js`. Copy `site/nz/index.html` and the top of `site/js/nz/app.js` (setup, Right now panel, `main`) for the shell (header, country switch, Right now panel, records section, story chapters). Then:

1. `setTimeZone(country.timeZone)`; `const records = createRecordsTool({ host: $('records'), country })` after `startAnalytics()`.
2. `const data = await loadData(country.dataPath)`; `records.setData(data, { end: dataEnd(data, country) })`.
3. The story: country-specific chapters in `site/js/<cc>/`, answer first (Alex's pyramid style). This is the part that should differ per country.
4. Add the flag to `site/flags/` and the country to the switch on every page.

## What stays country-specific

Source quirks (fuel code mapping, DST, unit lists, revisions), the story chapters and any models in them (NZ lakes, GB battery sources), and the preset ladders. Everything about how a record is counted, how a series is built from fuels, and how the records UI behaves is shared: fix it once in the shared module, not per country.
