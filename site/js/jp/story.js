// The Japan story: built around the last fossil fuel on the grid, in three
// parts (why it still runs, the economics, what is coming). The figures are
// worked out from the data by storyFigures(), which the tests also run.
//
// PLACEHOLDER: the chapters' text is still being drafted. renderStory() puts
// the computed figures and charts on the page under neutral headings, so the
// layout and the numbers can be checked; the drafted story replaces the text.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
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

  // Record spells over the whole record.
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: jp.timeZone };
  const spells = Object.fromEntries(FOSSIL_LEVELS.map((lv) => [lv, spellOf(summarise(fossil, lv, 'below', opts))]));
  return { rows, spells, splitFromMs: data.meta?.splitFromMs ?? null };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const twh = (v) => `${v.toFixed(1)} TWh`;
const gw = (v) => `${v.toFixed(1)} GW`;
const pc = (v) => `${Math.round(v)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

/**
 * Draws the placeholder story: neutral headings, the computed figures and
 * three charts. The drafted text replaces the headings and body copy.
 */
export function renderStory(data, end, figs) {
  const { rows } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);

  $('lede').textContent = `Fossil plants made ${pc(last.fossilPct)} of the nine areas' electricity in ${last.year}, against ${pc(first.fossilPct)} in ${first.year}.`;
  $('answer-lead').textContent = 'The story for this page is being written. Below are the figures it will draw on, worked out from the data.';
  $('answer-points').innerHTML = [
    `Fossil share of generation: ${pc(latest.fossilPct)} in the latest 365 days. <a href="#chapter-1" data-open="chapter-1">Chapter 1</a>`,
    `Solar and wind held back: ${twh(latest.twh.curtailed)} in the latest 365 days. <a href="#chapter-2" data-open="chapter-2">Chapter 2</a>`,
    `Lowest fossil output in the latest 365 days: ${gw(latest.fossilMin)}. <a href="#chapter-3" data-open="chapter-3">Chapter 3</a>`,
  ].map((x) => `<li>${x}</li>`).join('');
  $('facts').innerHTML = '';
  $('story-hint').textContent = '';

  const chapters = ['Why fossil power still runs', 'The economics', 'What is coming'];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    $(`take-${k + 1}`).textContent = '';
    if (k < 2) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const cats = rows.map((r) => label(r.year));

  // Chapter 1: generation by fuel each year.
  $('body-1').textContent = '';
  $('chart-h-1').textContent = 'Generation by source each year';
  $('chart-hint-1').textContent = 'TWh a year across the nine areas. The last bar is the latest 365 days.';
  const ch1 = [
    ['Nuclear', '--f-nuclear', (r) => r.twh.nuclear],
    ['Hydro', '--f-hydro', (r) => r.twh.hydro],
    ['Solar', '--f-solar', (r) => r.twh.solar],
    ['Wind', '--f-wind', (r) => r.twh.wind],
    ['Geothermal and biomass', '--f-biomass', (r) => r.twh.geothermal + r.twh.biomass],
    ['Fossil thermal', '--f-gas', (r) => r.twh.thermal],
  ].map(([name, color, f]) => ({ name, color: css(color), values: rows.map(f) }));
  barChart($('story-chart-1'), {
    cats,
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}<div>Fossil share: <b>${pc(rows[ci].fossilPct)}</b></div>`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: LNG and coal by hour of day.
  $('body-2').textContent = '';
  $('chart-h-2').textContent = 'LNG, coal and solar by hour of day';
  $('chart-hint-2').textContent = 'Average output for each hour of the day, Japan time, in GW, over the latest 365 days.';
  const hourX = (hr) => hr * 3600000;
  const lines = [
    ['LNG', '--f-gas', latest.byHour.gas],
    ['Coal', '--f-coal', latest.byHour.coal],
    ['Solar', '--f-solar', latest.byHour.solar],
    ['Nuclear', '--f-nuclear', latest.byHour.nuclear],
  ].map(([name, color, v]) => ({ name, color: css(color), points: v.map((x, hr) => [hourX(hr), x]), width: 2.5 }));
  lineChart($('story-chart-2'), {
    series: lines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) })),
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-2').innerHTML = legend(lines.map((sr) => [sr.name, sr.color]));

  // Chapter 3: hours a year with fossil under 30 GW.
  $('body-3').textContent = '';
  $('chart-h-3').textContent = 'Hours a year with fossil output under 30 GW';
  $('chart-hint-3').textContent = 'The last bar is the latest 365 days.';
  const ch3 = [{ name: 'Fossil under 30 GW', color: css('--lowcarbon'), values: rows.map((r) => r.hoursUnder[30]) }];
  barChart($('story-chart-3'), {
    cats,
    stacks: ch3,
    yFormat: (v) => `${Math.round(v)} hours`,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under 30 GW: <b>${Math.round(rows[ci].hoursUnder[30])}</b></div><div>Lowest fossil: <b>${gw(rows[ci].fossilMin)}</b>${rows[ci].fossilMinAt ? ` on ${fmtDate(rows[ci].fossilMinAt)}` : ''}</div>`,
  });
  $('story-legend-3').innerHTML = legend(ch3.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = '';
}
