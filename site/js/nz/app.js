// The New Zealand page: the latest data, the records tool and the story.
// The records tool works as on the GB page, on NZ's fuels and thresholds.
import { loadData } from '../data.js';
import { summarise, formatDuration, slotTime, STEP_MINUTES, meets } from '../records.js';
import { lineChart, heatmap, barChart, niceTicks, fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import { envelopes, windowEnvelopes } from '../envelope.js';
import { FUELS, FOSSIL, RENEWABLE, metricSeries, generationTotal, yearlyEnergy, yearlyHoursBelow, dailyEnergy } from './data.js';
import { LAKE, fleetFromDays, simulate, lakeSizes, minimumBuild, dryYearWeather, solarSeason } from './lakes.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';
import { ASSUMPTIONS as A, needs, projection, yearCosts, fuelCost, crf, SOURCES } from './firming.js';

setTimeZone('Pacific/Auckland');

const PRESETS = {
  fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [1, 0.5, 0.25, 0.1, 0.05, 0.02, 0], pct: [20, 10, 5, 2, 1, 0.5, 0] },
  renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [3, 4, 5, 6], pct: [80, 90, 95, 98, 99, 99.5], editable: true },
  gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [1, 0.5, 0.2, 0.1, 0.05, 0], pct: [20, 10, 5, 2, 1, 0] },
  coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [0.5, 0.25, 0.1, 0], pct: [10, 5, 2, 0] },
  hydro: { label: 'Hydro', members: ['hydro'], mode: 'below', gw: [3, 2.5, 2, 1.5], pct: [60, 50, 40, 30] },
  geothermal: { label: 'Geothermal', members: ['geothermal'], mode: 'above', gw: [0.6, 0.8, 1, 1.2], pct: [15, 20, 25, 30] },
  wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [0.25, 0.5, 0.75, 1], pct: [5, 10, 15, 20] },
  solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [0.05, 0.1, 0.2, 0.3], pct: [1, 2, 5, 10] },
  battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.05, 0.1, 0.2, 0.3], pct: [1, 2, 5] },
  custom: { label: 'Custom group…', members: ['wind', 'solar', 'geothermal'], mode: 'above', gw: [1, 1.5, 2], pct: [20, 30, 40], editable: true },
};

const RAMP = ['--r1', '--r2', '--r3', '--r4', '--r5', '--r6', '--r7', '--r8'];
const MAX_THRESHOLDS = RAMP.length;
const SPELL_BANDS = [
  { max: 6, label: 'Under 3 hours', color: '#ffec8f' },
  { max: 24, label: '3 to 12 hours', color: '#ffc94a' },
  { max: 48, label: '12 hours to a day', color: '#b9de6e' },
  { max: 144, label: '1 to 3 days', color: '#64c587' },
  { max: 336, label: '3 days to a week', color: '#25ad9f' },
  { max: 1440, label: '1 week to a month', color: '#2a90c8' },
  { max: 4380, label: '1 to 3 months', color: '#3a68d0' },
  { max: 8760, label: '3 to 6 months', color: '#5b48bd' },
  { max: Infinity, label: 'Over 6 months', color: '#3b2380' },
];
const bandFor = (slots) => SPELL_BANDS.find((b) => slots < b.max);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = (id) => document.getElementById(id);
const nzNum = (v) => v.toLocaleString('en-NZ');

const state = { preset: 'fossil', mode: 'below', unit: 'gw', thresholds: PRESETS.fossil.gw, members: PRESETS.fossil.members, range: 'all', membersOpen: false, scale: 'linear' };
let data;
let lakeInputs = null; // site/nz/lakes.json, or null if it didn't load
let end; // one past the last slot with data

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (PRESETS[p.get('m')]) state.preset = p.get('m');
  const preset = PRESETS[state.preset];
  state.mode = ['below', 'above'].includes(p.get('d')) ? p.get('d') : preset.mode;
  state.unit = ['gw', 'pct'].includes(p.get('u')) ? p.get('u') : 'gw';
  const t = parseThresholds(p.get('t') ?? '');
  state.thresholds = t.length ? t : preset[state.unit];
  const g = (p.get('g') ?? '').split(',').filter((m) => FUELS[m]);
  state.members = preset.editable && g.length ? g : preset.members;
  state.scale = p.get('s') === 'log' ? 'log' : 'linear';
}

function writeHash() {
  const p = new URLSearchParams({ m: state.preset, d: state.mode, u: state.unit, t: state.thresholds.join(',') });
  if (PRESETS[state.preset].editable) p.set('g', state.members.join(','));
  if (state.scale === 'log') p.set('s', 'log');
  history.replaceState(null, '', `#${p}`);
}

function parseThresholds(s) {
  return [...new Set(s.split(/[\s,]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v) && v >= 0))].slice(0, MAX_THRESHOLDS);
}

const fmtValue = (v) => (state.unit === 'gw' ? (v < 1 ? `${Math.round(v * 1000)} MW` : `${+v.toFixed(2)} GW`) : `${+v.toFixed(v < 1 ? 1 : 0)}%`);
const fmtThreshold = (v) => (state.unit === 'gw' ? (v < 1 && v > 0 ? `${Math.round(v * 1000)} MW` : `${v} GW`) : `${v}%`);
const thresholdLabel = (t) => (state.mode === 'below' ? (t === 0 ? 'Zero' : `< ${fmtThreshold(t)}`) : `≥ ${fmtThreshold(t)}`);

function orderedThresholds() {
  const t = [...state.thresholds].sort((a, b) => a - b);
  return state.mode === 'below' ? t.reverse() : t;
}
const thresholdColor = (i, n) => css(RAMP[n <= 1 ? 3 : Math.round((i * (RAMP.length - 1)) / (n - 1))]);

function setupControls() {
  const preset = $('preset');
  for (const [key, p] of Object.entries(PRESETS)) preset.add(new Option(p.label, key));
  preset.addEventListener('change', () => {
    state.preset = preset.value;
    const p = PRESETS[state.preset];
    state.mode = p.mode;
    state.members = [...p.members];
    state.thresholds = p[state.unit];
    state.membersOpen = state.preset === 'custom';
    update();
  });
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (state.mode === b.dataset.mode) return;
    state.mode = b.dataset.mode;
    update();
  }));
  document.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () => {
    if (state.unit === b.dataset.unit) return;
    state.unit = b.dataset.unit;
    state.thresholds = PRESETS[state.preset][state.unit];
    update();
  }));
  $('thresholds').addEventListener('change', (e) => {
    const t = parseThresholds(e.target.value);
    if (t.length) state.thresholds = t;
    update();
  });
  $('members-toggle').addEventListener('click', () => {
    state.membersOpen = !state.membersOpen;
    syncControls();
  });
  const members = $('members');
  for (const [key, f] of Object.entries(FUELS)) {
    const label = document.createElement('label');
    label.className = 'chip';
    label.innerHTML = `<input type="checkbox" value="${key}"> ${f.label}`;
    members.appendChild(label);
  }
  members.addEventListener('change', () => {
    const picked = [...members.querySelectorAll('input:checked')].map((i) => i.value);
    if (picked.length) state.members = picked;
    update();
  });
  document.querySelectorAll('[data-prog-scale]').forEach((b) => b.addEventListener('click', () => {
    progScale = b.dataset.progScale;
    document.querySelectorAll('[data-prog-scale]').forEach((x) => x.setAttribute('aria-checked', x === b));
    if (lastSummaries) renderProgression(lastSummaries);
  }));
  document.querySelectorAll('[data-scale]').forEach((b) => b.addEventListener('click', () => {
    state.scale = b.dataset.scale;
    syncControls();
    writeHash();
    renderTimeline(currentSeries());
  }));
  document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    state.range = b.dataset.range;
    syncControls();
    renderTimeline(currentSeries());
  }));
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
  // Links from the summary open their chapter, and can set the gas price there.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-open]');
    if (!link) return;
    e.preventDefault();
    if (link.dataset.gasPrice) firmOpts.gasPrice = Number(link.dataset.gasPrice);
    const ch = $(link.dataset.open);
    if (ch.open && data) renderStory();
    ch.open = true;
    ch.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function syncControls() {
  $('preset').value = state.preset;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === state.mode));
  document.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-checked', b.dataset.unit === state.unit));
  document.querySelectorAll('#range [data-range]').forEach((b) => b.setAttribute('aria-checked', b.dataset.range === state.range));
  document.querySelectorAll('[data-scale]').forEach((b) => b.setAttribute('aria-checked', b.dataset.scale === state.scale));
  $('thresholds').value = state.thresholds.join(', ');
  const members = $('members');
  const editable = !!PRESETS[state.preset].editable;
  $('members-field').hidden = !editable;
  members.hidden = !(editable && state.membersOpen);
  const toggle = $('members-toggle');
  toggle.setAttribute('aria-expanded', !members.hidden);
  toggle.textContent = members.hidden ? `Edit (${state.members.length})` : 'Done';
  members.querySelectorAll('input').forEach((i) => { i.checked = state.members.includes(i.value); });
}

