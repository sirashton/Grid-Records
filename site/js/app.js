import { loadData, metricSeries, FUELS, BATTERY_SOURCES, lastComplete, generationTotal } from './data.js';
import { summarise, formatDuration, slotTime, STEP_MINUTES } from './records.js';
import { lineChart, heatmap, fmtDate, fmtDateTime } from './charts.js';

const PRESETS = {
  fossil: { label: 'Fossil fuels (gas and coal)', members: ['gas', 'coal'], mode: 'below', gw: [10, 5, 2, 1, 0.5], pct: [30, 20, 10, 5, 2] },
  lowcarbon: { label: 'Low carbon (wind, solar, nuclear, battery)', members: ['wind', 'solar', 'nuclear', 'battery'], mode: 'above', gw: [15, 20, 25, 30, 35], pct: [50, 70, 80, 90, 95], editable: true },
  gas: { label: 'Gas', members: ['gas'], mode: 'below', gw: [10, 5, 2, 1], pct: [30, 20, 10, 5] },
  coal: { label: 'Coal', members: ['coal'], mode: 'below', gw: [5, 1, 0.5, 0.1, 0.01], pct: [20, 10, 5, 1, 0.1] },
  wind: { label: 'Wind', members: ['wind'], mode: 'above', gw: [5, 10, 15, 20, 25], pct: [25, 40, 50, 60, 70] },
  solar: { label: 'Solar', members: ['solar'], mode: 'above', gw: [2, 5, 10, 15], pct: [10, 20, 30, 40] },
  nuclear: { label: 'Nuclear', members: ['nuclear'], mode: 'below', gw: [6, 5, 4, 3], pct: [20, 15, 10, 5] },
  imports: { label: 'Imports', members: ['imports'], mode: 'above', gw: [2, 5, 8, 10], pct: [10, 15, 20, 25] },
  custom: { label: 'Custom group…', members: ['wind', 'solar', 'nuclear', 'hydro', 'battery'], mode: 'above', gw: [10, 20, 30], pct: [50, 75, 90], editable: true },
};

const RAMP = ['--r1', '--r2', '--r3', '--r4', '--r5', '--r6'];
const HEAT = ['--h1', '--h2', '--h3', '--h4', '--h5', '--h6', '--h7'];
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
}

function writeHash() {
  const p = new URLSearchParams({ m: state.preset, d: state.mode, u: state.unit, t: state.thresholds.join(','), b: state.battery });
  if (PRESETS[state.preset].editable) p.set('g', state.members.join(','));
  history.replaceState(null, '', `#${p}`);
}

function parseThresholds(s) {
  return [...new Set(s.split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v) && v > 0))].slice(0, 6);
}

const unitLabel = () => (state.unit === 'gw' ? 'GW' : '%');
const fmtValue = (v) => (state.unit === 'gw' ? `${+v.toFixed(v < 1 ? 2 : 1)} GW` : `${+v.toFixed(v < 1 ? 1 : 0)}%`);
const fmtThreshold = (v) => (state.unit === 'gw' ? `${v} GW` : `${v}%`);

/** Thresholds ordered from easiest to hardest, so darker colours mean harder. */
function orderedThresholds() {
  const t = [...state.thresholds].sort((a, b) => a - b);
  return state.mode === 'below' ? t.reverse() : t;
}
const thresholdColor = (i, n) => css(RAMP[Math.round((i / Math.max(1, n - 1)) * (RAMP.length - 1)) + (n < 4 ? 1 : 0)] ?? RAMP.at(-1));

function setupControls() {
  const preset = $('preset');
  for (const [key, p] of Object.entries(PRESETS)) preset.add(new Option(p.label, key));
  preset.addEventListener('change', () => {
    state.preset = preset.value;
    const p = PRESETS[state.preset];
    state.mode = p.mode;
    state.members = [...p.members];
    state.thresholds = p[state.unit];
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
    resize = setTimeout(update, 150);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', update);
}

function syncControls() {
  $('preset').value = state.preset;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === state.mode));
  document.querySelectorAll('[data-unit]').forEach((b) => b.setAttribute('aria-checked', b.dataset.unit === state.unit));
  document.querySelectorAll('#range [data-range]').forEach((b) => b.setAttribute('aria-checked', b.dataset.range === state.range));
  document.querySelectorAll('#battery-range [data-range]').forEach((b) => b.setAttribute('aria-checked', b.dataset.range === state.batteryRange));
  $('thresholds').value = state.thresholds.join(', ');
  const members = $('members');
  members.hidden = !PRESETS[state.preset].editable;
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
    const longest = r ? `<td class="big">${formatDuration(r.end - r.start)}<span class="when">${fmtDateTime(slotTime(r.start, data.startMs))} to ${fmtDateTime(slotTime(r.end, data.startMs))}</span></td>` : '<td>Never</td>';
    const c = s.current;
    const cur = c ? `<td class="big">${formatDuration(c.end - c.start)}<span class="live">Live</span><span class="when">since ${fmtDateTime(slotTime(c.start, data.startMs))}</span></td>` : '<td>—</td>';
    const lastYear = qualifyingSince(s.threshold, lastSlot - yearSlots);
    return `<tr><td><span class="swatch" style="background:${thresholdColor(i, n)}"></span><b>${state.mode === 'below' ? '&lt;' : '≥'} ${fmtThreshold(s.threshold)}</b></td>${longest}${cur}
      <td>${pct(s.totalSlots, nonMissing())}<span class="when">${pct(lastYear, yearSlots)} in the past year</span></td><td>${s.count.toLocaleString('en-GB')}</td></tr>`;
  });
  $('records-table').innerHTML = `<thead><tr><th>Threshold</th><th>Longest spell</th><th>Current spell</th><th>Share of all time</th><th>Spells</th></tr></thead><tbody>${rows.join('')}</tbody>`;
}

