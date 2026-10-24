// Western Australia's South West Interconnected System (SWIS), the grid
// around Perth that AEMO runs as the Wholesale Electricity Market (WEM). Not
// connected to the eastern states. Half-hourly facility output since
// September 2006 (5-minute since October 2023, averaged), AEMO's rooftop solar
// estimate since November 2020, and operational demand. Built by
// pipeline/build-wa.mjs into site/data/wa/. AEMO rewrites the current
// month's files each morning with data to 08:00 Perth time, so the latest
// data is up to a day old.

const RENEWABLE = ['wind', 'solar_utility', 'solar_rooftop', 'biomass'];
const FOSSIL = ['coal', 'gas', 'oil'];
const SOLAR = ['solar_utility', 'solar_rooftop'];

export default {
  code: 'wa',
  name: 'Western Australia',
  locale: 'en-AU',
  timeZone: 'Australia/Perth',
  dataPath: '../data/wa',
  live: false,
  endColumn: 'coal',
  smallInMw: true,
  fuels: {
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    oil: { label: 'Diesel', color: '--f-diesel', fossil: true },
    wind: { label: 'Wind', color: '--f-wind', renewable: true, lowCarbon: true },
    solar_utility: { label: 'Solar farms', color: '--f-solar', renewable: true, lowCarbon: true },
    // AEMO's estimate starts in November 2020.
    solar_rooftop: { label: 'Rooftop solar', color: '--f-rooftop', renewable: true, lowCarbon: true, optional: true },
    biomass: { label: 'Landfill gas and waste', color: '--f-biomass', renewable: true, lowCarbon: true },
    other: { label: 'Other', color: '--f-other' },
    // Batteries only move energy in time, so they are left out of the total, as on the NEM page.
    battery: { label: 'Battery discharge', color: '--f-battery', inTotal: false },
    battery_charge: { label: 'Battery charging', color: '--f-battery', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [2, 1.5, 1.25, 1, 0.75, 0.5], pct: [70, 60, 50, 40, 30, 20] },
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [1.5, 1.25, 1, 0.75, 0.5, 0.25, 0], pct: [50, 40, 30, 20, 10, 0] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [1.5, 1, 0.75, 0.5, 0.25], pct: [40, 30, 20, 10] },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [1, 1.5, 2, 2.5, 3], pct: [40, 50, 60, 70, 80, 90], editable: true },
    wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [0.5, 0.75, 1, 1.25, 1.5], pct: [20, 30, 40, 50, 60] },
    solar: { label: 'Solar (farms and rooftops)', members: SOLAR, mode: 'above', gw: [1, 1.5, 2, 2.5, 3], pct: [40, 50, 60, 70, 80] },
    rooftop: { label: 'Rooftop solar', members: ['solar_rooftop'], mode: 'above', gw: [1, 1.5, 2, 2.5], pct: [40, 50, 60, 70] },
    battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.1, 0.25, 0.5, 0.75, 1, 1.5], pct: [5, 10, 20, 30, 40] },
    charging: { label: 'Battery charging', members: ['battery_charge'], mode: 'above', gw: [0.1, 0.25, 0.5, 0.75, 1, 1.5], pct: [5, 10, 20, 30, 40] },
    custom: { label: 'Custom group…', members: ['wind', 'solar_utility', 'solar_rooftop'], mode: 'above', gw: [1, 1.5, 2], pct: [50, 60, 70], editable: true },
  },
  logScale: { min: 0.01, ticks: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5] },
};
