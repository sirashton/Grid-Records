// The Texas story: why ERCOT still burns gas after building more wind, solar
// and batteries than any other US grid. Demand has grown about as fast as the
// clean power, so gas has held level; what has changed is when it runs. It
// now backs off at noon and peaks after sunset, and the evening peak is where
// batteries have started to take its place.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import tx from '../countries/tx.js';
import { FOSSIL, GENERATION, metricSeries, byYear } from './data.js';

// Local hours the story compares: noon 10:00-14:59, evening 19:00-21:59,
// night 00:00-05:59.
const NOON = [10, 14];
const EVENING = [19, 21];
const NIGHT = [0, 5];
// The months a year is compared over, so the part year can join in: January to
// September.
const PART_MONTHS = 9;
// Fossil levels the story counts hours under, in GW.
export const FOSSIL_LOW = [10, 15, 20];
// Battery fleets (GW, GWh) the story tests against each day's evening hump.
export const BATTERIES = [[20, 40], [30, 80], [40, 120], [60, 240]];

/**
 * Local hour, month and day number for every slot. The Central offset is
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
      offset = tzOffsetMs(d * 864e5 + 432e5, tx.timeZone);
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
const inside = (h, [a, b]) => h >= a && h <= b;
const HOURLY = ['gas', 'coal', 'solar', 'wind', 'other', 'fossil', 'gen'];

/**
 * Every number the story uses. Rows run by Texas calendar year, complete
 * years only, then 'past365' for the latest 365 days. `part` holds January to
 * September of every year, the current one included.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const fossil = metricSeries(d, FOSSIL);
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const { gas, coal, solar, wind, other, nuclear } = data.columns;
  const { hour, month, day } = localClock(d);
  const gen = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    let g = 0;
    let any = false;
    for (const col of genCols) if (!Number.isNaN(col[i])) { g += Math.max(0, col[i]); any = true; }
    gen[i] = any ? g / 1000 : NaN;
  }
  const at = { gas, coal, solar, wind, other };
  const gwAt = (k, i) => (k === 'fossil' ? fossil[i] : k === 'gen' ? gen[i] : (at[k][i] || 0) / 1000);

  const init = () => ({
    twh: { gas: 0, coal: 0, solar: 0, wind: 0, nuclear: 0, other: 0, fossil: 0, gen: 0 },
    hourSum: Object.fromEntries(HOURLY.map((k) => [k, new Float64Array(24)])),
    hourN: new Float64Array(24),
    fosMonth: new Float64Array(12),
    fosMin: Infinity, fosMinAt: -1, fosMax: 0, fosMaxAt: -1,
    otherMax: 0, otherMaxAt: -1, solarMax: 0, solarMaxAt: -1,
    under: FOSSIL_LOW.map(() => 0),
    days: [], day: null,
  });
  const add = (r, i) => {
    const f = fossil[i];
    if (Number.isNaN(f)) return;
    const h = hour[i];
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(r.day);
      r.day = { n: day[i], month: month[i], noonMin: Infinity, fos: new Float64Array(24), fosN: new Float64Array(24) };
    }
    r.day.fos[h] += f;
    r.day.fosN[h]++;
    if (inside(h, NOON) && f < r.day.noonMin) r.day.noonMin = f;
    r.twh.fossil += (f * slotH) / 1000;
    r.twh.gen += (gen[i] * slotH) / 1000;
    for (const k of ['gas', 'coal', 'solar', 'wind', 'other']) r.twh[k] += ((at[k][i] || 0) * slotH) / 1e6;
    r.twh.nuclear += ((nuclear[i] || 0) * slotH) / 1e6;
    for (const k of HOURLY) r.hourSum[k][h] += gwAt(k, i);
    r.hourN[h]++;
    r.fosMonth[month[i] - 1] += (f * slotH) / 1000;
    if (f < r.fosMin) { r.fosMin = f; r.fosMinAt = i; }
    if (f > r.fosMax) { r.fosMax = f; r.fosMaxAt = i; }
    const o = (other[i] || 0) / 1000;
    if (o > r.otherMax) { r.otherMax = o; r.otherMaxAt = i; }
    const s = (solar[i] || 0) / 1000;
    if (s > r.solarMax) { r.solarMax = s; r.solarMaxAt = i; }
    FOSSIL_LOW.forEach((lv, k) => { if (f < lv) r.under[k] += slotH; });
  };
  const finish = (r) => {
    const days = (r.day ? [...r.days, r.day] : r.days).filter((x) => Number.isFinite(x.noonMin) && x.fosN.every((n) => n));
    // Each day's evening hump: fossil above that day's lowest midday level,
    // from 15:00 to midnight, in GWh, and its peak in GW. What a battery
    // charged at noon would have had to supply to hold fossil at its noon level.
    const humps = days.map((x) => {
      let gwh = 0;
      let peak = 0;
      for (let h = 15; h < 24; h++) {
        const above = Math.max(0, x.fos[h] / x.fosN[h] - x.noonMin);
        gwh += above;
        if (above > peak) peak = above;
      }
      return { gwh, peak, month: x.month, noon: x.noonMin };
    }).sort((a, b) => a.gwh - b.gwh);
    const hourly = Object.fromEntries(HOURLY.map((k) => [k, [...r.hourSum[k]].map((v, h) => mean(v, r.hourN[h]))]));
    const band = (k, hrs) => {
      let s = 0;
      let n = 0;
      for (let h = hrs[0]; h <= hrs[1]; h++) { s += r.hourSum[k][h]; n += r.hourN[h]; }
      return mean(s, n);
    };
    return {
      year: r.year,
      twh: r.twh,
      fosShare: r.twh.fossil / r.twh.gen,
      gasShare: r.twh.gas / r.twh.gen,
      coalShare: r.twh.coal / r.twh.gen,
      hourly,
      noon: Object.fromEntries(['gas', 'coal', 'fossil', 'gen', 'solar', 'other', 'wind'].map((k) => [k, band(k, NOON)])),
      evening: Object.fromEntries(['gas', 'coal', 'fossil', 'gen', 'solar', 'other', 'wind'].map((k) => [k, band(k, EVENING)])),
      night: Object.fromEntries(['gas', 'coal', 'fossil', 'gen', 'solar', 'other', 'wind'].map((k) => [k, band(k, NIGHT)])),
      fosMonth: [...r.fosMonth],
      fosMin: r.fosMin, fosMinAt: r.fosMinAt, fosMax: r.fosMax, fosMaxAt: r.fosMaxAt,
      otherMax: r.otherMax, otherMaxAt: r.otherMaxAt, solarMax: r.solarMax, solarMaxAt: r.solarMaxAt,
      under: r.under,
      days: humps.length,
      humps,
      medianHump: humps[Math.floor(humps.length / 2)] ?? null,
      batteries: BATTERIES.map(([gw, gwh]) => ({ gw, gwh, days: humps.filter((x) => x.gwh <= gwh && x.peak <= gw).length })),
    };
  };
  const rows = byYear(d, init, add).map(finish);

  // January to September of each year, so the year in progress can be compared.
  const part = new Map();
  for (let i = 0; i < end; i++) {
    if (month[i] > PART_MONTHS) continue;
    const y = new Date(day[i] * 864e5).getUTCFullYear();
    if (!part.has(y)) part.set(y, { gas: 0, coal: 0, fossil: 0, gen: 0, solar: 0, wind: 0, other: 0, n: 0 });
    const p = part.get(y);
    const f = fossil[i];
    if (Number.isNaN(f)) continue;
    p.n++;
    p.fossil += (f * slotH) / 1000;
    p.gen += (gen[i] * slotH) / 1000;
    for (const k of ['gas', 'coal', 'solar', 'wind', 'other']) p[k] += ((at[k][i] || 0) * slotH) / 1e6;
  }
  // Only years with every quarter hour from January to September (about 26,000).
  const partRows = [...part].filter(([, p]) => p.n >= 0.99 * 273 * 24 / slotH).map(([year, p]) => ({ year, ...p }));

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: tx.timeZone };
  return {
    rows,
    part: partRows,
    fossil10Spell: spellOf(summarise(fossil, 10, 'below', opts)),
    fossil15Spell: spellOf(summarise(fossil, 15, 'below', opts)),
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const gw = (v) => `${v.toFixed(1)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const peakHour = (arr, from = 0, to = 23) => { let k = from; for (let h = from; h <= to; h++) if (arr[h] > arr[k]) k = h; return k; };
const lowHour = (arr, from = 0, to = 23) => { let k = from; for (let h = from; h <= to; h++) if (arr[h] < arr[k]) k = h; return k; };

const SOURCES = {
  modoAnnual: 'https://modoenergy.com/research/ercot-battery-buildout-2025-annual-report',
  modoQ1: 'https://modoenergy.com/research/ercot-bess-buildout-15-gw-q1-2026-engie-tesla-constellation',
  gridstatus: 'https://blog.gridstatus.io/ercot-record-july-2026/',
  eiaMidday: 'https://www.eia.gov/todayinenergy/detail.cfm?id=66464',
  eiaSolarCoal: 'https://www.eia.gov/todayinenergy/detail.php?id=67685',
  energyOnly: 'https://www.ercot.com/files/docs/2025/10/16/ERCOT-Grid-Insights-Energy-Only-Wholesale-Market.pdf',
  swcap: 'https://www.ercot.com/files/docs/2026/09/07/15-Summer-2026-Operational-and-Market-Review.pdf',
  imm: 'https://www.ercot.com/files/docs/2026/08/06/2026-08-SoM-for-TAC-JDMc.pdf',
  dallasFed2025: 'https://dallasfed.org/research/economics/2025/0114',
  dallasFedBatteries: 'https://www.dallasfed.org/research/economics/2025/1104-golding-grid',
  yesEnergy: 'https://www.yesenergy.com/blog/6-months-in-review-ercot-rtcb',
  waha: 'https://pgjonline.com/news/2026/march/permian-pipeline-constraints-push-waha-gas-prices-negative-for-25th-straight-day',
  heatRate: 'https://www.eia.gov/electricity/annual/html/epa_08_01.html',
  coalFleet: 'https://www.cleanview.co/power-projects/operating/coal-power-plants/ercot',
  coleto: 'https://investor.vistracorp.com/2024-05-30-Vistra-Announces-Plans-to-Add-Up-to-2,000-MW-of-Gas-Fueled-Dispatchable-Power-in-ERCOT',
  spruce: 'https://www.gem.wiki/Spruce_Station',
  rmr: 'https://sanantonioreport.org/cps-energy-has-said-it-will-stop-burning-coal-by-2030-will-ercot-allow-it/',
  tef: 'https://dallasexpress.com/state/texas-energy-fund-buildout-tops-5400-mw-with-new-pecos-power-plant-loan/',
  pinOak: 'https://www.industrialinfo.com/news/article/first-texas-energy-fund-backed-generation-project-comes-online--357765',
  cpv: 'https://www.latitudemedia.com/news/how-the-data-center-boom-brought-down-the-texas-energy-fund',
  hb1500: 'https://pv-magazine-usa.com/2023/05/30/texas-sunset-bill-softens-the-blow-from-anti-renewables-changes/',
  queue: 'https://www.ercot.com/files/docs/2026/09/16/ERCOT-Monthly-Operational-Overview-August-2026.pdf',
  peak: 'https://www.ercot.com/files/docs/2026/09/14/13-CEO-Update-REVISED.pdf',
  forecast: 'https://www.ercot.com/files/docs/2026/04/15/12-CEO-Update.pdf',
  permian: 'https://www.utilitydive.com/news/oncor-lcra-propose-up-to-244-miles-of-765-kv-texas-transmission/816207/',
};

// Rough fuel cost of the average Texas gas plant in 2025: the market
// monitor's $3.06/MMBtu ERCOT gas price at the EIA's 2024 gas fleet heat rate
// of 7,754 Btu/kWh. An estimate, not a market figure.
export const GAS_FUEL_COST = 3.06 * 7.754;

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['2026', 'Solar generation passes coal in ERCOT for the year, 78 against 60 billion kWh in the EIA\'s forecast.', 'eiaSolarCoal', 'Yearly solar against coal TWh.'],
  ['1 Jan 2027', 'HB 1500\'s firming rule applies to renewables that sign interconnection agreements from this date. Batteries count towards it.', 'hb1500', 'The evening battery average and the highest battery quarter hour.'],
  ['2027', 'Coleto Creek (622 MW) stops burning coal and is repowered with gas.', 'coleto', 'Coal TWh, and the hours with coal under 3 GW.'],
  ['2026 to 2028', 'The Texas Energy Fund\'s nine 20-year, 3% loans for 5,446 MW of gas plants come online: Pin Oak (460 MW) on 5 May 2026, most of the rest in 2027 and 2028, CPV West Texas (1,350 MW) the largest.', 'tef', 'Evening and night-time fossil GW: new gas plants work against them falling.'],
  ['2028', 'J K Spruce unit 1 (CPS Energy) retires and unit 2 converts from coal to gas. ERCOT can hold a unit on under a reliability-must-run contract.', 'spruce', 'Coal TWh; the lowest fossil quarter hour.'],
  ['2030', 'Modo Energy projects 36 GW of batteries, from 14.96 GW and 24.6 GWh at the end of March 2026. The connection queue held 164 GW of batteries in August 2026.', 'modoQ1', 'Days with the evening hump flattened; the evening fossil peak.'],
  ['2030', 'The first 765 kV line of the Permian plan is due to be energised, carrying more West Texas wind and solar east.', 'permian', 'Night-time fossil GW and the hours with fossil under 15 GW.'],
  ['2032', 'ERCOT\'s preliminary forecast reaches about 368 GW of peak demand, mostly data-centre requests; its core forecast without them is 111 GW, against a record of 91.1 GW in July 2026.', 'forecast', 'Yearly fossil TWh: whether growth keeps outrunning wind and solar.'],
];

export function renderStory(data, end, figs) {
  const { rows, part, fossil10Spell, fossil15Spell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? first;
  const y19 = row(2019);
  const y23 = row(2023);
  const y24 = row(2024);
  const p = (y) => part.find((r) => r.year === y) ?? part[0];
  const pNow = part.at(-1);
  const p19 = p(2019);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const lowestYear = full.reduce((a, r) => (r.fosMin < a.fosMin ? r : a), first);
  const bat = (k) => last.batteries[k];
  const g19 = y19.hourly.gas;
  const gL = last.hourly.gas;
  const lo19 = lowHour(g19);
  const hi19 = peakHour(g19);
  const loL = lowHour(gL, 6, 18);
  const hiL = peakHour(gL);
  const lm = last.fosMonth;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const maxM = lm.indexOf(Math.max(...lm));
  const minM = lm.indexOf(Math.min(...lm));
  const allYears = rows.filter((r) => r.year === 'past365' || r.year >= 2019);
  const otherMax = rows.reduce((a, r) => (r.otherMax > a.otherMax ? r : a), first);

  // Header and in short.
  $('lede').textContent = `Texas burns about as much gas and coal as it did in ${first.year}: wind and solar took all the growth in demand, and gas moved its shift from the afternoon to the night.`;
  $('answer-lead').textContent = `Fossil power still runs in Texas because demand keeps growing and nothing yet covers the hours after sunset: gas and coal made ${twh(first.twh.fossil)} in ${first.year} and ${twh(last.twh.fossil)} in ${last.year}, while wind and solar met all the growth. Batteries are now taking the evening peak, but even ${bat(3).gw} GW and ${bat(3).gwh} GWh of them would leave fossil at its noon level of about ${Math.round(last.noon.fossil)} GW. The records to watch are the evening battery peak, night-time fossil and whether the yearly fossil total finally falls.`;
  $('answer-points').innerHTML = [
    `<b>Fossil flat, demand up.</b> Total generation rose from ${twh(first.twh.gen)} in ${first.year} to ${twh(last.twh.gen)} in ${last.year}; fossil stayed near ${Math.round(last.twh.fossil / 10) * 10} TWh. From January to September it was ${twh(p19.fossil)} in 2019 and ${twh(pNow.fossil)} in ${pNow.year}. ${link(1, 'Chapter 1')}`,
    `<b>Gas changed shift.</b> Fossil at midday fell from ${gw(y19.noon.fossil)} in 2019 to ${gw(last.noon.fossil)} in ${last.year} as solar arrived, but rose from ${gw(y19.evening.fossil)} to ${gw(last.evening.fossil)} in the evening and from ${gw(y19.night.fossil)} to ${gw(last.night.fossil)} at night. In an energy-only market with gas fuel at roughly $${Math.round(GAS_FUEL_COST)} a megawatt hour, gas runs whenever the sun is down. ${link(2, 'Chapters 2')} and ${link(3, '3')}`,
    `<b>Batteries take the evening, not the night.</b> Batteries and other averaged ${gw(latest.evening.other)} from ${hh(EVENING[0])} to ${hh(EVENING[1] + 1)} in the latest 365 days and reached ${gw(otherMax.otherMax)}. ${bat(1).gw} GW and ${bat(1).gwh} GWh would have flattened the evening hump on ${bat(1).days} days of ${last.year}; the nights need something else. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--fossil', `Fossil generation, January to September ${pNow.year}`, twh(pNow.fossil), `against ${twh(p19.fossil)} in 2019, while total generation rose from ${twh(p19.gen)} to ${twh(pNow.gen)}`],
    ['--f-gas', `Gas at ${hh(hiL)} and ${hh(loL)} in ${last.year}`, `${gw(gL[hiL])} vs ${gw(gL[loL])}`, `the day's high and its midday low; in 2019 gas peaked at ${hh(hi19)}`],
    ['--f-battery', 'Highest quarter hour of batteries and other', gw(otherMax.otherMax), `at ${fmtDate(at(otherMax.otherMaxAt))}; ${gw(y23.evening.other)} on average in the evening in 2023`],
    ['--fossil', 'Longest spell with fossil under 10 GW', fossil10Spell ? hrs(spellH(fossil10Spell)) : 'None', fossil10Spell ? `from ${fmtDate(at(fossil10Spell.start))}: the record to beat` : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${twh(last.twh.fossil)}</div><div class="sub">Fossil generation on the ERCOT grid in ${last.year}, against ${twh(first.twh.fossil)} in ${first.year}. Total generation grew from ${twh(first.twh.gen)} to ${twh(last.twh.gen)} over the same years, and wind and solar covered the growth.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: clean power that covered the growth, gas that changed shift, who pays it, what batteries can and cannot replace, and what is coming, with the record each item should move.';

  const chapters = [
    'Clean power covered the growth, not the base',
    'Gas has changed shift',
    'Who pays, and why gas still runs',
    'Batteries can flatten the evening, not remove the base',
    'What is coming, and the records to watch',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const yearColors = ['--f-other', '--f-wind', '--f-gas', '--f-coal'];

  // Chapter 1: fossil flat, generation up.
  $('take-1').textContent = `Texas made ${twh(last.twh.fossil)} from gas and coal in ${last.year}, against ${twh(first.twh.fossil)} in ${first.year}: wind and solar met the new demand rather than replacing old plants.`;
  $('body-1').innerHTML = `In ${first.year} ERCOT's plants generated ${twh(first.twh.gen)}, ${twh(first.twh.fossil)} of it from gas and coal, ${pc(first.fosShare)}. In ${last.year} they generated ${twh(last.twh.gen)}, and gas and coal supplied ${twh(last.twh.fossil)}, ${pc(last.fosShare)}. The share fell because the total grew; the fossil figure barely moved. Wind rose from ${twh(first.twh.wind)} to ${twh(last.twh.wind)} and solar from nothing to ${twh(last.twh.solar)}, while nuclear held near ${Math.round(last.twh.nuclear)} TWh. Inside the fossil total, coal fell from ${twh(first.twh.coal)} to ${twh(last.twh.coal)} and gas rose from ${twh(first.twh.gas)} to ${twh(last.twh.gas)}: gas replaced coal, and renewables met the growth. This year says the same. Fossil generation from January to September was ${twh(p19.fossil)} in 2019, ${twh(p(last.year).fossil)} in ${last.year} and ${twh(pNow.fossil)} in ${pNow.year}, while total generation over those months rose from ${twh(p19.gen)} to ${twh(pNow.gen)} and solar from ${twh(p19.solar)} to ${twh(pNow.solar)}. The base has not shrunk.`;
  $('chart-h-1').textContent = 'Generation from January to September, by fuel';
  $('chart-hint-1').textContent = 'TWh generated from January to September each year, so this year can join in. Gas and coal sit at the bottom.';
  const partCats = part.map((r) => String(r.year));
  const ch1 = [
    { name: 'Coal', color: css('--f-coal'), values: part.map((r) => r.coal) },
    { name: 'Gas', color: css('--f-gas'), values: part.map((r) => r.gas) },
    { name: 'Nuclear, hydro, biomass and other', color: css('--f-nuclear'), values: part.map((r) => r.gen - r.fossil - r.wind - r.solar) },
    { name: 'Wind', color: css('--f-wind'), values: part.map((r) => r.wind) },
    { name: 'Solar', color: css('--f-solar'), values: part.map((r) => r.solar) },
  ];
  barChart($('story-chart-1'), {
    cats: partCats,
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => ci === part.length - 1,
    tooltip: (ci) => `<strong>January to September ${part[ci].year}</strong><div>Fossil: <b>${twh(part[ci].fossil)}</b> of ${twh(part[ci].gen)}</div>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: fossil by hour of day.
  $('take-2').textContent = `Gas used to follow the afternoon air-conditioning peak and ease off at night; now it backs off at noon for solar and runs hardest after sunset and through the night.`;
  $('body-2').innerHTML = `In 2019 gas was lowest at ${hh(lo19)}, at ${gw(g19[lo19])}, and highest at ${hh(hi19)}, at ${gw(g19[hi19])}: a fleet following air conditioning. In ${last.year} its daytime low came at ${hh(loL)}, at ${gw(gL[loL])}, its high at ${hh(hiL)}, at ${gw(gL[hiL])}, and ${gw(gL[3])} still ran at ${hh(3)}. Solar made the dip. It averaged ${gw(y19.noon.solar)} from ${hh(NOON[0])} to ${hh(NOON[1] + 1)} in 2019 and ${gw(last.noon.solar)} in ${last.year}, and fossil over those hours fell from ${gw(y19.noon.fossil)} to ${gw(last.noon.fossil)}. But fossil in the evening rose from ${gw(y19.evening.fossil)} to ${gw(last.evening.fossil)}, and at night from ${gw(y19.night.fossil)} to ${gw(last.night.fossil)}, because generation at night grew from ${gw(y19.night.gen)} to ${gw(last.night.gen)} while night-time wind grew only from ${gw(y19.night.wind)} to ${gw(last.night.wind)}. The EIA sees the same shift: gas's share of summer midday generation fell from 50% in 2023 to 37% in 2025 (${src(SOURCES.eiaMidday, 'EIA')}). By month, fossil ran from ${twh(lm[minM])} in ${monthNames[minM]} ${last.year} to ${twh(lm[maxM])} in ${monthNames[maxM]}: the summer evening is where the fleet is busiest.`;
  $('chart-h-2').textContent = 'Fossil generation by hour of day';
  $('chart-hint-2').textContent = 'Average gas and coal output for each hour of the day, Central time, in GW. Gas and coal separately are in the tooltip. The thick line is the latest 365 days.';
  const lineYears = [2019, y23.year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const fosLines = lineYears.map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).hourly.fossil.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-2'), {
    series: fosLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b> (gas ${gw(row(v.series.year).hourly.gas[hr])}, coal ${gw(row(v.series.year).hourly.coal[hr])})</div>`).join('')}`;
    },
  });
  $('story-legend-2').innerHTML = legend(fosLines.map((sr) => [sr.name, sr.color]));

  // Chapter 3: the economics.
  const cL = last.hourly.coal;
  $('take-3').textContent = `ERCOT pays generators only for the energy they deliver, so a gas plant with fuel at roughly $${Math.round(GAS_FUEL_COST)} a megawatt hour (our estimate) runs whenever the sun is down and earns its margin in the evening.`;
  $('body-3').innerHTML = `ERCOT is an energy-only market: there is no capacity payment, and a plant is paid for the megawatt hours it delivers, at a price that the operating reserve demand curve pushes up when reserves run short (${src(SOURCES.energyOnly, 'ERCOT')}). Since real-time co-optimisation with batteries (RTC+B) went live on 5 December 2025, real-time offers are capped at $2,000 a megawatt hour, down from $5,000 (${src(SOURCES.swcap, 'ERCOT')}). Scarcity is rarer than it was: the reserve curve added to prices in 57 hours in 2025, against 612 in 2021 (${src(SOURCES.imm, 'Potomac Economics')}). The shape of the day matters more than the average. Summer prices from 6 to 9 pm averaged $332 in 2023 and $80 in 2024 (${src(SOURCES.dallasFed2025, 'Dallas Fed')}), and on 30 July 2025 batteries charged at about $20 in the late morning and sold at about $400 in the evening (${src(SOURCES.dallasFedBatteries, 'Dallas Fed')}). Fuel is cheap. ERCOT's gas cost $3.06 per MMBtu in 2025, up from $1.90 in 2024 (${src(SOURCES.imm, 'Potomac Economics')}); at the US gas fleet's average heat rate (${src(SOURCES.heatRate, 'EIA')}) that is roughly $${Math.round(GAS_FUEL_COST)} a megawatt hour, our estimate, and West Texas gas at Waha averaged $1.15 and fell below zero on 39 days (${src(SOURCES.waha, 'P&amp;GJ')}). Coal, about 14.3 GW in ten plants (${src(SOURCES.coalFleet, 'Cleanview')}), now cycles too: ${gw(cL[loL])} at ${hh(loL)} and ${gw(cL[hiL])} at ${hh(hiL)} in ${last.year}. When the sun is down and the wind is light there is no cheaper power to take its place.`;
  $('chart-h-3').textContent = 'Fossil generation by month';
  $('chart-hint-3').textContent = 'Gas and coal generation in each calendar month, in TWh.';
  const monthYears = [2019, y24.year, last.year].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const monthX = (m) => Date.UTC(2001, m, 15);
  const monthLines = monthYears.map((y, k) => ({ name: title(y), color: css(yearColors[k]), points: row(y).fosMonth.map((v, m) => [monthX(m), v]), width: y === last.year ? 3 : 2 }));
  monthLines.forEach((sr) => { sr.markers = sr.points; });
  lineChart($('story-chart-3'), {
    series: monthLines,
    yMin: 0,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    xTicks: monthNames.map((m, k) => ({ t: monthX(k), label: m })),
    tooltip: (t, vals) => `<strong>${monthNames[new Date(t).getUTCMonth()]}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? twh(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-3').innerHTML = legend(monthLines.map((sr) => [sr.name, sr.color]));

  // Chapter 4: the evening hump and batteries.
  const m19 = y19.medianHump;
  const mL = last.medianHump;
  $('take-4').textContent = `Batteries are taking the evening peak, but ${bat(3).gw} GW and ${bat(3).gwh} GWh of them would only bring fossil down to its midday level, about ${Math.round(last.noon.fossil)} GW.`;
  $('body-4').innerHTML = `Solar has made the evening hump bigger. We measure it as fossil output above that day's lowest midday level, from ${hh(15)} to midnight. On the median day it was ${n0(m19.gwh)} GWh with a ${gw(m19.peak)} peak in 2019, and ${n0(mL.gwh)} GWh with a ${gw(mL.peak)} peak in ${last.year}: solar cut the midday level and the evening did not move. Batteries are filling it. ERCOT's "Other", now nearly all battery discharge, averaged ${gw(y23.evening.other)} from ${hh(EVENING[0])} to ${hh(EVENING[1] + 1)} in 2023, ${gw(y24.evening.other)} in 2024, ${gw(last.evening.other)} in ${last.year} and ${gw(latest.evening.other)} in the latest 365 days. Its highest quarter hour was ${gw(otherMax.otherMax)} on ${fmtDate(at(otherMax.otherMaxAt))}; GridStatus logged a battery record of 11,980 MW on 22 July 2026 (${src(SOURCES.gridstatus, 'GridStatus')}). The fleet was 13.9 GW and 22.9 GWh at the end of 2025 (${src(SOURCES.modoAnnual, 'Modo Energy')}). Against ${last.year}'s days, ${last.batteries.map((b, i) => (i ? `${i === last.batteries.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh on ${b.days}` : `${b.gw} GW and ${b.gwh} GWh would have flattened the hump on ${b.days} days`)).join(', ')}, if they could charge from midday solar. Even then fossil would sit at its midday level, and at night (${gw(last.night.fossil)} on average) there is no midday surplus to charge from. The night needs more wind, more transmission or longer storage.`;
  $('chart-h-4').textContent = `Each day of ${last.year}, by the evening hump a battery would have had to cover`;
  $('chart-hint-4').textContent = `Each day's fossil output above its lowest midday level, from 15:00 to midnight, in GWh, sorted from smallest to largest. The lines mark ${BATTERIES.map((b) => `${b[1]}`).join(', ')} GWh of batteries; days below a line are covered if the batteries could charge and discharge fast enough.`;
  const dayX = (k) => k * 864e5;
  const sorted = [{ name: 'Evening hump', color: css('--f-gas'), points: last.humps.map((x, k) => [dayX(k), x.gwh]), width: 2.5 }];
  lineChart($('story-chart-4'), {
    series: sorted,
    yMin: 0,
    yFormat: (v) => `${n0(v)} GWh`,
    yTickFormat: (v) => n0(v),
    xTicks: [0, 60, 120, 180, 240, 300, 360].filter((k) => k < last.humps.length).map((k) => ({ t: dayX(k), label: `${k}` })),
    refLines: last.batteries.map((b) => ({ value: b.gwh, color: css('--ink-3') })),
    tooltip: (t) => {
      const k = Math.round(t / 864e5);
      const x = last.humps[k];
      return x ? `<strong>Day ${k + 1} of ${last.humps.length}</strong><div>Evening hump: <b>${n0(x.gwh)} GWh</b></div><div>Peak above midday: <b>${gw(x.peak)}</b></div><div>Midday fossil: <b>${gw(x.noon)}</b></div><div>Month: <b>${monthNames[x.month - 1]}</b></div>` : '';
    },
  });
  $('story-legend-4').innerHTML = `${legend(sorted.map((sr) => [sr.name, sr.color]))}<span>Lines: ${last.batteries.map((b) => `${b.gwh} GWh`).join(', ')}</span>`;

  // Chapter 5: what's coming.
  $('take-5').textContent = 'The next few years add gas as well as storage, so the records to watch are the battery peak, night-time fossil and whether the yearly fossil total finally falls.';
  $('body-5').innerHTML = `The pipeline points both ways; the dated items are below, each with the record it should move. The connection queue held 164 GW of batteries, 156 GW of solar, 82 GW of gas and 48 GW of wind in August 2026 (${src(SOURCES.queue, 'ERCOT')}). The state is paying for gas too: the Texas Energy Fund has made nine 20-year, 3% loans for 5,446 MW (${src(SOURCES.tef, 'Dallas Express')}), the first plant online on 5 May 2026 (${src(SOURCES.pinOak, 'Industrial Info')}). Coal goes slowly, and mostly to gas: Coleto Creek in 2027 (${src(SOURCES.coleto, 'Vistra')}), J K Spruce in 2028 (${src(SOURCES.spruce, 'GEM')}), and ERCOT can keep a unit running under a reliability-must-run contract (${src(SOURCES.rmr, 'San Antonio Report')}). Demand is the wild card: the peak reached 91.1 GW on 22 July 2026, unofficially (${src(SOURCES.peak, 'ERCOT')}), and connected large loads such as data centres peaked at 4.3 GW in August 2026 against requests far larger. The low-fossil records are the ones to watch: fossil has not gone below ${gw(lowestYear.fosMin)}, set in ${lowestYear.year}; it was under 10 GW for ${hrs(last.under[0])} in ${last.year}${fossil15Spell ? `, and the longest spell under 15 GW is ${hrs(spellH(fossil15Spell))}, from ${fmtDate(at(fossil15Spell.start))}` : ''}.`;
  $('chart-h-5').textContent = 'Evening output by year: fossil and batteries';
  $('chart-hint-5').textContent = `Average output from ${hh(EVENING[0])} to ${hh(EVENING[1] + 1)}, Central time, in GW. The last bar is the latest 365 days.`;
  const ch5 = [
    { name: 'Coal', color: css('--f-coal'), values: allYears.map((r) => r.evening.coal) },
    { name: 'Gas', color: css('--f-gas'), values: allYears.map((r) => r.evening.gas) },
    { name: 'Batteries and other', color: css('--f-battery'), values: allYears.map((r) => r.evening.other) },
  ];
  barChart($('story-chart-5'), {
    cats: allYears.map((r) => label(r.year)),
    stacks: ch5,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(allYears[ci].year)}</strong>${[...ch5].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${gw(sr.values[ci])}</b></div>`).join('')}<div>Hours with fossil under 10 GW: <b>${n0(allYears[ci].under[0])}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend([...ch5].reverse().map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--f-gas)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
