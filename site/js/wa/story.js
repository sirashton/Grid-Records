// The Western Australia story: why Perth's isolated grid still burns coal and
// gas at every hour of every day. Batteries have taken the evening peak from
// coal in three years, but gas has taken most of the rest, coal units that
// are paid whether or not they run are kept at minimum load for system
// security, and at midday there is nothing to export, so the batteries charge
// alongside the fossil floor rather than from a surplus. The figures are
// worked out from the data by storyFigures(), which the tests also run;
// renderStory() draws the page. Drafted with Alex's answer-first structure:
// the answer, three supporting points, then five chapters ending with what
// is coming and the record each item should move.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import wa from '../countries/wa.js';

// The evening peak, local hours [from, to).
export const EVENING = [17, 21];
// The middle of the day, local hours [from, to], when rooftop solar peaks.
export const NOON = [11, 14];
// The year the story compares against: the last before rooftop solar and batteries changed the grid's shape.
export const BASE_YEAR = 2019;
// Coal levels for the spells the story quotes, in MW.
export const COAL_LEVELS = [1000, 300, 250];
// Fossil (coal, gas and diesel) below this runs whatever the sun does: the
// floor, in MW. Batteries are sized against the fossil above it.
export const FOSSIL_FLOOR = 400;
// Fossil under this counts as a low-fossil hour, in MW.
export const FOSSIL_LOW = 1000;
// Battery fleets (GW, GWh) the story tests against each day's fossil above the
// floor. The first is about the fleet built so far.
export const BATTERIES = [[1.5, 6], [2.5, 10], [5, 20], [10, 40]];
const GEN = ['coal', 'gas', 'oil', 'biomass', 'wind', 'solar_utility', 'solar_rooftop', 'other'];
const RENEW = ['wind', 'solar_utility', 'solar_rooftop', 'biomass'];

/** Local year, month ("YYYY-MM"), hour, day of year and day number for every slot, with the offset looked up once per UTC day. */
function localClock(data, end) {
  const stepMs = stepOf(data) * 60000;
  const year = new Uint16Array(end);
  const hour = new Uint8Array(end);
  const doy = new Uint16Array(end);
  const day = new Int32Array(end);
  const month = new Array(end);
  let utcDay = -1;
  let offset = 0;
  for (let i = 0; i < end; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== utcDay) {
      utcDay = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, wa.timeZone);
    }
    const local = new Date(t + offset);
    year[i] = local.getUTCFullYear();
    hour[i] = local.getUTCHours();
    doy[i] = Math.floor((local - Date.UTC(year[i], 0, 1)) / 864e5);
    day[i] = Math.floor((t + offset) / 864e5);
    month[i] = local.toISOString().slice(0, 7);
  }
  return { year, hour, doy, day, month };
}

const num = (v) => (Number.isNaN(v) ? 0 : v);
const mean = (sum, n) => (n ? sum / n : NaN);

/**
 * Every number the story uses. Rows run by Perth calendar year, the first
 * and the current one partial (`partial` says so). Demand excluding charging
 * is operational demand less what grid batteries took, since AEMO's
 * operational demand counts battery charging as demand. Fossil is coal, gas
 * and diesel together.
 */
