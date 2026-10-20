// Czechia: Fraunhofer ISE's Energy-Charts public net generation (hourly from
// 2015, every 15 minutes in recent years, stored at 15 minutes). Built by
// pipeline/build-cz.mjs into site/data/cz/, with day-ahead prices as `price`.
// Energy-Charts runs a few hours behind ČEPS, the grid operator, and the
// pipeline refetches the current year every run.

const RENEWABLE = ['hydro', 'wind', 'solar', 'biomass'];
const FOSSIL = ['lignite', 'coal', 'gas', 'oil'];
const COAL = ['lignite', 'coal'];

export default {
  code: 'cz',
  name: 'Czechia',
  locale: 'en-GB',
  timeZone: 'Europe/Prague',
  dataPath: '../data/cz',
  live: true,
  endColumn: 'lignite',
  smallInMw: false,
  fuels: {
    lignite: { label: 'Lignite', color: '--f-lignite', fossil: true },
    coal: { label: 'Hard coal', color: '--f-coal', fossil: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    oil: { label: 'Oil and other', color: '--f-diesel', fossil: true },
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    biomass: { label: 'Biomass and biogas', color: '--f-biomass', renewable: true, lowCarbon: true },
    other: { label: 'Waste and other', color: '--f-other' },
    pumped_storage: { label: 'Pumped storage', color: '--f-hydro-2' },
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
    // Net imports are not Czech generation, so they are left out of the total.
    imports: { label: 'Net imports', color: '--f-imports', inTotal: false },
    pumped_storage_charge: { label: 'Pumping', color: '--f-hydro-2', abs: true, inTotal: false, notGeneration: true },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, optional: true, inTotal: false, notGeneration: true },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // The project's wide log ladder, 10 GW down to 0.1 GW and zero, with 4
    // and 3 added where Czech lignite now bottoms out.
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [7, 5, 4, 3, 2, 1, 0.5, 0.1, 0], pct: [60, 50, 40, 30, 20, 10] },
    lignite: { label: 'Lignite', members: ['lignite'], mode: 'below', gw: [5, 4, 3, 2.5, 2, 1.5, 1, 0.5], pct: [50, 40, 30, 20, 10] },
    allcoal: { label: 'Coal (lignite and hard coal)', members: COAL, mode: 'below', gw: [6, 5, 4, 3, 2, 1, 0.5], pct: [50, 40, 30, 20, 10] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [4, 5, 6, 7, 8], pct: [40, 50, 60, 70] },
    gas: { label: 'Gas', members: ['gas'], mode: 'above', gw: [0.5, 1, 1.5, 2], pct: [5, 10, 15, 20] },
    nuclear: { label: 'Nuclear, low output', members: ['nuclear'], mode: 'below', gw: [3.5, 3, 2.5, 2, 1.5], pct: [40, 30, 20] },
    lowcarbon: { label: 'Low carbon (with nuclear)', members: ['nuclear', ...RENEWABLE], mode: 'above', gw: [5, 6, 7, 8, 9], pct: [50, 60, 70, 80, 90], editable: true },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [1, 2, 3, 4, 5], pct: [20, 30, 40, 50, 60], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [1, 2, 3, 4, 5], pct: [10, 20, 30, 40, 50] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [0.2, 0.3, 0.4, 0.5], pct: [2, 3, 5] },
    exports: { label: 'Net exports', members: ['exports'], mode: 'above', gw: [1, 2, 3, 4, 5], pct: [10, 20, 30, 40] },
    imports: { label: 'Net imports', members: ['imports'], mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [5, 10, 20, 30] },
    custom: { label: 'Custom group…', members: ['solar', 'wind'], mode: 'above', gw: [1, 2, 3], pct: [20, 30, 40], editable: true },
  },
  logScale: { min: 0.05, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10] },
};
