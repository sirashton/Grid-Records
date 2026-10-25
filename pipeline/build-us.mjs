// Builds the United States (lower 48) data files from EIA-930's six-month
// balancing authority files (pipeline/sources/eia930.mjs) and writes
// site/data/us/.
//
// One download per half-year, from July 2018. Each parsed half-year is kept
// in the Actions cache (.cache-us/). The current half-year is fetched again
// every run and the one before it once a day, as EIA revises recent data.
//
// Usage: node pipeline/build-us.mjs [--budget-minutes N] [--from 2018H2]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { US_COLUMNS, PARSE_VERSION, halfList, fetchHalf, parseHalf, addHalves } from './sources/eia930.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, isStale } from './core/chunks.mjs';
import { lastFilled } from './core/recent.mjs';
import { log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    from: { type: 'string', default: '2018H2' },
    out: { type: 'string', default: 'site/data/us' },
    cache: { type: 'string', default: '.cache-us' },
    concurrency: { type: 'string', default: '2' },
  },
});

const RUN_MS = 20 * 60000;
// An hour counts only when balancing authorities with at least this share of
// the half-year's most-reporting hour sent a net generation figure; the
// latest hours fill in as they report.
export const MIN_REPORTING = 0.97;
// PJM's fuel mix starts on 19 September 2018, so the national total is only
// whole from then; the page starts at the next month (midnight Eastern).
export const START_MS = Date.UTC(2018, 9, 1, 4);

/** Whether half-year `index` (0 = current) should be fetched again. */
export function needsFetch(entry, index, nowMs) {
  if (index === 0 && entry && entry.version === PARSE_VERSION) return nowMs - Date.parse(entry.fetched) > RUN_MS;
  return isStale(entry, index, nowMs, { version: PARSE_VERSION, recent: 2 });
}

/** Adds the half-years together and ends the grid at the last hour with generation. */
export function mergeUS(pieces) {
  const merged = addHalves(pieces, MIN_REPORTING);
  if (!merged) return null;
  const end = lastFilled(merged, ['gas', 'coal', 'nuclear']);
  const from = Math.max(0, Math.round((START_MS - merged.startMs) / 3600000));
  for (const c of US_COLUMNS) merged.columns[c] = merged.columns[c].subarray(from, end);
  return { ...merged, startMs: merged.startMs + from * 3600000, length: end - from };
}

/** The largest hour-to-hour changes, for checking the data: lines of text. */
export function bigSteps(merged, limit = 25000) {
  const out = [];
  for (const c of US_COLUMNS) {
    const col = merged.columns[c];
    let prev = NaN;
    for (let i = 0; i < merged.length; i++) {
      if (Number.isNaN(col[i])) continue;
      if (Math.abs(col[i] - prev) > limit && out.length < 40) {
        const at = new Date(merged.startMs + i * 3600000).toISOString().slice(0, 13);
        out.push(`step ${c} ${at}Z ${Math.round(prev)} -> ${Math.round(col[i])} (then ${Math.round(col[i + 1])}, ${Math.round(col[i + 2])})`);
      }
      prev = col[i];
    }
  }
  return out;
}

async function main() {
  const started = Date.now();
  const deadline = started + Number(args['budget-minutes']) * 60000;
  await mkdir(args.out, { recursive: true });
  await mkdir(args.cache, { recursive: true });
  const now = Date.now();

  const cached = new Map();
  for (const f of await readdir(args.cache)) {
    if (/^\d{4}H[12]\.json$/.test(f)) cached.set(f.slice(0, 6), JSON.parse(await readFile(`${args.cache}/${f}`, 'utf8')));
  }
  const halves = halfList(now, args.from);
  const queue = halves.filter((k, i) => needsFetch(cached.get(k), i, now));
  log(`US: ${cached.size} half-years cached, ${queue.length} to fetch`);

  const { done, left } = await runQueue(queue, async (key) => {
    const t = Date.now();
    const text = await fetchHalf(key);
    let entry;
    if (text) {
      const p = parseHalf(key, text);
      entry = { version: PARSE_VERSION, fetched: new Date().toISOString(), ...p };
      log(`US: ${key}: ${p.hours} hours from ${p.bas} balancing authorities, ${p.spikes} spikes smoothed, fuels ${p.fuels.join(' ')}, in ${((Date.now() - t) / 1000).toFixed(0)} s`);
    } else {
      entry = { version: PARSE_VERSION, fetched: new Date().toISOString(), missing: true };
      log(`US: ${key}: no file`);
    }
    cached.set(key, entry);
    await writeFile(`${args.cache}/${key}.json`, JSON.stringify(entry));
  }, { concurrency: Number(args.concurrency), deadline, log: (m) => log(`US: ${m}`) });
  log(`US: fetched ${done} half-years, ${left} still to fetch`);

  const merged = mergeUS(halves.map((k) => cached.get(k)).filter((e) => e && !e.missing));
  if (!merged) {
    log('US: no data yet, nothing written');
    return;
  }
  log(`US: ${merged.dropped} hours dropped as too few balancing authorities reported`);
  for (const line of bigSteps(merged)) log(`US: ${line}`);
  const have = halves.filter((k) => cached.get(k)?.version === PARSE_VERSION).length;
  const { meta, bytes } = await writeDataset(args.out, {
    region: 'us',
    timeZone: 'America/New_York',
    stepMinutes: 60,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { halves: { fetched: have, listed: halves.length, toFetch: left } },
  }, { log });
  log(`US: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${meta.columns.length} columns x ${merged.length} hours)`,
    `in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
