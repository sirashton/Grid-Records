// The Belgium page: the latest data, the shared Records card and the story.
import { formatDuration, slotTime } from '../records.js';
import { fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import be from '../countries/be.js';
import { loadData, dataEnd, stepOf } from '../core/dataset.js';
import { createRecordsTool } from '../core/records-tool.js';
import { FUELS, FOSSIL, RENEWABLE, WIND, LOW_CARBON, metricSeries, generationTotal } from './data.js';
import { renderStory as drawStory, storyFigures } from './story.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, setupNowWindows, windowSlots, agoText, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';

setTimeZone(be.timeZone);

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

// The latest data panel, the same as the GB page's Right now panel. Energy-
// Charts runs a few hours behind Elia, so Live ends at the latest quarter hour
// it has.
const fuel = (k) => ({ label: FUELS[k].label, cols: [k], color: FUELS[k].color });
const NOW_GROUPS = [
  { label: 'Nuclear', color: '--f-nuclear', fuels: ['nuclear'].map(fuel) },
  { label: 'Renewables', color: '--lowcarbon', fuels: ['hydro', ...WIND, 'solar', 'biomass'].map(fuel) },
  { label: 'Fossil fuels', color: '--fossil', fuels: ['gas', 'coal', 'oil'].map(fuel) },
  { label: 'Other', color: '--f-other', fuels: ['pumped_storage', 'other'].map(fuel) },
];
let NOW_WINDOWS;
let nowWindow;
const INFO = {
  Nuclear: 'Doel near Antwerp and Tihange near Liège. Of the seven reactors, only Doel 4 and Tihange 3 are meant to run past 2025, now to 2035.',
  Renewables: 'Hydro, onshore and offshore wind, solar and biomass.',
  Hydro: 'Small run-of-river stations on the Meuse and its tributaries.',
  'Onshore wind': 'Wind farms on land, most of them in Flanders and Wallonia\'s high plateaus.',
  'Offshore wind': 'Wind farms in the Belgian North Sea zone, about 2.3 GW since 2020.',
  Solar: 'Solar farms and rooftop panels, as far as they feed the grid.',
  Biomass: 'Wood, biogas and other renewables.',
  'Fossil fuels': 'Gas, with coal until Langerlo closed in 2016, and a little oil.',
  Gas: 'Combined-cycle plants, combined heat and power, and peakers.',
  Coal: 'Langerlo, Belgium\'s last coal plant, closed in March 2016.',
  Oil: 'Oil-fired peaking turbines.',
  Other: 'Pumped storage, and waste and plants Energy-Charts does not assign a fuel.',
  'Pumped storage': 'Water pumped uphill when power is cheap and run back down when it is needed. Coo-Trois-Ponts in the Ardennes is the biggest.',
  'Waste and other': 'Waste incineration and plants Energy-Charts does not assign a fuel.',
  'Net imports': 'Power flowing in from neighbouring countries, less what flows out, when that is positive.',
  'Net exports': 'Power flowing out to neighbouring countries, less what flows in, when that is positive.',
  Pumping: 'Power taken off the grid to pump water uphill.',
};
const info = infoButton(INFO);

// Records to watch on the Belgian grid, in GW, for the recent records list.
const NOW_WATCH = [
  { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [2, 1, 0.5] },
  { label: 'Nuclear', members: ['nuclear'], mode: 'below', gw: [3, 2, 1] },
  { label: 'Solar', members: ['solar'], mode: 'above', gw: [4, 6, 8] },
  { label: 'Wind', members: WIND, mode: 'above', gw: [3, 4, 5] },
  { label: 'Imports', members: ['imports'], mode: 'above', gw: [2, 3, 4] },
];
const NOW_PEAKS = [
  { label: 'Most solar', members: ['solar'], unit: 'gw', best: 'max' },
  { label: 'Most wind', members: WIND, unit: 'gw', best: 'max' },
  { label: 'Least fossil fuel', members: FOSSIL, unit: 'gw', best: 'min' },
  { label: 'Greenest quarter hour', members: RENEWABLE, unit: 'pct', best: 'max' },
];
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { 'Fossil fuels': '--fossil', Nuclear: '--f-nuclear', Wind: '--f-wind', Solar: '--f-solar', Imports: '--f-imports', 'Most wind': '--f-wind', 'Most solar': '--f-solar', 'Least fossil fuel': '--fossil', 'Greenest quarter hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest quarter hour': 'Greenest' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: be.timeZone });
const shortDuration = (slots) => formatDuration(slots, step()).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => `${+v.toFixed(v < 1 ? 2 : 1)} GW`;
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (Belgian time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
  }
  const what = `${r.label === 'Fossil fuels' ? 'Fossil' : r.label} ${r.mode === 'below' ? 'under' : 'over'} ${gw(r.threshold)}`;
  const when = r.live ? `since ${fmtDate(r.startMs)}, still going at the latest data` : `${fmtDate(r.startMs)} to ${fmtDate(r.endMs)}`;
  return `<div class="nr rec${r.live ? ' is-live' : ''}" data-tip="The longest spell on record, ${when}." style="--tint: var(${color})"><span class="lbl">${what}</span><span class="sm">${r.live ? 'ongoing' : shortDay(r.endMs)}</span><span class="num">${shortDuration(r.slots)}</span><span class="mark-tile" style="background:var(${r.live ? '--sunny' : color})"></span></div>`;
}

