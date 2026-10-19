// The Poland story: has the economics of renewables beaten the politics of
// coal? At midday it has; in the evening coal is paid more each year. The
// figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import pl from '../countries/pl.js';
import { FOSSIL, RENEWABLE, COAL, GENERATION, metricSeries, yearlyEnergy, byYear } from './data.js';

// Coal levels the story follows, in GW.
export const COAL_LOW = 7;
export const COAL_MID = 10;
// Day-ahead price bands, in EUR/MWh.
export const PRICE_BANDS = [
  { label: 'Below €0', lo: -Infinity, hi: 0 },
  { label: '€0 to €50', lo: 0, hi: 50 },
  { label: '€50 to €100', lo: 50, hi: 100 },
  { label: '€100 to €150', lo: 100, hi: 150 },
  { label: '€150 to €200', lo: 150, hi: 200 },
  { label: '€200 and up', lo: 200, hi: Infinity },
];
// Local hours averaged as "midday" and "evening".
const MIDDAY = [11, 14];
const EVENING = [18, 20];

/**
 * Local hour of day and "YYYY-MM" for every slot. Warsaw's offset is looked up
 * once per UTC day, so the hour around a clock change can be one off.
 */
function localClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Array(data.length);
  let day = -1;
  let offset = 0;
  for (let i = 0; i < data.length; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== day) {
      day = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, pl.timeZone);
    }
    const local = new Date(t + offset);
    hour[i] = local.getUTCHours();
    month[i] = local.toISOString().slice(0, 7);
  }
  return { hour, month };
}

const mean = (sum, n) => (n ? sum / n : NaN);

