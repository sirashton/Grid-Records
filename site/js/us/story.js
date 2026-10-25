// The United States story. Figures half: storyFigures() works out every
// number the page uses from the data, and the tests run it.
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import us from '../countries/us.js';
import { FOSSIL, GENERATION, byYear } from './data.js';

// Fossil levels the story counts hours under, in GW.
export const FOSSIL_LOW = [150, 175, 200];
const HOURLY = ['gas', 'coal', 'solar', 'battery', 'fossil'];
const YTD = ['fossil', 'coal', 'gas', 'solar', 'wind', 'nuclear', 'demand', 'gen'];

/**
 * Local (Eastern) hour, month, day of month, weekday and year for every slot.
 * The offset is looked up once per UTC day, so the hour around a clock change
 * can be one off.
 */
function localClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Uint8Array(data.length);
  const date = new Uint8Array(data.length);
  const weekday = new Uint8Array(data.length);
  const year = new Uint16Array(data.length);
  let utcDay = -1;
  let offset = 0;
  for (let i = 0; i < data.length; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== utcDay) {
      utcDay = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, us.timeZone);
    }
    const l = new Date(t + offset);
    hour[i] = l.getUTCHours();
    month[i] = l.getUTCMonth() + 1;
    date[i] = l.getUTCDate();
    weekday[i] = l.getUTCDay();
    year[i] = l.getUTCFullYear();
  }
  return { hour, month, date, weekday, year };
}

const mean = (sum, n) => (n ? sum / n : NaN);

/**
 * Every number the story uses. Rows run by calendar year (Eastern time),
 * complete years only, then 'past365'. Each row also carries `ytd`, its
 * totals from 1 January to the same day of the year as the latest data, so
 * the current year compares like for like (`ytdRows`, the current year
 * included).
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const slotH = stepOf(data) / 60;
  const { hour, month, date, weekday, year } = localClock(d);
  const C = data.columns;
  const gw = (k, i) => {
    const v = C[k]?.[i];
    return v == null || Number.isNaN(v) ? 0 : v / 1000;
  };
  const fossilAt = (i) => FOSSIL.reduce((s, k) => s + gw(k, i), 0);
  const genAt = (i) => GENERATION.reduce((s, k) => s + Math.max(0, gw(k, i)), 0);
  const valid = (i) => !Number.isNaN(C.gas[i]);
  // The latest day of the year the data reaches, to compare years over.
  const last = end - 1;
  const cut = month[last] * 100 + date[last];
  const inYtd = (i) => month[i] * 100 + date[i] <= cut;

  const init = () => ({
    twh: Object.fromEntries([...GENERATION, 'battery', 'battery_charge', 'pumped_storage_charge', 'imports', 'exports', 'demand', 'fossil', 'gen'].map((k) => [k, 0])),
    hourSum: Object.fromEntries(HOURLY.map((k) => [k, new Float64Array(24)])),
    hourN: new Float64Array(24),
    under: FOSSIL_LOW.map(() => 0),
    fMin: Infinity, fMinAt: -1, fMax: 0, fMaxAt: -1,
    coalMin: Infinity, coalMinAt: -1,
    solMax: 0, solMaxAt: -1, batMax: 0, batMaxAt: -1, demMax: 0, demMaxAt: -1,
    n: 0,
  });
  const add = (r, i) => {
    if (!valid(i)) return;
    const f = fossilAt(i);
    const g = genAt(i);
    for (const k of Object.keys(r.twh)) if (k !== 'fossil' && k !== 'gen') r.twh[k] += (Math.abs(gw(k, i)) * slotH) / 1000;
    r.twh.fossil += (f * slotH) / 1000;
    r.twh.gen += (g * slotH) / 1000;
    const h = hour[i];
    for (const k of HOURLY) r.hourSum[k][h] += k === 'fossil' ? f : gw(k, i);
    r.hourN[h]++;
    FOSSIL_LOW.forEach((lv, k) => { if (f < lv) r.under[k] += slotH; });
    if (f < r.fMin) { r.fMin = f; r.fMinAt = i; }
    if (f > r.fMax) { r.fMax = f; r.fMaxAt = i; }
    if (gw('coal', i) < r.coalMin) { r.coalMin = gw('coal', i); r.coalMinAt = i; }
    if (gw('solar', i) > r.solMax) { r.solMax = gw('solar', i); r.solMaxAt = i; }
    if (gw('battery', i) > r.batMax) { r.batMax = gw('battery', i); r.batMaxAt = i; }
    if (gw('demand', i) > r.demMax) { r.demMax = gw('demand', i); r.demMaxAt = i; }
    r.n += slotH;
  };
  const finish = (r) => ({
    year: r.year,
    twh: r.twh,
    hours: r.n,
    fossilShare: r.twh.fossil / r.twh.gen,
    coalShare: r.twh.coal / r.twh.gen,
    gasShare: r.twh.gas / r.twh.gen,
    solarShare: r.twh.solar / r.twh.gen,
    hourly: Object.fromEntries(HOURLY.map((k) => [k, [...r.hourSum[k]].map((v, h) => mean(v, r.hourN[h]))])),
    under: r.under,
    fMin: r.fMin, fMinAt: r.fMinAt, fMinHour: hour[r.fMinAt], fMinWeekday: weekday[r.fMinAt],
    fMax: r.fMax, fMaxAt: r.fMaxAt,
    coalMin: r.coalMin, coalMinAt: r.coalMinAt,
    solMax: r.solMax, solMaxAt: r.solMaxAt, batMax: r.batMax, batMaxAt: r.batMaxAt, demMax: r.demMax, demMaxAt: r.demMaxAt,
  });
  const rows = byYear(d, init, add).map(finish);

  // 1 January to the latest day, every year the data covers from January.
  const ytdRows = [];
  const firstYear = rows.find((r) => r.year !== 'past365')?.year;
  for (let i = 0; i < end; i++) {
    if (!valid(i) || !inYtd(i)) continue;
    const y = year[i];
    if (firstYear == null || y < firstYear) continue;
    let row = ytdRows.at(-1);
    if (row?.year !== y) {
      row = { year: y, ...Object.fromEntries(YTD.map((k) => [k, 0])), fMin: Infinity, fMinAt: -1, under: FOSSIL_LOW.map(() => 0) };
      ytdRows.push(row);
    }
    const f = fossilAt(i);
    for (const k of YTD) row[k] += ((k === 'fossil' ? f : k === 'gen' ? genAt(i) : gw(k, i)) * slotH) / 1000;
    if (f < row.fMin) { row.fMin = f; row.fMinAt = i; }
    FOSSIL_LOW.forEach((lv, k) => { if (f < lv) row.under[k] += slotH; });
  }
  for (const r of ytdRows) r.fossilShare = r.fossil / r.gen;

  // The lowest fossil hour on record.
  let lowAt = -1;
  for (let i = 0; i < end; i++) if (valid(i) && (lowAt < 0 || fossilAt(i) < fossilAt(lowAt))) lowAt = i;
  return { rows, ytdRows, ytdTo: { month: month[last], date: date[last] }, low: { gw: fossilAt(lowAt), at: lowAt, hour: hour[lowAt], weekday: weekday[lowAt] } };
}
