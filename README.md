# Grid Records

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
  backfilled to 2020 a few weeks at a time.

## Data sources

| Source | Used for | Delay |
| --- | --- | --- |
| [NESO historic generation mix](https://www.neso.energy/data-portal/historic-generation-mix) | Generation by fuel since 2009, including embedded wind and solar | About an hour |
| [Elexon](https://bmrs.elexon.co.uk/) Physical Notifications (PN) | Battery units' planned output, charging and discharging | Live |
| Elexon B1610 | Battery units' metered output | About five days |
| Elexon BM unit register | Identifying battery units (by name and National Grid's unit naming) | — |

Contains BMRS data © Elexon Limited copyright and database right. Contains NESO data licensed under the NESO Open Data Licence.

## Development

Requires Node 20 or later. No dependencies.

```
npm test                 # unit tests
npm run build            # fetch real data into site/data (needs internet; --budget-minutes 2 for a quick run)
npm run serve            # serve site/ on http://localhost:8080
```
