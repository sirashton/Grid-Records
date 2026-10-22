// The Ontario story: gas, Ontario's last fossil fuel, has gone from the
// grid's peaker to a round-the-clock plant while the nuclear fleet is rebuilt.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate, fmtDateTime } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import on from '../countries/on.js';
import { GENERATION, byYear } from './data.js';

// The IESO's hours are Eastern Standard Time all year, so hour-of-day figures
// use UTC-5 too.
const OFFSET_MS = -5 * 3600000;
// Gas levels the story counts hours under, in GW.
export const GAS_LOW = [0.5, 1, 2];
const KEYS = ['nuclear', 'gas', 'hydro', 'wind', 'solar', 'biomass', 'battery'];

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s?.record ? { start: s.record.start, end: s.record.end } : null);

/**
 * Every number the story uses. Rows run by calendar year (Toronto time),
 * complete years only, then 'past365' for the latest 365 days. `months` holds
 * every calendar month, the current one included. Energy in TWh, power in GW.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const stepMs = step * 60000;
  const slotH = step / 60;
  const col = (k) => data.columns[k];
  const v = (k, i) => {
    const x = col(k)?.[i];
    return x == null || Number.isNaN(x) ? 0 : x / 1000;
  };
  const gas = new Float64Array(end);
  const gen = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    const g = col('gas')[i];
    gas[i] = Number.isNaN(g) ? NaN : g / 1000;
    gen[i] = Number.isNaN(g) ? NaN : GENERATION.reduce((s, k) => s + v(k, i), 0);
  }
  const local = (i) => new Date(data.startMs + i * stepMs + OFFSET_MS);

  const init = () => ({
    twh: Object.fromEntries([...KEYS, 'gen', 'demand', 'netx', 'gasInExport'].map((k) => [k, 0])),
    hourSum: { gas: new Float64Array(24), nuclear: new Float64Array(24), battery: new Float64Array(24), demand: new Float64Array(24) },
    hourN: new Float64Array(24),
    gasMin: Infinity, gasMinAt: -1, gasMax: 0, gasMaxAt: -1, batMax: 0, batMaxAt: -1,
    under: GAS_LOW.map(() => 0),
    exportHours: 0, hours: 0,
    dayMins: [], day: null,
  });
  const add = (r, i) => {
    const g = gas[i];
    if (Number.isNaN(g)) return;
    const t = local(i);
    const h = t.getUTCHours();
    for (const k of KEYS) r.twh[k] += (v(k, i) * slotH) / 1000;
    r.twh.gen += (gen[i] * slotH) / 1000;
    const dem = col('demand')[i];
    if (!Number.isNaN(dem)) {
      // Net exports, inferred: transmission-connected generation less Ontario Demand.
      const netx = gen[i] + v('battery', i) - dem / 1000;
      r.twh.demand += (dem / 1000 * slotH) / 1000;
      r.twh.netx += (netx * slotH) / 1000;
      r.twh.gasInExport += (Math.min(g, Math.max(0, netx)) * slotH) / 1000;
      if (netx > 0) r.exportHours += slotH;
      r.hourSum.demand[h] += dem / 1000;
    }
    r.hourSum.gas[h] += g;
    r.hourSum.nuclear[h] += v('nuclear', i);
    r.hourSum.battery[h] += v('battery', i);
    r.hourN[h]++;
    r.hours += slotH;
    if (g < r.gasMin) { r.gasMin = g; r.gasMinAt = i; }
    if (g > r.gasMax) { r.gasMax = g; r.gasMaxAt = i; }
    if (v('battery', i) > r.batMax) { r.batMax = v('battery', i); r.batMaxAt = i; }
    GAS_LOW.forEach((lv, k) => { if (g < lv) r.under[k] += slotH; });
    // The lowest gas hour of each day: the floor gas no longer leaves.
    const key = Math.floor((data.startMs + i * stepMs + OFFSET_MS) / 864e5);
    if (r.day?.key !== key) {
      if (r.day) r.dayMins.push(r.day);
      r.day = { key, min: g, n: 0 };
    }
    r.day.min = Math.min(r.day.min, g);
    r.day.n++;
  };
  const finish = (r) => {
    const mins = (r.day ? [...r.dayMins, r.day] : r.dayMins).filter((x) => x.n * slotH >= 24).map((x) => x.min).sort((a, b) => a - b);
    const hourly = Object.fromEntries(Object.keys(r.hourSum).map((k) => [k, [...r.hourSum[k]].map((x, h) => mean(x, r.hourN[h]))]));
    const bat = r.hourSum.battery.reduce((a, b) => a + b, 0);
    // Share of battery discharge from 15:00 to 20:59, the evening peak.
    const batEvening = bat ? [15, 16, 17, 18, 19, 20].reduce((s, h) => s + r.hourSum.battery[h], 0) / bat : NaN;
    return {
      year: r.year,
      twh: r.twh,
      gasShare: r.twh.gas / r.twh.gen,
      nuclearShare: r.twh.nuclear / r.twh.gen,
      lowCarbonShare: (r.twh.gen - r.twh.gas) / r.twh.gen,
      gasInExportShare: r.twh.gasInExport / r.twh.gas,
      exportHours: r.exportHours,
      hours: r.hours,
      hourly,
      floor: mins[Math.floor(mins.length / 2)] ?? NaN,
      gasMin: r.gasMin, gasMinAt: r.gasMinAt, gasMax: r.gasMax, gasMaxAt: r.gasMaxAt,
      batMax: r.batMax, batMaxAt: r.batMaxAt, batEvening,
      under: r.under,
    };
  };
  const rows = byYear(d, init, add).map(finish);

  // Every calendar month: average gas and nuclear GW and gas's share.
  const months = [];
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(gas[i])) continue;
    const t = local(i);
    const key = t.getUTCFullYear() * 12 + t.getUTCMonth();
    let mo = months.at(-1);
    if (mo?.key !== key) {
      mo = { key, year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, ms: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 15), gas: 0, nuclear: 0, gen: 0, n: 0 };
      months.push(mo);
    }
    mo.gas += gas[i];
    mo.nuclear += v('nuclear', i);
    mo.gen += gen[i];
    mo.n++;
  }
  for (const mo of months) {
    mo.share = mo.gas / mo.gen;
    mo.gas /= mo.n;
    mo.nuclear /= mo.n;
    delete mo.gen;
  }

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: on.timeZone };
  const under1 = summarise(gas, 1, 'below', opts);
  const over2 = summarise(gas, 2, 'above', opts);
  const hoursOf = (p) => ((p.end - p.start) * step) / 60;
  return {
    rows,
    months,
    under1Spell: spellOf(under1),
    under05Spell: spellOf(summarise(gas, 0.5, 'below', opts)),
    under2Spell: spellOf(summarise(gas, 2, 'below', opts)),
    over3Spell: spellOf(summarise(gas, 3, 'above', opts)),
    over5Spell: spellOf(summarise(gas, 5, 'above', opts)),
    // The longest spell under 1 GW in each calendar year, in hours.
    under1ByYear: under1.perYear.map(([y, p]) => [y, hoursOf(p)]),
    under1Past365: under1.pastYear ? hoursOf(under1.pastYear) : 0,
    // A spell over 2 GW still running at the latest data, in slots.
    over2Now: over2.current ? { start: over2.current.start, end: over2.current.end } : null,
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (x) => getComputedStyle(document.documentElement).getPropertyValue(x).trim();
const n0 = (x) => Math.round(x).toLocaleString('en-CA');
const gw = (x) => `${x.toFixed(2)} GW`;
const gw1 = (x) => `${x.toFixed(1)} GW`;
const twh = (x) => `${x.toFixed(1)} TWh`;
const pc = (x) => `${(x * 100).toFixed(1)}%`;
const pc0 = (x) => `${Math.round(x * 100)}%`;
const hrs = (x) => `${n0(x)} hours`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const SOURCES = {
  darlington: 'https://www.opg.com/story/darlington-nuclears-unit-4-returns-to-service-marking-completion-of-refurbishment-project/',
  bruce4: 'https://www.renewcanada.net/bruce-powers-unit-4-major-component-replacement-hits-key-project-milestone/',
  bruce3: 'https://world-nuclear-news.org/articles/renewed-bruce-3-back-in-service',
  apo2026: 'https://ieso.ca/-/media/Files/IESO/Document-Library/planning-forecasts/apo/2026/2026-Annual-Planning-Outlook.pdf',
  gasRise: 'https://energynow.ca/2025/05/ontario-electricity-produced-with-rising-percentage-of-greenhouse-gas-emitting-power/',
  pickering4: 'https://world-nuclear-news.org/articles/opg-says-goodbye-to-pickering-4',
  pickering: 'https://www.opg.com/?p=73042',
  pickeringRefurb: 'https://www.neimagazine.com/news/ontario-approves-pickering-refurb/',
  yearEnd: 'https://ieso.ca/Corporate-IESO/Media/Year-End-Data',
  ga: 'https://ieso.ca/Power-Data/Price-Overview/Global-Adjustment',
  bruceContract: 'https://www.brucepower.com/who-we-are/delivering-transparency-and-trust',
  market: 'https://www.ieso.ca/Power-Data/Price-Overview',
  carbon: 'https://ieso.ca/-/media/Files/IESO/Document-Library/planning-forecasts/apo/Mar2024/Carbon-Pricing-Module.pdf',
  cer: 'https://www.blakes.com/insights/canada-issues-finalized-clean-electricity-regulations/',
  lt1: 'https://ieso.ca/Sector-Participants/Resource-Acquisition-and-Contracts/Long-Term-RFP-and-Expedited-Process',
  napaneeGas: 'https://www.kingstonist.com/?p=168536',
  lt2: 'https://www.ieso.ca/-/media/Files/IESO/Document-Library/long-term-rfp/LT2-W1-results-overview.pdf',
  lt2Storage: 'https://www.energy-storage.news/?p=103140',
  oneida: 'https://www.energyglobal.com/energy-storage/08052025/oneida-energy-storage-project-commences-commercial-operations/',
  hagersville: 'https://us.boralex.com/sites/default/files/2026-02/c-blx-hagersville-cod-fr-2026.pdf',
  napaneeBess: 'https://www.energy-storage.news/?p=101760',
  smr: 'https://wnn.world-nuclear.org/articles/canadian-regulator-issues-smr-construction-licence',
  coal: 'https://www.ontario.ca/page/end-coal',
};

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['13 March 2026, done', 'Darlington Unit 4 returned at full power, completing the four-unit refurbishment and securing 3,512 MW.', 'darlington', 'The median daily gas floor should stop rising.'],
  ['3 June 2026, done', 'Bruce Unit 3 reconnected after its major component replacement, more than seven months ahead of its January 2027 schedule.', 'bruce3', 'Gas\'s share in the summer months.'],
  ['September 2026', 'Pickering Units 5 to 8, about 600 MW each, were due to go offline for a $26.8 billion refurbishment, returning in the mid-2030s. Daily nuclear output in the data fell by about 1.5 GW from 1 October (our inference that this is Pickering).', 'pickering', 'The longest spell with gas above 2 GW.'],
  ['By the end of 2026', 'The expedited E-LT1 process brings 880 MW of storage into service, alongside about 285 MW of gas expansions and 286 MW of upgrades at existing gas plants.', 'lt1', 'The highest battery hour, and the evening gas peak.'],
  ['2026 to 2028', 'LT1 contracts bring 1,784 MW of storage and 410 MW of gas and biogas into service, including new simple-cycle gas at Napanee.', 'lt1', 'The highest battery hour, and the highest gas hour.'],
  ['About 2028', 'Bruce Unit 4 returns from the major component replacement that began in February 2025.', 'bruce4', 'Hours each year with gas under 1 GW.'],
  ['End of 2029', 'OPG targets commercial operation of the first 300 MW BWRX-300 small modular reactor at Darlington; GE Hitachi says the end of 2030.', 'smr', 'The longest spell with gas under 1 GW.'],
  ['By May 2030', 'LT2 adds 915 MW of solar and 400 MW of wind, about 3.0 TWh a year at an average $87.80/MWh, and 640 MW of batteries.', 'lt2', 'The lowest gas hour of the day, which solar would move first.'],
  ['1 January 2035', 'The federal Clean Electricity Regulations start to cover most gas units, at 65 t/GWh, as most Ontario gas contracts end and the nuclear rebuild finishes.', 'cer', 'Yearly gas output, and whether it returns to the 2017 shape.'],
];

export function renderStory(data, end, figs) {
  const { rows, months, under1Spell, under05Spell, over2Now, under1ByYear, under1Past365 } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? last;
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const when = (i) => `${fmtDateTime(at(i))}`;

  const low = full.reduce((a, r) => (r.gasShare < a.gasShare ? r : a), full[0]);
  const y25 = row(2025);
  const y24 = row(2024);
  const y21 = row(2021);
  const peak = rows.reduce((a, r) => (r.gasMax > a.gasMax ? r : a), rows[0]);
  const batTop = rows.reduce((a, r) => (r.batMax > a.batMax ? r : a), rows[0]);
  // Rising every year since: the first year after which gas never fell.
  let since = last.year;
  while (full.some((r) => r.year === since - 1) && row(since - 1).twh.gas < row(since).twh.gas) since--;
  const curYear = new Date(at(end - 1) + OFFSET_MS).getUTCFullYear();
  const thisYear = under1ByYear.find(([y]) => y === curYear)?.[1] ?? under1Past365;
  const hL = latest.hourly;
  const hLow = row(low.year).hourly;
  const nightL = mean([1, 2, 3].reduce((a, h) => a + hL.gas[h], 0), 3);
  const nightLow = mean([1, 2, 3].reduce((a, h) => a + hLow.gas[h], 0), 3);
  const eveL = Math.max(...hL.gas);
  const eveH = hL.gas.indexOf(eveL);
  const yearMonths = months.filter((m) => m.year === curYear);
  const minMonth = yearMonths.reduce((a, m) => (m.gas < a.gas ? m : a), yearMonths[0]);
  const ratio = latest.twh.gas / low.twh.gas;

  // Header and in short.
  $('lede').textContent = 'Ontario\'s gas plants used to idle at night; while the nuclear fleet is rebuilt they have become a floor that never leaves.';
  $('answer-lead').textContent = `Gas still runs in Ontario because the province is rebuilding its nuclear fleet while demand and exports rise, and the data shows it as a floor that no longer leaves rather than a taller peak. In ${low.year} gas made ${pc(low.gasShare)} of transmission-connected generation and the median day's lowest gas hour was ${gw(low.floor)}; in the latest 365 days it made ${pc(latest.gasShare)} and that floor was ${gw(latest.floor)}. Ontario kept exporting throughout: ${twh(latest.twh.netx)} net in the latest 365 days (inferred). Batteries now take part of the evening peak, but they are far too small to touch the floor.`;
  $('answer-points').innerHTML = [
    `<b>Gas has gone from a peaker to a round-the-clock fuel.</b> In ${low.year} gas spent ${hrs(low.under[1])} under 1 GW${under1Spell ? `, once ${hrs(spellH(under1Spell))} in a row` : ''}; in the latest 365 days it spent ${hrs(latest.under[1])} under 1 GW, and the longest spell in ${curYear} is ${hrs(thisYear)}. ${link(1, 'Chapter 1')}`,
    `<b>The cause is the nuclear rebuild, with demand rising at the same time.</b> Nuclear fell from ${twh(low.twh.nuclear)} in ${low.year} to ${twh(latest.twh.nuclear)} in the latest 365 days, while Ontario Demand rose from ${twh(low.twh.demand)} to ${twh(latest.twh.demand)}. The IESO expects refurbishment outages to take 500 to 3,700 MW offline every summer until 2034 (${src(SOURCES.apo2026, 'IESO')}). ${link(2, 'Chapter 2')}`,
    `<b>Customers pay for the gas fleet through contracts, its carbon is mostly unpriced, and it often runs while Ontario exports.</b> Gas plants pay carbon only on emissions above a 310 t/GWh benchmark, about a fifth of what they emit (${src(SOURCES.carbon, 'IESO')}). In the latest 365 days ${twh(latest.twh.gasInExport)} of gas, ${pc0(latest.gasInExportShare)} of it, ran in hours when Ontario's net exports were at least that large (inferred). ${link(3, 'Chapter 3')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--fossil', 'Gas share, latest 365 days', pc(latest.gasShare), `${twh(latest.twh.gas)} of ${twh(latest.twh.gen)}`],
    ['--fossil', 'Highest gas hour', gw(peak.gasMax), when(peak.gasMaxAt)],
    ['--lowcarbon', 'Longest spell with gas under 1 GW', under1Spell ? hrs(spellH(under1Spell)) : 'None', under1Spell ? `${fmtDate(at(under1Spell.start))} to ${fmtDate(at(under1Spell.end - 1))}` : ''],
    ['--f-battery', 'Highest battery hour', gw(batTop.batMax), batTop.batMax ? when(batTop.batMaxAt) : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${gw1(latest.floor)}</div><div class="sub">The median day's lowest gas hour over the latest 365 days, up from ${gw(low.floor)} in ${low.year}: the gas that no longer leaves.</div></div>
    <ul class="fact-list">${facts.map(([c, l, x, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${x}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: the gas comeback, why it runs, who pays, the night floor and the batteries, and what is coming.';

  const chapters = [
    'The gas comeback',
    'Why: the nuclear rebuild, demand and exports',
    'Who pays, and what carbon costs',
    'The night floor, and what batteries cover',
    'What is coming, and the records to watch',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });

  // Chapter 1: gas by year.
  $('take-1').textContent = `Gas output has risen every year since ${since}, and the latest 365 days burned ${ratio.toFixed(1)} times as much as ${low.year}.`;
  $('body-1').innerHTML = `Ontario's grid has one fossil fuel left. The last coal was burned at Thunder Bay in April 2014, ending a fleet that made about a quarter of the province's power in 2003 (${src(SOURCES.coal, 'Ontario')}). In ${low.year} gas supplied ${twh(low.twh.gas)}, ${pc(low.gasShare)} of transmission-connected generation, and low-carbon sources the other ${pc(low.lowCarbonShare)}. That was the low point. Gas rose to ${twh(y21.twh.gas)} in 2021, ${twh(y24.twh.gas)} in 2024, ${twh(y25.twh.gas)} in 2025 and ${twh(latest.twh.gas)} in the latest 365 days, ${pc(latest.gasShare)} of generation. Emitting sources last supplied 16% or more of Ontario's power in 2012 (${src(SOURCES.gasRise, 'Canadian Press')}). The highest gas hour has grown, to ${gw(peak.gasMax)} at ${when(peak.gasMaxAt)}, but the bigger change is in the hours that used to be empty. Gas spent ${hrs(low.under[1])} under 1 GW in ${low.year} and ${hrs(latest.under[1])} in the latest 365 days.${under1Spell ? ` The longest spell under 1 GW ran ${hrs(spellH(under1Spell))}, from ${fmtDate(at(under1Spell.start))} to ${fmtDate(at(under1Spell.end - 1))}; the longest in ${curYear} is ${hrs(thisYear)}.` : ''}${over2Now ? ` Gas has not dropped below 2 GW since ${fmtDateTime(at(over2Now.start))}, ${hrs(spellH(over2Now))} and counting.` : ''}`;
  $('chart-h-1').textContent = 'Yearly generation by fuel';
  $('chart-hint-1').textContent = 'TWh generated each calendar year by transmission-connected plants; the last bar is the latest 365 days. Gas sits at the bottom.';
  const ch1 = [
    { name: 'Gas', color: css('--f-gas'), key: 'gas' },
    { name: 'Nuclear', color: css('--f-nuclear'), key: 'nuclear' },
    { name: 'Hydro', color: css('--f-hydro'), key: 'hydro' },
    { name: 'Wind', color: css('--f-wind'), key: 'wind' },
    { name: 'Solar and biofuel', color: css('--f-solar'), key: 'rest' },
  ].map((sr) => ({ ...sr, values: rows.map((r) => (sr.key === 'rest' ? r.twh.solar + r.twh.biomass : r.twh[sr.key])) }));
  barChart($('story-chart-1'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (x) => `${x}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Gas: <b>${twh(rows[ci].twh.gas)}</b>, ${pc(rows[ci].gasShare)} of ${twh(rows[ci].twh.gen)}</div>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: nuclear against gas, month by month.
  $('take-2').textContent = 'The data shows gas filling a gap made by reactors out for refurbishment, demand that is rising again, and exports that never stopped.';
  $('body-2').innerHTML = `Nuclear supplied ${twh(low.twh.nuclear)} in ${low.year} and ${twh(latest.twh.nuclear)} in the latest 365 days. Darlington's four reactors were refurbished one at a time from October 2016 until Unit 4 returned on 13 March 2026 (${src(SOURCES.darlington, 'OPG')}). Bruce Unit 3 was out from March 2023 to 3 June 2026 (${src(SOURCES.bruce3, 'World Nuclear News')}) and Unit 4 has been out since February 2025 (${src(SOURCES.bruce4, 'ReNew Canada')}). Pickering Unit 1 closed in late 2024 and Unit 4 at the end of December 2024 (${src(SOURCES.pickering4, 'World Nuclear News')}), and Units 5 to 8 were due to go offline in September 2026 for refurbishment (${src(SOURCES.pickering, 'OPG')}). In the data, daily nuclear output stepped down from about 8.9 GW in late September 2026 to about 7.5 GW from 1 October, which fits that (our inference). Demand moved the other way: Ontario Demand was ${twh(low.twh.demand)} in ${low.year}, ${twh(y25.twh.demand)} in 2025 and ${twh(latest.twh.demand)} in the latest 365 days, with a 24,862 MW peak on 24 June 2025, the highest in 12 years (${src(SOURCES.yearEnd, 'IESO')}). Net exports did not shrink to make room: ${twh(low.twh.netx)} in ${low.year} and ${twh(latest.twh.netx)} in the latest 365 days (inferred; the IESO's own 2025 figures give about 18 TWh). The IESO and the energy minister put the rise in gas down to refurbishment outages and lower imports (${src(SOURCES.gasRise, 'Canadian Press')}). In ${curYear} gas has averaged at least ${gw1(minMonth.gas)} in every month.`;
  $('chart-h-2').textContent = 'Nuclear and gas, month by month';
  $('chart-hint-2').textContent = 'Average output in each calendar month, in GW. When nuclear dips for refurbishment and summer outages, gas fills in.';
  const ch2 = [
    { name: 'Nuclear', color: css('--f-nuclear'), points: months.map((m) => [m.ms, m.nuclear]), width: 2 },
    { name: 'Gas', color: css('--f-gas'), points: months.map((m) => [m.ms, m.gas]), width: 2 },
  ];
  lineChart($('story-chart-2'), {
    series: ch2,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (x) => `${x}`,
    tooltip: (t) => {
      const dt = new Date(t);
      const m = months.find((x) => x.year === dt.getUTCFullYear() && x.month === dt.getUTCMonth() + 1) ?? months.at(-1);
      return `<strong>${MONTHS[m.month - 1]} ${m.year}</strong><div>Nuclear: <b>${gw(m.nuclear)}</b> on average</div><div>Gas: <b>${gw(m.gas)}</b>, ${pc(m.share)} of generation</div>`;
    },
  });
  $('story-legend-2').innerHTML = legend(ch2.map((sr) => [sr.name, sr.color]));

  // Chapter 3: the economics.
  $('take-3').textContent = 'Gas plants are paid to be there through contracts, pay carbon on about a fifth of their emissions, and often run while Ontario is selling power to its neighbours.';
  $('body-3').innerHTML = `Most of what Ontario's generators earn comes through the Global Adjustment, the charge on every bill that covers the gap between what contracted and regulated plants are paid and what they earn in the market. It covers OPG's regulated nuclear and hydro, the Bruce Power contract, renewables, storage and the contracted gas plants (${src(SOURCES.ga, 'IESO')}). In 2025 it added 4.56 cents/kWh for smaller customers on top of an average wholesale price of 6.41 cents (${src(SOURCES.yearEnd, 'IESO')}). Since May 2025 the wholesale price comes from a new day-ahead market, and exports are priced at the border (${src(SOURCES.market, 'IESO')}). On carbon, Ontario's Emissions Performance Standards charge gas generators only for emissions above 310 t/GWh, while the fleet averages about 390 t/GWh, so roughly 20% of their emissions are priced, at a price that rises to $170/t by 2030 (${src(SOURCES.carbon, 'IESO')}). The export side is where Ontario differs from most grids. In the latest 365 days Ontario was a net exporter in ${hrs(latest.exportHours)} of ${hrs(latest.hours)}, and ${twh(latest.twh.gasInExport)} of gas, ${pc0(latest.gasInExportShare)} of it, ran in hours when net exports were at least as large (our inference from generation less Ontario Demand; it does not say the exported power was gas). Replacing the nuclear is not cheap either: the Bruce Power contract pays an estimated $118.81/MWh from 1 April 2026 (${src(SOURCES.bruceContract, 'Bruce Power')}). Most gas contracts end in 2034 and 2035 (${src(SOURCES.apo2026, 'IESO')}).`;
  $('chart-h-3').textContent = 'Gas that ran while Ontario was exporting';
  $('chart-hint-3').textContent = 'TWh of gas each year, split into the part that ran in hours when net exports were at least as large and the rest. Net exports are inferred from generation less Ontario Demand.';
  const ch3 = [
    { name: 'Gas in hours Ontario exported as much', color: css('--f-imports'), values: rows.map((r) => r.twh.gasInExport) },
    { name: 'Other gas', color: css('--f-gas'), values: rows.map((r) => r.twh.gas - r.twh.gasInExport) },
  ];
  barChart($('story-chart-3'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch3,
    yFormat: twh,
    yTickFormat: (x) => `${x}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Gas: <b>${twh(rows[ci].twh.gas)}</b></div><div>In export hours: <b>${twh(rows[ci].twh.gasInExport)}</b>, ${pc0(rows[ci].gasInExportShare)}</div><div>Net exports: <b>${twh(rows[ci].twh.netx)}</b></div>`,
  });
  $('story-legend-3').innerHTML = legend(ch3.map((sr) => [sr.name, sr.color]));

  // Chapter 4: by hour of day, and the batteries.
  $('take-4').textContent = 'Batteries have started to take the evening peak, but the gas that matters is the floor that runs at three in the morning.';
  $('body-4').innerHTML = `The shape of a gas day has changed. In ${low.year} gas averaged ${gw(nightLow)} from 01:00 to 04:00 Eastern Standard Time and peaked at ${gw(Math.max(...hLow.gas))}. In the latest 365 days it averages ${gw(nightL)} in those hours and ${gw(eveL)} at ${hh(eveH)}. The median day's lowest gas hour went from ${gw(low.floor)} in ${low.year} to ${gw(y24.floor)} in 2024, ${gw(y25.floor)} in 2025 and ${gw(latest.floor)} in the latest 365 days. Grid batteries arrived in 2025: Oneida, 250 MW, in May 2025 (${src(SOURCES.oneida, 'Energy Global')}), then Hagersville, 300 MW, on 27 February 2026 (${src(SOURCES.hagersville, 'Boralex')}) and Napanee, 250 MW, on 19 May 2026 (${src(SOURCES.napaneeBess, 'Energy-Storage.news')}). Their discharge is in the evening: ${pc0(latest.batEvening)} of it in the latest 365 days fell between 15:00 and 21:00 Eastern Standard Time, and the highest battery hour is ${gw(batTop.batMax)}${batTop.batMax ? `, at ${when(batTop.batMaxAt)}` : ''}. That is the right shape to shave the evening peak. But batteries delivered ${twh(latest.twh.battery)} in the latest 365 days against ${twh(latest.twh.gas)} of gas, and a battery only moves energy within the day. The overnight floor is gas standing in for missing nuclear output, so it needs energy, not a shift in timing (our reading).`;
  $('chart-h-4').textContent = 'Gas and batteries by hour of day';
  $('chart-hint-4').textContent = 'Average output for each hour of the day, Eastern Standard Time, in GW. The whole curve has lifted, the night most of all.';
  const hourX = (h) => h * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ t: hourX(h), label: hh(h) }));
  const years4 = [low.year, 2025, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const colors4 = ['--f-other', '--f-gas', '--fossil'];
  const ch4 = [
    ...years4.map((y, k) => ({ name: `Gas, ${title(y).toLowerCase()}`, color: css(colors4[k]), points: row(y).hourly.gas.map((x, h) => [hourX(h), x]), width: y === 'past365' ? 3 : 2 })),
    { name: 'Batteries, latest 365 days', color: css('--f-battery'), points: hL.battery.map((x, h) => [hourX(h), x]), width: 2 },
  ];
  lineChart($('story-chart-4'), {
    series: ch4,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (x) => `${x}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((x) => `<div><i style="background:${x.series.color}"></i>${x.series.name}: <b>${Number.isFinite(x.value) ? gw(x.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-4').innerHTML = legend(ch4.map((sr) => [sr.name, sr.color]));

  // Chapter 5: what's coming.
  $('take-5').textContent = 'Reactors are coming back and storage is arriving, but the IESO expects refurbishment outages until 2034, and new gas is still being added.';
  $('body-5').innerHTML = `Two refurbished reactors are already back, Darlington 4 and Bruce 3. Pickering 5 to 8 are out until the mid-2030s (${src(SOURCES.pickeringRefurb, 'NEI')}) and Bruce 4 until about 2028. By the end of 2034, 10.6 GW of nuclear will have been refurbished (${src(SOURCES.apo2026, 'IESO')}). Storage is the fast-moving piece: 880 MW from the expedited E-LT1 process by 2026, 1,784 MW from LT1 between 2026 and 2028 (${src(SOURCES.lt1, 'IESO')}) and 640 MW from LT2 by May 2030 (${src(SOURCES.lt2Storage, 'Energy-Storage.news')}). Gas is still being added too: about 285 MW of expansions and 286 MW of upgrades under E-LT1, and 410 MW of gas and biogas under LT1, including Napanee (${src(SOURCES.napaneeGas, 'Kingstonist')}). LT2 adds 915 MW of solar and 400 MW of wind by about May 2030 (${src(SOURCES.lt2, 'IESO')}), and the first small modular reactor at Darlington is due by the end of 2029 (${src(SOURCES.smr, 'World Nuclear News')}). The IESO forecasts demand rising from 152 TWh in 2026 to 250 TWh in 2050 (${src(SOURCES.apo2026, 'IESO')}). The federal Clean Electricity Regulations cover most gas units from 1 January 2035 (${src(SOURCES.cer, 'Blakes')}). Records to watch: the longest spell with gas under 1 GW, ${hrs(thisYear)} so far in ${curYear}${under1Spell ? ` against ${hrs(spellH(under1Spell))} in ${new Date(at(under1Spell.start)).getUTCFullYear()}` : ''}; ${under05Spell ? `under 0.5 GW, ${hrs(spellH(under05Spell))}; ` : ''}the median daily floor, ${gw(latest.floor)}; the highest gas hour, ${gw(peak.gasMax)}; and the highest battery hour, ${gw(batTop.batMax)}.`;
  $('chart-h-5').textContent = 'Longest spell with gas under 1 GW, each year';
  $('chart-hint-5').textContent = 'Hours in a row with gas under 1 GW, the longest in each calendar year; the last bar is the current year so far. The record to watch as reactors return.';
  const cats5 = under1ByYear.map(([y]) => (y === curYear ? `${y}*` : String(y)));
  const ch5 = [{ name: 'Longest spell under 1 GW', color: css('--lowcarbon'), values: under1ByYear.map(([, h]) => h) }];
  barChart($('story-chart-5'), {
    cats: cats5,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (x) => n0(x),
    tooltip: (ci) => `<strong>${under1ByYear[ci][0]}${under1ByYear[ci][0] === curYear ? ' so far' : ''}</strong><div>Longest spell under 1 GW: <b>${hrs(under1ByYear[ci][1])}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([w, what, source, record]) => `<li><span class="swatch" style="background:var(--f-gas)"></span><span><b>${w}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
