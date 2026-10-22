// The Ontario story: gas, Ontario's last fossil fuel, has gone from the
// grid's peaker to a round-the-clock plant while the nuclear fleet is rebuilt.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate, fmtDateTime } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import on from '../countries/on.js';
import { GENERATION, byYear } from './data.js';

// The IESO's hours are Eastern Standard Time all year, so hour-of-day figures
// use UTC-5 too.
const OFFSET_MS = -5 * 3600000;
// Gas levels the story counts hours under, in GW.
export const GAS_LOW = [0.5, 1, 2];
const KEYS = ['nuclear', 'gas', 'hydro', 'wind', 'solar', 'biomass', 'battery'];

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s?.record ? { start: s.record.start, end: s.record.end } : null);

/**
 * Every number the story uses. Rows run by calendar year (Toronto time),
 * complete years only, then 'past365' for the latest 365 days. `months` holds
 * every calendar month, the current one included. Energy in TWh, power in GW.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const stepMs = step * 60000;
  const slotH = step / 60;
  const col = (k) => data.columns[k];
  const v = (k, i) => {
    const x = col(k)?.[i];
    return x == null || Number.isNaN(x) ? 0 : x / 1000;
  };
  const gas = new Float64Array(end);
  const gen = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    const g = col('gas')[i];
    gas[i] = Number.isNaN(g) ? NaN : g / 1000;
    gen[i] = Number.isNaN(g) ? NaN : GENERATION.reduce((s, k) => s + v(k, i), 0);
  }
  const local = (i) => new Date(data.startMs + i * stepMs + OFFSET_MS);

  const init = () => ({
    twh: Object.fromEntries([...KEYS, 'gen', 'demand', 'netx', 'gasInExport'].map((k) => [k, 0])),
    hourSum: { gas: new Float64Array(24), nuclear: new Float64Array(24), battery: new Float64Array(24), demand: new Float64Array(24) },
    hourN: new Float64Array(24),
    gasMin: Infinity, gasMinAt: -1, gasMax: 0, gasMaxAt: -1, batMax: 0, batMaxAt: -1,
    under: GAS_LOW.map(() => 0),
    exportHours: 0, hours: 0,
    dayMins: [], day: null,
  });
  const add = (r, i) => {
    const g = gas[i];
    if (Number.isNaN(g)) return;
    const t = local(i);
    const h = t.getUTCHours();
    for (const k of KEYS) r.twh[k] += (v(k, i) * slotH) / 1000;
    r.twh.gen += (gen[i] * slotH) / 1000;
    const dem = col('demand')[i];
    if (!Number.isNaN(dem)) {
      // Net exports, inferred: transmission-connected generation less Ontario Demand.
      const netx = gen[i] + v('battery', i) - dem / 1000;
      r.twh.demand += (dem / 1000 * slotH) / 1000;
      r.twh.netx += (netx * slotH) / 1000;
      r.twh.gasInExport += (Math.min(g, Math.max(0, netx)) * slotH) / 1000;
      if (netx > 0) r.exportHours += slotH;
      r.hourSum.demand[h] += dem / 1000;
    }
    r.hourSum.gas[h] += g;
    r.hourSum.nuclear[h] += v('nuclear', i);
    r.hourSum.battery[h] += v('battery', i);
    r.hourN[h]++;
    r.hours += slotH;
    if (g < r.gasMin) { r.gasMin = g; r.gasMinAt = i; }
    if (g > r.gasMax) { r.gasMax = g; r.gasMaxAt = i; }
    if (v('battery', i) > r.batMax) { r.batMax = v('battery', i); r.batMaxAt = i; }
    GAS_LOW.forEach((lv, k) => { if (g < lv) r.under[k] += slotH; });
    // The lowest gas hour of each day: the floor gas no longer leaves.
    const key = Math.floor((data.startMs + i * stepMs + OFFSET_MS) / 864e5);
    if (r.day?.key !== key) {
      if (r.day) r.dayMins.push(r.day);
      r.day = { key, min: g, n: 0 };
    }
    r.day.min = Math.min(r.day.min, g);
    r.day.n++;
  };
  const finish = (r) => {
    const mins = (r.day ? [...r.dayMins, r.day] : r.dayMins).filter((x) => x.n * slotH >= 24).map((x) => x.min).sort((a, b) => a - b);
    const hourly = Object.fromEntries(Object.keys(r.hourSum).map((k) => [k, [...r.hourSum[k]].map((x, h) => mean(x, r.hourN[h]))]));
    const bat = r.hourSum.battery.reduce((a, b) => a + b, 0);
    // Share of battery discharge from 15:00 to 20:59, the evening peak.
    const batEvening = bat ? [15, 16, 17, 18, 19, 20].reduce((s, h) => s + r.hourSum.battery[h], 0) / bat : NaN;
    return {
      year: r.year,
      twh: r.twh,
      gasShare: r.twh.gas / r.twh.gen,
      nuclearShare: r.twh.nuclear / r.twh.gen,
      lowCarbonShare: (r.twh.gen - r.twh.gas) / r.twh.gen,
      gasInExportShare: r.twh.gasInExport / r.twh.gas,
      exportHours: r.exportHours,
      hours: r.hours,
      hourly,
      floor: mins[Math.floor(mins.length / 2)] ?? NaN,
      gasMin: r.gasMin, gasMinAt: r.gasMinAt, gasMax: r.gasMax, gasMaxAt: r.gasMaxAt,
      batMax: r.batMax, batMaxAt: r.batMaxAt, batEvening,
      under: r.under,
    };
  };
  const rows = byYear(d, init, add).map(finish);

  // Every calendar month: average gas and nuclear GW and gas's share.
  const months = [];
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(gas[i])) continue;
    const t = local(i);
    const key = t.getUTCFullYear() * 12 + t.getUTCMonth();
    let mo = months.at(-1);
    if (mo?.key !== key) {
      mo = { key, year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, ms: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 15), gas: 0, nuclear: 0, gen: 0, n: 0 };
      months.push(mo);
    }
    mo.gas += gas[i];
    mo.nuclear += v('nuclear', i);
    mo.gen += gen[i];
    mo.n++;
  }
  for (const mo of months) {
    mo.share = mo.gas / mo.gen;
    mo.gas /= mo.n;
    mo.nuclear /= mo.n;
    delete mo.gen;
  }

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: on.timeZone };
  const under1 = summarise(gas, 1, 'below', opts);
  const over2 = summarise(gas, 2, 'above', opts);
  const hoursOf = (p) => ((p.end - p.start) * step) / 60;
  return {
    rows,
    months,
    under1Spell: spellOf(under1),
    under05Spell: spellOf(summarise(gas, 0.5, 'below', opts)),
    under2Spell: spellOf(summarise(gas, 2, 'below', opts)),
    over3Spell: spellOf(summarise(gas, 3, 'above', opts)),
    over5Spell: spellOf(summarise(gas, 5, 'above', opts)),
    // The longest spell under 1 GW in each calendar year, in hours.
    under1ByYear: under1.perYear.map(([y, p]) => [y, hoursOf(p)]),
    under1Past365: under1.pastYear ? hoursOf(under1.pastYear) : 0,
    // A spell over 2 GW still running at the latest data, in slots.
    over2Now: over2.current ? { start: over2.current.start, end: over2.current.end } : null,
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (x) => getComputedStyle(document.documentElement).getPropertyValue(x).trim();
const n0 = (x) => Math.round(x).toLocaleString('en-CA');
const gw = (x) => `${x.toFixed(2)} GW`;
const gw1 = (x) => `${x.toFixed(1)} GW`;
const twh = (x) => `${x.toFixed(1)} TWh`;
const pc = (x) => `${(x * 100).toFixed(1)}%`;
const pc0 = (x) => `${Math.round(x * 100)}%`;
const hrs = (x) => `${n0(x)} hours`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const SOURCES = {};

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [];

export function renderStory(data, end, figs) {
  const { rows } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  // Filled in from the drafted story.
  void [data, end, $, css, n0, gw, gw1, twh, pc, pc0, hrs, label, title, legend, link, src, hh, MONTHS, barChart, lineChart, fmtDate, fmtDateTime, slotTime];
}
