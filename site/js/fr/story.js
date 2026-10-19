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
  }), (r, i) => {
    const nu = nuclear[i];
    if (Number.isNaN(nu)) return;
    const h = hour[i];
    // The noon dip, one day at a time.
    if (r.day?.n !== day[i]) {
      if (r.day) r.dips.push(r.day);
      r.day = { n: day[i], night: 0, nightN: 0, noon: 0, noonN: 0 };
    }
    if (h >= NIGHT[0] && h <= NIGHT[1]) { r.day.night += nu; r.day.nightN++; }
    if (h >= NOON[0] && h <= NOON[1]) { r.day.noon += nu; r.day.noonN++; }
    r.nucTwh += (nu * slotH) / 1000;
    r.solTwh += (solar[i] * slotH) / 1000;
    r.gasTwh += ((data.columns.gas[i] || 0) * slotH) / 1e6;
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
  h12026: 'https://assets.rte-france.com/prod/public/2026-07/2026-07-16-bilan-semestre1-synthese.pdf',
  kpler: 'https://www.kpler.com/blog/nuclear-modulation-insights-volumes-and-units-behaviours',
  flamanville: 'https://www.enerdata.net/publications/daily-energy-news/165-gw-flamanville-reactor-achieves-full-output-first-time-france.html',
};

