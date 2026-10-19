// Live data for any country: a "recent" feed laid on the end of its archive.
//
// Many sources publish a complete archive late (a month or more) and a small
// rolling feed of the last few days or hours. An adapter fetches the archive
// as usual, then fills the gap from the archive's end to now from the feed,
// keeping what it has fetched in a state file in its Actions cache so each
// run only fetches what is new. See docs/adding-a-country.md, "Live data".
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DAY_MS } from '../lib.mjs';

/** Reads a recent feed's state file, or a fresh state with nothing fetched. */
export async function loadState(file, version) {
  if (existsSync(file)) {
    try {
      const state = JSON.parse(await readFile(file, 'utf8'));
      if (state.version === version) return state;
    } catch {
      // A broken state file is fetched again from scratch.
    }
  }
  return { version, files: {}, rows: {} };
}

export const saveState = (file, state) => writeFile(file, JSON.stringify(state));

/**
 * Where the recent feed should start: the archive's end, but no further back
 * than the feed keeps (maxDays), so a half-fetched archive doesn't ask for
 * data the feed never had.
 */
export const recentFrom = (archiveEndMs, nowMs, maxDays) => Math.max(archiveEndMs || 0, nowMs - maxDays * DAY_MS);

/**
 * Drops rows and fetched-file marks from before fromMs. `rows` and `files`
 * are keyed by a time in ms (as a string) or carry one as `t`.
 */
export function prune(state, fromMs) {
  for (const k of Object.keys(state.rows)) if (Number(k) < fromMs) delete state.rows[k];
  for (const [k, v] of Object.entries(state.files)) if ((v.t ?? 0) < fromMs) delete state.files[k];
  return state;
}

/**
 * Extends an archive grid ({ startMs, length, columns }) with a recent piece
 * on the same step. The archive wins wherever it has a slot; the piece only
 * adds slots after the archive's end. Returns a new grid.
 */
export function extend(base, piece, { stepMinutes, columns: names }) {
  if (!piece?.length) return base;
  const stepMs = stepMinutes * 60000;
  if (!base?.length) return piece;
  const baseEnd = base.startMs + base.length * stepMs;
  const pieceEnd = piece.startMs + piece.length * stepMs;
  if (pieceEnd <= baseEnd) return base;
  const length = Math.round((pieceEnd - base.startMs) / stepMs);
  const offset = Math.round((piece.startMs - base.startMs) / stepMs);
  const columns = {};
  for (const c of names) {
    const out = new Float64Array(length).fill(NaN);
    if (base.columns[c]) out.set(base.columns[c].subarray ? base.columns[c].subarray(0, base.length) : base.columns[c].slice(0, base.length));
    const src = piece.columns[c] ?? [];
    for (let i = Math.max(0, base.length - offset); i < piece.length; i++) if (src[i] != null) out[offset + i] = src[i];
    columns[c] = out;
  }
  return { startMs: base.startMs, length, columns };
}

/** One past the last slot where any column has a value. */
export function lastFilled(grid, names) {
  let end = grid?.length ?? 0;
  while (end > 0 && names.every((c) => grid.columns[c] == null || Number.isNaN(grid.columns[c][end - 1]))) end--;
  return end;
}
