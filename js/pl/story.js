// The Poland story: why coal still runs. About five gigawatts of it is kept
// on whatever the price, for heat, voltage and reserve, and the grid operator
// curtails solar around it; the rest runs in the evening, when the price pays
// its fuel and carbon, and it is paid to stay available until the end of 2028.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import pl from '../countries/pl.js';
import { FOSSIL, RENEWABLE, COAL, WIND, GENERATION, metricSeries, yearlyEnergy, byYear } from './data.js';

// Coal levels the story follows, in GW.
export const COAL_LOW = 7;
export const COAL_MID = 10;
// Coal below this is the floor that runs whatever the price; the daytime
// block is sized against the coal above it.
export const COAL_FLOOR = 5;
// Battery fleets (GW, GWh) the story tests against each day's evening rise.
export const BATTERIES = [[2, 4], [5, 10], [5, 20], [10, 40]];
// Wind and solar levels for the "coal against wind and solar" comparison, in GW.
export const WIND_HIGH = 6;
export const WIND_LOW = 1;
export const SOLAR_HIGH = 8;
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
// The day's lowest coal is looked for in these local hours; the evening rise
// is the coal above that low from then until midnight.
const DAYTIME = [9, 16];

/**
 * Local hour, month and day number for every slot. Warsaw's offset is looked
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
      offset = tzOffsetMs(d * 864e5 + 432e5, pl.timeZone);
    }
    const local = t + offset;
    hour[i] = new Date(local).getUTCHours();
    month[i] = new Date(local).getUTCMonth() + 1;
    day[i] = Math.floor(local / 864e5);
  }
  return { hour, month, day };
}

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);

/** Closes a day's tally: the evening rise above its daytime low. */
function closeDay(d) {
  let low = Infinity;
  let lowK = 0;
  d.slots.forEach(([h, c], k) => { if (h >= DAYTIME[0] && h <= DAYTIME[1] && c < low) { low = c; lowK = k; } });
  let rise = 0;
  let risePeak = 0;
  if (Number.isFinite(low)) {
    for (let k = lowK; k < d.slots.length; k++) {
      const above = Math.max(0, d.slots[k][1] - low);
      rise += above * d.slotH;
      if (above > risePeak) risePeak = above;
    }
  }
  return { month: d.month, low, rise, risePeak, above: d.above, abovePeak: d.abovePeak, solar: d.solar };
}

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
  const lignite = metricSeries(d, ['lignite']);
  const fossil = metricSeries(d, FOSSIL);
  const solar = metricSeries(d, ['solar']);
  const wind = metricSeries(d, WIND);
  const renewPct = metricSeries(d, RENEWABLE, { unit: 'pct' });
  const gas = metricSeries(d, ['gas']);
  const price = data.columns.price ?? new Float64Array(end).fill(NaN);
  const { exports, imports } = data.columns;
  const { hour, month, day } = localClock(d);

  const rows = byYear(d, () => ({
    coalTwh: 0, coalMin: Infinity, coalMinAt: -1, coalMax: -Infinity, ligMin: Infinity, hcMin: Infinity, fossilMin: Infinity,
    coalLow: 0, coalLow5: 0, coalMid: 0, coalLowSun: 0, renew50: 0, solarMax: 0,
    coalHour: new Float64Array(24), ligHour: new Float64Array(24), hourN: new Float64Array(24), coalMonth: new Float64Array(12), ligMonth: new Float64Array(12),
    coalExporting: 0, coalWindHi: 0, windHiN: 0, coalWindLo: 0, windLoN: 0, coalSolarHi: 0, solarHiN: 0,
    priceSum: 0, priceN: 0, neg: 0, middaySum: 0, middayN: 0, eveningSum: 0, eveningN: 0,
    solarRev: 0, solarMw: 0, coalRev: 0, coalMw: 0, byHour: new Float64Array(24), byHourN: new Float64Array(24),
    trade: 0, day: null, days: [],
  }), (r, i) => {
    const c = coal[i];
    if (Number.isNaN(c)) return;
    const h = hour[i];
    // The evening rise, one day at a time.
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(closeDay(r.day));
      r.day = { n: day[i], month: month[i], slotH, slots: [], above: 0, abovePeak: 0, solar: 0 };
    }
    r.day.slots.push([h, c]);
    r.day.above += Math.max(0, c - COAL_FLOOR) * slotH;
    if (c - COAL_FLOOR > r.day.abovePeak) r.day.abovePeak = c - COAL_FLOOR;
    r.day.solar += solar[i] * slotH;
    r.coalTwh += (c * slotH) / 1000;
    if (c < r.coalMin) { r.coalMin = c; r.coalMinAt = i; }
    if (c > r.coalMax) r.coalMax = c;
    if (lignite[i] < r.ligMin) r.ligMin = lignite[i];
    if (c - lignite[i] < r.hcMin) r.hcMin = c - lignite[i];
    if (fossil[i] < r.fossilMin) r.fossilMin = fossil[i];
    if (c < COAL_LOW) {
      r.coalLow += slotH;
      if (solar[i] >= 1) r.coalLowSun += slotH;
    }
    if (c < COAL_FLOOR) r.coalLow5 += slotH;
    if (c < COAL_MID) r.coalMid += slotH;
    if (renewPct[i] >= 50) r.renew50 += slotH;
    if (solar[i] > r.solarMax) r.solarMax = solar[i];
    r.coalHour[h] += c;
    r.ligHour[h] += lignite[i];
    r.hourN[h]++;
    r.coalMonth[month[i] - 1] += (c * slotH) / 1000;
    r.ligMonth[month[i] - 1] += (lignite[i] * slotH) / 1000;
    // Imports positive, exports negative, so this is net imports.
    const net = (imports[i] || 0) + (exports[i] || 0);
    if (net < 0) r.coalExporting += (c * slotH) / 1000;
    r.trade += (net * slotH) / 1e6;
    if (wind[i] >= WIND_HIGH) { r.coalWindHi += c; r.windHiN++; }
    if (wind[i] < WIND_LOW) { r.coalWindLo += c; r.windLoN++; }
    if (solar[i] >= SOLAR_HIGH) { r.coalSolarHi += c; r.solarHiN++; }
    const p = price[i];
    if (Number.isNaN(p)) return;
    r.priceSum += p;
    r.priceN++;
    if (p < 0) r.neg += slotH;
    r.byHour[h] += p;
    r.byHourN[h]++;
    if (h >= MIDDAY[0] && h <= MIDDAY[1]) { r.middaySum += p; r.middayN++; }
    if (h >= EVENING[0] && h <= EVENING[1]) { r.eveningSum += p; r.eveningN++; }
    r.solarRev += p * solar[i];
    r.solarMw += solar[i];
    r.coalRev += p * c;
    r.coalMw += c;
  }).map((r) => {
    const days = r.day ? [...r.days, closeDay(r.day)] : r.days;
    const full = days.filter((x) => Number.isFinite(x.low));
    return {
      year: r.year,
      coalTwh: r.coalTwh,
      coalMin: r.coalMin,
      coalMinAt: r.coalMinAt,
      coalMax: r.coalMax,
      ligMin: r.ligMin,
      hcMin: r.hcMin,
      fossilMin: r.fossilMin,
      coalLow: r.coalLow,
      coalLow5: r.coalLow5,
      coalLowSunShare: r.coalLow ? r.coalLowSun / r.coalLow : NaN,
      coalMid: r.coalMid,
      renew50: r.renew50,
      solarMax: r.solarMax,
      coalHour: [...r.coalHour].map((v, k) => mean(v, r.hourN[k])),
      ligHour: [...r.ligHour].map((v, k) => mean(v, r.hourN[k])),
      coalMonth: [...r.coalMonth],
      ligMonth: [...r.ligMonth],
      coalWinterShare: (r.coalMonth[10] + r.coalMonth[11] + r.coalMonth[0] + r.coalMonth[1] + r.coalMonth[2]) / r.coalTwh,
      coalExportingShare: r.coalExporting / r.coalTwh,
      coalWindHi: mean(r.coalWindHi, r.windHiN),
      coalWindLo: mean(r.coalWindLo, r.windLoN),
      coalSolarHi: mean(r.coalSolarHi, r.solarHiN),
      price: mean(r.priceSum, r.priceN),
      negHours: r.neg,
      midday: mean(r.middaySum, r.middayN),
      evening: mean(r.eveningSum, r.eveningN),
      solarCapture: mean(r.solarRev, r.solarMw),
      coalCapture: mean(r.coalRev, r.coalMw),
      byHour: [...r.byHour].map((v, k) => mean(v, r.byHourN[k])),
      netImportsTwh: r.trade,
      days: days.length,
      // Each day's evening rise (GWh above the daytime low, from the low to
      // midnight) with its peak, month and that day's solar, smallest first.
      riseDays: full.map((x) => ({ gwh: x.rise, peak: x.risePeak, month: x.month, solar: x.solar })).sort((a, b) => a.gwh - b.gwh),
      riseTwh: full.reduce((a, x) => a + x.rise, 0) / 1000,
      // Each day's coal above the floor, in GWh, smallest first.
      floorDays: days.map((x) => ({ gwh: x.above, peak: x.abovePeak, month: x.month })).sort((a, b) => a.gwh - b.gwh),
      floorTwh: days.reduce((a, x) => a + x.above, 0) / 1000,
      // Days each battery fleet could have covered: the evening rise, if it
      // was full, and (coveredFloor) the whole day's coal above the floor.
      batteries: BATTERIES.map(([bgw, gwh]) => ({
        gw: bgw,
        gwh,
        days: full.filter((x) => x.rise <= gwh && x.risePeak <= bgw).length,
        charged: full.filter((x) => x.rise <= gwh && x.risePeak <= bgw && x.solar >= x.rise).length,
        floorDays: days.filter((x) => x.above <= gwh && x.abovePeak <= bgw).length,
      })),
    };
  });

  // What runs in each price band, over the latest two years.
  const bandFrom = Math.max(0, end - Math.round((730 * 24) / slotH));
  const bands = PRICE_BANDS.map((b) => ({ ...b, hours: 0, coal: 0, lignite: 0, gas: 0, wind: 0, solar: 0, exports: 0, imports: 0 }));
  for (let i = bandFrom; i < end; i++) {
    const p = price[i];
    if (Number.isNaN(p) || Number.isNaN(coal[i])) continue;
    const b = bands.find((x) => p >= x.lo && p < x.hi);
    b.hours += slotH;
    b.coal += coal[i];
    b.lignite += lignite[i];
    b.gas += gas[i];
    b.wind += wind[i];
    b.solar += solar[i];
    b.exports -= exports[i] / 1000;
    b.imports += imports[i] / 1000;
  }
  for (const b of bands) {
    const n = b.hours / slotH;
    for (const k of ['coal', 'lignite', 'gas', 'wind', 'solar', 'exports', 'imports']) b[k] = mean(b[k], n);
  }

  // Coal's and renewables' monthly share of generation.
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const months = new Map();
  let y0 = -1;
  let yearOf = null;
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(coal[i])) continue;
    let gen = 0;
    for (const col of genCols) gen += col[i] || 0;
    if (!(gen > 0)) continue;
    if (day[i] !== y0) { y0 = day[i]; yearOf = new Date(day[i] * 864e5).getUTCFullYear(); }
    const key = `${yearOf}-${String(month[i]).padStart(2, '0')}`;
    const m = months.get(key) ?? { coal: 0, renew: 0, gen: 0 };
    m.coal += coal[i] * 1000;
    m.renew += (renewPct[i] / 100) * gen;
    m.gen += gen;
    months.set(key, m);
  }
  // The last month may be part of a month.
  const monthly = [...months].map(([m, v]) => ({ month: m, coalPct: (v.coal / v.gen) * 100, renewPct: (v.renew / v.gen) * 100 }));

  // Record spells over the whole record.
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: pl.timeZone };
  return {
    rows,
    energy,
    bands,
    bandFrom,
    monthly,
    coalLowSpell: spellOf(summarise(coal, COAL_LOW, 'below', opts)),
    coalFloorSpell: spellOf(summarise(coal, COAL_FLOOR, 'below', opts)),
    fossilLowSpell: spellOf(summarise(fossil, COAL_LOW, 'below', opts)),
  };
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
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const named = (y) => (y === 'past365' ? 'the latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SOURCES = {
  derogation: 'https://energiesmedia.com/poland-wins-eu-approval-to-keep-coal-plants/',
  reserve: 'https://www.bankier.pl/wiadomosc/Wegiel-w-glebokiej-rezerwie-Rzad-i-PSE-przekonuja-Bruksele-do-nowego-planu-9060824.html',
  auction2027: 'https://modoenergy.com/research/poland-capacity-market-supplementary-auction-bess-2027',
  auction2028: 'https://www.forum-energii.eu/en/8-aukcja-rynku-mocy',
  auction2030: 'https://www.ess-news.com/?p=7742',
  batteries: 'https://modoenergy.com/research/poland-battery-pipeline-buildout-queue-capacity-market-auctions-subsidy-grid-connection-queue',
  srmc: 'https://modoenergy.com/research/en/coal-solar-pse-tauron-enea-orlen-tge-utilities-spreads-retirement-solar-merit-gas-bess-batteries-poland-liberalised-carbon-ets-srmc',
  germany: 'https://bundesnetzagentur.de/SharedDocs/Pressemitteilungen/EN/2026/20260104_SMARD.html',
  wrapped: 'https://www.forum-energii.eu/en/2025_wrapped',
  pexapark: 'https://pexapark.com/blog/prmc-polish-solar-capture-factors-hit-new-low-as-negative-prices-and-curtailment-surge/',
  instrat: 'https://instrat.pl/wp-content/uploads/2024/01/Instrat-Policy-Paper-04-2023-Baseload-power.pdf',
  pseStrategy: 'https://xyz.pl/?p=150817',
  heat: 'https://www.argusmedia.com/de/news-and-insights/latest-market-news/2641754-narrowing-upside-for-gas-biomass-in-polish-transition',
  rybnik: 'https://www.parkiet.com/energetyka/art41546671-w-rybniku-dluzej-przy-weglu-pge-podjela-decyzje',
  ocgt: 'https://www.polimex-mostostal.pl/en/node/4798',
  belchatow: 'https://www.enerdata.net/publications/daily-energy-news/poland-will-stop-belchatow-lignite-fired-plant-between-2030-and-2036.html',
  nuclear: 'https://wnn.world-nuclear.org/articles/site-of-polish-plant-deemed-suitable',
  baltic: 'https://notesfrompoland.com/2026/07/10/polands-first-offshore-wind-farm-begins-generating-power/',
  harmony: 'https://www.pse.pl/web/pse-eng/-/pse-and-litgrid-signed-cooperation-agreement-to-build-harmony-link-interconnector-as-overland-line',
  necp: 'https://energy.instrat.pl/en/coal-brief-april-2026/',
  necpShare: 'https://www.argusmedia.com/es/news-and-insights/latest-market-news/2605262-poland-seeks-to-accelerate-decarbonisation',
  mining: 'https://notesfrompoland.com/2026/01/30/poland-to-become-eus-last-remaining-producer-of-hard-coal-as-czech-mine-closes/',
  veto: 'https://notesfrompoland.com/2025/08/21/polands-new-president-vetoes-bill-loosening-wind-turbine-law-freezing-energy-prices',
  tenh: 'https://polskieradio.pl/395/7786/artykul/3134476,president-signs-wind-farm-bill-to-help-poland-access-eu-funds',
};

