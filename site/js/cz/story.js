// The Czechia story: why lignite still makes so much of the country's power,
// what pays for it, and the closures that should bring its lows down in steps.
// The figures are worked out from the data by storyFigures() in figures.js,
// which the tests also run; renderStory() draws the page. Answer first: the
// answer, three supporting points, then five chapters.
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
  ceps: 'https://ct24.ceskatelevize.cz/clanek/ekonomika/dva-ze-ctyr-bloku-chvaletic-musi-pokracovat-uvedl-ceps-369692',
  cepsReport: 'https://oenergetice.cz/en/opinions/what-does-the-czech-ceps-report-really-say-about-the-need-for-tykacs-power-plants',
  chvaletice: 'https://oenergetice.cz/en/coal/free-allowances-will-not-save-czechias-chvaletice-plant-closure-remains-on-the-table',
  kladno: 'https://oenergetice.cz/teplarenstvi/teplarna-kladno-vyzvala-eru-aby-od-dubna-vybral-noveho-dodavatele-tepla',
  adequacy: 'https://oenergetice.cz/en/czech-power-plants/experts-czech-republic-will-have-enough-electricity-after-chvaletice-and-pocerady-plants-close',
  exports: 'https://oenergetice.cz/en/electricity-market/czech-electricity-exports-rose-last-year-after-years-of-decline',
  coal2025: 'https://oenergetice.cz/en/czech-energy-sector/decline-in-output-from-czech-coal-fired-power-plants-halted-last-year-but-is-set-to-continue',
  necp: 'https://oenergetice.cz/en/czech-energy-sector/czech-government-confirms-coal-phase-out-by-2033-but-underestimates-renewables-ngos-say',
  dukovany: 'https://www.enerdata.net/publications/daily-energy-news/khnp-signs-final-contract-build-two-nuclear-reactors-dukovany-czechia.html',
  aleasoft: 'https://aleasoft.com/european-market-prices-2025-second-lowest-since-2021-pv-records',
};

// Rough fuel and carbon cost of a lignite plant in 2025, our estimate: carbon
// at €76.85/t (AleaSoft's 2025 average) and about 1.1 t of CO2 per MWh of
// power for an old lignite unit, plus about €10/MWh for mine-mouth lignite.
// An estimate, not a market figure.
export const CARBON_EUR_T = 76.85;
export const LIGNITE_T_PER_MWH = 1.1;
export const LIGNITE_FUEL_EUR = 10;
export const LIGNITE_COST = CARBON_EUR_T * LIGNITE_T_PER_MWH + LIGNITE_FUEL_EUR;

const CLOSING_GW = (CLOSING_MW.pocerady + CLOSING_MW.chvaletice + CLOSING_MW.kladno) / 1000;
const CLOSING_NET_GW = CLOSING_GW - CHVALETICE_KEPT_MW / 1000;

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['Dec 2026 to Mar 2027', 'Sev.en closes Počerady (1,050 MW) and the Kladno plant (524 MW), and Chvaletice (820 MW) except, on ČEPS\'s advice, two of its four units kept running for grid support in 2027.', 'ceps', 'The lignite floor and the longest spell with lignite under 2.5 GW and 2 GW: they should step down from spring 2027.'],
  ['Around 2027', 'Kladno\'s heat: in February 2026 the coal plant asked ERÚ to find the city a new heat supplier, saying its contract price does not cover its costs; the city plans its own gas plant around 2027.', 'kladno', 'The winter lignite floor: one fewer heat contract keeping a coal boiler lit.'],
  ['2027 (Ministry of Industry analysis)', 'Czechia could become a net importer of electricity as the coal plants close.', 'exports', 'Net exports, and the spell with net imports over 1 GW.'],
  ['End of 2027', 'EP\'s first combined-cycle gas unit at Opatovice, part of its plan to stop burning coal by 2030.', 'closure', 'Gas output rises as lignite falls: watch fossil under 3 GW, not just lignite.'],
  ['2030', 'ČEZ plans to end coal generation, possibly earlier; the national plan targets 10 GW of solar.', 'necp', 'Lignite under 1 GW, and the solar peak.'],
  ['2033', 'The government\'s date for the end of coal.', 'necp', 'Lignite at zero.'],
  ['2036', 'The first of two new 1,055 MW reactors at Dukovany, built by KHNP.', 'dukovany', 'Nuclear peaks, and low-carbon share records in winter.'],
];