// The right half: recent records, then trade and pumping, mirroring the left.
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
    <div class="nr head" style="--tint: var(--f-imports)"><span class="lbl">Trade and pumping</span><span></span><span></span><span></span></div>
    ${row('Net exports', bat.exp, bat.expSeries, '--f-imports')}
    ${row('Net imports', bat.imp, bat.impSeries, '--f-imports')}
    ${row('Pumping', bat.chg, bat.chgSeries, '--f-hydro-2')}`;
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
  // Exports and pumping are stored as negative MW; the panel shows their size.
  const w = (col) => windowFigures((k) => Math.abs(data.columns[col][k]), i, slots);
  const [imp, exp, chg] = [w('imports'), w('exports'), w('pumped_storage_charge')];
  figs.bat = { imp: imp.value, impSeries: imp.series, exp: exp.value, expSeries: exp.series, chg: chg.value, chgSeries: chg.series };
  nowFigures = hoverFigures(figs, win.sub, win.span);
  nowRecords ??= recentRecords({ ...data, length: end }, { watch: NOW_WATCH, peaks: NOW_PEAKS, series: metricSeries, total: generationTotal(data), greenFloor: 3000, limit: NOW_RECORD_ROWS });
  const latest = groupFigures(NOW_GROUPS, data.columns, i, 1);
  liveFavicon(latest.groups, latest.total);
  if (animate && nowShown) tweenFigures(nowShown, figs, drawFigures, { batKeys: ['imp', 'exp', 'chg'], done: () => { nowShown = figs; } });
  else { nowShown = figs; drawFigures(figs); }
}

function renderNowPlaceholder() {
  $('now-groups').innerHTML = nowLeftHtml(NOW_GROUPS.map((g) => ({ ...g, now: NaN, fuels: g.fuels.map((f) => ({ ...f, value: NaN, now: NaN })) })), 0, info, '');
  const ring = NOW_GROUPS.map((g) => ({ ...g, color: '--cell-empty', fuels: g.fuels.map((f) => ({ ...f, color: '--cell-empty', now: 1 })) }));
  $('now-donut').innerHTML = donut(ring, ring.reduce((s, g) => s + g.fuels.length, 0)).replace(/>[\d.]+ GW</, '>— GW<');
  $('now-right').innerHTML = nowRightHtml(null, {}, 0);
}

let story = null;
let installed = null; // site/data/be/installed.json, or null if it didn't load
function renderStory() {
  story ??= storyFigures(data, end);
  drawStory(data, end, story, installed);
}

async function main() {
  // Before the Records card rewrites the URL, so a link that arrived with settings is still visible.
  startAnalytics();
  records = createRecordsTool({ host: $('records'), country: be });
  setupControls();
  ({ windows: NOW_WINDOWS, first: nowWindow } = setupNowWindows(be, (key) => {
    nowWindow = key;
    if (data) renderNow(true);
  }));
  renderNowPlaceholder();
  setupNowHover(() => nowFigures);
  const capacity = fetch(`${be.dataPath}/installed.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  try {
    data = await loadData(be.dataPath);
    installed = await capacity;
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = dataEnd(data, be);
  const latest = slotTime(end - 1, data.startMs, step());
  $('updated').textContent = `Data from ${fmtDate(data.startMs)} to ${fmtDateTime(latest)} Belgian time, ${agoText(latest)}. Energy-Charts runs a few hours behind the grid operator, Elia.`;
  renderNow();
  renderStory();
  records.setData(data, { end });
}

main();
