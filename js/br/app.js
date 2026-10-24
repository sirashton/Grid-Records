// The Brazil page: the latest data, the shared Records card and the story.
import { formatDuration, slotTime } from '../records.js';
import { fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import br from '../countries/br.js';
import { loadData, dataEnd, stepOf } from '../core/dataset.js';
import { createRecordsTool } from '../core/records-tool.js';
import { FUELS, FOSSIL, RENEWABLE, WIND_SOLAR, SOLAR, metricSeries, generationTotal } from './data.js';
import { renderStory as drawStory, storyFigures } from './story.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, setupNowWindows, windowSlots, agoText, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';

setTimeZone(br.timeZone);

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

// The latest data panel, the same as the GB page's Right now panel. ONS posts
// the current month's file about once a day, so each time frame ends at the
// latest hour of data.
const fuel = (k) => ({ label: FUELS[k].label, cols: [k], color: FUELS[k].color });
const NOW_GROUPS = [
  { label: 'Renewables', color: '--lowcarbon', fuels: ['hydro', 'wind', 'solar_utility', 'solar_rooftop', 'biomass'].map(fuel) },
  { label: 'Fossil fuels', color: '--fossil', fuels: ['gas', 'coal', 'oil', 'other'].map(fuel) },
  { label: 'Nuclear', color: '--f-nuclear', fuels: ['nuclear'].map(fuel) },
];
let NOW_WINDOWS;
let nowWindow;
const INFO = {
  Renewables: 'Hydro, wind, solar and biomass.',
  Hydro: 'Dams on the Paraná, São Francisco, Tocantins and Madeira rivers, and Itaipu, which Brazil shares with Paraguay. Still most of Brazil\'s power.',
  Wind: 'Wind farms, nearly all of them in the Northeast, where the trade winds blow strongest in the dry season.',
  'Solar farms': 'Large solar farms, mostly in Minas Gerais, Bahia, Piauí and the rest of the Northeast.',
  'Rooftop and small solar': 'ONS\'s estimate of distributed generation (MMGD): panels on homes, shops and farms, and small solar plants under 5 MW. Estimated from 2023 only.',
  Biomass: 'Mostly sugarcane bagasse, burnt at the mills during the harvest from April to November.',
  'Fossil fuels': 'Gas, coal, oil and diesel, and other thermal plants.',
  Gas: 'Gas-fired plants, many run only when the reservoirs are low.',
  Coal: 'Coal plants in the South, burning Brazilian coal, and two in the Northeast on imported coal.',
  'Oil and diesel': 'Oil and diesel plants, the most expensive to run, called on in droughts.',
  'Other thermal': 'Plants ONS lists as multi-fuel or burning industrial waste gases, such as at steelworks.',
  Nuclear: 'The two reactors at Angra dos Reis. A third, Angra 3, has been under construction on and off since 1984.',
  'Wind held back': 'Wind output ONS estimates was not generated because it limited the farms, from October 2021.',
  'Solar held back': 'Solar output ONS estimates was not generated because it limited the farms, from April 2024.',
};
const info = infoButton(INFO);

// Records to watch on the Brazilian grid, in GW, for the recent records list.
const NOW_WATCH = [
  { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [10, 7, 5, 3, 2] },
  { label: 'Wind and solar', members: WIND_SOLAR, mode: 'above', gw: [20, 30, 40, 50, 60] },
  { label: 'Wind', members: ['wind'], mode: 'above', gw: [10, 15, 20, 25, 30] },
  { label: 'Solar', members: SOLAR, mode: 'above', gw: [10, 20, 30, 40, 50] },
  { label: 'Held back', members: ['wind_curtailed', 'solar_curtailed'], mode: 'above', gw: [5, 10, 15, 20] },
];
const NOW_PEAKS = [
  { label: 'Most wind', members: ['wind'], unit: 'gw', best: 'max' },
  { label: 'Most solar', members: SOLAR, unit: 'gw', best: 'max' },
  { label: 'Least fossil fuel', members: FOSSIL, unit: 'gw', best: 'min' },
  { label: 'Greenest hour', members: RENEWABLE, unit: 'pct', best: 'max' },
];
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { 'Fossil fuels': '--fossil', 'Wind and solar': '--lowcarbon', Wind: '--f-wind', Solar: '--f-solar', 'Held back': '--f-other', 'Most wind': '--f-wind', 'Most solar': '--f-solar', 'Least fossil fuel': '--fossil', 'Greenest hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest hour': 'Greenest' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: br.timeZone });
const shortDuration = (slots) => formatDuration(slots, step()).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => `${+v.toFixed(v < 1 ? 2 : 1)} GW`;
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (Brasília time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
  }
  const what = `${r.label === 'Fossil fuels' ? 'Fossil' : r.label} ${r.mode === 'below' ? 'under' : 'over'} ${gw(r.threshold)}`;
  const when = r.live ? `since ${fmtDate(r.startMs)}, still going at the latest data` : `${fmtDate(r.startMs)} to ${fmtDate(r.endMs)}`;
  return `<div class="nr rec${r.live ? ' is-live' : ''}" data-tip="The longest spell on record, ${when}." style="--tint: var(${color})"><span class="lbl">${what}</span><span class="sm">${r.live ? 'ongoing' : shortDay(r.endMs)}</span><span class="num">${shortDuration(r.slots)}</span><span class="mark-tile" style="background:var(${r.live ? '--sunny' : color})"></span></div>`;
}