/**
 * Every number the story uses. Rows run by Polish calendar year, complete
 * years only, then 'past365' for the latest 365 days.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const energy = yearlyEnergy(d);
  const coal = metricSeries(d, COAL);
  const fossil = metricSeries(d, FOSSIL);
  const solar = metricSeries(d, ['solar']);
  const renewPct = metricSeries(d, RENEWABLE, { unit: 'pct' });
  const gas = metricSeries(d, ['gas']);
  const wind = metricSeries(d, ['wind_onshore', 'wind_offshore']);
  const price = data.columns.price ?? new Float64Array(end).fill(NaN);
  const exports = data.columns.exports;
  const imports = data.columns.imports;
  const { hour, month } = localClock(d);

  const rows = byYear(d, () => ({
    coalMin: Infinity, coalMax: -Infinity, fossilMin: Infinity, coalLow: 0, coalMid: 0, coalLowSun: 0, renew50: 0, solarMax: 0,
    priceSum: 0, priceN: 0, neg: 0, middaySum: 0, middayN: 0, eveningSum: 0, eveningN: 0,
    solarRev: 0, solarMw: 0, coalRev: 0, coalMw: 0, byHour: new Float64Array(24), byHourN: new Float64Array(24),
    trade: 0,
  }), (r, i) => {
    const c = coal[i];
    if (Number.isNaN(c)) return;
    if (c < r.coalMin) r.coalMin = c;
    if (c > r.coalMax) r.coalMax = c;
    if (fossil[i] < r.fossilMin) r.fossilMin = fossil[i];
    if (c < COAL_LOW) {
      r.coalLow += slotH;
      if (solar[i] >= 1) r.coalLowSun += slotH;
    }
    if (c < COAL_MID) r.coalMid += slotH;
    if (renewPct[i] >= 50) r.renew50 += slotH;
    if (solar[i] > r.solarMax) r.solarMax = solar[i];
    // Imports positive, exports negative, so this is net imports.
    r.trade += ((imports[i] + exports[i]) * slotH) / 1e6;
    const p = price[i];
    if (Number.isNaN(p)) return;
    r.priceSum += p;
    r.priceN++;
    if (p < 0) r.neg += slotH;
    const hr = hour[i];
    r.byHour[hr] += p;
    r.byHourN[hr]++;
    if (hr >= MIDDAY[0] && hr <= MIDDAY[1]) { r.middaySum += p; r.middayN++; }
    if (hr >= EVENING[0] && hr <= EVENING[1]) { r.eveningSum += p; r.eveningN++; }
    r.solarRev += p * solar[i];
    r.solarMw += solar[i];
    r.coalRev += p * c;
    r.coalMw += c;
  }).map((r) => ({
    year: r.year,
    coalMin: r.coalMin,
    coalMax: r.coalMax,
    fossilMin: r.fossilMin,
    coalLow: r.coalLow,
    coalLowSunShare: r.coalLow ? r.coalLowSun / r.coalLow : NaN,
    coalMid: r.coalMid,
    renew50: r.renew50,
    solarMax: r.solarMax,
    price: mean(r.priceSum, r.priceN),
    negHours: r.neg,
    midday: mean(r.middaySum, r.middayN),
    evening: mean(r.eveningSum, r.eveningN),
    solarCapture: mean(r.solarRev, r.solarMw),
    coalCapture: mean(r.coalRev, r.coalMw),
    byHour: [...r.byHour].map((v, k) => mean(v, r.byHourN[k])),
    netImportsTwh: r.trade,
  }));

  // What runs in each price band, over the latest two years.
  const bandFrom = Math.max(0, end - Math.round((730 * 24) / slotH));
  const bands = PRICE_BANDS.map((b) => ({ ...b, hours: 0, coal: 0, gas: 0, wind: 0, solar: 0, exports: 0, imports: 0 }));
  for (let i = bandFrom; i < end; i++) {
    const p = price[i];
    if (Number.isNaN(p) || Number.isNaN(coal[i])) continue;
    const b = bands.find((x) => p >= x.lo && p < x.hi);
    b.hours += slotH;
    b.coal += coal[i];
    b.gas += gas[i];
    b.wind += wind[i];
    b.solar += solar[i];
    b.exports -= exports[i] / 1000;
    b.imports += imports[i] / 1000;
  }
  for (const b of bands) {
    const n = b.hours / slotH;
    for (const k of ['coal', 'gas', 'wind', 'solar', 'exports', 'imports']) b[k] = mean(b[k], n);
  }

  // Coal's and renewables' monthly share of generation.
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const months = new Map();
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(coal[i])) continue;
    let gen = 0;
    for (const col of genCols) gen += col[i] || 0;
    if (!(gen > 0)) continue;
    const m = months.get(month[i]) ?? { coal: 0, renew: 0, gen: 0 };
    m.coal += coal[i] * 1000;
    m.renew += (renewPct[i] / 100) * gen;
    m.gen += gen;
    months.set(month[i], m);
  }
  // The last month may be part of a month.
  const monthly = [...months].map(([m, v]) => ({ month: m, coalPct: (v.coal / v.gen) * 100, renewPct: (v.renew / v.gen) * 100 }));

  const coalLowSpell = summarise(coal, COAL_LOW, 'below', { startMs: data.startMs, stepMinutes: step, timeZone: pl.timeZone });
  return { rows, energy, bands, bandFrom, monthly, coalLowSpell };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(1)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const eur = (v) => `€${Math.round(v)}`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const pct = (v) => `${v.toFixed(1)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const named = (y) => (y === 'past365' ? 'the latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;

const SOURCES = {
  veto: 'https://notesfrompoland.com/2025/08/21/polands-new-president-vetoes-bill-loosening-wind-turbine-law-freezing-energy-prices',
  tenh: 'https://defence24.com/legislation/tilting-at-windmills-polish-president-takes-up-political-fight-in-green-transition',
  derogation: 'https://energiesmedia.com/poland-wins-eu-approval-to-keep-coal-plants/',
  auction2027: 'https://modoenergy.com/research/poland-capacity-market-supplementary-auction-bess-2027',
  batteries: 'https://modoenergy.com/research/poland-battery-pipeline-buildout-queue-capacity-market-auctions-subsidy-grid-connection-queue',
  srmc: 'https://modoenergy.com/research/en/coal-solar-pse-tauron-enea-orlen-tge-utilities-spreads-retirement-solar-merit-gas-bess-batteries-poland-liberalised-carbon-ets-srmc',
  germany: 'https://bundesnetzagentur.de/SharedDocs/Pressemitteilungen/EN/2026/20260104_SMARD.html',
  necp: 'https://think.ing.com/opinions/polands-1000-page-energy-plan-big-ambition-challenging-to-deliver/',
  baltic: 'https://notesfrompoland.com/2026/07/10/polands-first-offshore-wind-farm-begins-generating-power/',
  mining: 'https://notesfrompoland.com/2026/01/30/poland-to-become-eus-last-remaining-producer-of-hard-coal-as-czech-mine-closes/',
};

/** Installed GW of a type at the end of a year, from Energy-Charts' yearly series. */
const cap = (installed, type, year) => installed?.types[type]?.[installed.years.indexOf(year)] ?? NaN;

