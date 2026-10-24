// Uruguay: the national grid, from ADME, the market administrator. Hourly
// output of the four big hydro plants, wind, solar, thermal and biomass, with
// imports and demand, from SCADA, since 2018. Built by pipeline/build-uy.mjs
// into site/data/uy/. Exports are inferred: what generation and imports leave
// after demand.

const HYDRO = ['hydro_salto', 'hydro_negro'];
const RENEWABLE = [...HYDRO, 'wind', 'solar', 'biomass'];

export default {
  code: 'uy',
  name: 'Uruguay',
  locale: 'en-GB',
  // Uruguay time, UTC-3 all year since 2015.
  timeZone: 'America/Montevideo',
  dataPath: '../data/uy',
  live: true,
  endColumn: 'wind',
  fuels: {
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    hydro_salto: { label: 'Hydro, Salto Grande', color: '--f-hydro', renewable: true, lowCarbon: true },
    hydro_negro: { label: 'Hydro, Río Negro', color: '--f-hydro-2', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    // Wood waste and black liquor, mostly the UPM and Montes del Plata pulp mills.
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true },
    // Punta del Tigre's gas-oil combined cycle and the diesel and fuel-oil units at La Tablada and Central Batlle.
    thermal: { label: 'Thermal', color: '--f-diesel', fossil: true },
    imports: { label: 'Imports', color: '--f-imports', inTotal: false },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // The project's wide log ladder: Uruguay's thermal is usually off, so the
    // records are about how long it stays off and how high droughts push it.
    fossil: { label: 'Thermal (fossil)', members: ['thermal'], mode: 'below', gw: [1, 0.5, 0.2, 0.1, 0.05, 0.01, 0], pct: [20, 10, 5, 2, 1, 0] },
    fossilhigh: { label: 'Thermal, high output', members: ['thermal'], mode: 'above', gw: [0.1, 0.2, 0.3, 0.5, 0.7, 1], pct: [5, 10, 20, 30, 40] },
    hydro: { label: 'Hydro, low output', members: HYDRO, mode: 'below', gw: [1, 0.5, 0.3, 0.2, 0.1], pct: [50, 30, 20, 10, 5] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [0.5, 1, 1.2, 1.4], pct: [50, 70, 80, 90] },
    windlow: { label: 'Wind, calm spells', members: ['wind'], mode: 'below', gw: [0.2, 0.1, 0.05], pct: [10, 5, 2] },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [1, 1.5, 2, 2.5], pct: [90, 95, 98, 99, 100], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [0.1, 0.2, 0.3, 0.4], pct: [10, 20, 30] },
    imports: { label: 'Imports', members: ['imports'], mode: 'above', gw: [0.1, 0.3, 0.5, 1], pct: [10, 20, 40] },
    exports: { label: 'Net exports', members: ['exports'], mode: 'above', gw: [0.2, 0.5, 1, 1.5], pct: [20, 40, 60] },
    custom: { label: 'Custom group…', members: ['solar', 'wind'], mode: 'above', gw: [0.5, 1, 1.5], pct: [50, 70, 90], editable: true },
  },
  logScale: { min: 0.005, ticks: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2] },
};