// The right half: recent records, then what was held back, mirroring the left.
function nowRightHtml(recs, held, total) {
  const rows = (recs ?? []).slice(0, NOW_RECORD_ROWS).map(recordRow);
  if (!recs) while (rows.length < 5) rows.push('<div class="nr rec"><span></span></div>');
  while (rows.length < NOW_RECORD_ROWS) rows.push(`<div class="nr rec">${rows.length === 0 && recs?.length === 0 ? '<span class="lbl sm">No new records in the last six months</span>' : ''}</div>`);
  const pc = (v) => (Number.isFinite(v) && total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');
  const span = NOW_WINDOWS[nowWindow].span;
  const row = (label, v, series, color) => `<div class="nr" style="--tint: var(${color})"><span class="lbl">${info(label)}${label}</span><span class="num">${pc(v)}</span>${num(fmtGw(v))}${sparkTile(series, color, span)}</div>`;
  return `
    <div class="nr head" style="--tint: var(--sunny)"><span class="lbl wide">Recent records <span class="sm">last 6 months</span></span><span></span></div>
    ${rows.join('')}
    <div class="nr head" style="--tint: var(--f-other)"><span class="lbl">Held back</span><span></span><span></span><span></span></div>
    ${row('Wind held back', held.wnd, held.wndSeries, '--f-wind')}
    ${row('Solar held back', held.sol, held.solSeries, '--f-solar')}`;
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
  const slots = windowSlots(win, step());
  const figs = groupFigures(NOW_GROUPS, data.columns, i, slots);
  const w = (col) => windowFigures((k) => data.columns[col][k], i, slots);
  const [wnd, sol] = [w('wind_curtailed'), w('solar_curtailed')];
  figs.bat = { wnd: wnd.value, wndSeries: wnd.series, sol: sol.value, solSeries: sol.series };
  nowFigures = hoverFigures(figs, win.sub, win.span);
  nowRecords ??= recentRecords({ ...data, length: end }, { watch: NOW_WATCH, peaks: NOW_PEAKS, series: metricSeries, total: generationTotal(data), greenFloor: 40000, limit: NOW_RECORD_ROWS });
  const latest = groupFigures(NOW_GROUPS, data.columns, i, 1);
  liveFavicon(latest.groups, latest.total);
  if (animate && nowShown) tweenFigures(nowShown, figs, drawFigures, { batKeys: ['wnd', 'sol'], done: () => { nowShown = figs; } });
  else { nowShown = figs; drawFigures(figs); }
}

function renderNowPlaceholder() {
  $('now-groups').innerHTML = nowLeftHtml(NOW_GROUPS.map((g) => ({ ...g, now: NaN, fuels: g.fuels.map((f) => ({ ...f, value: NaN, now: NaN })) })), 0, info, '');
  const ring = NOW_GROUPS.map((g) => ({ ...g, color: '--cell-empty', fuels: g.fuels.map((f) => ({ ...f, color: '--cell-empty', now: 1 })) }));
  $('now-donut').innerHTML = donut(ring, ring.reduce((s, g) => s + g.fuels.length, 0)).replace(/>[\d.]+ GW</, '>— GW<');
  $('now-right').innerHTML = nowRightHtml(null, {}, 0);
}

let story = null;
function renderStory() {
  story ??= storyFigures(data, end);
  drawStory(data, end, story);
}

async function main() {
  // Before the Records card rewrites the URL, so a link that arrived with settings is still visible.
  startAnalytics();
  records = createRecordsTool({ host: $('records'), country: br });
  setupControls();
  ({ windows: NOW_WINDOWS, first: nowWindow } = setupNowWindows(br, (key) => {
    nowWindow = key;
    if (data) renderNow(true);
  }));
  renderNowPlaceholder();
  setupNowHover(() => nowFigures);
  try {
    data = await loadData(br.dataPath);
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = dataEnd(data, br);
  const latest = slotTime(end - 1, data.startMs, step());
  $('updated').textContent = `Data from ${fmtDate(data.startMs)} to ${fmtDateTime(latest)} Brasília time, ${agoText(latest)}. ONS posts the current month's plant data about once a day.`;
  renderNow();
  renderStory();
  records.setData(data, { end });
}

main();
