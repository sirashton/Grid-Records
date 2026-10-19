// Great Britain: NESO's generation mix (half-hourly since 2009) plus Elexon's
// battery units. Built by pipeline/build.mjs into site/data/.

const battery = (side) => ({ batterySource = 'pn' } = {}) => [`${batterySource}_${side}`];

export default {
  code: 'gb',
  name: 'Great Britain',
  locale: 'en-GB',
  timeZone: 'Europe/London',
  dataPath: 'data',
  live: true,
  // The latest slot NESO has reported; battery feeds can run a little ahead.
  endColumn: 'gas',
  fuels: {
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    wind: { label: 'Wind', color: '--f-wind', columns: ['wind', 'wind_emb'], renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true },
    // NESO counts battery output inside OTHER, so batteries stay out of the total.
    // Before the chosen source has data, battery output counts as zero.
    battery: { label: 'Battery discharge', color: '--f-battery', columns: battery('dis'), optional: true, inTotal: false },
    // Charging takes power off the grid, so it is a measure on its own, never part of a generation group.
    battery_charge: { label: 'Battery charging', color: '--f-battery', columns: battery('chg'), abs: true, optional: true, inTotal: false, notGeneration: true },
    storage: { label: 'Pumped storage', color: '--f-hydro-2', lowCarbon: true },
    imports: { label: 'Imports', color: '--f-imports' },
    other: { label: 'Other', color: '--f-other' },
  },
  presets: {
    fossil: { label: 'Fossil fuels', members: ['gas', 'coal'], mode: 'below', gw: [20, 10, 5, 2, 1, 0.5, 0.1, 0], pct: [50, 30, 20, 10, 5, 2, 1, 0] },
    lowcarbon: { label: 'Low carbon', members: ['wind', 'solar', 'nuclear', 'hydro', 'storage', 'battery'], mode: 'above', gw: [1, 2, 5, 10, 15, 20, 25, 30], pct: [10, 20, 30, 50, 70, 80, 90, 95], editable: true },
    renewables: { label: 'Renewables', members: ['wind', 'solar', 'hydro', 'storage', 'biomass'], mode: 'above', gw: [1, 2, 5, 10, 15, 20, 25, 30], pct: [10, 20, 30, 50, 60, 70, 80, 90], editable: true },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [10, 5, 2, 1, 0.5, 0.1, 0], pct: [30, 20, 10, 5, 1, 0] },
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [5, 1, 0.5, 0.1, 0], pct: [20, 10, 5, 1, 0] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [5, 10, 15, 20, 25], pct: [25, 40, 50, 60, 70] },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [2, 5, 10, 15], pct: [10, 20, 30, 40] },
    nuclear: { label: 'Nuclear', members: ['nuclear'], mode: 'below', gw: [6, 5, 4, 3], pct: [20, 15, 10, 5] },
    imports: { label: 'Imports', members: ['imports'], mode: 'above', gw: [2, 5, 8, 10], pct: [10, 15, 20, 25] },
    battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [2, 5, 10, 15] },
    batterycharge: { label: 'Battery charging', members: ['battery_charge'], mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [2, 5, 10, 15] },
    custom: { label: 'Custom group…', members: ['wind', 'solar', 'nuclear', 'hydro', 'biomass'], mode: 'above', gw: [10, 20, 30], pct: [50, 75, 90], editable: true },
  },
  // The measure-over-time chart's log scale.
  logScale: { min: 0.05, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] },
};
