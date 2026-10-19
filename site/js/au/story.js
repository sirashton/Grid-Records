// The Australia story. storyFigures() works out every number from the data
// (the tests run it too); renderStory() writes the answer, the facts and the
// chapters, and draws the charts.
import { summarise, formatDuration, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { metricSeries, generationTotal, yearlyEnergy, fuelsWhere } from '../core/dataset.js';
import { monthly, averageDay, hoursBelowPrice, nemMonth } from './data.js';
import { HOME_BATTERIES, AEMO_Q2_2026 } from './sources.js';

const DAY_MS = 86400000;
const OFFSET = 10 * 3600000;

const spellOf = (values, threshold, mode, data) => summarise(values, threshold, mode, { startMs: data.startMs, timeZone: 'Australia/Brisbane', maxGap: 2 });

/** Mean of values over [a, b), skipping missing slots. */
function meanOver(values, a, b) {
  let s = 0;
  let n = 0;
  for (let i = Math.max(0, a); i < b; i++) if (!Number.isNaN(values[i])) { s += values[i]; n++; }
  return n ? s / n : NaN;
}

/** The same calendar months a year apart: the latest `months` whole months of data, and the year before. */
function comparePeriods(data, end, months = 3) {
  const lastMs = data.startMs + (end - 1) * 18e5;
  const last = new Date(lastMs + OFFSET);
  // The month the data ends in counts if the data runs to its last day.
  const endMonth = new Date(lastMs + OFFSET + 18e5).getUTCDate() === 1 ? last.getUTCMonth() + 1 : last.getUTCMonth();
  const at = (y, m) => Date.UTC(y, m, 1) - OFFSET;
  const y = last.getUTCFullYear();
  return {
    now: { fromMs: at(y, endMonth - months), toMs: at(y, endMonth) },
    before: { fromMs: at(y - 1, endMonth - months), toMs: at(y - 1, endMonth) },
    // Two years back, to tell a change in the day's shape from a falling level.
    earlier: { fromMs: at(y - 2, endMonth - months), toMs: at(y - 2, endMonth) },
  };
}

const label = ({ fromMs, toMs }) => {
  const f = (ms, opts) => new Date(ms).toLocaleDateString('en-AU', { timeZone: 'Australia/Brisbane', ...opts });
  return `${f(fromMs, { month: 'short' })} to ${f(toMs - 1, { month: 'short', year: 'numeric' })}`;
};

/** Every number the story uses, for one area. */
export function storyFigures(data, end, country) {
  const d = { ...data, length: end };
  const fossilFuels = fuelsWhere(country, 'fossil');
  const energy = yearlyEnergy(d, country).filter((r) => r.coverage > 0.95);
  const months = monthly(d, country).filter((m) => m.complete);
  const periods = comparePeriods(d, end);
  const idx = (ms) => Math.round((ms - d.startMs) / 18e5);

  const dis = metricSeries(d, country, ['battery']);
  const chg = metricSeries(d, country, ['battery_charge']);
  const price = d.columns.price;
  const gas = metricSeries(d, country, ['gas']);
  const fossilPct = metricSeries(d, country, fossilFuels, { unit: 'pct' });
  const coalPct = metricSeries(d, country, ['coal', 'lignite'], { unit: 'pct' });
  const renewablePct = metricSeries(d, country, fuelsWhere(country, 'renewable'), { unit: 'pct' });

  const series = { price, dis, chg, gas, demand: d.columns.demand };
  const day = Object.fromEntries(Object.entries(periods).map(([k, p]) => [k, withShape(averageDay(d, p.fromMs, p.toMs, series))]));
  // Hours of the average day dearer than a year earlier.
  day.hoursDearer = day.now.price.filter((v, k) => v > day.before.price[k]).length / 2;
  const period = (p, avg) => {
    const [a, b] = [idx(p.fromMs), idx(p.toMs)];
    let pd = 0;
    let w = 0;
    let neg = 0;
    let n = 0;
    for (let i = a; i < b; i++) {
      const p = price[i];
      const dm = d.columns.demand[i];
      if (Number.isNaN(p)) continue;
      n++;
      if (p < 0) neg++;
      if (dm > 0) { pd += p * dm; w += dm; }
    }
    // Evening peak: 4pm to 9pm, NEM time, as AEMO defines it.
    const evening = (k) => (k >= 32 && k < 42);
    const dayOf = (s, pick) => { let v = 0; let c = 0; s.forEach((x, k) => { if (pick(k) && !Number.isNaN(x)) { v += x; c++; } }); return c ? v / c : NaN; };
    return {
      ...p,
      label: label(p),
      price: w ? pd / w : NaN,
      negativePct: n ? (neg / n) * 100 : NaN,
      batteryGw: meanOver(dis, a, b),
      chargeGw: meanOver(chg, a, b),
      gasGw: meanOver(gas, a, b),
      eveningPrice: dayOf(avg.price, evening),
      middayPrice: dayOf(avg.price, (k) => k >= 20 && k < 32),
      eveningBatteryGw: dayOf(avg.dis, evening),
      eveningGasGw: dayOf(avg.gas, evening),
      eveningDemandGw: dayOf(avg.demand, evening) / 1000,
      renewablePct: meanOver(renewablePct, a, b),
    };
  };
  const now = period(periods.now, day.now);
  const before = period(periods.before, day.before);
  const earlier = period(periods.earlier, day.earlier);

  // Records: how long the grid has gone with little coal, and with the price below zero.
  const spells = {
    fossil: [50, 40, 30, 20].map((t) => ({ t, ...pick(spellOf(fossilPct, t, 'below', d)) })),
    coal: [40, 30, 20].map((t) => ({ t, ...pick(spellOf(coalPct, t, 'below', d)) })),
    renewables: [50, 60, 70, 80].map((t) => ({ t, ...pick(spellOf(renewablePct, t, 'above', d)) })),
    negative: [0, -20, -50].map((t) => ({ t, ...pick(spellOf(price, t, 'below', d)) })),
  };
  const fossilHours = byShare(d, fossilPct, [50, 40, 30]);
  const negativeHours = hoursBelowPrice(d, energy.map((r) => yearWindow(r.year, end, d)), [0]).map((r, k) => ({ year: energy[k].year, hours: r.hours[0], share: r.priced ? r.hours[0] / r.priced : NaN }));
  let peakDis = { v: 0, i: -1 };
  let peakChg = { v: 0, i: -1 };
  for (let i = 0; i < end; i++) {
    if (dis[i] > peakDis.v) peakDis = { v: dis[i], i };
    if (chg[i] > peakChg.v) peakChg = { v: chg[i], i };
  }
  return { energy, months, now, before, earlier, day, spells, fossilHours, negativeHours, peakDis, peakChg };
}

/** The average day's dearest and cheapest half hours, and its battery and gas peaks. */
function withShape(avg) {
  const at = (arr, better) => arr.reduce((b, v, k) => (!Number.isNaN(v) && (b.k < 0 || better(v, b.v)) ? { v, k } : b), { v: NaN, k: -1 });
  const hi = at(avg.price, (a, b) => a > b);
  const lo = at(avg.price, (a, b) => a < b);
  const max = (arr) => at(arr, (a, b) => a > b).v;
  return { ...avg, peakPrice: hi.v, peakAt: hi.k, minPrice: lo.v, minAt: lo.k, spread: hi.v - lo.v, peakDis: max(avg.dis), peakChg: max(avg.chg), peakGas: max(avg.gas) };
}

const pick = (s) => ({ record: s.record, current: s.current, perYear: s.perYear, pastYear: s.pastYear });

/** The slot window for a calendar year in NEM time, or the latest 365 days. */
function yearWindow(year, end, d) {
  if (year === 'past365') return { label: 'past365', fromMs: d.startMs + (end - 365 * 48) * 18e5, toMs: d.startMs + end * 18e5 };
  return { label: String(year), fromMs: Date.UTC(year, 0, 1) - OFFSET, toMs: Date.UTC(year + 1, 0, 1) - OFFSET };
}

/** Hours each year with a share series below each level. */
function byShare(d, values, levels) {
  const rows = new Map();
  const end = d.length;
  for (let i = 0; i < end; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    const y = new Date(d.startMs + i * 18e5 + OFFSET).getUTCFullYear();
    const r = rows.get(y) ?? rows.set(y, { year: y, hours: levels.map(() => 0), n: 0 }).get(y);
    r.n++;
    levels.forEach((l, k) => { if (v < l) r.hours[k] += 0.5; });
  }
  const past = { year: 'past365', hours: levels.map(() => 0), n: 0 };
  for (let i = Math.max(0, end - 365 * 48); i < end; i++) {
    const v = values[i];
    if (Number.isNaN(v)) continue;
    past.n++;
    levels.forEach((l, k) => { if (v < l) past.hours[k] += 0.5; });
  }
  const lastYear = new Date(d.startMs + (end - 1) * 18e5 + OFFSET + 18e5).getUTCFullYear();
  return [...rows.values()].filter((r) => r.n >= 365 * 48 * 0.95 && r.year < lastYear).concat(past.n >= 365 * 48 * 0.95 ? [past] : []);
}

// ---------------------------------------------------------------------------
// Drawing

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = (id) => document.getElementById(id);
const num = (v) => v.toLocaleString('en-AU');
const money = (v) => `${v < 0 ? '−' : ''}$${num(Math.abs(Math.round(v)))}`;
const gw = (v) => (Math.abs(v) < 1 ? `${Math.round(v * 1000)} MW` : `${v.toFixed(2)} GW`);
const pc = (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`;
const change = (a, b) => `${Math.round(Math.abs((a - b) / b) * 100)}%`;
const yearLabel = (y) => (y === 'past365' ? '365d' : String(y));
const yearTitle = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([c, n]) => `<span><span class="swatch" style="background:${c}"></span>${n}</span>`).join('');
// A fixed day in NEM time, for the average-day charts' x axis.
const DAY0 = Date.UTC(2000, 0, 3) - OFFSET;
const dayPoints = (arr, scale = 1) => arr.map((v, k) => [DAY0 + k * 18e5, v * scale]);
// Clock labels every three hours for the average-day charts.
const DAY_TICKS = Array.from({ length: 8 }, (_, k) => ({ t: DAY0 + k * 108e5, label: k ? `${(k * 3) % 12 || 12}${k * 3 < 12 ? 'am' : 'pm'}` : 'midnight' }));
const slotClock = (k) => clock(DAY0 + k * 18e5);
const clock = (t) => new Date(t).toLocaleTimeString('en-AU', { timeZone: 'Australia/Brisbane', hour: 'numeric', minute: '2-digit' });

function chapter(n, id, title, take, body, next) {
  return `<details class="chapter" id="${id}"${n === 1 ? ' open' : ''}>
    <summary><span class="ch-num">${n}</span><span class="ch-text"><span class="ch-title">${title}</span><span class="ch-take">${take}</span></span></summary>
    <div class="ch-body">${body}${next ? `<button type="button" class="edit-btn next-ch" data-next="${next[0]}">Next: ${next[1]}</button>` : ''}</div>
  </details>`;
}

/**
 * Writes the story for one area. `cache` is the previous return value, so
 * the figures are only worked out once per area.
 */
export function renderStory({ data, end, country, area, areaName, cache, factsHtml }) {
  const f = cache?.area === area ? cache.f : storyFigures(data, end, country);
  const where = area === 'nem' ? 'the NEM' : areaName;
  const Where = area === 'nem' ? 'The NEM' : areaName;
  const { now, before } = f;
  const at = (i) => fmtDate(slotTime(i, data.startMs));
  const dur = (s) => (s?.record ? formatDuration(s.record.end - s.record.start) : 'never');
  const from = (s) => (s?.record ? `from ${at(s.record.start)}` : '');
  const en = f.energy;
  const past = en.at(-1);
  const first = en.find((r) => r.year !== 'past365');

  // In short: the answer, then why, each point linking to its chapter.
  const link = (ch, text) => `<a href="#${ch}" data-open="${ch}">${text}</a>`;
  const { day } = f;
  const fell = now.price < before.price;
  const eveningFell = now.eveningPrice < before.eveningPrice;
  const middayRose = now.middayPrice > before.middayPrice;
  const hrs = f.fossilHours;
  const lastHours = hrs.at(-1);
  const firstHours = hrs.find((r) => r.hours[1] < r.n / 2) ?? hrs[0];
  $('answer-lead').innerHTML = `${Where}'s wholesale price averaged ${money(now.price)}/MWh over ${now.label}, ${fell ? 'down' : 'up'} ${change(now.price, before.price)} on the same months a year earlier (${money(before.price)}). ${eveningFell && middayRose
    ? `Most of the fall came between 4pm and 9pm. Grid batteries now charge on the midday solar surplus and sell it back in the evening, so the evening price fell by ${change(now.eveningPrice, before.eveningPrice)} while midday prices went up.`
    : `Between 4pm and 9pm the price went from ${money(before.eveningPrice)} to ${money(now.eveningPrice)}/MWh, and at midday from ${money(before.middayPrice)} to ${money(now.middayPrice)}.`}`;
  $('answer-points').innerHTML = [
    `<b>Evenings got ${eveningFell ? 'cheaper' : 'dearer'}.</b> Between 4pm and 9pm the price averaged ${money(now.eveningPrice)}/MWh, from ${money(before.eveningPrice)}. The dearest half hour of the average day went from ${money(day.before.peakPrice)} to ${money(day.now.peakPrice)}. ${link('chapter-1', 'The evening')}`,
    `<b>Batteries moved the surplus to where the price was.</b> Between 4pm and 9pm grid batteries put out ${gw(now.eveningBatteryGw)}, from ${gw(before.eveningBatteryGw)} a year earlier, and gas went from ${gw(before.eveningGasGw)} to ${gw(now.eveningGasGw)}. They charge at up to ${gw(day.now.peakChg)} around midday, when ${pc(now.negativePct)} of half hours were priced below zero, against ${pc(before.negativePct)}. ${link('chapter-2', 'Batteries')}`,
    `<b>This was storage, not more renewables.</b> Renewables made ${pc(now.renewablePct)} of generation over ${now.label}, against ${pc(before.renewablePct)} a year earlier. Over the longer run coal is giving ground hour by hour: fossil fuels were under 40% of ${where}'s generation for ${num(Math.round(lastHours.hours[1]))} hours in the latest year, from ${num(Math.round(firstHours.hours[1]))} in ${firstHours.year}. ${link('chapter-3', 'Coal')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  $('facts').innerHTML = factsHtml(dur(f.spells.fossil[1]), `with fossil fuels under 40% of ${where}'s generation, ${from(f.spells.fossil[1])}. The longest run so far.`, [
    ['--lowcarbon', 'Renewables above 50%', dur(f.spells.renewables[0]), from(f.spells.renewables[0])],
    ['--f-coal', 'Coal under 30%', dur(f.spells.coal[1]), from(f.spells.coal[1])],
    ['--s1', 'Price below zero', dur(f.spells.negative[0]), from(f.spells.negative[0])],
    ['--f-battery', 'Most battery output', gw(f.peakDis.v), f.peakDis.i >= 0 ? `at ${fmtDate(slotTime(f.peakDis.i, data.startMs))}` : ''],
  ]);
  $('story-hint').textContent = "Four chapters: what happened to the evening price, what the batteries did, how fast coal is going, and the half a million home batteries the market data can't see.";

  const { earlier } = f;
  const pastEnergy = en.at(-1);
  const coalShare = ((pastEnergy.twh.coal + pastEnergy.twh.lignite) / pastEnergy.total) * 100;
  const gasFirst = en.find((r) => r.twh.gas > 0) ?? first;
  const chapters = [
    chapter(1, 'chapter-1', `The evening peak ${eveningFell ? 'lost' : 'gained'} ${change(now.eveningPrice, before.eveningPrice)}`, `Between 4pm and 9pm the price averaged ${money(now.eveningPrice)}/MWh over ${now.label}, from ${money(before.eveningPrice)} a year earlier.`, `
      <p>A year ago the price climbed through the afternoon to ${money(day.before.peakPrice)} at ${slotClock(day.before.peakAt)}. This year the dearest half hour was ${money(day.now.peakPrice)}, at ${slotClock(day.now.peakAt)}, and the gap between the dearest and cheapest half hours of the average day went from ${money(day.before.spread)} to ${money(day.now.spread)}. Midday went the other way, from ${money(before.middayPrice)} to ${money(now.middayPrice)}/MWh between 10am and 4pm. Only ${day.hoursDearer} hours of the average day are dearer than a year ago.</p>
      ${Number.isFinite(earlier.eveningPrice) ? `<p>Two years back, over ${earlier.label}, the evening averaged ${money(earlier.eveningPrice)} and midday ${money(earlier.middayPrice)}.${earlier.eveningPrice > before.eveningPrice && before.eveningPrice > now.eveningPrice ? ' The evening price has now fallen two years running.' : ''}${middayRose && earlier.middayPrice > before.middayPrice ? ` Midday is back near where it was then, after a dip in ${before.label.slice(-4)}.` : ''}</p>` : ''}
      <h3>The price through the average day</h3>
      <p class="hint">Spot price by half hour, in $/MWh, NEM time${area === 'nem' ? ', weighted by each state\'s demand' : ''}.</p>
      <div class="chart-host" id="au-price-day"></div>
      <div class="legend" id="au-price-day-legend"></div>
      <h3>The price each month</h3>
      <p class="hint">Demand-weighted mean spot price each month, in $/MWh. September is cheap every year, with spring sun and wind.</p>
      <div class="chart-host" id="au-price-month"></div>`, ['chapter-2', 'Batteries']),
    chapter(2, 'chapter-2', 'Batteries bought the midday surplus', `Grid batteries charge at up to ${gw(day.now.peakChg)} around midday and put out up to ${gw(day.now.peakDis)} in the evening, from ${gw(day.before.peakDis)} a year earlier.`, `
      <p>Batteries charge when solar is pushing the price down and sell when gas would otherwise set it. Over ${now.label} they averaged ${gw(now.batteryGw)} of output and ${gw(now.chargeGw)} of charging, against ${gw(before.batteryGw)} and ${gw(before.chargeGw)} a year earlier. Gas at its evening peak went from ${gw(day.before.peakGas)} to ${gw(day.now.peakGas)}. With somewhere for spare solar to go, ${pc(now.negativePct)} of half hours were priced below zero, against ${pc(before.negativePct)}.</p>
      <p>Batteries are still a small part of evening supply, and they are not the only thing in these prices: power flows between states, the price of gas and the weather matter too, and this data can't say how much of the fall is which.${area === 'nem' ? ' The state buttons above show where the batteries are; some states saw their evening price fall with little change in their own batteries.' : ''}</p>
      <h3>Batteries through the average day</h3>
      <p class="hint">Grid battery output (up) and charging (down), in MW, NEM time.</p>
      <div class="chart-host" id="au-bat-day"></div>
      <div class="legend" id="au-bat-day-legend"></div>
      <h3>Gas through the average day</h3>
      <p class="hint">Gas generation by half hour, in MW, NEM time.</p>
      <div class="chart-host" id="au-gas-day"></div>
      <div class="legend" id="au-gas-day-legend"></div>
      <h3>Battery output each month</h3>
      <p class="hint">Mean output and charging each month, in MW. Charging is bigger because some energy is lost on the way through.</p>
      <div class="chart-host" id="au-bat-month"></div>
      <div class="legend" id="au-bat-month-legend"></div>
      <h3>Hours below zero each year</h3>
      <p class="hint">Hours with a negative spot price. The last bar is the latest 365 days.</p>
      <div class="chart-host" id="au-neg-year"></div>`, ['chapter-3', 'Coal']),
    chapter(3, 'chapter-3', 'Coal is going by the hour, not the year', `Renewables made ${pc(past.renewablePct)} of ${where}'s generation over the latest year, from ${pc(first.renewablePct)} in ${first.year}.`, `
      <p>The price fall above came with little change in the renewable share: ${pc(before.renewablePct)} a year ago, ${pc(now.renewablePct)} now. Coal still made ${pc(coalShare)} of the latest year's power. What is changing fast is the number of hours it isn't needed: fossil fuels were under 40% of generation for ${num(Math.round(lastHours.hours[1]))} hours in the latest year and under 30% for ${num(Math.round(lastHours.hours[2]))}, against ${num(Math.round(firstHours.hours[1]))} and ${num(Math.round(firstHours.hours[2]))} in ${firstHours.year}. Gas made ${pastEnergy.twh.gas.toFixed(1)} TWh in the latest year, from ${gasFirst.twh.gas.toFixed(1)} TWh in ${gasFirst.year}.</p>
      <h3>Where the power comes from</h3>
      <p class="hint">Share of generation each year, rooftop solar included. The last bar is the latest 365 days.</p>
      <div class="chart-host" id="au-mix"></div>
      <div class="legend" id="au-mix-legend"></div>
      <h3>Hours each year with little fossil fuel</h3>
      <p class="hint">Hours with fossil fuels under 50%, 40% and 30% of generation.</p>
      <div class="chart-host" id="au-fossil-hours"></div>
      <div class="legend" id="au-fossil-hours-legend"></div>`, ['chapter-4', 'Home batteries']),
    chapter(4, 'chapter-4', "The batteries the data can't see", `About ${num(HOME_BATTERIES.latest.installs)} home batteries have been installed under the federal scheme since July 2025.`, homeBatteriesHtml(now, before), null),
  ];
  $('chapters').innerHTML = chapters.join('');
  drawCharts(f, data);
  return { area, f };
}

function homeBatteriesHtml(now, before) {
  const h = HOME_BATTERIES;
  const q = AEMO_Q2_2026;
  return `<p>Home batteries sit behind the meter, so none of the charts above include them. To the grid they look like homes using less power at 6pm. The Cheaper Home Batteries Program has paid about 30% of the cost since July 2025, and uptake has been quick:</p>
    <ul class="notes">${h.milestones.map((m) => `<li><b>${m.when}:</b> ${m.text} (<a href="${m.url}">${m.source}</a>)</li>`).join('')}</ul>
    <p>AEMO's report for April to June 2026 counted ${num(q.homeBatteryMwh)} MWh across ${num(q.homeBatteryInstalls)} homes, up ${q.homeBatteryGrowthPct}% in a quarter, and found homes with solar and a battery drew ${q.eveningImportCutPct}% less from the grid between 4pm and 9pm than homes with solar alone (<a href="${q.url}">AEMO</a>, <a href="${q.newsUrl}">Energy-Storage.News</a>). In this data that can only show up as lower evening demand: ${gw(now.eveningDemandGw)} between 4pm and 9pm over ${now.label}, against ${gw(before.eveningDemandGw)} a year earlier. The weather moves that as much as batteries do.</p>`;
}

