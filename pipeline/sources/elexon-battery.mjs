// Battery charge and discharge from Elexon per-unit data, summed over the
// battery BM units. Two products:
//  - PN: Physical Notifications, each unit's planned output, published ahead of
//    real time. Live, but a plan: it misses balancing actions taken later.
//  - B1610: metered output per unit, published about five days after the fact
//    and revised through settlement. The most accurate, but lagged.
import { fetchJson, parseUtc, SLOT_MS, DAY_MS, isoDay } from '../lib.mjs';

const BASE = 'https://data.elexon.co.uk/bmrs/api/v1/datasets';
const rows = (j) => (Array.isArray(j) ? j : j?.data ?? []);

/** Per-slot discharge (>= 0) and charge (<= 0) in MW for one UTC day. */
function emptyDay() {
  return { dis: new Array(48).fill(null), chg: new Array(48).fill(null) };
}

/** Sums per-unit average MW per slot into discharge and charge totals. */
function totalsFromUnitSlots(unitSlots, dayMs) {
  const day = emptyDay();
  for (const [slot, units] of unitSlots) {
    const i = (slot - dayMs) / SLOT_MS;
    if (i < 0 || i >= 48) continue;
    let dis = 0;
    let chg = 0;
    for (const mw of units.values()) {
      if (mw > 0) dis += mw;
      else chg += mw;
    }
    day.dis[i] = Math.round(dis);
    day.chg[i] = Math.round(chg);
  }
  return day;
}

/**
 * Converts PN records (piecewise-linear segments) into time-weighted average MW
 * per unit per slot, then totals. Exported for tests.
 */
export function pnToDay(records, unitIds, dayMs) {
  const unitSlots = new Map();
  for (const r of records) {
    const id = r.nationalGridBmUnit;
    if (!unitIds.has(id)) continue;
    const from = parseUtc(r.timeFrom);
    const to = parseUtc(r.timeTo);
    if (!(to > from)) continue;
    const slot = Math.floor(from / SLOT_MS) * SLOT_MS;
    const mwAverage = ((r.levelFrom + r.levelTo) / 2) * ((to - from) / SLOT_MS);
    if (!unitSlots.has(slot)) unitSlots.set(slot, new Map());
    const units = unitSlots.get(slot);
    units.set(id, (units.get(id) ?? 0) + mwAverage);
  }
  return totalsFromUnitSlots(unitSlots, dayMs);
}

const RUN_RANK = { II: 1, SF: 2, R1: 3, R2: 4, R3: 5, RF: 6, DF: 7 };

/** Converts B1610 records (MWh per half hour) into MW totals. Exported for tests. */
export function b1610ToDay(records, unitIds, dayMs) {
  const best = new Map();
  for (const r of records) {
    if (!unitIds.has(r.bmUnit)) continue;
    const slot = parseUtc(r.halfHourEndTime) - SLOT_MS;
    const key = `${r.bmUnit}|${slot}`;
    const rank = RUN_RANK[r.settlementRunType] ?? 0;
    const prev = best.get(key);
    if (!prev || rank >= prev.rank) best.set(key, { rank, slot, id: r.bmUnit, mw: r.quantity * 2 });
  }
  const unitSlots = new Map();
  for (const { slot, id, mw } of best.values()) {
    if (!unitSlots.has(slot)) unitSlots.set(slot, new Map());
    unitSlots.get(slot).set(id, mw);
  }
  return totalsFromUnitSlots(unitSlots, dayMs);
}

const range = (dayMs) => `from=${new Date(dayMs).toISOString()}&to=${new Date(dayMs + DAY_MS).toISOString()}`;

export async function fetchPnDay(dayMs, batteries) {
  const recs = rows(await fetchJson(`${BASE}/PN/stream?${range(dayMs)}`));
  const ids = new Set(batteries.map((b) => b.ng).filter(Boolean));
  return pnToDay(recs, ids, dayMs);
}

export async function fetchB1610Day(dayMs, batteries) {
  const recs = rows(await fetchJson(`${BASE}/B1610/stream?${range(dayMs)}`, { timeoutMs: 300000 }));
  if (!recs.length) return null;
  const ids = new Set(batteries.map((b) => b.elexon).filter(Boolean));
  return b1610ToDay(recs, ids, dayMs);
}

export const BATTERY_SOURCES = {
  pn: { fetchDay: fetchPnDay, refreshDays: 2, label: 'Elexon Physical Notifications' },
  b1610: { fetchDay: fetchB1610Day, refreshDays: 21, label: 'Elexon B1610 metered output' },
};

export { isoDay };
