// The Australia story: why coal still runs at noon on a grid that no longer
// needs it then, how batteries are taking the evening from gas, who pays coal
// to stay, what South Australia shows about a grid without it, what batteries
// could replace, and what is coming. storyFigures() works out every number
// from the data (the tests run it too); renderStory() writes the answer, the
// facts and the chapters, and draws the charts.
import { summarise, formatDuration, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { metricSeries, generationTotal, byYear, fuelsWhere, stepOf } from '../core/dataset.js';
import { HOME_BATTERIES, AEMO_Q2_2026, GAS_PRICE_GJ, OCGT_COST, CCGT_COST, SOURCES, COMING } from './sources.js';

const OFFSET = 10 * 3600000; // NEM time is UTC+10 all year
// Local hours compared for the noon dip: night 01:00-04:00, noon 11:00-14:00.
const NIGHT = [1, 4];
const NOON = [11, 14];
// A day counts as a dip day when fossil output at noon is this much below the night, as a share.
export const DIP_SHARE = 0.2;
// The evening peak, 4pm to 9pm NEM time, as AEMO defines it; midday is 10am to 4pm.
const EVENING = [16, 20];
const MIDDAY = [10, 15];
// A slot where the units report under a fifth of demand, or under a tenth of
// the area's usual generation, is a gap in AEMO's data or a blackout, not a record.
const GAP_SHARE = 0.2;
const GAP_GEN_SHARE = 0.1;
// A year counts only when the data covers at least this many of its days.
const FULL_YEAR = 350;

/**
 * The levels the story follows for each area, in GW: the fossil output the
 * spells and hours count below, the gas floor that batteries are sized above,
 * and the battery fleets (GW, GWh) tested against each day. Scaled to each
 * state's size by hand.
 */
export const LEVELS = {
  nem: { fossilLow: 8, gasFloor: 0.5, batteries: [[5, 20], [10, 40], [20, 80], [30, 120]] },
  nsw: { fossilLow: 2.5, gasFloor: 0.2, batteries: [[2, 8], [4, 16], [6, 24], [10, 40]] },
  qld: { fossilLow: 3, gasFloor: 0.3, batteries: [[2, 8], [4, 16], [6, 24], [10, 40]] },
  vic: { fossilLow: 2, gasFloor: 0.1, batteries: [[1, 4], [2, 8], [4, 16], [6, 24]] },
  sa: { fossilLow: 0.1, gasFloor: 0.05, batteries: [[0.25, 1], [0.5, 2], [1, 4], [2, 8]] },
  tas: { fossilLow: 0.05, gasFloor: 0.02, batteries: [[0.1, 0.4], [0.2, 0.8], [0.5, 2], [1, 4]] },
};

/** NEM hour, month and day number for every slot. */
function nemClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Uint8Array(data.length);
  const day = new Int32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const local = data.startMs + i * stepMs + OFFSET;
    hour[i] = Math.floor(local / 3600000) % 24;
    month[i] = new Date(local).getUTCMonth() + 1;
    day[i] = Math.floor(local / 864e5);
  }
  return { hour, month, day };
}

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);
const meanRange = (arr, [a, b]) => mean(arr.slice(a, b + 1).reduce((s, v) => s + v, 0), b - a + 1);

/**
 * Every number the story uses, for one area. Rows run by NEM calendar year,
 * complete years only, then 'past365' for the latest 365 days.
 */
