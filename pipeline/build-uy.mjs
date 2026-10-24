// Builds the Uruguay data files from ADME's generation by source
// (pipeline/sources/adme.mjs) and writes site/data/uy/.
//
// One request per month. ADME builds each month's spreadsheet on request,
// which takes its server about half a minute, so requests run two at a time
// and each parsed month is kept in the Actions cache (.cache-uy/): a fresh
// cache backfills over a few runs, newest first. The current month is fetched
// again every run and the three before it once a day, as SCADA values are
// revised.
//
// Usage: node pipeline/build-uy.mjs [--budget-minutes N] [--from YYYY-MM] [--concurrency N]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { UY_COLUMNS, GEN_COLUMNS, PARSE_VERSION, fetchMonth, parseMonth } from './sources/adme.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, monthList, isStale, stitch } from './core/chunks.mjs';
import { lastFilled } from './core/recent.mjs';
import { log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    from: { type: 'string', default: '2018-01' },
    out: { type: 'string', default: 'site/data/uy' },
    cache: { type: 'string', default: '.cache-uy' },
    concurrency: { type: 'string', default: '2' },
  },
});

const started = Date.now();
const deadline = started + Number(args['budget-minutes']) * 60000;
const RUN_MS = 20 * 60000;

/** Whether month `index` (0 = current) should be fetched again. */
export function needsFetch(entry, index, nowMs) {
  if (index === 0 && entry) return nowMs - Date.parse(entry.fetched) > RUN_MS;
  return isStale(entry, index, nowMs, { version: PARSE_VERSION, recent: 4 });
}

/** Stitches the months and ends the grid at the last hour with generation. */
export function mergeUruguay(pieces) {
  const merged = stitch(pieces, { stepMinutes: 60, columns: UY_COLUMNS });
  if (!merged) return null;
  const end = lastFilled(merged, GEN_COLUMNS);
  for (const c of UY_COLUMNS) merged.columns[c] = merged.columns[c].subarray(0, end);
  return { ...merged, length: end };
}

async function main() {
  await mkdir(args.out, { recursive: true });
  await mkdir(args.cache, { recursive: true });
  const now = Date.now();

  const cached = new Map();
  for (const f of await readdir(args.cache)) {
    if (/^\d{6}\.json$/.test(f)) cached.set(f.slice(0, 6), JSON.parse(await readFile(`${args.cache}/${f}`, 'utf8')));
  }
  const months = monthList(args.from, now);
  const queue = months.filter((ym, i) => needsFetch(cached.get(ym), i, now));
  log(`UY: ${cached.size} months cached, ${queue.length} to fetch`);

  const { done, left } = await runQueue(queue, async (ym) => {
    const t = Date.now();
    const rows = await fetchMonth(ym);
    const entry = rows
      ? { version: PARSE_VERSION, fetched: new Date().toISOString(), ...parseMonth(ym, rows) }
      : { version: PARSE_VERSION, fetched: new Date().toISOString(), missing: true };
    cached.set(ym, entry);
    await writeFile(`${args.cache}/${ym}.json`, JSON.stringify(entry));
    log(`UY: ${ym}: ${rows ? `${entry.hours} hours` : 'no data'} in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }, { concurrency: Number(args.concurrency), deadline, log: (m) => log(`UY: ${m}`) });
  log(`UY: fetched ${done} months, ${left} still to fetch`);

  const merged = mergeUruguay(months.map((ym) => cached.get(ym)).filter((e) => e && !e.missing));
  if (!merged) {
    log('UY: no data yet, nothing written');
    return;
  }
  const have = months.filter((ym) => cached.get(ym)?.version === PARSE_VERSION).length;
  const { meta, bytes } = await writeDataset(args.out, {
    region: 'uy',
    timeZone: 'America/Montevideo',
    stepMinutes: 60,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { months: { fetched: have, listed: months.length, toFetch: left } },
  }, { log });
  log(`UY: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${meta.columns.length} columns x ${merged.length} hours)`,
    `in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
