// The Japan page: the latest data, the shared Records card and the story.
import { formatDuration, slotTime } from '../records.js';
import { fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import jp from '../countries/jp.js';
import { loadData, dataEnd, stepOf } from '../core/dataset.js';
import { createRecordsTool } from '../core/records-tool.js';
import { FUELS, FOSSIL, RENEWABLE, metricSeries, generationTotal } from './data.js';
import { renderStory as drawStory, storyFigures } from './story.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, setupNowWindows, windowSlots, agoText, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';

setTimeZone(jp.timeZone);

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

// The latest data panel, the same as the GB page's Right now panel. The
// national series ends at the last half hour all nine areas have published,
// usually one to two hours ago.
const fuel = (k) => ({ label: FUELS[k].label, cols: [k], color: FUELS[k].color });
const NOW_GROUPS = [
  { label: 'Nuclear', color: '--f-nuclear', fuels: ['nuclear'].map(fuel) },
  { label: 'Renewables', color: '--lowcarbon', fuels: ['solar', 'hydro', 'wind', 'geothermal', 'biomass'].map(fuel) },
  { label: 'Fossil fuels', color: '--fossil', fuels: ['gas', 'coal', 'oil', 'thermal_other'].map(fuel) },
  { label: 'Other', color: '--f-other', fuels: ['pumped_storage', 'other'].map(fuel) },
];
let NOW_WINDOWS;
let nowWindow;
const INFO = {
  Nuclear: 'Reactors restarted since 2015 under the safety rules set after Fukushima.',
  Renewables: 'Solar, hydro, wind, geothermal and biomass.',
  Solar: 'Solar farms and rooftop panels as far as they feed the grid; what homes use themselves is not counted.',
  Hydro: 'Run-of-river and reservoir hydro. Pumped storage is listed separately.',
  Wind: 'Onshore and offshore wind farms.',
  Geothermal: 'Geothermal plants.',
  Biomass: 'Dedicated biomass plants. Biomass burnt alongside coal counts as thermal.',
  'Fossil fuels': 'LNG, coal, oil and other thermal plants.',
  LNG: 'Gas plants running on imported liquefied natural gas.',
  Coal: 'Coal plants, most of them burning imported coal.',
  Oil: 'Oil-fired plants.',
  'Other thermal': 'Thermal plants the operators do not list under LNG, coal or oil.',
  Other: 'Pumped storage and sources the operators list as other.',
  'Pumped storage': 'Water pumped uphill when power is plentiful and run back down when it is needed.',
  'Battery discharge': 'Grid batteries the operators count, discharging.',
  'Battery charging': 'Power taken off the grid to charge batteries.',
  Pumping: 'Power taken off the grid to pump water uphill.',
  'Solar held back': 'Solar output the operators ordered off (出力制御) because the area had more than it could use or send to its neighbours.',
};
const info = infoButton(INFO);

// Records to watch on the Japanese grid, in GW, for the recent records list.
const NOW_WATCH = [
  { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [40, 35, 30, 25] },
  { label: 'LNG', members: ['gas'], mode: 'below', gw: [20, 15, 10] },
  { label: 'Solar', members: ['solar'], mode: 'above', gw: [50, 60, 70] },
  { label: 'Battery', members: ['battery'], mode: 'above', gw: [1, 2, 3, 5] },
];
const NOW_PEAKS = [
  { label: 'Most solar', members: ['solar'], unit: 'gw', best: 'max' },
  { label: 'Least fossil fuel', members: FOSSIL, unit: 'gw', best: 'min' },
  { label: 'Most battery output', members: ['battery'], unit: 'gw', best: 'max' },
  { label: 'Greenest half hour', members: RENEWABLE, unit: 'pct', best: 'max' },
];
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { 'Fossil fuels': '--fossil', LNG: '--f-gas', Solar: '--f-solar', Battery: '--f-battery', 'Most solar': '--f-solar', 'Least fossil fuel': '--fossil', 'Most battery output': '--f-battery', 'Greenest half hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest half hour': 'Greenest', 'Most battery output': 'Most battery' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: jp.timeZone });
const shortDuration = (slots) => formatDuration(slots, step()).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => `${+v.toFixed(v < 1 ? 2 : 1)} GW`;
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (Japan time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
  }
  const what = `${r.label === 'Fossil fuels' ? 'Fossil' : r.label} ${r.mode === 'below' ? 'under' : 'over'} ${gw(r.threshold)}`;
  const when = r.live ? `since ${fmtDate(r.startMs)}, still going at the latest data` : `${fmtDate(r.startMs)} to ${fmtDate(r.endMs)}`;
  return `<div class="nr rec${r.live ? ' is-live' : ''}" data-tip="The longest spell on record, ${when}." style="--tint: var(${color})"><span class="lbl">${what}</span><span class="sm">${r.live ? 'ongoing' : shortDay(r.endMs)}</span><span class="num">${shortDuration(r.slots)}</span><span class="mark-tile" style="background:var(${r.live ? '--sunny' : color})"></span></div>`;
}

// The right half: recent records, then storage and curtailment, mirroring the left.
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
    <div class="nr head" style="--tint: var(--f-battery)"><span class="lbl">Storage and curtailment</span><span></span><span></span><span></span></div>
    ${row('Battery discharge', bat.dis, bat.disSeries, '--f-battery')}
    ${row('Battery charging', bat.chg, bat.chgSeries, '--f-battery')}
    ${row('Pumping', bat.pump, bat.pumpSeries, '--f-hydro-2')}
    ${row('Solar held back', bat.curt, bat.curtSeries, '--f-solar')}`;
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
  // Charging and pumping are stored as negative MW; the panel shows their size.
  const w = (col) => windowFigures((k) => Math.abs(data.columns[col][k] || 0), i, slots);
  const [dis, chg, pump, curt] = [w('battery'), w('battery_charge'), w('pumped_storage_charge'), w('solar_curtailed')];
  figs.bat = { dis: dis.value, disSeries: dis.series, chg: chg.value, chgSeries: chg.series, pump: pump.value, pumpSeries: pump.series, curt: curt.value, curtSeries: curt.series };
  nowFigures = hoverFigures(figs, win.sub, win.span);
  nowRecords ??= recentRecords({ ...data, length: end }, { watch: NOW_WATCH, peaks: NOW_PEAKS, series: metricSeries, total: generationTotal(data), greenFloor: 60000, limit: NOW_RECORD_ROWS });
  const latest = groupFigures(NOW_GROUPS, data.columns, i, 1);
  liveFavicon(latest.groups, latest.total);
  if (animate && nowShown) tweenFigures(nowShown, figs, drawFigures, { batKeys: ['dis', 'chg', 'pump', 'curt'], done: () => { nowShown = figs; } });
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
  records = createRecordsTool({ host: $('records'), country: jp });
  setupControls();
  ({ windows: NOW_WINDOWS, first: nowWindow } = setupNowWindows(jp, (key) => {
    nowWindow = key;
    if (data) renderNow(true);
  }));
  renderNowPlaceholder();
  setupNowHover(() => nowFigures);
  try {
    data = await loadData(jp.dataPath);
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = dataEnd(data, jp);
  const latest = slotTime(end - 1, data.startMs, step());
  $('updated').textContent = `Data from ${fmtDate(data.startMs)} to ${fmtDateTime(latest)} Japan time, ${agoText(latest)}. The national figures end at the last half hour all nine areas have published.`;
  renderNow();
  renderStory();
  records.setData(data, { end });
}

main();
