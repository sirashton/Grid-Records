// The Germany story: why lignite still runs through the sunniest middays of
// the year, what it costs, and what is dated to end it. Germany has three
// fossil fuels left; lignite is the one that does not follow the price, so
// the story follows lignite by hour, fossil against trade, and the days a
// battery fleet could cover. The figures are worked out from the data by
// storyFigures(), which the tests also run; renderStory() draws the page.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import de from '../countries/de.js';
import { FOSSIL, WIND, GENERATION, metricSeries, byYear } from './data.js';

// Fossil below this is the floor that runs whatever the weather; batteries
// are sized against the fossil above it.
export const FOSSIL_FLOOR = 5;
// Battery fleets (GW, GWh) the story tests against each day's fossil.
export const BATTERIES = [[10, 40], [20, 80], [40, 160], [80, 320]];
// A day on which lignite at noon is this much below lignite at night, in GW, counts as a dip day.
export const LIGNITE_DIP = 2;
// The tightest hours of each year: the most demand left after wind and solar.
export const TOP_HOURS = 50;
// Local hours compared for the noon dip: night 02:00-05:00, noon 12:00-15:00,
// and the evening peak 17:00-21:00.
const NIGHT = [2, 4];
const NOON = [12, 14];
const EVENING = [17, 20];

/** Demand met in Germany at each slot, in GW: generation plus net imports, less pumping. */
export function demandSeries(data) {
  const { columns, length } = data;
  const out = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    // Exports and pumping are stored as negative MW.
    let v = columns.imports[i] + columns.exports[i] + columns.pumped_storage_charge[i];
    for (const k of GENERATION) v += columns[k][i];
    out[i] = v / 1000;
  }
  return out;
}

/**
 * Local hour, month and day number for every slot. The Berlin offset is looked
 * up once per UTC day, so the hour around a clock change can be one off.
 */
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
      offset = tzOffsetMs(d * 864e5 + 432e5, de.timeZone);
    }
    const local = t + offset;
    const l = new Date(local);
    hour[i] = l.getUTCHours();
    month[i] = l.getUTCMonth() + 1;
    day[i] = Math.floor(local / 864e5);
  }
  return { hour, month, day };
}

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);