let seriesCache = null;
function currentSeries() {
  const key = JSON.stringify([state.members, state.unit]);
  if (seriesCache?.key !== key) seriesCache = { key, values: metricSeries(data, state.members, { unit: state.unit }).subarray(0, end) };
  return seriesCache.values;
}

function groupName() {
  if (!PRESETS[state.preset].editable) return PRESETS[state.preset].label.toLowerCase();
  const names = state.members.map((m) => FUELS[m].label.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

function redrawAll() {
  if (!data) return;
  renderStory();
  update();
}

function update() {
  syncControls();
  writeHash();
  const values = currentSeries();
  const summaries = orderedThresholds().map((t) => summarise(values, t, state.mode, { startMs: data.startMs, maxGap: 2 }));
  renderQuestion();
  renderTable(summaries);
  renderProgression(summaries);
  renderByYear(summaries);
  renderTimeline(values);
}

function renderQuestion() {
  const verb = state.mode === 'below' ? 'below' : 'at or above';
  const what = state.unit === 'pct' ? `${groupName()} as a share of generation` : groupName();
  $('question').textContent = `What is the longest the grid has run with ${what} ${verb} each threshold?`;
}

const pct = (a, b) => `${b ? ((a / b) * 100).toFixed(a / b < 0.01 ? 2 : 1) : 0}%`;

function renderTable(summaries) {
  const n = summaries.length;
  const yearSlots = (365 * 24 * 60) / STEP_MINUTES;
  const values = currentSeries();
  const rows = summaries.map((s, i) => {
    const r = s.record;
    const c = s.current;
    const ongoing = r && c && c.start === r.start;
    const longest = r ? `<td class="big">${formatDuration(r.end - r.start)}<span class="when">${fmtDateTime(slotTime(r.start, data.startMs))} ${ongoing ? 'and still going' : `to ${fmtDateTime(slotTime(r.end, data.startMs))}`}</span></td>` : '<td>Never</td>';
    // The data runs a few weeks behind, so a spell running at the end of it is "at the latest data", not live.
    const cur = c ? `<td class="big">${formatDuration(c.end - c.start)}${ongoing ? '<span class="live record-live">Record</span>' : ''}<span class="when">since ${fmtDateTime(slotTime(c.start, data.startMs))}</span></td>` : '<td>—</td>';
    let q = 0;
    for (let k = Math.max(0, values.length - yearSlots); k < values.length; k++) if (!Number.isNaN(values[k]) && meets(values[k], s.threshold, state.mode)) q++;
    return `<tr><td><span class="swatch" style="background:${thresholdColor(i, n)}"></span><b>${thresholdLabel(s.threshold).replace('<', '&lt;')}</b></td>${longest}${cur}
      <td class="big">${pct(q, yearSlots)}</td><td>${nzNum(s.count)}</td></tr>`;
  });
  $('records-table').innerHTML = `<thead><tr><th>Threshold</th><th>Longest spell</th><th>At the latest data</th><th>Share of the latest 365 days</th><th>Spells</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

let progScale = 'log';
let lastSummaries = null;

function linearHourTicks(series) {
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p[1])));
  const days = max > 72;
  const ticks = niceTicks(0, days ? max / 24 : max);
  const step = ticks[1] - ticks[0];
  if (ticks[ticks.length - 1] < (days ? max / 24 : max)) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(10)));
  return days ? ticks.map((d) => d * 24) : ticks;
}

function renderProgression(summaries) {
  lastSummaries = summaries;
  const log = progScale === 'log';
  const n = summaries.length;
  const now = slotTime(end, data.startMs);
  const series = summaries.map((s, i) => ({
    name: thresholdLabel(s.threshold),
    color: thresholdColor(i, n),
    step: true,
    extendTo: now,
    points: s.progression.map((r) => [slotTime(r.end, data.startMs), ((r.end - r.start) * STEP_MINUTES) / 60]),
    records: s.progression,
  }));
  series.forEach((s) => { s.markers = s.points; });
  const linTicks = log ? null : linearHourTicks(series);
  lineChart($('progression'), {
    series,
    yLog: log,
    yMin: log ? 0.5 : 0,
    xMin: data.startMs,
    xMax: now,
    stepLookup: true,
    yFormat: (h) => formatDuration(Math.round((h * 60) / STEP_MINUTES)),
    yTickFormat: log
      ? (h) => (h >= 8760 ? `${+(h / 8760).toFixed(0)}y` : h >= 48 ? `${+(h / 24).toFixed(0)}d` : `${h}h`)
      : (h) => (linTicks[linTicks.length - 1] > 72 ? `${+(h / 24).toFixed(1)}d` : `${h}h`),
    yTicks: log ? [0.5, 1, 3, 6, 12, 24, 72, 168, 720, 2160, 8760, 17520, 43800] : linTicks,
    yMax: log ? undefined : linTicks[linTicks.length - 1],
    tooltip: (t, vals) => `<strong>Records as of ${fmtDate(t)}</strong>${vals.map((v) => {
      const rec = v.point ? v.series.records[v.series.points.indexOf(v.point)] : null;
      return `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${rec ? formatDuration(rec.end - rec.start) : 'none yet'}</b>${rec ? ` <span class="when">set ${fmtDate(slotTime(rec.start, data.startMs))}</span>` : ''}</div>`;
    }).join('')}`,
  });
  $('progression-legend').innerHTML = series.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('');
}

// Columns for the per-year heatmap: each complete calendar year, then the past
// 365 days in place of the unfinished one, as in the story charts.
function yearColumns(lastSlot) {
  const y0 = new Date(data.startMs).getUTCFullYear();
  const y1 = new Date(slotTime(lastSlot, data.startMs)).getUTCFullYear();
  const slotsIn = (y) => (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / (STEP_MINUTES * 60000);
  const cols = [];
  for (let y = y0; y < y1; y++) cols.push({ label: String(y), title: String(y), slots: slotsIn(y), pick: (s) => new Map(s.perYear).get(y) ?? null });
  cols.push({ label: '365d', title: 'Past 365 days', slots: 365 * 48, pick: (s) => s.pastYear });
  return cols;
}

function renderByYear(summaries) {
  const cols = yearColumns(end - 1);
  const values = summaries.map((s) => cols.map((c) => c.pick(s)));
  const full = (sp, ci) => !!sp && sp.end - sp.start >= cols[ci].slots;
  $('by-year-legend').innerHTML = SPELL_BANDS.map((b) => `<span><span class="swatch" style="background:${b.color}"></span>${b.label}</span>`).join('');
  heatmap($('by-year'), {
    rows: summaries.map((s) => thresholdLabel(s.threshold)),
    cols: cols.map((c) => c.label),
    values: values.map((r) => r.map((sp) => (sp ? sp.end - sp.start : null))),
    color: (v) => bandFor(v).color,
    mark: (ri, ci) => full(values[ri][ci], ci),
    format: formatDuration,
    title: (r, c, v) => {
      const ci = cols.findIndex((col) => col.label === c);
      const name = cols[ci].title;
      const sp = values[summaries.findIndex((s) => thresholdLabel(s.threshold) === r)][ci];
      return sp ? `<strong>${name}, ${r}</strong><div>Longest in ${ci === cols.length - 1 ? 'the past 365 days' : name}: <b>${full(sp, ci) ? 'the whole time ✓' : formatDuration(v)}</b></div><div>${fmtDateTime(slotTime(sp.start, data.startMs))} to ${fmtDateTime(slotTime(sp.end, data.startMs))}</div>`
        : `<strong>${name}, ${r}</strong><div>No spells</div>`;
    },
  });
}

/** Daily means for long ranges, raw half hours for short ones. */
function windowPoints(values, days) {
  const start = days === 'all' ? 0 : Math.max(0, end - Number(days) * 48);
  const pts = [];
  if (days === 'all' || Number(days) > 60) {
    for (let d = start - (start % 48); d < end; d += 48) {
      let sum = 0;
      let n = 0;
      for (let i = d; i < Math.min(end, d + 48); i++) if (!Number.isNaN(values[i])) { sum += values[i]; n++; }
      pts.push([slotTime(d, data.startMs), n ? sum / n : NaN]);
    }
  } else {
    for (let i = start; i < end; i++) pts.push([slotTime(i, data.startMs), values[i]]);
  }
  return pts;
}

const ENVELOPE_POINTS = { 7: 48, 30: 144, 365: 14, all: 365 };
const ENVELOPE_LABEL = { 7: '24-hour', 30: '3-day', 365: '14-day', all: '365-day' };
let envelopeCache = null;

function envelopeLayers(raw, env, name) {
  const edge = (arr) => raw.map(([t], i) => [t, arr[i]]);
  const [min, max, lo, hi] = ['min', 'max', 'lo', 'hi'].map((k) => edge(env[k]));
  const color = css('--s2');
  const ink = css('--fossil-ink');
  return {
    series: [
      { name, color, points: raw, width: 1.2, opacity: 0.35 },
      { name: '100% band, high', color: ink, points: max, width: 1, opacity: 0.55 },
      { name: '99% band, high', color: ink, points: hi, width: 2 },
      { name: '99% band, low', color: ink, points: lo, width: 2 },
      { name: '100% band, low', color: ink, points: min, width: 1, opacity: 0.55 },
    ],
    bands: [
      { lower: min, upper: max, color, opacity: 0.12 },
      { lower: lo, upper: hi, color, opacity: 0.2 },
    ],
  };
}

function renderTimeline(values) {
  const thresholds = orderedThresholds();
  const daily = state.range === 'all' || Number(state.range) > 60;
  const raw = windowPoints(values, state.range);
  const key = `${seriesCache.key}|${state.range}`;
  if (envelopeCache?.key !== key) {
    const w = ENVELOPE_POINTS[state.range] ?? 48;
    envelopeCache = { key, ...(daily
      ? windowEnvelopes(values, raw.map(([t]) => Math.round((t - data.startMs) / 1800000) + 24), Math.floor((w * 48) / 2))
      : envelopes(raw.map(([, v]) => v), w)) };
  }
  const span = ENVELOPE_LABEL[state.range] ?? '24-hour';
  $('timeline-note').textContent = `Over each rolling ${span} window, the light band spans every half-hour value and the darker band the middle 99%, leaving out the rarest spikes.`;
  lineChart($('timeline'), {
    ...envelopeLayers(raw, envelopeCache, `${groupName()}${daily ? ' (daily mean)' : ''}`),
    refLines: thresholds.map((t, i) => ({ value: t, color: thresholdColor(i, thresholds.length) })),
    yLog: state.scale === 'log',
    fitData: state.scale !== 'log',
    yMin: state.scale === 'log' ? (state.unit === 'pct' ? 0.5 : 0.01) : undefined,
    yTicks: state.scale === 'log' ? [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] : undefined,
    yFormat: fmtValue,
    yTickFormat: (v) => `${v}${state.unit === 'pct' ? '%' : ''}`,
    tooltip: (t, vals) => `<strong>${daily ? fmtDate(t) : fmtDateTime(t)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? fmtValue(v.value) : '—'}</b></div>`).join('')}`,
  });
}

