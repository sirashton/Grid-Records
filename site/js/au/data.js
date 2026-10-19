// Figures behind the Australia story that the shared dataset code doesn't
// cover: monthly prices and battery use, and the average day. Pure, so the
// Node tests use them too. Columns are the shared names (countries/au.js).

import { generationTotal, metricSeries, dataEnd, fuelsWhere } from '../core/dataset.js';

const OFFSET = 10 * 3600000; // NEM time is UTC+10 all year
/** "YYYY-MM" of an instant, in NEM time. */
export const nemMonth = (ms) => new Date(ms + OFFSET).toISOString().slice(0, 7);
/** Half hour of the NEM day, 0 to 47. */
export const nemSlotOfDay = (ms) => Math.floor(((ms + OFFSET) % 86400000) / 1800000);

/**
 * Each NEM calendar month: mean price weighted by demand, the share of half
 * hours priced below zero, mean battery discharge and charging (MW), and the
 * renewable and fossil shares of generation.
 */
export function monthly(data, country) {
  const { columns, startMs } = data;
  const total = generationTotal(data, country);
  const ren = metricSeries(data, country, fuelsWhere(country, 'renewable'));
  const fos = metricSeries(data, country, fuelsWhere(country, 'fossil'));
  const end = dataEnd(data, country);
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
    if (columns.battery_charge[i] < 0) r.chg -= columns.battery_charge[i];
    if (total[i] > 0) {
      r.gen += total[i];
      r.ren += ren[i] * 1000;
      r.fos += fos[i] * 1000;
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
 * the mean of each series (any unit), skipping missing slots.
 */
export function averageDay(data, fromMs, toMs, series) {
  const { startMs } = data;
  const a = Math.max(0, Math.ceil((fromMs - startMs) / 18e5));
  const b = Math.min(data.length, Math.floor((toMs - startMs) / 18e5));
  const out = {};
  for (const [name, values] of Object.entries(series)) {
    const sums = new Float64Array(48);
    const counts = new Uint32Array(48);
    for (let i = a; i < b; i++) {
      const v = values[i];
      if (Number.isNaN(v)) continue;
      const h = nemSlotOfDay(startMs + i * 18e5);
      sums[h] += v;
      counts[h]++;
    }
    out[name] = Array.from(sums, (s, h) => (counts[h] ? s / counts[h] : NaN));
  }
  return out;
}

/** Hours in each window [fromMs, toMs) with the price below each level ($/MWh). */
export function hoursBelowPrice(data, windows, levels) {
  const { startMs, columns } = data;
  return windows.map(({ fromMs, toMs, label }) => {
    const hours = levels.map(() => 0);
    let priced = 0;
    for (let i = Math.max(0, Math.ceil((fromMs - startMs) / 18e5)); i < Math.min(data.length, (toMs - startMs) / 18e5); i++) {
      const p = columns.price[i];
      if (Number.isNaN(p)) continue;
      priced++;
      levels.forEach((l, k) => { if (p < l) hours[k] += 0.5; });
    }
    return { label, hours, priced: priced / 2 };
  });
}
