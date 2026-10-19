// Builds the Germany data files from Energy-Charts, and writes site/data/de/.
//
// Each calendar year is one request of about 5 MB. Parsed years are kept in
// the Actions cache (.cache-de/); a run fetches years it has never seen and
// refreshes the current year (and, early in January, the one before), since
// Energy-Charts revises recent data as the grid operators report.
//
// Usage: node pipeline/build-de.mjs [--budget-minutes N] [--from YYYY]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchYear, fetchInstalled, DE_COLUMNS, PARSE_VERSION, STEP_MINUTES } from './sources/energy-charts.mjs';
import { writeDataset } from './core/dataset.mjs';
import { stitch } from './core/chunks.mjs';
import { DAY_MS, log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    from: { type: 'string', default: '2015' },
    out: { type: 'string', default: 'site/data/de' },
    cache: { type: 'string', default: '.cache-de' },
  },
});

const started = Date.now();
const deadline = started + Number(args['budget-minutes']) * 60000;
const YEARS = `${args.cache}/years`;
// The current year is fetched again once it is this old.
const REFRESH_MS = 25 * 60000;

/** Whether a cached year should be fetched again. */
export function isStale(entry, year, nowMs) {
  if (!entry || entry.version !== PARSE_VERSION) return true;
  const now = new Date(nowMs);
  const thisYear = now.getUTCFullYear();
  const age = nowMs - Date.parse(entry.fetched);
  if (year === thisYear) return age > REFRESH_MS;
  // Last year stays fresh for the first two weeks of January, then once more after.
  if (year === thisYear - 1) return nowMs - Date.UTC(thisYear, 0, 1) < 14 * DAY_MS ? age > REFRESH_MS : Date.parse(entry.fetched) < Date.UTC(thisYear, 0, 14);
  return false;
}

/** Lays cached years onto one 15-minute grid, trimming trailing slots with no data at all. */
export function mergeYears(entries) {
  const present = entries.filter((e) => e && e.length);
  if (!present.length) return null;
  // Energy-Charts starts at midnight UTC on 1 January 2015, an hour after New
  // Year in Germany. A few missing slots in front let 2015 count as a whole
  // German calendar year.
  const first = Math.min(...present.map((e) => e.startMs));
  const newYear = Date.UTC(new Date(first).getUTCFullYear(), 0, 1) - 3600000;
  const pad = first - newYear > 0 && first - newYear <= 3600000 ? [{ startMs: newYear, length: 1, columns: {} }] : [];
  const merged = stitch([...pad, ...present], { stepMinutes: STEP_MINUTES, columns: DE_COLUMNS });
  if (!merged) return null;
  let end = merged.length;
  while (end > 0 && DE_COLUMNS.every((c) => Number.isNaN(merged.columns[c][end - 1]))) end--;
  for (const c of DE_COLUMNS) merged.columns[c] = merged.columns[c].subarray(0, end);
  return { ...merged, length: end };
}

async function main() {
  await mkdir(YEARS, { recursive: true });
  await mkdir(args.out, { recursive: true });
  const now = Date.now();
  const thisYear = new Date(now).getUTCFullYear();
  const cached = new Map();
  for (const f of await readdir(YEARS)) {
    if (f.endsWith('.json')) cached.set(Number(f.slice(0, 4)), JSON.parse(await readFile(`${YEARS}/${f}`, 'utf8')));
  }
  log(`DE: ${cached.size} years in cache`);
  const years = [];
  for (let y = thisYear; y >= Number(args.from); y--) years.push(y);
  const queue = years.filter((y) => isStale(cached.get(y), y, now));
  let fetched = 0;
  for (const year of queue) {
    if (Date.now() > deadline) break;
    try {
      const parsed = await fetchYear(year);
      if (parsed) {
        const entry = { fetched: new Date().toISOString(), version: PARSE_VERSION, ...parsed };
        cached.set(year, entry);
        await writeFile(`${YEARS}/${year}.json`, JSON.stringify(entry));
        log(`DE: ${year}: ${parsed.length} quarter hours, types ${parsed.types.join('; ')}`);
      }
      fetched++;
    } catch (err) {
      log(`DE: ${year} failed: ${err.message}`);
    }
    // Energy-Charts rate-limits bursts of requests.
    await new Promise((r) => setTimeout(r, 1500));
  }
  const left = queue.length - fetched;
  log(`DE: fetched ${fetched} years, ${left} still to fetch`);

  const merged = mergeYears([...cached.values()]);
  if (!merged) {
    log('DE: no years yet, nothing written');
    return;
  }
  // Installed capacity, kept from the last good fetch if this one fails.
  let installed = null;
  try {
    installed = await fetchInstalled();
    if (installed) await writeFile(`${args.cache}/installed.json`, JSON.stringify(installed));
  } catch (err) {
    log(`DE: installed capacity failed: ${err.message}`);
  }
  if (!installed && existsSync(`${args.cache}/installed.json`)) installed = JSON.parse(await readFile(`${args.cache}/installed.json`, 'utf8'));
  if (installed) await writeFile(`${args.out}/installed.json`, JSON.stringify(installed));

  const { bytes } = await writeDataset(args.out, {
    region: 'de',
    timeZone: 'Europe/Berlin',
    stepMinutes: STEP_MINUTES,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { years: { first: Math.min(...cached.keys()), last: Math.max(...cached.keys()), toFetch: left } },
  }, { log });
  log(`DE: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${DE_COLUMNS.length} columns x ${merged.length} slots) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