// One headline figure set large, with the other highlights as a list beside it.
function factsHtml(big, sub, rest) {
  return `<div class="headline"><div class="big">${big}</div><div class="sub">${sub}</div></div>
    <ul class="fact-list">${rest.map(([c, label, v, when]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${label}</b> <span class="v">${v}</span> <span class="sub">${when}</span></span></li>`).join('')}</ul>`;
}

const mw = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} GW` : `${Math.round(v)} MW`);

// The latest data panel, the same as the GB page's Right now panel. The data
// arrives a few weeks late, so there is no live view: each time frame ends at
// the latest half hour of data.
const fuel = (k) => ({ label: FUELS[k].label, cols: [k], color: FUELS[k].color });
const NOW_GROUPS = [
  { label: 'Renewables', color: '--lowcarbon', fuels: ['hydro', 'geothermal', 'wind', 'solar', 'bioenergy'].map(fuel) },
  { label: 'Fossil fuels', color: '--fossil', fuels: ['gas', 'coal', 'diesel'].map(fuel) },
];
const NOW_WINDOWS = {
  day: { slots: 48, span: 'Latest 24 hours', sub: '24h average' },
  week: { slots: 48 * 7, span: 'Latest 7 days', sub: '7d average' },
  month: { slots: 48 * 30, span: 'Latest 30 days', sub: '30d average' },
  year: { slots: 48 * 365, span: 'Latest 365 days', sub: '365d average' },
};
let nowWindow = 'day';
const INFO = {
  Renewables: 'Hydro, geothermal, wind, solar, and wood and biogas.',
  Hydro: 'Hydro stations, mostly on the Waikato, Waitaki and Clutha rivers and at Manapōuri.',
  Geothermal: 'Steam from the volcanic zone around Taupō and Kawerau, running steadily around the clock.',
  Wind: 'Wind farms, most of them in the lower North Island and Southland.',
  Solar: 'Grid-scale solar farms. Rooftop panels are not in this data.',
  'Wood and biogas': 'Plants burning wood waste and landfill gas.',
  'Fossil fuels': 'Gas, coal and diesel.',
  Gas: 'Gas-fired stations, including the Huntly gas units and peakers.',
  Coal: 'The Rankine units at Huntly, which can burn coal or gas.',
  Diesel: 'Small diesel peakers, used at times of tight supply.',
  'Battery discharge': 'What grid batteries send into the grid. The data does not show what they take when charging.',
};
const info = infoButton(INFO);

// Records to watch on the NZ grid, in GW, for the recent records list.
const NOW_WATCH = [
  { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [1, 0.5, 0.25, 0.1, 0.05, 0.02] },
  { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [4, 5, 6, 7] },
  { label: 'Wind', members: ['wind'], mode: 'above', gw: [0.5, 0.75, 1, 1.25, 1.5] },
  { label: 'Solar', members: ['solar'], mode: 'above', gw: [0.1, 0.2, 0.3, 0.4, 0.5] },
  { label: 'Geothermal', members: ['geothermal'], mode: 'above', gw: [1, 1.1, 1.2, 1.3] },
];
const NOW_PEAKS = [
  { label: 'Most wind', members: ['wind'], unit: 'gw', best: 'max' },
  { label: 'Most solar', members: ['solar'], unit: 'gw', best: 'max' },
  { label: 'Least fossil fuel', members: FOSSIL, unit: 'gw', best: 'min' },
  { label: 'Greenest half hour', members: RENEWABLE, unit: 'pct', best: 'max' },
];
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { 'Fossil fuels': '--fossil', Renewables: '--lowcarbon', Wind: '--f-wind', Solar: '--f-solar', Geothermal: '--f-geo', 'Most wind': '--f-wind', 'Most solar': '--f-solar', 'Least fossil fuel': '--fossil', 'Greenest half hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest half hour': 'Greenest' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' });
const shortDuration = (slots) => formatDuration(slots).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => `${+v.toFixed(v < 1 ? 2 : 1)} GW`;
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (NZ time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
  }
  const what = `${r.label === 'Fossil fuels' ? 'Fossil' : r.label} ${r.mode === 'below' ? 'under' : 'over'} ${gw(r.threshold)}`;
  const when = r.live ? `since ${fmtDate(r.startMs)}, still going at the latest data` : `${fmtDate(r.startMs)} to ${fmtDate(r.endMs)}`;
  return `<div class="nr rec${r.live ? ' is-live' : ''}" data-tip="The longest spell on record, ${when}." style="--tint: var(${color})"><span class="lbl">${what}</span><span class="sm">${r.live ? 'ongoing' : shortDay(r.endMs)}</span><span class="num">${shortDuration(r.slots)}</span><span class="mark-tile" style="background:var(${r.live ? '--sunny' : color})"></span></div>`;
}

