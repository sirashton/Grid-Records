// The Japan story: built around the last fossil fuel on the grid, in three
// parts (why it still runs, who pays and why solar goes off first, what is
// coming). The figures are worked out from the data by storyFigures(), which
// the tests also run; the per-area figures come from meta.areaStats, written
// by the build. Facts that are not in the data link to the source opened.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate, fmtDateTime } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { FOSSIL, LOW_CARBON, RENEWABLE, GENERATION, metricSeries, byYear } from './data.js';
import jp from '../countries/jp.js';

// Japan has no daylight saving: local time is UTC+9 all year.
const JST_MS = 9 * 3600000;
// Battery fleets (GW, GWh) the story tests against each day's LNG swing: the
// LNG burnt above that day's own lowest half hour, which a battery charged at
// midday could have replaced. The day's lowest level is left as it is.
export const BATTERIES = [[5, 20], [10, 40], [20, 80], [30, 150]];
// Fossil output levels the story counts hours under, in GW.
export const FOSSIL_LEVELS = [50, 40, 30, 25];
// The lowest-fossil half hours whose fuel mix shows what is left at the floor.
const FLOOR_SLOTS = 100;

/** Local hour, month (1-12) and day number for every slot. */
function localClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Uint8Array(data.length);
  const day = new Int32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const local = data.startMs + i * stepMs + JST_MS;
    const l = new Date(local);
    hour[i] = l.getUTCHours();
    month[i] = l.getUTCMonth() + 1;
    day[i] = Math.floor(local / 864e5);
  }
  return { hour, month, day };
}

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);
const ok = (v) => v != null && !Number.isNaN(v);

