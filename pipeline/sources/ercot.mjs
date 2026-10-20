// ERCOT (Texas): the Interval Generation by Fuel reports on the Fuel Mix page
// (https://www.ercot.com/gridinfo/generation), plus the fuel mix dashboard
// for the last two days.
//
// The reports are one workbook a year: .xls to 2015, .xlsx since, with a
// sheet a month. Each row is a day and a fuel, then 96 quarter hours of
// energy in MWh, labelled by the end of the interval in Central Prevailing
// Time ("0:15" to "0:00"). The spring-forward day leaves 02:15 to 03:00 blank;
// the fall-back day adds four columns after midnight for the second pass
// through 01:15 to 02:00 (standard time). Older years put the date and fuel in
// one cell ("12/01/07 - Coal", "11/01/12_Coal"). Values are settlement data:
// the current year's file is updated about monthly, with initial settlement
// figures replaced by final ones about two months later.
//
// "Other" includes battery discharge (since about 2020 it is nearly all
// batteries) as well as petroleum coke and oil. "WSL" (wholesale storage
// load, from 2022) is a small part of battery charging only, so it is left
// out. Gas, combined-cycle and simple-cycle, is one column, because the
// dashboard used for the latest days doesn't split it.
export const TX_TZ = 'America/Chicago';
export const STEP_MINUTES = 15;
export const PARSE_VERSION = 1;
export const TX_COLUMNS = ['coal', 'gas', 'nuclear', 'wind', 'solar', 'hydro', 'biomass', 'other'];
export const PAGE_URL = 'https://www.ercot.com/gridinfo/generation';
export const DASHBOARD_URL = 'https://www.ercot.com/api/1/services/read/dashboards/fuel-mix.json';
const Q_MS = STEP_MINUTES * 60000;
const H_MS = 3600000;

/** The column for an ERCOT report fuel name; '' for one left out, null if unknown. */
export function fuelColumn(name) {
  const f = String(name).trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (f === 'coal') return 'coal';
  if (f === 'gas' || f === 'gas-cc' || f === 'gas-gt') return 'gas';
  if (f === 'nuclear') return 'nuclear';
  if (f === 'wind') return 'wind';
  if (f === 'solar') return 'solar';
  if (f === 'hydro') return 'hydro';
  if (f === 'biomass') return 'biomass';
  if (f === 'other') return 'other';
  if (f === 'wsl') return '';
  return null;
}

// Central time: daylight saving from 02:00 on the second Sunday of March to
// 02:00 on the first Sunday of November (the rule since 2007, when the data
// starts).
const nthSunday = (y, m, n) => {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + 7 * (n - 1);
};
export const springDay = (y) => Date.UTC(y, 2, nthSunday(y, 2, 2));
export const fallDay = (y) => Date.UTC(y, 10, nthSunday(y, 10, 1));

/**
 * UTC start of a local quarter hour: day (UTC midnight of the local date) and
 * the quarter's start in minutes after local midnight. `second` picks the
 * standard-time pass through the repeated hour. Null for a time that never
 * happened (the skipped spring hour).
 */
export function localToUtc(day, minutes, second = false) {
  const y = new Date(day).getUTCFullYear();
  const spring = springDay(y);
  const fall = fallDay(y);
  let offsetH;
  if (day === spring && minutes >= 120 && minutes < 180) return null;
  if (day === fall && minutes >= 60 && minutes < 120) offsetH = second ? 6 : 5;
  else if ((day > spring || (day === spring && minutes >= 180)) && (day < fall || (day === fall && minutes < 60))) offsetH = 5;
  else offsetH = 6;
  return day + minutes * 60000 + offsetH * H_MS;
}

/** UTC midnight of a cell's local date: an Excel serial number or "MM/DD/YY". */
export function cellDay(v) {
  if (typeof v === 'number') return Math.round(v - 25569) * 864e5;
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  return Date.UTC(y, Number(m[1]) - 1, Number(m[2]));
}

const MONTH_SHEET = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;

/**
 * One year's workbook ({ name, rows } sheets) onto a quarter-hour grid
 * covering that local year. Days a sheet lists get 0 for fuels it doesn't;
 * days no sheet lists stay missing.
 */
