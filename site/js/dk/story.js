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

  // The latest 14 local calendar months (the last one usually part done), by fuel.
  const recentMonths = [];
  const stepMs = step * 60000;
  for (let i = Math.max(0, end - 430 * (1440 / step)); i < end; i++) {
    const f = fossil[i];
    if (Number.isNaN(f)) continue;
    const local = new Date(data.startMs + i * stepMs + tzOffsetMs(data.startMs + i * stepMs, dk.timeZone));
    const key = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
    let m = recentMonths.at(-1);
    if (m?.key !== key) recentMonths.push((m = { key, year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, coal: 0, gas: 0, oil: 0, hours: 0, coalOn: 0, priceSum: 0, priceN: 0 }));
    m.coal += ((c.coal[i] || 0) * slotH) / 1e6;
    m.gas += ((c.gas[i] || 0) * slotH) / 1e6;
    m.oil += ((c.oil[i] || 0) * slotH) / 1e6;
    m.hours += slotH;
    if (coal[i] >= COAL_OFF) m.coalOn += slotH;
    if (!Number.isNaN(price[i])) { m.priceSum += price[i]; m.priceN++; }
  }
  for (const m of recentMonths) m.price = mean(m.priceSum, m.priceN);

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: dk.timeZone };
  return {
    rows,
    recentMonths: recentMonths.slice(-14),
    fossilLowSpell: spellOf(summarise(fossil, FOSSIL_LOW, 'below', opts)),
    fossil100Spell: spellOf(summarise(fossil, 0.1, 'below', opts)),
    fossil50Spell: spellOf(summarise(fossil, 0.05, 'below', opts)),
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
const twh = (v) => `${v.toFixed(2)} TWh`;
const twh1 = (v) => `${v.toFixed(1)} TWh`;
const eur = (v) => `€${v.toFixed(2)}`;
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (key, text) => `<a href="${SOURCES[key]}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const bandName = (bands, k, unit) => {
  if (k === bands.length - 1) return `${bands[k]}+ ${unit}`;
  if (!Number.isFinite(bands[k])) return `below ${bands[k + 1]} ${unit}`;
  return `${bands[k]}–${bands[k + 1]} ${unit}`;
};

export const SOURCES = {
  dataset: 'https://www.energidataservice.dk/tso-electricity/GenerationProdTypeExchange',
  esbjerg: 'https://bioenergyinternational.com/orsted-shuts-down-its-last-coal-fired-chp-plant/',
  nordjylland: 'https://en.wikipedia.org/wiki/Nordjylland_Power_Station',
  iea: 'https://www.iea.org/policies/18110',
  dea: 'https://c2e2.unepccc.org/wp-content/uploads/sites/3/2023/02/regulation-and-planning-of-district-heating-in-denmark.pdf',
  aleasoft: 'https://aleasoft.com/european-market-prices-2025-second-lowest-since-2021-pv-records',
  boilersDh: 'https://www.doi.dk/en/solenergi/artikel/fjernvarmen-sluger-el-som-aldrig-foer',
  reserve2018: 'https://energinet.dk/media/u5lltn03/effektbalance-i-dk2.pdf',
  marketPlan: 'https://ens.dk/media/7817/download',
  biomassTax: 'https://clean-energy-islands.ec.europa.eu/countries/denmark/legal/res-heating-and-cooling/tax-regulation-mechanism-absence-energy-tax-and-co2',
  concito: 'https://concito.dk/files/media/document/Q%26A%20Biomass_0.pdf',
  viking: 'https://www.nationalgrid.com/national-grid-announces-commercial-operations-viking-link-worlds-longest-land-and-subsea',
  imports2025: 'https://www.doi.dk/en/vindkraft/artikel/danmark-satte-rekord-i-elimport-i-2025',
  batteries: 'https://now.solar/2026/10/15/modi-energy-launches-zero-upfront-solar-plus-storage-offer-in-denmark-pv-magazine-global/',
  eeBess: 'https://cleanenergypipeline.com/news/european-energy-commissions-danish-bess-pair/',
  heatPump: 'https://dbdh.org/aalborg-forsyning-puts-denmarks-largest-seawater-heat-pump-out-to-tender/',
  heatPumpAward: 'https://www.stotles.com/explore/notices/c81e9f05-3a25-4aa4-b13d-d350b58ff157/sea-water-heat-pump-system',
  norbis: 'https://stotles.com/explore/notices/4a69eeda-1be1-4c80-b4a6-34b8a3a77234/150-mw-electrical-boilers-at-norbis-park',
  heatStore: 'https://ing.dk/artikel/gigantisk-varmelager-i-aalborg-skal-udnytte-svingende-elpriser',
  hofor: 'https://stateofgreen.com/en/solutions/decarbonising-district-heating-using-large-heat-pumps/',
  thor: 'https://www.offshore-mag.com/renewable-energy/news/55353164/rwe-rwe-gets-go-ahead-to-start-up-denmarks-largest-offshore-wind-farm',
  tenders: 'https://offshorewind.biz/2026/08/04/vattenfall-wins-danish-tender-for-two-new-offshore-wind-sites',
  bornholm: 'https://www.rigzone.com/news/denmark_germany_ink_agreement_on_bornholm_energy_island-29-jan-2026-182881-article/',
};

// Rough fuel and carbon cost of a gas engine's electricity in 2025: gas at
// €36.33/MWh and carbon at €76.85/t (AleaSoft's 2025 averages), 40%
// electrical efficiency and 0.202 t of CO2 per MWh of gas. An estimate, not a market figure.
export const GAS_ENGINE_COST = 36.33 / 0.4 + (0.202 * 76.85) / 0.4;

// What is coming, dated and sourced, with the record each should move.
// [when, what, source key, the record to watch]
export const COMING = [
  ['End of 2027', 'Thor, about 1 GW of offshore wind off west Jutland, is to be complete.', 'thor', 'Wind above 7 GW and 8 GW; hours with wind over Danish consumption.'],
  ['2028', 'Nordjyllandsværket stops burning coal and Denmark\'s coal power ban takes effect. Aalborg replaces the heat with a seawater heat pump, 150 MW of electric boilers and a 241,000 m³ heat store.', 'iea', 'Coal under 10 MW becomes a spell that never ends; a whole calendar year at the coal 0 rung; hours with fossil under 100 MW.'],
  ['October 2028', 'The tender for Nordsøen Syd, 1 GW of offshore wind, closes.', 'tenders', 'Nothing until it is built; the tender date is the marker.'],
  ['By 2032', 'Nordsøen Midt (at least 1 GW) and Hesselø (at least 0.8 GW) fully operational under 20-year contracts for difference.', 'tenders', 'Wind above 8 GW; fewer hours with wind under 1 GW; net imports above 2 GW in winter.'],
  ['2033', 'HOFOR\'s up to 300 MW of large heat pumps in Copenhagen.', 'hofor', 'All burning (fossil, waste, biomass) under 1 GW and 0.5 GW. This moves biomass more than fossil.'],
  ['Mid-2030s', 'Bornholm Energy Island, 3 GW of offshore wind landed in Denmark and Germany.', 'bornholm', 'Net imports above 3 GW and 4 GW in calm hours; peak wind.'],
  ['Undated', 'A capacity mechanism. The Danish Energy Agency is analysing one, and expects adjustable capacity to halve to about 2,500 MW by the mid-2030s.', 'marketPlan', 'Fossil, high output above 0.5 GW and 1 GW, which should go to zero hours unless plants are paid to stay.'],
  ['Undated', 'Gas combined heat and power. No closure date; the engines run on the power price.', 'dea', 'Gas under 50 MW; the longest spell with fossil under 100 MW crossing a winter.'],
];

export function renderStory(data, end, figs) {
  const { rows, fossilLowSpell, fossil100Spell, fossil50Spell, coalOffSpell, recentMonths } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const row = (y) => rows.find((r) => r.year === y);
  const exp2022 = row(2022) ?? first;
  const bat = (k) => last.batteries[k];
  const calm = last.calm;
  const netImp = last.impTwh - last.expTwh;
  const grossImp = Object.values(last.impBy).reduce((a, b) => a + b, 0);
  // May to September, as an average in GW.
  const summerHours = [4, 5, 6, 7, 8].reduce((a, m) => a + new Date(Date.UTC(2001, m + 1, 0)).getUTCDate() * 24, 0);
  const summerGw = (last.fosMonth.slice(4, 9).reduce((a, v) => a + v, 0) * 1000) / summerHours;
  const peakGw = Math.max(...last.fosHour);
  const peakHours = last.fosHour.map((v, h) => [v, h]).filter(([v]) => v === peakGw).map(([, h]) => hh(h));
  const nightGw = Math.min(...last.fosHour);
  const sumMin = Math.min(...last.fosHourSummer);
  const sumMax = Math.max(...last.fosHourSummer);
  const median = last.fosDays[Math.floor(last.fosDays.length / 2)];
  const worst = last.fosDays.at(-1);
  const wasteMw = (last.twh.waste * 1e6) / last.hours;
  const latestWind = latest.windFos.filter(Number.isFinite);
  const pb = last.priceFos;
  const ph = last.priceHours;
  const r2 = (v) => Math.round(v * 100) / 100;
  const priceFold = r2(pb[0]) > 0 ? `${Math.round(r2(pb.at(-1)) / r2(pb[0]))}-fold` : 'many times over';
  const range = (vs) => {
    const lo = twh(Math.min(...vs));
    const hi = twh(Math.max(...vs));
    return lo === hi ? `about ${lo}` : `${lo} to ${hi}`;
  };
  const spellFrom = (sp) => fmtDate(at(sp.start));

  $('lede').textContent = `Denmark burnt ${twh(last.twh.fossil)} of coal, gas and oil for electricity in ${last.year}, ${last.fossilPct.toFixed(1)}% of what it generated, and ${pc(last.winterShare)} of it from November to March. The plants left are heating plants.`;
  $('answer-lead').textContent = 'Denmark\'s remaining fossil power is not there to cover calm weather. It is combined heat and power plant that feeds district heating, and it runs on winter evenings when the heat is needed and the power price covers the fuel. When the wind drops, Denmark imports from Norway and Sweden instead. Coal ends in 2028 with the last coal plant in Aalborg; the gas engines have no date, so the records to watch are the longest spell with fossil under 100 MW and the first year with no coal at all.';
  $('answer-points').innerHTML = [
    `<b>It runs for heat.</b> ${pc(last.winterShare)} of ${last.year}'s fossil power came from November to March, and from May to September the fossil fleet averaged about ${mw(summerGw)}. Output peaks at ${peakHours.join(' and ')}, the district heating and evening demand peak, at ${gw(peakGw)} against ${gw(nightGw)} in the small hours. ${link(1, 'Chapters 1')} and ${link(2, '2')}`,
    `<b>It does not follow the wind, it follows the price.</b> In ${last.year} fossil averaged ${gw(last.windFos[0])} in hours with under 1 GW of wind and ${gw(last.windFos.at(-1))} with over ${WIND_BANDS.at(-1)} GW, and in the latest 365 days the line is flat at ${gw(Math.min(...latestWind))} to ${gw(Math.max(...latestWind))} whatever the wind. Against price it rises ${priceFold}, from ${gw(pb[0])} when the price was below zero to ${gw(pb.at(-1))} above €${PRICE_BANDS.at(-1)} a megawatt hour. ${link(3, 'Chapter 3')}`,
    `<b>The neighbours fill the calm hours.</b> In the ${n0(calm.hours)} hours of ${last.year} with under 1 GW of wind, Denmark imported ${gw(calm.imports)} on average and burnt ${gw(calm.biomass)} of biomass and ${gw(calm.fossil)} of fossil fuel. Net imports were a record ${twh1(netImp)}. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  const facts = [
    ['--f-coal', `Coal in ${last.year}`, twh(last.twh.coal), `against ${twh(first.twh.coal)} in ${first.year}; coal ran in ${hrs(last.coalOn)} of ${last.year}`],
    ['--fossil', `Fossil power in summer ${last.year}`, `about ${mw(summerGw)}`, `on average from May to September; ${mw(sumMin)} to ${mw(sumMax)} across the day from June to August`],
    ['--f-imports', `Average net imports in calm hours, ${last.year}`, gw(calm.imports), `in the ${n0(calm.hours)} hours with under 1 GW of wind; fossil made ${gw(calm.fossil)}`],
    ['--fossil', `Longest spell with fossil under ${mw(FOSSIL_LOW)}`, fossilLowSpell ? hrs(spellH(fossilLowSpell)) : 'None yet', fossilLowSpell ? `from ${spellFrom(fossilLowSpell)}` : ''],
    ['--f-coal', 'Longest spell with no coal', coalOffSpell ? hrs(spellH(coalOffSpell)) : 'None yet', coalOffSpell ? `from ${spellFrom(coalOffSpell)}, about ${Math.round(spellH(coalOffSpell) / 24)} days` : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${pc(last.winterShare)}</div><div class="sub">Share of the coal, gas and oil Denmark burnt for power in ${last.year} that was burnt from November to March. In ${first.year} it was ${pc(first.winterShare)}.</div></div>
    <ul class="fact-list">${facts.map(([col, l, v, w]) => `<li><span class="swatch" style="background:var(${col})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: what fossil power is left, when in the year and the day it runs, why it follows the price and not the wind, who covers the calm hours, and the hours with almost none, with what is coming and the record each item should move.';

  const chapters = [
    'The fossil power that is left',
    'It runs in the heating season',
    'It follows the price, not the wind',
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
  const finitePoints = (sr) => { sr.markers = sr.points.filter((p) => Number.isFinite(p[1])); };

  // Chapter 1: fossil by fuel each year, with waste.
  $('take-1').textContent = `Coal ${twh(last.twh.coal)}, gas ${twh(last.twh.gas)} and oil ${twh(last.twh.oil)} in ${last.year}, from ${twh(first.twh.coal)}, ${twh(first.twh.gas)} and ${twh(first.twh.oil)} in ${first.year}. Biomass made ${twh(last.twh.biomass)} and waste ${twh(last.twh.waste)}, and neither counts as fossil here.`;
  const wasteYears = full.map((r) => r.twh.waste);
  $('body-1').innerHTML = `<p>Denmark's fossil power in ${last.year} was ${twh(last.twh.fossil)}, ${last.fossilPct.toFixed(1)}% of generation, against ${twh(first.twh.fossil)} and ${first.fossilPct.toFixed(1)}% in ${first.year}. Nearly all of the fall is coal: ${twh(first.twh.coal)} in ${first.year}, ${twh(last.twh.coal)} in ${last.year}. Ørsted shut Esbjerg, its last coal-fired CHP plant, on 31 August 2024, together with Studstrup unit 4 and Kyndby 21; Studstrup 3 kept coal in reserve only until its pellet silo was ready at the end of 2024 (${src('esbjerg', 'Bioenergy International')}). That leaves one coal plant, Nordjyllandsværket in Aalborg, 385 MW electric and 422 MJ/s of heat, owned by the municipal utility, which has said coal stops in 2028 (${src('nordjylland', 'Wikipedia')}; ${src('iea', 'IEA')}). Coal ran in ${hrs(last.coalOn)} of ${last.year}${coalOffSpell ? `, and from ${spellFrom(coalOffSpell)} Denmark went ${hrs(spellH(coalOffSpell))}, about ${Math.round(spellH(coalOffSpell) / 24)} days, without coal` : ''}.</p>
    <p>Gas is now the larger fuel, ${twh(last.twh.gas)}, and it comes from a spread of small CHP engines and boilers at district heating plants rather than one big station. Oil is ${twh(last.twh.oil)}, the peaking and backup units.</p>
    <p>Two things the fossil count leaves out matter for what "fossil-free" would mean. Biomass and biogas made ${twh(last.twh.biomass)} in ${last.year}, ${(last.twh.biomass / last.twh.fossil).toFixed(1)} times the fossil total, from the big city CHP plants that were converted from coal to wood pellets and chips. Waste incineration made ${twh(last.twh.waste)}, between ${twh(Math.min(...wasteYears))} and ${twh(Math.max(...wasteYears))} every year since ${first.year}, and part of what it burns is plastic. Energinet classes each plant by its main fuel, so a pellet plant that also burns some coal counts as biomass (${src('dataset', 'Energi Data Service')}). The "All burning" measure in the Records card, fossil plus waste plus biomass, is the one to use if the question is when Denmark stops burning things for power at all.</p>`;
  $('chart-h-1').textContent = 'Fossil and waste generation each year';
  $('chart-hint-1').textContent = 'TWh a year by each plant\'s main fuel. Biomass is in the tooltip. The last bar is the latest 365 days.';
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

  // Chapter 2: by month and by hour.
  const lm = last.fosMonth;
  const fm = first.fosMonth;
  $('take-2').textContent = `${pc(last.winterShare)} of ${last.year}'s fossil power came from November to March. From May to September the fleet averaged about ${mw(summerGw)}, and on a winter day it peaks at ${peakHours.join(' and ')}.`;
  // The latest months by fuel, when the current heating season has started already.
  const [m1, m2] = recentMonths.slice(-2);
  const prevOf = (m) => recentMonths.find((x) => x.year === m.year - 1 && x.month === m.month);
  const p1 = m1 && prevOf(m1);
  const p2 = m2 && prevOf(m2);
  const recentLine = m1 && m2 && p1 && p2 && m2.month >= 8 && m2.month <= 10
    ? `<p>The heating season of ${m2.year} started early. In ${MONTH_NAMES[m1.month - 1]} and ${MONTH_NAMES[m2.month - 1]} ${m2.year} so far, coal made ${twh(m1.coal + m2.coal)} and gas ${twh(m1.gas + m2.gas)}; coal ran in ${n0(m1.coalOn)} of ${MONTH_NAMES[m1.month - 1]}'s ${n0(m1.hours)} hours and ${m2.coalOn === m2.hours ? 'all' : n0(m2.coalOn) + ' of the'} ${n0(m2.hours)} of ${MONTH_NAMES[m2.month - 1]} so far, against ${n0(p1.coalOn)} and ${n0(p2.coalOn)} hours a year earlier, while the day-ahead price averaged ${eur(m1.price)} and ${eur(m2.price)} a megawatt hour. Nordjyllandsværket is the only coal plant left, so this is, by inference, Aalborg starting its coal unit early in a high-price autumn.</p>`
    : '';
  $('body-2').innerHTML = `<p>Most Danish thermal plants are combined heat and power plants, and their customers are the district heating networks: about 69% of district heat came from CHP in 2014 (${src('dea', 'Danish Energy Agency')}). So the fossil fleet keeps the calendar of a heating system. In ${last.year} it made ${twh(lm[0])} in January, ${twh(lm[1])} in February and ${twh(lm[2])} in March, then ${range(lm.slice(4, 8))} a month from May to August, ${twh(lm[10])} in November and ${twh(lm[11])} in December. In ${first.year}, when coal still ran all year, the summer months were ${twh(Math.min(...fm.slice(4, 8)))} to ${twh(Math.max(...fm.slice(4, 8)))}. The winter share has gone from ${pc(first.winterShare)} in ${first.year} to ${pc(last.winterShare)} in ${last.year}, because the plants that ran all year have closed and the ones left only have a job when there is heat to sell.</p>
    <p>The day has the same shape. In ${last.year} fossil output averaged ${gw(nightGw)} in the small hours, rose through the morning to ${gw(last.fosHour[8])} at ${hh(8)}, dipped at midday and peaked at ${gw(peakGw)} at ${peakHours.join(' and ')}. From June to August it stayed between ${gw(sumMin)} and ${gw(sumMax)} all day. The evening peak is when heat demand, power demand and the power price all peak, so the hour-of-day curve alone cannot separate "running for heat" from "running for the price". Chapter 3 uses the wind and the price to do that.</p>
    <p>Fossil output never fell to zero in ${last.year}: the lowest hour was ${mw(last.fosMin)} and the highest ${gw(last.fosMax)}, against ${gw(first.fosMax)} in ${first.year}.</p>${recentLine}`;
  $('chart-h-2').textContent = 'Fossil generation by month';
  $('chart-hint-2').textContent = 'TWh in each calendar month, coal, gas and oil together. The heating season runs from November to March.';
  const monthX = (m) => Date.UTC(2001, m, 15);
  const monthLines = pick.map((y, k) => ({ name: title(y), color: css(yearColors[k]), points: row(y).fosMonth.map((v, m) => [monthX(m), v]), width: y === 'past365' ? 3 : 2 }));
  monthLines.forEach(finitePoints);
  lineChart($('story-chart-2'), {
    series: monthLines,
    yMin: 0,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    xTicks: MONTHS.map((m, k) => ({ t: monthX(k), label: m })),
    tooltip: (t, vals) => `<strong>${MONTHS[new Date(t).getUTCMonth()]}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? twh(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-2').innerHTML = legend(monthLines.map((sr) => [sr.name, sr.color]));

  // Chapter 3: against the wind and against the price.
  $('take-3').textContent = `In ${last.year} fossil averaged ${gw(last.windFos[0])} when wind was under 1 GW and ${gw(last.windFos.at(-1))} when it was over ${WIND_BANDS.at(-1)} GW. Against price it went from ${gw(pb[0])} below zero to ${gw(pb.at(-1))} above €${PRICE_BANDS.at(-1)} a megawatt hour. The plants are paid for heat, and they generate when the power is worth it.`;
  $('body-3').innerHTML = `<p>If fossil plants were covering for the wind, output would climb as the wind fell. In ${first.year} it did: ${gw(first.windFos[0])} in hours with under 1 GW of wind, ${gw(first.windFos[3])} with 3 to 4 GW. In ${last.year} the slope is almost gone, ${gw(last.windFos[0])} in calm hours and ${gw(last.windFos.at(-1))} in the windiest, and in the latest 365 days it is flat at ${gw(Math.min(...latestWind))} to ${gw(Math.max(...latestWind))} across every band. Only ${n0(last.fosWindy * 1000)} GWh of ${last.year}'s fossil power was burnt in the ${hrs(last.windyHours)} when wind alone exceeded Danish consumption, and ${pc(last.fosExportingShare)} of it was burnt while Denmark was a net exporter, down from ${pc(exp2022.fosExportingShare)} in ${exp2022.year}.</p>
    <p>Price does what wind does not. In ${last.year} fossil output averaged ${gw(pb[0])} in the ${hrs(ph[0])} with a negative price, ${gw(pb[2])} between €25 and €50, ${gw(pb[4])} between €100 and €200 and ${gw(pb[5])} in the ${hrs(ph[5])} above €200 a megawatt hour. That is how a Danish CHP plant is run. District heat is sold at cost, so the plant's owner earns nothing from heat beyond its costs; the margin comes from the power market. Operators generate when the power price is high and, when it is low, make the heat another way or draw on heat storage, which the Danish Energy Agency says typically holds about 12 hours of a plant's full-load heat (${src('dea', 'Danish Energy Agency')}). The production subsidy for most decentralised CHP ended at the end of 2018 (same source), so a gas engine now runs on the spread between the power price and its fuel and carbon.</p>
    <p>That spread is thin at the Danish average price. Day-ahead power in DK1 and DK2 averaged ${eur(last.price)} a megawatt hour in ${last.year}, with gas at €36.33 a megawatt hour and carbon at €76.85 a tonne (${src('aleasoft', 'AleaSoft')}). At 40% electrical efficiency a gas engine's fuel and carbon alone come to roughly €${Math.round(GAS_ENGINE_COST)} a megawatt hour of electricity, our estimate, which is why it runs only in the €100-plus hours and only when it can also sell the heat. The same price signal makes electricity the heat fuel in the cheap hours: district heating used a record 2.35 TWh of electricity in electric boilers and large heat pumps (${src('boilersDh', 'Dansk Fjernvarme via DOI')}), and that is where fossil CHP's old job went in the calm, cheap hours.</p>
    <p>Which hours are "needed" and which are "for the price" cannot be separated from the generation data alone, because winter evenings are both the heating peak and the price peak. The evidence points to price: the fleet is flat against wind, ${priceFold} against price, and in calm hours the gap is filled by imports (${link(4, 'chapter 4')}) rather than by the fossil plants. We read it as a fleet that runs for heat revenue and power price, not for adequacy. Energinet in 2018 estimated that eastern Denmark would need a strategic reserve of about 150 MW in 2025 (${src('reserve2018', 'Energinet')}), but the Danish Energy Agency's September 2025 market plan states that Denmark has implemented neither a strategic reserve nor a capacity market, so no fossil plant is currently paid to stand by (${src('marketPlan', 'Danish Energy Agency, 2025')}).</p>
    <p>Biomass CHP sits in the same market with a different cost line: wood pellets and chips for heat are exempt from both the energy tax and the CO2 tax that fossil fuels pay (${src('biomassTax', 'EU Clean Energy for Islands')}), and 57% of the wood Denmark burnt in 2019 was imported (${src('concito', 'CONCITO')}). That is why the big city plants converted rather than closed, and why they, not coal or gas, now make ${gw(calm.biomass)} on average in a calm hour.</p>`;
  $('chart-h-3').textContent = 'Fossil output by wind output';
  $('chart-hint-3').textContent = 'Average fossil output in GW in the hours of each wind band. Hours in each band are in the tooltip. A fleet covering for the wind would slope down to the right; 2015 does, the latest years barely.';
  const bandX = (k) => k * 864e5;
  const windLines = pick.map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).windFos.map((v, b) => [bandX(b), v]), width: y === 'past365' ? 3 : 2 }));
  windLines.forEach(finitePoints);
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
  // The second chart: against the day-ahead price, for the years with prices.
  const priceYears = rows.filter((r) => r.priceHours.some((h) => h > 0)).map((r) => r.year);
  const priceShow = [priceYears.find((y) => y !== 'past365'), last.year, 'past365'].filter((y, k, a) => y != null && a.indexOf(y) === k && priceYears.includes(y));
  $('chart-h-3b').textContent = 'Fossil output by day-ahead price';
  $('chart-hint-3b').textContent = 'Average fossil output in GW in the hours of each price band, in euros per MWh, the mean of DK1 and DK2. Hours in each band are in the tooltip.';
  const priceLines = priceShow.map((y, k) => ({ name: title(y), year: y, color: css(['--f-gas', '--f-wind-off', '--f-coal'][k]), points: row(y).priceFos.map((v, b) => [bandX(b), v]), width: y === 'past365' ? 3 : 2 }));
  priceLines.forEach(finitePoints);
  lineChart($('story-chart-3b'), {
    series: priceLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: PRICE_BANDS.map((_, k) => ({ t: bandX(k), label: bandName(PRICE_BANDS, k, '€') })),
    tooltip: (t, vals) => {
      const b = Math.round(t / 864e5);
      return `<strong>Price ${bandName(PRICE_BANDS, b, '€/MWh')}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? mw(v.value) : '—'}</b> over ${hrs(row(v.series.year).priceHours[b])}</div>`).join('')}`;
    },
  });
  $('story-legend-3b').innerHTML = legend(priceLines.map((sr) => [sr.name, sr.color]));

  // Chapter 4: imports by border.
  const fc = first.calm;
  $('take-4').textContent = `In the ${n0(calm.hours)} calm hours of ${last.year} Denmark imported ${gw(calm.imports)} on average against ${gw(calm.fossil)} of fossil. Gross imports across the borders were ${twh(grossImp)}, ${twh(last.impBy.net_se)} of it from Sweden and ${twh(last.impBy.net_no)} from Norway, and net imports a record ${twh1(netImp)}.`;
  $('body-4').innerHTML = `<p>When the wind drops, Denmark buys. In the ${n0(calm.hours)} hours of ${last.year} with less than 1 GW of wind, consumption averaged ${gw(calm.demand)} and net imports ${gw(calm.imports)}; biomass made ${gw(calm.biomass)}, waste ${gw(calm.waste)} and coal, gas and oil together ${gw(calm.fossil)}. In ${first.year}'s calm hours the same roles were ${gw(fc.imports)} of imports, ${gw(fc.biomass)} of biomass and ${gw(fc.fossil)} of fossil. Imports and biomass took the fossil fleet's calm-hour job between them.</p>
    <p>The imports come from the Nordic side and much of it goes on through. In ${last.year} Denmark took ${twh(last.impBy.net_se)} gross from Sweden and ${twh(last.impBy.net_no)} from Norway, and sent ${twh(last.expBy.net_de)} to Germany and ${twh(last.expBy.net_gb)} to Great Britain over Viking Link, the 1.4 GW cable that began commercial operation on 29 December 2023 (${src('viking', 'National Grid')}). Denmark was a net importer in ${hrs(last.impHours)} of ${last.year}, and net imports reached a record ${twh1(netImp)} because consumption grew faster than production (${src('imports2025', 'DOI')}): gross consumption was ${twh(last.twh.demand)} in ${last.year} against ${twh(first.twh.demand)} in ${first.year}, while generation was ${twh(last.twh.gen)}.</p>
    <p>The economics are simple. Norwegian hydro and Swedish hydro and nuclear sell into Denmark below the price at which a Danish gas engine or the Aalborg coal unit would start, and the Nord Pool system price averaged €39.70 a megawatt hour in 2025 (${src('aleasoft', 'AleaSoft')}) against ${eur(last.price)} in the Danish zones in ${last.year}. So in a calm hour the cheapest supply is the cable, and the Danish plants wait for the hours when the whole region is short and the price clears above €100. That is also the adequacy question. The Danish Energy Agency expects adjustable capacity to fall from about 5,000 MW to about 2,500 MW by the mid-2030s as biomass, coal and gas plants close for lack of profit, and the European adequacy assessment puts expected loss of load at 10.6 hours a year in DK1 and 10.3 in DK2 for 2026, rising to 18.8 and 21.0 in 2028; the government is analysing a capacity mechanism (${src('marketPlan', 'Danish Energy Agency, 2025')}). Energinet's 2018 study noted that half of eastern Denmark's shortfall hours coincide with German shortfalls (${src('reserve2018', 'Energinet')}).</p>`;
  $('chart-h-4').textContent = 'Imports by border';
  $('chart-hint-4').textContent = 'TWh a year flowing into Denmark on each border, counting only the hours that border was importing. Exports and the hours Denmark was a net importer are in the tooltip.';
  const borderColors = ['--f-hydro', '--f-nuclear', '--f-lignite', '--f-imports', '--f-wind-off'];
  const ch4 = BORDERS.map(([k, name], j) => ({ name, key: k, color: css(borderColors[j]), values: rows.map((r) => r.impBy[k]) }));
  barChart($('story-chart-4'), {
    cats,
    stacks: ch4,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${[...ch4].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b> in, ${twh(rows[ci].expBy[sr.key])} out</div>`).join('')}<div>Net importer: <b>${hrs(rows[ci].impHours)}</b></div>`,
  });
  $('story-legend-4').innerHTML = legend([...ch4].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 5: the hours with almost no fossil power, and what is coming.
  $('take-5').textContent = `Fossil was under ${mw(FOSSIL_LOW)} in ${hrs(last.fosLow)} of ${last.year} and under 100 MW in ${n0(last.fosU100)}, from ${n0(first.fosLow)} and ${n0(first.fosU100)} hours in ${first.year}. Coal ends in 2028. The gas engines have no date, and ${bat(0).gw} GW of batteries would have covered the fossil above ${mw(FOSSIL_FLOOR)} on ${bat(0).days} days of ${last.year}.`;
  const everMin = Math.min(...rows.map((r) => r.fosMin).filter(Number.isFinite));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const spellLine = (sp, what) => (sp ? `the longest ${what} is ${hrs(spellH(sp))}, from ${spellFrom(sp)}` : `there has been no spell ${what}`);
  $('body-5').innerHTML = `<p>The count that tracks the end of fossil power in Denmark is hours under a low floor. Fossil output was under ${mw(FOSSIL_LOW)} in ${hrs(last.fosLow)} of ${last.year}, ${pc(last.fosLow / last.hours)} of the year, against ${hrs(first.fosLow)} in ${first.year}, and under 100 MW in ${hrs(last.fosU100)} against ${n0(first.fosU100)}. ${spellLine(fossilLowSpell, `under ${mw(FOSSIL_LOW)}`).replace(/^t/, 'T')}; ${spellLine(fossil100Spell, 'under 100 MW')}. Summer is already done. The record to move is the winter.</p>
    <p>What would cover the rest? Take ${mw(FOSSIL_FLOOR)} as a floor and ask what a battery fleet would have had to supply above it. The median day of ${last.year} needed ${median.gwh.toFixed(2)} GWh and the worst ${worst.gwh.toFixed(1)} GWh. ${last.batteries.map((b, i) => (i ? `${i === last.batteries.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh ${b.days}` : `A fleet of ${b.gw} GW and ${b.gwh} GWh would have covered ${b.days} days`)).join(', ')}, if it could charge. Denmark registered 191 MW of new battery capacity in the twelve months to June 2026, 112 MW of it utility scale (${src('batteries', 'pv magazine')}), and European Energy commissioned 38 MW and 152 MWh in July 2026 (${src('eeBess', 'Clean Energy Pipeline')}). The sizing shows the power is small. The catch is that these plants are not there for the power: the heat they make at the same time has to come from somewhere, and that is heat pumps, electric boilers and storage on the heat side, not batteries on the power side.</p>
    <p>That is what Aalborg is building. Nordjyllandsværket stops coal in 2028 at the latest (${src('heatPump', 'Aalborg Forsyning via DBDH')}). In its place: a seawater heat pump of 100 to 125 MW of heat beside the plant, Denmark's largest, to supply a quarter of the network's heat (${src('heatPump', 'DBDH')}; contract to MAN Energy Solutions, ${src('heatPumpAward', 'tender award')}), 150 MW of electric boilers at Norbis Park for peak and backup, part of the plan to "phase out coal and all other fossil fuel consuming units by the end of year 2028" (${src('norbis', 'Nordjyllandsværket tender')}), and Denmark's largest heat store, four new tanks of 54,000 m³ each for 241,000 m³ in all, to shift electric heat into the cheap hours (${src('heatStore', 'Ingeniøren')}). Copenhagen's HOFOR plans up to 300 MW of large heat pumps by 2033 (${src('hofor', 'State of Green')}). Each of these takes heat demand off CHP and puts it onto the power market in the cheap hours, which lengthens the fossil-free spells and raises net imports in the same move.</p>
    <p>The wind side keeps growing. Thor, about 1 GW off the west coast, was authorised to start up in January 2026 and is to be complete by the end of 2027 (${src('thor', 'Offshore Magazine')}). Vattenfall won Nordsøen Midt (at least 1 GW) and Hesselø (at least 0.8 GW) in August 2026 with 20-year contracts for difference at DKK 504 and DKK 542 a megawatt hour, both to be fully operational by 2032, and the 1 GW Nordsøen Syd tender is open until October 2028 (${src('tenders', 'offshoreWIND.biz')}). Bornholm Energy Island, 3 GW landed in Denmark and Germany, had its Danish-German cost-sharing agreement signed in January 2026, with commissioning in the mid-2030s (${src('bornholm', 'Rigzone')}). More wind lowers the price in more hours, which is what keeps CHP off; it does not change the calm winter evening, which is the cable's job and, after 2028, the gas engines' last one.</p>
    <p>Nothing dated closes the gas. The Danish Energy Agency's own expectation is that the remaining biomass, coal and gas plants close because they stop being profitable, not on a timetable, and that is also why it is analysing a capacity mechanism (${src('marketPlan', 'Danish Energy Agency, 2025')}). If one is introduced, it would be the first time a Danish fossil plant is paid to stand by, and the fossil floor would then be set by contract rather than by the heat season.</p>`;
  $('chart-h-5').textContent = `Hours a year with fossil under ${mw(FOSSIL_LOW)}`;
  $('chart-hint-5').textContent = `Hours each year with coal, gas and oil together under ${mw(FOSSIL_LOW)}. The lowest hour is in the tooltip. The last bar is the latest 365 days.`;
  const ch5 = [{ name: `Fossil under ${mw(FOSSIL_LOW)}`, color: css('--lowcarbon'), values: rows.map((r) => r.fosLow) }];
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under ${mw(FOSSIL_LOW)}: <b>${n0(rows[ci].fosLow)}</b></div><div>Under 100 MW: <b>${n0(rows[ci].fosU100)}</b></div><div>Lowest fossil: <b>${mw(rows[ci].fosMin)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--fossil)"></span><span><b>${when}</b> ${what} (${src(source, 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
  $('coming-h').hidden = !COMING.length;

  // The records to watch, with where each stands now.
  const watch = [
    ['--fossil', 'Fossil fuels under 100 MW', `${hrs(last.fosU100)} in ${last.year}; ${spellLine(fossil100Spell, 'spell')}. The one to beat each year.`],
    ['--fossil', 'Fossil fuels under 50 MW, then zero', `${cap(spellLine(fossil50Spell, 'spell under 50 MW'))}. ${everMin > 0 ? `Fossil output has not been zero in any hour since ${first.year}: ` : ''}the lowest hour of ${last.year} was ${mw(last.fosMin)}. The first hour at the 0 rung is the record this page is waiting for.`],
    ['--f-coal', 'Coal under 10 MW', `${coalOffSpell ? `${hrs(spellH(coalOffSpell))} from ${spellFrom(coalOffSpell)}` : 'No spell yet'}. After 2028 this spell should never end.`],
    ['--f-gas', 'Gas under 50 MW', 'The gas engines\' floor; the first long spell here in a winter is the sign the heat side has taken over.'],
    ['--f-other', 'Fossil fuels and waste under 200 MW', `Waste runs at about ${mw(wasteMw / 1000)} all year (${twh(last.twh.waste)} in ${last.year}), so this rung is where what Denmark burns meets the fossil count.`],
    ['--f-biomass', 'All burning under 1 GW', `Fossil plus waste plus biomass. The biomass plants are the real last thermal fleet, ${gw(calm.biomass)} in a calm hour of ${last.year}.`],
    ['--fossil', 'Fossil fuels, high output above 0.5 GW', `${last.year}'s peak was ${gw(last.fosMax)}; a winter with no hour above 0.5 GW is the end of the CHP evening peak.`],
    ['--f-imports', 'Net imports above 2, 3 and 4 GW', `Calm hours averaged ${gw(calm.imports)} in ${last.year}; Bornholm and the 2032 wind farms push this both ways.`],
    ['--f-wind', 'Wind above 7 GW and 8 GW', 'Thor by the end of 2027, then Nordsøen Midt and Hesselø by 2032.'],
  ];
  $('watch').innerHTML = watch.map(([col, what, note]) => `<li><span class="swatch" style="background:var(${col})"></span><span><b>${what}</b> <span class="sub">${note}</span></span></li>`).join('');
}
