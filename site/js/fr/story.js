// The France story: why France now turns its reactors down on sunny days.
// Because it has run out of other things to do with the power: fossil plants
// are nearly off, the borders are full, so nuclear gives way to solar at noon.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import fr from '../countries/fr.js';
import { FOSSIL, LOW_CARBON, GENERATION, metricSeries, byYear } from './data.js';

// Levels the story follows, in GW.
export const NUC_LOW = 30;
export const EXPORT_HIGH = 15;
export const DIP_DAY = 3;
// Gas below this is the floor that runs whatever happens; batteries are sized
// against the gas above it.
export const GAS_FLOOR = 0.5;
// Battery fleets (GW, GWh) the story tests against each day's gas.
export const BATTERIES = [[3, 10], [5, 20], [8, 40], [12, 80]];
// A day with more gas than this above the floor, in GWh, counts as a heavy gas day.
export const HEAVY_GAS_DAY = 50;
// Local hours compared for the noon dip: night 02:00-05:00, noon 12:00-15:00.
const NIGHT = [2, 4];
const NOON = [12, 14];
// The months of the hour-of-day nuclear profile, April to June.
const SPRING = [4, 6];

/**
 * Local hour, month and day number for every slot. The Paris offset is looked
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
      offset = tzOffsetMs(d * 864e5 + 432e5, fr.timeZone);
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
 * Every number the story uses. Rows run by French calendar year, complete
 * years only, then 'past365' for the latest 365 days.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const nuclear = metricSeries(d, ['nuclear']);
  const solar = metricSeries(d, ['solar']);
  const fossil = metricSeries(d, FOSSIL);
  const low = metricSeries(d, LOW_CARBON);
  const price = data.columns.price ?? new Float64Array(end).fill(NaN);
  const { imports, exports } = data.columns;
  const pumping = data.columns.pumped_storage_charge;
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const { hour, month, day } = localClock(d);

  const rows = byYear(d, () => ({
    nucTwh: 0, solTwh: 0, gasTwh: 0, fosTwh: 0, nucMin: Infinity, nucMinAt: -1, nucLow: 0, fosU1: 0, fosU2: 0,
    expTwh: 0, impTwh: 0, impHours: 0, expHigh: 0, expMax: 0, pumpTwh: 0, lowSum: 0, genSum: 0,
    priceSum: 0, priceN: 0, byHour: new Float64Array(24), byHourN: new Float64Array(24),
    spring: new Float64Array(24), springN: new Float64Array(24),
    day: null, dips: [],
    gasMonth: new Float64Array(12), gasExporting: 0, gasExporting10: 0, gasImporting: 0, gasMin: Infinity, gasLow: 0,
    gasHour: new Float64Array(24), gasHourN: new Float64Array(24),
  }), (r, i) => {
    const nu = nuclear[i];
    if (Number.isNaN(nu)) return;
    const h = hour[i];
    // The noon dip, one day at a time.
    if (r.day?.n !== day[i]) {
      if (r.day) r.dips.push(r.day);
      r.day = { n: day[i], month: month[i], night: 0, nightN: 0, noon: 0, noonN: 0, gasAbove: 0, gasPeak: 0, nucMax: 0, net: 0, netN: 0, solar: 0 };
    }
    if (h >= NIGHT[0] && h <= NIGHT[1]) { r.day.night += nu; r.day.nightN++; }
    if (h >= NOON[0] && h <= NOON[1]) { r.day.noon += nu; r.day.noonN++; }
    r.nucTwh += (nu * slotH) / 1000;
    r.solTwh += (solar[i] * slotH) / 1000;
    const g = (data.columns.gas[i] || 0) / 1000;
    const net = (imports[i] || 0) + (exports[i] || 0);
    r.gasTwh += (g * slotH) / 1000;
    r.gasMonth[month[i] - 1] += (g * slotH) / 1000;
    if (net < 0) r.gasExporting += (g * slotH) / 1000;
    if (net < -10000) r.gasExporting10 += (g * slotH) / 1000;
    if (net > 0) r.gasImporting += (g * slotH) / 1000;
    if (g < r.gasMin) r.gasMin = g;
    r.day.gasAbove += Math.max(0, g - GAS_FLOOR) * slotH;
    if (g > r.day.gasPeak) r.day.gasPeak = g;
    if (nu > r.day.nucMax) r.day.nucMax = nu;
    r.day.net += net / 1000;
    r.day.netN++;
    r.day.solar += solar[i] * slotH;
    if (g < GAS_FLOOR) r.gasLow += slotH;
    r.gasHour[h] += g;
    r.gasHourN[h]++;
    r.fosTwh += (fossil[i] * slotH) / 1000;
    if (nu < r.nucMin) { r.nucMin = nu; r.nucMinAt = i; }
    if (nu < NUC_LOW) r.nucLow += slotH;
    if (fossil[i] < 1) r.fosU1 += slotH;
    if (fossil[i] < 2) r.fosU2 += slotH;
    const ex = -(exports[i] || 0);
    const im = imports[i] || 0;
    r.expTwh += (ex * slotH) / 1e6;
    r.impTwh += (im * slotH) / 1e6;
    if (im > 0) r.impHours += slotH;
    if (ex >= EXPORT_HIGH * 1000) r.expHigh += slotH;
    if (ex > r.expMax) r.expMax = ex;
    r.pumpTwh += (Math.abs(pumping[i] || 0) * slotH) / 1e6;
    let gen = 0;
    for (const col of genCols) gen += col[i] > 0 ? col[i] : 0;
    r.lowSum += low[i];
    r.genSum += gen / 1000;
    if (month[i] >= SPRING[0] && month[i] <= SPRING[1]) { r.spring[h] += nu; r.springN[h]++; }
    const p = price[i];
    if (Number.isNaN(p)) return;
    r.priceSum += p;
    r.priceN++;
    r.byHour[h] += p;
    r.byHourN[h]++;
  }).map((r) => {
    const dips = r.day ? [...r.dips, r.day] : r.dips;
    const full = dips.filter((x) => x.nightN && x.noonN).map((x) => x.night / x.nightN - x.noon / x.noonN);
    const spring = [...r.spring].map((v, k) => mean(v, r.springN[k]));
    return {
      year: r.year,
      nucTwh: r.nucTwh,
      solTwh: r.solTwh,
      gasTwh: r.gasTwh,
      fosTwh: r.fosTwh,
      nucMin: r.nucMin,
      nucMinAt: r.nucMinAt,
      nucLow: r.nucLow,
      fosU1: r.fosU1,
      fosU2: r.fosU2,
      expTwh: r.expTwh,
      impTwh: r.impTwh,
      netImpTwh: r.impTwh - r.expTwh,
      impHours: r.impHours,
      expHigh: r.expHigh,
      expMax: r.expMax / 1000,
      pumpTwh: r.pumpTwh,
      lowCarbonPct: (mean(r.lowSum, r.genSum) * 100),
      price: mean(r.priceSum, r.priceN),
      byHour: [...r.byHour].map((v, k) => mean(v, r.byHourN[k])),
      spring,
      springDip: spring[3] - spring[13],
      // Night minus noon, so a positive number means the reactors dip at noon.
      dip: mean(full.reduce((a, b) => a + b, 0), full.length),
      dipDays: full.filter((x) => x > DIP_DAY).length,
      gasMonth: [...r.gasMonth],
      gasExportingShare: r.gasExporting / r.gasTwh,
      gasExporting10Share: r.gasExporting10 / r.gasTwh,
      gasImporting: r.gasImporting,
      gasMin: r.gasMin,
      gasWinterShare: (r.gasMonth[10] + r.gasMonth[11] + r.gasMonth[0] + r.gasMonth[1] + r.gasMonth[2]) / r.gasTwh,
      // Days whose gas above the floor a battery fleet could have covered, if it was full.
      days: dips.length,
      gasHour: [...r.gasHour].map((v, k) => mean(v, r.gasHourN[k])),
      gasLow: r.gasLow,
      // Each day's gas above the floor (GWh) and its month, smallest first.
      gasDays: dips.map((x) => ({ gwh: x.gasAbove, month: x.month, peak: x.gasPeak })).sort((a, b) => a.gwh - b.gwh),
      // The days with the most gas: whether France was short of power on them.
      heavy: (() => {
        const h = dips.filter((x) => x.gasAbove > HEAVY_GAS_DAY && x.netN);
        return { days: h.length, exportGw: -mean(h.reduce((a, x) => a + x.net / x.netN, 0), h.length), nucPeak: mean(h.reduce((a, x) => a + x.nucMax, 0), h.length), solarGwh: mean(h.reduce((a, x) => a + x.solar, 0), h.length) };
      })(),
      nucMax: Math.max(...dips.map((x) => x.nucMax)),
      batteries: BATTERIES.map(([bgw, gwh]) => ({ gw: bgw, gwh, days: dips.filter((x) => x.gasAbove <= gwh && x.gasPeak - GAS_FLOOR <= bgw).length })),
    };
  });

  // Record spells and extremes over the whole record.
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: fr.timeZone };
  const exportSeries = new Float64Array(end);
  for (let i = 0; i < end; i++) exportSeries[i] = -exports[i] / 1000;
  let solarMax = 0;
  for (let i = 1; i < end; i++) if (solar[i] > solar[solarMax] || Number.isNaN(solar[solarMax])) solarMax = i;
  return {
    rows,
    nucLowSpell: spellOf(summarise(nuclear, NUC_LOW, 'below', opts)),
    exportSpell: spellOf(summarise(exportSeries, 10, 'above', opts)),
    fossil2Spell: spellOf(summarise(fossil, 2, 'below', opts)),
    fossilHalfSpell: spellOf(summarise(fossil, 0.5, 'below', opts)),
    solarMax: { i: solarMax, solar: solar[solarMax], nuclear: nuclear[solarMax], exports: exportSeries[solarMax] },
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
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

const SOURCES = {
  bilan2025: 'https://assets.rte-france.com/prod/public/2026-02/Bilan-electrique-2025-principaux-resultats.pdf',
  bilan2022: 'https://assets.rte-france.com/prod/public/2023-02/Communique-presse-bilan-electrique-2022_0.pdf',
  corrosion: 'https://www.edf.fr/en/the-edf-group/dedicated-sections/journalists/all-press-releases/update-on-the-stress-corrosion-phenomenon-and-adjustment-of-2022-french-nuclear-output-estimate',
  modulation: 'https://www.edf.fr/sites/groupe/files/epresspack/12701/PR-The-EDF-group-shares-the-key-findings-of-its-report-on-the-modulation-of-its-fleet.pdf',
  c13: 'https://www.cre.fr/fileadmin/Documents/Deliberations/import/221027_2022-270_AT_C13.pdf',
  c16: 'https://events.femto-st.fr/Journees-Cogeneration/sites/femto-st.fr.Journees-Cogeneration/files/content/pdf_2023/3_-_sophie_redoutey_edf_oa.pdf',
  aleasoft: 'https://aleasoft.com/european-market-prices-2025-second-lowest-since-2021-pv-records',
  bp2025: 'https://assets.rte-france.com/prod/public/2025-12/2025-12-16-bilan-previsionnel-principaux-resultats-2025.pdf',
  batteries: 'https://www.connaissancedesenergies.org/afp/le-plus-grand-site-de-stockage-delectricite-par-batteries-en-france-inaugure-pres-de-reims-261001',
  modo: 'https://modoenergy.com/research/france-battery-buildout-bess-construction-energy-storage-november-2025',
  capacity: 'https://www.cre.fr/fileadmin/Documents/Deliberations/2026/260127_2026-24_Avis_regles_mecanisme_capacite.pdf',
  epr2: 'https://www.edf.fr/sites/groupe/files/epresspack/12290/PR-EDF_EPR2-Programme-12.2025.pdf',
  cordemais: 'https://www.edf.fr/sites/groupe/files/2026-02/Fiche%20presse%20Cordemais%202026.pdf',
  saintAvold: 'https://www.connaissancedesenergies.org/afp/la-centrale-charbon-de-saint-avold-le-ministre-de-lindustrie-salue-la-future-conversion-au-gaz-250414',
  celtic: 'https://cms.eirgrid.ie/sites/default/files/publications/Celtic-Interconnector-Newsletter-June-2026.pdf',
  celticMw: 'https://en.wikipedia.org/wiki/Celtic_Interconnector',
  biscay: 'https://www.ree.es/en/activities/unique-projects/submarine-interconnection-with-france',
  ppe3: 'https://www.seban-associes.avocat.fr/?p=127963',
};

// Rough fuel and carbon cost of a combined-cycle gas plant in 2025: gas at
// €36.33/MWh and carbon at €76.85/t (AleaSoft's 2025 averages), 55%
// efficiency and 0.37 t of CO2 per MWh of power. An estimate, not a market figure.
export const CCGT_COST = 36.33 / 0.55 + 0.37 * 76.85;

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['1 Nov 2026', 'France\'s new capacity mechanism starts, approved to 2036. RTE pays plants to be available from November to March.', 'capacity', 'The gas floor: paying plants to stay open works against it falling.'],
  ['31 Mar 2027', 'Cordemais, the last EDF coal plant (2 × 600 MW), stops.', 'cordemais', 'Coal goes to zero, so coal no longer breaks the spells with fossil under 0.5 GW and 1 GW.'],
  ['2027 (target)', 'Saint-Avold (618 MW) converts from coal to gas, under a law passed in April 2025.', 'saintAvold', 'Coal to zero, but 0.6 GW more gas: watch the gas peak on cold days.'],
  ['By about 2028 (inferred)', 'The last C13 cogeneration contracts end. They run 12 years and were signed from 2013 until C16 replaced the tariff in 2016; new gas cogeneration support ended in 2021.', 'c16', 'The winter gas floor, and November to March gas.'],
  ['2028', 'Celtic Interconnector to Ireland (700 MW) and the Bay of Biscay link to Spain (2 × 1,000 MW) start.', 'biscay', 'Biggest net export; hours exporting 15 GW or more. More room abroad can mean more evening gas, not less.'],
  ['2030', 'PPE3 targets: 48 GW of solar and 31 GW of onshore wind. Batteries reach about 5 GW, from just over 1.5 GW at the end of 2025.', 'ppe3', 'Solar peak; days with a noon nuclear dip; hours with gas under 0.5 GW from April to October.'],
  ['From 2030', 'RTE\'s fast case needs 2 to 4 GW of extra peak capacity, and keeps about 12.5 GW of the existing gas fleet to 2035.', 'bp2025', 'Gas does not reach zero in RTE\'s outlook; the winter total stays.'],
  ['2035', 'PPE3: 15 GW of offshore wind, the first large winter source beyond nuclear and hydro.', 'ppe3', 'November to March gas, and calm-spell records for wind.'],
  ['2038', 'The first of six EPR2 reactors, at Penly.', 'epr2', 'Nuclear peaks; more surplus at noon rather than less gas.'],
];

export function renderStory(data, end, figs, installed = null) {
  const { rows, fossilHalfSpell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? first;
  const crisis = full.reduce((a, r) => (r.nucTwh < a.nucTwh ? r : a), first);
  const leastGas = full.reduce((a, r) => (r.gasTwh < a.gasTwh ? r : a), first);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const capYear = installed ? Math.max(...installed.years) : null;
  const nucCap = installed ? installed.types.Nuclear?.[installed.years.indexOf(capYear)] : NaN;
  const heavy = last.heavy;
  const pc = (v) => `${Math.round(v * 100)}%`;
  const bat = (k) => last.batteries[k];
  const winterAbove = last.gasDays.filter((x) => x.month >= 11 || x.month <= 2).reduce((a, x) => a + x.gwh, 0) / 1000;
  const summerAbove = last.gasDays.filter((x) => x.month >= 4 && x.month <= 9).reduce((a, x) => a + x.gwh, 0) / 1000;
  const totalAbove = last.gasDays.reduce((a, x) => a + x.gwh, 0) / 1000;
  const median = last.gasDays[Math.floor(last.gasDays.length / 2)];
  const worst = last.gasDays.at(-1);

  // Header and in short.
  $('lede').textContent = `France burnt ${twh(last.gasTwh)} of gas in ${last.year}${leastGas === last ? ', the least in the data,' : ''} and ${pc(last.gasExportingShare)} of it while the country was exporting power.`;
  $('answer-lead').textContent = `France still burns gas for two reasons, and almost never because it is short of power. Most of it runs on winter evenings when the neighbours pay more than its fuel and carbon cost, while French reactors have room to spare; the rest is about 2.3 GW of cogeneration paid under contract to run from November to March. Nothing now planned takes gas to zero: RTE keeps about 12.5 GW of gas plant to 2035, so the records to watch are the gas floor and the spells with fossil under 0.5 GW.`;
  $('answer-points').innerHTML = [
    `<b>Gas runs for the neighbours.</b> In ${last.year}, ${pc(last.gasExportingShare)} of France's gas was burnt while it was a net exporter and ${pc(last.gasExporting10Share)} while it was exporting more than 10 GW; only ${twh(last.gasImporting)} while importing. The evening price pays for it: ${eur(last.byHour[20])} a megawatt hour at ${hh(20)} against ${eur(last.byHour[13])} at ${hh(13)}. ${link(1, 'Chapters 1')} and ${link(2, '2')}`,
    `<b>The floor is a contract.</b> Gas never fell below ${gw(last.gasMin)} in ${last.year}, and ${pc(last.gasWinterShare)} of it was burnt from November to March, the months a 2.3 GW cogeneration tariff pays plants to run. ${link(3, 'Chapter 3')}`,
    `<b>Batteries can end the summer gas, not the winter gas.</b> ${bat(0).gw} GW and ${bat(0).gwh} GWh of batteries would have covered all gas above ${GAS_FLOOR} GW on ${bat(0).days} days of ${last.year}; ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}. The days left are deep winter, and the plans to 2030 don't reach them. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-gas', `Gas burnt in ${last.year}`, twh(last.gasTwh), `against ${twh(crisis.gasTwh)} in ${crisis.year} and ${twh(first.gasTwh)} in ${first.year}`],
    ['--f-gas', `Lowest gas output in ${last.year}`, gw(last.gasMin), `the plants never all stopped; ${gw(latest.gasMin)} in the latest 365 days`],
    ['--f-solar', `Price at ${hh(13)} and ${hh(20)}`, `${eur(last.byHour[13])} vs ${eur(last.byHour[20])}`, `per MWh on average in ${last.year}; a gas plant's fuel and carbon came to roughly ${eur(CCGT_COST)}`],
    ['--fossil', 'Longest spell with fossil under 0.5 GW', fossilHalfSpell ? hrs(spellH(fossilHalfSpell)) : 'None', fossilHalfSpell ? `from ${fmtDate(at(fossilHalfSpell.start))}: the record to beat` : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${pc(last.gasExportingShare)}</div><div class="sub">Share of the gas France burnt in ${last.year} that was burnt while the country was a net exporter of power. In ${crisis.year}, the year the reactors failed, it was ${pc(crisis.gasExportingShare)}.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: more clean power than France can use, gas that runs for the neighbours, gas that runs on contract, what batteries could and could not replace, and what is coming, with the record each item should move.';

  const chapters = [
    'France has more clean power than it can use',
    'Gas runs for the neighbours',
    'Gas runs on contract',
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
  const yearColors = ['--f-other', '--f-gas', '--f-hydro', '--f-nuclear'];

  // Chapter 1: the surplus.
  $('take-1').textContent = `On the ${heavy.days} days with the most gas in ${last.year}, nuclear peaked at ${gw(heavy.nucPeak)}${Number.isFinite(nucCap) ? ` of a ${Math.round(nucCap)} GW fleet` : ''} and France still exported ${gw(heavy.exportGw)}: gas is not filling a gap.`;
  $('body-1').innerHTML = `In ${crisis.year} France was short of power: twelve reactors were shut for stress-corrosion checks (${src(SOURCES.corrosion, 'EDF')}), nuclear made ${twh(crisis.nucTwh)}, gas made ${twh(crisis.gasTwh)}, and ${twh(crisis.gasImporting)} of that gas was burnt while the country was importing. By ${last.year} nuclear was back at ${twh(last.nucTwh)}, solar had reached ${twh(last.solTwh)}, and the problem had reversed. France exported ${twh(last.expTwh)} gross, was a net importer in only ${hrs(last.impHours)}, and turned its reactors down more than ${DIP_DAY} GW at midday on ${last.dipDays} days; EDF says it modulated 33 TWh in 2025 (${src(SOURCES.modulation, 'EDF')}). On the ${heavy.days} days when gas above ${GAS_FLOOR} GW passed ${HEAVY_GAS_DAY} GWh, nuclear's daily peak averaged ${gw(heavy.nucPeak)}, against ${gw(last.nucMax)} at its highest that year${Number.isFinite(nucCap) ? ` and ${Math.round(nucCap)} GW installed` : ''}, and France still exported ${gw(heavy.exportGw)} on average. The reactors had room. Gas ran anyway, for the reasons in the next two chapters.`;
  $('chart-h-1').textContent = 'Gas burnt while importing and while exporting';
  $('chart-hint-1').textContent = 'Gas generation each year, in TWh, split by whether France was a net importer or a net exporter in that quarter hour. The last bar is the latest 365 days.';
  const ch1 = [
    { name: 'While importing', color: css('--f-imports'), values: rows.map((r) => r.gasImporting) },
    { name: 'While exporting', color: css('--f-gas'), values: rows.map((r) => r.gasTwh - r.gasImporting) },
  ];
  barChart($('story-chart-1'), {
    cats,
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => rows[ci].year === crisis.year,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Gas: <b>${twh(rows[ci].gasTwh)}</b></div>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}<div>While exporting over 10 GW: <b>${pc(rows[ci].gasExporting10Share)}</b></div>`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: gas by hour and the price.
  $('take-2').textContent = `${pc(last.gasExporting10Share)} of ${last.year}'s gas was burnt while France exported more than 10 GW, because the evening price covers a gas plant's fuel and carbon.`;
  $('body-2').innerHTML = `A reactor's fuel is cheap, so EDF turns one down only when the price is near zero. A gas plant runs only when the price beats its fuel and carbon. With gas at €36 a megawatt hour and carbon at €77 a tonne on average in 2025 (${src(SOURCES.aleasoft, 'AleaSoft')}), a combined-cycle plant needs roughly ${eur(CCGT_COST)} a megawatt hour, our estimate at 55% efficiency. The French day-ahead price averaged ${eur(last.byHour[13])} at ${hh(13)} and ${eur(last.byHour[20])} at ${hh(20)} in ${last.year}. So gas runs in the evening, and much of the evening demand is abroad: ${pc(last.gasExporting10Share)} of ${last.year}'s gas was burnt while France exported more than 10 GW net, against ${pc(first.gasExporting10Share)} in ${first.year}. Gas averaged ${gw(last.gasHour[3])} at ${hh(3)} and ${gw(last.gasHour[20])} at ${hh(20)}. EDF reports that gas plant starts and stops doubled (${src(SOURCES.modulation, 'EDF')}). Italy, Germany and Spain set their evening price with their own gas, and France sells into it.`;
  $('chart-h-2').textContent = 'Gas by hour of day';
  $('chart-hint-2').textContent = 'Average gas output for each hour of the day, French time, in GW. The average price at each hour is in the tooltip. The thick line is the latest 365 days.';
  const gasYears = [row(2019).year, crisis.year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const gasLines = gasYears.map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).gasHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-2'), {
    series: gasLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b> at ${eur(row(v.series.year).byHour[hr])}/MWh</div>`).join('')}`;
    },
  });
  $('story-legend-2').innerHTML = legend(gasLines.map((sr) => [sr.name, sr.color]));

  // Chapter 3: by month, and the cogeneration contract.
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const lm = last.gasMonth;
  $('take-3').textContent = `${pc(last.gasWinterShare)} of ${last.year}'s gas was burnt from November to March, and gas never fell below ${gw(last.gasMin)}, because about 2.3 GW of cogeneration is paid to run through the winter.`;
  $('body-3').innerHTML = `Not all gas follows the price. About 2.3 GW of small gas cogeneration plants, 632 contracts averaging 3.7 MW, sell under the C13 purchase obligation: a 12-year contract that pays a fixed fee plus a gas-indexed price to run during a tariff winter from 1 November to 1 April, in most cases around the clock (${src(SOURCES.c13, 'CRE')}). It shows in the data. Gas ran at ${twh(lm[0])}, ${twh(lm[1])} and ${twh(lm[2])} from January to March ${last.year}, ${twh(Math.min(...lm.slice(3, 9)))} to ${twh(Math.max(...lm.slice(3, 9)))} a month from April to September, and ${twh(lm[10])} and ${twh(lm[11])} in November and December. The floor never reached zero: ${gw(last.gasMin)} in ${last.year} and ${gw(latest.gasMin)} in the latest 365 days. RTE says the gas capacity that closed in 2025 was mainly small cogeneration (${src(SOURCES.bilan2025, 'RTE')}), and support for new gas cogeneration ended in 2021 (${src(SOURCES.c16, 'EDF OA')}).`;
  $('chart-h-3').textContent = 'Gas by month';
  $('chart-hint-3').textContent = 'Gas generation in each calendar month, in TWh. The contract winter runs from November to March.';
  const monthYears = [row(2023).year, row(2024).year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const monthX = (m) => Date.UTC(2001, m, 15);
  const monthLines = monthYears.map((y, k) => ({ name: title(y), color: css(yearColors[k]), points: row(y).gasMonth.map((v, m) => [monthX(m), v]), width: y === 'past365' ? 3 : 2 }));
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

  // Chapter 4: battery sizing.
  $('take-4').textContent = `${bat(0).gw} GW and ${bat(0).gwh} GWh of batteries would have covered gas above the floor on ${bat(0).days} days of ${last.year}; ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}. The rest is winter, with little solar to charge from.`;
  $('body-4').innerHTML = `Take the ${GAS_FLOOR} GW floor as given and ask what would have covered the rest, ${twh(totalAbove)} in ${last.year}. The median day needed ${n0(median.gwh)} GWh and peaked at ${gw(median.peak)}; the worst needed ${n0(worst.gwh)} GWh and ${gw(worst.peak)}. Against those days, ${last.batteries.map((b, i) => (i ? `${i === last.batteries.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh ${b.days}` : `${b.gw} GW and ${b.gwh} GWh of batteries would have covered ${b.days} days`)).join(', ')}. France had just over 1.5 GW of batteries at the end of 2025, and about 14 GW of projects hold grid connections (${src(SOURCES.batteries, 'AFP')}); Modo Energy expects about 5 GW by 2030 (${src(SOURCES.modo, 'Modo Energy')}). The sizing assumes the batteries could charge. In summer they can, from the noon surplus. On the ${heavy.days} heaviest gas days solar averaged ${n0(heavy.solarGwh)} GWh a day, and gas above the floor came to ${twh(winterAbove)} from November to February against ${twh(summerAbove)} from April to September. Batteries can end the shoulder-season gas and lengthen the spells under 0.5 GW; January is a different problem, and RTE says batteries suit shortfalls of hours to days, not long cold spells (${src(SOURCES.bp2025, 'RTE')}).`;
  $('chart-h-4').textContent = `Each day of ${last.year}, by the gas a battery would have had to replace`;
  $('chart-hint-4').textContent = `Each day's gas above ${GAS_FLOOR} GW, in GWh, sorted from smallest to largest. The lines mark what 10, 20, 40 and 80 GWh of batteries could supply; days below a line are covered, if the batteries could charge.`;
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
      return x ? `<strong>Day ${k + 1} of ${last.gasDays.length}</strong><div>Gas above ${GAS_FLOOR} GW: <b>${n0(x.gwh)} GWh</b></div><div>Peak gas: <b>${gw(x.peak)}</b></div><div>Month: <b>${monthNames[x.month - 1]}</b></div>` : '';
    },
  });
  $('story-legend-4').innerHTML = `${legend(sorted.map((sr) => [sr.name, sr.color]))}<span>Lines: ${last.batteries.map((b) => `${b.gwh} GWh`).join(', ')}</span>`;

  // Chapter 5: what's coming.
  $('take-5').textContent = 'Coal ends in 2027, the cogeneration contracts by about 2028 and solar nearly doubles by 2030, but RTE keeps about 12.5 GW of gas plant to 2035.';
  $('body-5').innerHTML = `The dated items are listed below, each with the record it should move. Coal goes first: Cordemais stops on 31 March 2027 (${src(SOURCES.cordemais, 'EDF')}) and Saint-Avold is to convert to gas (${src(SOURCES.saintAvold, 'AFP')}). The C13 contracts are 12 years long and the last were signed in 2016, so they should run out by about 2028 (our inference from the contract terms), which should lower the winter floor. Batteries at about 5 GW by 2030 cut the shoulder months. Against that, the new capacity mechanism pays existing plants to stay available from November 2026 to 2036 (${src(SOURCES.capacity, 'CRE')}), and RTE expects around 20 TWh a year of gas in 2026 and 2027 and needs 2 to 4 GW of extra peak capacity from 2030 in its fast case (${src(SOURCES.bp2025, 'RTE')}). Gas is falling, but no date now fixed takes it to zero. Hours with gas under ${GAS_FLOOR} GW went from ${hrs(first.gasLow)} in ${first.year} to ${hrs(last.gasLow)} in ${last.year}: that is the count to watch.`;
  $('chart-h-5').textContent = `Hours a year with gas under ${GAS_FLOOR} GW`;
  $('chart-hint-5').textContent = 'Hours each year with gas output under 0.5 GW. The lowest quarter hour of gas is in the tooltip. The last bar is the latest 365 days.';
  const ch5 = [{ name: `Gas under ${GAS_FLOOR} GW`, color: css('--lowcarbon'), values: rows.map((r) => r.gasLow) }];
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => rows[ci].year === crisis.year,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under ${GAS_FLOOR} GW: <b>${n0(rows[ci].gasLow)}</b></div><div>Lowest gas: <b>${gw(rows[ci].gasMin)}</b></div><div>Gas: <b>${twh(rows[ci].gasTwh)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--f-gas)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
