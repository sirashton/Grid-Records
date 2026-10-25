// The United States story: fossil output in the lower 48 has not fallen
// since 2019, because demand growth took the new solar and wind. What has
// moved is the floor, the quietest fossil hour of the year, from the night to
// spring weekend lunchtimes, and in 2025 the mix moved back towards coal under
// dear gas and federal emergency orders. Texas's page tells the gas duck; here
// it is one chapter.
// The figures are worked out from the data by storyFigures(), which the tests
// also run; renderStory() draws the page. Drafted with Alex's answer-first
// structure: the answer, three supporting points, then five chapters.
import { slotTime } from '../records.js';
import { barChart, lineChart } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import us from '../countries/us.js';
import { FOSSIL, GENERATION, byYear } from './data.js';

// Fossil levels the story counts hours under, in GW.
export const FOSSIL_LOW = [150, 175, 200];
const HOURLY = ['gas', 'coal', 'solar', 'battery', 'fossil'];
const YTD = ['fossil', 'coal', 'gas', 'solar', 'wind', 'nuclear', 'demand', 'gen'];

/**
 * Local (Eastern) hour, month, day of month, weekday and year for every slot.
 * The offset is looked up once per UTC day, so the hour around a clock change
 * can be one off.
 */
function localClock(data) {
  const stepMs = stepOf(data) * 60000;
  const hour = new Uint8Array(data.length);
  const month = new Uint8Array(data.length);
  const date = new Uint8Array(data.length);
  const weekday = new Uint8Array(data.length);
  const year = new Uint16Array(data.length);
  let utcDay = -1;
  let offset = 0;
  for (let i = 0; i < data.length; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== utcDay) {
      utcDay = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, us.timeZone);
    }
    const l = new Date(t + offset);
    hour[i] = l.getUTCHours();
    month[i] = l.getUTCMonth() + 1;
    date[i] = l.getUTCDate();
    weekday[i] = l.getUTCDay();
    year[i] = l.getUTCFullYear();
  }
  return { hour, month, date, weekday, year };
}

const mean = (sum, n) => (n ? sum / n : NaN);

/**
 * Every number the story uses. Rows run by calendar year (Eastern time),
 * complete years only, then 'past365'. Each row also carries `ytd`, its
 * totals from 1 January to the same day of the year as the latest data, so
 * the current year compares like for like (`ytdRows`, the current year
 * included).
 */
