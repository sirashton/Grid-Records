// The United States (lower 48): EIA-930, the Hourly Electric Grid Monitor.
// Every balancing authority's hourly net generation by fuel, summed, from
// October 2018. Built by pipeline/build-us.mjs into site/data/us/ from EIA's
// six-month files, which run about a day behind. Rooftop solar is not in
// EIA-930, and Alaska and Hawaii are outside it.

const RENEWABLE = ['hydro', 'wind', 'solar', 'geothermal'];
const FOSSIL = ['gas', 'coal', 'oil'];

export default {
  code: 'us',
  name: 'United States',
  locale: 'en-US',
  timeZone: 'America/New_York',
  dataPath: '../data/us',
  live: false,
  endColumn: 'gas',
  fuels: {
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    oil: { label: 'Oil', color: '--f-diesel', fossil: true },
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    // Until June 2024 EIA-930 counted pumped storage in with hydro.
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    // Split out of "Other" from July 2024.
    geothermal: { label: 'Geothermal', color: '--f-geo', renewable: true, lowCarbon: true, optional: true },
    // Biomass, waste, and before July 2024 batteries and geothermal.
    other: { label: 'Other', color: '--f-other' },
    pumped_storage: { label: 'Pumped storage', color: '--f-hydro-2', optional: true },
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
    // Net flows with Canada and Mexico: what is left of interchange once flows
    // between balancing authorities cancel.
    imports: { label: 'Net imports', color: '--f-imports', inTotal: false },
    pumped_storage_charge: { label: 'Pumping', color: '--f-hydro-2', abs: true, optional: true, inTotal: false, notGeneration: true },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, optional: true, inTotal: false, notGeneration: true },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // US fossil output has never been under 130 GW in this record, so the
    // ladder starts far above the project's usual 20 GW and runs down to zero.
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [250, 200, 175, 150, 140, 130, 100, 50, 20, 0], pct: [60, 55, 50, 45, 40, 35, 30, 25] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [150, 125, 100, 90, 80, 50, 20], pct: [40, 35, 30, 25, 20] },
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [100, 75, 60, 50, 45, 40, 20, 10, 0], pct: [25, 20, 15, 12, 10, 8] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [350, 400, 450, 475], pct: [65, 70, 75] },
    gashigh: { label: 'Gas, high output', members: ['gas'], mode: 'above', gw: [250, 300, 325, 350], pct: [45, 50, 55] },
    battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [2, 5, 10, 15], pct: [1, 2, 3] },
    lowcarbon: { label: 'Low carbon (with nuclear)', members: ['nuclear', ...RENEWABLE], mode: 'above', gw: [250, 300, 350, 400], pct: [50, 55, 60, 65], editable: true },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [150, 200, 250, 300], pct: [30, 40, 50, 55], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [25, 50, 75, 100, 125], pct: [10, 15, 20, 25] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [50, 75, 90, 100], pct: [15, 20, 25] },
    windlow: { label: 'Wind, calm spells', members: ['wind'], mode: 'below', gw: [20, 15, 10], pct: [5, 3, 2] },
    custom: { label: 'Custom group…', members: ['solar', 'wind'], mode: 'above', gw: [100, 150, 200], pct: [25, 30, 40], editable: true },
  },
  logScale: { min: 1, ticks: [1, 2, 5, 10, 20, 50, 100, 200, 500] },
};
