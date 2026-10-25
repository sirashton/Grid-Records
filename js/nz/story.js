// The New Zealand story: why coal and gas still run on a grid that is now
// about nine tenths hydro, geothermal and wind. Three reasons, in order of
// size: a dry year empties lakes that hold only weeks of demand, a floor of
// gas runs round the clock on contract, and winter evenings add a little on
// top. The figures are worked out from the data by storyFigures() and
// storageFigures(), which the tests also run; renderStory() draws the page.
// The cost chapters (5 and 6) stay in app.js with the firming and lake models.
import { summarise, slotTime, formatDuration } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import nz from '../countries/nz.js';
import { FUELS, FOSSIL, metricSeries, generationTotal, byYear } from './data.js';
import { ASSUMPTIONS as A, fuelCost } from './firming.js';

// Fossil output below this, in GW, is the floor that runs whatever happens;
// batteries are sized against the fossil above it.
export const FLOOR = 0.1;
// Battery fleets (GW, GWh) the story tests against each day's fossil fuel.
// The first is about what is built: Ruakākā, Glenbrook and Huntly at 100 MW
// each and Rotohiko at 35 MW.
export const BATTERIES = [[0.3, 0.6], [0.5, 1], [1, 2], [2, 8]];
// Local hours compared: night 01:00 to 04:59, evening 17:00 to 20:59.
const NIGHT = [1, 4];
const EVENING = [17, 20];
// Winter months, May to August.
const WINTER = [5, 8];
// Lake storage bands, GWh, for fossil output against the lakes.
export const STORAGE_BANDS = [[0, 1500], [1500, 2500], [2500, 3500], [3500, Infinity]];
// Years compared against the lakes: the thermal fleet has been much the same since.
export const STORAGE_FROM = 2015;
// A day with more than this above the floor, in GWh, counts as a fossil day.
const FOSSIL_DAY = 0.5;

/**
 * Local hour, month and day number for every slot. The Auckland offset is
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
      offset = tzOffsetMs(d * 864e5 + 432e5, nz.timeZone);
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
 * Every number the story uses from the half-hourly data. Rows run by NZ
 * calendar year, complete years only, then 'past365' for the latest 365 days.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const slotH = stepOf(data) / 60;
  const fossil = metricSeries(d, FOSSIL);
  const coal = metricSeries(d, ['coal']);
  const gas = metricSeries(d, ['gas']);
  const hydro = metricSeries(d, ['hydro']);
  const total = generationTotal(d);
  const { hour, month, day } = localClock(d);

  const rows = byYear(d, () => ({
    fosTwh: 0, coalTwh: 0, gasTwh: 0, hydroTwh: 0, winterTwh: 0, fosMin: Infinity, fosMinAt: -1,
    fosHour: new Float64Array(24), coalHour: new Float64Array(24), gasHour: new Float64Array(24), demandHour: new Float64Array(24), hourN: new Float64Array(24),
    fosMonth: new Float64Array(12), nightSum: 0, nightN: 0, eveSum: 0, eveN: 0, days: new Map(),
  }), (r, i) => {
    const f = fossil[i];
    if (Number.isNaN(f)) return;
    const h = hour[i];
    r.fosTwh += (f * slotH) / 1000;
    r.coalTwh += (coal[i] * slotH) / 1000;
    r.gasTwh += (gas[i] * slotH) / 1000;
    if (!Number.isNaN(hydro[i])) r.hydroTwh += (hydro[i] * slotH) / 1000;
    if (month[i] >= WINTER[0] && month[i] <= WINTER[1]) r.winterTwh += (f * slotH) / 1000;
    if (f < r.fosMin) { r.fosMin = f; r.fosMinAt = i; }
    r.fosHour[h] += f;
    r.coalHour[h] += coal[i];
    r.gasHour[h] += gas[i];
    r.demandHour[h] += Number.isNaN(total[i]) ? 0 : total[i] / 1000;
    r.hourN[h]++;
    r.fosMonth[month[i] - 1] += (f * slotH) / 1000;
    if (h >= NIGHT[0] && h <= NIGHT[1]) { r.nightSum += f; r.nightN++; }
    if (h >= EVENING[0] && h <= EVENING[1]) { r.eveSum += f; r.eveN++; }
    const dayRow = r.days.get(day[i]) ?? { gwh: 0, peak: 0, min: Infinity, sum: 0 };
    const above = Math.max(0, f - FLOOR);
    dayRow.gwh += above * slotH;
    dayRow.peak = Math.max(dayRow.peak, above);
    dayRow.min = Math.min(dayRow.min, f);
    dayRow.sum += f * slotH;
    r.days.set(day[i], dayRow);
  }).map((r) => {
    const days = [...r.days.values()].sort((x, y) => x.gwh - y.gwh);
    // Fossil above each day's own minimum: the part a battery could move
    // within the day, as against the floor that runs all day.
    const aboveDayMin = days.reduce((s, x) => s + x.sum - x.min * 24, 0) / 1000;
    return {
      year: r.year,
      fosTwh: r.fosTwh, coalTwh: r.coalTwh, gasTwh: r.gasTwh, hydroTwh: r.hydroTwh,
      winterShare: r.fosTwh ? r.winterTwh / r.fosTwh : NaN,
      fosMin: r.fosMin, fosMinAt: r.fosMinAt,
      fosHour: Array.from(r.fosHour, (v, k) => mean(v, r.hourN[k])),
      coalHour: Array.from(r.coalHour, (v, k) => mean(v, r.hourN[k])),
      gasHour: Array.from(r.gasHour, (v, k) => mean(v, r.hourN[k])),
      demandHour: Array.from(r.demandHour, (v, k) => mean(v, r.hourN[k])),
      fosMonth: Array.from(r.fosMonth),
      night: mean(r.nightSum, r.nightN),
      evening: mean(r.eveSum, r.eveN),
      aboveDayMin,
      aboveShare: r.fosTwh ? aboveDayMin / r.fosTwh : NaN,
      days: days.map(({ gwh, peak }) => ({ gwh, peak })),
      fossilDays: days.filter((x) => x.gwh > FOSSIL_DAY).length,
      batteries: BATTERIES.map(([gw, gwh]) => ({ gw, gwh, days: days.filter((x) => x.gwh <= gwh + 1e-9 && x.peak <= gw + 1e-9).length })),
    };
  });

  const opts = { startMs: data.startMs, maxGap: 2 };
  const peak = (series) => {
    let at = -1;
    for (let i = 0; i < end; i++) if (series[i] > (at < 0 ? 0 : series[at])) at = i;
    return at < 0 ? null : { i: at, gw: series[at] };
  };
  return {
    rows,
    spells: Object.fromEntries([0.5, 0.25, 0.1].map((gw) => [gw, spellOf(summarise(fossil.subarray(0, end), gw, 'below', opts))])),
    // Coal under 20 MW is the Rankine units off: the record to beat for a coal-free spell.
    coalSpell: spellOf(summarise(coal.subarray(0, end), 0.02, 'below', opts)),
    peaks: {
      wind: peak(metricSeries(d, ['wind'])),
      solar: peak(metricSeries(d, ['solar'])),
      geothermal: peak(metricSeries(d, ['geothermal'])),
      battery: peak(metricSeries(d, ['battery'])),
    },
  };
}

/**
 * Fossil output against the hydro lakes: the average fossil, coal and gas
 * output, in GW, in each band of national lake storage (GWh), over the years
 * from STORAGE_FROM that both the data and the lake record (site/nz/lakes.json,
 * daily storage from 1980) cover. Null if they don't overlap.
 */
