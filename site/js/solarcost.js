// What would one firm megawatt (1 MW every half hour, all year) cost from
// solar panels and batteries alone, and how does that compare with gas?
// The solar side is sized on the real half-hourly GB solar output in the
// dataset; costs are yearly figures from the public sources listed in
// SOURCES. Pure functions so they can be tested in Node.

export const YEARS = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

/**
 * Published figures for some years only: the years between are filled in at a
 * steady rate of decline. Returns one value per year in YEARS order.
 */
export function steady(points) {
  const known = Object.keys(points).map(Number).sort((a, b) => a - b);
  return YEARS.map((y) => {
    if (points[y] != null) return points[y];
    const a = known.filter((k) => k < y).pop();
    const b = known.find((k) => k > y);
    if (a == null || b == null) return points[a ?? b];
    return points[a] * (points[b] / points[a]) ** ((y - a) / (b - a));
  });
}

/** Years with a published figure, for marking on the chart. */
export const PUBLISHED = { pv: [2010, 2023, 2024, 2025], battery: [2010, 2024, 2025] };

// Values per year in YEARS order. Money is converted to 2024 pounds.
export const COSTS = {
  // ONS CPI index (D7BT, 2015 = 100), annual average.
  cpi: [89.4, 93.4, 96.1, 98.5, 100.0, 100.0, 100.7, 103.4, 105.9, 107.8, 108.7, 111.6, 121.7, 130.5, 133.9, 138.4],
  // ONS USD per GBP, annual average (AUSS).
  usdPerGbp: [1.546, 1.603, 1.5851, 1.5644, 1.6477, 1.5286, 1.3542, 1.2888, 1.335, 1.2766, 1.2837, 1.3757, 1.2362, 1.2434, 1.2783, 1.3185],
  // IRENA: utility-scale solar PV total installed cost, global weighted average, 2024 USD/kW.
  // 2023 is backed out of IRENA's "down 11% to 691"; 2025 is from IRENA's 2025 edition.
  pvUsdPerKw: steady({ 2010: 5283, 2023: 776, 2024: 691, 2025: 667 }),
  // IRENA (2010, 2024) and Ember (2025): utility-scale battery storage total installed cost, 2024 USD/kWh.
  batteryUsdPerKwh: steady({ 2010: 2571, 2024: 192, 2025: 125 }),
  // NBP gas, annual average, nominal USD/MWh (Energy Institute, via Our World in Data).
  gasUsdPerMwh: [22.24, 30.71, 32.15, 36.16, 28.03, 22.26, 15.86, 19.71, 27.2, 15.23, 10.83, 52.72, 83.76, 41.97, 36.47, 39.75],
  // Carbon on GB power: EU ETS (real 2023 EUR/t) to 2020, then UK ETS (nominal £/t).
  etsEur2023: [17.19, 15.72, 8.62, 5.12, 6.73, 8.61, 5.97, 6.41, 17.32, 26.88, 25.79, null, null, null, null, null],
  ukEtsGbp: [null, null, null, null, null, null, null, null, null, null, null, 52.56, 83.03, 64.9, 41.84, 49.41],
  // Carbon Price Support, nominal £/t.
  cpsGbp: [0, 0, 0, 4.94, 9.55, 18.08, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18],
};

export const ASSUMPTIONS = {
  solarLoadFactor: 0.11, // DESNZ large-scale solar
  solarLifeYears: 30,
  solarOmPerMw: 7500, // £/MW/yr, DESNZ 2023 (£6,000 in 2021 £), rounded up to 2024 £
  batteryLifeYears: 15, // NREL ATB
  batteryOmShare: 0.025, // of capex per year
  roundTrip: 0.87,
  solarWacc: 0.06,
  gasWacc: 0.075,
  gasCapexPerMw: 632000, // DESNZ 2025 central: development, construction and connection, 2024 £
  gasLifeYears: 25,
  gasFixedOmPerMw: 15630,
  gasVariableOmPerMwh: 4.44,
  gasEfficiency: 0.54, // 60% LHV, about 54% on the gross calorific basis gas is priced on
  gasAvailability: 0.93,
  gasCo2PerMwhFuel: 0.184, // t CO2 per MWh of gas burned
  eurPerGbp2023: 1.15,
};