function drawCharts(f, data) {
  const { now, before, day } = f;
  const tip = (t, vals, fmt) => `<strong>${clock(t)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? fmt(v.value) : '—'}</b></div>`).join('')}`;
  const mw = (v) => `${num(Math.round(v))} MW`;
  if ($('au-bat-day')) {
    const s = [
      { name: `Output, ${now.label}`, color: css('--f-battery'), points: dayPoints(day.now.dis, 1000) },
      { name: `Charging, ${now.label}`, color: css('--s1'), points: dayPoints(day.now.chg, -1000) },
      { name: `Output, ${before.label}`, color: css('--f-battery'), points: dayPoints(day.before.dis, 1000), width: 1.5, opacity: 0.45 },
      { name: `Charging, ${before.label}`, color: css('--s1'), points: dayPoints(day.before.chg, -1000), width: 1.5, opacity: 0.45 },
    ];
    lineChart($('au-bat-day'), { xTicks: DAY_TICKS, series: s, zeroLine: true, yFormat: mw, yTickFormat: (v) => num(v), tooltip: (t, v) => tip(t, v, mw) });
    $('au-bat-day-legend').innerHTML = legend(s.map((x) => [x.color, x.name]));
    const m = f.months.filter((r) => r.month >= '2020-01');
    const toMs = (ym) => Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1, 15);
    const ms = [
      { name: 'Output', color: css('--f-battery'), points: m.map((r) => [toMs(r.month), r.batteryMw]) },
      { name: 'Charging', color: css('--s1'), points: m.map((r) => [toMs(r.month), -r.chargeMw]) },
    ];
    lineChart($('au-bat-month'), { series: ms, zeroLine: true, yFormat: mw, yTickFormat: (v) => num(v), tooltip: (t, v) => `<strong>${new Date(t).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</strong>${v.map((x) => `<div><i style="background:${x.series.color}"></i>${x.series.name}: <b>${mw(Math.abs(x.value))}</b></div>`).join('')}` });
    $('au-bat-month-legend').innerHTML = legend(ms.map((x) => [x.color, x.name]));
  }
  if ($('au-gas-day')) {
    const s = [
      { name: now.label, color: css('--f-gas'), points: dayPoints(day.now.gas, 1000) },
      { name: before.label, color: css('--f-gas'), points: dayPoints(day.before.gas, 1000), width: 1.5, opacity: 0.45 },
    ];
    lineChart($('au-gas-day'), { xTicks: DAY_TICKS, series: s, yMin: 0, yFormat: mw, yTickFormat: (v) => num(v), tooltip: (t, v) => tip(t, v, mw) });
    $('au-gas-day-legend').innerHTML = legend(s.map((x) => [x.color, x.name]));
  }
  if ($('au-price-day')) {
    const s = [
      { name: now.label, color: css('--s2'), points: dayPoints(day.now.price) },
      { name: before.label, color: css('--s2'), points: dayPoints(day.before.price), width: 1.5, opacity: 0.45 },
    ];
    const fmt = (v) => `${money(v)}/MWh`;
    lineChart($('au-price-day'), { xTicks: DAY_TICKS, series: s, zeroLine: true, yFormat: fmt, yTickFormat: (v) => money(v), tooltip: (t, v) => tip(t, v, fmt) });
    $('au-price-day-legend').innerHTML = legend(s.map((x) => [x.color, x.name]));
    const toMs = (ym) => Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1, 15);
    const byMonth = new Map(f.months.map((r) => [toMs(r.month), r]));
    lineChart($('au-price-month'), {
      series: [{ name: 'Mean price', color: css('--s2'), points: f.months.map((r) => [toMs(r.month), r.price]) }],
      yMin: 0,
      yFormat: fmt,
      yTickFormat: (v) => money(v),
      tooltip: (t, v) => { const r = byMonth.get(v[0]?.point?.[0]) ?? null; return `<strong>${new Date(t).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</strong><div>Mean price: <b>${Number.isFinite(v[0]?.value) ? fmt(v[0].value) : '—'}</b></div>${r ? `<div>Below zero: <b>${pc(r.negativePct)}</b> of half hours</div><div>Renewable: <b>${pc(r.renewablePct)}</b></div>` : ''}`; },
    });
    const neg = f.negativeHours;
    barChart($('au-neg-year'), {
      cats: neg.map((r) => yearLabel(r.year)),
      stacks: [{ name: 'Hours below zero', color: css('--s1'), values: neg.map((r) => r.hours) }],
      yFormat: (v) => `${num(Math.round(v))} h`,
      yTickFormat: (v) => num(v),
      highlight: (ci) => neg[ci].year === 'past365',
      tooltip: (ci) => `<strong>${yearTitle(neg[ci].year)}</strong><div>Below zero: <b>${num(Math.round(neg[ci].hours))} h</b> (${pc(neg[ci].share * 100)} of the time)</div>`,
    });
  }
  if ($('au-mix')) {
    const en = f.energy;
    const MIX = ['coal', 'lignite', 'gas', 'oil', 'other', 'biomass', 'hydro', 'wind', 'solar_utility', 'solar_rooftop'];
    const FUEL = { coal: ['Black coal', '--f-coal'], lignite: ['Brown coal', '--f-lignite'], gas: ['Gas', '--f-gas'], oil: ['Diesel and oil', '--f-diesel'], other: ['Other', '--f-other'], biomass: ['Bioenergy', '--f-biomass'], hydro: ['Hydro', '--f-hydro'], wind: ['Wind', '--f-wind'], solar_utility: ['Solar farms', '--f-solar'], solar_rooftop: ['Rooftop solar', '--f-rooftop'] };
    const stacks = MIX.map((k) => ({ name: FUEL[k][0], color: css(FUEL[k][1]), values: en.map((r) => ((r.twh[k] ?? 0) / r.total) * 100) }));
    barChart($('au-mix'), {
      cats: en.map((r) => yearLabel(r.year)),
      stacks,
      yMax: 100,
      yFormat: pc,
      yTickFormat: (v) => `${v}%`,
      highlight: (ci) => en[ci].year === 'past365',
      tooltip: (ci) => `<strong>${yearTitle(en[ci].year)}</strong><div>Renewable: <b>${pc(en[ci].renewablePct)}</b></div>${[...stacks].reverse().filter((s) => s.values[ci] >= 0.05).map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${pc(s.values[ci])}</b></div>`).join('')}`,
    });
    $('au-mix-legend').innerHTML = legend([...stacks].reverse().map((s) => [s.color, s.name]));
    const hrs = f.fossilHours;
    const hs = [
      { name: 'Under 30%', color: css('--h7'), values: hrs.map((r) => r.hours[2]) },
      { name: '30 to 40%', color: css('--lowcarbon'), values: hrs.map((r) => r.hours[1] - r.hours[2]) },
      { name: '40 to 50%', color: css('--h2'), values: hrs.map((r) => r.hours[0] - r.hours[1]) },
    ];
    barChart($('au-fossil-hours'), {
      cats: hrs.map((r) => yearLabel(r.year)),
      stacks: hs,
      yFormat: (v) => `${num(Math.round(v))} h`,
      yTickFormat: (v) => num(v),
      highlight: (ci) => hrs[ci].year === 'past365',
      tooltip: (ci) => `<strong>${yearTitle(hrs[ci].year)}</strong><div>Fossil under 50%: <b>${num(Math.round(hrs[ci].hours[0]))} h</b> (${pc((hrs[ci].hours[0] / 8760) * 100)} of the year)</div><div>Under 40%: <b>${num(Math.round(hrs[ci].hours[1]))} h</b></div><div>Under 30%: <b>${num(Math.round(hrs[ci].hours[2]))} h</b></div>`,
    });
    $('au-fossil-hours-legend').innerHTML = legend(hs.map((s) => [s.color, s.name]));
  }
}