export function storageFigures(data, end, lakes, from = STORAGE_FROM) {
  if (!lakes?.storage?.length) return null;
  const d = { ...data, length: end };
  const fossil = metricSeries(d, FOSSIL);
  const coal = metricSeries(d, ['coal']);
  const gas = metricSeries(d, ['gas']);
  const { day } = localClock(d);
  const firstDay = Math.floor(Date.parse(lakes.first) / 864e5);
  const fromDay = Math.floor(Date.UTC(from, 0, 1) / 864e5);
  const bands = STORAGE_BANDS.map(([lo, hi]) => ({ lo, hi, fossil: 0, coal: 0, gas: 0, n: 0 }));
  const slotH = stepOf(data) / 60;
  let lastDay = -1;
  for (let i = 0; i < end; i++) {
    const k = day[i] - firstDay;
    if (day[i] < fromDay || k < 0 || k >= lakes.days || Number.isNaN(fossil[i])) continue;
    const st = lakes.storage[k];
    const b = bands.find((x) => st >= x.lo && st < x.hi);
    if (!b) continue;
    b.fossil += fossil[i];
    b.coal += coal[i];
    b.gas += gas[i];
    b.n++;
    lastDay = day[i];
  }
  if (lastDay < 0) return null;
  return {
    from,
    to: new Date(lastDay * 864e5).getUTCFullYear(),
    bands: bands.map((b) => ({ lo: b.lo, hi: b.hi, fossil: mean(b.fossil, b.n), coal: mean(b.coal, b.n), gas: mean(b.gas, b.n), hours: b.n * slotH })),
  };
}

// The NZ ETS price: Platts' assessment of 12 December 2025 and the 2026
// auction floor, NZ$ a tonne (S&P Global, see SOURCES.ets).
export const CARBON = { spot: 39.25, floor: 71 };
// Fuel, carbon and running cost of a megawatt hour from the cost model's
// assumptions (firming.js): domestic gas at NZ$14/GJ, coal at NZ$7/GJ,
// imported LNG at NZ$25/GJ. Our estimates, not market figures.
export const THERMAL_COST = {
  gas: fuelCost(A.gas, CARBON.spot),
  gasFloor: fuelCost(A.gas, CARBON.floor),
  coal: fuelCost(A.coal, CARBON.spot),
  coalFloor: fuelCost(A.coal, CARBON.floor),
  lng: fuelCost({ ...A.gas, pricePerGj: A.importedGasPerGj }, CARBON.spot),
};

