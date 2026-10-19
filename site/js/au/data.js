// Australian (NEM) fuels, metric series and the figures behind the AU story.
// Pure functions, shared by the browser and the Node tests.

export const FUELS = {
  black_coal: { label: 'Black coal', color: '--f-coal', fossil: true },
  brown_coal: { label: 'Brown coal', color: '--f-brown', fossil: true },
  gas: { label: 'Gas', color: '--f-gas', fossil: true },
  liquid: { label: 'Diesel and oil', color: '--f-diesel', fossil: true },
  hydro: { label: 'Hydro', color: '--f-hydro', renewable: true },
  wind: { label: 'Wind', color: '--f-wind', renewable: true },
  solar: { label: 'Solar farms', color: '--f-solar', renewable: true },
  rooftop: { label: 'Rooftop solar', color: '--f-rooftop', renewable: true },
  bioenergy: { label: 'Bioenergy', color: '--f-biomass', renewable: true },
  other: { label: 'Other', color: '--f-other' },
  battery: { label: 'Battery discharge', color: '--f-battery', storage: true },
  battery_charge: { label: 'Battery charging', color: '--f-battery', storage: true, notGeneration: true },
  pumping: { label: 'Pumped hydro pumping', color: '--f-hydro-2', storage: true, notGeneration: true },
};

export const FOSSIL = Object.keys(FUELS).filter((k) => FUELS[k].fossil);
export const COAL = ['black_coal', 'brown_coal'];
export const RENEWABLE = Object.keys(FUELS).filter((k) => FUELS[k].renewable);
export const SOLAR = ['solar', 'rooftop'];
// Batteries only move energy in time, so they are left out of the total, as in AEMO's renewable share.
export const GENERATION = Object.keys(FUELS).filter((k) => !FUELS[k].storage);

export const TZ = 'Australia/Brisbane';
// NEM time is UTC+10 all year.
const OFFSET = 10 * 3600000;
const SLOT_H = 0.5;
const YEAR_SLOTS = 365 * 48;
export const nemYear = (ms) => new Date(ms + OFFSET).getUTCFullYear();
export const nemNewYear = (y) => Date.UTC(y, 0, 1) - OFFSET;
/** "YYYY-MM" of an instant, in NEM time. */
export const nemMonth = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 7);
/** Half hour of the NEM day, 0 to 47. */
export const nemSlotOfDay = (ms) => Math.floor(((ms + OFFSET) % 86400000) / 1800000);

/** Sum of the listed columns at slot i, or NaN if any is missing. */
function sumAt(columns, names, i) {
  let v = 0;
  for (const n of names) {
    const c = columns[n];
    if (!c) continue;
    if (Number.isNaN(c[i])) return NaN;
    if (c[i] > 0) v += c[i];
  }
  return v;
}

const totals = new WeakMap();
export function generationTotal(data) {
  if (totals.has(data)) return totals.get(data);
  const total = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = sumAt(data.columns, GENERATION, i);
    total[i] = v > 0 ? v : NaN;
  }
  totals.set(data, total);
  return total;
}

/**
 * A metric series in GW, as a percentage of generation, or (for the price
 * column) in $/MWh. Missing slots are NaN.
 */
export function metricSeries(data, members, { unit = 'gw' } = {}) {
  const out = new Float64Array(data.length);
  if (members.length === 1 && members[0] === 'price') {
    out.set(data.columns.price);
    return out;
  }
  const total = unit === 'pct' ? generationTotal(data) : null;
  for (let i = 0; i < data.length; i++) {
    const v = sumAt(data.columns, members, i);
    out[i] = total ? (v / total[i]) * 100 : v / 1000;
  }
  return out;
}

/** One past the last slot with unit data. */
export function dataEnd(data) {
  let end = data.length;
  while (end > 0 && Number.isNaN(data.columns.black_coal[end - 1])) end--;
  return end;
}

/**
 * Groups slots by calendar year in NEM time, keeping only years the data
 * fully covers, plus a final "past365" bucket for the latest 365 days.
 */
function byYear(data, init, add) {
  const { startMs } = data;
  const years = new Map();
  const rolling = { year: 'past365', ...init() };
  const end = dataEnd(data);
  const firstYear = startMs <= nemNewYear(nemYear(startMs)) ? nemYear(startMs) : nemYear(startMs) + 1;
  const lastYear = nemYear(startMs + end * 18e5) - 1;
  for (let i = 0; i < end; i++) {
    const y = nemYear(startMs + i * 18e5);
    if (y >= firstYear && y <= lastYear) {
      let row = years.get(y);
      if (!row) years.set(y, (row = { year: y, ...init() }));
      add(row, i);
    }
    if (i >= end - YEAR_SLOTS) add(rolling, i);
  }
  const rows = [...years.values()];
  if (end >= YEAR_SLOTS) rows.push(rolling);
  return rows;
}

