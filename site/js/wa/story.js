// The Western Australia story: big batteries have taken the evening peak from
// coal in three years, but gas, not stored solar, has taken most of coal's
// place, and a coal floor of about 200 MW that has never been broken may
// outlast the state's own coal exit. The figures are worked out from the data
// by storyFigures(), which the tests also run; renderStory() draws the page.
// Drafted with Alex's answer-first structure: the answer, three supporting
// points, then five chapters.
import { summarise, slotTime } from '../records.js';
import { barChart, lineChart, fmtDate } from '../charts.js';
import { stepOf } from '../core/dataset.js';
import { tzOffsetMs } from '../core/calendar.js';
import wa from '../countries/wa.js';

// The evening peak, local hours [from, to).
export const EVENING = [17, 21];
// The year the story compares against: the last before rooftop solar and batteries changed the grid's shape.
export const BASE_YEAR = 2019;
// Coal levels for the spells the story quotes, in MW.
export const COAL_LEVELS = [1000, 300, 250];
const GEN = ['coal', 'gas', 'oil', 'biomass', 'wind', 'solar_utility', 'solar_rooftop', 'other'];
const RENEW = ['wind', 'solar_utility', 'solar_rooftop', 'biomass'];

/** Local year, month ("YYYY-MM"), hour and day of year for every slot, with the offset looked up once per UTC day. */
function localClock(data, end) {
  const stepMs = stepOf(data) * 60000;
  const year = new Uint16Array(end);
  const hour = new Uint8Array(end);
  const doy = new Uint16Array(end);
  const month = new Array(end);
  let day = -1;
  let offset = 0;
  for (let i = 0; i < end; i++) {
    const t = data.startMs + i * stepMs;
    const d = Math.floor(t / 864e5);
    if (d !== day) {
      day = d;
      offset = tzOffsetMs(d * 864e5 + 432e5, wa.timeZone);
    }
    const local = new Date(t + offset);
    year[i] = local.getUTCFullYear();
    hour[i] = local.getUTCHours();
    doy[i] = Math.floor((local - Date.UTC(year[i], 0, 1)) / 864e5);
    month[i] = local.toISOString().slice(0, 7);
  }
  return { year, hour, doy, month };
}

const num = (v) => (Number.isNaN(v) ? 0 : v);

/**
 * Every number the story uses. Rows run by Perth calendar year, the first
 * and the current one partial (`partial` says so). Demand excluding charging
 * is operational demand less what grid batteries took, since AEMO's
 * operational demand counts battery charging as demand.
 */