const SOURCES = {
  hfo: 'https://www.comcom.govt.nz/news-and-media/news-and-events/2025/commission-authorises-gentailers-application-for-strategic-energy-reserve-huntly-firming-option/',
  hfoGenesis: 'https://announcements.asx.com.au/asxpdf/20250804/pdf/06mgz6zdrkw2m3.pdf',
  hfoInterest: 'https://www.interest.co.nz/public-policy/136037/countrys-four-largest-electricity-generator-retailers-have-been-given',
  genesisFy26: 'https://announcements.nzx.com/announcement/478634',
  genesisGas: 'https://www.nzx.com/announcements/479003',
  methanex: 'https://www.interest.co.nz/business/140083/methanex-says-continued-operations-nz-not-sustainable-due-%E2%80%98continued-decline',
  reserves: 'https://www.argusmedia.com/en/news-and-insights/latest-market-news/2826818-new-zealand-s-gas-reserves-extend-fall-in-2025-mbie',
  lngJune: 'https://www.mbie.govt.nz/about/news/lng-imports-to-help-secure-affordable-energy',
  lngOct: 'https://newswire.co.nz/2026/10/government-picks-preferred-bidder-lng-import-terminal-port-taranaki-before-election/',
  storage: 'https://www.ea.govt.nz/news/eye-on-electricity/hydro-storage-limits-and-why-rain-matters-for-electricity',
  prices2024: 'https://ea.govt.nz/news/eye-on-electricity/what-was-behind-high-wholesale-electricity-prices',
  sos2024: 'https://www.ea.govt.nz/documents/5843/Electricity_Authority_weekly_security_of_supply_report_15_Aug_2024.pdf',
  prices2025: 'https://www.ea.govt.nz/news/eye-on-electricity/wholesale-prices-plummet-as-the-proportion-of-renewables-increases',
  sos2025: 'https://www.ea.govt.nz/documents/9470/Security_of_supply_report_-_18_December_2025.pdf',
  mbie2026: 'https://www.mbie.govt.nz/building-and-energy/energy-and-natural-resources/energy-statistics-and-modelling/energy-publications-and-technical-papers/energy-in-new-zealand/energy-in-new-zealand-2026/electricity',
  onslow: 'https://www.odt.co.nz/regions/central-otago/govt-confirms-lake-onslow-scheme-scrapped',
  tiwai: 'https://meridianenergy.co.nz/public/Investors/Reports-and-presentations/Investor-presentations/Key-terms-accompanying-disclosure-Final-31-May-2024.pdf',
  ets: 'https://www.spglobal.com/energy/en/news-research/latest-news/energy-transition/121625-commodities-2026-new-zealand-carbon-market-poised-for-steady-recovery-elections-in-focus',
  contactFy26: 'https://announcements.nzx.com/announcement/477524',
  contactTcc: 'https://announcements.asx.com.au/asxpdf/20250916/pdf/06p7xm37cc938r.pdf',
  ruakaka: 'https://en.wikipedia.org/wiki/Ruak%C4%81k%C4%81_Energy_Park',
  kowhai: 'https://pv-tech.org/lightsource-bp-breaks-ground-on-168mw-solar-pv-project-in-new-zealand',
  kaiwera: 'https://www.mercury.co.nz/media/News%20Release%20Kaiwera%20Downs%20Wind%20Farm%20Celebration%20Event%20FINAL.pdf',
};

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['1 Jan 2026', 'The Huntly Firming Option starts: Contact, Meridian and Mercury pay Genesis a premium for 50 MW each of the Rankine units, authorised to 31 December 2035, with a coal reserve of up to 600,000 tonnes.', 'hfo', 'Coal does not go to zero while it runs. Watch whether the Rankines sit idle in wet years: the longest spell with coal under 20 MW.'],
  ['Mar 2026 and Sep 2026', 'Contact\'s 100 MW Glenbrook battery came online in March; Genesis\'s 100 MW, 200 MWh Huntly battery is due to be fully operational by September.', 'genesisFy26', 'Biggest battery half hour, from 101 MW so far, and the evening fossil peak against the night.'],
  ['9 Sep 2026', 'Mercury opened stage 2 of Kaiwera Downs, 155 MW, taking the wind farm to 198 MW and about 675 GWh a year.', 'kaiwera', 'Most wind in a half hour, 1.07 GW so far; the spells with fossil under 100 MW in spring.'],
  ['Late 2026 to early 2027', 'Meridian\'s 130 MW Ruakākā solar farm starts generating, and Lightsource bp\'s 168 MW Kōwhai Park at Christchurch Airport, built with Contact, is being commissioned.', 'ruakaka', 'Most solar in a half hour, 0.30 GW so far: it should pass 0.5 GW in summer.'],
  ['First quarter of 2027', 'Methanex idles its Motunui methanol plant and sells its gas entitlements to the end of the decade. Genesis has bought about 11.4 PJ for March 2027 to December 2029, plus up to 8.6 PJ of Kupe gas, and says it supports the move away from baseload gas generation.', 'genesisGas', 'The fossil floor at night: with gas held for dry years rather than burnt all year, the night-time floor should fall below 100 MW in wet years.'],
  ['Third quarter of 2027', 'Contact\'s Te Mihi stage 2 geothermal plant is scheduled online.', 'contactFy26', 'Most geothermal in a half hour, and the fossil floor, since geothermal runs through the night.'],
  ['First quarter of 2028', 'Contact\'s second Glenbrook battery, 200 MW, is expected online, taking its fleet to 300 MW.', 'contactFy26', 'Battery discharge peak, and the evening fossil peak.'],
  ['Winter 2028 (target)', 'An LNG import terminal at Port Taranaki: a preferred provider was shortlisted in October 2026, with no contract before the election and the funding model still being developed.', 'lngOct', 'None downwards. LNG keeps gas available in a dry year at the world price: watch the coal share of fossil fuel in the next dry year, which it should cut.'],
  ['Dec 2029', 'Genesis\'s Methanex gas runs out, and the field decline continues: 2P reserves were 731 PJ at 1 January 2026, down 23% in a year, with 2026 production estimated at 85 PJ.', 'reserves', 'Gas in a dry year. Without LNG or new fields, the next dry year after 2029 falls on coal.'],
  ['31 Dec 2035', 'The Huntly Firming Option ends, and with it the agreement that keeps the Rankine units open. Nothing dated takes coal to zero before then.', 'hfo', 'Coal to zero: the spells with coal under 20 MW should become permanent. The 2017 record is 62 days.'],
  ['31 Dec 2044', 'The Tiwai Point smelter\'s contracts run to the end of 2044, with demand response of up to 185 MW that Meridian can call in a dry year.', 'tiwai', 'Fossil fuel in a dry year: demand response is the other way to cover it.'],
];

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const nzNum = (v) => v.toLocaleString('en-NZ');
const n0 = (v) => nzNum(Math.round(v));
const mw = (v) => (v >= 1 ? `${v.toFixed(2)} GW` : `${Math.round(v * 1000)} MW`);
// Plant sizes: 300 MW, 1 GW, 2 GWh.
const cap = (v) => (v >= 1 ? `${+v.toFixed(1)} GW` : `${Math.round(v * 1000)} MW`);
const gwh = (v) => (v >= 1 ? `${+v.toFixed(1)} GWh` : `${Math.round(v * 1000)} MWh`);
const twh = (v) => `${v.toFixed(1)} TWh`;
const twh2 = (v) => `${v.toFixed(2)} TWh`;
const nzd = (v) => `NZ$${n0(v)}`;
const pc = (v) => `${Math.round(v * 100)}%`;
const hrs = (v) => `${n0(v)} hours`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// One headline figure set large, with the other highlights as a list beside it.
export function factsHtml(big, sub, rest) {
  return `<div class="headline"><div class="big">${big}</div><div class="sub">${sub}</div></div>
    <ul class="fact-list">${rest.map(([c, l, v, when]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${when}</span></span></li>`).join('')}</ul>`;
}

/**
 * Draws the answer, the headline facts and chapters 1 to 4 and 7. `ctx` is
 * what app.js already has: energy (yearlyEnergy rows), hours
 * (yearlyHoursBelow rows for 500, 250 and 100 MW), storage (storageFigures
 * or null), needs (the cost model's sizes) and cheapest (the cheapest
 * renewable build's NZ$m a year and its fossil-backup rival, or null).
 */
export function renderStory(data, end, figs, ctx) {
  const { rows, spells, coalSpell, peaks } = figs;
  const { energy, hours, storage, needs, cheapest } = ctx;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const last = full.at(-1);
  const latest = rows.at(-1);
  // The driest of the last ten years: hydro output stands in for rainfall.
  const recent = full.filter((r) => r.year >= last.year - 9);
  const dry = recent.reduce((a, r) => (r.hydroTwh < a.hydroTwh ? r : a), recent[0]);
  const leastFossil = full.every((r) => r.fosTwh > latest.fosTwh);
  const en = (y) => energy.find((r) => r.year === y);
  const past = en('past365') ?? en(last.year);
  const best = energy.filter((r) => r.year !== 'past365').reduce((a, b) => (b.renewablePct > a.renewablePct ? b : a));
  const step = stepOf(data);
  const at = (i) => fmtDate(slotTime(i, data.startMs, step));
  const spellText = (r) => (r ? formatDuration(r.end - r.start) : 'Never');
  const from = (r) => (r ? `from ${at(r.start)}` : 'not yet');
  const bands = storage?.bands;
  const low = bands?.[0];
  const high = bands?.at(-1);
  const bat = (r, k) => r.batteries[k];

  // Header and in short.
  $('lede').textContent = `New Zealand ran ${past.renewablePct.toFixed(0)}% renewable over the latest 365 days of data and burnt ${twh2(latest.fosTwh)} of gas and coal${leastFossil ? ', the least in the data' : ''}. What is left runs for a dry lake, a gas contract and a winter evening, in that order.`;
  $('answer-lead').textContent = `Coal and gas still run on New Zealand's grid for three reasons, in order of size. The hydro lakes hold about six weeks of demand, so when the rain fails, as it did in ${dry.year}, Huntly burns coal for months${low ? `: fossil output averaged ${mw(low.fossil)} when the lakes held under ${(low.hi / 1000).toFixed(1)} TWh and ${mw(high.fossil)} when they held over ${(high.lo / 1000).toFixed(1)} TWh` : ''}. A floor of gas ran round the clock even in the wet latest year, ${mw(latest.night)} at night, on take-or-pay contracts and a combined-cycle unit at Huntly. Winter evenings add ${mw(latest.evening - latest.night)} on top. The three big hydro companies now pay Genesis to keep 150 MW of Huntly's coal units open to the end of 2035, so nothing dated takes coal to zero before then. The records to watch are the longest spell with coal under 20 MW, and the fossil floor at night in a wet year.`;
  $('answer-points').innerHTML = [
    `<b>Dry years are the big one.</b> In ${dry.year}${dry.year === 2024 ? ' the lakes fell to a six-year low and' : ''} fossil fuel made ${twh(dry.fosTwh)}, ${twh(dry.coalTwh)} of it coal. In the latest 365 days hydro made ${twh(latest.hydroTwh)}, against ${twh(dry.hydroTwh)} in ${dry.year}, and fossil fuel ${twh2(latest.fosTwh)}. The difference between a wet year and a dry one is bigger than everything else on this page. ${link(1, 'Chapter 1')}`,
    `<b>The rest is a floor with a peak on top.</b> In the latest 365 days fossil output averaged ${mw(latest.night)} from ${hh(NIGHT[0])} to ${hh(NIGHT[1] + 1)} and ${mw(latest.evening)} from ${hh(EVENING[0])} to ${hh(EVENING[1] + 1)}; only ${pc(latest.aboveShare)} of the year's fossil fuel was above each day's own minimum. The floor is gas on contract, and it is what the price does not explain: a gas unit's fuel and carbon cost about ${nzd(THERMAL_COST.gas)} a megawatt hour, our estimate, and the wholesale price averaged NZ$30 in October 2025. ${link(2, 'Chapters 2')} and ${link(3, '3')}`,
    `<b>Batteries can cover a wet year's fossil fuel, not a dry year's.</b> About ${cap(bat(latest, 0).gw)} and ${gwh(bat(latest, 0).gwh)} of batteries, roughly what is built, would have covered all fossil fuel above ${FLOOR * 1000} MW on ${bat(latest, 0).days} days of the latest 365, and ${bat(dry, 0).days} days of ${dry.year}. Replacing the dry year takes new generation${needs ? `: about ${needs.sizes?.wind ? `${needs.sizes.wind.toFixed(1)} GW of wind or ${needs.sizes.geothermal.toFixed(1)} GW of geothermal` : `${needs.driest.fossil.toFixed(1)} TWh of energy`} to cover a year as dry as ${needs.driest.year}` : ''}${cheapest ? `, and the cheapest mix costs about ${nzd(cheapest.cost)}m a year against ${nzd(cheapest.keep)}m for keeping coal and gas on standby` : ''}. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const [r500, r250, r100] = [spells[0.5], spells[0.25], spells[0.1]];
  $('facts').innerHTML = factsHtml(spellText(r100), `with gas, coal and diesel together under 100 MW, ${from(r100)}. The longest New Zealand has run on almost no fossil fuel.`, [
    ['--fossil', 'Under 250 MW of fossil fuel', spellText(r250), from(r250)],
    ['--fossil', 'Under 500 MW of fossil fuel', spellText(r500), from(r500)],
    ['--f-coal', 'Coal under 20 MW', spellText(coalSpell), `${from(coalSpell)}: the record to beat for a coal-free spell`],
    ['--lowcarbon', 'Renewable share', `${past.renewablePct.toFixed(1)}%`, `over the latest 365 days of data, against ${best.renewablePct.toFixed(1)}% in ${best.year}, the best calendar year`],
    ['--fossil', 'Fossil fuel at night, latest 365 days', mw(latest.night), `average from ${hh(NIGHT[0])} to ${hh(NIGHT[1] + 1)}; ${mw(last.night)} in ${last.year} and ${mw(dry.night)} in ${dry.year}`],
  ]);
  $('story-hint').textContent = 'Seven chapters: the dry years, the floor and the evening peak, who pays for Huntly, what batteries could and could not replace, what covering the driest year would cost, what solar is worth on the lakes, and what is coming, with the record each item should move.';

  const chapters = [
    'Dry years bring back coal',
    'A floor of gas, with the evening on top',
    'Who pays for Huntly, and why it runs below the price',
    'What batteries could and could not replace',
    'When does 100% get cheaper?',
    'What if we put solar on hydro lakes?',
    'What is coming, and which records it moves',
  ];
  chapters.forEach((t, k) => {
    const el = $(`title-${k + 1}`);
    if (el) el.textContent = t;
    const next = $(`next-${k + 1}`);
    if (next) next.textContent = `Next: ${chapters[k + 1]}`;
  });

  // Chapter 1: the mix by year, then fossil fuel against the water.
  const yearLabel = (y) => label(y);
  const pct = (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`;
  const MIX = ['coal', 'gas', 'diesel', 'other', 'bioenergy', 'geothermal', 'hydro', 'wind', 'solar'];
  const stacks = MIX.map((k) => ({ name: FUELS[k].label, color: css(FUELS[k].color), values: energy.map((r) => (r.twh[k] / r.total) * 100) }));
  barChart($('story-mix'), {
    cats: energy.map((r) => yearLabel(r.year)),
    stacks,
    yMax: 100,
    yFormat: pct,
    yTickFormat: (v) => `${v}%`,
    highlight: (ci) => energy[ci].year === 'past365',
    tooltip: (ci) => `<strong>${title(energy[ci].year)}</strong><div>Renewable: <b>${pct(energy[ci].renewablePct)}</b></div>${[...stacks].reverse().filter((s) => s.values[ci] >= 0.05).map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${pct(s.values[ci])}</b></div>`).join('')}`,
  });
  $('story-mix-legend').innerHTML = legend([...stacks].reverse().map((s) => [s.name, s.color]));
  const years = energy.filter((r) => r.year !== 'past365');
  const meanHydro = years.reduce((s, r) => s + r.twh.hydro, 0) / years.length;
  const fossilStacks = ['coal', 'gas', 'diesel'].map((k) => ({ name: FUELS[k].label, color: css(FUELS[k].color), values: years.map((r) => r.twh[k]) }));
  barChart($('story-dry'), {
    cats: years.map((r) => String(r.year)),
    stacks: fossilStacks,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => years[ci].twh.hydro < meanHydro - 1,
    badge: (ci) => (years[ci].twh.hydro < meanHydro - 1 ? 'dry' : null),
    tooltip: (ci) => `<strong>${years[ci].year}</strong><div>Hydro: <b>${twh(years[ci].twh.hydro)}</b> (${years[ci].twh.hydro >= meanHydro ? '+' : ''}${(years[ci].twh.hydro - meanHydro).toFixed(1)} on average)</div>${[...fossilStacks].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${twh(s.values[ci])}</b></div>`).join('')}<div>Renewable: <b>${pct(years[ci].renewablePct)}</b></div>`,
  });
  $('story-dry-legend').innerHTML = `${legend([...fossilStacks].reverse().map((s) => [s.name, s.color]))}<span>Outlined: hydro at least 1 TWh below its ${years[0].year} to ${years.at(-1).year} average of ${twh(meanHydro)}</span>`;
  $('take-1').textContent = `${dry.year} was dry and burnt ${twh(dry.fosTwh)} of fossil fuel; the latest 365 days were wet and burnt ${twh2(latest.fosTwh)}. The lakes decide.`;
  $('body-1').innerHTML = `New Zealand's hydro lakes hold about 4,500 GWh, enough for around six weeks of the country's demand (${src(SOURCES.storage, 'Electricity Authority')}), so a dry year cannot be stored through; it has to be burnt through. In ${dry.year} hydro made ${twh(dry.hydroTwh)} and fossil fuel ${twh(dry.fosTwh)}, ${twh(dry.coalTwh)} of it coal.${dry.year === 2024 ? ` Storage fell to a six-year low in early August, wholesale prices went from about NZ$300 to over NZ$800 a megawatt hour, and the Authority put it down to low lakes, dear gas and wind that was often under 300 MW of a 1,000 MW fleet (${src(SOURCES.prices2024, 'Electricity Authority')}). Genesis was shipping coal in to a stockpile estimated at 113,000 to 154,000 tonnes (${src(SOURCES.sos2024, 'Electricity Authority')}).` : ''} In the latest 365 days hydro made ${twh(latest.hydroTwh)} and fossil fuel ${twh2(latest.fosTwh)}.${bands ? ` The pattern holds across the years: from ${storage.from} to ${storage.to}, fossil output averaged ${list(bands.map((b) => `${mw(b.fossil)} with the lakes ${b.lo === 0 ? 'under' : b.hi === Infinity ? 'over' : 'between'} ${b.lo === 0 ? `${(b.hi / 1000).toFixed(1)} TWh` : b.hi === Infinity ? `${(b.lo / 1000).toFixed(1)} TWh` : `${(b.lo / 1000).toFixed(1)} and ${(b.hi / 1000).toFixed(1)} TWh`}`))}, and coal from ${mw(high.coal)} with the lakes high to ${mw(low.coal)} with them low.` : ''} The one plan to store a dry year, Lake Onslow pumped hydro at about NZ$16 billion, was cancelled in December 2023 (${src(SOURCES.onslow, 'ODT')}). So the dry year still belongs to Huntly. MBIE's annual figures agree with the shape here: 88.5% renewable in 2025, coal down 32% on 2024, gas at its lowest since 1981 (${src(SOURCES.mbie2026, 'MBIE')}).`;

  // Chapter 2: by hour of day, and the hours under the thresholds.
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const hourYears = [dry.year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k);
  const yearColors = ['--f-coal', '--f-gas', '--lowcarbon'];
  const hourLines = hourYears.map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: rows.find((r) => r.year === y).fosHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-hour'), {
    series: hourLines,
    yMin: 0,
    yFormat: mw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => { const r = rows.find((x) => x.year === v.series.year); return `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? mw(v.value) : '—'}</b>, coal ${mw(r.coalHour[hr])}, demand ${r.demandHour[hr].toFixed(1)} GW</div>`; }).join('')}`;
    },
  });
  $('story-hour-legend').innerHTML = legend(hourLines.map((sr) => [sr.name, sr.color]));
  const hourStacks = [
    { name: 'Under 100 MW', color: css('--h7'), values: hours.map((r) => r.hours[2]) },
    { name: '100 to 250 MW', color: css('--lowcarbon'), values: hours.map((r) => r.hours[1] - r.hours[2]) },
    { name: '250 to 500 MW', color: css('--h2'), values: hours.map((r) => r.hours[0] - r.hours[1]) },
  ];
  const fmtH = (v) => `${n0(v)} h`;
  barChart($('story-hours'), {
    cats: hours.map((r) => yearLabel(r.year)),
    stacks: hourStacks,
    yFormat: fmtH,
    yTickFormat: (v) => nzNum(v),
    highlight: (ci) => hours[ci].year === 'past365',
    tooltip: (ci) => `<strong>${title(hours[ci].year)}</strong><div>Under 500 MW: <b>${fmtH(hours[ci].hours[0])}</b> (${((hours[ci].hours[0] / 8760) * 100).toFixed(0)}% of the year)</div><div>Under 250 MW: <b>${fmtH(hours[ci].hours[1])}</b></div><div>Under 100 MW: <b>${fmtH(hours[ci].hours[2])}</b></div>`,
  });
  $('story-hours-legend').innerHTML = legend(hourStacks.map((s) => [s.name, s.color]));
  const h100 = (y) => hours.find((r) => r.year === y)?.hours[2] ?? 0;
  const firstHours = hours.find((r) => r.year >= last.year - 9) ?? hours[0];
  $('take-2').textContent = `Fossil fuel averaged ${mw(latest.night)} at night and ${mw(latest.evening)} in the evening over the latest 365 days. The floor is most of it, and the floor is gas.`;
  $('body-2').innerHTML = `Demand on the grid is about ${latest.demandHour[18].toFixed(1)} GW at ${hh(18)} and ${latest.demandHour[3].toFixed(1)} GW at ${hh(3)}, but fossil fuel does not follow it far. In ${last.year} it averaged ${mw(last.night)} from ${hh(NIGHT[0])} to ${hh(NIGHT[1] + 1)} and ${mw(last.evening)} from ${hh(EVENING[0])} to ${hh(EVENING[1] + 1)}; in the latest 365 days ${mw(latest.night)} and ${mw(latest.evening)}. Fossil fuel above each day's own minimum, the part that follows the peaks, was ${pc(last.aboveShare)} of ${last.year}'s total and ${pc(latest.aboveShare)} of the latest year's. The rest ran all day and all night. That floor is gas: Huntly's Unit 5 is a 385 MW combined-cycle unit that the system operator lists as available subject to gas (${src(SOURCES.sos2025, 'Electricity Authority')}), and Genesis says it keeps contracting minimum levels of take-or-pay gas (${src(SOURCES.genesisFy26, 'Genesis')}), so gas that is paid for gets burnt. When it is not running, the market notices: the Authority blamed price spikes in October 2025 partly on a lack of efficient thermal baseload generation running that week (${src(SOURCES.prices2025, 'Electricity Authority')}). The floor is falling all the same. Fossil fuel never went below ${mw(last.fosMin)} in ${last.year}, and reached ${mw(latest.fosMin)} on ${at(latest.fosMinAt)}. Hours under 100 MW went from ${hrs(h100(firstHours.year))} in ${firstHours.year} to ${hrs(h100(last.year))} in ${last.year} and ${hrs(h100('past365'))} in the latest 365 days. Winter, May to August, took ${pc(latest.winterShare)} of the latest year's fossil fuel and ${pc(dry.winterShare)} of ${dry.year}'s: the season matters less than the lakes.`;

  // Chapter 3: the economics.
  const T = THERMAL_COST;
  $('take-3').textContent = `A gas unit's fuel and carbon cost about ${nzd(T.gas)} a megawatt hour and coal's about ${nzd(T.coal)}, our estimate. The price was NZ$30 in October 2025 and NZ$653 in one week of August 2024. Fossil fuel runs on contract, not on the price.`;
  $('econ-facts').innerHTML = `<ul class="fact-list">${[
    ['--f-gas', 'Gas, fuel and carbon', `${nzd(T.gas)} to ${nzd(T.gasFloor)}/MWh`, `our estimate at NZ$${A.gas.pricePerGj}/GJ, ${A.gas.heatRate} GJ/MWh and carbon at NZ$${CARBON.spot} (the spot price) to NZ$${CARBON.floor} (the 2026 auction floor)`],
    ['--f-coal', 'Coal, fuel and carbon', `${nzd(T.coal)} to ${nzd(T.coalFloor)}/MWh`, `at NZ$${A.coal.pricePerGj}/GJ and ${A.coal.heatRate} GJ/MWh; coal makes about two and a half times the carbon of gas per megawatt hour`],
    ['--f-gas', 'Imported LNG, fuel and carbon', `${nzd(T.lng)}/MWh`, `at NZ$${A.importedGasPerGj}/GJ landed, an assumption`],
    ['--lowcarbon', 'Wholesale price, October 2025', 'NZ$30/MWh', 'the lowest October average in a decade, with full lakes and steady wind'],
    ['--fossil', 'Wholesale price, 8 to 14 August 2024', 'NZ$653/MWh', 'the national average for the week, with the lakes at 54% of their historic mean'],
  ].map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('body-3').innerHTML = [
    `<b>Who pays for the coal units.</b> Huntly's three Rankine units, 240 MW each, burn coal or gas. One was due to close in February 2026. Instead, from 1 January 2026, Contact, Meridian and Mercury each pay Genesis an annual premium plus running costs for 50 MW of notional capacity, 150 MW in all, backed by a solid-fuel reserve of up to 600,000 tonnes that starts as coal and may move to biomass (${src(SOURCES.hfoGenesis, 'Genesis')}, ${src(SOURCES.hfoInterest, 'interest.co.nz')}). The Commerce Commission authorised it for ten years, to 31 December 2035, because keeping the unit should mean lower wholesale prices than closing it (${src(SOURCES.hfo, 'Commerce Commission')}). The premium is not public. The gentailers are buying insurance against the dry year in chapter 1, and the insurance is a coal plant.`,
    `<b>Why fossil fuel runs below its cost.</b> With domestic gas at NZ$${A.gas.pricePerGj}/GJ and carbon at NZ$${CARBON.spot} to NZ$${CARBON.floor} a tonne (${src(SOURCES.ets, 'S&P Global')}), a gas unit needs about ${nzd(T.gas)} to ${nzd(T.gasFloor)} a megawatt hour to cover fuel and carbon, and a Rankine unit on coal about ${nzd(T.coal)} to ${nzd(T.coalFloor)}, our estimates from the cost model's inputs in chapter 5. The wholesale price averaged NZ$30 in October 2025 (${src(SOURCES.prices2025, 'Electricity Authority')}). Gas ran anyway, because it was already paid for: under a take-or-pay contract the fuel costs the generator the same whether it is burnt or not, so its marginal cost is near zero (our inference from the contract terms). In a dry year the sign flips. Hydro companies price their water above the thermal plants to save it for winter, which is how the market is meant to conserve the lakes (${src(SOURCES.storage, 'Electricity Authority')}), and the week of 8 to 14 August 2024 averaged NZ$653 with the lakes at 54% of their historic mean (${src(SOURCES.sos2024, 'Electricity Authority')}). Then coal is the cheap option.`,
    `<b>The gas is running down.</b> Reserves were 731 PJ at 1 January 2026, down 23% in a year, with 2026 production estimated at 85 PJ against 115.7 PJ in 2024 (${src(SOURCES.reserves, 'Argus, from MBIE')}). Contact closed the 377 MW Taranaki combined-cycle plant at the end of 2025, a year late, after buying 2.8 PJ from Methanex to run it through winter (${src(SOURCES.contactTcc, 'Contact')}). Methanex itself idles Motunui in the first quarter of 2027 and is selling its gas entitlements to the end of the decade (${src(SOURCES.methanex, 'interest.co.nz')}); Genesis has bought about 11.4 PJ for March 2027 to December 2029, plus up to 8.6 PJ from Kupe, and says it supports the move away from baseload gas generation (${src(SOURCES.genesisGas, 'Genesis')}). That is the floor in chapter 2 turning into a dry-year reserve. The Government's answer is an LNG import terminal at Port Taranaki for winter 2028, with a preferred provider shortlisted in October 2026 and the funding model still being worked out (${src(SOURCES.lngJune, 'MBIE')}, ${src(SOURCES.lngOct, 'Newswire')}). At about NZ$${A.importedGasPerGj}/GJ that gas would cost around ${nzd(T.lng)} a megawatt hour to burn, which is why chapter 5 finds that imported gas is the expensive way to cover a dry year.`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Chapter 4: batteries against each day's fossil fuel above the floor.
  const median = (r) => r.days[Math.floor(r.days.length / 2)];
  const worst = (r) => r.days.at(-1);
  const totalAbove = (r) => r.days.reduce((s, x) => s + x.gwh, 0) / 1000;
  const batText = (r) => r.batteries.map((b, i) => (i ? `${i === r.batteries.length - 1 ? 'and ' : ''}${cap(b.gw)} and ${gwh(b.gwh)}, ${b.days}` : `${cap(b.gw)} and ${gwh(b.gwh)} of batteries would have covered ${b.days} days`)).join('; ');
  $('body-4').innerHTML = `Take ${FLOOR * 1000} MW as a floor and ask what would have covered the rest. In the latest 365 days that was ${twh2(totalAbove(latest))}; the median day needed ${median(latest).gwh.toFixed(1)} GWh above the floor and the worst ${n0(worst(latest).gwh)} GWh, peaking ${mw(worst(latest).peak)} above it. Against those days, ${batText(latest)} of the 365. New Zealand has about 335 MW of grid batteries: Meridian's 100 MW, 200 MWh at Ruakākā since May 2025 (${src(SOURCES.ruakaka, 'Wikipedia')}), Contact's 100 MW at Glenbrook since March 2026 (${src(SOURCES.contactFy26, 'Contact')}), Genesis's 100 MW, 200 MWh at Huntly due by September 2026 (${src(SOURCES.genesisFy26, 'Genesis')}) and Rotohiko's 35 MW. In ${dry.year} the same fleets would have covered ${list(dry.batteries.map((b) => `${b.days} days with ${cap(b.gw)}`))}: the dry year needed ${twh(totalAbove(dry))} above the floor, the median day ${n0(median(dry).gwh)} GWh, and no battery that charges overnight covers a lake that is short for four months. Batteries can take the evening off the top, which lengthens the spells under 250 and 500 MW in a wet year. The dry year, and the floor itself, are the next three chapters.`;

  // Chapter 7: what is coming.
  const pk = (k, f) => (peaks[k] ? `${f(peaks[k].gw)} on ${at(peaks[k].i)}` : 'none yet');
  $('body-7').innerHTML = `The dated items are listed below, each with the record it should move. The order matters. Batteries and the new wind and solar farms arrive first, and they move the wet-year records: the spells under 100 MW, the solar and wind peaks, the evening fossil peak. The gas floor should go next, as Genesis's new gas is held for dry years rather than burnt all year, and Te Mihi's geothermal runs through the night. Nothing dated moves the dry-year record before 2035: the Huntly Firming Option keeps coal on standby until then, the LNG terminal would swap coal for imported gas in a dry year rather than remove either, and Lake Onslow is cancelled. So the first thing to watch is a wet year with coal under 20 MW for the whole of it, which would beat the ${spellText(coalSpell)} record of ${coalSpell ? at(coalSpell.start) : 'the data'}. The peaks to beat: wind ${pk('wind', mw)}, solar ${pk('solar', mw)}, geothermal ${pk('geothermal', mw)}, battery discharge ${pk('battery', mw)}.`;
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--fossil)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
