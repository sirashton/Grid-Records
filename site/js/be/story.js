// The Belgium story: what happened when the last two reactors were off for
// six months. From April to October 2026 Belgium ran with no nuclear power at
// all, and imports, not gas, filled most of the gap. Gas still runs every hour
// of the year: a floor of cogeneration and the evening ramp after the sun sets.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import be from '../countries/be.js';
import { FOSSIL, WIND, GENERATION, metricSeries, byYear } from './data.js';

// Levels the story follows, in GW.
export const NUC_OFF = 0.1;
export const FOSSIL_LOW = 1;
export const GAS_FLOOR = 0.5;
export const IMPORT_HIGH = 4;
// The summer window compared across years, April to September.
const SUMMER = [4, 9];

/**
 * Local hour, month and year for every slot. The Brussels offset is looked up
 * once per UTC day, so the hour around a clock change can be one off.
 */
function localClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Uint8Array(data.length);
  const year = new Uint16Array(data.length);
  let utcDay = -1;
  let offset = 0;
  for (let i = 0; i < data.length; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== utcDay) {
      utcDay = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, be.timeZone);
    }
    const l = new Date(t + offset);
    hour[i] = l.getUTCHours();
    month[i] = l.getUTCMonth() + 1;
    year[i] = l.getUTCFullYear();
  }
  return { hour, month, year };
}

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);
const val = (v) => (Number.isFinite(v) ? v : 0);