export function storyFigures(data, end) {
  const d = { ...data, length: end };
  const slotH = stepOf(data) / 60;
  const { hour, month, date, weekday, year } = localClock(d);
  const C = data.columns;
  const gw = (k, i) => {
    const v = C[k]?.[i];
    return v == null || Number.isNaN(v) ? 0 : v / 1000;
  };
  const fossilAt = (i) => FOSSIL.reduce((s, k) => s + gw(k, i), 0);
  const genAt = (i) => GENERATION.reduce((s, k) => s + Math.max(0, gw(k, i)), 0);
  const valid = (i) => !Number.isNaN(C.gas[i]);
  // The latest day of the year the data reaches, to compare years over.
  const last = end - 1;
  const cut = month[last] * 100 + date[last];
  const inYtd = (i) => month[i] * 100 + date[i] <= cut;

  const init = () => ({
    twh: Object.fromEntries([...GENERATION, 'battery', 'battery_charge', 'pumped_storage_charge', 'imports', 'exports', 'demand', 'fossil', 'gen'].map((k) => [k, 0])),
    hourSum: Object.fromEntries(HOURLY.map((k) => [k, new Float64Array(24)])),
    hourN: new Float64Array(24),
    under: FOSSIL_LOW.map(() => 0),
    fMin: Infinity, fMinAt: -1, fMax: 0, fMaxAt: -1,
    coalMin: Infinity, coalMinAt: -1,
    solMax: 0, solMaxAt: -1, batMax: 0, batMaxAt: -1, demMax: 0, demMaxAt: -1,
    n: 0,
  });
  const add = (r, i) => {
    if (!valid(i)) return;
    const f = fossilAt(i);
    const g = genAt(i);
    for (const k of Object.keys(r.twh)) if (k !== 'fossil' && k !== 'gen') r.twh[k] += (Math.abs(gw(k, i)) * slotH) / 1000;
    r.twh.fossil += (f * slotH) / 1000;
    r.twh.gen += (g * slotH) / 1000;
    const h = hour[i];
    for (const k of HOURLY) r.hourSum[k][h] += k === 'fossil' ? f : gw(k, i);
    r.hourN[h]++;
    FOSSIL_LOW.forEach((lv, k) => { if (f < lv) r.under[k] += slotH; });
    if (f < r.fMin) { r.fMin = f; r.fMinAt = i; }
    if (f > r.fMax) { r.fMax = f; r.fMaxAt = i; }
    if (gw('coal', i) < r.coalMin) { r.coalMin = gw('coal', i); r.coalMinAt = i; }
    if (gw('solar', i) > r.solMax) { r.solMax = gw('solar', i); r.solMaxAt = i; }
    if (gw('battery', i) > r.batMax) { r.batMax = gw('battery', i); r.batMaxAt = i; }
    if (gw('demand', i) > r.demMax) { r.demMax = gw('demand', i); r.demMaxAt = i; }
    r.n += slotH;
  };
  const finish = (r) => ({
    year: r.year,
    twh: r.twh,
    hours: r.n,
    fossilShare: r.twh.fossil / r.twh.gen,
    coalShare: r.twh.coal / r.twh.gen,
    gasShare: r.twh.gas / r.twh.gen,
    solarShare: r.twh.solar / r.twh.gen,
    hourly: Object.fromEntries(HOURLY.map((k) => [k, [...r.hourSum[k]].map((v, h) => mean(v, r.hourN[h]))])),
    under: r.under,
    fMin: r.fMin, fMinAt: r.fMinAt, fMinHour: hour[r.fMinAt], fMinWeekday: weekday[r.fMinAt],
    fMax: r.fMax, fMaxAt: r.fMaxAt,
    coalMin: r.coalMin, coalMinAt: r.coalMinAt,
    solMax: r.solMax, solMaxAt: r.solMaxAt, batMax: r.batMax, batMaxAt: r.batMaxAt, demMax: r.demMax, demMaxAt: r.demMaxAt,
  });
  const rows = byYear(d, init, add).map(finish);

  // 1 January to the latest day, every year the data covers from January.
  const ytdRows = [];
  const firstYear = rows.find((r) => r.year !== 'past365')?.year;
  for (let i = 0; i < end; i++) {
    if (!valid(i) || !inYtd(i)) continue;
    const y = year[i];
    if (firstYear == null || y < firstYear) continue;
    let row = ytdRows.at(-1);
    if (row?.year !== y) {
      row = { year: y, ...Object.fromEntries(YTD.map((k) => [k, 0])), fMin: Infinity, fMinAt: -1, under: FOSSIL_LOW.map(() => 0) };
      ytdRows.push(row);
    }
    const f = fossilAt(i);
    for (const k of YTD) row[k] += ((k === 'fossil' ? f : k === 'gen' ? genAt(i) : gw(k, i)) * slotH) / 1000;
    if (f < row.fMin) { row.fMin = f; row.fMinAt = i; }
    FOSSIL_LOW.forEach((lv, k) => { if (f < lv) row.under[k] += slotH; });
  }
  for (const r of ytdRows) r.fossilShare = r.fossil / r.gen;

  // The lowest fossil hour on record.
  let lowAt = -1;
  for (let i = 0; i < end; i++) if (valid(i) && (lowAt < 0 || fossilAt(i) < fossilAt(lowAt))) lowAt = i;
  return { rows, ytdRows, ytdTo: { month: month[last], date: date[last] }, low: { gw: fossilAt(lowAt), at: lowAt, hour: hour[lowAt], weekday: weekday[lowAt] } };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const twh = (v) => `${n0(v)} TWh`;
const gwf = (v) => `${v.toFixed(1)} GW`;
const pc = (v) => `${(v * 100).toFixed(1)}%`;
const label = (y) => (y === 'past365' ? '365d' : String(y));
const title = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const src = (url, text) => `<a href="${url}">${text}</a>`;
const hh = (h) => `${String(h).padStart(2, '0')}:00`;
const FOLD = { 2: 'twofold', 3: 'threefold', 4: 'fourfold', 5: 'fivefold', 6: 'sixfold', 7: 'sevenfold', 8: 'eightfold' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const whenFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: us.timeZone });
const hourFmt = new Intl.DateTimeFormat('en', { hour: 'numeric', hourCycle: 'h23', timeZone: us.timeZone });
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: us.timeZone });

