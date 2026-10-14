import { loadData, metricSeries, FUELS, BATTERY_SOURCES, lastComplete, generationTotal } from './data.js';
import { summarise, formatDuration, slotTime, STEP_MINUTES, meets } from './records.js';
import { lineChart, heatmap, barChart, fmtDate, fmtDateTime } from './charts.js';
import { recentRecords } from './recent.js';
import { MIX, FOSSIL, LOW_CARBON, yearlyMix, monthlyShares, yearlyHoursBelow, facts } from './story.js';
import { renderBatteryOrigins } from './origins.js';

const PRESETS = {
  fossil: { label: 'Fossil fuels', members: ['gas', 'coal'], mode: 'below', gw: [20, 10, 5, 2, 1, 0.5, 0.1, 0], pct: [50, 30, 20, 10, 5, 2, 1, 0] },
  lowcarbon: { label: 'Low carbon', members: ['wind', 'solar', 'nuclear', 'hydro', 'storage', 'battery'], mode: 'above', gw: [1, 2, 5, 10, 15, 20, 25, 30], pct: [10, 20, 30, 50, 70, 80, 90, 95], editable: true },
  renewables: { label: 'Renewables', members: ['wind', 'solar', 'hydro', 'biomass'], mode: 'above', gw: [1, 2, 5, 10, 15, 20, 25, 30], pct: [10, 20, 30, 50, 60, 70, 80, 90], editable: true },
  gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [10, 5, 2, 1, 0.5, 0.1, 0], pct: [30, 20, 10, 5, 1, 0] },
  coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [5, 1, 0.5, 0.1, 0], pct: [20, 10, 5, 1, 0] },
  wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [5, 10, 15, 20, 25], pct: [25, 40, 50, 60, 70] },
  solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [2, 5, 10, 15], pct: [10, 20, 30, 40] },
  nuclear: { label: 'Nuclear', members: ['nuclear'], mode: 'below', gw: [6, 5, 4, 3], pct: [20, 15, 10, 5] },
  imports: { label: 'Imports', members: ['imports'], mode: 'above', gw: [2, 5, 8, 10], pct: [10, 15, 20, 25] },
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
  range: '30',
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
    resize = setTimeout(() => { renderStory(); update(); if (!$('origin-body').hidden) renderBatteryOrigins(data); }, 150);
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

