import { loadData, metricSeries, FUELS, BATTERY_SOURCES, lastComplete, generationTotal } from './data.js';
import { summarise, formatDuration, slotTime, STEP_MINUTES, meets } from './records.js';
import { lineChart, heatmap, barChart, niceTicks, fmtDate, fmtDateTime } from './charts.js';
import { recentRecords } from './recent.js';
import { envelopes } from './envelope.js';
import { MIX, FOSSIL, LOW_CARBON, yearlyMix, monthlyShares, yearlyHoursBelow, facts } from './story.js';
import { renderBatteryOrigins } from './origins.js';
import { renderSolar } from './solar-view.js';
import { startAnalytics } from './analytics.js';

const PRESETS = {
  fossil: { label: 'Fossil fuels', members: ['gas', 'coal'], mode: 'below', gw: [20, 10, 5, 2, 1, 0.5, 0.1, 0], pct: [50, 30, 20, 10, 5, 2, 1, 0] },
  lowcarbon: { label: 'Low carbon', members: ['wind', 'solar', 'nuclear', 'hydro', 'storage', 'battery'], mode: 'above', gw: [1, 2, 5, 10, 15, 20, 25, 30], pct: [10, 20, 30, 50, 70, 80, 90, 95], editable: true },
  renewables: { label: 'Renewables', members: ['wind', 'solar', 'hydro', 'storage', 'biomass'], mode: 'above', gw: [1, 2, 5, 10, 15, 20, 25, 30], pct: [10, 20, 30, 50, 60, 70, 80, 90], editable: true },
  gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [10, 5, 2, 1, 0.5, 0.1, 0], pct: [30, 20, 10, 5, 1, 0] },
  coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [5, 1, 0.5, 0.1, 0], pct: [20, 10, 5, 1, 0] },
  wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [5, 10, 15, 20, 25], pct: [25, 40, 50, 60, 70] },
  solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [2, 5, 10, 15], pct: [10, 20, 30, 40] },
  nuclear: { label: 'Nuclear', members: ['nuclear'], mode: 'below', gw: [6, 5, 4, 3], pct: [20, 15, 10, 5] },
  imports: { label: 'Imports', members: ['imports'], mode: 'above', gw: [2, 5, 8, 10], pct: [10, 15, 20, 25] },
  battery: { label: 'Battery discharge', members: ['battery'], mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [2, 5, 10, 15] },
  batterycharge: { label: 'Battery charging', members: ['battery_charge'], mode: 'above', gw: [0.5, 1, 2, 3, 4], pct: [2, 5, 10, 15] },
  custom: { label: 'Custom group…', members: ['wind', 'solar', 'nuclear', 'hydro', 'biomass'], mode: 'above', gw: [10, 20, 30], pct: [50, 75, 90], editable: true },
};

const RAMP = ['--r1', '--r2', '--r3', '--r4', '--r5', '--r6', '--r7', '--r8'];
const MAX_THRESHOLDS = RAMP.length;
// Duration bands for the per-year heatmap, roughly log-spaced, in half hours.
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

const state = {
  preset: 'fossil',
  mode: 'below',
  unit: 'gw',
  thresholds: PRESETS.fossil.gw,
  members: PRESETS.fossil.members,
  battery: 'pn',
  range: 'all',
  batteryRange: '14',
  membersOpen: false,
  scale: 'linear',
};

let data;

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
  if (BATTERY_SOURCES[p.get('b')]) state.battery = p.get('b');
  state.scale = p.get('s') === 'log' ? 'log' : 'linear';
}

function writeHash() {
  const p = new URLSearchParams({ m: state.preset, d: state.mode, u: state.unit, t: state.thresholds.join(','), b: state.battery });
  if (PRESETS[state.preset].editable) p.set('g', state.members.join(','));
  if (state.scale === 'log') p.set('s', 'log');
  history.replaceState(null, '', `#${p}`);
}

function parseThresholds(s) {
  return [...new Set(s.split(/[\s,]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v) && v >= 0))].slice(0, MAX_THRESHOLDS);
}

const unitLabel = () => (state.unit === 'gw' ? 'GW' : '%');
const fmtValue = (v) => (state.unit === 'gw' ? `${+v.toFixed(v < 1 ? 2 : 1)} GW` : `${+v.toFixed(v < 1 ? 1 : 0)}%`);
const fmtThreshold = (v) => (state.unit === 'gw' ? `${v} GW` : `${v}%`);
/** Row label for a threshold, e.g. "< 2 GW", "≥ 20 GW" or "Zero". */
const thresholdLabel = (t) => (state.mode === 'below' ? (t === 0 ? 'Zero' : `< ${fmtThreshold(t)}`) : `≥ ${fmtThreshold(t)}`);

/** Thresholds ordered from easiest to hardest, so darker colours mean harder. */
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
  const bat = $('battery-source');
  for (const [key, label] of Object.entries(BATTERY_SOURCES)) bat.add(new Option(label, key));
  bat.addEventListener('change', () => {
    state.battery = bat.value;
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
    if (b.closest('#battery-range')) state.batteryRange = b.dataset.range;
    else state.range = b.dataset.range;
    syncControls();
    if (b.closest('#battery-range')) renderBattery();
    else renderTimeline(currentSeries());
  }));
  let resize;
  addEventListener('resize', () => {
    clearTimeout(resize);
    resize = setTimeout(redrawAll, 150);
  });
  // Story chapters: charts in a closed chapter have no width, so redraw when
  // one opens. "Next" closes this chapter and opens the following one.
  for (const ch of document.querySelectorAll('details.chapter')) {
    ch.addEventListener('toggle', () => { if (ch.open && data) redrawAll(); });
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.next-ch');
    if (!btn) return;
    btn.closest('details.chapter').open = false;
    const next = $(btn.dataset.next);
    next.open = true;
    next.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function syncControls() {
  $('preset').value = state.preset;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === state.mode));
  document.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-checked', b.dataset.unit === state.unit));
  document.querySelectorAll('#range [data-range]').forEach((b) => b.setAttribute('aria-checked', b.dataset.range === state.range));
  document.querySelectorAll('#battery-range [data-range]').forEach((b) => b.setAttribute('aria-checked', b.dataset.range === state.batteryRange));
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
  $('battery-source').value = state.battery;
}

