// The Brazil story: a grid that runs on rivers built so much wind and solar
// that it now throws a fifth of it away, while a dry year still sends it back
// to fossil fuels. The figures are worked out from the data by storyFigures(),
// which the tests also run; renderStory() draws the page. Drafted with Alex's
// answer-first structure: the answer, three supporting points, then five
// chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import br from '../countries/br.js';
import { FOSSIL, RENEWABLE, metricSeries, yearlyEnergy, byYear } from './data.js';

// Levels the story follows, in GW.
export const FOSSIL_HIGH = 15;
export const HYDRO_LOW = 30;
export const HELD_HIGH = 10;

/** Local hour of day and "YYYY-MM" for every slot, with the offset looked up once per UTC day. */
function localClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Array(data.length);
  let day = -1;
  let offset = 0;
  for (let i = 0; i < data.length; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== day) {
      day = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, br.timeZone);
    }
    const local = new Date(t + offset);
    hour[i] = local.getUTCHours();
    month[i] = local.toISOString().slice(0, 7);
  }
  return { hour, month };
}

const share = (held, made) => (held + made > 0 ? (held / (held + made)) * 100 : NaN);
const col = (data, k, end) => data.columns[k] ?? new Float64Array(end).fill(NaN);

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
  const hydro = metricSeries(d, ['hydro']);
  const renewPct = metricSeries(d, RENEWABLE, { unit: 'pct' });
  const wind = col(data, 'wind', end);
  const farms = col(data, 'solar_utility', end);
  const roof = col(data, 'solar_rooftop', end);
  const windHeld = col(data, 'wind_curtailed', end);
  const solarHeld = col(data, 'solar_curtailed', end);
  const demand = col(data, 'demand', end);
  const { hour, month } = localClock(d);
  const held = new Float64Array(end);
  for (let i = 0; i < end; i++) {
    const a = windHeld[i];
    const b = solarHeld[i];
    held[i] = Number.isNaN(a) && Number.isNaN(b) ? NaN : ((a || 0) + (b || 0)) / 1000;
  }

  const rows = byYear(d, () => ({
    fossilMin: Infinity, fossilMax: -Infinity, fossilMaxAt: -1, fossilHigh: 0, hydroMin: Infinity, hydroLow: 0, renewMin: Infinity,
    windMax: 0, solarMax: 0, windSolarMax: 0, demandMax: 0, heldMax: 0, heldMaxAt: -1, heldHigh: 0,
    windMade: 0, windHeld: 0, solarMade: 0, solarHeld: 0, roof: 0, lowByHour: new Float64Array(24), hydroHour: new Float64Array(24), hydroHourN: new Float64Array(24),
    byHour: Array.from({ length: 24 }, () => ({ wind: 0, solar: 0, roof: 0, n: 0 })),
  }), (r, i) => {
    const f = fossil[i];
    if (Number.isNaN(f)) return;
    if (f < r.fossilMin) r.fossilMin = f;
    if (f > r.fossilMax) { r.fossilMax = f; r.fossilMaxAt = i; }
    if (f >= FOSSIL_HIGH) r.fossilHigh += slotH;
    if (hydro[i] < r.hydroMin) r.hydroMin = hydro[i];
    r.hydroHour[hour[i]] += hydro[i];
    r.hydroHourN[hour[i]]++;
    if (hydro[i] < HYDRO_LOW) {
      r.hydroLow += slotH;
      r.lowByHour[hour[i]] += slotH;
    }
    if (renewPct[i] < r.renewMin) r.renewMin = renewPct[i];
    const w = wind[i] || 0;
    const s = (farms[i] || 0) + (roof[i] || 0);
    if (w / 1000 > r.windMax) r.windMax = w / 1000;
    if (s / 1000 > r.solarMax) r.solarMax = s / 1000;
    if ((w + s) / 1000 > r.windSolarMax) r.windSolarMax = (w + s) / 1000;
    if (demand[i] / 1000 > r.demandMax) r.demandMax = demand[i] / 1000;
    if (!Number.isNaN(windHeld[i])) { r.windHeld += windHeld[i] * slotH; r.windMade += w * slotH; }
    if (!Number.isNaN(solarHeld[i])) { r.solarHeld += solarHeld[i] * slotH; r.solarMade += (farms[i] || 0) * slotH; }
    if (!Number.isNaN(roof[i])) r.roof += roof[i] * slotH;
    if (held[i] > r.heldMax) { r.heldMax = held[i]; r.heldMaxAt = i; }
    if (held[i] >= HELD_HIGH) r.heldHigh += slotH;
    if (!Number.isNaN(held[i])) {
      const h = r.byHour[hour[i]];
      h.wind += (windHeld[i] || 0) / 1000;
      h.solar += (solarHeld[i] || 0) / 1000;
      h.roof += (roof[i] || 0) / 1000;
      h.n++;
    }
  }).map((r) => ({
    year: r.year,
    fossilMin: r.fossilMin,
    fossilMax: r.fossilMax,
    fossilMaxAt: r.fossilMaxAt,
    fossilHigh: r.fossilHigh,
    hydroMin: r.hydroMin,
    hydroLow: r.hydroLow,
    hydroLowByHour: [...r.lowByHour],
    hydroByHour: [...r.hydroHour].map((v, k) => (r.hydroHourN[k] ? v / r.hydroHourN[k] : NaN)),
    renewMin: r.renewMin,
    windMax: r.windMax,
    solarMax: r.solarMax,
    windSolarMax: r.windSolarMax,
    demandMax: r.demandMax,
    heldMax: r.heldMax,
    heldMaxAt: r.heldMaxAt,
    heldHigh: r.heldHigh,
    // TWh.
    windHeldTwh: r.windHeld / 1e6,
    solarHeldTwh: r.solarHeld / 1e6,
    roofTwh: r.roof / 1e6,
    windHeldPct: share(r.windHeld, r.windMade),
    solarHeldPct: share(r.solarHeld, r.solarMade),
    heldPct: share(r.windHeld + r.solarHeld, r.windMade + r.solarMade),
    byHour: r.byHour.map((h) => (h.n ? { wind: h.wind / h.n, solar: h.solar / h.n, roof: h.roof / h.n } : null)),
  }));

  // Held back share month by month, since ONS first reported it.
  const months = new Map();
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(held[i])) continue;
    const m = months.get(month[i]) ?? { held: 0, made: 0, heldGw: 0, n: 0 };
    if (!Number.isNaN(windHeld[i])) { m.held += windHeld[i]; m.made += wind[i] || 0; }
    if (!Number.isNaN(solarHeld[i])) { m.held += solarHeld[i]; m.made += farms[i] || 0; }
    m.heldGw += held[i];
    m.n++;
    months.set(month[i], m);
  }
  // The last month may be part of a month.
  const monthly = [...months].map(([m, v]) => ({ month: m, heldPct: share(v.held, v.made), heldGw: v.heldGw / v.n }));

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: br.timeZone };
  const fossilSpell = summarise(fossil, FOSSIL_HIGH, 'above', opts);
  const heldSpell = summarise(held, HELD_HIGH, 'above', opts);
  return { rows, energy, monthly, fossilSpell, heldSpell };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-GB');