export function renderStory(data, end, installed, figs) {
  const { rows, energy, bands, bandFrom, monthly, coalLowSpell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y);
  const en = (y) => energy.find((r) => r.year === y);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  // The last year coal never went under the low mark, and the first full year with a price.
  const noLow = [...full].reverse().find((r) => r.coalLow === 0) ?? first;
  const flat = row(2019) ?? full.find((r) => Number.isFinite(r.price)) ?? first;
  const peakPrice = row(2022);
  const capYear = installed ? Math.max(...installed.years) : null;
  const coalCap = cap(installed, 'Fossil hard coal', capYear) + cap(installed, 'Fossil brown coal / lignite', capYear);
  const neg = bands[0];
  const cheap = bands[1];
  const dear = bands.at(-1);
  const bandStart = fmtDate(at(bandFrom));
  const ratio = latest.evening / latest.midday;

  // Header and in short.
  $('lede').textContent = `In ${flat.year} a Polish evening cost about the same as a Polish lunchtime. In ${named(latest.year)} it cost ${Math.round(ratio * 2) / 2} times as much, and that gap is where coal now lives.`;
  $('answer-lead').textContent = `Yes, and it has already happened, but only at midday. Solar has pushed coal's floor from ${gw(first.coalMin)} to ${gw(last.coalMin)}, with no help from the wind law or the mining deal. The evening still belongs to coal, and will until batteries arrive and coal's capacity payments stop, which puts the crossover for the rest of the day between 2028 and 2030.`;
  $('answer-points').innerHTML = [
    `<b>Midday is gone.</b> Hours with coal under ${COAL_LOW} GW went from none in ${noLow.year} to ${hrs(last.coalLow)} in ${last.year}, ${Math.round(last.coalLowSunShare * 100)}% of them with the sun up. ${link(1, 'Chapter 1')}`,
    `<b>The evening pays coal more each year.</b> Midday prices fell from ${eur(peakPrice?.midday ?? flat.midday)} in ${peakPrice?.year ?? flat.year} to ${eur(latest.midday)} in ${named(latest.year)}, while evenings rose to ${eur(latest.evening)} a megawatt hour, and the average price coal sold at went from ${eur(row(2024)?.coalCapture ?? last.coalCapture)} in 2024 to ${eur(latest.coalCapture)}. ${link(2, 'Chapter 2')}`,
    `<b>About ${Math.round(neg.coal)} GW of coal ignores the price.</b> When the price goes below zero, Poland still runs ${gw(neg.coal)} of coal and exports ${gw(neg.exports)}. The capacity payments that keep that fleet ready end on 31 December 2028, and 5.1 GW of batteries are contracted for 2027 to 2030. ${link(3, 'Chapters 3')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-coal', 'Coal\'s lowest output', gw(last.coalMin), `in ${last.year}, against ${gw(first.coalMin)} in ${first.year}`],
    ['--f-coal', `Hours with coal under ${COAL_LOW} GW`, n0(last.coalLow), `in ${last.year}, none in ${noLow.year}`],
    ['--f-coal', 'Coal running at negative prices', gw(neg.coal), `on average, since ${bandStart}`],
    ['--f-battery', 'Grid batteries', installed ? `${gw(Math.max(0, ...data.columns.battery.subarray(Math.max(0, end - 35040), end)) / 1000)} at most` : '', `against ${Math.round(cap(installed, 'Solar AC', capYear))} GW of solar`],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${eur(latest.evening)} vs ${eur(latest.midday)}</div><div class="sub">The average day-ahead price per MWh in the evening (${EVENING[0]}:00 to ${EVENING[1] + 1}:00) and at midday (${MIDDAY[0]}:00 to ${MIDDAY[1] + 1}:00), ${named(latest.year)}. In ${flat.year} they were ${eur(flat.evening)} and ${eur(flat.midday)}.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters on where solar has already beaten coal, where it hasn\'t, and when that changes.';

  const chapters = [
    'Midday has already gone',
    'The evening pays coal more every year',
    'Six gigawatts that ignore the price',
    'What politics built, and what it didn\'t',
    'The date on the crossover',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });

  // Chapter 1: floor and ceiling.
  const rec = coalLowSpell.record;
  $('take-1').textContent = `Coal's floor has nearly halved, and it spent ${hrs(last.coalLow)} under ${COAL_LOW} GW in ${last.year}.`;
  $('body-1').innerHTML = `In ${first.year} Polish coal never dropped below ${gw(first.coalMin)}, and spent ${hrs(first.coalMid)} under ${COAL_MID} GW. In ${last.year} the floor was ${gw(last.coalMin)}, and coal was under ${COAL_MID} GW for ${hrs(last.coalMid)} and under ${COAL_LOW} GW for ${hrs(last.coalLow)}, ${Math.round(last.coalLowSunShare * 100)}% of them with at least 1 GW of solar running. Solar peaked at ${gw(last.solarMax)} in ${last.year}, against ${gw(row(2020)?.solarMax ?? first.solarMax)} in 2020. Renewables made at least half of generation for ${hrs(last.renew50)} in ${last.year} and ${hrs(latest.renew50)} in the latest 365 days, up from none before 2022.${rec ? ` The longest spell with coal under ${COAL_LOW} GW is ${n0(((rec.end - rec.start) * step) / 60)} hours, from ${fmtDate(at(rec.start))}.` : ''} The top of coal's range has barely moved, from ${gw(first.coalMax)} to ${gw(last.coalMax)}: coal has lost the middle of the day, not the cold evening.`;
  $('chart-h-1').textContent = 'Coal\'s floor is falling, its ceiling is not';
  $('chart-hint-1').textContent = 'The lowest and highest quarter hour of hard coal and lignite together each year, in GW. The last point is the latest 365 days.';
  const yearMs = (y) => (y === 'past365' ? at(end) : Date.UTC(y, 6, 1));
  const xs = rows.map((r) => yearMs(r.year));
  const floor = [
    { name: 'Highest quarter hour', color: css('--f-coal'), points: rows.map((r, k) => [xs[k], r.coalMax]), width: 2.5 },
    { name: 'Lowest quarter hour', color: css('--f-lignite'), points: rows.map((r, k) => [xs[k], r.coalMin]), width: 2.5 },
  ];
  floor.forEach((s) => { s.markers = s.points; });
  lineChart($('story-chart-1'), {
    series: floor,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    refLines: [{ value: COAL_LOW, color: css('--ink-3') }],
    tooltip: (t, vals) => {
      const r = rows[xs.indexOf(t)];
      return `<strong>${title(r?.year ?? new Date(t).getUTCFullYear())}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}${r ? `<div>Hours under ${COAL_LOW} GW: <b>${n0(r.coalLow)}</b></div>` : ''}`;
    },
  });
  $('story-legend-1').innerHTML = `${legend(floor.map((s) => [s.name, s.color]))}<span>Line: ${COAL_LOW} GW</span>`;

  // Chapter 2: the price by hour of day.
  const duckYears = [flat.year, 2022, last.year, 'past365'].filter((y, k, a) => row(y) && Number.isFinite(row(y).price) && a.indexOf(y) === k);
  const duckColors = ['--f-other', '--f-gas', '--f-coal', '--fossil'];
  $('take-2').textContent = `Midday fell to ${eur(latest.midday)} and the evening rose to ${eur(latest.evening)}, so coal's selling price went up as its hours went down.`;
  $('body-2').innerHTML = `In ${flat.year} the average price from ${MIDDAY[0]}:00 to ${MIDDAY[1] + 1}:00 was ${eur(flat.midday)} a megawatt hour and from ${EVENING[0]}:00 to ${EVENING[1] + 1}:00 it was ${eur(flat.evening)}: a flat day. In the latest 365 days midday averaged ${eur(latest.midday)} and the evening ${eur(latest.evening)}. Solar sold at an average ${eur(latest.solarCapture)} and coal at ${eur(latest.coalCapture)}, up from ${eur(row(2024)?.coalCapture ?? last.coalCapture)} in 2024. Poland's ${last.year} average of ${eur(last.price)} compares with €89 in Germany (${src(SOURCES.germany, 'Bundesnetzagentur')}). Coal is turning into a well-paid evening plant: it runs fewer hours each year, and each one sells for more.`;
  $('chart-h-2').textContent = 'The price by hour of day';
  $('chart-hint-2').textContent = 'The average day-ahead price for each hour of the day, Polish time, in euros per MWh.';
  const hourX = (hr) => hr * 3600000;
  const duck = duckYears.map((y, k) => ({ name: title(y), color: css(duckColors[k]), points: row(y).byHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-2'), {
    series: duck,
    yMin: 0,
    yFormat: (v) => eur(v),
    yTickFormat: (v) => `${v}`,
    xTicks: [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: `${String(hr).padStart(2, '0')}:00` })),
    tooltip: (t, vals) => `<strong>${String(Math.round(t / 3600000)).padStart(2, '0')}:00</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? `${eur(v.value)}/MWh` : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-2').innerHTML = legend(duck.map((s) => [s.name, s.color]));

  // Chapter 3: what runs in each price band.
  $('take-3').textContent = `When the price is below zero, Poland still runs ${gw(neg.coal)} of coal and exports ${gw(neg.exports)}.`;
  $('body-3').innerHTML = `Since ${bandStart} the price has been below zero for ${hrs(neg.hours)} and between zero and €50 for another ${hrs(cheap.hours)}. In those hours coal averaged ${gw(neg.coal)} and ${gw(cheap.coal)}, and Poland exported ${gw(neg.exports)} and ${gw(cheap.exports)} net. A hard coal plant cost about €110 a megawatt hour to run in 2025, about €70 of it for carbon (${src(SOURCES.srmc, 'Modo Energy')}), so those hours were run at a loss. At €200 and above coal averaged ${gw(dear.coal)}. The floor is lignite units that can't cycle quickly, plants that also heat cities, and units holding capacity contracts: the part of the fleet that physics and politics still protect.`;
  $('chart-h-3').textContent = 'What runs when the price says stop';
  $('chart-hint-3').textContent = `Average output by day-ahead price, in GW, since ${bandStart}. The hours in each band are in the tooltip.`;
  const bandParts = [['coal', 'Coal', '--f-coal'], ['gas', 'Gas', '--f-gas'], ['wind', 'Wind', '--f-wind'], ['solar', 'Solar', '--f-solar']];
  const bandStacks = bandParts.map(([k, name, color]) => ({ name, color: css(color), values: bands.map((b) => b[k]) }));
  barChart($('story-chart-3'), {
    cats: bands.map((b) => b.label),
    stacks: bandStacks,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => ci === 0,
    tooltip: (ci) => `<strong>${bands[ci].label} per MWh</strong><div>${hrs(bands[ci].hours)}</div>${[...bandStacks].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${gw(s.values[ci])}</b></div>`).join('')}<div>Net exports: <b>${gw(bands[ci].exports)}</b></div>`,
  });
  $('story-legend-3').innerHTML = legend([...bandStacks].reverse().map((s) => [s.name, s.color]));

  // Chapter 4: capacity.
  const e = (y) => en(y)?.twh ?? {};
  const windT = (y) => (e(y).wind_onshore ?? 0) + (e(y).wind_offshore ?? 0);
  const prev = en(last.year - 1);
  $('take-4').textContent = `Solar went from almost nothing to ${Math.round(cap(installed, 'Solar AC', capYear))} GW with no law needed; onshore wind was held back by one.`;
  $('body-4').innerHTML = `The 2016 "10H" law, which kept turbines ten times their height from homes, all but froze onshore wind at about 6 GW (${src(SOURCES.tenh, 'Defence24')}). It was eased to 700 metres in 2023, and in August 2025 the president vetoed a bill to cut that to 500 metres (${src(SOURCES.veto, 'Notes from Poland')}). Wind capacity reached ${gw(cap(installed, 'Wind onshore', capYear))} in ${capYear}, and wind made ${twh(windT(last.year))} in ${last.year}${prev ? ` against ${twh(windT(prev.year))} in ${prev.year}` : ''}. Solar had no such law and grew from ${gw(cap(installed, 'Solar AC', 2019))} in 2019 to ${gw(cap(installed, 'Solar AC', capYear))} in ${capYear}. Gas grew too, from ${gw(cap(installed, 'Fossil gas', installed?.years[0]))} to ${gw(cap(installed, 'Fossil gas', capYear))}, and from ${twh(e(first.year).gas ?? 0)} to ${twh(e(last.year).gas ?? 0)} a year. Coal capacity hardly moved: ${gw(coalCap)} of hard coal and lignite at the end of ${capYear}. Poland's first offshore wind farm, Baltic Power, began feeding the grid in July 2026 (${src(SOURCES.baltic, 'Notes from Poland')}).`;
  $('chart-h-4').textContent = 'Twenty gigawatts nobody legislated for';
  $('chart-hint-4').textContent = 'Installed capacity at the end of each year, in GW, from Energy-Charts.';
  if (installed) {
    const capParts = [['Fossil hard coal', 'Hard coal', '--f-coal'], ['Fossil brown coal / lignite', 'Lignite', '--f-lignite'], ['Fossil gas', 'Gas', '--f-gas'], ['Wind onshore', 'Onshore wind', '--f-wind'], ['Solar AC', 'Solar', '--f-solar']];
    const ys = installed.years;
    const capStacks = capParts.map(([type, name, color]) => ({ name, color: css(color), values: ys.map((y) => cap(installed, type, y) || 0) }));
    barChart($('story-chart-4'), {
      cats: ys.map(String),
      stacks: capStacks,
      yFormat: gw,
      yTickFormat: (v) => `${v}`,
      tooltip: (ci) => `<strong>End of ${ys[ci]}</strong>${[...capStacks].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${gw(s.values[ci])}</b></div>`).join('')}`,
    });
    $('story-legend-4').innerHTML = legend([...capStacks].reverse().map((s) => [s.name, s.color]));
  }

  // Chapter 5: monthly share and the dates ahead.
  const lowMonth = monthly.reduce((a, m) => (m.coalPct < a.coalPct ? m : a), monthly[0]);
  const thisYear = monthly.filter((m) => m.month > `${last.year}-12`);
  const thisLow = thisYear.length && lowMonth.month <= `${last.year}-12` ? thisYear.reduce((a, m) => (m.coalPct < a.coalPct ? m : a)) : null;
  const under50 = (y) => monthly.filter((m) => m.month.startsWith(String(y)) && m.coalPct < 50).length;
  const monthName = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  $('take-5').textContent = 'Coal\'s capacity payments end on 31 December 2028 and 5.1 GW of batteries are due from 2027: that is when the evening is up for grabs.';
  $('body-5').innerHTML = `The EU let Poland pay coal plants to stay available only until the end of 2028 (${src(SOURCES.derogation, 'Energies Media')}); the September 2026 auction for 2027 still cleared about 7.5 GW, mostly coal and gas (${src(SOURCES.auction2027, 'Modo Energy')}). Four capacity auctions have contracted 5.1 GW of batteries for 2027 to 2030 (${src(SOURCES.batteries, 'Modo Energy')}), against a peak of ${gw(Math.max(0, ...data.columns.battery.subarray(Math.max(0, end - 35040), end)) / 1000)} in the data so far. The national plan adopted in June 2026 has coal at 23% of generation by 2030 (${src(SOURCES.necp, 'ING')}), and Poland is now the EU's last hard coal miner (${src(SOURCES.mining, 'Notes from Poland')}). Coal's lowest month was ${monthName(lowMonth.month)}, at ${pct(lowMonth.coalPct)}; coal was under half of generation in ${under50(last.year)} months of ${last.year}.${thisLow ? ` This year has not beaten it: the lowest month so far was ${monthName(thisLow.month)}, at ${pct(thisLow.coalPct)}.` : ''} Poland went from importing a net ${twh(row(2020)?.netImportsTwh ?? first.netImportsTwh)} in 2020 to ${latest.netImportsTwh < 0 ? `exporting a net ${twh(-latest.netImportsTwh)}` : `importing ${twh(latest.netImportsTwh)}`} in the latest 365 days. The evening and the winter are the last two things coal has to lose.`;
  $('chart-h-5').textContent = 'Coal\'s share, month by month';
  $('chart-hint-5').textContent = 'Coal (hard coal and lignite) and renewables as a share of generation each month, Polish time. The line marks half.';
  const mx = monthly.map((m) => Date.parse(`${m.month}-15T00:00:00Z`));
  const share = [
    { name: 'Coal', color: css('--f-coal'), points: monthly.map((m, k) => [mx[k], m.coalPct]), width: 2.5 },
    { name: 'Renewables', color: css('--lowcarbon'), points: monthly.map((m, k) => [mx[k], m.renewPct]), width: 2.5 },
  ];
  lineChart($('story-chart-5'), {
    series: share,
    yMin: 0,
    yMax: 100,
    yFormat: (v) => `${Math.round(v)}%`,
    refLines: [{ value: 50, color: css('--ink-3') }],
    tooltip: (t, vals) => `<strong>${monthName(monthly[mx.indexOf(t)]?.month ?? new Date(t).toISOString().slice(0, 7))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? pct(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-5').innerHTML = `${legend(share.map((s) => [s.name, s.color]))}<span>Line: 50%</span>`;
}
