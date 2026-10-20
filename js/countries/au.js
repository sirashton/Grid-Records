// Australia's National Electricity Market: AEMO's unit output, rooftop solar
// estimate and spot prices since 2015, half-hourly. Built by
// pipeline/build-au.mjs into site/data/au/<area>/: nem for the whole market,
// and nsw, qld, vic, sa and tas for each state.

const RENEWABLE = ['wind', 'solar_utility', 'solar_rooftop', 'hydro', 'biomass'];
const FOSSIL = ['coal', 'lignite', 'gas', 'oil'];

export default {
  code: 'au',
  name: 'Australia (NEM)',
  locale: 'en-AU',
  // NEM time: AEST all year.
  timeZone: 'Australia/Brisbane',
  dataPath: '../data/au/nem',
  // AEMO's 5-minute reports fill in the weeks since the last monthly archive.
  live: true,
  endColumn: 'coal',
  smallInMw: true,
  fuels: {
    coal: { label: 'Black coal', color: '--f-coal', fossil: true },
    lignite: { label: 'Brown coal', color: '--f-lignite', fossil: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    oil: { label: 'Diesel and oil', color: '--f-diesel', fossil: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true },
    solar_utility: { label: 'Solar farms', color: '--f-solar', renewable: true },
    // AEMO's estimate starts in August 2016.
    solar_rooftop: { label: 'Rooftop solar', color: '--f-rooftop', renewable: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true },
    biomass: { label: 'Bioenergy', color: '--f-biomass', renewable: true },
    other: { label: 'Other', color: '--f-other' },
    // Batteries only move energy in time, so they are left out of the total, as in AEMO's renewable share.
    battery: { label: 'Battery discharge', color: '--f-battery', inTotal: false },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, inTotal: false, notGeneration: true },
    pumped_storage_charge: { label: 'Pumped hydro pumping', color: '--f-hydro-2', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [15, 12, 10, 8, 6, 4], pct: [60, 50, 40, 30, 20, 10] },
    coal: { label: 'Coal (black and brown)', members: ['coal', 'lignite'], mode: 'below', gw: [14, 12, 10, 8, 6], pct: [50, 40, 30, 20, 10] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [2, 1, 0.5, 0.25, 0.1], pct: [10, 5, 2, 1] },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [10, 15, 20, 25], pct: [40, 50, 60, 70, 80], editable: true },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [4, 6, 8, 10], pct: [20, 30, 40, 50] },
    solar: { label: 'Solar (farms and rooftops)', members: ['solar_utility', 'solar_rooftop'], mode: 'above', gw: [5, 10, 15, 20, 25], pct: [30, 40, 50, 60] },
    rooftop: { label: 'Rooftop solar', members: ['solar_rooftop'], mode: 'above', gw: [4, 8, 12, 16], pct: [20, 30, 40, 50] },
    battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.5, 1, 2, 3], pct: [2, 5, 10] },
    charging: { label: 'Battery charging', members: ['battery_charge'], mode: 'above', gw: [0.5, 1, 2, 3], pct: [2, 5, 10] },
    custom: { label: 'Custom group…', members: ['wind', 'solar_utility', 'solar_rooftop'], mode: 'above', gw: [5, 10, 15], pct: [30, 40, 50], editable: true },
  },
  logScale: { min: 0.01, ticks: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] },
};

export const AREAS = { nem: 'Whole NEM', nsw: 'NSW', qld: 'Queensland', vic: 'Victoria', sa: 'South Australia', tas: 'Tasmania' };