const SOURCES = {
  prices2025: 'https://www.eia.gov/todayinenergy/detail.php?id=67106',
  demand: 'https://www.eia.gov/todayinenergy/detail.php?id=67344',
  capacity2026: 'https://www.eia.gov/todayinenergy/detail.php?id=67205',
  orders: 'https://insight.factset.com/u.s.-coal-plant-retirement-delays-continue',
  court: 'https://earthjustice.org/press/2026/trump-administration-loses-first-court-case-challenging-doe-orders-for-coal-plants',
  credits: 'https://www.projectfinance.law/media/6071/the-one-big-beautiful-bill-s-energy-tax-credit-timeline_0825.pdf',
};

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['4 July 2026 (passed)', 'The last day for wind and solar projects to begin construction and keep their tax credits under the 2025 budget act. Projects that missed it must be in service by 31 December 2027. Storage keeps its credits for construction starting through 2033.', 'credits', 'The highest solar hour.'],
  ['11 September 2026', 'The D.C. Circuit ruled that DOE cannot use section 202(c) without a genuine emergency, in the case over the order keeping J.H. Campbell open, which had been reissued six times.', 'court', 'Coal output by year, and the lowest coal hour.'],
  ['During 2026', 'Seven more coal units, nearly 5 GW, are due to retire. FactSet expects most of them to get emergency orders near their dates.', 'orders', 'Coal output by year.'],
  ['End of 2026', 'A record 86 GW of new capacity planned for the year: 43.4 GW of solar, 24 GW of batteries, 11.8 GW of wind and 6.3 GW of gas.', 'capacity2026', 'The lowest fossil hour, hours under 150 GW, and the highest battery hour.'],
  ['2026 and 2027', 'EIA\'s baseline has load growing 1.9% in 2026 and 2.5% in 2027, with ERCOT near 10% a year and PJM near 3%. Coal falls 9.3% from 2025 to 2027 and gas rises 1.7%; in its high data-centre case coal falls only 5.0% and gas rises 7.3%.', 'demand', 'Fossil output by year, and the highest demand hour.'],
];

