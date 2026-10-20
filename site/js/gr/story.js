// The Greece story: lignite going to zero, gas left as the last fossil fuel,
// and the solar the grid turns away at noon. The figures are worked out from
// the data by storyFigures(), which the tests also run; renderStory() draws
// the page.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate, fmtDateTime } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import gr from '../countries/gr.js';
import { FOSSIL, RENEWABLE, GENERATION, metricSeries, byYear } from './data.js';

// Lignite below this (GW) counts as off, the Records card's lowest lignite rung
// above zero: a unit on standby or the last trickle of a shutdown reads a few MW.
export const LIGNITE_OFF = 0.1;
// Gas below this (GW) is the floor the story follows; batteries are sized
// against the gas above it.
export const GAS_FLOOR = 1;
// Battery fleets (GW, GWh) the story tests against each day's gas above the
// floor. 4.7 GW is the size of Greece's standalone storage programme.
export const BATTERIES = [[1, 2], [2, 5], [4.7, 12], [8, 30]];
// Local hours of the evening peak, 18:00 to 22:00.
const EVENING = [18, 21];

/**
 * Local hour, month and day number for every slot. The Athens offset is
 * looked up once per UTC day, so the hour around a clock change can be one off.
 */
function localClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Uint8Array(data.length);
  const day = new Int32Array(data.length);
  const ym = new Int32Array(data.length);
  let utcDay = -1;
  let offset = 0;
  for (let i = 0; i < data.length; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== utcDay) {
      utcDay = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, gr.timeZone);
    }
    const local = t + offset;
    const l = new Date(local);
    hour[i] = l.getUTCHours();
    month[i] = l.getUTCMonth() + 1;
    day[i] = Math.floor(local / 864e5);
    ym[i] = l.getUTCFullYear() * 100 + month[i];
  }
  return { hour, month, day, ym };
}

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);
const zeros = (n) => new Float64Array(n);

