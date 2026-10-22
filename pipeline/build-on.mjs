// Builds the Ontario (IESO) data files from the IESO's public reports
// (pipeline/sources/ieso.mjs) and writes site/data/on/.
//
// The history is one generation-by-fuel file a year since 2015 plus one
// demand file a year. Each parsed year is kept in the Actions cache
// (.cache-on/), so a run downloads only the current year's files (rewritten
// each morning, fetched again every few hours) and last year's for a few
// weeks into January. The hours since the yearly file's end come from the
// generator report for each day (rewritten every hour), so the data is about
// an hour behind; a later yearly file replaces those hours.
//
// Usage: node pipeline/build-on.mjs [--budget-minutes N]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ON_COLUMNS, GEN_COLUMNS, PARSE_VERSION, FIRST_YEAR, fetchYear, parseGeneratorDay, getText, dayUrl, estDate } from './sources/ieso.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, stitch } from './core/chunks.mjs';
import { extend, lastFilled } from './core/recent.mjs';
import { log } from './lib.mjs';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const CURRENT_MS = 3 * HOUR_MS;
const RECENT_DAYS = 3;

/** Whether year `y` should be fetched again. */
export function needsFetch(entry, y, currentYear, nowMs) {
  if (!entry || entry.version !== PARSE_VERSION) return true;
  const age = nowMs - Date.parse(entry.fetched);
  if (y === currentYear) return age > CURRENT_MS;
  // Last year's files settle in the first weeks of January.
  if (y === currentYear - 1) return Date.parse(entry.fetched) < Date.UTC(currentYear, 1, 1) && age > DAY_MS;
  return false;
}

/** Cuts a grid at its last hour with generation (demand runs a day behind). */
function trim(grid) {
  if (!grid) return null;
  const all = Object.fromEntries(ON_COLUMNS.map((c) => [c, Float64Array.from(grid.columns[c], (v) => v ?? NaN)]));
  const end = lastFilled({ length: grid.length, columns: all }, GEN_COLUMNS);
  if (!end) return null;
  const columns = Object.fromEntries(ON_COLUMNS.map((c) => [c, all[c].slice(0, end)]));
  return { startMs: grid.startMs, length: end, columns };
}

/** Lays the years and then the recent days on one grid. */
export function mergeOntario(years, days) {
  let grid = trim(stitch(years, { stepMinutes: 60, columns: ON_COLUMNS }));
  for (const d of [...days].filter(Boolean).sort((a, b) => a.startMs - b.startMs)) {
    grid = extend(grid, trim(d), { stepMinutes: 60, columns: ON_COLUMNS });
  }
  return trim(grid);
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      'budget-minutes': { type: 'string', default: '5' },
      out: { type: 'string', default: 'site/data/on' },
      cache: { type: 'string', default: '.cache-on' },
    },
  });
  const started = Date.now();
  const deadline = started + Number(args['budget-minutes']) * 60000;
  await mkdir(args.out, { recursive: true });
  await mkdir(args.cache, { recursive: true });
  const now = Date.now();
  const today = estDate(now);
  const currentYear = Number(today.slice(0, 4));

  const cached = new Map();
  for (const f of await readdir(args.cache)) {
    if (/^\d{4}\.json$/.test(f)) cached.set(Number(f.slice(0, 4)), JSON.parse(await readFile(`${args.cache}/${f}`, 'utf8')));
  }
  const years = [];
  for (let y = currentYear; y >= FIRST_YEAR; y--) years.push(y);
  const queue = years.filter((y) => needsFetch(cached.get(y), y, currentYear, now));
  log(`ON: ${cached.size} years cached, ${queue.length} to fetch`);
  const { done, left } = await runQueue(queue, async (y) => {
    const t = Date.now();
    const piece = await fetchYear(y, currentYear);
    if (!piece) return log(`ON: ${y}: no file`);
    const entry = { version: PARSE_VERSION, fetched: new Date().toISOString(), ...piece };
    cached.set(y, entry);
    await writeFile(`${args.cache}/${y}.json`, JSON.stringify(entry));
    log(`ON: ${y}: ${piece.length / 24} days in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }, { concurrency: 3, deadline, log: (m) => log(`ON: ${m}`) });
  log(`ON: fetched ${done} years, ${left} still to fetch`);

  const archive = trim(stitch([...cached.values()], { stepMinutes: 60, columns: ON_COLUMNS }));
  if (!archive) {
    log('ON: no data yet, nothing written');
    return;
  }
  const archiveEnd = archive.startMs + archive.length * HOUR_MS;

  // The generator report for each day from the yearly file's end to today.
  const days = [];
  for (let ms = Math.max(archiveEnd, now - RECENT_DAYS * DAY_MS); estDate(ms) <= today; ms += DAY_MS) {
    const day = estDate(ms);
    try {
      const xml = await getText(dayUrl(day, today), { retries: 1 });
      const piece = xml && parseGeneratorDay(xml);
      if (piece) days.push(piece);
      log(`ON: generator report ${day}: ${piece ? piece.columns.nuclear.filter((v) => v != null).length : 0} hours`);
    } catch (err) {
      log(`ON: generator report ${day} failed: ${err.message}`);
    }
  }

  const merged = mergeOntario([...cached.values()], days);
  const { bytes } = await writeDataset(args.out, {
    region: 'on',
    timeZone: 'America/Toronto',
    stepMinutes: 60,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: {
      years: [...cached.keys()].sort(),
      yearlyEnd: archiveEnd,
      units: { battery: 'MW, discharge only (fuel OTHER)', demand: 'MW, Ontario Demand' },
    },
  }, { log });
  log(`ON: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${ON_COLUMNS.length} columns x ${merged.length} hours),`,
    `yearly files to ${new Date(archiveEnd).toISOString()}, data to ${new Date(merged.startMs + merged.length * HOUR_MS).toISOString()}, in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
