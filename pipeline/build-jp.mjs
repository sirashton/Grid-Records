// Builds the Japan data files from the nine interconnected areas' supply and
// demand results (pipeline/sources/jp-areas.mjs), and writes site/data/jp/.
//
// Two kinds of file per area, each cached in .cache-jp/<area>/ (Actions cache):
// - months in the shared layout (half hours, thermal split by fuel), from
//   early 2024. The current month is fetched again on every run, since most
//   operators rewrite it through the day; last month every few hours (late
//   revisions, and Tohoku's monthly file replacing its daily ones); older
//   months are kept unless the parser changes.
// - the older hourly files (April 2016 to early 2024), fetched once.
// Where both cover a slot, the shared layout wins.
//
// The national series is the sum of the nine areas, and only where all nine
// have a reading. Okinawa is not included.
//
// Usage: node pipeline/build-jp.mjs [--budget-minutes N] [--concurrency N] [--no-history]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { AREAS, JP_COLUMNS, FIRST_MONTH, PARSE_VERSION, STEP_MINUTES, fetchAreaMonth, historyFiles, fetchHistoryFile, joinPieces, combineAreas, lastFilled } from './sources/jp-areas.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, monthList } from './core/chunks.mjs';
import { log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '5' },
    out: { type: 'string', default: 'site/data/jp' },
    cache: { type: 'string', default: '.cache-jp' },
    concurrency: { type: 'string', default: '4' },
    'no-history': { type: 'boolean', default: false },
  },
});

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const SLOT_MS = STEP_MINUTES * 60000;

/**
 * Whether a cached area-month should be fetched again. index 0 is the
 * current month (always), 1 the one before (every 3 hours). A month that
 * came partly from daily files is checked daily; one with no file yet,
 * monthly.
 */
export function isStale(entry, index, nowMs) {
  if (!entry || (!entry.missing && entry.version !== PARSE_VERSION)) return true;
  const age = nowMs - Date.parse(entry.fetched);
  if (index === 0) return true;
  if (index === 1) return age > 3 * HOUR_MS;
  if (entry.partial || index < 4) return age > DAY_MS;
  return entry.missing ? age > 30 * DAY_MS : false;
}

/** Whether a cached older file should be fetched again: never fetched, an older parser, or missing a month ago. */
export const isHistoryStale = (entry, nowMs) => !entry || (entry.missing ? nowMs - Date.parse(entry.fetched) > 30 * DAY_MS : entry.version !== PARSE_VERSION);

const toJson = (piece) => ({ ...piece, columns: Object.fromEntries(Object.entries(piece.columns).map(([k, v]) => [k, Array.from(v, (x) => (Number.isNaN(x) ? null : x))])) });
const fromJson = (entry) => ({ ...entry, columns: Object.fromEntries(Object.entries(entry.columns ?? {}).map(([k, v]) => [k, Float64Array.from(v, (x) => (x == null ? NaN : x))])) });
const fmt = (ms) => new Date(ms + 9 * HOUR_MS).toISOString().slice(0, 16).replace('T', ' ');
const entryOf = (parsed) => (parsed && parsed.length
  ? { fetched: new Date().toISOString(), version: PARSE_VERSION, ...toJson(parsed) }
  : { fetched: new Date().toISOString(), missing: true });