/**
 * Every number the story uses. Rows run by Greek calendar year, complete
 * years only, then 'past365' for the latest 365 days. Energy in TWh, power in
 * GW, prices in EUR/MWh, time in hours.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const col = (k) => data.columns[k] ?? new Float64Array(end).fill(NaN);
  const lignite = col('lignite');
  const gas = col('gas');
  const solar = col('solar');
  const wind = col('wind');
  const price = col('price');
  const demand = col('demand');
  const { imports, exports } = data.columns;
  const fossil = metricSeries(d, FOSSIL);
  const renew = metricSeries(d, RENEWABLE);
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const { hour, month, day, ym } = localClock(d);
  const battery = col('battery');
  const twh = (mw) => (mw * slotH) / 1e6;

  const rows = byYear(d, () => ({
    ligTwh: 0, gasTwh: 0, oilTwh: 0, fosTwh: 0, solTwh: 0, windTwh: 0, renTwh: 0, genTwh: 0, demTwh: 0,
    expTwh: 0, impTwh: 0, impHours: 0, expHours: 0,
    ligMax: 0, ligOff: 0, ligDays: new Set(), ligMonth: zeros(12),
    gasMin: Infinity, gasMax: 0, gasMonth: zeros(12), gasHour: zeros(24), gasHourN: zeros(24), ligHour: zeros(24), expHour: zeros(24), gasLow: 0,
    gasEvening: 0, gasExporting: 0, gasImporting: 0,
    fosMin: Infinity, fosU1: 0, fosU2: 0, solMax: 0,
    priceSum: 0, priceN: 0, priceHour: zeros(24), priceHourN: zeros(24), solarHour: zeros(24), solarHourN: zeros(24),
    negHours: 0, zeroHours: 0, cheapGas: 0, cheapGasN: 0, cheapGasMin: Infinity, cheapExport: 0, cheapSolar: 0,
    day: null, days: [],
  }), (r, i) => {
    const g = gas[i];
    if (Number.isNaN(g)) return;
    const h = hour[i];
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(r.day);
      r.day = { n: day[i], month: month[i], gasAbove: 0, gasPeak: 0 };
    }
    const lg = lignite[i] || 0;
    const ex = -(exports?.[i] || 0);
    const im = imports?.[i] || 0;
    const so = solar[i] || 0;
    const fo = fossil[i];
    r.ligTwh += twh(lg);
    r.gasTwh += twh(g);
    r.oilTwh += twh(col('oil')[i] || 0);
    r.fosTwh += (fo * slotH) / 1000;
    r.solTwh += twh(so);
    r.windTwh += twh(wind[i] || 0);
    r.renTwh += (renew[i] * slotH) / 1000;
    let gen = 0;
    for (const c of genCols) gen += c[i] > 0 ? c[i] : 0;
    r.genTwh += twh(gen);
    if (demand[i] > 0) r.demTwh += twh(demand[i]);
    r.expTwh += twh(ex);
    r.impTwh += twh(im);
    if (im > 0) r.impHours += slotH;
    if (ex > 0) r.expHours += slotH;
    // Lignite.
    if (lg / 1000 > r.ligMax) r.ligMax = lg / 1000;
    if (lg / 1000 < LIGNITE_OFF) r.ligOff += slotH;
    else r.ligDays.add(day[i]);
    r.ligMonth[month[i] - 1] += twh(lg);
    // Gas.
    const gw = g / 1000;
    if (gw < r.gasMin) r.gasMin = gw;
    if (gw > r.gasMax) r.gasMax = gw;
    r.gasMonth[month[i] - 1] += twh(g);
    r.gasHour[h] += gw;
    r.gasHourN[h]++;
    r.ligHour[h] += lg / 1000;
    r.expHour[h] += (ex - im) / 1000;
    if (gw < GAS_FLOOR) r.gasLow += slotH;
    if (h >= EVENING[0] && h <= EVENING[1]) r.gasEvening += twh(g);
    if (ex > 0) r.gasExporting += twh(g);
    if (im > 0) r.gasImporting += twh(g);
    r.day.gasAbove += Math.max(0, gw - GAS_FLOOR) * slotH;
    if (gw > r.day.gasPeak) r.day.gasPeak = gw;
    // Fossil and solar.
    if (fo < r.fosMin) r.fosMin = fo;
    if (fo < 1) r.fosU1 += slotH;
    if (fo < 2) r.fosU2 += slotH;
    if (so / 1000 > r.solMax) r.solMax = so / 1000;
    r.solarHour[h] += so / 1000;
    r.solarHourN[h]++;
    // Prices.
    const p = price[i];
    if (Number.isNaN(p)) return;
    r.priceSum += p;
    r.priceN++;
    r.priceHour[h] += p;
    r.priceHourN[h]++;
    if (p < 0) r.negHours += slotH;
    if (p <= 0) {
      r.zeroHours += slotH;
      r.cheapGas += gw;
      r.cheapGasN++;
      if (gw < r.cheapGasMin) r.cheapGasMin = gw;
      r.cheapExport += ex / 1000;
      r.cheapSolar += so / 1000;
    }
  }).map((r) => {
    const days = r.day ? [...r.days, r.day] : r.days;
    return {
      year: r.year,
      ligTwh: r.ligTwh,
      gasTwh: r.gasTwh,
      oilTwh: r.oilTwh,
      fosTwh: r.fosTwh,
      solTwh: r.solTwh,
      windTwh: r.windTwh,
      renTwh: r.renTwh,
      genTwh: r.genTwh,
      demTwh: r.demTwh,
      renPct: (r.renTwh / r.genTwh) * 100,
      ligPct: (r.ligTwh / r.genTwh) * 100,
      gasPct: (r.gasTwh / r.genTwh) * 100,
      gasFossilShare: r.gasTwh / r.fosTwh,
      expTwh: r.expTwh,
      impTwh: r.impTwh,
      netImpTwh: r.impTwh - r.expTwh,
      impHours: r.impHours,
      expHours: r.expHours,
      ligMax: r.ligMax,
      ligOff: r.ligOff,
      ligDays: r.ligDays.size,
      ligMonth: [...r.ligMonth],
      gasMin: r.gasMin,
      gasMax: r.gasMax,
      gasMonth: [...r.gasMonth],
      gasHour: [...r.gasHour].map((v, k) => mean(v, r.gasHourN[k])),
      ligHour: [...r.ligHour].map((v, k) => mean(v, r.gasHourN[k])),
      // Net exports by hour (GW; negative is net imports).
      expHour: [...r.expHour].map((v, k) => mean(v, r.gasHourN[k])),
      gasLow: r.gasLow,
      gasEveningShare: r.gasEvening / r.gasTwh,
      gasExportingShare: r.gasExporting / r.gasTwh,
      gasImportingShare: r.gasImporting / r.gasTwh,
      fosMin: r.fosMin,
      fosU1: r.fosU1,
      fosU2: r.fosU2,
      solMax: r.solMax,
      solarHour: [...r.solarHour].map((v, k) => mean(v, r.solarHourN[k])),
      price: mean(r.priceSum, r.priceN),
      priceHour: [...r.priceHour].map((v, k) => mean(v, r.priceHourN[k])),
      negHours: r.negHours,
      zeroHours: r.zeroHours,
      // While the price was zero or below: average gas, lowest gas, exports and solar.
      cheapGas: mean(r.cheapGas, r.cheapGasN),
      cheapGasMin: r.cheapGasN ? r.cheapGasMin : NaN,
      cheapExport: mean(r.cheapExport, r.cheapGasN),
      cheapSolar: mean(r.cheapSolar, r.cheapGasN),
      days: days.length,
      // Each day's gas above the floor (GWh) and its month, smallest first.
      gasDays: days.map((x) => ({ gwh: x.gasAbove, month: x.month, peak: x.gasPeak })).sort((a, b) => a.gwh - b.gwh),
      // Days whose gas above the floor a battery fleet could have covered, if it was full.
      batteries: BATTERIES.map(([bgw, gwh]) => ({ gw: bgw, gwh, days: days.filter((x) => x.gasAbove <= gwh && x.gasPeak - GAS_FLOOR <= bgw).length })),
    };
  });

  // Record spells and extremes over the whole record.
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: gr.timeZone };
  const ligGw = new Float64Array(end);
  const gasGw = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    ligGw[i] = lignite[i] / 1000;
    gasGw[i] = gas[i] / 1000;
  }
  // The last quarter hour lignite ran above the off level.
  let ligLast = -1;
  for (let i = end - 1; i >= 0; i--) if (ligGw[i] >= LIGNITE_OFF) { ligLast = i; break; }
  let solarMax = -1;
  let gasMin = Infinity;
  // Each calendar month in Greek time: hours at a zero or negative price, and
  // battery discharge (GWh).
  const months = new Map();
  for (let i = 0; i < end; i++) {
    if (solar[i] > (solarMax < 0 ? -Infinity : solar[solarMax])) solarMax = i;
    if (gasGw[i] < gasMin) gasMin = gasGw[i];
    let m = months.get(ym[i]);
    if (!m) months.set(ym[i], (m = { year: Math.floor(ym[i] / 100), month: ym[i] % 100, zeroHours: 0, batGwh: 0 }));
    if (price[i] <= 0) m.zeroHours += slotH;
    if (battery[i] > 0) m.batGwh += (battery[i] * slotH) / 1000;
  }
  return {
    rows,
    months: [...months.values()],
    gasMin,
    ligOffSpell: spellOf(summarise(ligGw, LIGNITE_OFF, 'below', opts)),
    gasFloorSpell: spellOf(summarise(gasGw, GAS_FLOOR, 'below', opts)),
    fossil1Spell: spellOf(summarise(fossil, 1, 'below', opts)),
    fossil2Spell: spellOf(summarise(fossil, 2, 'below', opts)),
    ligLast,
    solarMax: solarMax < 0 ? null : { i: solarMax, solar: solar[solarMax] / 1000, gas: gasGw[solarMax], price: price[solarMax] },
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const n1 = (v) => v.toFixed(1);
const gwf = (v) => `${v.toFixed(v < 1 ? 2 : 1)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const eur = (v) => `€${Math.round(v)}`;
const twhf = (v) => `${v.toFixed(1)} TWh`;
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');

const SOURCES = {
  agDim: 'https://balkangreenenergynews.com/ag-dimitrios-shutdown-today-leaves-greece-with-last-coal-plant/',
  ppc: 'https://www.ppcgroup.com/en/environment/lignite-phase-out/',
  gem: 'https://www.gem.wiki/Ptolema%C3%AFda_power_station',
  damco: 'https://energypress.eu/tag/damco-energy/',
  aleasoft: 'https://aleasoft.com/european-market-prices-2025-second-lowest-since-2021-pv-records',
  argus: 'https://www.argusmedia.com/zh/news-and-insights/latest-market-news/2764079-cee-see-yearly-power-cbc-auction-costs-flip',
  tovimaAug: 'https://www.tovima.com/finance/greeces-renewable-power-surge-keeps-prices-below-europes/amp/',
  manifesto: 'https://en.tomanifesto.gr/?p=8132',
  haee: 'https://www.haee.gr/media/6580/energy-news-jul-sep-2025.pdf',
  bgen2025: 'https://balkangreenenergynews.com/greece-achieves-record-renewables-output-but-also-curtailments-in-2025/',
  nse: 'https://www.nsenergybusiness.com/projects/alexandroupolis-ccgt-power-plant',
  ports: 'https://www.portseurope.com/alexandroupoli-strengthens-role-as-energy-hub-with-new-gas-plant-linked-to-fsru/',
  larissa: 'https://www.enerdata.net/publications/daily-energy-news/larissa-thermoelectric-selects-contractor-794-mw-ccgt-project-greece.html',
  enspired: 'https://www.enspired-trading.com/blog/the-role-of-bess-in-the-greek-power-market',
  frm: 'https://ec.europa.eu/competition/state_aid/cases/256426/256426_1751668_182_2.pdf',
  frm2: 'https://energypress.eu/?p=17528',
  council: 'https://energypress.eu/energy-council-adopts-greek-proposals-for-price-protection-flexibility/',
  pvmag: 'https://www.pv-magazine.com/2026/03/04/greek-pv-producers-fret-3-5-twh-of-curtailments-in-2026/',
  ricardo: 'https://www.ricardo.com/en/news-and-insights/industry-insights/renewable-curtailments-at-7-in-2025-mounting-pressure-on-greek-renewables-and-the-case-for-storage',
  bgenSolar: 'https://balkangreenenergynews.com/curtailments-negative-prices-slash-solar-power-revenue-in-greece-by-up-to-60/',
  bgenZero: 'https://balkangreenenergynews.com/?p=92251',
  bgenNeg: 'https://balkangreenenergynews.com/?p=81022',
  pvmag2024: 'https://www.pv-magazine.com/?p=255731',
  alba: 'https://energy.alba.acg.edu/research-publications/decoding-energy-news/the-paradox-of-the-greek-electricity-market/',
  metlen: 'https://www.enerdata.net/publications/daily-energy-news/metlen-commissions-330-mw790-mwh-standalone-bess-project-greece.html',
  essNews: 'https://www.ess-news.com/2026/01/02/greece-struggles-to-connect-any-battery-storage-projects/',
  bgenBess: 'https://balkangreenenergynews.com/greece-advancing-bess-projects-as-standalone-facility-of-100-mwh-comes-online/',
  ipto2035: 'https://balkangreenenergynews.com/greeces-ipto-set-to-connect-over-10-gw-of-renewables-by-2035/',
  iptoDelay: 'https://balkangreenenergynews.com/?p=90226',
  crete: 'https://www.enerdata.net/publications/daily-energy-news/1-gw-attica-crete-interconnection-starts-operations-greece.html',
  cyclades: 'https://balkangreenenergynews.com/cyclades-islands-including-santorini-get-direct-power-link-to-mainland-greece/',
  gsi: 'https://www.tovima.com/finance/greece-cyprus-gsi-power-link-timeline-revised-by-nexans/amp/',
};

// Rough fuel and carbon cost of a combined-cycle gas plant in 2025: TTF gas
// at €36.33/MWh and carbon at €76.85/t (AleaSoft's 2025 averages), 55%
// efficiency and 0.37 t of CO2 per MWh of power. An estimate, and a floor:
// Greek gas, much of it LNG, costs more than TTF.
export const CCGT_COST = 36.33 / 0.55 + 0.37 * 76.85;

export function renderStory(data, end, figs) {
  const { rows } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const spellText = (sp) => (sp ? `${hrs(spellH(sp))}, ${fmtDate(at(sp.start))} to ${fmtDate(at(sp.end))}` : 'none yet');
  const cats = rows.map((r) => label(r.year));
  const mostGas = full.reduce((a, r) => (r.gasTwh > a.gasTwh ? r : a), first);
  const allExporting = latest.expHour.every((v) => v > 0);
  const { ligOffSpell, fossil1Spell, fossil2Spell, gasFloorSpell, solarMax } = figs;
  const bat = (k) => latest.batteries[k];
  const median = latest.gasDays[Math.floor(latest.gasDays.length / 2)];
  const worst = latest.gasDays.at(-1);
  // The latest calendar year's months with the most zero-price hours, and the
  // months with battery output.
  const endYear = figs.months.at(-1)?.year;
  const lastMonth = figs.months.at(-1);
  const busy = figs.months.filter((m) => m.year === endYear && m.zeroHours >= 100);
  const monthName = (m) => MONTHS[m.month - 1];
  const soFar = (m) => (m === lastMonth ? ' so far' : '');
  // The last year fossil output went under 0.5 GW, and the lowest since.
  const under05 = full.filter((r) => r.fosMin < 0.5).at(-1);
  const batMonths = figs.months.filter((m) => m.batGwh >= 0.5);

  // Header and in short.
  $('lede').textContent = `Greece's last lignite unit is due to stop within months. Gas is the fossil fuel that is left: it made ${twhf(last.gasTwh)} in ${last.year}${mostGas === last ? ', more than in any other year of the data' : ''}, and ${pc(latest.gasExportingShare)} of the latest year's gas was burnt while Greece was exporting power.`;
  $('answer-lead').textContent = 'Lignite is nearly at zero: Ptolemaida 5, the one unit left, is due to stop burning lignite by the end of 2026, so the lignite records should fall in 2027. Gas is a different matter. Greece has become a net exporter, the neighbours pay evening prices that cover a gas plant\'s fuel and carbon, and at noon the grid keeps about a gigawatt of gas on and turns solar away instead. Nothing dated takes gas to zero; three new gas plants are on the way. The records to watch are the gas floor and the spells with fossil under 1 GW.';
  $('answer-points').innerHTML = [
    `<b>Lignite ends in 2027, not 2025.</b> Lignite made ${twhf(first.ligTwh)} in ${first.year} and ${twhf(last.ligTwh)} in ${last.year}, but it still ran on ${last.ligDays} days of ${last.year}. The record spell with lignite under ${LIGNITE_OFF} GW is ${spellText(ligOffSpell)}. Agios Dimitrios closed in May 2026 and Ptolemaida 5 (660 MW) is the last unit (${src(SOURCES.agDim, 'BGEN')}). ${link(1, 'Chapter 1')}`,
    `<b>Gas runs for the evening, at home and abroad.</b> In the latest 365 days gas averaged ${gwf(latest.gasHour[12])} at noon and ${gwf(latest.gasHour[21])} at ${hh(21)}, against a price of ${eur(latest.priceHour[12])} at noon and ${eur(latest.priceHour[20])} at ${hh(20)}. ${allExporting ? 'Greece was a net exporter in every hour of the average day' : 'Greece was a net exporter most of the day'}, ${gwf(latest.expHour[12])} at noon and ${gwf(latest.expHour[20])} at ${hh(20)}, and ${pc(latest.gasExportingShare)} of its gas was burnt while exporting. ${link(2, 'Chapters 2')} and ${link(3, '3')}`,
    `<b>The floor is about half a gigawatt, and solar pays for it.</b> The price was zero or below for ${hrs(latest.zeroHours)} in the latest 365 days. In those hours gas still averaged ${gwf(latest.cheapGas)} and never fell under ${gwf(latest.cheapGasMin)}, while solar averaged ${gwf(latest.cheapSolar)} and net exports ${gwf(latest.cheapExport)}. Curtailment was about 2 TWh in 2025 and is forecast at 3.3 to 3.7 TWh in 2026 (${src(SOURCES.pvmag, 'pv magazine')}). Batteries are what should move this: ${bat(2).gw} GW and ${bat(2).gwh} GWh would have covered gas above ${GAS_FLOOR} GW on only ${bat(2).days} days of the latest year, ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-lignite', `Lignite in ${last.year}`, twhf(last.ligTwh), `against ${twhf(first.ligTwh)} in ${first.year}`],
    ['--f-gas', `Lowest gas output in ${last.year}`, gwf(last.gasMin), `${gwf(latest.gasMin)} in the latest 365 days`],
    ['--f-solar', 'Hours at a zero or negative price', `${n0(last.zeroHours)} in ${last.year}`, `${n0(latest.zeroHours)} in the latest 365 days`],
    ['--fossil', 'Longest spell with fossil under 1 GW', fossil1Spell ? hrs(spellH(fossil1Spell)) : 'None yet', fossil1Spell ? `from ${fmtDate(at(fossil1Spell.start))}: the record to beat` : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${pc(latest.gasExportingShare)}</div><div class="sub">Share of the gas Greece burnt in the latest 365 days while it was a net exporter of power. ${pc(first.gasExportingShare)} in ${first.year}, ${pc(row(2024)?.gasExportingShare ?? NaN)} in 2024.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: the last lignite unit, gas by hour and who buys it, gas by month, the gas that burns at a zero price, and what is coming, with the record each item should move.';

  const chapters = [
    'The last lignite unit',
    'Gas runs for the evening, and the evening is also abroad',
    'Gas by month: two peaks and a growing fleet',
    'The gas that burns at a zero price',
    'What is coming, and which records it moves',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const yearColors = ['--f-other', '--f-gas', '--f-hydro', '--f-lignite'];
  const pick = (ys) => ys.filter((y, k, a) => a.indexOf(y) === k && row(y));

  // Chapter 1: lignite.
  $('take-1').textContent = `Lignite made ${n1(first.ligPct)}% of Greek generation in ${first.year} and ${n1(last.ligPct)}% in ${last.year}, but it still ran on ${last.ligDays} days of ${last.year}. One 660 MW unit is left and it is due to stop within months.`;
  $('body-1').innerHTML = `<p>Lignite was Greece's grid. It made ${twhf(first.ligTwh)} in ${first.year}, ${n1(first.ligPct)}% of generation, and peaked at ${gwf(first.ligMax)} that year. PPC closed Kardia, Amyntaio, Megalopolis 3 and 4 and Meliti between 2019 and 2023 (${src(SOURCES.ppc, 'PPC')}), and output fell to ${twhf(row(2020)?.ligTwh ?? NaN)} in 2020 and ${twhf(last.ligTwh)} in ${last.year}. The last big station, Agios Dimitrios, five units and about 1.6 GW running since 1984, shut on 15 May 2026. Its 2025 emissions were 2.7 Mt of CO2, which at a carbon price above €70 a tonne cost about €200m in allowances (${src(SOURCES.agDim, 'BGEN')}). That is the economics of the phase-out in one line: a lignite unit now pays more for carbon than for fuel.</p>
    <p>What is left is Ptolemaida 5, 660 MW, commissioned in February 2023 (${src(SOURCES.gem, 'GEM')}). PPC said it would stop burning lignite by the end of 2026. IPTO asked that its formal decommissioning wait until March 2027, in case gas imports were disrupted; PPC says IPTO did not ask it to keep running (${src(SOURCES.agDim, 'BGEN')}). It does not run flat out. The highest lignite output in the latest 365 days was ${gwf(latest.ligMax)}, the average by hour stays between ${gwf(Math.min(...latest.ligHour))} and ${gwf(Math.max(...latest.ligHour))}, and lignite was under ${LIGNITE_OFF} GW for ${hrs(latest.ligOff)}. In recent days it has been at zero from early morning to mid afternoon and back at a few hundred MW through the evening and night, which looks like one unit cycling off at noon (inferred from the data, not checked against a unit-level source). The plan is to convert it to gas in two stages, a 350 MW gas turbine and a 500 MW combined-cycle unit (${src(SOURCES.gem, 'GEM')}); energypress has the conversion in 2028 (${src(SOURCES.damco, 'energypress')}). A 2024 report said the conversion was not financially viable (${src(SOURCES.gem, 'GEM')}), so treat the date as soft.</p>
    <p>The lignite record to watch is the longest spell with it under ${LIGNITE_OFF} GW: ${spellText(ligOffSpell)}. The lignite presets on the Records card follow it. The day Ptolemaida 5 stops, that spell starts running and does not end.</p>`;
  $('chart-h-1').textContent = 'Fossil generation by year';
  $('chart-hint-1').textContent = `TWh a year; the last bar is the latest 365 days. Lignite's ${last.year} bar is the last full year; the unit left is 660 MW.`;
  const ch1 = [
    { name: 'Lignite', color: css('--f-lignite'), values: rows.map((r) => r.ligTwh) },
    { name: 'Gas', color: css('--f-gas'), values: rows.map((r) => r.gasTwh) },
    { name: 'Oil', color: css('--f-diesel'), values: rows.map((r) => r.oilTwh) },
  ];
  barChart($('story-chart-1'), {
    cats,
    stacks: ch1,
    yFormat: twhf,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twhf(sr.values[ci])}</b></div>`).join('')}<div>Lignite share: <b>${n1(rows[ci].ligPct)}%</b></div><div>Days lignite ran: <b>${rows[ci].ligDays}</b></div>`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: gas by hour, the price and exports.
  $('take-2').textContent = `In the latest 365 days gas averaged ${gwf(latest.gasHour[12])} at noon and ${gwf(latest.gasHour[21])} at ${hh(21)}, and the price went from ${eur(latest.priceHour[12])} to ${eur(latest.priceHour[20])}. Greece exported through both: ${gwf(latest.expHour[12])} net at noon, ${gwf(latest.expHour[20])} at ${hh(20)}.`;
  $('body-2').innerHTML = `<p>A gas plant runs when the price beats its fuel and carbon. With TTF gas at €36.33 a megawatt hour and carbon at €76.85 a tonne on average in 2025 (${src(SOURCES.aleasoft, 'AleaSoft')}), a combined-cycle plant needs roughly ${eur(CCGT_COST)} a megawatt hour, our estimate at 55% efficiency; Greek gas, much of it LNG, costs more than TTF, so this is a floor. The Greek day-ahead price averaged ${eur(last.priceHour[12])} at noon and ${eur(last.priceHour[20])} at ${hh(20)} in ${last.year}, and ${eur(latest.priceHour[12])} and ${eur(latest.priceHour[20])} in the latest 365 days. So the evening pays well and noon does not, and gas follows: ${gwf(latest.gasHour[12])} at ${hh(12)}, ${gwf(latest.gasHour[21])} at ${hh(21)}, about ${gwf(latest.gasHour[3])} overnight.</p>
    <p>The evening demand is not all Greek. In ${first.year} Greece imported ${twhf(first.netImpTwh)} net; in 2024 the balance was ${twhf(Math.abs(row(2024)?.netImpTwh ?? NaN))} ${(row(2024)?.netImpTwh ?? 0) > 0 ? 'of net imports' : 'of net exports'}, in ${last.year} it exported ${twhf(-last.netImpTwh)} net, and in the latest 365 days ${twhf(-latest.netImpTwh)} net, ${twhf(latest.expTwh)} out against ${twhf(latest.impTwh)} in. ${allExporting ? 'In the average day of the latest 365 days Greece was a net exporter in every hour' : 'In the average day of the latest 365 days Greece was a net exporter most hours'}, ${gwf(latest.expHour[12])} at noon and ${gwf(latest.expHour[20])} at ${hh(20)}. Gas burnt while exporting went from ${pc(first.gasExportingShare)} in ${first.year} to ${pc(row(2022)?.gasExportingShare ?? NaN)} in 2022, ${pc(last.gasExportingShare)} in ${last.year} and ${pc(latest.gasExportingShare)} in the latest 365 days. The neighbours set the price: the Greek 2026 forward was assessed at €95.15, €6.75 under Bulgaria, and the 2026 yearly Greece-to-Bulgaria transmission right sold for the first time at a premium over the reverse direction (${src(SOURCES.argus, 'Argus')}). On one August 2026 day the Greek day-ahead price was €97 against €125 in Bulgaria and €176 in Italy (${src(SOURCES.tovimaAug, 'To Vima')}). Exports go to Italy, Bulgaria, North Macedonia and Albania; in May 2026 Greece exported to Bulgaria on 96% of days (${src(SOURCES.manifesto, 'To Manifesto')}). Greek power exports hit 963 GWh in July 2025, the same month gas set a monthly record of 2,494 GWh (${src(SOURCES.haee, 'HAEE')}).</p>
    <p>Be careful what the ${pc(latest.gasExportingShare)} means. Greece hardly ever imports any more, so almost everything, including the noon gas, is burnt while the balance is positive. It does not mean three quarters of the gas is for export. At ${hh(21)} the ${gwf(latest.gasHour[21])} of gas serves mostly Greek demand, with ${gwf(latest.expHour[21])} going abroad. At noon it is the other way round: gas at ${gwf(latest.gasHour[12])} and net exports at ${gwf(latest.expHour[12])}, so the midday gas is, in effect, the export. ${link(4, 'Chapter 4')} is about why it is on at all.</p>`;
  $('chart-h-2').textContent = 'Gas by hour of day';
  $('chart-hint-2').textContent = 'Average gas output for each hour, Greek time, in GW. The dashed line is net exports in the latest 365 days; the price at each hour is in the tooltip.';
  const gasLines = pick([first.year, 2022, last.year, 'past365']).map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).gasHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  const expLine = { name: 'Net exports, latest 365 days', year: 'past365', exports: true, color: css('--f-imports'), points: latest.expHour.map((v, hr) => [hourX(hr), v]), width: 2, dash: '5 4' };
  lineChart($('story-chart-2'), {
    series: [...gasLines, expLine],
    yMin: 0,
    yFormat: gwf,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gwf(v.value) : '—'}</b>${!v.series.exports && Number.isFinite(row(v.series.year).priceHour[hr]) ? ` at ${eur(row(v.series.year).priceHour[hr])}/MWh` : ''}</div>`).join('')}`;
    },
  });
  $('story-legend-2').innerHTML = legend([...gasLines, expLine].map((sr) => [sr.name, sr.color]));

  // Chapter 3: gas by month, and the fleet.
  const lm = latest.gasMonth;
  const lowM = lm.indexOf(Math.min(...lm));
  $('take-3').textContent = `Gas is highest in December and January (about ${twhf((lm[11] + lm[0]) / 2)} a month) and again in July and August (about ${twhf((lm[6] + lm[7]) / 2)}), and lowest in ${MONTHS[lowM]} (${twhf(lm[lowM])}). The fleet is still growing, and three more plants are planned.`;
  $('body-3').innerHTML = `<p>Greek gas has two seasons. In the latest 365 days it ran at about ${twhf((lm[11] + lm[0]) / 2)} a month in December and January and about ${twhf((lm[6] + lm[7]) / 2)} in July and August, with the trough in ${MONTHS[lowM]} at ${twhf(lm[lowM])}. Winter is heating and little solar. Summer is cooling demand across the Balkans, low hydro in the neighbours and Ukraine's imports; BGEN credits the 2025 export surplus to demand from Albania, North Macedonia and Bulgaria, low hydro elsewhere in the Balkans and Ukraine's higher import needs (${src(SOURCES.bgen2025, 'BGEN')}). Gas made ${twhf(first.gasTwh)} in ${first.year}, ${twhf(row(2019)?.gasTwh ?? NaN)} in 2019 when lignite began to fall, ${twhf(row(2021)?.gasTwh ?? NaN)} in 2021, ${twhf(row(2023)?.gasTwh ?? NaN)} in 2023 and ${twhf(last.gasTwh)} in ${last.year}. Its share of fossil power went from ${pc(first.gasFossilShare)} to ${pc(last.gasFossilShare)}. BGEN reports gas-plant emissions at a record 8.8 Mt in 2025, alongside record renewables (${src(SOURCES.bgen2025, 'BGEN')}).</p>
    <p>The fleet is growing to match: Energy-Charts has installed gas at 4.9 GW in 2019 and 6.68 GW in 2025. Alexandroupolis, an 840 MW combined-cycle plant owned by PPC, DEPA and Damco, started construction in 2023 (${src(SOURCES.nse, 'NS Energy')}); its commercial operation is now targeted for late 2027 (${src(SOURCES.ports, 'Ports Europe')}). Larissa, 794 MW, led by Clavenia with DEPA Commercial, picked its contractor in August 2026 and expects a final investment decision before the end of 2026, with construction taking about three years (${src(SOURCES.larissa, 'Enerdata')}). Ptolemaida 5 is to become a gas plant too (${link(1, 'Chapter 1')}). IPTO's own view is that gas plants are the flexibility: it relies on "RES curtailment, redispatch of thermal units, and flexible gas generation", with about 300 MW of aFRR and 600 MW of mFRR procured daily (${src(SOURCES.enspired, 'Enspired')}).</p>
    <p>Gas has also been paid to be there. The 2016 flexibility remuneration mechanism paid €45,000 per MW a year to 4,994 MW, 4,412 MW of it gas, with a budget of €225m (${src(SOURCES.frm, 'European Commission')}). Its successor was drawn up with a €30,000 per MW starting price for 4,263 MW (${src(SOURCES.frm2, 'energypress')}). In 2024 the EU Energy Council adopted a Greek proposal that lets gas plants receive availability fees under the capacity mechanism rules (${src(SOURCES.council, 'energypress')}). What is paid in 2026 is not in any source we opened.</p>`;
  $('chart-h-3').textContent = 'Gas by month';
  $('chart-hint-3').textContent = 'Gas generation in each calendar month, in TWh.';
  const monthNames = MONTHS.map((m) => m.slice(0, 3));
  const monthX = (m) => Date.UTC(2001, m, 15);
  const monthLines = pick([2022, last.year - 1, last.year, 'past365']).map((y, k) => ({ name: title(y), color: css(yearColors[k]), points: row(y).gasMonth.map((v, m) => [monthX(m), v]), width: y === 'past365' ? 3 : 2 }));
  monthLines.forEach((sr) => { sr.markers = sr.points; });
  lineChart($('story-chart-3'), {
    series: monthLines,
    yMin: 0,
    yFormat: twhf,
    yTickFormat: (v) => `${v}`,
    xTicks: monthNames.map((m, k) => ({ t: monthX(k), label: m })),
    tooltip: (t, vals) => `<strong>${monthNames[new Date(t).getUTCMonth()]}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? twhf(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-3').innerHTML = legend(monthLines.map((sr) => [sr.name, sr.color]));

  // Chapter 4: zero prices, the gas floor and curtailment.
  const early = full.filter((r) => r.year <= 2022);
  const floorYears = full.filter((r) => r.year <= 2023).map((r) => r.gasMin);
  $('take-4').textContent = `The price was at or below zero for ${hrs(latest.zeroHours)} in the latest 365 days. Gas still averaged ${gwf(latest.cheapGas)} in those hours and never fell under ${gwf(latest.cheapGasMin)}, while solar was turned away.`;
  $('body-4').innerHTML = `<p>The day-ahead price was at or below zero for about ${n0(early.reduce((a, r) => a + r.zeroHours, 0) / early.length)} hours a year up to 2022, ${n0(row(2023)?.zeroHours ?? NaN)} in 2023, ${n0(row(2024)?.zeroHours ?? NaN)} in 2024, ${n0(row(2025)?.zeroHours ?? NaN)} in 2025 and ${n0(latest.zeroHours)} in the latest 365 days; ${n0(latest.negHours)} of those were below zero. ${busy.length ? `In ${endYear} the heavy months were ${list(busy.map((m) => `${monthName(m)} (${n0(m.zeroHours)}${soFar(m)})`))}. ` : ''}On 1 May 2025 the hourly price hit €50 below zero (${src(SOURCES.bgenNeg, 'BGEN')}). ${solarMax ? `Solar peaked at ${gwf(solarMax.solar)} on ${fmtDateTime(at(solarMax.i))} Greek time, with gas at ${gwf(solarMax.gas)} and a price of ${eur(solarMax.price)}.` : ''} Installed solar was 9.8 GW at the end of 2025 (Energy-Charts), and IPTO says it reached the 2030 goal of 13.5 GW in summer 2026 (${src(SOURCES.ipto2035, 'BGEN')}).</p>
    <p>In the zero-price hours of the latest 365 days gas averaged ${gwf(latest.cheapGas)} and was never under ${gwf(latest.cheapGasMin)}, while solar averaged ${gwf(latest.cheapSolar)} and net exports ${gwf(latest.cheapExport)}. Gas was under ${GAS_FLOOR} GW for only ${hrs(last.gasLow)} in ${last.year} and ${hrs(latest.gasLow)} in the latest 365 days, and the lowest it went was ${gwf(last.gasMin)} in ${last.year} and ${gwf(latest.gasMin)} in the latest 365 days. That floor has risen: each year's lowest gas was between ${gwf(Math.min(...floorYears))} and ${gwf(Math.max(...floorYears))} from ${first.year} to 2023, then ${gwf(row(2024)?.gasMin ?? NaN)} in 2024. Meanwhile solar is switched off: curtailment was about 2 TWh in 2025, about 7.5% of renewable output, against 0.9 TWh in 2024, and the 2026 forecast is 3.3 to 3.7 TWh, with the cuts running from about 09:00 to 16:00 (${src(SOURCES.pvmag, 'pv magazine')}). Ricardo puts 2025 curtailment at 7% at market level, about 10% for an average PV plant, most of it technical, ordered by IPTO for grid constraints rather than price (${src(SOURCES.ricardo, 'Ricardo')}). From May 2026 zero and negative prices came almost daily, at least four hours at a time, and solar parks on contracts for difference lost about half their April revenue year on year (${src(SOURCES.bgenSolar, 'BGEN')}), because the contract pays nothing in a run of two or more zero-price hours (${src(SOURCES.bgenZero, 'BGEN')}).</p>
    <p>Why gas stays on at a zero price is not stated in any source we opened, so this is inferred. Three things fit the data. First, reserves: IPTO buys about 300 MW of aFRR and 600 MW of mFRR every day and gas plants dominate the balancing market (${src(SOURCES.enspired, 'Enspired')}, ${src(SOURCES.pvmag2024, 'pv magazine')}), and a plant cannot offer upward reserve unless it is already running. Second, the evening ramp: the ${gwf(latest.gasHour[21])} at ${hh(21)} means units cannot all shut at noon and restart, so some sit at minimum load. Third, the balancing market pays for it: Alba put Greece's balancing costs at over €1bn in 2025 and called the level hard to explain by technical need alone (${src(SOURCES.alba, 'Alba')}). What the data shows without inference is this: a floor of about half a gigawatt of gas that the day-ahead price does not move, and a solar fleet that is turned down around it.</p>`;
  $('chart-h-4').textContent = 'Hours a year at a zero or negative day-ahead price';
  $('chart-hint-4').textContent = `Hours each year; the last bar is the latest 365 days. Gas in those hours: ${gwf(latest.cheapGas)} on average in the latest 365 days, never under ${gwf(latest.cheapGasMin)}. Gas, solar and net exports for each year are in the tooltip.`;
  const ch4 = [
    { name: 'Below zero', color: css('--f-solar'), values: rows.map((r) => r.negHours) },
    { name: 'Exactly zero', color: css('--f-wind'), values: rows.map((r) => r.zeroHours - r.negHours) },
  ];
  barChart($('story-chart-4'), {
    cats,
    stacks: ch4,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => { const r = rows[ci]; return `<strong>${title(r.year)}</strong><div>Zero or below: <b>${hrs(r.zeroHours)}</b></div>${r.zeroHours ? `<div>Gas then: <b>${gwf(r.cheapGas)}</b> (lowest ${gwf(r.cheapGasMin)})</div><div>Solar then: <b>${gwf(r.cheapSolar)}</b></div><div>Net exports then: <b>${gwf(r.cheapExport)}</b></div>` : ''}`; },
  });
  $('story-legend-4').innerHTML = legend([...ch4].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 5: what's coming.
  $('take-5').textContent = 'Lignite goes in 2027. Batteries arrived in 2026 and the target is 5 to 7 GW by 2030. Against that, three gas plants totalling about 2.5 GW are planned, so gas does not have an end date.';
  $('body-5').innerHTML = `<p>Batteries are the item that should move the gas floor and the zero-price hours together. ${batMonths.length ? `They first appear in the data in ${MONTHS[batMonths[0].month - 1]} ${batMonths[0].year}: ${list(batMonths.map((m, k) => `${n1(m.batGwh)} GWh${k ? '' : ' discharged'} in ${monthName(m)}${soFar(m)}`))}.` : ''} About 500 MW is operating and 1,403 MW / 4,439 MWh holds connection terms (${src(SOURCES.ipto2035, 'BGEN')}); Metlen's 330 MW / 790 MWh plant at Larissa, the largest, was commissioned in October 2026 (${src(SOURCES.metlen, 'Enerdata')}). None of the 900 MW from the three subsidised tenders was connected by the end of 2025 (${src(SOURCES.essNews, 'ESS News')}), and the government has raised the 2030 target to 5 to 7 GW, with 1.5 GW by 2027 (${src(SOURCES.bgenBess, 'BGEN')}). Sized against the latest 365 days, with ${GAS_FLOOR} GW taken as the floor: ${latest.batteries.map((b, i) => (i ? `${i === latest.batteries.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh on ${b.days}` : `${b.gw} GW and ${b.gwh} GWh of batteries would have covered all gas above the floor on ${b.days} ${b.days === 1 ? 'day' : 'days'}`)).join(', ')}. The median day needs ${n0(median.gwh)} GWh above ${GAS_FLOOR} GW and the worst ${n0(worst.gwh)} GWh. So the first few gigawatts of batteries will mostly cut the zero-price hours and the noon curtailment, and lengthen the spells with gas under ${GAS_FLOOR} GW on spring and autumn days. They will not touch the January or July total.</p>
    <p>The interconnections mostly move the export records, not the gas. Crete joined the mainland through the 1 GW Attica link in May 2025 (${src(SOURCES.crete, 'Enerdata')}), so Crete's load is presumably in the data from then and its oil plants are not (inferred: oil reads zero throughout). The final Cyclades phase (Santorini, Milos, Folegandros, Serifos) was in testing in July 2026 (${src(SOURCES.cyclades, 'BGEN')}). The Dodecanese and North Aegean links have slipped to 2030 and the second Italy cable (1 GW) to 2033 (${src(SOURCES.iptoDelay, 'BGEN')}). More capacity abroad, with Italy at €176 against Greece at €97 on an August day (${src(SOURCES.tovimaAug, 'To Vima')}), means more evening gas sold, not less.</p>
    <p>Hours with gas under ${GAS_FLOOR} GW went from ${n0(last.gasLow)} in ${last.year} to ${n0(latest.gasLow)} in the latest 365 days. The longest spell under ${GAS_FLOOR} GW, ${spellText(gasFloorSpell)}, is from when gas was a small fleet and lignite did the work. That count, and a new spell set with lignite gone, are the things to watch.</p>`;
  $('chart-h-5').textContent = `Hours a year with gas under ${GAS_FLOOR} GW`;
  $('chart-hint-5').textContent = 'The last bar is the latest 365 days. The lowest quarter hour of gas is in the tooltip.';
  const ch5 = [{ name: `Gas under ${GAS_FLOOR} GW`, color: css('--lowcarbon'), values: rows.map((r) => r.gasLow) }];
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under ${GAS_FLOOR} GW: <b>${n0(rows[ci].gasLow)}</b></div><div>Lowest gas: <b>${gwf(rows[ci].gasMin)}</b></div><div>Gas: <b>${twhf(rows[ci].gasTwh)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));

  const coming = [
    ['By end of 2026, formally by March 2027', 'Ptolemaida 5 (660 MW), the last lignite unit, stops burning lignite; IPTO asked that decommissioning wait until March 2027.', 'agDim', `the longest spell with lignite under ${LIGNITE_OFF} GW (${ligOffSpell ? hrs(spellH(ligOffSpell)) : 'none yet'} now), then lignite at zero, which should run without end.`],
    ['End of 2026', 'Final investment decision expected on the Larissa CCGT, 794 MW, about three years to build.', 'larissa', 'the gas peak on winter evenings, which this adds to from about 2029.'],
    ['2027', '1.5 GW interim storage target.', 'bgenBess', `hours at a zero or negative price (${n0(latest.zeroHours)} in the latest 365 days) and hours with gas under ${GAS_FLOOR} GW (${n0(latest.gasLow)}).`],
    ['Late 2027', 'Alexandroupolis CCGT, 840 MW, commercial operation.', 'ports', 'net exports above 2 GW, and the gas peak. More gas plant means more gas sold abroad on a tight Balkan evening, not less gas.'],
    ['2028 (soft)', 'Ptolemaida 5 converts to gas: a 350 MW turbine, then a 500 MW combined cycle.', 'gem', `the gas floor; the spell with fossil under ${GAS_FLOOR} GW gets no help from this.`],
    ['2030', 'Dodecanese and North Aegean links, delayed from 2029; storage target 5 to 7 GW.', 'iptoDelay', `the solar peak (${solarMax ? gwf(solarMax.solar) : '—'} so far), spells with fossil under 1 GW and 0.5 GW, and net exports.`],
    ['2033', 'Second Greece-Italy cable, 1 GW, delayed from 2031.', 'iptoDelay', 'net exports above 3 and 4 GW. Expect evening gas to rise with it.'],
    ['No date', 'Great Sea Interconnector to Cyprus (1 GW, €1.43bn cable contract): timeline revised with no new date.', 'gsi', 'nothing yet.'],
  ];
  $('coming').innerHTML = coming.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--f-gas)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
  const watch = [
    ['--f-lignite', `Lignite, longest spell under ${LIGNITE_OFF} GW`, spellText(ligOffSpell), 'Should start running for good when Ptolemaida 5 stops; the lignite-at-zero rung follows once the trickle readings go.'],
    ['--fossil', 'Fossil, longest spell under 1 GW', spellText(fossil1Spell), 'With lignite gone this is a gas record; a spring weekend with batteries charging at noon could beat it.'],
    ['--fossil', 'Fossil, longest spell under 2 GW', spellText(fossil2Spell), ''],
    ['--fossil', 'Fossil under 0.5 GW', under05 ? `last in ${under05.year}` : 'never', `lowest fossil output ${gwf(last.fosMin)} in ${last.year} and ${gwf(latest.fosMin)} in the latest 365 days. With gas never under ${gwf(latest.gasMin)} lately, the first hour back under 0.5 GW is the record to notice.`],
    ['--f-gas', `Gas, hours a year under ${GAS_FLOOR} GW`, `${n0(last.gasLow)} in ${last.year}`, `${n0(latest.gasLow)} in the latest 365 days; a post-lignite spell will be the real one.`],
    ['--f-solar', 'Solar peak', solarMax ? gwf(solarMax.solar) : '—', solarMax ? `on ${fmtDate(at(solarMax.i))}` : ''],
    ['--f-imports', 'Net exports above 2, 3 and 4 GW', 'on the Records card', 'The one record new gas plants and new cables push up.'],
    ['--f-solar', 'Hours at a zero or negative price', n0(latest.zeroHours), 'in the latest 365 days, on chart 4. Batteries should bring it down; more solar pushes it up.'],
  ];
  $('watch').innerHTML = watch.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('');
}