export function parseWorkbook(sheets, year) {
  const startMs = localToUtc(Date.UTC(year, 0, 1), 0);
  const endMs = localToUtc(Date.UTC(year + 1, 0, 1), 0);
  const length = Math.round((endMs - startMs) / Q_MS);
  const columns = Object.fromEntries(TX_COLUMNS.map((c) => [c, new Array(length).fill(null)]));
  const days = new Set();
  const unknown = new Set();
  const put = (col, t, mwh) => {
    if (t == null || !Number.isFinite(mwh)) return;
    const i = Math.round((t - startMs) / Q_MS);
    if (i < 0 || i >= length) return;
    columns[col][i] = (columns[col][i] ?? 0) + Math.round(mwh * 4 * 10) / 10;
  };
  for (const sheet of sheets) {
    if (!MONTH_SHEET.test(sheet.name) || /summary/i.test(sheet.name)) continue;
    const head = sheet.rows.findIndex((r) => r?.some((c) => /^(total|daily mwh)$/i.test(String(c ?? '').trim())));
    if (head < 0) continue;
    const h = sheet.rows[head];
    const first = h.findIndex((c) => /^(total|daily mwh)$/i.test(String(c ?? '').trim())) + 1;
    const split = /^date$/i.test(String(h[0]).trim()) && /^fuel$/i.test(String(h[1]).trim());
    for (const r of sheet.rows.slice(head + 1)) {
      if (!r || r[0] == null) continue;
      let day;
      let fuel;
      if (split) {
        day = cellDay(r[0]);
        fuel = r[1];
      } else {
        const m = String(r[0]).match(/^(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-_ ]+\s*(.+)$/);
        if (!m) continue;
        day = cellDay(m[1]);
        fuel = m[2];
      }
      if (day == null || new Date(day).getUTCFullYear() !== year) continue;
      const col = fuelColumn(fuel);
      if (col == null) unknown.add(String(fuel));
      if (!col) continue;
      days.add(day);
      for (let k = 0; k < 96; k++) {
        const v = r[first + k];
        if (typeof v === 'number') put(col, localToUtc(day, k * 15), v);
      }
      if (day === fallDay(year)) {
        for (let k = 0; k < 4; k++) {
          const v = r[first + 96 + k];
          if (typeof v === 'number') put(col, localToUtc(day, 60 + k * 15, true), v);
        }
      }
    }
  }
  // A listed day's quarter hours are 0 for any fuel it didn't list.
  for (const day of days) {
    for (let k = -4; k < 96; k++) {
      const t = k < 0 ? (day === fallDay(year) ? localToUtc(day, 60 + (k + 4) * 15, true) : null) : localToUtc(day, k * 15);
      if (t == null) continue;
      const i = Math.round((t - startMs) / Q_MS);
      if (i < 0 || i >= length) continue;
      if (TX_COLUMNS.some((c) => columns[c][i] != null)) for (const c of TX_COLUMNS) columns[c][i] ??= 0;
    }
  }
  return { startMs, length, columns, days: days.size, unknown: [...unknown] };
}

/** Workbook links on the Fuel Mix page: { year: url } plus the previous-years zip. */
export function pageLinks(html) {
  const years = {};
  for (const m of html.matchAll(/href="([^"]*IntGenbyFuel(\d{4})\.xlsx?)"/gi)) years[Number(m[2])] = new URL(m[1], PAGE_URL).href;
  const zip = html.match(/href="([^"]*FuelMixReport_PreviousYears\.zip)"/i)?.[1];
  return { years, previous: zip ? new URL(zip, PAGE_URL).href : null };
}

// Dashboard fuel names to columns. Battery discharge joins "Other", as in
// the reports; charging is left out.
const DASH = {
  'Coal and Lignite': 'coal',
  'Natural Gas': 'gas',
  Nuclear: 'nuclear',
  Wind: 'wind',
  Solar: 'solar',
  Hydro: 'hydro',
  Other: 'other',
  'Power Storage Discharging': 'other',
};

/**
 * The fuel mix dashboard (5-minute readings for yesterday and today) as
 * quarter hours: { [utcMs]: { column: MW } }, complete quarters only.
 */
export function parseDashboard(json) {
  const sums = new Map();
  for (const day of Object.values(json?.data ?? {})) {
    for (const [stamp, fuels] of Object.entries(day)) {
      const t = Date.parse(stamp.replace(' ', 'T').replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
      if (!Number.isFinite(t)) continue;
      const q = Math.floor(t / Q_MS) * Q_MS;
      const s = sums.get(q) ?? { n: 0, cols: {} };
      s.n++;
      for (const [name, v] of Object.entries(fuels)) {
        const col = DASH[name];
        const mw = Number(v?.gen);
        if (!col || !Number.isFinite(mw)) continue;
        s.cols[col] = (s.cols[col] ?? 0) + Math.max(0, mw);
      }
      sums.set(q, s);
    }
  }
  const out = {};
  for (const [q, s] of sums) {
    if (s.n < 3) continue;
    out[q] = Object.fromEntries(Object.entries(s.cols).map(([c, v]) => [c, Math.round((v / s.n) * 10) / 10]));
  }
  return out;
}

/** Recent quarter hours ({ [ms]: { column: MW } }) as a grid piece. */
export function rowsToPiece(rows) {
  const times = Object.keys(rows).map(Number).sort((a, b) => a - b);
  if (!times.length) return null;
  const startMs = times[0];
  const length = Math.round((times.at(-1) - startMs) / Q_MS) + 1;
  const columns = Object.fromEntries(TX_COLUMNS.map((c) => [c, new Array(length).fill(null)]));
  for (const t of times) {
    const i = Math.round((t - startMs) / Q_MS);
    for (const c of TX_COLUMNS) columns[c][i] = rows[t][c] ?? (c === 'biomass' ? null : 0);
  }
  return { startMs, length, columns };
}
