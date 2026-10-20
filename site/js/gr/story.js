// The Greece story: lignite going to zero, gas left as the last fossil fuel,
// and the solar the grid turns away at noon. The figures are worked out from
// the data by storyFigures(), which the tests also run; renderStory() draws
// the page.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import gr from '../countries/gr.js';
import { FOSSIL, RENEWABLE, GENERATION, metricSeries, byYear } from './data.js';

// Lignite below this (GW) counts as off: a unit on hot standby or the last
// trickle of a shutdown reads a few MW.
export const LIGNITE_OFF = 0.05;
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
  }
  return { hour, month, day };
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
  const { hour, month, day } = localClock(d);
  const twh = (mw) => (mw * slotH) / 1e6;

  const rows = byYear(d, () => ({
    ligTwh: 0, gasTwh: 0, oilTwh: 0, fosTwh: 0, solTwh: 0, windTwh: 0, renTwh: 0, genTwh: 0, demTwh: 0,
    expTwh: 0, impTwh: 0, impHours: 0, expHours: 0,
    ligMax: 0, ligOff: 0, ligDays: new Set(), ligMonth: zeros(12),
    gasMin: Infinity, gasMax: 0, gasMonth: zeros(12), gasHour: zeros(24), gasHourN: zeros(24), gasLow: 0,
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
  for (let i = 0; i < end; i++) if (solar[i] > (solarMax < 0 ? -Infinity : solar[solarMax])) solarMax = i;
  return {
    rows,
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
const gwf = (v) => `${v.toFixed(v < 1 ? 2 : 1)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const eur = (v) => `€${Math.round(v)}`;
const twhf = (v) => `${v.toFixed(1)} TWh`;
const pc = (v) => `${Math.round(v * 100)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

export function renderStory(data, end, figs) {
  const { rows } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const spellH = (sp) => ((sp.end - sp.start) * step) / 60;
  const cats = rows.map((r) => label(r.year));
  const peakLig = full.reduce((a, r) => (r.ligTwh > a.ligTwh ? r : a), first);

  // Header and in short: what the data shows, before the story is written.
  $('lede').textContent = `Greece made ${twhf(peakLig.ligTwh)} of power from lignite in ${peakLig.year} and ${twhf(last.ligTwh)} in ${last.year}. Gas made ${twhf(last.gasTwh)}, ${pc(last.gasFossilShare)} of the fossil power.`;
  $('answer-lead').textContent = `In ${last.year} renewables made ${Math.round(last.renPct)}% of Greek generation, lignite ${Math.round(last.ligPct)}% and gas ${Math.round(last.gasPct)}%. The day-ahead price was zero or below for ${hrs(last.zeroHours)}.`;
  $('answer-points').innerHTML = [
    `<b>Lignite.</b> ${twhf(first.ligTwh)} in ${first.year}, ${twhf(last.ligTwh)} in ${last.year}; off for ${hrs(last.ligOff)} of ${last.year}${figs.ligOffSpell ? `, and the longest spell off is ${hrs(spellH(figs.ligOffSpell))}, from ${fmtDate(at(figs.ligOffSpell.start))}` : ''}.`,
    `<b>Gas.</b> Never below ${gwf(last.gasMin)} in ${last.year}; ${pc(last.gasEveningShare)} of it ran from ${hh(EVENING[0])} to ${hh(EVENING[1] + 1)}.`,
    `<b>Solar and prices.</b> Solar peaked at ${gwf(latest.solMax)} in the latest 365 days. The price averaged ${eur(last.priceHour[13])} at ${hh(13)} and ${eur(last.priceHour[20])} at ${hh(20)} in ${last.year}.`,
  ].map((x) => `<li>${x}</li>`).join('');

  const facts = [
    ['--f-lignite', `Lignite in ${last.year}`, twhf(last.ligTwh), `against ${twhf(peakLig.ligTwh)} in ${peakLig.year}`],
    ['--f-gas', `Lowest gas in ${last.year}`, gwf(last.gasMin), `${gwf(latest.gasMin)} in the latest 365 days`],
    ['--f-solar', `Hours at a zero or negative price, ${last.year}`, n0(last.zeroHours), `${n0(latest.zeroHours)} in the latest 365 days`],
    ['--fossil', 'Longest spell with fossil under 1 GW', figs.fossil1Spell ? hrs(spellH(figs.fossil1Spell)) : 'None yet', figs.fossil1Spell ? `from ${fmtDate(at(figs.fossil1Spell.start))}` : ''],
  ];
  $('facts').innerHTML = `<ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = '';

  const chapters = ['Lignite, year by year', 'Gas by hour of day', 'Gas by month', 'Zero and negative prices', 'Hours with gas under 1 GW'];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    $(`take-${k + 1}`).textContent = '';
    $(`body-${k + 1}`).textContent = '';
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const yearColors = ['--f-other', '--f-gas', '--f-hydro', '--f-lignite'];
  const row = (y) => rows.find((r) => r.year === y);
  const pick = (ys) => ys.filter((y, k, a) => a.indexOf(y) === k && row(y));

  // 1: fossil generation by year.
  $('chart-h-1').textContent = 'Fossil generation by year';
  $('chart-hint-1').textContent = 'TWh a year. The last bar is the latest 365 days.';
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
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twhf(sr.values[ci])}</b></div>`).join('')}<div>Lignite off: <b>${hrs(rows[ci].ligOff)}</b></div>`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // 2: gas by hour.
  $('chart-h-2').textContent = 'Gas by hour of day';
  $('chart-hint-2').textContent = 'Average gas output for each hour, Greek time, in GW; the average price at each hour is in the tooltip.';
  const gasLines = pick([first.year, 2022, last.year, 'past365']).map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).gasHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-2'), {
    series: gasLines,
    yMin: 0,
    yFormat: gwf,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gwf(v.value) : '—'}</b>${Number.isFinite(row(v.series.year).priceHour[hr]) ? ` at ${eur(row(v.series.year).priceHour[hr])}/MWh` : ''}</div>`).join('')}`;
    },
  });
  $('story-legend-2').innerHTML = legend(gasLines.map((sr) => [sr.name, sr.color]));

  // 3: gas by month.
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthX = (m) => Date.UTC(2001, m, 15);
  $('chart-h-3').textContent = 'Gas by month';
  $('chart-hint-3').textContent = 'Gas generation in each calendar month, in TWh.';
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

  // 4: zero and negative prices.
  $('chart-h-4').textContent = 'Hours a year at a zero or negative day-ahead price';
  $('chart-hint-4').textContent = 'Hours each year. Average gas, solar and net exports in those hours are in the tooltip.';
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

  // 5: hours with gas under the floor.
  $('chart-h-5').textContent = `Hours a year with gas under ${GAS_FLOOR} GW`;
  $('chart-hint-5').textContent = 'The lowest quarter hour of gas is in the tooltip.';
  const ch5 = [{ name: `Gas under ${GAS_FLOOR} GW`, color: css('--lowcarbon'), values: rows.map((r) => r.gasLow) }];
  barChart($('story-chart-5'), {
    cats,
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Hours under ${GAS_FLOOR} GW: <b>${n0(rows[ci].gasLow)}</b></div><div>Lowest gas: <b>${gwf(rows[ci].gasMin)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((sr) => [sr.name, sr.color]));
  $('coming').innerHTML = '';
}