export function renderStory(data, end, figs, installed = null) {
  const { rows, ligSpells } = figs;
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
  const capAt = (type, k) => installed?.types[type]?.[k];
  const ligCap = installed ? capAt('Fossil brown coal / lignite', installed.years.indexOf(capYear)) : NaN;
  const solarFrom = installed ? capAt('Solar AC', 0) : NaN;
  const solarTo = installed ? capAt('Solar AC', installed.years.indexOf(capYear)) : NaN;
  // The fleet's real ceiling is its highest output in the latest 365 days,
  // well under the capacity Energy-Charts lists; the closures take the net
  // closing capacity off that ceiling (an assumption, stated on the page).
  const peakFleet = latest.ligMax;
  const remaining = peakFleet - CLOSING_NET_GW;
  const gap = closureGap(latest, remaining);
  const everMax = full.reduce((a, r) => (r.ligMax > a.ligMax ? r : a), first);
  const sp = Object.fromEntries(ligSpells.map((s) => [s.gw, s.spell]));
  const highest = full.reduce((a, r) => (r.ligTwh > a.ligTwh ? r : a), first);
  const lowExport = full.reduce((a, r) => (r.netExpTwh < a.netExpTwh ? r : a), first);
  const noon = last.summerHour[13];
  const evening = last.summerHour[21];
  const mw = (v) => `${n0(v * 1000)} MW`;
  const under = (r, l) => r.hours - (r.levels.find((x) => x.gw === l)?.hours ?? 0);
  const hasPrice = Number.isFinite(last.price);

  // Header and in short.
  $('lede').textContent = `Lignite made ${pc(last.ligShare)} of Czechia's electricity in ${last.year}, ${twh(last.ligTwh)}, and ${pc(last.ligExportingShare)} of it was burnt while the country was selling power abroad.`;
  $('answer-lead').textContent = 'Lignite still runs in Czechia because it supplies the evenings, the winter and the exports, which pay more than it costs. At noon in summer, when solar pulls the price below its fuel and carbon cost, it now turns down to about a gigawatt. So when Sev.en closes Počerady, Chvaletice and Kladno by March 2027, exports should go first, and the lignite lows should step down again.';
  $('answer-points').innerHTML = [
    `<b>It follows the price now.</b> From May to August ${last.year} lignite averaged ${gw(noon)} at ${hh(13)} and ${gw(evening)} at ${hh(21)}; in ${first.year} the same hours were ${gw(first.summerHour[13])} and ${gw(first.summerHour[21])}. ${link(1, 'Chapter 1')}`,
    `<b>Much of it is exported.</b> Czechia was a net exporter for ${hrs(last.expHours)} of ${last.year} and sold ${twh(last.netExpTwh)} net abroad; only ${twh(last.ligImporting)} of lignite was burnt while it was importing. ${link(2, 'Chapters 2')} and ${link(3, '3')}`,
    `<b>The closures cut exports first.</b> With about ${gw(CLOSING_NET_GW)} gone, lignite above ${gw(remaining)} made ${twh(gap.twh)} in the latest 365 days, and net exports in the same quarter hours matched ${pc(gap.exportedShare)} of it. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-lignite', `Lignite in ${last.year}`, twh(last.ligTwh), `${pc(last.ligShare)} of generation, against ${twh(highest.ligTwh)} in ${highest.year}`],
    ['--f-lignite', `Lowest lignite in ${last.year}`, mw(last.ligMin), `on ${fmtDate(at(last.ligMinAt))}; the heating plants never all stop`],
    ['--f-nuclear', `Nuclear in ${last.year}`, twh(last.nucTwh), `${pc(last.nucShare)} of generation, from Dukovany and Temelín`],
    ['--fossil', 'Longest spell with lignite under 2 GW', sp[2] ? hrs(spellH(sp[2])) : 'None yet', sp[2] ? `from ${fmtDate(at(sp[2].start))}: the record the closures should break` : 'the record the closures should set'],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${gw(noon)}</div><div class="sub">Average lignite output at ${hh(13)} from May to August ${last.year}, when solar peaks. In ${first.year} it was ${gw(first.summerHour[13])}, and the lowest point of the median day has fallen from ${gw(first.ligDayMinMedian)} to ${gw(last.ligDayMinMedian)}.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: lignite that now follows the price, where its power goes, what it costs and who pays, the closures in steps, and what is coming, with the record each item should move.';

  const chapters = [
    'Lignite now follows the price',
    'Where the lignite power goes',
    'What it costs, and who pays',
    'The closures, in steps',
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
  $('take-1').textContent = `Summer noon lignite fell from ${gw(first.summerHour[13])} in ${first.year} to ${gw(noon)} in ${last.year}, while summer evenings stayed near ${gw(evening)}.`;
  $('body-1').innerHTML = `Lignite made ${twh(last.ligTwh)} in ${last.year}, ${pc(last.ligShare)} of Czech generation, down from ${twh(first.ligTwh)} (${pc(first.ligShare)}) in ${first.year}; nuclear made ${twh(last.nucTwh)}. Lignite used to run flat: from May to August ${first.year} it averaged ${gw(first.summerHour[3])} at ${hh(3)} and ${gw(first.summerHour[13])} at ${hh(13)}. Solar has since grown to ${twh(last.solTwh)} a year${Number.isFinite(solarTo) ? `, with ${gw(solarFrom)} installed in ${installed.years[0]} and ${gw(solarTo)} in ${capYear}` : ''}, and in summer ${last.year} lignite averaged ${gw(last.summerHour[3])} at ${hh(3)}, ${gw(noon)} at ${hh(13)} and ${gw(evening)} at ${hh(21)}. It still runs most in winter: ${twh(last.ligMonth[0])} in January against ${twh(Math.min(...last.ligMonth))} in its lowest month. The lowest quarter hour of ${last.year} was ${mw(last.ligMin)}, never zero: most Czech lignite plants also supply district heat (${src(SOURCES.closure, 'ČEZ, via oEnergetice')}).`;
  $('chart-h-1').textContent = 'Lignite by hour of day, May to August';
  $('chart-hint-1').textContent = 'Average lignite output for each hour of the day, Czech time, in GW, over May to August. The thick line is the latest 365 days.';
  const hourYears = [first.year, row(2020).year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
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
  $('take-2').textContent = `${pc(last.ligExportingShare)} of ${last.year}'s lignite was burnt while Czechia was a net exporter; it sold ${twh(last.netExpTwh)} net abroad.`;
  $('body-2').innerHTML = `Czechia exported ${twh(last.expTwh)} in the quarter hours it was a net exporter in ${last.year} and imported ${twh(last.impTwh)} in the rest, ${twh(last.netExpTwh)} net, against ${twh(first.netExpTwh)} in ${first.year} and ${twh(lowExport.netExpTwh)} in ${lowExport.year}, the lowest year. ČEPS's figures for 2025 put the net export at 7.56 TWh, mostly to Austria and Slovakia, with net imports from Germany (${src(SOURCES.exports, 'oEnergetice')}). Only ${twh(last.ligImporting)} of lignite was burnt while the country was importing. In the latest 365 days lignite made ${twh(latest.ligTwh)} and net exports came to ${twh(latest.netExpTwh)}. A country that makes ${pc(last.nucShare)} of its power from nuclear and sells a surplus to its neighbours has a margin to lose before it goes short: the export is that margin, and lignite fills it.`;
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
  $('take-3').textContent = hasPrice ? `Lignite needs roughly ${eur(LIGNITE_COST)} a megawatt hour at 2025 carbon prices, our estimate; the Czech price averaged ${eur(last.priceHour[13])} at ${hh(13)} and ${eur(last.priceHour[19])} at ${hh(19)} in ${last.year}.` : `Lignite needs roughly ${eur(LIGNITE_COST)} a megawatt hour at 2025 carbon prices, our estimate.`;
  $('body-3').innerHTML = `An old lignite unit emits about ${LIGNITE_T_PER_MWH} tonnes of CO2 for each megawatt hour, so at the 2025 average carbon price of €76.85 a tonne (${src(SOURCES.aleasoft, 'AleaSoft')}) carbon alone costs about ${eur(CARBON_EUR_T * LIGNITE_T_PER_MWH)} a megawatt hour, roughly ${eur(LIGNITE_COST)} with the fuel (our estimate, not a market figure). ${hasPrice ? `The Czech day-ahead price averaged ${eur(last.price)} in ${last.year}: ${eur(last.priceHour[13])} at ${hh(13)}, below that cost, and ${eur(last.priceHour[19])} at ${hh(19)}, well above it. That is why lignite eases at noon and runs hard in the evening. ` : ''}${last.negPriceHours ? `It never stops entirely: in the ${hrs(last.negPriceHours)} of negative prices in ${last.year}, lignite still made ${twh(last.ligNegPriceTwh)}, for heat customers and to stay ready for the evening (inferred). ` : ''}The margins are thin. Sev.en, which owns Počerady, Chvaletice and Kladno, said the outlook for power and carbon prices meant lasting losses and will close all three (${src(SOURCES.closure, 'oEnergetice')}); Chvaletice lost CZK 1.4 billion in 2025 (${src(SOURCES.chvaletice, 'oEnergetice')}). ČEPS, the grid operator, found the country has enough capacity without them, but asked for two of Chvaletice's four units to keep running in 2027 for voltage control and grid restoration; the regulator, ERÚ, is to set their compensation, paid through regulated charges (${src(SOURCES.ceps, 'ČT24')}). Kladno's heat is a separate problem: the plant says its contract price with the city does not cover its costs (${src(SOURCES.kladno, 'oEnergetice')}).`;
  $('chart-h-3').textContent = 'Price by hour of day';
  $('chart-hint-3').textContent = `Average Czech day-ahead price for each hour of the day, in euros per MWh. The line across is our rough estimate of a lignite plant's fuel and carbon cost, ${eur(LIGNITE_COST)}.`;
  const priceYears = [row(2019).year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y && Number.isFinite(r.price)));
  const priceLines = priceYears.map((y, k) => ({ name: title(y), color: css(yearColors[k + 1]), points: row(y).priceHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-3'), {
    series: priceLines,
    yMin: 0,
    yFormat: eur,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    refLines: [{ value: LIGNITE_COST, color: css('--f-lignite') }],
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? `${eur(v.value)}/MWh` : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-3').innerHTML = `${legend(priceLines.map((sr) => [sr.name, sr.color]))}<span>Line: lignite cost, about ${eur(LIGNITE_COST)}</span>`;

  // Chapter 4: the closures, as a lower ceiling.
  $('take-4').textContent = `Take ${gw(CLOSING_NET_GW)} off lignite's ${gw(peakFleet)} peak and ${twh(gap.twh)} of the latest year's output has nowhere to come from; net exports matched ${pc(gap.exportedShare)} of it.`;
  $('body-4').innerHTML = `Sev.en's three plants add up to about ${gw(CLOSING_GW)} (${src(SOURCES.closure, 'Sev.en, via oEnergetice')}); keep about ${gw(CHVALETICE_KEPT_MW / 1000)} of Chvaletice for the grid (two of its four units, our estimate of their size) and about ${gw(CLOSING_NET_GW)} goes. ${Number.isFinite(ligCap) ? `Energy-Charts lists ${gw(ligCap)} of lignite plant in ${capYear}, but the fleet has made no more than ${gw(everMax.ligMax)} in any year of the data (${everMax.year}), and ${gw(peakFleet)} in the latest 365 days. ` : ''}Taking the closing capacity off that ${gw(peakFleet)} peak leaves a ceiling of about ${gw(remaining)} (our assumption: the plants that close run whenever the fleet runs flat out). In the latest 365 days lignite was above that ceiling for ${hrs(gap.hours)} and made ${twh(gap.twh)} above it; in those same quarter hours Czechia's net exports came to ${pc(gap.exportedShare)} of that. So the first effect should be smaller exports, not shortages, as ČEPS (${src(SOURCES.cepsReport, 'oEnergetice')}) and a study by the Fakta o klimatu initiative (${src(SOURCES.adequacy, 'oEnergetice')}) expect. The remaining plants could run more instead, so this is the most the closures could take, not a forecast.`;
  $('chart-h-4').textContent = 'Hours each year with lignite above 3 GW';
  $('chart-hint-4').textContent = 'Hours each year that lignite output was above 3 GW, about where its ceiling should be after the closures. Hours above 4 and 5 GW, and the year\'s highest, are in the tooltip.';
  const lvls = [3, 4, 5];
  const lvColors = ['--f-lignite', '--f-coal', '--fossil'];
  const lvLines = lvls.map((l, k) => ({ name: `Above ${l} GW`, color: css(lvColors[k]), values: rows.map((r) => r.levels.find((x) => x.gw === l)?.hours ?? 0) }));
  barChart($('story-chart-4'), {
    cats,
    stacks: [lvLines[0]],
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${lvLines.map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${hrs(sr.values[ci])}</b></div>`).join('')}<div>Highest: <b>${gw(rows[ci].ligMax)}</b></div>`,
  });
  $('story-legend-4').innerHTML = legend([[lvLines[0].name, lvLines[0].color]]);

  // Chapter 5: what's coming.
  $('take-5').textContent = 'Sev.en\'s closures by March 2027, ČEZ out of coal by 2030 and the national end of coal in 2033; new nuclear only from 2036. The record to watch is the longest spell with lignite under 2 GW.';
  $('body-5').innerHTML = `The dated items are below, each with the record it should move. The first step is close: from spring 2027 the lignite fleet loses about ${gw(CLOSING_NET_GW)}. The longest spell with lignite under 2 GW is ${sp[2] ? `${hrs(spellH(sp[2]))}, from ${fmtDate(at(sp[2].start))}` : 'none yet'}; under 1.5 GW, ${sp[1.5] ? `${hrs(spellH(sp[1.5]))}, from ${fmtDate(at(sp[1.5].start))}` : 'none yet'}. Both were set in summer, when solar is strong; with less lignite plant, spells like these should run on into the autumn. Hours with lignite under 2 GW went from ${hrs(under(first, 2))} in ${first.year} to ${hrs(under(last, 2))} in ${last.year}: that is the count to watch in 2027.`;
  $('chart-h-5').textContent = 'Hours a year with lignite under 2 GW';
  $('chart-hint-5').textContent = 'Hours each year with lignite output under 2 GW. The year\'s lowest quarter hour is in the tooltip. The last bar is the latest 365 days.';
  const ch5 = [{ name: 'Lignite under 2 GW', color: css('--lowcarbon'), values: rows.map((r) => under(r, 2)) }];
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under 2 GW: <b>${n0(ch5[0].values[ci])}</b></div><div>Lowest lignite: <b>${mw(rows[ci].ligMin)}</b></div><div>Median day's low: <b>${gw(rows[ci].ligDayMinMedian)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--f-lignite)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
