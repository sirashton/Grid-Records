// Builds the Brazil data files from ONS open data (pipeline/sources/ons.mjs),
// and writes site/data/br/.
//
// The generation history is about 11 GB of CSV (one file per year to 2021,
// per month since), so each parsed file is kept in the Actions cache
// (.cache-br/) under its S3 ETag. A run lists the bucket, fetches files it
// has never seen or that ONS has replaced, newest first, within a time
// budget, and stitches everything onto one hourly UTC grid. A fresh cache
// backfills over a few runs.
//
// Usage: node pipeline/build-br.mjs [--budget-minutes N] [--from YYYY] [--concurrency N]
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  DATASETS, BR_COLUMNS, GEN_COLUMNS, PARSE_VERSION, listFiles, fetchChunks,
  parseGeneration, parseBalance, parseCurtailment,
} from './sources/ons.mjs';
import { writeDataset } from './core/dataset.mjs';
import { runQueue, stitch } from './core/chunks.mjs';
import { log } from './lib.mjs';

const { values: args } = parseArgs({
  options: {
    'budget-minutes': { type: 'string', default: '3' },
    from: { type: 'string', default: '2000' },
    out: { type: 'string', default: 'site/data/br' },
    cache: { type: 'string', default: '.cache-br' },
    concurrency: { type: 'string', default: '3' },
  },
});

const started = Date.now();
const deadline = started + Number(args['budget-minutes']) * 60000;

const PARSERS = {
  generation: (chunks, f) => parseGeneration(chunks, f.year, f.month),
  balance: (chunks, f) => parseBalance(chunks, f.year),
  windCurtailment: (chunks, f) => parseCurtailment(chunks, f.year, f.month, 'wind_curtailed'),
  solarCurtailment: (chunks, f) => parseCurtailment(chunks, f.year, f.month, 'solar_curtailed'),
};

const cachePath = (kind, name) => `${args.cache}/${kind}/${name.replace(/\.csv$/, '.json')}`;

/** Whether a cached file is current: same ETag and parser version. */
export const isCurrent = (entry, file) => Boolean(entry && entry.etag === file.etag && entry.version === PARSE_VERSION);

/**
 * Puts the pieces of every dataset on one grid, ending at the last hour with
 * generation. Rooftop solar counts from ONS's first estimate, not as zero
 * before it.
 */
export function mergeBrazil(pieces) {
  const merged = stitch(pieces, { stepMinutes: 60, columns: BR_COLUMNS });
  if (!merged) return null;
  let end = merged.length;
  while (end > 0 && GEN_COLUMNS.every((c) => Number.isNaN(merged.columns[c][end - 1]))) end--;
  const roof = merged.columns.solar_rooftop;
  const first = roof.findIndex((v) => v > 0);
  for (let i = 0; i < (first < 0 ? end : first); i++) roof[i] = NaN;
  for (const c of BR_COLUMNS) merged.columns[c] = merged.columns[c].subarray(0, end);
  return { ...merged, length: end };
}

async function main() {
  await mkdir(args.out, { recursive: true });
  const from = Number(args.from);
  const files = [];
  for (const [kind, ds] of Object.entries(DATASETS)) {
    await mkdir(`${args.cache}/${kind}`, { recursive: true });
    const listed = (await listFiles(ds)).filter((f) => f.year >= from);
    log(`BR: ${kind}: ${listed.length} files listed`);
    for (const f of listed) files.push({ ...f, kind });
  }

  const cached = new Map();
  for (const kind of Object.keys(DATASETS)) {
    for (const f of await readdir(`${args.cache}/${kind}`)) {
      if (f.endsWith('.json')) cached.set(`${kind}/${f}`, JSON.parse(await readFile(`${args.cache}/${kind}/${f}`, 'utf8')));
    }
  }
  const key = (f) => `${f.kind}/${f.name.replace(/\.csv$/, '.json')}`;
  log(`BR: ${cached.size} files in cache`);

  // Newest first, so a short run still brings the page up to date.
  const stamp = (f) => f.year * 100 + (f.month ?? 12);
  const queue = files.filter((f) => !isCurrent(cached.get(key(f)), f)).sort((a, b) => stamp(b) - stamp(a) || a.size - b.size);
  const unknown = new Set();
  const { done, left } = await runQueue(queue, async (f) => {
    const t = Date.now();
    const piece = await PARSERS[f.kind](fetchChunks(f.url), f);
    for (const u of piece.unknown ?? []) unknown.add(u);
    delete piece.unknown;
    const entry = { etag: f.etag, version: PARSE_VERSION, fetched: new Date().toISOString(), ...piece };
    cached.set(key(f), entry);
    await writeFile(cachePath(f.kind, f.name), JSON.stringify(entry));
    log(`BR: ${f.kind} ${f.name} (${(f.size / 1e6).toFixed(0)} MB) in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  }, { concurrency: Number(args.concurrency), deadline, log: (m) => log(`BR: ${m}`) });
  log(`BR: fetched ${done} files, ${left} still to fetch`);
  if (unknown.size) log(`BR: unmapped plant types: ${[...unknown].join(', ')}`);

  // Only files still listed count, so a yearly file ONS splits into months isn't counted twice.
  const listedKeys = new Set(files.map(key));
  const pieces = [...cached.entries()].filter(([k]) => listedKeys.has(k)).map(([, e]) => e);
  const merged = mergeBrazil(pieces);
  if (!merged) {
    log('BR: no data yet, nothing written');
    return;
  }
  const genFiles = files.filter((f) => f.kind === 'generation');
  const haveGen = genFiles.filter((f) => isCurrent(cached.get(key(f)), f));
  const { meta, bytes } = await writeDataset(args.out, {
    region: 'br',
    timeZone: 'America/Sao_Paulo',
    stepMinutes: 60,
    startMs: merged.startMs,
    length: merged.length,
    columns: merged.columns,
    extra: { files: { generation: haveGen.length, generationListed: genFiles.length, toFetch: left } },
  }, { log });
  log(`BR: wrote ${args.out}/series.bin.gz (${(bytes / 1e6).toFixed(2)} MB, ${meta.columns.length} columns x ${merged.length} hours)`,
    `in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