// The right half: recent records, then batteries, mirroring the left.
function nowRightHtml(recs, bat, total) {
  const rows = (recs ?? []).slice(0, NOW_RECORD_ROWS).map(recordRow);
  if (!recs) while (rows.length < 5) rows.push('<div class="nr rec"><span></span></div>');
  while (rows.length < NOW_RECORD_ROWS) rows.push(`<div class="nr rec">${rows.length === 0 && recs?.length === 0 ? '<span class="lbl sm">No new records in the last six months</span>' : ''}</div>`);
  const pc = (v) => (Number.isFinite(v) && total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');
  return `
    <div class="nr head" style="--tint: var(--sunny)"><span class="lbl wide">Recent records <span class="sm">last 6 months of data</span></span><span></span></div>
    ${rows.join('')}
    <div class="nr head" style="--tint: var(--f-battery)"><span class="lbl">Batteries</span><span></span>${num(fmtGw(bat.dis))}<span></span></div>
    <div class="nr" style="--tint: var(--f-battery)"><span class="lbl">${info('Battery discharge')}Discharging</span><span class="num">${pc(bat.dis)}</span>${num(fmtGw(bat.dis))}${sparkTile(bat.disSeries, '--f-battery', NOW_WINDOWS[nowWindow].span)}</div>`;
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
  const figs = groupFigures(NOW_GROUPS, data.columns, i, win.slots);
  const dis = windowFigures((k) => data.columns.battery[k], i, win.slots);
  figs.bat = { dis: dis.value, disSeries: dis.series };
  nowFigures = hoverFigures(figs, win.sub, win.span);
  nowRecords ??= recentRecords({ ...data, length: end }, { watch: NOW_WATCH, peaks: NOW_PEAKS, series: metricSeries, total: generationTotal(data), greenFloor: 2000, limit: NOW_RECORD_ROWS });
  const latest = groupFigures(NOW_GROUPS, data.columns, i, 1);
  liveFavicon(latest.groups, latest.total);
  if (animate && nowShown) tweenFigures(nowShown, figs, drawFigures, { batKeys: ['dis'], done: () => { nowShown = figs; } });
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
  if (!story) {
    story = {
      energy: yearlyEnergy(data),
      hours: yearlyHoursBelow(data, FOSSIL, [500, 250, 100]),
      spells: [0.1, 0.25, 0.5].map((gw) => summarise(metricSeries(data, FOSSIL).subarray(0, end), gw, 'below', { startMs: data.startMs, maxGap: 2 }).record),
    };
    story.needs = needs(story.energy, metricSeries(data, FOSSIL), end);
    if (lakeInputs) {
      const fleet = fleetFromDays(dailyEnergy(data, end));
      const sizes = lakeSizes(lakeInputs, fleet);
      story.lakes = { fleet, sizes, half: lakeSizes(lakeInputs, fleet, { cap: lakeInputs.activeGwh / 2 }), contingent: lakeSizes(lakeInputs, fleet, { cap: lakeInputs.activeGwh + lakeInputs.contingentGwh }) };
      story.needs.sizes = Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, v.gw]));
    }
  }
  const at = (i) => fmtDate(slotTime(i, data.startMs));
  const spellText = (r) => (r ? formatDuration(r.end - r.start) : 'Never');
  const from = (r) => (r ? `from ${at(r.start)}` : 'not yet');
  const [r100, r250, r500] = story.spells;
  const en = story.energy;
  const past = en.at(-1);
  const best = en.filter((r) => r.year !== 'past365').reduce((a, b) => (b.renewablePct > a.renewablePct ? b : a));
  const worst = en.filter((r) => r.year !== 'past365' && r.year >= 2010).reduce((a, b) => (b.fossil > a.fossil ? b : a));
  $('facts').innerHTML = factsHtml(spellText(r100), `with gas, coal and diesel together under 100 MW, ${from(r100)}. The longest New Zealand has run on almost no fossil fuel.`, [
    ['--fossil', 'Under 250 MW of fossil fuel', spellText(r250), from(r250)],
    ['--fossil', 'Under 500 MW of fossil fuel', spellText(r500), from(r500)],
    ['--lowcarbon', 'Renewable share', `${past.renewablePct.toFixed(1)}%`, 'over the latest 365 days of data'],
    ['--lowcarbon', 'Best calendar year', `${best.renewablePct.toFixed(1)}%`, `renewable, in ${best.year}`],
    ['--f-coal', 'Most fossil since 2010', `${worst.fossil.toFixed(1)} TWh`, `in ${worst.year}`],
  ]);

  const yearLabel = (y) => (y === 'past365' ? '365d' : String(y));
  const yearTitle = (y) => (y === 'past365' ? 'Latest 365 days' : String(y));
  const pc = (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`;
  // Stack order, fossil at the bottom.
  const MIX = ['coal', 'gas', 'diesel', 'other', 'bioenergy', 'geothermal', 'hydro', 'wind', 'solar'];
  const stacks = MIX.map((k) => ({ name: FUELS[k].label, color: css(FUELS[k].color), values: en.map((r) => (r.twh[k] / r.total) * 100) }));
  barChart($('story-mix'), {
    cats: en.map((r) => yearLabel(r.year)),
    stacks,
    yMax: 100,
    yFormat: pc,
    yTickFormat: (v) => `${v}%`,
    highlight: (ci) => en[ci].year === 'past365',
    tooltip: (ci) => `<strong>${yearTitle(en[ci].year)}</strong><div>Renewable: <b>${pc(en[ci].renewablePct)}</b></div>${[...stacks].reverse().filter((s) => s.values[ci] >= 0.05).map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${pc(s.values[ci])}</b></div>`).join('')}`,
  });
  $('story-mix-legend').innerHTML = [...stacks].reverse().map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('');
  $('mix-take').textContent = `Renewables made ${pc(en[0].renewablePct)} of grid power in ${en[0].year} and ${pc(past.renewablePct)} over the latest year of data.`;

  // Dry years: fossil TWh as bars, hydro TWh in the tooltip and as a marker line.
  const years = en.filter((r) => r.year !== 'past365');
  const twh = (v) => `${v.toFixed(1)} TWh`;
  const fossilStacks = ['coal', 'gas', 'diesel'].map((k) => ({ name: FUELS[k].label, color: css(FUELS[k].color), values: years.map((r) => r.twh[k]) }));
  const meanHydro = years.reduce((s, r) => s + r.twh.hydro, 0) / years.length;
  barChart($('story-dry'), {
    cats: years.map((r) => String(r.year)),
    stacks: fossilStacks,
    yFormat: twh,
    yTickFormat: (v) => `${v}`,
    highlight: (ci) => years[ci].twh.hydro < meanHydro - 1,
    badge: (ci) => (years[ci].twh.hydro < meanHydro - 1 ? 'dry' : null),
    tooltip: (ci) => `<strong>${years[ci].year}</strong><div>Hydro: <b>${twh(years[ci].twh.hydro)}</b> (${years[ci].twh.hydro >= meanHydro ? '+' : ''}${(years[ci].twh.hydro - meanHydro).toFixed(1)} on average)</div>${[...fossilStacks].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${twh(s.values[ci])}</b></div>`).join('')}<div>Renewable: <b>${pc(years[ci].renewablePct)}</b></div>`,
  });
  $('story-dry-legend').innerHTML = `${[...fossilStacks].reverse().map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('')}<span>Outlined: hydro at least 1 TWh below its ${years[0].year} to ${years.at(-1).year} average of ${twh(meanHydro)}</span>`;

  const hrs = story.hours;
  const hourStacks = [
    { name: 'Under 100 MW', color: css('--h7'), values: hrs.map((r) => r.hours[2]) },
    { name: '100 to 250 MW', color: css('--lowcarbon'), values: hrs.map((r) => r.hours[1] - r.hours[2]) },
    { name: '250 to 500 MW', color: css('--h2'), values: hrs.map((r) => r.hours[0] - r.hours[1]) },
  ];
  const fmtH = (v) => `${nzNum(Math.round(v))} h`;
  barChart($('story-hours'), {
    cats: hrs.map((r) => yearLabel(r.year)),
    stacks: hourStacks,
    yFormat: fmtH,
    yTickFormat: (v) => nzNum(v),
    highlight: (ci) => hrs[ci].year === 'past365',
    tooltip: (ci) => `<strong>${yearTitle(hrs[ci].year)}</strong><div>Under 500 MW: <b>${fmtH(hrs[ci].hours[0])}</b> (${((hrs[ci].hours[0] / 8760) * 100).toFixed(0)}% of the year)</div><div>Under 250 MW: <b>${fmtH(hrs[ci].hours[1])}</b></div><div>Under 100 MW: <b>${fmtH(hrs[ci].hours[2])}</b></div>`,
  });
  $('story-hours-legend').innerHTML = hourStacks.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('');

  renderBatteryStory();
  renderFirming();
  renderLakes();
  renderAnswer();
}

// The page's answer first, then the three reasons for it, each linking to the
// chapter with the evidence. Always worked out with no carbon price, so the
// case doesn't rest on one.
function renderAnswer() {
  const n = story.needs;
  const past = story.energy.at(-1);
  const plain = { carbon: 0, surplusValue: 0 };
  const cheapest = (r) => Math.min(...Object.values(r.renewables).map((x) => x.cost));
  const { rows } = projection(n, plain);
  // NZ$m a year over the grid's TWh a year is $/MWh; a tenth of that is c/kWh.
  const centsMore = (r) => (cheapest(r) - r.keep) / past.total / 10;
  const [now, later] = [rows[0], rows.at(-1)];
  const imported = projection(n, { ...plain, gasPrice: A.importedGasPerGj });
  const c = (v) => `${v.toFixed(v < 0.1 ? 2 : 1)}c`;
  const premium = centsMore(now) > 0
    ? `covering even the driest year on record without fossil fuel would add about ${c(centsMore(now))} a unit to power prices today${centsMore(later) > 0 ? `, and ${c(centsMore(later))} by ${later.year}` : `, and save money by ${rows.find((r) => centsMore(r) <= 0).year}`}`
    : 'covering even the driest year on record without fossil fuel already costs less than keeping it';
  $('answer-lead').textContent = `New Zealand's grid is ${past.renewablePct.toFixed(0)}% renewable, and finishing the job doesn't need a carbon tax. New wind and solar already cost less than the gas they would replace, and ${premium}. If gas has to be imported, going all the way is the cheaper choice.`;

  const r = now.renewables;
  const gasNow = now.keepPerMwh.gas;
  const gasImported = fuelCost({ ...A.gas, pricePerGj: A.importedGasPerGj }, 0);
  const cross = Object.entries(imported.crossover).filter(([, y]) => y).sort((x, y) => x[1] - y[1]);
  const crossText = cross.map(([k, y]) => `${A.tech[k].label.toLowerCase()}${k === 'geothermal' ? '' : ' with batteries'} ${y === now.year ? 'is already cheaper' : `from ${y}`}`);
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
  const record = story.spells[0];
  const link = (ch, text, gas) => `<a href="#${ch}" data-open="${ch}"${gas ? ` data-gas-price="${gas}"` : ''}>${text}</a>`;
  $('answer-points').innerHTML = [
    `<b>Home-grown power is the cheapest new power.</b> New wind costs about ${nzd(r.wind.lcoe)} and new solar about ${nzd(r.solar.lcoe)} per MWh to build and run. Gas costs ${nzd(gasNow)} per MWh in fuel alone at today's domestic price, before paying for the power station. ${link('chapter-5', 'The costs')}`,
    `<b>The only hard part is a dry year.</b> The grid has run ${record ? formatDuration(record.end - record.start) : 'for days'} on almost no fossil fuel. But a year as dry as ${n.driest.year} would still need ${n.driest.fossil.toFixed(1)} TWh of coal and gas, and that is what the last few percent has to replace. ${link('chapter-2', 'Dry years')}`,
    ...(story.lakes ? [lakesPoint(link)] : []),
    `<b>Imported gas would be the expensive choice.</b> New Zealand's own gas is running down, and the Government plans to import LNG. At about NZ$${A.importedGasPerGj}/GJ, gas costs ${nzd(gasImported)} per MWh in fuel and keeping fossil backup costs ${nzd(imported.rows[0].keep)}m a year, against ${nzd(now.keep)}m today. ${cross.length ? `At that price, ${list(crossText)}.` : ''} Wind, water, sun and steam are priced at home; imported gas is priced on the world market. ${link('chapter-5', 'With imported gas', A.importedGasPerGj)}`,
  ].map((x) => `<li>${x}</li>`).join('');
}