export function renderStory(data, end, figs) {
  const { rows, ytdRows, ytdTo, low } = figs;
  const full = rows.filter((r) => r.year !== 'past365');
  if (!full.length || !ytdRows.length) return;
  const latest = rows.at(-1);
  const row = (y) => rows.find((r) => r.year === y) ?? full.at(-1);
  const ytd = (y) => ytdRows.find((r) => r.year === y) ?? ytdRows[0];
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const when = (i) => whenFmt.format(at(i)).replace(/ at /, ', ').replace(/, (\d\d:\d\d)$/, ' at $1');
  const toDate = `1 January to ${ytdTo.date} ${MONTHS[ytdTo.month - 1]}`;

  const first = full[0];
  const lastFull = full.at(-1);
  const y20 = row(2020);
  const y23 = row(2023);
  const y24 = row(2024);
  const y25 = row(2025);
  const now = ytdRows.at(-1);
  const then = ytd(first.year);
  const yt24 = ytd(2024);
  const yt25 = ytd(2025);
  const topFossil = full.reduce((a, r) => (r.twh.fossil > a.twh.fossil ? r : a), first);
  // The year's lowest fossil hour falls in spring, so the year-to-date low is the year's.
  const hourOfSlot = (i) => Number(hourFmt.format(at(i)));
  const isDay = (i) => hourOfSlot(i) >= 9 && hourOfSlot(i) <= 17;
  const night = ytdRows.filter((r) => !isDay(r.fMinAt)).map((r) => r.year);
  const day = ytdRows.filter((r) => isDay(r.fMinAt)).map((r) => r.year);
  const batTop = rows.reduce((a, r) => (r.batMax > a.batMax ? r : a), first);
  const solTop = rows.reduce((a, r) => (r.solMax > a.solMax ? r : a), first);
  const demTop = rows.reduce((a, r) => (r.demMax > a.demMax ? r : a), first);
  const g0 = first.hourly.gas;
  const gN = latest.hourly.gas;
  const argMin = (a, from, to) => { let k = from; for (let h = from; h <= to; h++) if (a[h] < a[k]) k = h; return k; };
  const argMax = (a, from, to) => { let k = from; for (let h = from; h <= to; h++) if (a[h] > a[k]) k = h; return k; };
  const nightLow0 = argMin(g0, 0, 8);
  const eve0 = argMax(g0, 12, 23);
  const nightLowN = argMin(gN, 0, 8);
  const noonN = argMin(gN, 9, 15);
  const eveN = argMax(gN, 15, 23);
  const coalAvg25 = (y25.twh.coal * 1000) / y25.hours;
  const span = (ys) => (ys.length > 1 && ys.at(-1) - ys[0] === ys.length - 1 ? `from ${ys[0]} to ${ys.at(-1)}` : `in ${ys.join(', ')}`);
  const list = (ys) => (ys.length > 1 ? `${ys.slice(0, -1).join(', ')} and ${ys.at(-1)}` : String(ys[0]));

  // Header and in short.
  $('lede').textContent = `America's fossil plants made ${twh(now.fossil)} from ${toDate} this year, ${now.fossil >= then.fossil ? 'more' : 'barely less'} than in the same stretch of ${then.year}, while solar output grew ${FOLD[Math.round(now.solar / then.solar)] ?? `${Math.round(now.solar / then.solar)} times over`}.`;
  $('answer-lead').textContent = `Fossil generation in the lower 48 states has not fallen. From ${toDate} it was ${twh(then.fossil)} in ${then.year} and ${twh(now.fossil)} in ${now.year}, and ${topFossil.year} was the highest fossil year in this record, at ${twh(topFossil.twh.fossil)}. Solar rose from ${twh(then.solar)} to ${twh(now.solar)} over the same stretch, but demand rose from ${twh(then.demand)} to ${twh(now.demand)}, so the new solar met new load rather than replacing old plants. What has moved is the floor, the quietest fossil hour of the year, and in 2025 the mix moved back towards coal.`;
  $('answer-points').innerHTML = [
    `<b>Demand growth took the solar.</b> Demand grew about 1.7% a year from 2020 to 2025, against 0.1% a year from 2005 to 2019, with data centres the main driver (${src(SOURCES.demand, 'EIA')}). Fossil's share of generation fell only from ${pc(then.fossilShare)} to ${pc(now.fossilShare)} over the same stretch of ${then.year} and ${now.year}.`,
    `<b>The fossil floor moved from the night to lunchtime.</b> The lowest fossil hour of the year came at night ${span(night)}, but on a spring weekend midday in ${list(day)}. This year's, ${gwf(now.fMin)} on ${when(now.fMinAt)} Eastern, is ${(now.fMin - low.gw).toFixed(1)} GW above the record, ${gwf(low.gw)} during the Covid lockdown.`,
    `<b>Coal came back in 2025.</b> Coal made ${twh(y25.twh.coal)} in 2025, ${pc((y25.twh.coal - y24.twh.coal) / y24.twh.coal)} more than in 2024, as gas got 56% dearer and federal emergency orders kept plants due to retire running. This year it is lower again, ${twh(now.coal)} against ${twh(yt25.coal)} over the same stretch of 2025, but above 2024's ${twh(yt24.coal)}.`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-solar', `Solar, ${toDate}`, `${twh(then.solar)} to ${twh(now.solar)}`, `${then.year} to ${now.year}; utility-scale only, rooftop solar is not in EIA-930`],
    ['--f-other', `Demand, ${toDate}`, `${twh(then.demand)} to ${twh(now.demand)}`, `up ${twh(now.demand - then.demand)}, more than the ${twh(now.solar - then.solar)} gain in solar`],
    ['--fossil', 'Lowest fossil hour this year', gwf(now.fMin), `${when(now.fMinAt)} Eastern; the record is ${gwf(low.gw)}, ${when(low.at)}`],
    ['--fossil', 'Hours with fossil under 150 GW', `${n0(now.under[0])} this year`, `against ${n0(y20.under[0])} in all of 2020`],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${twh(now.fossil)}</div><div class="sub">Fossil generation in the lower 48 from ${toDate} ${now.year}, against ${twh(then.fossil)} over the same days of ${then.year}.</div></div>
    <ul class="fact-list">${facts.map(([c, l, v, w]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: demand against solar, what runs and why, the fossil day, dear gas and coal, and what is coming.';

  const chapters = [
    'Demand grew as fast as solar',
    'Gas is the grid, coal the margin',
    'The fossil day turned inside out',
    'Dear gas brought coal back',
    'What is coming, and the records to watch',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });

  // Chapter 1: fossil against demand, by year.
  const ws = (r) => r.twh.wind + r.twh.solar;
  $('take-1').textContent = `Yearly wind and solar output grew by ${twh(ws(y25) - ws(first))} between ${first.year} and 2025, but demand grew by ${twh(y25.twh.demand - first.twh.demand)} and nuclear and hydro fell by ${twh(first.twh.nuclear + first.twh.hydro - y25.twh.nuclear - y25.twh.hydro)}, so fossil output rose.`;
  $('body-1').innerHTML = `The United States is the large grid where more renewables have not yet meant less fossil power. Fossil plants generated ${twh(first.twh.fossil)} in ${first.year} and ${twh(y25.twh.fossil)} in 2025. Over those years solar grew from ${twh(first.twh.solar)} to ${twh(y25.twh.solar)} and wind from ${twh(first.twh.wind)} to ${twh(y25.twh.wind)}. Demand grew from ${twh(first.twh.demand)} to ${twh(y25.twh.demand)}, nuclear fell from ${twh(first.twh.nuclear)} to ${twh(y25.twh.nuclear)} and hydro from ${twh(first.twh.hydro)} to ${twh(y25.twh.hydro)}. The new wind and solar covered the new load and the shortfall from older clean plants, and fossil output ended ${twh(y25.twh.fossil - first.twh.fossil)} higher. EIA puts the change plainly: load grew about 1.7% a year from 2020 to 2025 against 0.1% a year from 2005 to 2019, and data centres are the main driver (${src(SOURCES.demand, 'EIA')}). The fossil share fell from ${pc(first.fossilShare)} in ${first.year} to ${pc(latest.fossilShare)} in the latest 365 days, because the total grew, not because fossil plants ran less. 2022 reads low: about 500 hours of January 2022 are missing, as a large balancing authority did not report.`;
  $('chart-h-1').textContent = 'Fossil and other generation, and demand';
  $('chart-hint-1').textContent = 'TWh generated each calendar year; the last bar is the latest 365 days. Fossil sits at the bottom. Highlighted years made more fossil power than the first full year.';
  const ch1 = [
    { name: 'Fossil fuels', color: css('--fossil'), values: rows.map((r) => r.twh.fossil) },
    { name: 'Everything else', color: css('--lowcarbon'), values: rows.map((r) => r.twh.gen - r.twh.fossil) },
  ];
  barChart($('story-chart-1'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch1,
    yFormat: twh,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => rows[ci].twh.fossil > first.twh.fossil,
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong><div>Fossil: <b>${twh(rows[ci].twh.fossil)}</b>, ${pc(rows[ci].fossilShare)} of generation</div><div>Everything else: <b>${twh(rows[ci].twh.gen - rows[ci].twh.fossil)}</b></div><div>Demand: <b>${twh(rows[ci].twh.demand)}</b></div>`,
  });
  $('story-legend-1').innerHTML = legend(ch1.map((sr) => [sr.name, sr.color]).reverse());

  // Chapter 2: the mix by year, and what is kept on by order.
  $('take-2').textContent = `Gas made ${pc(y25.gasShare)} of US generation in 2025 and coal ${pc(y25.coalShare)}. Most of it runs because the load is there; a smaller slice is kept on by federal order.`;
  $('body-2').innerHTML = `In 2025 gas plants generated ${twh(y25.twh.gas)}, coal ${twh(y25.twh.coal)} and oil ${twh(y25.twh.oil)}. Gas follows demand: the busiest fossil hour of 2025 was ${gwf(y25.fMax)} on ${when(y25.fMaxAt)} Eastern, the same day demand set the record in this data, ${gwf(demTop.demMax)} at ${when(demTop.demMaxAt).split(' at ')[1]}. Even at its quietest hour this year fossil output was ${gwf(now.fMin)}. We infer, as the data does not say, that this floor is combined heat and power, plants held at minimum output so they are ready for the evening, and plants that local grids need running. A separate, smaller slice runs for policy reasons. The Department of Energy has used Federal Power Act section 202(c) emergency orders to keep coal plants open past their planned closures: J.H. Campbell in Michigan since 31 May 2025, and from December 2025 Centralia 2 in Washington (730 MW), Craig 1 in Colorado (446 MW), and F.B. Culley 2 (104 MW) and R.M. Schahfer 17 and 18 (847 MW) in Indiana (${src(SOURCES.orders, 'FactSet')}). The December orders cover about 2.1 GW, against a coal fleet that averaged ${gwf(coalAvg25)} of output in 2025.`;
  $('chart-h-2').textContent = 'Yearly generation by source';
  $('chart-hint-2').textContent = 'TWh generated each calendar year; the last bar is the latest 365 days. Batteries and pumped storage are separate from July 2024; before that they sit in other and hydro.';
  const ch2 = [
    ['Coal', '--f-coal', 'coal'], ['Gas', '--f-gas', 'gas'], ['Oil', '--f-diesel', 'oil'], ['Nuclear', '--f-nuclear', 'nuclear'],
    ['Hydro', '--f-hydro', 'hydro'], ['Pumped storage', '--f-hydro-2', 'pumped_storage'], ['Wind', '--f-wind', 'wind'], ['Solar', '--f-solar', 'solar'],
    ['Geothermal', '--f-geo', 'geothermal'], ['Batteries', '--f-battery', 'battery'], ['Other', '--f-other', 'other'],
  ].map(([name, color, key]) => ({ name, color: css(color), key, values: rows.map((r) => r.twh[key] ?? 0) }));
  barChart($('story-chart-2'), {
    cats: rows.map((r) => label(r.year)),
    stacks: ch2,
    yFormat: twh,
    yTickFormat: (v) => n0(v),
    tooltip: (ci) => `<strong>${title(rows[ci].year)}</strong>${[...ch2].reverse().filter((sr) => sr.values[ci] > 0.05).map((sr) => `<div><i style="background:${sr.color}"></i>${sr.name}: <b>${twh(sr.values[ci])}</b></div>`).join('')}`,
  });
  $('story-legend-2').innerHTML = legend([...ch2].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 3: the fossil day.
  $('take-3').textContent = 'Solar has hollowed out the middle of the fossil day, so the lowest fossil hour is now a spring weekend lunchtime and the gas peak comes after dark.';
  $('body-3').innerHTML = `In ${first.year} average gas output was lowest at ${hh(nightLow0)} Eastern, ${gwf(g0[nightLow0])}, and climbed steadily to ${gwf(g0[eve0])} at ${hh(eve0)}. In the latest 365 days the curve is a duck: ${gwf(gN[nightLowN])} at ${hh(nightLowN)}, a midday trough of ${gwf(gN[noonN])} at ${hh(noonN)} while solar averages ${gwf(latest.hourly.solar[noonN])}, then a climb to ${gwf(gN[eveN])} at ${hh(eveN)}. Since ${y23.year}, gas at ${hh(noonN)} has gone from ${gwf(y23.hourly.gas[noonN])} to ${gwf(gN[noonN])}, while gas at ${hh(eveN)} has gone from ${gwf(y23.hourly.gas[eveN])} to ${gwf(gN[eveN])}. The records show the same shift. The lowest fossil hour of the year came at night ${span(night)}; in ${list(day)} it came in the middle of a spring day, this year at ${when(now.fMinAt)}, with ${gwf(now.fMin)}. Hours with fossil under 150 GW: ${ytdRows.map((r) => `${n0(r.year === now.year ? r.under[0] : row(r.year).under[0])} in ${r.year}`).join(', ')} so far. Batteries have started to lean on the evening: average discharge at 21:00 is ${gwf(latest.hourly.battery[21])} in the latest 365 days against ${gwf(y25.hourly.battery[21])} in 2025, and the highest battery hour is ${gwf(batTop.batMax)}, on ${when(batTop.batMaxAt)}.`;
  $('chart-h-3').textContent = 'Gas output by hour of day';
  $('chart-hint-3').textContent = 'Average output for each hour of the day, US Eastern time, in GW. Solar and batteries are for the latest 365 days.';
  const hourX = (h) => h * 3600000;
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((h) => ({ t: hourX(h), label: hh(h) }));
  const ch3 = [
    { name: `Gas, ${first.year}`, color: css('--f-other'), points: g0.map((v, h) => [hourX(h), v]), width: 2 },
    { name: `Gas, ${y23.year}`, color: css('--f-diesel'), points: y23.hourly.gas.map((v, h) => [hourX(h), v]), width: 2 },
    { name: 'Gas, latest 365 days', color: css('--f-gas'), points: gN.map((v, h) => [hourX(h), v]), width: 3 },
    { name: 'Solar, latest 365 days', color: css('--f-solar'), points: latest.hourly.solar.map((v, h) => [hourX(h), v]), width: 2 },
    { name: 'Batteries, latest 365 days', color: css('--f-battery'), points: latest.hourly.battery.map((v, h) => [hourX(h), v]), width: 2 },
  ];
  lineChart($('story-chart-3'), {
    series: ch3,
    yMin: 0,
    yFormat: gwf,
    yTickFormat: (v) => n0(v),
    xTicks: hourTicks,
    tooltip: (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? gwf(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-3').innerHTML = legend(ch3.map((sr) => [sr.name, sr.color]));

  // Chapter 4: coal and gas over the same days of each year.
  $('take-4').textContent = 'Coal rose in 2025 because gas got 56% dearer, and some plants that should have closed were ordered to stay open, at a cost not yet settled.';
  $('body-4').innerHTML = `Coal generation was ${twh(y24.twh.coal)} in 2024 and ${twh(y25.twh.coal)} in 2025, its first rise since 2021. EIA gives the reason: Henry Hub gas averaged $3.52/MMBtu in 2025, 56% more than in 2024, and as gas sets the wholesale price in most hours in most markets, power prices rose with it. Cheaper coal units ran more, up 11% on EIA's figures, and gas ran less, down 3% (${src(SOURCES.prices2025, 'EIA')}). This data agrees: coal ${twh(y25.twh.coal - y24.twh.coal)} higher, gas ${twh(y24.twh.gas - y25.twh.gas)} lower. The price signal can reverse, and this year coal is running below 2025, ${twh(now.coal)} from ${toDate} against ${twh(yt25.coal)} over the same days of 2025, though above 2024's ${twh(yt24.coal)}. The orders are another matter. At J.H. Campbell, the first plant kept open by order, costs had passed $248 million by June 2026, about $642,000 a day, according to the company's filings, and the order had been reissued six times (${src(SOURCES.court, 'Earthjustice')}). FactSet notes that who will carry the cost is still an open question (${src(SOURCES.orders, 'FactSet')}).`;
  $('chart-h-4').textContent = `Coal and gas, ${toDate} each year`;
  $('chart-hint-4').textContent = `TWh over the same days of each year, so ${now.year} compares like for like. Highlighted: coal above the year before.`;
  const ch4 = [
    { name: 'Coal', color: css('--f-coal'), values: ytdRows.map((r) => r.coal) },
    { name: 'Gas', color: css('--f-gas'), values: ytdRows.map((r) => r.gas) },
  ];
  barChart($('story-chart-4'), {
    cats: ytdRows.map((r) => String(r.year)),
    stacks: ch4,
    yFormat: twh,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => ci > 0 && ytdRows[ci].coal > ytdRows[ci - 1].coal,
    tooltip: (ci) => `<strong>${ytdRows[ci].year}, ${toDate}</strong><div>Coal: <b>${twh(ytdRows[ci].coal)}</b></div><div>Gas: <b>${twh(ytdRows[ci].gas)}</b></div>`,
  });
  $('story-legend-4').innerHTML = legend([...ch4].reverse().map((sr) => [sr.name, sr.color]));

  // Chapter 5: what's coming, and the floor by year.
  $('take-5').textContent = 'A record 86 GW of new capacity is due in 2026, but EIA expects gas generation to rise through 2027 either way, so the records to watch are the midday floor and the evening peak.';
  $('body-5').innerHTML = `EIA expected a record 86 GW of new capacity in 2026: 43.4 GW of solar, 24 GW of batteries, 11.8 GW of wind and 6.3 GW of gas (${src(SOURCES.capacity2026, 'EIA')}). The tax rules have tightened behind it: wind and solar had to begin construction by 4 July 2026, or be in service by the end of 2027, to keep their credits (${src(SOURCES.credits, 'Norton Rose Fulbright')}). On the demand side, EIA's baseline has load rising 1.9% in 2026 and 2.5% in 2027; coal falls 9.3% from 2025 to 2027 and gas rises 1.7%, and with faster data-centre growth gas rises 7.3% (${src(SOURCES.demand, 'EIA')}). The coal orders face a test after the D.C. Circuit's ruling of 11 September 2026 (${src(SOURCES.court, 'Earthjustice')}). The records to watch, in order: the lowest fossil hour (${gwf(now.fMin)} this year, ${(now.fMin - low.gw).toFixed(1)} GW above the record), hours under 150 GW (${n0(now.under[0])} this year), the highest battery hour (${gwf(batTop.batMax)}), the highest solar hour (${gwf(solTop.solMax)}, ${dayFmt.format(at(solTop.solMaxAt))}), and whether ${now.year} makes less fossil power than ${lastFull.year}'s ${twh(lastFull.twh.fossil)}.`;
  $('chart-h-5').textContent = 'The lowest fossil hour each year';
  $('chart-hint-5').textContent = `The lowest hour of fossil output each year, in GW; ${now.year} so far. Highlighted bars came in the day (09:00 to 17:59 Eastern), the rest at night.`;
  const lowRows = ytdRows.map((r) => ({ year: r.year, gw: r.fMin, at: r.fMinAt, under: r.year === now.year ? r.under[0] : row(r.year).under[0] }));
  barChart($('story-chart-5'), {
    cats: lowRows.map((r) => String(r.year)),
    stacks: [{ name: 'Lowest fossil hour', color: css('--fossil'), values: lowRows.map((r) => r.gw) }],
    yFormat: gwf,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => isDay(lowRows[ci].at),
    tooltip: (ci) => `<strong>${lowRows[ci].year}</strong><div>Lowest fossil hour: <b>${gwf(lowRows[ci].gw)}</b></div><div>${when(lowRows[ci].at)} Eastern</div><div>Hours under 150 GW: <b>${n0(lowRows[ci].under)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend([['Lowest fossil hour', css('--fossil')]]);
  $('coming').innerHTML = COMING.map(([w, what, source, record]) => `<li><span class="swatch" style="background:var(--f-gas)"></span><span><b>${w}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}
