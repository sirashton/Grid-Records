// The figures behind the Czechia story, worked out from the data. Kept apart
// from the drawing (story.js) so the tests can run them without a page.
// Every number the story prints comes from storyFigures() or a cited source.
import { summarise } from '../records.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import cz from '../countries/cz.js';
import { FOSSIL, GENERATION, metricSeries, byYear } from './data.js';

// Lignite output levels (GW) the story counts hours above, and tests the
// closures against: lignite above a level is output a smaller fleet could not
// have made.
export const LIG_LEVELS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7];
// Lignite levels whose longest spell below the story follows.
export const LIG_SPELLS = [3, 2.5, 2, 1.5];
// Nuclear below this (GW) counts as a reactor outage hour (about 4.1 GW installed).
export const NUC_OUT = 3;
// Sev.en's three plants closing by March 2027 (MW, Sev.en's figures):
// Počerady 1,050, Chvaletice 820, Kladno 524.
export const CLOSING_MW = { pocerady: 1050, chvaletice: 820, kladno: 524 };
// ČEPS asked for two of Chvaletice's four units to keep running in 2027.
export const CHVALETICE_KEPT_MW = 410;

/**
 * Local hour, month and day number for every slot. The Prague offset is looked
 * up once per UTC day, so the hour around a clock change can be one off.
 */
export function localClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Uint8Array(data.length);
  const day = new Int32Array(data.length);
  let utcDay = -1;
  let offset = 0;
  for (let i = 0; i < data.length; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== utcDay) {
      utcDay = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, cz.timeZone);
    }
    const local = t + offset;
    const l = new Date(local);
    hour[i] = l.getUTCHours();
    month[i] = l.getUTCMonth() + 1;
    day[i] = Math.floor(local / 864e5);
  }
  return { hour, month, day };
}

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end, slots: s.record.end - s.record.start } : null);

