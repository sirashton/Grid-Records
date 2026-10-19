// The Western Australia page: the latest data, the shared Records card and the story.
import { formatDuration, slotTime } from '../records.js';
import { fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import wa from '../countries/wa.js';
import { loadData, dataEnd, stepOf } from '../core/dataset.js';
import { createRecordsTool } from '../core/records-tool.js';
import { FUELS, FOSSIL, RENEWABLE, WIND_SOLAR, SOLAR, metricSeries, generationTotal } from './data.js';
import { renderStory as drawStory, storyFigures } from './story.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, setupNowWindows, windowSlots, agoText, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';

setTimeZone(wa.timeZone);

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

// The latest data panel, the same as the GB page's Right now panel. AEMO
// posts each day's facility data the next morning, so each time frame ends at
// the latest half hour of data.
const fuel = (k) => ({ label: FUELS[k].label, cols: [k], color: FUELS[k].color });
const NOW_GROUPS = [
  { label: 'Renewables', color: '--lowcarbon', fuels: ['wind', 'solar_utility', 'solar_rooftop', 'biomass'].map(fuel) },
  { label: 'Fossil fuels', color: '--fossil', fuels: ['coal', 'gas', 'oil'].map(fuel) },
];
let NOW_WINDOWS;
let nowWindow;
const INFO = {
  Renewables: 'Wind, solar farms, rooftop solar, and landfill gas and waste.',
  Wind: 'Wind farms along the coast north of Perth, in the Wheatbelt and at Albany, where the afternoon sea breeze and winter fronts blow.',
  'Solar farms': 'Grid-scale solar farms, most of them in the Mid West and Wheatbelt.',
  'Rooftop solar': 'Panels on homes and businesses, on about two in five Perth houses. AEMO estimates their output; to the grid it shows up as lower demand. Estimated from November 2020 only.',
  'Landfill gas and waste': 'Engines burning gas from landfill and sewage, and the Kwinana waste-to-energy plant.',
  'Fossil fuels': 'Coal, gas and diesel.',
  Coal: 'Muja, Collie and Bluewaters, all near the town of Collie, which mines WA\'s own coal. The state-owned units close by 2029.',
  Gas: 'Gas from the North West Shelf: the Kwinana, Cockburn and Pinjarra plants, and peakers at Pinjar, Kemerton and Neerabup.',
  Diesel: 'Small diesel and distillate peakers, run only when supply is tight.',
  'Battery discharge': 'What grid batteries send into the grid, most of them at Collie and Kwinana. Home batteries are not in the data.',
  'Battery charging': 'What grid batteries take from the grid, mostly in the middle of the day when rooftop solar is high.',
};
const info = infoButton(INFO);

// Records to watch on the SWIS, in GW, for the recent records list.
const NOW_WATCH = [
  { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [2, 1.5, 1.25, 1, 0.75, 0.5] },
  { label: 'Coal', members: ['coal'], mode: 'below', gw: [1, 0.75, 0.5, 0.25] },
  { label: 'Wind and solar', members: WIND_SOLAR, mode: 'above', gw: [1.5, 2, 2.5, 3, 3.5] },
  { label: 'Batteries', members: ['battery'], mode: 'above', gw: [0.25, 0.5, 0.75, 1, 1.5] },
];
const NOW_PEAKS = [
  { label: 'Most wind', members: ['wind'], unit: 'gw', best: 'max' },
  { label: 'Most solar', members: SOLAR, unit: 'gw', best: 'max' },
  { label: 'Most battery output', members: ['battery'], unit: 'gw', best: 'max' },
  { label: 'Least fossil fuel', members: FOSSIL, unit: 'gw', best: 'min' },
  { label: 'Greenest half hour', members: RENEWABLE, unit: 'pct', best: 'max' },
];
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { 'Fossil fuels': '--fossil', Coal: '--f-coal', 'Wind and solar': '--lowcarbon', Batteries: '--f-battery', 'Most wind': '--f-wind', 'Most solar': '--f-solar', 'Most battery output': '--f-battery', 'Least fossil fuel': '--fossil', 'Greenest half hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest half hour': 'Greenest', 'Most battery output': 'Most battery' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: wa.timeZone });
const shortDuration = (slots) => formatDuration(slots, step()).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => (v < 1 ? `${Math.round(v * 1000)} MW` : `${+v.toFixed(2)} GW`);
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : gw(r.value);
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (Perth time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
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
  const span = NOW_WINDOWS[nowWindow].span;
  return `
    <div class="nr head" style="--tint: var(--sunny)"><span class="lbl wide">Recent records <span class="sm">last 6 months of data</span></span><span></span></div>
    ${rows.join('')}
    <div class="nr head" style="--tint: var(--f-battery)"><span class="lbl">Grid batteries <span class="sm">net</span></span><span></span>${num(Number.isFinite(bat.dis) ? fmtGw(bat.dis - bat.chg) : '—')}<span></span></div>
    <div class="nr" style="--tint: var(--f-battery)"><span class="lbl">${info('Battery discharge')}Discharging</span><span class="num">${pc(bat.dis)}</span>${num(fmtGw(bat.dis))}${sparkTile(bat.disSeries, '--f-battery', span)}</div>
    <div class="nr" style="--tint: var(--s1)"><span class="lbl">${info('Battery charging')}Charging</span><span class="num">${pc(bat.chg)}</span>${num(Number.isFinite(bat.chg) ? `−${fmtGw(bat.chg)}` : '—')}${sparkTile(bat.chgSeries?.map((v) => -v), '--s1', span)}</div>`;
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
  const dis = windowFigures((k) => data.columns.battery[k], i, slots);
  const chg = windowFigures((k) => -data.columns.battery_charge[k], i, slots);
  figs.bat = { dis: dis.value, chg: chg.value, disSeries: dis.series, chgSeries: chg.series };
  nowFigures = hoverFigures(figs, win.sub, win.span);
  nowRecords ??= recentRecords({ ...data, length: end }, { watch: NOW_WATCH, peaks: NOW_PEAKS, series: metricSeries, total: generationTotal(data), greenFloor: 500, limit: NOW_RECORD_ROWS });
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

let story = null;
function renderStory() {
  story ??= storyFigures(data, end);
  drawStory(data, end, story);
}

async function main() {
  // Before the Records card rewrites the URL, so a link that arrived with settings is still visible.
  startAnalytics();
  records = createRecordsTool({ host: $('records'), country: wa });
  setupControls();
  ({ windows: NOW_WINDOWS, first: nowWindow } = setupNowWindows(wa, (key) => {
    nowWindow = key;
    if (data) renderNow(true);
  }));
  renderNowPlaceholder();
  setupNowHover(() => nowFigures);
  try {
    data = await loadData(wa.dataPath);
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = dataEnd(data, wa);
  const latest = slotTime(end - 1, data.startMs, step());
  const pending = data.meta.files?.toFetch ? ` ${data.meta.files.toFetch} more of AEMO's files are still being fetched, so the early years may be incomplete.` : '';
  $('updated').textContent = `Data from ${fmtDate(data.startMs)} to ${fmtDateTime(latest)} Perth time, ${agoText(latest)}. AEMO posts each day's data the next morning.${pending}`;
  renderNow();
  renderStory();
  records.setData(data, { end });
}

main();
