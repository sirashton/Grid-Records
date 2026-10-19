// France: Fraunhofer ISE's Energy-Charts public net generation (hourly from
// 2015, every 15 minutes in recent years, stored at 15 minutes). Built by
// pipeline/build-fr.mjs into site/data/fr/, with day-ahead prices as `price`.
// Energy-Charts runs a few hours behind RTE's real time.

const RENEWABLE = ['hydro', 'wind_onshore', 'wind_offshore', 'solar', 'biomass'];
const WIND = ['wind_onshore', 'wind_offshore'];
const FOSSIL = ['gas', 'coal', 'oil'];

export default {
  code: 'fr',
  name: 'France',
  locale: 'en-GB',
  timeZone: 'Europe/Paris',
  dataPath: '../data/fr',
  live: true,
  endColumn: 'nuclear',
  fuels: {
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    wind_onshore: { label: 'Onshore wind', color: '--f-wind', renewable: true, lowCarbon: true },
    wind_offshore: { label: 'Offshore wind', color: '--f-wind-off', renewable: true, lowCarbon: true, optional: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    oil: { label: 'Oil', color: '--f-diesel', fossil: true },
    other: { label: 'Waste and other', color: '--f-other' },
    pumped_storage: { label: 'Pumped storage', color: '--f-hydro-2' },
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
    // Net imports are not French generation, so they are left out of the total.
    imports: { label: 'Net imports', color: '--f-imports', inTotal: false },
    pumped_storage_charge: { label: 'Pumping', color: '--f-hydro-2', abs: true, inTotal: false, notGeneration: true },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, optional: true, inTotal: false, notGeneration: true },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // The project's wide log ladder, 20 GW down to 0.1 GW and zero. France's
    // fossil output is small already, so the low rungs are where records fall.
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [20, 10, 5, 3, 2, 1, 0.5, 0.1, 0], pct: [20, 10, 5, 3, 2, 1] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [10, 5, 3, 2, 1, 0.5], pct: [10, 5, 3, 2, 1] },
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [2, 1, 0.5, 0.1, 0], pct: [3, 2, 1, 0.5, 0] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [5, 8, 10, 12, 15], pct: [10, 15, 20, 25] },
    nuclear: { label: 'Nuclear, low output', members: ['nuclear'], mode: 'below', gw: [50, 45, 40, 35, 30, 25], pct: [70, 60, 50, 40] },
    nuclearhigh: { label: 'Nuclear, high output', members: ['nuclear'], mode: 'above', gw: [40, 45, 50, 55, 60], pct: [70, 75, 80, 85] },
    lowcarbon: { label: 'Low carbon (with nuclear)', members: ['nuclear', ...RENEWABLE], mode: 'above', gw: [40, 50, 60, 70, 80], pct: [90, 95, 97, 98, 99], editable: true },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [10, 20, 30, 40, 50], pct: [20, 30, 40, 50, 60], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [5, 10, 15, 20, 25], pct: [10, 20, 30, 40] },
    wind: { label: 'Wind', members: WIND, mode: 'above', gw: [5, 10, 15, 20], pct: [10, 20, 30] },
    windlow: { label: 'Wind, calm spells', members: WIND, mode: 'below', gw: [2, 1, 0.5], pct: [3, 2, 1] },
    exports: { label: 'Net exports', members: ['exports'], mode: 'above', gw: [5, 10, 15, 18], pct: [10, 15, 20, 25] },
    imports: { label: 'Net imports', members: ['imports'], mode: 'above', gw: [1, 3, 5, 8, 10], pct: [2, 5, 10, 15] },
    custom: { label: 'Custom group…', members: ['solar', ...WIND], mode: 'above', gw: [10, 20, 30], pct: [20, 30, 40], editable: true },
  },
  logScale: { min: 0.05, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50] },
};
