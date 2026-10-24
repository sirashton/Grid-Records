// The Uruguay story: a grid that runs on water, wind and wood waste keeps a
// fossil fleet as drought insurance. It is off most hours in a wet year,
// makes a sixth of the power when the rivers fail, has at times run mainly
// while Uruguay was exporting, and in 2026 is back, on Argentine pipeline gas.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate, fmtDateTime } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import uy from '../countries/uy.js';
import { FOSSIL, GENERATION, HYDRO, metricSeries, byYear } from './data.js';

// Uruguay keeps UTC-3 all year.
const OFFSET_MS = -3 * 3600000;
// Thermal levels the story counts hours against, in GW. Under 0.01 GW reads
// as off: SCADA shows a few MW of auxiliaries and test runs.
export const THERMAL_OFF = 0.01;
export const THERMAL_HIGH = [0.1, 0.5];
// Imports at or above this, in GW, count as an importing hour.
const TRADE_GW = 0.05;
const KEYS = ['hydro_salto', 'hydro_negro', 'wind', 'solar', 'biomass', 'thermal', 'imports', 'exports', 'demand'];

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);

/**
 * Every number the story uses. Rows run by Uruguayan calendar year, complete
 * years only, then 'past365' for the latest 365 days. `months` holds every
 * calendar month, the current one included.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const stepMs = step * 60000;
  const slotH = step / 60;
  const thermal = metricSeries(d, FOSSIL);
  const hydro = metricSeries(d, HYDRO);
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const gen = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    let g = 0;
    let any = false;
    for (const col of genCols) if (!Number.isNaN(col[i])) { g += Math.max(0, col[i]); any = true; }
    gen[i] = any ? g / 1000 : NaN;
  }
  const local = (i) => new Date(data.startMs + i * stepMs + OFFSET_MS);
  const val = (k, i) => {
    const v = data.columns[k]?.[i];
    return Number.isNaN(v) || v == null ? 0 : Math.abs(v) / 1000;
  };

  const init = () => ({
    // thermalExported: thermal output in hours of net exports, up to the
    // exports. An upper bound on thermal sold abroad; the flows aren't traced.
    twh: Object.fromEntries([...KEYS, 'gen', 'hydro', 'thermalExported', 'thermalImporting'].map((k) => [k, 0])),
    demMax: 0, demMaxAt: -1,
    thermalHour: new Float64Array(24),
    hourN: new Float64Array(24),
    thermalMonth: new Float64Array(12),
    thMax: 0, thMaxAt: -1, impMax: 0, impMaxAt: -1, expMax: 0, expMaxAt: -1,
    off: 0, high: THERMAL_HIGH.map(() => 0), n: 0,
  });
  const add = (r, i) => {
    const th = thermal[i];
    if (Number.isNaN(th)) return;
    const t = local(i);
    const h = t.getUTCHours();
    for (const k of KEYS) r.twh[k] += (val(k, i) * slotH) / 1000;
    r.twh.gen += (gen[i] * slotH) / 1000;
    r.twh.hydro += ((hydro[i] || 0) * slotH) / 1000;
    r.twh.thermalExported += (Math.min(th, val('exports', i)) * slotH) / 1000;
    if (val('imports', i) >= TRADE_GW) r.twh.thermalImporting += (th * slotH) / 1000;
    if (val('demand', i) > r.demMax) { r.demMax = val('demand', i); r.demMaxAt = i; }
    r.thermalHour[h] += th;
    r.hourN[h]++;
    r.thermalMonth[t.getUTCMonth()] += (th * slotH) / 1000;
    if (th > r.thMax) { r.thMax = th; r.thMaxAt = i; }
    if (val('imports', i) > r.impMax) { r.impMax = val('imports', i); r.impMaxAt = i; }
    if (val('exports', i) > r.expMax) { r.expMax = val('exports', i); r.expMaxAt = i; }
    if (th < THERMAL_OFF) r.off += slotH;
    THERMAL_HIGH.forEach((lv, k) => { if (th >= lv) r.high[k] += slotH; });
    r.n += slotH;
  };
  const finish = (r) => ({
    year: r.year,
    twh: r.twh,
    hours: r.n,
    thermalShare: r.twh.thermal / r.twh.gen,
    renewShare: 1 - r.twh.thermal / r.twh.gen,
    hydroShare: r.twh.hydro / r.twh.gen,
    windShare: r.twh.wind / r.twh.gen,
    importShare: r.twh.imports / r.twh.demand,
    exportedShare: r.twh.thermalExported / r.twh.thermal,
    demMax: r.demMax, demMaxAt: r.demMaxAt,
    thermalHour: [...r.thermalHour].map((v, h) => mean(v, r.hourN[h])),
    thermalMonth: [...r.thermalMonth],
    thMax: r.thMax, thMaxAt: r.thMaxAt, impMax: r.impMax, impMaxAt: r.impMaxAt, expMax: r.expMax, expMaxAt: r.expMaxAt,
    off: r.off, offShare: r.off / r.n, high: r.high,
  });
  const rows = byYear(d, init, add).map(finish);

  // Every calendar month, in GWh: thermal, hydro, imports and exports, and
  // thermal in exporting and importing hours as in the yearly rows.
  const months = [];
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(thermal[i])) continue;
    const t = local(i);
    const key = t.getUTCFullYear() * 12 + t.getUTCMonth();
    let mo = months.at(-1);
    if (mo?.key !== key) {
      mo = { key, year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, ms: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 15), thermal: 0, hydro: 0, imports: 0, exports: 0, thermalExported: 0, thermalImporting: 0, gen: 0, n: 0 };
      months.push(mo);
    }
    mo.thermal += thermal[i] * slotH;
    mo.hydro += (hydro[i] || 0) * slotH;
    mo.imports += val('imports', i) * slotH;
    mo.exports += val('exports', i) * slotH;
    mo.thermalExported += Math.min(thermal[i], val('exports', i)) * slotH;
    if (val('imports', i) >= TRADE_GW) mo.thermalImporting += thermal[i] * slotH;
    mo.gen += gen[i] * slotH;
    mo.n++;
  }
  for (const mo of months) mo.share = mo.thermal / mo.gen;

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: uy.timeZone };
  const off = summarise(thermal, THERMAL_OFF, 'below', opts);
  const on01 = summarise(thermal, 0.1, 'above', opts);
  const on05 = summarise(thermal, 0.5, 'above', opts);
  return {
    rows,
    months,
    offSpell: spellOf(off),
    offNow: off.current ? { start: off.current.start, end: off.current.end } : null,
    on01Spell: spellOf(on01),
    on05Spell: spellOf(on05),
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(2)} GW`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const gwh = (v) => `${n0(v)} GWh`;
const pc = (v) => `${(v * 100).toFixed(1)}%`;
const pc0 = (v) => `${Math.round(v * 100)}%`;
const hrs = (v) => `${n0(v)} hours`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const SOURCES = {
  ptb: 'https://www.gub.uy/ministerio-industria-energia-mineria/sites/ministerio-industria-energia-mineria/files/documentos/noticias/ute_fto_puntadeltigre.pdf',
  drought2021: 'https://www.elobservador.com.uy/nota/la-generacion-hidroelectrica-de-uruguay-cayo-a-su-menor-nivel-en-18-anos--20221313256',
  exports2021: 'https://www.montevideo.com.uy/Noticias/UTE-exporto-por-US-594-millones-en-2021-y-fue-la-empresa-lider-en-ventas-al-exterior-uc810188',
  fund: 'https://www.elobservador.com.uy/nota/ute-se-quedo-sin-su-fondo-de-reserva-para-tarifas-pero-exportacion-le-dio-mas-plata-20218305024',
  ancap: 'https://www.montevideo.com.uy/Noticias/Por-la-sequia-UTE-paga-US-1-5-millones-por-dia-a-Ancap-para-generar-energia-termica-uc843827',
  brazil2023: 'https://www.montevideo.com.uy/Noticias/Uruguay-empezo-a-importar-energia-de-Brasil-con-lo-que-abastece-a-un-cuarto-de-la-demanda-uc845089',
  cost2023: 'https://www.elobservador.com.uy/nota/por-que-es-un-ano-complejo-para-ute-y-como-puede-repercutir-en-las-tarifas--202391114270',
  exportRules: 'https://www.elobservador.com.uy/nota/cuanto-dinero-movio-la-exportacion-de-energia-y-como-pesa-en-las-tarifas-de-los-hogares-20231913588/amp',
  ucu2024: 'https://www.ucu.edu.uy/Institucionales/MONITOR-MENSUAL-DEL-SECTOR-ELECTRICO-uc1481/5275/Monitor-Diciembre-2024.pdf',
  adme2025: 'https://adme.com.uy/db-docs/Docs_secciones/nid_526/Informe_Anual2025_ADME_2026.pdf',
  vacaMuerta: 'https://www.montevideo.com.uy/Noticias/Uruguay-reduce-costos-con-un-acuerdo-para-importar-gas-de-Vaca-Muerta-uc946799',
  ucuDec2025: 'https://www.ucu.edu.uy/Institucionales/MONITOR-MENSUAL-DEL-SECTOR-ELECTRICO-uc1481/7083/Monitor-Diciembre-2025.pdf',
  gnl: 'https://tankterminals.com/news/uruguays-big-lng-project-hits-the-rocks/',
  salto: 'https://www.elobservador.com.uy/economia-y-empresas/salto-grande-un-pozo-petroleo-el-que-uruguay-se-ahorra-us-400-millones-al-ano-n6012409',
  saltoTurbines: 'https://www.montevideo.com.uy/Noticias/Las-viejas-turbinas-sovieticas-de-Salto-Grande-piden-cambio-y-hay-interesados-uc969083',
  cerroLargo: 'https://www.elobservador.com.uy/economia-y-empresas/ute-adjudico-construccion-parque-solar-cerro-largo-y-sera-el-tercero-su-propiedad-n6016370',
  melo2026: 'https://energiaestrategica.com/energiaestrategica/es/notes/mas-demanda-mas-renovables-y-una-cuenta-pendiente-uruguay-debate-nuevos-ppa',
  hif: 'https://www.montevideo.com.uy/Noticias/HIF-Global-entra-en-la-recta-final-con-predio-definido-y-acuerdo-energetico-encaminado-uc968811',
  plan2034: 'https://noticiasambientales.com/energy/uruguay-will-expand-wind-and-solar-parks-in-response-to-energy-demand/',
  brazilLink: 'https://www.montevideo.com.uy/Noticias/Gobierno-firma-acuerdo-para-aumentar-potencia-de-interconexion-energetica-con-Brasil-uc914821',
};

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['Since December 2025', 'Vaca Muerta gas from Argentina through the Cruz del Sur pipeline, under a UTE deal with Pan American Energy. Punta del Tigre\'s turbines cost about 105 USD/MWh on gas against about 215 on gasoil.', 'vacaMuerta', 'The longest spell with thermal at or above 0.1 GW: cheaper fuel can mean longer runs in a dry spell.'],
  ['November 2026', 'Stage 1 of the Salto Grande renovation, under way since 2019, is due to finish.', 'salto', 'Salto Grande\'s yearly output, and the longest spell with thermal off.'],
  ['2028', 'UTE\'s solar park at Cerro Largo, next to the Melo converter: 75 MW when awarded, reported in July 2026 as 100 MWp with construction begun in April. The sources differ.', 'melo2026', 'Thermal output at midday in a dry summer.'],
  ['2029', 'First exports from HIF Global\'s e-fuels plant at Paysandú, which plans to buy power at about US$45/MWh. New load of this kind pulls the other way.', 'hif', 'The highest demand hour, and exports.'],
  ['From 2031', 'Salto Grande stage 3: new turbines and generators, at least one unit a year, about US$373M. A unit out of service is less water to fall back on.', 'saltoTurbines', 'The highest thermal share in a dry year.'],
  ['By 2034', 'The ministry\'s base case: another 355 MW of wind and 545 MW of solar. A data-centre case adds 540 MW of wind and 250 MW of solar from 2033.', 'plan2034', 'The yearly thermal share in the next drought, against 2021.'],
  ['No date', 'An addendum with Brazil to raise the interconnection\'s capacity. In 2023 imports from Brazil were the cheaper drought insurance.', 'brazilLink', 'The highest import hour.'],
];

export function renderStory(data, end, figs) {
  const { rows, months, offSpell, offNow, on01Spell, on05Spell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? full.at(-1);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const when = (i) => fmtDateTime(at(i));
  const span = (sp) => `${fmtDate(at(sp.start))} to ${fmtDate(at(sp.end - 1))}`;
  const monthName = (m) => `${MONTHS[m.month - 1]} ${m.year}`;

  // The figures the text leans on, worked out from whatever data is loaded.
  const driest = full.reduce((a, r) => (r.thermalShare > a.thermalShare ? r : a), first);
  const quietest = full.reduce((a, r) => (r.offShare > a.offShare ? r : a), first);
  const lowHydro = full.reduce((a, r) => (r.twh.hydro < a.twh.hydro ? r : a), first);
  const maxHour = full.reduce((a, r) => (r.thMax > a.thMax ? r : a), first);
  const maxMonth = months.reduce((a, m) => (m.share > a.share ? m : a), months[0]);
  const demTop = rows.reduce((a, r) => (r.demMax > a.demMax ? r : a), first);
  const impTop = rows.reduce((a, r) => (r.impMax > a.impMax ? r : a), first);
  const y19 = row(2019);
  const y21 = row(2021);
  const y23 = row(2023);
  const y24 = row(2024);
  const y25 = row(2025);
  const curYear = months.at(-1).year;
  const ytd = months.filter((m) => m.year === curYear);
  const lastYtd = ytd.at(-1);
  const sum = (ms, k) => ms.reduce((s, m) => s + m[k], 0);
  const ytdThermal = sum(ytd, 'thermal');
  const ytdExported = sum(ytd, 'thermalExported');
  const ytdImporting = sum(ytd, 'thermalImporting');
  const prior2 = (y24.twh.thermal + y25.twh.thermal) * 1000;
  const ytdTop = ytd.reduce((a, m) => (m.thermal > a.thermal ? m : a), ytd[0]);
  const dryMonths = months.filter((m) => m.year === driest.year || m.year === driest.year + 1);
  const lowDry = dryMonths.reduce((a, m) => (m.hydro < a.hydro ? m : a), dryMonths[0]);
  const peakH = (arr) => arr.indexOf(Math.max(...arr));
  const lowH = (arr) => arr.indexOf(Math.min(...arr));
  const h21 = y21.thermalHour;
  const h24 = y24.thermalHour;
  const hLt = latest.thermalHour;
  const mw = (v) => `${n0(v * 1000)} MW`;

  // Header and in short.
  $('lede').textContent = `Uruguay's fossil plants are drought insurance: off for ${pc0(quietest.offShare)} of hours in ${quietest.year}, they made ${pc(driest.thermalShare)} of its power in ${driest.year}, and in ${curYear} they are back on Argentine gas.`;
  $('answer-lead').textContent = `Fossil power still runs in Uruguay for one main reason: the rivers. The grid runs on hydro, wind and wood waste, and keeps a fleet of gas turbines and engines, led by the 532 MW Punta del Tigre B combined cycle, for the years the water does not come. In ${quietest.year} it was off for ${hrs(quietest.off)} and made ${pc(quietest.thermalShare)} of generation; in ${driest.year}, a drought year, it made ${pc(driest.thermalShare)}. Since late 2025 the same turbines can burn Argentine gas at about half the cost of gasoil, and ${curYear} has already used ${prior2 > 0 && ytdThermal > prior2 ? 'more thermal energy than 2024 and 2025 together' : `${gwh(ytdThermal)} of thermal energy`}.`;
  $('answer-points').innerHTML = [
    `<b>The rivers decide, not demand.</b> Thermal made ${twh(y19.twh.thermal)} in 2019 when hydro made ${twh(y19.twh.hydro)}, ${twh(y21.twh.thermal)} in 2021 when hydro fell to ${twh(y21.twh.hydro)}, and ${twh(y24.twh.thermal)} in 2024 when hydro was back at ${twh(y24.twh.hydro)}. Demand moved only from ${twh(y19.twh.demand)} to ${twh(y24.twh.demand)}. ${link(1, 'Chapter 1')}`,
    `<b>Some of it was burned for the neighbours.</b> ${pc0(y21.exportedShare)} of thermal output in 2021 and ${pc0(y24.exportedShare)} in 2024 ran in hours when Uruguay was exporting (our inference: the flows are not traced). The 2024 figure matches the 70% that UCU's monitor reports as exported (${src(SOURCES.ucu2024, 'UCU')}). ${link(3, 'Chapter 3')}`,
    `<b>${curYear} is a gas year, for home use.</b> Thermal has made ${gwh(ytdThermal)} so far this year, against ${gwh(y24.twh.thermal * 1000)} in 2024 and ${gwh(y25.twh.thermal * 1000)} in 2025, and only ${gwh(ytdExported)} of it coincided with exports. The fuel is now mostly Vaca Muerta gas through the Cruz del Sur pipeline (${src(SOURCES.ucuDec2025, 'UCU')}). ${link(5, 'Chapter 5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--fossil', `Thermal share, ${driest.year}`, pc(driest.thermalShare), `${twh(driest.twh.thermal)}, the highest year in the record`],
    ['--fossil', `Thermal in ${curYear} so far`, gwh(ytdThermal), `to ${monthName(lastYtd)}, against ${gwh(prior2)} in 2024 and 2025 together`],
    ['--lowcarbon', 'Longest spell with thermal off', offSpell ? hrs(spellH(offSpell)) : 'None', offSpell ? `${span(offSpell)}, under 0.01 GW` : ''],
    ['--fossil', 'Highest thermal hour', gw(maxHour.thMax), when(maxHour.thMaxAt)],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${pc0(quietest.offShare)}</div><div class="sub">Share of hours in ${quietest.year} when Uruguay's fossil plants were off (under 0.01 GW). In ${driest.year}, when the rivers failed, it was ${pc0(driest.offShare)}.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: why it runs, when it runs, who it runs for, who pays, and what is coming.';

  const chapters = [
    'Why fossil still runs: dry rivers',
    'When it runs: summer and the evening',
    'Burned for the neighbours',
    'Who pays, and against what',
    'What is coming, and the records to watch',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });

  // Chapter 1: by year.
  $('take-1').textContent = 'Thermal output rises and falls with the two river systems, not with demand.';
  $('body-1').innerHTML = `Uruguay's fossil fleet is Punta del Tigre A and B at San José, open-cycle gas turbines and a 532 MW combined cycle, plus La Tablada's turbines and the engines at Central Batlle in Montevideo. UTE calls Punta del Tigre B a backup plant, to be used sparingly for 30 years (${src(SOURCES.ptb, 'UTE')}). The data agree. In 2019 the dams made ${twh(y19.twh.hydro)} and thermal ${twh(y19.twh.thermal)}, ${pc(y19.thermalShare)} of generation. In 2021 hydro fell to ${twh(y21.twh.hydro)}, thermal rose to ${twh(y21.twh.thermal)}, ${pc(y21.thermalShare)}, and the fleet ran at 0.5 GW or more for ${hrs(y21.high[1])}; the 2020-21 pair was the worst for hydro in 18 years (${src(SOURCES.drought2021, 'El Observador')}). In 2024 hydro was back at ${twh(y24.twh.hydro)} and thermal fell to ${twh(y24.twh.thermal)}. The exception is ${lowHydro.year}, the lowest hydro year in the data at ${twh(lowHydro.twh.hydro)}, when thermal made only ${twh(lowHydro.twh.thermal)} because ${twh(lowHydro.twh.imports)} was imported, most of it from Brazil from February 2023 (${src(SOURCES.brazil2023, 'Montevideo Portal')}). That year imports, not diesel, were the cheaper insurance.`;
  $('chart-h-1').textContent = 'Yearly generation by source';
  $('chart-hint-1').textContent = 'TWh generated each calendar year; the last bar is the latest 365 days. Thermal sits at the bottom and swells when hydro shrinks. Highlighted years have thermal above 5% of generation.';
  const ch1 = [
    { name: 'Thermal', color: css('--f-diesel'), key: 'thermal' },
    { name: 'Hydro, Salto Grande', color: css('--f-hydro'), key: 'hydro_salto' },
    { name: 'Hydro, Río Negro', color: css('--f-hydro-2'), key: 'hydro_negro' },
    { name: 'Wind', color: css('--f-wind'), key: 'wind' },
    { name: 'Biomass', color: css('--f-biomass'), key: 'biomass' },
    { name: 'Solar', color: css('--f-solar'), key: 'solar' },
  ].map((sr) => ({ ...sr, values: rows.map((r) => r.twh[sr.key]) }));
  barChart($('story-chart-1'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => rows[ci].thermalShare >= 0.05,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Thermal: <b>${twh(rows[ci].twh.thermal)}</b>, ${pc(rows[ci].thermalShare)} of ${twh(rows[ci].twh.gen)}</div>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}<div>Imports: <b>${twh(rows[ci].twh.imports)}</b></div>`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: by month and by hour.
  $('take-2').textContent = 'In a dry year the fleet runs hardest in summer and autumn, when the reservoirs are lowest, and in the evening peak.';
  $('body-2').innerHTML = `The highest monthly share in the record is ${monthName(maxMonth)}: thermal made ${gwh(maxMonth.thermal)}, ${pc(maxMonth.share)} of the month's generation, while hydro made ${gwh(maxMonth.hydro)}. In a good winter month the dams make 700 GWh or more; in ${monthName(lowDry)} they made ${gwh(lowDry.hydro)}. Within the day the fleet follows demand. In 2021 average thermal output ran from ${mw(h21[lowH(h21)])} at ${hh(lowH(h21))} to ${mw(h21[peakH(h21)])} at ${hh(peakH(h21))}. In 2024, a wet year, the same curve ran from ${mw(h24[lowH(h24)])} to ${mw(h24[peakH(h24)])} at ${hh(peakH(h24))}. Over the latest 365 days it peaks at ${mw(hLt[peakH(hLt)])} at ${hh(peakH(hLt))}, against ${mw(hLt[lowH(hLt)])} at ${hh(lowH(hLt))}. So the fleet covers the evening peak, when solar has gone and the dams are being held back (inferred: dispatch orders are not in the data).${on01Spell ? ` The longest spell with thermal at or above 0.1 GW ran ${hrs(spellH(on01Spell))}, ${span(on01Spell)}.` : ''}${on05Spell ? ` At or above 0.5 GW the longest ran ${hrs(spellH(on05Spell))}, ${span(on05Spell)}.` : ''}`;
  $('chart-h-2').textContent = 'Thermal output by hour of day';
  $('chart-hint-2').textContent = 'Average thermal output for each hour of the day, Uruguay time, in MW. The evening hump is there in a drought and in a wet year.';
  const hourX = (h) => h * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ t: hourX(h), label: hh(h) }));
  const years2 = [2021, 2024, 'past365'].filter((y) => rows.some((r) => r.year === y));
  const colors2 = ['--f-diesel', '--f-other', '--fossil'];
  const ch2 = years2.map((y, k) => ({ name: title(y), color: css(colors2[k]), points: row(y).thermalHour.map((v, h) => [hourX(h), v * 1000]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-2'), {
    series: ch2,
    yMin: 0,
    yFormat: (v) => `${n0(v)} MW`,
    yTickFormat: (v) => n0(v),
    xTicks: hourTicks,
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? `${n0(v.value)} MW` : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-2').innerHTML = legend(ch2.map((sr) => [sr.name, sr.color]));

  // Chapter 3: exports.
  const runY = (r) => `${pc0(r.exportedShare)} in ${r.year}`;
  $('take-3').textContent = 'In some years most thermal output ran while Uruguay was exporting; since 2025 very little does.';
  $('body-3').innerHTML = `This dataset has no export column. Exports are what generation and imports leave after demand, so thermal output in an exporting hour is a proxy for fossil power that left the country, an upper bound rather than a measurement. In 2021, ${twh(y21.twh.thermalExported)} of the ${twh(y21.twh.thermal)} of thermal ran while Uruguay was exporting, ${pc0(y21.exportedShare)}. Brazil was in drought, and UTE's exports earned a record US$594M (${src(SOURCES.exports2021, 'Montevideo Portal')}). UTE priced its 2022 exports at US$80/MWh for renewable surplus, US$125 for stored water and US$290 for thermal, sold when Argentina declared an emergency, and from March 2022 it limited exports to renewable surplus, with no gasoil plants run for export (${src(SOURCES.exportRules, 'El Observador')}). Even so, in 2024 the share was ${pc0(y24.exportedShare)}, ${gwh(y24.twh.thermalExported * 1000)} of ${gwh(y24.twh.thermal * 1000)}, most of it in one run in late May while exports were near 1 GW, close to the 70% that UCU reports as exported (${src(SOURCES.ucu2024, 'UCU')}). The share was ${runY(y23)}, when ${gwh(y23.twh.thermalImporting * 1000)} of thermal ran alongside imports, and ${runY(y25)}. In ${curYear} so far it is ${pc0(ytdExported / ytdThermal)}. The last fossil fuel burned in Uruguay is now burned for Uruguay.`;
  $('chart-h-3').textContent = 'Thermal output, and how much ran while exporting';
  $('chart-hint-3').textContent = 'GWh of thermal each year; the last bar is the latest 365 days. The darker part is thermal in hours when Uruguay was a net exporter, up to the size of the exports: an upper bound on fossil power sold abroad.';
  const ch3 = [
    { name: 'In exporting hours', color: css('--f-imports'), values: rows.map((r) => r.twh.thermalExported * 1000) },
    { name: 'The rest', color: css('--f-diesel'), values: rows.map((r) => (r.twh.thermal - r.twh.thermalExported) * 1000) },
  ];
  barChart($('story-chart-3'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch3,
    yFormat: gwh,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Thermal: <b>${gwh(rows[ci].twh.thermal * 1000)}</b></div><div>In exporting hours: <b>${gwh(rows[ci].twh.thermalExported * 1000)}</b>, ${pc0(rows[ci].exportedShare)}</div><div>In importing hours: <b>${gwh(rows[ci].twh.thermalImporting * 1000)}</b></div>`,
  });
  $('story-legend-3').innerHTML = legend(ch3.map((sr) => [sr.name, sr.color]));

  // Chapter 4: the economics.
  $('take-4').textContent = 'Thermal runs when stored water is worth more than the fuel; UTE and its customers pay the difference, and the fund meant to absorb it ran dry in 2021.';
  $('body-4').innerHTML = `Uruguay dispatches the cheapest plant first, and the spot price is the cost of the last one needed. It averaged 4 USD/MWh in 2024 (${src(SOURCES.ucu2024, 'UCU')}), 61 in 2025, and 159 in February 2025, a hot month with low rivers (${src(SOURCES.adme2025, 'ADME')}). Thermal is the expensive end. In January 2023 UTE was paying ANCAP, the state oil company, about US$1.5M a day for fuel, at a thermal cost of about US$189/MWh (${src(SOURCES.ancap, 'Montevideo Portal')}). In a normal year UTE spends about US$80M on fuel; in 2021 it spent about US$297M, and the energy stabilisation fund, about US$51M at the start of the year, was used up (${src(SOURCES.fund, 'El Observador')}). Exports paid for much of 2021. In 2023 they could not: supply cost US$320M more than budgeted (${src(SOURCES.cost2023, 'El Observador')}). Gas changes the sums. UCU puts Punta del Tigre's turbines at about 105 USD/MWh on gas against about 215 on gasoil (${src(SOURCES.ucuDec2025, 'UCU')}), so in a dry spell the fleet may now be called on sooner, and run for longer, than it was on gasoil (inferred).`;
  $('chart-h-4').textContent = 'Thermal and imports, month by month';
  $('chart-hint-4').textContent = 'GWh each calendar month. Thermal and imports are the two ways to cover a dry spell; in 2023 imports did most of it.';
  const ch4 = [
    { name: 'Thermal', color: css('--f-diesel'), points: months.map((m) => [m.ms, m.thermal]), width: 2 },
    { name: 'Imports', color: css('--f-imports'), points: months.map((m) => [m.ms, m.imports]), width: 2 },
  ];
  const mon = (t) => {
    const dt = new Date(t);
    return months.find((x) => x.year === dt.getUTCFullYear() && x.month === dt.getUTCMonth() + 1) ?? months.at(-1);
  };
  lineChart($('story-chart-4'), {
    series: ch4,
    yMin: 0,
    yFormat: gwh,
    yTickFormat: (v) => n0(v),
    tooltip: (t) => {
      const m = mon(t);
      return `<strong>${monthName(m)}</strong><div>Thermal: <b>${gwh(m.thermal)}</b>, ${pc(m.share)} of generation</div><div>Imports: <b>${gwh(m.imports)}</b></div><div>Hydro: <b>${gwh(m.hydro)}</b></div><div>Net exports: <b>${gwh(m.exports)}</b></div>`;
    },
  });
  $('story-legend-4').innerHTML = legend(ch4.map((sr) => [sr.name, sr.color]));

  // Chapter 5: what's coming.
  $('take-5').textContent = 'Nothing planned retires the fleet. The plan is to run it less, and on gas, while solar, wind and a renovated Salto Grande shrink the dry-year gap.';
  $('body-5').innerHTML = `Punta del Tigre B was built for gas that never came by sea: the GNL del Plata import terminal collapsed in 2015 (${src(SOURCES.gnl, 'Tank Terminals')}). Ten years on, gas has come by pipe. UTE agreed with Pan American Energy to bring Vaca Muerta gas from Argentina through the Cruz del Sur pipeline (${src(SOURCES.vacaMuerta, 'Montevideo Portal')}), and in late 2025 the turbines burned gas for the first time since 2021 (${src(SOURCES.ucuDec2025, 'UCU')}). ${curYear} shows the result: ${gwh(ytdThermal)} of thermal so far, the most in a month ${gwh(ytdTop.thermal)} in ${MONTHS[ytdTop.month - 1]}, and ${gwh(ytdImporting)} of it alongside imports. Thermal was off for ${pc0(latest.offShare)} of the latest 365 days, against ${pc0(y24.offShare)} in 2024 and ${pc0(y25.offShare)} in 2025. UTE says it will keep Punta del Tigre B as backup for 30 years (${src(SOURCES.ptb, 'UTE')}), and no plan to close it was found. Against it are more solar and wind, and Salto Grande's renovation; for it, new loads such as HIF's e-fuels plant. Records to watch: the longest spell with thermal off, ${offSpell ? `${hrs(spellH(offSpell))} (${span(offSpell)})` : 'none yet'}${offNow ? `, with the current one at ${hrs(spellH(offNow))}` : ''}; the highest thermal hour, ${gw(maxHour.thMax)}; the highest thermal year, ${pc(driest.thermalShare)} in ${driest.year}; the highest demand hour, ${gw(demTop.demMax)} at ${when(demTop.demMaxAt)}; and the highest import hour, ${gw(impTop.impMax)}.`;
  $('chart-h-5').textContent = 'Hours each year with thermal off';
  $('chart-hint-5').textContent = 'Hours with thermal under 0.01 GW, and hours at or above 0.1 GW. The last bar is the latest 365 days.';
  const ch5 = [
    { name: 'Off', color: css('--lowcarbon'), values: rows.map((r) => r.off) },
    { name: 'At or above 0.1 GW', color: css('--fossil'), values: rows.map((r) => r.high[0]) },
  ];
  barChart($('story-chart-5'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Off: <b>${hrs(rows[ci].off)}</b>, ${pc0(rows[ci].offShare)} of hours</div><div>At or above 0.1 GW: <b>${hrs(rows[ci].high[0])}</b></div><div>At or above 0.5 GW: <b>${hrs(rows[ci].high[1])}</b></div><div>Highest hour: <b>${gw(rows[ci].thMax)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([w, what, source, record]) => `<li><span class="swatch" style="background:var(--f-diesel)"></span><span><b>${w}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
