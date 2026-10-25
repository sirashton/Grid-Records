// Poland: Fraunhofer ISE's Energy-Charts public net generation (hourly from
// 2015, every 15 minutes in recent years, stored at 15 minutes). Built by
// pipeline/build-pl.mjs into site/data/pl/, with day-ahead prices as `price`.

const RENEWABLE = ['solar', 'wind_onshore', 'wind_offshore', 'hydro', 'biomass'];
const WIND = ['wind_onshore', 'wind_offshore'];
const COAL = ['lignite', 'coal'];

export default {
  code: 'pl',
  name: 'Poland',
  locale: 'en-GB',
  timeZone: 'Europe/Warsaw',
  dataPath: '../data/pl',
  live: true,
  endColumn: 'coal',
  fuels: {
    coal: { label: 'Hard coal', color: '--f-coal', fossil: true },
    lignite: { label: 'Lignite', color: '--f-lignite', fossil: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    oil: { label: 'Oil and other', color: '--f-diesel', fossil: true },
    wind_onshore: { label: 'Onshore wind', color: '--f-wind', renewable: true, lowCarbon: true },
    wind_offshore: { label: 'Offshore wind', color: '--f-wind-off', renewable: true, lowCarbon: true, optional: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true },
    other: { label: 'Other', color: '--f-other' },
    pumped_storage: { label: 'Pumped storage', color: '--f-hydro-2' },
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
    // Net imports are not Polish generation, so they are left out of the total.
    imports: { label: 'Net imports', color: '--f-imports', inTotal: false },
    pumped_storage_charge: { label: 'Pumping', color: '--f-hydro-2', abs: true, inTotal: false, notGeneration: true },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, optional: true, inTotal: false, notGeneration: true },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // The project's wide log ladder, 20 GW down to 0.1 GW and zero, with 15
    // and 7 added where Poland is now. Its fossil floor is still over 5 GW,
    // so the low rungs read "Never" for now.
    fossil: { label: 'Fossil fuels', members: ['coal', 'lignite', 'gas', 'oil'], mode: 'below', gw: [20, 15, 10, 7, 5, 2, 1, 0.5, 0.1, 0], pct: [80, 70, 60, 50, 40, 30, 20] },
    allcoal: { label: 'Coal (hard coal and lignite)', members: COAL, mode: 'below', gw: [20, 15, 10, 7, 5, 2, 1, 0.5, 0.1, 0], pct: [80, 70, 60, 50, 40, 30, 20] },
    coal: { label: 'Hard coal', members: ['coal'], mode: 'below', gw: [10, 7, 5, 3, 2, 1], pct: [50, 40, 30, 20, 10] },
    lignite: { label: 'Lignite', members: ['lignite'], mode: 'below', gw: [5, 3, 2, 1, 0.5], pct: [30, 20, 10, 5] },
    fossilhigh: { label: 'Fossil fuels, high output', members: ['coal', 'lignite', 'gas', 'oil'], mode: 'above', gw: [10, 15, 20, 25], pct: [70, 80, 90] },
    coalhigh: { label: 'Coal, high output', members: COAL, mode: 'above', gw: [10, 15, 20, 22], pct: [70, 80, 90] },
    gas: { label: 'Gas', members: ['gas'], mode: 'above', gw: [1, 2, 3, 4, 5], pct: [5, 10, 15, 20] },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [5, 10, 15, 20, 25], pct: [30, 40, 50, 60, 70], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [2, 5, 10, 15], pct: [10, 20, 30, 40, 50] },
    wind: { label: 'Wind', members: WIND, mode: 'above', gw: [2, 5, 7, 10], pct: [10, 20, 30, 40] },
    windlow: { label: 'Wind, calm spells', members: WIND, mode: 'below', gw: [2, 1, 0.5], pct: [5, 3, 1] },
    imports: { label: 'Net imports', members: ['imports'], mode: 'above', gw: [1, 2, 3, 4, 5], pct: [5, 10, 15, 20] },
    custom: { label: 'Custom group…', members: ['solar', ...WIND], mode: 'above', gw: [5, 10, 15], pct: [30, 40, 50], editable: true },
  },
  logScale: { min: 0.05, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50] },
};