export function storyFigures(data, end, country, levels = LEVELS.nem) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const coal = metricSeries(d, country, ['coal', 'lignite']);
  const gas = metricSeries(d, country, ['gas']);
  const oil = metricSeries(d, country, ['oil']);
  const fossil = metricSeries(d, country, fuelsWhere(country, 'fossil'));
  const fossilPct = metricSeries(d, country, fuelsWhere(country, 'fossil'), { unit: 'pct' });
  const renewable = metricSeries(d, country, fuelsWhere(country, 'renewable'));
  const solar = metricSeries(d, country, ['solar_utility', 'solar_rooftop']);
  const wind = metricSeries(d, country, ['wind']);
  const bat = metricSeries(d, country, ['battery']);
  const chg = metricSeries(d, country, ['battery_charge']);
  const total = generationTotal(d, country);
  const price = data.columns.price ?? new Float64Array(end).fill(NaN);
  const demand = data.columns.demand ?? new Float64Array(end).fill(NaN);
  const { hour, month, day } = nemClock(d);
  let genSum = 0;
  let genN = 0;
  for (let i = 0; i < end; i++) if (total[i] > 0) { genSum += total[i]; genN++; }
  const lowGen = GAP_GEN_SHARE * mean(genSum, genN);
  const gap = (i) => Number.isNaN(fossil[i]) || !(total[i] > lowGen) || (demand[i] > 0 && total[i] < GAP_SHARE * demand[i]);

  const rows = byYear(d, country, () => ({
    coalTwh: 0, gasTwh: 0, oilTwh: 0, fosTwh: 0, solTwh: 0, windTwh: 0, batTwh: 0, chgTwh: 0, renSum: 0, genSum: 0,
    coalHour: new Float64Array(24), gasHour: new Float64Array(24), batHour: new Float64Array(24), hourN: new Float64Array(24),
    priceHour: new Float64Array(24), priceN: new Float64Array(24),
    coalMin: Infinity, coalMinAt: -1, gasMin: Infinity, fosMin: Infinity, fosMinAt: -1,
    coalMonth: new Float64Array(12), gasMonth: new Float64Array(12),
    negH: 0, negCoal: 0, negFos: 0, negPrice: 0, fossilLowH: 0, fossilShare10H: 0,
    day: null, days: [],
  }), (r, i) => {
    if (gap(i)) return;
    const h = hour[i];
    const f = fossil[i];
    const g = gas[i];
    // One day at a time: the noon dip, and the fossil above the day's own floor.
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(r.day);
      r.day = { n: day[i], month: month[i], night: 0, nightN: 0, noon: 0, noonN: 0, fosSum: 0, fosN: 0, fosMin: Infinity, fosMax: 0, gasAbove: 0, gasPeak: 0, solar: 0 };
    }
    const dd = r.day;
    if (h >= NIGHT[0] && h <= NIGHT[1]) { dd.night += f; dd.nightN++; }
    if (h >= NOON[0] && h <= NOON[1]) { dd.noon += f; dd.noonN++; }
    dd.fosSum += f;
    dd.fosN++;
    if (f < dd.fosMin) dd.fosMin = f;
    if (f > dd.fosMax) dd.fosMax = f;
    dd.gasAbove += Math.max(0, g - levels.gasFloor) * slotH;
    if (g > dd.gasPeak) dd.gasPeak = g;
    dd.solar += solar[i] * slotH;

    r.coalTwh += (coal[i] * slotH) / 1000;
    r.gasTwh += (g * slotH) / 1000;
    r.oilTwh += (oil[i] * slotH) / 1000;
    r.fosTwh += (f * slotH) / 1000;
    r.solTwh += (solar[i] * slotH) / 1000;
    r.windTwh += (wind[i] * slotH) / 1000;
    r.batTwh += (bat[i] * slotH) / 1000;
    r.chgTwh += (Math.abs(chg[i]) * slotH) / 1000;
    r.renSum += renewable[i];
    r.genSum += total[i] / 1000;
    r.coalHour[h] += coal[i];
    r.gasHour[h] += g;
    r.batHour[h] += bat[i];
    r.hourN[h]++;
    r.coalMonth[month[i] - 1] += (coal[i] * slotH) / 1000;
    r.gasMonth[month[i] - 1] += (g * slotH) / 1000;
    if (coal[i] < r.coalMin) { r.coalMin = coal[i]; r.coalMinAt = i; }
    if (g < r.gasMin) r.gasMin = g;
    if (f < r.fosMin) { r.fosMin = f; r.fosMinAt = i; }
    if (f < levels.fossilLow) r.fossilLowH += slotH;
    if (fossilPct[i] < 10) r.fossilShare10H += slotH;
    const p = price[i];
    if (Number.isNaN(p)) return;
    r.priceHour[h] += p;
    r.priceN[h]++;
    if (p < 0) { r.negH += slotH; r.negCoal += coal[i]; r.negFos += f; r.negPrice += p; }
  }).map((r) => {
    const days = r.day ? [...r.days, r.day] : r.days;
    const full = days.filter((x) => x.nightN && x.noonN);
    const dips = full.map((x) => x.night / x.nightN - x.noon / x.noonN);
    const dipDays = full.filter((x) => x.noon / x.noonN < (1 - DIP_SHARE) * (x.night / x.nightN)).length;
    const priceHour = [...r.priceHour].map((v, k) => mean(v, r.priceN[k]));
    const gasHour = [...r.gasHour].map((v, k) => mean(v, r.hourN[k]));
    const batHour = [...r.batHour].map((v, k) => mean(v, r.hourN[k]));
    // Each day's gas above the floor, and its fossil above its own lowest half hour, in GWh, smallest first.
    const gasDays = days.map((x) => ({ gwh: x.gasAbove, peak: x.gasPeak, month: x.month })).sort((a, b) => a.gwh - b.gwh);
    const rampDays = days.map((x) => ({ gwh: (x.fosSum - x.fosMin * x.fosN) * slotH, peak: x.fosMax - x.fosMin, floor: x.fosMin, month: x.month, solar: x.solar })).sort((a, b) => a.gwh - b.gwh);
    const covered = (list, peakOf) => levels.batteries.map(([gw, gwh]) => ({ gw, gwh, days: list.filter((x) => x.gwh <= gwh && peakOf(x) <= gw).length }));
    return {
      year: r.year,
      coalTwh: r.coalTwh,
      gasTwh: r.gasTwh,
      oilTwh: r.oilTwh,
      fosTwh: r.fosTwh,
      solTwh: r.solTwh,
      windTwh: r.windTwh,
      batTwh: r.batTwh,
      chgTwh: r.chgTwh,
      renewablePct: mean(r.renSum, r.genSum) * 100,
      coalPct: (r.coalTwh / (r.genSum * slotH / 1000)) * 100,
      coalHour: [...r.coalHour].map((v, k) => mean(v, r.hourN[k])),
      gasHour,
      batHour,
      priceHour,
      coalMin: r.coalMin,
      coalMinAt: r.coalMinAt,
      gasMin: r.gasMin,
      fosMin: r.fosMin,
      fosMinAt: r.fosMinAt,
      coalMonth: [...r.coalMonth],
      gasMonth: [...r.gasMonth],
      // Hours priced below zero, the coal that ran through them, and the average of those prices.
      negHours: r.negH,
      coalAtNeg: mean(r.negCoal, r.negH / slotH),
      fosAtNeg: mean(r.negFos, r.negH / slotH),
      negPrice: mean(r.negPrice, r.negH / slotH),
      fossilLowHours: r.fossilLowH,
      fossilShare10Hours: r.fossilShare10H,
      // Night minus noon, so a positive number means fossil output dips at noon.
      dip: mean(dips.reduce((a, b) => a + b, 0), dips.length),
      dipDays,
      days: days.length,
      eveningPrice: meanRange(priceHour, EVENING),
      middayPrice: meanRange(priceHour, MIDDAY),
      eveningGas: meanRange(gasHour, EVENING),
      eveningBat: meanRange(batHour, EVENING),
      gasDays,
      rampDays,
      gasAboveTwh: gasDays.reduce((a, x) => a + x.gwh, 0) / 1000,
      rampTwh: rampDays.reduce((a, x) => a + x.gwh, 0) / 1000,
      // Days a battery fleet could have covered, if it was full: the gas above the floor, and the whole fossil ramp.
      batteriesGas: covered(gasDays, (x) => x.peak - levels.gasFloor),
      batteriesRamp: covered(rampDays, (x) => x.peak),
    };
  }).filter((r) => r.days >= FULL_YEAR);

  // Record spells and extremes over the whole record.
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: country.timeZone, maxGap: 2 };
  const clean = new Float64Array(end);
  for (let i = 0; i < end; i++) clean[i] = gap(i) ? NaN : fossil[i];
  let peakBat = { i: -1, gw: 0 };
  let lowest = { i: -1, gw: Infinity };
  for (let i = 0; i < end; i++) {
    if (bat[i] > peakBat.gw) peakBat = { i, gw: bat[i] };
    if (clean[i] < lowest.gw) lowest = { i, gw: clean[i] };
  }
  const past = rows.at(-1);
  return {
    rows,
    levels,
    // Coal is the last fuel where it still makes the bulk of fossil output; gas in South Australia and Tasmania.
    lastFuel: past && past.gasTwh > past.coalTwh ? 'gas' : 'coal',
    fossilLowSpell: spellOf(summarise(clean, levels.fossilLow, 'below', opts)),
    fossilShare10Spell: spellOf(summarise(fossilPct, 10, 'below', opts)),
    negativeSpell: spellOf(summarise(price, 0, 'below', opts)),
    peakBat,
    lowest,
  };
}

