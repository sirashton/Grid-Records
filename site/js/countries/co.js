// Colombia: the national interconnected system (SIN), run by XM. Net
// generation of every plant each hour since 2000, from XM's public API,
// classified by XM's resource list and, for thermal plants, by the fuel XM
// says they burned that hour. Built by pipeline/build-co.mjs into
// site/data/co/. XM adds a day at a time, so the latest data is usually two
// or three days old.

const RENEWABLE = ['hydro', 'solar', 'wind', 'biomass'];
const FOSSIL = ['gas', 'coal', 'oil'];

export default {
  code: 'co',
  name: 'Colombia',
  locale: 'en-GB',
  // Colombia time, UTC-5 all year.
  timeZone: 'America/Bogota',
  dataPath: '../data/co',
  live: false,
  endColumn: 'hydro',
  fuels: {
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    // Sugar-cane bagasse, palm waste and biogas, mostly sugar mills in the Cauca valley.
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    // Diesel (ACPM), fuel oil and jet fuel, burned when gas runs short.
    oil: { label: 'Oil and diesel', color: '--f-diesel', fossil: true },
    // Plants no longer in XM's resource list whose fuel XM never reported.
    other: { label: 'Other', color: '--f-other' },
  },
  presets: {
    // The project's wide log ladder, from drought years down to zero.
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [5, 4, 3, 2, 1.5, 1, 0.5, 0.2, 0], pct: [40, 30, 20, 15, 10, 5, 2] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [2, 3, 4, 5, 6], pct: [20, 30, 40, 50, 60] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [3, 2, 1, 0.5, 0.2], pct: [25, 15, 10, 5, 2] },
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [2, 1.5, 1, 0.5, 0.2, 0], pct: [15, 10, 5, 2, 1] },
    hydro: { label: 'Hydro, low output', members: ['hydro'], mode: 'below', gw: [8, 7, 6, 5, 4, 3], pct: [80, 70, 60, 50, 40] },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [6, 7, 8, 9, 10, 11], pct: [80, 85, 90, 95, 98, 99], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [0.2, 0.5, 1, 1.5, 2, 3], pct: [5, 10, 15, 20, 25] },
    custom: { label: 'Custom group…', members: ['solar', 'wind'], mode: 'above', gw: [0.5, 1, 2], pct: [5, 10, 20], editable: true },
  },
  logScale: { min: 0.02, ticks: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10] },
};
