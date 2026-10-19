// The Australia page: the latest data, the shared Records card and the
// story, for the whole National Electricity Market or any one state.
import { formatDuration, slotTime } from '../records.js';
import { fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import au, { AREAS } from '../countries/au.js';
import { loadData, dataEnd, metricSeries, generationTotal, fuelsWhere, windowPoints as corePoints } from '../core/dataset.js';
import { createRecordsTool } from '../core/records-tool.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, setupNowWindows, windowSlots, agoText, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';
import { renderStory as drawStory, drawStoryCharts, storyFigures, LEVELS } from './story.js';

setTimeZone(au.timeZone);

const $ = (id) => document.getElementById(id);
const FUELS = au.fuels;
const FOSSIL = fuelsWhere(au, 'fossil');
const RENEWABLE = fuelsWhere(au, 'renewable');
const COAL = ['coal', 'lignite'];
const SOLAR = ['solar_utility', 'solar_rooftop'];

// Each state's share of the NEM's generation, roughly, to scale the GW ladders.
const SCALE = { nem: 1, nsw: 0.33, qld: 0.31, vic: 0.25, sa: 0.065, tas: 0.05 };
const nice = (v) => +v.toPrecision(v < 1 ? 1 : 2);

let area = 'nem';
let data;
let records;
let end; // one past the last slot with data

const windowPoints = (values, days) => corePoints(data, values, days, end);
const series = (d, members, opts) => metricSeries(d, au, members, opts);

/** The country config for one area: the same fuels, GW ladders scaled to its size. */
function areaConfig(a) {
  if (a === 'nem') return au;
  const presets = Object.fromEntries(Object.entries(au.presets).map(([k, p]) => [k, { ...p, gw: [...new Set(p.gw.map((v) => nice(v * SCALE[a])))] }]));
  return { ...au, name: AREAS[a], dataPath: `../data/au/${a}`, presets };
}

function readArea() {
  const a = new URLSearchParams(location.hash.slice(1)).get('r');
  if (AREAS[a]) area = a;
}

// The Records card rewrites the URL, so it keeps the area in it too.
const areaHash = { read: () => {}, write: (p) => { if (area !== 'nem') p.set('r', area); } };

function setupControls() {
  let resize;
  addEventListener('resize', () => {
    clearTimeout(resize);
    resize = setTimeout(redrawAll, 150);
  });
  document.addEventListener('toggle', (e) => {
    // Charts in a closed chapter have no width, so draw them once it opens.
    if (e.target.matches?.('details.chapter') && e.target.open && data) drawStoryCharts(story, data, saStory);
  }, true);
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.next-ch');
    if (!btn) return;
    btn.closest('details.chapter').open = false;
    const next = $(btn.dataset.next);
    next.open = true;
    next.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // Links from the summary open their chapter.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-open]');
    if (!link) return;
    e.preventDefault();
    const ch = $(link.dataset.open);
    ch.open = true;
    ch.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.querySelectorAll('[data-region]').forEach((b) => b.addEventListener('click', () => {
    if (area === b.dataset.region) return;
    area = b.dataset.region;
    loadArea();
  }));
}

function redrawAll() {
  if (!data) return;
  drawStoryCharts(story, data, saStory);
  records.update();
}

// One headline figure set large, with the other highlights as a list beside it.
function factsHtml(big, sub, rest) {
  return `<div class="headline"><div class="big">${big}</div><div class="sub">${sub}</div></div>
    <ul class="fact-list">${rest.map(([c, label, v, when]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${label}</b> <span class="v">${v}</span> <span class="sub">${when}</span></span></li>`).join('')}</ul>`;
}

// The Right now panel, as on the GB page. AEMO's rolling reports keep the
// data within the hour, so Live is the latest half hour.
const fuel = (k) => ({ label: FUELS[k].label, cols: [k], color: FUELS[k].color });
const NOW_GROUPS = [
  { label: 'Renewables', color: '--lowcarbon', fuels: ['wind', 'solar_utility', 'solar_rooftop', 'hydro', 'biomass'].map(fuel) },
  { label: 'Fossil fuels', color: '--fossil', fuels: ['coal', 'lignite', 'gas', 'oil'].map(fuel) },
];
let NOW_WINDOWS;
let nowWindow;
const INFO = {
  Renewables: 'Wind, solar farms, rooftop solar, hydro and bioenergy.',
  Wind: 'Wind farms, most of them in Victoria, South Australia and New South Wales.',
  'Solar farms': 'Grid-scale solar farms, which report to AEMO every five minutes.',
  'Rooftop solar': 'Panels on homes and businesses. AEMO estimates their output from a sample of systems; to the grid it shows up as lower demand.',
  Hydro: 'Snowy Hydro, Tasmania and Wivenhoe, including pumped hydro when generating.',
  Bioenergy: 'Bagasse at Queensland sugar mills, landfill gas and biomass.',
  'Fossil fuels': 'Black coal, brown coal, gas, and diesel and oil.',
  'Black coal': 'Coal stations in New South Wales and Queensland.',
  'Brown coal': "Victoria's Latrobe Valley stations: Loy Yang A, Loy Yang B and Yallourn.",
  Gas: 'Gas turbines and steam plant, including coal seam and coal mine gas.',
  'Diesel and oil': 'Diesel and kerosene peakers, used at times of tight supply.',
  'Battery discharge': 'What grid-scale batteries send into the grid. Home batteries are not in the data.',
  'Battery charging': 'What grid-scale batteries take from the grid, mostly in the middle of the day.',
};
const info = infoButton(INFO);

// Records to watch, as shares of the area's mean generation, for the recent records list.
const NOW_WATCH = [
  { label: 'Fossil fuels', members: FOSSIL, mode: 'below', share: [0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05] },
  { label: 'Coal', members: COAL, mode: 'below', share: [0.5, 0.4, 0.3, 0.2, 0.1] },
  { label: 'Renewables', members: RENEWABLE, mode: 'above', share: [0.4, 0.5, 0.6, 0.7, 0.8, 0.9] },
  { label: 'Wind', members: ['wind'], mode: 'above', share: [0.2, 0.3, 0.4, 0.5, 0.6] },
  { label: 'Batteries', members: ['battery'], mode: 'above', share: [0.02, 0.05, 0.1, 0.15] },
];
const NOW_PEAKS = [
  { label: 'Most wind', members: ['wind'], unit: 'gw', best: 'max' },
  { label: 'Most solar', members: SOLAR, unit: 'gw', best: 'max' },
  { label: 'Most battery output', members: ['battery'], unit: 'gw', best: 'max' },
  { label: 'Least fossil fuel', members: FOSSIL, unit: 'gw', best: 'min' },
  { label: 'Greenest half hour', members: RENEWABLE, unit: 'pct', best: 'max' },
];
const watchFor = (meanGw) => NOW_WATCH.map((w) => ({ ...w, gw: [...new Set(w.share.map((f) => nice(f * meanGw)))] }));
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { 'Fossil fuels': '--fossil', Coal: '--f-coal', Renewables: '--lowcarbon', Wind: '--f-wind', Batteries: '--f-battery', 'Most wind': '--f-wind', 'Most solar': '--f-solar', 'Most battery output': '--f-battery', 'Least fossil fuel': '--fossil', 'Greenest half hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest half hour': 'Greenest', 'Most battery output': 'Most battery' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: au.timeZone });
const shortDuration = (slots) => formatDuration(slots).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => (v < 1 ? `${Math.round(v * 1000)} MW` : `${+v.toFixed(1)} GW`);
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : gw(r.value);
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (NEM time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
  }
  const what = `${r.label === 'Fossil fuels' ? 'Fossil' : r.label} ${r.mode === 'below' ? 'under' : 'over'} ${gw(r.threshold)}`;
  const when = r.live ? `since ${fmtDate(r.startMs)}, still going at the latest data` : `${fmtDate(r.startMs)} to ${fmtDate(r.endMs)}`;
  return `<div class="nr rec${r.live ? ' is-live' : ''}" data-tip="The longest spell on record, ${when}." style="--tint: var(${color})"><span class="lbl">${what}</span><span class="sm">${r.live ? 'ongoing' : shortDay(r.endMs)}</span><span class="num">${shortDuration(r.slots)}</span><span class="mark-tile" style="background:var(${r.live ? '--sunny' : color})"></span></div>`;
}

// The right half: recent records, then grid batteries both ways, mirroring the left.
function nowRightHtml(recs, bat, total) {
  const rows = (recs ?? []).slice(0, NOW_RECORD_ROWS).map(recordRow);
  if (!recs) while (rows.length < 5) rows.push('<div class="nr rec"><span></span></div>');
  while (rows.length < NOW_RECORD_ROWS) rows.push(`<div class="nr rec">${rows.length === 0 && recs?.length === 0 ? '<span class="lbl sm">No new records in the last six months</span>' : ''}</div>`);
  const pc = (v) => (Number.isFinite(v) && total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');
  return `
    <div class="nr head" style="--tint: var(--sunny)"><span class="lbl wide">Recent records <span class="sm">last 6 months of data</span></span><span></span></div>
    ${rows.join('')}
    <div class="nr head" style="--tint: var(--f-battery)"><span class="lbl">Grid batteries <span class="sm">net</span></span><span></span>${num(Number.isFinite(bat.dis) ? fmtGw(bat.dis - bat.chg) : '—')}<span></span></div>
    <div class="nr" style="--tint: var(--f-battery)"><span class="lbl">${info('Battery discharge')}Discharging</span><span class="num">${pc(bat.dis)}</span>${num(fmtGw(bat.dis))}${sparkTile(bat.disSeries, '--f-battery', NOW_WINDOWS[nowWindow].span)}</div>
    <div class="nr" style="--tint: var(--s1)"><span class="lbl">${info('Battery charging')}Charging</span><span class="num">${pc(bat.chg)}</span>${num(Number.isFinite(bat.chg) ? `−${fmtGw(bat.chg)}` : '—')}${sparkTile(bat.chgSeries?.map((v) => -v), '--s1', NOW_WINDOWS[nowWindow].span)}</div>`;
}

let nowShown = null;
let nowFigures = {};
let nowRecords = null;

function drawFigures(figs) {
  $('now-groups').innerHTML = nowLeftHtml(figs.groups, figs.total, info, NOW_WINDOWS[nowWindow].span);
  $('now-donut').innerHTML = donut(figs.groups, figs.total, NOW_WINDOWS[nowWindow].sub);
  fitDonutText();
  $('now-right').innerHTML = nowRightHtml(nowRecords, figs.bat, figs.total);
}

function renderNow(animate = false) {
  const i = end - 1;
  const win = NOW_WINDOWS[nowWindow];
  const slots = windowSlots(win, 30);
  const figs = groupFigures(NOW_GROUPS, data.columns, i, slots);
  const dis = windowFigures((k) => data.columns.battery[k], i, slots);
  const chg = windowFigures((k) => -data.columns.battery_charge[k], i, slots);
  figs.bat = { dis: dis.value, chg: chg.value, disSeries: dis.series, chgSeries: chg.series };
  nowFigures = hoverFigures(figs, win.sub, win.span);
  if (!nowRecords) {
    const year = groupFigures(NOW_GROUPS, data.columns, i, 48 * 365);
    nowRecords = recentRecords({ ...data, length: end }, { watch: watchFor(year.total / 1000), peaks: NOW_PEAKS, series, total: generationTotal(data, au), greenFloor: year.total / 4, limit: NOW_RECORD_ROWS });
  }
  const latest = groupFigures(NOW_GROUPS, data.columns, i, 1);
  liveFavicon(latest.groups, latest.total);
  if (animate && nowShown) tweenFigures(nowShown, figs, drawFigures, { batKeys: ['dis', 'chg'], done: () => { nowShown = figs; } });
  else { nowShown = figs; drawFigures(figs); }
}

function renderNowPlaceholder() {
  $('now-groups').innerHTML = nowLeftHtml(NOW_GROUPS.map((g) => ({ ...g, now: NaN, fuels: g.fuels.map((f) => ({ ...f, value: NaN, now: NaN })) })), 0, info, '');
  const ring = NOW_GROUPS.map((g) => ({ ...g, color: '--cell-empty', fuels: g.fuels.map((f) => ({ ...f, color: '--cell-empty', now: 1 })) }));
  $('now-donut').innerHTML = donut(ring, ring.reduce((s, g) => s + g.fuels.length, 0)).replace(/>[\d.]+ GW</, '>— GW<');
  $('now-right').innerHTML = nowRightHtml(null, {}, 0);
}

// The story is worked out once per area, and drawn by story.js. Its chapter
// on South Australia needs that state's figures whichever area is shown, so
// they are worked out once and kept.
let story = null;
let saStory = null;
async function loadSaStory() {
  if (saStory) return saStory;
  const sa = area === 'sa' ? data : await loadData('../data/au/sa');
  saStory = storyFigures(sa, dataEnd(sa, au), au, LEVELS.sa);
  return saStory;
}
function renderStory() {
  story = drawStory({ data, end, country: au, area, areaName: AREAS[area], cache: area === 'sa' && saStory ? { area, f: saStory } : story, factsHtml, sa: saStory });
}

async function loadArea() {
  document.querySelectorAll('[data-region]').forEach((b) => b.setAttribute('aria-checked', b.dataset.region === area));
  const where = area === 'nem' ? 'the whole NEM' : AREAS[area];
  $('updated').textContent = `Loading the data for ${where}.`;
  records = createRecordsTool({ host: $('records'), country: areaConfig(area), hash: areaHash });
  try {
    data = await loadData(`../data/au/${area}`);
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = dataEnd(data, au);
  nowRecords = null;
  story = null;
  const pending = data.meta.months?.toFetch ? ` ${data.meta.months.toFetch} more months are still being fetched.` : '';
  const latest = slotTime(end, data.startMs);
  $('updated').textContent = `${where === 'the whole NEM' ? 'The whole NEM' : where}: data from ${fmtDate(data.startMs)} to ${fmtDateTime(latest)} NEM time (AEST), ${agoText(latest)}. Updated every 30 minutes from AEMO's 5-minute reports.${pending}`;
  renderNow();
  records.setData(data, { end });
  try {
    await loadSaStory();
  } catch (err) {
    console.error(err);
  }
  renderStory();
}

async function main() {
  // Before the Records card rewrites the URL, so a link that arrived with settings is still visible.
  startAnalytics();
  readArea();
  setupControls();
  ({ windows: NOW_WINDOWS, first: nowWindow } = setupNowWindows(au, (key) => {
    nowWindow = key;
    if (data) renderNow(true);
  }));
  renderNowPlaceholder();
  setupNowHover(() => nowFigures);
  await loadArea();
}

main();
