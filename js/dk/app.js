// The Denmark page: the latest data, the shared Records card and the story.
import { formatDuration, slotTime } from '../records.js';
import { fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import dk from '../countries/dk.js';
import { loadData, dataEnd, stepOf } from '../core/dataset.js';
import { createRecordsTool } from '../core/records-tool.js';
import { FUELS, FOSSIL, RENEWABLE, WIND, metricSeries, generationTotal } from './data.js';
import { renderStory as drawStory, storyFigures } from './story.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, setupNowWindows, windowSlots, agoText, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';

setTimeZone(dk.timeZone);

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

// The latest data panel, the same as the GB page's Right now panel. Energinet
// publishes each hour shortly after it ends, so Live is the latest whole hour.
const fuel = (k) => ({ label: FUELS[k].label, cols: [k], color: FUELS[k].color });
const NOW_GROUPS = [
  { label: 'Wind', color: '--f-wind', fuels: WIND.map(fuel) },
  { label: 'Other renewables', color: '--lowcarbon', fuels: ['solar', 'biomass', 'hydro'].map(fuel) },
  { label: 'Waste', color: '--f-other', fuels: ['waste'].map(fuel) },
  { label: 'Fossil fuels', color: '--fossil', fuels: ['coal', 'gas', 'oil'].map(fuel) },
];
let NOW_WINDOWS;
let nowWindow;
const INFO = {
  Wind: 'Onshore and offshore wind, together the largest source of Danish power.',
  'Onshore wind': 'Wind turbines on land, most of them in Jutland (DK1).',
  'Offshore wind': 'Wind farms at sea, from Horns Rev and Anholt to Kriegers Flak.',
  'Other renewables': 'Solar, biomass and biogas, and a little hydro.',
  Solar: 'Solar fed into the grid. Energinet estimates rooftop solar used on site separately; it is not counted here.',
  'Biomass and biogas': 'Combined heat and power plants whose main fuel is wood pellets, wood chips or straw, and biogas engines.',
  Hydro: 'A few small river plants in Jutland.',
  Waste: 'Waste incineration plants, nearly all of them combined heat and power for district heating. Part of what they burn is fossil (plastics).',
  'Fossil fuels': 'Coal, gas and oil, by each plant\'s main fuel.',
  Coal: 'Coal-fired combined heat and power plants.',
  Gas: 'Gas-fired combined heat and power plants, large and small.',
  Oil: 'Oil-fired plants and engines, mostly reserve and start-up fuel.',
  'Net imports': 'Power flowing in from Norway, Sweden, Germany, the Netherlands and Britain, less what flows out, when that is positive.',
  'Net exports': 'Power flowing out to the neighbours, less what flows in, when that is positive.',
};
const info = infoButton(INFO);

// Records to watch on the Danish grid, in GW, for the recent records list.
const NOW_WATCH = [
  { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [0.3, 0.2, 0.1, 0.05] },
  { label: 'Coal', members: ['coal'], mode: 'below', gw: [0.1, 0.05, 0.01] },
  { label: 'Wind', members: WIND, mode: 'above', gw: [4, 5, 6, 7] },
  { label: 'Solar', members: ['solar'], mode: 'above', gw: [1, 2, 3, 4] },
  { label: 'Imports', members: ['imports'], mode: 'above', gw: [2, 3, 4] },
];
const NOW_PEAKS = [
  { label: 'Most wind', members: WIND, unit: 'gw', best: 'max' },
  { label: 'Most solar', members: ['solar'], unit: 'gw', best: 'max' },
  { label: 'Least fossil fuel', members: FOSSIL, unit: 'gw', best: 'min' },
  { label: 'Greenest hour', members: RENEWABLE, unit: 'pct', best: 'max' },
];
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { 'Fossil fuels': '--fossil', Coal: '--f-coal', Wind: '--f-wind', Solar: '--f-solar', Imports: '--f-imports', 'Most wind': '--f-wind', 'Most solar': '--f-solar', 'Least fossil fuel': '--fossil', 'Greenest hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest hour': 'Greenest' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: dk.timeZone });
const shortDuration = (slots) => formatDuration(slots, step()).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => (v < 1 ? `${Math.round(v * 1000)} MW` : `${+v.toFixed(1)} GW`);
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (Danish time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
  }
  const what = `${r.label === 'Fossil fuels' ? 'Fossil' : r.label} ${r.mode === 'below' ? 'under' : 'over'} ${gw(r.threshold)}`;
  const when = r.live ? `since ${fmtDate(r.startMs)}, still going at the latest data` : `${fmtDate(r.startMs)} to ${fmtDate(r.endMs)}`;
  return `<div class="nr rec${r.live ? ' is-live' : ''}" data-tip="The longest spell on record, ${when}." style="--tint: var(${color})"><span class="lbl">${what}</span><span class="sm">${r.live ? 'ongoing' : shortDay(r.endMs)}</span><span class="num">${shortDuration(r.slots)}</span><span class="mark-tile" style="background:var(${r.live ? '--sunny' : color})"></span></div>`;
}