const link6 = (text) => `<a href="#chapter-6" data-open="chapter-6">${text}</a>`;
const pctLess = (v) => `${Math.round((1 - v) * 100)}%`;

// One line of the In short card: what each source is really worth in a dry year.
function lakesPoint(link) {
  const { sizes } = story.lakes;
  return `<b>Solar can do it, but wind and geothermal do more per unit.</b> Replaying every day from 1980 to 2024 through the hydro lakes, the grid needs about ${sizes.wind.gw.toFixed(1)} GW of new wind, ${sizes.solar.gw.toFixed(1)} GW of solar or ${sizes.geothermal.gw.toFixed(1)} GW of geothermal to never run them dry. Each MWh of solar counts for about ${pctLess(sizes.solar.value / sizes.wind.value)} less than a MWh of wind, because the sun is weakest in winter. ${link('chapter-6', 'Solar on the lakes')}`;
}

const firmOpts = { carbon: 0, surplusValue: 0, gasPrice: A.gas.pricePerGj };
let firmWired = false;
const nzd = (v) => `$${nzNum(Math.round(v))}`;

function renderFirming() {
  if (!firmWired) {
    firmWired = true;
    document.querySelectorAll('[data-carbon]').forEach((b) => b.addEventListener('click', () => { firmOpts.carbon = Number(b.dataset.carbon); renderFirming(); }));
    document.querySelectorAll('[data-surplus]').forEach((b) => b.addEventListener('click', () => { firmOpts.surplusValue = Number(b.dataset.surplus); renderFirming(); }));
    document.querySelectorAll('[data-gas]').forEach((b) => b.addEventListener('click', () => { firmOpts.gasPrice = Number(b.dataset.gas); renderFirming(); }));
  }
  document.querySelectorAll('[data-carbon]').forEach((b) => b.setAttribute('aria-checked', Number(b.dataset.carbon) === firmOpts.carbon));
  document.querySelectorAll('[data-surplus]').forEach((b) => b.setAttribute('aria-checked', Number(b.dataset.surplus) === firmOpts.surplusValue));
  document.querySelectorAll('[data-gas]').forEach((b) => b.setAttribute('aria-checked', Number(b.dataset.gas) === firmOpts.gasPrice));
  const n = story.needs;
  const twh = (v) => `${v.toFixed(1)} TWh`;
  $('firm-facts').innerHTML = factsHtml(twh(n.driest.fossil), `of fossil generation today's grid would need in a year as dry as ${n.driest.year}, the driest of ${n.years[0]} to ${n.years[1]}.`, [
    ['--fossil', 'In a year of average rainfall', twh(n.normalFossil), "today's fleet, average water"],
    ['--f-hydro', `Hydro short in ${n.driest.year}`, twh(n.driest.deficit), `against the ${twh(n.meanHydro)} average`],
    ['--fossil', 'Fossil capacity at the peaks', `${n.peakGw.toFixed(2)} GW`, `99th percentile, latest ${A.peakYears} years`],
  ]);
  const { rows, crossover } = projection(n, firmOpts);
  const at = (y) => Date.UTC(y, 6, 1);
  const series = [
    { key: 'keep', name: 'Keep coal and gas on standby', color: css('--fossil'), points: rows.map((r) => [at(r.year), r.keep]), width: 3 },
    ...Object.entries(A.tech).map(([k, g]) => ({ key: k, name: `100% renewable: ${g.label.toLowerCase()} and batteries`, color: css(FUELS[k].color), points: rows.map((r) => [at(r.year), r.renewables[k].cost]) })),
  ];
  lineChart($('firm-chart'), {
    series,
    yMin: 0,
    yFormat: (v) => `${nzd(v)}m`,
    yTickFormat: (v) => `${nzd(v)}m`,
    tooltip: (t, vals) => `<strong>${new Date(t).getUTCFullYear()}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${nzd(v.value)}m</b></div>`).join('')}`,
  });
  $('firm-legend').innerHTML = series.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('');
  const first = rows[0];
  const named = Object.entries(crossover).filter(([, y]) => y).sort((x, y) => x[1] - y[1]);
  const when = ([k, y], i) => {
    const name = i ? A.tech[k].label.toLowerCase() : A.tech[k].label;
    return y === rows[0].year ? `${name} is already cheaper` : `${name} gets cheaper in ${y}`;
  };
  const never = Object.keys(A.tech).filter((k) => !crossover[k]).map((k) => A.tech[k].label.toLowerCase());
  const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
  const carbonText = firmOpts.carbon ? `NZ$${firmOpts.carbon} a tonne of carbon` : 'no carbon price';
  const gasText = firmOpts.gasPrice === A.gas.pricePerGj ? 'domestic gas' : `imported gas at NZ$${firmOpts.gasPrice}/GJ`;
  $('firm-answer').innerHTML = `<b>With ${carbonText}, ${gasText}${firmOpts.surplusValue ? ` and NZ$${firmOpts.surplusValue}/MWh for spare energy` : ' and spare energy worth nothing'}:</b> keeping fossil backup costs about ${nzd(first.keep)}m a year. `
    + (named.length ? `${list(named.map(when))}.` : 'No single renewable source gets cheaper by 2045.')
    + (named.length && never.length ? ` Not ${list(never)}, before 2045.` : '');
  $('firm-take').textContent = named.length
    ? `With ${carbonText} and ${gasText}, ${A.tech[named[0][0]].label.toLowerCase()} plus batteries ${named[0][1] === rows[0].year ? 'already beats' : `beats`} keeping fossil backup${named[0][1] === rows[0].year ? '' : ` from ${named[0][1]}`}.`
    : `With ${carbonText} and ${gasText}, keeping fossil backup stays cheaper for now.`;
  const g = first.renewables.geothermal;
  $('firm-notes').innerHTML = [
    `<b>The value of spare energy.</b> Renewables sized for the driest years make about ${twh(first.renewables.wind.spareTwh)} (wind) to ${twh(first.renewables.solar.spareTwh)} (solar) more than an average year needs. If that sells, to new electric demand, to flexible industry like the Tiwai smelter, or by keeping lakes fuller, the renewable lines fall a long way.`,
    `<b>The gas price.</b> Imported gas at NZ$${A.importedGasPerGj}/GJ instead of NZ$${A.gas.pricePerGj} adds about ${nzd(yearCosts(n, first.year, { ...firmOpts, gasPrice: A.importedGasPerGj }).keep - yearCosts(n, first.year, { ...firmOpts, gasPrice: A.gas.pricePerGj }).keep)}m a year to keeping fossil backup. New Zealand's gas fields are running down, and an LNG import terminal would tie the price in dry years to the world market.`,
    `<b>The carbon price.</b> Each NZ$50 a tonne adds about ${nzd(yearCosts(n, first.year, { ...firmOpts, carbon: firmOpts.carbon + 50 }).keep - first.keep)}m a year to keeping fossil backup.`,
    `<b>Geothermal is limited.</b> It is the cheapest here, at about ${nzd(g.lcoe)} per MWh, but it needs ${g.gw.toFixed(2)} GW of new plant, which is near the limit of what the known fields can add.`,
    story.lakes
      ? `<b>Wind and sun in a dry winter.</b> Each source is sized by replaying every day from 1980 to 2024 through the hydro lakes. Solar needs ${story.lakes.sizes.solar.gw.toFixed(1)} GW, a little more than its yearly average suggests, because it is weakest in winter. ${link6('Solar on the lakes')}`
      : `<b>Wind and sun in a dry winter.</b> Each source is sized on its yearly average. Dry years tend to be winters, when solar makes a third of its summer output. Hydro lakes can hold some summer energy back, but solar in particular would need more than shown.`,
    `<b>Batteries.</b> Two-hour batteries in place of ${n.peakGw.toFixed(2)} GW of fossil peak capacity, less the ${Math.round(A.committedBatteryGw * 1000)} MW Huntly battery already being built, cost about ${nzd(first.battery)}m a year, a large share of each renewable line. More demand response, or hydro run harder at peaks, would cut that.`,
  ].map((x) => `<li>${x}</li>`).join('');
  $('firm-method').innerHTML = `<p>Hydro output stands in for rainfall. The hydro fleet has barely changed since the late 1990s, so a year with less hydro had less water. Today's need for fossil fuel in an average year is the latest 365 days' fossil output (${twh(story.energy.at(-1).fossil)}) plus how much wetter than average those days were. Each year from ${n.years[0]} to ${n.years[1]} then adds its own shortfall of water.</p>
    <p>${story.lakes ? `Each renewable line is sized by the lake model in chapter 6: the least of that one source that gets through every day from 1980 to 2024 without the lakes running dry (${Object.entries(story.lakes.sizes).map(([k, v]) => `${A.tech[k].label.toLowerCase()} ${v.gw.toFixed(2)} GW`).join(', ')}).` : 'Each renewable line is sized to make the driest year\'s fossil need on its yearly average.'} The energy it makes beyond what an average year needs is the spare energy valued above.</p>
    <p>Keeping fossil backup costs NZ$${A.thermalFixedPerKw}/kW a year to keep ${n.peakGw.toFixed(2)} GW of existing plant open (an assumption; the Huntly reserve's price is not public), plus fuel and carbon for each year's need. Gas covers the fossil an average year needs (${nzd(first.keepPerMwh.gas)}/MWh at these prices; domestic gas at NZ$${A.gas.pricePerGj}/GJ, imported LNG at NZ$${A.importedGasPerGj}/GJ, which is an assumption), and coal covers the extra in a dry year (${nzd(first.keepPerMwh.coal)}/MWh).</p>
    <p>Renewables are annualised at ${A.wacc * 100}% real. ${Object.values(A.tech).map((t) => `${t.label}: NZ$${nzNum(t.capexPerKw)}/kW, ${Math.round(t.loadFactor * 100)}% load factor, ${t.life} years, falling ${(t.decline * 100).toFixed(t.decline < 0.01 ? 2 : 1)}% a year`).join('; ')}. Batteries: NZ$${nzNum(A.battery.capexPerKw)}/kW for two hours, ${A.battery.life} years, falling ${A.battery.decline * 100}% a year. The rates of decline are assumptions.</p>
    <ul>${SOURCES.map(([what, who, url]) => `<li>${what}: <a href="${url}">${who}</a></li>`).join('')}</ul>`;
}

