// The New Zealand page: the latest month, the records tool and the story.
// The records tool works as on the GB page, on NZ's fuels and thresholds.
import { loadData } from '../data.js';
import { summarise, formatDuration, slotTime, STEP_MINUTES, meets } from '../records.js';
import { lineChart, heatmap, barChart, niceTicks, fmtDate, fmtDateTime, setTimeZone } from '../charts.js';
import { envelopes, windowEnvelopes } from '../envelope.js';
import { FUELS, FOSSIL, RENEWABLE, metricSeries, yearlyEnergy, yearlyHoursBelow, recentMix } from './data.js';

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

function renderByYear(summaries) {
  const y0 = new Date(data.startMs).getUTCFullYear();
  const y1 = new Date(slotTime(end - 1, data.startMs)).getUTCFullYear();
  const years = [];
  for (let y = y0; y <= y1; y++) years.push(y);
  const values = summaries.map((s) => {
    const map = new Map(s.perYear);
    return years.map((y) => map.get(y) ?? null);
  });
  const full = (sp, y) => !!sp && sp.end - sp.start >= (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / (STEP_MINUTES * 60000);
  $('by-year-legend').innerHTML = SPELL_BANDS.map((b) => `<span><span class="swatch" style="background:${b.color}"></span>${b.label}</span>`).join('');
  heatmap($('by-year'), {
    rows: summaries.map((s) => thresholdLabel(s.threshold)),
    cols: years.map(String),
    values: values.map((r) => r.map((sp) => (sp ? sp.end - sp.start : null))),
    color: (v) => bandFor(v).color,
    mark: (ri, ci) => full(values[ri][ci], years[ci]),
    format: formatDuration,
    title: (r, c, v) => {
      const sp = values[summaries.findIndex((s) => thresholdLabel(s.threshold) === r)][years.indexOf(Number(c))];
      return sp ? `<strong>${c}, ${r}</strong><div>Longest in ${c}: <b>${full(sp, +c) ? 'the whole year ✓' : formatDuration(v)}</b></div><div>${fmtDateTime(slotTime(sp.start, data.startMs))} to ${fmtDateTime(slotTime(sp.end, data.startMs))}</div>`
        : `<strong>${c}, ${r}</strong><div>No spells</div>`;
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

function renderLatest() {
  const m = recentMix(data, 30 * 48);
  const order = Object.keys(FUELS).filter((k) => m.means[k] >= 0.5).sort((a, b) => m.means[b] - m.means[a]);
  const share = (v) => `${((v / m.total) * 100).toFixed(1)}%`;
  $('latest').innerHTML = factsHtml(`${m.renewablePct.toFixed(1)}%`,
    `renewable, ${fmtDate(slotTime(m.start, data.startMs))} to ${fmtDate(slotTime(m.end - 1, data.startMs))}. Average grid generation ${mw(m.total)}.`,
    order.map((k) => [FUELS[k].color, FUELS[k].label, mw(m.means[k]), k === 'battery' ? 'discharge' : share(m.means[k])]));
}

let story = null;
function renderStory() {
  if (!story) {
    story = {
      energy: yearlyEnergy(data),
      hours: yearlyHoursBelow(data, FOSSIL, [500, 250, 100]),
      spells: [0.1, 0.25, 0.5].map((gw) => summarise(metricSeries(data, FOSSIL).subarray(0, end), gw, 'below', { startMs: data.startMs, maxGap: 2 }).record),
    };
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
  readHash();
  setupControls();
  syncControls();
  renderQuestion();
  try {
    data = await loadData('../data/nz');
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  end = data.length;
  while (end > 0 && Number.isNaN(data.columns.hydro[end - 1])) end--;
  $('updated').textContent = `Data from ${fmtDate(data.startMs)} to ${fmtDateTime(slotTime(end - 1, data.startMs))}, NZ time. Each month arrives a few weeks after it ends.`;
  renderLatest();
  renderStory();
  update();
}

main();
