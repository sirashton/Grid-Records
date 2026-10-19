// Builds the Australian (NEM) data files from AEMO's monthly MMS archive and
// writes site/data/au/<region>/ for the whole market and each state.
//
// Each month is a few hundred MB of unit output, so each parsed month is kept
// in the Actions cache (.cache-au/). A run fetches months it has never seen,
// newest first, within a time budget, and checks the latest month once a day
// until AEMO publishes the next one.
//
// Usage: node pipeline/build-au.mjs [--budget-minutes N] [--from YYYY-MM] [--concurrency N]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fetchMonth, fetchRegistryTables, AU_COLUMNS, AU_FUELS, REGIONS, PARSE_VERSION } from './sources/aemo-mms.mjs';
import { encodeColumns } from './encode.mjs';
import { SLOT_MS, DAY_MS, log } from './lib.mjs';
import { monthList } from './build-nz.mjs';

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
// AEMO posts each month two to six weeks after it ends, so the latest few
// months are checked once a day; older ones are kept for good.
const RECENT_MONTHS = 3;

export const REGION_FILES = { nem: null, nsw: 'NSW1', qld: 'QLD1', vic: 'VIC1', sa: 'SA1', tas: 'TAS1' };

/** Whether a cached month (or a cached "not published yet") should be fetched again. */
export function isStale(entry, index, nowMs) {
  if (!entry || (!entry.missing && entry.version !== PARSE_VERSION)) return true;
  const age = nowMs - Date.parse(entry.fetched);
  if (index < RECENT_MONTHS) return age > (entry.missing ? DAY_MS / 4 : 7 * DAY_MS);
  return entry.missing ? age > 30 * DAY_MS : false;
}

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

  const queue = months.map((m, i) => [m, i]).filter(([m, i]) => isStale(cached.get(m), i, now));
  // The newest month's registration tables, for units older months don't give a fuel for.
  let latest = null;
  if (queue.length) {
    for (const m of months.slice(0, RECENT_MONTHS + 1)) {
      latest = await fetchRegistryTables(m).catch((err) => log(`AU: registry ${m} failed: ${err.message}`));
      if (latest) { log(`AU: registration tables from ${m}`); break; }
    }
  }
  let fetched = 0;
  let next = 0;
  const worker = async () => {
    while (next < queue.length && Date.now() < deadline) {
      const [month] = queue[next++];
      const t0 = Date.now();
      try {
        const parsed = await fetchMonth(month, { log, latest });
        const entry = parsed
          ? { fetched: new Date().toISOString(), version: PARSE_VERSION, ...parsed }
          : { fetched: new Date().toISOString(), missing: true };
        cached.set(month, entry);
        await writeFile(`${MONTHS}/${month}.json`, JSON.stringify(entry));
        fetched++;
        log(`AU: ${month} ${parsed ? 'parsed' : 'not published'} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      } catch (err) {
        log(`AU: ${month} failed: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Number(args.concurrency)) }, worker));
  const left = queue.length - fetched;
  log(`AU: fetched ${fetched} months, ${left} still to fetch`);

  const present = [...cached.entries()].filter(([, e]) => e && !e.missing && e.length).sort(([a], [b]) => a.localeCompare(b));
  if (!present.length) {
    log('AU: no months yet, nothing written');
    return;
  }
  const startMs = present[0][1].startMs;
  const last = present.at(-1)[1];
  const length = Math.round((last.startMs - startMs) / SLOT_MS) + last.length;
  const regionCols = Object.fromEntries(REGIONS.map((r) => [r, Object.fromEntries(AU_COLUMNS.map((c) => [c, new Float64Array(length).fill(NaN)]))]));
  for (const [, e] of present) {
    const base = Math.round((e.startMs - startMs) / SLOT_MS);
    for (const r of REGIONS) {
      for (const c of AU_COLUMNS) {
        const src = e.regions[r]?.[c] ?? [];
        for (let i = 0; i < e.length; i++) if (src[i] != null) regionCols[r][c][base + i] = src[i];
      }
    }
  }
  const missingMonths = months.filter((m) => cached.get(m)?.missing && m >= present[0][0] && m <= present.at(-1)[0]).sort();
  for (const [name, region] of Object.entries(REGION_FILES)) {
    const cols = region ? regionCols[region] : nemColumns(regionCols, length);
    const { names, missing, gz } = encodeColumns(cols, length);
    const dir = `${args.out}/${name}`;
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}/series.bin.gz`, gz);
    const meta = {
      generated: new Date().toISOString(),
      region: name,
      startMs,
      stepMinutes: 30,
      length,
      columns: names,
      missing,
      months: { first: present[0][0], last: present.at(-1)[0], count: present.length, missing: missingMonths, toFetch: left },
    };
    await writeFile(`${dir}/meta.json`, JSON.stringify(meta));
    log(`AU: wrote ${dir} (${(gz.length / 1e6).toFixed(2)} MB)`);
  }
  log(`AU: ${present[0][0]} to ${present.at(-1)[0]}, ${length} slots, in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