export function storyFigures(data, end) {
  const c = data.columns;
  const step = stepOf(data);
  const slotH = step / 60;
  const { year, hour, doy, month } = localClock(data, end);
  const blank = (y) => ({
    year: y, slots: 0, twh: Object.fromEntries([...GEN, 'battery'].map((k) => [k, 0])),
    coalMin: Infinity, coalSum: 0, demandMin: Infinity, demandMinAt: -1, underMin: Infinity, underMinAt: -1,
    eve: { coal: 0, gas: 0, battery: 0, n: 0 },
    byHour: Array.from({ length: 24 }, () => ({ coal: 0, gas: 0, battery: 0, roof: 0, demand: 0, n: 0 })),
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
    r.twh.battery += (dis * slotH) / 1e6;
    if (c.coal[i] < r.coalMin) r.coalMin = c.coal[i];
    r.coalSum += c.coal[i];
    const d = c.demand[i];
    if (d < r.demandMin) { r.demandMin = d; r.demandMinAt = i; }
    if (d + chg < r.underMin) { r.underMin = d + chg; r.underMinAt = i; }
    if (hour[i] >= EVENING[0] && hour[i] < EVENING[1]) {
      r.eve.coal += c.coal[i]; r.eve.gas += num(c.gas[i]); r.eve.battery += dis; r.eve.n++;
    }
    const h = r.byHour[hour[i]];
    h.coal += c.coal[i]; h.gas += num(c.gas[i]); h.battery += dis + chg; h.roof += num(c.solar_rooftop[i]); h.demand += d; h.n++;
    const supply = gen - num(c.solar_rooftop[i]) + dis;
    if (supply > 0 && dis / supply > batteryShare.pct) batteryShare = { pct: dis / supply, at: i };
    const m = months.get(month[i]) ?? { month: month[i], coal: 0, gas: 0, battery: 0 };
    m.coal += (c.coal[i] * slotH) / 1000; m.gas += (num(c.gas[i]) * slotH) / 1000; m.battery += (dis * slotH) / 1000;
    months.set(month[i], m);
  }
  const fullYear = 360 * 24 / slotH;
  const years = [...rows.values()].map((r) => {
    const total = GEN.reduce((s, k) => s + r.twh[k], 0);
    return {
      year: r.year,
      partial: r.slots < fullYear,
      twh: r.twh,
      total,
      fossil: r.twh.coal + r.twh.gas + r.twh.oil,
      renewablePct: total ? (RENEW.reduce((s, k) => s + r.twh[k], 0) / total) * 100 : NaN,
      coalMin: r.coalMin,
      coalAvg: r.coalSum / r.slots,
      demandMin: r.demandMin,
      demandMinAt: r.demandMinAt,
      underMin: r.underMin,
      underMinAt: r.underMinAt,
      eve: { coal: r.eve.coal / r.eve.n, gas: r.eve.gas / r.eve.n, battery: r.eve.battery / r.eve.n },
      byHour: r.byHour.map((h) => (h.n ? { coal: h.coal / h.n, gas: h.gas / h.n, battery: h.battery / h.n, roof: h.roof / h.n, demand: h.demand / h.n } : null)),
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
  const coalSpells = Object.fromEntries(COAL_LEVELS.map((t) => [t, summarise(coal, t, 'below', opts).record]));
  return { years, monthly: [...months.values()], yearToDate, coalSpells, batteryShare, end };
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
const legend = (items) => items.map(([name, color]) => `<span><span class="swatch" style="background:${color}"></span>${name}</span>`).join('');
const src = (url, text) => `<a href="${url}">${text}</a>`;
const link = (ch, text) => `<a href="#chapter-${ch}" data-open="chapter-${ch}">${text}</a>`;
const monthName = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const hourX = (hr) => hr * 3600000;
const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21].map((hr) => ({ t: hourX(hr), label: `${String(hr).padStart(2, '0')}:00` }));
const hourTip = (fmt) => (t, vals) => `<strong>${String(Math.round(t / 3600000)).padStart(2, '0')}:00</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? fmt(v.value) : '—'}</b></div>`).join('')}`;
const hours = (rec, step) => ((rec.end - rec.start) * step) / 60;
const hoursText = (h) => (h >= 72 ? `${n0(h / 24)} days` : `${+h.toFixed(1)} hours`);

const SOURCES = {
  kwinana: 'https://reneweconomy.com.au/big-battery-to-the-rescue-as-rooftop-pv-pushes-biggest-isolated-grid-to-record-demand-lows/',
  collie: 'https://reneweconomy.com.au/this-australian-utility-will-soon-be-the-first-to-have-more-big-battery-capacity-than-coal',
  esoo: 'https://www.aemo.com.au/-/media/files/electricity/wem/planning_and_forecasting/esoo/2025/2025-wem-esoo-visual-overview.pdf',
  rooftop81: 'https://www.pv-magazine-australia.com/2024/11/13/worth-its-weight-in-sunshine-rooftop-solar-clocks-new-supply-records/',
  floor600: 'https://reneweconomy.com.au/rooftop-solar-crunches-minimum-demand-to-new-lows-despite-aircon-use-in-warm-weather/',
  esm: 'https://aemo.com.au/initiatives/major-programs/wa-der-program/emergency-solar-management',
  muja6: 'https://www.colliebulletin.com.au/muja-unit-6-generator-retired-decommissioning-activities-underway',
  exit: 'https://www.pv-magazine-australia.com/2022/06/15/western-australia-to-exit-coal-by-2029-in-response-to-competition-from-solar',
  bluewaters: 'https://www.boilingcold.com.au/wa-needs-bluewaters-coal-fired-power-until-2028-but-the-dollars-do-not-add-up/',
  griffin: 'https://www.wa.gov.au/government/media-statements/Cook%20Labor%20Government/Griffin-Coal-extension-delivers-certainty-for-jobs-and-energy-20260121',
};

export function renderStory(data, end, figs) {
  const { years, monthly, yearToDate, coalSpells, batteryShare } = figs;
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
  const demandMinRow = years.reduce((a, r) => (r.demandMin < a.demandMin ? r : a), years[0]);
  const underMinRow = years.reduce((a, r) => (r.underMin < a.underMin ? r : a), years[0]);
  const gasAhead = years.find((r) => !r.partial && r.twh.gas > r.twh.coal && years.filter((x) => x.year >= r.year && !x.partial).every((x) => x.twh.gas > x.twh.coal));
  // This year's biggest gas month, and the last month before it with more.
  const gasTop = monthly.filter((m) => m.month.startsWith(String(latest.year))).reduce((a, m) => (m.gas > a.gas ? m : a), { gas: -1 });
  const gasHigher = monthly.filter((m) => m.month < gasTop.month && m.gas > gasTop.gas).at(-1);
  const dt = yearToDate.delta;
  const peakAt = (r, k) => r.byHour.reduce((a, h, hr) => (h && h[k] > a.v ? { v: h[k], hr } : a), { v: -Infinity, hr: 0 });
  const lowAt = (r, k) => r.byHour.reduce((a, h, hr) => (h && h[k] < a.v ? { v: h[k], hr } : a), { v: Infinity, hr: 0 });
  const hh = (hr) => `${String(hr).padStart(2, '0')}:00`;
  const night = (r) => r.byHour.slice(0, 5).reduce((s, h) => s + h.demand, 0) / 5;
  const coal1000 = coalSpells[1000];
  const coal250 = coalSpells[250];
  const coal300 = coalSpells[300];
  const live = (rec) => rec && rec.end >= end - 1;
  const since2020 = years.filter((r) => r.year >= 2020).map((r) => r.coalMin);
  const firstGrid = row(2007) ?? full[0];

  // Header and in short.
  $('lede').textContent = `Perth's isolated grid has handed its evening peak from coal to batteries in three years. Gas has taken much of coal's place too, and a privately owned coal plant may outlast the state's own coal exit.`;
  $('answer-lead').textContent = `Big batteries have pushed coal out of the evening peak since ${firstBattery.year}, but gas has taken much of coal's place too, so fossil generation is barely falling. Coal has never once been off, and the private Bluewaters station is outside the state's 2029 coal exit.`;
  $('answer-points').innerHTML = [
    `<b>Batteries took the evening from coal.</b> Battery output between ${hh(EVENING[0])} and ${hh(EVENING[1])} averaged ${mw(latest.eve.battery)} in ${named(latest)}, up from ${mw(firstBattery.eve.battery)} in ${firstBattery.year}, while evening coal fell from ${mw(base.eve.coal)} in ${base.year} to ${mw(latest.eve.coal)}. ${link(2, 'Chapter 2')}`,
    `<b>Gas took much of coal's place.</b> Gas has made more power than coal every year since ${gasAhead?.year ?? 2022}. In ${named(latest)} gas is ${pct(Math.abs(yearToDate.gas))} ${yearToDate.gas >= 0 ? 'up' : 'down'} on the same days of last year and coal ${pct(Math.abs(yearToDate.coal))} ${yearToDate.coal >= 0 ? 'up' : 'down'}, so fossil fuels together are only ${pct(Math.abs(yearToDate.fossil))} ${yearToDate.fossil >= 0 ? 'up' : 'down'}. ${link(3, 'Chapter 3')}`,
    `<b>Batteries fixed the midday floor, but not the coal floor.</b> Grid demand hit ${mw(demandMinRow.demandMin)} on ${fmtDate(at(demandMinRow.demandMinAt))}, below the 600 MW AEMO treats as its security level, and battery charging has since lifted the minimum to ${mw(latest.demandMin)}. Coal has never run below ${mw(coalMinRow.coalMin)}, and the private Bluewaters plant has coal past 2030. ${link(4, 'Chapters 4')} and ${link(5, '5')}`,
  ].map((x) => `<li>${x}</li>`).join('');

  // Headline facts.
  const facts = [
    ['--f-rooftop', 'Lowest grid demand', mw(demandMinRow.demandMin), `on ${fmtDate(at(demandMinRow.demandMinAt))}`],
    ['--f-battery', 'Lowest demand without battery charging', mw(underMinRow.underMin), `on ${fmtDate(at(underMinRow.underMinAt))}`],
    ['--f-coal', 'Lowest coal half hour ever', mw(coalMinRow.coalMin), `in ${coalMinRow.year}; coal has never been off`],
    ['--f-coal', 'Longest with coal under 1,000 MW', coal1000 ? hoursText(hours(coal1000, step)) : '—', coal1000 ? `from ${fmtDate(at(coal1000.start))}${live(coal1000) ? ', still going' : ''}` : ''],
  ];
  $('facts').innerHTML = `<div class="headline"><div class="big">${mw(latest.eve.battery)}</div><div class="sub">Average battery output between ${hh(EVENING[0])} and ${hh(EVENING[1])} in ${named(latest)}, up from ${mw(firstBattery.eve.battery)} in ${firstBattery.year}.</div></div>
    <ul class="fact-list">${facts.map(([cl, l, v, w]) => `<li><span class="swatch" style="background:var(${cl})"></span><span><b>${l}</b> <span class="v">${v}</span> <span class="sub">${w}</span></span></li>`).join('')}</ul>`;
  $('story-hint').textContent = 'Five chapters: twenty years of coal and gas, the batteries that took the evening, the gas that took coal\'s place, the midday floor, and the last 200 MW of coal.';

  const chapters = ['Two fuels for twenty years', 'Batteries take the evening', 'Gas fills the gap', 'The midday floor turned over', 'The last 200 MW'];
  chapters.forEach((t, k) => {
    $(`title-${k + 1}`).textContent = t;
    if (k < 4) $(`next-${k + 1}`).textContent = `Next: ${chapters[k + 1]}`;
  });

  // Chapter 1: generation by fuel each year.
  const before = full.filter((r) => r.year <= BASE_YEAR);
  const range = (k) => [Math.min(...before.map((r) => r.twh[k])), Math.max(...before.map((r) => r.twh[k]))];
  const [genLo, genHi] = [Math.min(...before.map((r) => r.total)), Math.max(...before.map((r) => r.total))];
  const r21 = row(2021);
  $('take-1').textContent = `From ${firstGrid.year} to ${BASE_YEAR} the grid ran on coal and gas, and renewables never passed ${Math.ceil(Math.max(...before.map((r) => r.renewablePct)))}% of generation.`;
  $('body-1').innerHTML = `The record starts in September 2006. For the next thirteen years the grid barely changed shape: generation sat between ${twh(genLo)} and ${twh(genHi)} a year, coal made ${twh(range('coal')[0])} to ${twh(range('coal')[1])} and gas ${twh(range('gas')[0])} to ${twh(range('gas')[1])}, and wind was the only renewable worth counting, ${twh(firstGrid.twh.wind)} in ${firstGrid.year} and ${twh(base.twh.wind)} in ${base.year}. The renewable share was ${pct(firstGrid.renewablePct)} in ${firstGrid.year} and ${pct(base.renewablePct)} in ${base.year}. What the facility data cannot see is rooftop solar, which AEMO has only estimated since November 2020${r21 ? `; in its first full year it added ${twh(r21.twh.solar_rooftop)} and the share jumped to ${pct(r21.renewablePct)}` : ''}. In ${lastFull.year} renewables made ${pct(lastFull.renewablePct)}, with rooftop solar (${twh(lastFull.twh.solar_rooftop)}) ahead of wind (${twh(lastFull.twh.wind)}), but coal and gas still made ${twh(lastFull.twh.coal + lastFull.twh.gas)} of ${twh(lastFull.total)}.`;
  $('chart-h-1').textContent = 'Generation by fuel each year';
  $('chart-hint-1').textContent = `TWh by fuel, Perth calendar years from ${firstGrid.year}. Rooftop solar is estimated from November 2020 only. The last bar is ${named(latest)}.`;
  const bars = years.filter((r) => r.year >= firstGrid.year);
  const stacks = [
    ['coal', 'Coal', '--f-coal'], ['gas', 'Gas', '--f-gas'], ['wind', 'Wind', '--f-wind'],
    ['solar_utility', 'Solar farms', '--f-solar'], ['solar_rooftop', 'Rooftop solar', '--f-rooftop'], ['battery', 'Battery discharge', '--f-battery'],
  ].map(([k, name, cl]) => ({ name, color: css(cl), values: bars.map((r) => r.twh[k]) }));
  barChart($('story-chart-1'), {
    cats: bars.map((r) => (r.partial ? `${String(r.year).slice(2)}*` : String(r.year).slice(2))),
    stacks,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => bars[ci].partial,
    tooltip: (ci) => {
      const r = bars[ci];
      return `<strong>${named(r)}</strong>${stacks.map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${twh2(s.values[ci])}</b></div>`).join('')}<div>Renewables: <b>${pct(r.renewablePct)}</b></div>`;
    },
  });
  $('story-legend-1').innerHTML = legend(stacks.map((s) => [s.name, s.color]));

  // Chapter 2: the evening, by hour of day.
  const coalB = [lowAt(base, 'coal'), peakAt(base, 'coal')];
  const coalL = [lowAt(latest, 'coal'), peakAt(latest, 'coal')];
  const evenYears = years.filter((r) => r.year >= firstBattery.year);
  $('take-2').textContent = `In three years battery output has replaced the evening hump that coal supplied for two decades.`;
  $('body-2').innerHTML = `The first big battery on the grid was Synergy's 100 MW Kwinana battery, in 2023 (${src(SOURCES.kwinana, 'RenewEconomy')}). A second at Kwinana (225 MW) followed, then Neoen's 560 MW and Synergy's 500 MW batteries at Collie, next to the coal stations they are replacing (${src(SOURCES.collie, 'RenewEconomy')}). Average battery output between ${hh(EVENING[0])} and ${hh(EVENING[1])} went ${evenYears.map((r) => mw(r.eve.battery)).join(', ')} in ${evenYears.map(named).join(', ')}. Evening coal fell from ${mw(base.eve.coal)} in ${base.year} to ${mw(latest.eve.coal)}. In ${base.year} coal ran from ${mw(coalB[0].v)} at ${hh(coalB[0].hr)} to ${mw(coalB[1].v)} at ${hh(coalB[1].hr)}, a daily hump of ${mw(coalB[1].v - coalB[0].v)}; in ${named(latest)} it runs between ${mw(coalL[0].v)} and ${mw(coalL[1].v)}. For one half hour on ${fmtDate(at(batteryShare.at))}, batteries made ${pct(batteryShare.pct * 100)} of the grid's metered supply.${coal1000 ? ` Coal has now run under 1,000 MW for ${hoursText(hours(coal1000, step))} from ${fmtDate(at(coal1000.start))}${live(coal1000) ? ', a spell still going' : ''}, the longest in the record.` : ''}`;
  $('chart-h-2').textContent = `Coal and batteries through the day, ${base.year} and ${named(latest)}`;
  $('chart-hint-2').textContent = 'Average MW for each hour of the day, Perth time. Batteries are net: below zero when charging.';
  const daySeries = [
    [base, 'coal', `Coal ${base.year}`, '--ink-3', 2],
    [latest, 'coal', `Coal ${named(latest)}`, '--f-coal', 3],
    [latest, 'battery', `Batteries ${named(latest)}`, '--f-battery', 3],
    [latest, 'roof', `Rooftop solar ${named(latest)}`, '--f-rooftop', 2],
  ].map(([r, k, name, cl, width]) => ({ name, color: css(cl), points: r.byHour.map((h, hr) => [hourX(hr), h ? h[k] : NaN]), width }));
  lineChart($('story-chart-2'), { series: daySeries, yFormat: mw, yTickFormat: (v) => n0(v), xTicks: hourTicks, refLines: [{ value: 0, color: css('--ink-3') }], tooltip: hourTip(mw) });
  $('story-legend-2').innerHTML = legend(daySeries.map((s) => [s.name, s.color]));

  // Chapter 3: gas month by month.
  const gasPeak = peakAt(latest, 'gas');
  const recent = monthly.slice(-25);
  $('take-3').textContent = `Coal's retreat has mostly been gas's gain, and with demand rising the fossil total is only edging down.`;
  $('body-3').innerHTML = `Gas has made more power than coal every year since ${gasAhead?.year ?? 2022}: ${twh2(lastFull.twh.gas)} against ${twh2(lastFull.twh.coal)} in ${lastFull.year}. Batteries have not touched it. Evening gas averaged ${mw(base.eve.gas)} in ${base.year} and ${mw(latest.eve.gas)} in ${named(latest)}, and it still peaks at ${mw(gasPeak.v)} at ${hh(gasPeak.hr)}. ${gasTop.month ? `${monthName(gasTop.month)}, at ${gwh(gasTop.gas)}, was gas's biggest month ${gasHigher ? `since ${monthName(gasHigher.month)}` : 'on record'}. ` : ''}From 1 January to ${fmtDate(yearToDate.upToMs)}, coal made ${twh2(Math.abs(dt.coal))} ${dt.coal <= 0 ? 'less' : 'more'} than over the same days of ${latest.year - 1} (${pct(Math.abs(yearToDate.coal))}), gas ${twh2(Math.abs(dt.gas))} ${dt.gas >= 0 ? 'more' : 'less'} (${pct(Math.abs(yearToDate.gas))}) and batteries ${twh2(Math.abs(dt.battery))} ${dt.battery >= 0 ? 'more' : 'less'}, so coal and gas together were only ${pct(Math.abs(yearToDate.fossil))} ${yearToDate.fossil >= 0 ? 'higher' : 'lower'}. Demand is part of the reason. Grid demand between midnight and 05:00 averaged ${mw(night(latest))} in ${named(latest)} against ${mw(night(base))} in ${base.year}, though the newer figure includes batteries charging overnight, and AEMO expects consumption on the grid to grow from about 20 TWh to 28 TWh in the decade to 2034-35 (${src(SOURCES.esoo, 'AEMO')}).`;
  $('chart-h-3').textContent = 'Coal, gas and batteries month by month';
  $('chart-hint-3').textContent = 'GWh each month, Perth time. The last month may be part of a month.';
  const mx = recent.map((m) => Date.parse(`${m.month}-15T00:00:00Z`));
  const monthSeries = [['coal', 'Coal', '--f-coal'], ['gas', 'Gas', '--f-gas'], ['battery', 'Battery discharge', '--f-battery']]
    .map(([k, name, cl]) => ({ name, color: css(cl), points: recent.map((m, j) => [mx[j], m[k]]), width: 2.5 }));
  lineChart($('story-chart-3'), {
    series: monthSeries,
    yMin: 0,
    yFormat: gwh,
    yTickFormat: (v) => n0(v),
    tooltip: (t) => {
      const m = recent[mx.indexOf(t)];
      return m ? `<strong>${monthName(m.month)}</strong>${monthSeries.map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${gwh(m[s.name === 'Coal' ? 'coal' : s.name === 'Gas' ? 'gas' : 'battery'])}</b></div>`).join('')}` : '';
    },
  });
  $('story-legend-3').innerHTML = legend(monthSeries.map((s) => [s.name, s.color]));

  // Chapter 4: the midday floor.
  const floorYears = years.filter((r) => r.year >= 2016);
  const charging = -lowAt(latest, 'battery').v;
  $('take-4').textContent = `Rooftop solar drove grid demand below AEMO's security level; batteries charging at midday have pushed it back up while the underlying floor keeps falling.`;
  $('body-4').innerHTML = `The lowest grid demand of the year fell from ${mw(row(2016)?.demandMin ?? NaN)} in 2016 to ${mw(demandMinRow.demandMin)} on ${fmtDate(at(demandMinRow.demandMinAt))}, a day when rooftop solar met about 81% of all the power used on the grid (${src(SOURCES.rooftop81, 'pv magazine')}). AEMO had treated 600 MW as the level at which it must act to keep enough controllable plant running (${src(SOURCES.floor600, 'RenewEconomy')}), and since 2022 new home solar systems must be able to be switched off remotely in an emergency (${src(SOURCES.esm, 'AEMO')}). Then the batteries arrived. AEMO counts battery charging as demand, so the yearly minimum rose to ${floorYears.filter((r) => r.year > demandMinRow.year).map((r) => `${mw(r.demandMin)} in ${named(r)}`).join(' and ')}, even though demand without battery charging kept falling, to ${mw(underMinRow.underMin)} on ${fmtDate(at(underMinRow.underMinAt))}. In ${named(latest)} batteries take ${mw(charging)} on average at ${hh(lowAt(latest, 'battery').hr)}. What was a security problem is now a supply of cheap midday energy for the evening.`;
  $('chart-h-4').textContent = 'The lowest grid demand each year';
  $('chart-hint-4').textContent = 'The lowest half hour of operational demand each year, with and without what grid batteries were taking. The dashed line marks 600 MW.';
  const yearMs = (r) => Date.UTC(r.year, 6, 1);
  const fx = floorYears.map(yearMs);
  const floorSeries = [
    { name: 'Without battery charging', color: css('--f-battery'), points: floorYears.map((r, j) => [fx[j], r.underMin]), width: 2.5 },
    { name: 'Grid demand', color: css('--f-wind'), points: floorYears.map((r, j) => [fx[j], r.demandMin]), width: 2.5 },
  ];
  floorSeries.forEach((s) => { s.markers = s.points; });
  lineChart($('story-chart-4'), {
    series: floorSeries,
    yMin: 0,
    yFormat: mw,
    yTickFormat: (v) => n0(v),
    refLines: [{ value: 600, color: css('--ink-3') }],
    tooltip: (t, vals) => `<strong>${named(floorYears[fx.indexOf(t)] ?? latest)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? mw(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-4').innerHTML = `${legend(floorSeries.map((s) => [s.name, s.color]))}<span>Line: 600 MW</span>`;

  // Chapter 5: the coal floor.
  $('take-5').textContent = `Coal has never been off, and one of its stations is private, so the state's coal exit may not bring a coal-free hour.`;
  $('body-5').innerHTML = `The lowest coal half hour in the record is ${mw(coalMinRow.coalMin)}, in ${coalMinRow.year}, and every year since 2020 has bottomed out between ${mw(Math.min(...since2020))} and ${mw(Math.max(...since2020))}.${coal300 ? ` The longest spell under 300 MW is ${hoursText(hours(coal300, step))}` : ''}${coal250 ? ` and under 250 MW ${hoursText(hours(coal250, step))}, from ${fmtDate(at(coal250.start))}` : ''}. The state's plan for its own stations is set: Muja's unit 6 retired in April 2025 (${src(SOURCES.muja6, 'Collie Bulletin')}), Collie (340 MW) closes in October 2027 and the rest of Muja by October 2029 (${src(SOURCES.exit, 'pv magazine')}). Bluewaters is different. It is privately owned, two units of 217 MW, holds capacity contracts to October 2028, and burns coal from the Griffin mine, whose owner is insolvent (${src(SOURCES.bluewaters, 'Boiling Cold')}). In January 2026 the government extended Griffin's state agreement by up to five years from July 2026 (${src(SOURCES.griffin, 'WA Government')}). So the grid's first coal-free half hour depends on a plant the state does not own.`;
  $('chart-h-5').textContent = 'The lowest and average coal output each year';
  $('chart-hint-5').textContent = `MW, Perth calendar years. The last point is ${named(latest)}.`;
  const cy = years.filter((r) => r.year >= firstGrid.year);
  const cx = cy.map(yearMs);
  const coalSeries = [
    { name: 'Average', color: css('--f-coal'), points: cy.map((r, j) => [cx[j], r.coalAvg]), width: 2.5 },
    { name: 'Lowest half hour', color: css('--fossil'), points: cy.map((r, j) => [cx[j], r.coalMin]), width: 2.5 },
  ];
  coalSeries.forEach((s) => { s.markers = s.points; });
  lineChart($('story-chart-5'), {
    series: coalSeries,
    yMin: 0,
    yFormat: mw,
    yTickFormat: (v) => n0(v),
    tooltip: (t, vals) => `<strong>${named(cy[cx.indexOf(t)] ?? latest)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? mw(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-legend-5').innerHTML = legend(coalSeries.map((s) => [s.name, s.color]));
}
