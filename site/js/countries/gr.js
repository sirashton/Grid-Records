// Greece: Fraunhofer ISE's Energy-Charts public net generation for the
// interconnected system (hourly since 2015, stored at 15 minutes). Built by
// pipeline/build-gr.mjs into site/data/gr/, with day-ahead prices as
// `price`. Energy-Charts runs one to a few hours behind IPTO's real time.

const RENEWABLE = ['solar', 'wind', 'hydro', 'biomass'];
const FOSSIL = ['lignite', 'gas', 'oil'];

export default {
  code: 'gr',
  name: 'Greece',
  locale: 'en-GB',
  timeZone: 'Europe/Athens',
  dataPath: '../data/gr',
  live: true,
  endColumn: 'gas',
  smallInMw: true,
  fuels: {
    lignite: { label: 'Lignite', color: '--f-lignite', fossil: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    oil: { label: 'Oil', color: '--f-diesel', fossil: true, optional: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true, optional: true },
    other: { label: 'Other', color: '--f-other', optional: true },
    pumped_storage: { label: 'Pumped storage', color: '--f-hydro-2', optional: true },
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
    // Net imports are not Greek generation, so they are left out of the total.
    imports: { label: 'Net imports', color: '--f-imports', inTotal: false },
    pumped_storage_charge: { label: 'Pumping', color: '--f-hydro-2', abs: true, optional: true, inTotal: false, notGeneration: true },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, optional: true, inTotal: false, notGeneration: true },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // A small grid: peak demand is about 10 GW, so the ladders run in
    // hundreds of MW at the low end, where the records now fall.
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [5, 3, 2, 1.5, 1, 0.5, 0.2, 0], pct: [50, 30, 20, 10, 5, 1] },
    lignite: { label: 'Lignite', members: ['lignite'], mode: 'below', gw: [2, 1, 0.5, 0.2, 0.1, 0], pct: [20, 10, 5, 1, 0] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [3, 2, 1.5, 1, 0.5, 0.2], pct: [40, 30, 20, 10, 5] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [3, 4, 5, 6, 7], pct: [50, 60, 70, 80] },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [3, 5, 7, 9, 11], pct: [50, 60, 70, 80, 90, 100], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [2, 4, 5, 6, 7, 8], pct: [30, 40, 50, 60, 70] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [2, 3, 4, 5], pct: [30, 40, 50, 60] },
    windlow: { label: 'Wind, calm spells', members: ['wind'], mode: 'below', gw: [0.5, 0.3, 0.2, 0.1], pct: [5, 3, 1] },
    exports: { label: 'Net exports', members: ['exports'], mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [10, 20, 30, 40] },
    imports: { label: 'Net imports', members: ['imports'], mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [10, 20, 30, 40] },
    custom: { label: 'Custom group…', members: ['solar', 'wind'], mode: 'above', gw: [3, 5, 7], pct: [50, 60, 70], editable: true },
  },
  logScale: { min: 0.02, ticks: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10] },
};