// Chapter 6: the lake model. What each source is worth when the lakes run
// low, and the lakes' level through 45 years of weather for each build.
let lakesBuild = 'none';
function renderLakes() {
  const L = story.lakes;
  if (!L) {
    $('lakes-lead').textContent = 'The lake model could not be loaded. Please try again shortly.';
    return;
  }
  const { sizes, half, contingent } = L;
  const inputs = lakeInputs;
  const gw = (v) => `${v.toFixed(1)} GW`;
  const weather = dryYearWeather(inputs);
  const season = solarSeason(inputs);
  const years = `${inputs.first.slice(0, 4)} to ${new Date(Date.parse(inputs.first) + (inputs.days - 1) * 864e5).getUTCFullYear()}`;
  const solarVsWind = sizes.solar.value / sizes.wind.value;
  $('lakes-take').textContent = `Each MWh of solar is worth about ${pctLess(solarVsWind)} less than wind's in a dry year. The lakes are what make it work at all.`;
  $('lakes-lead').innerHTML = `<b>Solar can carry New Zealand through its dry years, but it isn't the best at it.</b> With today's demand and no coal or gas, the grid gets through every year from ${years} with ${gw(sizes.wind.gw)} of new wind, ${gw(sizes.solar.gw)} of new solar, or ${gw(sizes.geothermal.gw)} of new geothermal. Per MWh made, solar counts for about ${pctLess(solarVsWind)} less than wind and ${pctLess(sizes.solar.value)} less than geothermal.`;
  const pct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`;
  $('lakes-facts').innerHTML = factsHtml(gw(sizes.solar.gw), `of new solar, or ${gw(sizes.wind.gw)} of new wind, keeps the lakes from running dry in every year from ${years} with no fossil fuel.`, [
    ['--f-geo', 'Geothermal', `${gw(sizes.geothermal.gw)}`, `${sizes.geothermal.twh.toFixed(1)} TWh a year, steady day and night`],
    ['--f-wind', 'Wind', `${gw(sizes.wind.gw)}`, `${sizes.wind.twh.toFixed(1)} TWh a year, ${Math.round(sizes.wind.value * 100)}% as useful as geothermal`],
    ['--f-solar', 'Solar', `${gw(sizes.solar.gw)}`, `${sizes.solar.twh.toFixed(1)} TWh a year, ${Math.round(sizes.solar.value * 100)}% as useful as geothermal`],
    ['--f-wind', 'Wind in the driest years', pct(weather.windPct), `${weather.years.join(', ')}, against the average`],
    ['--f-solar', 'Sunshine in the driest years', pct(weather.solarPct), 'the same years'],
  ]);

  const mixWind = minimumBuild(inputs, { ...L.fleet, solarGw: L.fleet.solarGw + sizes.solar.gw / 2 }, 'wind');
  const builds = {
    none: { name: "Today's grid, no fossil fuel", color: '--fossil', add: {} },
    wind: { name: `With ${gw(sizes.wind.gw)} of new wind`, label: 'New wind', color: '--f-wind', add: { wind: sizes.wind.gw } },
    solar: { name: `With ${gw(sizes.solar.gw)} of new solar`, label: 'New solar', color: '--f-solar', add: { solar: sizes.solar.gw } },
    ...(mixWind === null ? {} : { mix: { name: `With ${gw(sizes.solar.gw / 2)} of solar and ${gw(mixWind)} of wind`, label: 'Solar and wind', color: '--lowcarbon', add: { solar: sizes.solar.gw / 2, wind: mixWind } } }),
    geothermal: { name: `With ${gw(sizes.geothermal.gw)} of new geothermal`, label: 'New geothermal', color: '--f-geo', add: { geothermal: sizes.geothermal.gw } },
  };
  // NZ$m a year: GW × NZ$/kW a year.
  const perKw = (k, y) => { const g = A.tech[k]; return g.capexPerKw * (1 - g.decline) ** (y - 2025) * crf(A.wacc, g.life) + g.omPerKw; };
  const cost = (add, y) => Object.entries(add).reduce((s, [k, v]) => s + v * perKw(k, y), 0);
  const costYears = [2025, 2035, 2045];
  const solarYear = Array.from({ length: 21 }, (_, i) => 2025 + i).find((y) => cost(builds.solar.add, y) <= cost(builds.wind.add, y)) ?? null;
  const costRows = Object.values(builds).filter((b) => b.label);
  const cheapest = costYears.map((y) => Math.min(...costRows.filter((b) => !b.add.geothermal).map((b) => cost(b.add, y))));
  $('lakes-costs').innerHTML = `<thead><tr><th>Build</th>${costYears.map((y) => `<th>${y}</th>`).join('')}</tr></thead><tbody>${costRows.map((b) => `<tr><td><span class="swatch" style="background:var(${b.color})"></span> ${b.label}<span class="when">${Object.entries(b.add).map(([k, v]) => `${gw(v)} of ${k}`).join(' and ')}</span></td>${costYears.map((y, i) => { const c = cost(b.add, y); return `<td${!b.add.geothermal && c <= cheapest[i] + 1e-6 ? ' class="big"' : ''}>${nzd(c)}m</td>`; }).join('')}</tr>`).join('')}</tbody>`;
  const area = sizes.solar.gw * 10; // km², at Rosedale's 1 MW a hectare
  // Evaporation saved under floating panels: about half, over Pūkaki water
  // worth 0.73 GWh per million m³ through the stations below it.
  const EVAP_M = 0.7;
  const evapMm3 = area * EVAP_M * 0.5;
  const evapGwh = evapMm3 * 0.73;
  $('lakes-points').innerHTML = [
    `<b>Dry years are calm, not sunny.</b> In the five driest years since ${inputs.first.slice(0, 4)}, ${weather.years.slice(0, -1).join(', ')} and ${weather.years.at(-1)}, the lakes got ${Math.abs(weather.inflowPct).toFixed(0)}% less water, the wind blew ${Math.abs(weather.windPct).toFixed(0)}% less and the sun shone ${Math.abs(weather.solarPct) < 2 ? 'about as usual' : `${Math.abs(weather.solarPct).toFixed(0)}% ${weather.solarPct < 0 ? 'less' : 'more'}`}. The westerlies that fill the southern lakes also turn the wind farms. That is solar's one real dry-year strength: it doesn't fail when the rain does.`,
    `<b>But solar is weakest when it's needed.</b> It makes ${Math.round(season[5] * 100)}% of its average in June and ${Math.round(season[11] * 100)}% in December, while demand peaks in winter as the lakes draw down. The lakes make up for it by holding water back while the sun shines, and with today's ${(inputs.activeGwh / 1000).toFixed(1)} TWh of storage that works well. With half as much storage, solar would need ${gw(half.solar.gw)} and wind ${gw(half.wind.gw)}. The lakes are what make solar work.`,
    `<b>The emergency water helps solar most.</b> Counting the lakes' ${(inputs.contingentGwh / 1000).toFixed(1)} TWh of contingent storage, mostly low levels in Pūkaki and Tekapo kept for emergencies, wind would need ${gw(contingent.wind.gw)} and solar ${gw(contingent.solar.gw)}. Then each MWh of solar is worth ${Math.abs(1 - contingent.solar.value / contingent.wind.value) < 0.03 ? 'about the same as' : `${pctLess(contingent.solar.value / contingent.wind.value)} less than`} a MWh of wind.`,
    `<b>Mixing them is no shortcut.</b> Half the solar (${gw(sizes.solar.gw / 2)}) still needs ${mixWind === null ? 'more than half the wind' : `${gw(mixWind)} of wind`} to get through, ${mixWind !== null && mixWind <= sizes.wind.gw * 0.55 ? 'which is just half the wind' : `against half the wind's ${gw(sizes.wind.gw / 2)}`}. In a dry year sun and wind don't fill each other's gaps, so a mix costs what its parts do. ${solarYear === 2025 ? 'Solar is already the cheaper of the two.' : solarYear ? `Today wind is the cheaper of the two. Solar's cost falls faster, and it becomes cheaper from ${solarYear}.` : 'Wind stays the cheaper of the two to 2045.'}`,
    `<b>On a hydro lake, solar shares the wiring.</b> Panels floating on or beside a hydro lake can send power through the station's existing grid connection: the turbines back off while the sun shines and run harder after dark, so no new transmission line is needed up to the station's size. Huntly's new battery uses the same trick at a coal station. New Zealand has no solar on its hydro lakes yet, and no generator has announced any. Its only floating array is 1 MW on one hectare of Watercare's Rosedale wastewater ponds in Auckland. A 2023 study of 10 MW on Lake Maraetai and Lake Tekapo put the cost at NZ$176 to NZ$237/MWh, about twice what land-based solar costs (<a href="https://durham-repository.worktribe.com/output/2148836">Brent, Crossland and Ranusa</a>). At Rosedale's density, ${gw(sizes.solar.gw)} would cover about ${Math.round(area / 5) * 5} km², under a quarter of Lake Pūkaki. The Mackenzie Basin's landscape is fiercely protected, so it would be a hard consent.`,
    `<b>Less evaporation, but not much power.</b> Covering water roughly halves evaporation from the covered part: a Fraunhofer ISE study of Lake Nasser found 90% cover cut it by about 50% (<a href="https://www.pv-magazine.com/?p=254055">pv magazine</a>). If a Mackenzie lake loses about ${EVAP_M} m a year (our assumption), ${Math.round(area / 5) * 5} km² of panels would save about ${Math.round(evapMm3)} million m³ of water, worth about ${Math.round(evapGwh)} GWh a year through the Waitaki stations. That is ${(evapGwh / (sizes.solar.twh * 10)).toFixed(1)}% of what the panels themselves make: a bonus, not a reason to build.`,
  ].map((x) => `<li>${x}</li>`).join('');

  $('lakes-method').innerHTML = `<p>For every day from ${years}, the model takes that day's inflow to the hydro lakes and that day's wind and sunshine, and sets them against today's grid: the latest 365 days of demand (${L.fleet.demandTwh.toFixed(1)} TWh), geothermal, wood and biogas, and the wind and solar already built. Wind, solar and geothermal go first. The lakes cover the rest, down to ${LAKE.hydroMinGw} GW of hydro that river flows force through the turbines and up to ${LAKE.hydroMaxGw} GW, and spill once full. Water is only drawn when it's needed, which is the best an operator could do, so a day the lakes run dry is a day fossil fuel was unavoidable. Batteries move energy within the day and are costed separately in chapter 5.</p>
    <p>Inflows are the Electricity Authority's Hydrological Modelling Dataset: each lake and river inflow, times the megawatts a cubic metre a second makes in every station below it, summed over the Waikato, Tongariro, Waitaki, Clutha, Manapōuri, Waikaremoana and smaller schemes. They are scaled by ${inputs.inflowScale} so that inflow less hydro output matches the change in national lake storage month by month (R² ${inputs.balanceR2}). Storage is the lakes' ${(inputs.activeGwh / 1000).toFixed(2)} TWh of active storage at the end of 2024; contingent storage is left alone unless stated.</p>
    <p>Wind and sunshine are ERA5 reanalysis from Open-Meteo at seven wind-farm areas and six solar areas around the country, made into capacity factors of ${Math.round(LAKE.load.wind * 100)}% and ${Math.round(LAKE.load.solar * 100)}% on average, the cost model's figures. ERA5's daily wind tracks the actual wind fleet's output closely (correlation 0.82 to 0.90 from 2018 to 2025). Today's demand is held fixed, so this doesn't allow for growth from electric cars and industry.</p>`;

  // Switching build eases the lake line from the old levels to the new, so
  // you can see each build lift it off the bottom.
  const runs = {};
  const levels = (key) => (runs[key] ??= simulate(inputs, L.fleet, builds[key].add, { track: true }));
  const first = Date.parse(inputs.first);
  const weekly = (get) => {
    const pts = [];
    for (let i = 0; i < inputs.days; i += 7) {
      let v = Infinity;
      for (let k = i; k < Math.min(inputs.days, i + 7); k++) v = Math.min(v, get(k));
      pts.push([first + i * 864e5, v / 1000]);
    }
    return pts;
  };
  const actual = weekly((k) => inputs.storage[k]);
  const yMax = Math.ceil(Math.max(inputs.activeGwh, ...inputs.storage) / 1000);
  const plot = (pts, b, run) => {
    const series = [
      { name: 'Actual lake storage, with fossil fuel', color: css('--f-other'), width: 1.2, opacity: 0.8, points: actual },
      { name: b.name, color: css(b.color), width: 2, points: pts },
    ];
    lineChart($('lakes-chart'), {
      series,
      yMin: 0,
      yMax,
      yFormat: (v) => `${v.toFixed(2)} TWh`,
      yTickFormat: (v) => `${v}`,
      tooltip: (t, vals) => `<strong>${fmtDate(t)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${v.value.toFixed(2)} TWh</b></div>`).join('')}`,
    });
    const nYears = Math.round(inputs.days / 365.25);
    const dry = run.years.size;
    $('lakes-legend').innerHTML = `${series.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('')}<span>${dry ? `Lakes run dry in ${dry} of ${nYears} years, short ${(run.short / 1000 / (inputs.days / 365.25)).toFixed(1)} TWh a year on average and ${(run.worst.gwh / 1000).toFixed(1)} TWh in ${run.worst.year}` : 'The lakes never run dry'}</span>`;
  };
  let shown = null;
  let tween = 0;
  const draw = () => {
    document.querySelectorAll('[data-lakes]').forEach((b) => b.setAttribute('aria-checked', b.dataset.lakes === lakesBuild));
    const b = builds[lakesBuild];
    const run = levels(lakesBuild);
    const to = weekly((k) => run.level[k]);
    const from = shown;
    shown = to;
    const id = ++tween;
    if (!from || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { plot(to, b, run); return; }
    const start = performance.now();
    const step = (now) => {
      if (id !== tween) return;
      const p = Math.min(1, (now - start) / 900);
      const t = 1 - (1 - p) ** 3;
      plot(to.map(([x, v], k) => [x, from[k][1] + (v - from[k][1]) * t]), b, run);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  if (!renderLakes.wired) {
    renderLakes.wired = true;
    document.querySelectorAll('[data-lakes]').forEach((b) => {
      if (!builds[b.dataset.lakes]) b.hidden = true;
      b.addEventListener('click', () => { lakesBuild = b.dataset.lakes; draw(); });
    });
  }
  draw();
}

function renderBatteryStory() {
  const dis = data.columns.battery;
  const first = dis.findIndex((v) => v > 0);
  if (first < 0) {
    $('story-battery').innerHTML = '<p class="empty">No battery output in the data yet.</p>';
    return;
  }
  let peak = { v: 0, i: first };
  for (let i = first; i < end; i++) if (dis[i] > peak.v) peak = { v: dis[i], i };
  $('battery-take').textContent = `Grid batteries first show up in ${new Date(slotTime(first, data.startMs)).getUTCFullYear()}. Their biggest half hour so far is ${mw(peak.v)}, on ${fmtDate(slotTime(peak.i, data.startMs))}.`;
  const startDay = first - (first % 48);
  const raw = windowPoints(metricSeries(data, ['battery']), 'all').filter(([t]) => t >= slotTime(startDay, data.startMs));
  lineChart($('story-battery'), {
    series: [{ name: 'Battery discharge (daily mean)', color: css('--f-battery'), points: raw }],
    yMin: 0,
    yFormat: (v) => mw(v * 1000),
    yTickFormat: (v) => `${Math.round(v * 1000)}`,
    tooltip: (t, vals) => `<strong>${fmtDate(t)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? mw(v.value * 1000) : '—'}</b></div>`).join('')}`,
  });
}

async function main() {
  startAnalytics();
  readHash();
  setupControls();
  syncControls();
  renderQuestion();
  renderNowPlaceholder();
  setupNowHover(() => nowFigures);
  document.querySelectorAll('[data-now-window]').forEach((b) => b.addEventListener('click', () => {
    nowWindow = b.dataset.nowWindow;
    document.querySelectorAll('[data-now-window]').forEach((x) => x.setAttribute('aria-checked', x === b));
    if (data) renderNow(true);
  }));
  const lakes = fetch('lakes.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  try {
    data = await loadData('../data/nz');
    lakeInputs = await lakes;
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = data.length;
  while (end > 0 && Number.isNaN(data.columns.hydro[end - 1])) end--;
  $('updated').textContent = `Data from ${fmtDate(data.startMs)} to ${fmtDateTime(slotTime(end - 1, data.startMs))}, NZ time. Each month arrives a few weeks after it ends.`;
  renderNow();
  renderStory();
  update();
}

main();