export function renderStory(data, end, figs) {
  const { rows, nucLowSpell, exportSpell, fossil2Spell, fossilHalfSpell, solarMax } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? first;
  const crisis = full.reduce((a, r) => (r.nucTwh < a.nucTwh ? r : a), first);
  const before = row(2019);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (s) => ((s.end - s.start) * step) / 60;
  const lowest = crisis.nucMinAt >= 0 ? at(crisis.nucMinAt) : null;
  const atTime = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: fr.timeZone });

  // Header and in short.
  $('lede').textContent = `In ${crisis.year} France could not keep its reactors running. In ${last.year} it turned them down at lunchtime on ${last.dipDays} days, because the sun had taken their place.`;
  $('answer-lead').textContent = `France turns its reactors down on sunny days because it has run out of other things to do with the power. It now makes more low-carbon electricity than it can use: fossil plants sit under 1 GW for about ${n0(Math.round(last.fosU1 / 100) * 100)} hours a year, net exports are the highest in the country's history, and the neighbours are full of solar at midday too. What is left is to cut nuclear, which EDF did for 33 TWh in 2025, more than double the 15 TWh of 2019.`;
  $('answer-points').innerHTML = [
    `<b>The reactors now dip at noon.</b> In ${first.year} nuclear ran ${gw(-first.dip)} higher at midday than at night; in ${last.year} it ran ${gw(last.dip)} lower, and in April to June of the latest 365 days the dip averaged ${gw(latest.springDip)}. Days with a noon dip over ${DIP_DAY} GW went from ${first.dipDays || 'none'} in ${first.year} to ${last.dipDays} in ${last.year}. ${link(2, 'Chapter 2')}`,
    `<b>Exports are already at the limit.</b> Hours with net exports of ${EXPORT_HIGH} GW or more went from ${n0(first.expHigh)} in ${first.year} to ${n0(last.expHigh)} in ${last.year}, and gross exports from ${twh(first.expTwh)} to ${twh(last.expTwh)}. ${link(3, 'Chapter 3')}`,
    `<b>There is almost no fossil fuel left to cut.</b> Fossil plants ran under 1 GW for ${hrs(last.fosU1)} in ${last.year}, against ${hrs(crisis.fosU1)} in ${crisis.year}, and made ${twh(last.fosTwh)}, against ${twh(first.fosTwh)} in ${first.year}. ${link(1, 'Chapters 1')} and ${link(4, '4')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-nuclear', 'Lowest nuclear output', gw(crisis.nucMin), lowest ? `on ${fmtDate(lowest)}, with 12 reactors shut for checks that summer` : ''],
    ['--f-imports', `Hours exporting ${EXPORT_HIGH} GW or more`, n0(last.expHigh), `in ${last.year}, against ${n0(first.expHigh)} in ${first.year}`],
    ['--fossil', 'Hours with fossil under 1 GW', n0(last.fosU1), `in ${last.year}, against ${n0(crisis.fosU1)} in ${crisis.year}`],
    ['--f-solar', `Price at ${hh(13)} and ${hh(20)}`, `${eur(last.byHour[13])} vs ${eur(last.byHour[20])}`, `per MWh on average in ${last.year}; in ${before.year} ${eur(before.byHour[13])} and ${eur(before.byHour[20])}`],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${last.dipDays} days</div><div class="sub">Days in ${last.year} when nuclear output at midday (${hh(NOON[0])} to ${hh(NOON[1] + 1)}) was more than ${DIP_DAY} GW below the night (${hh(NIGHT[0])} to ${hh(NIGHT[1] + 1)}). In ${first.year} there were ${first.dipDays || 'none'}; in the latest 365 days there were ${latest.dipDays}.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: the year the reactors failed, the noon dip, exports at the limit, fossil fuel running out of hours, and the price gap that now pays for the evening.';

  const chapters = [
    'The year the reactors failed',
    'The reactors now dip at noon',
    'Exports are already at the limit',
    'Fossil fuel is running out of hours',
    'The evening now pays for the day',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const yearMs = (y) => (y === 'past365' ? at(end) : Date.UTC(y, 6, 1));

  // Chapter 1: the 2022 collapse and the recovery.
  $('take-1').textContent = `In ${crisis.year} nuclear made ${twh(crisis.nucTwh)}, the least in the data, and France imported power in ${Math.round((crisis.impHours / 8760) * 100)}% of hours.`;
  $('body-1').innerHTML = `France's reactors made ${twh(first.nucTwh)} in ${first.year}. In ${crisis.year} they made ${twh(crisis.nucTwh)}, the lowest since 1988 (${src(SOURCES.bilan2022, 'RTE')}). Twelve reactors were shut that summer for checks on stress corrosion, cracking found in pipes of their safety injection circuits (${src(SOURCES.corrosion, 'EDF')}), and output fell to ${gw(crisis.nucMin)}${lowest ? ` on ${fmtDate(lowest)}` : ''}, the lowest quarter hour in the data. Nuclear was under ${NUC_LOW} GW for ${hrs(crisis.nucLow)}${nucLowSpell ? `, including one spell of ${n0(spellH(nucLowSpell) / 24)} days from ${fmtDate(at(nucLowSpell.start))}` : ''}. Gas filled the gap, at ${twh(crisis.gasTwh)}, and fossil plants were under 1 GW for just ${hrs(crisis.fosU1)}. France was a net importer in ${hrs(crisis.impHours)} and of ${twh(crisis.netImpTwh)} over the year, the first time since 1980 (${src(SOURCES.bilan2022, 'RTE')}). The day-ahead price averaged ${eur(crisis.price)} a megawatt hour. By ${last.year} nuclear was back at ${twh(last.nucTwh)}, and solar had grown from ${twh(first.solTwh)} to ${twh(last.solTwh)}.`;
  $('chart-h-1').textContent = 'Nuclear\'s collapse and recovery, with solar on top';
  $('chart-hint-1').textContent = 'Nuclear and solar generation each year, in TWh. The last bar is the latest 365 days. Hours with nuclear under 30 GW are in the tooltip.';
  const ch1 = [['nucTwh', 'Nuclear', '--f-nuclear'], ['solTwh', 'Solar', '--f-solar']].map(([k, name, color]) => ({ name, color: css(color), values: rows.map((r) => r[k]) }));
  barChart($('story-chart-1'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => rows[ci].year === crisis.year,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${[...ch1].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${twh(s.values[ci])}</b></div>`).join('')}<div>Hours with nuclear under ${NUC_LOW} GW: <b>${n0(rows[ci].nucLow)}</b></div><div>Lowest quarter hour: <b>${gw(rows[ci].nucMin)}</b></div>`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((s) => [s.name, s.color]));

  // Chapter 2: nuclear by hour of day, April to June.
  const sm = solarMax;
  $('take-2').textContent = `In ${first.year} nuclear ran higher at noon than at night; in spring of the latest 365 days it ran ${gw(latest.springDip)} lower, and EDF cut 33 TWh in 2025 to make room.`;
  $('body-2').innerHTML = `French reactors used to follow demand: in April to June ${first.year} nuclear averaged ${gw(first.spring[3])} at ${hh(3)} and ${gw(first.spring[13])} at ${hh(13)}. In the same months of the latest 365 days it averaged ${gw(latest.spring[3])} at ${hh(3)}, ${gw(latest.spring[13])} at ${hh(13)} and ${gw(latest.spring[20])} at ${hh(20)}: a dip of ${gw(latest.springDip)} in the middle of the day. Solar peaked at ${gw(sm.solar)} at ${atTime(at(sm.i))} on ${fmtDate(at(sm.i))}, with nuclear at ${gw(sm.nuclear)} and ${gw(sm.exports)} going abroad. Days with a noon dip over ${DIP_DAY} GW went from ${first.dipDays || 'none'} in ${first.year} to ${[row(2023), row(2024), last].filter((r, k, a) => a.indexOf(r) === k).map((r) => `${r.dipDays} in ${r.year}`).join(', ')}. EDF says it modulated 33 TWh of nuclear output in 2025, against 15 TWh in 2019, that this now happens by day rather than at night or at weekends, and that the extra manoeuvring is raising maintenance costs (${src(SOURCES.modulation, 'EDF')}). The most-cycled reactor, Cattenom 2, gave up nearly 1.4 TWh in 2025 alone (${src(SOURCES.kpler, 'Kpler')}).`;
  $('chart-h-2').textContent = 'The hour-of-day shape of the French fleet';
  $('chart-hint-2').textContent = 'Average nuclear output for each hour of the day, French time, April to June, in GW. The thick line is the latest 365 days.';
  const hourX = (hr) => hr * 3600000;
  const profileYears = [first.year, crisis.year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const profileColors = ['--f-other', '--f-gas', '--f-hydro', '--f-nuclear'];
  const profile = profileYears.map((y, k) => ({ name: title(y), color: css(profileColors[k]), points: row(y).spring.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-2'), {
    series: profile,
    // Not from zero: the dip is a few GW on a 30-40 GW fleet.
    yMin: 25,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) })),
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-2').innerHTML = legend(profile.map((s) => [s.name, s.color]));

  // Chapter 3: exports.
  $('take-3').textContent = `France exported ${EXPORT_HIGH} GW or more for ${hrs(last.expHigh)} in ${last.year}, against ${hrs(first.expHigh)} in ${first.year}, and imported in only ${n0(last.impHours)}.`;
  $('body-3').innerHTML = `The first outlet for surplus power is the border. Gross exports were ${twh(first.expTwh)} in ${first.year}, ${twh(crisis.expTwh)} in ${crisis.year}, then ${twh(row(2024).expTwh)} in 2024 and ${twh(last.expTwh)} in ${last.year}. RTE puts the 2025 net balance at 92.3 TWh, a record for the second year running (${src(SOURCES.bilan2025, 'RTE')}), and the first half of 2026 set another, at 51 TWh (${src(SOURCES.h12026, 'RTE')}). The interconnectors are now full for long stretches: hours with net exports of ${EXPORT_HIGH} GW or more rose from ${n0(before.expHigh)} in ${before.year} to ${n0(row(2024).expHigh)} in 2024 and ${n0(last.expHigh)} in ${last.year}, and the biggest net export in the latest 365 days was ${gw(latest.expMax)}.${exportSpell ? ` The longest spell above 10 GW net is ${(spellH(exportSpell) / 24).toFixed(1)} days, from ${fmtDate(at(exportSpell.start))}.` : ''} France imported in ${hrs(crisis.impHours)} of ${crisis.year} and ${hrs(last.impHours)} of ${last.year}. More power cannot leave at noon, because Germany, Spain and Italy are flooded with solar at the same hour.`;
  $('chart-h-3').textContent = 'Exports back to a record, and the hours at full stretch';
  $('chart-hint-3').textContent = 'Gross exports and gross imports each year, in TWh. The last point is the latest 365 days. Hours with net exports of 15 GW or more are in the tooltip.';
  const xs = rows.map((r) => yearMs(r.year));
  const trade = [
    { name: 'Exports', color: css('--f-imports'), points: rows.map((r, k) => [xs[k], r.expTwh]), width: 2.5 },
    { name: 'Imports', color: css('--f-gas'), points: rows.map((r, k) => [xs[k], r.impTwh]), width: 2.5 },
  ];
  trade.forEach((s) => { s.markers = s.points; });
  lineChart($('story-chart-3'), {
    series: trade,
    yMin: 0,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    tooltip: (t, vals) => {
      const r = rows[xs.indexOf(t)];
      return `<strong>${title(r?.year ?? new Date(t).getUTCFullYear())}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? twh(v.value) : '—'}</b></div>`).join('')}${r ? `<div>Hours exporting ${EXPORT_HIGH} GW or more: <b>${n0(r.expHigh)}</b></div><div>Hours importing: <b>${n0(r.impHours)}</b></div>` : ''}`;
    },
  });
  $('story-legend-3').innerHTML = legend(trade.map((s) => [s.name, s.color]));

  // Chapter 4: fossil fuel hours.
  $('take-4').textContent = `Fossil plants ran under 1 GW for ${hrs(last.fosU1)} in ${last.year}${fossilHalfSpell ? `, and the longest spell under 0.5 GW is ${hrs(spellH(fossilHalfSpell))} from ${fmtDate(at(fossilHalfSpell.start))}` : ''}.`;
  $('body-4').innerHTML = `The second outlet is to switch off the gas and coal, and that is nearly done. Fossil generation fell from ${twh(first.fosTwh)} in ${first.year} and ${twh(crisis.fosTwh)} in ${crisis.year} to ${twh(last.fosTwh)} in ${last.year}. RTE calls 2025 the lowest fossil output in nearly 75 years (${src(SOURCES.bilan2025, 'RTE')}). Hours with fossil under 1 GW were ${n0(first.fosU1)} in ${first.year}, ${n0(crisis.fosU1)} in ${crisis.year}, ${n0(row(2024).fosU1)} in 2024 and ${n0(last.fosU1)} in ${last.year}; under 2 GW, ${hrs(last.fosU2)} in ${last.year}.${fossil2Spell ? ` The longest spell under 2 GW is ${hrs(spellH(fossil2Spell))} from ${fmtDate(at(fossil2Spell.start))}` : ''}${fossilHalfSpell ? `, and the longest under 0.5 GW is ${hrs(spellH(fossilHalfSpell))} from ${fmtDate(at(fossilHalfSpell.start))}.` : '.'} Nuclear and renewables made ${last.lowCarbonPct.toFixed(1)}% of generation in ${last.year}. The fossil hours that are left are winter evenings, and cutting them does nothing for a sunny noon.`;
  $('chart-h-4').textContent = 'Hours a year with fossil fuel under 1 GW';
  $('chart-hint-4').textContent = 'Hours each year with gas, coal and oil together under 1 GW, and between 1 and 2 GW. The last bar is the latest 365 days.';
  const ch4 = [
    { name: 'Under 1 GW', color: css('--lowcarbon'), values: rows.map((r) => r.fosU1) },
    { name: '1 to 2 GW', color: css('--f-gas'), values: rows.map((r) => r.fosU2 - r.fosU1) },
  ];
  barChart($('story-chart-4'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch4,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => rows[ci].year === crisis.year,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Under 1 GW: <b>${hrs(rows[ci].fosU1)}</b></div><div>Under 2 GW: <b>${hrs(rows[ci].fosU2)}</b></div><div>Fossil generation: <b>${twh(rows[ci].fosTwh)}</b></div>`,
  });
  $('story-legend-4').innerHTML = legend([...ch4].reverse().map((s) => [s.name, s.color]));

  // Chapter 5: the price by hour of day.
  $('take-5').textContent = `In ${last.year} the price averaged ${eur(last.byHour[13])} at ${hh(13)} and ${eur(last.byHour[20])} at ${hh(20)}${last.pumpTwh >= Math.max(...full.map((r) => r.pumpTwh)) ? ', and pumped storage pumped more than in any year before' : ''}.`;
  $('body-5').innerHTML = `In ${before.year} the day-ahead price averaged ${eur(before.byHour[13])} a megawatt hour at ${hh(13)} and ${eur(before.byHour[20])} at ${hh(20)}. In ${last.year} it averaged ${eur(last.byHour[13])} at ${hh(13)} and ${eur(last.byHour[20])} at ${hh(20)}, a gap of ${eur(last.byHour[20] - last.byHour[13])} on a yearly average of ${eur(last.price)}. The gap is what pays for the dip: a reactor that gives up a lunchtime megawatt hour loses little, and the pumped storage plants that fill at noon and empty in the evening pumped ${twh(last.pumpTwh)} in ${last.year}, against ${twh(first.pumpTwh)} in ${first.year}. EDF reports the same from the plant side: pumped storage ran for much longer in 2025, and gas plant starts and stops doubled (${src(SOURCES.modulation, 'EDF')}). Flamanville 3, at 1.65 GW the biggest unit in the fleet, reached full power in December 2025 (${src(SOURCES.flamanville, 'Enerdata')}), adding to the noon surplus. EDF's answer is to grow demand, through electrification, rather than cut supply (${src(SOURCES.modulation, 'EDF')}).`;
  $('chart-h-5').textContent = 'The price by hour of day';
  $('chart-hint-5').textContent = 'The average day-ahead price for each hour of the day, French time, in euros per MWh. The thick line is the latest 365 days.';
  // 2022's prices were four times today's, so it is left out to keep the shape readable.
  const priceYears = [before.year, row(2024).year, last.year, 'past365'].filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));
  const price = priceYears.map((y, k) => ({ name: title(y), color: css(profileColors[k]), points: row(y).byHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-5'), {
    series: price,
    yMin: 0,
    yFormat: (v) => eur(v),
    yTickFormat: (v) => `${v}`,
    xTicks: [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) })),
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? `${eur(v.value)}/MWh` : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-5').innerHTML = legend(price.map((s) => [s.name, s.color]));
}