/**
 * Every number the story uses. Rows run by Japanese calendar year, complete
 * years only, then 'past365' for the latest 365 days. Fuel splits (LNG,
 * coal, oil) exist from April 2024 only; their sums count the hours that
 * have them (splitHours), and are NaN-free but partial for 2024.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const c = data.columns;
  const zero = new Float64Array(end);
  const col = (k) => c[k] ?? zero;
  const fossil = metricSeries(d, FOSSIL);
  const low = metricSeries(d, LOW_CARBON);
  const ren = metricSeries(d, RENEWABLE);
  const gen = metricSeries(d, GENERATION);
  const { hour, month, day } = localClock(d);
  const curtCols = [col('solar_curtailed'), col('wind_curtailed')];
  const curtAt = (i) => (ok(curtCols[0][i]) ? curtCols[0][i] : 0) + (ok(curtCols[1][i]) ? curtCols[1][i] : 0);
  const FUELS_TWH = ['demand', 'nuclear', 'hydro', 'solar', 'wind', 'geothermal', 'biomass', 'pumped_storage', 'other', 'battery', 'thermal'];
  const SPLIT = ['gas', 'coal', 'oil', 'thermal_other'];
  const hourKeys = ['thermal', 'gas', 'coal', 'solar', 'nuclear', 'curtailed', 'battery', 'pumped', 'demand'];

  const rows = byYear(d, () => ({
    slots: 0,
    twh: Object.fromEntries([...FUELS_TWH, ...SPLIT, 'curtailed', 'solar_curtailed', 'wind_curtailed', 'gen', 'battery_charge', 'pumped_storage_charge'].map((k) => [k, 0])),
    splitSlots: 0, lowSum: 0, renSum: 0, genSum: 0,
    fossilMin: Infinity, fossilMinAt: -1, fossilMax: -Infinity, fossilMaxAt: -1, fossilPctMin: Infinity, fossilPctMinAt: -1,
    gasMin: Infinity, gasMinAt: -1, coalMin: Infinity, coalMinAt: -1, gasMax: -Infinity, coalMax: -Infinity,
    solarMax: -Infinity, solarMaxAt: -1, batteryMax: 0, batteryMaxAt: -1, chargeMax: 0, curtMax: 0, curtMaxAt: -1,
    under: FOSSIL_LEVELS.map(() => 0),
    hourSum: Object.fromEntries(hourKeys.map((k) => [k, new Float64Array(24)])), hourN: new Float64Array(24), hourSplitN: new Float64Array(24),
    monthTwh: { thermal: new Float64Array(12), gas: new Float64Array(12), coal: new Float64Array(12), curtailed: new Float64Array(12), solar: new Float64Array(12) },
    curtH1: 0, curtSlots: 0, curt: { thermal: 0, gas: 0, coal: 0, nuclear: 0, solar: 0, splitN: 0 },
    floor: [], days: new Map(), coalOverGas: 0,
  }), (r, i) => {
    const fo = fossil[i];
    if (!ok(fo) || !ok(gen[i]) || gen[i] <= 0) return;
    r.slots++;
    const h = hour[i];
    const mo = month[i] - 1;
    const e = slotH / 1e6; // MW in one slot to TWh
    for (const k of FUELS_TWH) if (ok(c[k]?.[i])) r.twh[k] += Math.max(0, c[k][i]) * e;
    r.twh.battery_charge += Math.abs(ok(c.battery_charge?.[i]) ? c.battery_charge[i] : 0) * e;
    r.twh.pumped_storage_charge += Math.abs(ok(c.pumped_storage_charge?.[i]) ? c.pumped_storage_charge[i] : 0) * e;
    const cu = curtAt(i);
    r.twh.curtailed += cu * e;
    r.twh.solar_curtailed += (ok(c.solar_curtailed?.[i]) ? c.solar_curtailed[i] : 0) * e;
    r.twh.wind_curtailed += (ok(c.wind_curtailed?.[i]) ? c.wind_curtailed[i] : 0) * e;
    r.twh.gen += gen[i] * 1000 * e;
    r.lowSum += low[i];
    r.renSum += ren[i];
    r.genSum += gen[i];
    const pct = fo / gen[i];
    if (fo < r.fossilMin) { r.fossilMin = fo; r.fossilMinAt = i; }
    if (fo > r.fossilMax) { r.fossilMax = fo; r.fossilMaxAt = i; }
    if (pct < r.fossilPctMin) { r.fossilPctMin = pct; r.fossilPctMinAt = i; }
    FOSSIL_LEVELS.forEach((lv, k) => { if (fo < lv) r.under[k] += slotH; });
    const so = c.solar[i] / 1000;
    if (so > r.solarMax) { r.solarMax = so; r.solarMaxAt = i; }
    const bd = ok(c.battery?.[i]) ? c.battery[i] / 1000 : 0;
    const bc = ok(c.battery_charge?.[i]) ? -c.battery_charge[i] / 1000 : 0;
    if (bd > r.batteryMax) { r.batteryMax = bd; r.batteryMaxAt = i; }
    if (bc > r.chargeMax) r.chargeMax = bc;
    if (cu / 1000 > r.curtMax) { r.curtMax = cu / 1000; r.curtMaxAt = i; }
    if (mo < 6) r.curtH1 += cu * e;
    r.monthTwh.thermal[mo] += c.thermal[i] * e;
    r.monthTwh.curtailed[mo] += cu * e;
    r.monthTwh.solar[mo] += c.solar[i] * e;
    r.hourN[h]++;
    r.hourSum.thermal[h] += fo;
    r.hourSum.solar[h] += so;
    r.hourSum.nuclear[h] += c.nuclear[i] / 1000;
    r.hourSum.curtailed[h] += cu / 1000;
    r.hourSum.battery[h] += bd - bc;
    r.hourSum.pumped[h] += ((ok(c.pumped_storage?.[i]) ? c.pumped_storage[i] : 0) + (ok(c.pumped_storage_charge?.[i]) ? c.pumped_storage_charge[i] : 0)) / 1000;
    r.hourSum.demand[h] += c.demand[i] / 1000;
    const split = ok(c.gas?.[i]) && ok(c.coal?.[i]);
    if (cu > 0) {
      r.curtSlots++;
      r.curt.thermal += fo;
      r.curt.nuclear += c.nuclear[i] / 1000;
      r.curt.solar += so;
      if (split) { r.curt.gas += c.gas[i] / 1000; r.curt.coal += c.coal[i] / 1000; r.curt.splitN++; }
    }
    if (!split) return;
    r.splitSlots++;
    for (const k of SPLIT) if (ok(c[k]?.[i])) r.twh[k] += c[k][i] * e;
    const g = c.gas[i] / 1000;
    const co = c.coal[i] / 1000;
    r.monthTwh.gas[mo] += g * 1000 * e;
    r.monthTwh.coal[mo] += co * 1000 * e;
    r.hourSplitN[h]++;
    r.hourSum.gas[h] += g;
    r.hourSum.coal[h] += co;
    if (g < r.gasMin) { r.gasMin = g; r.gasMinAt = i; }
    if (co < r.coalMin) { r.coalMin = co; r.coalMinAt = i; }
    if (g > r.gasMax) r.gasMax = g;
    if (co > r.coalMax) r.coalMax = co;
    // Keep the lowest-fossil half hours with a fuel split.
    if (r.floor.length < FLOOR_SLOTS || fo < r.floor[r.floor.length - 1].fo) {
      r.floor.push({ fo, i });
      r.floor.sort((a, b) => a.fo - b.fo);
      if (r.floor.length > FLOOR_SLOTS) r.floor.pop();
    }
    if (co > g) r.coalOverGas += slotH;
    let dd = r.days.get(day[i]);
    if (!dd) r.days.set(day[i], (dd = { month: month[i], gas: [], solar: 0, curtailed: 0 }));
    dd.gas.push(g);
    dd.solar += so * slotH;
    dd.curtailed += (cu / 1000) * slotH;
  }).map((r) => {
    const hours = r.slots * slotH;
    const at = (i) => (i >= 0 ? slotTime(i, data.startMs, step) : null);
    const floorMix = (k) => mean(r.floor.reduce((s, x) => s + (ok(c[k]?.[x.i]) ? c[k][x.i] : 0), 0), r.floor.length) / 1000;
    // Each full day's LNG swing above its own lowest half hour (GWh), and its peak (GW).
    const fullDays = [...r.days.values()].filter((x) => x.gas.length === 1440 / step).map((x) => {
      const lo = Math.min(...x.gas);
      return { month: x.month, low: lo, swing: x.gas.reduce((s, v) => s + (v - lo) * slotH, 0), peak: Math.max(...x.gas) - lo, curtailed: x.curtailed, solar: x.solar };
    });
    const byHour = Object.fromEntries(hourKeys.map((k) => [k, [...r.hourSum[k]].map((v, hh) => mean(v, k === 'gas' || k === 'coal' ? r.hourSplitN[hh] : r.hourN[hh]))]));
    return {
      year: r.year,
      hours,
      splitHours: r.splitSlots * slotH,
      twh: r.twh,
      fossilPct: (r.twh.thermal / r.twh.gen) * 100,
      lowCarbonPct: mean(r.lowSum, r.genSum) * 100,
      renewablePct: mean(r.renSum, r.genSum) * 100,
      solarPct: (r.twh.solar / r.twh.gen) * 100,
      nuclearPct: (r.twh.nuclear / r.twh.gen) * 100,
      // Shares of thermal output by fuel, over the hours with a split.
      split: r.splitSlots ? Object.fromEntries(SPLIT.map((k) => [k, r.twh[k] / SPLIT.reduce((s, x) => s + r.twh[x], 0)])) : null,
      fossilMin: r.fossilMin, fossilMinAt: at(r.fossilMinAt),
      fossilMax: r.fossilMax, fossilMaxAt: at(r.fossilMaxAt),
      fossilPctMin: r.fossilPctMin * 100, fossilPctMinAt: at(r.fossilPctMinAt),
      gasMin: r.splitSlots ? r.gasMin : NaN, gasMinAt: at(r.gasMinAt),
      coalMin: r.splitSlots ? r.coalMin : NaN, coalMinAt: at(r.coalMinAt),
      gasMax: r.splitSlots ? r.gasMax : NaN,
      coalMax: r.splitSlots ? r.coalMax : NaN,
      solarMax: r.solarMax, solarMaxAt: at(r.solarMaxAt),
      batteryMax: r.batteryMax, batteryMaxAt: at(r.batteryMaxAt), chargeMax: r.chargeMax,
      curtMax: r.curtMax, curtMaxAt: at(r.curtMaxAt),
      curtH1: r.curtH1,
      hoursUnder: Object.fromEntries(FOSSIL_LEVELS.map((lv, k) => [lv, r.under[k]])),
      byHour,
      monthTwh: Object.fromEntries(Object.entries(r.monthTwh).map(([k, v]) => [k, [...v]])),
      // While solar or wind was being curtailed: hours, and what ran on average (GW).
      curtailing: {
        hours: r.curtSlots * slotH,
        thermal: mean(r.curt.thermal, r.curtSlots),
        nuclear: mean(r.curt.nuclear, r.curtSlots),
        solar: mean(r.curt.solar, r.curtSlots),
        gas: mean(r.curt.gas, r.curt.splitN),
        coal: mean(r.curt.coal, r.curt.splitN),
      },
      // The lowest-fossil half hours: what the remaining fossil output was made of (GW).
      floor: r.floor.length ? { n: r.floor.length, fossil: mean(r.floor.reduce((s, x) => s + x.fo, 0), r.floor.length), gas: floorMix('gas'), coal: floorMix('coal'), oil: floorMix('oil'), thermal_other: floorMix('thermal_other') } : null,
      // Days with a full fuel split: LNG above the floor (GWh) and whether each battery fleet could have covered it.
      // Hours with more coal than LNG running.
      coalOverGasHours: r.coalOverGas,
      days: fullDays.length,
      // LNG above each day's own low (TWh), and the part of it the same day's curtailed solar and wind could have covered through an ideal battery.
      swingTwh: fullDays.reduce((s, x) => s + x.swing, 0) / 1000,
      swingFromCurtailedTwh: fullDays.reduce((s, x) => s + Math.min(x.swing, x.curtailed), 0) / 1000,
      swingMedian: fullDays.length ? [...fullDays].sort((a, b) => a.swing - b.swing)[Math.floor(fullDays.length / 2)].swing : NaN,
      swingPeakMedian: fullDays.length ? [...fullDays].sort((a, b) => a.peak - b.peak)[Math.floor(fullDays.length / 2)].peak : NaN,
      lowMedian: fullDays.length ? [...fullDays].sort((a, b) => a.low - b.low)[Math.floor(fullDays.length / 2)].low : NaN,
      batteries: BATTERIES.map(([bgw, gwh]) => ({ gw: bgw, gwh, days: fullDays.filter((x) => x.swing <= gwh && x.peak <= bgw).length })),
    };
  });

  // Solar and wind held back from January to June of each year, for the
  // years whose first half the data covers completely (the current year
  // included, once June is over).
  const stepMs = step * 60000;
  const yearOf = (ms) => new Date(ms + JST_MS).getUTCFullYear();
  const yearStart = (y) => Date.UTC(y, 0, 1) - JST_MS;
  const julyStart = (y) => Date.UTC(y, 6, 1) - JST_MS;
  const h1 = new Map();
  for (let i = 0; i < end; i++) {
    const t = data.startMs + i * stepMs;
    const y = yearOf(t);
    if (t >= julyStart(y)) continue;
    h1.set(y, (h1.get(y) ?? 0) + (curtAt(i) * slotH) / 1e6);
  }
  const endMs = data.startMs + end * stepMs;
  const firstHalves = [...h1.entries()].filter(([y]) => yearStart(y) >= data.startMs && julyStart(y) <= endMs).map(([year, twh]) => ({ year, twh }));

  // Record spells over the whole record.
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: jp.timeZone };
  const spells = Object.fromEntries(FOSSIL_LEVELS.map((lv) => [lv, spellOf(summarise(fossil, lv, 'below', opts))]));
  return { rows, spells, firstHalves, splitFromMs: data.meta?.splitFromMs ?? null };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const twh = (v) => `${Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)} TWh`;
const gw1 = (v) => `${v.toFixed(1)} GW`;
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const words = (n) => WORDS[n] ?? String(n);
// Two decimals under 10 GW, where a tenth would hide the change.
const gw = (v) => `${Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1)} GW`;
const pc = (v) => `${Math.round(v)}%`;
const pc1 = (v) => `${v.toFixed(1)}%`;
const hrs = (v) => `${n0(v)} hours`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (key, text) => `<a href="${SOURCES[key]}">${text}</a>`;
const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The per-area figures the build writes to meta.areaStats, for one period
 * (a Japanese calendar year such as '2025', or 'past365'), with each area's
 * average fossil output and whether LNG or coal is its bigger fossil fuel.
 * Null unless every area has the period.
 */
