// The Texas story: why ERCOT still burns gas after building more wind, solar
// and batteries than any other US grid. Demand has grown about as fast as the
// clean power, so gas has held level; what has changed is when it runs. It
// now backs off at noon and peaks after sunset, and the evening peak is where
// batteries have started to take its place.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import tx from '../countries/tx.js';
import { FOSSIL, GENERATION, metricSeries, byYear } from './data.js';

// Local hours the story compares: noon 10:00-14:59, evening 19:00-21:59,
// night 00:00-05:59.
const NOON = [10, 14];
const EVENING = [19, 21];
const NIGHT = [0, 5];
// The months a year is compared over, so the part year can join in: January to
// September.
const PART_MONTHS = 9;
// Fossil levels the story counts hours under, in GW.
export const FOSSIL_LOW = [10, 15, 20];
// Battery fleets (GW, GWh) the story tests against each day's evening hump.
export const BATTERIES = [[20, 40], [30, 80], [40, 120], [60, 240]];

/**
 * Local hour, month and day number for every slot. The Central offset is
 * looked up once per UTC day, so the hour around a clock change can be one off.
 */
function localClock(data) {
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
      offset = tzOffsetMs(d * 864e5 + 432e5, tx.timeZone);
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
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);
const inside = (h, [a, b]) => h >= a && h <= b;
const HOURLY = ['gas', 'coal', 'solar', 'wind', 'other', 'fossil', 'gen'];

