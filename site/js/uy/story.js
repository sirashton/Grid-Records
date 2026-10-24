// The Uruguay story, drawn from storyFigures(). The figures are worked out
// from the data by storyFigures(), which the tests also run; renderStory()
// draws the page.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate, fmtDateTime } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import uy from '../countries/uy.js';
import { FOSSIL, GENERATION, HYDRO, metricSeries, byYear } from './data.js';

// Uruguay keeps UTC-3 all year.
const OFFSET_MS = -3 * 3600000;
// Thermal levels the story counts hours against, in GW. Under 0.01 GW reads
// as off: SCADA shows a few MW of auxiliaries and test runs.
export const THERMAL_OFF = 0.01;
export const THERMAL_HIGH = [0.1, 0.5];
const KEYS = ['hydro_salto', 'hydro_negro', 'wind', 'solar', 'biomass', 'thermal', 'imports', 'exports', 'demand'];

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);

/**
 * Every number the story uses. Rows run by Uruguayan calendar year, complete
 * years only, then 'past365' for the latest 365 days. `months` holds every
 * calendar month, the current one included.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const stepMs = step * 60000;
  const slotH = step / 60;
  const thermal = metricSeries(d, FOSSIL);
  const hydro = metricSeries(d, HYDRO);
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const gen = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    let g = 0;
    let any = false;
    for (const col of genCols) if (!Number.isNaN(col[i])) { g += Math.max(0, col[i]); any = true; }
    gen[i] = any ? g / 1000 : NaN;
  }
  const local = (i) => new Date(data.startMs + i * stepMs + OFFSET_MS);
  const val = (k, i) => {
    const v = data.columns[k]?.[i];
    return Number.isNaN(v) || v == null ? 0 : Math.abs(v) / 1000;
  };

  const init = () => ({
    twh: Object.fromEntries([...KEYS, 'gen', 'hydro'].map((k) => [k, 0])),
    thermalHour: new Float64Array(24),
    hourN: new Float64Array(24),
    thermalMonth: new Float64Array(12),
    thMax: 0, thMaxAt: -1, impMax: 0, impMaxAt: -1, expMax: 0, expMaxAt: -1,
    off: 0, high: THERMAL_HIGH.map(() => 0), n: 0,
  });
  const add = (r, i) => {
    const th = thermal[i];
    if (Number.isNaN(th)) return;
    const t = local(i);
    const h = t.getUTCHours();
    for (const k of KEYS) r.twh[k] += (val(k, i) * slotH) / 1000;
    r.twh.gen += (gen[i] * slotH) / 1000;
    r.twh.hydro += ((hydro[i] || 0) * slotH) / 1000;
    r.thermalHour[h] += th;
    r.hourN[h]++;
    r.thermalMonth[t.getUTCMonth()] += (th * slotH) / 1000;
    if (th > r.thMax) { r.thMax = th; r.thMaxAt = i; }
    if (val('imports', i) > r.impMax) { r.impMax = val('imports', i); r.impMaxAt = i; }
    if (val('exports', i) > r.expMax) { r.expMax = val('exports', i); r.expMaxAt = i; }
    if (th < THERMAL_OFF) r.off += slotH;
    THERMAL_HIGH.forEach((lv, k) => { if (th >= lv) r.high[k] += slotH; });
    r.n += slotH;
  };
  const finish = (r) => ({
    year: r.year,
    twh: r.twh,
    hours: r.n,
    thermalShare: r.twh.thermal / r.twh.gen,
    renewShare: 1 - r.twh.thermal / r.twh.gen,
    hydroShare: r.twh.hydro / r.twh.gen,
    windShare: r.twh.wind / r.twh.gen,
    importShare: r.twh.imports / r.twh.demand,
    thermalHour: [...r.thermalHour].map((v, h) => mean(v, r.hourN[h])),
    thermalMonth: [...r.thermalMonth],
    thMax: r.thMax, thMaxAt: r.thMaxAt, impMax: r.impMax, impMaxAt: r.impMaxAt, expMax: r.expMax, expMaxAt: r.expMaxAt,
    off: r.off, offShare: r.off / r.n, high: r.high,
  });
  const rows = byYear(d, init, add).map(finish);

  // Every calendar month: thermal and hydro output in GWh, imports and exports.
  const months = [];
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(thermal[i])) continue;
    const t = local(i);
    const key = t.getUTCFullYear() * 12 + t.getUTCMonth();
    let mo = months.at(-1);
    if (mo?.key !== key) {
      mo = { key, year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, ms: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 15), thermal: 0, hydro: 0, imports: 0, exports: 0, gen: 0, n: 0 };
      months.push(mo);
    }
    mo.thermal += thermal[i] * slotH;
    mo.hydro += (hydro[i] || 0) * slotH;
    mo.imports += val('imports', i) * slotH;
    mo.exports += val('exports', i) * slotH;
    mo.gen += gen[i] * slotH;
    mo.n++;
  }
  for (const mo of months) mo.share = mo.thermal / mo.gen;

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: uy.timeZone };
  const off = summarise(thermal, THERMAL_OFF, 'below', opts);
  const on01 = summarise(thermal, 0.1, 'above', opts);
  const on05 = summarise(thermal, 0.5, 'above', opts);
  return {
    rows,
    months,
    offSpell: spellOf(off),
    offNow: off.current ? { start: off.current.start, end: off.current.end } : null,
    on01Spell: spellOf(on01),
    on05Spell: spellOf(on05),
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(2)} GW`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const gwh = (v) => `${n0(v)} GWh`;
const pc = (v) => `${(v * 100).toFixed(1)}%`;
const hrs = (v) => `${n0(v)} hours`;
const days = (h) => `${n0(h / 24)} days`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function renderStory() {}
