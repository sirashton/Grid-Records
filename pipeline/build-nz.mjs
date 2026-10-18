// Builds the New Zealand data files from the Electricity Authority's monthly
// generation-by-plant CSVs, and writes site/data/nz/.
//
// The history is hundreds of monthly files, so each parsed month is kept in
// the Actions cache (.cache-nz/). A run fetches months it has never seen,
// newest first, within a time budget, and refreshes the last few months once
// a day, since the Authority posts and revises them weeks after month end.
//
// Usage: node pipeline/build-nz.mjs [--budget-minutes N] [--from YYYY-MM] [--concurrency N]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchGenerationMonth, NZ_COLUMNS, PARSE_VERSION } from './sources/emi-generation.mjs';
import { encodeColumns } from './encode.mjs';
import { SLOT_MS, DAY_MS, log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    from: { type: 'string', default: '1990-01' },
    out: { type: 'string', default: 'site/data/nz' },
    cache: { type: 'string', default: '.cache-nz' },
    concurrency: { type: 'string', default: '4' },
  },
});

const started = Date.now();
const deadline = started + Number(args['budget-minutes']) * 60000;
const MONTHS = `${args.cache}/months`;
// Months this recent are refetched once a day; older ones are kept for good.
const RECENT_MONTHS = 4;

const ym = (y, m) => `${y}${String(m + 1).padStart(2, '0')}`;

/** Every month from `from` (YYYY-MM) to the current one, newest first. */
export function monthList(from, nowMs) {
  const [fy, fm] = from.split('-').map(Number);
  const now = new Date(nowMs);
  const out = [];
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth();
  while (y > fy || (y === fy && m >= fm - 1)) {
    out.push(ym(y, m));
    if (--m < 0) { m = 11; y--; }
  }
  return out;
}

/** Whether a cached month (or a cached "no file yet") should be fetched again. */
export function isStale(entry, index, nowMs) {
  if (!entry || (!entry.missing && entry.version !== PARSE_VERSION)) return true;
  const age = nowMs - Date.parse(entry.fetched);
  if (index < RECENT_MONTHS) return age > DAY_MS;
  // An old month with no file (a few are missing from the archive) is checked monthly.
  return entry.missing ? age > 30 * DAY_MS : false;
}

async function readMonth(month) {
  const file = `${MONTHS}/${month}.json`;
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
}

async function main() {
  await mkdir(MONTHS, { recursive: true });
  await mkdir(args.out, { recursive: true });
  const now = Date.now();
  const months = monthList(args.from, now);
  const cached = new Map();
  for (const f of await readdir(MONTHS)) {
    if (f.endsWith('.json')) cached.set(f.slice(0, 6), await readMonth(f.slice(0, 6)));
  }
  log(`NZ: ${cached.size} months in cache`);

  const queue = months.map((m, i) => [m, i]).filter(([m, i]) => isStale(cached.get(m), i, now));
  const fuelCodes = {};
  let fetched = 0;
  let next = 0;
  const worker = async () => {
    while (next < queue.length && Date.now() < deadline) {
      const [month] = queue[next++];
      try {
        const parsed = await fetchGenerationMonth(month);
        const entry = parsed && parsed.length
          ? { fetched: new Date().toISOString(), version: PARSE_VERSION, ...parsed }
          : { fetched: new Date().toISOString(), missing: true };
        if (parsed) Object.assign(fuelCodes, parsed.fuels);
        cached.set(month, entry);
        await writeFile(`${MONTHS}/${month}.json`, JSON.stringify(entry));
        fetched++;
      } catch (err) {
        log(`NZ: ${month} failed: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Number(args.concurrency)) }, worker));
  const left = queue.length - fetched;
  log(`NZ: fetched ${fetched} months, ${left} still to fetch`);
  if (Object.keys(fuelCodes).length) log('NZ: fuel codes', JSON.stringify(fuelCodes));

  const present = [...cached.entries()].filter(([, e]) => e && !e.missing && e.length).sort(([a], [b]) => a.localeCompare(b));
  if (!present.length) {
    log('NZ: no months yet, nothing written');
    return;
  }
  const startMs = present[0][1].startMs;
  const last = present.at(-1)[1];
  const length = Math.round((last.startMs - startMs) / SLOT_MS) + last.length;
  const columns = Object.fromEntries(NZ_COLUMNS.map((c) => [c, new Float64Array(length).fill(NaN)]));
  for (const [, e] of present) {
    const base = Math.round((e.startMs - startMs) / SLOT_MS);
    for (const c of NZ_COLUMNS) {
      const src = e.columns[c] ?? [];
      for (let i = 0; i < e.length; i++) if (src[i] != null) columns[c][base + i] = src[i];
    }
  }
  const { names, missing, gz } = encodeColumns(columns, length);
  await writeFile(`${args.out}/series.bin.gz`, gz);
  const missingMonths = months.filter((m) => cached.get(m)?.missing && m >= present[0][0]).sort();
  const meta = {
    generated: new Date().toISOString(),
    region: 'nz',
    startMs,
    stepMinutes: 30,
    length,
    columns: names,
    missing,
    months: { first: present[0][0], last: present.at(-1)[0], count: present.length, missing: missingMonths, toFetch: left },
  };
  await writeFile(`${args.out}/meta.json`, JSON.stringify(meta));
  log(`NZ: wrote ${args.out}/series.bin.gz (${(gz.length / 1e6).toFixed(2)} MB, ${names.length} columns x ${length} slots,`,
    `${present[0][0]} to ${present.at(-1)[0]}, ${missingMonths.length} months missing) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
