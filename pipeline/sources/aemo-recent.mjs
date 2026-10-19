// AEMO's rolling NEMWEB reports, for the weeks since the last monthly archive
// (aemo-mms.mjs) up to the latest five minutes.
// https://nemweb.com.au/Reports/Current/ and /Reports/Archive/
//
// - Dispatch_SCADA: every unit's output, one small zip per 5 minutes for the
//   last two days (Current), and one zip of those per day for a year (Archive).
// - DispatchIS_Reports: regional price and demand, per 5 minutes, two days;
//   Public_Prices has the same per day for 60 days.
// - ROOFTOP_PV/ACTUAL: AEMO's rooftop solar estimate per half hour, two weeks;
//   the Archive has it per week for a year.
//
// The same tables as the monthly archive, so rows are read the same way.
import { fetchText, SLOT_MS, DAY_MS } from '../lib.mjs';
import { zipRows, nemTime, unitFlows, REGIONS, AU_FUELS, AU_COLUMNS } from './aemo-mms.mjs';

const HOST = 'https://nemweb.com.au';

// Bump when parsing changes, so the recent state is fetched again.
export const RECENT_VERSION = 1;
// How far back the feeds reach: the daily SCADA archive keeps about a year,
// but prices go back 60 days, so the gap filled is at most that.
export const MAX_DAYS = 56;

const FIVE_MIN = 5 * 60000;
const SCADA_FUELS = AU_FUELS.filter((c) => c !== 'rooftop');

// Each feed: where to list it, which files to take, and what time a name stands for.
export const FEEDS = {
  scada: { dir: '/Reports/Current/Dispatch_SCADA/', re: /PUBLIC_DISPATCHSCADA_(\d{12})_\d+\.zip$/i, span: FIVE_MIN },
  scadaDaily: { dir: '/Reports/Archive/Dispatch_SCADA/', re: /PUBLIC_DISPATCHSCADA_(\d{8})\.zip$/i, span: DAY_MS },
  dispatch: { dir: '/Reports/Current/DispatchIS_Reports/', re: /PUBLIC_DISPATCHIS_(\d{12})_\d+\.zip$/i, span: FIVE_MIN },
  pricesDaily: { dir: '/Reports/Current/Public_Prices/', re: /PUBLIC_PRICES_(\d{8})0000_\d+\.zip$/i, span: DAY_MS },
  rooftop: { dir: '/Reports/Current/ROOFTOP_PV/ACTUAL/', re: /PUBLIC_ROOFTOP_PV_ACTUAL_MEASUREMENT_(\d{12})00_\d+\.zip$/i, span: SLOT_MS },
  rooftopWeekly: { dir: '/Reports/Archive/ROOFTOP_PV/ACTUAL/', re: /PUBLIC_ROOFTOP_PV_ACTUAL_MEASUREMENT_(\d{8})\.zip$/i, span: 7 * DAY_MS },
};

/** NEM time in a file name (yyyymmdd or yyyymmddhhmm) to UTC ms. */
export function nameTime(stamp) {
  const s = stamp.length === 8 ? `${stamp}0000` : stamp;
  return nemTime(`${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6, 8)} ${s.slice(8, 10)}:${s.slice(10, 12)}`);
}

