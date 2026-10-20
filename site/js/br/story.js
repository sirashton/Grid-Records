// The Brazil story: why a grid that throws away a fifth of its wind and solar
// still burns 7 to 8 GW of fossil fuel round the clock. Because most of it is
// contracted to run whatever the weather does, and the rest is ONS saving
// water in the reservoirs. The figures are worked out from the data by
// storyFigures(), which the tests also run; renderStory() draws the page.
// Drafted with Alex's answer-first structure: the answer, three supporting
// points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import br from '../countries/br.js';
import { FOSSIL, metricSeries, yearlyEnergy, byYear } from './data.js';

// Levels the story follows, in GW.
export const FOSSIL_HIGH = 15;
export const FOSSIL_LOW = 5;
// Fossil below this is the floor that has run whatever happens since 2018;
// batteries are sized against the fossil above it.
export const FOSSIL_FLOOR = 3;
// Battery fleets (GW, GWh) the story tests against each day's fossil above
// the floor. The first two are four-hour batteries, the shape of the
// December 2026 auctions.
export const BATTERIES = [[5, 20], [10, 40], [20, 80], [30, 160]];
// The low-fossil spells count from this year, when the fleet had reached its present size.
export const SPELLS_FROM = 2013;
// Local hours compared for the midday sag: late morning 10:00-12:00, evening 19:00-21:00.
const NOON = [10, 12];
const EVENING = [19, 21];

/**
 * Local hour, month and day number for every slot. The Brasília offset is
 * looked up once per UTC day, so the hour around a clock change (before 2019)
 * can be one off.
 */
function localClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Uint8Array(data.length);
  const day = new Int32Array(data.length);
  const year = new Int16Array(data.length);
  let utcDay = -1;
  let offset = 0;
  for (let i = 0; i < data.length; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== utcDay) {
      utcDay = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, br.timeZone);
    }
    const local = t + offset;
    const l = new Date(local);
    hour[i] = l.getUTCHours();
    month[i] = l.getUTCMonth() + 1;
    day[i] = Math.floor(local / 864e5);
    year[i] = l.getUTCFullYear();
  }
  return { hour, month, day, year };
}

const mean = (sum, n) => (n ? sum / n : NaN);
const share = (held, made) => (held + made > 0 ? (held / (held + made)) * 100 : NaN);
const col = (data, k, end) => data.columns[k] ?? new Float64Array(end).fill(NaN);
const spellOf = (s) => (s.record ? { start: s.record.start, end: s.record.end } : null);