export function areaFigures(meta, period) {
  const stats = meta?.areaStats;
  if (!stats) return null;
  const out = Object.entries(stats).map(([key, p]) => {
    const s = p?.[period];
    if (!s?.hours) return null;
    const w = Object.fromEntries(Object.entries(s.whileCurtailing ?? {}).map(([k, v]) => [k, v ?? NaN]));
    return { key, name: meta.areas?.[key]?.name ?? key, ...s, whileCurtailing: w, fossilGw: (s.twh.thermal * 1000) / s.hours, lngLed: s.twh.gas > s.twh.coal };
  });
  return out.every(Boolean) ? out : null;
}

/** The latest full year meta.areaStats has, preferring `year`. */
export function areaYear(meta, year) {
  const any = meta?.areaStats && Object.values(meta.areaStats)[0];
  if (!any) return null;
  if (any[String(year)]) return String(year);
  return Object.keys(any).filter((k) => /^\d{4}$/.test(k)).sort().at(-1) ?? null;
}

// Sources opened for the story.
export const SOURCES = {
  plan: 'https://www.enerdata.net/publications/daily-energy-news/japans-7th-strategic-energy-plan-focuses-nuclear-and-renewables-through-2040.html',
  order: 'https://www.occto.or.jp/en/works/no2.html',
  occtoKyushu: 'https://www.occto.or.jp/oshirase/shutsuryokuyokusei/2022/files/230327_kenshokekka.pdf',
  kyuden: 'https://www.kyuden.co.jp/var/rev0/0583/7111/iy3woe8b.pdf',
  rei2019: 'https://www.renewable-ei.org/en/activities/column/REupdate/20190409.php',
  rei2024: 'https://renewable-ei.org/en/activities/column/REupdate/20240411.php',
  pvTokyo: 'https://www.pv-magazine.com/2026/03/24/solar-curtailment-reaches-tokyo-japans-last-holdout-grid-area/',
  capacity: 'https://japanenergyhub.com/?p=7000',
  coalRule: 'https://www.argusmedia.com/en/news-and-insights/latest-market-news/2806874-japan-plans-temporary-ease-of-coal-power-restriction',
  coal2030: 'https://www.spglobal.com/energy/en/news-research/latest-news/electric-power/040921-japans-coal-power-share-to-drop-to-26-by-2030-31-on-regulatory-push-meti',
  ieefa: 'https://ieefa.org/articles/japans-declining-gas-demand-will-leave-utilities-persistent-lng-oversupply-through-2030',
  resales: 'https://greentechlead.com/renewable-energy/japan-transforms-into-global-lng-trading-hub-as-resales-hit-record-40-amid-shifting-energy-demand-52649',
  ltda: 'https://www.gtlaw.com/en/insights/2026/6/bess-and-the-japan-power-market-the-current-state-of-play-at-ltda-auction-round-3',
  ltda3: 'https://japanenergyhub.com/?p=16410',
  ltda3b: 'https://shulman-advisory.com/occto-awards-7-3-gw-in-latest-ltda-round-with-bess-competition-easing/',
  kk6: 'https://www.nucnet.org/news/japan-s-kashiwazaki-kariwa-6-resumes-commercial-operation-after-more-than-14-years-offline-4-5-2026',
  kk7: 'https://www.enerdata.net/publications/daily-energy-news/tepco-plans-restart-13-gw-reactor-kashiwazaki-kariwa-plant-japan.html',
  tomari: 'https://www.argusmedia.com/es/news-and-insights/latest-market-news/2763944-japan-s-hokkaido-approves-tomari-nuclear-restart',
  hvdc: 'https://japanenergyhub.com/?p=6803',
  iea: 'https://www.iea.org/articles/japan-electricity-security-policy',
  hida: 'https://www.hitachi.com/en/press/articles/2021/04/0401b/',
  offshore: 'https://www.bairdmaritime.com/offshore/renewables/offshore-wind/japan-to-re-auction-offshore-wind-sites-dumped-by-mitsubishi',
  ishikari: 'https://maritime-executive.com/article/japan-s-largest-offshore-wind-farm-starts-commercial-operations',
};

