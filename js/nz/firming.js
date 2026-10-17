// When does a 100% renewable grid cost less than keeping fossil backup?
//
// The sizes come from the data: how much fossil generation today's fleet
// needs in a year of average rainfall, how much more each historical dry year
// would have needed, and how many megawatts of fossil output the grid has
// leaned on at its peaks. The costs are 2025 NZ dollars from the public
// sources in SOURCES. Pure functions, so they can be tested in Node.

export const ASSUMPTIONS = {
  wacc: 0.06, // real, pre-tax: NZ Treasury's 5 to 6% range for public projects
  // Q1 2025 NZD capital costs, Beca and Concept for Transpower (2025 Generation Stack).
  tech: {
    geothermal: { label: 'Geothermal', capexPerKw: 5600, omPerKw: 160, loadFactor: 0.92, life: 30, decline: 0.0035 },
    wind: { label: 'Wind', capexPerKw: 3400, omPerKw: 45, loadFactor: 0.38, life: 27, decline: 0.01 },
    solar: { label: 'Solar', capexPerKw: 1900, omPerKw: 20, loadFactor: 0.19, life: 30, decline: 0.025 },
  },
  battery: { capexPerKw: 1700, omShare: 0.025, life: 15, decline: 0.04 }, // two-hour, per kW
  // Keeping existing thermal plant open: staff, maintenance and insurance, no new build.
  thermalFixedPerKw: 80,
  // The fuel that covers an average year is mostly gas; the extra in a dry year is mostly coal at Huntly.
  gas: { pricePerGj: 14, heatRate: 7.5, co2PerGj: 0.0531, vom: 5 },
  coal: { pricePerGj: 7, heatRate: 10.5, co2PerGj: 0.0946, vom: 20 },
  // The capacity to replace: the 99th percentile of fossil output over the latest three years.
  peakQuantile: 0.99,
  peakYears: 3,
};

/** Capital recovery factor: the yearly payment that repays 1 over `years` at `rate`. */
export const crf = (rate, years) => (rate * (1 + rate) ** years) / ((1 + rate) ** years - 1);

/**
 * The sizes the costs are built on, from yearly energy (yearlyEnergy rows)
 * and the half-hourly fossil series in GW.
 * Hydro output stands in for rainfall: the hydro fleet has barely changed
 * since the late 1990s, so a year with less hydro had less water.
 */
export function needs(energyRows, fossilGw, end, a = ASSUMPTIONS) {
  const years = energyRows.filter((r) => r.year !== 'past365' && r.coverage > 0.98);
  const latest = energyRows.find((r) => r.year === 'past365') ?? years.at(-1);
  const meanHydro = years.reduce((s, r) => s + r.twh.hydro, 0) / years.length;
  // Fossil today's fleet would need with average water: the latest year's
  // fossil output, plus however much wetter than average that year was.
  const normalFossil = Math.max(0, latest.fossil + (latest.twh.hydro - meanHydro));
  const byYear = years.map((r) => ({ year: r.year, deficit: meanHydro - r.twh.hydro, fossil: Math.max(0, normalFossil + meanHydro - r.twh.hydro) }));
  const driest = byYear.reduce((x, y) => (y.fossil > x.fossil ? y : x));
  const expectedFossil = byYear.reduce((s, r) => s + r.fossil, 0) / byYear.length;
  const recent = [...fossilGw.subarray(Math.max(0, end - a.peakYears * 365 * 48), end)].filter((v) => !Number.isNaN(v)).sort((x, y) => x - y);
  const peakGw = recent.length ? recent[Math.min(recent.length - 1, Math.floor(a.peakQuantile * recent.length))] : 0;
  return { meanHydro, normalFossil, expectedFossil, byYear, driest, peakGw, years: [years[0].year, years.at(-1).year] };
}

/** Fuel, carbon and running cost of one MWh, NZ$. */
export const fuelCost = (f, carbon) => f.heatRate * (f.pricePerGj + f.co2PerGj * carbon) + f.vom;