async function main() {
  const started = Date.now();
  const deadline = started + Number(args['budget-minutes']) * 60000;
  const now = Date.now();
  // Months in Japan time, newest first.
  const months = monthList(FIRST_MONTH, now + 9 * HOUR_MS);
  const cached = new Map();
  for (const area of AREAS) {
    const dir = `${args.cache}/${area.key}`;
    await mkdir(dir, { recursive: true });
    for (const f of await readdir(dir)) {
      if (f.endsWith('.json')) cached.set(`${area.key}/${f.slice(0, -5)}`, JSON.parse(await readFile(`${dir}/${f}`, 'utf8')));
    }
  }
  log(`JP: ${cached.size} area files in cache`);
  let refused = 0;
  const queueLog = (msg) => { if (/HTTP 403/.test(msg)) refused++; log(`JP: ${msg}`); };
  const save = async (key, entry) => {
    cached.set(key, entry);
    await writeFile(`${args.cache}/${key}.json`, JSON.stringify(entry));
  };

  // Months first, newest first, so a short run still brings the page up to date.
  const queue = [];
  months.forEach((m, i) => {
    for (const area of AREAS) if (isStale(cached.get(`${area.key}/${m}`), i, now)) queue.push({ area, m, name: `${area.name} ${m}` });
  });
  const monthsRun = await runQueue(queue, async ({ area, m }) => {
    const parsed = await fetchAreaMonth(area, m, { nowMs: now });
    await save(`${area.key}/${m}`, entryOf(parsed));
    if (!parsed) log(`JP: ${area.name} ${m}: no file`);
  }, { concurrency: Number(args.concurrency), deadline, stop: () => refused > 5, log: queueLog });
  log(`JP: fetched ${monthsRun.done} area-months, ${monthsRun.left} still to fetch`);

  // Then the older hourly files, once each.
  let historyLeft = 0;
  if (!args['no-history']) {
    const hq = [];
    for (const area of AREAS) {
      let files = [];
      try {
        files = await historyFiles(area);
      } catch (err) {
        log(`JP: ${area.name}: list of older files failed: ${err.message}`);
      }
      for (const file of files) if (isHistoryStale(cached.get(`${area.key}/old-${file.name}`), now)) hq.push({ area, file, name: `${area.name} ${file.name}` });
    }
    const run = await runQueue(hq, async ({ area, file }) => {
      const parsed = await fetchHistoryFile(file);
      await save(`${area.key}/old-${file.name}`, entryOf(parsed));
      log(`JP: ${area.name} ${file.name}: ${parsed?.length ? `${fmt(parsed.startMs)} to ${fmt(parsed.startMs + (parsed.length - 1) * SLOT_MS)}` : 'no file'}`);
    }, { concurrency: Number(args.concurrency), deadline, stop: () => refused > 5, log: queueLog });
    historyLeft = run.left;
    log(`JP: fetched ${run.done} older files, ${run.left} still to fetch`);
  }

  const areas = {};
  const coverage = {};
  for (const area of AREAS) {
    const entries = [...cached.entries()].filter(([k, e]) => k.startsWith(`${area.key}/`) && e && !e.missing && e.length);
    const old = entries.filter(([k]) => k.includes('/old-')).map(([, e]) => fromJson(e)).sort((a, b) => a.startMs - b.startMs);
    const recent = entries.filter(([k]) => !k.includes('/old-')).map(([, e]) => fromJson(e)).sort((a, b) => a.startMs - b.startMs);
    // Later pieces win: the shared layout over the older files.
    const joined = joinPieces([...old, ...recent], JP_COLUMNS);
    areas[area.key] = joined;
    const end = lastFilled(joined);
    const split = recent.length ? fmt(recent[0].startMs) : null;
    coverage[area.key] = joined.length
      ? { name: area.name, first: fmt(joined.startMs), last: fmt(joined.startMs + (end - 1) * SLOT_MS), split, months: recent.length, olderFiles: old.length }
      : null;
    log(`JP: ${area.name}: ${coverage[area.key] ? `${coverage[area.key].first} to ${coverage[area.key].last} JST, split by fuel from ${split}, ${recent.length} months and ${old.length} older files` : 'no data'}`);
  }
  const national = combineAreas(areas);
  if (!national) {
    log('JP: not every area has data yet, nothing written');
    return;
  }
  // From the first to the last slot all nine areas have.
  const end = lastFilled(national);
  let first = 0;
  while (first < end && Number.isNaN(national.columns.demand[first])) first++;
  const columns = Object.fromEntries(JP_COLUMNS.map((c) => [c, national.columns[c].subarray(first, end)]));
  const startMs = national.startMs + first * SLOT_MS;
  const length = end - first;
  let gaps = 0;
  for (let i = 0; i < length; i++) if (Number.isNaN(columns.demand[i])) gaps++;
  let splitFrom = 0;
  while (splitFrom < length && Number.isNaN(columns.gas[splitFrom])) splitFrom++;
  const { meta, bytes } = await writeDataset(args.out, {
    region: 'jp',
    timeZone: 'Asia/Tokyo',
    stepMinutes: STEP_MINUTES,
    startMs,
    length,
    columns,
    extra: {
      areas: coverage,
      // The first slot with thermal split by fuel nationally.
      splitFromMs: startMs + splitFrom * SLOT_MS,
      excluded: { okinawa: 'Okinawa (area 10) is not connected to the other nine areas, and its operator\'s site refuses automated requests.' },
      toFetch: { months: monthsRun.left, olderFiles: historyLeft },
    },
  }, { log });
  log(`JP: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${meta.columns.length} columns x ${length} slots,`,
    `${fmt(startMs)} to ${fmt(startMs + (length - 1) * SLOT_MS)} JST, ${(gaps / 2 / 24).toFixed(1)} days missing, split by fuel from ${fmt(meta.splitFromMs)}) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
