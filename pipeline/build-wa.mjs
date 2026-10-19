// Builds the Western Australia data files from AEMO's WEM public data
// (pipeline/sources/aemo-wa.mjs) and writes site/data/wa/.
//
// The facility history is about 1.2 GB of monthly half-hourly files to
// September 2023 and 1 GB of 5-minute files since, from a slow server, so
// each parsed file is kept in the Actions cache (.cache-wa/) with the date
// and size its directory listing showed. A run fetches files it has never
// seen or that AEMO has rewritten (the current month's, each morning),
// newest first, within a time budget. A fresh cache backfills over a few runs.
//
// Everything is half-hourly: the 5-minute data is averaged, as for the NEM.
//
// Usage: node pipeline/build-wa.mjs [--budget-minutes N] [--concurrency N]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  DATASETS, GEN_COLUMNS, WA_TZ, PARSE_VERSION, OLD_SCADA_END, SLOT_MS, listFiles, parseScada, parseSeries,
} from './sources/aemo-wa.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, stitch } from './core/chunks.mjs';
import { fetchText, log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    out: { type: 'string', default: 'site/data/wa' },
    cache: { type: 'string', default: '.cache-wa' },
    concurrency: { type: 'string', default: '4' },
  },
});

const started = Date.now();
const deadline = started + Number(args['budget-minutes']) * 60000;

const PARSERS = {
  scadaOld: (text) => parseScada(text, { fiveMinute: false }),
  scada: (text) => parseScada(text, { fiveMinute: true }),
  rooftopOld: (text) => parseSeries(text, 'solar_rooftop'),
  rooftop: (text) => parseSeries(text, 'solar_rooftop'),
  demandOld: (text) => parseSeries(text, 'demand'),
  demand: (text) => parseSeries(text, 'demand'),
};

/** Whether a cached file is current: same listing stamp and parser version. */
export const isCurrent = (entry, file) => Boolean(entry && entry.etag === file.etag && entry.version === PARSE_VERSION);

/** Pieces of one series on its own grid, the newer source winning where both have a value. */
function preferNewer(older, newer, names) {
  const a = stitch(older, { stepMinutes: 30, columns: names });
  const b = stitch(newer, { stepMinutes: 30, columns: names });
  if (!a || !b) return a ?? b;
  return stitch([a, b].map((p) => ({ ...p, columns: Object.fromEntries(names.map((c) => [c, [...p.columns[c]].map((v) => (Number.isNaN(v) ? null : v))])) })), { stepMinutes: 30, columns: names });
}

/**
 * Lays every dataset onto one half-hourly grid that runs from the first to
 * the last half hour with facility data. Pieces: { kind, ...piece } where
 * kind is a DATASETS key. Rooftop solar before AEMO's first estimate is
 * missing, not zero.
 */
export function mergeWa(pieces) {
  const of = (k) => pieces.filter((p) => p.kind === k);
  // stitch() lays later pieces over earlier ones, so the 5-minute months win any overlap.
  const gen = stitch([...of('scadaOld'), ...of('scada')], { stepMinutes: 30, columns: GEN_COLUMNS });
  if (!gen) return null;
  let end = gen.length;
  while (end > 0 && GEN_COLUMNS.every((c) => Number.isNaN(gen.columns[c][end - 1]))) end--;
  let start = 0;
  while (start < end && GEN_COLUMNS.every((c) => Number.isNaN(gen.columns[c][start]))) start++;
  const startMs = gen.startMs + start * SLOT_MS;
  const length = end - start;
  const columns = {};
  for (const c of GEN_COLUMNS) columns[c] = gen.columns[c].slice(start, end);
  const lay = (series, name) => {
    const col = new Float64Array(length).fill(NaN);
    if (series) {
      const off = Math.round((series.startMs - startMs) / SLOT_MS);
      for (let i = 0; i < series.length; i++) {
        const j = off + i;
        if (j >= 0 && j < length) col[j] = series.columns[name][i];
      }
    }
    columns[name] = col;
  };
  lay(preferNewer(of('rooftopOld'), of('rooftop'), ['solar_rooftop']), 'solar_rooftop');
  lay(preferNewer(of('demandOld'), of('demand'), ['demand']), 'demand');
  return { startMs, length, columns };
}

async function main() {
  await mkdir(args.out, { recursive: true });
  const files = [];
  for (const [kind, ds] of Object.entries(DATASETS)) {
    await mkdir(`${args.cache}/${kind}`, { recursive: true });
    let listed = await listFiles(ds);
    if (kind === 'scadaOld') listed = listed.filter((f) => `${f.year}-${String(f.month).padStart(2, '0')}` <= OLD_SCADA_END);
    log(`WA: ${kind}: ${listed.length} files listed`);
    for (const f of listed) files.push({ ...f, kind });
  }

  const cached = new Map();
  for (const kind of Object.keys(DATASETS)) {
    for (const f of await readdir(`${args.cache}/${kind}`)) {
      if (f.endsWith('.json')) cached.set(`${kind}/${f}`, JSON.parse(await readFile(`${args.cache}/${kind}/${f}`, 'utf8')));
    }
  }
  const key = (f) => `${f.kind}/${f.name.replace(/\.csv$/, '.json')}`;
  log(`WA: ${cached.size} files in cache`);

  // Newest first, so a short run still brings the page up to date; the small
  // rooftop and demand files go first within a month.
  const stamp = (f) => f.year * 100 + (f.month ?? 12);
  const queue = files.filter((f) => !isCurrent(cached.get(key(f)), f)).sort((a, b) => stamp(b) - stamp(a) || a.size - b.size);
  const unknown = new Set();
  const { done, left } = await runQueue(queue, async (f) => {
    const t = Date.now();
    const text = await fetchText(f.url, { timeoutMs: 600000 });
    if (text == null) throw new Error('not found');
    const piece = PARSERS[f.kind](text);
    for (const u of piece.unknown ?? []) unknown.add(u);
    delete piece.unknown;
    const entry = { etag: f.etag, version: PARSE_VERSION, fetched: new Date().toISOString(), ...piece };
    cached.set(key(f), entry);
    await writeFile(`${args.cache}/${key(f)}`, JSON.stringify(entry));
    log(`WA: ${f.kind} ${f.name} (${(f.size / 1e6).toFixed(0)} MB) in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }, { concurrency: Number(args.concurrency), deadline, log: (m) => log(`WA: ${m}`) });
  log(`WA: fetched ${done} files, ${left} still to fetch`);
  if (unknown.size) log(`WA: facilities with no fuel, counted as other: ${[...unknown].join(', ')}`);

  // Only files still listed count.
  const listedKeys = new Set(files.map(key));
  const pieces = [...cached.entries()].filter(([k]) => listedKeys.has(k)).map(([k, e]) => ({ ...e, kind: k.split('/')[0] }));
  const merged = mergeWa(pieces);
  if (!merged) {
    log('WA: no data yet, nothing written');
    return;
  }
  const scada = files.filter((f) => DATASETS[f.kind].kind === 'generation');
  const { meta, bytes } = await writeDataset(args.out, {
    region: 'wa',
    timeZone: WA_TZ,
    stepMinutes: 30,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { files: { facility: scada.filter((f) => isCurrent(cached.get(key(f)), f)).length, facilityListed: scada.length, toFetch: left } },
  }, { log });
  log(`WA: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${meta.columns.length} columns x ${merged.length} half hours)`,
    `in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