/**
 * Every number the story uses. Rows run by Texas calendar year, complete
 * years only, then 'past365' for the latest 365 days. `part` holds January to
 * September of every year, the current one included.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const fossil = metricSeries(d, FOSSIL);
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const { gas, coal, solar, wind, other, nuclear } = data.columns;
  const { hour, month, day } = localClock(d);
  const gen = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    let g = 0;
    let any = false;
    for (const col of genCols) if (!Number.isNaN(col[i])) { g += Math.max(0, col[i]); any = true; }
    gen[i] = any ? g / 1000 : NaN;
  }
  const at = { gas, coal, solar, wind, other };
  const gwAt = (k, i) => (k === 'fossil' ? fossil[i] : k === 'gen' ? gen[i] : (at[k][i] || 0) / 1000);

  const init = () => ({
    twh: { gas: 0, coal: 0, solar: 0, wind: 0, nuclear: 0, other: 0, fossil: 0, gen: 0 },
    hourSum: Object.fromEntries(HOURLY.map((k) => [k, new Float64Array(24)])),
    hourN: new Float64Array(24),
    fosMonth: new Float64Array(12),
    fosMin: Infinity, fosMinAt: -1, fosMax: 0, fosMaxAt: -1,
    otherMax: 0, otherMaxAt: -1, solarMax: 0, solarMaxAt: -1,
    under: FOSSIL_LOW.map(() => 0),
    days: [], day: null,
  });
  const add = (r, i) => {
    const f = fossil[i];
    if (Number.isNaN(f)) return;
    const h = hour[i];
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(r.day);
      r.day = { n: day[i], month: month[i], noonMin: Infinity, fos: new Float64Array(24), fosN: new Float64Array(24) };
    }
    r.day.fos[h] += f;
    r.day.fosN[h]++;
    if (inside(h, NOON) && f < r.day.noonMin) r.day.noonMin = f;
    r.twh.fossil += (f * slotH) / 1000;
    r.twh.gen += (gen[i] * slotH) / 1000;
    for (const k of ['gas', 'coal', 'solar', 'wind', 'other']) r.twh[k] += ((at[k][i] || 0) * slotH) / 1e6;
    r.twh.nuclear += ((nuclear[i] || 0) * slotH) / 1e6;
    for (const k of HOURLY) r.hourSum[k][h] += gwAt(k, i);
    r.hourN[h]++;
    r.fosMonth[month[i] - 1] += (f * slotH) / 1000;
    if (f < r.fosMin) { r.fosMin = f; r.fosMinAt = i; }
    if (f > r.fosMax) { r.fosMax = f; r.fosMaxAt = i; }
    const o = (other[i] || 0) / 1000;
    if (o > r.otherMax) { r.otherMax = o; r.otherMaxAt = i; }
    const s = (solar[i] || 0) / 1000;
    if (s > r.solarMax) { r.solarMax = s; r.solarMaxAt = i; }
    FOSSIL_LOW.forEach((lv, k) => { if (f < lv) r.under[k] += slotH; });
  };
  const finish = (r) => {
    const days = (r.day ? [...r.days, r.day] : r.days).filter((x) => Number.isFinite(x.noonMin) && x.fosN.every((n) => n));
    // Each day's evening hump: fossil above that day's lowest midday level,
    // from 15:00 to midnight, in GWh, and its peak in GW. What a battery
    // charged at noon would have had to supply to hold fossil at its noon level.
    const humps = days.map((x) => {
      let gwh = 0;
      let peak = 0;
      for (let h = 15; h < 24; h++) {
        const above = Math.max(0, x.fos[h] / x.fosN[h] - x.noonMin);
        gwh += above;
        if (above > peak) peak = above;
      }
      return { gwh, peak, month: x.month, noon: x.noonMin };
    }).sort((a, b) => a.gwh - b.gwh);
    const hourly = Object.fromEntries(HOURLY.map((k) => [k, [...r.hourSum[k]].map((v, h) => mean(v, r.hourN[h]))]));
    const band = (k, hrs) => {
      let s = 0;
      let n = 0;
      for (let h = hrs[0]; h <= hrs[1]; h++) { s += r.hourSum[k][h]; n += r.hourN[h]; }
      return mean(s, n);
    };
    return {
      year: r.year,
      twh: r.twh,
      fosShare: r.twh.fossil / r.twh.gen,
      gasShare: r.twh.gas / r.twh.gen,
      coalShare: r.twh.coal / r.twh.gen,
      hourly,
      noon: Object.fromEntries(['gas', 'coal', 'fossil', 'gen', 'solar', 'other', 'wind'].map((k) => [k, band(k, NOON)])),
      evening: Object.fromEntries(['gas', 'coal', 'fossil', 'gen', 'solar', 'other', 'wind'].map((k) => [k, band(k, EVENING)])),
      night: Object.fromEntries(['gas', 'coal', 'fossil', 'gen', 'solar', 'other', 'wind'].map((k) => [k, band(k, NIGHT)])),
      fosMonth: [...r.fosMonth],
      fosMin: r.fosMin, fosMinAt: r.fosMinAt, fosMax: r.fosMax, fosMaxAt: r.fosMaxAt,
      otherMax: r.otherMax, otherMaxAt: r.otherMaxAt, solarMax: r.solarMax, solarMaxAt: r.solarMaxAt,
      under: r.under,
      days: humps.length,
      humps,
      medianHump: humps[Math.floor(humps.length / 2)] ?? null,
      batteries: BATTERIES.map(([gw, gwh]) => ({ gw, gwh, days: humps.filter((x) => x.gwh <= gwh && x.peak <= gw).length })),
    };
  };
  const rows = byYear(d, init, add).map(finish);

  // January to September of each year, so the year in progress can be compared.
  const part = new Map();
  for (let i = 0; i < end; i++) {
    if (month[i] > PART_MONTHS) continue;
    const y = new Date(day[i] * 864e5).getUTCFullYear();
    if (!part.has(y)) part.set(y, { gas: 0, coal: 0, fossil: 0, gen: 0, solar: 0, wind: 0, other: 0, n: 0 });
    const p = part.get(y);
    const f = fossil[i];
    if (Number.isNaN(f)) continue;
    p.n++;
    p.fossil += (f * slotH) / 1000;
    p.gen += (gen[i] * slotH) / 1000;
    for (const k of ['gas', 'coal', 'solar', 'wind', 'other']) p[k] += ((at[k][i] || 0) * slotH) / 1e6;
  }
  // Only years with every quarter hour from January to September (about 26,000).
  const partRows = [...part].filter(([, p]) => p.n >= 0.99 * 273 * 24 / slotH).map(([year, p]) => ({ year, ...p }));

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: tx.timeZone };
  return {
    rows,
    part: partRows,
    fossil10Spell: spellOf(summarise(fossil, 10, 'below', opts)),
    fossil15Spell: spellOf(summarise(fossil, 15, 'below', opts)),
  };
}
