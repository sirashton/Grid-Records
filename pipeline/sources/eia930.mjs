// The United States (lower 48) from EIA-930, the Hourly Electric Grid
// Monitor: every balancing authority's hourly net generation by energy
// source, demand and interchange, from July 2018. EIA publishes the whole
// form as six-month CSV files (EIA930_BALANCE_YYYY_Jan_Jun.csv and _Jul_Dec)
// at www.eia.gov/electricity/gridmonitor/sixMonthFiles/, refreshed daily
// and free of any key. The current file runs to about a day ago.
//
// One row per balancing authority per hour, stamped "UTC Time at End of Hour".
// Each value comes raw, imputed and adjusted; the adjusted series is EIA's
// cleaned one (gaps and outliers filled), so it is preferred and the raw
// value is the fallback. Summing every balancing authority gives the lower
// 48, as EIA's own US48 totals do: flows between them cancel, and what is
// left of interchange is the net flow with Canada and Mexico.
//
// The fuel headings changed over the years: hydro and pumped storage were
// one column until EIA split them, and battery storage and geothermal came
// out of "Other" later still. A column a file doesn't have is left missing
// for that half-year rather than set to zero.

export const BASE = 'https://www.eia.gov/electricity/gridmonitor/sixMonthFiles';
export const PARSE_VERSION = 1;
export const HOUR_MS = 3600000;

// Heading (after "Net Generation (MW) from ") to dataset column. Several
// headings can add into one column.
const FUELS = {
  Coal: 'coal',
  'Natural Gas': 'gas',
  Nuclear: 'nuclear',
  'All Petroleum Products': 'oil',
  'Hydropower and Pumped Storage': 'hydro',
  'Hydropower Excluding Pumped Storage': 'hydro',
  'Pumped Storage': 'pumped_storage',
  Solar: 'solar',
  'Solar without Integrated Battery Storage': 'solar',
  'Solar with Integrated Battery Storage': 'solar',
  Wind: 'wind',
  'Wind without Integrated Battery Storage': 'wind',
  'Wind with Integrated Battery Storage': 'wind',
  'Battery Storage': 'battery',
  'Other Energy Storage': 'other',
  'Unknown Energy Storage': 'other',
  Geothermal: 'geothermal',
  'Other Fuel Sources': 'other',
  'Unknown Fuel Sources': 'other',
};
export const GEN_COLUMNS = ['coal', 'gas', 'oil', 'nuclear', 'hydro', 'pumped_storage', 'wind', 'solar', 'geothermal', 'battery', 'other'];
export const US_COLUMNS = [...GEN_COLUMNS, 'imports', 'exports', 'demand'];

/** Half-years from 2018 H2 to the one holding nowMs, newest first: '2026H2', '2026H1', ... */
export function halfList(nowMs, from = '2018H2') {
  const d = new Date(nowMs);
  let y = d.getUTCFullYear();
  let h = d.getUTCMonth() < 6 ? 1 : 2;
  const out = [];
  for (;;) {
    const key = `${y}H${h}`;
    out.push(key);
    if (key === from) return out;
    if (h === 2) h = 1;
    else { h = 2; y--; }
    if (y < 2015) return out;
  }
}

/** The file name, first hour (UTC, hour beginning) and hour count of a half-year. */
export function halfInfo(key) {
  const y = Number(key.slice(0, 4));
  const h = Number(key.slice(5));
  const startMs = Date.UTC(y, h === 1 ? 0 : 6, 1);
  const endMs = Date.UTC(h === 1 ? y : y + 1, h === 1 ? 6 : 0, 1);
  return { file: `EIA930_BALANCE_${y}_${h === 1 ? 'Jan_Jun' : 'Jul_Dec'}.csv`, startMs, length: (endMs - startMs) / HOUR_MS };
}

/** Splits one CSV line, honouring quotes. */
export function splitCsv(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** "10/24/2026 3:00:00 AM" (UTC) to milliseconds. */
export function parseUtc(s) {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) ([AP]M)$/);
  if (!m) return NaN;
  let h = Number(m[4]) % 12;
  if (m[7] === 'PM') h += 12;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]));
}

