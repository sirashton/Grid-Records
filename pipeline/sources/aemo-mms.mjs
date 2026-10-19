// AEMO's MMS Data Model monthly archive (NEMWEB): every scheduled and
// semi-scheduled unit's 5-minute output, regional prices, demand and AEMO's
// rooftop solar estimate, for the National Electricity Market.
// https://nemweb.com.au/Data_Archive/Wholesale_Electricity/MMSDM/
//
// Each table is a zipped CSV in AEMO's "C/I/D" format: I rows name the
// columns, D rows hold data. Times are NEM time (UTC+10, no daylight saving)
// and mark the end of each interval.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fetchText, SLOT_MS } from '../lib.mjs';

const HOST = 'https://nemweb.com.au';
const ARCHIVE = `${HOST}/Data_Archive/Wholesale_Electricity/MMSDM`;
const UA = { 'user-agent': 'grid-records (+https://github.com/sirashton/Grid-Records)' };

// Bump when parsing changes, so cached months are parsed again.
export const PARSE_VERSION = 2;

export const REGIONS = ['NSW1', 'QLD1', 'VIC1', 'SA1', 'TAS1'];

// Output columns, in the order they are written. Rooftop solar is AEMO's
// estimate of household and business panels, which the unit data can't see.
export const AU_FUELS = ['black_coal', 'brown_coal', 'gas', 'liquid', 'hydro', 'wind', 'solar', 'rooftop', 'bioenergy', 'other', 'battery', 'battery_charge', 'pumping'];
export const AU_COLUMNS = [...AU_FUELS, 'demand', 'price'];

/** Maps a GENUNITS CO2E_ENERGY_SOURCE to an output column. */
export function fuelColumn(source) {
  const s = String(source ?? '').trim().toLowerCase();
  if (s.startsWith('black coal')) return 'black_coal';
  if (s.startsWith('brown coal')) return 'brown_coal';
  if (s.includes('battery')) return 'battery';
  if (s === 'hydro') return 'hydro';
  if (s === 'wind') return 'wind';
  if (s === 'solar') return 'solar';
  if (s.includes('natural gas') || s.includes('methane') && !s.includes('biogas') || s.includes('waste gas') || s === 'ethane') return 'gas';
  if (s.includes('diesel') || s.includes('kerosene') || s.includes('oil')) return 'liquid';
  if (s.includes('bio') || s.includes('bagasse') || s.includes('landfill') || s.includes('wood')) return 'bioenergy';
  return 'other';
}

/** The month's directory of per-table zips. Only months from 2015 have one. */
export const monthDir = (ym) => `${ARCHIVE}/${ym.slice(0, 4)}/MMSDM_${ym.slice(0, 4)}_${ym.slice(4)}/MMSDM_Historical_Data_SQLLoader/DATA/`;

/** Links in a month's listing for one table, e.g. DISPATCH_UNIT_SCADA. */
export function tableLinks(html, table) {
  const re = new RegExp(`href="([^"]*(?:%23|#|_DVD_)${table}(?:%23|#|_\\d{6})[^"]*\\.zip)"`, 'gi');
  return [...html.matchAll(re)].map((m) => (m[1].startsWith('http') ? m[1] : `${HOST}${m[1].replace(/#/g, '%23')}`));
}

/** Parses an NEM time "YYYY/MM/DD HH:MM:SS" (UTC+10) to UTC ms. */
export function nemTime(s) {
  const m = /(\d{4})\/(\d\d)\/(\d\d) (\d\d):(\d\d)/.exec(s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 10 * 3600000;
}

/** The half hour an interval ending at t belongs to. */
export const slotOf = (t) => Math.floor((t - 1) / SLOT_MS) * SLOT_MS;

/**
 * Streams the D rows of a zipped MMS CSV as objects keyed by column name.
 * Uses the system unzip, since the files are hundreds of MB unpacked.
 * NEMWEB's daily archives are zips of zips; those are unpacked a level first.
 */
export async function* zipRows(url) {
  const dir = await mkdtemp(join(tmpdir(), 'mms-'));
  try {
    const file = join(dir, 'f.zip');
    // curl rather than fetch: Node's fetch has crashed part way through these
    // large downloads (an undici assertion), taking the whole run with it.
    await run('curl', ['-sSfL', '--retry', '4', '--retry-delay', '2', '--max-time', '600', '-A', UA['user-agent'], '-o', file, url]);
    const inner = (await output('unzip', ['-Z1', file])).split('\n').filter((n) => /\.zip$/i.test(n)).sort();
    if (!inner.length) {
      yield* unzipRows(file);
      return;
    }
    const sub = join(dir, 'inner');
    await run('unzip', ['-qq', '-o', file, '-d', sub]);
    for (const n of inner) yield* unzipRows(join(sub, n));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function* unzipRows(file) {
  const unzip = spawn('unzip', ['-p', file], { stdio: ['ignore', 'pipe', 'inherit'] });
  yield* csvRows(unzip.stdout);
  await new Promise((resolve, reject) => {
    const done = (code) => (code === 0 ? resolve() : reject(new Error(`unzip exited ${code}`)));
    if (unzip.exitCode != null) done(unzip.exitCode);
    else unzip.on('close', done);
  });
}

/** Yields D rows of MMS CSV text (a stream or a string) as objects. */
export async function* csvRows(input) {
  const lines = typeof input === 'string' ? input.split('\n') : createInterface({ input, crlfDelay: Infinity });
  let cols = null;
  for await (const line of lines) {
    if (line.startsWith('D,')) {
      if (!cols) continue;
      const f = line.split(',');
      const row = {};
      for (let k = 4; k < cols.length && k < f.length; k++) row[cols[k]] = f[k].charCodeAt(0) === 34 ? f[k].slice(1, -1) : f[k];
      yield row;
    } else if (line.startsWith('I,')) {
      cols = line.trim().split(',');
    }
  }
}

function output(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.trim()}`))));
  });
}

function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.trim()}`))));
  });
}

