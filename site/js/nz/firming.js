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
    // No new hydro projects are costed in the report, only a generic 9,200 $/kW.
    // Running costs and life are assumptions.
    hydro: { label: 'Hydro', capexPerKw: 9200, omPerKw: 45, loadFactor: 0.5, life: 60, decline: 0 },
  },
  // Share of each GW that can be counted on at a winter evening peak, so
  // needs no battery behind it. Wind and solar are counted as nothing.
  peakCredit: { geothermal: 0.92, hydro: 0.9 },
  // The most of each the cheapest mix may build, GW. Geothermal: the known
  // fields' headroom left after the plants built since 2024 (GNS Science, via
  // Castalia). Hydro: schemes MBIE rated six out of ten or better to consent.
  limits: { geothermal: 0.2, hydro: 1.3 },
  battery: { capexPerKw: 1700, omShare: 0.025, life: 15, decline: 0.04 }, // two-hour, per kW
  // Huntly's battery is already being built and counts toward the peak:
  // 100 MW from mid-2026 and another 100 MW around 2029 (Genesis).
  committedBatteryGw: 0.2,
  // Keeping existing thermal plant open: staff, maintenance and insurance, no new build.
  thermalFixedPerKw: 80,
  // The fuel that covers an average year is mostly gas; the extra in a dry year is mostly coal at Huntly.
  gas: { pricePerGj: 14, heatRate: 7.5, co2PerGj: 0.0531, vom: 5 },
  // Gas if it has to be imported as LNG: about US$15 per million BTU landed,
  // near Asian spot prices in 2025 plus shipping and regasification. An assumption.
  importedGasPerGj: 25,
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
 * given year, at a carbon price (NZ$/t), a value for surplus renewable
 * energy (NZ$/MWh) in years that don't need it all, and optionally a gas
 * price (NZ$/GJ) in place of the assumed domestic one.
 */
export function yearCosts(n, year, { carbon, surplusValue, gasPrice }, a = ASSUMPTIONS) {
  const t = year - 2025;
  // Keep fossil: fixed costs on the peak capacity, plus fuel for each year's
  // need, gas up to an average year and coal for the rest.
  const gasMwh = fuelCost({ ...a.gas, pricePerGj: gasPrice ?? a.gas.pricePerGj }, carbon);
  const coalMwh = fuelCost(a.coal, carbon);
  const fuel = n.byYear.reduce((s, r) => s + Math.min(r.fossil, n.normalFossil) * gasMwh + Math.max(0, r.fossil - n.normalFossil) * coalMwh, 0) / n.byYear.length;
  const keep = (n.peakGw * 1e6 * a.thermalFixedPerKw) / 1e6 + fuel; // GW→kW, TWh→MWh both 1e6
  // 100% renewable: enough of one technology to cover the driest year on
  // record, plus batteries in place of the fossil peak capacity. The lake
  // model's sizes (n.sizes, GW) replace sizing on the yearly average when given.
  const battery = batteryCost(n, year, {}, a).cost;
  const renewables = {};
  for (const [key, g] of Object.entries(a.tech)) {
    const gw = n.sizes?.[key] ?? (n.driest.fossil * 1e3) / (g.loadFactor * 8760); // TWh → GW
    renewables[key] = { ...buildCost(n, year, { [key]: gw }, surplusValue, a), gw, lcoe: perKwYear(g, year, a) / (g.loadFactor * 8.76) };
  }
  // The cheapest mix of geothermal, hydro, solar and batteries this year,
  // from the mixes the lake model found would get through the record.
  if (n.mixes?.length) {
    renewables.mix = n.mixes.map((add) => ({ add, ...buildCost(n, year, add, surplusValue, a) })).reduce((x, y) => (y.cost < x.cost ? y : x));
  }
  return { year, keep, keepPerMwh: { gas: gasMwh, coal: coalMwh }, battery, renewables };
}

/** NZ$ a year to build and run one kW of a technology bought in `year`. */
export const perKwYear = (g, year, a = ASSUMPTIONS) => g.capexPerKw * (1 - g.decline) ** (year - 2025) * crf(a.wacc, g.life) + g.omPerKw;

/**
 * NZ$ million a year for two-hour batteries in place of the fossil peak
 * capacity, less Huntly's battery and whatever firm capacity a build adds.
 */