/**
 * Yearly cost, NZ$ million, of each way through the record's weather in a
 * given year, at a carbon price (NZ$/t) and a value for surplus renewable
 * energy (NZ$/MWh) in years that don't need it all.
 */
export function yearCosts(n, year, { carbon, surplusValue }, a = ASSUMPTIONS) {
  const t = year - 2025;
  // Keep fossil: fixed costs on the peak capacity, plus fuel for each year's
  // need, gas up to an average year and coal for the rest.
  const gasMwh = fuelCost(a.gas, carbon);
  const coalMwh = fuelCost(a.coal, carbon);
  const fuel = n.byYear.reduce((s, r) => s + Math.min(r.fossil, n.normalFossil) * gasMwh + Math.max(0, r.fossil - n.normalFossil) * coalMwh, 0) / n.byYear.length;
  const keep = (n.peakGw * 1e6 * a.thermalFixedPerKw) / 1e6 + fuel; // GW→kW, TWh→MWh both 1e6
  // 100% renewable: enough of one technology to cover the driest year on
  // record, plus batteries in place of the fossil peak capacity.
  const b = a.battery;
  const batteryCapex = b.capexPerKw * (1 - b.decline) ** t;
  const battery = (n.peakGw * 1e6 * (batteryCapex * (crf(a.wacc, b.life) + b.omShare))) / 1e6;
  const renewables = {};
  for (const [key, g] of Object.entries(a.tech)) {
    const capex = g.capexPerKw * (1 - g.decline) ** t;
    const perKw = capex * crf(a.wacc, g.life) + g.omPerKw;
    const kw = (n.driest.fossil * 1e9) / (g.loadFactor * 8760); // TWh → kWh
    const surplus = (n.driest.fossil - n.expectedFossil) * 1e6 * surplusValue;
    renewables[key] = {
      gw: kw / 1e6,
      lcoe: perKw / (g.loadFactor * 8.76),
      cost: (kw * perKw - surplus) / 1e6 + battery,
    };
  }
  return { year, keep, keepPerMwh: { gas: gasMwh, coal: coalMwh }, battery, renewables };
}

export const PROJECTION = Array.from({ length: 21 }, (_, i) => 2025 + i);

/** Costs for every projection year, and the first year each technology beats keeping fossil. */
export function projection(n, opts, a = ASSUMPTIONS) {
  const rows = PROJECTION.map((y) => yearCosts(n, y, opts, a));
  const crossover = Object.fromEntries(Object.keys(a.tech).map((k) => [k, rows.find((r) => r.renewables[k].cost <= r.keep)?.year ?? null]));
  return { rows, crossover };
}

export const SOURCES = [
  ['Capital costs, heat rates', 'Beca and Concept Consulting for Transpower, 2025 Generation Stack report (Sept 2025), Q1 2025 NZD', 'https://static.transpower.co.nz/public/uncontrolled_docs/2025%20Generation%20Stack%20full%20report.pdf'],
  ['Coal price, existing plant running costs', 'Concept Consulting for the Electricity Authority, thermal generation in the transition (May 2023)', 'https://www.ea.govt.nz/media/documents/Appendix_C_-_Concept_Consulting.pdf'],
  ['Dry-year shortfall of 3 to 5 TWh', 'Parliamentary Commissioner for the Environment, electricity pathways briefing (June 2023)', 'https://pce.parliament.nz/media/yhon4rio/the-economics-of-four-future-electricity-system-pathways-for-new-zealand-media-briefing-kelly.pdf'],
  ['The last 1% of renewables', 'Interim Climate Change Committee, accelerated electrification (2019)', 'https://www.climatecommission.govt.nz/public/Advice-to-govt-docs/ICCC-accelerated-electrification-summary-report.pdf'],
  ['Huntly reserve: 150 MW, up to 600,000 t of coal, to 2035', 'Commerce Commission determination (2025)', 'https://www.comcom.govt.nz/news-and-media/news-and-events/2025/commission-issues-draft-determination-proposing-authorisation-of-gentailers-application-for-strategic-energy-reserve-huntly-firming-option/'],
];