async function collect(url) {
  const out = [];
  for await (const r of zipRows(url)) out.push(r);
  return out;
}

/**
 * Builds DUID -> { region, type, column } from a month's registration tables.
 * Loads tied to a battery or hydro station are charging or pumping; other
 * loads (aluminium smelters' reserve trader units and the like) are left out.
 */
export function buildRegistry({ dudetail, dualloc, genunits }) {
  const latest = new Map();
  for (const r of dudetail) {
    const prev = latest.get(r.DUID);
    if (!prev || r.START_DATE > prev.START_DATE) latest.set(r.DUID, r);
  }
  // Energy sources were only filled in from late 2020, so a blank one gives way to another table's.
  const source = new Map();
  for (const g of genunits) if (g.CO2E_ENERGY_SOURCE || !source.has(g.GENSETID)) source.set(g.GENSETID, g.CO2E_ENERGY_SOURCE);
  const gensets = new Map();
  for (const a of dualloc) {
    if (!gensets.has(a.DUID)) gensets.set(a.DUID, new Set());
    gensets.get(a.DUID).add(a.GENSETID);
  }
  const units = {};
  const stationFuel = {};
  for (const [duid, r] of latest) {
    const src = [...(gensets.get(duid) ?? [])].map((g) => source.get(g)).find((s) => s);
    const column = src ? fuelColumn(src) : null;
    units[duid] = { region: r.REGIONID, type: r.DISPATCHTYPE, station: r.STATIONID, column };
    if (column && r.DISPATCHTYPE !== 'LOAD') stationFuel[r.STATIONID] ??= column;
  }
  for (const u of Object.values(units)) {
    if (u.type === 'LOAD') {
      const f = u.column ?? stationFuel[u.station];
      u.column = f === 'battery' ? 'battery_charge' : f === 'hydro' ? 'pumping' : null;
    } else {
      u.column ??= 'other';
    }
  }
  return units;
}

/**
 * Where a unit's 5-minute reading goes: [column, MW] pairs. Bidirectional
 * units (batteries since 2024) read negative while charging.
 */
export function unitFlows(unit, mw) {
  if (!unit?.column) return [];
  if (unit.type === 'BIDIRECTIONAL') {
    const charge = unit.column === 'hydro' ? 'pumping' : 'battery_charge';
    return mw >= 0 ? [[unit.column, mw]] : [[charge, -mw]];
  }
  return [[unit.column, Math.max(0, mw)]];
}

/** A month's half hours: [region][column] arrays of MW (or $/MWh), NaN where missing. */
function emptyMonth(ym) {
  const startMs = Date.UTC(+ym.slice(0, 4), +ym.slice(4) - 1, 1) - 10 * 3600000;
  const endMs = Date.UTC(+ym.slice(0, 4), +ym.slice(4), 1) - 10 * 3600000;
  const length = (endMs - startMs) / SLOT_MS;
  const regions = {};
  for (const reg of REGIONS) {
    regions[reg] = {};
    for (const c of AU_COLUMNS) regions[reg][c] = new Float64Array(length).fill(NaN);
  }
  return { startMs, length, regions };
}

const REGISTRY_TABLES = ['DUDETAILSUMMARY', 'DUALLOC', 'GENUNITS'];

/** A month's registration tables, as { dudetail, dualloc, genunits } rows. */
export async function fetchRegistryTables(ym, html) {
  html ??= await fetchText(monthDir(ym));
  if (!html) return null;
  const [dudetail, dualloc, genunits] = await Promise.all(REGISTRY_TABLES.map(async (t) => {
    const url = tableLinks(html, t)[0];
    return url ? collect(url) : [];
  }));
  return dudetail.length ? { dudetail, dualloc, genunits } : null;
}

