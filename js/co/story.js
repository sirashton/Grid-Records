// The Colombia story: why a grid that runs on Andean water still burns gas,
// coal and diesel. Fossil plants are the country's drought insurance: they
// make about an eighth of its power in a wet year and close to a third in an
// El Niño year, and they are paid to stand by for exactly that. Solar has
// started to push them down at noon; the nights and the dry seasons are
// still theirs.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate, fmtDateTime } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import co from '../countries/co.js';
import { FOSSIL, GENERATION, metricSeries, byYear } from './data.js';

// Colombia keeps UTC-5 all year.
const OFFSET_MS = -5 * 3600000;
// Local hours the story compares: noon 10:00-14:59, night 19:00-04:59.
const NOON = [10, 14];
const NIGHT_FROM = 19;
const NIGHT_TO = 4;
// Fossil levels the story counts hours under, in GW.
export const FOSSIL_LOW = [0.5, 1, 2];
// A year counts as a drought year when fossil made at least this share.
export const DROUGHT_SHARE = 0.25;
const KEYS = ['hydro', 'gas', 'coal', 'oil', 'solar', 'wind', 'biomass', 'other'];

const mean = (sum, n) => (n ? sum / n : NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);
const isNight = (h) => h >= NIGHT_FROM || h <= NIGHT_TO;

