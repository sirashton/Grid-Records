// Texas: ERCOT, the grid that covers about 90% of the state's demand and is
// barely connected to the rest of the US. Its Interval Generation by Fuel
// reports (every 15 minutes since 2007), plus the fuel mix dashboard for the
// latest days. Built by pipeline/build-tx.mjs into site/data/tx/. The reports
// are published about monthly, so the days between the last report and the
// dashboard's two days fill in as runs go by.

const RENEWABLE = ['wind', 'solar', 'hydro', 'biomass'];
const FOSSIL = ['gas', 'coal'];
const WIND_SOLAR = ['wind', 'solar'];

export default {
  code: 'tx',
  name: 'Texas (ERCOT)',
  locale: 'en-US',
  timeZone: 'America/Chicago',
  dataPath: '../data/tx',
  live: true,
  endColumn: 'gas',
  fuels: {
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    // The reports split biomass out; the dashboard folds it into "Other", so
    // it reads 0 for the latest days.
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true, optional: true },
    // ERCOT's "Other": battery discharge, nearly all of it since about 2022,
    // plus petroleum coke and oil. Battery charging is left out.
    other: { label: 'Batteries and other', color: '--f-battery' },
  },
  presets: {
    // The project's wide log ladder, from the gas-heavy past down to zero.
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [30, 25, 20, 15, 10, 5, 2, 1, 0.1, 0], pct: [50, 40, 30, 25, 20, 15, 10, 5] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [20, 15, 10, 5, 2, 1, 0.1], pct: [40, 30, 20, 15, 10, 5] },
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [10, 5, 3, 2, 1, 0.5, 0.1, 0], pct: [15, 10, 5, 3, 2, 1] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [40, 50, 55, 60, 65], pct: [70, 75, 80, 85] },
    batteries: { label: 'Batteries and other', members: ['other'], mode: 'above', gw: [1, 2, 5, 8, 10], pct: [2, 5, 10, 15] },
    lowcarbon: { label: 'Low carbon (with nuclear)', members: ['nuclear', ...RENEWABLE], mode: 'above', gw: [30, 40, 50, 60, 70], pct: [50, 60, 70, 75, 80], editable: true },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [20, 30, 40, 50, 60], pct: [40, 50, 60, 70], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [5, 10, 15, 20, 25, 30], pct: [10, 20, 30, 40] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [10, 15, 20, 25, 28], pct: [30, 40, 50, 60] },
    windlow: { label: 'Wind, calm spells', members: ['wind'], mode: 'below', gw: [2, 1, 0.5], pct: [3, 2, 1] },
    custom: { label: 'Custom group…', members: WIND_SOLAR, mode: 'above', gw: [20, 30, 40], pct: [40, 50, 60], editable: true },
  },
  logScale: { min: 0.05, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50] },
};
