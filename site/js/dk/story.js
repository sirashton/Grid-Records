// The Denmark story: what fossil power is left on a grid famous for wind,
// and why it still runs. The figures are worked out from the data by
// storyFigures(), which the tests also run; renderStory() draws the page.
// The text here states the figures; the narrative draft is commissioned
// separately (see the project notes, five-countries/dk-story-brief.md).
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import dk from '../countries/dk.js';
import { FOSSIL, WIND, BORDERS, GENERATION, metricSeries, byYear } from './data.js';

// Wind bands (GW, lower edges) and price bands (EUR/MWh, lower edges) the story groups hours by.
export const WIND_BANDS = [0, 1, 2, 3, 4, 5];
export const PRICE_BANDS = [-Infinity, 0, 25, 50, 100, 200];
// Fossil under this (GW) is the low level the spells and hour counts follow.
export const FOSSIL_LOW = 0.2;
// Coal under this (GW) counts as coal off.
export const COAL_OFF = 0.01;
// Fossil below this floor is left to run; batteries are sized against the rest.
export const FOSSIL_FLOOR = 0.1;
// Battery fleets (GW, GWh) tested against each day's fossil above the floor.
export const BATTERIES = [[0.5, 2], [1, 4], [2, 10], [3, 20]];
// The heating season, November to March.
const WINTER = new Set([11, 12, 1, 2, 3]);
const SUMMER = new Set([6, 7, 8]);

const bandOf = (bands, v) => {
  let k = -1;
  for (let j = 0; j < bands.length; j++) if (v >= bands[j]) k = j;
  return k;
};

/** Local hour, month and day number for every slot (offset looked up once per UTC day). */
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
      offset = tzOffsetMs(d * 864e5 + 432e5, dk.timeZone);
    }
    const l = new Date(t + offset);
    hour[i] = l.getUTCHours();
    month[i] = l.getUTCMonth() + 1;
    day[i] = Math.floor((t + offset) / 864e5);
  }
  return { hour, month, day };
}

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);