// Half hours since a slot that meet the threshold.
function qualifyingSince(threshold, fromSlot) {
  const values = currentSeries();
  let n = 0;
  for (let i = Math.max(0, Math.floor(fromSlot)); i < values.length; i++) {
    const v = values[i];
    if (!Number.isNaN(v) && (state.mode === 'below' ? v < threshold : v >= threshold)) n++;
  }
  return n;
}

let nonMissingCache = null;
function nonMissing() {
  if (nonMissingCache?.v === seriesCache.key) return nonMissingCache.n;
  let n = 0;
  for (const v of currentSeries()) if (!Number.isNaN(v)) n++;
  nonMissingCache = { v: seriesCache.key, n };
  return n;
}
const pct = (a, b) => `${b ? ((a / b) * 100).toFixed(a / b < 0.01 ? 2 : 1) : 0}%`;

function renderProgression(summaries) {
  const n = summaries.length;
  const now = slotTime(data.length, data.startMs);
  const series = summaries.map((s, i) => ({
    name: `${state.mode === 'below' ? '<' : '≥'} ${fmtThreshold(s.threshold)}`,
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
    yTickFormat: (h) => (h >= 48 ? `${+(h / 24).toFixed(0)}d` : `${h}h`),
    yTicks: [0.5, 1, 3, 6, 12, 24, 72, 168, 720, 2160, 8760],
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
  heatmap($('by-year'), {
    rows: summaries.map((s) => `${state.mode === 'below' ? '<' : '≥'} ${fmtThreshold(s.threshold)}`),
    cols: years.map(String),
    values: values.map((r) => r.map((sp) => (sp ? sp.end - sp.start : null))),
    ramp: HEAT.map(css),
    log: true,
    format: formatDuration,
    title: (r, c, v) => {
      const sp = values[summaries.findIndex((s) => `${state.mode === 'below' ? '<' : '≥'} ${fmtThreshold(s.threshold)}` === r)][years.indexOf(Number(c))];
      return sp ? `<strong>${c}, ${r}</strong><div>Longest: <b>${formatDuration(v)}</b></div><div>${fmtDateTime(slotTime(sp.start, data.startMs))} to ${fmtDateTime(slotTime(sp.end, data.startMs))}</div>`
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

function renderNow() {
  const c = data.columns;
  const i = lastComplete(data, ['gas', 'wind']);
  const gw = (v) => `${(v / 1000).toFixed(1)} GW`;
  const total = generationTotal(data)[i];
  const fossil = c.gas[i] + c.coal[i];
  const low = c.wind[i] + c.wind_emb[i] + c.solar[i] + c.nuclear[i] + c.hydro[i];
  const pnI = data.meta.lastSlot.pn_dis;
  const bat = pnI != null ? c.pn_dis[pnI] + c.pn_chg[pnI] : NaN;
  const fossilRecord = summarise(metricSeries(data, ['gas', 'coal']), 5, 'below', { startMs: data.startMs, maxGap: 2 });
  const tiles = [
    ['Fossil fuels', gw(fossil), `${((fossil / total) * 100).toFixed(0)}% of generation`],
    ['Low carbon', `${((low / total) * 100).toFixed(0)}%`, 'wind, solar, nuclear, hydro'],
    ['Wind', gw(c.wind[i] + c.wind_emb[i]), `${((((c.wind[i] + c.wind_emb[i]) / total) * 100)).toFixed(0)}%`],
    ['Solar', gw(c.solar[i]), `${((c.solar[i] / total) * 100).toFixed(0)}%`],
    ['Nuclear', gw(c.nuclear[i]), `${((c.nuclear[i] / total) * 100).toFixed(0)}%`],
    ['Batteries', Number.isFinite(bat) ? `${bat >= 0 ? '+' : '−'}${Math.abs(bat / 1000).toFixed(2)} GW` : '—', Number.isFinite(bat) ? (bat >= 0 ? 'net discharging (planned)' : 'net charging (planned)') : 'no data yet'],
    ['Fossil under 5 GW', fossilRecord.current ? formatDuration(fossilRecord.current.end - fossilRecord.current.start) : 'Not now', fossilRecord.current ? 'current spell' : `record ${formatDuration(fossilRecord.record.end - fossilRecord.record.start)}`],
  ];
  $('now').innerHTML = tiles.map(([l, v, s]) => `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join('');
  $('updated').textContent = `Generation data to ${fmtDateTime(slotTime(i, data.startMs))} (UK time). Updated every 30 minutes.`;
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
  update();
}

main();
