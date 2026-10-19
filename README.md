# Gridstreak

A dashboard for Great Britain's electricity grid, inspired by Kate Morley's [National Grid: Live](https://grid.iamkate.com/).
It tracks record durations: the longest spells the grid has run above or below any power level, for any fuel or
group of fuels (for example, the longest the grid has gone with fossil fuels below 1 GW). It also compares three
sources of battery charge and discharge data.

Live at https://grid.gathered.consulting once DNS and GitHub Pages are set up.

## How it works

- `pipeline/build.mjs` runs in GitHub Actions every 30 minutes (`.github/workflows/deploy.yml`). It fetches
  NESO's historic generation mix and Elexon's per-unit battery data, and writes `site/data/`.
- `site/` is a static page with no build step. The browser decodes the data and computes every record itself
  (`site/js/records.js`), so any combination of fuels and thresholds works without a server.
- Battery history is kept between runs in the Actions cache, falling back to the published site, and is
  backfilled to 2017 a little each run (about three minutes of fetching), so a fresh start takes a few days to fill in.

## New Zealand

A second page at `/nz/` covers New Zealand. `pipeline/build-nz.mjs` reads the Electricity Authority's monthly
[generation output by plant](https://www.emi.ea.govt.nz/Wholesale/Datasets/Generation/Generation_MD) files (half-hourly,
every grid-connected plant, since August 1997) and writes `site/data/nz/`. Parsed months are kept in the Actions cache
(`.cache-nz/`); each run refreshes only the last four months, once a day. The data arrives a few weeks after each month ends.
The page's last chapter (`site/js/nz/firming.js`) estimates when a 100% renewable grid costs less than keeping fossil backup
for dry years.

## Adding a country

Every country page shares one framework. A pipeline adapter (`pipeline/build-<cc>.mjs`) writes the country's data in one
format with `pipeline/core/dataset.mjs`, at the source's own time step (5 to 60 minutes). A config in
`site/js/countries/<cc>.js` names its fuels, groups and time zone. The record engine (`site/js/records.js`), the series and
yearly figures (`site/js/core/dataset.js`) and the whole Records card (`site/js/core/records-tool.js`) are shared, so each
page only adds its own story. `test/framework.test.mjs` shows a 15-minute country end to end. The full guide is [docs/adding-a-country.md](docs/adding-a-country.md).

## Data sources

| Source | Used for | Delay |
| --- | --- | --- |
| [NESO historic generation mix](https://www.neso.energy/data-portal/historic-generation-mix) | Generation by fuel since 2009, including embedded wind and solar | About an hour |
| [Elexon](https://bmrs.elexon.co.uk/) Physical Notifications (PN) | Battery units' planned output, charging and discharging | Live |
| Elexon B1610 | Battery units' metered output | About five days |
| Elexon BM unit register | Identifying battery units (by name and National Grid's unit naming) | — |

Contains BMRS data © Elexon Limited copyright and database right. Contains NESO data licensed under the NESO Open Data Licence.

## Usage analytics

Cookie-free page views and events through GoatCounter. What is measured and how to read it: [docs/analytics.md](docs/analytics.md).

## Development

Requires Node 20 or later. No dependencies.

```
npm test                 # unit tests
npm run build            # fetch real data into site/data (needs internet; --budget-minutes 2 for a quick run)
npm run serve            # serve site/ on http://localhost:8080
```
