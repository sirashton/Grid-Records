// The common dataset every country page loads, and the series and yearly
// figures built from it. Country differences live in the country config
// (site/js/countries/<cc>.js): which columns make up each fuel, which fuels
// are fossil or renewable, the time zone. Pure apart from loadData, so the
// Node tests use it too.
//
// A dataset is { meta, columns, length, startMs, stepMinutes }: columns of
// average MW per slot, NaN where the source has no data.

import { yearStart, localYear, localDate } from './calendar.js';

/** Fetches and decodes a dataset written by pipeline/core/dataset.mjs. */
export async function loadData(base = 'data') {
  const meta = await (await fetch(`${base}/meta.json`, { cache: 'no-cache' })).json();
  const res = await fetch(`${base}/series.bin.gz`, { cache: 'no-cache' });
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  const raw = await new Response(stream).arrayBuffer();
  return { meta, columns: decode(new Int16Array(raw), meta), length: meta.length, startMs: meta.startMs, stepMinutes: meta.stepMinutes ?? 30 };
}

/** Undoes the delta encoding: see pipeline/encode.mjs. */
export function decode(buf, meta) {
  const { length } = meta;
  const columns = {};
  meta.columns.forEach((name, c) => {
    const col = new Float64Array(length);
    // Columns with very large changes are stored in units of `scale` MW.
    const unit = meta.scale?.[name] ?? 1;
    let acc = (meta.base?.[name] ?? 0) / unit;
    for (let i = 0; i < length; i++) {
      acc += buf[c * length + i];
      col[i] = acc * unit;
    }
    for (const [s, n] of meta.missing[name] ?? []) col.fill(NaN, s, s + n);
    columns[name] = col;
  });
  return columns;
}

export const stepOf = (data) => data.stepMinutes ?? data.meta?.stepMinutes ?? 30;
/** Slots in a span of minutes, e.g. slotsIn(data, 1440) for a day. */
export const slotsIn = (data, minutes) => Math.round(minutes / stepOf(data));
export const slotMs = (data, i) => data.startMs + i * stepOf(data) * 60000;

/** Fuel keys in a country's generation total. */
export const totalFuels = (country) => Object.keys(country.fuels).filter((k) => country.fuels[k].inTotal !== false);
export const fuelsWhere = (country, flag) => Object.keys(country.fuels).filter((k) => country.fuels[k][flag]);

/**
 * The data columns behind a list of fuels, with how to add each. A fuel's
 * columns default to its own key; a function picks them from opts (GB's
 * battery source). Fuels or columns the data lacks are skipped.
 */
export function resolveColumns(data, country, members, opts = {}) {
  const out = [];
  for (const m of members) {
    const f = country.fuels[m] ?? {};
    const names = typeof f.columns === 'function' ? f.columns(opts) : (f.columns ?? [m]);
    for (const n of names) {
      if (data.columns[n]) out.push({ col: data.columns[n], abs: !!f.abs, optional: !!f.optional });
    }
  }
  return out;
}

/**
 * Sum at slot i. Missing data gives NaN, except in optional columns (such as
 * battery output before a source starts), which count as zero. Generation
 * below zero counts as zero; abs columns (charging) count by size.
 */
function sumAt(cols, i) {
  let v = 0;
  for (const { col, abs, optional } of cols) {
    const x = col[i];
    if (Number.isNaN(x)) {
      if (optional) continue;
      return NaN;
    }
    v += abs ? Math.abs(x) : x > 0 ? x : 0;
  }
  return v;
}

const totals = new WeakMap();
/** Total generation in MW at each slot, NaN where any part is missing. */
export function generationTotal(data, country) {
  let byCountry = totals.get(data);
  if (!byCountry) totals.set(data, (byCountry = new Map()));
  if (byCountry.has(country.code)) return byCountry.get(country.code);
  const cols = resolveColumns(data, country, totalFuels(country));
  const total = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = sumAt(cols, i);
    total[i] = v > 0 ? v : NaN;
  }
  byCountry.set(country.code, total);
  return total;
}

/** A group of fuels as a series in GW, or as a percentage of total generation. */
export function metricSeries(data, country, members, { unit = 'gw', ...opts } = {}) {
  const cols = resolveColumns(data, country, members, opts);
  const total = unit === 'pct' ? generationTotal(data, country) : null;
  const out = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const v = sumAt(cols, i);
    out[i] = total ? (v / total[i]) * 100 : v / 1000;
  }
  return out;
}

/** Index of the last slot where every listed column has data. */
export function lastComplete(data, names) {
  for (let i = data.length - 1; i >= 0; i--) {
    if (names.every((n) => !data.columns[n] || !Number.isNaN(data.columns[n][i]))) return i;
  }
  return -1;
}

/** One past the last slot with data, judged by the country's endColumn. */
export function dataEnd(data, country) {
  const col = data.columns[country.endColumn];
  if (!col) return data.length;
  let end = data.length;
  while (end > 0 && Number.isNaN(col[end - 1])) end--;
  return end;
}

/**
 * Groups slots by local calendar year, keeping only years the data fully
 * covers, plus a final "past365" bucket for the latest 365 days. Calls
 * add(row, i) for each slot in each bucket and returns the rows in order.
 */
