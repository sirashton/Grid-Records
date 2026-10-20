// Bulgaria: Fraunhofer ISE's Energy-Charts public net generation, hourly
// from 2015 (stored at 15 minutes), with batteries listed only from 9 September
// 2026 (earlier battery output is partly in Solar, after dark, and partly unlisted).
// Built by pipeline/build-bg.mjs into site/data/bg/, with day-ahead prices as
// `price`. Energy-Charts runs about nine hours behind ESO's real time.

const RENEWABLE = ['solar', 'wind_onshore', 'hydro', 'biomass'];
const FOSSIL = ['lignite', 'coal', 'gas'];

export default {
  code: 'bg',
  name: 'Bulgaria',
  locale: 'en-GB',
  timeZone: 'Europe/Sofia',
  dataPath: '../data/bg',
  live: true,
  endColumn: 'lignite',
  fuels: {
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    lignite: { label: 'Lignite', color: '--f-lignite', fossil: true },
    coal: { label: 'Hard coal', color: '--f-coal', fossil: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    wind_onshore: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true },
    other: { label: 'Waste and other', color: '--f-other' },
    pumped_storage: { label: 'Pumped storage', color: '--f-hydro-2' },
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
    // Net imports are not Bulgarian generation, so they are left out of the total.
    imports: { label: 'Net imports', color: '--f-imports', inTotal: false },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, optional: true, inTotal: false, notGeneration: true },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // The project's log ladder from 5 GW down. Bulgaria's fossil output has
    // rarely been below 1 GW, so the low rungs read "Never" for now.
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [5, 4, 3, 2, 1.5, 1, 0.5, 0.1, 0], pct: [60, 50, 40, 30, 20, 10, 5] },
    lignite: { label: 'Lignite', members: ['lignite'], mode: 'below', gw: [4, 3, 2, 1.5, 1, 0.5, 0.1, 0], pct: [50, 40, 30, 20, 10, 5] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [2, 3, 4, 5], pct: [40, 50, 60] },
    battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.5, 1, 2, 3, 4, 5], pct: [10, 20, 30, 40, 50] },
    batterycharge: { label: 'Battery charging', members: ['battery_charge'], mode: 'above', gw: [0.5, 1, 2, 3, 4, 5], pct: [10, 20, 30, 40, 50] },
    nuclear: { label: 'Nuclear, low output', members: ['nuclear'], mode: 'below', gw: [1.5, 1, 0.5], pct: [40, 30, 20] },
    lowcarbon: { label: 'Low carbon (with nuclear)', members: ['nuclear', ...RENEWABLE], mode: 'above', gw: [3, 4, 5, 6, 7], pct: [60, 70, 80, 90, 95], editable: true },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [2, 3, 4, 5, 6], pct: [30, 40, 50, 60, 70], editable: true },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [1, 2, 3, 4, 5], pct: [30, 40, 50, 60, 70] },
    wind: { label: 'Wind', members: ['wind_onshore'], mode: 'above', gw: [0.3, 0.5, 0.6], pct: [5, 10, 15] },
    exports: { label: 'Net exports', members: ['exports'], mode: 'above', gw: [1, 2, 3, 4], pct: [20, 30, 40, 50] },
    imports: { label: 'Net imports', members: ['imports'], mode: 'above', gw: [0.5, 1, 2, 3], pct: [10, 20, 30, 40] },
    custom: { label: 'Custom group…', members: ['solar', 'battery'], mode: 'above', gw: [2, 3, 4], pct: [40, 50, 60], editable: true },
  },
  logScale: { min: 0.02, ticks: [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10] },
};
