// The Bulgaria story: lignite from the Maritsa East complex is the last
// fossil fuel that matters on the grid; batteries, new since 2025, are taking
// its evening hours, while Kozloduy's two reactors and the exports set the
// rest. The figures are worked out from the data by storyFigures(), which the
// tests also run; renderStory() draws the charts, and the words come from
// ./text.js.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import bg from '../countries/bg.js';
import { FOSSIL, metricSeries, byYear } from './data.js';
import { TEXT, CHAPTERS } from './text.js';

// Local hours of the evening peak the story follows: 18:00 to 22:00.
export const EVENING = [18, 21];
// Local hours of the solar middle of the day: 11:00 to 15:00.
export const MIDDAY = [11, 14];
// Fossil levels the story counts hours under, in GW.
export const FOSSIL_LOW = [1.5, 1];
// A battery output that counts as the fleet really working, in GW.
export const BATTERY_ON = 0.1;

/**
 * Local hour, month and day number for every slot. The Sofia offset is looked
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
      offset = tzOffsetMs(d * 864e5 + 432e5, bg.timeZone);
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
const hours24 = () => new Float64Array(24);
const inHours = (h, [a, b]) => h >= a && h <= b;

/**
 * Every number the story uses, in GW, TWh and hours. Rows run by Bulgarian
 * calendar year, complete years only, then 'past365' for the latest 365 days.
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const step = stepOf(data);
  const slotH = step / 60;
  const c = data.columns;
  const zero = new Float64Array(end);
  const col = (k) => c[k] ?? zero;
  const lig = col('lignite');
  const nuc = col('nuclear');
  const sol = col('solar');
  const bat = col('battery');
  const chg = col('battery_charge');
  const imp = col('imports');
  const exp = col('exports');
  const dem = col('demand');
  const price = c.price ?? new Float64Array(end).fill(NaN);
  const fossil = metricSeries(d, FOSSIL);
  const { hour, month } = localClock(d);
  const v0 = (x) => (Number.isFinite(x) ? x : 0);

  const rows = byYear(d, () => ({
    ligTwh: 0, gasTwh: 0, coalTwh: 0, fosTwh: 0, nucTwh: 0, solTwh: 0, batTwh: 0, chgTwh: 0, expTwh: 0, impTwh: 0, demTwh: 0,
    ligMonth: new Float64Array(12), ligMin: Infinity, ligMinAt: -1, ligMax: 0,
    ligExporting: 0, ligImporting: 0, ligCovered: 0, hours: 0,
    ligHour: hours24(), batHour: hours24(), chgHour: hours24(), solHour: hours24(), netExpHour: hours24(), demHour: hours24(), hourN: hours24(),
    priceHour: hours24(), priceHourN: hours24(), priceSum: 0, priceN: 0,
    batMax: 0, batMaxAt: -1, chgMax: 0, batHours: 0,
    fosLow: FOSSIL_LOW.map(() => 0), nucMin: Infinity, nucLowHours: 0,
    eve: { lig: 0, bat: 0, dem: 0, net: 0, price: 0, priceN: 0, n: 0 },
    mid: { lig: 0, chg: 0, sol: 0, net: 0, price: 0, priceN: 0, n: 0 },
  }), (r, i) => {
    const l = lig[i];
    if (Number.isNaN(l)) return;
    const h = hour[i];
    const g = l / 1000;
    const net = v0(imp[i]) + v0(exp[i]);
    const b = v0(bat[i]) / 1000;
    const ch = Math.abs(v0(chg[i])) / 1000;
    const s = v0(sol[i]) / 1000;
    const dm = dem[i] / 1000;
    r.hours += slotH;
    r.ligTwh += (g * slotH) / 1000;
    r.gasTwh += (v0(c.gas?.[i]) / 1000 * slotH) / 1000;
    r.coalTwh += (v0(c.coal?.[i]) / 1000 * slotH) / 1000;
    r.fosTwh += (v0(fossil[i]) * slotH) / 1000;
    r.nucTwh += (v0(nuc[i]) / 1000 * slotH) / 1000;
    r.solTwh += (s * slotH) / 1000;
    r.batTwh += (b * slotH) / 1000;
    r.chgTwh += (ch * slotH) / 1000;
    r.expTwh += (Math.max(0, -net) / 1000 * slotH) / 1000;
    r.impTwh += (Math.max(0, net) / 1000 * slotH) / 1000;
    if (Number.isFinite(dm)) r.demTwh += (dm * slotH) / 1000;
    r.ligMonth[month[i] - 1] += (g * slotH) / 1000;
    if (g < r.ligMin) { r.ligMin = g; r.ligMinAt = i; }
    if (g > r.ligMax) r.ligMax = g;
    if (net < 0) r.ligExporting += (g * slotH) / 1000;
    if (net > 0) r.ligImporting += (g * slotH) / 1000;
    // Hours when the net exports were as big as all the lignite: on a net
    // view, every lignite megawatt went abroad.
    if (-net >= l) r.ligCovered += slotH;
    r.ligHour[h] += g;
    r.batHour[h] += b;
    r.chgHour[h] += ch;
    r.solHour[h] += s;
    r.netExpHour[h] += -net / 1000;
    r.demHour[h] += Number.isFinite(dm) ? dm : 0;
    r.hourN[h]++;
    if (b > r.batMax) { r.batMax = b; r.batMaxAt = i; }
    if (ch > r.chgMax) r.chgMax = ch;
    if (b >= BATTERY_ON) r.batHours += slotH;
    FOSSIL_LOW.forEach((lv, k) => { if (fossil[i] < lv) r.fosLow[k] += slotH; });
    const n = nuc[i] / 1000;
    if (n < r.nucMin) r.nucMin = n;
    if (n < 1.5) r.nucLowHours += slotH;
    const p = price[i];
    const hasP = Number.isFinite(p);
    if (hasP) { r.priceSum += p; r.priceN++; r.priceHour[h] += p; r.priceHourN[h]++; }
    if (inHours(h, EVENING)) {
      r.eve.lig += g; r.eve.bat += b; r.eve.dem += Number.isFinite(dm) ? dm : 0; r.eve.net += -net / 1000; r.eve.n++;
      if (hasP) { r.eve.price += p; r.eve.priceN++; }
    }
    if (inHours(h, MIDDAY)) {
      r.mid.lig += g; r.mid.chg += ch; r.mid.sol += s; r.mid.net += -net / 1000; r.mid.n++;
      if (hasP) { r.mid.price += p; r.mid.priceN++; }
    }
  }).map((r) => {
    const per = (arr) => [...arr].map((v, k) => mean(v, r.hourN[k]));
    return {
      year: r.year,
      hours: r.hours,
      ligTwh: r.ligTwh,
      gasTwh: r.gasTwh,
      coalTwh: r.coalTwh,
      fosTwh: r.fosTwh,
      nucTwh: r.nucTwh,
      solTwh: r.solTwh,
      batTwh: r.batTwh,
      chgTwh: r.chgTwh,
      expTwh: r.expTwh,
      impTwh: r.impTwh,
      netExpTwh: r.expTwh - r.impTwh,
      demTwh: r.demTwh,
      ligMonth: [...r.ligMonth],
      ligMin: r.ligMin,
      ligMinAt: r.ligMinAt,
      ligMax: r.ligMax,
      ligAvg: mean(r.ligTwh * 1000, r.hours),
      ligExportingShare: r.ligExporting / r.ligTwh,
      ligImporting: r.ligImporting,
      ligCovered: r.ligCovered,
      ligHour: per(r.ligHour),
      batHour: per(r.batHour),
      chgHour: per(r.chgHour),
      solHour: per(r.solHour),
      netExpHour: per(r.netExpHour),
      demHour: per(r.demHour),
      priceHour: [...r.priceHour].map((v, k) => mean(v, r.priceHourN[k])),
      price: mean(r.priceSum, r.priceN),
      batMax: r.batMax,
      batMaxAt: r.batMaxAt,
      chgMax: r.chgMax,
      batHours: r.batHours,
      fosLow: r.fosLow,
      nucMin: r.nucMin,
      nucLowHours: r.nucLowHours,
      // Evening, 18:00 to 22:00, average GW and EUR/MWh.
      eve: { lig: mean(r.eve.lig, r.eve.n), bat: mean(r.eve.bat, r.eve.n), dem: mean(r.eve.dem, r.eve.n), net: mean(r.eve.net, r.eve.n), price: mean(r.eve.price, r.eve.priceN) },
      // Midday, 11:00 to 15:00.
      mid: { lig: mean(r.mid.lig, r.mid.n), chg: mean(r.mid.chg, r.mid.n), sol: mean(r.mid.sol, r.mid.n), net: mean(r.mid.net, r.mid.n), price: mean(r.mid.price, r.mid.priceN) },
    };
  });

  // The battery fleet's first reading, and record spells over the whole record.
  let batFirst = -1;
  for (let i = 0; i < end; i++) if (bat[i] > 0 || chg[i] < 0) { batFirst = i; break; }
  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: bg.timeZone };
  const ligGw = new Float64Array(end);
  const batGw = new Float64Array(end);
  for (let i = 0; i < end; i++) { ligGw[i] = lig[i] / 1000; batGw[i] = (bat[i] ?? NaN) / 1000; }
  let ligLow = 0;
  for (let i = 1; i < end; i++) if (ligGw[i] < ligGw[ligLow] || Number.isNaN(ligGw[ligLow])) ligLow = i;
  return {
    rows,
    batFirst,
    ligLow: { i: ligLow, gw: ligGw[ligLow] },
    fossil15Spell: spellOf(summarise(fossil, 1.5, 'below', opts)),
    fossil1Spell: spellOf(summarise(fossil, 1, 'below', opts)),
    lignite1Spell: spellOf(summarise(ligGw, 1, 'below', opts)),
    battery1Spell: spellOf(summarise(batGw, 1, 'above', opts)),
  };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(2)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const eur = (v) => (Number.isFinite(v) ? `€${Math.round(v)}` : '—');
const twh = (v) => `${v.toFixed(1)} TWh`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const hh = (h) => `${String(h).padStart(2, '0')}:00`;

/** Sets a text slot, or hides it while the words are not written yet. */
function put(id, html, asHtml = true) {
  const el = $(id);
  if (!el) return;
  el.hidden = !html;
  if (asHtml) el.innerHTML = html ?? '';
  else el.textContent = html ?? '';
}

