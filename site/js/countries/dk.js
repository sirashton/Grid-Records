// Denmark, DK1 and DK2 added together: Energinet's Energi Data Service,
// GenerationProdTypeExchange, hourly from 2015 with production by each
// plant's main fuel and the flow on every interconnector. Built by
// pipeline/build-dk.mjs into site/data/dk/, with the mean DK1/DK2 day-ahead
// price as `price` and each border's net flow as net_no, net_se, net_de,
// net_nl and net_gb (positive into Denmark). The latest hour is usually one
// to two hours old (Energinet's "Initial" figures, replaced by settlement
// data after about 8 days).

const WIND = ['wind_onshore', 'wind_offshore'];
const RENEWABLE = [...WIND, 'solar', 'biomass', 'hydro'];
const FOSSIL = ['coal', 'gas', 'oil'];

export default {
  code: 'dk',
  name: 'Denmark',
  locale: 'en-GB',
  timeZone: 'Europe/Copenhagen',
  dataPath: '../data/dk',
  live: true,
  endColumn: 'wind_onshore',
  smallInMw: true,
  fuels: {
    wind_onshore: { label: 'Onshore wind', color: '--f-wind', renewable: true, lowCarbon: true },
    wind_offshore: { label: 'Offshore wind', color: '--f-wind-off', renewable: true, lowCarbon: true },
    solar: { label: 'Solar', color: '--f-solar', renewable: true, lowCarbon: true },
    // Wood pellets, wood chips and straw in combined heat and power plants, and biogas.
    biomass: { label: 'Biomass and biogas', color: '--f-biomass', renewable: true, lowCarbon: true },
    hydro: { label: 'Hydro', color: '--f-hydro', renewable: true, lowCarbon: true },
    // Waste incineration: part fossil (plastics), part biogenic, so in neither group.
    waste: { label: 'Waste', color: '--f-other' },
    coal: { label: 'Coal', color: '--f-coal', fossil: true },
    gas: { label: 'Gas', color: '--f-gas', fossil: true },
    oil: { label: 'Oil', color: '--f-diesel', fossil: true },
    // Net trade is not Danish generation, so it is left out of the total.
    imports: { label: 'Net imports', color: '--f-imports', inTotal: false },
    exports: { label: 'Net exports', color: '--f-imports', abs: true, inTotal: false, notGeneration: true },
  },
  presets: {
    // Denmark's fossil output is under 1 GW most hours now, so the ladder runs down to zero in MW steps.
    fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [2, 1, 0.5, 0.3, 0.2, 0.1, 0.05, 0], pct: [30, 20, 10, 5, 3, 2, 1] },
    coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [1, 0.5, 0.2, 0.1, 0.05, 0.01, 0], pct: [20, 10, 5, 2, 1, 0] },
    gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [0.5, 0.3, 0.2, 0.1, 0.05], pct: [10, 5, 3, 2, 1] },
    fossilwaste: { label: 'Fossil fuels and waste', members: [...FOSSIL, 'waste'], mode: 'below', gw: [2, 1, 0.5, 0.3, 0.2, 0.1], pct: [30, 20, 10, 5, 3] },
    thermal: { label: 'All burning (fossil, waste, biomass)', members: [...FOSSIL, 'waste', 'biomass'], mode: 'below', gw: [3, 2, 1.5, 1, 0.5, 0.3], pct: [50, 40, 30, 20, 10, 5] },
    fossilhigh: { label: 'Fossil fuels, high output', members: FOSSIL, mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [10, 20, 30, 40, 50] },
    renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [2, 4, 6, 8, 10], pct: [50, 75, 90, 95, 99], editable: true },
    wind: { label: 'Wind', members: WIND, mode: 'above', gw: [2, 4, 5, 6, 7, 8], pct: [50, 60, 70, 80, 90] },
    windlow: { label: 'Wind, calm spells', members: WIND, mode: 'below', gw: [0.5, 0.2, 0.1, 0.05], pct: [10, 5, 3, 2] },
    solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [20, 30, 40, 50, 60] },
    imports: { label: 'Net imports', members: ['imports'], mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [20, 30, 50, 75, 100] },
    exports: { label: 'Net exports', members: ['exports'], mode: 'above', gw: [1, 2, 3, 4, 5], pct: [20, 40, 60, 80] },
    custom: { label: 'Custom group…', members: ['solar', ...WIND], mode: 'above', gw: [2, 4, 6], pct: [50, 75, 90], editable: true },
  },
  logScale: { min: 0.01, ticks: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10] },
};
