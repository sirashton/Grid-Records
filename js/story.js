// The Great Britain story: why Britain still burns gas now that coal has gone.
// Most of it fills the gap when the wind drops; a floor of a few gigawatts
// runs even on the windiest days, while Scottish wind farms are paid to
// switch off. The figures are worked out from the data by storyFigures(),
// which the tests also run; renderStory() draws the page. Answer-first:
// the answer, three supporting points, then five chapters.
import { summarise, slotTime, formatDuration } from './records.js';
import { barChart, lineChart, fmtDate } from './charts.js';
import { stepOf, byYear, metricSeries as coreMetric, generationTotal } from './core/dataset.js';
import { tzOffsetMs } from './core/calendar.js';
import gb from './countries/gb.js';

// Every generation column NESO reports, for the totals.
export const MIX = [
  { key: 'coal', label: 'Coal', columns: ['coal'] },
  { key: 'gas', label: 'Gas', columns: ['gas'] },
  { key: 'other', label: 'Other', columns: ['other'] },
  { key: 'imports', label: 'Imports', columns: ['imports'] },
  { key: 'biomass', label: 'Biomass', columns: ['biomass'] },
  { key: 'nuclear', label: 'Nuclear', columns: ['nuclear'] },
  { key: 'hydro', label: 'Hydro and pumped storage', columns: ['hydro', 'storage'] },
  { key: 'wind', label: 'Wind', columns: ['wind', 'wind_emb'] },
  { key: 'solar', label: 'Solar', columns: ['solar'] },
];

export const FOSSIL = ['gas', 'coal'];
export const LOW_CARBON = ['wind', 'wind_emb', 'solar', 'nuclear', 'hydro', 'storage'];
const ALL = MIX.flatMap((f) => f.columns);

// Levels the story follows, in GW. Gas below the floor is what runs whatever
// the weather; batteries are sized against the gas above it.
export const GAS_FLOOR = 2;
// Wind bands for the floor chart, and the level above which a windy half hour counts as windy.
export const WIND_BANDS = [0, 5, 10, 15, 20];
export const WIND_HIGH = 15;
// Battery fleets (GW, GWh) the story tests against each day's gas: about
// today's fleet, two steps up, and the 2030 plan's batteries with its
// long-duration storage.
export const BATTERIES = [[7, 11], [15, 30], [25, 50], [31, 110]];
// How many of the heaviest and lightest gas days to average.
export const HEAVY_DAYS = 30;

const pos = (v) => (v > 0 ? v : 0);

/** Sum of the listed columns at slot i, or NaN if any is missing. */
function sumAt(columns, names, i) {
  let v = 0;
  for (const n of names) {
    const c = columns[n];
    if (!c) continue;
    if (Number.isNaN(c[i])) return NaN;
    v += pos(c[i]);
  }
  return v;
}

