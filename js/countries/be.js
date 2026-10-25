// Belgium: Fraunhofer ISE's Energy-Charts public net generation (hourly from
// 2015, every 15 minutes in recent years, stored at 15 minutes). Built by
// pipeline/build-be.mjs into site/data/be/, with day-ahead prices as `price`.
// Energy-Charts runs a few hours behind Elia's real time.

const RENEWABLE = ['hydro', 'wind_onshore', 'wind_offshore', 'solar', 'biomass'];
const WIND = ['wind_onshore', 'wind_offshore'];
const FOSSIL = ['gas', 'coal', 'oil'];

export default {
  code: 'be',
  name: 'Belgium',
  locale: 'en-GB',
  timeZone: 'Europe/Brussels',
  dataPath: '../data/be',
  live: true,
  endColumn: 'gas',
  fuels: {
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    wind_onshore: { label: 'Onshore wind', color: '--f-wind', renewable: true, lowCarbon: true },
    wind_offshore: { label: 'Offshore wind', color: '--f-wind-off', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    coal: { label: 'Coal', color: '--f-coal', fossil: true, optional: true },
    oil: { label: 'Oil', color: '--f-diesel', fossil: true, optional: true },
    other: { label: 'Waste and other', color: '--f-other' },
    pumped_storage: { label: 'Pumped storage', color: '--f-hydro-2' },
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
    // Net imports are not Belgian generation, so they are left out of the total.
    imports: { label: 'Net imports', color: '--f-imports', inTotal: false },
    pumped_storage_charge: { label: 'Pumping', color: '--f-hydro-2', abs: true, inTotal: false, notGeneration: true },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, optional: true, inTotal: false, notGeneration: true },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // The project's wide log ladder, 20 GW down to 0.1 GW and zero. Belgian
    // fossil output is almost all gas, a few GW at most.
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [20, 10, 5, 3, 2, 1, 0.5, 0.1, 0], pct: [40, 30, 20, 10, 5, 3, 1] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [5, 3, 2, 1, 0.5], pct: [30, 20, 10, 5, 3] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [3, 4, 5, 6, 7], pct: [40, 50, 60, 70] },
    nuclear: { label: 'Nuclear, low output', members: ['nuclear'], mode: 'below', gw: [4, 3, 2, 1, 0.5], pct: [40, 30, 20, 10] },
    nuclearhigh: { label: 'Nuclear, high output', members: ['nuclear'], mode: 'above', gw: [3, 4, 5, 5.5], pct: [50, 60, 70, 80] },
    lowcarbon: { label: 'Low carbon (with nuclear)', members: ['nuclear', ...RENEWABLE], mode: 'above', gw: [4, 6, 8, 10, 12], pct: [70, 80, 90, 95, 99], editable: true },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [2, 4, 6, 8, 10], pct: [30, 50, 70, 80, 90], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [2, 4, 6, 8], pct: [20, 30, 40, 50] },
    wind: { label: 'Wind', members: WIND, mode: 'above', gw: [2, 3, 4, 5], pct: [30, 40, 50] },
    windlow: { label: 'Wind, calm spells', members: WIND, mode: 'below', gw: [0.5, 0.2, 0.1], pct: [5, 3, 1] },
    exports: { label: 'Net exports', members: ['exports'], mode: 'above', gw: [1, 2, 3, 4], pct: [10, 20, 30] },
    imports: { label: 'Net imports', members: ['imports'], mode: 'above', gw: [1, 2, 3, 4, 5], pct: [20, 30, 40, 50] },
    custom: { label: 'Custom group…', members: ['solar', ...WIND], mode: 'above', gw: [2, 4, 6], pct: [30, 40, 50], editable: true },
  },
  logScale: { min: 0.05, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10] },
};
