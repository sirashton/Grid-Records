// Electricity Authority (EMI) "Generation output by plant": half-hourly
// generation for every grid-connected plant in New Zealand, one CSV per month.
// https://www.emi.ea.govt.nz/Wholesale/Datasets/Generation/Generation_MD
//
// Each row is one plant at one connection point on one trading date, with
// TP1..TP48 in kWh (TP46 or TP50 on daylight saving days). TP1 starts at local
// midnight, NZ time. Values are metered grid injections mapped to plants.
import { fetchText, SLOT_MS } from '../lib.mjs';

const BASE = 'https://emidatasets.blob.core.windows.net/publicdata/Datasets/Wholesale/Generation/Generation_MD';
export const monthUrl = (ym) => `${BASE}/${ym}_Generation_MD.csv`;

export const NZ_TZ = 'Pacific/Auckland';

// Output columns, in the order they are written.
export const NZ_COLUMNS = ['hydro', 'geothermal', 'wind', 'solar', 'bioenergy', 'gas', 'coal', 'diesel', 'battery', 'other'];

/** Maps an EMI Fuel_Code to an output column. */
export function fuelColumn(code) {
  const c = String(code ?? '').trim().toLowerCase();
  if (c === 'hydro') return 'hydro';
  if (c.startsWith('geo')) return 'geothermal';
  if (c === 'wind') return 'wind';
  if (c.startsWith('sol')) return 'solar';
  // Huntly's Rankine units burn coal or gas and are listed as Coal or Coal/Gas.
  if (c.includes('coal')) return 'coal';
  if (c.startsWith('gas')) return 'gas';
  if (c.includes('diesel') || c === 'oil') return 'diesel';
  if (c.includes('wood') || c.includes('bio')) return 'bioenergy';
  if (c.includes('batt') || c.includes('bess') || c.includes('elec')) return 'battery';
  return 'other';
}

const offsetFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: NZ_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

/** NZ's offset from UTC at an instant, in ms. */
export function nzOffset(ms) {
  const p = Object.fromEntries(offsetFmt.formatToParts(ms).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(ms / 60000) * 60000;
}

/** The UTC instant of midnight NZ time at the start of a yyyy-mm-dd date. */
export function nzMidnight(date) {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d);
  let t = wall - 12 * 3600000;
  for (let i = 0; i < 2; i++) t = wall - nzOffset(t);
  return t;
}

/** "YYYY-MM-DD" or "DD/MM/YYYY" to "YYYY-MM-DD". */
function isoDate(s) {
  const t = s.trim();
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  return dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : t.slice(0, 10);
}

/**
 * Parses one month's CSV into MW per fuel on a UTC half-hourly grid running
 * from midnight NZ time on the first day to midnight after the last.
 * Days with no rows are NaN; plants missing on a day count as zero.
 * @returns {{startMs: number, length: number, columns: Record<string, (number|null)[]>, fuels: Record<string, string>}}
 */
export function parseGenerationMonth(csv) {
  const lines = csv.split(/\r?\n/);
  const header = lines[0].replace(/^﻿/, '').split(',').map((h) => h.trim());
  const col = (name) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const fuelIdx = col('Fuel_Code');
  const dateIdx = col('Trading_date');
  if (fuelIdx < 0 || dateIdx < 0) throw new Error(`EMI generation: unexpected header ${header.slice(0, 8).join(',')}`);
  const tpIdx = [];
  header.forEach((h, i) => {
    const m = /^TP(\d+)$/i.exec(h);
    if (m) tpIdx.push([Number(m[1]) - 1, i]);
  });

  // First pass: sum kWh per date, fuel and trading period.
  const days = new Map();
  const fuels = {};
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r];
    if (!line) continue;
    const f = line.split(',');
    const date = isoDate(f[dateIdx] ?? '');
    if (!/^\d{4}-\d\d-\d\d$/.test(date)) continue;
    const code = f[fuelIdx];
    const name = fuelColumn(code);
    fuels[code] = name;
    let day = days.get(date);
    if (!day) days.set(date, (day = {}));
    const sums = (day[name] ??= []);
    for (const [tp, i] of tpIdx) {
      const v = f[i];
      if (v === undefined || v === '') continue;
      sums[tp] = (sums[tp] ?? 0) + Number(v);
    }
  }
  if (!days.size) return { startMs: NaN, length: 0, columns: {}, fuels };

  const dates = [...days.keys()].sort();
  const startMs = nzMidnight(dates[0]);
  const [y, m, d] = dates.at(-1).split('-').map(Number);
  const endMs = nzMidnight(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10));
  const length = Math.round((endMs - startMs) / SLOT_MS);
  const columns = Object.fromEntries(NZ_COLUMNS.map((c) => [c, new Array(length).fill(null)]));
  for (const [date, day] of days) {
    const base = Math.round((nzMidnight(date) - startMs) / SLOT_MS);
    const [yy, mm, dd] = date.split('-').map(Number);
    const periods = Math.round((nzMidnight(new Date(Date.UTC(yy, mm - 1, dd + 1)).toISOString().slice(0, 10)) - nzMidnight(date)) / SLOT_MS);
    for (const c of NZ_COLUMNS) {
      const sums = day[c] ?? [];
      for (let tp = 0; tp < periods; tp++) {
        // kWh in a half hour, times two, over a thousand: average MW.
        columns[c][base + tp] = Math.round(((sums[tp] ?? 0) * 2) / 1000 * 10) / 10;
      }
    }
  }
  return { startMs, length, columns, fuels };
}

/** Fetches one month. Returns null when the file does not exist. */
export async function fetchGenerationMonth(ym) {
  const csv = await fetchText(monthUrl(ym), { timeoutMs: 300000 });
  return csv == null ? null : parseGenerationMonth(csv);
}