let seriesCache = null;
function currentSeries() {
  const key = JSON.stringify([state.members, state.unit, state.battery]);
  if (seriesCache?.key !== key) {
    seriesCache = { key, values: metricSeries(data, state.members, { unit: state.unit, batterySource: state.battery }) };
  }
  return seriesCache.values;
}

function groupName() {
  if (!PRESETS[state.preset].editable) return PRESETS[state.preset].label.replace(/ \(.*\)/, '').toLowerCase();
  const names = state.members.map((m) => FUELS[m].label.toLowerCase());
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

function redrawAll() {
  if (!data) return;
  renderStory();
  update();
  renderSolar(data);
  if (!$('origin-body').hidden) renderBatteryOrigins(data);
}

function update() {
  syncControls();
  writeHash();
  const values = currentSeries();
  const thresholds = orderedThresholds();
  const summaries = thresholds.map((t) => summarise(values, t, state.mode, { startMs: data.startMs, maxGap: 2 }));
  renderQuestion();
  renderTable(summaries);
  renderProgression(summaries);
  renderByYear(summaries);
  renderTimeline(values);
  renderBattery();
}

function renderQuestion() {
  const verb = state.mode === 'below' ? 'below' : 'at or above';
  const what = state.unit === 'pct' ? `${groupName()} as a share of generation` : groupName();
  $('question').textContent = `What is the longest the grid has run with ${what} ${verb} each threshold?`;
}

function renderTable(summaries) {
  const n = summaries.length;
  const lastSlot = data.length;
  const yearSlots = (365 * 24 * 60) / STEP_MINUTES;
  const rows = summaries.map((s, i) => {
    const r = s.record;
    const c = s.current;
    const ongoing = r && c && c.start === r.start;
    const longest = r ? `<td class="big">${formatDuration(r.end - r.start)}<span class="when">${fmtDateTime(slotTime(r.start, data.startMs))} ${ongoing ? 'and still going' : `to ${fmtDateTime(slotTime(r.end, data.startMs))}`}</span></td>` : '<td>Never</td>';
    const cur = c ? `<td class="big">${formatDuration(c.end - c.start)}${ongoing ? '<span class="live record-live" title="The current spell is the longest ever">Record, live</span>' : '<span class="live">Live</span>'}<span class="when">since ${fmtDateTime(slotTime(c.start, data.startMs))}</span></td>` : '<td>—</td>';
    const lastYear = qualifyingSince(s.threshold, lastSlot - yearSlots);
    return `<tr><td><span class="swatch" style="background:${thresholdColor(i, n)}"></span><b>${thresholdLabel(s.threshold).replace('<', '&lt;')}</b></td>${longest}${cur}
      <td class="big">${pct(lastYear, yearSlots)}</td><td>${s.count.toLocaleString('en-GB')}</td></tr>`;
  });
  $('records-table').innerHTML = `<thead><tr><th>Threshold</th><th>Longest spell</th><th>Current spell</th><th>Share of past 365 days</th><th>Spells</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

// Half hours since a slot that meet the threshold.
function qualifyingSince(threshold, fromSlot) {
  const values = currentSeries();
  let n = 0;
  for (let i = Math.max(0, Math.floor(fromSlot)); i < values.length; i++) {
    const v = values[i];
    if (!Number.isNaN(v) && meets(v, threshold, state.mode)) n++;
  }
  return n;
}

const pct = (a, b) => `${b ? ((a / b) * 100).toFixed(a / b < 0.01 ? 2 : 1) : 0}%`;

// The records chart has its own scale switch; log by default, since records
// run from half an hour to days.
let progScale = 'log';

/** Evenly spaced ticks in hours, stepping in whole days once records pass three days. */
function linearHourTicks(series) {
  const max = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p[1])));
  const days = max > 72;
  const ticks = niceTicks(0, days ? max / 24 : max);
  const step = ticks[1] - ticks[0];
  if (ticks[ticks.length - 1] < (days ? max / 24 : max)) ticks.push(Number((ticks[ticks.length - 1] + step).toPrecision(10)));
  return days ? ticks.map((d) => d * 24) : ticks;
}
let lastSummaries = null;

function renderProgression(summaries) {
  lastSummaries = summaries;
  const log = progScale === 'log';
  const n = summaries.length;
  const now = slotTime(data.length, data.startMs);
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

function renderByYear(summaries) {
  const y0 = new Date(data.startMs).getUTCFullYear();
  const y1 = new Date(slotTime(data.length - 1, data.startMs)).getUTCFullYear();
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  const values = summaries.map((s) => {
    const map = new Map(s.perYear);
    return years.map((y) => map.get(y) ?? null);
  });
  $('by-year-legend').innerHTML = SPELL_BANDS.map((b) => `<span><span class="swatch" style="background:${b.color}"></span>${b.label}</span>`).join('');
  heatmap($('by-year'), {
    rows: summaries.map((s) => thresholdLabel(s.threshold)),
    cols: years.map(String),
    values: values.map((r) => r.map((sp) => (sp ? sp.end - sp.start : null))),
    color: (v) => bandFor(v).color,
    // A tick where the spell covers the whole calendar year.
    mark: (ri, ci) => {
      const sp = values[ri][ci];
      const y = years[ci];
      return !!sp && sp.end - sp.start >= (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / (STEP_MINUTES * 60000);
    },
    format: formatDuration,
    title: (r, c, v) => {
      const sp = values[summaries.findIndex((s) => thresholdLabel(s.threshold) === r)][years.indexOf(Number(c))];
      const whole = sp?.spell;
      const clipped = whole && (whole.start !== sp.start || whole.end !== sp.end);
      const full = sp && v >= (Date.UTC(+c + 1, 0, 1) - Date.UTC(+c, 0, 1)) / (STEP_MINUTES * 60000);
      return sp ? `<strong>${c}, ${r}</strong><div>Longest in ${c}: <b>${full ? 'the whole year ✓' : formatDuration(v)}</b></div><div>${fmtDateTime(slotTime(sp.start, data.startMs))} to ${fmtDateTime(slotTime(sp.end, data.startMs))}</div>${clipped ? `<div class="when">Part of a ${formatDuration(whole.end - whole.start)} spell from ${fmtDate(slotTime(whole.start, data.startMs))} to ${fmtDate(slotTime(whole.end, data.startMs))}</div>` : ''}`
        : `<strong>${c}, ${r}</strong><div>No spells</div>`;
    },
  });
}

/** Daily means for long ranges, raw half hours for short ones. */
function windowPoints(values, days, fromEnd = data.length) {
  const end = fromEnd;
  const slotsPerDay = 48;
  const start = days === 'all' ? 0 : Math.max(0, end - Number(days) * slotsPerDay);
  const pts = [];
  if (days === 'all' || Number(days) > 60) {
    for (let d = start - (start % slotsPerDay); d < end; d += slotsPerDay) {
      let sum = 0;
      let n = 0;
      for (let i = d; i < Math.min(end, d + slotsPerDay); i++) if (!Number.isNaN(values[i])) { sum += values[i]; n++; }
      pts.push([slotTime(d, data.startMs), n ? sum / n : NaN]);
    }
  } else {
    for (let i = start; i < end; i++) pts.push([slotTime(i, data.startMs), values[i]]);
  }
  return pts;
}

// How many plotted points each envelope spans, per time range: a day of
// half hours for a week, three days for a month, a fortnight of daily means
// for a year, and a year of them for all time.
const ENVELOPE_POINTS = { 7: 48, 30: 144, 365: 14, all: 365 };
const ENVELOPE_LABEL = { 7: '24-hour', 30: '3-day', 365: '14-day', all: '365-day' };
let envelopeCache = null;

/** The line, its two envelope bands and their edges, as lineChart series and bands. */
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
  const end = lastComplete(data, ['gas']) + 1;
  const daily = state.range === 'all' || Number(state.range) > 60;
  const raw = windowPoints(values, state.range, end);
  const key = `${seriesCache.key}|${state.range}|${end}`;
  if (envelopeCache?.key !== key) {
    envelopeCache = { key, ...envelopes(raw.map(([, v]) => v), ENVELOPE_POINTS[state.range] ?? 48) };
  }
  const span = ENVELOPE_LABEL[state.range] ?? '24-hour';
  $('timeline-note').textContent = `Over each rolling ${span} window, the light band spans every value and the darker band the middle 99%, leaving out the rarest spikes.`;
  lineChart($('timeline'), {
    ...envelopeLayers(raw, envelopeCache, `${groupName()}${daily ? ' (daily mean)' : ''}`),
    refLines: thresholds.map((t, i) => ({ value: t, color: thresholdColor(i, thresholds.length) })),
    yLog: state.scale === 'log',
    fitData: state.scale !== 'log',
    yMin: state.scale === 'log' ? (state.unit === 'pct' ? 0.5 : 0.05) : undefined,
    yTicks: state.scale === 'log' ? [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] : undefined,
    yFormat: fmtValue,
    yTickFormat: (v) => `${v}${state.unit === 'pct' ? '%' : ''}`,
    tooltip: (t, vals) => `<strong>${daily ? fmtDate(t) : fmtDateTime(t)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? fmtValue(v.value) : '—'}</b></div>`).join('')}`,
  });
}