// ---------------------------------------------------------------------------
// Drawing. The tests run only the figures above, so these need no DOM.

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = (id) => document.getElementById(id);
const n0 = (v) => Math.round(v).toLocaleString('en-AU');
const money = (v) => `${v < 0 ? '−' : ''}$${n0(Math.abs(v))}`;
const gw = (v) => (Math.abs(v) < 1 ? `${n0(v * 1000)} MW` : `${+v.toFixed(1)} GW`);
const twh = (v) => `${v.toFixed(1)} TWh`;
const hrs = (v) => `${n0(v)} hours`;
const pc = (v) => `${Math.round(v)}%`;
const yearLabel = (y) => (y === 'past365' ? '365d' : String(y));
const yearTitle = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([c, n]) => `<span><span class="swatch" style="background:${c}"></span>${n}</span>`).join('');
const link = (ch, text) => `<a href="#${ch}" data-open="${ch}">${text}</a>`;
const src = (key, text = 'source') => `<a href="${SOURCES[key]}">${text}</a>`;
const clock = (h) => (h === 0 ? 'midnight' : h === 12 ? 'noon' : h < 12 ? `${h}am` : `${h - 12}pm`);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// The hour-of-day charts: a fixed day in NEM time, labelled every three hours.
const DAY0 = Date.UTC(2000, 0, 3) - OFFSET;
const hourX = (h) => DAY0 + h * 3600000;
const DAY_TICKS = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ t: hourX(h), label: clock(h) }));
const hourOf = (t) => Math.round((t - DAY0) / 3600000) % 24;
const yearColors = ['--f-other', '--f-gas', '--f-hydro', '--f-nuclear'];

function chapter(n, id, title, take, body, next) {
  return `<details class="chapter" id="${id}"${n === 1 ? ' open' : ''}>
    <summary><span class="ch-num">${n}</span><span class="ch-text"><span class="ch-title">${title}</span><span class="ch-take">${take}</span></span></summary>
    <div class="ch-body">${body}${next ? `<button type="button" class="edit-btn next-ch" data-next="${next[0]}">Next: ${next[1]}</button>` : ''}</div>
  </details>`;
}

/**
 * Writes the story for one area. `sa` is South Australia's figures, for the
 * chapter on it; `cache` is the previous return value, so the figures are
 * only worked out once per area.
 */
