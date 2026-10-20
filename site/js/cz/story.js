// The Czechia story: why lignite still runs, what pays for it, and what
// Sev.en's closures should do to the records. Lignite is no longer the base of
// the grid (nuclear is); it runs for the winter, the evenings and the
// neighbours, and turns down at noon in summer. The figures are worked out
// from the data by storyFigures() in figures.js, which the tests also run;
// renderStory() draws the page. Answer first: the answer, three supporting
// points, then five chapters.
import { slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { storyFigures, closureGap, CLOSING_MW, CHVALETICE_KEPT_MW } from './figures.js';

export { storyFigures };

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(1)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const eur = (v) => `€${Math.round(v)}`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

export const SOURCES = {
  closure: 'https://oenergetice.cz/en/coal/tykacs-seven-to-shut-down-three-czech-coal-plants-by-march-2027',
  runOn: 'https://oenergetice.cz/en/czech-power-plants/power-generation-at-czech-plants-pocerady-and-chvaletice-may-not-end-in-march-2027-as-reported',
  ceps: 'https://ct24.ceskatelevize.cz/clanek/ekonomika/dva-ze-ctyr-bloku-chvaletic-musi-pokracovat-uvedl-ceps-369692',
  cepsReport: 'https://oenergetice.cz/en/opinions/what-does-the-czech-ceps-report-really-say-about-the-need-for-tykacs-power-plants',
  chvaleticeLoss: 'https://oenergetice.cz/en/coal/czech-chvaletice-power-plant-remained-loss-making-but-significantly-reduced-its-loss',
  chvaleticeComp: 'https://oenergetice.cz/en/coal/free-allowances-will-not-save-czechias-chvaletice-plant-closure-remains-on-the-table',
  kladno: 'https://oenergetice.cz/teplarenstvi/teplarna-kladno-vyzvala-eru-aby-od-dubna-vybral-noveho-dodavatele-tepla',
  kladnoOrder: 'https://oenergetice.cz/teplarenstvi/eru-pripravuje-mozne-narizeni-provozu-teplarny-kladno-teplo-muze-zdrazit',
  kladnoCity: 'https://oenergetice.cz/en/teplarenstvi/kladno-without-coal-fired-heat-what-does-the-plant-closure-mean-for-residents',
  adequacy: 'https://oenergetice.cz/en/czech-power-plants/experts-czech-republic-will-have-enough-electricity-after-chvaletice-and-pocerady-plants-close',
  exports: 'https://oenergetice.cz/en/electricity-market/czech-electricity-exports-rose-last-year-after-years-of-decline',
  necp: 'https://oenergetice.cz/en/czech-energy-sector/czech-government-confirms-coal-phase-out-by-2033-but-underestimates-renewables-ngos-say',
  kpler: 'https://www.kpler.com/zh/blog/czechias-coal-phase-out-roadmap-and-long-term-nuclear-outlook',
  batteries: 'https://oenergetice.cz/en/energy-storage/billion-koruna-investments-overview-of-the-largest-planned-battery-storage-facilities-in-the-czech-republic',
  batteriesH1: 'https://www.ess-news.com/2026/08/11/czechia-connects-318-mwh-of-batteries-in-h1/',
  dukovany: 'https://www.enerdata.net/publications/daily-energy-news/khnp-signs-final-contract-build-two-nuclear-reactors-dukovany-czechia.html',
  aleasoft: 'https://aleasoft.com/european-market-prices-2025-second-lowest-since-2021-pv-records',
  intensity: 'https://en.wikipedia.org/wiki/List_of_least_carbon_efficient_power_stations',
};

// Rough fuel and carbon cost of a lignite unit in 2025: carbon at €76.85/t
// (AleaSoft's 2025 average) and about 1.1 t of CO2 per MWh (Prunéřov is
// listed at 1.07 t/MWh, ČEZ's subcritical coal fleet at 1.22), plus about
// €10/MWh for fuel and running costs, which is our estimate.
export const CARBON_EUR_T = 76.85;
export const LIGNITE_T_PER_MWH = 1.1;
export const LIGNITE_FUEL_EUR = 10;
export const LIGNITE_COST = CARBON_EUR_T * LIGNITE_T_PER_MWH + LIGNITE_FUEL_EUR;

const CLOSING_GW = (CLOSING_MW.pocerady + CLOSING_MW.chvaletice + CLOSING_MW.kladno) / 1000;
const CLOSING_NET_GW = CLOSING_GW - CHVALETICE_KEPT_MW / 1000;

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['2026', 'Sev.en\'s batteries at Chvaletice (115 MW, 230 MWh) and Kladno (45 MW, 90 MWh); ČEZ converts Dětmarovice to gas and biomass.', ['batteries', 'kpler'], 'Battery discharge peaks; gas above 0.5 GW and 1 GW.'],
  ['From 1 Apr 2027', 'Sev.en\'s earliest closure date for Počerady (1,050 MW) and Chvaletice (820 MW), with two Chvaletice units kept running for ČEPS. In April 2026 Sev.en said it may run on past this.', ['runOn', 'ceps'], 'Lignite under 2.5 GW, 2 GW and 1.5 GW: the summer spells should run into autumn. Hours above 3 GW should fall toward zero.'],
  ['2026 to 2027', 'Kladno: ERÚ is preparing to order the coal heating plant to keep supplying the city, which plans its own heat source in about two years.', ['kladnoOrder', 'kladnoCity'], 'The winter lignite floor: lignite under 1 GW and 0.5 GW from December to February.'],
  ['2027', 'The Ministry of Industry and Trade says Czechia could become a net importer.', ['exports'], 'Hours with net exports above 1 GW and 2 GW should fall; spells with net imports above 1 GW and 2 GW should lengthen.'],
  ['2027', 'ČEZ\'s Prunéřov and Tušimice sites switch to gas engines, biomass and gas boilers; EP\'s Opatovice combined-cycle unit is due at the end of 2027.', ['kpler', 'closure'], 'Gas above 1 GW and 1.5 GW; fossil under 3 GW, which gas can hold up as lignite falls.'],
  ['2029 to 2030', 'ČEZ converts Trmice and Mělník and plans to be out of coal by 2030; its 270 MW, 970 MWh battery near Chomutov; the national plan\'s 10 GW of solar and 1.5 GW of wind; about 6 GWh of batteries expected.', ['kpler', 'batteries', 'batteriesH1', 'necp'], 'Solar above 4 GW and 5 GW; lignite under 1 GW; low carbon above 8 GW and 9 GW.'],
  ['2033', 'The national end of coal.', ['kpler', 'necp'], 'Lignite at zero; coal (lignite and hard coal) under 0.5 GW.'],
  ['2036', 'The first of two 1,055 MW APR1000 reactors at Dukovany, built by KHNP under a contract signed in June 2025; Kpler says mid to late 2030s.', ['dukovany', 'kpler'], 'Nuclear under 3 GW should become rare; low carbon above 9 GW in winter.'],
];