const num = (s) => {
  if (s === undefined || s === '') return null;
  const v = Number(s.replace(/,/g, ''));
  return Number.isFinite(v) ? v : null;
};

/**
 * One half-year file's text summed over balancing authorities, onto an
 * hour-beginning UTC grid: { startMs, length, columns, bas, hours }.
 * `reporting` counts, per hour, the balancing authorities with a net
 * generation value, so the builder can drop hours too few reported.
 */
export function parseHalf(key, text) {
  const { startMs, length } = halfInfo(key);
  const lines = text.split(/\r?\n/);
  const head = splitCsv(lines[0]);
  const at = (name) => head.indexOf(name);
  const pick = (base) => {
    const adj = at(`${base} (Adjusted)`) >= 0 ? at(`${base} (Adjusted)`) : at(`${base}  (Adjusted)`);
    return { adj, raw: at(base) };
  };
  const iBa = at('Balancing Authority');
  const iUtc = at('UTC Time at End of Hour');
  const fuel = [];
  for (const [label, col] of Object.entries(FUELS)) {
    const p = pick(`Net Generation (MW) from ${label}`);
    if (p.raw >= 0 || p.adj >= 0) fuel.push({ col, ...p });
  }
  const totals = { gen: pick('Net Generation (MW)'), demand: pick('Demand (MW)'), ti: pick('Total Interchange (MW)') };
  const present = new Set(fuel.map((f) => f.col));
  const columns = Object.fromEntries(US_COLUMNS.map((c) => [c, Array(length).fill(null)]));
  const net = Array(length).fill(null);
  const ti = Array(length).fill(null);
  const reporting = new Uint16Array(length);
  const bas = new Set();
  const value = (r, p) => (p.adj >= 0 && num(r[p.adj]) != null ? num(r[p.adj]) : p.raw >= 0 ? num(r[p.raw]) : null);
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const r = splitCsv(line);
    const t = parseUtc(r[iUtc]) - HOUR_MS;
    const i = Math.round((t - startMs) / HOUR_MS);
    if (!(i >= 0 && i < length)) continue;
    bas.add(r[iBa]);
    const g = value(r, totals.gen);
    if (g != null) { net[i] = (net[i] ?? 0) + g; reporting[i]++; }
    const d = value(r, totals.demand);
    if (d != null) columns.demand[i] = (columns.demand[i] ?? 0) + d;
    const x = value(r, totals.ti);
    if (x != null) ti[i] = (ti[i] ?? 0) + x;
    for (const f of fuel) {
      const v = value(r, f);
      if (v != null) columns[f.col][i] = (columns[f.col][i] ?? 0) + v;
    }
  }
  // A fuel this file reports reads zero where no balancing authority had any.
  for (let i = 0; i < length; i++) {
    if (!reporting[i]) continue;
    for (const c of present) if (columns[c][i] == null) columns[c][i] = 0;
    // Interchange left after flows between balancing authorities cancel: the
    // net flow with Canada and Mexico, positive out of the US.
    if (ti[i] != null) {
      columns.imports[i] = Math.max(0, -ti[i]);
      columns.exports[i] = -Math.max(0, ti[i]);
    }
  }
  let hours = 0;
  for (let i = 0; i < length; i++) if (reporting[i]) hours++;
  const round = (a) => a.map((v) => (v == null ? null : Math.round(v)));
  return {
    startMs,
    length,
    columns: Object.fromEntries(Object.entries(columns).map(([c, a]) => [c, round(a)])),
    net: round(net),
    reporting: [...reporting],
    bas: bas.size,
    hours,
    fuels: [...present],
  };
}

/** Downloads one half-year file as text. */
export async function fetchHalf(key, timeoutMs = 180000) {
  const url = `${BASE}/${halfInfo(key).file}`;
  const res = await fetch(url, { headers: { 'user-agent': 'grid-records (github.com/sirashton/Grid-Records)' }, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
