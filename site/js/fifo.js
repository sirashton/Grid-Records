// Attributes battery discharge to the generation that charged it, by treating
// the whole battery fleet as one first-in, first-out store of energy.
//
// Each half hour the fleet is net charging, the energy it takes in is tagged
// with that half hour's grid mix and joins the back of the queue, less
// round-trip losses. Each half hour it is net discharging, energy leaves from
// the front, so the oldest charge is used first. Pure functions so they can be
// tested in Node.
import { MIX } from './story.js';

export const KEYS = MIX.map((m) => m.key);
const FOSSIL_KEYS = ['coal', 'gas'];
const LOW_CARBON_KEYS = ['nuclear', 'hydro', 'wind', 'solar'];
const DAY_SLOTS = 48;
const pos = (v) => (v > 0 ? v : 0);

export const DEFAULTS = {
  // Share of the energy taken in that comes back out. Lithium-ion fleets
  // manage about 85% including auxiliary loads, which matches B1610's ratio of
  // metered export to import.
  efficiency: 0.85,
  // Energy the fleet can hold, as hours at its recent peak power. Energy that
  // would overflow it is written off, oldest first, so metering gaps cannot
  // leave months-old charge sitting in the store.
  durationHours: 2,
  peakDays: 30,
};

/**
 * Battery charge and discharge per slot in MW: metered B1610 where it has
 * data, planned PN otherwise. Returns null for slots with neither.
 */
function batteryAt(columns, i) {
  for (const s of ['b1610', 'pn']) {
    const d = columns[`${s}_dis`]?.[i];
    const c = columns[`${s}_chg`]?.[i];
    if (d !== undefined && !Number.isNaN(d) && !Number.isNaN(c)) return { dis: d, chg: c, source: s };
  }
  return null;
}

/** Grid generation at slot i by mix key in MW, with battery discharge taken out of Other. */
function gridMix(columns, i, batteryDis) {
  const out = new Float64Array(KEYS.length);
  MIX.forEach((m, k) => {
    for (const c of m.columns) {
      const v = columns[c]?.[i];
      if (v !== undefined && !Number.isNaN(v)) out[k] += pos(v);
    }
  });
  const other = KEYS.indexOf('other');
  out[other] = pos(out[other] - batteryDis);
  return out;
}

const emptyDay = (dayMs) => ({
  dayMs,
  discharged: new Float64Array(KEYS.length), // MWh out, by the fuel that charged it
  unknown: 0, // MWh out with nothing in the store to explain it
  charged: 0, // MWh in, before losses
  writtenOff: 0, // MWh dropped from the store because it overflowed
  grid: new Float64Array(KEYS.length), // MWh generated on the grid, for comparison
  sources: { b1610: 0, pn: 0 }, // half hours from each battery source
});

/**
 * Runs the FIFO model over the dataset.
 * @returns {{ days: object[], store: { mwh: number, mix: Float64Array } }}
 *   days: one entry per UTC day from the first battery data.
 *   store: what the model thinks is in the batteries at the end, by fuel.
 */
