// Records being broken right now: for every preset and threshold in a
// country's config, a spell still running at the end of the data that is
// already the longest ever, or close to it. Pure, so the Node tests use it
// too; the Live records page runs it over every country.

import { summarise } from '../records.js';
import { metricSeries, dataEnd, stepOf } from './dataset.js';

// A running spell this share of the record or more counts as closing in.
export const CLOSE = 0.8;
// Shorter spells than this are not worth a line, record or not.
export const MIN_MINUTES = 60;
// A record spell that started longer ago than this is a streak (coal-free
// since the last plant closed), not news.
export const STREAK_DAYS = 30;

/**
 * Running spells for one country. Returns { breaking, close, streaks, nearest }:
 * breaking and streaks are spells already longer than any before them,
 * close are within `close` of the record, and nearest is the running spell
 * closest to its record when nothing else is. Each spell:
 * { preset, label, mode, unit, threshold, status, slots, recordSlots (the
 *   record just beaten, or the one to beat), ratio, start, end, stepMinutes }.
 * One spell per preset: the most demanding record if there is one, else the
 * one closest to its record.
 */
export function liveRecords(data, country, {
  end = dataEnd(data, country), close = CLOSE, minMinutes = MIN_MINUTES, streakDays = STREAK_DAYS, series,
} = {}) {
  const step = stepOf(data);
  const minSlots = Math.ceil(minMinutes / step);
  const streakSlots = Math.round((streakDays * 1440) / step);
  const picks = [];
  for (const [key, p] of Object.entries(country.presets)) {
    if (key === 'custom') continue;
    let best = null;
    for (const unit of ['gw', 'pct']) {
      const all = series ? series(data, p.members, { unit }) : metricSeries(data, country, p.members, { unit });
      const values = all.subarray(0, end);
      let first = 0;
      while (first < end && Number.isNaN(values[first])) first++;
      for (const threshold of p[unit] ?? []) {
        const s = summarise(values, threshold, p.mode, { startMs: data.startMs, stepMinutes: step, timeZone: country.timeZone });
        const cur = s.current;
        // Running to the end of the data, long enough, and not just the
        // first spell on record (nothing to beat).
        if (!cur || cur.end !== end || cur.start === first) continue;
        const slots = cur.end - cur.start;
        if (slots < minSlots) continue;
        const isRecord = s.record.start === cur.start;
        const prev = isRecord ? s.progression.at(-2) : s.record;
        // No earlier spell at all: the first time ever, which is a record too.
        if (!prev && !isRecord) continue;
        const recordSlots = prev ? prev.end - prev.start : 0;
        const c = { preset: key, label: p.label, mode: p.mode, unit, threshold, isRecord, slots, recordSlots, ratio: recordSlots ? slots / recordSlots : Infinity, start: cur.start, end, stepMinutes: step };
        if (!best || better(c, best)) best = c;
      }
    }
    if (best) picks.push(best);
  }
  const out = { breaking: [], close: [], streaks: [], nearest: null };
  for (const c of picks) {
    if (c.isRecord) (c.slots > streakSlots ? out.streaks : out.breaking).push({ ...c, status: c.slots > streakSlots ? 'streak' : 'record' });
    else if (c.ratio >= close) out.close.push({ ...c, status: 'close' });
    else if (!out.nearest || c.ratio > out.nearest.ratio) out.nearest = { ...c, status: 'nearest' };
  }
  const longest = (a, b) => b.slots - a.slots;
  out.breaking.sort(longest);
  out.streaks.sort(longest);
  out.close.sort((a, b) => b.ratio - a.ratio);
  if (out.breaking.length || out.close.length) out.nearest = null;
  for (const k of ['breaking', 'close', 'streaks']) out[k].forEach(strip);
  if (out.nearest) strip(out.nearest);
  return out;
}

const strip = (c) => delete c.isRecord;

// How demanding a threshold is: lower is harder below, higher is harder above.
const harder = (a, b) => (a.mode === 'below' ? a.threshold < b.threshold : a.threshold > b.threshold);

// A record beats a near miss. Between records, GW before % (the same spell
// usually shows in both), then the harder bar; between near misses, the one
// closest to its record.
function better(c, best) {
  if (c.isRecord !== best.isRecord) return c.isRecord;
  if (!c.isRecord) return c.ratio > best.ratio;
  if (c.unit !== best.unit) return c.unit === 'gw';
  return harder(c, best);
}

// Data more than this far behind is "latest data", even for a live country
// (a feed that has stalled).
export const LIVE_HOURS = 6;

/** How fresh a country's data is: { live, behindMs, endMs }. */
export function freshness(data, country, end = dataEnd(data, country), now = Date.now()) {
  const endMs = data.startMs + end * stepOf(data) * 60000;
  const behindMs = Math.max(0, now - endMs);
  return { live: !!country.live && behindMs < LIVE_HOURS * 3600000, behindMs, endMs };
}

/** "40 minutes", "3 hours", "19 days": roughly how far behind. */
export function behindText(ms) {
  const min = Math.round(ms / 60000);
  const part = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (min < 90) return part(Math.max(min, 1), 'minute');
  const h = Math.round(min / 60);
  if (h < 48) return part(h, 'hour');
  return part(Math.round(h / 24), 'day');
}

/** The bar a spell clears, in words: "Fossil fuels under 20 GW", "No coal". */
export function thresholdText(c, country) {
  const { label, mode, unit, threshold: t } = c;
  if (mode === 'below' && t === 0) return `No ${label.toLowerCase()}`;
  const amount = unit === 'pct'
    ? `${t}% of generation`
    : country.smallInMw && t < 1 ? `${Math.round(t * 1000)} MW` : `${t} GW`;
  return mode === 'below' ? `${label} under ${amount}` : `${label} at ${amount} or more`;
}