function renderBattery() {
  const c = data.columns;
  const net = (s) => {
    const d = c[`${s}_dis`];
    const g = c[`${s}_chg`];
    const out = new Float64Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = (d[i] + g[i]) / 1000;
    return out;
  };
  const other = Float64Array.from(c.other, (v) => v / 1000);
  const days = state.batteryRange;
  const series = [
    { name: 'Elexon planned (PN), net', color: css('--s1'), points: windowPoints(net('pn'), days) },
    { name: 'Elexon metered (B1610), net', color: css('--s2'), points: windowPoints(net('b1610'), days) },
    { name: 'NESO "Other" (includes battery discharge)', color: css('--s3'), points: windowPoints(other, days), dash: '5 4' },
  ];
  lineChart($('battery-chart'), {
    series,
    zeroLine: true,
    yFormat: (v) => `${v.toFixed(2)} GW`,
    yTickFormat: (v) => `${v}`,
  });
  $('battery-legend').innerHTML = series.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('') + '<span>GW</span>';

  const cov = data.meta.battery.coverage;
  const first = (s) => (cov[s]?.first != null ? fmtDate(slotTime(cov[s].first, data.startMs)) : 'not yet');
  const last = (name) => (data.meta.lastSlot[name] != null ? fmtDateTime(slotTime(data.meta.lastSlot[name], data.startMs)) : '—');
  const backfill = (s) => (cov[s]?.backfillRemaining ? ` (still backfilling ${cov[s].backfillRemaining} days)` : '');
  renderBatterySources([
    `${first('pn')} to ${last('pn_dis')}${backfill('pn')}`,
    `${first('b1610')} to ${last('b1610_dis')}${backfill('b1610')}`,
    `2009 to ${last('other')}`,
  ]);
  const units = data.meta.battery.units;
  const mw = units.reduce((n, u) => n + u.mw, 0);
  $('units-summary').textContent = `${units.length} battery units, ${(mw / 1000).toFixed(1)} GW of export capacity`;
  $('units').innerHTML = `<thead><tr><th>Unit</th><th>Name</th><th>Operator</th><th>MW</th><th>Matched by</th></tr></thead><tbody>${units.map((u) => `<tr><td>${u.ng ?? u.elexon}</td><td>${u.name}</td><td>${u.party ?? ''}</td><td>${Math.round(u.mw)}</td><td>${u.reason}</td></tr>`).join('')}</tbody>`;
}