export function renderStory(data, end, figs, installed = null) {
  const { rows, ligSpells, fossil3Spell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? first;
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => (sp.slots * step) / 60;
  const capYear = installed ? Math.max(...installed.years) : null;
  const capOf = (type, y) => installed?.types[type]?.[installed.years.indexOf(y)];
  const ligCap = installed ? capOf('Fossil brown coal / lignite', capYear) : NaN;
  const solar22 = installed ? capOf('Solar AC', 2022) : NaN;
  const solarNow = installed ? capOf('Solar AC', capYear) : NaN;
  // The fleet's real ceiling is its highest output in the latest 365 days,
  // well under the capacity Energy-Charts lists; the closures take the net
  // closing capacity off that ceiling (an assumption, stated on the page).
  const peakFleet = latest.ligMax;
  const remaining = peakFleet - CLOSING_NET_GW;
  const gap = closureGap(latest, remaining);
  const gapLast = closureGap(last, remaining);
  const above = (r, l) => r.levels.find((x) => x.gw === l)?.hours ?? 0;
  const under = (r, l) => r.hours - above(r, l);
  const everMax = full.reduce((a, r) => (r.ligMax > a.ligMax ? r : a), first);
  const recent = full.filter((r) => r.year >= 2023);
  const sp = Object.fromEntries(ligSpells.map((s) => [s.gw, s.spell]));
  const highest = full.reduce((a, r) => (r.ligTwh > a.ligTwh ? r : a), first);
  const lowExport = full.reduce((a, r) => (r.netExpTwh < a.netExpTwh ? r : a), first);
  const y2020 = row(2020);
  const y2022 = row(2022);
  const noon = last.summerHour[13];
  const evening = last.summerHour[21];
  const mw = (v) => `${n0(v * 1000)} MW`;
  const lowMonth = last.ligMonth.indexOf(Math.min(...last.ligMonth));
  const monthName = (m) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m];
  const spellText = (s) => (s ? `${hrs(spellH(s))} from ${fmtDate(at(s.start))}` : 'none yet');

  // Header and in short.
  $('lede').textContent = `Lignite made ${pc(last.ligShare)} of Czechia's electricity in ${last.year}, ${twh(last.ligTwh)}, and ${pc(last.ligExportingShare)} of it was burnt while the country was selling power abroad.`;
  $('answer-lead').textContent = `Czech lignite is no longer the base of the grid; nuclear is. Lignite now runs for the winter, the evenings and the neighbours, and turns down to about a gigawatt on summer afternoons when solar pushes the price below what its carbon costs. Sev.en plans to close Počerady, Chvaletice and Kladno, about ${gw(CLOSING_NET_GW)} net, from March 2027 at the earliest, and the output that would lose was almost all matched by exports, so exports should fall before anything else does. The record to watch is the longest spell with lignite under 2 GW${sp[2] ? `, now ${hrs(spellH(sp[2]))}` : ''}.`;
  $('answer-points').innerHTML = [
    `<b>It follows the price now.</b> From May to August ${last.year} lignite averaged ${gw(noon)} at ${hh(13)} and ${gw(evening)} at ${hh(21)}. In ${first.year} the same hours were ${gw(first.summerHour[13])} and ${gw(first.summerHour[21])}. ${link(1, 'Chapter 1')}`,
    `<b>Most of it is sold abroad.</b> Czechia was a net exporter for ${hrs(last.expHours)} of ${last.year} and sold ${twh(last.netExpTwh)} net. Only ${twh(last.ligImporting)} of lignite was burnt while the country was importing. The evening price, ${eur(last.priceHour[19])} at ${hh(19)}, pays for it; the noon price, ${eur(last.priceHour[13])}, does not. ${link(2, 'Chapters 2')} and ${link(3, '3')}`,
    `<b>The closures cut exports first.</b> Take about ${gw(CLOSING_NET_GW)} off a fleet that peaked at ${gw(peakFleet)} in the latest 365 days and ${twh(gap.twh)} of lignite has nowhere to come from. Net exports in the same quarter hours matched ${pc(gap.exportedShare)} of it. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-lignite', `Lignite in ${last.year}`, twh(last.ligTwh), `${pc(last.ligShare)} of generation, against ${twh(highest.ligTwh)} in ${highest.year}, the most`],
    ['--f-nuclear', `Nuclear in ${last.year}`, twh(last.nucTwh), `${pc(last.nucShare)} of generation${full.every((r) => r.nucTwh <= last.nucTwh) ? ', the most in the data' : ''}`],
    ['--f-lignite', `Lowest lignite in ${last.year}`, mw(last.ligMin), `on ${fmtDate(at(last.ligMinAt))}; it never reaches zero`],
    ['--fossil', 'Longest spell with lignite under 2 GW', sp[2] ? hrs(spellH(sp[2])) : 'None yet', sp[2] ? `from ${fmtDate(at(sp[2].start))}: the record the closures should break` : 'the record the closures should set'],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${gw(noon)}</div><div class="sub">Average lignite output at ${hh(13)} from May to August ${last.year}, when solar peaks. In ${first.year} it was ${gw(first.summerHour[13])}. The lowest point of the median day has fallen from ${gw(first.ligDayMinMedian)} to ${gw(last.ligDayMinMedian)}.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: lignite that now follows the sun and the price, where its power goes, what it costs and who pays, the closures sized against the data, and what is coming, with the record each item should move.';

  const chapters = [
    'Lignite now follows the sun',
    'Where the lignite power goes',
    'What it costs, and who pays',
    'The closures, sized against the data',
    'What is coming, and which records it moves',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const cats = rows.map((r) => label(r.year));
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const yearColors = ['--f-other', '--f-gas', '--f-lignite', '--f-coal'];

  // Chapter 1: lignite by hour.
  $('take-1').textContent = `Summer noon lignite fell from ${gw(first.summerHour[13])} in ${first.year} to ${gw(noon)} in ${last.year}. Summer evenings stayed near ${gw(evening)}.`;
  $('body-1').innerHTML = `<p>In ${first.year} Czech lignite ran flat. From May to August it averaged ${gw(first.summerHour[3])} at ${hh(3)}, ${gw(first.summerHour[13])} at ${hh(13)} and ${gw(first.summerHour[21])} at ${hh(21)}, and it made ${twh(first.ligTwh)} over the year, ${pc(first.ligShare)} of public generation. In ${last.year} it made ${twh(last.ligTwh)}, ${pc(last.ligShare)}, and nuclear made ${twh(last.nucTwh)}, ${pc(last.nucShare)}. The yearly total fell by less than a third. The shape of the day changed much more. From May to August ${last.year} lignite averaged ${gw(last.summerHour[3])} at ${hh(3)}, ${gw(noon)} at ${hh(13)} and ${gw(evening)} at ${hh(21)}. The dip at noon is new: in ${y2020.year} the same three hours were ${gw(y2020.summerHour[3])}, ${gw(y2020.summerHour[13])} and ${gw(y2020.summerHour[21])}.</p>
    <p>What changed is solar. ${Number.isFinite(solarNow) ? `Energy-Charts lists ${gw(solar22)} of solar installed in 2022 and ${gw(solarNow)} in ${capYear}, and solar` : 'Solar'} generation went from ${twh(first.solTwh)} in ${first.year} to ${twh(last.solTwh)} in ${last.year}. A Czech summer afternoon now has several gigawatts of solar that cost nothing to run, and lignite is what gets turned down.</p>
    <p>The seasons tell the same story. In ${last.year} lignite made ${twh(last.ligMonth[0])} in January and ${twh(last.ligMonth[lowMonth])} in ${monthName(lowMonth)}. It never stops: the lowest quarter hour of ${last.year} was ${mw(last.ligMin)} (${fmtDate(at(last.ligMinAt))}), and the median day's lowest point was ${gw(last.ligDayMinMedian)}, against ${gw(first.ligDayMinMedian)} in ${first.year}. The floor that is left is the heat-supplying plants and the units that stay warm for the evening. Which is which is in ${link(3, 'chapter 3')}.</p>`;
  $('chart-h-1').textContent = 'Lignite by hour of day, May to August';
  $('chart-hint-1').textContent = 'Average lignite output at each hour of the day, Czech time, from May to August. The thick line is the latest 365 days.';
  const hourYears = [first.year, y2020.year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const hourLines = hourYears.map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).summerHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-1'), {
    series: hourLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}`;
    },
  });
  $('story-legend-1').innerHTML = legend(hourLines.map((sr) => [sr.name, sr.color]));

  // Chapter 2: exports.
  $('take-2').textContent = `${pc(last.ligExportingShare)} of ${last.year}'s lignite was burnt while Czechia was a net exporter. It sold ${twh(last.netExpTwh)} net abroad, and only ${twh(last.ligImporting)} of lignite was burnt while it was importing.`;
  $('body-2').innerHTML = `<p>Czechia has exported power every year of the data. Net exports were ${twh(first.netExpTwh)} in ${first.year} and ${twh(y2022.netExpTwh)} in ${y2022.year}, fell to ${twh(lowExport.netExpTwh)} in ${lowExport.year}, the lowest year, and came back to ${twh(last.netExpTwh)} in ${last.year}. ČEPS's own figure for 2025 is 7.56 TWh net, mostly to Austria (8.27 TWh) and Slovakia (4.36 TWh), with net imports from Germany (4.2 TWh) and Poland (0.88 TWh) (${src(SOURCES.exports, 'oEnergetice')}). The country was a net exporter for ${hrs(last.expHours)} of ${last.year}, and for ${hrs(latest.expHours)} of the latest 365 days.</p>
    <p>Lignite and exports move together. ${pc(first.ligExportingShare)} of ${first.year}'s lignite was burnt while the country was exporting; ${pc(lowExport.ligExportingShare)} in ${lowExport.year}, the low-export year; ${pc(last.ligExportingShare)} in ${last.year} and ${pc(latest.ligExportingShare)} in the latest 365 days. Lignite burnt while importing was ${twh(lowExport.ligImporting)} in ${lowExport.year} and ${twh(last.ligImporting)} in ${last.year}. With nuclear at ${pc(last.nucShare)} of generation, and hydro, biomass and now solar on top, Czech demand is covered for most of the year without the lignite fleet running hard. What the fleet does above that is sell into Austria and Slovakia.</p>
    <p>That is also why reactor outages do not show up in the lignite data. In ${last.year} lignite averaged ${gw(last.ligNucOut)} in the hours a reactor was off (nuclear under 3 GW) and ${gw(last.ligNucIn)} in the rest. The outages fall in summer, when lignite is low anyway, so the comparison says nothing about lignite backing up nuclear. The Ministry of Industry and Trade expects Czechia to become a net importer as early as 2027 as the coal plants close (${src(SOURCES.exports, 'oEnergetice')}), which is the first record on the exports side to watch.</p>`;
  $('chart-h-2').textContent = 'Lignite burnt while exporting and while importing';
  $('chart-hint-2').textContent = 'Lignite generation each year, in TWh, split by whether Czechia was a net exporter or a net importer in that quarter hour. The last bar is the latest 365 days.';
  const ch2 = [
    { name: 'While importing', color: css('--f-imports'), values: rows.map((r) => r.ligImporting) },
    { name: 'While exporting', color: css('--f-lignite'), values: rows.map((r) => r.ligTwh - r.ligImporting) },
  ];
  barChart($('story-chart-2'), {
    cats,
    stacks: ch2,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Lignite: <b>${twh(rows[ci].ligTwh)}</b> (${pc(rows[ci].ligShare)})</div>${[...ch2].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}<div>Net exports: <b>${twh(rows[ci].netExpTwh)}</b></div>`,
  });
  $('story-legend-2').innerHTML = legend([...ch2].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 3: the economics.
  $('take-3').textContent = `Carbon alone costs a lignite unit about ${eur(CARBON_EUR_T * LIGNITE_T_PER_MWH)} a megawatt hour at 2025 prices. The Czech price averaged ${eur(last.priceHour[13])} at ${hh(13)} and ${eur(last.priceHour[19])} at ${hh(19)} in ${last.year}.`;
  $('body-3').innerHTML = `<p>A lignite plant's fuel is cheap and dug next door. Its carbon is not. Old Czech lignite units emit about ${LIGNITE_T_PER_MWH} tonnes of CO2 for each megawatt hour (Prunéřov is listed at 1.07 and ČEZ's subcritical coal fleet at 1.22: ${src(SOURCES.intensity, 'Wikipedia')}). At the 2025 average allowance price of €76.85 a tonne (${src(SOURCES.aleasoft, 'AleaSoft')}) carbon alone costs about ${eur(CARBON_EUR_T * LIGNITE_T_PER_MWH)} a megawatt hour, and roughly ${eur(LIGNITE_COST)} with fuel and running costs (our estimate, not a market figure). Chvaletice alone paid CZK 4.98 billion for allowances in 2025 (${src(SOURCES.chvaleticeLoss, 'oEnergetice')}). By April 2026 the allowance price was around €90 a tonne (${src(SOURCES.runOn, 'oEnergetice')}).</p>
    <p>The Czech day-ahead price averaged ${eur(last.price)} in ${last.year}: ${eur(last.priceHour[13])} at ${hh(13)}, below that cost, and ${eur(last.priceHour[19])} at ${hh(19)}, well above it. In ${first.year} the price averaged ${eur(first.price)} and was nearly flat through the day. In the latest 365 days the average was ${eur(latest.price)}, ${eur(latest.priceHour[13])} at ${hh(13)} and ${eur(latest.priceHour[19])} at ${hh(19)}. So a lignite unit that can turn down at noon and come back for the evening makes money, and one that cannot loses it. That is the day shape in ${link(1, 'chapter 1')}.</p>
    <p>Not all of it follows the price. In the ${hrs(last.negPriceHours)} of negative prices in ${last.year} lignite still made ${twh(last.ligNegPriceTwh)}. The plausible reasons are heat contracts, the minimum load a boiler can hold, and staying warm for the evening ramp; none of these is published, so this is inferred. Most Czech lignite plants supply district heat, and Kladno is the clearest case: in February 2026 the plant asked the regulator, ERÚ, to find the city a new heat supplier from April, saying its contract price with the city company Tepo, fixed to 2030, does not cover its costs (${src(SOURCES.kladno, 'oEnergetice')}). In March ERÚ said it was preparing to order the plant to keep running beyond its licence, with justified costs reimbursed and heat prices likely to rise (${src(SOURCES.kladnoOrder, 'oEnergetice')}).</p>
    <p>The owners are now saying the sums do not add up. Sev.en, which owns Počerady, Chvaletice and Kladno, announced in November 2025 that all three would close by March 2027, citing lasting losses from the outlook for power and carbon prices (${src(SOURCES.closure, 'oEnergetice')}). Chvaletice lost CZK 1.3 billion in 2024 and CZK 310 million in 2025 (${src(SOURCES.chvaleticeLoss, 'annual report, via oEnergetice')}). ČEPS, the grid operator, found that Počerady and Kladno are not needed for electricity and that supply is adequate in every scenario, but asked for two of Chvaletice's four units to keep running in 2027 for voltage control in the north of the grid, line loading and black start, after the July 2025 blackout (${src(SOURCES.ceps, 'ČT24')}, ${src(SOURCES.cepsReport, 'oEnergetice')}). ERÚ is working out the plant's demonstrable loss from that partial running, to be paid through regulated grid charges, "at most a few dozen CZK/MWh" (${src(SOURCES.chvaleticeComp, 'oEnergetice')}, ${src(SOURCES.ceps, 'ČT24')}). So from 2027 the bill splits three ways: the market pays the evening and winter units, heat customers pay for the boilers ERÚ orders on, and every grid user pays for two Chvaletice units to hold voltage.</p>`;
  $('chart-h-3').textContent = 'Price by hour of day';
  $('chart-hint-3').textContent = `Average Czech day-ahead price at each hour of the day, in euros per MWh. The line across is our rough estimate of a lignite unit's carbon and fuel cost, about ${eur(LIGNITE_COST)}.`;
  const priceYears = [first.year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y && Number.isFinite(r.price)));
  const priceLines = priceYears.map((y, k) => ({ name: title(y), color: css(yearColors[[0, 2, 3][k]]), points: row(y).priceHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-3'), {
    series: priceLines,
    yMin: 0,
    yFormat: eur,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    refLines: [{ value: LIGNITE_COST, color: css('--f-lignite') }],
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? `${eur(v.value)}/MWh` : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-3').innerHTML = `${legend(priceLines.map((sr) => [sr.name, sr.color]))}<span>Line: lignite's cost, about ${eur(LIGNITE_COST)}</span>`;

  // Chapter 4: the closures, as a lower ceiling.
  $('take-4').textContent = `Take ${gw(CLOSING_NET_GW)} off lignite's ${gw(peakFleet)} peak and ${twh(gap.twh)} of the latest year's output has nowhere to come from. Net exports matched ${pc(gap.exportedShare)} of it.`;
  $('body-4').innerHTML = `<p>Sev.en's three plants add up to ${gw(CLOSING_GW)}: Počerady 1,050 MW, Chvaletice 820 MW and Kladno 524 MW (${src(SOURCES.closure, 'oEnergetice')}). ČEPS's study counts them at 2,187 MWe (${src(SOURCES.cepsReport, 'oEnergetice')}). Keep two of Chvaletice's four units, about ${gw(CHVALETICE_KEPT_MW / 1000)} (our estimate, half of 820 MW), and about ${gw(CLOSING_NET_GW)} goes.</p>
    <p>${Number.isFinite(ligCap) ? `Energy-Charts lists ${gw(ligCap)} of lignite plant in ${capYear}, but the fleet has not run near that in years. ` : ''}It peaked at ${gw(everMax.ligMax)} in ${everMax.year} and at ${gw(Math.min(...recent.map((r) => r.ligMax)))} to ${gw(Math.max(...recent.map((r) => r.ligMax)))} in each year since 2023; ${gw(peakFleet)} in the latest 365 days. Take the ${gw(CLOSING_NET_GW)} off that ${gw(peakFleet)} peak and the ceiling is about ${gw(remaining)}. This assumes the closing plants are running whenever the fleet is flat out, which is an assumption, not a measurement.</p>
    <p>Lignite was above ${gw(remaining)} for ${hrs(gap.hours)} in the latest 365 days and made ${twh(gap.twh)} above it. In those same quarter hours Czechia's net exports came to ${pc(gap.exportedShare)} of that. For ${last.year} the figures are ${hrs(gapLast.hours)}, ${twh(gapLast.twh)} and ${pc(gapLast.exportedShare)}. Hours above 3 GW were ${n0(above(first, 3))} in ${first.year}. So the first thing the closures take is the export, which is what ČEPS found (loss of load expectation zero in every scenario) and what an independent study by Fakta o klimatu found, with wholesale prices up at most 2% (${src(SOURCES.adequacy, 'oEnergetice')}). This is the most the closures could take off, not a forecast: ČEZ's and EP's plants could run more in the hours Sev.en's used to, and the grid can import.</p>`;
  $('chart-h-4').textContent = 'Hours each year with lignite above 3 GW';
  $('chart-hint-4').textContent = 'Hours each year that lignite output was above 3 GW, about where its ceiling should sit after Sev.en\'s closures. Hours above 4 and 5 GW and the year\'s peak are in the tooltip.';
  const lvls = [3, 4, 5];
  const lvColors = ['--f-lignite', '--f-coal', '--fossil'];
  const lvLines = lvls.map((l, k) => ({ name: `Above ${l} GW`, color: css(lvColors[k]), values: rows.map((r) => above(r, l)) }));
  barChart($('story-chart-4'), {
    cats,
    stacks: [lvLines[0]],
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${lvLines.map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${hrs(sr.values[ci])}</b></div>`).join('')}<div>Peak: <b>${gw(rows[ci].ligMax)}</b></div>`,
  });
  $('story-legend-4').innerHTML = legend([[lvLines[0].name, lvLines[0].color]]);

  // Chapter 5: what's coming.
  $('take-5').textContent = 'Sev.en\'s plants run at least to March 2027 and may run on. ČEZ converts its coal sites to gas and biomass from 2026 to 2030, coal ends nationally in 2033, and new nuclear arrives in 2036. The record to watch is the longest spell with lignite under 2 GW.';
  $('body-5').innerHTML = `<p>The date has already moved once. Sev.en said in November 2025 it would close in December 2026, or by March 2027 at the latest. On 1 April 2026 it said that Počerady and Chvaletice will generate at least until 31 March 2027 and that, after assessing market conditions, it may continue after that, citing power, carbon and gas prices (${src(SOURCES.runOn, 'oEnergetice')}). So March 2027 is a floor, not a closure date, and the records below will say whether the plants went.</p>
    <p>The record to watch is the longest spell with lignite under 2 GW: ${spellText(sp[2])}. Under 1.5 GW it is ${spellText(sp[1.5])}; under 2.5 GW, ${spellText(sp[2.5])}; under 3 GW, ${spellText(sp[3])}. All fossil fuels together have been under 3 GW for ${fossil3Spell ? hrs(spellH(fossil3Spell)) : 'no time'} at most. The spells under 2 and 1.5 GW were set in summer, when solar is strong. With ${gw(CLOSING_NET_GW)} less lignite plant, spells like these should run on into the autumn, and the hours a year with lignite under 2 GW, ${n0(under(first, 2))} in ${first.year} and ${n0(under(last, 2))} in ${last.year}, should jump. If Sev.en keeps running, they will not.</p>
    <p>Lignite is not the only fossil fuel. Gas made ${twh(last.gasTwh)} in ${last.year} and ${twh(latest.gasTwh)} in the latest 365 days, and the coal sites are being rebuilt around it: EP's first combined-cycle unit at Opatovice is due at the end of 2027 (${src(SOURCES.closure, 'oEnergetice')}), and ČEZ plans gas and biomass at Dětmarovice in 2026, Prunéřov and Tušimice in 2027, Trmice in 2029 and Mělník in 2029 to 2030 (${src(SOURCES.kpler, 'Kpler')}). So watch fossil under 3 GW and 2 GW, not only lignite. Batteries are small but arriving: 318 MWh connected in the first half of 2026 (${src(SOURCES.batteriesH1, 'ESS News')}), Sev.en's own 115 MW and 230 MWh at Chvaletice and 45 MW and 90 MWh at Kladno due in 2026, ČEZ's 270 MW and 970 MWh near Chomutov before 2030 (${src(SOURCES.batteries, 'oEnergetice')}), and about 6 GWh expected by 2030 (${src(SOURCES.batteriesH1, 'ESS News')}). At those sizes they can cover part of an evening, not a winter.</p>`;
  $('chart-h-5').textContent = 'Hours a year with lignite under 2 GW';
  $('chart-hint-5').textContent = 'Hours each year with lignite under 2 GW. The year\'s lowest quarter hour is in the tooltip. The last bar is the latest 365 days.';
  const ch5 = [{ name: 'Lignite under 2 GW', color: css('--lowcarbon'), values: rows.map((r) => under(r, 2)) }];
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under 2 GW: <b>${n0(ch5[0].values[ci])}</b></div><div>Lowest lignite: <b>${mw(rows[ci].ligMin)}</b></div><div>Median day's low: <b>${gw(rows[ci].ligDayMinMedian)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([when, what, sources, record]) => `<li><span class="swatch" style="background:var(--f-lignite)"></span><span><b>${when}</b> ${what} (${sources.map((s, k) => src(SOURCES[s], k ? `${k + 1}` : 'source')).join(', ')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