const gw = (v) => `${v.toFixed(1)} GW`;
const hrs = (v) => `${n0(v)} hours`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const pct = (v) => `${v.toFixed(1)}%`;
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const named = (y) => (y === 'past365' ? 'the latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const src = (url, text) => `<a href="${url}">${text}</a>`;
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const monthName = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const hourX = (hr) => hr * 3600000;
const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: `${String(hr).padStart(2, '0')}:00` }));
const hourTip = (fmt) => (t, vals) => `<strong>${String(Math.round(t / 3600000)).padStart(2, '0')}:00</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? fmt(v.value) : '—'}</b></div>`).join('')}`;
// From other ONS datasets, not the generation data: natural inflow to the
// reservoirs as a share of the long-term average (ENA), stored energy as a
// share of the maximum (EAR), and turbinable water spilled (energia vertida
// turbinável), for the whole interconnected system.
export const HYDROLOGY = {
  2021: { inflowPct: 72, storeStart: 25, storeMin: 24, spillTwh: 11.6, spillMidday: 1.3 },
  2025: { inflowPct: 78, storeStart: 53, storeMin: 44, spillTwh: 21.0, spillMidday: 4.6 },
};
const ONS_DATA = 'https://dados.ons.org.br/';
// Average hydro output over local hours [a, b).
const hydroAt = (r, a, b) => r.hydroByHour.slice(a, b).reduce((p, q) => p + q, 0) / (b - a);
// Share of a year's low-hydro hours that fell in daylight, 08:00 to 16:00.
const daytime = (r) => r.hydroLowByHour.slice(8, 16).reduce((a, b) => a + b, 0) / r.hydroLow;

export function renderStory(data, end, figs) {
  const { rows, energy, monthly, fossilSpell, heldSpell } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length || !monthly.length) return;
  const first = full[0];
  const last = full.at(-1);
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? last;
  const en = (y) => energy.find((r) => r.year === y) ?? energy.at(-1);
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const when = (i) => `${fmtDate(at(i))}`;
  const held = rows.filter((r) => Number.isFinite(r.heldPct));
  const heldTwh = (r) => r.windHeldTwh + r.solarHeldTwh;
  const top = monthly.reduce((a, m) => (m.heldPct > a.heldPct ? m : a), monthly[0]);
  const mon = (m) => monthly.find((x) => x.month === m);
  const lowShare = (m) => mon(m)?.heldPct ?? NaN;
  const before = monthly.filter((m) => m.month < '2023-06');
  const under1 = before.filter((m) => m.heldPct < 1).length;
  const allTimeHeld = rows.reduce((a, r) => (r.heldMax > a.heldMax ? r : a), rows[0]);
  const hours = latest.byHour.filter(Boolean);
  const peakOf = (k) => latest.byHour.reduce((a, h, hr) => (h && h[k] > a.v ? { v: h[k], hr } : a), { v: 0, hr: 0 });
  const windPeak = peakOf('wind');
  const solarPeak = peakOf('solar');
  const roofPeak = peakOf('roof');
  const night = latest.byHour.filter((h, hr) => h && (hr < 5 || hr > 19)).map((h) => h.wind);
  const windNight = night.reduce((a, b) => a + b, 0) / night.length;
  const gasYear = en(last.year);
  const y21 = row(2021);
  const drought = fossilSpell.record;
  const sinceDrought = rows.filter((r) => r.year !== 'past365' && r.year > 2021);
  const maxHighSince = Math.max(...sinceDrought.map((r) => r.fossilHigh));
  const floorRows = full.filter((r) => r.year >= 2013);
  const lowerSince = [...full].reverse().find((r) => r.fossilMin < latest.fossilMin);
  const hh = (hr) => `${String(hr).padStart(2, '0')}:00`;

  // Header and in short.
  $('lede').textContent = `Brazil's grid runs almost entirely on water, wind and sun, and it now has more wind and solar than it can use. In ${named(latest.year)} ONS held back ${pct(latest.heldPct)} of what its wind and solar farms could have made.`;
  $('answer-lead').textContent = `Brazil now throws away about a fifth of its wind and solar farm output, mostly in the late morning, and the jump began the month after the August 2023 blackout. The old problem, a dry year forcing fossil plants on, has faded: fossil fuels have not run at ${FOSSIL_HIGH} GW for more than ${hrs(maxHighSince)} in any year since 2021.`;
  $('answer-points').innerHTML = [
    `<b>From ${pct(row(2022).heldPct)} to ${pct(last.heldPct)} in three years.</b> In ${named(latest.year)} ${twh(heldTwh(latest))} was held back, more than Brazil's gas plants made in ${last.year} (${twh(gasYear.twh.gas)}). ${link(1, 'Chapters 1')} and ${link(2, '2')}`,
    `<b>Thrown away in the late morning.</b> Wind held back averages ${gw(windPeak.v)} at ${hh(windPeak.hr)} against ${gw(windNight)} at night, while rooftop solar, which ONS cannot switch off, averages ${gw(roofPeak.v)} at ${hh(roofPeak.hr)}. ${link(3, 'Chapter 3')}`,
    `<b>The rivers now make room for the sun.</b> In 2021 most hours with hydro under ${HYDRO_LOW} GW came at night, in a drought; in ${last.year} ${Math.round(daytime(last) * 100)}% came between 08:00 and 16:00, as hydro made way for the sun, in a year almost as dry. ${link(4, 'Chapter 4')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-wind', 'Most held back in an hour', gw(allTimeHeld.heldMax), `on ${when(allTimeHeld.heldMaxAt)}`],
    ['--f-wind', 'Worst month', pct(top.heldPct), `${monthName(top.month)}, ${gw(top.heldGw)} held back on average`],
    ['--f-solar', 'Most wind and solar at once', gw(Math.max(...rows.map((r) => r.windSolarMax))), 'rooftop solar included'],
    ['--fossil', 'Lowest fossil hour', gw(latest.fossilMin), `in ${named(latest.year)}${lowerSince ? `, the lowest since ${lowerSince.year}` : ''}`],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${twh(heldTwh(latest))}</div><div class="sub">Wind and solar held back in ${named(latest.year)}, more than Brazil's gas plants made in all of ${last.year} (${twh(gasYear.twh.gas)}).</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: how much is held back, when it jumped, which hour of the day, what the rivers do now, and how low fossil can go.';

  const chapters = [
    'A fifth of wind and solar held back',
    'The jump after the blackout',
    'Thrown away at ten in the morning',
    'The rivers make room for the sun',
    'How low can fossil go?',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });

  // Chapter 1: held back by year.
  const r24 = row(2024);
  $('take-1').textContent = `The held back share rose from ${pct(row(2022).heldPct)} in 2022 to ${pct(last.heldPct)} in ${last.year}, and solar farms lose a larger share than wind.`;
  $('body-1').innerHTML = `ONS has published wind curtailment since October 2021 and solar farm curtailment since April 2024. In 2022 it held back ${pct(row(2022).windHeldPct)} of wind output, and in 2023 ${pct(row(2023).windHeldPct)}. In 2024 wind lost ${pct(r24.windHeldPct)} and solar farms ${pct(r24.solarHeldPct)}, ${pct(r24.heldPct)} combined. In ${last.year} wind lost ${pct(last.windHeldPct)} and solar farms ${pct(last.solarHeldPct)}, ${pct(last.heldPct)} combined: ${twh(last.windHeldTwh)} of wind and ${twh(last.solarHeldTwh)} of solar. ${named(latest.year)[0].toUpperCase()}${named(latest.year).slice(1)} were higher still, at ${pct(latest.windHeldPct)} for wind and ${pct(latest.solarHeldPct)} for solar farms, ${twh(heldTwh(latest))} in all. That is more than Brazil's gas plants made in ${last.year} (${twh(gasYear.twh.gas)}) and over twice its nuclear output (${twh(gasYear.twh.nuclear)}). Generators are not paid for output ONS holds back, so this is lost income as well as lost clean power.`;
  $('chart-h-1').textContent = 'Wind and solar held back each year';
  $('chart-hint-1').textContent = 'Energy ONS held back from wind farms and solar farms, in TWh. The share of what they could have made is in the tooltip. The last bar is the latest 365 days.';
  const heldStacks = [
    { name: 'Wind', color: css('--f-wind'), values: held.map((r) => r.windHeldTwh) },
    { name: 'Solar farms', color: css('--f-solar'), values: held.map((r) => r.solarHeldTwh) },
  ];
  barChart($('story-chart-1'), {
    cats: held.map((r) => (r.year === 'past365' ? '365d' : String(r.year))),
    stacks: heldStacks,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => held[ci].year === 'past365',
    tooltip: (ci) => {
      const r = held[ci];
      return `<strong>${title(r.year)}</strong><div><i style="background:${heldStacks[0].color}"></i>Wind: <b>${twh(r.windHeldTwh)}</b> (${pct(r.windHeldPct)})</div>${Number.isFinite(r.solarHeldPct) ? `<div><i style="background:${heldStacks[1].color}"></i>Solar farms: <b>${twh(r.solarHeldTwh)}</b> (${pct(r.solarHeldPct)})</div>` : ''}<div>Combined: <b>${pct(r.heldPct)}</b></div>`;
    },
  });
  $('story-legend-1').innerHTML = legend(heldStacks.map((s) => [s.name, s.color]));

  // Chapter 2: month by month.
  const rec = heldSpell.record;
  $('take-2').textContent = `The held back share was under 1% in almost every month to May 2023, then hit ${pct(lowShare('2023-09'))} in September 2023, the month after the nationwide blackout.`;
  $('body-2').innerHTML = `Until May 2023 the share held back was under 1% in ${under1} of ${before.length} months. It rose to ${pct(lowShare('2023-06'))} in June 2023 and ${pct(lowShare('2023-08'))} in August. On 15 August 2023 a transmission fault caused a nationwide blackout, with about 16 GW of load lost across 25 states; the hour from 10:00 that day, at ${gw(row(2023).heldMax)}, was the most held back in 2023. September 2023 came in at ${pct(lowShare('2023-09'))}. Since then the ceiling has kept rising, to a record ${pct(top.heldPct)} in ${monthName(top.month)}, when an average ${gw(top.heldGw)} was held back all month. The most held back in one hour went from ${gw(r24.heldMax)} in 2024 to ${gw(row(2025).heldMax)} in 2025 and ${gw(allTimeHeld.heldMax)} on ${when(allTimeHeld.heldMaxAt)}.${rec ? ` The longest run above ${HELD_HIGH} GW is ${n0(((rec.end - rec.start) * step) / 60)} hours, from ${when(rec.start)}.` : ''}`;
  $('chart-h-2').textContent = 'The share held back, month by month';
  $('chart-hint-2').textContent = 'What ONS held back as a share of what wind and solar farms could have made each month, Brasília time. The dashed line marks one fifth. The last month may be part of a month.';
  const mx = monthly.map((m) => Date.parse(`${m.month}-15T00:00:00Z`));
  const monthlySeries = [{ name: 'Held back', color: css('--f-wind'), points: monthly.map((m, k) => [mx[k], m.heldPct]), width: 2.5 }];
  lineChart($('story-chart-2'), {
    series: monthlySeries,
    yMin: 0,
    yFormat: (v) => `${Math.round(v)}%`,
    refLines: [{ value: 20, color: css('--ink-3') }],
    tooltip: (t) => {
      const m = monthly[mx.indexOf(t)];
      return m ? `<strong>${monthName(m.month)}</strong><div>Held back: <b>${pct(m.heldPct)}</b></div><div>On average: <b>${gw(m.heldGw)}</b></div>` : '';
    },
  });
  $('story-legend-2').innerHTML = `${legend(monthlySeries.map((s) => [s.name, s.color]))}<span>Line: 20%</span>`;

  // Chapter 3: by hour of day.
  $('take-3').textContent = `Wind is held back most at ${hh(windPeak.hr)}, as rooftop solar that ONS cannot switch off nears its ${gw(roofPeak.v)} peak.`;
  $('body-3').innerHTML = `Averaged over ${named(latest.year)}, wind held back is about ${gw(windNight)} at night but ${gw(windPeak.v)} at ${hh(windPeak.hr)}. Solar farms held back peaks at ${gw(solarPeak.v)} at ${hh(solarPeak.hr)}. The reason is on Brazil's roofs. Rooftop and small solar, which ONS estimates rather than controls, is zero at night and averages ${gw(roofPeak.v)} at ${hh(roofPeak.hr)}. It cannot be curtailed, so when it floods the grid in the late morning the wind and solar farms are what get switched off. Solar including rooftop reached ${gw(latest.solarMax)} and wind plus solar ${gw(latest.windSolarMax)} in ${named(latest.year)}. Over ${HELD_HIGH} GW was held back for ${hrs(latest.heldHigh)}, against ${hrs(r24.heldHigh)} in 2024.`;
  $('chart-h-3').textContent = 'Held back by hour of day, with rooftop solar';
  $('chart-hint-3').textContent = `Average GW for each hour of the day, Brasília time, over ${named(latest.year)}.`;
  const daySeries = [
    ['wind', 'Wind held back', '--f-wind'],
    ['solar', 'Solar farms held back', '--f-solar'],
    ['roof', 'Rooftop and small solar made', '--f-rooftop'],
  ].map(([k, name, c]) => ({ name, color: css(c), points: latest.byHour.map((h, hr) => [hourX(hr), h ? h[k] : NaN]), width: k === 'roof' ? 2 : 2.5 }));
  if (hours.length) {
    lineChart($('story-chart-3'), { series: daySeries, yMin: 0, yFormat: gw, yTickFormat: (v) => `${v}`, xTicks: hourTicks, tooltip: hourTip(gw) });
    $('story-legend-3').innerHTML = legend(daySeries.map((s) => [s.name, s.color]));
  }

  // Chapter 4: when hydro is low.
  const r01 = row(2001);
  const r25 = row(2025);
  const hyd21 = HYDROLOGY[2021];
  const hyd25 = rows.some((r) => r.year === 2025) ? HYDROLOGY[2025] : null;
  $('take-4').textContent = `Hours with hydro under ${HYDRO_LOW} GW used to mean drought nights; in ${last.year} ${Math.round(daytime(last) * 100)}% of them came in daylight.`;
  $('body-4').innerHTML = `Brazil's grid has always feared drought. In 2001 hydro ran under ${HYDRO_LOW} GW for ${hrs(r01.hydroLow)} and the government imposed rationing. In 2021, the worst drought in about 90 years, hydro fell to its lowest hour ever, ${gw(y21.hydroMin)}, and ONS ran nearly every thermal plant: fossil fuels made ${twh(en(2021).fossil)}, the most ever, and ran at ${FOSSIL_HIGH} GW or more for ${hrs(y21.fossilHigh)}${drought ? `, including ${n0(((drought.end - drought.start) * step) / 60)} in a row from ${when(drought.start)}` : ''}. Most of 2021's low-hydro hours were at night. ${last.year} had ${hrs(last.hydroLow)} with hydro under ${HYDRO_LOW} GW, but ${Math.round(daytime(last) * 100)}% fell between 08:00 and 16:00, against ${Math.round(daytime(y21) * 100)}% in 2021. ${hyd25 ? `Yet 2025 was nearly as dry: the rivers brought ${hyd25.inflowPct}% of their long-term average, against ${hyd21.inflowPct}% in 2021. The difference was the water already stored. The reservoirs started 2025 ${hyd25.storeStart}% full, against ${hyd21.storeStart}% in 2021, and never fell below ${hyd25.storeMin}%, against ${hyd21.storeMin}% (${src(ONS_DATA, 'ONS')}). With that cushion, and wind and solar covering the day, fossil fuels never reached ${FOSSIL_HIGH} GW in 2025. ` : ''}Hydro now works around the sun: from 10:00 to 14:00 it averaged ${gw(hydroAt(r25, 10, 14))} in 2025, against ${gw(hydroAt(y21, 10, 14))} in 2021, and from 18:00 to 22:00 it rose from ${gw(hydroAt(y21, 18, 22))} to ${gw(hydroAt(r25, 18, 22))}.${hyd25 ? ` Not all the midday water is saved for the evening. Water that could have gone through the turbines but was spilled averaged ${gw(hyd25.spillMidday)} at midday in 2025, against ${gw(hyd21.spillMidday)} in 2021, ${twh(hyd25.spillTwh)} over the year. Almost three quarters of it was at four northern plants: Tucuruí, and the run-of-river plants Belo Monte, Santo Antônio and Jirau, which have little storage and must spill what the grid won't take.` : ''}`;
  $('chart-h-4').textContent = `When hydro runs under ${HYDRO_LOW} GW`;
  $('chart-hint-4').textContent = `Hours with hydro under ${HYDRO_LOW} GW, by hour of day, Brasília time.`;
  const lowYears = [2001, 2021, last.year].filter((y, k, a) => rows.some((r) => r.year === y) && a.indexOf(y) === k);
  const lowColors = ['--f-other', '--f-gas', '--f-hydro'];
  const lowSeries = lowYears.map((y, k) => ({ name: String(y), color: css(lowColors[k]), points: row(y).hydroLowByHour.map((v, hr) => [hourX(hr), v]), width: y === last.year ? 3 : 2 }));
  lineChart($('story-chart-4'), { series: lowSeries, yMin: 0, yFormat: (v) => hrs(v), yTickFormat: (v) => `${v}`, xTicks: hourTicks, tooltip: hourTip(hrs) });
  $('story-legend-4').innerHTML = legend(lowSeries.map((s) => [s.name, s.color]));

  // Chapter 5: the fossil floor.
  const e0 = en(first.year);
  const r14 = en(2014);
  $('take-5').textContent = `The lowest fossil hour fell to ${gw(latest.fossilMin)} in ${named(latest.year)}, with renewables at ${pct(en('past365').renewablePct)} of generation.`;
  $('body-5').innerHTML = `Renewables made ${pct(e0.renewablePct)} of Brazil's electricity in ${first.year}, fell to ${pct(r14.renewablePct)} in 2014 and ${pct(en(2021).renewablePct)} in 2021, and recovered to ${pct(en(last.year).renewablePct)} in ${last.year}. Demand grew from ${gw(first.demandMax)} at its peak in ${first.year} to ${gw(Math.max(...rows.map((r) => r.demandMax)))}, and wind and solar met most of the growth. The fossil floor is moving too. The lowest fossil hour each year was ${gw(Math.min(...floorRows.filter((r) => r.year <= 2017).map((r) => r.fossilMin)))} or more from 2013 to 2017 and about 3 GW from 2018; in ${named(latest.year)} it reached ${gw(latest.fossilMin)}${lowerSince ? `, the lowest since ${lowerSince.year}` : ''}. Whether the held back share keeps climbing past ${pct(latest.heldPct)} now depends on more lines out of the Northeast, storage, and demand that moves into the late morning.`;
  $('chart-h-5').textContent = 'The lowest and highest fossil hour each year';
  $('chart-hint-5').textContent = 'Gas, coal, oil and other thermal plants together, in GW. The last point is the latest 365 days.';
  const yearMs = (y) => (y === 'past365' ? at(end) : Date.UTC(y, 6, 1));
  const xs = rows.map((r) => yearMs(r.year));
  const fos = [
    { name: 'Highest hour', color: css('--fossil'), points: rows.map((r, k) => [xs[k], r.fossilMax]), width: 2.5 },
    { name: 'Lowest hour', color: css('--f-gas'), points: rows.map((r, k) => [xs[k], r.fossilMin]), width: 2.5 },
  ];
  fos.forEach((s) => { s.markers = s.points; });
  lineChart($('story-chart-5'), {
    series: fos,
    yMin: 0,
    yFormat: gw,
    yTickFormat: (v) => `${v}`,
    refLines: [{ value: FOSSIL_HIGH, color: css('--ink-3') }],
    tooltip: (t, vals) => {
      const r = rows[xs.indexOf(t)];
      return `<strong>${title(r?.year ?? new Date(t).getUTCFullYear())}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gw(v.value) : '—'}</b></div>`).join('')}${r ? `<div>Hours at ${FOSSIL_HIGH} GW or more: <b>${n0(r.fossilHigh)}</b></div>` : ''}`;
    },
  });
  $('story-legend-5').innerHTML = `${legend(fos.map((s) => [s.name, s.color]))}<span>Line: ${FOSSIL_HIGH} GW</span>`;
}
