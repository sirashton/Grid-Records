// New Zealand: the Electricity Authority's generation by plant (half-hourly
// since 1997). Built by pipeline/build-nz.mjs into site/data/nz/.

export default {
  code: 'nz',
  name: 'New Zealand',
  locale: 'en-NZ',
  timeZone: 'Pacific/Auckland',
  dataPath: '../data/nz',
  // Each month arrives a few weeks after it ends.
  live: false,
  endColumn: 'hydro',
  // Thresholds under 1 GW read better in MW on a small grid.
  smallInMw: true,
  fuels: {
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true },
    geothermal: { label: 'Geothermal', color: '--f-geo', renewable: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true },
    bioenergy: { label: 'Wood and biogas', color: '--f-biomass', renewable: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    diesel: { label: 'Diesel', color: '--f-diesel', fossil: true },
    // Batteries only move energy in time, so they are left out of the total.
    battery: { label: 'Battery discharge', color: '--f-battery', inTotal: false },
    other: { label: 'Other', color: '--f-other' },
  },
  presets: {
    fossil: { label: 'Fossil fuels', members: ['gas', 'coal', 'diesel'], mode: 'below', gw: [1, 0.5, 0.25, 0.1, 0.05, 0.02, 0], pct: [20, 10, 5, 2, 1, 0.5, 0] },
    renewables: { label: 'Renewables', members: ['hydro', 'geothermal', 'wind', 'solar', 'bioenergy'], mode: 'above', gw: [3, 4, 5, 6], pct: [80, 90, 95, 98, 99, 99.5], editable: true },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [1, 0.5, 0.2, 0.1, 0.05, 0], pct: [20, 10, 5, 2, 1, 0] },
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [0.5, 0.25, 0.1, 0], pct: [10, 5, 2, 0] },
    hydro: { label: 'Hydro', members: ['hydro'], mode: 'below', gw: [3, 2.5, 2, 1.5], pct: [60, 50, 40, 30] },
    geothermal: { label: 'Geothermal', members: ['geothermal'], mode: 'above', gw: [0.6, 0.8, 1, 1.2], pct: [15, 20, 25, 30] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [0.25, 0.5, 0.75, 1], pct: [5, 10, 15, 20] },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [0.05, 0.1, 0.2, 0.3], pct: [1, 2, 5, 10] },
    battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.05, 0.1, 0.2, 0.3], pct: [1, 2, 5] },
    custom: { label: 'Custom group…', members: ['wind', 'solar', 'geothermal'], mode: 'above', gw: [1, 1.5, 2], pct: [20, 30, 40], editable: true },
  },
  logScale: { min: 0.01, ticks: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] },
};