// Modo Energy's 2025 average short-run cost of a Polish hard coal plant, in
// EUR/MWh: €37 of coal, €70 of carbon and €4 of running costs.
export const COAL_COST = 37 + 70 + 4;

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['End of June 2026, and 2027', 'Rybnik\'s last four 200 MW coal units stop, two at the end of June 2026 and two in 2027, once an 880 MW gas unit is running there; they were kept on at PSE\'s request to supply the grid and the city\'s heat.', 'rybnik', 'The coal ceiling on cold evenings; the gas peak rises instead.'],
  ['Autumn 2026', 'Baltic Power (1.2 GW), the first offshore wind farm, finishes; it began feeding the grid in July 2026.', 'baltic', 'The wind peak; hours with renewables over half; the winter coal floor, which only wind reaches.'],
  ['2027 to 2030', 'Batteries with capacity contracts come due: about 5.1 GW derated across the four auctions, at least 11 GW physical, against under 40 MW of grid-scale batteries running in April 2026.', 'batteries', 'The battery peak; the evening rise in coal; hours with coal under 7 GW after dark.'],
  ['31 Dec 2028', 'The EU derogation that lets Poland pay coal plants above 550 g/kWh to stay available ends; the last supplementary auction for coal is for 2028.', 'derogation', 'The coal floor and the lowest quarter hour: the first date on which the fleet has no reason to stay whole.'],
  ['2029 to 2031', 'The years PSE calls the gap: it wants the old coal units kept in a "deep reserve" after their contracts end, and only five coal units hold contracts to 2035. Consumers paid about 6.4 billion złoty for the capacity market in 2025 and about 10 billion in 2026.', 'reserve', 'Whether the floor falls or the fleet is paid to idle: coal\'s hours under 5 GW.'],
  ['2030', 'Two 600 MW open-cycle gas turbines at Rybnik and Gryfino are due to be producing by 2030, under 15-year capacity contracts that start that year.', 'ocgt', 'Fossil under 5 GW, not coal under 5 GW: the last fuel is starting to change from coal to gas.'],
  ['2030', 'Harmony Link, a second line to Lithuania, energised by the end of 2030.', 'harmony', 'The export peak, and the coal burnt while exporting.'],
  ['2030', 'The national plan adopted in April 2026 has 8.2 GW of hard coal and 6.5 GW of lignite left, from 21.8 GW and 7.6 GW; the 2024 draft\'s faster scenario had coal at about 22% of generation.', 'necp', 'Coal\'s annual total; the months with coal under half.'],
  ['2030 to 2036', 'Bełchatów\'s twelve lignite units, about 5.1 GW, close one to three a year under the 2021 plan: one in 2030 and the last in 2036.', 'belchatow', 'The lignite floor, now about 1 GW, and the lignite peak.'],
  ['2036', 'The first of three AP1000 reactors at Lubiatowo-Kopalino, with first concrete due in late 2028.', 'nuclear', 'The overnight fossil floor in winter, which neither solar nor batteries reach.'],
];

