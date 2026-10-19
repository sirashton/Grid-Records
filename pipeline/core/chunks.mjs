// Fetching a long history in pieces (days, months) within a time budget, and
// stitching the pieces onto one grid. Parsed pieces are kept in an Actions
// cache between runs, so a fresh start backfills over several runs.
import { DAY_MS } from '../lib.mjs';

/**
 * Runs fn over items with a few workers, in order, until the deadline.
 * Failures are logged and skipped. Returns how many finished and how many are left.
 */
export async function runQueue(items, fn, { concurrency = 4, deadline = Infinity, log = console.log } = {}) {
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length && Date.now() < deadline) {
      const item = items[next++];
      try {
        await fn(item);
        done++;
      } catch (err) {
        log(`${item}: failed: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return { done, left: items.length - done };
}

const ym = (y, m) => `${y}${String(m + 1).padStart(2, '0')}`;

/** Every month (YYYYMM) from `from` (YYYY-MM) to the current one, newest first. */
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

/**
 * Whether a cached piece should be fetched again: never fetched, parsed by an
 * older parser, one of the `recent` newest (refetched daily, as sources revise
 * them), or a piece that had no file yet (checked monthly).
 * entry: { fetched: ISO time, version?, missing? }; index: 0 for the newest.
 */
export function isStale(entry, index, nowMs, { version, recent = 4 } = {}) {
  if (!entry || (!entry.missing && entry.version !== version)) return true;
  const age = nowMs - Date.parse(entry.fetched);
  if (index < recent) return age > DAY_MS;
  return entry.missing ? age > 30 * DAY_MS : false;
}

/**
 * Lays pieces onto one grid. Each piece: { startMs, length, columns: { name: (number|null)[] } }
 * at the same step. Slots no piece covers stay NaN. Returns { startMs, length, columns }.
 */
export function stitch(pieces, { stepMinutes, columns: names }) {
  const stepMs = stepMinutes * 60000;
  const present = pieces.filter((p) => p && p.length).sort((a, b) => a.startMs - b.startMs);
  if (!present.length) return null;
  const startMs = present[0].startMs;
  const length = Math.max(...present.map((p) => Math.round((p.startMs - startMs) / stepMs) + p.length));
  const columns = Object.fromEntries(names.map((c) => [c, new Float64Array(length).fill(NaN)]));
  for (const p of present) {
    const base = Math.round((p.startMs - startMs) / stepMs);
    for (const c of names) {
      const src = p.columns[c] ?? [];
      for (let i = 0; i < p.length; i++) if (src[i] != null) columns[c][base + i] = src[i];
    }
  }
  return { startMs, length, columns };
}
