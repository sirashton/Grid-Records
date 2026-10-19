// The Germany story: what solar parity meant in 2012, and how long the grid
// took to change after it. The figures are worked out from the data by
// storyFigures(), which the tests also run; renderStory() draws the page.
import { summarise, formatDuration, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { FOSSIL, WIND, GENERATION, metricSeries, yearlyEnergy, byYear } from './data.js';

const SLOT_H = 0.5;
const WS = ['solar', ...WIND];
// The 2012 solar record that made the news, in GW.
export const RECORD_2012_GW = 22;
const TOP_N = 100;

/** Demand met in Germany at each slot, in GW: generation plus net imports, less pumping. */
export function demandSeries(data) {
  const { columns, length } = data;
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    let v = columns.imports[i] - columns.exports[i] - columns.pumped_chg[i];
    for (const k of GENERATION) v += columns[k][i];
    out[i] = v / 1000;
  }
  return out;
}

const spellH = (s) => (s ? ((s.end - s.start) * SLOT_H) : 0);

/** Longest spell in each calendar year, and in the latest 365 days, in hours. */
function spellsByYear(values, threshold, mode, startMs, years) {
  const s = summarise(values, threshold, mode, { startMs, maxGap: 2 });
  const per = new Map(s.perYear);
  return {
    record: s.record,
    hours: years.map((y) => (y === 'past365' ? spellH(s.pastYear) : spellH(per.get(y)))),
    spans: years.map((y) => (y === 'past365' ? s.pastYear : per.get(y)) ?? null),
  };
}

/**
 * Every number the story uses. Rows run by calendar year, complete years
 * only, then 'past365' for the latest 365 days, as yearlyEnergy does.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const energy = yearlyEnergy(d);
  const years = energy.map((r) => r.year);
  const fossil = metricSeries(d, FOSSIL);
  const solar = metricSeries(d, ['solar']);
  const ws = metricSeries(d, WS);
  const demand = demandSeries(d);
  const imports = metricSeries(d, ['imports']);
  const nuclear = metricSeries(d, ['nuclear']);

  // Floor, ceiling and hours above or below the story's thresholds.
  const yearly = byYear(d, () => ({ min: Infinity, max: -Infinity, solar22: 0, fossil10: 0, halfDays: new Set(), slots: [] }), (row, i) => {
    const f = fossil[i];
    if (Number.isNaN(f) || Number.isNaN(demand[i])) return;
    if (f < row.min) row.min = f;
    if (f > row.max) row.max = f;
    if (solar[i] >= RECORD_2012_GW) row.solar22 += SLOT_H;
    if (f < 10) row.fossil10 += SLOT_H;
    // German calendar day, near enough for counting days: UTC plus an hour.
    if (solar[i] >= demand[i] / 2) row.halfDays.add(Math.floor((data.startMs + i * 18e5 + 36e5) / 864e5));
    row.slots.push(i);
  });
  // The tightest half hours: highest demand left after wind and solar.
  const residual = (i) => demand[i] - ws[i];
  const top = yearly.map((row) => {
    const idx = row.slots.sort((a, b) => residual(b) - residual(a)).slice(0, TOP_N);
    const mean = (s) => idx.reduce((a, i) => a + s[i], 0) / idx.length;
    const parts = { ws: mean(ws), nuclear: mean(nuclear), fossil: mean(fossil), imports: mean(imports), demand: mean(demand) };
    parts.other = Math.max(0, parts.demand - parts.ws - parts.nuclear - parts.fossil - parts.imports);
    return parts;
  });
  const rows = yearly.map((row, k) => ({
    year: row.year,
    fossilMin: row.min,
    fossilMax: row.max,
    solar22: row.solar22,
    fossil10: row.fossil10,
    halfDays: row.halfDays.size,
    top: top[k],
  }));
  const startMs = data.startMs;
  return {
    energy,
    years,
    rows,
    wsLull: spellsByYear(ws, 10, 'below', startMs, years),
    fossil10: spellsByYear(fossil, 10, 'below', startMs, years),
    fossil35: spellsByYear(fossil, 35, 'above', startMs, years),
    importRun: spellsByYear(imports, 0.001, 'above', startMs, years),
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(1)} GW`;
const h = (v) => `${n0(v)} hours`;
const twh = (v) => `${v.toFixed(v < 10 ? 1 : 0)} TWh`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;

const SOURCES = {
  gtai: 'https://www.gtai.de/resource/blob/174776/9c30ee0eb9bba916cff037e4db3c52b7/industry-overview-photovoltaics-en-data.pdf',
  solarserver: 'https://www.solarserver.de/2013/01/02/photovoltaik-rekordjahr-2012-deutschland-produziert-solarstrom-fuer-8-millionen-haushalte/',
  record2012: 'https://www.modernpowersystems.com/?p=8960',
  cut2012: 'https://www.renewableenergyworld.com/?p=194263',
  wiki: 'https://en.wikipedia.org/wiki/Solar_power_in_Germany',
  smard: 'https://www.smard.de/page/en/topic-article/217400/219038',
  bnetza: 'https://www.bundesnetzagentur.de/SharedDocs/Pressemitteilungen/EN/2025/20251021_Preisspitzen.html',
  nuclear: 'https://wnn.world-nuclear.org/articles/a-guide-the-end-of-germany%E2%80%99s-nuclear-power',
};

/** Installed GW of a type at the end of a year, from Energy-Charts' yearly series. */
const cap = (installed, type, year) => installed?.types[type]?.[installed.years.indexOf(year)] ?? NaN;