/**
 * Every number the story uses. Rows run by Belgian calendar year, complete
 * years only, then 'past365' for the latest 365 days. `summers` has the
 * April to September averages for every year the data covers, 2026 included.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const nuclear = metricSeries(d, ['nuclear']);
  const fossil = metricSeries(d, FOSSIL);
  const wind = metricSeries(d, WIND);
  const solar = metricSeries(d, ['solar']);
  const price = data.columns.price ?? new Float64Array(end).fill(NaN);
  const { gas, imports, exports, demand } = data.columns;
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const { hour, month, year } = localClock(d);
  const net = new Float64Array(end);
  for (let i = 0; i < end; i++) net[i] = (val(imports[i]) + val(exports[i])) / 1000;

  const rows = byYear(d, () => ({
    nucTwh: 0, gasTwh: 0, fosTwh: 0, solTwh: 0, windTwh: 0, impTwh: 0, expTwh: 0, genTwh: 0,
    gasMin: Infinity, gasMax: 0, fosU1: 0, gasU05: 0, nucOff: 0, impHigh: 0, impMax: 0,
    priceSum: 0, priceN: 0, neg: 0,
    byHour: new Float64Array(24), byHourN: new Float64Array(24),
    gasHour: new Float64Array(24), gasHourN: new Float64Array(24),
    netHour: new Float64Array(24),
  }), (r, i) => {
    const g = gas[i];
    if (Number.isNaN(g)) return;
    const h = hour[i];
    r.nucTwh += (val(nuclear[i]) * slotH) / 1000;
    r.gasTwh += (g * slotH) / 1e6;
    r.fosTwh += (val(fossil[i]) * slotH) / 1000;
    r.solTwh += (val(solar[i]) * slotH) / 1000;
    r.windTwh += (val(wind[i]) * slotH) / 1000;
    r.impTwh += (val(imports[i]) * slotH) / 1e6;
    r.expTwh += (-val(exports[i]) * slotH) / 1e6;
    let gen = 0;
    for (const col of genCols) gen += col[i] > 0 ? col[i] : 0;
    r.genTwh += (gen * slotH) / 1e6;
    if (g < r.gasMin) r.gasMin = g;
    if (g > r.gasMax) r.gasMax = g;
    if (fossil[i] < FOSSIL_LOW) r.fosU1 += slotH;
    if (g < GAS_FLOOR * 1000) r.gasU05 += slotH;
    if (nuclear[i] < NUC_OFF) r.nucOff += slotH;
    if (net[i] >= IMPORT_HIGH) r.impHigh += slotH;
    if (net[i] > r.impMax) r.impMax = net[i];
    r.gasHour[h] += g / 1000;
    r.gasHourN[h]++;
    r.netHour[h] += net[i];
    const p = price[i];
    if (Number.isNaN(p)) return;
    r.priceSum += p;
    r.priceN++;
    if (p < 0) r.neg += slotH;
    r.byHour[h] += p;
    r.byHourN[h]++;
  }).map((r) => ({
    year: r.year,
    nucTwh: r.nucTwh,
    gasTwh: r.gasTwh,
    fosTwh: r.fosTwh,
    solTwh: r.solTwh,
    windTwh: r.windTwh,
    impTwh: r.impTwh,
    expTwh: r.expTwh,
    netImpTwh: r.impTwh - r.expTwh,
    genTwh: r.genTwh,
    gasShare: r.gasTwh / r.genTwh,
    gasMin: r.gasMin / 1000,
    gasMax: r.gasMax / 1000,
    fosU1: r.fosU1,
    gasU05: r.gasU05,
    nucOff: r.nucOff,
    impHigh: r.impHigh,
    impMax: r.impMax,
    price: mean(r.priceSum, r.priceN),
    neg: r.neg,
    byHour: [...r.byHour].map((v, k) => mean(v, r.byHourN[k])),
    gasHour: [...r.gasHour].map((v, k) => mean(v, r.gasHourN[k])),
    netHour: [...r.netHour].map((v, k) => mean(v, r.gasHourN[k])),
  }));

  // April to September averages in GW, every year the data reaches.
  const S = new Map();
  for (let i = 0; i < end; i++) {
    if (month[i] < SUMMER[0] || month[i] > SUMMER[1] || Number.isNaN(gas[i])) continue;
    let s = S.get(year[i]);
    if (!s) S.set(year[i], (s = { year: year[i], n: 0, nuclear: 0, gas: 0, net: 0, solar: 0, wind: 0, demand: 0, demandN: 0, price: 0, priceN: 0, gasPeak: 0 }));
    s.n++;
    s.nuclear += val(nuclear[i]);
    s.gas += gas[i] / 1000;
    s.net += net[i];
    s.solar += val(solar[i]);
    s.wind += val(wind[i]);
    if (Number.isFinite(demand[i])) { s.demand += demand[i] / 1000; s.demandN++; }
    if (Number.isFinite(price[i])) { s.price += price[i]; s.priceN++; }
    if (gas[i] / 1000 > s.gasPeak) s.gasPeak = gas[i] / 1000;
  }
  // A summer counts only once the data reaches its end.
  const full = (y) => year[end - 1] * 100 + month[end - 1] > y * 100 + SUMMER[1];
  const summers = [...S.values()].filter((s) => full(s.year)).map((s) => ({
    year: s.year,
    nuclear: s.nuclear / s.n,
    gas: s.gas / s.n,
    net: s.net / s.n,
    solar: s.solar / s.n,
    wind: s.wind / s.n,
    demand: mean(s.demand, s.demandN),
    price: mean(s.price, s.priceN),
    gasPeak: s.gasPeak,
  }));

  // Monthly averages in GW, every month the data reaches.
  const M = new Map();
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(gas[i])) continue;
    const key = year[i] * 100 + month[i];
    let m = M.get(key);
    if (!m) M.set(key, (m = { year: year[i], month: month[i], n: 0, gas: 0, net: 0, nuclear: 0 }));
    m.n++;
    m.gas += gas[i] / 1000;
    m.net += net[i];
    m.nuclear += val(nuclear[i]);
  }
  const months = [...M.values()].map((m) => ({ year: m.year, month: m.month, gas: m.gas / m.n, net: m.net / m.n, nuclear: m.nuclear / m.n }));

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: be.timeZone };
  const gasGw = metricSeries(d, ['gas']);
  return {
    rows,
    summers,
    months,
    nucOffSpell: spellOf(summarise(nuclear, NUC_OFF, 'below', opts)),
    fossil1Spell: spellOf(summarise(fossil, FOSSIL_LOW, 'below', opts)),
    gasHalfSpell: spellOf(summarise(gasGw, GAS_FLOOR, 'below', opts)),
    importSpell: spellOf(summarise(net, IMPORT_HIGH, 'above', opts)),
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(1)} GW`;
const gw2 = (v) => `${v.toFixed(2)} GW`;
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
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SOURCES = {
  outage: 'https://aktualnosci.be/2026/10/17/reaktor-tihange-3-znow-produkuje-prad-po-kilkumiesiecznym-przegladzie-doel-4-ma-wrocic-do-pracy-w-srode-21-pazdziernika/',
  outageVrt: 'https://www.vrt.be/vrtnws/fr/2026/10/13/le-redemarrage-du-reacteur-nucleaire-tihange-3-devrait-avoir-lie/',
  tihange1: 'https://smr.nucnet.org/news/engie-shuts-down-belgium-s-tihange-1-nuclear-plant-after-50-years-10-3-2025',
  doel2: 'https://newmobility.news/en/2025/12/01/doel-2-nuclear-reactor-permanently-disconnected-from-grid-after-50-years/',
  repeal: 'https://www.foronuclear.org/en/updates/news/belgiums-parliament-votes-to-abandon-nuclear-phaseout-plans/',
  takeover: 'https://newmobility.news/en/2026/10/01/belgium-and-engie-buy-another-month-for-nuclear-takeover-talks/',
  elia2024: 'https://elia.be/-/media/project/elia/shared/documents/press-releases/2025/20250102_press-release_electricity-mix-2024_en.pdf',
  creg2025: 'https://www.creg.be/en/publications/study-f3197',
  gasWar: 'https://www.brusselstimes.com/2056113/energy-costs-in-belgium-surge-to-higher-levels-than-expected',
  heatwave: 'https://www.pv-magazine.com/2026/06/23/record-high-power-prices-in-belgium-netherlands-and-germany/',
  flemalle: 'https://en.newsroom.engie.com/news/engie-strengthens-the-resilience-of-the-belgian-electricity-system-with-new-flexible-capacities-d4ebc-314df.html',
  seraing: 'https://www.lalibre.be/dernieres-depeches/2026/10/05/nouveau-report-pour-la-centrale-au-gaz-de-luminus-a-seraing-QVCQNINPVZE5ZBDE4XNYVWNNUU/',
  crmBatteries: 'https://www.pv-magazine.com/2024/11/25/belgian-capacity-auctions-catalyze-1-1-gw-of-battery-storage/',
  drogenbos: 'https://www.ess-news.com/2026/05/28/engie-and-nhoa-energy-begin-construction-on-320-mwh-battery-in-belgium/',
  greenTurtle: 'https://www.ess-news.com/2026/09/25/giga-storage-starts-construction-on-2-8-gwh-belgian-bess/',
  pez: 'https://www.offshorewind.biz/2026/07/24/belgium-approves-new-tender-framework-for-first-princess-elisabeth-zone-offshore-wind-site/',
  pezDelay: 'https://www.aegirinsights.com/articles/relaunch-of-belgiums-princess-elisabeth-zone-auction-further-delayed',
  ventilus: 'https://www.loyensloeff.com/insights/news--events/news/belgium-offshore-wind-tender-amendment-and-ventilus-permit-push/',
  nemo: 'https://en.wikipedia.org/wiki/Nemo_Link',
  alegro: 'https://www.elia.be/en/news/press-releases/2020/11/20201109_cp-alegro-inauguration',
};

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['21 Oct 2026 (scheduled)', 'Doel 4 restarts after its maintenance outage, joining Tihange 3, which came back on 14 October.', 'outage', 'The nuclear floor: whether nuclear stays above 1 GW through the winter.'],
  ['4 Nov 2026', 'Deadline for the heads of terms on the state taking over all seven reactors from Engie. The government wants Doel 4 and Tihange 3 to run to 2045.', 'takeover', 'Nuclear output by year after 2035.'],
  ['Q2 2027', 'Luminus Seraing, an 870 MW gas plant contracted under the capacity mechanism, enters service after a third delay.', 'seraing', 'The highest gas output, 6.6 GW in the latest 365 days.'],
  ['From Nov 2027', 'Engie\'s Drogenbos battery (80 MW, 320 MWh) starts a 15-year capacity contract, after Vilvoorde (200 MW, 800 MWh) in November 2025.', 'drogenbos', 'The evening gas ramp, from early afternoon to 20:00.'],
  ['End of March 2028', 'Giga Storage\'s Green Turtle battery, 700 MW and 2.8 GWh, at Dilsen-Stokkem.', 'greenTurtle', 'Hours with gas under 0.5 GW.'],
  ['2028-29', '350 MW of batteries contracted in the October 2024 capacity auction come online.', 'crmBatteries', 'The evening gas ramp.'],
  ['1 Oct 2031', 'The first phase of the Princess Elisabeth Island grid hub is due in service; the 700 MW first offshore wind lot is still to be tendered.', 'pez', 'Wind records and the hours importing 4 GW or more.'],
];

export function renderStory(data, end, figs, installed = null) {
  const { rows, summers, months, nucOffSpell, importSpell, fossil1Spell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length || summers.length < 2) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const s1 = summers.at(-1);
  const s0 = summers.at(-2);
  // The summer gap: lost nuclear plus extra load, and what met it.
  const lost = s0.nuclear - s1.nuclear;
  const load = s1.demand - s0.demand;
  const gap = lost + load;
  const dImp = s1.net - s0.net;
  const dGas = s1.gas - s0.gas;
  const dSolar = s1.solar - s0.solar;
  const before = summers.filter((s) => s.year < s1.year && s.year <= 2023);
  const minBefore = before.reduce((a, s) => (s.gas < a.gas ? s : a), before[0]);
  const nucRange = [Math.min(...before.map((s) => s.nuclear)), Math.max(...before.map((s) => s.nuclear))];
  const month = (y, m) => months.find((x) => x.year === y && x.month === m);
  const jan1 = month(s1.year, 1);
  const jan0 = month(s0.year, 1);
  const apr1 = month(s1.year, 4);
  const apr0 = month(s0.year, 4);
  const impRecord = full.reduce((a, r) => (r.netImpTwh > a.netImpTwh ? r : a), first);
  const impHighBefore = full.reduce((a, r) => (r.impHigh > a.impHigh ? r : a), first);
  const gasLow = rows.reduce((a, r) => Math.min(a, r.gasMin), Infinity);
  const r2019 = rows.find((r) => r.year === 2019) ?? first;
  const H13 = latest.gasHour[13];
  const H20 = latest.gasHour[20];
  const netH = latest.netHour;
  const capYear = installed ? Math.max(...installed.years) : null;
  const gasCap = installed ? installed.types['Fossil gas']?.[installed.years.indexOf(capYear)] : NaN;
  const gasCap0 = installed ? installed.types['Fossil gas']?.[installed.years.indexOf(first.year)] : NaN;
  const offFrom = nucOffSpell ? fmtDate(at(nucOffSpell.start)) : '';
  const offTo = nucOffSpell ? fmtDate(at(nucOffSpell.end)) : '';

  // Header and in short.
  $('lede').textContent = `Belgium ran ${nucOffSpell ? hrs(spellH(nucOffSpell)) : 'months'} without nuclear power in ${s1.year} and filled the gap mainly with imports. ${s1.gas < minBefore.gas ? `Gas rose, but stayed below every summer from ${first.year} to 2023, when nuclear ran at ${gw(nucRange[0])} to ${gw(nucRange[1])}.` : `Gas rose by ${gw(dGas)}.`}`;
  $('answer-lead').textContent = `From ${offFrom} to ${offTo} both of Belgium's remaining reactors were off for maintenance, and for the first time in this record the country made no nuclear power at all. Imports covered about ${pc(dImp / gap)} of the gap and gas about ${pc(dGas / gap)}. Gas no longer stands in for nuclear: it runs when the sun sets, when it is cold, and when imports are already at their limit.`;
  $('answer-points').innerHTML = [
    `<b>Imports did the heavy lifting.</b> Net imports averaged ${gw(s1.net)} from April to September ${s1.year}, against ${gw(s0.net)} a year earlier. Belgium imported a net ${twh(latest.netImpTwh)} in the latest 365 days, more than in any calendar year in the data (${twh(impRecord.netImpTwh)} in ${impRecord.year}), and ${hrs(latest.impHigh)} were at or above ${IMPORT_HIGH} GW, against ${hrs(impHighBefore.impHigh)} in ${impHighBefore.year}. ${link(1, 'Chapter 1')}`,
    `<b>Gas does the shaping, not the base.</b> In the latest 365 days gas averaged ${gw(H13)} at ${hh(13)} and ${gw(H20)} at ${hh(20)}, while net imports barely moved by hour of day. The evening price pays for it. ${link(2, 'Chapters 2')} and ${link(4, '4')}`,
    `<b>Nothing before 2028 ends it.</b> The reactors are back and may run to 2045, but the next additions are an 870 MW gas plant and batteries of a few hundred megawatts, and offshore wind has slipped to the 2030s. Gas has never fallen below ${gw2(gasLow)}. ${link(3, 'Chapters 3')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-imports', `Net imports, April to September ${s1.year}`, gw(s1.net), `up from ${gw(s0.net)} in ${s0.year}`],
    ['--f-gas', `Gas, April to September ${s1.year}`, gw(s1.gas), `up from ${gw(s0.gas)} in ${s0.year}${s1.gas < minBefore.gas ? `, below every summer from ${first.year} to 2023` : ''}`],
    ['--f-imports', 'Net imports, latest 365 days', twh(latest.netImpTwh), `the most in the data; ${twh(impRecord.netImpTwh)} in ${impRecord.year}`],
    ['--sunny', 'Average day-ahead price, latest 365 days', `${eur(latest.price)}/MWh`, `against ${eur(last.price)} in ${last.year}`],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${nucOffSpell ? n0(spellH(nucOffSpell)) : '0'} hours</div><div class="sub">With nuclear output under ${NUC_OFF} GW, from ${offFrom} to ${offTo}. Before ${s1.year}, Belgian nuclear never fell below 1 GW in this record.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: what filled the nuclear gap, gas at dusk, a bigger gas fleet that runs less, who pays, and what is coming, with the record each item should move.';

  const chapters = [
    'What filled the nuclear gap',
    'Gas runs at dusk, imports run flat',
    'A bigger gas fleet that runs less',
    'Who pays for the gas',
    'What is coming, and which records it moves',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const yearColors = ['--f-other', '--f-hydro', '--f-gas'];

  // Chapter 1: the summer gap.
  const sCats = summers.map((s) => String(s.year));
  const p2015 = summers[0];
  $('take-1').textContent = `Of the ${gw(gap)} Belgium had to find in summer ${s1.year}, imports gave about ${gw(dImp)} and gas about ${gw(dGas)}.`;
  $('body-1').innerHTML = `Doel 4 and Tihange 3, the two reactors left after Tihange 1 and Doel 2 closed in late 2025 (${src(SOURCES.tihange1, 'NucNet')}, ${src(SOURCES.doel2, 'New Mobility')}), were both shut in early April ${s1.year} for major maintenance (${src(SOURCES.outage, 'Belga via Aktualności')}). Nuclear averaged ${gw2(s1.nuclear)} from April to September, against ${gw2(s0.nuclear)} in the same months of ${s0.year}, and load was ${gw(load)} higher. That left ${gw(gap)} to cover. Net imports rose by ${gw(dImp)} to ${gw(s1.net)}, gas by ${gw(dGas)} to ${gw(s1.gas)} and solar by ${gw(dSolar)}; wind was flat. The rest is pumped storage, batteries and differences in the load data. In ${apr1 && apr0 ? `April, the first month without reactors, gas (${gw2(apr1.gas)}) was below April ${s0.year} (${gw2(apr0.gas)}) while net imports reached ${gw2(apr1.net)}, against ${gw2(apr0.net)}` : 'the first month without reactors, imports rose first'}. There is a precedent: in summer ${p2015.year} nuclear averaged ${gw(p2015.nuclear)}, net imports ${gw(p2015.net)} and gas ${gw(p2015.gas)}. In ${s1.year} the hole was deeper and imports took more of it, which fits the 2 GW of links built since, Nemo Link to Britain in 2019 (${src(SOURCES.nemo, 'Wikipedia')}) and ALEGrO to Germany in 2020 (${src(SOURCES.alegro, 'Elia')}); that link is our inference.`;
  $('chart-h-1').textContent = 'What ran from April to September';
  $('chart-hint-1').textContent = 'Average output from April to September each year, in GW. Net imports count only when Belgium imported more than it exported over the season.';
  const ch1 = [
    { name: 'Nuclear', color: css('--f-nuclear'), key: 'nuclear' },
    { name: 'Gas', color: css('--f-gas'), key: 'gas' },
    { name: 'Net imports', color: css('--f-imports'), key: 'net' },
    { name: 'Solar', color: css('--f-solar'), key: 'solar' },
    { name: 'Wind', color: css('--f-wind'), key: 'wind' },
  ].map((sr) => ({ ...sr, values: summers.map((s) => Math.max(0, s[sr.key])) }));
  barChart($('story-chart-1'), {
    cats: sCats,
    stacks: ch1,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => summers[ci].year === s1.year,
    tooltip: (ci) => `<strong>April to September ${summers[ci].year}</strong>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${gw2(summers[ci][sr.key])}</b></div>`).join('')}<div>Load: <b>${gw(summers[ci].demand)}</b></div><div>Price: <b>${eur(summers[ci].price)}/MWh</b></div>`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: gas and imports by hour.
  const netMin = Math.min(...netH);
  const netMax = Math.max(...netH);
  $('take-2').textContent = `In the latest 365 days net imports stayed between ${gw(netMin)} and ${gw(netMax)} at every hour; gas did the shaping, rising from ${gw(H13)} at ${hh(13)} to ${gw(H20)} at ${hh(20)}.`;
  $('body-2').innerHTML = `The hour of day shows what the gas fleet is for. Over the latest 365 days gas averaged ${gw2(H13)} at ${hh(13)}, when solar is highest, and ${gw2(H20)} at ${hh(20)}. The day-ahead price has the same shape: ${eur(latest.byHour[13])} a megawatt hour at ${hh(13)} and ${eur(latest.byHour[20])} at ${hh(20)}. Net imports, by contrast, sat between ${gw2(netMin)} and ${gw2(netMax)} at every hour, a little lower in the evening than in the morning. We infer that the borders were close to full for much of the day, so the evening ramp could not be bought abroad and gas met it. When the reactors ran, the day was flatter: in 2019 gas ranged from ${gw(Math.min(...r2019.gasHour))} to ${gw(Math.max(...r2019.gasHour))} and prices from ${eur(Math.min(...r2019.byHour))} to ${eur(Math.max(...r2019.byHour))}. The June ${s1.year} heat wave was the extreme case: a record quarter-hour price of €1,038 a megawatt hour at 20:45, as solar faded and gas plants lost output in the heat (${src(SOURCES.heatwave, 'pv magazine')}).`;
  $('chart-h-2').textContent = 'Gas and net imports by hour of day';
  $('chart-hint-2').textContent = 'Average gas output and average net imports for each hour of the day, Belgian time, in GW. The average price at each hour is in the tooltip.';
  const hourLines = [
    { name: 'Gas, 2019', year: 2019, color: css('--f-other'), points: r2019.gasHour.map((v, hr) => [hourX(hr), v]), width: 2 },
    { name: 'Gas, latest 365 days', year: 'past365', color: css('--f-gas'), points: latest.gasHour.map((v, hr) => [hourX(hr), v]), width: 3 },
    { name: 'Net imports, latest 365 days', year: 'past365', color: css('--f-imports'), points: netH.map((v, hr) => [hourX(hr), v]), width: 3 },
  ];
  lineChart($('story-chart-2'), {
    series: hourLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw2(v.value) : '—'}</b></div>`).join('')}<div>Price: <b>${eur(latest.byHour[hr])}</b> (latest 365 days), <b>${eur(r2019.byHour[hr])}</b> (2019)</div>`;
    },
  });
  $('story-legend-2').innerHTML = legend(hourLines.map((sr) => [sr.name, sr.color]));

  // Chapter 3: a bigger fleet that runs less.
  const gasPeak = rows.reduce((a, r) => (r.gasMax > a.gasMax ? r : a), first);
  const fosRecord = rows.reduce((a, r) => (r.fosU1 > a.fosU1 ? r : a), first);
  const prevFos = full.filter((r) => r !== fosRecord).reduce((a, r) => (r.fosU1 > a.fosU1 ? r : a), first);
  const gasHigh = full.reduce((a, r) => (r.gasTwh > a.gasTwh ? r : a), first);
  $('take-3').textContent = `${Number.isFinite(gasCap) ? `Belgium had ${gw(gasCap)} of gas plant in ${capYear}, against ${gw(gasCap0)} in ${first.year}` : 'Belgium has more gas plant than in 2015'}, but burnt less gas; the fleet now peaks higher and idles more.`;
  $('body-3').innerHTML = `${Number.isFinite(gasCap) ? `Installed gas capacity was ${gw(gasCap)} in ${capYear}, against ${gw(gasCap0)} in ${first.year}, ` : ''}and Engie's 875 MW Flémalle plant, built under the capacity remuneration mechanism, was declared available in December 2025 (${src(SOURCES.flemalle, 'Engie')}). Output went the other way: ${twh(first.gasTwh)} in ${first.year}, a high of ${twh(gasHigh.gasTwh)} in ${gasHigh.year}, ${twh(rows.find((r) => r.year === 2024)?.gasTwh ?? last.gasTwh)} in 2024 and ${twh(latest.gasTwh)} in the latest 365 days. The no-nuclear year set records at both ends: the highest gas output in the data, ${gw(gasPeak.gasMax)}${gasPeak === latest ? ' in the latest 365 days' : ` in ${gasPeak.year}`}, and the most hours with fossil fuels under ${FOSSIL_LOW} GW, ${n0(fosRecord.fosU1)}${fosRecord === latest ? ' in the latest 365 days' : ` in ${fosRecord.year}`}, against ${n0(prevFos.fosU1)} in ${prevFos.year} and ${n0(r2019.fosU1)} in 2019. Solar pushes gas out at midday and on windy weekends; the missing reactors pulled it in on evenings and cold days. Gas has never reached zero: its lowest quarter hour is ${gw2(gasLow)}, and the longest spell with fossil fuels under ${FOSSIL_LOW} GW is ${fossil1Spell ? `${n0(spellH(fossil1Spell))} hours, from ${fmtDate(at(fossil1Spell.start))}` : 'none'}.`;
  $('chart-h-3').textContent = `Hours a year with fossil fuels under ${FOSSIL_LOW} GW`;
  $('chart-hint-3').textContent = 'Hours each year when gas, coal and oil together made less than 1 GW. The highest and lowest gas output are in the tooltip. The last bar is the latest 365 days.';
  const cats = rows.map((r) => label(r.year));
  const ch3 = [{ name: `Fossil under ${FOSSIL_LOW} GW`, color: css('--lowcarbon'), values: rows.map((r) => r.fosU1) }];
  barChart($('story-chart-3'), {
    cats,
    stacks: ch3,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => rows[ci].year === 'past365',
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under ${FOSSIL_LOW} GW: <b>${n0(rows[ci].fosU1)}</b></div><div>Gas: <b>${twh(rows[ci].gasTwh)}</b>, ${pc(rows[ci].gasShare)} of generation</div><div>Lowest gas: <b>${gw2(rows[ci].gasMin)}</b>, highest <b>${gw(rows[ci].gasMax)}</b></div>`,
  });
  $('story-legend-3').innerHTML = legend(ch3.map((sr) => [sr.name, sr.color]));

  // Chapter 4: prices.
  $('take-4').textContent = `The day-ahead price averaged ${eur(latest.price)} a megawatt hour in the latest 365 days, against ${eur(last.price)} in ${last.year}; the evening, when gas runs most, is where it rose.`;
  $('body-4').innerHTML = `The average day-ahead price over the latest 365 days was ${eur(latest.price)} a megawatt hour, against ${eur(last.price)} in ${last.year}, which CREG already called about twice the 2015 to 2020 average of €42 (${src(SOURCES.creg2025, 'CREG')}). Two things pushed it up: the reactors were off, and EU wholesale gas rose about 70% after the war in the Middle East began (${src(SOURCES.gasWar, 'Brussels Times')}). By hour, the rise was in the evening: ${eur(latest.byHour[20])} at ${hh(20)} against ${eur(last.byHour[20])} in ${last.year}, and ${eur(latest.byHour[13])} at ${hh(13)} against ${eur(last.byHour[13])}. That is the hour gas runs most, and gas plants are paid twice: in the energy market at those evening prices, and through the capacity mechanism, which funded Flémalle and Seraing and now also batteries, 100 MW for 2025-26 and 350 MW for 2028-29 (${src(SOURCES.crmBatteries, 'pv magazine')}). Imports were the cheaper option most of the day; the data does not say what made them.`;
  $('chart-h-4').textContent = 'Day-ahead price by hour of day';
  $('chart-hint-4').textContent = 'Average day-ahead price for each hour of the day, Belgian time, in euros per MWh. The thick line is the latest 365 days.';
  const priceYears = [2019, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const priceLines = priceYears.map((y, k) => ({ name: title(y), color: css(yearColors[k]), points: rows.find((r) => r.year === y).byHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-4'), {
    series: priceLines,
    yMin: 0,
    yFormat: (v) => `${eur(v)}/MWh`,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? eur(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-4').innerHTML = legend(priceLines.map((sr) => [sr.name, sr.color]));

  // Chapter 5: what's coming.
  $('take-5').textContent = 'The reactors are back and may run to 2045, but the next three years add a delayed gas plant and batteries, not new round-the-clock power.';
  $('body-5').innerHTML = `Tihange 3 came back on 14 October ${s1.year} and Doel 4 was due on 21 October (${src(SOURCES.outage, 'Belga via Aktualności')}); nuclear was back near 2 GW in the latest data. The question for gas is winter. ${jan1 && jan0 ? `In January ${s1.year}, with ${gw(jan1.nuclear)} of nuclear running, gas averaged ${gw2(jan1.gas)}, against ${gw2(jan0.gas)} in January ${s0.year}. That was the first winter without Tihange 1 and Doel 2; that their loss is the main reason is our inference, and the weather is not in the data. ` : ''}Nothing arriving before 2028 replaces round-the-clock power: Seraing adds 870 MW of gas (${src(SOURCES.seraing, 'La Libre')}), batteries add a few hundred megawatts for a few hours, and the first Princess Elisabeth offshore lot has slipped into the 2030s (${src(SOURCES.pezDelay, 'Aegir Insights')}). Parliament voted to repeal the nuclear phase-out law in May 2025 (${src(SOURCES.repeal, 'Foro Nuclear')}), and the talks on the state taking over all seven reactors now run to 4 November ${s1.year} (${src(SOURCES.takeover, 'New Mobility')}). The records to watch: whether nuclear stays above 1 GW this winter, whether the ${gw(gasPeak.gasMax)} gas peak falls in a cold spell, and whether net imports stay at ${IMPORT_HIGH} GW or more for longer than ${importSpell ? n0(spellH(importSpell)) : 'the'} hours, the record set in April ${s1.year}.`;
  $('chart-h-5').textContent = 'Nuclear, gas and net imports by year';
  $('chart-hint-5').textContent = 'Energy each year, in TWh. Net imports count only in years when Belgium imported more than it exported. The last bar is the latest 365 days.';
  const ch5 = [
    { name: 'Nuclear', color: css('--f-nuclear'), key: 'nucTwh' },
    { name: 'Gas', color: css('--f-gas'), key: 'gasTwh' },
    { name: 'Net imports', color: css('--f-imports'), key: 'netImpTwh' },
  ].map((sr) => ({ ...sr, values: rows.map((r) => Math.max(0, r[sr.key])) }));
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => rows[ci].year === 'past365',
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${[...ch5].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(rows[ci][sr.key])}</b></div>`).join('')}<div>Hours importing ${IMPORT_HIGH} GW or more: <b>${n0(rows[ci].impHigh)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend([...ch5].reverse().map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--f-gas)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