/**
 * Local hour, month and day number for every slot. The London offset is
 * looked up once per UTC day, so the hour around a clock change can be one off.
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
      offset = tzOffsetMs(d * 864e5 + 432e5, gb.timeZone);
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
const avg = (arr, f) => mean(arr.reduce((a, x) => a + f(x), 0), arr.length);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);

/**
 * Every number the story uses. Rows run by UK calendar year, complete years
 * only, then 'past365' for the latest 365 days.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const c = data.columns;
  const supply = generationTotal(d, gb);
  const { hour, month, day } = localClock(d);
  const bandOf = (w) => { let k = 0; for (let j = 1; j < WIND_BANDS.length; j++) if (w >= WIND_BANDS[j]) k = j; return k; };

  const rows = byYear(d, gb, () => ({
    gasTwh: 0, coalTwh: 0, windTwh: 0, solarTwh: 0, impTwh: 0, supplyTwh: 0,
    gasMin: Infinity, gasMinAt: -1, gasU1: 0, gasU2: 0, gasU5: 0, fosU1: 0,
    gasMonth: new Float64Array(12), gasHour: new Float64Array(24), gasHourN: new Float64Array(24),
    windHour: new Float64Array(24),
    bands: WIND_BANDS.map(() => ({ slots: 0, gas: 0, min: Infinity, gasTwh: 0 })),
    windyTwh: 0, windyHours: 0,
    day: null, days: [],
  }), (r, i) => {
    const g = c.gas[i];
    if (Number.isNaN(g) || Number.isNaN(c.coal[i])) return;
    const gas = g / 1000;
    const w = sumAt(c, ['wind', 'wind_emb'], i) / 1000;
    const imp = pos(c.imports[i]) / 1000;
    const sol = pos(c.solar[i]) / 1000;
    const h = hour[i];
    // One row per local day, for the battery sizing and the heaviest days.
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(r.day);
      r.day = { n: day[i], month: month[i], slots: 0, gas: 0, gasAbove: 0, gasPeak: 0, gasMin: Infinity, wind: 0, imp: 0, solar: 0, supply: 0 };
    }
    const dy = r.day;
    dy.slots++;
    dy.gas += gas * slotH;
    dy.gasAbove += Math.max(0, gas - GAS_FLOOR) * slotH;
    if (gas > dy.gasPeak) dy.gasPeak = gas;
    if (gas < dy.gasMin) dy.gasMin = gas;
    dy.wind += w;
    dy.imp += imp;
    dy.solar += sol * slotH;
    if (Number.isFinite(supply[i])) dy.supply += (supply[i] / 1000) * slotH;
    r.gasTwh += (gas * slotH) / 1000;
    r.coalTwh += (pos(c.coal[i]) * slotH) / 1e6;
    r.windTwh += (w * slotH) / 1000;
    r.solarTwh += (sol * slotH) / 1000;
    r.impTwh += (imp * slotH) / 1000;
    if (Number.isFinite(supply[i])) r.supplyTwh += (supply[i] * slotH) / 1e6;
    if (gas < r.gasMin) { r.gasMin = gas; r.gasMinAt = i; }
    if (gas < 1) r.gasU1 += slotH;
    if (gas < GAS_FLOOR) r.gasU2 += slotH;
    if (gas < 5) r.gasU5 += slotH;
    if (gas + pos(c.coal[i]) / 1000 < 1) r.fosU1 += slotH;
    r.gasMonth[month[i] - 1] += (gas * slotH) / 1000;
    r.gasHour[h] += gas;
    r.windHour[h] += w;
    r.gasHourN[h]++;
    const b = r.bands[bandOf(w)];
    b.slots++;
    b.gas += gas;
    b.gasTwh += (gas * slotH) / 1000;
    if (gas < b.min) b.min = gas;
    if (w >= WIND_HIGH) { r.windyTwh += (gas * slotH) / 1000; r.windyHours += slotH; }
  }).map((r) => {
    const days = (r.day ? [...r.days, r.day] : r.days).filter((x) => x.slots * slotH >= 23);
    const byGas = [...days].sort((a, b) => b.gas - a.gas);
    const profile = (set) => ({ days: set.length, gasGwh: avg(set, (x) => x.gas), windGw: avg(set, (x) => x.wind / x.slots), impGw: avg(set, (x) => x.imp / x.slots), solarGwh: avg(set, (x) => x.solar), supplyGwh: avg(set, (x) => x.supply), gasMin: avg(set, (x) => x.gasMin), gasPeak: avg(set, (x) => x.gasPeak) });
    return {
      year: r.year,
      gasTwh: r.gasTwh,
      coalTwh: r.coalTwh,
      windTwh: r.windTwh,
      solarTwh: r.solarTwh,
      impTwh: r.impTwh,
      supplyTwh: r.supplyTwh,
      gasMin: r.gasMin,
      gasMinAt: r.gasMinAt,
      gasU1: r.gasU1,
      gasU2: r.gasU2,
      gasU5: r.gasU5,
      fosU1: r.fosU1,
      gasMonth: [...r.gasMonth],
      gasHour: [...r.gasHour].map((v, k) => mean(v, r.gasHourN[k])),
      windHour: [...r.windHour].map((v, k) => mean(v, r.gasHourN[k])),
      // Gas in each wind band: hours, average and lowest gas, TWh.
      bands: r.bands.map((b, k) => ({ from: WIND_BANDS[k], to: WIND_BANDS[k + 1] ?? null, hours: b.slots * slotH, gas: mean(b.gas, b.slots), min: b.slots ? b.min : NaN, gasTwh: b.gasTwh })),
      // Gas burnt in the hours with wind at or above WIND_HIGH, and its share.
      windyTwh: r.windyTwh,
      windyHours: r.windyHours,
      windyShare: r.gasTwh ? r.windyTwh / r.gasTwh : NaN,
      windyGas: mean(r.windyTwh * 1000, r.windyHours),
      days: days.length,
      // Each day's gas above the floor (GWh), its peak above the floor and its month, smallest first.
      gasDays: days.map((x) => ({ gwh: x.gasAbove, peak: x.gasPeak - GAS_FLOOR, month: x.month })).sort((a, b) => a.gwh - b.gwh),
      aboveTwh: days.reduce((a, x) => a + x.gasAbove, 0) / 1000,
      // The heaviest and lightest gas days: what the wind and the imports were doing.
      heavy: profile(byGas.slice(0, HEAVY_DAYS)),
      light: profile(byGas.slice(-HEAVY_DAYS)),
      // Days a battery fleet could have covered, if it was full: the day's gas
      // above the floor fits its energy and the peak fits its power.
      batteries: BATTERIES.map(([gw, gwh]) => ({ gw, gwh, days: days.filter((x) => x.gasAbove <= gwh && x.gasPeak - GAS_FLOOR <= gw).length })),
    };
  });

  // Record spells over the whole record, in gas and in gas plus coal.
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: gb.timeZone };
  const gas = coreMetric(d, gb, ['gas']);
  const fossil = coreMetric(d, gb, FOSSIL);
  return {
    rows,
    facts: facts(d),
    gas2Spell: spellOf(summarise(gas, GAS_FLOOR, 'below', opts)),
    fossil1Spell: spellOf(summarise(fossil, 1, 'below', opts)),
    fossil2Spell: spellOf(summarise(fossil, 2, 'below', opts)),
    fossil5Spell: spellOf(summarise(fossil, 5, 'below', opts)),
  };
}

/** Highlights for the fact cards. */
export function facts(data) {
  const { columns, length } = data;
  let lastCoal = -1;
  let wind = { v: -1, i: -1 };
  let solar = { v: -1, i: -1 };
  let green = { v: -1, i: -1 };
  let fossil = { v: Infinity, i: -1 };
  for (let i = 0; i < length; i++) {
    // NESO still shows occasional small coal blips after Ratcliffe closed, so
    // count only output a real coal station would make.
    if (columns.coal[i] >= 200) lastCoal = i;
    const w = sumAt(columns, ['wind', 'wind_emb'], i);
    if (w > wind.v) wind = { v: w, i };
    if (columns.solar[i] > solar.v) solar = { v: columns.solar[i], i };
    const total = sumAt(columns, ALL, i);
    if (total > 10000) {
      const g = (sumAt(columns, LOW_CARBON, i) / total) * 100;
      if (g > green.v) green = { v: g, i };
    }
    const f = sumAt(columns, FOSSIL, i);
    if (f < fossil.v) fossil = { v: f, i };
  }
  return { lastCoal, wind, solar, green, fossil };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(1)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const gbp = (v) => `£${Math.round(v)}`;
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The sources the text cites, each one opened while writing.
const SOURCES = {
  ratcliffe: 'https://www.uniper.energy/united-kingdom/news/the-end-of-an-era---ratcliffe-on-soar-power-station-ends-coal-generation/',
  roadmap: 'https://www.neso.energy/document/379411/download',
  pathfinder: 'https://www.neso.energy/news/first-phase-stability-pathfinders-delivered',
  modoCurtail: 'https://modoenergy.com/research/gb-great-britain-battery-energy-storage-curtailment-wind-constraint-scotland-costs',
  montel: 'https://theenergyst.com/record-wasted-wind-could-have-powered-every-home-in-london-in-2025/',
  winterCosts: 'https://www.neso.energy/document/366796/download',
  ukerc: 'https://ukerc.ac.uk/news/transmission-network-unavailability-the-quiet-driving-force-behind-rising-curtailment-costs-in-great-britain/',
  ucl: 'https://www.ucl.ac.uk/bartlett/sustainable/sites/bartlett_sustainable/files/the_role_of_natural_gas_in_electricity_prices_in_europe_updated_may_2023.pdf',
  qep: 'https://assets.publishing.service.gov.uk/media/69ca357a4a06660f085443c1/quarterly-energy-prices-march-2026.pdf',
  ets: 'https://www.gov.uk/government/publications/determinations-of-the-uk-ets-carbon-price/uk-ets-carbon-price-for-use-in-civil-penalties-2026',
  cps: 'https://taxscape.deloitte.com/measures-autumn-budget-2025/climate-change-levy.aspx',
  power2025: 'https://www.smart-energy.uk/2025-uk-energy-market-year-in-review',
  capacity: 'https://www.smartestenergy.com/en_GB/insights/the-informer/capacity-market-t-4-auction-sees-lower-clearing-price',
  cp2030: 'https://www.gov.uk/government/publications/clean-power-2030-action-plan/242aa00e-a82e-4f29-a785-9d7d690a1230',
  modoBatteries: 'https://modoenergy.com/research/gb-battery-energy-storage-capacity-buildout-q4-2025-projections-2026-clean-power',
  ldes: 'https://www.energy-storage.news/uks-ofgem-goes-big-on-ldes-cap-and-floor-window-1-18-hour-lithium-ion-among-winners/',
  links: 'https://en.wikipedia.org/wiki/List_of_high-voltage_transmission_links_in_the_United_Kingdom',
  teesside: 'https://www.netzeroteesside.co.uk/news/greenlight-for-net-zero-teesside-power/',
  ar7: 'https://www.westwoodenergy.com/news/westwood-insight-analysing-the-record-breaking-ar7-offshore-wind-results',
  hinkley: 'https://world-nuclear-news.org/articles/edf-announces-hinkley-point-c-delay-and-big-rise-i',
  sizewell: 'https://www.enerdata.net/publications/daily-energy-news/final-green-light-32-gw-sizewell-c-nuclear-plant-uk.html',
};

// Rough fuel and carbon cost of a combined-cycle gas plant: gas at 3.1p/kWh,
// what major power producers paid in the last quarter of 2025 (DESNZ), the
// UK ETS price of £49.41/t set for 2026 plus the £18/t Carbon Price Support,
// 55% efficiency and 0.37 t of CO2 per MWh of power. An estimate, not a
// market figure.
export const GAS_PRICE = 31;
export const CARBON_PRICE = 49.41 + 18;
export const CCGT_COST = GAS_PRICE / 0.55 + 0.37 * CARBON_PRICE;

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['2026', 'Batteries reach about 9 GW, from 6.8 GW and 11 GWh at the end of 2025, on Modo Energy\'s projection.', 'modoBatteries', 'Battery discharge peak; the evening gas peak against the overnight level.'],
  ['2026 to 2027', 'Ofgem decides the first long-duration storage cap and floor window: 16 projects, 7.6 GW, 8 to 22 hours, most of them in northern Scotland, were minded-to approved in June 2026.', 'ldes', 'Days with gas above the floor that storage could cover, once the projects are built; Ofgem gives no dates yet.'],
  ['2028', 'NeuConnect, 1.4 GW to Germany, and Net Zero Teesside, a 742 MW gas plant with carbon capture, are due to start.', 'teesside', 'More imports in calm weather; the first gas that would not count as unabated.'],
  ['Oct 2028', 'Capacity Market contracts for 2028/29 pay 43.1 GW of capacity £60 per kilowatt a year to be available; gas won most of them.', 'capacity', 'The floor: paying plants to stay open works against it falling.'],
  ['2029', 'Eastern Green Links 1 and 2, 2 GW each, carry Scottish wind to England under the sea.', 'links', 'The gas floor on windy days, and the TWh of gas burnt while wind is above 15 GW.'],
  ['2030', 'Clean Power 2030: 95% of generation from clean sources, unabated gas no more than 5%, 23 to 27 GW of batteries, with 35 GW of gas kept in reserve.', 'cp2030', 'Gas TWh a year against 5% of supply, worked out in chapter 5. Hours a year with gas under 2 GW.'],
  ['2030 (EDF base case)', 'Hinkley Point C unit 1, 1.6 GW; 2029 if all goes well, 2031 if not.', 'hinkley', 'Overnight gas in calm weather; the lowest gas half hour of the year.'],
  ['Around 2030 (inferred from the target)', 'The 8.4 GW of offshore wind contracted in January 2026\'s AR7 auction, including Berwick Bank and the Dogger Bank South and Norfolk Vanguard projects.', 'ar7', 'Hours a year with wind above 15 GW and 20 GW; calm-spell records.'],
  ['Mid to late 2030s', 'Sizewell C, two reactors of 3.2 GW together, given its final investment decision on 22 July 2025.', 'sizewell', 'Overnight gas; the floor in calm weather.'],
];

