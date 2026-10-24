// The Ontario page: the latest data, the shared Records card and the story.
import { formatDuration, slotTime } from '../records.js';
import { fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import on from '../countries/on.js';
import { loadData, dataEnd, stepOf } from '../core/dataset.js';
import { createRecordsTool } from '../core/records-tool.js';
import { FUELS, FOSSIL, LOW_CARBON, metricSeries, generationTotal } from './data.js';
import { renderStory as drawStory, storyFigures } from './story.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, setupNowWindows, windowSlots, agoText, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';

setTimeZone(on.timeZone);

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

// The Right now panel, the same as the GB page's. The IESO's generator report
// fills in each hour, so the latest hour is usually about an hour old.
const fuel = (k) => ({ label: FUELS[k].label, cols: [k], color: FUELS[k].color });
const NOW_GROUPS = [
  { label: 'Fossil fuels', color: '--fossil', fuels: ['gas'].map(fuel) },
  { label: 'Low carbon', color: '--lowcarbon', fuels: ['nuclear', 'hydro', 'wind', 'solar', 'biomass'].map(fuel) },
  { label: 'Storage', color: '--f-battery', fuels: ['battery'].map(fuel) },
];
let NOW_WINDOWS;
let nowWindow;
const INFO = {
  'Fossil fuels': 'Gas, Ontario\'s only fossil fuel since its last coal plant, Thunder Bay, stopped burning coal in 2014.',
  Gas: 'Gas plants, most of them around Toronto, Sarnia and Windsor: Portlands, Goreway, Halton Hills, Napanee, Greenfield and Lennox, plus factories\' and hospitals\' own plants.',
  'Low carbon': 'Nuclear, hydro, wind, solar and biofuel.',
  Nuclear: 'Bruce (the world\'s largest nuclear plant by output), Darlington and Pickering, all on the Great Lakes.',
  Hydro: 'Niagara Falls (Sir Adam Beck), the St Lawrence at Cornwall, and dams across the north.',
  Wind: 'Wind farms in southwestern Ontario and along Lake Huron and Lake Erie.',
  Solar: 'Only the solar farms connected to the transmission grid. Most of Ontario\'s solar is on the distribution network and shows up as lower demand instead.',
  Biofuel: 'Atikokan, a coal plant converted to wood pellets, and two small wood-waste plants.',
  Storage: 'Grid batteries, such as Oneida, Hagersville and Napanee, as they discharge. The IESO does not publish their charging.',
  'Battery discharge': 'Grid batteries, such as Oneida, Hagersville and Napanee, as they discharge. The IESO does not publish their charging.',
};
const info = infoButton(INFO);

// Records to watch on Ontario's grid, in GW, for the recent records list.
const NOW_WATCH = [
  { label: 'Gas', members: FOSSIL, mode: 'below', gw: [2, 1, 0.5] },
  { label: 'Gas, high', members: FOSSIL, mode: 'above', gw: [4, 5, 6, 7] },
  { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.25, 0.5, 1] },
];
const NOW_PEAKS = [
  { label: 'Most battery discharge', members: ['battery'], unit: 'gw', best: 'max' },
  { label: 'Most gas', members: FOSSIL, unit: 'gw', best: 'max' },
  { label: 'Least gas', members: FOSSIL, unit: 'gw', best: 'min' },
  { label: 'Cleanest hour', members: LOW_CARBON, unit: 'pct', best: 'max' },
];
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { Gas: '--fossil', 'Gas, high': '--fossil', 'Battery discharge': '--f-battery', 'Most battery discharge': '--f-battery', 'Most gas': '--fossil', 'Least gas': '--fossil', 'Cleanest hour': '--lowcarbon' };
const PEAK_NAMES = { 'Most battery discharge': 'Most battery', 'Cleanest hour': 'Cleanest' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: on.timeZone });
const shortDuration = (slots) => formatDuration(slots, step()).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => `${+v.toFixed(v < 1 ? 2 : 1)} GW`;
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (Eastern time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
  }
  const what = `${r.label.replace(', high', '').replace('Battery discharge', 'Battery')} ${r.mode === 'below' ? 'under' : 'over'} ${gw(r.threshold)}`;
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
  nowRecords ??= recentRecords({ ...data, length: end }, { watch: NOW_WATCH, peaks: NOW_PEAKS, series: metricSeries, total: generationTotal(data), greenFloor: 10000, limit: NOW_RECORD_ROWS });
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
  records = createRecordsTool({ host: $('records'), country: on });
  setupControls();
  ({ windows: NOW_WINDOWS, first: nowWindow } = setupNowWindows(on, (key) => {
    nowWindow = key;
    if (data) renderNow(true);
  }));
  renderNowPlaceholder();
  setupNowHover(() => nowFigures);
  try {
    data = await loadData(on.dataPath);
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = dataEnd(data, on);
  const latest = slotTime(end - 1, data.startMs, step());
  $('updated').textContent = `Data from ${fmtDate(data.startMs)} to ${fmtDateTime(latest)} Eastern time, ${agoText(latest)}. The IESO publishes each hour shortly after it ends.`;
  renderNow();
  renderStory();
  records.setData(data, { end });
}

main();
