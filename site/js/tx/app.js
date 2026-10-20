// The Texas page: the latest data, the shared Records card and the story.
import { formatDuration, slotTime } from '../records.js';
import { fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import tx from '../countries/tx.js';
import { loadData, dataEnd, stepOf } from '../core/dataset.js';
import { createRecordsTool } from '../core/records-tool.js';
import { FUELS, FOSSIL, RENEWABLE, metricSeries, generationTotal } from './data.js';
import { renderStory as drawStory, storyFigures } from './story.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, setupNowWindows, windowSlots, agoText, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';

setTimeZone(tx.timeZone);

const $ = (id) => document.getElementById(id);

let data;
let records;
let end; // one past the last slot with data
const step = () => stepOf(data);

function setupControls() {
  let resize;
  addEventListener('resize', () => {
    clearTimeout(resize);
    resize = setTimeout(redrawAll, 150);
  });
  for (const ch of document.querySelectorAll('details.chapter')) {
    ch.addEventListener('toggle', () => { if (ch.open && data) renderStory(); });
  }
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
}

function redrawAll() {
  if (!data) return;
  renderStory();
  records.update();
}

// The latest data panel, the same as the GB page's Right now panel. ERCOT's
// dashboard updates every five minutes; Live ends at the latest complete
// quarter hour the last run fetched.
const fuel = (k) => ({ label: FUELS[k].label, cols: [k], color: FUELS[k].color });
const NOW_GROUPS = [
  { label: 'Fossil fuels', color: '--fossil', fuels: ['gas', 'coal'].map(fuel) },
  { label: 'Renewables', color: '--lowcarbon', fuels: ['wind', 'solar', 'hydro', 'biomass'].map(fuel) },
  { label: 'Nuclear', color: '--f-nuclear', fuels: ['nuclear'].map(fuel) },
  { label: 'Batteries and other', color: '--f-battery', fuels: ['other'].map(fuel) },
];
let NOW_WINDOWS;
let nowWindow;
const INFO = {
  'Fossil fuels': 'Gas and coal.',
  Gas: 'Combined-cycle plants, peaking turbines and combined heat and power. ERCOT reports them as one figure on its live dashboard.',
  Coal: 'Coal and lignite plants, such as Martin Lake, Limestone and W. A. Parish.',
  Renewables: 'Wind, solar, hydro and biomass.',
  Wind: 'Wind farms, most of them in West Texas and the Panhandle, plus a coastal fleet near Corpus Christi.',
  Solar: 'Utility-scale solar farms. Rooftop panels are not counted.',
  Hydro: 'Dams on the Colorado, Brazos and other rivers.',
  Biomass: 'Wood and landfill gas. ERCOT\'s live dashboard folds it into Other, so it is blank for the latest days.',
  Nuclear: 'Comanche Peak and the South Texas Project, four reactors.',
  'Batteries and other': 'ERCOT\'s "Other": battery discharge, nearly all of it in recent years, plus petroleum coke and oil. Battery charging is not counted.',
};
const info = infoButton(INFO);

// Records to watch on the Texas grid, in GW, for the recent records list.
const NOW_WATCH = [
  { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [20, 15, 10] },
  { label: 'Gas', members: ['gas'], mode: 'below', gw: [15, 10, 5] },
  { label: 'Coal', members: ['coal'], mode: 'below', gw: [5, 3, 2, 1] },
  { label: 'Solar', members: ['solar'], mode: 'above', gw: [20, 25, 30] },
  { label: 'Batteries', members: ['other'], mode: 'above', gw: [5, 8, 10] },
];
const NOW_PEAKS = [
  { label: 'Most solar', members: ['solar'], unit: 'gw', best: 'max' },
  { label: 'Most wind', members: ['wind'], unit: 'gw', best: 'max' },
  { label: 'Most batteries and other', members: ['other'], unit: 'gw', best: 'max' },
  { label: 'Least fossil fuel', members: FOSSIL, unit: 'gw', best: 'min' },
  { label: 'Greenest quarter hour', members: RENEWABLE, unit: 'pct', best: 'max' },
];
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { 'Fossil fuels': '--fossil', Gas: '--f-gas', Coal: '--f-coal', Wind: '--f-wind', Solar: '--f-solar', Batteries: '--f-battery', 'Most wind': '--f-wind', 'Most solar': '--f-solar', 'Most batteries and other': '--f-battery', 'Least fossil fuel': '--fossil', 'Greenest quarter hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest quarter hour': 'Greenest', 'Most batteries and other': 'Most batteries' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-US', { day: 'numeric', month: 'short', timeZone: tx.timeZone });
const shortDuration = (slots) => formatDuration(slots, step()).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => `${+v.toFixed(v < 1 ? 2 : 1)} GW`;
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (Central time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
  }
  const what = `${r.label === 'Fossil fuels' ? 'Fossil' : r.label} ${r.mode === 'below' ? 'under' : 'over'} ${gw(r.threshold)}`;
  const when = r.live ? `since ${fmtDate(r.startMs)}, still going at the latest data` : `${fmtDate(r.startMs)} to ${fmtDate(r.endMs)}`;
  return `<div class="nr rec${r.live ? ' is-live' : ''}" data-tip="The longest spell on record, ${when}." style="--tint: var(${color})"><span class="lbl">${what}</span><span class="sm">${r.live ? 'ongoing' : shortDay(r.endMs)}</span><span class="num">${shortDuration(r.slots)}</span><span class="mark-tile" style="background:var(${r.live ? '--sunny' : color})"></span></div>`;
}

// The right half: recent records.
function nowRightHtml(recs) {
  const rows = (recs ?? []).slice(0, NOW_RECORD_ROWS).map(recordRow);
  if (!recs) while (rows.length < 5) rows.push('<div class="nr rec"><span></span></div>');
  while (rows.length < NOW_RECORD_ROWS) rows.push(`<div class="nr rec">${rows.length === 0 && recs?.length === 0 ? '<span class="lbl sm">No new records in the last six months</span>' : ''}</div>`);
  return `
    <div class="nr head" style="--tint: var(--sunny)"><span class="lbl wide">Recent records <span class="sm">last 6 months</span></span><span></span></div>
    ${rows.join('')}`;
}

let nowShown = null;
let nowFigures = {};
let nowRecords = null;

function drawFigures(figs) {
  $('now-groups').innerHTML = nowLeftHtml(figs.groups, figs.total, info, NOW_WINDOWS[nowWindow].span);
  $('now-donut').innerHTML = donut(figs.groups, figs.total, NOW_WINDOWS[nowWindow].sub);
  fitDonutText();
  $('now-right').innerHTML = nowRightHtml(nowRecords);
}

function renderNow(animate = false) {
  const i = end - 1;
  const win = NOW_WINDOWS[nowWindow];
  const slots = windowSlots(win, step());
  const figs = groupFigures(NOW_GROUPS, data.columns, i, slots);
  nowFigures = hoverFigures(figs, win.sub, win.span);
  nowRecords ??= recentRecords({ ...data, length: end }, { watch: NOW_WATCH, peaks: NOW_PEAKS, series: metricSeries, total: generationTotal(data), greenFloor: 30000, limit: NOW_RECORD_ROWS });
  const latest = groupFigures(NOW_GROUPS, data.columns, i, 1);
  liveFavicon(latest.groups, latest.total);
  if (animate && nowShown) tweenFigures(nowShown, figs, drawFigures, { done: () => { nowShown = figs; } });
  else { nowShown = figs; drawFigures(figs); }
}

function renderNowPlaceholder() {
  $('now-groups').innerHTML = nowLeftHtml(NOW_GROUPS.map((g) => ({ ...g, now: NaN, fuels: g.fuels.map((f) => ({ ...f, value: NaN, now: NaN })) })), 0, info, '');
  const ring = NOW_GROUPS.map((g) => ({ ...g, color: '--cell-empty', fuels: g.fuels.map((f) => ({ ...f, color: '--cell-empty', now: 1 })) }));
  $('now-donut').innerHTML = donut(ring, ring.reduce((s, g) => s + g.fuels.length, 0)).replace(/>[\d.]+ GW</, '>— GW<');
  $('now-right').innerHTML = nowRightHtml(null);
}

let story = null;
function renderStory() {
  story ??= storyFigures(data, end);
  drawStory(data, end, story);
}

async function main() {
  // Before the Records card rewrites the URL, so a link that arrived with settings is still visible.
  startAnalytics();
  records = createRecordsTool({ host: $('records'), country: tx });
  setupControls();
  ({ windows: NOW_WINDOWS, first: nowWindow } = setupNowWindows(tx, (key) => {
    nowWindow = key;
    if (data) renderNow(true);
  }));
  renderNowPlaceholder();
  setupNowHover(() => nowFigures);
  try {
    data = await loadData(tx.dataPath);
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = dataEnd(data, tx);
  const latest = slotTime(end - 1, data.startMs, step());
  $('updated').textContent = `Data from ${fmtDate(data.startMs)} to ${fmtDateTime(latest)} Central time, ${agoText(latest)}. ERCOT publishes its full reports about monthly; the latest days come from its live dashboard.`;
  renderNow();
  renderStory();
  records.setData(data, { end });
}

main();