// Batteries contracted in the long-term decarbonisation auction (GW, minimum
// hours), from the sources above; round 3 is the lithium-ion count.
export const LTDA_BATTERIES = [[1.09, 3, 3], [1.4, 3, 6], [0.551, 6, 6]];

/** Draws the story from storyFigures() and, where the build wrote them, the per-area figures in meta. */
export function renderStory(data, end, figs) {
  const { rows, spells, firstHalves = [] } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (s) => (s ? ((s.end - s.start) * step) / 60 : 0);
  const when = (ms) => { const [d, t] = fmtDateTime(ms).split(', '); return `${t} on ${d}`; };
  const spellText = (s) => {
    if (!s) return 'none yet';
    const a = at(s.start);
    const b = at(s.end);
    return fmtDate(a) === fmtDate(b) ? `${hrs(spellH(s))}, ${when(a).replace(' on ', ' to ' + when(b).split(' on ')[0] + ' on ')}` : `${hrs(spellH(s))}, ${fmtDateTime(a)} to ${fmtDateTime(b)}`;
  };
  const minBy = (k) => rows.filter((r) => Number.isFinite(r[k])).reduce((a, r) => (r[k] < a[k] ? r : a));
  const maxBy = (k) => rows.filter((r) => Number.isFinite(r[k])).reduce((a, r) => (r[k] > a[k] ? r : a));
  const floorRow = minBy('fossilMin');
  const gasRow = minBy('gasMin');
  const coalRow = minBy('coalMin');
  const solarRow = maxBy('solarMax');
  const batRow = maxBy('batteryMax');
  const curtRow = maxBy('curtMax');
  const h1Max = firstHalves.length ? firstHalves.reduce((a, x) => (x.twh > a.twh ? x : a)) : null;
  const h1Of = (y) => firstHalves.find((x) => x.year === y);
  const lb = latest.byHour;
  const gasRise = lb.gas[18] - lb.gas[12];
  const coalRise = lb.coal[19] - lb.coal[12];
  const fossilRise = lb.thermal[18] - lb.thermal[12];
  const meta = data.meta;
  const yearKey = areaYear(meta, last.year);
  const areasY = yearKey ? areaFigures(meta, yearKey) : null;
  const areas365 = areaFigures(meta, 'past365');
  const area = (xs, key) => xs?.find((a) => a.key === key);
  const lngLed = areasY?.filter((a) => a.lngLed).map((a) => a.name) ?? [];
  const coalLed = areasY?.filter((a) => !a.lngLed) ?? [];
  const topCurt = areas365 ? areas365.reduce((a, x) => (x.twh.curtailed > a.twh.curtailed ? x : a)) : null;
  const tokyo365 = area(areas365, 'tepco');
  const tokyoY = area(areasY, 'tepco');
  const chubu365 = area(areas365, 'chubu');
  const hokkaido365 = area(areas365, 'hokkaido');
  const hokkaidoY = area(areasY, 'hokkaido');
  const tohokuY = area(areasY, 'tohoku');
  const kansaiY = area(areasY, 'kansai');
  const kyushuY = area(areasY, 'kyushu');
  const hokurikuY = area(areasY, 'hokuriku');
  const battGw = LTDA_BATTERIES.reduce((s, [g]) => s + g, 0);
  const battLo = LTDA_BATTERIES.reduce((s, [g, lo]) => s + g * lo, 0);
  const battHi = LTDA_BATTERIES.reduce((s, [g, , hi]) => s + g * hi, 0);
  const battDays = (g) => latest.batteries.find((b) => b.gw === g)?.days ?? 0;
  const floors = [first, row(2019), row(2023), floorRow].filter((r, k, xs) => r && xs.indexOf(r) === k);
  const goldenWeek = full.every((r) => r.fossilMinAt == null || [3, 4].includes(new Date(r.fossilMinAt + 9 * 3600000).getUTCMonth()));
  const split = (r) => r.split ?? { gas: NaN, coal: NaN };

  // Header and in short.
  $('lede').textContent = `Japan's nine connected grid areas made ${twh(latest.twh.thermal)} of electricity from LNG, coal and oil in the latest 365 days, ${pc(latest.fossilPct)} of the total, and their fossil plants have never come close to all stopping: the lowest they have run at is ${gw(floorRow.fossilMin)}, for one half hour at ${when(floorRow.fossilMinAt)}.`;
  $('answer-lead').textContent = `The last fossil fuel on Japan's grid is LNG. It is most of what is left at the fossil floor, and it does the daily swing that solar cannot: ${gw(lb.gas[12])} at noon and ${gw(lb.gas[18])} at six in the evening on an average day in the latest 365 days. Coal runs flatter underneath it${coalLed.length ? `, and in ${words(coalLed.length)} of the nine areas coal is the bigger fossil fuel` : ''}. Nothing yet dated takes either to zero: the 2040 plan still has thermal at 30 to 40% of generation. So the records to watch are the LNG floor, the fossil floor in Golden Week, and how long fossil output can stay under 40 GW.`;
  const kyushu365 = area(areas365, 'kyushu');
  $('answer-points').innerHTML = [
    `<b>LNG runs for the evening and the winter, and about ${Math.round(latest.lowMedian)} GW of it never stops.</b> On the median day of the latest 365 days LNG never fell below ${gw(latest.lowMedian)}, and rose ${gw(latest.swingPeakMedian)} above that by evening. LNG made ${twh(latest.monthTwh.gas[0])} in January and ${twh(latest.monthTwh.gas[4])} in May. Coal moves less: ${gw(lb.coal[12])} at noon, ${gw(lb.coal[19])} at seven in the evening. ${link(1, 'Chapter 1')}`,
    `<b>The rules and the contracts keep fossil on while solar is switched off.</b> Japan's dispatch rule turns thermal plants down to their minimum, pumps water, sends power to other areas and cuts biomass before it cuts solar and wind; nuclear comes last. While solar or wind was being curtailed somewhere, ${gw(latest.curtailing.thermal)} of fossil was still running across the nine areas${kyushu365 && Number.isFinite(kyushu365.whileCurtailing.thermal) ? `, but in Kyushu, the area that curtails most, only ${gw(kyushu365.whileCurtailing.thermal)} was left while it curtailed, ${gw(kyushu365.whileCurtailing.coal)} of it coal` : ''}. ${link(2, 'Chapter 2')}`,
    `<b>What is coming moves the floor, not the evening.</b> Kashiwazaki-Kariwa 6 is back, Tomari 3 should follow in 2027, about ${Math.round(battGw)} GW of batteries are due by March 2031, and the links between areas grow. Those cut the Golden Week floor and the curtailment. Against a median daily LNG swing of ${n0(latest.swingMedian)} GWh they are small: a 20 GW, 80 GWh fleet would have covered the whole swing on ${battDays(20)} days of the latest 365. ${link(3, 'Chapter 3')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--fossil', 'Fossil share, latest 365 days', pc1(latest.fossilPct), `from ${pc1(first.fossilPct)} in ${first.year}`],
    ['--f-gas', 'Lowest LNG', gw(gasRow.gasMin), `at ${when(gasRow.gasMinAt)}, the record`],
    ['--f-solar', 'Solar and wind held back, latest 365 days', twh(latest.twh.curtailed), h1Max ? `the most in the first half of any year: ${twh(h1Max.twh)}, in ${h1Max.year}` : ''],
    ['--lowcarbon', 'Longest run with fossil under 40 GW', spells[40] ? hrs(spellH(spells[40])) : 'None yet', spells[40] ? `from ${when(at(spells[40].start))}, the record to beat` : 'the record to set'],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${gw(floorRow.fossilMin)}</div><div class="sub">The least fossil power the nine areas have run on, at ${when(floorRow.fossilMinAt)}, with solar near its spring peak. In ${first.year} the lowest was ${gw(first.fossilMin)}.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Three chapters: why LNG and coal still run, who pays each plant and why solar is switched off before coal, and what is coming, with the record each item should move.';

  const chapters = [
    'LNG does the evening, coal does the night',
    'Who pays each plant, and why solar goes off before coal',
    'What is coming, and which records it moves',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 2) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const cats = rows.map((r) => label(r.year));

  // Chapter 1.
  $('take-1').textContent = `Fossil fell from ${pc(first.fossilPct)} of generation in ${first.year} to ${pc(latest.fossilPct)} in the latest 365 days, but on an average day it still rises ${gw1(fossilRise)} between noon and six in the evening, and ${gw1(gasRise)} of that rise is LNG.`;
  const p1 = [
    `Japan's fossil output has fallen by about ${pc((1 - latest.twh.thermal / first.twh.thermal) * 100)} since ${first.year}: ${twh(first.twh.thermal)} then, ${twh(last.twh.thermal)} in ${last.year} and ${twh(latest.twh.thermal)} in the latest 365 days. Two things did it. Nuclear came back, from ${twh(first.twh.nuclear)} in ${first.year} to ${twh(last.twh.nuclear)} in ${last.year}${full.every((r) => r.twh.nuclear <= last.twh.nuclear) ? ', the most in the data' : ''}${kansaiY && kyushuY ? `; Kansai made ${twh(kansaiY.twh.nuclear)} of it in ${yearKey} and Kyushu ${twh(kyushuY.twh.nuclear)}` : ''}. And solar doubled, from ${twh(first.twh.solar)} to ${twh(last.twh.solar)}, though it has flattened at about ${pc(latest.solarPct)} of generation since ${row(2023) ? 2023 : last.year}. Wind is still small, at ${twh(latest.twh.wind)}.`,
    `The fuel split only exists from April 2024, when the nine operators moved to a shared half-hourly format. In the latest 365 days LNG made ${twh(latest.twh.gas)} and coal ${twh(latest.twh.coal)}; oil and other thermal, mostly by-product gases, made ${twh(latest.twh.oil + latest.twh.thermal_other)}. They behave differently. Coal moves less through the day: ${gw(lb.coal[0])} at midnight, ${gw(lb.coal[12])} at noon, ${gw(lb.coal[19])} at seven in the evening. LNG follows demand: ${gw(lb.gas[1])} at one in the morning, ${gw(lb.gas[12])} at noon when solar is at ${gw(lb.solar[12])}, then ${gw(lb.gas[18])} at six in the evening as solar fades and demand is still ${gw(lb.demand[18])}. Pumped storage does what it can: on average it is pumping ${gw(-lb.pumped[12])} at noon and generating ${gw(lb.pumped[18])} at six, and ${twh(latest.twh.pumped_storage_charge)} went into pumping over the year. Grid batteries in the operators' figures peaked at ${gw(latest.batteryMax)}.`,
    `The seasons matter as much as the hours. In the latest 365 days fossil output was ${twh(latest.monthTwh.thermal[0])} in January and ${twh(latest.monthTwh.thermal[4])} in May. LNG took most of the cut, ${twh(latest.monthTwh.gas[0])} in January against ${twh(latest.monthTwh.gas[4])} in May; coal went from ${twh(latest.monthTwh.coal[0])} to ${twh(latest.monthTwh.coal[4])}. ${goldenWeek ? 'The floor comes every year in Golden Week, the run of holidays from late April to early May, when demand is low and the sun is high: ' : 'The yearly lows: '}${list(floors.map((r) => `${gw(r.fossilMin)} at ${when(r.fossilMinAt)}`))}.`,
    latest.floor && last.floor ? `What is left at the floor is mostly LNG. Across the hundred lowest-fossil half hours of ${last.year}, fossil averaged ${gw(last.floor.fossil)}: ${gw(last.floor.gas)} of LNG, ${gw(last.floor.coal)} of coal, ${gw(last.floor.oil)} of oil and ${gw(last.floor.thermal_other)} of other thermal. The lowest single LNG reading is ${gw(gasRow.gasMin)}, at ${when(gasRow.gasMinAt)}. Coal's lowest was ${gw(coalRow.coalMin)}, at ${when(coalRow.coalMinAt)}, lower than its daily profile suggests, which looks like units being cycled or out for spring maintenance (inferred from the data, not sourced). At night coal is often the bigger of the two: it ran above LNG for ${hrs(latest.coalOverGasHours)} of the latest 365 days.` : '',
    areasY ? `The national picture hides where each fuel lives. In ${yearKey} Tokyo made ${twh(tokyoY.twh.gas)} from LNG and ${twh(tokyoY.twh.coal)} from coal. LNG was the bigger fossil fuel in ${list(lngLed)}; coal in the other ${words(coalLed.length)}${hokurikuY ? `: Hokuriku, for one, made ${twh(hokurikuY.twh.coal)} from coal and ${twh(hokurikuY.twh.gas)} from LNG, Kyushu ${twh(kyushuY.twh.coal)} and ${twh(kyushuY.twh.gas)}` : ''}. So the national floor is mostly an LNG floor in the big LNG areas, and in most of the country the last fossil fuel is coal.${tohokuY ? ` Some fossil output is not for the area that makes it: Tohoku generated ${twh(tohokuY.twh.thermal)} of fossil power against ${twh(tohokuY.twh.demand)} of its own demand, and sells into Tokyo. The area figures here are generation, not consumption.` : ''}` : '',
    `So the evening ramp and the winter are real demand that nothing else yet meets, and that is LNG. The ${Math.round(floorRow.fossilMin)} GW or so of fossil that never switches off, even at noon in Golden Week, is a mix of coal that is not designed to stop, the minimum output of plants kept on for reserve and frequency control (inferred), and the output the dispatch rules protect. That is the subject of chapter 2.`,
  ];
  $('body-1').innerHTML = p1.filter(Boolean).map((p) => `<p>${p}</p>`).join('');
  $('chart-h-1').textContent = 'LNG, coal, solar and nuclear by hour of day';
  $('chart-hint-1').textContent = `Average output at each hour, Japan time, in GW, over the latest 365 days. LNG rises ${gw1(gasRise)} between noon and six; coal rises ${gw1(coalRise)} between noon and seven.`;
  const hourX = (hr) => hr * 3600000;
  const lines = [
    ['LNG', '--f-gas', lb.gas],
    ['Coal', '--f-coal', lb.coal],
    ['Solar', '--f-solar', lb.solar],
    ['Nuclear', '--f-nuclear', lb.nuclear],
  ].map(([name, color, v]) => ({ name, color: css(color), points: v.map((x, hr) => [hourX(hr), x]), width: 2.5 }));
  lineChart($('story-chart-1'), {
    series: lines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) })),
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}<div>Demand: <b>${gw(lb.demand[Math.round(t / 3600000)])}</b></div>`,
  });
  $('story-legend-1').innerHTML = legend(lines.map((sr) => [sr.name, sr.color]));

  // Chapter 2.
  $('take-2').textContent = `While solar or wind was being switched off in the latest 365 days, ${gw(latest.curtailing.thermal)} of fossil plant was still running, ${gw(latest.curtailing.gas)} of it LNG and ${gw(latest.curtailing.coal)} coal: the rules turn thermal down to its minimum before they cut solar, and capacity payments and fuel contracts pay the plants whether or not the noon market wants them.`;
  const firstCurt = full.find((r) => r.twh.curtailed > 0);
  const tokyoHours = tokyo365?.curtHours ?? 0;
  const p2 = [
    'This page has no price data, so this chapter leans on the rules and the contracts, and on what the operators\' figures show happening under them.',
    `Start with the rule. When supply exceeds demand, the operators follow a fixed order set by the grid coordinator, OCCTO. First they turn down the balancing plant they have contracted and pump water into pumped storage and charge batteries; next, other thermal plant; then they send power to other areas over the interconnectors; then they cut biomass; then solar and wind; and only after that, on OCCTO's instruction, the "long-term fixed" sources: nuclear, hydro and geothermal (${src('order', 'OCCTO')}). Kyushu describes the same order for its area (${src('kyuden', 'Kyushu Electric')}). Thermal is turned down, not off. In OCCTO's review of curtailment on Kyushu's islands, the thermal minimum is 50% of each unit's rated output, kept so the units can still regulate and cover a sudden drop in solar (${src('occtoKyushu', 'OCCTO review')}). No figure for the mainland is published in a form this page can cite. The Renewable Energy Institute has argued since 2019 that the order is uneconomic, since it cuts solar, which costs nothing to run, before plants that burn fuel (${src('rei2019', '2019')}, ${src('rei2024', '2024')}).`,
    `The data shows the rule at work. Curtailment first appears in ${firstCurt?.year ?? 2018}, at ${twh(firstCurt?.twh.curtailed ?? 0)}; it was ${twh(row(2023)?.twh.curtailed ?? 0)} in 2023, ${twh(last.twh.curtailed)} in ${last.year} and ${twh(latest.twh.curtailed)} in the latest 365 days. ${h1Max ? `The most in the first half of a year was ${twh(h1Max.twh)}, in ${h1Max.year}.` : ''}${h1Of(2025) ? ` The first half of 2025 was ${twh(h1Of(2025).twh)} in the operators' files, reported at the time as 1.74 TWh (${src('pvTokyo', 'pv magazine')}).` : ''} The largest single half hour was ${gw(curtRow.curtMax)}, at ${when(curtRow.curtMaxAt)}. Tokyo, the last area without curtailment, ordered its first cut on 1 March 2026 (${src('pvTokyo', 'pv magazine')})${tokyoHours ? `, and the latest 365 days show ${hrs(tokyoHours)} of it there` : ''}.`,
    topCurt && Number.isFinite(topCurt.whileCurtailing.thermal) ? `Where the fossil runs while this happens is the point. Across the nine areas, during curtailment, fossil averaged ${gw(last.curtailing.thermal)} in ${last.year} and ${gw(latest.curtailing.thermal)} in the latest 365 days, with nuclear at ${gw(latest.curtailing.nuclear)} and solar at ${gw(latest.curtailing.solar)}. But ${topCurt.name} does the most curtailing, ${twh(topCurt.twh.curtailed)} over ${hrs(topCurt.curtHours)} in the latest 365 days, and in ${topCurt.name} itself only ${gw(topCurt.whileCurtailing.thermal)} of fossil was still on while it did, ${gw(topCurt.whileCurtailing.gas)} of LNG and ${gw(topCurt.whileCurtailing.coal)} of coal, next to ${gw(topCurt.whileCurtailing.nuclear)} of nuclear. Why that much stays on is not published; the minimum output of units kept on for reserve, and the inertia and voltage support they give, are the likely reasons (inferred). The national figure is mostly in areas that were not curtailing: Tokyo and Chubu alone average ${gw(tokyo365.fossilGw + chubu365.fossilGw)} of fossil output across the year, and the links that would carry western solar to them are limited (Kyushu's link to Chugoku is about 2.5 GW, ${src('rei2024', 'REI')}). So for the country as a whole the problem is transmission, and inside ${topCurt.name} it is about ${Math.round(topCurt.whileCurtailing.thermal)} GW of mostly ${topCurt.whileCurtailing.coal > topCurt.whileCurtailing.gas ? 'coal' : 'LNG'} that the rule leaves running.` : '',
    'Now who pays. Three streams keep the fossil fleet on beyond the energy it sells.',
    `The capacity market pays plants to exist. OCCTO's auction for delivery in fiscal 2028 cleared 166.2 GW at an average of 11,134 yen per kilowatt: 14,812 yen in Hokkaido, Tohoku and Tokyo and 13,177 yen in Kyushu, up from 7,874 yen the year before (${src('capacity', 'Japan Energy Hub')}). A coal or LNG plant collects that whether it runs at noon or not. The market does penalise inefficient coal: a plant under 42% design efficiency must keep its capacity factor at or below 50% or lose 20% of its capacity revenue. METI suspended that limit for fiscal 2026 to save LNG while imports from the Middle East were uncertain (${src('coalRule', 'Argus')}). Coal's share of fossil output went from ${pc(split(last).coal * 100)} in ${last.year} to ${pc(split(latest).coal * 100)} in the latest 365 days, and the suspension may be one reason (inferred).`,
    `The long-term decarbonisation auction pays new low-carbon capacity, and some gas, a fixed sum for twenty years. Its three rounds so far have contracted batteries, pumped storage, nuclear safety work and, in the latest, the first new reactor, Oma 1 (${src('ltda3', 'Japan Energy Hub')}). Those contracts are in chapter 3.`,
    `The LNG contracts are the third stream, and they help explain why the swing is LNG rather than coal. Japan's utilities buy most of their LNG on long-term contracts, and demand has fallen faster than the contracts: IEEFA put the big buyers at about 11 million tonnes a year over-contracted for the rest of the decade (${src('ieefa', 'IEEFA')}). The surplus is resold: 40% of Japan's contracted LNG was resold abroad in fiscal 2024, from 16% in 2018 (${src('resales', 'GreentechLead')}). LNG is the fuel that flexes: it is turned down at noon and up at six, and ${twh(latest.swingTwh)} of the year's ${twh(latest.twh.gas)} of LNG, about ${pc((latest.swingTwh / latest.twh.gas) * 100)}, was burnt above each day's own lowest half hour.`,
    `Coal holds up better at the bottom. In the latest 365 days its lowest half hour was ${gw(latest.coalMin)}, against LNG's ${gw(latest.gasMin)}, and across the hundred lowest-fossil half hours coal averaged ${gw(latest.floor?.coal ?? NaN)} to LNG's ${gw(latest.floor?.gas ?? NaN)}.`,
    `What could the curtailed power have replaced? Not much of the swing. In the latest 365 days the same day's curtailed solar and wind, through a perfect battery, could have covered ${twh(latest.swingFromCurtailedTwh)} of the ${twh(latest.swingTwh)} LNG swing, ${pc((latest.swingFromCurtailedTwh / latest.swingTwh) * 100)}. Curtailment is a spring problem; the swing happens every day of the year.`,
  ];
  $('body-2').innerHTML = p2.filter(Boolean).map((p) => `<p>${p}</p>`).join('');
  if (areas365) {
    $('chart-h-2').textContent = 'Fossil still running while each area curtails';
    $('chart-hint-2').textContent = 'Average LNG, coal and other fossil output during the half hours each area was curtailing solar or wind, in GW, over the latest 365 days. The curtailed energy is in the tooltip.';
    const v = (a, k) => (Number.isFinite(a.whileCurtailing[k]) ? a.whileCurtailing[k] : 0);
    const ch2 = [
      ['LNG', '--f-gas', (a) => v(a, 'gas')],
      ['Coal', '--f-coal', (a) => v(a, 'coal')],
      ['Oil and other thermal', '--f-diesel', (a) => Math.max(0, v(a, 'thermal') - v(a, 'gas') - v(a, 'coal'))],
    ].map(([name, color, f]) => ({ name, color: css(color), values: areas365.map(f) }));
    barChart($('story-chart-2'), {
      cats: areas365.map((a) => a.name),
      stacks: ch2,
      yFormat: gw,
      yTickFormat: (x) => `${x}`,
      tooltip: (ci) => {
        const a = areas365[ci];
        return `<strong>${a.name}</strong>${a.curtHours ? `<div>Curtailing for <b>${hrs(a.curtHours)}</b>, <b>${twh(a.twh.curtailed)}</b> held back</div>${[...ch2].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${gw(sr.values[ci])}</b></div>`).join('')}<div>Nuclear: <b>${gw(v(a, 'nuclear'))}</b></div>` : '<div>No curtailment</div>'}`;
      },
    });
    $('story-legend-2').innerHTML = legend(ch2.map((sr) => [sr.name, sr.color]));
  }

  // Chapter 3.
  const nuclearBack = 1.315 + 0.912;
  $('take-3').textContent = `The dated changes to 2031 bring back about ${gw1(nuclearBack)} of nuclear in Tokyo and Hokkaido, add about ${Math.round(battGw)} GW of batteries, take the links between east and west Japan to 3 GW and plan a 2 GW cable from Hokkaido. They should push the Golden Week floor under ${gw(floorRow.fossilMin)} and stretch the run under 40 GW past a week (inferred), but the 2040 plan still keeps thermal at 30 to 40% of generation.`;
  const y2017 = row(2017) ?? first;
  const p3 = [
    `The items are listed below, with dates and the record each should move. Together they say two things. First, the Golden Week floor keeps falling: more nuclear in Tokyo and Hokkaido and more room to move power between areas both take fossil out of the half hours that already have the least of it. Hours with fossil under 40 GW went from ${n0(y2017.hoursUnder[40])} in ${y2017.year} to ${n0(row(2023)?.hoursUnder[40] ?? 0)} in 2023 and ${n0(latest.hoursUnder[40])} in the latest 365 days; under 30 GW, from ${n0(y2017.hoursUnder[30])} to ${n0(latest.hoursUnder[30])}.`,
    `Second, the evening is not addressed. The median day's LNG swing was ${n0(latest.swingMedian)} GWh in the latest 365 days, with a peak ${gw(latest.swingPeakMedian)} above the day's low. A battery fleet of 5 GW and 20 GWh would have covered the whole swing on ${battDays(5)} days of the year, 10 GW and 40 GWh on ${battDays(10)}, 20 GW and 80 GWh on ${battDays(20)}, and 30 GW and 150 GWh on ${battDays(30)}. The batteries contracted so far come to about ${Math.round(battGw)} GW; at the auctions' minimum durations, three to six hours, that is roughly ${Math.round(battLo)} to ${Math.round(battHi)} GWh (the builder's estimate). They will show in the operators' battery figures, which peaked at ${gw(batRow.batteryMax)}, and they will shave the evening, but LNG keeps the evening until something many times larger arrives.`,
    `The Seventh Strategic Energy Plan, approved in February 2025, sets 2040 at renewables 40 to 50%, nuclear about 20% and thermal 30 to 40%, from about 69% thermal in fiscal 2023 (${src('plan', 'Enerdata')}). On this page's measure the nine areas are already at ${pc1(latest.fossilPct)} fossil, so the plan's low end is about halving in fifteen years, and its high end is not far from where the grid already is.`,
  ];
  $('body-3').innerHTML = p3.map((p) => `<p>${p}</p>`).join('');
  $('chart-h-3').textContent = 'Hours a year with fossil under 40 GW and under 30 GW';
  $('chart-hint-3').textContent = 'The whole bar is the hours under 40 GW; the darker part, under 30 GW. The lowest half hour each year is in the tooltip. The last bar is the latest 365 days.';
  const ch3 = [
    { name: 'Under 30 GW', color: css('--lowcarbon'), values: rows.map((r) => r.hoursUnder[30]) },
    { name: '30 to 40 GW', color: css('--f-solar'), values: rows.map((r) => r.hoursUnder[40] - r.hoursUnder[30]) },
  ];
  barChart($('story-chart-3'), {
    cats,
    stacks: ch3,
    yFormat: (x) => hrs(x),
    yTickFormat: (x) => `${x}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under 40 GW: <b>${n0(rows[ci].hoursUnder[40])}</b></div><div>Hours under 30 GW: <b>${n0(rows[ci].hoursUnder[30])}</b></div><div>Lowest fossil: <b>${gw(rows[ci].fossilMin)}</b>${rows[ci].fossilMinAt ? ` on ${fmtDate(rows[ci].fossilMinAt)}` : ''}</div>`,
  });
  $('story-legend-3').innerHTML = legend(ch3.map((sr) => [sr.name, sr.color]));

  // What is coming: date, item, sources, and the record to watch.
  const coming = [
    ['16 April 2026, done', `Kashiwazaki-Kariwa 6 (1,315 MW, Tokyo area) resumed commercial operation after more than fourteen years, Tokyo's first nuclear output since 2012. It runs until an inspection in April 2027.${tokyo365 ? ` Tokyo's nuclear output was ${twh(tokyo365.twh.nuclear)} in the latest 365 days${tokyoY && tokyoY.twh.nuclear < 0.05 ? `, from none in ${yearKey}` : ''}.` : ''}`, ['kk6'], `the LNG floor, ${gw(gasRow.gasMin)}, and LNG under 10 GW again.`],
    ['No date', 'Kashiwazaki-Kariwa 7 has the same local approval and filed its pre-operation paperwork on 24 December 2025, but TEPCO has given no restart date.', ['kk7'], `nuclear above 12 GW (it averaged ${gw(latest.twh.nuclear * 1000 / latest.hours)} in the latest 365 days), and Tokyo's LNG at noon in May.`],
    ['2027', `Tomari 3 (912 MW, Hokkaido): the governor approved the restart on 10 December 2025 and Hepco aims for as early as possible in 2027. Hokkaido has had no nuclear power since May 2012.${hokkaidoY ? ` It made ${twh(hokkaidoY.twh.coal)} from coal in ${yearKey}, of ${twh(hokkaidoY.twh.thermal)} from fossil fuels.` : ''}`, ['tomari'], `Hokkaido's lowest fossil output${hokkaido365 ? `, ${gw(hokkaido365.thermalMin)} in the latest 365 days` : ''}, and coal under 20 GW nationally overnight.`],
    ['By 31 March 2027', 'The 50/60 Hz frequency converters between east and west Japan reach 3 GW, from 1.2 GW before the 900 MW Hida station opened in April 2021.', ['iea', 'hida'], 'curtailment hours in Chubu and Kansai, and the national fossil floor, since western nuclear and solar can reach Tokyo\'s LNG.'],
    ['By 31 March 2029, 2030 and 2031', 'Batteries from the long-term decarbonisation auction: about 1,090 MW from round 1, about 1.4 GW from round 2, and 551 MW of lithium-ion from round 3 in May 2026. Round 3 awarded 1.25 GW of storage in all; the other 700 MW is other technologies, which include new pumped hydro.', ['ltda', 'ltda3', 'ltda3b'], `battery output above 1, 2 and 3 GW, from a record of ${gw(batRow.batteryMax)}.`],
    ['Early 2030s', 'A 2 GW HVDC cable from Hokkaido to Honshu along the Sea of Japan coast, at 1.5 to 1.8 trillion yen; OCCTO puts construction at six to ten years. The existing link was raised to 900 MW in 2019.', ['hvdc', 'iea'], 'Hokkaido curtailment, and wind above 4, 5 and 6 GW nationally as Hokkaido\'s output can leave the island.'],
    ['2030', 'Inefficient coal: the 2020 policy phases out inefficient coal units by 2030, and the capacity market docks 20% of their revenue if they run above a 50% capacity factor, except in fiscal 2026, when METI suspended the limit to save LNG.', ['coalRule', 'coal2030'], `coal's lowest half hour, ${gw(coalRow.coalMin)}, coal under 15 and 10 GW, and whether coal's share of fossil, ${pc(split(latest).coal * 100)} now, passes LNG's ${pc(split(latest).gas * 100)}.`],
    ['2028 to 2030, then later', 'Offshore wind: Mitsubishi walked away from 1.76 GW of first-round sites in Akita and Chiba on 27 August 2025, and the government will auction them again; the targets are 10 GW by 2030 and 45 GW by 2040. The largest running today is Ishikari Bay, 112 MW, from January 2024.', ['offshore', 'ishikari'], 'wind above 3 GW, and winter fossil under 50 GW, since offshore wind is the one item here that works in January.'],
    ['February 2025, for 2040', 'The Seventh Strategic Energy Plan: renewables 40 to 50%, nuclear about 20%, thermal 30 to 40%.', ['plan'], `the yearly fossil share, ${pc1(latest.fossilPct)} in the latest 365 days.`],
  ];
  $('coming').innerHTML = coming.map(([when, what, sources, watch]) => `<li><span class="swatch" style="background:var(--fossil)"></span><span><b>${when}.</b> ${what} (${sources.map((s, k) => src(s, k ? `${k + 1}` : 'source')).join(', ')}) <span class="sub">Watch: ${watch}</span></span></li>`).join('');
  $('coming-h').hidden = false;

  // Records to watch, with the current record.
  const watch = [
    ['Fossil under 25 GW, longest run', spellText(spells[25]), 'The first run under 20 GW is still open.'],
    ['Fossil under 30 GW, longest run', spellText(spells[30]), 'A run through a night would need the evening LNG to fall, so this is the one that says whether storage is arriving.'],
    ['Fossil under 40 GW, longest run', spellText(spells[40]), 'A full week is the next mark.'],
    ['Fossil under 50 GW, longest run', spellText(spells[50]), ''],
    ['Lowest fossil half hour', `${gw(floorRow.fossilMin)}, ${fmtDateTime(floorRow.fossilMinAt)}`, 'Then under 15 GW.'],
    ['Lowest LNG', `${gw(gasRow.gasMin)}, ${fmtDateTime(gasRow.gasMinAt)}`, 'Then under 5 GW.'],
    ['Lowest coal', `${gw(coalRow.coalMin)}, ${fmtDateTime(coalRow.coalMinAt)}`, 'Coal under 5 GW for an hour.'],
    ['Most solar', `${gw(solarRow.solarMax)}, ${fmtDateTime(solarRow.solarMaxAt)}`, 'Solar above 60 GW.'],
    ['Most battery output', `${gw(batRow.batteryMax)}, ${fmtDateTime(batRow.batteryMaxAt)}`, 'Above 1 GW.'],
    ['Most solar and wind held back', `${gw(curtRow.curtMax)}, ${fmtDateTime(curtRow.curtMaxAt)}`, 'Fewer hours of curtailment, not more, is the sign that the converters and the Hokkaido cable are working.'],
    ['Hours a year with fossil under 40 GW', `${n0(latest.hoursUnder[40])} in the latest 365 days`, 'The first year over 1,000 hours.'],
  ];
  $('watch').innerHTML = watch.map(([l, v, w]) => `<li><span class="swatch" style="background:var(--lowcarbon)"></span><span><b>${l}</b> <span class="v">${v}</span>${w ? ` <span class="sub">${w}</span>` : ''}</span></li>`).join('');
}