export function renderStory(data, end, figs, installed = null) {
  const { rows } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length) return;
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? full[0];
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const ctx = { data, figs, rows, full, first: full[0], last, latest, row, at, installed, fmtDate, n0, gw, hrs, eur, twh, hh, step };
  const text = (k) => (typeof TEXT[k] === 'function' ? TEXT[k](ctx) : TEXT[k]) ?? null;

  if (text('lede')) $('lede').textContent = text('lede');
  put('answer-lead', text('answerLead'), false);
  const points = text('answerPoints');
  put('answer-points', points?.length ? points.map((x) => `<li>${x}</li>`).join('') : null);
  $('answer').hidden = !text('answerLead');
  put('facts', text('facts'));
  put('story-hint', text('hint'), false);

  CHAPTERS.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < CHAPTERS.length - 1) $(`next-${k + 1}`).textContent = `Next: ${CHAPTERS[k + 1]}`;
    put(`take-${k + 1}`, text(`take${k + 1}`), false);
    put(`body-${k + 1}`, text(`body${k + 1}`));
  });

  const cats = rows.map((r) => label(r.year));
  const hourX = (hr) => hr * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
  const yearColors = ['--f-other', '--f-coal', '--f-lignite', '--f-nuclear'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pick = (ys) => ys.filter((y, k, a) => a.indexOf(y) === k && rows.some((r) => r.year === y));

  // Chapter 1: lignite by year, split by whether Bulgaria was exporting.
  $('chart-h-1').textContent = 'Lignite burnt while importing and while exporting';
  $('chart-hint-1').textContent = 'Lignite generation each year, in TWh, split by whether Bulgaria was a net importer or a net exporter in that hour. The last bar is the latest 365 days.';
  const ch1 = [
    { name: 'While importing', color: css('--f-imports'), values: rows.map((r) => r.ligImporting) },
    { name: 'While exporting', color: css('--f-lignite'), values: rows.map((r) => r.ligTwh - r.ligImporting) },
  ];
  barChart($('story-chart-1'), {
    cats,
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Lignite: <b>${twh(rows[ci].ligTwh)}</b></div>${[...ch1].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}<div>Net exports: <b>${twh(rows[ci].netExpTwh)}</b></div><div>Nuclear: <b>${twh(rows[ci].nucTwh)}</b></div>`,
  });
  $('story-legend-1').innerHTML = legend([...ch1].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 2: lignite by hour of day, with the price in the tooltip.
  $('chart-h-2').textContent = 'Lignite by hour of day';
  $('chart-hint-2').textContent = 'Average lignite output for each hour of the day, Bulgarian time, in GW. The average day-ahead price at each hour is in the tooltip. The thick line is the latest 365 days.';
  const ligYears = pick([row(2019).year, row(2023).year, last.year, 'past365']);
  const ligLines = ligYears.map((y, k) => ({ name: title(y), year: y, color: css(yearColors[k]), points: row(y).ligHour.map((v, hr) => [hourX(hr), v]), width: y === 'past365' ? 3 : 2 }));
  lineChart($('story-chart-2'), {
    series: ligLines,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b> at ${eur(row(v.series.year).priceHour[hr])}/MWh</div>`).join('')}`;
    },
  });
  $('story-legend-2').innerHTML = legend(ligLines.map((sr) => [sr.name, sr.color]));

  // Chapter 3: the latest 365 days' average day: batteries charge at noon and
  // run in the evening, against lignite and the exports.
  $('chart-h-3').textContent = 'The average day in the latest 365 days';
  $('chart-hint-3').textContent = 'Average output for each hour of the day, Bulgarian time, in GW: lignite, solar, battery discharge and battery charging (shown as a size), and net exports (negative when Bulgaria imports).';
  const day = [
    { name: 'Lignite', color: css('--f-lignite'), key: 'ligHour' },
    { name: 'Solar', color: css('--f-solar'), key: 'solHour' },
    { name: 'Battery discharge', color: css('--f-battery'), key: 'batHour', width: 3 },
    { name: 'Battery charging', color: css('--f-battery'), key: 'chgHour', dash: '5 4' },
    { name: 'Net exports', color: css('--f-imports'), key: 'netExpHour' },
  ].map((sr) => ({ ...sr, points: latest[sr.key].map((v, hr) => [hourX(hr), v]), width: sr.width ?? 2 }));
  lineChart($('story-chart-3'), {
    series: day,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    xTicks: hourTicks,
    tooltip: (t, vals) => {
      const hr = Math.round(t / 3600000);
      return `<strong>${hh(hr)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}<div>Price: <b>${eur(latest.priceHour[hr])}/MWh</b></div>`;
    },
  });
  $('story-legend-3').innerHTML = legend(day.map((sr) => [sr.name, sr.color]));

  // Chapter 4: the evening, year by year.
  $('chart-h-4').textContent = 'The evening peak, 18:00 to 22:00';
  $('chart-hint-4').textContent = 'Average output from 18:00 to 22:00, Bulgarian time, in GW: lignite and battery discharge stacked. Demand, net exports and the evening price are in the tooltip. The last bar is the latest 365 days.';
  const ch4 = [
    { name: 'Lignite', color: css('--f-lignite'), values: rows.map((r) => r.eve.lig) },
    { name: 'Battery discharge', color: css('--f-battery'), values: rows.map((r) => r.eve.bat) },
  ];
  barChart($('story-chart-4'), {
    cats,
    stacks: ch4,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    tooltip: (ci) => {
      const r = rows[ci];
      return `<strong>${title(r.year)}, 18:00 to 22:00</strong>${[...ch4].reverse().map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${gw(sr.values[ci])}</b></div>`).join('')}<div>Demand: <b>${gw(r.eve.dem)}</b></div><div>Net exports: <b>${gw(r.eve.net)}</b></div><div>Price: <b>${eur(r.eve.price)}/MWh</b></div>`;
    },
  });
  $('story-legend-4').innerHTML = legend([...ch4].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 5: lignite by month, and the hours with little fossil.
  $('chart-h-5').textContent = 'Lignite by month';
  $('chart-hint-5').textContent = 'Lignite generation in each calendar month, in TWh.';
  const monthYears = pick([row(2019).year, row(2024).year, last.year, 'past365']);
  const monthX = (m) => Date.UTC(2001, m, 15);
  const monthLines = monthYears.map((y, k) => ({ name: title(y), color: css(yearColors[k]), points: row(y).ligMonth.map((v, m) => [monthX(m), v]), width: y === 'past365' ? 3 : 2 }));
  monthLines.forEach((sr) => { sr.markers = sr.points; });
  lineChart($('story-chart-5'), {
    series: monthLines,
    yMin: 0,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    xTicks: monthNames.map((m, k) => ({ t: monthX(k), label: m })),
    tooltip: (t, vals) => `<strong>${monthNames[new Date(t).getUTCMonth()]}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? twh(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-5').innerHTML = legend(monthLines.map((sr) => [sr.name, sr.color]));
  const coming = text('coming');
  put('coming', coming?.length ? coming.map(([when, what, url, record]) => `<li><span class="swatch" style="background:var(--f-lignite)"></span><span><b>${when}</b> ${what} (<a href="${url}">source</a>) <span class="sub">Watch: ${record}</span></span></li>`).join('') : null);
  $('coming-h').hidden = !coming?.length;
}
