// Brazil's interconnected system (SIN): ONS hourly generation for every plant
// it dispatches or estimates since 2000, its estimate of small distributed
// solar since 2023, whole-system load, and the wind (since October 2021) and
// solar (since April 2024) it held back. Built by pipeline/build-br.mjs into
// site/data/br/. ONS updates the current month's file about once a day, so
// the latest data is usually a day or two old.

const RENEWABLE = ['hydro', 'wind', 'solar_utility', 'solar_rooftop', 'biomass'];
const FOSSIL = ['gas', 'coal', 'oil', 'other'];
const WIND_SOLAR = ['wind', 'solar_utility', 'solar_rooftop'];
const SOLAR = ['solar_utility', 'solar_rooftop'];

export default {
  code: 'br',
  name: 'Brazil',
  locale: 'en-GB',
  // Brasília time, which kept daylight saving until 2019.
  timeZone: 'America/Sao_Paulo',
  dataPath: '../data/br',
  live: false,
  endColumn: 'hydro',
  fuels: {
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    solar_utility: { label: 'Solar farms', color: '--f-solar', renewable: true, lowCarbon: true },
    // ONS's estimate of distributed solar (MMGD) starts in 2023.
    solar_rooftop: { label: 'Rooftop and small solar', color: '--f-rooftop', renewable: true, lowCarbon: true, optional: true },
    biomass: { label: 'Biomass', color: '--f-biomass', renewable: true, lowCarbon: true },
    nuclear: { label: 'Nuclear', color: '--f-nuclear', lowCarbon: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    oil: { label: 'Oil and diesel', color: '--f-diesel', fossil: true },
    other: { label: 'Other thermal', color: '--f-other', fossil: true },
    // What ONS held back from wind and solar farms, as average MW: not generation.
    wind_curtailed: { label: 'Wind held back', color: '--f-wind', inTotal: false, notGeneration: true },
    solar_curtailed: { label: 'Solar held back', color: '--f-solar', inTotal: false, notGeneration: true },
  },
  presets: {
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [20, 15, 10, 7, 5, 3, 2, 1, 0.5], pct: [30, 20, 15, 10, 7, 5, 3, 2] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [5, 10, 15, 20, 25], pct: [10, 15, 20, 25, 30] },
    hydro: { label: 'Hydro, low output', members: ['hydro'], mode: 'below', gw: [60, 50, 40, 35, 30, 25, 20], pct: [80, 70, 60, 50, 40, 30] },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [50, 60, 70, 80, 90], pct: [80, 85, 90, 95, 98, 99], editable: true },
    windsolar: { label: 'Wind and solar', members: WIND_SOLAR, mode: 'above', gw: [10, 20, 30, 40, 50, 60], pct: [10, 20, 30, 40, 50, 60] },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [5, 10, 15, 20, 25, 30], pct: [10, 20, 30, 40] },
    solar: { label: 'Solar (farms and small)', members: SOLAR, mode: 'above', gw: [5, 10, 20, 30, 40, 50], pct: [10, 20, 30, 40, 50] },
    curtailed: { label: 'Wind and solar held back', members: ['wind_curtailed', 'solar_curtailed'], mode: 'above', gw: [1, 2, 5, 10, 15, 20], pct: [2, 5, 10, 15, 20] },
    custom: { label: 'Custom group…', members: WIND_SOLAR, mode: 'above', gw: [10, 20, 30], pct: [20, 30, 40], editable: true },
  },
  logScale: { min: 0.1, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] },
};