/**
 * Every number the story uses. Rows run by Colombian calendar year, complete
 * years only, then 'past365' for the latest 365 days. `months` holds every
 * calendar month, the current one included.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const stepMs = step * 60000;
  const slotH = step / 60;
  const fossil = metricSeries(d, FOSSIL);
  const genCols = GENERATION.map((k) => data.columns[k]).filter(Boolean);
  const gen = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    let g = 0;
    let any = false;
    for (const col of genCols) if (!Number.isNaN(col[i])) { g += Math.max(0, col[i]); any = true; }
    gen[i] = any ? g / 1000 : NaN;
  }
  const local = (i) => new Date(data.startMs + i * stepMs + OFFSET_MS);
  const val = (k, i) => (data.columns[k]?.[i] || 0) / 1000;

  const init = () => ({
    twh: Object.fromEntries([...KEYS, 'fossil', 'gen'].map((k) => [k, 0])),
    hourSum: { fossil: new Float64Array(24), solar: new Float64Array(24), hydro: new Float64Array(24), gen: new Float64Array(24) },
    hourN: new Float64Array(24),
    fosMonth: new Float64Array(12), genMonth: new Float64Array(12),
    fosMin: Infinity, fosMinAt: -1, fosMax: 0, fosMaxAt: -1, solarMax: 0, solarMaxAt: -1, oilMax: 0, oilMaxAt: -1,
    under: FOSSIL_LOW.map(() => 0),
    nights: [], night: null,
  });
  const add = (r, i) => {
    const f = fossil[i];
    if (Number.isNaN(f)) return;
    const t = local(i);
    const h = t.getUTCHours();
    const m = t.getUTCMonth();
    for (const k of KEYS) r.twh[k] += (val(k, i) * slotH) / 1000;
    r.twh.fossil += (f * slotH) / 1000;
    r.twh.gen += (gen[i] * slotH) / 1000;
    r.hourSum.fossil[h] += f;
    r.hourSum.solar[h] += val('solar', i);
    r.hourSum.hydro[h] += val('hydro', i);
    r.hourSum.gen[h] += gen[i];
    r.hourN[h]++;
    r.fosMonth[m] += (f * slotH) / 1000;
    r.genMonth[m] += (gen[i] * slotH) / 1000;
    if (f < r.fosMin) { r.fosMin = f; r.fosMinAt = i; }
    if (f > r.fosMax) { r.fosMax = f; r.fosMaxAt = i; }
    if (val('solar', i) > r.solarMax) { r.solarMax = val('solar', i); r.solarMaxAt = i; }
    if (val('oil', i) > r.oilMax) { r.oilMax = val('oil', i); r.oilMaxAt = i; }
    FOSSIL_LOW.forEach((lv, k) => { if (f < lv) r.under[k] += slotH; });
    // Each night's fossil energy, 19:00 to 04:59, in GWh: what storage
    // charged from the day before would have to supply.
    if (isNight(h)) {
      const key = Math.floor((i * stepMs + data.startMs + OFFSET_MS - 5 * 3600000) / 864e5);
      if (r.night?.key !== key) {
        if (r.night) r.nights.push(r.night);
        r.night = { key, gwh: 0, n: 0 };
      }
      r.night.gwh += f * slotH;
      r.night.n++;
    }
  };
  const finish = (r) => {
    const full = 10 / slotH;
    const nights = (r.night ? [...r.nights, r.night] : r.nights).filter((x) => x.n >= full).map((x) => x.gwh).sort((a, b) => a - b);
    const hourly = Object.fromEntries(Object.keys(r.hourSum).map((k) => [k, [...r.hourSum[k]].map((v, h) => mean(v, r.hourN[h]))]));
    const band = (k, hours) => mean(hours.reduce((s, h) => s + r.hourSum[k][h], 0), hours.reduce((s, h) => s + r.hourN[h], 0));
    const noonHours = Array.from({ length: NOON[1] - NOON[0] + 1 }, (_, k) => NOON[0] + k);
    const nightHours = Array.from({ length: 24 }, (_, h) => h).filter(isNight);
    return {
      year: r.year,
      twh: r.twh,
      fosShare: r.twh.fossil / r.twh.gen,
      hydroShare: r.twh.hydro / r.twh.gen,
      solarShare: r.twh.solar / r.twh.gen,
      otherShare: r.twh.other / r.twh.gen,
      oilShareOfFossil: r.twh.oil / r.twh.fossil,
      hourly,
      noon: Object.fromEntries(['fossil', 'solar', 'hydro', 'gen'].map((k) => [k, band(k, noonHours)])),
      night: Object.fromEntries(['fossil', 'solar', 'hydro', 'gen'].map((k) => [k, band(k, nightHours)])),
      fosMonth: [...r.fosMonth],
      fosMonthShare: [...r.fosMonth].map((v, m) => v / r.genMonth[m]),
      fosMin: r.fosMin, fosMinAt: r.fosMinAt, fosMax: r.fosMax, fosMaxAt: r.fosMaxAt,
      solarMax: r.solarMax, solarMaxAt: r.solarMaxAt, oilMax: r.oilMax, oilMaxAt: r.oilMaxAt,
      under: r.under,
      nights: nights.length,
      medianNight: nights[Math.floor(nights.length / 2)] ?? NaN,
      maxNight: nights.at(-1) ?? NaN,
    };
  };
  const rows = byYear(d, init, add).map(finish);

  // Every calendar month: average fossil GW and its share of generation.
  const months = [];
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(fossil[i])) continue;
    const t = local(i);
    const key = t.getUTCFullYear() * 12 + t.getUTCMonth();
    let mo = months.at(-1);
    if (mo?.key !== key) {
      mo = { key, year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, ms: Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 15), fos: 0, gen: 0, solar: 0, n: 0 };
      months.push(mo);
    }
    mo.fos += fossil[i];
    mo.gen += gen[i];
    mo.solar += val('solar', i);
    mo.n++;
  }
  for (const mo of months) {
    mo.share = mo.fos / mo.gen;
    mo.fos /= mo.n;
    mo.solar /= mo.n;
    delete mo.gen;
  }

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: co.timeZone };
  const below = (gw) => summarise(fossil, gw, 'below', opts);
  const above = (gw) => summarise(fossil, gw, 'above', opts);
  const under1 = below(1);
  const over3 = above(3);
  return {
    rows,
    months,
    under1Spell: spellOf(under1),
    under05Spell: spellOf(below(0.5)),
    over3Spell: spellOf(over3),
    over4Spell: spellOf(above(4)),
    // A spell still running at the latest data: { start, end } in slots.
    over3Now: over3.current ? { start: over3.current.start, end: over3.current.end } : null,
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(2)} GW`;
const twh = (v) => `${v.toFixed(1)} TWh`;
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
  capacity: 'https://www.larepublica.co/especiales/el-camino-hacia-una-economia-mas-verde/generacion-de-energia-hidraulica-pesa-62-8-en-la-matriz-energetica-la-solar-7-6-4402044',
  crisis2024: 'https://www.portafolio.co/energia/asi-estuvo-la-crisis-del-sector-energetico-en-2024-621801',
  inflows2024: 'https://www.larepublica.co/economia/xm-no-ve-riesgos-en-suministro-de-energia-pero-envio-alerta-por-nivel-de-embalses-3960987',
  elNino2026: 'https://www.bluradio.com/nacion/gobierno-confirma-inicio-de-el-nino-y-advierte-posible-intensificacion-a-finales-de-2026-rg10',
  oef: 'https://www.portafolio.co/energia/xm-presento-los-resultados-de-la-asignacion-de-cargo-por-confiabilidad-593845',
  auction: 'https://www.portafolio.co/energia/subasta-de-energia-en-colombia-2027-2028-se-adjudicaron-33-nuevas-plantas-de-generacion-598538',
  scarcity: 'https://www.larepublica.co/economia/precio-de-la-energia-en-colombia-alcanzo-maximo-historico-en-septiembre-por-sequias-3977261',
  spike: 'https://www.larepublica.co/economia/intervencion-de-creg-y-xm-al-mercado-disparo-el-precio-de-energia-en-bolsa-a-7-000-3967646',
  gas: 'https://www.portafolio.co/energia/colombia-se-juega-el-gas-a-una-sola-carta-spec-opera-al-limite-y-marzo-de-2027-enciende-las-alarmas-504586',
  regions: 'https://www.portafolio.co/energia/mapa-de-riesgos-operativos-en-colombia-el-suministro-de-energia-electrica-se-tensiona-en-las-regiones-503963',
  aire: 'https://www.valoraanalitik.com/?p=617722',
  batteries: 'https://www.elcolombiano.com/negocios/megabaterias-energia-colombia-rezagada-negocio-china-y-ee-uu-IE30074084',
  xm364: 'https://www.portafolio.co/energia/colombia-podria-enfrentar-un-deficit-de-energia-en-2027-xm-advierte-faltantes-de-hasta-7-669-gwh-504633',
  stress: 'https://cambiocolombia.com/economia/articulo/2026/10/hay-riesgo-de-racionamiento-de-energia-xm-se-pronuncia-sobre-la-proxima-temporada-seca',
  hidroituango: 'https://www.elcolombiano.com/antioquia/hidroituango-epm-unidades-energia-apagon-embalse-BH40219392',
  colectora: 'https://www.valoraanalitik.com/?p=610261',
  pacific: 'https://forbes.co/2026/10/09/actualidad/llego-a-buenaventura-buque-que-permitira-importar-gas-natural-por-el-pacifico-colombiano/',
  puertoBahia: 'https://www.valoraanalitik.com/ecopetrol-se-enfocara-en-regasificadora-de-puerto-bahia-tras-retraso-en-tramites-en-proyecto-covenas/',
};

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['October 2026', 'SPEC, the LNG terminal at Cartagena, expands from 475 to 533 MMSCFD. Its LNG price rose from US$13.96 to US$24.97/MMBTU this year, with US$28-30 possible in November.', 'gas', 'The highest oil and diesel hour in a year, if gas runs short and liquids step in.'],
  ['Late 2026', 'The Pacific regasification terminal at Buenaventura starts at about 90 MMSCFD, its LNG trucked to Buga. The storage ship arrived on 9 October 2026.', 'pacific', 'The longest spell with fossil over 4 GW: more gas lets thermal hold a higher plateau.'],
  ['November 2026 to January 2027', 'El Niño: a 96% chance it persists and a 63% chance it becomes "very strong".', 'elNino2026', 'The highest fossil hour and the highest monthly fossil share.'],
  ['February to April 2027', 'XM\'s shortfall window: firm energy falls up to 7,669 GWh short for 2026-27, and demand cannot be fully met if thermal averages only 85 GWh a day.', 'xm364', 'The highest fossil share in a calendar year.'],
  ['February 2027', 'Puerto Bahía regasification (Ecopetrol and Frontera, Cartagena) is expected. With it and the Pacific terminal, the March 2027 gas gap falls from 124 to 37 MMSCFD.', 'puertoBahia', 'The longest spell with fossil over 3 GW.'],
  ['April 2027', 'The Colectora 500 kV line, eight months late, connects seven Guajira wind parks, about 10% of peak demand. At least 2,200 MW of those parks are stalled.', 'colectora', 'A first year with wind above 1 TWh.'],
  ['November 2027 to mid-2028', 'Hidroituango units 5 to 8, another 1,200 MW; all eight would make about 17% of generation.', 'hidroituango', 'The longest spells with fossil under 1 GW and under 0.5 GW.'],
  ['December 2027', 'The 2027-28 Reliability Charge obligations begin: 4,441 MW of new solar from the 2024 auction, 99% of the new capacity.', 'auction', 'The highest solar hour, and the lowest fossil hour in a year.'],
];

export function renderStory(data, end, figs) {
  const { rows, months, under1Spell, under05Spell, over3Spell, over4Spell, over3Now } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? last;
  const mon = (y, m) => months.find((x) => x.year === y && x.month === m) ?? months.at(-1);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const when = (i) => fmtDateTime(at(i));
  const monthName = (m) => `${MONTHS[m.month - 1]} ${m.year}`;

  // The figures the text leans on, worked out from whatever data is loaded.
  const byShare = [...full].sort((a, b) => a.fosShare - b.fosShare);
  const wet = byShare.slice(0, 2).sort((a, b) => a.year - b.year);
  const dry = byShare.slice(-2).sort((a, b) => a.year - b.year);
  const maxHour = full.reduce((a, r) => (r.fosMax > a.fosMax ? r : a), first);
  const maxMonth = months.reduce((a, m) => (m.share > a.share ? m : a), months[0]);
  const solarTop = rows.reduce((a, r) => (r.solarMax > a.solarMax ? r : a), first);
  const now = months.at(-1);
  const curYear = now.year;
  const yearMonths = months.filter((m) => m.year === curYear);
  const low = yearMonths.reduce((a, m) => (m.share < a.share ? m : a), yearMonths[0]);
  const y22 = row(2022);
  const y24 = row(2024);
  const y25 = row(2025);
  const y17 = row(2017);
  const y15 = row(2015);
  const peak24 = mon(2024, 4);
  const h22 = y22.hourly;
  const h25 = y25.hourly;
  const hL = latest.hourly;
  const nightGw = y25.medianNight / 10;

  // Header and in short.
  $('lede').textContent = 'Colombia\'s gas and coal plants are drought insurance: they idle in wet years and run flat out when El Niño empties the reservoirs.';
  $('answer-lead').textContent = `Fossil power still runs in Colombia because the grid runs on hydro and the rivers fail every few years. In wet years fossil supplies about an eighth of generation (${pc0(wet[0].fosShare)} in ${wet[0].year}, ${pc0(wet[1].fosShare)} in ${wet[1].year}); in El Niño years close to a third (${pc0(dry[0].fosShare)} in ${dry[0].year}, ${pc0(dry[1].fosShare)} in ${dry[1].year}). ${curYear} is turning into one of those years: fossil's monthly share rose from ${pc0(low.share)} in ${MONTHS[low.month - 1]} to ${pc0(now.share)} in ${MONTHS[now.month - 1]}. Solar now takes the middle of the day, but nothing yet takes the night or the dry season.`;
  $('answer-points').innerHTML = [
    `<b>Fossil output more than doubles between a wet year and a dry one.</b> ${twh(y17.twh.fossil)} in 2017 and ${twh(y25.twh.fossil)} in 2025, against ${twh(y15.twh.fossil)} in 2015 and ${twh(y24.twh.fossil)} in 2024. The highest fossil hour on record is ${gw(maxHour.fosMax)}, at ${when(maxHour.fosMaxAt)}${maxHour.year === 2024 ? `, when reservoirs were near 28% (${src(SOURCES.crisis2024, 'Portafolio')})` : ''}. ${link(1, 'Chapter 1')}`,
    `<b>The plants are paid to stand by, and the fuel is now imported.</b> Thermal plants hold 50.3% of the firm energy bought under the Reliability Charge (${src(SOURCES.oef, 'Portafolio')}). Gas is 41% imported LNG through one terminal at Cartagena, at US$24.97/MMBTU (${src(SOURCES.gas, 'Portafolio')}). ${link(3, 'Chapter 3')}`,
    `<b>Solar has cut fossil at noon but not at night.</b> In 2025 fossil averaged ${gw(y25.noon.fossil)} from ${hh(NOON[0])} to ${hh(NOON[1] + 1)} and ${gw(y25.night.fossil)} at night; in 2022 the two were level, ${gw(y22.noon.fossil)} and ${gw(y22.night.fossil)}. ${under1Spell ? `Fossil has never spent more than ${hrs(spellH(under1Spell))} in a row below 1 GW.` : ''} ${link(4, 'Chapter 4')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--fossil', 'Fossil share, latest 365 days', pc(latest.fosShare), `${twh(latest.twh.fossil)} of ${twh(latest.twh.gen)}`],
    ['--fossil', 'Highest fossil hour', gw(maxHour.fosMax), `${when(maxHour.fosMaxAt)}${maxHour.year === 2024 ? ', at the bottom of the 2024 drought' : ''}`],
    ['--lowcarbon', 'Longest spell with fossil under 1 GW', under1Spell ? hrs(spellH(under1Spell)) : 'None', under1Spell ? `${fmtDate(at(under1Spell.start))} to ${fmtDate(at(under1Spell.end - 1))}` : ''],
    ['--f-solar', 'Highest solar hour', gw(solarTop.solarMax), when(solarTop.solarMaxAt)],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${pc0(now.share)}</div><div class="sub">Fossil's share of generation in ${monthName(now)}${now.year === curYear ? ' so far' : ''}, up from ${pc0(low.share)} in ${MONTHS[low.month - 1]} as El Niño drains the reservoirs.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: drought insurance, when fossil runs, who pays and why it still runs, what solar does and does not replace, and what is coming.';

  const chapters = [
    'Drought insurance',
    'When it runs: the dry months and the El Niño years',
    'Who pays, and why it still runs',
    'Solar takes the noon, not the night or the drought',
    'What is coming, and the records to watch',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });

  // Chapter 1: fossil by year.
  $('take-1').textContent = 'Colombia\'s fossil fleet is sized for the year the rivers fail, and the yearly totals show it.';
  $('body-1').innerHTML = `Colombia generated ${twh(y25.twh.gen)} in 2025, of which hydro was ${twh(y25.twh.hydro)}, or ${pc(y25.hydroShare)}. Fossil plants supplied ${twh(y25.twh.fossil)}: ${twh(y25.twh.gas)} of gas, ${twh(y25.twh.coal)} of coal and ${twh(y25.twh.oil)} of oil. That was a wet year. The year before was not. In 2024 fossil supplied ${twh(y24.twh.fossil)}, ${pc(y24.fosShare)} of generation, with gas at ${twh(y24.twh.gas)} and coal at ${twh(y24.twh.coal)}. The pattern repeats across the record. The El Niño years of 2009 and 2010 took fossil to ${pc(row(2009).fosShare)} and ${pc(row(2010).fosShare)}; 2015 and 2016 to ${pc(y15.fosShare)} and ${pc(row(2016).fosShare)}; 2023 and 2024 to ${pc(row(2023).fosShare)} and ${pc(y24.fosShare)}. Between them, wet years such as 2017 at ${pc(y17.fosShare)} and 2025 at ${pc(y25.fosShare)} set the floor. Installed capacity at the end of 2025 was 13,209 MW of hydro, 6,224 MW of thermal and at least 1,594 MW of solar (${src(SOURCES.capacity, 'La República')}). The thermal fleet exists for the dry years; in the wet ones most of it sits idle.`;
  $('chart-h-1').textContent = 'Yearly generation by fuel';
  $('chart-hint-1').textContent = 'TWh generated each calendar year; the last bar is the latest 365 days. Fossil (coal, gas, oil) sits at the bottom and more than doubles in El Niño years: 2009-10, 2015-16, 2023-24.';
  const ch1 = [
    { name: 'Coal', color: css('--f-coal'), key: 'coal' },
    { name: 'Gas', color: css('--f-gas'), key: 'gas' },
    { name: 'Oil and diesel', color: css('--f-diesel'), key: 'oil' },
    { name: 'Hydro', color: css('--f-hydro'), key: 'hydro' },
    { name: 'Solar', color: css('--f-solar'), key: 'solar' },
    { name: 'Wind, biomass and other', color: css('--f-biomass'), key: 'rest' },
  ].map((s) => ({ ...s, values: rows.map((r) => (s.key === 'rest' ? r.twh.wind + r.twh.biomass + r.twh.other : r.twh[s.key])) }));
  barChart($('story-chart-1'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => rows[ci].fosShare >= DROUGHT_SHARE,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Fossil: <b>${twh(rows[ci].twh.fossil)}</b>, ${pc(rows[ci].fosShare)} of ${twh(rows[ci].twh.gen)}</div>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: the months.
  const oct24 = mon(2024, 10);
  const may24 = mon(2024, 5);
  $('take-2').textContent = 'Fossil follows the reservoirs, so it runs hardest in the dry season, from December to April, and in any year the Pacific turns warm.';
  $('body-2').innerHTML = `Fossil's monthly share of generation reached ${pc(peak24.share)} in April 2024, when reservoirs fell to about 28% of useful volume, the first time below 30% (${src(SOURCES.crisis2024, 'Portafolio')}). The highest month on record is ${monthName(maxMonth)}, at ${pc(maxMonth.share)}.${over3Spell ? ` The longest spell with fossil above 3 GW ran ${hrs(spellH(over3Spell))}, from ${fmtDate(at(over3Spell.start))} to ${fmtDate(at(over3Spell.end - 1))}.` : ''}${over4Spell ? ` The longest above 4 GW was ${hrs(spellH(over4Spell))}, from ${fmtDate(at(over4Spell.start))}.` : ''} When the rains came in May 2024 the share fell at once, to ${pc(may24.share)}. The second half of 2024 was worse than the first, because inflows in August and September were the lowest in 40 years (${src(SOURCES.inflows2024, 'La República')}), and October 2024 reached ${pc(oct24.share)}. ${curYear} looks like 2023 again. IDEAM confirmed El Niño about three months early, with a 63% chance it becomes "very strong" (${src(SOURCES.elNino2026, 'Blu Radio')}). Fossil's share climbed from ${pc(low.share)} in ${MONTHS[low.month - 1]} to ${pc(now.share)} in ${MONTHS[now.month - 1]}${over3Now ? `, and fossil has been above 3 GW for ${hrs(spellH(over3Now))} and counting since ${fmtDate(at(over3Now.start))}` : ''}. The dry season proper starts in December.`;
  $('chart-h-2').textContent = 'Fossil share of generation, month by month';
  $('chart-hint-2').textContent = 'Gas, coal and oil as a share of each calendar month\'s generation. The peaks are the dry seasons of El Niño years.';
  const ch2 = [{ name: 'Fossil share', color: css('--fossil'), points: months.map((m) => [m.ms, m.share * 100]), width: 2 }];
  lineChart($('story-chart-2'), {
    series: ch2,
    yMin: 0,
    yFormat: (v) => `${v.toFixed(1)}%`,
    yTickFormat: (v) => `${v}%`,
    tooltip: (t) => {
      const d = new Date(t);
      const m = mon(d.getUTCFullYear(), d.getUTCMonth() + 1);
      return `<strong>${monthName(m)}</strong><div>Fossil: <b>${pc(m.share)}</b> of generation, <b>${gw(m.fos)}</b> on average</div><div>Solar: <b>${gw(m.solar)}</b> on average</div>`;
    },
  });
  $('story-legend-2').innerHTML = legend(ch2.map((sr) => [sr.name, sr.color]));

  // Chapter 3: the economics, and the floor.
  $('take-3').textContent = 'Consumers pay thermal plants a monthly fee for firm energy, and the insurance it buys is now written on imported LNG.';
  $('body-3').innerHTML = `Every Colombian bill carries the Reliability Charge (Cargo por Confiabilidad). It pays generators for firm energy obligations: a promise to deliver in a drought. For 2025-26 thermal plants held 50.3% of the 58,940 GWh-year assigned, mostly gas, then coal, then liquid fuels (${src(SOURCES.oef, 'Portafolio')}). The last auction, for 2027-28, cleared at US$18.2/MWh (${src(SOURCES.auction, 'Portafolio')}). When the spot price passes the scarcity price, put near COP 900/kWh (${src(SOURCES.scarcity, 'La República')}), plants holding obligations must deliver and are paid about that price; that is the usual reading of the rules, not checked here. In 2024 prices went far past it. CREG moved the system to "risk" on about 29 September, every thermal plant was dispatched, and the spot price hit COP 7,233/kWh on 30 September (${src(SOURCES.spike, 'La República')}); October 2024 averaged COP 1,560/kWh (${src(SOURCES.crisis2024, 'Portafolio')}). The fuel has changed too. Imports are 41% of gas consumption, all through SPEC at Cartagena, and its LNG price rose from US$13.96 to US$24.97/MMBTU this year (${src(SOURCES.gas, 'Portafolio')}). Some plants run for the wires rather than the energy: the Termozipa coal plant is "indispensable" for voltage near Bogotá, and 352 of 367 load-shedding orders this year were in the Caribbean (${src(SOURCES.regions, 'Portafolio')}), where most thermal plants sit and the distributor Air-e owes the market more than COP 4 trillion (${src(SOURCES.aire, 'Valora Analitik')}). The floor shows it: fossil was under 1 GW for ${hrs(y15.under[1])} in 2015 and ${hrs(y24.under[1])} in 2024, against ${hrs(y17.under[1])} in 2017.`;
  $('chart-h-3').textContent = 'Hours each year with fossil under 1 GW';
  $('chart-hint-3').textContent = 'Wet years have thousands of hours under 1 GW; El Niño years almost none. The lowest fossil hour of each year is in the tooltip.';
  const ch3 = [{ name: 'Hours under 1 GW', color: css('--lowcarbon'), values: rows.map((r) => r.under[1]) }];
  barChart($('story-chart-3'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch3,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Under 1 GW: <b>${hrs(rows[ci].under[1])}</b></div><div>Under 0.5 GW: <b>${hrs(rows[ci].under[0])}</b></div><div>Lowest hour: <b>${gw(rows[ci].fosMin)}</b>, ${when(rows[ci].fosMinAt)}</div>`,
  });
  $('story-legend-3').innerHTML = legend(ch3.map((sr) => [sr.name, sr.color]));

  // Chapter 4: by hour of day.
  const lowH = (arr) => arr.indexOf(Math.min(...arr.slice(5, 18)), 5);
  $('take-4').textContent = 'Solar has reshaped fossil\'s day since 2022, but it covers the hours when fossil was already lowest, and none of the dry season.';
  $('body-4').innerHTML = `In 2022 fossil barely moved through the day: ${gw(h22.fossil[6])} at 06:00 and ${gw(h22.fossil[20])} at 20:00, with solar peaking at ${gw(Math.max(...h22.solar))}. By 2025 solar peaked at ${gw(Math.max(...h25.solar))} and fossil dipped to ${gw(h25.fossil[lowH(h25.fossil)])} at ${hh(lowH(h25.fossil))} before climbing to ${gw(h25.fossil[20])} at 20:00. Over the latest 365 days solar reaches ${gw(Math.max(...hL.solar))} on average at its peak, while fossil runs ${gw(hL.fossil[lowH(hL.fossil)])} at ${hh(lowH(hL.fossil))} and ${gw(hL.fossil[20])} at 20:00. Solar generation rose from ${twh(y22.twh.solar)} in 2022 to ${twh(y25.twh.solar)} in 2025 and ${twh(latest.twh.solar)} in the latest year. The night is still fossil's. In 2025 fossil supplied a median of ${n0(y25.medianNight)} GWh each night from ${hh(NIGHT_FROM)} to ${hh(NIGHT_TO + 1)}. Batteries to cover that median wet-year night would need about ${n0(y25.medianNight)} GWh of storage and ${nightGw.toFixed(1)} GW of output (our estimate: the night's energy over ten hours). Colombia has about 6 MWh of utility batteries in service, at Termozipa and Palmira (${src(SOURCES.batteries, 'El Colombiano')}). Even that fleet would not touch a drought. In 2024 the median night needed ${n0(y24.medianNight)} GWh and the worst ${n0(y24.maxNight)} GWh, and the year needed ${twh(y24.twh.fossil - y25.twh.fossil)} more fossil than 2025. A battery recharges from the next day's surplus; a drought has no surplus for months.`;
  $('chart-h-4').textContent = 'Fossil and solar by hour of day';
  $('chart-hint-4').textContent = 'Average output for each hour of the day, Colombia time, in GW. Solar carves a midday dip in fossil that did not exist in 2022; the evening peak is untouched.';
  const hourX = (h) => h * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ t: hourX(h), label: hh(h) }));
  const years4 = [2022, 2025, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const colors4 = ['--f-other', '--f-gas', '--fossil'];
  const ch4 = [
    ...years4.map((y, k) => ({ name: `Fossil, ${title(y).toLowerCase()}`, color: css(colors4[k]), points: row(y).hourly.fossil.map((v, h) => [hourX(h), v]), width: y === 'past365' ? 3 : 2 })),
    { name: 'Solar, latest 365 days', color: css('--f-solar'), points: hL.solar.map((v, h) => [hourX(h), v]), width: 2 },
  ];
  lineChart($('story-chart-4'), {
    series: ch4,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-4').innerHTML = legend(ch4.map((sr) => [sr.name, sr.color]));

  // Chapter 5: what's coming.
  const maxShareYear = full.reduce((a, r) => (r.fosShare > a.fosShare ? r : a), first);
  $('take-5').textContent = 'The next eighteen months bring a possibly very strong El Niño first, and new hydro, solar and wind after it.';
  $('body-5').innerHTML = `The near term is about getting through to April 2027. XM's latest bulletin says firm energy falls short of demand by up to 7,669 GWh for 2026-27 on 2015-17 hydrology, and that demand cannot be fully met from February to April 2027 if thermal averages only 85 GWh a day (${src(SOURCES.xm364, 'Portafolio')}). On 28-29 September 2026 the generation offered fell short of forecast demand, and XM called it a "stress condition" (${src(SOURCES.stress, 'Cambio')}). Gas is the limit: thermal plants need 519-538 MMSCFD to meet their obligations, and March 2027 could be 124 MMSCFD short without new terminals (${src(SOURCES.gas, 'Portafolio')}). After that the picture changes. The 2024 auction adds 4,441 MW of solar for December 2027 (${src(SOURCES.auction, 'Portafolio')}), Hidroituango's second 1,200 MW arrives from November 2027 (${src(SOURCES.hidroituango, 'El Colombiano')}), and the Colectora line for Guajira wind is due in April 2027 (${src(SOURCES.colectora, 'Valora Analitik')}). None of it is storage, and no coal plant has a closure date. Records to watch this dry season: the highest fossil hour, ${gw(maxHour.fosMax)}; ${over4Spell ? `the longest spell over 4 GW, ${hrs(spellH(over4Spell))}; ` : ''}the highest monthly share, ${pc(maxMonth.share)}; the highest yearly share, ${pc(maxShareYear.fosShare)} in ${maxShareYear.year}. After it: ${under1Spell ? `the longest spell under 1 GW, ${hrs(spellH(under1Spell))}; ` : ''}${under05Spell ? `the longest under 0.5 GW, ${hrs(spellH(under05Spell))}; ` : ''}and the highest solar hour, ${gw(solarTop.solarMax)}.`;
  $('chart-h-5').textContent = 'Solar generation by year';
  $('chart-hint-5').textContent = 'TWh of solar each year; the last bar is the latest 365 days. The highest solar hour of each year is in the tooltip.';
  const solarRows = rows.filter((r) => r.year === 'past365' || r.year >= 2018);
  const ch5 = [{ name: 'Solar', color: css('--f-solar'), values: solarRows.map((r) => r.twh.solar) }];
  barChart($('story-chart-5'), {
    cats: solarRows.map((r) => label(r.year)),
    stacks: ch5,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(solarRows[ci].year)}</strong><div>Solar: <b>${twh(solarRows[ci].twh.solar)}</b>, ${pc(solarRows[ci].solarShare)} of generation</div><div>Highest hour: <b>${gw(solarRows[ci].solarMax)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = COMING.map(([w, what, source, record]) => `<li><span class="swatch" style="background:var(--f-gas)"></span><span><b>${w}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