/** The files a listing links to for a feed: [{ name, url, t }], oldest first. */
export function listFiles(html, feed) {
  const out = new Map();
  for (const m of String(html ?? '').matchAll(/href="([^"]+\.zip)"/gi)) {
    const href = m[1];
    const name = href.split('/').pop();
    const hit = feed.re.exec(name);
    if (!hit) continue;
    out.set(name, { name, url: href.startsWith('http') ? href : `${HOST}${href.startsWith('/') ? '' : feed.dir}${href}`, t: nameTime(hit[1]) });
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

/**
 * Which files to fetch, given each feed's listing: everything from fromMs
 * that isn't in state.files. The daily and weekly archives come first, since
 * one of their files stands for hundreds of small ones; the rolling feeds
 * only fill in after the archives' last file. AEMO turns a runner away
 * (HTTP 403) after a burst of requests, so fewer files matters.
 */
export function plan(listings, state, fromMs) {
  const want = [];
  const pick = (key, files, afterMs = -Infinity) => {
    const span = FEEDS[key].span;
    for (const f of files ?? []) {
      // A 5-minute name marks the end of its interval; daily and weekly ones the start of their period.
      const end = span === FIVE_MIN ? f.t : f.t + span;
      if (end <= fromMs || f.t < afterMs || state.files[f.name]) continue;
      want.push({ ...f, feed: key });
    }
  };
  for (const [live, archive] of [['scada', 'scadaDaily'], ['dispatch', 'pricesDaily'], ['rooftop', 'rooftopWeekly']]) {
    const files = listings[archive] ?? [];
    pick(archive, files);
    pick(live, listings[live], files.length ? files.at(-1).t + FEEDS[archive].span : -Infinity);
  }
  return want;
}

/**
 * Adds one file's rows to state.rows, keyed by interval end (ms). Unit output
 * replaces what an interval had, since one file holds whole intervals and the
 * daily and 5-minute files overlap.
 */
export function addRows(state, feed, rows, units) {
  const at = (t) => (state.rows[t] ??= {});
  if (feed === 'scada' || feed === 'scadaDaily') {
    const sums = new Map();
    for (const r of rows) {
      if (!r.DUID || !r.SETTLEMENTDATE) continue;
      const t = nemTime(r.SETTLEMENTDATE);
      if (!sums.has(t)) sums.set(t, {});
      const u = units[r.DUID];
      const mw = Number(r.SCADAVALUE);
      if (!u || !REGIONS.includes(u.region) || !Number.isFinite(mw)) continue;
      const s = (sums.get(t)[u.region] ??= new Array(SCADA_FUELS.length).fill(0));
      for (const [c, v] of unitFlows(u, mw)) s[SCADA_FUELS.indexOf(c)] += v;
    }
    for (const [t, s] of sums) at(t).s = s;
    return;
  }
  for (const r of rows) {
    if (feed === 'rooftop' || feed === 'rooftopWeekly') {
      if (!REGIONS.includes(r.REGIONID) || !r.INTERVAL_DATETIME) continue;
      const v = Number(r.POWER);
      if (Number.isFinite(v)) (at(nemTime(r.INTERVAL_DATETIME)).r ??= {})[r.REGIONID] = v;
    } else {
      // DispatchIS and Public_Prices: the dispatch price and regional demand tables.
      if (!REGIONS.includes(r.REGIONID) || !r.SETTLEMENTDATE || (r.INTERVENTION != null && r.INTERVENTION !== '0')) continue;
      const row = at(nemTime(r.SETTLEMENTDATE));
      if (r.RRP != null && Number.isFinite(Number(r.RRP))) (row.p ??= {})[r.REGIONID] = Number(r.RRP);
      if (r.TOTALDEMAND != null && Number.isFinite(Number(r.TOTALDEMAND))) (row.d ??= {})[r.REGIONID] = Number(r.TOTALDEMAND);
    }
  }
}

/**
 * Half hours from fromMs, as a piece in the monthly cache's shape:
 * { startMs, length, regions: { REGION: { column: MW[] } } }. A half hour
 * needs most of its six unit readings, and is left off until it has ended.
 */
export function halfHours(state, fromMs) {
  const times = Object.keys(state.rows).map(Number).filter((t) => t > fromMs && state.rows[t].s);
  if (!times.length) return null;
  const startMs = Math.ceil(fromMs / SLOT_MS) * SLOT_MS;
  const latest = Math.max(...times);
  const length = Math.floor((latest - startMs) / SLOT_MS);
  if (length <= 0) return null;
  const regions = Object.fromEntries(REGIONS.map((reg) => [reg, Object.fromEntries(AU_COLUMNS.map((c) => [c, new Array(length).fill(null)]))]));
  const round = (v) => Math.round(v * 10) / 10;
  for (let i = 0; i < length; i++) {
    const s = startMs + i * SLOT_MS;
    const rows = [];
    for (let t = s + FIVE_MIN; t <= s + SLOT_MS; t += FIVE_MIN) if (state.rows[t]) rows.push(state.rows[t]);
    const scada = rows.filter((r) => r.s);
    for (const reg of REGIONS) {
      const out = regions[reg];
      if (scada.length >= 4) {
        SCADA_FUELS.forEach((c, k) => {
          out[c][i] = round(scada.reduce((sum, r) => sum + (r.s[reg]?.[k] ?? 0), 0) / scada.length);
        });
      }
      for (const [key, col] of [['p', 'price'], ['d', 'demand']]) {
        const vals = rows.map((r) => r[key]?.[reg]).filter((v) => v != null);
        if (vals.length) out[col][i] = round(vals.reduce((a, b) => a + b, 0) / vals.length);
      }
      const roof = state.rows[s + SLOT_MS]?.r?.[reg];
      if (roof != null) out.rooftop[i] = round(roof);
    }
  }
  return { startMs, length, regions };
}

/** Lists every feed. A listing that fails is left out, so the others still count. */
export async function fetchListings({ log = () => {} } = {}) {
  const out = {};
  await Promise.all(Object.entries(FEEDS).map(async ([key, feed]) => {
    try {
      out[key] = listFiles(await fetchText(`${HOST}${feed.dir}`), feed);
    } catch (err) {
      log(`AU recent: listing ${key} failed: ${err.message}`);
    }
  }));
  return out;
}

/** Fetches one planned file into the state. */
export async function fetchFile(state, file, units) {
  const rows = [];
  for await (const r of zipRows(file.url)) rows.push(r);
  addRows(state, file.feed, rows, units);
  state.files[file.name] = { t: file.t };
}
