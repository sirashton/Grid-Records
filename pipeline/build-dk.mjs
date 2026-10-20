// Builds the Denmark data files from Energinet's Energi Data Service
// (pipeline/sources/energinet.mjs), and writes site/data/dk/.
//
// One request per calendar month (UTC) for generation and one for prices.
// Parsed months are kept in the Actions cache (.cache-dk/); a run fetches
// months it has never seen, the current month every run (so the page stays
// within an hour or two of real time), the two before it daily (Energinet
// replaces its first "Initial" figures with settlement data after about 8
// days) and older months weekly until their "Final" version is due on 1 June
// of the next year. A fresh cache backfills over a few runs, newest first.
//
// Usage: node pipeline/build-dk.mjs [--budget-minutes N] [--from YYYY-MM]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { fetchGeneration, fetchPrices, DK_COLUMNS, GEN_COLUMNS, PARSE_VERSION, STEP_MINUTES } from './sources/energinet.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, stitch, monthList } from './core/chunks.mjs';
import { DAY_MS, log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    from: { type: 'string', default: '2014-12' },
    out: { type: 'string', default: 'site/data/dk' },
    cache: { type: 'string', default: '.cache-dk' },
    concurrency: { type: 'string', default: '1' },
  },
});

const COLUMNS = [...DK_COLUMNS, 'price'];
// The current month is fetched again once it is this old.
const LIVE_MS = 20 * 60000;

/** First and one-past-last ms (UTC) of a YYYYMM month. */
export function monthRange(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(4)) - 1;
  return [Date.UTC(y, m, 1), Date.UTC(y, m + 1, 1)];
}

/**
 * Whether a cached month should be fetched again. index 0 is the current
 * month. Months before a year's Final version (1 June the next year) are
 * checked weekly; after that they stand.
 */
export function isStale(entry, ym, index, nowMs) {
  if (!entry || entry.version !== PARSE_VERSION) return true;
  const fetched = Date.parse(entry.fetched);
  const age = nowMs - fetched;
  if (index === 0) return age > LIVE_MS;
  if (index <= 2) return age > DAY_MS;
  const finalDue = Date.UTC(Number(ym.slice(0, 4)) + 1, 5, 2);
  if (fetched >= finalDue) return false;
  return nowMs >= finalDue || age > 7 * DAY_MS;
}

/**
 * Lays months of generation and prices onto one hourly grid, ending at the
 * last hour with generation (prices are published a day ahead). A month of
 * generation with no data at all is left out.
 */
export function mergeDenmark(gen, prices) {
  const merged = stitch([...gen, ...prices], { stepMinutes: STEP_MINUTES, columns: COLUMNS });
  if (!merged) return null;
  let end = merged.length;
  while (end > 0 && GEN_COLUMNS.every((c) => Number.isNaN(merged.columns[c][end - 1]))) end--;
  // And starting at the first hour with generation (Elspotprices goes back further).
  let start = 0;
  while (start < end && GEN_COLUMNS.every((c) => Number.isNaN(merged.columns[c][start]))) start++;
  if (start >= end) return null;
  for (const c of COLUMNS) merged.columns[c] = merged.columns[c].subarray(start, end);
  return { startMs: merged.startMs + start * STEP_MINUTES * 60000, length: end - start, columns: merged.columns };
}

async function loadDir(dir) {
  await mkdir(dir, { recursive: true });
  const out = new Map();
  for (const f of await readdir(dir)) {
    if (f.endsWith('.json')) out.set(f.slice(0, 6), JSON.parse(await readFile(`${dir}/${f}`, 'utf8')));
  }
  return out;
}

async function main() {
  const started = Date.now();
  const deadline = started + Number(args['budget-minutes']) * 60000;
  await mkdir(args.out, { recursive: true });
  const now = Date.now();
  const months = monthList(args.from, now);
  const kinds = {
    gen: { dir: `${args.cache}/gen`, fetch: fetchGeneration },
    price: { dir: `${args.cache}/price`, fetch: fetchPrices },
  };
  const cached = {};
  for (const [k, v] of Object.entries(kinds)) cached[k] = await loadDir(v.dir);
  log(`DK: ${cached.gen.size} generation and ${cached.price.size} price months in cache`);

  // Newest first, generation before prices for each month.
  const queue = [];
  months.forEach((ym, index) => {
    for (const kind of Object.keys(kinds)) if (isStale(cached[kind].get(ym), ym, index, now)) queue.push({ kind, ym, name: `${kind} ${ym}` });
  });
  let refused = false;
  const { done, left } = await runQueue(queue, async ({ kind, ym }) => {
    const [s, e] = monthRange(ym);
    try {
      const piece = await kinds[kind].fetch(s, e);
      const entry = { fetched: new Date().toISOString(), version: PARSE_VERSION, ...piece };
      cached[kind].set(ym, entry);
      await writeFile(`${kinds[kind].dir}/${ym}.json`, JSON.stringify(entry));
    } catch (err) {
      if (/HTTP (403|429)/.test(err.message)) refused = true;
      throw err;
    }
    // Energi Data Service turns away quick bursts (HTTP 429), so one at a time with a pause.
    await new Promise((r) => setTimeout(r, 1500));
  }, { concurrency: Number(args.concurrency), deadline, stop: () => refused, log: (m) => log(`DK: ${m}`) });
  log(`DK: fetched ${done} months, ${left} still to fetch${refused ? ' (stopped: the service refused a request)' : ''}`);

  const keep = new Set(months);
  const pick = (kind) => [...cached[kind].entries()].filter(([ym]) => keep.has(ym)).map(([, e]) => e);
  const merged = mergeDenmark(pick('gen'), pick('price'));
  if (!merged) {
    log('DK: no data yet, nothing written');
    return;
  }
  const have = [...cached.gen.keys()].filter((ym) => keep.has(ym)).sort();
  const { meta, bytes } = await writeDataset(args.out, {
    region: 'dk',
    timeZone: 'Europe/Copenhagen',
    stepMinutes: STEP_MINUTES,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { months: { first: have[0], last: have.at(-1), count: have.length, toFetch: left }, units: { price: 'EUR/MWh' } },
  }, { log });
  const last = new Date(merged.startMs + merged.length * 3600000).toISOString();
  log(`DK: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${meta.columns.length} columns x ${merged.length} hours, data to ${last}) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
