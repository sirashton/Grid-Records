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
import { writeDataset } from './core/dataset.mjs';
import { runQueue, stitch, monthList, isStale as isStaleEntry } from './core/chunks.mjs';
import { log } from './lib.mjs';

export { monthList };

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

/** Whether a cached month (or a cached "no file yet") should be fetched again. */
export const isStale = (entry, index, nowMs) => isStaleEntry(entry, index, nowMs, { version: PARSE_VERSION, recent: RECENT_MONTHS });

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

  const queue = months.map((m, i) => [m, i]).filter(([m, i]) => isStale(cached.get(m), i, now)).map(([m]) => m);
  const fuelCodes = {};
  const { done: fetched, left } = await runQueue(queue, async (month) => {
    const parsed = await fetchGenerationMonth(month);
    const entry = parsed && parsed.length
      ? { fetched: new Date().toISOString(), version: PARSE_VERSION, ...parsed }
      : { fetched: new Date().toISOString(), missing: true };
    if (parsed) Object.assign(fuelCodes, parsed.fuels);
    cached.set(month, entry);
    await writeFile(`${MONTHS}/${month}.json`, JSON.stringify(entry));
  }, { concurrency: Number(args.concurrency), deadline, log: (m) => log(`NZ: ${m}`) });
  log(`NZ: fetched ${fetched} months, ${left} still to fetch`);
  if (Object.keys(fuelCodes).length) log('NZ: fuel codes', JSON.stringify(fuelCodes));

  const present = [...cached.entries()].filter(([, e]) => e && !e.missing && e.length).sort(([a], [b]) => a.localeCompare(b));
  if (!present.length) {
    log('NZ: no months yet, nothing written');
    return;
  }
  const { startMs, length, columns } = stitch(present.map(([, e]) => e), { stepMinutes: 30, columns: NZ_COLUMNS });
  const missingMonths = months.filter((m) => cached.get(m)?.missing && m >= present[0][0]).sort();
  const { meta, bytes } = await writeDataset(args.out, {
    region: 'nz',
    timeZone: 'Pacific/Auckland',
    stepMinutes: 30,
    startMs,
    length,
    columns,
    extra: { months: { first: present[0][0], last: present.at(-1)[0], count: present.length, missing: missingMonths, toFetch: left } },
  }, { log });
  log(`NZ: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${meta.columns.length} columns x ${length} slots,`,
    `${present[0][0]} to ${present.at(-1)[0]}, ${missingMonths.length} months missing) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
