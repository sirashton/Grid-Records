// Picks out records set recently, for the "Right now" panel. Pure, so it can
// be tested in Node.

import { summarise, slotTime } from './records.js';
import { metricSeries, generationTotal } from './data.js';

// Groups and thresholds (GW) to watch. Below: lower is better; above: higher.
export const WATCH = [
  { label: 'Fossil fuels', members: ['gas', 'coal'], mode: 'below', gw: [20, 10, 5, 2, 1, 0.5, 0.1] },
  { label: 'Low carbon', members: ['wind', 'solar', 'nuclear', 'hydro', 'storage', 'battery'], mode: 'above', gw: [10, 15, 20, 25, 30, 35] },
  { label: 'Renewables', members: ['wind', 'solar', 'hydro', 'biomass'], mode: 'above', gw: [10, 15, 20, 25, 30, 35] },
  { label: 'Wind', members: ['wind'], mode: 'above', gw: [10, 15, 20, 25] },
  { label: 'Solar', members: ['solar'], mode: 'above', gw: [5, 10, 15, 20] },
];

// Single half-hour peaks worth celebrating.
const PEAKS = [
  { label: 'Most wind', members: ['wind'], unit: 'gw', best: 'max' },
  { label: 'Most solar', members: ['solar'], unit: 'gw', best: 'max' },
  { label: 'Least fossil fuel', members: ['gas', 'coal'], unit: 'gw', best: 'min' },
  { label: 'Greenest half hour', members: ['wind', 'solar', 'nuclear', 'hydro', 'storage'], unit: 'pct', best: 'max' },
];

const DAY = 48;

/**
 * Records set within `days` (spells still running count), newest first.
 * Each: { kind: 'spell'|'peak', label, threshold?, mode?, slots?, value? (GW or %), unit?, start, end, live }.
 */
export function recentRecords(data, { days = 180, peakDays = 365, limit = 6, batterySource = 'pn' } = {}) {
  const end = data.length;
  const since = end - days * DAY;
  const out = [];
  const total = generationTotal(data);
  for (const w of WATCH) {
    const values = metricSeries(data, w.members, { batterySource });
    // The most demanding threshold whose record was set recently.
    const ordered = w.mode === 'below' ? [...w.gw].sort((a, b) => a - b) : [...w.gw].sort((a, b) => b - a);
    for (const t of ordered) {
      const s = summarise(values, t, w.mode, { startMs: data.startMs, maxGap: 2 });
      const r = s.record;
      if (!r || r.end < since) continue;
      out.push({ kind: 'spell', label: w.label, threshold: t, mode: w.mode, slots: r.end - r.start, start: r.start, end: r.end, live: !!s.current && s.current.start === r.start });
      break;
    }
  }
  for (const p of PEAKS) {
    const values = metricSeries(data, p.members, { unit: 'gw', batterySource: 'none' });
    let best = -1;
    for (let i = 0; i < end; i++) {
      let v = values[i];
      if (Number.isNaN(v)) continue;
      if (p.unit === 'pct') {
        if (!(total[i] > 10000)) continue;
        v = (v * 1000 / total[i]) * 100;
        values[i] = v;
      }
      if (best < 0 || (p.best === 'max' ? v > values[best] : v < values[best])) best = i;
    }
    if (best >= end - peakDays * DAY) out.push({ kind: 'peak', label: p.label, value: values[best], unit: p.unit, start: best, end: best + 1, live: false });
  }
  out.sort((a, b) => (b.live - a.live) || (b.end - a.end));
  return out.slice(0, limit).map((r) => ({ ...r, startMs: slotTime(r.start, data.startMs), endMs: slotTime(r.end, data.startMs) }));
}