export function batteryCost(n, year, add = {}, a = ASSUMPTIONS) {
  const b = a.battery;
  const firm = Object.entries(add).reduce((s, [k, gw]) => s + gw * (a.peakCredit[k] ?? 0), 0);
  const gw = Math.max(0, n.peakGw - a.committedBatteryGw - firm);
  return { gw, cost: gw * b.capexPerKw * (1 - b.decline) ** (year - 2025) * (crf(a.wacc, b.life) + b.omShare) };
}

/**
 * NZ$ million a year for a build ({ tech: GW }) and the batteries it still
 * needs, less what its energy beyond an average year's need sells for.
 */
export function buildCost(n, year, add, surplusValue = 0, a = ASSUMPTIONS) {
  const plant = Object.entries(add).reduce((s, [k, gw]) => s + gw * perKwYear(a.tech[k], year, a), 0); // GW × $/kW = $m
  const spareTwh = Object.entries(add).reduce((s, [k, gw]) => s + gw * a.tech[k].loadFactor * 8.76, 0) - n.expectedFossil;
  const bat = batteryCost(n, year, add, a);
  return { plant, batteryGw: bat.gw, battery: bat.cost, spareTwh, cost: plant + bat.cost - Math.max(0, spareTwh) * surplusValue };
}

export const PROJECTION = Array.from({ length: 21 }, (_, i) => 2025 + i);

/** Costs for every projection year, and the first year each technology beats keeping fossil. */
export function projection(n, opts, a = ASSUMPTIONS) {
  const rows = PROJECTION.map((y) => yearCosts(n, y, opts, a));
  const crossover = Object.fromEntries(Object.keys(rows[0].renewables).map((k) => [k, rows.find((r) => r.renewables[k].cost <= r.keep)?.year ?? null]));
  return { rows, crossover };
}

export const SOURCES = [
  ['Capital costs, heat rates', 'Beca and Concept Consulting for Transpower, 2025 Generation Stack report (Sept 2025), Q1 2025 NZD', 'https://static.transpower.co.nz/public/uncontrolled_docs/2025%20Generation%20Stack%20full%20report.pdf'],
  ['Coal price, existing plant running costs', 'Concept Consulting for the Electricity Authority, thermal generation in the transition (May 2023)', 'https://www.ea.govt.nz/media/documents/Appendix_C_-_Concept_Consulting.pdf'],
  ['Dry-year shortfall of 3 to 5 TWh', 'Parliamentary Commissioner for the Environment, electricity pathways briefing (June 2023)', 'https://pce.parliament.nz/media/yhon4rio/the-economics-of-four-future-electricity-system-pathways-for-new-zealand-media-briefing-kelly.pdf'],
  ['The last 1% of renewables', 'Interim Climate Change Committee, accelerated electrification (2019)', 'https://www.climatecommission.govt.nz/public/Advice-to-govt-docs/ICCC-accelerated-electrification-summary-report.pdf'],
  ['Lake inflows and storage, 1980 to 2024', 'Electricity Authority, Hydrological Modelling Dataset (to Dec 2024)', 'https://www.emi.ea.govt.nz/Environment/Datasets/HydrologicalModellingDataset'],
  ['Wind and sunshine, 1980 to 2024', 'ERA5 reanalysis via the Open-Meteo historical weather API', 'https://open-meteo.com/en/docs/historical-weather-api'],
  ['Huntly battery: 100 MW / 200 MWh in 2026, 200 MW / 400 MWh by about 2029', 'Genesis to the NZX (2026)', 'https://announcements.nzx.com/announcement/471153'],
  ['Floating solar at Rosedale: 1 MW on one hectare', 'pv magazine (Oct 2020)', 'https://www.pv-magazine-australia.com/2020/10/07/something-to-be-buoyant-about-nzs-largest-solar-array-is-afloat/'],
  ['Plans to import LNG', 'MBIE, Government says yes to liquefied natural gas (Feb 2026)', 'https://www.mbie.govt.nz/about/news/government-says-yes-to-liquefied-natural-gas'],
  ['Huntly reserve: 150 MW, up to 600,000 t of coal, to 2035', 'Commerce Commission determination (2025)', 'https://www.comcom.govt.nz/news-and-media/news-and-events/2025/commission-issues-draft-determination-proposing-authorisation-of-gentailers-application-for-strategic-energy-reserve-huntly-firming-option/'],
];
