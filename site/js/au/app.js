// The Australia page: the latest data, the records tool and the story, for
// the whole National Electricity Market or any one state.
import { loadData } from '../data.js';
import { summarise, formatDuration, slotTime, STEP_MINUTES, meets } from '../records.js';
import { lineChart, heatmap, barChart, niceTicks, fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import { envelopes, windowEnvelopes } from '../envelope.js';
import { FUELS, FOSSIL, COAL, RENEWABLE, SOLAR, TZ, metricSeries, generationTotal, yearlyEnergy, yearlyHoursBelow, monthly, averageDay, dataEnd } from './data.js';
import { recentRecords } from '../recent.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from '../now-panel.js';
import { startAnalytics } from '../analytics.js';
import { renderStory as drawStory } from './story.js';

setTimeZone(TZ);

// The whole market, then each state. Tasmania is mostly hydro, South Australia mostly wind and sun.
export const REGIONS = { nem: 'Whole NEM', nsw: 'NSW', qld: 'Queensland', vic: 'Victoria', sa: 'South Australia', tas: 'Tasmania' };

const PRESETS = {
  fossil: { label: 'Fossil fuels', members: FOSSIL, mode: 'below', gw: [15, 12, 10, 8, 6, 4], pct: [60, 50, 40, 30, 20, 10] },
  coal: { label: 'Coal', members: COAL, mode: 'below', gw: [14, 12, 10, 8, 6], pct: [50, 40, 30, 20, 10] },
  gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [2, 1, 0.5, 0.25, 0.1], pct: [10, 5, 2, 1] },
  renewables: { label: 'Renewables', members: RENEWABLE, mode: 'above', gw: [10, 15, 20, 25], pct: [40, 50, 60, 70, 80], editable: true },
  wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [4, 6, 8, 10], pct: [20, 30, 40, 50] },
  solar: { label: 'Solar, farms and rooftops', members: SOLAR, mode: 'above', gw: [5, 10, 15, 20], pct: [30, 40, 50, 60] },
  rooftop: { label: 'Rooftop solar', members: ['rooftop'], mode: 'above', gw: [4, 8, 12, 16], pct: [20, 30, 40, 50] },
  battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.5, 1, 2, 3], pct: [2, 5, 10] },
  battery_charge: { label: 'Battery charging', members: ['battery_charge'], mode: 'above', gw: [0.5, 1, 2, 3], pct: [2, 5, 10] },
  price: { label: 'Wholesale price', members: ['price'], mode: 'below', price: [100, 50, 20, 0, -20], money: true },
  custom: { label: 'Custom group…', members: ['wind', 'solar', 'rooftop'], mode: 'above', gw: [5, 10, 15], pct: [30, 40, 50], editable: true },
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
const auNum = (v) => v.toLocaleString('en-AU');
const regionFromPath = () => new URLSearchParams(location.hash.slice(1)).get('r');

const state = { region: 'nem', preset: 'fossil', mode: 'below', unit: 'gw', thresholds: PRESETS.fossil.gw, members: PRESETS.fossil.members, range: 'all', membersOpen: false, scale: 'linear' };
let data;
let end; // one past the last slot with data

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (REGIONS[p.get('r')]) state.region = p.get('r');
  if (PRESETS[p.get('m')]) state.preset = p.get('m');
  const preset = PRESETS[state.preset];
  state.mode = ['below', 'above'].includes(p.get('d')) ? p.get('d') : preset.mode;
  state.unit = preset.money ? 'price' : ['gw', 'pct'].includes(p.get('u')) ? p.get('u') : 'gw';
  const t = parseThresholds(p.get('t') ?? '');
  state.thresholds = t.length ? t : preset[state.unit];
  const g = (p.get('g') ?? '').split(',').filter((m) => FUELS[m]);
  state.members = preset.editable && g.length ? g : preset.members;
  state.scale = p.get('s') === 'log' ? 'log' : 'linear';
}

function writeHash() {
  const p = new URLSearchParams({ r: state.region, m: state.preset, d: state.mode, u: state.unit, t: state.thresholds.join(',') });
  if (PRESETS[state.preset].editable) p.set('g', state.members.join(','));
  if (state.scale === 'log') p.set('s', 'log');
  history.replaceState(null, '', `#${p}`);
}