export const SOURCES = [
  ['IRENA, Renewable Power Generation Costs in 2024', 'https://www.irena.org/Publications/2025/Jul/Renewable-Power-Generation-Costs-in-2024'],
  ['IRENA, Renewable Power Generation Costs in 2025 (solar, 2025)', 'https://greentechlead.com/solar/solar-pv-installation-costs-fall-88-since-2010-as-global-capacity-surpasses-2393-gw-in-2025-irena-54058'],
  ['Ember, battery storage costs (2025)', 'https://www.energy-storage.news/?p=92133'],
  ['BNEF, lithium-ion battery pack prices', 'https://about.bnef.com/insights/clean-energy/lithium-ion-battery-pack-prices/'],
  ['NREL Annual Technology Baseline 2025, utility-scale batteries', 'https://atb.nlr.gov/electricity/2025/utility-scale_battery_storage'],
  ['Lazard, Levelized Cost of Storage 2025', 'https://www.lazard.com/media/uounhon4/lazards-lcoeplus-june-2025.pdf'],
  ['Modo Energy, GB battery capex survey', 'https://modoenergy.com/research/battery-energy-storage-capex-containerised-bess-development-costs-oem-balance-plant-bop-grid-connections-survey-2024'],
  ['DESNZ, Electricity Generation Costs 2023', 'https://assets.publishing.service.gov.uk/media/6556027d046ed400148b99fe/electricity-generation-costs-2023.pdf'],
  ['DESNZ, Unabated Gas Generation Costs 2025', 'https://assets.publishing.service.gov.uk/media/696616c68d599f4c09e1ffae/unabated-gas-electricity-generation-costs-2025.pdf'],
  ['Energy Institute NBP gas prices, via Our World in Data', 'https://ourworldindata.org/grapher/natural-gas-prices'],
  ['UK ETS carbon price determinations', 'https://www.gov.uk/government/publications/determinations-of-the-uk-ets-carbon-price'],
  ['Danish Energy Agency, EU ETS price history', 'https://ens.dk/media/5518/download'],
  ['HMRC, Carbon Price Support rates', 'https://www.gov.uk/government/statistics/environmental-taxes-bulletin/environmental-taxes-bulletin-historical-rates'],
  ['ONS, CPI index (D7BT)', 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bt/mm23'],
  ['ONS, US dollar exchange rate (AUSS)', 'https://www.ons.gov.uk/economy/nationalaccounts/balanceofpayments/timeseries/auss/mret'],
  ['Royal Society, Large-scale electricity storage (2023)', 'https://royalsociety.org/news-resources/projects/low-carbon-energy-programme/large-scale-electricity-storage/'],
];

// Panel sizes tried, in MW of panels per firm MW.
export const PANEL_SIZES = [10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 120, 150];

const DAY = 48;

/**
 * Solar output per MW of panels for each half hour of the given whole years.
 * NESO's solar column grows as panels are installed, so each day is divided by
 * a running estimate of the fleet's size (a high percentile of daily peaks
 * over the surrounding year), then the whole series is scaled to the
 * long-run load factor.
 */
export function solarShape(data, fromYear, toYear, loadFactor = ASSUMPTIONS.solarLoadFactor) {
  const { columns, startMs } = data;
  const solar = columns.solar;
  const days = Math.floor(data.length / DAY);
  const peaks = new Float64Array(days);
  for (let d = 0; d < days; d++) {
    let m = 0;
    for (let k = d * DAY; k < (d + 1) * DAY; k++) if (solar[k] > m) m = solar[k];
    peaks[d] = m;
  }
  const from = Math.round((Date.UTC(fromYear, 0, 1) - startMs) / 18e5);
  const to = Math.round((Date.UTC(toYear + 1, 0, 1) - startMs) / 18e5);
  if (from < 0 || to > days * DAY) return null;
  const out = new Float64Array(to - from);
  for (let d = from / DAY; d < to / DAY; d++) {
    const lo = Math.max(0, d - 182);
    const win = Array.from(peaks.subarray(lo, Math.min(days, lo + 365))).sort((a, b) => a - b);
    const cap = win[Math.floor(win.length * 0.95)] || 1;
    for (let k = 0; k < DAY; k++) {
      const v = solar[d * DAY + k];
      out[d * DAY + k - from] = Number.isFinite(v) && v > 0 ? v / cap : 0;
    }
  }
  let sum = 0;
  for (const v of out) sum += v;
  const scale = loadFactor / (sum / out.length);
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  return out;
}

/**
 * Smallest battery (MWh) that lets `panels` MW of panels deliver 1 MW in
 * every half hour of the shape. Surplus charges the battery, losing the
 * round trip on the way in; anything beyond that is spilled.
 */
export function batteryForFirm(shape, panels, roundTrip = ASSUMPTIONS.roundTrip) {
  let deficit = 0;
  let worst = 0;
  for (let i = 0; i < shape.length; i++) {
    const g = panels * shape[i];
    if (g >= 1) deficit = Math.max(0, deficit - roundTrip * (g - 1) * 0.5);
    else if ((deficit += (1 - g) * 0.5) > worst) worst = deficit;
  }
  return worst;
}

/** Share of the 1 MW that panels plus a battery of `mwh` fail to supply, starting full. */
export function unservedShare(shape, panels, mwh, roundTrip = ASSUMPTIONS.roundTrip) {
  let soc = mwh;
  let missed = 0;
  for (let i = 0; i < shape.length; i++) {
    const g = panels * shape[i];
    if (g >= 1) soc = Math.min(mwh, soc + roundTrip * (g - 1) * 0.5);
    else {
      const need = (1 - g) * 0.5;
      const d = Math.min(soc, need);
      soc -= d;
      missed += need - d;
    }
  }
  return missed / (shape.length * 0.5);
}

/** Smallest battery that supplies at least `share` of the energy. */
export function batteryForShare(shape, panels, share) {
  let hi = batteryForFirm(shape, panels);
  let lo = 0;
  if (unservedShare(shape, panels, 0) <= 1 - share) return 0;
  for (let k = 0; k < 24 && hi - lo > 0.05; k++) {
    const mid = (lo + hi) / 2;
    if (unservedShare(shape, panels, mid) <= 1 - share) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Battery needed at each panel size, for each reliability level. */
export function sizing(shape, shares = [1, 0.99]) {
  return shares.map((share) => ({
    share,
    options: PANEL_SIZES.map((panels) => ({ panels, mwh: share === 1 ? batteryForFirm(shape, panels) : batteryForShare(shape, panels, share) })),
  }));
}

const crf = (r, n) => (r * (1 + r) ** n) / ((1 + r) ** n - 1);

/** Yearly cost inputs converted to 2024 pounds. */
export function yearInputs(k, c = COSTS) {
  const toReal = c.cpi[YEARS.indexOf(2024)] / c.cpi[k];
  const usd24 = c.usdPerGbp[YEARS.indexOf(2024)];
  const carbon = c.ukEtsGbp[k] != null
    ? c.ukEtsGbp[k] * toReal
    : (c.etsEur2023[k] / ASSUMPTIONS.eurPerGbp2023) * (c.cpi[YEARS.indexOf(2024)] / c.cpi[YEARS.indexOf(2023)]);
  return {
    year: YEARS[k],
    panelPerMw: (c.pvUsdPerKw[k] * 1000) / usd24,
    batteryPerMwh: (c.batteryUsdPerKwh[k] * 1000) / usd24,
    gasPerMwhFuel: (c.gasUsdPerMwh[k] / c.usdPerGbp[k]) * toReal,
    carbonPerT: carbon + c.cpsGbp[k] * toReal,
  };
}

/** Cheapest panel and battery pair for one year's prices, in £ per MWh of firm power. */
export function cheapestSolar(options, inp, a = ASSUMPTIONS) {
  const panelYear = inp.panelPerMw * crf(a.solarWacc, a.solarLifeYears) + a.solarOmPerMw;
  const batteryYear = inp.batteryPerMwh * (crf(a.solarWacc, a.batteryLifeYears) + a.batteryOmShare);
  let best = null;
  for (const o of options) {
    const cost = (o.panels * panelYear + o.mwh * batteryYear) / 8760;
    if (!best || cost < best.cost) best = { ...o, cost, panelShare: (o.panels * panelYear) / 8760 / cost };
  }
  return best;
}

/** Gas: £ per MWh of firm power, for running an existing plant and for building a new one. */
export function gasCost(inp, a = ASSUMPTIONS) {
  const fuel = inp.gasPerMwhFuel / a.gasEfficiency;
  const carbon = (a.gasCo2PerMwhFuel / a.gasEfficiency) * inp.carbonPerT;
  // A plant is available 93% of the time, so a firm MW needs 1/0.93 MW of plant.
  const fixed = a.gasFixedOmPerMw / a.gasAvailability / 8760;
  const existing = fuel + carbon + a.gasVariableOmPerMwh + fixed;
  const build = (a.gasCapexPerMw * crf(a.gasWacc, a.gasLifeYears)) / a.gasAvailability / 8760;
  return { fuel, carbon, existing, newBuild: existing + build, build };
}

/** The full comparison, one row per year. */
export function firmCosts(sized, c = COSTS) {
  return YEARS.map((year, k) => {
    const inp = yearInputs(k, c);
    return { ...inp, solar: sized.map((s) => ({ share: s.share, ...cheapestSolar(s.options, inp) })), gas: gasCost(inp) };
  });
}

/** Average output per MW of panels in each calendar month, for the shape's years. */
export function monthlyLoadFactor(shape, fromYear) {
  const sums = new Float64Array(12);
  const counts = new Float64Array(12);
  const start = Date.UTC(fromYear, 0, 1);
  for (let i = 0; i < shape.length; i++) {
    const m = new Date(start + i * 18e5).getUTCMonth();
    sums[m] += shape[i];
    counts[m]++;
  }
  return Array.from(sums, (s, m) => s / counts[m]);
}