// "3h 30m", "4d 20h": short enough for a tile.
function shortDuration(slots) {
  return formatDuration(slots).replace(/ (minute|hour|day)s?/g, (_, u) => u[0]);
}

const NOW_GROUPS = [
  { label: 'Fossil fuels', color: '--fossil', fuels: [
    { label: 'Gas', cols: ['gas'], color: '--f-gas' },
    { label: 'Coal', cols: ['coal'], color: '--f-coal' },
  ] },
  { label: 'Renewables', color: '--lowcarbon', fuels: [
    { label: 'Wind', cols: ['wind', 'wind_emb'], color: '--f-wind' },
    { label: 'Solar', cols: ['solar'], color: '--f-solar' },
    { label: 'Hydro', cols: ['hydro'], color: '--f-hydro' },
    { label: 'Pumped hydro', cols: ['storage'], color: '--f-hydro-2' },
    { label: 'Biomass', cols: ['biomass'], color: '--f-biomass' },
  ] },
  { label: 'Other sources', color: '--f-nuclear', fuels: [
    { label: 'Nuclear', cols: ['nuclear'], color: '--f-nuclear' },
    { label: 'Imports', cols: ['imports'], color: '--f-imports' },
    { label: 'Other', cols: ['other'], color: '--f-other' },
  ] },
];