/**
 * Every number the story uses. Rows run by Czech calendar year, complete years
 * only, then 'past365' for the latest 365 days. Energies are TWh, powers GW,
 * times hours, prices EUR/MWh.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const lignite = metricSeries(d, ['lignite']);
  const fossil = metricSeries(d, FOSSIL);
  const nuclear = metricSeries(d, ['nuclear']);
  const solar = metricSeries(d, ['solar']);
  const price = data.columns.price ?? new Float64Array(end).fill(NaN);
  const { imports, exports } = data.columns;
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const { hour, month, day } = localClock(d);
  const nL = LIG_LEVELS.length;

  const rows = byYear(d, () => ({
    slots: 0, ligTwh: 0, fosTwh: 0, nucTwh: 0, solTwh: 0, genTwh: 0, gasTwh: 0, coalTwh: 0,
    expTwh: 0, impTwh: 0, expHours: 0, impHours: 0,
    ligMin: Infinity, ligMinAt: -1, ligMax: 0, fosMin: Infinity,
    ligMonth: new Float64Array(12), ligHour: new Float64Array(24), ligHourN: new Float64Array(24),
    summerHour: new Float64Array(24), summerHourN: new Float64Array(24),
    priceSum: 0, priceN: 0, priceHour: new Float64Array(24), priceHourN: new Float64Array(24),
    ligExporting: 0, ligImporting: 0,
    above: new Float64Array(nL), excess: new Float64Array(nL), excessExported: new Float64Array(nL),
    nucOutH: 0, ligNucOut: 0, ligNucOutN: 0, ligNucIn: 0, ligNucInN: 0,
    ligCheap: 0, ligCheapH: 0,
    day: null, days: [],
  }), (r, i) => {
    const lg = lignite[i];
    if (Number.isNaN(lg)) return;
    const h = hour[i];
    const m = month[i];
    r.slots++;
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(r.day);
      r.day = { n: day[i], month: m, min: Infinity, max: 0 };
    }
    if (lg < r.day.min) r.day.min = lg;
    if (lg > r.day.max) r.day.max = lg;
    const e = slotH / 1000; // GW over one slot, in TWh
    r.ligTwh += lg * e;
    r.ligMonth[m - 1] += lg * e;
    r.ligHour[h] += lg;
    r.ligHourN[h]++;
    if (m >= 5 && m <= 8) { r.summerHour[h] += lg; r.summerHourN[h]++; }
    if (lg < r.ligMin) { r.ligMin = lg; r.ligMinAt = i; }
    if (lg > r.ligMax) r.ligMax = lg;
    const fo = fossil[i];
    if (fo < r.fosMin) r.fosMin = fo;
    r.fosTwh += (fo || 0) * e;
    r.gasTwh += ((data.columns.gas[i] || 0) / 1000) * e;
    r.coalTwh += ((data.columns.coal[i] || 0) / 1000) * e;
    const nu = nuclear[i];
    if (Number.isFinite(nu)) {
      r.nucTwh += nu * e;
      if (nu < NUC_OUT) { r.nucOutH += slotH; r.ligNucOut += lg; r.ligNucOutN++; } else { r.ligNucIn += lg; r.ligNucInN++; }
    }
    r.solTwh += (solar[i] || 0) * e;
    let gen = 0;
    for (const col of genCols) gen += col[i] > 0 ? col[i] : 0;
    r.genTwh += (gen / 1000) * e;
    // Net trade in GW: positive is a net export.
    const netExp = -((imports[i] || 0) + (exports[i] || 0)) / 1000;
    if (netExp > 0) { r.expTwh += netExp * e; r.expHours += slotH; r.ligExporting += lg * e; }
    if (netExp < 0) { r.impTwh += -netExp * e; r.impHours += slotH; r.ligImporting += lg * e; }
    for (let k = 0; k < nL; k++) {
      const over = lg - LIG_LEVELS[k];
      if (over <= 0) continue;
      r.above[k] += slotH;
      r.excess[k] += over * e;
      r.excessExported[k] += Math.min(over, Math.max(0, netExp)) * e;
    }
    const p = price[i];
    if (Number.isNaN(p)) return;
    r.priceSum += p;
    r.priceN++;
    r.priceHour[h] += p;
    r.priceHourN[h]++;
    if (p < 0) { r.ligCheap += lg * e; r.ligCheapH += slotH; }
  }).map((r) => {
    const days = r.day ? [...r.days, r.day] : r.days;
    const dayMins = days.map((x) => x.min).sort((a, b) => a - b);
    return {
      year: r.year,
      hours: r.slots * slotH,
      ligTwh: r.ligTwh,
      fosTwh: r.fosTwh,
      gasTwh: r.gasTwh,
      coalTwh: r.coalTwh,
      nucTwh: r.nucTwh,
      solTwh: r.solTwh,
      genTwh: r.genTwh,
      ligShare: r.ligTwh / r.genTwh,
      nucShare: r.nucTwh / r.genTwh,
      expTwh: r.expTwh,
      impTwh: r.impTwh,
      netExpTwh: r.expTwh - r.impTwh,
      expHours: r.expHours,
      impHours: r.impHours,
      ligMin: r.ligMin,
      ligMinAt: r.ligMinAt,
      ligMax: r.ligMax,
      fosMin: r.fosMin,
      // The median day's lowest quarter hour of lignite: the everyday floor.
      ligDayMinMedian: dayMins.length ? dayMins[Math.floor(dayMins.length / 2)] : NaN,
      ligMonth: [...r.ligMonth],
      ligHour: [...r.ligHour].map((v, k) => mean(v, r.ligHourN[k])),
      summerHour: [...r.summerHour].map((v, k) => mean(v, r.summerHourN[k])),
      price: mean(r.priceSum, r.priceN),
      priceHour: [...r.priceHour].map((v, k) => mean(v, r.priceHourN[k])),
      ligExportingShare: r.ligExporting / r.ligTwh,
      ligImporting: r.ligImporting,
      // For each lignite level: hours above it, lignite output above it, and
      // how much of that output was matched by net exports in the same slot.
      levels: LIG_LEVELS.map((gw, k) => ({ gw, hours: r.above[k], twh: r.excess[k], exportedTwh: r.excessExported[k] })),
      nucOutHours: r.nucOutH,
      ligNucOut: mean(r.ligNucOut, r.ligNucOutN),
      ligNucIn: mean(r.ligNucIn, r.ligNucInN),
      ligNegPriceTwh: r.ligCheap,
      negPriceHours: r.ligCheapH,
    };
  });

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: cz.timeZone };
  return {
    rows,
    ligSpells: LIG_SPELLS.map((gw) => ({ gw, spell: spellOf(summarise(lignite, gw, 'below', opts)) })),
    fossil3Spell: spellOf(summarise(fossil, 3, 'below', opts)),
  };
}

/**
 * What a lignite fleet with `closeGw` less capacity would have had to give up
 * in a year: the hours its output was above the remaining capacity, that
 * output, and the share of it matched by net exports. Linear between levels.
 */
export function closureGap(row, remainingGw) {
  const lv = row.levels;
  const k = lv.findIndex((l) => l.gw >= remainingGw);
  if (k < 0) return { hours: 0, twh: 0, exportedShare: NaN };
  const at = (f) => {
    if (k === 0 || lv[k].gw === remainingGw) return lv[k][f];
    const a = lv[k - 1];
    const b = lv[k];
    const t = (remainingGw - a.gw) / (b.gw - a.gw);
    return a[f] + (b[f] - a[f]) * t;
  };
  const twh = at('twh');
  return { hours: at('hours'), twh, exportedShare: twh > 0 ? at('exportedTwh') / twh : NaN };
}