/** TWh by fuel for each year, with renewable, fossil and coal shares. */
export function yearlyEnergy(data) {
  const keys = Object.keys(FUELS);
  return byYear(data, () => ({ twh: Object.fromEntries(keys.map((k) => [k, 0])), slots: 0, gaps: 0 }), (row, i) => {
    const t = sumAt(data.columns, GENERATION, i);
    if (!(t > 0)) { row.gaps++; return; }
    row.slots++;
    for (const k of keys) {
      const v = data.columns[k]?.[i];
      if (v > 0) row.twh[k] += (v * SLOT_H) / 1e6;
    }
  }).map((r) => {
    const sum = (ks) => ks.reduce((s, k) => s + r.twh[k], 0);
    const total = sum(GENERATION);
    const pc = (v) => (total ? (v / total) * 100 : NaN);
    return { year: r.year, twh: r.twh, total, renewable: sum(RENEWABLE), fossil: sum(FOSSIL), coal: sum(COAL), renewablePct: pc(sum(RENEWABLE)), fossilPct: pc(sum(FOSSIL)), coalPct: pc(sum(COAL)), coverage: r.slots / (r.slots + r.gaps) };
  });
}

/** Hours in each year with the summed columns below each threshold (MW). */
export function yearlyHoursBelow(data, names, thresholdsMw) {
  return byYear(data, () => ({ hours: thresholdsMw.map(() => 0) }), (row, i) => {
    const v = sumAt(data.columns, names, i);
    if (Number.isNaN(v)) return;
    thresholdsMw.forEach((t, k) => { if (v < t) row.hours[k] += SLOT_H; });
  });
}

/**
 * Each NEM calendar month: mean price weighted by demand, the share of half
 * hours priced below zero, mean battery discharge and charging (MW), and
 * renewable and fossil shares.
 */
export function monthly(data) {
  const { columns, startMs } = data;
  const total = generationTotal(data);
  const end = dataEnd(data);
  const months = new Map();
  for (let i = 0; i < end; i++) {
    const m = nemMonth(startMs + i * 18e5);
    let r = months.get(m);
    if (!r) months.set(m, (r = { month: m, pd: 0, d: 0, n: 0, neg: 0, priced: 0, dis: 0, chg: 0, ren: 0, fos: 0, gen: 0 }));
    r.n++;
    const p = columns.price[i];
    const d = columns.demand[i];
    if (!Number.isNaN(p)) {
      r.priced++;
      if (p < 0) r.neg++;
      if (d > 0) { r.pd += p * d; r.d += d; }
    }
    if (columns.battery[i] > 0) r.dis += columns.battery[i];
    if (columns.battery_charge[i] > 0) r.chg += columns.battery_charge[i];
    if (total[i] > 0) {
      r.gen += total[i];
      r.ren += sumAt(columns, RENEWABLE, i);
      r.fos += sumAt(columns, FOSSIL, i);
    }
  }
  return [...months.values()].map((r) => ({
    month: r.month,
    price: r.d ? r.pd / r.d : NaN,
    negativePct: r.priced ? (r.neg / r.priced) * 100 : NaN,
    batteryMw: r.dis / r.n,
    chargeMw: r.chg / r.n,
    renewablePct: r.gen ? (r.ren / r.gen) * 100 : NaN,
    fossilPct: r.gen ? (r.fos / r.gen) * 100 : NaN,
    complete: r.n >= 28 * 48,
  }));
}

/**
 * The average day between two instants: for each half hour of the NEM day,
 * the mean of each listed column (MW, or $/MWh for price).
 */
export function averageDay(data, fromMs, toMs, names) {
  const { columns, startMs } = data;
  const a = Math.max(0, Math.ceil((fromMs - startMs) / 18e5));
  const b = Math.min(dataEnd(data), Math.floor((toMs - startMs) / 18e5));
  const sums = Object.fromEntries(names.map((k) => [k, new Float64Array(48)]));
  const counts = Object.fromEntries(names.map((k) => [k, new Uint32Array(48)]));
  for (let i = a; i < b; i++) {
    const h = nemSlotOfDay(startMs + i * 18e5);
    for (const k of names) {
      const v = columns[k][i];
      if (!Number.isNaN(v)) { sums[k][h] += v; counts[k][h]++; }
    }
  }
  return Object.fromEntries(names.map((k) => [k, Array.from(sums[k], (s, h) => (counts[k][h] ? s / counts[k][h] : NaN))]));
}