/**
 * Every number the story uses. Rows run by Danish calendar year, complete
 * years only, then 'past365' for the latest 365 days. Energy in TWh, power
 * in GW, time in hours.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const c = data.columns;
  const fossil = metricSeries(d, FOSSIL);
  const wind = metricSeries(d, WIND);
  const coal = metricSeries(d, ['coal']);
  const price = c.price ?? new Float64Array(end).fill(NaN);
  const genCols = GENERATION.map((k) => c[k]).filter(Boolean);
  const { hour, month, day } = localClock(d);
  const nb = WIND_BANDS.length;
  const np = PRICE_BANDS.length;

  const rows = byYear(d, () => ({
    twh: { coal: 0, gas: 0, oil: 0, waste: 0, biomass: 0, wind: 0, solar: 0, gen: 0, demand: 0, fossil: 0 },
    fosMonth: new Float64Array(12), fosHour: new Float64Array(24), fosHourN: new Float64Array(24),
    fosHourSummer: new Float64Array(24), fosHourSummerN: new Float64Array(24),
    fosMin: Infinity, fosMinSummer: Infinity, fosMinWinter: Infinity, fosMax: 0,
    fosLow: 0, fosU100: 0, coalOn: 0, hours: 0,
    windFos: new Float64Array(nb), windN: new Float64Array(nb),
    priceFos: new Float64Array(np), priceN: new Float64Array(np),
    fosExporting: 0, fosWindy: 0, windyHours: 0,
    impTwh: 0, expTwh: 0, impHours: 0,
    impBy: Object.fromEntries(BORDERS.map(([k]) => [k, 0])), expBy: Object.fromEntries(BORDERS.map(([k]) => [k, 0])),
    calm: { n: 0, imports: 0, fossil: 0, biomass: 0, waste: 0, demand: 0 },
    priceSum: 0, priceN2: 0,
    dayN: -1, dayAbove: 0, dayPeak: 0, days: [],
  }), (r, i) => {
    const f = fossil[i];
    if (Number.isNaN(f)) return;
    const m = month[i];
    const h = hour[i];
    if (day[i] !== r.dayN) {
      if (r.dayN >= 0) r.days.push({ gwh: r.dayAbove, peak: r.dayPeak, month: r.dayMonth });
      r.dayN = day[i];
      r.dayMonth = m;
      r.dayAbove = 0;
      r.dayPeak = 0;
    }
    r.dayAbove += Math.max(0, f - FOSSIL_FLOOR) * slotH;
    r.dayPeak = Math.max(r.dayPeak, f - FOSSIL_FLOOR);
    r.hours += slotH;
    const add = (k, mw) => { r.twh[k] += ((mw || 0) * slotH) / 1e6; };
    add('coal', c.coal[i]);
    add('gas', c.gas[i]);
    add('oil', c.oil[i]);
    add('waste', c.waste[i]);
    add('biomass', c.biomass[i]);
    add('wind', (c.wind_onshore[i] || 0) + (c.wind_offshore[i] || 0));
    add('solar', c.solar[i]);
    add('demand', c.demand[i]);
    let gen = 0;
    for (const col of genCols) gen += col[i] > 0 ? col[i] : 0;
    add('gen', gen);
    r.twh.fossil += (f * slotH) / 1000;
    r.fosMonth[m - 1] += (f * slotH) / 1000;
    r.fosHour[h] += f;
    r.fosHourN[h]++;
    if (SUMMER.has(m)) { r.fosHourSummer[h] += f; r.fosHourSummerN[h]++; r.fosMinSummer = Math.min(r.fosMinSummer, f); }
    if (WINTER.has(m)) r.fosMinWinter = Math.min(r.fosMinWinter, f);
    r.fosMin = Math.min(r.fosMin, f);
    r.fosMax = Math.max(r.fosMax, f);
    if (f < FOSSIL_LOW) r.fosLow += slotH;
    if (f < 0.1) r.fosU100 += slotH;
    if (coal[i] >= COAL_OFF) r.coalOn += slotH;
    const w = wind[i];
    const wb = bandOf(WIND_BANDS, w);
    if (wb >= 0) { r.windFos[wb] += f; r.windN[wb]++; }
    const p = price[i];
    if (!Number.isNaN(p)) {
      const pb = bandOf(PRICE_BANDS, p);
      r.priceFos[pb] += f;
      r.priceN[pb]++;
      r.priceSum += p;
      r.priceN2++;
    }
    const net = (c.imports[i] || 0) + (c.exports[i] || 0);
    if (net < 0) r.fosExporting += (f * slotH) / 1000;
    const dem = c.demand[i];
    if (w * 1000 >= dem) { r.fosWindy += (f * slotH) / 1000; r.windyHours += slotH; }
    if (net > 0) { r.impTwh += (net * slotH) / 1e6; r.impHours += slotH; } else r.expTwh += (-net * slotH) / 1e6;
    for (const [k] of BORDERS) {
      const v = c[k]?.[i] || 0;
      if (v > 0) r.impBy[k] += (v * slotH) / 1e6;
      else r.expBy[k] += (-v * slotH) / 1e6;
    }
    if (w < 1) {
      r.calm.n++;
      r.calm.imports += net / 1000;
      r.calm.fossil += f;
      r.calm.biomass += (c.biomass[i] || 0) / 1000;
      r.calm.waste += (c.waste[i] || 0) / 1000;
      r.calm.demand += (dem || 0) / 1000;
    }
  }).map((r) => {
    const days = r.dayN >= 0 ? [...r.days, { gwh: r.dayAbove, peak: r.dayPeak, month: r.dayMonth }] : r.days;
    const winterTwh = r.fosMonth.reduce((a, v, k) => a + (WINTER.has(k + 1) ? v : 0), 0);
    return {
      year: r.year,
      twh: r.twh,
      hours: r.hours,
      fossilPct: (r.twh.fossil / r.twh.gen) * 100,
      windPct: (r.twh.wind / r.twh.gen) * 100,
      windOfDemandPct: (r.twh.wind / r.twh.demand) * 100,
      fosMonth: [...r.fosMonth],
      winterShare: winterTwh / r.twh.fossil,
      fosHour: [...r.fosHour].map((v, k) => mean(v, r.fosHourN[k])),
      fosHourSummer: [...r.fosHourSummer].map((v, k) => mean(v, r.fosHourSummerN[k])),
      fosMin: r.fosMin,
      fosMinSummer: r.fosMinSummer,
      fosMinWinter: r.fosMinWinter,
      fosMax: r.fosMax,
      fosLow: r.fosLow,
      fosU100: r.fosU100,
      coalOn: r.coalOn,
      windFos: [...r.windFos].map((v, k) => mean(v, r.windN[k])),
      windHours: [...r.windN].map((n) => n * slotH),
      priceFos: [...r.priceFos].map((v, k) => mean(v, r.priceN[k])),
      priceHours: [...r.priceN].map((n) => n * slotH),
      price: mean(r.priceSum, r.priceN2),
      fosExportingShare: r.fosExporting / r.twh.fossil,
      fosWindy: r.fosWindy,
      windyHours: r.windyHours,
      impTwh: r.impTwh,
      expTwh: r.expTwh,
      impHours: r.impHours,
      impBy: r.impBy,
      expBy: r.expBy,
      calm: { hours: r.calm.n * slotH, imports: mean(r.calm.imports, r.calm.n), fossil: mean(r.calm.fossil, r.calm.n), biomass: mean(r.calm.biomass, r.calm.n), waste: mean(r.calm.waste, r.calm.n), demand: mean(r.calm.demand, r.calm.n) },
      // Each day's fossil above the floor (GWh), smallest first.
      fosDays: days.map((x) => ({ gwh: x.gwh, peak: x.peak, month: x.month })).sort((a, b) => a.gwh - b.gwh),
      batteries: BATTERIES.map(([gw, gwh]) => ({ gw, gwh, days: days.filter((x) => x.gwh <= gwh && x.peak <= gw).length })),
      days: days.length,
    };
  });

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: dk.timeZone };
  return {
    rows,
    fossilLowSpell: spellOf(summarise(fossil, FOSSIL_LOW, 'below', opts)),
    fossil100Spell: spellOf(summarise(fossil, 0.1, 'below', opts)),
    coalOffSpell: spellOf(summarise(coal, COAL_OFF, 'below', opts)),
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(2)} GW`;
const mw = (v) => `${n0(v * 1000)} MW`;
const hrs = (v) => `${n0(v)} hours`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const bandName = (bands, k, unit) => (k === bands.length - 1 ? `${bands[k]}+ ${unit}` : `${Number.isFinite(bands[k]) ? bands[k] : 'below'}${Number.isFinite(bands[k]) ? '–' : ' '}${bands[k + 1]} ${unit}`);

export const SOURCES = {
  ens: 'https://ens.dk/en/our-services/statistics-data-key-figures-and-energy-maps/annual-and-monthly-statistics',
  orstedCoal: 'https://orsted.com/en/media/news/2023/05/oersted-ends-coal-based-energy-production',
  nordjylland: 'https://www.aalborgforsyning.dk/privat/vores-forsyning/varme/fremtidens-fjernvarme/',
  thor: 'https://www.rwe.com/en/research-and-development/project-plans/thor-offshore-wind-farm/',
  bornholm: 'https://en.energinet.dk/infrastructure-projects/projektliste/energy-island-bornholm/',
  dataset: 'https://www.energidataservice.dk/tso-electricity/GenerationProdTypeExchange',
};

// What is coming, dated and sourced, with the record each should move.
// [when, what, source key, the record to watch]
export const COMING = [];

export function renderStory(data, end, figs) {
  const { rows, fossilLowSpell, coalOffSpell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const fosT = (r) => r.twh.fossil;
  const bat = (k) => last.batteries[k];
  const mainImport = BORDERS.reduce((a, b) => (last.impBy[b[0]] > last.impBy[a[0]] ? b : a));

  $('lede').textContent = `Wind made ${Math.round(last.windPct)}% of Denmark's electricity in ${last.year}. Fossil fuels made ${last.fossilPct.toFixed(1)}%, ${twh(fosT(last))}, against ${twh(fosT(first))} in ${first.year}.`;
  $('answer-lead').textContent = `In ${last.year} Denmark burnt ${twh(last.twh.coal)} of coal, ${twh(last.twh.gas)} of gas and ${twh(last.twh.oil)} of oil for power, ${pc(last.winterShare)} of it from November to March, and fossil output never fell below ${mw(last.fosMin)}.`;
  $('answer-points').innerHTML = [
    `<b>What is left.</b> Coal fell from ${twh(first.twh.coal)} in ${first.year} to ${twh(last.twh.coal)} in ${last.year}; waste made ${twh(last.twh.waste)} and biomass ${twh(last.twh.biomass)}. ${link(1, 'Chapter 1')}`,
    `<b>When it runs.</b> ${pc(last.winterShare)} of ${last.year}'s fossil power came from November to March. In the windiest hours (over ${WIND_BANDS.at(-1)} GW) fossil still averaged ${mw(last.windFos.at(-1))}. ${link(2, 'Chapters 2')} and ${link(3, '3')}`,
    `<b>The neighbours.</b> Denmark was a net importer in ${hrs(last.impHours)} of ${last.year}; most came from ${mainImport[1]} (${twh(last.impBy[mainImport[0]])} gross). ${link(4, 'Chapter 4')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  const facts = [
    ['--f-coal', `Coal in ${last.year}`, twh(last.twh.coal), `against ${twh(first.twh.coal)} in ${first.year}; coal ran in ${hrs(last.coalOn)} of ${last.year}`],
    ['--fossil', `Lowest fossil output in ${last.year}`, mw(last.fosMin), `${mw(latest.fosMin)} in the latest 365 days`],
    ['--f-wind', `Fossil power burnt while wind exceeded demand, ${last.year}`, `${n0(last.fosWindy * 1000)} GWh`, `in ${hrs(last.windyHours)}`],
    ['--fossil', `Longest spell with fossil under ${mw(FOSSIL_LOW)}`, fossilLowSpell ? hrs(spellH(fossilLowSpell)) : 'None yet', fossilLowSpell ? `from ${fmtDate(at(fossilLowSpell.start))}` : ''],
    ['--f-coal', 'Longest spell with no coal', coalOffSpell ? hrs(spellH(coalOffSpell)) : 'None yet', coalOffSpell ? `from ${fmtDate(at(coalOffSpell.start))}` : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${twh(fosT(last))}</div><div class="sub">Fossil power made in Denmark in ${last.year}, ${last.fossilPct.toFixed(1)}% of its generation. In ${first.year} it was ${twh(fosT(first))}, ${first.fossilPct.toFixed(1)}%.</div></div>
    <ul class="fact-list">${facts.map(([col, l, v, w]) => `<li><span class="swatch" style="background:var(${col})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: the fossil power that is left, when in the year it runs, how it moves with the wind, the neighbours, and the hours with almost none.';

  const chapters = [
    'The fossil power that is left',
    'It runs in the heating season',
    'It runs whatever the wind',
    'The neighbours fill the calm hours',
    'Hours with almost no fossil power',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const cats = rows.map((r) => label(r.year));
  const yearColors = ['--f-other', '--f-gas', '--f-wind-off', '--f-coal'];
  const pick = [first.year, full[Math.floor(full.length / 2)]?.year, last.year, 'past365'].filter((y, k, a) => y != null && a.indexOf(y) === k && rows.some((r) => r.year === y));
  const row = (y) => rows.find((r) => r.year === y);

  // Chapter 1: fossil by fuel each year, with waste.
  $('take-1').textContent = `Coal ${twh(last.twh.coal)}, gas ${twh(last.twh.gas)} and oil ${twh(last.twh.oil)} in ${last.year}; waste ${twh(last.twh.waste)}.`;
  $('body-1').innerHTML = `Production by each plant's main fuel, from Energinet (${src(SOURCES.dataset, 'Energi Data Service')}). A biomass plant that also burns some coal counts as biomass, and waste plants burn plastics as well as biogenic waste, so waste is shown on its own.`;
  $('chart-h-1').textContent = 'Fossil and waste generation each year';
  $('chart-hint-1').textContent = 'TWh a year by main fuel. The last bar is the latest 365 days.';
  const ch1 = [
    { name: 'Coal', color: css('--f-coal'), values: rows.map((r) => r.twh.coal) },
    { name: 'Gas', color: css('--f-gas'), values: rows.map((r) => r.twh.gas) },
    { name: 'Oil', color: css('--f-diesel'), values: rows.map((r) => r.twh.oil) },
    { name: 'Waste', color: css('--f-other'), values: rows.map((r) => r.twh.waste) },
  ];
  barChart($('story-chart-1'), {
    cats,
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}<div>Biomass: <b>${twh(rows[ci].twh.biomass)}</b></div><div>Fossil share: <b>${rows[ci].fossilPct.toFixed(1)}%</b></div>`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: by month.
  $('take-2').textContent = `${pc(last.winterShare)} of ${last.year}'s fossil power came from November to March.`;
  $('body-2').innerHTML = `Fossil generation by month. The lowest hour in June to August ${last.year} was ${mw(last.fosMinSummer)}; from November to March, ${mw(last.fosMinWinter)}.`;
  $('chart-h-2').textContent = 'Fossil generation by month';
  $('chart-hint-2').textContent = 'TWh in each calendar month, coal, gas and oil together.';
  const monthX = (m) => Date.UTC(2001, m, 15);
  const monthLines = pick.map((y, k) => ({ name: title(y), color: css(yearColors[k]), points: row(y).fosMonth.map((v, m) => [monthX(m), v]), width: y === 'past365' ? 3 : 2 }));
  monthLines.forEach((sr) => { sr.markers = sr.points.filter((p) => Number.isFinite(p[1])); });
  lineChart($('story-chart-2'), {
    series: monthLines,
    yMin: 0,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    xTicks: MONTHS.map((m, k) => ({ t: monthX(k), label: m })),
    tooltip: (t, vals) => `<strong>${MONTHS[new Date(t).getUTCMonth()]}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? twh(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-2').innerHTML = legend(monthLines.map((sr) => [sr.name, sr.color]));

  // Chapter 3: fossil against wind.
  $('take-3').textContent = `Fossil averaged ${mw(last.windFos[0])} in ${last.year}'s calmest hours and ${mw(last.windFos.at(-1))} in its windiest.`;
  $('body-3').innerHTML = `Average fossil output in hours grouped by wind output. In ${last.year} wind made more than Denmark's whole demand in ${hrs(last.windyHours)}, and ${twh(last.fosWindy)} of fossil power was made in those hours. ${pc(last.fosExportingShare)} of the year's fossil power was made while Denmark was a net exporter.`;
  $('chart-h-3').textContent = 'Fossil output by wind output';
  $('chart-hint-3').textContent = 'Average fossil output (GW) in the hours of each wind band. Hours in each band are in the tooltip.';
  const bandX = (k) => k * 864e5;
  const windLines = pick.map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).windFos.map((v, b) => [bandX(b), v]), width: y === 'past365' ? 3 : 2 }));
  windLines.forEach((sr) => { sr.markers = sr.points.filter((p) => Number.isFinite(p[1])); });
  lineChart($('story-chart-3'), {
    series: windLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: WIND_BANDS.map((_, k) => ({ t: bandX(k), label: bandName(WIND_BANDS, k, 'GW') })),
    tooltip: (t, vals) => {
      const b = Math.round(t / 864e5);
      return `<strong>Wind ${bandName(WIND_BANDS, b, 'GW')}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? mw(v.value) : '—'}</b> over ${hrs(row(v.series.year).windHours[b])}</div>`).join('')}`;
    },
  });
  $('story-legend-3').innerHTML = legend(windLines.map((sr) => [sr.name, sr.color]));

  // Chapter 4: imports by border.
  $('take-4').textContent = `In hours with wind under 1 GW in ${last.year}, Denmark imported ${gw(last.calm.imports)} net on average and burnt ${gw(last.calm.fossil)} of fossil fuel.`;
  $('body-4').innerHTML = `Gross imports on each border, adding up the hours when power flowed into Denmark. In ${last.year} Denmark imported ${twh(last.impTwh)} and exported ${twh(last.expTwh)}, adding up its net position hour by hour. ${BORDERS.map(([k, name]) => `${name}: ${twh(last.impBy[k])} in, ${twh(last.expBy[k])} out`).join('; ')}.`;
  $('chart-h-4').textContent = 'Imports by border';
  $('chart-hint-4').textContent = 'TWh a year flowing into Denmark on each border, counting only the hours a border was importing.';
  const borderColors = ['--f-hydro', '--f-nuclear', '--f-lignite', '--f-imports', '--f-wind-off'];
  const ch4 = BORDERS.map(([k, name], j) => ({ name, color: css(borderColors[j]), values: rows.map((r) => r.impBy[k]) }));
  barChart($('story-chart-4'), {
    cats,
    stacks: ch4,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${[...ch4].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}<div>Net importer: <b>${hrs(rows[ci].impHours)}</b></div>`,
  });
  $('story-legend-4').innerHTML = legend([...ch4].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 5: the hours with almost no fossil power.
  $('take-5').textContent = `Fossil was under ${mw(FOSSIL_LOW)} in ${hrs(last.fosLow)} of ${last.year}, against ${hrs(first.fosLow)} in ${first.year}.`;
  $('body-5').innerHTML = `With fossil output under ${mw(FOSSIL_FLOOR)} left to run, ${bat(0).gw} GW and ${bat(0).gwh} GWh of batteries would have covered the rest on ${bat(0).days} days of ${last.year}, and ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}, if they could charge.`;
  $('chart-h-5').textContent = `Hours a year with fossil under ${mw(FOSSIL_LOW)}`;
  $('chart-hint-5').textContent = 'The last bar is the latest 365 days. The lowest hour is in the tooltip.';
  const ch5 = [{ name: `Fossil under ${mw(FOSSIL_LOW)}`, color: css('--lowcarbon'), values: rows.map((r) => r.fosLow) }];
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under ${mw(FOSSIL_LOW)}: <b>${n0(rows[ci].fosLow)}</b></div><div>Lowest fossil: <b>${mw(rows[ci].fosMin)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--fossil)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
  $('coming-h').hidden = !COMING.length;
}