function update() {
  syncControls();
  writeHash();
  const values = currentSeries();
  const thresholds = orderedThresholds();
  const summaries = thresholds.map((t) => summarise(values, t, state.mode, { startMs: data.startMs, maxGap: 2 }));
  const verb = state.mode === 'below' ? 'below' : 'at or above';
  const what = state.unit === 'pct' ? `${groupName()} as a share of generation` : groupName();
  $('question').textContent = `What is the longest the grid has run with ${what} ${verb} each threshold?`;
  renderTable(summaries);
  renderProgression(summaries);
  renderByYear(summaries);
  renderTimeline(values);
  renderBattery();
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
    const cur = c ? `<td class="big">${formatDuration(c.end - c.start)}${ongoing ? '<span class="live record-live" title="The current spell is the longest ever">🏆 Record, live</span>' : '<span class="live">Live</span>'}<span class="when">since ${fmtDateTime(slotTime(c.start, data.startMs))}</span></td>` : '<td>—</td>';
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

function renderProgression(summaries) {
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
  lineChart($('progression'), {
    series,
    yLog: true,
    yMin: 0.5,
    xMin: data.startMs,
    xMax: now,
    stepLookup: true,
    yFormat: (h) => formatDuration(Math.round((h * 60) / STEP_MINUTES)),
    yTickFormat: (h) => (h >= 8760 ? `${+(h / 8760).toFixed(0)}y` : h >= 48 ? `${+(h / 24).toFixed(0)}d` : `${h}h`),
    yTicks: [0.5, 1, 3, 6, 12, 24, 72, 168, 720, 2160, 8760, 17520, 43800],
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
    format: formatDuration,
    title: (r, c, v) => {
      const sp = values[summaries.findIndex((s) => thresholdLabel(s.threshold) === r)][years.indexOf(Number(c))];
      const whole = sp?.spell;
      const clipped = whole && (whole.start !== sp.start || whole.end !== sp.end);
      return sp ? `<strong>${c}, ${r}</strong><div>Longest in ${c}: <b>${formatDuration(v)}</b></div><div>${fmtDateTime(slotTime(sp.start, data.startMs))} to ${fmtDateTime(slotTime(sp.end, data.startMs))}</div>${clipped ? `<div class="when">Part of a ${formatDuration(whole.end - whole.start)} spell from ${fmtDate(slotTime(whole.start, data.startMs))} to ${fmtDate(slotTime(whole.end, data.startMs))}</div>` : ''}`
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

function renderTimeline(values) {
  const thresholds = orderedThresholds();
  const end = lastComplete(data, ['gas']) + 1;
  const daily = state.range === 'all' || Number(state.range) > 60;
  lineChart($('timeline'), {
    series: [{ name: `${groupName()}${daily ? ' (daily mean)' : ''}`, color: css('--s2'), points: windowPoints(values, state.range, end) }],
    refLines: thresholds.map((t, i) => ({ value: t, color: thresholdColor(i, thresholds.length) })),
    yLog: state.scale === 'log',
    yMin: state.scale === 'log' ? (state.unit === 'pct' ? 0.5 : 0.05) : undefined,
    yTicks: state.scale === 'log' ? [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] : undefined,
    yFormat: fmtValue,
    yTickFormat: (v) => `${v}${state.unit === 'pct' ? '%' : ''}`,
    tooltip: daily ? (t, vals) => `<strong>${fmtDate(t)}</strong><div>Daily mean: <b>${Number.isFinite(vals[0].value) ? fmtValue(vals[0].value) : '—'}</b></div>` : undefined,
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
  $('battery-sources').innerHTML = [
    ['<span class="swatch" style="background:var(--s1)"></span>Elexon Physical Notifications', 'Each battery unit\'s planned output, summed. A plan, so it misses later balancing instructions.', 'Live', 'Yes', `${first('pn')} to ${last('pn_dis')}${backfill('pn')}`],
    ['<span class="swatch" style="background:var(--s2)"></span>Elexon B1610 metered output', 'What each battery unit actually exported or imported, from settlement meters.', 'About 5 days', 'Yes', `${first('b1610')} to ${last('b1610_dis')}${backfill('b1610')}`],
    ['<span class="swatch" style="background:var(--s3)"></span>NESO generation mix "Other"', 'Battery net discharge mixed in with other small sources. NESO plans a separate battery figure.', 'About an hour', 'No', `2009 to ${last('other')}`],
  ].map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('');
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
    { label: 'Biomass', cols: ['biomass'], color: '--f-biomass' },
  ] },
  { label: 'Other sources', color: '--f-nuclear', fuels: [
    { label: 'Nuclear', cols: ['nuclear'], color: '--f-nuclear' },
    { label: 'Imports', cols: ['imports'], color: '--f-imports' },
    { label: 'Pumped storage', cols: ['storage'], color: '--f-hydro-2' },
    { label: 'Other', cols: ['other'], color: '--f-other' },
  ] },
];

function sparkline(values, color) {
  const fin = values.filter(Number.isFinite);
  if (fin.length < 2) return '<svg class="spark"></svg>';
  const lo = Math.min(0, ...fin);
  const hi = Math.max(...fin, lo + 1);
  const pts = values.map((v, k) => (Number.isFinite(v) ? `${((k / (values.length - 1)) * 48).toFixed(1)},${(18 - ((v - lo) / (hi - lo)) * 16).toFixed(1)}` : null)).filter(Boolean).join(' ');
  return `<svg class="spark" viewBox="0 0 48 20" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
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
      if (span > 0) outer += `<path d="${arc(102, 128, a, a + span)}" fill="${css(f.color)}"><title>${f.label}: ${(f.now / 1000).toFixed(2)} GW</title></path>`;
      a += span;
    }
    if (a > ga) inner += `<path d="${arc(72, 100, ga, a)}" fill="${css(g.color)}"><title>${g.label}: ${(g.now / 1000).toFixed(2)} GW</title></path>`;
  }
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Current generation mix">${outer}${inner}
    <text x="${c}" y="${c - 6}" text-anchor="middle" class="donut-label">Generation</text>
    <text x="${c}" y="${c + 20}" text-anchor="middle" class="donut-value">${(total / 1000).toFixed(1)} GW</text></svg>`;
}

function recordLine(r) {
  const gw = (v) => `${+v.toFixed(v < 1 ? 1 : 0)} GW`;
  if (r.kind === 'peak') {
    const v = r.unit === 'pct' ? `${r.value.toFixed(1)}%` : `${r.value.toFixed(r.value < 1 ? 2 : 1)} GW`;
    return `<li><span class="rec-what">${r.label} ever</span><span class="rec-value">${v}</span><span class="rec-when">${fmtDateTime(r.startMs)}</span></li>`;
  }
  const what = `${r.label} ${r.mode === 'below' ? 'under' : 'at or above'} ${gw(r.threshold)}`;
  const when = r.live ? `since ${fmtDate(r.startMs)}` : `${fmtDate(r.startMs)} to ${fmtDate(r.endMs)}`;
  return `<li${r.live ? ' class="is-live"' : ''}><span class="rec-what">${what}</span><span class="rec-value">${shortDuration(r.slots)}${r.live ? ' <span class="live record-live">🏆 Live</span>' : ''}</span><span class="rec-when">Longest ever, ${when}</span></li>`;
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
  const gw = (v) => `${(v / 1000).toFixed(2)}`;
  const pc = (v) => `${((v / total) * 100).toFixed(1)}%`;
  const pnI = data.meta.lastSlot.pn_dis;
  const bat = pnI != null ? c.pn_dis[pnI] + c.pn_chg[pnI] : NaN;
  $('now-groups').innerHTML = groups.map((g) => `
    <div class="now-group" style="--tint: var(${g.color})">
      <div class="now-row now-head"><span></span><span class="num">${gw(g.now)}<small>GW</small></span><span class="num">${pc(g.now)}</span><span>${g.label}</span></div>
      ${g.fuels.map((f) => `<div class="now-row">${sparkline(f.series, css(f.color))}<span class="num">${gw(f.value)}<small>GW</small></span><span class="num">${pc(f.now)}</span><span><span class="swatch" style="background:var(${f.color})"></span>${f.label}</span></div>`).join('')}
    </div>`).join('') + `
    <div class="now-row now-battery"><span></span><span class="num">${Number.isFinite(bat) ? `${bat >= 0 ? '+' : '−'}${Math.abs(bat / 1000).toFixed(2)}` : '—'}<small>GW</small></span><span></span><span>Batteries, ${Number.isFinite(bat) ? (bat >= 0 ? 'discharging' : 'charging') : 'no data'} <small>(planned, inside Other)</small></span></div>`;
  $('now-donut').innerHTML = donut(groups, total);
  const recs = recentRecords(data, { batterySource: state.battery });
  $('now-records').innerHTML = recs.length ? recs.map(recordLine).join('') : '<li class="rec-none">No new records in the last six months.</li>';
  $('updated').textContent = `Generation data to ${fmtDateTime(slotTime(i, data.startMs))} (UK time). Updated every 30 minutes.`;
}

let story = null;
function renderStory() {
  if (!story) {
    story = {
      mix: yearlyMix(data),
      cross: monthlyShares(data, { fossil: FOSSIL, low: LOW_CARBON }),
      hours: yearlyHoursBelow(data, FOSSIL, [10000, 5000, 1000]),
      facts: facts(data),
    };
  }
  const f = story.facts;
  const at = (i) => fmtDate(slotTime(i, data.startMs));
  const days = Math.floor((data.length - 1 - f.lastCoal) / 48);
  const cards = [
    ['--f-coal', '🪨', 'Coal free', `${days.toLocaleString('en-GB')} days`, `since the last coal station closed on ${at(f.lastCoal)}`],
    ['--lowcarbon', '🌍', 'Greenest half hour', `${f.green.v.toFixed(1)}%`, `low carbon on ${at(f.green.i)}`],
    ['--f-wind', '🌬️', 'Windiest half hour', `${(f.wind.v / 1000).toFixed(1)} GW`, `from wind on ${at(f.wind.i)}`],
    ['--f-solar', '☀️', 'Sunniest half hour', `${(f.solar.v / 1000).toFixed(1)} GW`, `from solar on ${at(f.solar.i)}`],
    ['--fossil', '🔥', 'Least fossil fuel', `${(f.fossil.v / 1000).toFixed(2)} GW`, `gas and coal on ${at(f.fossil.i)}`],
  ];
  $('facts').innerHTML = cards.map(([c, e, l, v, sub]) => `<div class="fact" style="--tint: color-mix(in srgb, var(${c}) 20%, #fff)"><div class="label"><span aria-hidden="true">${e}</span> ${l}</div><div class="big">${v}</div><div class="sub">${sub}</div></div>`).join('');

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
}

async function main() {
  readHash();
  setupControls();
  syncControls();
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
  $('origin-toggle').addEventListener('click', () => {
    const body = $('origin-body');
    body.hidden = !body.hidden;
    $('origin-toggle').setAttribute('aria-expanded', !body.hidden);
    $('origin-toggle').textContent = body.hidden ? 'Work it out' : 'Hide';
    if (!body.hidden) renderBatteryOrigins(data);
  });
}

main();
