// A day-by-day model of New Zealand's hydro lakes with no fossil fuel.
//
// Each day from 1980 to 2024 replays that day's inflow to the lakes and that
// day's wind and sunshine (site/nz/lakes.json, built by pipeline/nz-lakes)
// against today's grid: the latest 365 days of demand, geothermal, wind and
// solar. Wind, solar and geothermal go first and the lakes cover the rest.
// Water is only drawn when it's needed, which is the best a lake operator
// could do, so any day the lakes run dry is a day fossil fuel was unavoidable.
// Pure functions, so they can be tested in Node.

export const LAKE = {
  // Hydro output the rivers' minimum flows and run-of-river stations force
  // even on days with spare wind and sun. An assumption.
  hydroMinGw: 0.8,
  // Roughly the hydro fleet's capacity; more than this in a day can't come from the lakes.
  hydroMaxGw: 5.3,
  load: { geothermal: 0.92, wind: 0.38, solar: 0.19 }, // as in the cost model
};

const DAY = 864e5;
const dayKey = (ms) => new Date(ms).toISOString().slice(5, 10);

/**
 * Today's grid from the latest 365 days, one row per day:
 * { date: 'YYYY-MM-DD', total, geothermal, bioenergy, wind, solar } in GWh.
 * Existing wind and solar become GW at the cost model's load factors.
 */
export function fleetFromDays(days, l = LAKE) {
  const sum = (k) => days.reduce((s, d) => s + (d[k] ?? 0), 0);
  const demand = new Map(days.map((d) => [d.date.slice(5), d.total]));
  if (!demand.has('02-29')) demand.set('02-29', demand.get('02-28'));
  const n = days.length;
  return {
    demand,
    demandTwh: sum('total') / 1000,
    geoGwh: sum('geothermal') / n,
    bioGwh: sum('bioenergy') / n,
    windGw: sum('wind') / (l.load.wind * 24 * n),
    solarGw: sum('solar') / (l.load.solar * 24 * n),
  };
}

// Today's demand laid out over every day of the record, by calendar day.
const demandCache = new WeakMap();
function demandByDay(inputs, fleet) {
  let d = demandCache.get(fleet);
  if (!d || d.length !== inputs.days) {
    const first = Date.parse(inputs.first);
    d = Float64Array.from({ length: inputs.days }, (_, i) => fleet.demand.get(dayKey(first + i * DAY)));
    demandCache.set(fleet, d);
  }
  return d;
}

/**
 * Runs the record twice, starting the second pass where the first ended, so
 * the start doesn't depend on a guess of 1980's lake levels.
 * add: extra GW of { geothermal, wind, solar }. Returns the shortfall (GWh)
 * by year and, with track, the lake level each day.
 */
export function simulate(inputs, fleet, add = {}, { cap = inputs.activeGwh, track = false } = {}, l = LAKE) {
  const wind = fleet.windGw + (add.wind ?? 0);
  const solar = fleet.solarGw + (add.solar ?? 0);
  const flat = fleet.geoGwh + fleet.bioGwh + (add.geothermal ?? 0) * l.load.geothermal * 24;
  const hmin = l.hydroMinGw * 24;
  const hmax = l.hydroMaxGw * 24;
  const demand = demandByDay(inputs, fleet);
  const first = Date.parse(inputs.first);
  const years = new Map();
  const level = track ? new Float32Array(inputs.days) : null;
  let s = cap * 0.7;
  let short = 0;
  let spill = 0;
  let curtailed = 0;
  for (let pass = 0; pass < 2; pass++) {
    let year = Number(inputs.first.slice(0, 4));
    let nextYear = Date.UTC(year + 1, 0, 1);
    for (let i = 0; i < inputs.days; i++) {
      if (first + i * DAY >= nextYear) { year++; nextYear = Date.UTC(year + 1, 0, 1); }
      const need = demand[i] - flat - (inputs.wind[i] * wind + inputs.solar[i] * solar) * 24;
      const draw = Math.min(hmax, Math.max(hmin, need));
      let gap = Math.max(0, need - draw);
      s += inputs.inflow[i] * inputs.inflowScale - draw;
      if (s < 0) { gap -= s; s = 0; }
      if (pass === 0) { s = Math.min(s, cap); continue; }
      if (s > cap) { spill += s - cap; s = cap; }
      if (need < hmin) curtailed += hmin - need;
      if (gap > 0) { short += gap; years.set(year, (years.get(year) ?? 0) + gap); }
      if (level) level[i] = s;
    }
  }
  const nYears = inputs.days / 365.25;
  const worst = [...years].reduce((a, b) => (b[1] > a[1] ? b : a), [null, 0]);
  return { short, years, worst: { year: worst[0], gwh: worst[1] }, level, spillTwh: spill / 1000 / nYears, curtailedTwh: curtailed / 1000 / nYears };
}

/** The least GW of one technology that gets through every year on record with the lakes never empty. */
export function minimumBuild(inputs, fleet, tech, opts = {}, max = 40, l = LAKE) {
  const shortAt = (gw) => simulate(inputs, fleet, { [tech]: gw }, opts, l).short;
  if (shortAt(0) <= 0) return 0;
  if (shortAt(max) > 0) return null;
  let lo = 0;
  let hi = max;
  while (hi - lo > 0.005) {
    const mid = (lo + hi) / 2;
    if (shortAt(mid) > 0) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * GW of each technology needed on its own, the energy that makes a year, and
 * that energy against geothermal's: how much of each MWh counts in a dry year.
 */
export function lakeSizes(inputs, fleet, opts = {}, l = LAKE) {
  const out = {};
  for (const tech of Object.keys(l.load)) {
    const gw = minimumBuild(inputs, fleet, tech, opts, 40, l);
    out[tech] = { gw, twh: gw === null ? null : gw * l.load[tech] * 8.76 };
  }
  for (const r of Object.values(out)) r.value = r.twh ? out.geothermal.twh / r.twh : null;
  return out;
}

/** Wind and sunshine in the driest years, against the 1980 to 2024 average, in %. */
export function dryYearWeather(inputs, n = 5) {
  const years = new Map();
  const first = Date.parse(inputs.first);
  for (let i = 0; i < inputs.days; i++) {
    const y = new Date(first + i * DAY).getUTCFullYear();
    const r = years.get(y) ?? { year: y, inflow: 0, wind: 0, solar: 0, days: 0 };
    r.inflow += inputs.inflow[i];
    r.wind += inputs.wind[i];
    r.solar += inputs.solar[i];
    r.days++;
    years.set(y, r);
  }
  const rows = [...years.values()].filter((r) => r.days >= 365).map((r) => ({ year: r.year, inflow: r.inflow, wind: r.wind / r.days, solar: r.solar / r.days }));
  const mean = (k, rs) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
  const driest = [...rows].sort((a, b) => a.inflow - b.inflow).slice(0, n);
  const pct = (k) => (mean(k, driest) / mean(k, rows) - 1) * 100;
  return { years: driest.map((r) => r.year), windPct: pct('wind'), solarPct: pct('solar'), inflowPct: pct('inflow') };
}

/** Solar's output each month, as a share of its average month. */
export function solarSeason(inputs) {
  const m = Array.from({ length: 12 }, () => [0, 0]);
  const first = Date.parse(inputs.first);
  for (let i = 0; i < inputs.days; i++) {
    const k = new Date(first + i * DAY).getUTCMonth();
    m[k][0] += inputs.solar[i];
    m[k][1]++;
  }
  const means = m.map(([s, c]) => s / c);
  const avg = means.reduce((a, b) => a + b) / 12;
  return means.map((v) => v / avg);
}
