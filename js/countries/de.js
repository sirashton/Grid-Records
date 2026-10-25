// Germany: Fraunhofer ISE's Energy-Charts public net generation (15-minute
// since 2015). Built by pipeline/build-de.mjs into site/data/de/.

const RENEWABLE = ['solar', 'wind_onshore', 'wind_offshore', 'hydro', 'biomass'];
const WIND = ['wind_onshore', 'wind_offshore'];

export default {
  code: 'de',
  name: 'Germany',
  locale: 'en-GB',
  timeZone: 'Europe/Berlin',
  dataPath: '../data/de',
  live: true,
  endColumn: 'lignite',
  fuels: {
    lignite: { label: 'Lignite', color: '--f-lignite', fossil: true },
    coal: { label: 'Hard coal', color: '--f-coal', fossil: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    oil: { label: 'Oil and other', color: '--f-diesel', fossil: true },
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    wind_onshore: { label: 'Onshore wind', color: '--f-wind', renewable: true, lowCarbon: true },
    wind_offshore: { label: 'Offshore wind', color: '--f-wind-off', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true },
    other: { label: 'Waste and other', color: '--f-other' },
    pumped_storage: { label: 'Pumped storage', color: '--f-hydro-2' },
    // Net imports are not German generation, so they are left out of the total.
    imports: { label: 'Net imports', color: '--f-imports', inTotal: false },
    pumped_storage_charge: { label: 'Pumping', color: '--f-hydro-2', abs: true, inTotal: false, notGeneration: true },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    fossil: { label: 'Fossil fuels', members: ['lignite', 'coal', 'gas', 'oil'], mode: 'below', gw: [30, 20, 15, 10, 7, 5], pct: [50, 40, 30, 20, 15, 10] },
    allcoal: { label: 'Coal (lignite and hard coal)', members: ['lignite', 'coal'], mode: 'below', gw: [20, 15, 10, 7, 5, 3], pct: [40, 30, 20, 15, 10, 5] },
    lignite: { label: 'Lignite', members: ['lignite'], mode: 'below', gw: [15, 10, 7, 5, 3], pct: [30, 20, 15, 10, 5] },
    coal: { label: 'Hard coal', members: ['coal'], mode: 'below', gw: [10, 5, 2, 1, 0.5], pct: [20, 10, 5, 2, 1] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [10, 5, 3, 2, 1], pct: [20, 10, 5, 3] },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [20, 30, 40, 50, 60], pct: [50, 60, 70, 80, 90], editable: true },
    lowcarbon: { label: 'Low carbon (with nuclear)', members: [...RENEWABLE, 'nuclear'], mode: 'above', gw: [20, 30, 40, 50, 60], pct: [50, 60, 70, 80, 90], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [10, 20, 30, 40, 50], pct: [20, 30, 40, 50, 60] },
    wind: { label: 'Wind', members: WIND, mode: 'above', gw: [10, 20, 30, 40, 50], pct: [20, 30, 40, 50, 60] },
    windlow: { label: 'Wind, calm spells', members: WIND, mode: 'below', gw: [10, 5, 3, 2], pct: [10, 5, 3] },
    nuclear: { label: 'Nuclear', members: ['nuclear'], mode: 'below', gw: [8, 6, 4, 2, 0], pct: [15, 10, 5, 0] },
    imports: { label: 'Net imports', members: ['imports'], mode: 'above', gw: [2, 5, 8, 10, 12], pct: [5, 10, 15, 20] },
    custom: { label: 'Custom group…', members: ['solar', ...WIND], mode: 'above', gw: [20, 30, 40], pct: [40, 50, 60], editable: true },
  },
  logScale: { min: 0.1, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] },
};