/**
 * Parses one month. Unit output is summed per interval, then averaged over
 * the six intervals of each half hour. A half hour with no unit readings at
 * all is missing; units that don't report simply add nothing.
 */
export async function fetchMonth(ym, { log = () => {}, latest = null } = {}) {
  const html = await fetchText(monthDir(ym));
  if (!html) return null;
  const link = (t) => tableLinks(html, t);
  const scadaLinks = link('DISPATCH_UNIT_SCADA');
  if (!scadaLinks.length) return null;
  // The month's own tables first, then the latest month's, which name the fuel of units
  // registered before AEMO recorded energy sources.
  const own = (await fetchRegistryTables(ym, html)) ?? { dudetail: [], dualloc: [], genunits: [] };
  const units = buildRegistry({
    dudetail: [...own.dudetail, ...(latest?.dudetail ?? [])],
    dualloc: [...own.dualloc, ...(latest?.dualloc ?? [])],
    genunits: [...own.genunits, ...(latest?.genunits ?? [])],
  });
  const month = emptyMonth(ym);
  const { startMs, length } = month;
  const idx = (t) => (slotOf(t) - startMs) / SLOT_MS;

  // Unit output: total MW per region, column and 5-minute interval.
  const totals = {};
  for (const reg of REGIONS) {
    totals[reg] = {};
    for (const c of AU_FUELS) totals[reg][c] = new Float64Array(length);
  }
  const seen = new Uint8Array(length * 6);
  const unknown = {};
  for (const url of scadaLinks) {
    for await (const r of zipRows(url)) {
      const t = nemTime(r.SETTLEMENTDATE);
      const i = idx(t);
      if (i < 0 || i >= length) continue;
      seen[i * 6 + (Math.floor((t - 1 - startMs) / 300000) % 6)] = 1;
      const u = units[r.DUID];
      const mw = Number(r.SCADAVALUE);
      if (!u) { if (mw > 1) unknown[r.DUID] = Math.max(unknown[r.DUID] ?? 0, mw); continue; }
      if (!REGIONS.includes(u.region) || !Number.isFinite(mw)) continue;
      for (const [c, v] of unitFlows(u, mw)) totals[u.region][c][i] += v;
    }
  }
  for (let i = 0; i < length; i++) {
    let n = 0;
    for (let k = 0; k < 6; k++) n += seen[i * 6 + k];
    if (!n) continue;
    for (const reg of REGIONS) for (const c of AU_FUELS) if (c !== 'rooftop') month.regions[reg][c][i] = totals[reg][c][i] / n;
  }
  if (Object.keys(unknown).length) log(`AU ${ym}: units with no registration`, JSON.stringify(unknown));

  // Rooftop solar: half-hourly per region. Prefer measured over satellite estimates.
  const rank = { MEASUREMENT: 3, DAILY: 2, SATELLITE: 1 };
  const best = {};
  for (const url of link('ROOFTOP_PV_ACTUAL').slice(0, 1)) {
    for await (const r of zipRows(url)) {
      if (!REGIONS.includes(r.REGIONID)) continue;
      const i = idx(nemTime(r.INTERVAL_DATETIME));
      if (i < 0 || i >= length) continue;
      const k = `${r.REGIONID}|${i}`;
      const q = rank[r.TYPE] ?? 0;
      if ((best[k] ?? -1) >= q) continue;
      best[k] = q;
      month.regions[r.REGIONID].rooftop[i] = Number(r.POWER);
    }
  }

  // Price and demand: averaged over the half hour (5-minute rows since October 2021).
  for (const [table, col, field, keep] of [['TRADINGPRICE', 'price', 'RRP', () => true], ['DISPATCHREGIONSUM', 'demand', 'TOTALDEMAND', (r) => r.INTERVENTION === '0']]) {
    const acc = {};
    for (const url of link(table).slice(0, 1)) {
      for await (const r of zipRows(url)) {
        if (!REGIONS.includes(r.REGIONID) || !keep(r)) continue;
        const t = nemTime(r.SETTLEMENTDATE);
        const i = idx(t);
        if (i < 0 || i >= length) continue;
        // Keyed by interval, so a rerun row replaces the earlier one.
        ((acc[r.REGIONID] ??= new Map()).set(t, [i, Number(r[field])]));
      }
    }
    for (const [reg, rows] of Object.entries(acc)) {
      const s = new Float64Array(length);
      const n = new Uint16Array(length);
      for (const [i, v] of rows.values()) if (Number.isFinite(v)) { s[i] += v; n[i]++; }
      for (let i = 0; i < length; i++) if (n[i]) month.regions[reg][col][i] = s[i] / n[i];
    }
  }
  const round = (v) => (Number.isNaN(v) ? null : Math.round(v * 10) / 10);
  return {
    startMs,
    length,
    regions: Object.fromEntries(REGIONS.map((reg) => [reg, Object.fromEntries(AU_COLUMNS.map((c) => [c, Array.from(month.regions[reg][c], round)]))])),
  };
}