function parseThresholds(s) {
  return [...new Set(s.split(/[\s,]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v) && (v >= 0 || state.unit === 'price')))].slice(0, MAX_THRESHOLDS);
}

const money = (v) => `${v < 0 ? '−' : ''}$${auNum(Math.abs(Math.round(v)))}`;
const fmtValue = (v) => (state.unit === 'price' ? `${money(v)}/MWh` : state.unit === 'gw' ? (v < 1 ? `${Math.round(v * 1000)} MW` : `${+v.toFixed(2)} GW`) : `${+v.toFixed(v < 1 ? 1 : 0)}%`);
const fmtThreshold = (v) => (state.unit === 'price' ? `${money(v)}/MWh` : state.unit === 'gw' ? (v < 1 && v > 0 ? `${Math.round(v * 1000)} MW` : `${v} GW`) : `${v}%`);
const thresholdLabel = (t) => (state.mode === 'below' ? (t === 0 && state.unit !== 'price' ? 'Zero' : `< ${fmtThreshold(t)}`) : `≥ ${fmtThreshold(t)}`);

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
    if (p.money) state.unit = 'price';
    else if (state.unit === 'price') state.unit = 'gw';
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
    if (state.unit === b.dataset.unit || PRESETS[state.preset].money) return;
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
    if (f.notGeneration) continue;
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
  // Links from the summary open their chapter.
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-open]');
    if (!link) return;
    e.preventDefault();
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
  $('units-field').hidden = !!PRESETS[state.preset].money;
  document.querySelectorAll('[data-region]').forEach((b) => b.setAttribute('aria-checked', b.dataset.region === state.region));
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
  const where = state.region === 'nem' ? 'the grid' : REGIONS[state.region];
  if (state.unit === 'price') {
    $('question').textContent = `What is the longest ${state.region === 'nem' ? 'the NEM' : REGIONS[state.region]} has gone with the wholesale price ${verb} each level?`;
    return;
  }
  const what = state.unit === 'pct' ? `${groupName()} as a share of generation` : groupName();
  $('question').textContent = `What is the longest ${where} has run with ${what} ${verb} each threshold?`;
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
      <td class="big">${pct(q, yearSlots)}</td><td>${auNum(s.count)}</td></tr>`;
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
  { label: 'Renewables', color: '--lowcarbon', fuels: ['wind', 'solar', 'rooftop', 'hydro', 'bioenergy'].map(fuel) },
  { label: 'Fossil fuels', color: '--fossil', fuels: ['black_coal', 'brown_coal', 'gas', 'liquid'].map(fuel) },
];
const NOW_WINDOWS = {
  day: { slots: 48, span: 'Latest 24 hours', sub: '24h average' },
  week: { slots: 48 * 7, span: 'Latest 7 days', sub: '7d average' },
  month: { slots: 48 * 30, span: 'Latest 30 days', sub: '30d average' },
  year: { slots: 48 * 365, span: 'Latest 365 days', sub: '365d average' },
};
let nowWindow = 'day';
const INFO = {
  Renewables: 'Wind, solar farms, rooftop solar, hydro and bioenergy.',
  Wind: 'Wind farms, most of them in Victoria, South Australia and New South Wales.',
  'Solar farms': 'Grid-scale solar farms, which report to AEMO every five minutes.',
  'Rooftop solar': 'Panels on homes and businesses. AEMO estimates their output from a sample of systems; it lowers the demand the grid sees.',
  Hydro: 'Snowy Hydro, Tasmania and Wivenhoe, including pumped hydro generating.',
  Bioenergy: 'Bagasse at Queensland sugar mills, landfill gas and biomass.',
  'Fossil fuels': 'Black coal, brown coal, gas, and diesel and oil.',
  'Black coal': 'Coal stations in New South Wales and Queensland.',
  'Brown coal': 'Victoria\'s Latrobe Valley stations: Loy Yang A, Loy Yang B and Yallourn.',
  Gas: 'Gas turbines and steam plants, including coal seam and mine gas.',
  'Diesel and oil': 'Diesel and kerosene peakers, used at times of tight supply.',
  'Battery discharge': 'What grid-scale batteries send into the grid. Home batteries are not in the data.',
  'Battery charging': 'What grid-scale batteries take from the grid, mostly in the middle of the day.',
};
const info = infoButton(INFO);

// Records to watch, in GW, for the recent records list. Each state's page
// scales them to its size.
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
/** The watch list in GW for this region: shares of its mean generation, rounded. */
function watchFor(meanGw) {
  const round = (v) => +v.toPrecision(v < 1 ? 1 : 2);
  return NOW_WATCH.map((w) => ({ ...w, gw: [...new Set(w.share.map((f) => round(f * meanGw)))] }));
}
const NOW_RECORD_ROWS = 8;
const RECORD_COLORS = { 'Fossil fuels': '--fossil', Coal: '--f-coal', Renewables: '--lowcarbon', Wind: '--f-wind', Batteries: '--f-battery', 'Most wind': '--f-wind', 'Most solar': '--f-solar', 'Most battery output': '--f-battery', 'Least fossil fuel': '--fossil', 'Greenest half hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest half hour': 'Greenest', 'Most battery output': 'Most battery' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: TZ });
const shortDuration = (slots) => formatDuration(slots).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => `${+v.toFixed(v < 1 ? 2 : 1)} GW`;
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(r.value >= 99.95 ? 2 : 1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (NEM time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
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
    <div class="nr head" style="--tint: var(--f-battery)"><span class="lbl">Grid batteries <span class="sm">net</span></span><span></span>${num(fmtGw(bat.dis - bat.chg))}<span></span></div>
    <div class="nr" style="--tint: var(--f-battery)"><span class="lbl">${info('Battery discharge')}Discharging</span><span class="num">${pc(bat.dis)}</span>${num(fmtGw(bat.dis))}${sparkTile(bat.disSeries, '--f-battery', NOW_WINDOWS[nowWindow].span)}</div>
    <div class="nr" style="--tint: var(--s1)"><span class="lbl">${info('Battery charging')}Charging</span><span class="num">${pc(bat.chg)}</span>${num(Number.isFinite(bat.chg) ? `−${fmtGw(Math.abs(bat.chg))}` : '—')}${sparkTile(bat.chgSeries?.map((v) => -v), '--s1', NOW_WINDOWS[nowWindow].span)}</div>`;
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
  const chg = windowFigures((k) => data.columns.battery_charge[k], i, win.slots);
  figs.bat = { dis: dis.value, chg: chg.value, disSeries: dis.series, chgSeries: chg.series };
  nowFigures = hoverFigures(figs, win.sub, win.span);
  const year = groupFigures(NOW_GROUPS, data.columns, i, 48 * 365);
  nowRecords ??= recentRecords({ ...data, length: end }, { watch: watchFor(year.total / 1000), peaks: NOW_PEAKS, series: metricSeries, total: generationTotal(data), greenFloor: year.total / 4, limit: NOW_RECORD_ROWS });
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

// The story is worked out once per region and drawn by story.js.
let story = null;
function renderStory() {
  story = drawStory({ data, end, region: state.region, regionName: REGIONS[state.region], story, factsHtml, windowPoints });
}

async function loadRegion() {
  $('updated').textContent = `Loading the data for ${REGIONS[state.region] === 'Whole NEM' ? 'the whole NEM' : REGIONS[state.region]}.`;
  try {
    data = await loadData(`../data/au/${state.region}`);
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = dataEnd(data);
  seriesCache = null;
  envelopeCache = null;
  nowRecords = null;
  story = null;
  const pending = data.meta.months.toFetch ? ` ${data.meta.months.toFetch} older months are still being fetched.` : '';
  $('updated').textContent = `Data from ${fmtDate(data.startMs)} to ${fmtDateTime(slotTime(end - 1, data.startMs))}, NEM time (AEST). AEMO publishes each month two to six weeks after it ends.${pending}`;
  renderNow();
  renderStory();
  update();
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
  document.querySelectorAll('[data-region]').forEach((b) => b.addEventListener('click', () => {
    if (state.region === b.dataset.region) return;
    state.region = b.dataset.region;
    syncControls();
    writeHash();
    loadRegion();
  }));
  await loadRegion();
}

main();
