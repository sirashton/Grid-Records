// Ontario: the province's grid, run by the IESO. Hourly output of every
// transmission-connected generator, summed by fuel, from 2015, from the IESO's
// public reports. Built by pipeline/build-on.mjs into site/data/on/. The
// yearly file runs to yesterday and the generator report fills today hour by
// hour, so the latest data is usually about an hour old. Solar and wind on
// the distribution network (most of Ontario's solar) are not in these reports.

const LOW_CARBON = ['nuclear', 'hydro', 'wind', 'solar', 'biomass'];

export default {
  code: 'on',
  name: 'Ontario',
  locale: 'en-CA',
  // The IESO keeps Eastern Standard Time all year; years and chart dates use Toronto time.
  timeZone: 'America/Toronto',
  dataPath: '../data/on',
  live: true,
  endColumn: 'nuclear',
  fuels: {
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    // Atikokan (wood pellets), Calstock and Thunder Bay.
    biomass: { label: 'Biofuel', color: '--f-biomass', renewable: true, lowCarbon: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    // The IESO's OTHER: grid batteries, discharge only, from 2025.
    battery: { label: 'Battery discharge', color: '--f-battery', optional: true, inTotal: false },
  },
  presets: {
    // Gas is Ontario's only fossil fuel since the last coal plant closed in 2014.
    fossil: { label: 'Gas', members: ['gas'], mode: 'below', gw: [6, 5, 4, 3, 2, 1.5, 1, 0.5, 0.2, 0], pct: [30, 20, 15, 10, 5, 2, 1] },
    fossilhigh: { label: 'Gas, high output', members: ['gas'], mode: 'above', gw: [2, 3, 4, 5, 6, 7, 8], pct: [10, 20, 30, 40] },
    lowcarbon: { label: 'Low carbon', members: LOW_CARBON, mode: 'above', gw: [10, 12, 14, 16, 18, 20], pct: [80, 85, 90, 95, 98, 99], editable: true },
    nuclear: { label: 'Nuclear, low output', members: ['nuclear'], mode: 'below', gw: [12, 11, 10, 9, 8, 7, 6], pct: [70, 60, 50, 40] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [1, 2, 3, 4, 4.5], pct: [10, 15, 20, 25, 30] },
    battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.1, 0.25, 0.5, 1, 1.5, 2], pct: [1, 2, 5, 10] },
    custom: { label: 'Custom group…', members: ['wind', 'solar', 'battery'], mode: 'above', gw: [2, 3, 4], pct: [10, 20, 30], editable: true },
  },
  logScale: { min: 0.05, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20] },
};