// Chapter titles, set before the data arrives so the summaries are not blank.
export const CHAPTERS = [
  'Gas is what runs when the wind drops',
  'A floor of gas runs even when the wind blows',
  'Who pays for gas, and what replacing it would cost',
  'What batteries could and could not replace',
  'What is coming, and which records it moves',
];

export function renderChapterTitles() {
  CHAPTERS.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < CHAPTERS.length - 1) $(`next-${k + 1}`).textContent = `Next: ${CHAPTERS[k + 1]}`;
  });
}

export function renderStory(data, end, figs) {
  const { rows, gas2Spell, fossil1Spell, fossil2Spell, fossil5Spell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? first;
  const prev = full.length > 1 ? full.at(-2) : first;
  const leastGas = full.reduce((a, r) => (r.gasTwh < a.gasTwh ? r : a), first);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellText = (sp) => (sp ? formatDuration(sp.end - sp.start) : 'None yet');
  const from = (sp) => (sp ? `from ${fmtDate(at(sp.start))}` : 'not yet');
  const bat = (k) => last.batteries[k];
  // The windy hours: every band from WIND_HIGH up.
  const windyBands = last.bands.filter((b) => b.from >= WIND_HIGH);
  const windy = { from: WIND_HIGH, hours: last.windyHours, gas: last.windyGas, min: Math.min(...windyBands.map((b) => b.min)) };
  const calm = last.bands[0];
  const heavy = last.heavy;
  const light = last.light;
  const peakHour = last.gasHour.indexOf(Math.max(...last.gasHour));
  const lowHour = last.gasHour.indexOf(Math.min(...last.gasHour));
  const lm = last.gasMonth;
  const winter = (lm[10] + lm[11] + lm[0] + lm[1]) / last.gasTwh;
  const median = last.gasDays[Math.floor(last.gasDays.length / 2)];
  const worst = last.gasDays.at(-1);
  const coalDays = Math.floor((end - 1 - figs.facts.lastCoal) / (1440 / step));

  // Header and in short.
  $('lede').textContent = `With coal gone, I wanted to know why Britain still burns gas. In ${last.year} it burnt ${twh(last.gasTwh)}, ${leastGas === last ? `the least since the data began in ${first.year}` : `${last.gasTwh > prev.gasTwh ? 'up' : 'down'} from ${twh(prev.gasTwh)} in ${prev.year}`}, and never ran below ${gw(last.gasMin)}.`;
  $('answer-lead').textContent = `Britain still burns gas for two reasons. Most of it fills the gap when the wind drops: nothing else now on the system covers the ${n0(heavy.gasGwh)} GWh a day that gas made on the heaviest days of ${last.year}. The rest is a floor of a few gigawatts that runs whatever the weather, on the windiest days alongside Scottish wind farms being paid to switch off. Nothing now planned takes gas to zero: the 2030 plan keeps 35 GW of it in reserve. The records to watch are the floor on windy days and the spells with gas under ${GAS_FLOOR} GW.`;
  $('answer-points').innerHTML = [
    `<b>Gas is what runs when the wind drops.</b> On the ${heavy.days} heaviest gas days of ${last.year} wind averaged ${gw(heavy.windGw)} and gas made ${n0(heavy.gasGwh)} GWh a day; on the ${light.days} lightest, wind averaged ${gw(light.windGw)} and gas ${n0(light.gasGwh)} GWh. On an average day gas peaks at ${hh(peakHour)}, at ${gw(last.gasHour[peakHour])} against ${gw(last.gasHour[lowHour])} at ${hh(lowHour)}. ${link(1, 'Chapter 1')}`,
    `<b>A floor runs even when the wind blows.</b> In the ${hrs(windy.hours)} of ${last.year} with wind above ${windy.from} GW, gas still averaged ${gw(windy.gas)} and never fell below ${gw(windy.min)}: ${twh(last.windyTwh)}, ${pc(last.windyShare)} of the year's gas, burnt while a record 10.2 TWh of renewable output was curtailed, almost all of it in Scotland. ${link(2, 'Chapter 2')}`,
    `<b>Gas sets the price, gets paid to wait, and batteries cannot yet replace it.</b> A gas plant's fuel and carbon come to roughly ${gbp(CCGT_COST)} a megawatt hour, our estimate, against a day-ahead price that averaged about £83 in 2025. Today's ${bat(0).gw} GW and ${bat(0).gwh} GWh of batteries would have covered all gas above ${GAS_FLOOR} GW on ${bat(0).days} ${bat(0).days === 1 ? 'day' : 'days'} of ${last.year}; the 2030 plan's ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}. ${link(3, 'Chapters 3')}, ${link(4, '4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const fossilFacts = [
    ['--fossil', 'Under 2 GW of fossil fuel', spellText(fossil2Spell), from(fossil2Spell)],
    ['--fossil', 'Under 5 GW of fossil fuel', spellText(fossil5Spell), from(fossil5Spell)],
    ['--f-gas', `Gas burnt in ${last.year}`, twh(last.gasTwh), `against ${twh(row(2019).gasTwh)} in ${row(2019).year} and ${twh(first.gasTwh)} in ${first.year}`],
    ['--f-gas', `Lowest gas in ${last.year}`, gw(last.gasMin), `on ${fmtDate(at(last.gasMinAt))}; ${gw(latest.gasMin)} in the latest 365 days`],
    ['--f-coal', 'Without coal', `${n0(coalDays)} days`, `since Ratcliffe-on-Soar closed on ${fmtDate(at(figs.facts.lastCoal))}`],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${spellText(fossil1Spell)}</div><div class="sub">with gas and coal under 1 GW, ${from(fossil1Spell)}. The longest Britain has run on almost no fossil fuel, and the record to beat.</div></div>
    <ul class="fact-list">${fossilFacts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: the gas that fills the gap when the wind drops, the floor that runs when it blows, who pays for gas, what batteries could and could not replace, and what is coming, with the record each item should move.';

  renderChapterTitles();
  const cats = rows.map((r) => label(r.year));
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const yearColors = ['--f-other', '--f-nuclear', '--f-hydro', '--f-gas'];
  const years = [row(2019).year, row(2023).year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const yearLines = (pick, xOf, markers = false) => years.map((y, k) => {
    const s = { name: title(y), year: y, color: css(yearColors[k]), points: pick(row(y)).map((v, m) => [xOf(m), v]), width: y === 'past365' ? 3 : 2 };
    if (markers) s.markers = s.points;
    return s;
  });
  const lineTip = (head, fmt) => (t, vals) => `<strong>${head(t)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? fmt(v.value) : '—'}</b></div>`).join('')}`;

  // Chapter 1: the gap gas fills.
  $('take-1').textContent = `On the ${heavy.days} heaviest gas days of ${last.year} wind averaged ${gw(heavy.windGw)}; on the ${light.days} lightest it averaged ${gw(light.windGw)}. Gas is the plant that answers the weather.`;
  $('body-1').innerHTML = `Coal ended when Ratcliffe-on-Soar closed on 30 September 2024 (${src(SOURCES.ratcliffe, 'Uniper')}), so gas is the last fossil fuel on the grid. It made ${twh(first.gasTwh)} in ${first.year}, ${twh(row(2019).gasTwh)} in 2019 and ${twh(last.gasTwh)} in ${last.year}, while wind went from ${twh(first.windTwh)} to ${twh(last.windTwh)}. What gas does now is follow the wind. On the ${heavy.days} days of ${last.year} with the most gas it made ${n0(heavy.gasGwh)} GWh a day, with wind at ${gw(heavy.windGw)} on average, imports at ${gw(heavy.impGw)} and ${n0(heavy.solarGwh)} GWh of solar; on the ${light.days} days with the least, gas made ${n0(light.gasGwh)} GWh with wind at ${gw(light.windGw)}. ${pc(winter)} of the year's gas was burnt from November to February. Within the day the shape is the same: gas averaged ${gw(last.gasHour[lowHour])} at ${hh(lowHour)} and ${gw(last.gasHour[peakHour])} at ${hh(peakHour)}, when demand peaks and solar has gone. That evening ramp, about ${gw(last.gasHour[peakHour] - last.gasHour[lowHour])} on an average day, is the part of gas that batteries are built for; the calm weeks are the part they are not.`;
  $('chart-h-1').textContent = 'Gas by month';
  $('chart-hint-1').textContent = 'Gas generation in each calendar month, in TWh. The thick line is the latest 365 days.';
  const monthX = (m) => Date.UTC(2001, m, 15);
  const monthLines = yearLines((r) => r.gasMonth, monthX, true);
  lineChart($('story-chart-1'), {
    series: monthLines,
    yMin: 0,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    xTicks: MONTHS.map((m, k) => ({ t: monthX(k), label: m })),
    tooltip: lineTip((t) => MONTHS[new Date(t).getUTCMonth()], twh),
  });
  $('story-legend-1').innerHTML = legend(monthLines.map((sr) => [sr.name, sr.color]));
  $('chart-h-1b').textContent = 'Gas by hour of day';
  $('chart-hint-1b').textContent = 'Average gas output at each hour of the day, UK time, in GW. The average wind at that hour is in the tooltip.';
  const hourLines = yearLines((r) => r.gasHour, hourX);
  lineChart($('story-chart-1b'), {
    series: hourLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b>, wind ${gw(row(v.series.year).windHour[hr])}</div>`).join('')}`;
    },
  });
  $('story-legend-1b').innerHTML = legend(hourLines.map((sr) => [sr.name, sr.color]));

  // Chapter 2: the floor on windy days.
  $('take-2').textContent = `With wind above ${windy.from} GW, gas still averaged ${gw(windy.gas)} in ${last.year} and never fell below ${gw(windy.min)}. Part of that is physics, and part is a grid that cannot carry Scottish wind south.`;
  $('body-2').innerHTML = `Gas does not go away when the wind arrives. In ${last.year} it averaged ${gw(calm.gas)} in the ${hrs(calm.hours)} with wind under ${calm.to} GW and ${gw(windy.gas)} in the ${hrs(windy.hours)} with wind above ${windy.from} GW, where the lowest it reached was ${gw(windy.min)}. That is ${twh(last.windyTwh)} of gas, ${pc(last.windyShare)} of the year's total, burnt while the system had more wind than it could use: a record 10.2 TWh of renewable output was curtailed in 2025, over 98% of it in Scotland (Montel EnAppSys, via ${src(SOURCES.montel, 'The Energyst')}). Two things keep the gas on, and the data cannot separate them, so the split is inferred. The first is the wires. The B6 boundary between Scotland and England was constrained for 34% of 2025; NESO paid about £350 million to turn Scottish wind down and over £1 billion for replacement generation, mostly gas (${src(SOURCES.modoCurtail, 'Modo Energy')}). Gas offers cost £959 million over the 2024/25 winter alone, when 14% of possible wind output was curtailed (${src(SOURCES.winterCosts, 'NESO')}). The second is stability. The grid needs a minimum of 120 GVA.s of inertia, which used to come free from spinning coal and gas turbines; NESO is buying it instead from synchronous compensators and grid-forming batteries, and it still reports leaning on fossil plant for inertia and voltage through the Balancing Mechanism (${src(SOURCES.roadmap, 'NESO Markets Roadmap, March 2026')}; ${src(SOURCES.pathfinder, 'stability pathfinders')}). The floor is falling: gas never dropped below ${gw(row(2019).gasMin)} in 2019, ${gw(last.gasMin)} in ${last.year} and ${gw(latest.gasMin)} in the latest 365 days. On 1 April 2025 the grid ran a half hour at 97.7% zero carbon, its record (${src(SOURCES.roadmap, 'NESO')}).`;
  $('chart-h-2').textContent = `Gas against wind in ${last.year}`;
  $('chart-hint-2').textContent = `Average gas output in ${last.year} for each band of wind output, both in GW. The darker part of each bar is the lowest gas reached in that band: the floor.`;
  const bandCats = last.bands.map((b) => (b.to ? `${b.from} to ${b.to}` : `${b.from} and up`));
  const bandStacks = [
    { name: 'Lowest gas in the band', color: css('--f-coal'), values: last.bands.map((b) => (Number.isFinite(b.min) ? b.min : 0)) },
    { name: 'Average gas', color: css('--f-gas'), values: last.bands.map((b) => (Number.isFinite(b.gas) ? b.gas - b.min : 0)) },
  ];
  barChart($('story-chart-2'), {
    cats: bandCats,
    stacks: bandStacks,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => { const b = last.bands[ci]; return `<strong>Wind ${bandCats[ci]} GW</strong><div>Hours: <b>${n0(b.hours)}</b></div><div>Average gas: <b>${gw(b.gas)}</b></div><div>Lowest gas: <b>${gw(b.min)}</b></div><div>Gas burnt: <b>${twh(b.gasTwh)}</b></div>`; },
  });
  $('story-legend-2').innerHTML = legend([['Average gas', css('--f-gas')], ['Lowest gas in the band', css('--f-coal')]]);
  $('chart-h-2b').textContent = `Gas burnt with wind above ${WIND_HIGH} GW`;
  $('chart-hint-2b').textContent = `Gas generation each year, in TWh, split by whether wind was above ${WIND_HIGH} GW in that half hour. The last bar is the latest 365 days.`;
  const windyStacks = [
    { name: `Wind under ${WIND_HIGH} GW`, color: css('--f-gas'), values: rows.map((r) => r.gasTwh - r.windyTwh) },
    { name: `Wind above ${WIND_HIGH} GW`, color: css('--f-wind'), values: rows.map((r) => r.windyTwh) },
  ];
  barChart($('story-chart-2b'), {
    cats,
    stacks: windyStacks,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => rows[ci].year === 'past365',
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Gas: <b>${twh(rows[ci].gasTwh)}</b></div><div>With wind above ${WIND_HIGH} GW: <b>${twh(rows[ci].windyTwh)}</b> in ${hrs(rows[ci].windyHours)}</div><div>Lowest gas: <b>${gw(rows[ci].gasMin)}</b></div>`,
  });
  $('story-legend-2b').innerHTML = legend([...windyStacks].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 3: the economics. The firm-megawatt model below it is drawn by solar-view.js.
  $('take-3').textContent = `Gas sets the power price in almost every hour, is paid £60 a kilowatt a year to stay available, and the 2030 plan keeps 35 GW of it. The price of a firm megawatt from solar and batteries is below.`;
  $('body-3').innerHTML = `In Britain the gas plant is nearly always the last one needed, so it sets the price: 98% of the time in 2021, more than in any other European country studied (${src(SOURCES.ucl, 'UCL')}). The arithmetic shows why. Major power producers paid 3.1p a kilowatt hour for gas in the last quarter of 2025 (${src(SOURCES.qep, 'DESNZ')}); the UK ETS allowance set for 2026 is £49.41 a tonne (${src(SOURCES.ets, 'gov.uk')}) and the Carbon Price Support adds £18 (${src(SOURCES.cps, 'Deloitte')}). At 55% efficiency a combined-cycle plant needs roughly ${gbp(CCGT_COST)} a megawatt hour to cover fuel and carbon, our estimate, and the day-ahead price averaged about £83 in 2025 (${src(SOURCES.power2025, 'Smart Energy')}). Wind and solar, paid under contracts for difference, bid in below gas and run first; gas fills what is left and names the price. Being available is paid for too: the Capacity Market auction for 2028/29 cleared at £60 per kilowatt a year for 43.1 GW, and gas won the lion's share, with 1.8 GW going to batteries (${src(SOURCES.capacity, 'SmartestEnergy')}). When the wind is turned down instead of gas it is because the wires are full, not the price: NESO paid an average of £127 a megawatt hour for thermal constraint actions in 2025, and gas generators asked about 30% more for short-notice output than they would have in the day-ahead market (${src(SOURCES.roadmap, 'NESO')}; ${src(SOURCES.ukerc, 'UKERC')}). Balancing costs reached £2.99 billion in 2025, about 60% of it constraints. The Clean Power 2030 plan keeps 35 GW of unabated gas as reserve while aiming for it to make no more than 5% of generation (${src(SOURCES.cp2030, 'DESNZ')}), so the plants will be paid to wait for the calm weeks rather than closed. What a steady megawatt from solar and batteries would cost instead, compared with gas, is worked out below.`;

  // Chapter 4: battery sizing. The battery feeds and the fleet's growth follow, drawn by app.js.
  $('take-4').textContent = `${bat(0).gw} GW and ${bat(0).gwh} GWh of batteries, about today's fleet, would have covered gas above ${GAS_FLOOR} GW on ${bat(0).days} ${bat(0).days === 1 ? 'day' : 'days'} of ${last.year}; ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}. The calm weeks are out of reach.`;
  $('body-4').innerHTML = `Take the ${GAS_FLOOR} GW floor as given and ask what would have covered the rest, ${twh(last.aboveTwh)} in ${last.year}. The median day needed ${n0(median.gwh)} GWh above the floor and peaked ${gw(median.peak)} above it; the worst needed ${n0(worst.gwh)} GWh and ${gw(worst.peak)}. Against those days, ${last.batteries.map((b, i) => (i ? `${i === last.batteries.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh ${b.days}` : `${b.gw} GW and ${b.gwh} GWh of batteries would have covered ${b.days} ${b.days === 1 ? 'day' : 'days'}`)).join(', ')}. Britain had 6.8 GW and 11 GWh of batteries at the end of 2025, an average of 1.6 hours each (${src(SOURCES.modoBatteries, 'Modo Energy')}); the 2030 plan wants 23 to 27 GW of batteries and 4 to 6 GW of long-duration storage (${src(SOURCES.cp2030, 'DESNZ')}), which the largest fleet above stands for. The sizing assumes the batteries could charge, and on windy days they can, from the wind that is otherwise turned off. The problem is the calm week: on the ${heavy.days} heaviest gas days of ${last.year} the grid supplied ${n0(heavy.supplyGwh)} GWh a day with ${n0(heavy.solarGwh)} GWh of solar and wind at ${gw(heavy.windGw)}, and no battery fleet in the plan holds a day of that. Batteries can flatten the evening peak, soak up Scottish wind and lengthen the spells under ${GAS_FLOOR} GW; the ${n0(worst.gwh)} GWh days need wind, imports, nuclear or gas.`;
  $('chart-h-4').textContent = `Each day of ${last.year}, by the gas a battery would have had to replace`;
  $('chart-hint-4').textContent = `Each day's gas above ${GAS_FLOOR} GW, in GWh, sorted from smallest to largest. The lines mark what ${last.batteries.map((b) => b.gwh).join(', ')} GWh of batteries could supply; days below a line are covered, if the batteries could charge and their power is enough.`;
  const dayX = (k) => k * 864e5;
  const sorted = [{ name: 'Gas above the floor', color: css('--f-gas'), points: last.gasDays.map((x, k) => [dayX(k), x.gwh]), width: 2.5 }];
  lineChart($('story-chart-4'), {
    series: sorted,
    yMin: 0,
    yFormat: (v) => `${n0(v)} GWh`,
    yTickFormat: (v) => n0(v),
    xTicks: [0, 60, 120, 180, 240, 300, 360].filter((k) => k < last.gasDays.length).map((k) => ({ t: dayX(k), label: `${k}` })),
    refLines: last.batteries.map((b) => ({ value: b.gwh, color: css('--ink-3') })),
    tooltip: (t) => {
      const k = Math.round(t / 864e5);
      const x = last.gasDays[k];
      return x ? `<strong>Day ${k + 1} of ${last.gasDays.length}</strong><div>Gas above ${GAS_FLOOR} GW: <b>${n0(x.gwh)} GWh</b></div><div>Peak above the floor: <b>${gw(x.peak)}</b></div><div>Month: <b>${MONTHS[x.month - 1]}</b></div>` : '';
    },
  });
  $('story-legend-4').innerHTML = `${legend(sorted.map((sr) => [sr.name, sr.color]))}<span>Lines: ${last.batteries.map((b) => `${b.gwh} GWh`).join(', ')}</span>`;

  // Chapter 5: what's coming.
  $('take-5').textContent = `The Scottish links arrive in 2029 and the 2030 plan wants gas under 5% of generation, but it keeps 35 GW of gas plant and pays it to wait.`;
  $('body-5').innerHTML = `The dated items are listed below, each with the record it should move. The wires come first: Eastern Green Links 1 and 2 in 2029 should cut the gas burnt in England while Scottish wind is turned off, so watch the floor on windy days and the ${twh(last.windyTwh)} of gas burnt with wind above ${WIND_HIGH} GW. Batteries at about 9 GW by the end of 2026 and 23 to 27 GW by 2030 go for the evening peak, and should lengthen the spells with gas under ${GAS_FLOOR} GW. Against that, the Capacity Market pays the gas fleet to stay, and 5% of what the grid supplied in ${last.year} is still ${twh(0.05 * last.supplyTwh)} a year, ${pc((0.05 * last.supplyTwh) / last.gasTwh)} of what gas made. Hours with gas under ${GAS_FLOOR} GW went from ${hrs(first.gasU2)} in ${first.year} to ${hrs(last.gasU2)} in ${last.year} and ${hrs(latest.gasU2)} in the latest 365 days; the longest spell so far is ${spellText(gas2Spell)}, ${from(gas2Spell)}. Those are the counts to watch.`;
  $('chart-h-5').textContent = 'Hours a year with gas under 5, 2 and 1 GW';
  $('chart-hint-5').textContent = 'Hours each year with gas output under each level. The lowest half hour of gas is in the tooltip. The last bar is the latest 365 days.';
  const fmtH = (v) => `${n0(v)} h`;
  const hourStacks = [
    { name: 'Under 1 GW', color: css('--h7'), values: rows.map((r) => r.gasU1) },
    { name: `1 to ${GAS_FLOOR} GW`, color: css('--lowcarbon'), values: rows.map((r) => r.gasU2 - r.gasU1) },
    { name: `${GAS_FLOOR} to 5 GW`, color: css('--h2'), values: rows.map((r) => r.gasU5 - r.gasU2) },
  ];
  barChart($('story-chart-5'), {
    cats,
    stacks: hourStacks,
    yFormat: fmtH,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => rows[ci].year === 'past365',
    // Under 2 GW is too rare to see as a bar yet, so flag it with a star.
    badge: (ci) => (rows[ci].gasU2 > 0 ? `★ ${fmtH(rows[ci].gasU2)}` : null),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Under 5 GW: <b>${fmtH(rows[ci].gasU5)}</b> (${Math.round((rows[ci].gasU5 / 8760) * 100)}% of the year)</div><div>Under ${GAS_FLOOR} GW: <b>${fmtH(rows[ci].gasU2)}</b></div><div>Under 1 GW: <b>${fmtH(rows[ci].gasU1)}</b></div><div>Lowest gas: <b>${gw(rows[ci].gasMin)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(hourStacks.map((sr) => [sr.name, sr.color])) + `<span>★ hours under ${GAS_FLOOR} GW</span>`;
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--f-gas)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