/**
 * Every number the story uses. Rows run by Brazilian calendar year, complete
 * years only, then 'past365' for the latest 365 days. Held back shares are
 * what ONS held back as a share of what wind farms (or solar farms) made plus
 * what they were held back, over hours ONS reported it.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const energy = yearlyEnergy(d);
  const fossil = metricSeries(d, FOSSIL);
  const gas = col(data, 'gas', end);
  const other = col(data, 'other', end);
  const wind = col(data, 'wind', end);
  const farms = col(data, 'solar_utility', end);
  const roof = col(data, 'solar_rooftop', end);
  const windHeld = col(data, 'wind_curtailed', end);
  const solarHeld = col(data, 'solar_curtailed', end);
  const { hour, month, day, year } = localClock(d);
  // What ONS held back from wind and solar farms together, in GW; NaN before it reported either.
  const held = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    const a = windHeld[i];
    const b = solarHeld[i];
    held[i] = Number.isNaN(a) && Number.isNaN(b) ? NaN : ((a || 0) + (b || 0)) / 1000;
  }

  const rows = byYear(d, () => ({
    fosMin: Infinity, fosMinAt: -1, fosHigh: 0, fosLow: 0, fosU3: 0, gasMin: Infinity, otherMin: Infinity,
    fosHour: new Float64Array(24), gasHour: new Float64Array(24), heldHour: new Float64Array(24), solarHour: new Float64Array(24), hourN: new Float64Array(24), heldN: new Float64Array(24),
    fosMonth: new Float64Array(12), noon: 0, noonN: 0, evening: 0, eveningN: 0,
    windMade: 0, windHeld: 0, solarMade: 0, solarHeld: 0,
    day: null, days: [],
  }), (r, i) => {
    const f = fossil[i];
    if (Number.isNaN(f)) return;
    const h = hour[i];
    // Fossil above the floor, one day at a time.
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(r.day);
      r.day = { n: day[i], month: month[i], above: 0, peak: 0, held: 0, slots: 0 };
    }
    r.day.above += Math.max(0, f - FOSSIL_FLOOR) * slotH;
    if (f > r.day.peak) r.day.peak = f;
    if (!Number.isNaN(held[i])) r.day.held += held[i] * slotH;
    r.day.slots++;
    if (f < r.fosMin) { r.fosMin = f; r.fosMinAt = i; }
    if (gas[i] / 1000 < r.gasMin) r.gasMin = gas[i] / 1000;
    if (other[i] / 1000 < r.otherMin) r.otherMin = other[i] / 1000;
    if (f >= FOSSIL_HIGH) r.fosHigh += slotH;
    if (f < FOSSIL_LOW) r.fosLow += slotH;
    if (f < FOSSIL_FLOOR) r.fosU3 += slotH;
    r.fosHour[h] += f;
    r.gasHour[h] += (gas[i] || 0) / 1000;
    r.solarHour[h] += ((farms[i] || 0) + (roof[i] || 0)) / 1000;
    r.hourN[h]++;
    if (!Number.isNaN(held[i])) { r.heldHour[h] += held[i]; r.heldN[h]++; }
    r.fosMonth[month[i] - 1] += (f * slotH) / 1000;
    if (h >= NOON[0] && h <= NOON[1]) { r.noon += f; r.noonN++; }
    if (h >= EVENING[0] && h <= EVENING[1]) { r.evening += f; r.eveningN++; }
    if (!Number.isNaN(windHeld[i])) { r.windHeld += windHeld[i] * slotH; r.windMade += (wind[i] || 0) * slotH; }
    if (!Number.isNaN(solarHeld[i])) { r.solarHeld += solarHeld[i] * slotH; r.solarMade += (farms[i] || 0) * slotH; }
  }).map((r) => {
    const days = (r.day ? [...r.days, r.day] : r.days).filter((x) => x.slots * slotH >= 23);
    const sorted = days.map((x) => ({ gwh: x.above, peak: x.peak, held: x.held, month: x.month })).sort((a, b) => a.gwh - b.gwh);
    return {
      year: r.year,
      fosMin: r.fosMin,
      fosMinAt: r.fosMinAt,
      fosHigh: r.fosHigh,
      fosLow: r.fosLow,
      fosU3: r.fosU3,
      gasMin: r.gasMin,
      otherMin: r.otherMin,
      fosHour: [...r.fosHour].map((v, k) => mean(v, r.hourN[k])),
      gasHour: [...r.gasHour].map((v, k) => mean(v, r.hourN[k])),
      solarHour: [...r.solarHour].map((v, k) => mean(v, r.hourN[k])),
      heldHour: [...r.heldHour].map((v, k) => mean(v, r.heldN[k])),
      // TWh in each calendar month.
      fosMonth: [...r.fosMonth],
      // Evening minus late morning, so a positive number means fossil sags at midday.
      sag: mean(r.evening, r.eveningN) - mean(r.noon, r.noonN),
      // TWh.
      windHeldTwh: r.windHeld / 1e6,
      solarHeldTwh: r.solarHeld / 1e6,
      heldTwh: (r.windHeld + r.solarHeld) / 1e6,
      windHeldPct: share(r.windHeld, r.windMade),
      solarHeldPct: share(r.solarHeld, r.solarMade),
      heldPct: share(r.windHeld + r.solarHeld, r.windMade + r.solarMade),
      // Each whole day's fossil above the floor (GWh), its peak, and what was held back that day, smallest first.
      days: sorted,
      aboveTwh: sorted.reduce((a, x) => a + x.gwh, 0) / 1000,
      // Days on which the wind and solar held back could have covered the fossil above the floor.
      heldCovers: sorted.filter((x) => x.held >= x.gwh).length,
      // Days a battery fleet could have covered, if it was full, and of those the days
      // the power held back that same day would have filled it.
      batteries: BATTERIES.map(([bgw, gwh]) => {
        const fits = sorted.filter((x) => x.gwh <= gwh && x.peak - FOSSIL_FLOOR <= bgw);
        return { gw: bgw, gwh, days: fits.length, charged: fits.filter((x) => x.held >= x.gwh).length };
      }),
    };
  });

  // Record spells. The high spell runs over the whole record; the low spells
  // start at SPELLS_FROM, because before the 2013 drought the fleet was a
  // fraction of today's and ran under 5 GW for years at a time.
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: br.timeZone };
  let from = year.findIndex((y) => y >= SPELLS_FROM);
  if (from < 0) from = end;
  const recent = fossil.subarray(from);
  const shift = (sp) => (sp ? { start: sp.start + from, end: sp.end + from } : null);
  const recentOpts = { ...opts, startMs: data.startMs + from * step * 60000 };
  return {
    rows,
    energy,
    fossilHighSpell: spellOf(summarise(fossil, FOSSIL_HIGH, 'above', opts)),
    fossilLowSpell: shift(spellOf(summarise(recent, FOSSIL_LOW, 'below', recentOpts))),
    fossilFloorSpell: shift(spellOf(summarise(recent, FOSSIL_FLOOR, 'below', recentOpts))),
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(1)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const pct = (v) => `${v.toFixed(1)}%`;
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const named = (y) => (y === 'past365' ? 'the latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const src = (url, text) => `<a href="${url}">${text}</a>`;
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// From other ONS datasets, not the generation data: natural inflow to the
// reservoirs as a share of the long-term average (ENA), stored energy as a
// share of the maximum (EAR), and turbinable water spilled (energia vertida
// turbinável), for the whole interconnected system.
export const HYDROLOGY = {
  2021: { inflowPct: 72, storeStart: 25, storeMin: 24, spillTwh: 11.6, spillMidday: 1.3 },
  2025: { inflowPct: 78, storeStart: 53, storeMin: 44, spillTwh: 21.0, spillMidday: 4.6 },
};

// Pages the writer opened for the figures quoted in the text.
const SOURCES = {
  onsData: 'https://dados.ons.org.br/',
  pmo: 'https://static.poder360.com.br/2025/05/Informe-do-PMO-MAI_2025-RV2.pdf',
  pmo2026: 'https://cenarioenergia.com.br/2026/02/20/ons-revisa-para-baixo-nivel-dos-reservatorios-no-sudeste-centro-oeste-para-574/',
  pmoMay2026: 'https://cenarioenergia.com.br/2026/05/29/ons-reduz-despacho-termico-e-reforca-estrategia-para-preservar-reservatorios-do-sudeste-antes-do-periodo-seco/',
  angra2: 'https://canalsolar.com.br/angra-dois-desligada-cinquenta-dias/',
  inflex: 'https://cenarioenergia.com.br/2025/09/23/ons-estabelece-nova-rotina-para-ofertas-de-reducao-de-inflexibilidade-em-usinas-termicas/',
  jabutis: 'https://energiaeambiente.org.br/wp-content/uploads/2023/09/NOTA-TECNICA-JABUTIS-DO-GAS-_Coalizao.pdf',
  lrcap2021: 'https://www.poder360.com.br/energia/leilao-de-reserva-de-capacidade-acaba-com-46-gw-contratados/',
  lrcap2026: 'https://www.ccee.org.br/documents/80415/31088149/InfoLeilão_expresso_04LRCAP_2026.pdf/ec548418-5998-43a6-a93b-e21516fcf0cc',
  lrcap2026news: 'https://eixos.com.br/newsletters/comece-seu-dia/muita-potencia-e-baixa-competicao-o-resultado-do-leilao-de-energia-mais-esperado-de-2026/',
  cvu: 'https://cenarioenergia.com.br/2025/07/28/aneel-aprova-novos-cvus-para-termicas-porto-sergipe-i-e-linhares-com-valores-acima-de-r-900-mwh/',
  pld: 'https://www.ccee.org.br/documents/80415/30981079/InfoPLD_Diario29122025.pdf/42fff11f-cded-4072-2dd5-1be468648580',
  cmse2025: 'https://canalsolar.com.br/cmse-vai-antecipar-termicas-para-reforcar-seguranca-energetica/',
  coal: 'https://apublica.org/2025/10/energia-suja-verba-publica-ainda-paga-termicas-a-carvao-no-brasil/',
  pecem: 'https://cenarioenergia.com.br/2026/03/27/eneva-vende-termica-pecem-ii-por-r-872-milhoes-e-acelera-reconfiguracao-estrategica-do-portfolio/',
  hvdc: 'https://canalsolar.com.br/mme-antecipa-obra-linha-de-transmissao/',
  batteries: 'https://painel-website.rolim.com/wp-content/uploads/2026/08/Editais-dos-leiloes-de-baterias-.pdf',
  calendar: 'https://agenciainfra.com/blog/?p=48291',
  angra3: 'https://www.poder360.com.br/poder-energia/silveira-diz-querer-apresentar-solucao-para-angra-3-ainda-em-2026/',
  angra: 'https://en.wikipedia.org/wiki/Angra_Nuclear_Power_Plant',
  pen: 'https://movimentoeconomico.com.br/economia/energia/2026/07/11/cortes-de-geracao-devem-cair-pouco-ate-2030-e-preocupam-setor-eletrico-do-ne/',
};

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['2 and 4 Dec 2026', 'Brazil\'s first battery auctions, for four-hour batteries of 30 MW or more on 15-year contracts, with supply from 1 August 2028.', 'batteries', 'The fossil sag at midday against the evening, and the 10:00 record for wind and solar held back.'],
  ['By the end of 2026 (promised)', 'A CNPE decision on Angra 3 (1,405 MW, about 66% built, R$23.9bn to finish), which the minister says will come this year.', 'angra3', 'If it goes ahead, the nuclear peak from about 1.9 GW to about 3.3 GW in the 2030s: a flat block that does not help the midday surplus.'],
  ['2027', 'The CDE reimbursement for coal, about R$1bn a year to Candiota III and Jorge Lacerda, ends. Candiota III\'s supply contract ended in 2024; Jorge Lacerda has state support to 2040.', 'coal', 'Coal\'s lowest hour and hours a year with coal at zero.'],
  ['2027 to 2030', 'ONS\'s plan to 2030 keeps energy curtailment at about 40 GW a year, mostly between 07:00 and 15:00, while curtailment for grid limits falls from 7% of hours in 2027 to 4% in 2030.', 'pen', 'The held back share: the record to watch is whether it falls below a fifth.'],
  ['March 2028', 'The Graça Aranha to Silvânia HVDC line, 5 GW from Maranhão to Goiás, brought forward from 2030.', 'hvdc', 'The share of wind and solar held back, and the most held back in an hour (the record to fall).'],
  ['Sept 2028', 'Pecém II\'s coal supply contracts end; it was recontracted for capacity from August 2031.', 'pecem', 'Coal in the Northeast between the two contracts.'],
  ['By August 2031', 'The 19 GW from the March 2026 capacity reserve auction comes on, 86% of it thermal and the largest part gas; Pecém II\'s new ten-year contract, the last dated, starts in August 2031.', 'lrcap2026news', 'The fossil peak in dry months should rise; the floor should not, if the new contracts are flexible as promised.'],
];

export function renderStory(data, end, figs) {
  const { rows, energy, fossilHighSpell, fossilLowSpell, fossilFloorSpell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? last;
  const en = (y) => energy.find((r) => r.year === y) ?? energy.at(-1);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const when = (i) => fmtDate(at(i));
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const fuels = ['gas', 'coal', 'oil', 'other'];
  const fosTwh = (e) => fuels.reduce((a, k) => a + (e.twh[k] || 0), 0);
  const drought = en(2021);
  // The year with the least fossil since the 2013 drought.
  const lowest = energy.filter((e) => e.year !== 'past365' && e.year >= SPELLS_FROM).reduce((a, e) => (fosTwh(e) < fosTwh(a) ? e : a), drought);
  const eLast = en(last.year);
  const eLatest = en('past365');
  const peakOf = (arr) => arr.reduce((a, v, hr) => (v > a.v ? { v, hr } : a), { v: -Infinity, hr: 0 });
  const minOf = (arr) => arr.reduce((a, v, hr) => (v < a.v ? { v, hr } : a), { v: Infinity, hr: 0 });
  const heldPeak = peakOf(latest.heldHour);
  const fosMinHour = minOf(latest.fosHour);
  const fosMaxHour = peakOf(latest.fosHour);
  const lowerSince = [...full].reverse().find((r) => r.fosMin < latest.fosMin);
  const bat = (k) => latest.batteries[k];
  const median = latest.days[Math.floor(latest.days.length / 2)];
  const worst = latest.days.at(-1);
  const dry = (r) => r.fosMonth.slice(6, 11).reduce((a, b) => a + b, 0);
  const wet = (r) => r.fosMonth.slice(0, 5).reduce((a, b) => a + b, 0);

  // Header and in short.
  $('lede').textContent = `Brazil burnt ${twh(fosTwh(eLatest))} of fossil fuel in ${named(latest.year)} while holding back ${twh(latest.heldTwh)} of wind and solar. At ${hh(heldPeak.hr)}, when ${gw(heldPeak.v)} is thrown away on an average day, fossil plants are still running at ${gw(latest.fosHour[heldPeak.hr])}.`;
  $('answer-lead').textContent = `Brazil's fossil plants run because they are contracted to, not because the grid needs them at that hour. The fleet runs almost flat round the clock, two thirds to three quarters of it under contracts that fix a minimum output whatever the weather, and the rest is ONS burning fuel in the dry season to keep water in the reservoirs. So the cheaper wind and solar is what gets switched off, and nothing now dated takes fossil to zero: the March 2026 capacity auction signed 19 GW, most of it thermal and the largest part gas, on contracts of ten years and more.`;
  $('answer-points').innerHTML = [
    `<b>The fleet barely moves.</b> Over ${named(latest.year)} fossil averaged ${gw(fosMinHour.v)} at ${hh(fosMinHour.hr)} and ${gw(fosMaxHour.v)} at ${hh(fosMaxHour.hr)}, a sag of ${gw(latest.sag)} between evening and late morning, while ONS held back ${gw(heldPeak.v)} of wind and solar at ${hh(heldPeak.hr)}. ${link(1, 'Chapter 1')}`,
    `<b>Most of it is contracted to run, the rest is saving water.</b> In February 2026 ONS listed 4.9 of its 7.7 GW of thermal output as inflexibility, output the contracts oblige it to take; in a May 2025 week it was 4.0 of 5.4 GW. The rest runs on its cost model, and in dry months out of merit order to spare the reservoirs. ${link(2, 'Chapters 2')} and ${link(3, '3')}`,
    `<b>Batteries alone would not replace it.</b> ${bat(1).gw} GW and ${bat(1).gwh} GWh of four-hour batteries would have covered the fossil above ${FOSSIL_FLOOR} GW on ${bat(1).days} days of ${named(latest.year)}; the median day needed ${n0(median.gwh)} GWh. The energy exists, held back wind and solar matched the fossil above the floor on ${latest.heldCovers} days, but it needs lines, storage and an end to must-run contracts together. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--fossil', `Fossil fuels burnt in ${last.year}`, twh(fosTwh(eLast)), `against ${twh(fosTwh(drought))} in the 2021 drought and ${twh(fosTwh(lowest))} in ${lowest.year}, the least since ${SPELLS_FROM}`],
    ['--f-gas', 'Lowest fossil hour', gw(latest.fosMin), `on ${when(latest.fosMinAt)}${lowerSince ? `, the lowest since ${lowerSince.year}` : ', the lowest in the data'}`],
    ['--f-wind', `Held back in ${named(latest.year)}`, twh(latest.heldTwh), `against ${twh(latest.aboveTwh)} of fossil output above the ${FOSSIL_FLOOR} GW floor`],
    ['--lowcarbon', `Longest spell with fossil under ${FOSSIL_LOW} GW`, fossilLowSpell ? hrs(spellH(fossilLowSpell)) : 'None', fossilLowSpell ? `from ${when(fossilLowSpell.start)}, since ${SPELLS_FROM}: the record to beat` : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${gw(latest.fosHour[heldPeak.hr])}</div><div class="sub">Fossil fuel burnt at ${hh(heldPeak.hr)} on an average day of ${named(latest.year)}, the hour ONS held back the most wind and solar: ${gw(heldPeak.v)}.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: a fossil fleet that runs flat through the midday surplus, the contracts that make it run, the dry season dispatch, who pays and what batteries could replace, and what is coming, with the record each item should move.';

  const chapters = [
    'Fossil runs flat through the midday surplus',
    'Most of it is contracted to run',
    'The rest is ONS saving water',
    'Who pays, and what batteries could replace',
    'What is coming, and which records it moves',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const hourTip = (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}`;
  const yearColors = ['--f-other', '--f-gas', '--f-hydro', '--f-nuclear'];

  // Chapter 1: by hour of day.
  const solarPeak = peakOf(latest.solarHour);
  $('take-1').textContent = `Fossil output sags only ${gw(latest.sag)} between the evening and the late morning, when solar peaks at ${gw(solarPeak.v)} and ${gw(heldPeak.v)} of wind and solar is held back.`;
  $('body-1').innerHTML = `A fossil plant that ran only when the grid was short would be off at ${hh(heldPeak.hr)}, the hour ONS throws away the most wind and solar. Brazil's is not. Averaged over ${named(latest.year)}, fossil fuels ran at ${gw(fosMinHour.v)} at ${hh(fosMinHour.hr)}, their lowest hour, and ${gw(fosMaxHour.v)} at ${hh(fosMaxHour.hr)}, their highest, with gas at ${gw(latest.gasHour[fosMinHour.hr])} and ${gw(latest.gasHour[fosMaxHour.hr])}. Over the same days ONS held back ${pct(latest.heldPct)} of what its wind and solar farms could have made, ${twh(latest.heldTwh)}, almost all of it between 07:00 and 15:00, and ${gw(heldPeak.v)} on average at ${hh(heldPeak.hr)}. The evening peak in demand is met by hydro, which ONS holds back at midday and releases from 17:00; fossil barely takes part. Nuclear is the same shape as the fossil fleet: Angra 1 and 2 made ${twh(eLatest.twh.nuclear)} in ${named(latest.year)}, a flat block of about ${gw(eLatest.twh.nuclear / 8.76)} that is never turned down for the sun. Not all of the held back power is surplus. The Northeast makes more wind and solar than its lines can carry south, and ONS's plan to 2030 expects that part, curtailment for grid limits, to fall from 7% of hours in 2027 to 4% in 2030 while the surplus part stays (${src(SOURCES.pen, 'Movimento Econômico')}). The 2021 drought shows what the fleet looks like when it is needed: fossil fuels made ${twh(fosTwh(drought))} that year and ran at ${FOSSIL_HIGH} GW or more for ${hrs(row(2021).fosHigh)}${fossilHighSpell ? `, including ${n0(spellH(fossilHighSpell))} hours in a row from ${when(fossilHighSpell.start)}` : ''}. In ${last.year} they never reached ${FOSSIL_HIGH} GW, yet they never fell below ${gw(last.fosMin)} either.`;
  $('chart-h-1').textContent = 'Fossil fuels and what was held back, by hour of day';
  $('chart-hint-1').textContent = `Average GW for each hour of the day, Brasília time, over ${named(latest.year)}.`;
  const daySeries = [
    { name: 'Fossil fuels', color: css('--fossil'), points: latest.fosHour.map((v, hr) => [hourX(hr), v]), width: 3 },
    { name: 'of which gas', color: css('--f-gas'), points: latest.gasHour.map((v, hr) => [hourX(hr), v]), width: 2 },
    { name: 'Wind and solar held back', color: css('--f-wind'), points: latest.heldHour.map((v, hr) => [hourX(hr), v]), width: 2.5 },
  ];
  lineChart($('story-chart-1'), { series: daySeries, yMin: 0, yFormat: gw, yTickFormat: (v) => `${v}`, xTicks: hourTicks, tooltip: hourTip });
  $('story-legend-1').innerHTML = legend(daySeries.map((s) => [s.name, s.color]));

  // Chapter 2: by fuel and year, and the contracts.
  const chartEnergy = energy.filter((e) => e.year === 'past365' || e.year >= 2010);
  $('take-2').textContent = `ONS listed 4.9 of its 7.7 GW of thermal output in February 2026 as inflexibility: output the plants' contracts oblige it to take, whatever the price.`;
  $('body-2').innerHTML = `Brazil's thermal plants sell under regulated contracts that pay a fixed fee for being available and a declared minimum, the inflexibility, that ONS must dispatch whether or not it is the cheapest power on the system. The operator's monthly programme spells it out: in February 2026 thermal output was 7,727 MW on average, about 4,900 MW of it inflexibility and 2,800 MW dispatched on cost, and in the Southeast nearly all of the 3,100 MW was inflexibility (${src(SOURCES.pmo2026, 'Cenário Energia')}). In the week of 10 to 16 May 2025 it was 5,433 MW, of which 3,989 MW was inflexibility (${src(SOURCES.pmo, 'ONS PMO, May 2025')}). The data shows the shape. "Other thermal", plants ONS lists as multi-fuel or burning industrial waste gases, made ${twh(eLast.twh.other)} in ${last.year}, ${twh(en(2020).twh.other)} in 2020, and its lowest hour of the year has not been under ${gw(Math.min(...full.filter((r) => r.year >= 2021).map((r) => r.otherMin)))} since 2021; it runs at about 2 GW day and night. Gas made ${twh(eLast.twh.gas)} in ${last.year} and ${twh(eLatest.twh.gas)} in ${named(latest.year)}, up from ${twh(en(2023).twh.gas)} in 2023, and never fell below ${gw(latest.gasMin)} in ${named(latest.year)}. Coal made ${twh(eLast.twh.coal)}. The contracts keep coming: the law that privatised Eletrobras in 2021 ordered 8 GW of gas plants to be contracted in regions without pipelines, at 70% inflexibility for 15 years, at about R$440 a megawatt hour against R$175 for solar in the auction before it (${src(SOURCES.jabutis, 'Coalizão Energia Limpa')}). Only in July 2025 did the ministry let plants offer to reduce their inflexibility when renewables exceed demand, and ONS published the routine in September 2025 (${src(SOURCES.inflex, 'Cenário Energia')}).`;
  $('chart-h-2').textContent = 'Fossil fuels by fuel, each year';
  $('chart-hint-2').textContent = 'Gas, coal, oil and diesel, and other thermal plants, in TWh. The last bar is the latest 365 days.';
  const fuelStacks = [
    ['gas', 'Gas', '--f-gas'],
    ['coal', 'Coal', '--f-coal'],
    ['oil', 'Oil and diesel', '--f-diesel'],
    ['other', 'Other thermal', '--f-other'],
  ].map(([k, name, c]) => ({ name, color: css(c), values: chartEnergy.map((e) => e.twh[k] || 0) }));
  barChart($('story-chart-2'), {
    cats: chartEnergy.map((e) => label(e.year)),
    stacks: fuelStacks,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => chartEnergy[ci].year === 2021,
    tooltip: (ci) => `<strong>${title(chartEnergy[ci].year)}</strong><div>Fossil fuels: <b>${twh(fosTwh(chartEnergy[ci]))}</b></div>${[...fuelStacks].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${twh(s.values[ci])}</b></div>`).join('')}`,
  });
  $('story-legend-2').innerHTML = legend([...fuelStacks].reverse().map((s) => [s.name, s.color]));

  // Chapter 3: by month, and the reservoirs.
  const hyd21 = HYDROLOGY[2021];
  const hyd25 = rows.some((r) => r.year === 2025) ? HYDROLOGY[2025] : null;
  const r25 = row(2025);
  const dryPeak = peakOf(last.fosMonth);
  $('take-3').textContent = `Fossil output in ${last.year} was ${twh(dryPeak.v)} in ${longMonths[dryPeak.hr]} against ${twh(Math.min(...last.fosMonth))} in ${longMonths[minOf(last.fosMonth).hr]}: the part above the contracts is ONS burning fuel to keep water behind the dams.`;
  $('body-3').innerHTML = `Brazil's grid has always feared drought, and the rules let ONS run thermal plants out of merit order when the reservoirs look thin. In 2021, the worst drought in about 90 years, the rivers brought ${hyd21.inflowPct}% of their long-term average, the reservoirs started the year ${hyd21.storeStart}% full (${src(SOURCES.onsData, 'ONS')}), and fossil fuels made ${twh(fosTwh(drought))}, ${twh(dry(row(2021)))} of it from July to November. ${hyd25 ? `2025 was nearly as dry, with ${hyd25.inflowPct}% of normal inflow, but the reservoirs started it ${hyd25.storeStart}% full and never fell below ${hyd25.storeMin}%, so fossil made ${twh(fosTwh(en(2025)))}: ${twh(wet(r25))} from January to May and ${twh(dry(r25))} from July to November. ` : ''}The dry season still brings the plants on. In May 2025 the CMSE, the ministry's monitoring committee, brought forward about 2.3 GW of plants from the 2021 capacity auction from July 2026 to August 2025, after the South's reservoirs fell to 40%, and in October 2024 it had done the same with the 550 MW Termopernambuco (${src(SOURCES.cmse2025, 'Canal Solar')}). The 2025-26 wet season brought the plants on early: with inflows at 88% of normal in the Southeast and 52% in the South, thermal output averaged 7.7 GW in February 2026 and 7.8 GW in March, falling to 5.4 GW by May once the South's rivers recovered, by which point ONS said almost all of what was left was contractual inflexibility (${src(SOURCES.pmoMay2026, 'Cenário Energia')}). Angra 2 was also off for a 50-day refuelling from 16 January 2026 (${src(SOURCES.angra2, 'Canal Solar')}). Water is the reason fossil runs in the dry season, and water is also what gets spilled: in 2025 turbinable water that could have made ${twh(hyd25?.spillTwh ?? hyd21.spillTwh)} was spilled, most of it at four northern run-of-river plants with little storage (${src(SOURCES.onsData, 'ONS')}). In ${named(latest.year)} the fossil fleet made ${twh(fosTwh(eLatest))}, ${twh(latest.aboveTwh)} of it above the ${FOSSIL_FLOOR} GW floor.`;
  $('chart-h-3').textContent = 'Fossil fuels by month';
  $('chart-hint-3').textContent = 'Fossil generation in each calendar month, in TWh. The dry season runs from about May to November.';
  const monthYears = [2021, 2024, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const monthX = (m) => Date.UTC(2001, m, 15);
  const monthLines = monthYears.map((y, k) => ({ name: title(y), color: css(yearColors[k]), points: row(y).fosMonth.map((v, m) => [monthX(m), v]), width: y === 'past365' ? 3 : 2 }));
  monthLines.forEach((s) => { s.markers = s.points; });
  lineChart($('story-chart-3'), {
    series: monthLines,
    yMin: 0,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    xTicks: monthNames.map((m, k) => ({ t: monthX(k), label: m })),
    tooltip: (t, vals) => `<strong>${monthNames[new Date(t).getUTCMonth()]}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? twh(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-3').innerHTML = legend(monthLines.map((s) => [s.name, s.color]));

  // Chapter 4: the economics, and battery sizing.
  $('take-4').textContent = `Consumers pay the plants a fixed fee to exist and their fuel when ONS calls them; the wind and solar held back is paid nothing. ${bat(1).gw} GW and ${bat(1).gwh} GWh of batteries would have covered ${bat(1).days} days of ${named(latest.year)}.`;
  $('body-4').innerHTML = `Brazil has no market in which plants bid hour by hour. ONS runs a cost model and dispatches each thermal plant at its declared variable cost, the CVU, which ANEEL approves; the spot price, the PLD, comes out of the same model and is capped. For 2026 ANEEL set it between R$57.31 and R$785.27 a megawatt hour, with an hourly ceiling of R$1,611.04; on 29 December 2025 it averaged R$199.51 in the trough from 06:00 to 15:00 and reached R$1,102.02 at 19:00 (${src(SOURCES.pld, 'CCEE')}). The costliest LNG plants sit far above it: ANEEL set Porto Sergipe I (1.6 GW) at R$968.27 and Linhares at R$1,251.82 a megawatt hour for late 2025 (${src(SOURCES.cvu, 'Cenário Energia')}). Those plants run only when ONS orders them, and the order is paid by all consumers as a system charge, not by the price. The fixed part is bigger. The first capacity reserve auction, in December 2021, contracted 4.6 GW of thermal plant for R$57.3bn over 15 years, from July 2026 (${src(SOURCES.lrcap2021, 'Poder360')}); the fourth, on 18 March 2026, contracted 18,977 MW, 100 plants, at an average R$2.33m per megawatt-year, R$515.7bn over the contracts (${src(SOURCES.lrcap2026, 'CCEE')}). Coal gets a further R$1bn a year through the CDE fund until 2027 (${src(SOURCES.coal, 'Agência Pública')}). The wind and solar farms, by contrast, are paid for what they generate, so the ${twh(latest.heldTwh)} held back in ${named(latest.year)} was lost income, which ONS's plan puts at about R$6bn in 2025 (${src(SOURCES.pen, 'Movimento Econômico')}). An inflexible contract cannot be turned down and a curtailed wind farm costs the operator nothing, so the wind farm goes first. What would replace the rest? Take the ${FOSSIL_FLOOR} GW floor as given. The median day of ${named(latest.year)} had ${n0(median.gwh)} GWh of fossil above it, peaking at ${gw(median.peak)}; the worst had ${n0(worst.gwh)} GWh. Against those days, ${latest.batteries.map((b, i) => (i ? `${i === latest.batteries.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh ${b.days}` : `${b.gw} GW and ${b.gwh} GWh of batteries would have covered ${b.days} days`)).join(', ')}, if they could charge; the wind and solar held back the same day would have filled the largest on only ${bat(3).charged} of its ${bat(3).days}. Over the year the energy was there, ${twh(latest.heldTwh)} held back against ${twh(latest.aboveTwh)} above the floor, and on ${latest.heldCovers} days the held back power matched that day's fossil above the floor. But fossil in Brazil is flat through the day and high for months, not a few evening hours, so four-hour batteries cut the midday sag and little else. Moving the surplus needs lines out of the Northeast, storage, and contracts that let the plants stop.`;
  $('chart-h-4').textContent = `Each day of ${named(latest.year)}, by the fossil a battery would have had to replace`;
  $('chart-hint-4').textContent = `Each day's fossil above ${FOSSIL_FLOOR} GW, in GWh, sorted from smallest to largest. The lines mark what ${BATTERIES.map((b) => b[1]).join(', ')} GWh of batteries could supply; days below a line are covered, if the batteries could charge.`;
  const dayX = (k) => k * 864e5;
  const sorted = [{ name: 'Fossil above the floor', color: css('--fossil'), points: latest.days.map((x, k) => [dayX(k), x.gwh]), width: 2.5 }];
  lineChart($('story-chart-4'), {
    series: sorted,
    yMin: 0,
    yFormat: (v) => `${n0(v)} GWh`,
    yTickFormat: (v) => n0(v),
    xTicks: [0, 60, 120, 180, 240, 300, 360].filter((k) => k < latest.days.length).map((k) => ({ t: dayX(k), label: `${k}` })),
    refLines: latest.batteries.map((b) => ({ value: b.gwh, color: css('--ink-3') })),
    tooltip: (t) => {
      const k = Math.round(t / 864e5);
      const x = latest.days[k];
      return x ? `<strong>Day ${k + 1} of ${latest.days.length}</strong><div>Fossil above ${FOSSIL_FLOOR} GW: <b>${n0(x.gwh)} GWh</b></div><div>Peak fossil: <b>${gw(x.peak)}</b></div><div>Held back that day: <b>${n0(x.held)} GWh</b></div><div>Month: <b>${monthNames[x.month - 1]}</b></div>` : '';
    },
  });
  $('story-legend-4').innerHTML = `${legend(sorted.map((s) => [s.name, s.color]))}<span>Lines: ${latest.batteries.map((b) => `${b.gwh} GWh`).join(', ')}</span>`;

  // Chapter 5: what's coming.
  const chartRows = rows.filter((r) => r.year === 'past365' || r.year >= 2010);
  $('take-5').textContent = `Batteries are auctioned in December 2026 and a 5 GW line from the Northeast opens in March 2028, but 19 GW of thermal plant was signed in March 2026 for ten to fifteen years.`;
  $('body-5').innerHTML = `The dated items are listed below, each with the record it should move. The next years add fossil plant before they take any away: the 2021 auction's 4.6 GW was due by July 2026, some of it brought forward to August 2025 (${src(SOURCES.cmse2025, 'Canal Solar')}), and the March 2026 auction's 19 GW, 86% thermal with gas the largest part, comes on over the years to 2031 (${src(SOURCES.lrcap2026news, 'eixos')}). Against that, the first battery auctions are set for 2 and 4 December 2026, four-hour batteries with supply from 1 August 2028 (${src(SOURCES.batteries, 'ANEEL draft notices')}), and from 2027 batteries and pumped hydro may compete with thermal plants in the yearly capacity auctions (${src(SOURCES.calendar, 'Agência iNFRA')}). The 5 GW Graça Aranha to Silvânia line is now due in March 2028 (${src(SOURCES.hvdc, 'Canal Solar')}). Coal's subsidy ends in 2027, though Jorge Lacerda has support to 2040 (${src(SOURCES.coal, 'Agência Pública')}) and Pecém II was recontracted from 2031 (${src(SOURCES.pecem, 'Cenário Energia')}). Angra 3 would add 1,405 MW of flat nuclear output if the government decides to finish it, which the minister promised for 2026 (${src(SOURCES.angra3, 'Poder360')}; capacity from ${src(SOURCES.angra, 'Wikipedia')}). Hours with fossil under ${FOSSIL_LOW} GW went from ${hrs(row(2018).fosLow)} in 2018 to ${hrs(last.fosLow)} in ${last.year} and ${hrs(latest.fosLow)} in ${named(latest.year)}: that is the count to watch, with the lowest hour, ${gw(latest.fosMin)} on ${when(latest.fosMinAt)}${fossilFloorSpell ? `, and the longest spell under ${FOSSIL_FLOOR} GW, ${hrs(spellH(fossilFloorSpell))} from ${when(fossilFloorSpell.start)}` : ''}.`;
  $('chart-h-5').textContent = `Hours a year with fossil fuels under ${FOSSIL_LOW} GW`;
  $('chart-hint-5').textContent = `Hours each year with gas, coal, oil and other thermal plants together under ${FOSSIL_LOW} GW. The lowest hour is in the tooltip. The last bar is the latest 365 days.`;
  const ch5 = [{ name: `Fossil under ${FOSSIL_LOW} GW`, color: css('--lowcarbon'), values: chartRows.map((r) => r.fosLow) }];
  barChart($('story-chart-5'), {
    cats: chartRows.map((r) => label(r.year)),
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => chartRows[ci].year === 2021,
    tooltip: (ci) => `<strong>${title(chartRows[ci].year)}</strong><div>Hours under ${FOSSIL_LOW} GW: <b>${n0(chartRows[ci].fosLow)}</b></div><div>Lowest hour: <b>${gw(chartRows[ci].fosMin)}</b></div><div>Hours at ${FOSSIL_HIGH} GW or more: <b>${n0(chartRows[ci].fosHigh)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((s) => [s.name, s.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--fossil)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