export function attributeBatteries(data, opts = {}) {
  const { efficiency, durationHours, peakDays } = { ...DEFAULTS, ...opts };
  const { columns, length, startMs } = data;
  let first = 0;
  while (first < length && !batteryAt(columns, first)) first++;
  first -= first % DAY_SLOTS;

  // Peak net power per day, then the store's capacity from the trailing peak.
  const nDays = Math.ceil((length - first) / DAY_SLOTS);
  const dayPeak = new Float64Array(nDays);
  for (let i = first; i < length; i++) {
    const b = batteryAt(columns, i);
    if (b) dayPeak[(i - first) / DAY_SLOTS | 0] = Math.max(dayPeak[(i - first) / DAY_SLOTS | 0], Math.abs(b.dis + b.chg));
  }
  const capacity = new Float64Array(nDays);
  for (let d = 0; d < nDays; d++) {
    let peak = 0;
    for (let k = Math.max(0, d - peakDays + 1); k <= d; k++) peak = Math.max(peak, dayPeak[k]);
    capacity[d] = peak * durationHours;
  }

  // The queue is an array of parcels with a moving head, compacted now and then.
  let queue = [];
  let head = 0;
  let stored = 0;
  const days = [];
  for (let i = first; i < length; i++) {
    const d = (i - first) / DAY_SLOTS | 0;
    if (!days[d]) days[d] = emptyDay(startMs + i * 18e5);
    const day = days[d];
    const b = batteryAt(columns, i);
    const grid = gridMix(columns, i, b ? b.dis : 0);
    for (let k = 0; k < KEYS.length; k++) day.grid[k] += grid[k] / 2;
    if (!b) continue;
    day.sources[b.source]++;
    // Units charging while others discharge are moving energy within the
    // fleet, so only the net flow meets the grid.
    const net = b.dis + b.chg;
    const mwh = Math.abs(net) / 2;
    if (net < 0) {
      const total = grid.reduce((a, v) => a + v, 0);
      if (!(total > 0)) continue;
      day.charged += mwh;
      const e = mwh * efficiency;
      queue.push({ e, mix: grid.map((v) => v / total) });
      stored += e;
      // Overflow: the oldest energy is written off.
      while (stored > capacity[d] + 1e-9 && head < queue.length) {
        const p = queue[head];
        const drop = Math.min(p.e, stored - capacity[d]);
        p.e -= drop;
        stored -= drop;
        day.writtenOff += drop;
        if (p.e <= 1e-9) head++;
      }
    } else if (net > 0) {
      let need = mwh;
      while (need > 1e-9 && head < queue.length) {
        const p = queue[head];
        const take = Math.min(p.e, need);
        for (let k = 0; k < KEYS.length; k++) day.discharged[k] += take * p.mix[k];
        p.e -= take;
        stored -= take;
        need -= take;
        if (p.e <= 1e-9) head++;
      }
      day.unknown += need;
    }
    if (head > 4096) {
      queue = queue.slice(head);
      head = 0;
    }
  }

  const mix = new Float64Array(KEYS.length);
  for (let q = head; q < queue.length; q++) for (let k = 0; k < KEYS.length; k++) mix[k] += queue[q].e * queue[q].mix[k];
  return { days: days.filter(Boolean), store: { mwh: Math.max(0, stored), mix } };
}

/** Adds up days into one total, optionally only those from fromMs onwards. */
export function sumDays(days, fromMs = -Infinity, toMs = Infinity) {
  const out = emptyDay(null);
  for (const d of days) {
    if (d.dayMs < fromMs || d.dayMs >= toMs) continue;
    for (let k = 0; k < KEYS.length; k++) {
      out.discharged[k] += d.discharged[k];
      out.grid[k] += d.grid[k];
    }
    out.unknown += d.unknown;
    out.charged += d.charged;
    out.writtenOff += d.writtenOff;
    out.sources.b1610 += d.sources.b1610;
    out.sources.pn += d.sources.pn;
  }
  return out;
}

/** Totals per calendar month (UTC). */
export function byMonth(days) {
  const months = new Map();
  for (const d of days) {
    const dt = new Date(d.dayMs);
    const m = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1);
    if (!months.has(m)) months.set(m, []);
    months.get(m).push(d);
  }
  return [...months].map(([monthMs, ds]) => ({ monthMs, ...sumDays(ds) }));
}

/**
 * Shares (%) of a total: the battery output by fuel plus "unknown", the fossil
 * and low carbon share of attributed output, and the same for the grid.
 */
export function shares(total) {
  const out = total.discharged.reduce((a, v) => a + v, 0) + total.unknown;
  const attributed = out - total.unknown;
  const gridTotal = total.grid.reduce((a, v) => a + v, 0);
  const pick = (arr, keys) => keys.reduce((a, k) => a + arr[KEYS.indexOf(k)], 0);
  const pc = (a, b) => (b > 0 ? (a / b) * 100 : NaN);
  return {
    dischargedMwh: out,
    byFuel: Object.fromEntries(KEYS.map((k, i) => [k, pc(total.discharged[i], out)])),
    unknown: pc(total.unknown, out),
    fossil: pc(pick(total.discharged, FOSSIL_KEYS), attributed),
    lowCarbon: pc(pick(total.discharged, LOW_CARBON_KEYS), attributed),
    gridFossil: pc(pick(total.grid, FOSSIL_KEYS), gridTotal),
    gridLowCarbon: pc(pick(total.grid, LOW_CARBON_KEYS), gridTotal),
  };
}