export function renderStory({ data, end, country, area, areaName, cache, factsHtml, sa }) {
  const f = cache?.area === area ? cache.f : storyFigures(data, end, country, LEVELS[area] ?? LEVELS.nem);
  const where = area === 'nem' ? 'the NEM' : areaName;
  const Where = area === 'nem' ? 'The NEM' : areaName;
  const { rows, levels, lastFuel } = f;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return { area, f };
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? first;
  const leastGas = full.reduce((a, r) => (r.gasTwh < a.gasTwh ? r : a), first);
  const step = stepOf(data);
  const at = (i) => fmtDate(slotTime(i, data.startMs, step));
  const dur = (sp) => (sp ? formatDuration(sp.end - sp.start, step) : 'none yet');
  const from = (sp) => (sp ? `from ${at(sp.start)}` : '');
  const isCoal = lastFuel === 'coal';
  const fuel = isCoal ? 'coal' : 'gas';
  const Fuel = isCoal ? 'Coal' : 'Gas';
  const fuelHour = (r) => (isCoal ? r.coalHour : r.gasHour);
  const lowBar = gw(levels.fossilLow);
  const gasBat = (k) => last.batteriesGas[k];
  const rampBat = (k) => last.batteriesRamp[k];
  const median = last.rampDays[Math.floor(last.rampDays.length / 2)];
  const worst = last.rampDays.at(-1);
  const gasMedian = last.gasDays[Math.floor(last.gasDays.length / 2)];
  const bigBat = last.batteriesRamp.at(-1);
  const evFell = latest.eveningPrice < last.eveningPrice;

  // The lede, the answer and its three points.
  $('lede').textContent = isCoal
    ? `${Where} burnt ${twh(last.coalTwh)} of coal and ${twh(last.gasTwh)} of gas in ${last.year}. Coal ran through ${hrs(last.negHours)} of negative prices because its stations cannot stop for the afternoon, and gas is losing the evening to batteries.`
    : `${Where} burnt ${twh(last.gasTwh)} of gas in ${last.year}${leastGas === last ? ', the least in the data' : ''}, and its fossil output fell to ${gw(last.fosMin)} at its lowest. What is left runs for system strength as much as for power.`;
  $('answer-lead').innerHTML = isCoal
    ? `Coal still makes ${pc(last.coalPct)} of ${where}'s power, and it runs at midday not because the grid needs it then but because a coal unit cannot stop for the afternoon and start again for the evening. In ${last.year} coal averaged ${gw(last.coalHour[13])} at 1pm and ${gw(last.coalHour[19])} at 7pm, never fell below ${gw(last.coalMin)}, and sat through ${hrs(last.negHours)} of negative prices. Gas is the fuel actually leaving: over the latest 365 days batteries put out nearly as much between 4pm and 9pm as gas did. The floor only falls when stations close, so the records to watch are the lowest coal half hour and the hours with fossil under ${lowBar}.`
    : `${Where}'s last fossil fuel is gas${area === 'sa' ? ', and the little that still runs through sunny, windy days runs because AEMO keeps gas units on for system strength, not for their power' : ', and it runs on the days hydro and wind fall short'}. Fossil output fell to ${gw(last.fosMin)} in ${last.year} and stayed under ${lowBar} for ${hrs(last.fossilLowHours)}. ${area === 'sa' ? 'The number of units AEMO requires is the floor, and the' : 'The'} record to watch is the longest spell with fossil under ${lowBar}.`;
  $('answer-points').innerHTML = (isCoal ? [
    `<b>Coal runs at noon because it cannot stop.</b> On ${last.dipDays} days of ${last.year} it ran at least ${pc(DIP_SHARE * 100)} lower at noon than at night, down to a floor the units cannot go below. The price averaged ${money(last.priceHour[13])}/MWh at 1pm and coal still ran at ${gw(last.coalAtNeg)} on average through the hours below zero. ${link('chapter-1', 'Chapters 1')} and ${link('chapter-3', '3')}`,
    `<b>The evening is going from gas to batteries.</b> Between 4pm and 9pm gas averaged ${gw(last.eveningGas)} in ${last.year} and ${gw(latest.eveningGas)} in the latest 365 days; batteries went from ${gw(last.eveningBat)} to ${gw(latest.eveningBat)}, and the evening price ${evFell ? 'fell' : 'rose'} from ${money(last.eveningPrice)} to ${money(latest.eveningPrice)}/MWh. ${link('chapter-2', 'Chapters 2')} and ${link('chapter-5', '5')}`,
    `<b>Only closures move the floor.</b> ${bigBat.gw} GW and ${bigBat.gwh} GWh of batteries would have flattened the evening ramp on ${bigBat.days} days of ${last.year}, but nothing a battery does lowers the ${gw(last.coalMin)} coal ran at its lowest. South Australia shows the floor can go: its fossil output has been under 100 MW for ${sa ? hrs(sa.rows.at(-1).fossilLowHours) : 'thousands of hours'} in the latest year. Yallourn closes in 2028 and Eraring in April 2029. ${link('chapter-4', 'Chapters 4')} and ${link('chapter-6', '6')}`,
  ] : [
    area === 'sa'
      ? `<b>Gas runs for system strength.</b> AEMO requires two large gas units online in most conditions, and has only assessed going to one. Gas averaged ${gw(last.gasHour[13])} at 1pm in ${last.year}, with the price at ${money(last.priceHour[13])}/MWh. ${link('chapter-1', 'Chapter 1')} and ${link('chapter-4', '4')}`
      : `<b>Gas is a reserve, not a habit.</b> ${areaName} burnt ${twh(last.gasTwh)} of gas in ${last.year}, against ${twh(first.gasTwh)} in ${first.year}, and fossil output was under ${lowBar} for ${hrs(last.fossilLowHours)}. ${link('chapter-1', 'Chapter 1')}`,
    `<b>The evening is going from gas to batteries.</b> Between 4pm and 9pm gas averaged ${gw(last.eveningGas)} in ${last.year} and ${gw(latest.eveningGas)} in the latest 365 days; batteries went from ${gw(last.eveningBat)} to ${gw(latest.eveningBat)}. ${link('chapter-2', 'Chapters 2')} and ${link('chapter-5', '5')}`,
    area === 'sa'
      ? `<b>The second link to NSW is what moves the floor.</b> AEMO says the minimum number of gas units can only reach zero after Project EnergyConnect stage 2, energised in late 2026. The spell to watch is fossil under ${lowBar}: ${dur(f.fossilLowSpell)} so far. ${link('chapter-6', 'Chapter 6')}`
      : `<b>The coal is on the mainland.</b> ${areaName}'s records move with the NEM's: the spell to watch here is fossil under ${lowBar}, ${dur(f.fossilLowSpell)} so far, and the closures that lower the mainland floor are in the last chapter. ${link('chapter-4', 'Chapters 4')} and ${link('chapter-6', '6')}`,
  ]).map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  $('facts').innerHTML = factsHtml(hrs(last.negHours), isCoal
    ? `with the spot price below zero in ${last.year}, while coal ran at ${gw(last.coalAtNeg)} on average. In ${first.year} it was ${hrs(first.negHours)}.`
    : `with the spot price below zero in ${last.year}, while fossil plant ran at ${gw(last.fosAtNeg)} on average. In ${first.year} it was ${hrs(first.negHours)}.`, [
    ['--f-coal', `Lowest ${fuel} half hour in ${last.year}`, gw(isCoal ? last.coalMin : last.fosMin), `on ${at(isCoal ? last.coalMinAt : last.fosMinAt)}; the lowest fossil half hour on record is ${gw(f.lowest.gw)}, on ${at(f.lowest.i)}`],
    ['--f-gas', `Gas burnt in ${last.year}`, twh(last.gasTwh), `against ${twh(first.gasTwh)} in ${first.year}${leastGas === last ? ', the least in the data' : ''}`],
    ['--f-battery', 'Most battery output', gw(f.peakBat.gw), f.peakBat.i >= 0 ? `at ${at(f.peakBat.i)}` : ''],
    ['--fossil', `Longest spell with fossil under ${lowBar}`, dur(f.fossilLowSpell), from(f.fossilLowSpell)],
  ]);
  $('story-hint').textContent = `Six chapters: why ${fuel} runs at noon, the evening passing from gas to batteries, who pays coal to stay, what South Australia shows, what batteries could and could not replace, and what is coming, with the record each item should move.`;

  const chapters = [
    chapter(1, 'chapter-1', isCoal ? 'Coal runs at noon because it cannot stop' : 'Gas runs at noon for system strength, not power',
      isCoal
        ? `In ${last.year} coal averaged ${gw(last.coalHour[3])} at 3am, ${gw(last.coalHour[13])} at 1pm and ${gw(last.coalHour[19])} at 7pm. The dip is as far as the units can go.`
        : `In ${last.year} gas averaged ${gw(last.gasHour[13])} at 1pm, with the price at ${money(last.priceHour[13])}/MWh, and fossil output never fell below ${gw(last.fosMin)}.`, `
      <p>${isCoal
        ? `A coal unit takes hours to stop and hours to start, and each start costs fuel and wear, so a unit that is wanted at 7pm stays on at 1pm. What it can do is turn down. WattClarity's review of AEMO's 2023 unit data found Eraring and Bayswater units running at 25% of capacity and Loy Yang B at about 40%, while Yallourn went no lower than about 50% (${src('mingen', 'WattClarity')}). That is the shape of the chart below. In ${first.year} coal followed demand, ${gw(first.coalHour[3])} at 3am and ${gw(first.coalHour[13])} at 1pm. In ${last.year} it ran ${gw(last.coalHour[3])} at 3am and ${gw(last.coalHour[13])} at 1pm; coal and gas together dipped ${gw(last.dip)} between night and noon on an average day, by more than ${pc(DIP_SHARE * 100)} on ${last.dipDays} days, and coal's lowest half hour was ${gw(last.coalMin)} on ${at(last.coalMinAt)}. Below that it did not go, whatever the price: the spot price averaged ${money(last.priceHour[13])}/MWh at 1pm, was below zero for ${hrs(last.negHours)} in the year, and coal ran at ${gw(last.coalAtNeg)} on average through those hours. AEMO's own reading is the same: coal units at their minimum stable output are part of why daytime prices go negative (${src('qedQ1_2026', 'AEMO, Q1 2026')}).`
        : `${areaName} has no coal. What fossil plant still runs through a sunny day is gas${area === 'sa'
          ? `, and it runs because AEMO requires a minimum number of large synchronous units online for system strength and voltage control, two in most conditions (${src('saMinimum', 'AEMO')})`
          : ', run on the days hydro and wind fall short rather than at any fixed hour, as far as the data shows'}. In ${first.year} gas ran at ${gw(first.gasHour[13])} at 1pm; in ${last.year} it was ${gw(last.gasHour[13])}, with the price at ${money(last.priceHour[13])}/MWh and below zero for ${hrs(last.negHours)} in the year. The lowest fossil half hour was ${gw(last.fosMin)} on ${at(last.fosMinAt)}.`}</p>
      <h3>${Fuel} by hour of day</h3>
      <p class="hint">Average ${fuel} output for each hour of the day, NEM time, in GW. The average spot price at each hour is in the tooltip. The thick line is the latest 365 days.</p>
      <div class="chart-host" id="au-fuel-day"></div>
      <div class="legend" id="au-fuel-day-legend"></div>`, ['chapter-2', 'The evening']),
    chapter(2, 'chapter-2', 'The evening is passing from gas to batteries', `Between 4pm and 9pm gas averaged ${gw(last.eveningGas)} in ${last.year} and ${gw(latest.eveningGas)} in the latest 365 days; batteries went from ${gw(last.eveningBat)} to ${gw(latest.eveningBat)}.`, `
      <p>Gas is the fuel the NEM is actually giving up. ${Where} burnt ${twh(first.gasTwh)} of gas in ${first.year} and ${twh(last.gasTwh)} in ${last.year}${leastGas === last ? ', the least in the data' : ''}. Nearly all of it is evening and winter: in ${last.year} gas averaged ${gw(last.gasHour[13])} at 1pm and ${gw(last.gasHour[18])} at 6pm, and ${twh(last.gasMonth[5])} of the year's ${twh(last.gasTwh)} was burnt in June. A gas turbine runs when the price beats its fuel. East coast gas averaged $${GAS_PRICE_GJ.toFixed(2)} a gigajoule from April to June 2026 (${src('qedQ2_2026', 'AEMO')}), which puts an open-cycle turbine's fuel at roughly ${money(OCGT_COST)}/MWh and a combined-cycle plant's at ${money(CCGT_COST)}, our estimate with no carbon price. The evening price has been above that and the midday price far below it: ${money(last.middayPrice)}/MWh from 10am to 4pm and ${money(last.eveningPrice)} from 4pm to 9pm in ${last.year}. That gap is what a battery earns, and the fleet has grown into it. Between 4pm and 9pm batteries put out ${gw(latest.eveningBat)} on average over the latest 365 days, against ${gw(last.eveningBat)} in ${last.year} and ${gw(row(last.year - 1).eveningBat)} the year before, and gas went from ${gw(row(last.year - 1).eveningGas)} to ${gw(latest.eveningGas)}. The evening price ${evFell ? 'fell' : 'rose'} to ${money(latest.eveningPrice)}/MWh. AEMO reports that batteries set the price in 36% of evening peak intervals in the March quarter of 2026, and that gas generation in that quarter was the lowest since 1999 (${src('qedQ1_2026', 'AEMO')}).</p>
      <h3>Gas and batteries by hour of day</h3>
      <p class="hint">Average gas output and battery output for each hour of the day, NEM time, in GW, for ${last.year} and the latest 365 days.</p>
      <div class="chart-host" id="au-evening-day"></div>
      <div class="legend" id="au-evening-day-legend"></div>`, ['chapter-3', 'Who pays coal to stay']),
    chapter(3, 'chapter-3', 'Who pays coal to stay', `Governments now underwrite the biggest stations: NSW covers up to $225 million a year of Eraring's losses, Victoria has an unpublished deal on Yallourn, and Queensland owns its coal fleet.`, `
      <p>A coal unit that runs at a loss at noon can make it back in the evening, and its owner's contracts matter as much as the spot price: a generator that has sold more hedges than it is generating gains when the price falls, which helps explain why coal units keep offering their minimum volume at any price (${src('negativeBids', 'WattClarity')}). Across the year the price still covered it. In ${last.year} the demand-weighted price at 7pm averaged ${money(last.priceHour[19])}/MWh against ${money(last.priceHour[13])} at 1pm, and the hours below zero averaged ${money(last.negPrice)}/MWh, a cost the fleet carries to be there for the evening. What has changed is that the stations' owners wanted out sooner than governments did. Origin set Eraring, 2,880 MW and the NEM's biggest station, to close in August 2025; in May 2024 NSW agreed to cover up to 80% of its operating losses, capped at $225 million a year, if Origin asked (${src('eraringDeal', 'RenewEconomy')}). Origin did not claim for the first year (${src('eraringNoClaim', 'RenewEconomy')}), and in January 2026 extended all four units to 30 April 2029 anyway, citing AEMO's system security plan and late transmission, wind and storage (${src('eraring2029', 'Origin')}). EnergyAustralia brought Yallourn forward to mid-2028 in 2021 under a deal with the Victorian government whose terms were not published (${src('yallourn2021', 'RenewEconomy')}, ${src('yallourn2028', 'Utility')}). Queensland's coal stations are owned by the state, and its October 2025 roadmap dropped the previous plan to close them by 2035 and keeps them running into the 2040s (${src('qldRoadmap', 'ESD News')}). Australia has no carbon price, so nothing but the spot price and the coal price pushes a unit off. The hours below zero are the market's measure of how often coal runs when nobody wants it.</p>
      <h3>Hours below zero each year</h3>
      <p class="hint">Hours with a negative spot price${area === 'nem' ? ', weighted by each state\'s demand' : ''}. The fossil plant that ran through them is in the tooltip. The last bar is the latest 365 days.</p>
      <div class="chart-host" id="au-neg-year"></div>
      <div class="legend" id="au-neg-year-legend"></div>`, ['chapter-4', 'South Australia']),
    chapter(4, 'chapter-4', 'South Australia shows the floor can go', saTake(sa), saHtml(sa, at, dur, from), ['chapter-5', 'Batteries']),
    chapter(5, 'chapter-5', 'What batteries could and could not replace', `${gasBat(1).gw} GW and ${gasBat(1).gwh} GWh of batteries would have covered gas above ${gw(levels.gasFloor)} on ${gasBat(1).days} days of ${last.year}; the whole evening ramp of ${fuel} and gas needs ${rampBat(3).gw} GW and ${rampBat(3).gwh} GWh to cover ${rampBat(3).days} days.`, `
      <p>Two things a battery could replace. The first is the gas above a floor of ${gw(levels.gasFloor)}, the peaking fuel: ${twh(last.gasAboveTwh)} in ${last.year}, ${n0(gasMedian.gwh)} GWh on the median day with a peak of ${gw(gasMedian.peak)}. Against that, ${last.batteriesGas.map((b, i) => (i ? `${i === last.batteriesGas.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh ${b.days}` : `${b.gw} GW and ${b.gwh} GWh of batteries would have covered ${b.days} days`)).join(', ')}. The second is the whole fossil ramp: everything coal and gas ran above that day's own lowest half hour, which is the output the units could not avoid. That came to ${twh(last.rampTwh)} in ${last.year}, ${n0(median.gwh)} GWh and ${gw(median.peak)} on the median day, ${n0(worst.gwh)} GWh and ${gw(worst.peak)} on the worst. ${last.batteriesRamp.map((b, i) => (i ? `${i === last.batteriesRamp.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh ${b.days}` : `${b.gw} GW and ${b.gwh} GWh of batteries would have covered ${b.days} days`)).join(', ')}. The NEM's grid batteries passed 9 GW in mid-2026 (${src('qedQ2_2026', 'AEMO')}), tender 8 of the Capacity Investment Scheme adds 4.2 GW and 16.1 GWh by the end of 2029 (${src('cisTender8', 'Energy-Storage.News')}), and AEMO's 2026 plan wants 33 GW by 2030 (${src('isp2026', 'ABC')}). The sizing assumes the batteries could charge, which on most days they could: solar averaged ${n0(median.solar)} GWh on the median day. What none of it covers is the floor itself, the ${gw(last.coalMin)} ${fuel} ran at its lowest in ${last.year}. A battery that soaks up the noon surplus makes the dip shallower, not the floor lower. Only a closure does that, and the next chapter lists them.</p>
      <h3>Each day of ${last.year}, by the fossil a battery would have had to replace</h3>
      <p class="hint">Each day's coal and gas above that day's lowest half hour, in GWh, sorted from smallest to largest. The lines mark what ${levels.batteries.map((b) => `${b[1]} GWh`).join(', ')} of batteries could supply; days below a line are covered, if the batteries could charge.</p>
      <div class="chart-host" id="au-ramp-days"></div>
      <div class="legend" id="au-ramp-days-legend"></div>
      ${homeBatteriesHtml(last, latest)}`, ['chapter-6', 'What is coming']),
    chapter(6, 'chapter-6', 'What is coming, and which records it moves', 'Yallourn closes in 2028 and Eraring in April 2029, which lowers the floor for the first time; Queensland keeps its coal into the 2040s, so the NEM does not reach zero on any date now fixed.', `
      <p>The dated items are listed below, each with the record it should move. Closures are the ones that matter for the floor: Yallourn in mid-2028 and Eraring on 30 April 2029 take about 4.3 GW of coal off, and with it the minimum those units ran at, so the lowest coal half hour and the hours with fossil under ${lowBar} should both move in 2029. Batteries work on the shape, not the floor: more of them means a shallower noon dip and less evening gas, and the records they move are the battery output peak and the hours below zero. South Australia's second link to NSW is the one item that takes a floor to zero, if AEMO's test of running without a synchronous unit succeeds. Hours with fossil under ${lowBar} went from ${hrs(first.fossilLowHours)} in ${first.year} to ${hrs(last.fossilLowHours)} in ${last.year}: that is the count to watch, with the lowest ${fuel} half hour.</p>
      <h3>Hours a year with fossil under ${lowBar}</h3>
      <p class="hint">Hours each year with coal, gas and oil together under ${lowBar}. The lowest ${fuel} half hour is in the tooltip. The last bar is the latest 365 days.</p>
      <div class="chart-host" id="au-low-year"></div>
      <div class="legend" id="au-low-year-legend"></div>
      <h3>What's coming, and the record each should move</h3>
      <ul class="fact-list" id="coming">${COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--f-coal)"></span><span><b>${when}</b> ${what} (${src(source)}) <span class="sub">Watch: ${record}</span></span></li>`).join('')}</ul>`, null),
  ];
  $('chapters').innerHTML = chapters.join('');
  drawCharts(f, data, sa);
  return { area, f };
}

/** Redraws the charts in open chapters, as chapters open or the window resizes. */
export function drawStoryCharts(story, data, sa) {
  if (story) drawCharts(story.f, data, sa);
}

function saTake(sa) {
  if (!sa) return 'South Australia runs on wind and solar with a few gas units kept on for system strength.';
  const last = sa.rows.filter((r) => r.year !== 'past365').at(-1);
  return `South Australia's fossil output was under 100 MW for ${hrs(last.fossilLowHours)} of ${last.year} and under 10% of its generation for ${hrs(last.fossilShare10Hours)}. What is left is the units AEMO keeps on.`;
}

function saHtml(sa, at, dur, from) {
  if (!sa) return '<p>South Australia\'s figures could not be loaded.</p>';
  const full = sa.rows.filter((r) => r.year !== 'past365');
  const first = full[0];
  const last = full.at(-1);
  const latest = sa.rows.at(-1);
  return `
      <p>South Australia has no coal, and it is where the NEM has already run the experiment of a grid with almost no fossil plant. In ${first.year} its gas and diesel plant made ${twh(first.fosTwh)}; in ${last.year} it made ${twh(last.fosTwh)}, and fossil output was under 100 MW for ${hrs(last.fossilLowHours)}, under 10% of the state's generation for ${hrs(last.fossilShare10Hours)}, and never below ${gw(last.fosMin)}. The longest spell under 100 MW is ${dur(sa.fossilLowSpell)}, ${from(sa.fossilLowSpell)}. What is left is not there for its power. Until 2021 AEMO kept up to four gas units running for system strength; ElectraNet's four synchronous condensers, spinning machines that give the grid strength and inertia without burning fuel, cut that to two (${src('syncons', 'Energy Magazine')}). AEMO had set itself the goal of being able to run the grid on 100% renewables at times by 2025, with South Australia the proving ground (${src('aemo2025', 'pv magazine')}). Its August 2025 assessment found one large unit is enough when demand is above 600 MW and the system is intact, but two or more are still needed when the state is at risk of islanding (${src('saMinimum', 'AEMO')}), and in June 2026 it told the regulator the minimum can only fall to zero once the second link to NSW, Project EnergyConnect stage 2, is in service and has been proven, which it expects to be energised in late 2026 (${src('pec', 'AEMO')}). So the state's gas floor is a rule rather than a need, and the rule has a date. The price is already there: ${pc(latest.negHours / 87.6)} of the latest 365 days' half hours were priced below zero.</p>
      <h3>South Australia: hours a year with fossil under 100 MW</h3>
      <p class="hint">Hours each year with gas and diesel together under 100 MW, and hours under 10% of the state's generation. The last bar is the latest 365 days.</p>
      <div class="chart-host" id="au-sa-year"></div>
      <div class="legend" id="au-sa-year-legend"></div>`;
}

function homeBatteriesHtml(last, latest) {
  const h = HOME_BATTERIES;
  const q = AEMO_Q2_2026;
  return `<h3>The batteries the data can't see</h3>
    <p>Home batteries sit behind the meter, so none of the charts here include them. To the grid they look like homes using less power at 6pm. The Cheaper Home Batteries Program has paid about 30% of the cost since July 2025, and uptake has been quick:</p>
    <ul class="notes">${h.milestones.map((m) => `<li><b>${m.when}:</b> ${m.text} (<a href="${m.url}">${m.source}</a>)</li>`).join('')}</ul>
    <p>AEMO's report for April to June 2026 counted ${n0(q.homeBatteryMwh)} MWh across ${n0(q.homeBatteryInstalls)} homes, up ${q.homeBatteryGrowthPct}% in a quarter, and found homes with solar and a battery drew ${q.eveningImportCutPct}% less from the grid between 4pm and 9pm than homes with solar alone (<a href="${q.url}">AEMO</a>, <a href="${q.newsUrl}">Energy-Storage.News</a>). In this data that can only show up as lower evening demand and a smaller ramp: the fossil above each day's floor came to ${twh(last.rampTwh)} in ${last.year} and ${twh(latest.rampTwh)} in the latest 365 days. The weather moves that as much as batteries do.</p>`;
}

function drawCharts(f, data, sa) {
  const { rows } = f;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? full[0];
  const isCoal = f.lastFuel === 'coal';
  const tip = (t, vals, fmt) => `<strong>${clock(hourOf(t))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? fmt(v.value) : '—'}</b></div>`).join('')}`;
  const points = (arr) => arr.map((v, h) => [hourX(h), v]);
  const cats = rows.map((r) => yearLabel(r.year));
  const pick = (years) => years.filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));

  if ($('au-fuel-day')) {
    const years = pick([2019, 2023, last.year, 'past365']);
    const s = years.map((y, k) => ({ name: yearTitle(y), year: y, color: css(yearColors[k]), points: points(isCoal ? row(y).coalHour : row(y).gasHour), width: y === 'past365' ? 3 : 2 }));
    lineChart($('au-fuel-day'), {
      xTicks: DAY_TICKS, series: s, yMin: 0, yFormat: gw, yTickFormat: (v) => `${v}`,
      tooltip: (t, vals) => { const h = hourOf(t); return `<strong>${clock(h)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b> at ${money(row(v.series.year).priceHour[h])}/MWh</div>`).join('')}`; },
    });
    $('au-fuel-day-legend').innerHTML = legend(s.map((x) => [x.color, x.name]));
  }
  if ($('au-evening-day')) {
    const s = [
      { name: `Gas, ${last.year}`, color: css('--f-gas'), points: points(last.gasHour), width: 1.5, opacity: 0.45 },
      { name: 'Gas, latest 365 days', color: css('--f-gas'), points: points(latest.gasHour), width: 3 },
      { name: `Batteries, ${last.year}`, color: css('--f-battery'), points: points(last.batHour), width: 1.5, opacity: 0.45 },
      { name: 'Batteries, latest 365 days', color: css('--f-battery'), points: points(latest.batHour), width: 3 },
    ];
    lineChart($('au-evening-day'), { xTicks: DAY_TICKS, series: s, yMin: 0, yFormat: gw, yTickFormat: (v) => `${v}`, tooltip: (t, v) => tip(t, v, gw) });
    $('au-evening-day-legend').innerHTML = legend(s.map((x) => [x.color, x.name]));
  }
  if ($('au-neg-year')) {
    const st = [{ name: 'Hours below zero', color: css('--s1'), values: rows.map((r) => r.negHours) }];
    barChart($('au-neg-year'), {
      cats, stacks: st, yFormat: hrs, yTickFormat: (v) => n0(v),
      highlight: (ci) => rows[ci].year === 'past365',
      tooltip: (ci) => `<strong>${yearTitle(rows[ci].year)}</strong><div>Below zero: <b>${hrs(rows[ci].negHours)}</b></div><div>Fossil plant through those hours: <b>${Number.isFinite(rows[ci].fosAtNeg) ? gw(rows[ci].fosAtNeg) : '—'}</b></div><div>Average of those prices: <b>${Number.isFinite(rows[ci].negPrice) ? `${money(rows[ci].negPrice)}/MWh` : '—'}</b></div>`,
    });
    $('au-neg-year-legend').innerHTML = legend(st.map((x) => [x.color, x.name]));
  }
  if ($('au-sa-year') && sa) {
    const sr = sa.rows;
    const st = [
      { name: 'Under 100 MW', color: css('--h7'), values: sr.map((r) => r.fossilLowHours) },
      { name: 'Under 10% of generation, above 100 MW', color: css('--lowcarbon'), values: sr.map((r) => Math.max(0, r.fossilShare10Hours - r.fossilLowHours)) },
    ];
    barChart($('au-sa-year'), {
      cats: sr.map((r) => yearLabel(r.year)), stacks: st, yFormat: hrs, yTickFormat: (v) => n0(v),
      highlight: (ci) => sr[ci].year === 'past365',
      tooltip: (ci) => `<strong>${yearTitle(sr[ci].year)}</strong><div>Fossil under 100 MW: <b>${hrs(sr[ci].fossilLowHours)}</b></div><div>Under 10% of generation: <b>${hrs(sr[ci].fossilShare10Hours)}</b></div><div>Lowest fossil: <b>${gw(sr[ci].fosMin)}</b></div><div>Gas: <b>${twh(sr[ci].gasTwh)}</b></div>`,
    });
    $('au-sa-year-legend').innerHTML = legend(st.map((x) => [x.color, x.name]));
  }
  if ($('au-ramp-days')) {
    const dayX = (k) => k * 864e5;
    const s = [{ name: 'Fossil above the day\'s floor', color: css('--f-coal'), points: last.rampDays.map((x, k) => [dayX(k), x.gwh]), width: 2.5 }];
    lineChart($('au-ramp-days'), {
      series: s, yMin: 0, yFormat: (v) => `${n0(v)} GWh`, yTickFormat: (v) => n0(v),
      xTicks: [0, 60, 120, 180, 240, 300, 360].filter((k) => k < last.rampDays.length).map((k) => ({ t: dayX(k), label: `${k}` })),
      refLines: f.levels.batteries.map((b) => ({ value: b[1], color: css('--ink-3') })),
      tooltip: (t) => { const k = Math.round(t / 864e5); const x = last.rampDays[k]; return x ? `<strong>Day ${k + 1} of ${last.rampDays.length}</strong><div>Fossil above the floor: <b>${n0(x.gwh)} GWh</b></div><div>Peak above the floor: <b>${gw(x.peak)}</b></div><div>The day's floor: <b>${gw(x.floor)}</b></div><div>Month: <b>${MONTHS[x.month - 1]}</b></div>` : ''; },
    });
    $('au-ramp-days-legend').innerHTML = `${legend(s.map((x) => [x.color, x.name]))}<span>Lines: ${f.levels.batteries.map((b) => `${b[1]} GWh`).join(', ')}</span>`;
  }
  if ($('au-low-year')) {
    const st = [{ name: `Fossil under ${gw(f.levels.fossilLow)}`, color: css('--lowcarbon'), values: rows.map((r) => r.fossilLowHours) }];
    barChart($('au-low-year'), {
      cats, stacks: st, yFormat: hrs, yTickFormat: (v) => n0(v),
      highlight: (ci) => rows[ci].year === 'past365',
      tooltip: (ci) => `<strong>${yearTitle(rows[ci].year)}</strong><div>Hours under ${gw(f.levels.fossilLow)}: <b>${n0(rows[ci].fossilLowHours)}</b></div><div>Lowest ${isCoal ? 'coal' : 'fossil'}: <b>${gw(isCoal ? rows[ci].coalMin : rows[ci].fosMin)}</b></div><div>Coal: <b>${twh(rows[ci].coalTwh)}</b>, gas: <b>${twh(rows[ci].gasTwh)}</b></div>`,
    });
    $('au-low-year-legend').innerHTML = legend(st.map((x) => [x.color, x.name]));
  }
}
