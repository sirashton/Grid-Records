// Builds the Australian (NEM) data files from AEMO's monthly MMS archive and
// writes site/data/au/<area>/ for the whole market and each state.
//
// Each month is a few hundred MB of unit output, so each parsed month is kept
// in the Actions cache (.cache-au/). A run fetches months it has never seen,
// newest first, within a time budget, and checks the latest months once a
// day until AEMO publishes the next one.
//
// AEMO's unit data is 5-minute, but rooftop solar and the archive's prices
// are half-hourly, so the files are half-hourly too: six times smaller, and
// spells are counted in half hours like the GB and NZ pages.
//
// Usage: node pipeline/build-au.mjs [--budget-minutes N] [--from YYYY-MM] [--concurrency N]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchMonth, fetchRegistryTables, AU_COLUMNS, AU_FUELS, REGIONS, PARSE_VERSION } from './sources/aemo-mms.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, stitch, monthList, isStale as isStaleEntry } from './core/chunks.mjs';
import { log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    // Months before 2015 are only in whole-market zips of about 2 GB each.
    from: { type: 'string', default: '2015-01' },
    out: { type: 'string', default: 'site/data/au' },
    cache: { type: 'string', default: '.cache-au' },
    concurrency: { type: 'string', default: '3' },
  },
});

const started = Date.now();
const deadline = started + Number(args['budget-minutes']) * 60000;
const MONTHS = `${args.cache}/months`;
// AEMO posts each month two to six weeks after it ends, and rarely revises it.
const RECENT_MONTHS = 2;

// The whole market, then each state's file, by AEMO region.
export const AREAS = { nem: null, nsw: 'NSW1', qld: 'QLD1', vic: 'VIC1', sa: 'SA1', tas: 'TAS1' };

// Cached months keep AEMO-flavoured names; the files use the shared names
// (docs/adding-a-country.md), with charging as negative MW.
export const OUTPUT = {
  black_coal: 'coal', brown_coal: 'lignite', gas: 'gas', liquid: 'oil', hydro: 'hydro', wind: 'wind',
  solar: 'solar_utility', rooftop: 'solar_rooftop', bioenergy: 'biomass', other: 'other',
  battery: 'battery', battery_charge: 'battery_charge', pumping: 'pumped_storage_charge', demand: 'demand', price: 'price',
};
const NEGATED = new Set(['battery_charge', 'pumping']);

/** Whether a cached month (or a cached "not published yet") should be fetched again. */
export const isStale = (entry, index, nowMs) => isStaleEntry(entry, index, nowMs, { version: PARSE_VERSION, recent: RECENT_MONTHS });

/** The whole market: regions summed, with price weighted by each region's demand. */
export function nemColumns(regionCols, length) {
  const out = Object.fromEntries(AU_COLUMNS.map((c) => [c, new Float64Array(length).fill(NaN)]));
  for (let i = 0; i < length; i++) {
    for (const c of [...AU_FUELS, 'demand']) {
      let s = 0;
      let ok = true;
      for (const r of REGIONS) {
        const v = regionCols[r][c][i];
        if (Number.isNaN(v)) { ok = false; break; }
        s += v;
      }
      if (ok) out[c][i] = s;
    }
    let pw = 0;
    let w = 0;
    for (const r of REGIONS) {
      const p = regionCols[r].price[i];
      const d = regionCols[r].demand[i];
      if (Number.isNaN(p) || Number.isNaN(d)) { w = NaN; break; }
      if (d > 0) { pw += p * d; w += d; }
    }
    if (w > 0) out.price[i] = pw / w;
  }
  return out;
}

/** Renames cached columns to the shared names, charging as negative MW. */
export function outputColumns(cols) {
  return Object.fromEntries(Object.entries(OUTPUT).map(([from, to]) => [to, NEGATED.has(from) ? cols[from].map((v) => (v ? -v : v)) : cols[from]]));
}

async function readMonth(month) {
  const file = `${MONTHS}/${month}.json`;
  return existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : null;
}

async function main() {
  await mkdir(MONTHS, { recursive: true });
  const now = Date.now();
  const months = monthList(args.from, now);
  const cached = new Map();
  for (const f of await readdir(MONTHS)) {
    if (f.endsWith('.json')) cached.set(f.slice(0, 6), await readMonth(f.slice(0, 6)));
  }
  log(`AU: ${cached.size} months in cache`);

  const queue = months.map((m, i) => [m, i]).filter(([m, i]) => isStale(cached.get(m), i, now)).map(([m]) => m);
  // The newest month's registration tables, for units older months don't give a fuel for.
  let latest = null;
  if (queue.length) {
    for (const m of months.slice(0, 4)) {
      latest = await fetchRegistryTables(m).catch((err) => log(`AU: registry ${m} failed: ${err.message}`));
      if (latest) { log(`AU: registration tables from ${m}`); break; }
    }
  }
  const { done: fetched, left } = await runQueue(queue, async (month) => {
    const t0 = Date.now();
    const parsed = await fetchMonth(month, { log, latest });
    const entry = parsed
      ? { fetched: new Date().toISOString(), version: PARSE_VERSION, ...parsed }
      : { fetched: new Date().toISOString(), missing: true };
    cached.set(month, entry);
    await writeFile(`${MONTHS}/${month}.json`, JSON.stringify(entry));
    log(`AU: ${month} ${parsed ? 'parsed' : 'not published yet'} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }, { concurrency: Number(args.concurrency), deadline, log });
  log(`AU: fetched ${fetched} months, ${left} still to fetch`);

  const present = [...cached.entries()].filter(([, e]) => e && !e.missing && e.length).sort(([a], [b]) => a.localeCompare(b));
  if (!present.length) {
    log('AU: no months yet, nothing written');
    return;
  }
  const regionCols = {};
  let grid;
  for (const r of REGIONS) {
    grid = stitch(present.map(([, e]) => ({ startMs: e.startMs, length: e.length, columns: e.regions[r] })), { stepMinutes: 30, columns: AU_COLUMNS });
    regionCols[r] = grid.columns;
  }
  const { startMs, length } = grid;
  const missingMonths = months.filter((m) => cached.get(m)?.missing && m >= present[0][0] && m <= present.at(-1)[0]).sort();
  for (const [area, region] of Object.entries(AREAS)) {
    const cols = region ? regionCols[region] : nemColumns(regionCols, length);
    const { bytes } = await writeDataset(`${args.out}/${area}`, {
      region: 'au',
      timeZone: 'Australia/Brisbane',
      stepMinutes: 30,
      startMs,
      length,
      columns: outputColumns(cols),
      extra: { area, months: { first: present[0][0], last: present.at(-1)[0], count: present.length, missing: missingMonths, toFetch: left } },
    }, { log });
    log(`AU: wrote ${args.out}/${area} (${(bytes / 1e6).toFixed(2)} MB)`);
  }
  log(`AU: ${present[0][0]} to ${present.at(-1)[0]}, ${length} slots, in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
