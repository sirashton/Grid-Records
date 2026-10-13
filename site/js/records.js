// Record-duration engine. Shared by the browser and the Node tests.
//
// A series is a Float64Array of values at a fixed step (half-hourly), with NaN
// marking missing slots. A "spell" is a run of consecutive slots where the
// value is below (or above) a threshold. Missing slots end a spell, unless a
// gap allowance lets short gaps be bridged when the slots either side qualify.

export const STEP_MINUTES = 30;

/**
 * Finds every spell where the series satisfies the threshold.
 * @param {ArrayLike<number>} values
 * @param {number} threshold
 * @param {'below'|'above'} mode  below: value < threshold; above: value >= threshold
 * @param {{maxGap?: number}} [opts] number of missing slots that may be bridged
 * @returns {{start: number, end: number}[]} end is exclusive, in slot indexes
 */
export function findSpells(values, threshold, mode, opts = {}) {
  const maxGap = opts.maxGap ?? 0;
  const ok = mode === 'below' ? (v) => v < threshold : (v) => v >= threshold;
  const spells = [];
  let start = -1;
  let lastGood = -1;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    if (ok(v)) {
      if (start >= 0 && i - lastGood - 1 > maxGap) {
        spells.push({ start, end: lastGood + 1 });
        start = -1;
      }
      if (start < 0) start = i;
      lastGood = i;
    } else if (start >= 0) {
      spells.push({ start, end: lastGood + 1 });
      start = -1;
    }
  }
  if (start >= 0) spells.push({ start, end: lastGood + 1 });
  return spells;
}

/** Length of a spell in slots. */
export const spellLength = (s) => s.end - s.start;

/**
 * The record progression: each spell that beat every earlier spell, in the
 * order they ended. The last entry is the all-time record.
 */
export function recordProgression(spells) {
  const records = [];
  let best = 0;
  for (const s of [...spells].sort((a, b) => a.end - b.end)) {
    const len = spellLength(s);
    if (len > best) {
      best = len;
      records.push(s);
    }
  }
  return records;
}

/** The n longest spells, longest first (ties go to the earlier spell). */
export function topSpells(spells, n) {
  return [...spells]
    .sort((a, b) => spellLength(b) - spellLength(a) || a.start - b.start)
    .slice(0, n);
}

/**
 * Summarises a threshold: all-time record, record progression, the current
 * spell (if the series ends inside one) and the longest spell per year.
 * @param {ArrayLike<number>} values
 * @param {number} threshold
 * @param {'below'|'above'} mode
 * @param {{maxGap?: number, startMs: number, top?: number}} opts
 */
export function summarise(values, threshold, mode, opts) {
  const spells = findSpells(values, threshold, mode, opts);
  const progression = recordProgression(spells);
  const record = progression.at(-1) ?? null;
  let lastValid = values.length - 1;
  while (lastValid >= 0 && Number.isNaN(values[lastValid])) lastValid--;
  const last = spells.at(-1);
  const current = last && last.end === lastValid + 1 ? last : null;
  const totalSlots = spells.reduce((n, s) => n + spellLength(s), 0);
  const perYear = new Map();
  for (const s of spells) {
    const y = new Date(slotTime(s.end - 1, opts.startMs)).getUTCFullYear();
    const prev = perYear.get(y);
    if (!prev || spellLength(s) > spellLength(prev)) perYear.set(y, s);
  }
  return {
    threshold,
    mode,
    count: spells.length,
    totalSlots,
    record,
    current,
    progression,
    top: topSpells(spells, opts.top ?? 10),
    perYear: [...perYear.entries()].sort((a, b) => a[0] - b[0]),
  };
}

export const slotTime = (index, startMs) => startMs + index * STEP_MINUTES * 60000;

/** "3 days 4 hours", "5 hours 30 minutes", "30 minutes". */
export function formatDuration(slots) {
  let minutes = slots * STEP_MINUTES;
  const days = Math.floor(minutes / 1440);
  minutes -= days * 1440;
  const hours = Math.floor(minutes / 60);
  minutes -= hours * 60;
  const part = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const parts = [];
  if (days) parts.push(part(days, 'day'));
  if (hours) parts.push(part(hours, 'hour'));
  if (minutes && !days) parts.push(part(minutes, 'minute'));
  return parts.slice(0, 2).join(' ') || '0 minutes';
}

/** A log-spaced 1-2-5 ladder between lo and hi inclusive, e.g. 0.5, 1, 2, 5, 10. */
export function logLadder(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)) + 1; e++) {
    for (const m of [1, 2, 5]) {
      const v = Number((m * 10 ** e).toPrecision(3));
      if (v >= lo - 1e-9 && v <= hi + 1e-9) out.push(v);
    }
  }
  return out;
}