/**
 * Every number the story uses. Rows run by German calendar year, complete
 * years only, then 'past365' for the latest 365 days.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const lignite = metricSeries(d, ['lignite']);
  const coal = metricSeries(d, ['coal']);
  const gas = metricSeries(d, ['gas']);
  const fossil = metricSeries(d, FOSSIL);
  const solar = metricSeries(d, ['solar']);
  const wind = metricSeries(d, WIND);
  const nuclear = metricSeries(d, ['nuclear']);
  const demand = demandSeries(d);
  const { imports, exports } = data.columns;
  const { hour, month, day } = localClock(d);

  const rows = byYear(d, () => ({
    ligTwh: 0, coalTwh: 0, gasTwh: 0, fosTwh: 0, solTwh: 0, windTwh: 0, impTwh: 0, expTwh: 0, impHours: 0,
    ligHour: new Float64Array(24), coalHour: new Float64Array(24), gasHour: new Float64Array(24), hourN: new Float64Array(24),
    ligMonth: new Float64Array(12), fosMonth: new Float64Array(12),
    ligMin: Infinity, ligMinAt: -1, fosMin: Infinity, fosMinAt: -1, fosMax: 0, fosMaxAt: -1,
    surplus: { slots: 0, lignite: 0, coal: 0, gas: 0, fossil: 0, exports: 0 },
    fosImporting: 0, evening: { slots: 0, imports: 0, fossil: 0 },
    fosLow5: 0, fosLow10: 0, ligLow3: 0,
    day: null, days: [], slots: [],
  }), (r, i) => {
    const f = fossil[i];
    if (Number.isNaN(f) || Number.isNaN(demand[i])) return;
    const h = hour[i];
    const net = ((imports[i] || 0) + (exports[i] || 0)) / 1000;
    // Each day's lignite dip and fossil above the floor, one day at a time.
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(r.day);
      r.day = { n: day[i], month: month[i], night: 0, nightN: 0, noon: 0, noonN: 0, above: 0, peak: 0, solar: 0 };
    }
    if (h >= NIGHT[0] && h <= NIGHT[1]) { r.day.night += lignite[i]; r.day.nightN++; }
    if (h >= NOON[0] && h <= NOON[1]) { r.day.noon += lignite[i]; r.day.noonN++; }
    r.day.above += Math.max(0, f - FOSSIL_FLOOR) * slotH;
    if (f > r.day.peak) r.day.peak = f;
    r.day.solar += solar[i] * slotH;
    r.ligTwh += (lignite[i] * slotH) / 1000;
    r.coalTwh += (coal[i] * slotH) / 1000;
    r.gasTwh += (gas[i] * slotH) / 1000;
    r.fosTwh += (f * slotH) / 1000;
    r.solTwh += (solar[i] * slotH) / 1000;
    r.windTwh += (wind[i] * slotH) / 1000;
    r.impTwh += ((imports[i] || 0) * slotH) / 1e6;
    r.expTwh += (-(exports[i] || 0) * slotH) / 1e6;
    if (net > 0) { r.impHours += slotH; r.fosImporting += (f * slotH) / 1000; }
    r.ligHour[h] += lignite[i];
    r.coalHour[h] += coal[i];
    r.gasHour[h] += gas[i];
    r.hourN[h]++;
    r.ligMonth[month[i] - 1] += (lignite[i] * slotH) / 1000;
    r.fosMonth[month[i] - 1] += (f * slotH) / 1000;
    if (lignite[i] < r.ligMin) { r.ligMin = lignite[i]; r.ligMinAt = i; }
    if (f < r.fosMin) { r.fosMin = f; r.fosMinAt = i; }
    if (f > r.fosMax) { r.fosMax = f; r.fosMaxAt = i; }
    // Surplus: wind and solar alone above everything Germany used.
    if (wind[i] + solar[i] > demand[i]) {
      const s = r.surplus;
      s.slots++; s.lignite += lignite[i]; s.coal += coal[i]; s.gas += gas[i]; s.fossil += f; s.exports -= net;
    }
    if (h >= EVENING[0] && h <= EVENING[1]) { r.evening.slots++; r.evening.imports += net; r.evening.fossil += f; }
    if (f < 5) r.fosLow5 += slotH;
    if (f < 10) r.fosLow10 += slotH;
    if (lignite[i] < 3) r.ligLow3 += slotH;
    r.slots.push(i);
  }).map((r) => {
    const days = r.day ? [...r.days, r.day] : r.days;
    const dips = days.filter((x) => x.nightN && x.noonN).map((x) => x.night / x.nightN - x.noon / x.noonN);
    const s = r.surplus;
    // The tightest hours: highest demand left after wind and solar.
    const idx = r.slots.sort((a, b) => (demand[b] - wind[b] - solar[b]) - (demand[a] - wind[a] - solar[a])).slice(0, Math.round(TOP_HOURS / slotH));
    const avg = (series) => mean(idx.reduce((a, i) => a + series[i], 0), idx.length);
    const top = { fossil: avg(fossil), nuclear: avg(nuclear), imports: avg(imports) / 1000, ws: mean(idx.reduce((a, i) => a + wind[i] + solar[i], 0), idx.length), demand: avg(demand) };
    top.other = Math.max(0, top.demand - top.ws - top.nuclear - top.fossil - top.imports);
    return {
      year: r.year,
      ligTwh: r.ligTwh,
      coalTwh: r.coalTwh,
      gasTwh: r.gasTwh,
      fosTwh: r.fosTwh,
      solTwh: r.solTwh,
      windTwh: r.windTwh,
      impTwh: r.impTwh,
      expTwh: r.expTwh,
      impHours: r.impHours,
      ligHour: [...r.ligHour].map((v, k) => mean(v, r.hourN[k])),
      coalHour: [...r.coalHour].map((v, k) => mean(v, r.hourN[k])),
      gasHour: [...r.gasHour].map((v, k) => mean(v, r.hourN[k])),
      ligMonth: [...r.ligMonth],
      fosMonth: [...r.fosMonth],
      ligMin: r.ligMin,
      ligMinAt: r.ligMinAt,
      fosMin: r.fosMin,
      fosMinAt: r.fosMinAt,
      fosMax: r.fosMax,
      fosMaxAt: r.fosMaxAt,
      // Hours with wind and solar above demand, and what still ran in them.
      surplus: { hours: s.slots * slotH, lignite: mean(s.lignite, s.slots), coal: mean(s.coal, s.slots), gas: mean(s.gas, s.slots), fossil: mean(s.fossil, s.slots), exports: mean(s.exports, s.slots) },
      fosImportingShare: r.fosImporting / r.fosTwh,
      evening: { imports: mean(r.evening.imports, r.evening.slots), fossil: mean(r.evening.fossil, r.evening.slots) },
      // Night minus noon, so a positive number means lignite dips at noon.
      dip: mean(dips.reduce((a, b) => a + b, 0), dips.length),
      dipDays: dips.filter((x) => x > LIGNITE_DIP).length,
      days: days.length,
      fosLow5: r.fosLow5,
      fosLow10: r.fosLow10,
      ligLow3: r.ligLow3,
      top,
      // Each day's fossil above the floor (GWh), its month and its peak, smallest first.
      fosDays: days.map((x) => ({ gwh: x.above, month: x.month, peak: x.peak, solar: x.solar })).sort((a, b) => a.gwh - b.gwh),
      // Days whose fossil above the floor a battery fleet could have covered, if it was full.
      batteries: BATTERIES.map(([bgw, gwh]) => ({ gw: bgw, gwh, days: days.filter((x) => x.above <= gwh && x.peak - FOSSIL_FLOOR <= bgw).length })),
    };
  });

  // Record spells over the whole record.
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: de.timeZone };
  return {
    rows,
    fossil10Spell: spellOf(summarise(fossil, 10, 'below', opts)),
    fossil5Spell: spellOf(summarise(fossil, 5, 'below', opts)),
    lignite3Spell: spellOf(summarise(lignite, 3, 'below', opts)),
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(1)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const eur = (v) => `€${Math.round(v)}`;
const twh = (v) => `${v.toFixed(v < 10 ? 1 : 0)} TWh`;
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SOURCES = {
  smard: 'https://www.smard.de/page/en/topic-article/217400/219038',
  bnetzaMustRun: 'https://www.bundesnetzagentur.de/SharedDocs/Pressemitteilungen/EN/2021/20211008_Mindesterzeugung.html?r=1',
  btu: 'https://mweke.brandenburg.de/media/bb1.a.3814.de/Studie_konventionelle_Mindesterzeugung_Endbericht.pdf',
  agora: 'https://www.agora-energiewende.de/fileadmin/Projekte/2021/2021_06_DE_Deutsche_Braunkohlewirtschaft/A-EW_248_Deutsche-Braunkohlenwirtschaft-2021_WEB.pdf',
  rte: 'https://analysesetdonnees.rte-france.com/en/annual-review-2025/prices',
  redispatch: 'https://www.cleanthinking.de/faktencheck-redispatch-drei-milliarden/',
  solarspitzen: 'https://www.roedl.com/insights/das-solarspitzengesetz-zweitausendfuenfundzwanzig-wichtige-aenderungen-fuer-erneuerbare-energie-anlagen/',
  kvbg: 'https://lexmea.de/de/gesetz/kvbg/anlage-2',
  kvbgFacts: 'https://www.cleanenergywire.org/factsheets/spelling-out-coal-phase-out-germanys-exit-law-draft',
  nrw2030: 'https://www.cleanenergywire.org/news/german-coal-region-brings-coal-phase-out-forward-2030-refires-lignite-short-term',
  noLaw: 'https://www.cleanenergywire.org/news/german-government-says-no-new-law-planned-ensure-coal-exit-earlier-2038',
  coalition: 'https://www.cleanenergywire.org/factsheets/what-germanys-2025-coalition-agreement-says-climate-and-energy',
  kws: 'https://www.solarserver.de/2026/01/16/bundesregierung-einigt-sich-mit-eu-auf-kraftwerksstrategie/',
  stromvkg: 'https://www.spglobal.com/energy/en/news-research/latest-news/electric-power/051326-german-cabinet-approves-gas-plant-tender-heating-reform-draft-laws',
  batteries: 'https://www.renewable-energy-industry.com/news/world/article-7555-battery-storage-additions-in-germany-on-record-pace-in-first-half-of-2026',
  suedlink: 'https://www.renewable-energy-industry.com/news/world/article-7625-suedlink-elbe-tunnel-completed-germanys-major-power-highways-approach-2027-28-commissioning',
  nuclear: 'https://wnn.world-nuclear.org/articles/a-guide-the-end-of-germany%E2%80%99s-nuclear-power',
};

// 2025 averages from RTE's annual review: gas (TTF) €35.8/MWh and carbon €74.4/t.
export const GAS_2025 = 35.8;
export const CARBON_2025 = 74.4;
// Rough carbon cost of a megawatt hour of lignite power: 0.41 t of CO2 per
// MWh of fuel energy (Öko-Institut for Agora, Rhineland and Lusatia) at the
// 35% to 42% efficiency the same report uses for old and new plants gives
// 1.0 to 1.2 t per MWh of power. The fuel comes from the operator's own mine
// and is not priced on a market, so the carbon is most of the running cost.
// An estimate, not a market figure.
export const LIGNITE_CARBON = [0.41 / 0.42 * CARBON_2025, 0.41 / 0.35 * CARBON_2025];
// A combined-cycle gas plant at 55% efficiency and 0.37 t of CO2 per MWh of power.
export const CCGT_COST = GAS_2025 / 0.55 + 0.37 * CARBON_2025;

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['September and December 2026', 'The first two auctions under the power plant security act (StromVKG), 4.5 GW each, for new hydrogen-ready gas plants that must be running by November 2031. The cabinet approved the draft in May 2026; it still needs parliament and EU state-aid clearance.', 'stromvkg', 'The fossil ceiling: new gas replaces lignite on winter evenings, so the ceiling should fall slower than lignite does. The floor is unaffected until lignite closes.'],
  ['2027', 'A-Nord, a 2 GW direct-current line from the north to the Rhineland, follows Ultranet (2 GW, 2026); SuedLink (4 GW, about 700 km from the Elbe to the south) is due at the end of 2028.', 'suedlink', 'Hours with fossil under 10 GW: northern wind can reach the southern gas plants that run for the grid today (inferred). Redispatch, which does not show in this data, should fall.'],
  ['1 Apr 2028 and 31 Dec 2028', 'Weisweiler G or H (about 660 MW) closes in April; Jänschwalde A to D, four 465 MW units in Lusatia, close at the end of the year. About 2.5 GW of lignite in one year.', 'kvbg', 'The lignite floor and the noon lignite: the longest spell with lignite under 3 GW should pass the record in the facts above.'],
  ['1 Apr 2029 and 31 Dec 2029', 'The other Weisweiler unit, Boxberg N and P (2 × 465 MW) and one of Niederaußem G or H (about 640 MW).', 'kvbg', 'Lignite under 3 GW for days rather than hours; fossil under 5 GW on sunny weekends.'],
  ['31 Mar 2030', 'Niederaußem K and Neurath F and G, the three newest Rhineland units (3.1 GW), close on the date the 2022 agreement to end lignite in North Rhine-Westphalia by 2030 wrote into the law. About 6 GW of lignite is left after this, all in the east bar one Rhineland unit held in reserve to 2033.', 'kvbg', 'The lignite ceiling halves; the floor should sit under 2 GW on most summer days (inferred).'],
  ['2032', 'A technology-open capacity market, to be introduced in 2027 and in force from 2032, pays plants, storage and flexible demand to be available.', 'kws', 'The fossil floor: paying plants to stay available works against the floor falling, as in France.'],
  ['31 Dec 2034 and 31 Dec 2035', 'Schkopau A and B (2 × 450 MW), then Lippendorf R and S (2 × 875 MW).', 'kvbg', 'Lignite under 3 GW becomes the normal state; the record to watch moves to lignite under 1 GW.'],
  ['31 Dec 2038 at the latest', 'Schwarze Pumpe A and B and Boxberg Q and R, the last 3 GW of lignite. Reviews in 2026, 2029 and 2032 can bring the end to 2035; the 2025 coalition agreement keeps 2038 and ties the timetable to new plants being built.', 'coalition', 'Lignite to zero. The fossil floor becomes a gas floor: gas cogeneration and whatever the capacity market keeps on.'],
];

/** Installed GW of a type at the end of a year, from Energy-Charts' yearly series. */
const cap = (installed, type, year) => installed?.types[type]?.[installed.years.indexOf(year)] ?? NaN;

