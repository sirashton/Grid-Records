// Japan, nine interconnected areas: the supply and demand results that each
// area's transmission operator publishes (エリア需給実績), summed by
// pipeline/build-jp.mjs into site/data/jp/. Half hours, average MW. Okinawa,
// the tenth area, is not included: it has no link to the other nine, and its
// operator's site refuses automated requests.
//
// Most operators rewrite the current month's file through the day, about an
// hour behind; the national series ends at the last half hour all nine have,
// so it is usually one to three hours old.
//
// Thermal: since April 2024 the files split it into LNG, coal, oil and other
// thermal. `thermal` is all of them together, the one fossil column that can
// also carry the operators' older hourly files, which don't split it. So the
// fossil total is `thermal`, and the four fuels are its breakdown, kept out of
// the generation total so nothing is counted twice.

const RENEWABLE = ['hydro', 'solar', 'wind', 'geothermal', 'biomass'];
const VRE = ['solar', 'wind'];

export default {
  code: 'jp',
  name: 'Japan (nine areas)',
  locale: 'en-GB',
  timeZone: 'Asia/Tokyo',
  dataPath: '../data/jp',
  live: true,
  endColumn: 'demand',
  fuels: {
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    geothermal: { label: 'Geothermal', color: '--f-geo', renewable: true, lowCarbon: true },
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true },
    thermal: { label: 'Fossil thermal', color: '--f-gas', fossil: true, notGeneration: true },
    gas: { label: 'LNG', color: '--f-gas', inTotal: false },
    coal: { label: 'Coal', color: '--f-coal', inTotal: false },
    oil: { label: 'Oil', color: '--f-diesel', inTotal: false },
    thermal_other: { label: 'Other thermal', color: '--f-lignite', inTotal: false },
    pumped_storage: { label: 'Pumped storage', color: '--f-hydro-2' },
    other: { label: 'Other', color: '--f-other', optional: true },
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
    pumped_storage_charge: { label: 'Pumping', color: '--f-hydro-2', abs: true, inTotal: false, notGeneration: true },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, optional: true, inTotal: false, notGeneration: true },
    solar_curtailed: { label: 'Solar held back', color: '--f-solar', optional: true, inTotal: false, notGeneration: true },
    wind_curtailed: { label: 'Wind held back', color: '--f-wind', optional: true, inTotal: false, notGeneration: true },
  },
  presets: {
    fossil: { label: 'Fossil fuels', members: ['thermal'], mode: 'below', gw: [60, 50, 40, 35, 30, 25, 20], pct: [70, 60, 50, 40, 30, 25, 20] },
    gas: { label: 'LNG', members: ['gas'], mode: 'below', gw: [30, 25, 20, 15, 10, 5], pct: [30, 25, 20, 15, 10] },
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [25, 20, 15, 10, 5], pct: [30, 25, 20, 15, 10] },
    fossilhigh: { label: 'Fossil fuels, high output', members: ['thermal'], mode: 'above', gw: [80, 90, 100, 110], pct: [70, 80, 85, 90] },
    lowcarbon: { label: 'Low carbon (with nuclear)', members: ['nuclear', ...RENEWABLE], mode: 'above', gw: [40, 50, 60, 70, 80], pct: [40, 50, 60, 70, 80], editable: true },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [30, 40, 50, 60, 70], pct: [30, 40, 50, 60, 70], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [30, 40, 50, 60, 70], pct: [30, 40, 50, 60] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [2, 3, 4, 5, 6], pct: [2, 3, 4, 5] },
    nuclear: { label: 'Nuclear', members: ['nuclear'], mode: 'above', gw: [10, 12, 14, 16], pct: [10, 15, 20] },
    battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.5, 1, 2, 3, 5], pct: [1, 2, 3, 5] },
    curtailed: { label: 'Solar and wind held back', members: ['solar_curtailed', 'wind_curtailed'], mode: 'above', gw: [1, 2, 5, 10, 15], pct: [2, 5, 10, 15] },
    custom: { label: 'Custom group…', members: VRE, mode: 'above', gw: [30, 40, 50], pct: [30, 40, 50], editable: true },
  },
  logScale: { min: 0.1, ticks: [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] },
};