// A coloured square with the past day's trace drawn across it, as on Kate's site.
function sparkTile(values, color) {
  const fin = (values ?? []).filter(Number.isFinite);
  let line = '';
  if (fin.length >= 2) {
    const lo = Math.min(0, ...fin);
    const hi = Math.max(...fin, lo + 1);
    const pts = values.map((v, k) => (Number.isFinite(v) ? `${((k / (values.length - 1)) * 40).toFixed(1)},${(26 - ((v - lo) / (hi - lo)) * 20).toFixed(1)}` : null)).filter(Boolean).join(' ');
    line = `<polyline points="${pts}" fill="none" stroke="var(--line)" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  const tip = fin.length >= 2 ? ` data-tip="Past 24 hours: ${(Math.min(...fin) / 1000).toFixed(2)} to ${(Math.max(...fin) / 1000).toFixed(2)} GW"` : '';
  return `<svg class="spark" viewBox="0 0 40 28" aria-hidden="true" style="background:var(${color})"${tip}>${line}</svg>`;
}

function donut(groups, total) {
  const size = 260;
  const c = size / 2;
  const arc = (r0, r1, a0, a1) => {
    if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
    const p = (r, a) => `${(c + r * Math.sin(a)).toFixed(2)},${(c - r * Math.cos(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${p(r1, a0)}A${r1},${r1} 0 ${large} 1 ${p(r1, a1)}L${p(r0, a1)}A${r0},${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
  };
  let inner = '';
  let outer = '';
  let a = 0;
  for (const g of groups) {
    const ga = a;
    for (const f of g.fuels) {
      const span = (f.now / total) * Math.PI * 2;
      if (span > 0) outer += `<path d="${arc(94, 118, a, a + span)}" fill="${css(f.color)}" data-key="${f.label}" data-group="${g.label}"></path>`;
      a += span;
    }
    if (a > ga) inner += `<path d="${arc(66, 92, ga, a)}" fill="${css(g.color)}" data-key="${g.label}"></path>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Current generation mix"><circle class="disc" cx="${c}" cy="${c}" r="128"/>${outer}${inner}
    <text x="${c}" y="${c - 14}" text-anchor="middle" class="donut-label">Generation</text>
    <text x="${c}" y="${c + 12}" text-anchor="middle" class="donut-value">${(total / 1000).toFixed(1)} GW</text>
    <text x="${c}" y="${c + 32}" text-anchor="middle" class="donut-sub"></text></svg>`;
}

// What each row means, shown from its "?" button.
const INFO = {
  'Fossil fuels': 'Gas and coal power stations.',
  Gas: 'Gas power stations, mostly combined cycle plants plus some fast-starting open cycle units.',
  Coal: 'Coal power stations. Britain\'s last one, Ratcliffe-on-Soar, closed on 30 September 2024.',
  Renewables: 'Wind, solar, hydro, pumped storage and biomass.',
  Wind: 'Onshore and offshore wind farms, including the smaller farms connected to local networks.',
  Solar: 'Solar panels. Almost all are on local networks, so NESO estimates this figure.',
  Hydro: 'Hydroelectric power stations, mostly in Scotland and Wales.',
  'Pumped hydro': 'Pumped storage hydro stations, which pump water uphill when power is cheap and release it at peak times.',
  Biomass: 'Power stations burning wood pellets and other plant material, such as Drax.',
  'Other sources': 'Nuclear, imports through interconnectors, and other small sources.',
  Nuclear: 'Nuclear power stations, which run steadily around the clock.',
  Imports: 'Net power flowing in through the interconnectors to Europe and Ireland.',
  Other: 'Small sources NESO doesn\'t list separately. Battery output is counted here.',
  Discharging: 'What battery units planned to export (Elexon Physical Notifications). Counted inside Other.',
  Charging: 'What battery units planned to import (Elexon Physical Notifications).',
  'Metered net': 'Battery export minus import from settlement meters (Elexon B1610), which arrive about five days late.',
};
const info = (key) => (INFO[key] ? `<button type="button" class="info" data-tip="${INFO[key].replace(/"/g, '&quot;')}" aria-label="About ${key}">?</button>` : '');

const RECORD_COLORS = { 'Fossil fuels': '--fossil', 'Low carbon': '--lowcarbon', Renewables: '--lowcarbon', Wind: '--f-wind', Solar: '--f-solar', 'Most wind': '--f-wind', 'Most solar': '--f-solar', 'Least fossil fuel': '--fossil', 'Greenest half hour': '--lowcarbon' };
const PEAK_NAMES = { 'Least fossil fuel': 'Least fossil', 'Greenest half hour': 'Greenest' };
const shortDay = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });

/** One row of the records list: what, when, the record, and a marker. */
function recordRow(r) {
  const gw = (v) => `${+v.toFixed(v < 1 ? 1 : 0)} GW`;
  const color = RECORD_COLORS[r.label] ?? '--sunny';
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<div class="nr rec" data-tip="${r.label} ever, at ${fmtDateTime(r.startMs)} (UK time)." style="--tint: var(${color})"><span class="lbl">${PEAK_NAMES[r.label] ?? r.label} ever</span><span class="sm">${shortDay(r.startMs)}</span><span class="num">${v}</span><span class="mark-tile" style="background:var(${color})"></span></div>`;
  }
  const what = `${r.label === 'Fossil fuels' ? 'Fossil' : r.label} ${r.mode === 'below' ? 'under' : 'over'} ${gw(r.threshold)}`;
  const when = r.live ? `since ${fmtDate(r.startMs)}, still going` : `${fmtDate(r.startMs)} to ${fmtDate(r.endMs)}`;
  return `<div class="nr rec${r.live ? ' is-live' : ''}" data-tip="The longest spell on record, ${when}." style="--tint: var(${color})"><span class="lbl">${what}</span><span class="sm">${r.live ? 'live' : shortDay(r.endMs)}</span><span class="num">${shortDuration(r.slots)}</span><span class="mark-tile" style="background:var(${r.live ? '--sunny' : color})">${r.live ? 'LIVE' : ''}</span></div>`;
}

const NOW_RECORD_ROWS = 8;
const fmtGw = (v) => (Number.isFinite(v) ? (v / 1000).toFixed(2) : '—');
const num = (v, unit = 'GW') => `<span class="num">${v}<small>${unit}</small></span>`;

// The left half of the Right now panel: a band per group, then a row per fuel.
// Non-finite values show as dashes, which is how the loading placeholder
// reserves the panel's exact height.
function nowLeftHtml(groups, total) {
  const pc = (v) => (Number.isFinite(v) && total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '—');
  return groups.map((g) => `
    <div class="nr head" style="--tint: var(${g.color})" data-key="${g.label}"><span></span>${num(fmtGw(g.now))}<span class="num">${pc(g.now)}</span><span class="lbl">${g.label}${info(g.label)}</span></div>
    ${g.fuels.map((f) => `<div class="nr" data-key="${f.label}" data-group="${g.label}" style="--tint: var(${f.color})">${sparkTile(f.series, f.color)}${num(fmtGw(f.value))}<span class="num">${pc(f.now)}</span><span class="lbl">${f.label}${info(f.label)}</span></div>`).join('')}`).join('');
}

// The right half: recent records, then batteries, mirroring the left.
function nowRightHtml(recs, bat, total) {
  // recs is null while loading, so the rows stay blank.
  const rows = (recs ?? []).slice(0, NOW_RECORD_ROWS).map(recordRow);
  // On phones empty rows collapse, so the placeholder keeps five, a typical count.
  if (!recs) while (rows.length < 5) rows.push('<div class="nr rec"><span></span></div>');
  while (rows.length < NOW_RECORD_ROWS) rows.push(`<div class="nr rec">${rows.length === 0 && recs?.length === 0 ? '<span class="lbl sm">No new records in the last six months</span>' : ''}</div>`);
  const pc = (v) => (Number.isFinite(v) && total > 0 ? `${((Math.abs(v) / total) * 100).toFixed(1)}%` : '—');
  const net = Number.isFinite(bat.net) ? `${bat.net < 0 ? '−' : ''}${Math.abs(bat.net / 1000).toFixed(2)}` : '—';
  const state = Number.isFinite(bat.net) ? (bat.net >= 0 ? 'discharging' : 'charging') : bat.net === undefined ? '' : 'no data';
  return `
    <div class="nr head" style="--tint: var(--sunny)"><span class="lbl wide">Recent records <span class="sm">last 6 months</span></span><span></span></div>
    ${rows.join('')}
    <div class="nr head" style="--tint: var(--s3)"><span class="lbl">Batteries <span class="sm">${state}</span></span><span></span>${num(net)}<span></span></div>
    <div class="nr" style="--tint: var(--s3)"><span class="lbl">${info('Discharging')}Discharging</span><span class="num">${pc(bat.dis)}</span>${num(fmtGw(bat.dis))}${sparkTile(bat.disSeries, '--s3')}</div>
    <div class="nr" style="--tint: var(--s1)"><span class="lbl">${info('Charging')}Charging</span><span class="num">${pc(bat.chg)}</span>${num(Number.isFinite(bat.chg) ? `−${fmtGw(Math.abs(bat.chg))}` : '—')}${sparkTile(bat.chgSeries?.map((v) => -v), '--s1')}</div>
    <div class="nr" style="--tint: var(--s2)"><span class="lbl">${info('Metered net')}Metered net</span><span class="sm">${bat.meteredMs ? shortDay(bat.meteredMs) : ''}</span>${num(Number.isFinite(bat.metered) ? `${bat.metered < 0 ? '−' : ''}${fmtGw(Math.abs(bat.metered))}` : '—')}${sparkTile(bat.meteredSeries, '--s2')}</div>`;
}

function renderBatterySources(coverage) {
  $('battery-sources').innerHTML = [
    ['<span class="swatch" style="background:var(--s1)"></span>Elexon Physical Notifications', 'Each battery unit\'s planned output, summed. A plan, so it misses later balancing instructions.', 'Live', 'Yes'],
    ['<span class="swatch" style="background:var(--s2)"></span>Elexon B1610 metered output', 'What each battery unit actually exported or imported, from settlement meters.', 'About 5 days', 'Yes'],
    ['<span class="swatch" style="background:var(--s3)"></span>NESO generation mix "Other"', 'Battery net discharge mixed in with other small sources. NESO plans a separate battery figure.', 'About an hour', 'No'],
  ].map((r, k) => `<tr>${[...r, coverage[k]].map((v) => `<td>${v}</td>`).join('')}</tr>`).join('');
}

// Hovering a row or a donut segment highlights its partners and shows its
// figures in the middle of the donut; "?" buttons and record rows show a tip.
let nowFigures = {};
function setupNowHover() {
  const panel = document.querySelector('.now-panel');
  const tip = document.createElement('div');
  tip.className = 'now-tip';
  tip.hidden = true;
  panel.append(tip);
  const showTip = (el) => {
    const text = el?.dataset.tip;
    if (!text) { tip.hidden = true; return; }
    tip.textContent = text;
    tip.hidden = false;
    const p = panel.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(0, r.left - p.left + r.width / 2 - tip.offsetWidth / 2), p.width - tip.offsetWidth);
    tip.style.left = `${left}px`;
    tip.style.top = `${r.bottom - p.top + 6}px`;
  };
  const highlight = (key) => {
    panel.classList.toggle('hovering', !!key);
    for (const el of panel.querySelectorAll('[data-key]')) {
      el.classList.toggle('hl', !!key && (el.dataset.key === key || el.dataset.group === key));
    }
    const label = panel.querySelector('.donut-label');
    const value = panel.querySelector('.donut-value');
    const sub = panel.querySelector('.donut-sub');
    if (!label || !nowFigures.total) return;
    const f = key && nowFigures[key];
    label.textContent = f ? key : 'Generation';
    value.textContent = `${((f ? f.now : nowFigures.total) / 1000).toFixed(2)} GW`;
    sub.textContent = f ? `${((f.now / nowFigures.total) * 100).toFixed(1)}% of generation` : '';
  };
  const over = (e) => {
    highlight(e.target.closest('[data-key]')?.dataset.key);
    showTip(e.target.closest('[data-tip]'));
  };
  panel.addEventListener('mouseover', over);
  panel.addEventListener('focusin', over);
  panel.addEventListener('click', (e) => { if (e.target.closest('.info')) showTip(e.target.closest('.info')); });
  panel.addEventListener('mouseleave', () => { highlight(null); tip.hidden = true; });
  panel.addEventListener('focusout', (e) => { if (!panel.contains(e.relatedTarget)) { highlight(null); tip.hidden = true; } });
}

// Like Kate's site, the tab icon is a pie of the current generation mix.
function liveFavicon(groups, total) {
  const c = 32;
  const r = 29;
  let a = 0;
  let slices = '';
  for (const g of groups) {
    for (const f of g.fuels) {
      const span = (f.now / total) * Math.PI * 2;
      if (!(span > 0)) continue;
      const p = (t) => `${(c + r * Math.sin(t)).toFixed(2)},${(c - r * Math.cos(t)).toFixed(2)}`;
      slices += span >= Math.PI * 2 - 1e-6
        ? `<circle cx="${c}" cy="${c}" r="${r}" fill="${css(f.color)}"/>`
        : `<path d="M${c},${c}L${p(a)}A${r},${r} 0 ${span > Math.PI ? 1 : 0} 1 ${p(a + span)}Z" fill="${css(f.color)}"/>`;
      a += span;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${slices}<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${css('--line')}" stroke-width="4"/></svg>`;
  document.querySelector('link[rel="icon"]').href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function renderNow() {
  const c = data.columns;
  const i = lastComplete(data, ['gas', 'wind']);
  const from = Math.max(0, i - 47);
  const groups = NOW_GROUPS.map((g) => {
    const fuels = g.fuels.map((f) => {
      const at = (k) => f.cols.reduce((sum, col) => sum + (c[col]?.[k] ?? 0), 0);
      const series = [];
      for (let k = from; k <= i; k++) series.push(at(k));
      return { ...f, value: at(i), now: Math.max(0, at(i)), series };
    });
    return { ...g, fuels, now: fuels.reduce((s, f) => s + f.now, 0) };
  });
  const total = groups.reduce((s, g) => s + g.now, 0);
  const pnI = data.meta.lastSlot.pn_dis;
  const bat = { net: NaN };
  if (pnI != null) {
    const past = (col) => Array.from({ length: 48 }, (_, k) => c[col][pnI - 47 + k]);
    Object.assign(bat, { dis: c.pn_dis[pnI], chg: c.pn_chg[pnI], net: c.pn_dis[pnI] + c.pn_chg[pnI], disSeries: past('pn_dis'), chgSeries: past('pn_chg') });
  }
  const mI = data.meta.lastSlot.b1610_dis;
  if (mI != null && c.b1610_dis) {
    const net = (k) => c.b1610_dis[k] + c.b1610_chg[k];
    Object.assign(bat, { metered: net(mI), meteredMs: slotTime(mI, data.startMs), meteredSeries: Array.from({ length: 48 }, (_, k) => net(mI - 47 + k)) });
  }
  nowFigures = { total };
  for (const g of groups) {
    nowFigures[g.label] = g;
    for (const f of g.fuels) nowFigures[f.label] = f;
  }
  $('now-groups').innerHTML = nowLeftHtml(groups, total);
  $('now-donut').innerHTML = donut(groups, total);
  liveFavicon(groups, total);
  $('now-right').innerHTML = nowRightHtml(recentRecords(data, { batterySource: state.battery, limit: NOW_RECORD_ROWS }), bat, total);
  $('updated').textContent = `Generation data to ${fmtDateTime(slotTime(i, data.startMs))} (UK time). Updated every 30 minutes.`;
}

// One headline figure set large, with the other highlights as a list beside it.
function factsHtml(big, sub, rest) {
  return `<div class="headline"><div class="big">${big}</div><div class="sub">${sub}</div></div>
    <ul class="fact-list">${rest.map(([c, label, v, when]) => `<li><span class="swatch" style="background:var(${c})"></span><span><b>${label}</b> <span class="v">${v}</span> <span class="sub">${when}</span></span></li>`).join('')}</ul>`;
}

// Longest spells with gas and coal below each level (GW).
function spellRecords(levels) {
  const fossil = metricSeries(data, FOSSIL, { batterySource: 'none' });
  return levels.map((gw) => summarise(fossil, gw, 'below', { startMs: data.startMs, maxGap: 2 }).record);
}

// Battery discharge (Elexon PN) as daily means from its first full year, with
// a rolling-year envelope and the biggest half hour of each year.
function batteryGrowth() {
  const dis = data.columns.pn_dis;
  const first = dis.findIndex((v) => v > 0);
  if (first < 0) return null;
  const year = (i) => new Date(slotTime(i, data.startMs)).getUTCFullYear();
  const peaks = new Map();
  for (let i = first; i < data.length; i++) if (dis[i] > (peaks.get(year(i)) ?? 0)) peaks.set(year(i), dis[i]);
  let recent = 0;
  for (let i = Math.max(first, data.length - 365 * 48); i < data.length; i++) if (dis[i] > recent) recent = dis[i];
  const startMs = Date.UTC(year(first), 0, 1);
  const raw = windowPoints(metricSeries(data, ['battery'], { batterySource: 'pn' }), 'all').filter(([t]) => t >= startMs);
  return { raw, env: envelopes(raw.map(([, v]) => v), 365), firstYear: year(first) + 1, peaks, recent };
}

function renderBatteryStory() {
  const b = story.battery;
  if (!b) return;
  const gw = (mw) => `${(mw / 1000).toFixed(1)} GW`;
  // The first year with data is usually partial, so compare from the year after.
  const then = b.peaks.get(b.firstYear);
  if (then) $('battery-take').textContent = `The most batteries gave in any half hour went from ${gw(then)} in ${b.firstYear} to ${gw(b.recent)} in the past year.`;
  lineChart($('story-battery'), {
    ...envelopeLayers(b.raw, b.env, 'Battery discharge (daily mean)'),
    yLog: true,
    yMin: 0.01,
    yTicks: [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
    yFormat: (v) => `${v.toFixed(2)} GW`,
    yTickFormat: (v) => `${v}`,
    tooltip: (t, vals) => `<strong>${fmtDate(t)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? `${v.value.toFixed(2)} GW` : '—'}</b></div>`).join('')}`,
  });
}

let story = null;
function renderStory() {
  if (!story) {
    story = {
      mix: yearlyMix(data),
      cross: monthlyShares(data, { fossil: FOSSIL, low: LOW_CARBON }),
      hours: yearlyHoursBelow(data, FOSSIL, [10000, 5000, 1000]),
      facts: facts(data),
      spells: spellRecords([1, 2, 5]),
      battery: batteryGrowth(),
    };
  }
  const f = story.facts;
  const at = (i) => fmtDate(slotTime(i, data.startMs));
  const days = Math.floor((data.length - 1 - f.lastCoal) / 48);
  // Lead with how long the grid can run on almost no fossil fuel; coal is done.
  const spellText = (r) => (r ? formatDuration(r.end - r.start) : 'Never');
  const from = (r) => (r ? `from ${at(r.start)}` : 'not yet');
  const [r1, r2, r5] = story.spells;
  const past = story.hours[story.hours.length - 1].hours;
  $('facts').innerHTML = factsHtml(spellText(r1), `with gas and coal under 1 GW, ${from(r1)}. The longest Britain has run on almost no fossil fuel.`, [
    ['--fossil', 'Under 2 GW of fossil fuel', spellText(r2), from(r2)],
    ['--fossil', 'Under 5 GW of fossil fuel', spellText(r5), from(r5)],
    ['--lowcarbon', 'Hours under 5 GW', `${Math.round(past[1]).toLocaleString('en-GB')} h`, 'in the past 365 days'],
    ['--f-coal', 'Without coal', `${days.toLocaleString('en-GB')} days`, `since the last coal station closed on ${at(f.lastCoal)}`],
    ['--lowcarbon', 'Greenest half hour', `${f.green.v.toFixed(1)}%`, `low carbon, ${at(f.green.i)}`],
  ]);

  const yearLabel = (y) => (y === 'past365' ? '365d' : String(y));
  const yearTitle = (y) => (y === 'past365' ? 'Past 365 days' : String(y));
  const pc = (v) => `${v.toFixed(v < 10 ? 1 : 0)}%`;
  const mix = story.mix;
  const stacks = MIX.map((m) => ({ name: m.label, color: css(`--f-${m.key}`), values: mix.map((r) => r.shares[m.key]) }));
  barChart($('story-mix'), {
    cats: mix.map((r) => yearLabel(r.year)),
    stacks,
    yMax: 100,
    yFormat: pc,
    yTickFormat: (v) => `${v}%`,
    highlight: (ci) => mix[ci].year === 'past365',
    tooltip: (ci) => `<strong>${yearTitle(mix[ci].year)}</strong>${[...stacks].reverse().map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${pc(s.values[ci])}</b></div>`).join('')}`,
  });
  $('story-mix-legend').innerHTML = [...stacks].reverse().map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('');

  const cross = [
    { name: 'Low carbon', color: css('--lowcarbon'), points: story.cross.low },
    { name: 'Fossil fuels', color: css('--fossil'), points: story.cross.fossil },
  ];
  lineChart($('story-cross'), {
    series: cross,
    yMin: 0,
    yFormat: pc,
    yTickFormat: (v) => `${v}%`,
    tooltip: (t, vals) => `<strong>${new Date(t).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? pc(v.value) : '—'}</b></div>`).join('')}`,
  });
  $('story-cross-legend').innerHTML = cross.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('');

  const hrs = story.hours;
  const hourStacks = [
    { name: 'Under 1 GW', color: css('--h7'), values: hrs.map((r) => r.hours[2]) },
    { name: '1 to 5 GW', color: css('--lowcarbon'), values: hrs.map((r) => r.hours[1] - r.hours[2]) },
    { name: '5 to 10 GW', color: css('--h2'), values: hrs.map((r) => r.hours[0] - r.hours[1]) },
  ];
  const fmtH = (v) => `${Math.round(v).toLocaleString('en-GB')} h`;
  barChart($('story-hours'), {
    cats: hrs.map((r) => yearLabel(r.year)),
    stacks: hourStacks,
    yFormat: fmtH,
    yTickFormat: (v) => v.toLocaleString('en-GB'),
    highlight: (ci) => hrs[ci].year === 'past365',
    // Under 1 GW is too rare to see as a bar yet, so flag it with a star.
    badge: (ci) => (hrs[ci].hours[2] > 0 ? `★ ${fmtH(hrs[ci].hours[2])}` : null),
    tooltip: (ci) => `<strong>${yearTitle(hrs[ci].year)}</strong><div>Under 10 GW: <b>${fmtH(hrs[ci].hours[0])}</b> (${((hrs[ci].hours[0] / 8760) * 100).toFixed(0)}% of the year)</div><div>Under 5 GW: <b>${fmtH(hrs[ci].hours[1])}</b></div><div>Under 1 GW: <b>${fmtH(hrs[ci].hours[2])}</b></div>`,
  });
  $('story-hours-legend').innerHTML = hourStacks.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('') + '<span>★ hours under 1 GW</span>';
  renderBatteryStory();
}

/**
 * Fills the page with stand-ins the same size as what the data will put there,
 * so nothing jumps down the page when it arrives. Hidden sample text (a date,
 * a duration) makes a line wrap the way the real text will. Charts reserve
 * their height in CSS, until they are drawn.
 */
function renderPlaceholders() {
  const sample = (text) => `<span style="visibility: hidden">${text}</span>`;
  const date = fmtDate(Date.now());
  $('now-groups').innerHTML = nowLeftHtml(NOW_GROUPS.map((g) => ({ ...g, now: NaN, fuels: g.fuels.map((f) => ({ ...f, value: NaN, now: NaN })) })), 0);
  // An empty ring in place of the donut, the same size as the real one.
  const ring = NOW_GROUPS.map((g) => ({ ...g, color: '--cell-empty', fuels: g.fuels.map((f) => ({ ...f, color: '--cell-empty', now: 1 })) }));
  $('now-donut').innerHTML = donut(ring, ring.reduce((s, g) => s + g.fuels.length, 0)).replace(/>[\d.]+ GW</, '>— GW<');
  $('now-right').innerHTML = nowRightHtml(null, {}, 0);
  $('facts').innerHTML = factsHtml('—', sample(`with gas and coal under 1 GW, from ${date}. The longest Britain has run on almost no fossil fuel.`), [
    ['--fossil', 'Under 2 GW of fossil fuel', '—', sample(`from ${date}`)],
    ['--fossil', 'Under 5 GW of fossil fuel', '—', sample(`from ${date}`)],
    ['--lowcarbon', 'Hours under 5 GW', '—', sample('in the past 365 days')],
    ['--f-coal', 'Without coal', '—', sample(`since the last coal station closed on ${date}`)],
    ['--lowcarbon', 'Greenest half hour', '—', sample(`low carbon, ${date}`)],
  ]);
  renderQuestion();
  const cell = `<td class="big">—<span class="when">${sample(date)}</span></td>`;
  $('records-table').innerHTML = `<thead><tr><th>Threshold</th><th>Longest spell</th><th>Current spell</th><th>Share of past 365 days</th><th>Spells</th></tr></thead><tbody>${orderedThresholds().map((t) => `<tr><td><span class="swatch"></span><b>${thresholdLabel(t).replace('<', '&lt;')}</b></td>${cell}${cell}<td class="big">—</td><td>—</td></tr>`).join('')}</tbody>`;
  $('by-year-legend').innerHTML = SPELL_BANDS.map((b) => `<span><span class="swatch" style="background:${b.color}"></span>${b.label}</span>`).join('');
  const dt = fmtDateTime(Date.now());
  renderBatterySources([sample(`${date} to ${dt}`), sample(`${date} to ${dt}`), sample(`2009 to ${dt}`)]);
  // The heatmap is 28px a row plus its axis.
  $('by-year').style.setProperty('--placeholder-height', `${34 + 28 * state.thresholds.length}px`);
}

async function main() {
  // Before readHash, so a link that arrived with settings is still visible.
  startAnalytics();
  readHash();
  setupControls();
  syncControls();
  renderPlaceholders();
  setupNowHover();
  try {
    data = await loadData();
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  renderNow();
  renderStory();
  update();
  // Sizing the solar farm takes a moment, so let the rest of the page paint first.
  setTimeout(() => renderSolar(data), 0);
  $('origin-toggle').addEventListener('click', () => {
    const body = $('origin-body');
    body.hidden = !body.hidden;
    $('origin-toggle').setAttribute('aria-expanded', !body.hidden);
    $('origin-toggle').textContent = body.hidden ? 'Work it out' : 'Hide';
    if (!body.hidden) renderBatteryOrigins(data);
  });
}

main();