export function renderStory(data, end, installed, figs) {
  const { rows, energy, wsLull, fossil10, fossil35, importRun } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  const [first, last] = [full[0], full.at(-1)];
  const at = (y) => rows.findIndex((r) => r.year === y);
  const en = (y) => energy.find((r) => r.year === y);
  const ix = { first: at(first.year), last: at(last.year) };
  const when = (span) => (span ? fmtDate(slotTime(span.start, data.startMs)) : '');
  const record = (s) => (s.record ? (s.record.end - s.record.start) * SLOT_H : 0);
  const thisYear = installed ? Math.max(...installed.years.filter((y, k) => installed.types['Solar DC'][k] != null)) : null;
  const solarNow = cap(installed, 'Solar DC', thisYear);

  // In short.
  $('answer-lead').textContent = 'Parity in 2012 meant a panel on your roof made electricity for less than you paid at the socket. It said nothing about the grid, which took another decade to notice: solar barely grew from 2013 to 2018, and the longest spells with fossil plants near idle only started to stretch after 2019.';
  const c12 = cap(installed, 'Solar DC', 2012);
  const c18 = cap(installed, 'Solar DC', 2018);
  const lastAdd = cap(installed, 'Solar DC', thisYear - 1) - cap(installed, 'Solar DC', thisYear - 2);
  const t1 = first.top;
  const t2 = last.top;
  $('answer-points').innerHTML = [
    `<b>Parity was a price, and the price got cut the same year.</b> Rooftop solar undercut the household tariff in early 2012, and that year Germany cut the feed-in tariff by up to 30%. Capacity went from ${Math.round(c12)} GW at the end of 2012 to ${Math.round(c18)} GW at the end of 2018${c18 - c12 < lastAdd ? `, less than Germany added in ${thisYear - 1} alone (${Math.round(lastAdd)} GW)` : ''}. ${link(1, 'Chapter 1')}`,
    `<b>The grid's fossil floor fell from ${Math.round(first.fossilMin)} GW to ${Math.round(last.fossilMin)} GW, but the ceiling only fell from ${Math.round(first.fossilMax)} GW to ${Math.round(last.fossilMax)} GW.</b> The longest spell with fossil plants under 10 GW ${fossil10.hours[ix.first] ? `was ${h(fossil10.hours[ix.first])} in ${first.year}` : `did not exist in ${first.year}`} and reached ${h(record(fossil10))} in ${new Date(slotTime(fossil10.record.start, data.startMs)).getUTCFullYear()}. On the coldest, calmest evenings Germany still burns nearly ${Math.round(last.fossilMax / 5) * 5} GW of fossil fuel. ${link(3, 'Chapter 3')}`,
    `<b>Winter evenings are now covered by neighbours, and the dark lulls have got shorter.</b> In the hundred tightest half hours of ${first.year}, fossil plants supplied ${gw(t1.fossil)} and imports ${gw(t1.imports)}; in ${last.year} it was ${gw(t2.fossil)} and ${gw(t2.imports)}. The longest spell with wind and solar together under 10 GW was ${h(wsLull.hours[ix.first])} in ${first.year} and ${h(wsLull.hours[ix.last])} in ${last.year}. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-solar', 'Solar capacity', `${Math.round(solarNow)} GW`, `against ${Math.round(c12)} GW at parity in 2012`],
    ['--fossil', 'Lowest fossil output', gw(Math.min(...rows.map((r) => r.fossilMin))), 'in any half hour since 2015'],
    ['--fossil', 'Highest fossil output, latest year', gw(rows.at(-1).fossilMax), 'still needed on winter evenings'],
    ['--f-imports', 'Longest run of net imports', h(record(importRun)), `from ${fmtDate(slotTime(importRun.record.start, data.startMs))}`],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${h(rows.at(-1).solar22)}</div><div class="sub">with solar above ${RECORD_2012_GW} GW in the latest 365 days. In ${first.year} it was ${h(first.solar22)}. ${RECORD_2012_GW} GW was the record that made world news in May 2012.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;

  // Chapter 1: parity and the flat years.
  $('take-1').textContent = 'Solar became cheaper than the socket, and Germany stopped building it.';
  $('body-1').innerHTML = `At the start of 2012 a new rooftop array cost less per kilowatt hour than the roughly 25 cents a household paid (${src(SOURCES.gtai, 'GTAI')}, ${src(SOURCES.solarserver, 'Solarserver')}). In May 2012 solar reached 22 GW at midday, reported around the world as half the country's demand (${src(SOURCES.record2012, 'Modern Power Systems')}), though it made only 4% of that year's electricity. The government had announced deep cuts to the feed-in tariff that February (${src(SOURCES.cut2012, 'Renewable Energy World')}), and new building fell from 8 GW in 2012 to about 2 GW a year from 2013 to 2018 (${src(SOURCES.wiki, 'Wikipedia')}). Capacity passed 100 GW in 2024 and is ${Math.round(solarNow)} GW now.`;
  if (installed) {
    const ys = installed.years.filter((y) => y <= thisYear);
    const vals = ys.map((y) => cap(installed, 'Solar DC', y));
    const added = vals.map((v, k) => (k ? v - vals[k - 1] : v));
    const badges = { 2012: 'parity', 2024: '100 GW' };
    barChart($('story-capacity'), {
      cats: ys.map(String),
      stacks: [{ name: 'Solar capacity', color: css('--f-solar'), values: vals }],
      yFormat: (v) => `${Math.round(v)} GW`,
      yTickFormat: (v) => `${v}`,
      highlight: (ci) => ys[ci] >= 2013 && ys[ci] <= 2018,
      badge: (ci) => badges[ys[ci]] ?? null,
      tooltip: (ci) => `<strong>${ys[ci]}${ys[ci] === thisYear ? ', so far' : ''}</strong><div>Installed: <b>${vals[ci].toFixed(1)} GW</b></div><div>Added that year: <b>${added[ci].toFixed(1)} GW</b></div>`,
    });
    $('story-capacity-legend').innerHTML = `${legend([['Solar capacity, end of year', css('--f-solar')]])}<span>Outlined: 2013 to 2018, when Germany added ${Math.round(c18 - c12)} GW in six years</span>`;
  }

  // Chapter 2: hours above the 2012 record.
  const p = rows.at(-1);
  $('take-2').textContent = `What made world news in 2012 now happens for more than ${n0(Math.floor(last.solar22 / 100) * 100)} hours a year.`;
  $('body-2').innerHTML = `In ${first.year} solar was at or above ${RECORD_2012_GW} GW for ${h(first.solar22)}; in ${last.year} it was ${h(last.solar22)}, and ${h(p.solar22)} in the latest 365 days. The days on which solar covered at least half of demand at some point went from ${n0(first.halfDays)} in ${first.year} to ${n0(last.halfDays)} in ${last.year}. So much arrives at once that prices went below zero for 573 hours in 2025 (${src(SOURCES.smard, 'SMARD')}).`;
  barChart($('story-solar22'), {
    cats: rows.map((r) => label(r.year)),
    stacks: [{ name: `Hours with solar at or above ${RECORD_2012_GW} GW`, color: css('--f-solar'), values: rows.map((r) => r.solar22) }],
    yFormat: (v) => `${n0(v)} h`,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => rows[ci].year === 'past365',
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Solar at or above ${RECORD_2012_GW} GW: <b>${h(rows[ci].solar22)}</b></div><div>Days solar met half of demand: <b>${n0(rows[ci].halfDays)}</b></div>`,
  });

  // Chapter 3: floor and ceiling.
  $('take-3').textContent = `Fossil plants now spend summer days almost off, but a winter evening still needs nearly ${Math.round(last.fossilMax / 5) * 5} GW of them.`;
  const lastYear35 = fossil35.hours[ix.last];
  $('body-3').innerHTML = `The lowest fossil output in a year fell from ${gw(first.fossilMin)} in ${first.year} to ${gw(last.fossilMin)} in ${last.year}, most of it after 2019 as lignite plants stopped running round the clock and the last reactors closed. Hours with fossil under 10 GW went from ${h(first.fossil10)} to ${h(last.fossil10)}, and the longest spell reached ${h(record(fossil10))} from ${fmtDate(slotTime(fossil10.record.start, data.startMs))}. The yearly peak fell only from ${gw(first.fossilMax)} to ${gw(last.fossilMax)}. The longest spell above 35 GW was ${h(record(fossil35))} from ${fmtDate(slotTime(fossil35.record.start, data.startMs))}${lastYear35 ? `, and ${h(lastYear35)} in ${last.year}` : `, and none in ${last.year}`}.`;
  const yearMs = (y) => (y === 'past365' ? slotTime(end, data.startMs) : Date.UTC(y, 6, 1));
  const xs = rows.map((r) => yearMs(r.year));
  const floorSeries = [
    { name: 'Highest half hour', color: css('--fossil-ink'), points: rows.map((r, k) => [xs[k], r.fossilMax]), width: 2.5 },
    { name: 'Lowest half hour', color: css('--fossil'), points: rows.map((r, k) => [xs[k], r.fossilMin]), width: 2.5 },
  ];
  floorSeries.forEach((s) => { s.markers = s.points; });
  lineChart($('story-floor'), {
    series: floorSeries,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    tooltip: (t, vals) => `<strong>${title(rows[xs.indexOf(t)]?.year ?? new Date(t).getUTCFullYear())}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-floor-legend').innerHTML = legend(floorSeries.map((s) => [s.name, s.color]));

  // Chapter 4: lulls.
  const rec = wsLull.record;
  const lullYear = (y) => wsLull.hours[at(y)] ?? 0;
  const ws0 = cap(installed, 'Solar DC', first.year) + cap(installed, 'Wind onshore', first.year) + cap(installed, 'Wind offshore', first.year);
  const ws1 = cap(installed, 'Solar DC', thisYear) + cap(installed, 'Wind onshore', thisYear) + cap(installed, 'Wind offshore', thisYear);
  $('take-4').textContent = `The longest lull in the data is from ${new Date(slotTime(rec.start, data.startMs)).getUTCFullYear()}, when there was well under half as much wind and solar.`;
  $('body-4').innerHTML = `The longest spell with wind and solar together under 10 GW was ${h(record(wsLull))}, from ${fmtDate(slotTime(rec.start, data.startMs))}. In 2024, the year of the November and December lulls that pushed prices above 900 euros a megawatt hour (${src(SOURCES.bnetza, 'Bundesnetzagentur')}), the longest was ${h(lullYear(2024))}${at(2025) >= 0 ? `, and in 2025 ${h(lullYear(2025))}` : ''}. Wind and solar capacity grew from ${Math.round(ws0)} GW to ${Math.round(ws1)} GW, so the same grey, still weather now makes more. The lulls still hurt because of the ceiling in chapter 3: they no longer last as long, but fossil plants still have to cover them.`;
  barChart($('story-lull'), {
    cats: rows.map((r) => label(r.year)),
    stacks: [{ name: 'Longest spell with wind and solar under 10 GW', color: css('--f-wind'), values: wsLull.hours }],
    yFormat: (v) => `${n0(v)} h`,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => rows[ci].year === 'past365',
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Longest lull: <b>${wsLull.hours[ci] ? formatDuration(wsLull.spans[ci].end - wsLull.spans[ci].start) : 'none'}</b></div>${wsLull.spans[ci] ? `<div>from ${when(wsLull.spans[ci])}</div>` : ''}`,
  });

  // Chapter 5: the tightest half hours.
  const pick = [first.year, 2019, 2022, last.year].filter((y, k, a) => at(y) >= 0 && a.indexOf(y) === k);
  const parts = [['fossil', 'Fossil', '--fossil'], ['nuclear', 'Nuclear', '--f-nuclear'], ['imports', 'Net imports', '--f-imports'], ['ws', 'Wind and solar', '--f-wind'], ['other', 'Hydro, biomass, storage and other', '--f-other']];
  const stacks = parts.map(([k, name, color]) => ({ name, color: css(color), values: pick.map((y) => rows[at(y)].top[k]) }));
  $('take-5').textContent = 'Germany replaced coal and nuclear with solar by day and with its neighbours after dark.';
  const e0 = en(first.year);
  const e1 = en(last.year);
  const imp24 = en(2024);
  $('body-5').innerHTML = `In the hundred tightest half hours of ${first.year}, demand of ${gw(t1.demand)} was met by ${gw(t1.fossil)} of fossil, ${gw(t1.nuclear)} of nuclear and ${gw(t1.imports)} of imports. In ${last.year} the same hours took ${gw(t2.fossil)} of fossil and ${gw(t2.imports)} of imports, with nuclear gone since April 2023 (${src(SOURCES.nuclear, 'World Nuclear News')}). Net imports rose from ${twh(e0.twh.imports)} in ${first.year} to ${twh((imp24 ?? e1).twh.imports)} in ${(imp24 ?? e1).year}, and the longest unbroken run of importing grew from ${h(importRun.hours[ix.first])} to ${h(record(importRun))}, from ${fmtDate(slotTime(importRun.record.start, data.startMs))}. Fossil generation still halved, from ${twh(e0.fossil)} to ${twh(e1.fossil)}.`;
  barChart($('story-tight'), {
    cats: pick.map(String),
    stacks,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${pick[ci]}, tightest ${TOP_N} half hours</strong><div>Demand: <b>${gw(rows[at(pick[ci])].top.demand)}</b></div>${[...stacks].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${gw(s.values[ci])}</b></div>`).join('')}`,
  });
  $('story-tight-legend').innerHTML = legend([...stacks].reverse().map((s) => [s.name, s.color]));
}