export function storyFigures(data, end) {
  const c = data.columns;
  const step = stepOf(data);
  const slotH = step / 60;
  const { year, hour, doy, day, month } = localClock(data, end);
  const blank = (y) => ({
    year: y, slots: 0, twh: Object.fromEntries([...GEN, 'battery'].map((k) => [k, 0])),
    coalMin: Infinity, coalSum: 0, demandMin: Infinity, demandMinAt: -1, underMin: Infinity, underMinAt: -1,
    fosMin: Infinity, fosMinAt: -1, gasMin: Infinity, gasMinAt: -1, fosLow: 0, fosMonth: new Float64Array(12),
    eve: { coal: 0, gas: 0, battery: 0, n: 0 },
    noon: { fos: 0, charge: 0, n: 0 },
    byHour: Array.from({ length: 24 }, () => ({ coal: 0, gas: 0, fos: 0, wind: 0, battery: 0, roof: 0, demand: 0, n: 0 })),
    day: null, days: [],
  });
  const rows = new Map();
  const months = new Map();
  let batteryShare = { pct: 0, at: -1 };
  for (let i = 0; i < end; i++) {
    if (Number.isNaN(c.coal[i])) continue;
    const y = year[i];
    let r = rows.get(y);
    if (!r) { r = blank(y); rows.set(y, r); }
    r.slots++;
    let gen = 0;
    for (const k of GEN) { const v = num(c[k][i]); r.twh[k] += (v * slotH) / 1e6; gen += v; }
    const dis = num(c.battery[i]);
    const chg = num(c.battery_charge[i]);
    const gas = num(c.gas[i]);
    const fos = c.coal[i] + gas + num(c.oil[i]);
    r.twh.battery += (dis * slotH) / 1e6;
    if (c.coal[i] < r.coalMin) r.coalMin = c.coal[i];
    r.coalSum += c.coal[i];
    if (fos < r.fosMin) { r.fosMin = fos; r.fosMinAt = i; }
    if (gas < r.gasMin) { r.gasMin = gas; r.gasMinAt = i; }
    if (fos < FOSSIL_LOW) r.fosLow += slotH;
    r.fosMonth[Number(month[i].slice(5)) - 1] += (fos * slotH) / 1000;
    const d = c.demand[i];
    if (d < r.demandMin) { r.demandMin = d; r.demandMinAt = i; }
    if (d + chg < r.underMin) { r.underMin = d + chg; r.underMinAt = i; }
    if (hour[i] >= EVENING[0] && hour[i] < EVENING[1]) {
      r.eve.coal += c.coal[i]; r.eve.gas += gas; r.eve.battery += dis; r.eve.n++;
    }
    if (hour[i] >= NOON[0] && hour[i] <= NOON[1]) { r.noon.fos += fos; r.noon.charge -= chg; r.noon.n++; }
    const h = r.byHour[hour[i]];
    h.coal += c.coal[i]; h.gas += gas; h.fos += fos; h.wind += num(c.wind[i]); h.battery += dis + chg; h.roof += num(c.solar_rooftop[i]); h.demand += d; h.n++;
    // Each day's fossil above the floor, for the battery sizing.
    if (r.day?.n !== day[i]) {
      if (r.day) r.days.push(r.day);
      r.day = { n: day[i], month: Number(month[i].slice(5)), gwh: 0, peak: 0, solar: 0, slots: 0 };
    }
    r.day.gwh += (Math.max(0, fos - FOSSIL_FLOOR) * slotH) / 1000;
    r.day.peak = Math.max(r.day.peak, (fos - FOSSIL_FLOOR) / 1000);
    r.day.solar += ((num(c.solar_rooftop[i]) + num(c.solar_utility[i])) * slotH) / 1000;
    r.day.slots++;
    const supply = gen - num(c.solar_rooftop[i]) + dis;
    if (supply > 0 && dis / supply > batteryShare.pct) batteryShare = { pct: dis / supply, at: i };
    const m = months.get(month[i]) ?? { month: month[i], coal: 0, gas: 0, battery: 0 };
    m.coal += (c.coal[i] * slotH) / 1000; m.gas += (gas * slotH) / 1000; m.battery += (dis * slotH) / 1000;
    months.set(month[i], m);
  }
  const fullYear = 360 * 24 / slotH;
  const fullDay = 24 / slotH;
  const years = [...rows.values()].map((r) => {
    const total = GEN.reduce((s, k) => s + r.twh[k], 0);
    // Whole days only, smallest first.
    const days = (r.day ? [...r.days, r.day] : r.days).filter((x) => x.slots >= fullDay).sort((a, b) => a.gwh - b.gwh);
    return {
      year: r.year,
      partial: r.slots < fullYear,
      twh: r.twh,
      total,
      fossil: r.twh.coal + r.twh.gas + r.twh.oil,
      renewablePct: total ? (RENEW.reduce((s, k) => s + r.twh[k], 0) / total) * 100 : NaN,
      coalMin: r.coalMin,
      coalAvg: r.coalSum / r.slots,
      fosMin: r.fosMin,
      fosMinAt: r.fosMinAt,
      gasMin: r.gasMin,
      gasMinAt: r.gasMinAt,
      // Hours with fossil under FOSSIL_LOW.
      fosLow: r.fosLow,
      // Fossil GWh in each calendar month.
      fosMonth: [...r.fosMonth],
      demandMin: r.demandMin,
      demandMinAt: r.demandMinAt,
      underMin: r.underMin,
      underMinAt: r.underMinAt,
      eve: { coal: mean(r.eve.coal, r.eve.n), gas: mean(r.eve.gas, r.eve.n), battery: mean(r.eve.battery, r.eve.n) },
      // Average fossil output and battery charging in the middle of the day.
      noon: { fos: mean(r.noon.fos, r.noon.n), charge: mean(r.noon.charge, r.noon.n) },
      byHour: r.byHour.map((h) => (h.n ? { coal: h.coal / h.n, gas: h.gas / h.n, fos: h.fos / h.n, wind: h.wind / h.n, battery: h.battery / h.n, roof: h.roof / h.n, demand: h.demand / h.n } : null)),
      // Each whole day's fossil above the floor (GWh), its peak above the floor (GW), month and solar (GWh), smallest first.
      days,
      aboveTwh: days.reduce((s, x) => s + x.gwh, 0) / 1000,
      // Days a battery fleet could have covered, if it was full: the day's fossil above the floor within its energy, and the peak within its power.
      batteries: BATTERIES.map(([gw, gwh]) => ({ gw, gwh, days: days.filter((x) => x.gwh <= gwh && x.peak <= gw).length })),
    };
  });

  // This year so far against the same days of last year.
  const last = years.at(-1);
  const upTo = doy[end - 1];
  const ytd = { coal: [0, 0], gas: [0, 0], battery: [0, 0] };
  for (let i = 0; i < end; i++) {
    const k = year[i] === last.year ? 1 : year[i] === last.year - 1 ? 0 : -1;
    if (k < 0 || doy[i] > upTo || Number.isNaN(c.coal[i])) continue;
    ytd.coal[k] += c.coal[i];
    ytd.gas[k] += num(c.gas[i]);
    ytd.battery[k] += num(c.battery[i]);
  }
  const twhOf = (v) => (v * slotH) / 1e6;
  const change = (a) => (a[0] ? ((a[1] - a[0]) / a[0]) * 100 : NaN);
  const yearToDate = { upToMs: slotTime(end - 1, data.startMs, step), coal: change(ytd.coal), gas: change(ytd.gas), fossil: change([ytd.coal[0] + ytd.gas[0], ytd.coal[1] + ytd.gas[1]]),
    // TWh change on the same days: coal (negative when it falls), gas and battery discharge.
    delta: Object.fromEntries(['coal', 'gas', 'battery'].map((k) => [k, twhOf(ytd[k][1] - ytd[k][0])])) };

  const opts = { startMs: data.startMs, stepMinutes: step, timeZone: wa.timeZone };
  const coal = Float64Array.from({ length: end }, (_, i) => c.coal[i]);
  const fossil = Float64Array.from({ length: end }, (_, i) => c.coal[i] + num(c.gas[i]) + num(c.oil[i]));
  const coalSpells = Object.fromEntries(COAL_LEVELS.map((t) => [t, summarise(coal, t, 'below', opts).record]));
  const fossilSpells = Object.fromEntries([500, FOSSIL_LOW].map((t) => [t, summarise(fossil, t, 'below', opts).record]));
  return { years, monthly: [...months.values()], yearToDate, coalSpells, fossilSpells, batteryShare, end };
}