// The right half: recent records, then trade, mirroring the left.
function nowRightHtml(recs, bat, total) {
  const rows = (recs ?? []).slice(0, NOW_RECORD_ROWS).map(recordRow);
  if (!recs) while (rows.length < 5) rows.push('<div class="nr rec"><span></span></div>');
  while (rows.length < NOW_RECORD_ROWS) rows.push(`<div class="nr rec">${rows.length === 0 && recs?.length === 0 ? '<span class="lbl sm">No new records in the last six months</span>' : ''}</div>`);
  const pc = (v) => (Number.isFinite(v) && total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');
  const span = NOW_WINDOWS[nowWindow].span;
  const row = (label, v, series, color) => `<div class="nr" style="--tint: var(${color})"><span class="lbl">${info(label)}${label}</span><span class="num">${pc(v)}</span>${num(fmtGw(v))}${sparkTile(series, color, span)}</div>`;
  return `
    <div class="nr head" style="--tint: var(--sunny)"><span class="lbl wide">Recent records <span class="sm">last 6 months</span></span><span></span></div>
    ${rows.join('')}
    <div class="nr head" style="--tint: var(--f-imports)"><span class="lbl">Trade</span><span></span><span></span><span></span></div>
    ${row('Net imports', bat.imp, bat.impSeries, '--f-imports')}
    ${row('Net exports', bat.exp, bat.expSeries, '--f-imports')}`;
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
  // Exports are stored as negative MW; the panel shows their size.
  const w = (col) => windowFigures((k) => Math.abs(data.columns[col][k]), i, slots);
  const [imp, exp] = [w('imports'), w('exports')];
  figs.bat = { imp: imp.value, impSeries: imp.series, exp: exp.value, expSeries: exp.series };
  nowFigures = hoverFigures(figs, win.sub, win.span);
  nowRecords ??= recentRecords({ ...data, length: end }, { watch: NOW_WATCH, peaks: NOW_PEAKS, series: metricSeries, total: generationTotal(data), greenFloor: 1000, limit: NOW_RECORD_ROWS });
  const latest = groupFigures(NOW_GROUPS, data.columns, i, 1);
  liveFavicon(latest.groups, latest.total);
  if (animate && nowShown) tweenFigures(nowShown, figs, drawFigures, { batKeys: ['imp', 'exp'], done: () => { nowShown = figs; } });
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
  records = createRecordsTool({ host: $('records'), country: dk });
  setupControls();
  ({ windows: NOW_WINDOWS, first: nowWindow } = setupNowWindows(dk, (key) => {
    nowWindow = key;
    if (data) renderNow(true);
  }));
  renderNowPlaceholder();
  setupNowHover(() => nowFigures);
  try {
    data = await loadData(dk.dataPath);
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = dataEnd(data, dk);
  const latest = slotTime(end - 1, data.startMs, step());
  $('updated').textContent = `Hourly data from ${fmtDate(data.startMs)} to the hour starting ${fmtDateTime(latest)} Danish time, ${agoText(latest)}. Energinet publishes each hour shortly after it ends.`;
  renderNow();
  renderStory();
  records.setData(data, { end });
}

main();
