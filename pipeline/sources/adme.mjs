// Uruguay's generation by source from ADME, the market administrator
// (pronos.adme.com.uy/gpf.php, "Generación por fuente", from SCADA). The page
// builds an hourly spreadsheet for a date range on request and serves it from
// /cache/; one month takes the server about half a minute. The history starts
// in 2018 (earlier ranges fail on the server).
//
// The first sheet has one row per hour, "YYYY-MM-DD HH" in Uruguayan time
// (UTC-3 all year since 2015), the hour starting then, with MW for the four
// hydro plants (Salto Grande, Bonete, Baygorria, Palmar), wind, solar,
// thermal, biomass, imports from Argentina and from Brazil (Rivera and Melo)
// and demand. Exports are not a column: they are what generation and imports
// leave over after demand (inferred, so they also carry the grid's losses).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
export const BASE = 'https://pronos.adme.com.uy';
export const PARSE_VERSION = 1;
export const HOUR_MS = 3600000;
export const UTC_OFFSET_MS = -3 * HOUR_MS;

// Spreadsheet headings to dataset columns.
const HEADINGS = {
  'Salto Grande': 'hydro_salto',
  Bonete: 'hydro_negro',
  Baygorria: 'hydro_negro',
  Palmar: 'hydro_negro',
  'Eólica': 'wind',
  Solar: 'solar',
  'Térmica': 'thermal',
  Biomasa: 'biomass',
  'Imp.Arg': 'imports',
  'Imp.Br.Riv': 'imports',
  'Imp.Br.Mel': 'imports',
  Demanda: 'demand',
};
export const GEN_COLUMNS = ['hydro_salto', 'hydro_negro', 'wind', 'solar', 'thermal', 'biomass'];
export const UY_COLUMNS = [...GEN_COLUMNS, 'imports', 'exports', 'demand'];

/** The form's dates for month YYYYMM: first and last day, DD/MM/YYYY. */
export function monthDates(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `01/${mm}/${y}`, to: `${last}/${mm}/${y}`, startMs: Date.UTC(y, m - 1, 1) - UTC_OFFSET_MS, days: last };
}

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Rows of the first sheet of an ODS content.xml, as arrays of numbers and strings. */
export function firstSheetRows(xml) {
  const table = xml.match(/<table:table\b[^>]*>([\s\S]*?)<\/table:table>/)?.[1] ?? '';
  const rows = [];
  for (const r of table.matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
    const row = [];
    for (const c of (r[2] ?? '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
      const attrs = c[1];
      const repeat = Math.min(Number(attrs.match(/table:number-columns-repeated="(\d+)"/)?.[1] ?? 1), 64);
      const value = attrs.match(/office:value="([^"]*)"/)?.[1];
      const text = unescape((c[2] ?? '').replace(/<text:s[^>]*\/>/g, ' ').replace(/<[^>]+>/g, '')).trim();
      const v = value != null ? Number(value) : text;
      for (let k = 0; k < repeat; k++) row.push(v);
    }
    while (row.length && row.at(-1) === '') row.pop();
    const repeatRows = Math.min(Number(r[1].match(/table:number-rows-repeated="(\d+)"/)?.[1] ?? 1), 64);
    for (let k = 0; k < repeatRows; k++) rows.push(row);
  }
  return rows;
}

/** One month's hourly rows onto the month's grid: { startMs, length, columns, hours }. */
export function parseMonth(ym, rows) {
  const { startMs, days } = monthDates(ym);
  const length = days * 24;
  const columns = Object.fromEntries(UY_COLUMNS.map((c) => [c, Array(length).fill(null)]));
  const head = rows.findIndex((r) => r[0] === 'Fecha');
  if (head < 0) return { startMs, length, columns, hours: 0 };
  const map = rows[head].map((h) => HEADINGS[String(h).trim()] ?? null);
  let hours = 0;
  for (const r of rows.slice(head + 1)) {
    const m = String(r[0]).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})/);
    if (!m) continue;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4]) - UTC_OFFSET_MS;
    const i = Math.round((t - startMs) / HOUR_MS);
    if (i < 0 || i >= length) continue;
    const sums = {};
    map.forEach((col, k) => {
      if (!col) return;
      const v = r[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      sums[col] = (sums[col] ?? 0) + v;
    });
    if (!GEN_COLUMNS.some((c) => c in sums)) continue;
    for (const [c, v] of Object.entries(sums)) columns[c][i] = Math.round(v * 10) / 10;
    hours++;
  }
  // Exports: what generation and imports leave after demand.
  for (let i = 0; i < length; i++) {
    if (columns.demand[i] == null) continue;
    const supply = GEN_COLUMNS.reduce((s, c) => s + (columns[c][i] ?? 0), 0) + (columns.imports[i] ?? 0);
    columns.exports[i] = -Math.max(0, Math.round((supply - columns.demand[i]) * 10) / 10);
  }
  return { startMs, length, columns, hours };
}

async function fetchText(url, timeoutMs) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Asks ADME to build month YYYYMM and downloads its hourly spreadsheet. Returns the first sheet's rows. */
export async function fetchMonth(ym) {
  const { from, to } = monthDates(ym);
  const page = (await fetchText(`${BASE}/gpf.php?fecha_ini=${from}&fecha_fin=${to}`, 240000)).toString('latin1');
  const link = page.match(/\/?cache\/gpf_\d+_\d+_horario\.ods/)?.[0];
  if (!link) {
    if (/Fatal error/.test(page)) return null; // no data for the range
    throw new Error(`no spreadsheet link for ${ym}`);
  }
  const ods = await fetchText(`${BASE}/${link.replace(/^\//, '')}`, 120000);
  const dir = await mkdtemp(join(tmpdir(), 'adme-'));
  try {
    await writeFile(join(dir, 'f.ods'), ods);
    const xml = (await exec('unzip', ['-p', join(dir, 'f.ods'), 'content.xml'], { maxBuffer: 1 << 28, encoding: 'utf8' })).stdout;
    return firstSheetRows(xml);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