// Drawing. The tests run only the figures above, so these need no DOM.

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const n0 = (v) => Math.round(v).toLocaleString('en-AU');
const mw = (v) => `${n0(v)} MW`;
const twh = (v) => `${v.toFixed(1)} TWh`;
const twh2 = (v) => `${v.toFixed(2)} TWh`;
const gwh = (v) => `${n0(v)} GWh`;
const pct = (v) => `${v.toFixed(1)}%`;
const hrs = (v) => `${n0(v)} hours`;
const aud = (v) => `$${n0(v)}`;
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const src = (url, text) => `<a href="${url}">${text}</a>`;
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const monthName = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthFull = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const hourX = (hr) => hr * 3600000;
const hh = (hr) => `${String(hr).padStart(2, '0')}:00`;
const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: hh(hr) }));
const hourTip = (fmt) => (t, vals) => `<strong>${hh(Math.round(t / 3600000))}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? fmt(v.value) : '—'}</b></div>`).join('')}`;
const hours = (rec, step) => ((rec.end - rec.start) * step) / 60;
const hoursText = (h) => (h >= 72 ? `${n0(h / 24)} days` : `${+h.toFixed(1)} hours`);

const SOURCES = {
  kwinana: 'https://reneweconomy.com.au/big-battery-to-the-rescue-as-rooftop-pv-pushes-biggest-isolated-grid-to-record-demand-lows/',
  collie: 'https://reneweconomy.com.au/this-australian-utility-will-soon-be-the-first-to-have-more-big-battery-capacity-than-coal',
  neoen: 'https://www.pv-magazine-australia.com/2025/08/25/neoen-reaches-operational-milestone-with-collie-battery/',
  ncess: 'https://reneweconomy.com.au/the-eye-watering-payments-being-made-to-big-batteries-to-squash-huge-solar-duck/',
  lowLoad: 'https://www.wa.gov.au/system/files/2023-04/NCESS%20Trigger%20Submission-Low%20Load-redacted%20%281%29.pdf',
  esoo: 'https://www.aemo.com.au/-/media/files/electricity/wem/planning_and_forecasting/esoo/2025/2025-wem-esoo-visual-overview.pdf',
  rooftop81: 'https://www.pv-magazine-australia.com/2024/11/13/worth-its-weight-in-sunshine-rooftop-solar-clocks-new-supply-records/',
  esm: 'https://aemo.com.au/initiatives/major-programs/wa-der-program/emergency-solar-management',
  inertia: 'https://www.boilingcold.com.au/synergy-pushes-ageing-coal-plants/',
  alinta: 'https://alintaenergy.com.au/about-us/power-generation',
  rcp: 'https://aemo.com.au/en/energy-systems/electricity/wholesale-electricity-market-wem/wa-reserve-capacity-mechanism/reserve-capacity-price',
  brcp: 'https://www.erawa.com.au/cproot/23833/2/2024-benchmark-reserve-capacity-price-for-the-202627-capacity-year.PDF',
  brcpBattery: 'https://www.pv-magazine-australia.com/2024/12/19/wa-capacity-pricing-benchmark-swaps-gas-for-batteries-and-ups-returns-57',
  bluewaters: 'https://www.boilingcold.com.au/wa-needs-bluewaters-coal-fired-power-until-2028-but-the-dollars-do-not-add-up/',
  synergyLoss: 'https://reneweconomy.com.au/utility-giant-writes-off-coal-assets-as-it-transitions-to-renewables-and-storage',
  budget: 'https://www.ourstatebudget.wa.gov.au/2026-27/budget-papers/bp2/2026-27-wa-state-budget-bp2-part12.pdf',
  takeOrPay: 'https://www.collie.wa.gov.au/news/take-or-pay-security-for-coal/2559/',
  gasPrice: 'https://www.boilingcold.com.au/woodside-has-doubled-its-wa-gas-price-in-5-years/',
  qedQ3: 'https://www.aemo.com.au/-/media/files/major-publications/qed/2025/qed-q3-2025.pdf',
  qedQ2: 'https://www.aemo.com.au/newsroom/media-release/qed-q2-2026',
  exit: 'https://www.pv-magazine-australia.com/2022/06/15/western-australia-to-exit-coal-by-2029-in-response-to-competition-from-solar',
  kingRocks: 'https://reneweconomy.com.au/synergy-kicks-off-construction-of-new-wheatbelt-wind-farm-as-race-to-quit-coal-continues',
  warradarge: 'https://www.wa.gov.au/government/media-statements/Cook%20Labor%20Government/Construction-starts-on-Warradarge-Wind-Farm-Stage-2-20250729',
  griffin: 'https://www.wa.gov.au/government/media-statements/Cook%20Labor%20Government/Griffin-Coal-extension-delivers-certainty-for-jobs-and-energy-20260121',
  gasPolicy: 'https://wa.gov.au/government/announcements/domestic-gas-policy-updated-secure-was-energy-future',
  gsoo: 'https://www.aemo.com.au/newsroom/media-release/western-australia-domestic-gas-market-to-remain-balanced-in-near-term',
};

// The Reserve Capacity Price paid for each MW of accredited capacity, $/MW
// a year, by capacity year (October to October): the ERA's 2025-26 and
// 2026-27 benchmarks and AEMO's 2027-28 price.
export const CAPACITY_PRICE = { '2025-26': 193400, '2026-27': 230000, '2027-28': 360700 };
// Rough fuel cost of gas power at Woodside's 2024 domestic price of $6.50 a
// gigajoule: a combined-cycle plant at 50% efficiency and an open-cycle
// peaker at 33%, in $/MWh. An estimate, not a market figure. Australia has
// no carbon price on the power these plants make.
export const GAS_PRICE_GJ = 6.5;
export const CCGT_COST = (GAS_PRICE_GJ * 3.6) / 0.5;
export const OCGT_COST = (GAS_PRICE_GJ * 3.6) / 0.33;

// What is coming, dated and sourced, with the record each item should move.
export const COMING = [
  ['1 Oct 2026', 'The Reserve Capacity Price rises to $230,000 for each MW a year for 2026-27, paid to every accredited plant, coal and gas included.', 'brcp', 'The fossil floor: paying plants to stay open works against it falling.'],
  ['By Oct 2027', 'AEMO counts 806 MW more battery storage as committed, on top of the 500 MW built since 2023, plus 106 MW of new gas plant.', 'esoo', 'Battery output peak (over 1 GW); evening coal and gas between 17:00 and 21:00.'],
  ['2027', 'Warradarge wind farm grows by 103 MW to 283 MW, and Synergy\'s 105 MW King Rocks wind farm is built, the first new wind on the grid for years.', 'warradarge', 'Most wind; hours a year with fossil under 1 GW.'],
  ['Oct 2027', 'Collie power station (340 MW), the state\'s biggest coal unit, closes.', 'exit', 'The coal floor of about 200 MW, and the spells with coal under 500 MW and 300 MW.'],
  ['1 Oct 2027', 'The capacity price jumps to $360,700 a MW for 2027-28, the first year the benchmark is a battery rather than a gas peaker.', 'rcp', 'Whether gas peakers keep their capacity credits, and the gas floor.'],
  ['Oct 2028', 'Bluewaters\' capacity credits (434 MW, two private coal units) run out; nothing beyond that date is contracted.', 'bluewaters', 'Coal has never been off: the first coal-free half hour depends on this plant.'],
  ['Late 2029', 'Muja 7 and 8 (227 MW each), the last state-owned coal units, close.', 'kingRocks', 'The coal floor falls to Bluewaters alone; lowest coal half hour.'],
  ['2030 to 2031', 'Synergy\'s take-or-pay coal contract runs to 2030; Griffin Coal\'s state agreement, the mine that feeds Bluewaters, is extended up to five years from July 2026.', 'griffin', 'Coal spells after the state exit: under 250 MW, then zero.'],
  ['31 Dec 2030', 'Onshore gas fields lose the right to export a fifth of their output and must sell it all in WA. AEMO sees a possible gas gap of 11 TJ a day in 2030 and expects gas burnt for power to rise as coal closes.', 'gasPolicy', 'Gas\'s biggest month; winter gas from June to August.'],
  ['To 2034-35', 'AEMO expects consumption on the grid to grow from about 20 TWh to 28 TWh.', 'esoo', 'Coal and gas together, which demand growth keeps from falling.'],
];

export function renderStory(data, end, figs) {
  const { years, monthly, yearToDate, coalSpells, fossilSpells, batteryShare } = figs;
  const full = years.filter((r) => !r.partial);
  if (!full.length) return;
  const step = stepOf(data);
  const at = (i) => slotTime(i, data.startMs, step);
  const row = (y) => years.find((r) => r.year === y);
  const latest = years.at(-1);
  const named = (r) => (r.partial && r === latest ? `${r.year} so far` : String(r.year));
  const base = row(BASE_YEAR) ?? full[0];
  const firstBattery = years.find((r) => r.eve.battery >= 1) ?? latest;
  const lastFull = full.at(-1);
  const coalMinRow = years.reduce((a, r) => (r.coalMin < a.coalMin ? r : a), years[0]);
  const fosMinRow = years.reduce((a, r) => (r.fosMin < a.fosMin ? r : a), years[0]);
  const gasMinRow = years.reduce((a, r) => (r.gasMin < a.gasMin ? r : a), years[0]);
  const demandMinRow = years.reduce((a, r) => (r.demandMin < a.demandMin ? r : a), years[0]);
  const underMinRow = years.reduce((a, r) => (r.underMin < a.underMin ? r : a), years[0]);
  const gasAhead = years.find((r) => !r.partial && r.twh.gas > r.twh.coal && years.filter((x) => x.year >= r.year && !x.partial).every((x) => x.twh.gas > x.twh.coal));
  // This year's biggest gas month, and the last month before it with more.
  const gasTop = monthly.filter((m) => m.month.startsWith(String(latest.year))).reduce((a, m) => (m.gas > a.gas ? m : a), { gas: -1 });
  const gasHigher = monthly.filter((m) => m.month < gasTop.month && m.gas > gasTop.gas).at(-1);
  const dt = yearToDate.delta;
  const peakAt = (r, k) => r.byHour.reduce((a, h, hr) => (h && h[k] > a.v ? { v: h[k], hr } : a), { v: -Infinity, hr: 0 });
  const lowAt = (r, k) => r.byHour.reduce((a, h, hr) => (h && h[k] < a.v ? { v: h[k], hr } : a), { v: Infinity, hr: 0 });
  const coal1000 = coalSpells[1000];
  const coal250 = coalSpells[250];
  const coal300 = coalSpells[300];
  const fos500 = fossilSpells[500];
  const fos1000 = fossilSpells[FOSSIL_LOW];
  const live = (rec) => rec && rec.end >= end - 1;
  const since2020 = years.filter((r) => r.year >= 2020).map((r) => r.coalMin);
  const pc = (v) => `${Math.round(v)}%`;
  const bat = (k) => lastFull.batteries[k];
  const median = lastFull.days[Math.floor(lastFull.days.length / 2)];
  const worst = lastFull.days.at(-1);
  const monthLow = (r) => r.fosMonth.reduce((a, v, k) => (v < r.fosMonth[a] ? k : a), 0);
  const monthHigh = (r) => r.fosMonth.reduce((a, v, k) => (v > r.fosMonth[a] ? k : a), 0);
  // The summer peak: the biggest of December, January and February.
  const summerHigh = (r) => [11, 0, 1].reduce((a, k) => (r.fosMonth[k] > r.fosMonth[a] ? k : a), 11);
  const fosNoon = lowAt(lastFull, 'fos');
  const fosEve = peakAt(lastFull, 'fos');

  // Header and in short.
  $('lede').textContent = `Perth's grid stands alone, and it burns coal and gas at every hour of every day. Batteries took the evening peak from coal in three years, but gas took most of what coal gave up, and under ${(peakAt(lastFull, 'roof').v / 1000).toFixed(1)} GW of rooftop solar at midday the fossil plants still ran at ${mw(fosNoon.v)} on average in ${lastFull.year}.`;
  $('answer-lead').textContent = `Fossil plant runs on the South West Interconnected System for three reasons. After sunset nothing else is big enough, so gas carries the evening on a grid with no neighbour to import from. Coal units that are paid whether or not they run are kept at minimum load through the day for system security, so coal has never been off in twenty years. And at midday nothing can be exported, so the batteries charge alongside a fossil floor of about ${(fosNoon.v / 1000).toFixed(1)} GW rather than from a surplus. The state's coal closes by 2029, but the private Bluewaters plant holds capacity credits to 2028 and coal to 2031, and AEMO expects gas to rise, so the records to watch are the fossil floor and the hours with fossil under 1 GW.`;
  $('answer-points').innerHTML = [
    `<b>Batteries took the evening from coal; gas kept its place.</b> Battery output between ${hh(EVENING[0])} and ${hh(EVENING[1])} averaged ${mw(latest.eve.battery)} in ${named(latest)}, up from ${mw(firstBattery.eve.battery)} in ${firstBattery.year}, while evening coal fell from ${mw(base.eve.coal)} in ${base.year} to ${mw(latest.eve.coal)}. Evening gas was ${mw(base.eve.gas)} in ${base.year} and ${mw(latest.eve.gas)} now. ${link(1, 'Chapters 1')} and ${link(2, '2')}`,
    `<b>The floor is paid for.</b> Coal has never run below ${mw(coalMinRow.coalMin)}, and coal and gas together never below ${mw(fosMinRow.fosMin)}. Every accredited megawatt earns ${aud(CAPACITY_PRICE['2025-26'])} a year whether it runs or not, Synergy's coal is bought under a take-or-pay contract to 2030, and AEMO keeps synchronous plant on for security at low load. ${link(3, 'Chapter 3')}`,
    `<b>Batteries cannot replace the rest without new wind and solar.</b> Fossil above ${FOSSIL_FLOOR} MW came to ${twh(lastFull.aboveTwh)} in ${lastFull.year}. A fleet the size of today's (${bat(0).gw} GW, ${bat(0).gwh} GWh) would have covered it on ${bat(0).days} days; ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}, and only if there were spare clean power to charge from, which at midday there is not yet. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--fossil', 'Lowest coal and gas together', mw(fosMinRow.fosMin), `on ${fmtDate(at(fosMinRow.fosMinAt))}; fossil has never been off`],
    ['--f-coal', 'Lowest coal half hour ever', mw(coalMinRow.coalMin), `in ${coalMinRow.year}; coal has never been off`],
    ['--f-battery', 'Lowest demand without battery charging', mw(underMinRow.underMin), `on ${fmtDate(at(underMinRow.underMinAt))}; the lowest as AEMO counts it, charging included, is ${mw(demandMinRow.demandMin)}`],
    ['--fossil', `Longest spell with fossil under ${FOSSIL_LOW.toLocaleString('en-AU')} MW`, fos1000 ? hoursText(hours(fos1000, step)) : 'None', fos1000 ? `from ${fmtDate(at(fos1000.start))}${live(fos1000) ? ', still going' : ''}: the record to beat` : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${mw(fosNoon.v)}</div><div class="sub">Average coal and gas output at ${hh(fosNoon.hr)}, the lowest hour of the day, in ${lastFull.year}. At ${hh(fosEve.hr)} it was ${mw(fosEve.v)}.</div></div>
    <ul class="fact-list">${facts.map(([cl, l, v, w]) => `<li><span class="swatch" style="background:var(${cl})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: when coal and gas run, the batteries that took the evening from coal but not from gas, who pays the floor, what batteries could and could not replace, and what is coming, with the record each item should move.';

  const chapters = [
    'Coal and gas run all day, most in the evening, least in spring',
    'Batteries took the evening from coal, not from gas',
    'Who pays the floor',
    'What batteries could and could not replace',
    'What is coming, and which records it moves',
  ];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });
  const yearColors = ['--ink-3', '--f-gas', '--f-wind', '--fossil'];

  // Chapter 1: fossil by hour of day across the years.
  const windNoon = lowAt(lastFull, 'wind');
  const windNight = peakAt(lastFull, 'wind');
  $('take-1').textContent = `In ${lastFull.year} coal and gas made ${twh(lastFull.fossil)} of ${twh(lastFull.total)}, never fell below ${mw(lastFull.fosMin)} together, and ran at ${mw(fosNoon.v)} even at ${hh(fosNoon.hr)}.`;
  $('body-1').innerHTML = `The grid has no interconnector, so whatever rooftop solar and wind do not cover, coal and gas must. They peak at ${hh(fosEve.hr)}, ${mw(fosEve.v)} on average in ${lastFull.year}, after the sun has gone and before the evening demand fades. They bottom out at ${hh(fosNoon.hr)}, but only to ${mw(fosNoon.v)}: a fossil floor that batteries charge on top of (${link(4, 'chapter 4')}). Wind does not help the evening much. It averaged ${mw(windNight.v)} at ${hh(windNight.hr)} and ${mw(windNoon.v)} at ${hh(windNoon.hr)} in ${lastFull.year}, out of ${twh(lastFull.twh.wind)} for the year. By month, fossil output peaks twice: in winter, when the days are short and the heating is on, and again in midsummer, when the air conditioning runs into the evening. In ${lastFull.year} the high was ${monthFull[monthHigh(lastFull)]} (${gwh(lastFull.fosMonth[monthHigh(lastFull)])}), the summer peak ${monthFull[summerHigh(lastFull)]} (${gwh(lastFull.fosMonth[summerHigh(lastFull)])}) and the low ${monthFull[monthLow(lastFull)]} (${gwh(lastFull.fosMonth[monthLow(lastFull)])}), when the sun is high and the heat has not yet come. The shape has moved since ${base.year}, when the lowest hour was ${hh(lowAt(base, 'fos').hr)} at ${mw(lowAt(base, 'fos').v)} and the peak ${mw(peakAt(base, 'fos').v)}: rooftop solar has dug a midday dip ${mw(lowAt(base, 'fos').v - fosNoon.v)} deeper, batteries have cut the evening peak by ${mw(peakAt(base, 'fos').v - fosEve.v)}, and the night is much the same. All of that is needed in the sense that nothing else was there at the time. Whether the floor is needed is the question of ${link(3, 'chapter 3')}.`;
  $('chart-h-1').textContent = 'Coal and gas by hour of day';
  $('chart-hint-1').textContent = `Average coal, gas and diesel output for each hour of the day, Perth time, in MW. The thick line is ${named(latest)}.`;
  const fosYears = [base, row(2023), lastFull, latest].filter((r, k, a) => r && a.indexOf(r) === k);
  const fosLines = fosYears.map((r, k) => ({ name: named(r), color: css(yearColors[k]), points: r.byHour.map((h, hr) => [hourX(hr), h ? h.fos : NaN]), width: r === latest ? 3 : 2 }));
  lineChart($('story-chart-1'), { series: fosLines, yMin: 0, yFormat: mw, yTickFormat: (v) => n0(v), xTicks: hourTicks, tooltip: hourTip(mw) });
  $('story-legend-1').innerHTML = legend(fosLines.map((s) => [s.name, s.color]));

  // Chapter 2: the evening, coal against batteries and gas, month by month.
  const evenYears = years.filter((r) => r.year >= firstBattery.year);
  const gasPeak = peakAt(latest, 'gas');
  const recent = monthly.slice(-25);
  $('take-2').textContent = `Evening coal fell from ${mw(base.eve.coal)} in ${base.year} to ${mw(latest.eve.coal)} as batteries rose to ${mw(latest.eve.battery)}; evening gas has not moved.`;
  $('body-2').innerHTML = `The first big battery on the grid was Synergy's 100 MW Kwinana battery, in 2023 (${src(SOURCES.kwinana, 'RenewEconomy')}). A second at Kwinana (225 MW) followed, then Neoen's 560 MW battery at Collie, in two stages to July 2025 (${src(SOURCES.neoen, 'pv magazine')}), and Synergy's 500 MW battery next to it (${src(SOURCES.collie, 'RenewEconomy')}), both on the site of the coal stations they replace. Average battery output between ${hh(EVENING[0])} and ${hh(EVENING[1])} went ${evenYears.map((r) => mw(r.eve.battery)).join(', ')} in ${evenYears.map(named).join(', ')}, and for one half hour on ${fmtDate(at(batteryShare.at))} batteries made ${pct(batteryShare.pct * 100)} of the grid's metered supply. Coal gave way: ${mw(base.eve.coal)} in the evening of ${base.year}, ${mw(latest.eve.coal)} in ${named(latest)}${coal1000 ? `, and coal has now run under 1,000 MW for ${hoursText(hours(coal1000, step))} from ${fmtDate(at(coal1000.start))}${live(coal1000) ? ', a spell still going' : ''}` : ''}. Gas did not. Evening gas averaged ${mw(base.eve.gas)} in ${base.year} and ${mw(latest.eve.gas)} in ${named(latest)}, still peaking at ${mw(gasPeak.v)} at ${hh(gasPeak.hr)}, and gas has made more power than coal every year since ${gasAhead?.year ?? 2022}. ${gasTop.month ? `${monthName(gasTop.month)}, at ${gwh(gasTop.gas)}, was gas's biggest month ${gasHigher ? `since ${monthName(gasHigher.month)}` : 'on record'}; AEMO put the June quarter's 27% rise in gas down to low wind and coal outages (${src(SOURCES.qedQ2, 'AEMO')}). ` : ''}From 1 January to ${fmtDate(yearToDate.upToMs)}, coal made ${twh2(Math.abs(dt.coal))} ${dt.coal <= 0 ? 'less' : 'more'} than over the same days of ${latest.year - 1}, gas ${twh2(Math.abs(dt.gas))} ${dt.gas >= 0 ? 'more' : 'less'} and batteries ${twh2(Math.abs(dt.battery))} ${dt.battery >= 0 ? 'more' : 'less'}, so coal and gas together were ${pct(Math.abs(yearToDate.fossil))} ${yearToDate.fossil >= 0 ? 'higher' : 'lower'}. Batteries moved the evening from coal to stored midday power, and the gap coal left overnight and in winter went to gas.`;
  $('chart-h-2').textContent = 'Coal, gas and batteries month by month';
  $('chart-hint-2').textContent = 'GWh each month, Perth time. The last month may be part of a month.';
  const mx = recent.map((m) => Date.parse(`${m.month}-15T00:00:00Z`));
  const monthSeries = [['coal', 'Coal', '--f-coal'], ['gas', 'Gas', '--f-gas'], ['battery', 'Battery discharge', '--f-battery']]
    .map(([k, name, cl]) => ({ key: k, name, color: css(cl), points: recent.map((m, j) => [mx[j], m[k]]), width: 2.5 }));
  lineChart($('story-chart-2'), {
    series: monthSeries,
    yMin: 0,
    yFormat: gwh,
    yTickFormat: (v) => n0(v),
    tooltip: (t) => {
      const m = recent[mx.indexOf(t)];
      return m ? `<strong>${monthName(m.month)}</strong>${monthSeries.map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${gwh(m[s.key])}</b></div>`).join('')}` : '';
    },
  });
  $('story-legend-2').innerHTML = legend(monthSeries.map((s) => [s.name, s.color]));

  // Chapter 3: the floor and who pays it.
  const coalNoon = lowAt(lastFull, 'coal');
  $('take-3').textContent = `Coal has never been off because its units are paid to exist, its fuel is paid for whether burnt or not, and AEMO keeps spinning plant on for security at low load.`;
  $('body-3').innerHTML = `The lowest coal half hour in the record is ${mw(coalMinRow.coalMin)}, in ${coalMinRow.year}, and every year since 2020 has bottomed out between ${mw(Math.min(...since2020))} and ${mw(Math.max(...since2020))}${coal300 ? `; the longest spell under 300 MW is ${hoursText(hours(coal300, step))}` : ''}${coal250 ? ` and under 250 MW ${hoursText(hours(coal250, step))}, from ${fmtDate(at(coal250.start))}` : ''}. Gas has been down to ${mw(gasMinRow.gasMin)}, on ${fmtDate(at(gasMinRow.gasMinAt))}, but coal and gas together never fell below ${mw(fosMinRow.fosMin)}, on ${fmtDate(at(fosMinRow.fosMinAt))}. Three things hold the floor up. First, security: AEMO treats 500 MW of operational demand as the level below which it cannot keep the system secure, and pays for a minimum demand service to stay above it (${src(SOURCES.lowLoad, 'AEMO')}); since 2022 new rooftop systems must be switchable off as a last resort (${src(SOURCES.esm, 'AEMO')}). Synergy says its coal units are kept on for the inertia they provide, which the market does not pay for (${src(SOURCES.inertia, 'Boiling Cold')}), and at ${hh(coalNoon.hr)} in ${lastFull.year} coal still averaged ${mw(coalNoon.v)}, about three units turned down as far as they go (our inference from the unit sizes). Alinta's 280 MW Pinjarra plant makes steam for Alcoa's refinery as well as power (${src(SOURCES.alinta, 'Alinta')}), so part of the gas floor runs for heat (inferred). Second, capacity payments: every accredited megawatt earns the Reserve Capacity Price whether it runs or not, ${aud(CAPACITY_PRICE['2025-26'])} a year in 2025-26 and ${aud(CAPACITY_PRICE['2026-27'])} in 2026-27 (${src(SOURCES.brcp, 'ERA')}), rising to ${aud(CAPACITY_PRICE['2027-28'])} in 2027-28 when the benchmark plant becomes a battery (${src(SOURCES.rcp, 'AEMO')}; ${src(SOURCES.brcpBattery, 'pv magazine')}). Bluewaters, the private coal station, holds 434 MW of credits to October 2028 and earned $158 million from capacity against $98 million from selling energy in the year to March 2025 (${src(SOURCES.bluewaters, 'Boiling Cold')}). Third, the fuel is already paid for. Synergy buys its coal under a take-or-pay contract with a floor of 2.8 million tonnes a year to 2030 (${src(SOURCES.takeOrPay, 'Shire of Collie')}), has written its coal stations down to nil and lost $778.5 million in 2024-25, blaming coal and gas costs (${src(SOURCES.synergyLoss, 'RenewEconomy')}), and gets an operating subsidy of about $671 million from the state in 2026-27 (${src(SOURCES.budget, 'WA Budget')}). Gas, meanwhile, has doubled in price: Woodside's WA domestic gas fetched $6.50 a gigajoule in 2024 against $3.14 in 2019 (${src(SOURCES.gasPrice, 'Boiling Cold')}), which is roughly ${aud(CCGT_COST)} a megawatt hour of fuel for a combined-cycle plant and ${aud(OCGT_COST)} for a peaker (our estimate, with no carbon price to add). The market paid an average $101.76 a megawatt hour in the September quarter of 2025 (${src(SOURCES.qedQ3, 'AEMO')}) and $118 in the June quarter of 2026 (${src(SOURCES.qedQ2, 'AEMO')}), so gas runs at a profit in the evening and the coal runs because stopping it would not save its owner much.`;
  $('chart-h-3').textContent = 'The lowest and average coal output each year';
  $('chart-hint-3').textContent = `MW, Perth calendar years. The last point is ${named(latest)}.`;
  const yearMs = (r) => Date.UTC(r.year, 6, 1);
  const cy = years.filter((r) => r.year >= 2007);
  const cx = cy.map(yearMs);
  const coalSeries = [
    { name: 'Average', color: css('--f-coal'), points: cy.map((r, j) => [cx[j], r.coalAvg]), width: 2.5 },
    { name: 'Lowest half hour', color: css('--fossil'), points: cy.map((r, j) => [cx[j], r.coalMin]), width: 2.5 },
  ];
  coalSeries.forEach((s) => { s.markers = s.points; });
  lineChart($('story-chart-3'), {
    series: coalSeries,
    yMin: 0,
    yFormat: mw,
    yTickFormat: (v) => n0(v),
    tooltip: (t, vals) => `<strong>${named(cy[cx.indexOf(t)] ?? latest)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? mw(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-3').innerHTML = legend(coalSeries.map((s) => [s.name, s.color]));

  // Chapter 4: battery sizing against each day's fossil above the floor.
  $('take-4').textContent = `${bat(0).gw} GW and ${bat(0).gwh} GWh of batteries, about today's fleet, would have covered fossil above ${FOSSIL_FLOOR} MW on ${bat(0).days} days of ${lastFull.year}; ${bat(3).gw} GW and ${bat(3).gwh} GWh on ${bat(3).days}. But there is little spare power to charge them with.`;
  $('body-4').innerHTML = `Take the ${FOSSIL_FLOOR} MW floor as given and ask what would have covered the rest, ${twh(lastFull.aboveTwh)} in ${lastFull.year}. The median day needed ${n0(median.gwh)} GWh above the floor and peaked ${(median.peak).toFixed(1)} GW above it; the worst needed ${n0(worst.gwh)} GWh and ${worst.peak.toFixed(1)} GW. Against those days, ${lastFull.batteries.map((b, i) => (i ? `${i === lastFull.batteries.length - 1 ? 'and ' : ''}${b.gw} GW and ${b.gwh} GWh ${b.days}` : `${b.gw} GW and ${b.gwh} GWh of batteries would have covered ${b.days} days`)).join(', ')}. The grid has about 1.5 GW and 6 GWh now, counting the two Kwinana and two Collie batteries and Alinta's at Wagerup (our sum of the sources above), and AEMO counts 806 MW more as committed by October 2027 (${src(SOURCES.esoo, 'AEMO')}). The sizing assumes the batteries could charge, and that is the problem. In France the batteries would charge from a noon surplus that is exported today. Here nothing is exported, and at midday in ${lastFull.year} coal and gas still averaged ${mw(lastFull.noon.fos)} while batteries took ${mw(lastFull.noon.charge)}: on an average day the batteries were charging alongside the fossil floor, not from a surplus above it. On the sunniest days there is one: on ${fmtDate(at(fosMinRow.fosMinAt))} fossil fell to ${mw(fosMinRow.fosMin)} with ${mw(-c0(data, fosMinRow.fosMinAt, 'battery_charge'))} going into batteries. The median day's ${n0(median.gwh)} GWh would also need that much clean energy from somewhere, and solar farms and rooftops together made ${n0(lastFull.days.reduce((s, x) => s + x.solar, 0) / lastFull.days.length)} GWh a day on average in ${lastFull.year}, nearly all of it used as it was made. Batteries can take the evening from coal; taking the rest from gas needs the wind and solar to be built first, and the ${twh(lastFull.aboveTwh)} to be covered is ${(lastFull.aboveTwh / lastFull.twh.wind).toFixed(1)} times what wind made in ${lastFull.year}. AEMO's own NCESS contracts show the order: the batteries are paid both to charge in the middle of the day, to keep demand above the security level, and to discharge in the evening (${src(SOURCES.ncess, 'RenewEconomy')}).`;
  $('chart-h-4').textContent = `Each day of ${lastFull.year}, by the fossil a battery would have had to replace`;
  $('chart-hint-4').textContent = `Each day's coal, gas and diesel above ${FOSSIL_FLOOR} MW, in GWh, sorted from smallest to largest. The lines mark what ${lastFull.batteries.map((b) => b.gwh).join(', ')} GWh of batteries could supply; days below a line are covered, if the batteries could charge.`;
  const dayX = (k) => k * 864e5;
  const sorted = [{ name: 'Fossil above the floor', color: css('--fossil'), points: lastFull.days.map((x, k) => [dayX(k), x.gwh]), width: 2.5 }];
  lineChart($('story-chart-4'), {
    series: sorted,
    yMin: 0,
    yFormat: (v) => `${n0(v)} GWh`,
    yTickFormat: (v) => n0(v),
    xTicks: [0, 60, 120, 180, 240, 300, 360].filter((k) => k < lastFull.days.length).map((k) => ({ t: dayX(k), label: `${k}` })),
    refLines: lastFull.batteries.map((b) => ({ value: b.gwh, color: css('--ink-3') })),
    tooltip: (t) => {
      const k = Math.round(t / 864e5);
      const x = lastFull.days[k];
      return x ? `<strong>Day ${k + 1} of ${lastFull.days.length}</strong><div>Fossil above ${FOSSIL_FLOOR} MW: <b>${n0(x.gwh)} GWh</b></div><div>Peak above the floor: <b>${x.peak.toFixed(2)} GW</b></div><div>Solar that day: <b>${n0(x.solar)} GWh</b></div><div>Month: <b>${monthNames[x.month - 1]}</b></div>` : '';
    },
  });
  $('story-legend-4').innerHTML = `${legend(sorted.map((s) => [s.name, s.color]))}<span>Lines: ${lastFull.batteries.map((b) => `${b.gwh} GWh`).join(', ')}</span>`;

  // Chapter 5: what is coming.
  const first = years.find((r) => !r.partial);
  $('take-5').textContent = `The state's coal closes in 2027 and 2029, 806 MW of batteries and two wind farms arrive by 2027, but Bluewaters has coal to 2031, capacity payments rise, and AEMO expects gas to grow.`;
  $('body-5').innerHTML = `The dated items are listed below, each with the record it should move. The state's plan for its own stations is set: Muja's unit 6 retired in April 2025, Collie (340 MW) closes in October 2027 and Muja 7 and 8 in late 2029 (${src(SOURCES.exit, 'pv magazine')}; ${src(SOURCES.kingRocks, 'RenewEconomy')}). Bluewaters is different. It is privately owned, holds capacity credits to October 2028 and burns coal from the Griffin mine, whose owner is insolvent (${src(SOURCES.bluewaters, 'Boiling Cold')}); in January 2026 the government extended Griffin's state agreement by up to five years from July 2026 (${src(SOURCES.griffin, 'WA Government')}). So the first coal-free half hour depends on a plant the state does not own. Gas is set to grow, not shrink: AEMO's gas outlook has gas burnt for power rising as coal closes, with a possible supply gap in 2030 (${src(SOURCES.gsoo, 'AEMO')}), and from 2031 onshore fields must sell all their gas in WA (${src(SOURCES.gasPolicy, 'WA Government')}). Against that, 806 MW more batteries are committed by October 2027 (${src(SOURCES.esoo, 'AEMO')}), Warradarge grows to 283 MW in 2027 (${src(SOURCES.warradarge, 'WA Government')}) and King Rocks (105 MW) is under construction (${src(SOURCES.kingRocks, 'RenewEconomy')}). Hours with fossil under ${FOSSIL_LOW.toLocaleString('en-AU')} MW went from ${hrs(base.fosLow)} in ${base.year} to ${hrs(lastFull.fosLow)} in ${lastFull.year}${fos500 ? `, and the longest spell under 500 MW is ${hoursText(hours(fos500, step))} from ${fmtDate(at(fos500.start))}` : ''}: those are the counts to watch.`;
  $('chart-h-5').textContent = `Hours a year with fossil under ${FOSSIL_LOW.toLocaleString('en-AU')} MW`;
  $('chart-hint-5').textContent = `Hours each year with coal, gas and diesel together under ${FOSSIL_LOW.toLocaleString('en-AU')} MW. The lowest half hour of fossil is in the tooltip. The last bar is ${named(latest)}.`;
  const bars = years.filter((r) => r.year >= (first?.year ?? years[0].year));
  const ch5 = [{ name: `Fossil under ${FOSSIL_LOW.toLocaleString('en-AU')} MW`, color: css('--lowcarbon'), values: bars.map((r) => r.fosLow) }];
  barChart($('story-chart-5'), {
    cats: bars.map((r) => (r.partial ? `${String(r.year).slice(2)}*` : String(r.year).slice(2))),
    stacks: ch5,
    yFormat: hrs,
    yTickFormat: (v) => n0(v),
    highlight: (ci) => bars[ci].partial,
    tooltip: (ci) => `<strong>${named(bars[ci])}</strong><div>Hours under ${FOSSIL_LOW.toLocaleString('en-AU')} MW: <b>${n0(bars[ci].fosLow)}</b></div><div>Lowest fossil: <b>${mw(bars[ci].fosMin)}</b></div><div>Coal and gas: <b>${twh(bars[ci].fossil)}</b></div>`,
  });
  $('story-legend-5').innerHTML = legend(ch5.map((s) => [s.name, s.color]));
  $('coming').innerHTML = COMING.map(([when, what, source, record]) => `<li><span class="swatch" style="background:var(--fossil)"></span><span><b>${when}</b> ${what} (${src(SOURCES[source], 'source')}) <span class="sub">Watch: ${record}</span></span></li>`).join('');
}

/** A column's value at a slot, zero when missing. */
function c0(data, i, col) {
  return num(data.columns[col][i]);
}