export function renderStory(data, end, installed, figs) {
  const { rows, energy, bands, bandFrom, monthly, coalLowSpell, coalFloorSpell, fossilLowSpell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? first;
  const en = (y) => energy.find((r) => r.year === y)?.twh ?? {};
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  // The last year coal never went under the low mark, and the first full year with a price.
  const noLow = [...full].reverse().find((r) => r.coalLow === 0) ?? first;
  const flat = row(2019);
  const peakPrice = row(2022);
  const leastCoal = full.reduce((a, r) => (r.coalTwh < a.coalTwh ? r : a), first);
  const neg = bands[0];
  const cheap = bands[1];
  const dear = bands.at(-1);
  const bandStart = fmtDate(at(bandFrom));
  const share = (y) => { const e = en(y); const sum = Object.values(e).reduce((a, v) => a + v, 0) - (e.imports ?? 0); return sum ? ((e.coal ?? 0) + (e.lignite ?? 0)) / sum : NaN; };
  const bat = (k) => last.batteries[k];
  const lm = last.coalMonth;
  const median = last.riseDays[Math.floor(last.riseDays.length / 2)];
  const worst = last.riseDays.at(-1);
  const floorMedian = last.floorDays[Math.floor(last.floorDays.length / 2)];
  const summerRise = last.riseDays.filter((x) => x.month >= 4 && x.month <= 9).reduce((a, x) => a + x.gwh, 0) / 1000;
  const batMax = Math.max(0, ...data.columns.battery.subarray(Math.max(0, end - 35040), end)) / 1000;
  // What else was running at the lowest coal quarter hour of the last full year.
  const mi = last.coalMinAt;
  const atMin = { lignite: data.columns.lignite[mi] / 1000, coal: data.columns.coal[mi] / 1000, gas: data.columns.gas[mi] / 1000, solar: data.columns.solar[mi] / 1000, exports: -(data.columns.exports[mi] || 0) / 1000, price: data.columns.price?.[mi] };
  const monthName = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const under50 = (y) => monthly.filter((m) => m.month.startsWith(String(y)) && m.coalPct < 50).length;

  // Header and in short.
  $('lede').textContent = `Coal made ${pc(share(last.year))} of Poland's electricity in ${last.year}, down from ${pc(share(first.year))} in ${first.year}, but it has never once run below ${gw(Math.min(...rows.map((r) => r.coalMin)))}. This page is about why that floor is there, and when it goes.`;
  $('answer-lead').textContent = `Coal still runs in Poland for three reasons, and only one of them is the market. About ${Math.round(neg.coal)} GW is kept on whatever the price, for heat, voltage and reserve, and the grid operator curtails solar around it rather than switch it off. The rest runs in the evening, when the price clears a hard coal plant's fuel and carbon with room to spare. And the fleet is paid to stay available, under contracts the EU allows until 31 December 2028. Nothing now dated takes coal to zero before the 2030s, so the records to watch are the floor, and the hours with coal under 5 GW.`;
  $('answer-points').innerHTML = [
    `<b>The floor is not a market decision.</b> When the price was below zero, Poland still ran ${gw(neg.coal)} of coal and exported ${gw(neg.exports)}. Coal's lowest quarter hour in ${last.year} was ${gw(last.coalMin)}, with ${gw(atMin.solar)} of solar running, and PSE curtailed about 1.4 TWh of wind and solar over the year. ${link(1, 'Chapters 1')} and ${link(2, '2')}`,
    `<b>The evening pays.</b> The price averaged ${eur(latest.midday)} a megawatt hour at midday and ${eur(latest.evening)} in the evening in ${named(latest.year)}, against a hard coal plant's cost of about ${eur(COAL_COST)}; coal sold at ${eur(latest.coalCapture)} on average, up from ${eur(row(2024).coalCapture)} in 2024. Consumers also paid about 6.4 billion złoty in 2025 to keep plants available. ${link(3, 'Chapter 3')}`,
    `<b>Batteries can take the evening, not the day.</b> ${bat(1).gw} GW and ${bat(1).gwh} GWh of batteries would have covered the evening rise in coal on ${bat(1).days} days of ${last.year}; ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}. Only the biggest covers the ${n0(floorMedian.gwh)} GWh a median day burns above ${COAL_FLOOR} GW, and only on ${bat(3).floorDays} days. That waits on the contracts ending in 2028, Bełchatów from 2030 and the first reactor in 2036. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-coal', `Coal burnt in ${last.year}`, twh(last.coalTwh), `against ${twh(first.coalTwh)} in ${first.year}; ${pc(last.coalExportingShare)} of it while Poland was a net exporter`],
    ['--f-lignite', `Coal's lowest quarter hour in ${last.year}`, gw(last.coalMin), `${gw(atMin.lignite)} of lignite and ${gw(atMin.coal)} of hard coal, with ${gw(atMin.solar)} of solar on and ${gw(atMin.exports)} exported`],
    ['--f-solar', `Price at ${hh(13)} and ${hh(20)}`, `${eur(latest.byHour[13])} vs ${eur(latest.byHour[20])}`, `per MWh on average in ${named(latest.year)}; a hard coal plant's fuel and carbon came to about ${eur(COAL_COST)}`],
    ['--f-coal', `Longest spell with coal under ${COAL_FLOOR} GW`, coalFloorSpell ? hrs(spellH(coalFloorSpell)) : 'None yet', coalFloorSpell ? `from ${fmtDate(at(coalFloorSpell.start))}: the record to beat` : 'coal has never been under 5 GW'],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${gw(neg.coal)}</div><div class="sub">Coal running, on average, in the ${hrs(neg.hours)} since ${bandStart} when the day-ahead price was below zero. Poland exported ${gw(neg.exports)} in those hours. In ${noLow.year} coal never went under ${COAL_LOW} GW at any price.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: when coal runs, the floor that ignores the price, the evening that pays for it, what batteries could and could not replace, and what is coming, with the record each item should move.';

  const chapters = [
    'Coal runs all day, and least at noon',
    'The floor ignores the price',
    'The evening pays coal more each year',
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
  const yearColors = ['--f-other', '--f-gas', '--f-coal', '--fossil'];

  // Chapter 1: when coal runs.
  $('take-1').textContent = `Coal averaged ${gw(last.coalHour[12])} at ${hh(12)} and ${gw(last.coalHour[19])} at ${hh(19)} in ${last.year}, and ${gw(last.coalWindHi)} even when wind was over ${WIND_HIGH} GW. It spent ${hrs(last.coalLow)} under ${COAL_LOW} GW, ${pc(last.coalLowSunShare)} of them with the sun up.`;
  $('body-1').innerHTML = `Poland's last fossil fuel is two fuels: hard coal from Silesia and lignite dug beside the plants that burn it, above all at Bełchatów. Together they made ${twh(last.coalTwh)} in ${last.year}, against ${twh(first.coalTwh)} in ${first.year}, and ${twh(en(last.year).gas ?? 0)} of gas is now the third fossil fuel and growing. Coal is not a peaking plant. In ${last.year} it averaged ${gw(last.coalHour[3])} at ${hh(3)}, ${gw(last.coalHour[12])} at ${hh(12)} and ${gw(last.coalHour[19])} at ${hh(19)}; in ${flat.year} the same hours were ${gw(flat.coalHour[3])}, ${gw(flat.coalHour[12])} and ${gw(flat.coalHour[19])}. Solar has taken the middle of the day: coal averaged ${gw(last.coalSolarHi)} when solar was over ${SOLAR_HIGH} GW. Wind takes less: ${gw(last.coalWindHi)} when wind was over ${WIND_HIGH} GW against ${gw(last.coalWindLo)} when it was under ${WIND_LOW} GW. By month, lignite moves less (${twh(Math.min(...last.ligMonth))} to ${twh(Math.max(...last.ligMonth))} a month in ${last.year}) and hard coal carries the winter: coal as a whole burnt ${twh(lm[0])} in January against ${twh(Math.min(...lm.slice(3, 9)))} in the lowest summer month, and ${pc(last.coalWinterShare)} of the year's coal from November to March. The floor has fallen from ${gw(first.coalMin)} in ${first.year} to ${gw(last.coalMin)} in ${last.year}, and the ceiling from ${gw(first.coalMax)} to ${gw(last.coalMax)}. Coal was under ${COAL_LOW} GW for ${hrs(last.coalLow)} in ${last.year}, none in ${noLow.year}, and under ${COAL_FLOOR} GW for ${hrs(last.coalLow5)}.${coalLowSpell ? ` The longest spell under ${COAL_LOW} GW is ${hrs(spellH(coalLowSpell))}, from ${fmtDate(at(coalLowSpell.start))}.` : ''} ${pc(last.coalExportingShare)} of ${last.year}'s coal was burnt while Poland was a net exporter, so some of it ran for the neighbours; the next chapter is about the part that runs for nobody.`;
  $('chart-h-1').textContent = 'Coal by hour of day';
  $('chart-hint-1').textContent = 'Average hard coal and lignite output for each hour of the day, Polish time, in GW. Lignite alone, and the average price, are in the tooltip. The thick line is the latest 365 days.';
  const coalYears = [flat.year, peakPrice.year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const coalLines = coalYears.map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).coalHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-1'), {
    series: coalLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    refLines: [{ value: COAL_LOW, color: css('--ink-3') }],
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b> (lignite ${gw(row(v.series.year).ligHour[hr])}${Number.isFinite(row(v.series.year).byHour[hr]) ? `, ${eur(row(v.series.year).byHour[hr])}/MWh` : ''})</div>`).join('')}`;
    },
  });
  $('story-legend-1').innerHTML = `${legend(coalLines.map((sr) => [sr.name, sr.color]))}<span>Line: ${COAL_LOW} GW</span>`;

  // Chapter 2: the floor and the price bands.
  $('take-2').textContent = `When the price is below zero, Poland still runs ${gw(neg.coal)} of coal and exports ${gw(neg.exports)}: units kept on for heat, voltage and reserve, with solar curtailed around them.`;
  $('body-2').innerHTML = `Since ${bandStart} the price has been below zero for ${hrs(neg.hours)} and between zero and €50 for another ${hrs(cheap.hours)}. In those hours coal averaged ${gw(neg.coal)} and ${gw(cheap.coal)}, about ${gw(neg.lignite)} of it lignite, and Poland exported ${gw(neg.exports)} and ${gw(cheap.exports)} net. At €200 and above coal averaged ${gw(dear.coal)}. At its lowest quarter hour of ${last.year}, ${fmtDate(at(mi))}, coal was ${gw(last.coalMin)}: ${gw(atMin.lignite)} of lignite and ${gw(atMin.coal)} of hard coal, with ${gw(atMin.gas)} of gas, ${gw(atMin.solar)} of solar and ${gw(atMin.exports)} exported${Number.isFinite(atMin.price) ? `, at ${eur(atMin.price)} a megawatt hour` : ''}. That floor is not bought on the day-ahead market. Part of it is heat: coal was still more than two thirds of the fuel burnt by district heating plants in 2022 (${src(SOURCES.heat, 'Argus')}), and PGE kept Rybnik's coal units on past their closing date to keep the city warm and at PSE's request (${src(SOURCES.rybnik, 'Parkiet')}). Part of it is the grid: Instrat found almost 8 GW of mostly coal-fired plant still online on sunny Sundays in April 2023 while solar was being curtailed, and says the main reason coal runs continuously is system stability (${src(SOURCES.instrat, 'Instrat')}); PSE's strategy to 2040 says the coal units still set the grid's inertia and voltage, that synchronous condensers, some built from retired coal units, and renewables and storage running in grid-forming mode will take that over, and that the grid should be able to run without coal and gas by 2035 (${src(SOURCES.pseStrategy, 'XYZ')}). How much of the ${gw(neg.coal)} is heat and how much is grid support is not published; our reading, inferred and not a published split, is that the lignite is mostly grid support, since Bełchatów sells no heat, and the hard coal is mostly heat and reserve, since the coal cogeneration plants sit in the cities. Either way, the clean power gives way instead. PSE curtailed about 1.4 TWh of wind and solar in 2025, twice 2024's total, almost all of it for balancing rather than grid congestion (${src(SOURCES.wrapped, 'Forum Energii')}); April 2025 alone saw 223 GWh of solar curtailed over 25 days (${src(SOURCES.pexapark, 'Pexapark')}). The price was below zero for ${hrs(last.negHours)} in ${last.year}, up from ${hrs(row(2023).negHours)} in 2023.`;
  $('chart-h-2').textContent = 'What runs when the price says stop';
  $('chart-hint-2').textContent = `Average output by day-ahead price, in GW, since ${bandStart}. The hours in each band, and net exports, are in the tooltip.`;
  const bandParts = [['lignite', 'Lignite', '--f-lignite'], ['hardCoal', 'Hard coal', '--f-coal'], ['gas', 'Gas', '--f-gas'], ['wind', 'Wind', '--f-wind'], ['solar', 'Solar', '--f-solar']];
  const bandStacks = bandParts.map(([k, name, color]) => ({ name, color: css(color), values: bands.map((b) => (k === 'hardCoal' ? b.coal - b.lignite : b[k])) }));
  barChart($('story-chart-2'), {
    cats: bands.map((b) => b.label),
    stacks: bandStacks,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => ci === 0,
    tooltip: (ci) => `<strong>${bands[ci].label} per MWh</strong><div>${hrs(bands[ci].hours)}</div>${[...bandStacks].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${gw(s.values[ci])}</b></div>`).join('')}<div>Net exports: <b>${gw(bands[ci].exports)}</b></div>`,
  });
  $('story-legend-2').innerHTML = legend([...bandStacks].reverse().map((s) => [s.name, s.color]));

  // Chapter 3: the economics.
  const duckYears = [flat.year, peakPrice.year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y) && Number.isFinite(row(y).price));
  $('take-3').textContent = `Midday fell to ${eur(latest.midday)} and the evening rose to ${eur(latest.evening)}, against a hard coal plant's cost of about ${eur(COAL_COST)}: coal runs fewer hours and sells each one for more, and consumers pay it to stay available on top.`;
  $('body-3').innerHTML = `A hard coal plant cost about ${eur(COAL_COST)} a megawatt hour to run in 2025: €37 of coal, €70 of carbon and €4 of running costs, with carbon's share of the cost up from 43% in 2020 to 63% (${src(SOURCES.srmc, 'Modo Energy')}). The price now crosses that line twice a day. In ${flat.year} the average from ${hh(MIDDAY[0])} to ${hh(MIDDAY[1] + 1)} was ${eur(flat.midday)} and from ${hh(EVENING[0])} to ${hh(EVENING[1] + 1)} it was ${eur(flat.evening)}, a flat day. In ${named(latest.year)} midday averaged ${eur(latest.midday)}, below the cost of coal, and the evening ${eur(latest.evening)}, well above it. Solar sold at an average ${eur(latest.solarCapture)} and coal at ${eur(latest.coalCapture)}, up from ${eur(row(2024).coalCapture)} in 2024. Poland's ${last.year} average of ${eur(last.price)} compares with €89 in Germany (${src(SOURCES.germany, 'Bundesnetzagentur')}): the evening is a coal price, set by a coal plant's carbon. The market is not the only payment. Coal and lignite units, nearly all above the EU's 550 g/kWh limit, have been shut out of the main capacity auctions since December 2021, but the Commission let Poland hold supplementary one-year auctions for them from 1 July 2025 to the end of 2028 (${src(SOURCES.derogation, 'Energies Media')}); the September 2026 auction for 2027 bought about 7.5 GW, mostly existing coal and gas, at 325,550 złoty per megawatt a year (${src(SOURCES.auction2027, 'Modo Energy')}). The capacity market cost consumers about 6.4 billion złoty in 2025 and is expected to cost about 10 billion in 2026 (${src(SOURCES.reserve, 'PAP via Bankier')}). So a coal unit that loses money at noon is paid to be there in the evening, and the evening price pays it again.`;
  $('chart-h-3').textContent = 'The price by hour of day';
  $('chart-hint-3').textContent = `The average day-ahead price for each hour of the day, Polish time, in euros per MWh. The line marks a hard coal plant's 2025 cost of about ${eur(COAL_COST)}.`;
  const duck = duckYears.map((y, k) => ({ name: title(y), color: css(yearColors[k]), points: row(y).byHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-3'), {
    series: duck,
    yMin: 0,
    yFormat: (v) => eur(v),
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    refLines: [{ value: COAL_COST, color: css('--ink-3') }],
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? `${eur(v.value)}/MWh` : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-3').innerHTML = `${legend(duck.map((s) => [s.name, s.color]))}<span>Line: ${eur(COAL_COST)}/MWh</span>`;

  // Chapter 4: battery sizing.
  $('take-4').textContent = `${bat(1).gw} GW and ${bat(1).gwh} GWh of batteries would have covered the evening rise in coal on ${bat(1).days} days of ${last.year}; ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}. The whole day's coal above ${COAL_FLOOR} GW is another matter: ${bat(3).floorDays} days for the biggest fleet.`;
  $('body-4').innerHTML = `What a battery can do in Poland is move the midday surplus to the evening. So take each day of ${last.year}, find coal's lowest point between ${hh(DAYTIME[0])} and ${hh(DAYTIME[1] + 1)}, and add up the coal above that low from then until midnight: the evening rise. It came to ${twh(last.riseTwh)} over the year, ${twh(summerRise)} of it from April to September. The median day rose ${n0(median.gwh)} GWh with a peak of ${gw(median.peak)}; the worst rose ${n0(worst.gwh)} GWh and ${gw(worst.peak)}. Against those days, ${last.batteries.map((b, i) => (i ? `${i === last.batteries.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh ${b.days}` : `${b.gw} GW and ${b.gwh} GWh of batteries would have covered ${b.days} days`)).join(', ')}, if they were full; the day's own solar was enough to fill them on ${bat(1).charged} and ${bat(3).charged} of those. Poland added 0.4 GW of storage in 2025, much of it in homes (${src(SOURCES.wrapped, 'Forum Energii')}); under 40 MW of grid-scale batteries was running by April 2026, and the data shows a battery peak of ${gw(batMax)} so far. The contracts are far bigger: storage won 1.7 GW of capacity obligations for 2028 in the December 2023 auction (${src(SOURCES.auction2028, 'Forum Energii')}), and the four auctions for 2027 to 2030 together hold about 5.1 GW of derated battery capacity, at least 11 GW physical (${src(SOURCES.batteries, 'Modo Energy')}). That contracted fleet is nearer the top line on the chart than the second. What it barely touches is the block underneath. Coal above the ${COAL_FLOOR} GW floor came to ${twh(last.floorTwh)} in ${last.year}, and the median day burnt ${n0(floorMedian.gwh)} GWh above the floor: ${bat(3).gw} GW and ${bat(3).gwh} GWh would have covered the whole day on ${bat(3).floorDays} days, ${bat(2).gw} GW and ${bat(2).gwh} GWh on ${bat(2).floorDays}, and the smaller fleets on none. Batteries can end the evening rise and lengthen the spells under ${COAL_LOW} GW into the night. The daytime block, and the floor under it, wait on the other dates: wind, the contracts, Bełchatów and the first reactor.`;
  $('chart-h-4').textContent = `Each day of ${last.year}, by the evening rise in coal`;
  $('chart-hint-4').textContent = `Each day's coal above its daytime low, from that low until midnight, in GWh, sorted from smallest to largest. The lines mark what ${BATTERIES.map((b) => b[1]).join(', ')} GWh of batteries could supply; days below a line are covered, if the batteries could charge.`;
  const dayX = (k) => k * 864e5;
  const sorted = [{ name: 'Evening rise in coal', color: css('--f-coal'), points: last.riseDays.map((x, k) => [dayX(k), x.gwh]), width: 2.5 }];
  lineChart($('story-chart-4'), {
    series: sorted,
    yMin: 0,
    yFormat: (v) => `${n0(v)} GWh`,
    yTickFormat: (v) => n0(v),
    xTicks: [0, 60, 120, 180, 240, 300, 360].filter((k) => k < last.riseDays.length).map((k) => ({ t: dayX(k), label: `${k}` })),
    refLines: last.batteries.map((b) => ({ value: b.gwh, color: css('--ink-3') })),
    tooltip: (t) => {
      const k = Math.round(t / 864e5);
      const x = last.riseDays[k];
      return x ? `<strong>Day ${k + 1} of ${last.riseDays.length}</strong><div>Evening rise: <b>${n0(x.gwh)} GWh</b></div><div>Peak above the low: <b>${gw(x.peak)}</b></div><div>Solar that day: <b>${n0(x.solar)} GWh</b></div><div>Month: <b>${monthNames[x.month - 1]}</b></div>` : '';
    },
  });
  $('story-legend-4').innerHTML = `${legend(sorted.map((sr) => [sr.name, sr.color]))}<span>Lines: ${last.batteries.map((b) => `${b.gwh} GWh`).join(', ')}</span>`;

  // Chapter 5: what's coming.
  const lowMonth = monthly.reduce((a, m) => (m.coalPct < a.coalPct ? m : a), monthly[0]);
  $('take-5').textContent = 'Coal\'s capacity payments end on 31 December 2028, Bełchatów starts closing in 2030 and the first reactor is due in 2036, but PSE wants the old units kept in reserve and gas is being built to replace them.';
  $('body-5').innerHTML = `The dated items are listed below, each with the record it should move. The first date that matters is 31 December 2028, when the EU derogation that lets Poland pay coal plants to stay available runs out (${src(SOURCES.derogation, 'Energies Media')}). PSE's answer is to keep the old units in a "deep reserve" rather than close them, since only five coal units hold contracts to 2035, and the gas to replace them is being bought now: the December 2025 auction for 2030 gave 15-year contracts to three 600 MW gas plants, and batteries cleared at 465 złoty per kilowatt a year (${src(SOURCES.reserve, 'PAP via Bankier')}, ${src(SOURCES.auction2030, 'ESS News')}). The national plan adopted in April 2026 leaves 8.2 GW of hard coal and 6.5 GW of lignite in 2030, from 21.8 GW and 7.6 GW now (${src(SOURCES.necp, 'Instrat')}); the draft plan's faster scenario, from September 2024, had coal at about 22% of generation by then (${src(SOURCES.necpShare, 'Argus')}). Poland is now the EU's last hard coal miner, under a 2020 agreement with the unions that closes the mines by 2049 (${src(SOURCES.mining, 'Notes from Poland')}). The politics still shows in what was built: solar went from ${gw(installed?.types['Solar AC']?.[installed.years.indexOf(2019)] ?? NaN)} in 2019 to ${gw(installed?.types['Solar AC']?.at(-1) ?? NaN)} at the end of ${installed?.years.at(-1) ?? ''} with no law to help it, while onshore wind was frozen by the 2016 rule keeping turbines ten times their height from homes until it was eased to 700 metres in March 2023 (${src(SOURCES.tenh, 'Polskie Radio')}), and the president vetoed a cut to 500 metres in August 2025 (${src(SOURCES.veto, 'Notes from Poland')}). Coal's lowest month so far was ${monthName(lowMonth.month)}, at ${pct(lowMonth.coalPct)}, and it was under half of generation in ${under50(last.year)} months of ${last.year}. Hours with coal under ${COAL_LOW} GW went from none in ${noLow.year} to ${hrs(last.coalLow)} in ${last.year}; hours under ${COAL_FLOOR} GW from none to ${hrs(last.coalLow5)}${fossilLowSpell ? `, and the longest spell with all fossil fuels under ${COAL_LOW} GW is ${hrs(spellH(fossilLowSpell))}` : ''}. Those are the counts to watch, and the one after them is fossil under 5 GW rather than coal, because the gas being built to replace coal will set the next floor.`;
  $('chart-h-5').textContent = `Hours a year with coal under ${COAL_LOW} GW`;
  $('chart-hint-5').textContent = `Hours each year with hard coal and lignite together under ${COAL_LOW} GW. Hours under ${COAL_FLOOR} GW and the lowest quarter hour are in the tooltip. The last bar is the latest 365 days.`;
  const ch5 = [{ name: `Coal under ${COAL_LOW} GW`, color: css('--lowcarbon'), values: rows.map((r) => r.coalLow) }];
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under ${COAL_LOW} GW: <b>${n0(rows[ci].coalLow)}</b></div><div>Hours under ${COAL_FLOOR} GW: <b>${n0(rows[ci].coalLow5)}</b></div><div>Lowest coal: <b>${gw(rows[ci].coalMin)}</b></div><div>Coal: <b>${twh(rows[ci].coalTwh)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--f-coal)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