export function byYear(data, country, init, add) {
  const { startMs } = data;
  const tz = country.timeZone;
  const stepMs = stepOf(data) * 60000;
  const yearSlots = slotsIn(data, 365 * 1440);
  const end = dataEnd(data, country);
  const endMs = startMs + end * stepMs;
  const y0 = localYear(startMs, tz);
  // A year counts only if the data starts on or before its New Year and runs past its end.
  const firstYear = startMs <= yearStart(y0, tz) ? y0 : y0 + 1;
  const lastYear = localYear(endMs, tz) - 1;
  const years = [];
  for (let y = firstYear; y <= lastYear; y++) {
    years.push({ row: { year: y, ...init() }, from: Math.ceil((yearStart(y, tz) - startMs) / stepMs), to: Math.ceil((yearStart(y + 1, tz) - startMs) / stepMs) });
  }
  for (const { row, from, to } of years) for (let i = Math.max(0, from); i < Math.min(to, end); i++) add(row, i);
  const rows = years.map((y) => y.row);
  if (end >= yearSlots) {
    const rolling = { year: 'past365', ...init() };
    for (let i = end - yearSlots; i < end; i++) add(rolling, i);
    rows.push(rolling);
  }
  return rows;
}

/** TWh by fuel for each year and the past 365 days, with the renewable and fossil shares. */
export function yearlyEnergy(data, country) {
  const keys = Object.keys(country.fuels).filter((k) => !country.fuels[k].abs);
  const cols = Object.fromEntries(keys.map((k) => [k, resolveColumns(data, country, [k])]));
  const inTotal = totalFuels(country);
  const totalCols = resolveColumns(data, country, inTotal);
  const h = stepOf(data) / 60;
  const renewable = fuelsWhere(country, 'renewable');
  const fossil = fuelsWhere(country, 'fossil');
  return byYear(data, country, () => ({ twh: Object.fromEntries(keys.map((k) => [k, 0])), slots: 0, gaps: 0 }), (row, i) => {
    if (!(sumAt(totalCols, i) > 0)) { row.gaps++; return; }
    row.slots++;
    for (const k of keys) {
      const v = sumAt(cols[k], i);
      if (v > 0) row.twh[k] += (v * h) / 1e6;
    }
  }).map((r) => {
    const sum = (ks) => ks.reduce((s, k) => s + (r.twh[k] ?? 0), 0);
    const total = sum(inTotal);
    return { year: r.year, twh: r.twh, total, renewable: sum(renewable), fossil: sum(fossil), renewablePct: total ? (sum(renewable) / total) * 100 : NaN, coverage: r.slots / (r.slots + r.gaps) };
  });
}

/** Hours in each year with a group of fuels below each threshold (MW). */
export function yearlyHoursBelow(data, country, members, thresholdsMw) {
  const cols = resolveColumns(data, country, members);
  const h = stepOf(data) / 60;
  return byYear(data, country, () => ({ hours: thresholdsMw.map(() => 0) }), (row, i) => {
    const v = sumAt(cols, i);
    if (Number.isNaN(v)) return;
    thresholdsMw.forEach((t, k) => { if (v < t) row.hours[k] += h; });
  });
}

/**
 * GWh by fuel for each local calendar day of the latest n whole days before
 * slot end, with the generation total: { date: 'YYYY-MM-DD', total, [fuel] }.
 */
export function dailyEnergy(data, country, end, n = 365) {
  const tz = country.timeZone;
  const step = stepOf(data);
  const h = step / 60;
  const day = slotsIn(data, 1440);
  const fuels = totalFuels(country).map((k) => [k, resolveColumns(data, country, [k])]);
  const days = new Map();
  let hour = -1;
  let date = '';
  for (let i = Math.max(0, end - (n + 2) * day); i < end; i++) {
    const t = slotMs(data, i);
    // Days change on the hour (or half hour), so the date only needs working out then.
    if (Math.floor(t / 18e5) !== hour) { hour = Math.floor(t / 18e5); date = localDate(t, tz); }
    const row = days.get(date) ?? days.set(date, { date, total: 0, slots: 0 }).get(date);
    row.slots++;
    for (const [k, cols] of fuels) {
      const v = sumAt(cols, i);
      if (v > 0) { row[k] = (row[k] ?? 0) + (v * h) / 1000; row.total += (v * h) / 1000; }
    }
  }
  // Whole days only, as daylight saving changes allow (23 to 25 hours).
  return [...days.values()].filter((d) => d.slots >= slotsIn(data, 23 * 60)).slice(-n);
}

/**
 * Chart points [ms, value] for the latest `days` before slot end ('all' for
 * everything): daily means past 60 days, raw slots for shorter spans.
 */
export function windowPoints(data, values, days, end = data.length) {
  const slotsPerDay = slotsIn(data, 1440);
  const start = days === 'all' ? 0 : Math.max(0, end - Number(days) * slotsPerDay);
  const pts = [];
  if (days === 'all' || Number(days) > 60) {
    for (let d = start - (start % slotsPerDay); d < end; d += slotsPerDay) {
      let sum = 0;
      let n = 0;
      for (let i = d; i < Math.min(end, d + slotsPerDay); i++) if (!Number.isNaN(values[i])) { sum += values[i]; n++; }
      pts.push([slotMs(data, d), n ? sum / n : NaN]);
    }
  } else {
    for (let i = start; i < end; i++) pts.push([slotMs(data, i), values[i]]);
  }
  return pts;
}