export function renderStory(data, end, installed, figs) {
  const { rows, fossil10Spell, fossil5Spell, lignite3Spell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? first;
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const capYear = installed ? Math.max(...installed.years.filter((y, k) => installed.types['Fossil brown coal / lignite']?.[k] != null)) : null;
  const ligCap = cap(installed, 'Fossil brown coal / lignite', capYear);
  const batCap = cap(installed, 'Battery storage (power)', capYear);
  const batGwh = cap(installed, 'Battery storage (capacity)', capYear);
  const bat = (k) => last.batteries[k];
  const sp = last.surplus;
  const totalAbove = last.fosDays.reduce((a, x) => a + x.gwh, 0) / 1000;
  const winterAbove = last.fosDays.filter((x) => x.month >= 11 || x.month <= 2).reduce((a, x) => a + x.gwh, 0) / 1000;
  const summerAbove = last.fosDays.filter((x) => x.month >= 4 && x.month <= 9).reduce((a, x) => a + x.gwh, 0) / 1000;
  const median = last.fosDays[Math.floor(last.fosDays.length / 2)];
  const worst = last.fosDays.at(-1);
  const best = last.fosDays[0];
  const t1 = first.top;
  const t2 = last.top;

  // Header and in short.
  $('lede').textContent = `Germany burnt ${twh(last.fosTwh)} of lignite, hard coal and gas in ${last.year}, ${pc(last.fosTwh / first.fosTwh)} of what it burnt in ${first.year}, and lignite ran at ${gw(sp.lignite)} on average through the ${hrs(sp.hours)} when wind and solar alone covered demand.`;
  $('answer-lead').textContent = `Germany's fossil plants still run for two different reasons. On winter evenings they are needed: ${gw(t2.fossil)} of fossil plus ${gw(t2.imports)} of imports met the tightest hours of ${last.year}, and nothing built yet replaces that. At sunny noon they are not: lignite kept ${gw(sp.lignite)} running through the hours when wind and solar exceeded demand, while Germany exported ${gw(sp.exports)}, because a lignite unit tied to a mine, a heat network or a grid service is cheaper to keep ticking over than to stop. The dates that end the noon lignite are in law, 2028 to 2030 for the Rhineland and Jänschwalde; the evening fossil is being handed to new gas plants, so the records to watch are the fossil floor and the spells with lignite under 3 GW.`;
  $('answer-points').innerHTML = [
    `<b>Lignite runs through the surplus.</b> In ${last.year} wind and solar alone exceeded demand for ${hrs(sp.hours)}; lignite averaged ${gw(sp.lignite)} in those hours, fossil ${gw(sp.fossil)}, and the surplus went abroad at ${gw(sp.exports)}. Lignite dipped more than ${LIGNITE_DIP} GW at noon on ${last.dipDays} days but never below ${gw(last.ligMin)}. ${link(1, 'Chapter 1')}`,
    `<b>The evening is still fossil, and now imported too.</b> ${pc(last.fosImportingShare)} of ${last.year}'s fossil power was burnt while Germany was a net importer, against ${pc(first.fosImportingShare)} in ${first.year}. In the ${TOP_HOURS} tightest hours of ${last.year} fossil plants made ${gw(t2.fossil)} and imports ${gw(t2.imports)}. ${link(2, 'Chapters 2')} and ${link(3, '3')}`,
    `<b>Batteries can take the summer days, not the winter.</b> ${bat(0).gw} GW and ${bat(0).gwh} GWh would have covered all fossil above ${FOSSIL_FLOOR} GW on ${bat(0).days} days of ${last.year}; ${bat(2).gw} GW and ${bat(2).gwh} GWh on ${bat(2).days}. The rest is winter, and the law ends lignite before anything ends the winter gas. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--fossil', `Fossil burnt in ${last.year}`, twh(last.fosTwh), `lignite ${twh(last.ligTwh)}, gas ${twh(last.gasTwh)}, hard coal ${twh(last.coalTwh)}; ${twh(first.fosTwh)} in ${first.year}`],
    ['--fossil', `Lowest fossil output in ${last.year}`, gw(last.fosMin), `on ${fmtDate(at(last.fosMinAt))}; ${gw(latest.fosMin)} in the latest 365 days`],
    ['--f-lignite', `Lignite at ${hh(13)} and ${hh(19)}`, `${gw(last.ligHour[13])} vs ${gw(last.ligHour[19])}`, `average in ${last.year}${Number.isFinite(ligCap) ? `, from ${ligCap.toFixed(1)} GW of lignite plant` : ''}`],
    ['--fossil', 'Longest spell with fossil under 10 GW', fossil10Spell ? hrs(spellH(fossil10Spell)) : 'None', fossil10Spell ? `from ${fmtDate(at(fossil10Spell.start))}: the record to beat` : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${gw(sp.lignite)}</div><div class="sub">Lignite running, on average, through the ${hrs(sp.hours)} of ${last.year} when wind and solar alone exceeded everything Germany used. Germany exported ${gw(sp.exports)} in those hours. In ${row(2023).year} there were ${hrs(row(2023).surplus.hours)} like that.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: lignite through the sunny middays, the fossil evening and the imports that now cover it, what each fuel costs against the price, what batteries could and could not replace, and what is coming, with the record each item should move.';

  const chapters = [
    'Lignite runs through the sunny middays',
    'The evening is still fossil, and imported',
    'Carbon is most of the cost, and the noon price is below it',
    'What batteries could and could not replace',
    'What is coming, and which records it moves',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const cats = rows.map((r) => label(r.year));
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const yearColors = ['--f-other', '--f-gas', '--f-hydro', '--f-lignite'];

  // Chapter 1: lignite by hour.
  $('take-1').textContent = `Lignite averaged ${gw(last.ligHour[13])} at ${hh(13)} and ${gw(last.ligHour[19])} at ${hh(19)} in ${last.year}. It dips at noon now, but it never stops: ${gw(last.ligMin)} was the year's low.`;
  $('body-1').innerHTML = `Germany's last nuclear reactors closed in April 2023 (${src(SOURCES.nuclear, 'World Nuclear News')}), so lignite is now the plant that runs round the clock. In ${first.year} it ran flat, ${gw(first.ligHour[3])} at ${hh(3)} and ${gw(first.ligHour[13])} at ${hh(13)}. In ${last.year} it learned to dip: ${gw(last.ligHour[13])} at ${hh(13)} against ${gw(last.ligHour[19])} at ${hh(19)}, and on ${last.dipDays} days the noon lignite was more than ${LIGNITE_DIP} GW below the night's. But the dip has a bottom. Wind and solar alone exceeded demand for ${hrs(sp.hours)} in ${last.year}, up from ${hrs(row(2023).surplus.hours)} in ${row(2023).year}, and in those hours lignite still averaged ${gw(sp.lignite)}, hard coal ${gw(sp.coal)} and gas ${gw(sp.gas)}, while Germany exported ${gw(sp.exports)} net. The lowest lignite reading of ${last.year} was ${gw(last.ligMin)}, on ${fmtDate(at(last.ligMinAt))}; in the latest 365 days it is ${gw(latest.ligMin)}. The Bundesnetzagentur found 13 to 14 GW of conventional plant running through the negative-price hours of 2019 and 2020, down from 19 to 24 GW in 2015, and put 4 to 7 GW of it down to minimum generation that cannot respond to price at all, the largest part of that holding negative balancing reserve (${src(SOURCES.bnetzaMustRun, 'Bundesnetzagentur')}). A study for Brandenburg lists why a lignite unit stays on: district heat and process steam it is contracted to supply, the inertia, short-circuit and reactive power the grid takes from a spinning turbine, and the cost of a restart, which it says cannot be cleanly separated from the technical minimum (${src(SOURCES.btu, 'BTU Cottbus')}). The mine behind the plant has to keep digging too; that it pays to burn the coal rather than stockpile it is our inference, not a figure from any source.`;
  $('chart-h-1').textContent = 'Lignite by hour of day';
  $('chart-hint-1').textContent = 'Average lignite output for each hour of the day, German time, in GW. Hard coal and gas at the same hour are in the tooltip. The thick line is the latest 365 days.';
  const ligYears = [first.year, row(2019).year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const ligLines = ligYears.map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).ligHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-1'), {
    series: ligLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b> lignite, ${gw(row(v.series.year).coalHour[hr])} hard coal, ${gw(row(v.series.year).gasHour[hr])} gas</div>`).join('')}`;
    },
  });
  $('story-legend-1').innerHTML = legend(ligLines.map((sr) => [sr.name, sr.color]));

  // Chapter 2: the tightest hours.
  const pick = [first.year, 2019, 2022, last.year].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const parts = [['fossil', 'Fossil', '--fossil'], ['nuclear', 'Nuclear', '--f-nuclear'], ['imports', 'Net imports', '--f-imports'], ['ws', 'Wind and solar', '--f-wind'], ['other', 'Hydro, biomass, storage and other', '--f-other']];
  const stacks = parts.map(([k, name, color]) => ({ name, color: css(color), values: pick.map((y) => row(y).top[k]) }));
  $('take-2').textContent = `In the ${TOP_HOURS} tightest hours of ${last.year}, demand of ${gw(t2.demand)} took ${gw(t2.fossil)} of fossil and ${gw(t2.imports)} of imports. This is the fossil Germany needs, and the ceiling has only fallen from ${gw(first.fosMax)} to ${gw(last.fosMax)}.`;
  $('body-2').innerHTML = `The noon lignite is a few gigawatts. The evening is the bulk of it. Fossil output averaged ${gw(last.evening.fossil)} between ${hh(EVENING[0])} and ${hh(EVENING[1] + 1)} in ${last.year}, and the year's peak was ${gw(last.fosMax)}, on ${fmtDate(at(last.fosMaxAt))}. In the ${TOP_HOURS} tightest hours of ${first.year}, the hours with the most demand left after wind and solar, ${gw(t1.demand)} was met by ${gw(t1.fossil)} of fossil, ${gw(t1.nuclear)} of nuclear and ${gw(t1.imports)} of imports. In ${last.year} the same hours took ${gw(t2.fossil)} of fossil and ${gw(t2.imports)} of imports, with nuclear gone. The trade has turned round. In ${first.year} Germany exported ${twh(first.expTwh)} and was a net importer for ${hrs(first.impHours)}; in ${last.year} it imported ${twh(last.impTwh)} gross, was a net importer for ${hrs(last.impHours)}, and ${pc(last.fosImportingShare)} of its fossil power was burnt while importing. The country that used to export its coal now burns coal and imports at the same time. The figures here are the net flow in each quarter hour; SMARD, counting each direction separately, puts 2025 at 76.2 TWh in and 54.3 TWh out, 21.9 TWh net (${src(SOURCES.smard, 'SMARD')}). Fossil has still halved, from ${twh(first.fosTwh)} to ${twh(last.fosTwh)}: hard coal from ${twh(first.coalTwh)} to ${twh(last.coalTwh)}, lignite from ${twh(first.ligTwh)} to ${twh(last.ligTwh)}, while gas went from ${twh(first.gasTwh)} to ${twh(last.gasTwh)}.`;
  $('chart-h-2').textContent = `Who covers the tightest ${TOP_HOURS} hours`;
  $('chart-hint-2').textContent = `Average supply in the ${TOP_HOURS} hours of each year with the most demand left after wind and solar, in GW.`;
  barChart($('story-chart-2'), {
    cats: pick.map(String),
    stacks,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${pick[ci]}, tightest ${TOP_HOURS} hours</strong><div>Demand: <b>${gw(row(pick[ci]).top.demand)}</b></div>${[...stacks].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${gw(s.values[ci])}</b></div>`).join('')}`,
  });
  $('story-legend-2').innerHTML = legend([...stacks].reverse().map((s) => [s.name, s.color]));

  // Chapter 3: the economics, and fossil against trade.
  $('take-3').textContent = `A megawatt hour of lignite carries roughly ${eur(LIGNITE_CARBON[0])} to ${eur(LIGNITE_CARBON[1])} of carbon at 2025's price, about what a gas plant pays for fuel and carbon together. Neither is covered at noon, when the price went negative for 573 hours in 2025.`;
  $('body-3').innerHTML = `Lignite's fuel comes out of the operator's own mine, so there is no fuel market to set its price; the carbon is most of what it costs to run. At 0.41 tonnes of CO2 per megawatt hour of fuel energy and a plant efficiency of 35% for the older units to 42% for the newest (${src(SOURCES.agora, 'Öko-Institut for Agora')}), each megawatt hour of lignite power carries 1.0 to 1.2 tonnes, which at 2025's average allowance price of €${CARBON_2025} a tonne (${src(SOURCES.rte, 'RTE')}) is ${eur(LIGNITE_CARBON[0])} to ${eur(LIGNITE_CARBON[1])}, our estimate. A combined-cycle gas plant at 55% efficiency, with gas at €${GAS_2025} a megawatt hour, needs roughly ${eur(CCGT_COST)} for fuel and carbon, also our estimate. The German day-ahead price averaged €89.32 in 2025, and was below zero for 573 hours, up from 457 in 2024 (${src(SOURCES.smard, 'SMARD')}). So on the evening price both fuels earn their keep, and gas, with its cheaper start and no mine to feed, is the one that follows the price up and down: ${gw(last.gasHour[13])} at ${hh(13)} and ${gw(last.gasHour[19])} at ${hh(19)} in ${last.year}. At a negative noon, lignite loses money on every megawatt hour and runs anyway, for the reasons in chapter 1. The newer solar is being made to stop instead: since the Solarspitzengesetz of 2025, new plants get no feed-in payment in negative-price hours and those without a smart meter are capped at 60% of their peak (${src(SOURCES.solarspitzen, 'Rödl')}). And some fossil is paid outside the market altogether. Congestion management cost €3.07 billion in 2025, €1.18 billion of it conventional redispatch and €1.36 billion for reserve plants kept and run for the grid, with 2.7 TWh of solar curtailed (${src(SOURCES.redispatch, 'Cleanthinking, from the Bundesnetzagentur')}). The chart shows the switch: in ${first.year} ${pc(1 - first.fosImportingShare)} of Germany's fossil power was burnt while it was exporting, in ${last.year} ${pc(1 - last.fosImportingShare)}.`;
  $('chart-h-3').textContent = 'Fossil burnt while exporting and while importing';
  $('chart-hint-3').textContent = 'Lignite, hard coal, gas and oil generation each year, in TWh, split by whether Germany was a net exporter or a net importer in that quarter hour. The last bar is the latest 365 days.';
  const ch3 = [
    { name: 'While importing', color: css('--f-imports'), values: rows.map((r) => r.fosTwh * r.fosImportingShare) },
    { name: 'While exporting', color: css('--fossil'), values: rows.map((r) => r.fosTwh * (1 - r.fosImportingShare)) },
  ];
  barChart($('story-chart-3'), {
    cats,
    stacks: ch3,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => rows[ci].year === 2023,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Fossil: <b>${twh(rows[ci].fosTwh)}</b></div>${[...ch3].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}<div>Hours as a net importer: <b>${n0(rows[ci].impHours)}</b></div>`,
  });
  $('story-legend-3').innerHTML = `${legend([...ch3].reverse().map((sr) => [sr.name, sr.color]))}<span>Outlined: 2023, the year the last reactors closed</span>`;

  // Chapter 4: battery sizing.
  $('take-4').textContent = `${bat(0).gw} GW and ${bat(0).gwh} GWh of batteries would have covered fossil above the floor on ${bat(0).days} days of ${last.year}; ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}. The rest is winter, with ${twh(winterAbove)} to cover from November to February.`;
  $('body-4').innerHTML = `Take ${FOSSIL_FLOOR} GW as the floor, roughly the least fossil Germany ran in ${last.year} (${gw(last.fosMin)}), and ask what would have covered the rest: ${twh(totalAbove)} in ${last.year}. The lightest day needed ${n0(best.gwh)} GWh, the median day ${n0(median.gwh)} GWh with a peak of ${gw(median.peak)}, and the worst ${n0(worst.gwh)} GWh and ${gw(worst.peak)}. Against those days, ${last.batteries.map((b, i) => (i ? `${i === last.batteries.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh ${b.days}` : `${b.gw} GW and ${b.gwh} GWh of batteries would have covered ${b.days} days`)).join(', ')}. Germany had about 18.5 GW and 31.5 GWh of batteries connected by mid-2026, across 2.6 million systems, with 2.5 GW added in the first half of the year and the new systems averaging 2.3 hours (${src(SOURCES.batteries, 'IWR, from the Marktstammdatenregister')})${Number.isFinite(batGwh) ? `; Energy-Charts puts the fleet at ${batCap.toFixed(1)} GW and ${batGwh.toFixed(1)} GWh for ${capYear}` : ''}. So the first fleet on the chart is about the size of today's, if all of it were run against the grid. The sizing assumes the batteries could charge, and in summer they can: fossil above the floor came to ${twh(summerAbove)} from April to September against ${twh(winterAbove)} from November to February, and the ${last.year} days a 40 GWh fleet covers had ${n0(last.fosDays.slice(0, bat(0).days).reduce((a, x) => a + x.solar, 0) / Math.max(1, bat(0).days))} GWh of solar each on average. Batteries can take the noon lignite's place in the evening ramp and lengthen the spells under 5 GW and 10 GW. A calm week in ${new Date(Date.UTC(2001, worst.month - 1, 15)).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}, when fossil ran at ${gw(worst.peak)}, is a different problem, and nothing in the fleet sizes above touches it.`;
  $('chart-h-4').textContent = `Each day of ${last.year}, by the fossil a battery would have had to replace`;
  $('chart-hint-4').textContent = `Each day's fossil above ${FOSSIL_FLOOR} GW, in GWh, sorted from smallest to largest. The lines mark what ${BATTERIES.map((b) => b[1]).join(', ')} GWh of batteries could supply; days below a line are covered, if the batteries could charge and were big enough for the day's peak.`;
  const dayX = (k) => k * 864e5;
  const sorted = [{ name: 'Fossil above the floor', color: css('--fossil'), points: last.fosDays.map((x, k) => [dayX(k), x.gwh]), width: 2.5 }];
  lineChart($('story-chart-4'), {
    series: sorted,
    yMin: 0,
    yFormat: (v) => `${n0(v)} GWh`,
    yTickFormat: (v) => n0(v),
    xTicks: [0, 60, 120, 180, 240, 300, 360].filter((k) => k < last.fosDays.length).map((k) => ({ t: dayX(k), label: `${k}` })),
    refLines: last.batteries.map((b) => ({ value: b.gwh, color: css('--ink-3') })),
    tooltip: (t) => {
      const k = Math.round(t / 864e5);
      const x = last.fosDays[k];
      return x ? `<strong>Day ${k + 1} of ${last.fosDays.length}</strong><div>Fossil above ${FOSSIL_FLOOR} GW: <b>${n0(x.gwh)} GWh</b></div><div>Peak fossil: <b>${gw(x.peak)}</b></div><div>Solar that day: <b>${n0(x.solar)} GWh</b></div><div>Month: <b>${monthNames[x.month - 1]}</b></div>` : '';
    },
  });
  $('story-legend-4').innerHTML = `${legend(sorted.map((sr) => [sr.name, sr.color]))}<span>Lines: ${last.batteries.map((b) => `${b.gwh} GWh`).join(', ')}</span>`;

  // Chapter 5: what's coming.
  $('take-5').textContent = `Lignite closes on dates in law: 2.5 GW in 2028, about 2 GW in 2029, 3 GW in March 2030, the last 3 GW by 2038. The evening fossil is being handed to new gas plants, not ended.`;
  $('body-5').innerHTML = `The coal exit law (KVBG) fixes every lignite unit's closing date (${src(SOURCES.kvbg, 'Anlage 2 KVBG')}) and leaves about 17 GW of coal in 2030 and none by the end of 2038, with reviews in 2026, 2029 and 2032 on whether the end can be 2035 (${src(SOURCES.kvbgFacts, 'Clean Energy Wire')}). The Rhineland goes first, under the October 2022 agreement between the federal government, North Rhine-Westphalia and RWE to finish there by 2030, which also kept Neurath D and E running fifteen months longer through the gas crisis (${src(SOURCES.nrw2030, 'Clean Energy Wire')}); Lusatia does not, its premier citing the law and the €1.75 billion LEAG is paid against a 2038 end, and the previous government said in 2024 it would pass no law to change the date (${src(SOURCES.noLaw, 'Clean Energy Wire')}). The 2025 coalition agreement keeps 2038 and makes the timetable depend on new plants being built (${src(SOURCES.coalition, 'Clean Energy Wire')}). Those plants are gas: the deal with the EU Commission in January 2026 covers 12 GW of new controllable capacity, hydrogen-capable and to be decarbonised by 2045, with a capacity market from 2032 (${src(SOURCES.kws, 'Solarserver')}), and the cabinet approved the auction law in May 2026, with two auctions of 4.5 GW in September and December and the plants due by November 2031 (${src(SOURCES.stromvkg, 'S&P Global')}). So the noon lignite ends on dates already written down, and the evening fossil changes fuel. Hours with fossil under 10 GW went from ${hrs(first.fosLow10)} in ${first.year} to ${hrs(last.fosLow10)} in ${last.year}; under 5 GW from ${hrs(first.fosLow5)} to ${hrs(last.fosLow5)}. The longest spell under 10 GW is ${fossil10Spell ? `${hrs(spellH(fossil10Spell))} from ${fmtDate(at(fossil10Spell.start))}` : 'not yet set'}${fossil5Spell ? `, under 5 GW ${hrs(spellH(fossil5Spell))} from ${fmtDate(at(fossil5Spell.start))}` : ''}${lignite3Spell ? `, and lignite under 3 GW ${hrs(spellH(lignite3Spell))} from ${fmtDate(at(lignite3Spell.start))}` : ''}. Those are the counts to watch.`;
  $('chart-h-5').textContent = 'Hours a year with fossil under 10 GW and under 5 GW';
  $('chart-hint-5').textContent = 'Hours each year with lignite, hard coal, gas and oil together under 10 GW, and the part of those under 5 GW. The lowest quarter hour is in the tooltip. The last bar is the latest 365 days.';
  const ch5 = [
    { name: 'Under 5 GW', color: css('--lowcarbon'), values: rows.map((r) => r.fosLow5) },
    { name: '5 to 10 GW', color: css('--f-hydro'), values: rows.map((r) => r.fosLow10 - r.fosLow5) },
  ];
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => rows[ci].year === 'past365',
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under 10 GW: <b>${n0(rows[ci].fosLow10)}</b></div><div>Hours under 5 GW: <b>${n0(rows[ci].fosLow5)}</b></div><div>Lowest fossil: <b>${gw(rows[ci].fosMin)}</b></div><div>Lignite under 3 GW: <b>${hrs(rows[ci].ligLow3)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend([...ch5].reverse().map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--f-lignite)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
