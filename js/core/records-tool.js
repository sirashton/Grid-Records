// The Records card, shared by every country page: pick a fuel or group and
// thresholds, then see the longest spells below or above each, how the
// records grew, the longest spell in each year and the measure over time.
//
// Everything country-specific comes from the country config (fuels, presets,
// time zone) and the dataset (its step). A page mounts it into an empty
// <section id="records"> before its data loads, so the card holds its place:
//
//   const records = createRecordsTool({ host: $('records'), country });
//   ...
//   records.setData(data);
//
// A page with its own controls that change the series (GB's battery source)
// passes `series` and `seriesKey`, and `hash` to keep its setting in the URL.

import { summarise, formatDuration, slotTime, meets } from '../records.js';
import { lineChart, heatmap, niceTicks, fmtDate, fmtDateTime } from '../charts.js';
import { envelopes, windowEnvelopes, envelopeLayers } from '../envelope.js';
import { metricSeries, windowPoints } from './dataset.js';
import { yearStart, localYear } from './calendar.js';

const RAMP = ['--r1', '--r2', '--r3', '--r4', '--r5', '--r6', '--r7', '--r8'];
const MAX_THRESHOLDS = RAMP.length;
const HOUR = 60;
const DAY = 1440;
// Duration bands for the per-year heatmap, roughly log-spaced, in minutes.
const SPELL_BANDS = [
  { max: 3 * HOUR, label: 'Under 3 hours', color: '#ffec8f' },
  { max: 12 * HOUR, label: '3 to 12 hours', color: '#ffc94a' },
  { max: DAY, label: '12 hours to a day', color: '#b9de6e' },
  { max: 3 * DAY, label: '1 to 3 days', color: '#64c587' },
  { max: 7 * DAY, label: '3 days to a week', color: '#25ad9f' },
  { max: 30 * DAY, label: '1 week to a month', color: '#2a90c8' },
  { max: 91.25 * DAY, label: '1 to 3 months', color: '#3a68d0' },
  { max: 182.5 * DAY, label: '3 to 6 months', color: '#5b48bd' },
  { max: Infinity, label: 'Over 6 months', color: '#3b2380' },
];
// How much each envelope spans, per time range, in days: a day of raw slots
// for a week, three days for a month, a fortnight of daily means for a year,
// and a year of them for all time.
const ENVELOPE_DAYS = { 7: 1, 30: 3, 365: 14, all: 365 };
const ENVELOPE_LABEL = { 7: '24-hour', 30: '3-day', 365: '14-day', all: '365-day' };
const STEP_NAMES = { 5: 'five-minute', 15: 'quarter-hour', 30: 'half-hour', 60: 'hourly' };

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pct = (a, b) => `${b ? ((a / b) * 100).toFixed(a / b < 0.01 ? 2 : 1) : 0}%`;

const MARKUP = `
  <h2 id="records-h">Records</h2>
  <p class="hint">How long the grid can now run below or above any level, for any fuel or group.</p>
  <form class="controls" onsubmit="return false">
    <label class="field">
      <span>Measure</span>
      <select id="preset"></select>
    </label>
    <div class="field">
      <span>Record type</span>
      <div class="segmented" role="radiogroup" aria-label="Record type">
        <button type="button" data-mode="below" role="radio">Below</button>
        <button type="button" data-mode="above" role="radio">Above</button>
      </div>
    </div>
    <div class="field">
      <span>Units</span>
      <div class="segmented" role="radiogroup" aria-label="Units">
        <button type="button" data-unit="gw" role="radio">GW</button>
        <button type="button" data-unit="pct" role="radio">% of generation</button>
      </div>
    </div>
    <label class="field grow">
      <span>Thresholds</span>
      <input id="thresholds" inputmode="decimal" autocomplete="off">
    </label>
    <div class="field" id="members-field">
      <span>Sources</span>
      <button type="button" class="edit-btn" id="members-toggle" aria-expanded="false" aria-controls="members"></button>
    </div>
    <fieldset class="field members" id="members" hidden>
      <legend>Sources in the group</legend>
    </fieldset>
  </form>
  <p class="question" id="question"></p>
  <div class="table-scroll">
    <table class="records" id="records-table"></table>
  </div>

  <h3>How the records have grown</h3>
  <p class="hint">Each step is a new longest spell.</p>
  <div class="segmented small" role="radiogroup" aria-label="Y axis scale">
    <button type="button" data-prog-scale="linear" role="radio" aria-checked="false">Linear</button>
    <button type="button" data-prog-scale="log" role="radio" aria-checked="true">Log</button>
  </div>
  <div class="chart-host" id="progression"></div>
  <div class="legend" id="progression-legend"></div>

  <h3>Longest spell in each year</h3>
  <p class="hint">✓ marks a spell that lasted the whole year.</p>
  <div class="chart-host" id="by-year"></div>
  <div class="legend" id="by-year-legend"></div>

  <h3>The measure over time</h3>
  <div class="segmented small" id="range" role="radiogroup" aria-label="Time range">
    <button type="button" data-range="7">Week</button>
    <button type="button" data-range="30">Month</button>
    <button type="button" data-range="365">Year</button>
    <button type="button" data-range="all">All time</button>
  </div>
  <div class="segmented small" role="radiogroup" aria-label="Y axis scale">
    <button type="button" data-scale="linear" role="radio">Linear</button>
    <button type="button" data-scale="log" role="radio">Log</button>
  </div>
  <div class="chart-host" id="timeline"></div>
  <p class="hint" id="timeline-note"></p>`;

/**
 * @param {object} o
 * @param {HTMLElement} o.host  an empty section to fill
 * @param {object} o.country  site/js/countries/<cc>.js
 * @param {(data, members: string[], unit: string) => Float64Array} [o.series]  defaults to metricSeries
 * @param {() => string} [o.seriesKey]  changes when the page's own settings change the series
 * @param {{read(p: URLSearchParams): void, write(p: URLSearchParams): void}} [o.hash]  page settings kept in the URL
 */
export function createRecordsTool({ host, country, series, seriesKey = () => '', hash }) {
  const PRESETS = country.presets;
  const FUELS = country.fuels;
  const q = (sel) => host.querySelector(sel);
  const qa = (sel) => host.querySelectorAll(sel);
  host.innerHTML = MARKUP;

  const state = { preset: 'fossil', mode: 'below', unit: 'gw', thresholds: [], members: [], range: 'all', membersOpen: false, scale: 'linear' };
  let data = null;
  let end = 0; // one past the last slot the table and charts cover
  let timelineEnd = 0;
  let step = 30;
  let seriesCache = null;
  let envelopeCache = null;
  let lastSummaries = null;
  // The records chart has its own scale switch; log by default, since records
  // run from minutes to days.
  let progScale = 'log';

  const dur = (slots) => formatDuration(slots, step);
  const at = (i) => slotTime(i, data.startMs, step);
  const bandFor = (slots) => SPELL_BANDS.find((b) => slots * step < b.max);

  const small = (v) => country.smallInMw && v > 0 && v < 1;
  const fmtValue = (v) => (state.unit === 'gw'
    ? (small(v) ? `${Math.round(v * 1000)} MW` : `${+v.toFixed(v < 1 ? 2 : country.smallInMw ? 2 : 1)} GW`)
    : `${+v.toFixed(v < 1 ? 1 : 0)}%`);
  const fmtThreshold = (v) => (state.unit === 'gw' ? (small(v) ? `${Math.round(v * 1000)} MW` : `${v} GW`) : `${v}%`);
  /** Row label for a threshold, e.g. "< 2 GW", "≥ 20 GW" or "Zero". */
  const thresholdLabel = (t) => (state.mode === 'below' ? (t === 0 ? 'Zero' : `< ${fmtThreshold(t)}`) : `≥ ${fmtThreshold(t)}`);
  /** Thresholds ordered from easiest to hardest, so darker colours mean harder. */
  function orderedThresholds() {
    const t = [...state.thresholds].sort((a, b) => a - b);
    return state.mode === 'below' ? t.reverse() : t;
  }
  const thresholdColor = (i, n) => css(RAMP[n <= 1 ? 3 : Math.round((i * (RAMP.length - 1)) / (n - 1))]);
  const parseThresholds = (s) => [...new Set(s.split(/[\s,]+/).filter(Boolean).map(Number).filter((v) => Number.isFinite(v) && v >= 0))].slice(0, MAX_THRESHOLDS);

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
    hash?.read(p);
  }

  function writeHash() {
    const p = new URLSearchParams({ m: state.preset, d: state.mode, u: state.unit, t: state.thresholds.join(',') });
    hash?.write(p);
    if (PRESETS[state.preset].editable) p.set('g', state.members.join(','));
    if (state.scale === 'log') p.set('s', 'log');
    history.replaceState(null, '', `#${p}`);
  }

  function groupName() {
    if (!PRESETS[state.preset].editable) return PRESETS[state.preset].label.replace(/ \(.*\)/, '').toLowerCase();
    const names = state.members.map((m) => FUELS[m].label.toLowerCase());
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
  }

  function setupControls() {
    const preset = q('#preset');
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
    qa('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      if (state.mode === b.dataset.mode) return;
      state.mode = b.dataset.mode;
      update();
    }));
    qa('[data-unit]').forEach((b) => b.addEventListener('click', () => {
      if (state.unit === b.dataset.unit) return;
      state.unit = b.dataset.unit;
      state.thresholds = PRESETS[state.preset][state.unit];
      update();
    }));
    q('#thresholds').addEventListener('change', (e) => {
      const t = parseThresholds(e.target.value);
      if (t.length) state.thresholds = t;
      update();
    });
    q('#members-toggle').addEventListener('click', () => {
      state.membersOpen = !state.membersOpen;
      syncControls();
    });
    const members = q('#members');
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
    qa('[data-prog-scale]').forEach((b) => b.addEventListener('click', () => {
      progScale = b.dataset.progScale;
      qa('[data-prog-scale]').forEach((x) => x.setAttribute('aria-checked', x === b));
      if (lastSummaries) renderProgression(lastSummaries);
    }));
    qa('[data-scale]').forEach((b) => b.addEventListener('click', () => {
      state.scale = b.dataset.scale;
      syncControls();
      writeHash();
      if (data) renderTimeline(currentSeries());
    }));
    qa('[data-range]').forEach((b) => b.addEventListener('click', () => {
      state.range = b.dataset.range;
      syncControls();
      if (data) renderTimeline(currentSeries());
    }));
  }

  function syncControls() {
    q('#preset').value = state.preset;
    qa('[data-mode]').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === state.mode));
    qa('[data-unit]').forEach((b) => b.setAttribute('aria-checked', b.dataset.unit === state.unit));
    qa('[data-range]').forEach((b) => b.setAttribute('aria-checked', b.dataset.range === state.range));
    qa('[data-scale]').forEach((b) => b.setAttribute('aria-checked', b.dataset.scale === state.scale));
    q('#thresholds').value = state.thresholds.join(', ');
    const members = q('#members');
    const editable = !!PRESETS[state.preset].editable;
    q('#members-field').hidden = !editable;
    members.hidden = !(editable && state.membersOpen);
    const toggle = q('#members-toggle');
    toggle.setAttribute('aria-expanded', !members.hidden);
    toggle.textContent = members.hidden ? `Edit (${state.members.length})` : 'Done';
    members.querySelectorAll('input').forEach((i) => { i.checked = state.members.includes(i.value); });
  }

  function currentSeries() {
    const key = JSON.stringify([state.members, state.unit, seriesKey()]);
    if (seriesCache?.key !== key) {
      const values = series ? series(data, state.members, state.unit) : metricSeries(data, country, state.members, { unit: state.unit });
      seriesCache = { key, values: values.subarray(0, end) };
    }
    return seriesCache.values;
  }

  function renderQuestion() {
    const verb = state.mode === 'below' ? 'below' : 'at or above';
    const what = state.unit === 'pct' ? `${groupName()} as a share of generation` : groupName();
    q('#question').textContent = `What is the longest the grid has run with ${what} ${verb} each threshold?`;
  }

  const tableHead = () => `<thead><tr><th>Threshold</th><th>Longest spell</th><th>${country.live ? 'Current spell' : 'At the latest data'}</th><th>Share of ${country.live ? 'past' : 'the latest'} 365 days</th><th>Spells</th></tr></thead>`;

  function renderTable(summaries) {
    const n = summaries.length;
    const values = currentSeries();
    const yearSlots = (365 * DAY) / step;
    const rows = summaries.map((s, i) => {
      const r = s.record;
      const c = s.current;
      const ongoing = r && c && c.start === r.start;
      const longest = r ? `<td class="big">${dur(r.end - r.start)}<span class="when">${fmtDateTime(at(r.start))} ${ongoing ? 'and still going' : `to ${fmtDateTime(at(r.end))}`}</span></td>` : '<td>Never</td>';
      // Where the data runs weeks behind, a spell running at the end of it is "at the latest data", not live.
      const badge = country.live
        ? (ongoing ? '<span class="live record-live" title="The current spell is the longest ever">Record, live</span>' : '<span class="live">Live</span>')
        : (ongoing ? '<span class="live record-live">Record</span>' : '');
      const cur = c ? `<td class="big">${dur(c.end - c.start)}${badge}<span class="when">since ${fmtDateTime(at(c.start))}</span></td>` : '<td>—</td>';
      let qualifying = 0;
      for (let k = Math.max(0, values.length - yearSlots); k < values.length; k++) if (!Number.isNaN(values[k]) && meets(values[k], s.threshold, state.mode)) qualifying++;
      return `<tr><td><span class="swatch" style="background:${thresholdColor(i, n)}"></span><b>${thresholdLabel(s.threshold).replace('<', '&lt;')}</b></td>${longest}${cur}
        <td class="big">${pct(qualifying, yearSlots)}</td><td>${s.count.toLocaleString(country.locale)}</td></tr>`;
    });
    q('#records-table').innerHTML = `${tableHead()}<tbody>${rows.join('')}</tbody>`;
  }

  /** Evenly spaced ticks in hours, stepping in whole days once records pass three days. */
  function linearHourTicks(lines) {
    const max = Math.max(1, ...lines.flatMap((s) => s.points.map((p) => p[1])));
    const days = max > 72;
    const ticks = niceTicks(0, days ? max / 24 : max);
    const gap = ticks[1] - ticks[0];
    if (ticks[ticks.length - 1] < (days ? max / 24 : max)) ticks.push(Number((ticks[ticks.length - 1] + gap).toPrecision(10)));
    return days ? ticks.map((d) => d * 24) : ticks;
  }

  function renderProgression(summaries) {
    lastSummaries = summaries;
    const log = progScale === 'log';
    const n = summaries.length;
    const now = at(end);
    const lines = summaries.map((s, i) => ({
      name: thresholdLabel(s.threshold),
      color: thresholdColor(i, n),
      step: true,
      extendTo: now,
      points: s.progression.map((r) => [at(r.end), ((r.end - r.start) * step) / 60]),
      records: s.progression,
    }));
    lines.forEach((s) => { s.markers = s.points; });
    const linTicks = log ? null : linearHourTicks(lines);
    // The shortest possible spell is one slot, so the log axis starts there.
    const logMin = Math.min(0.5, step / 60);
    lineChart(q('#progression'), {
      series: lines,
      yLog: log,
      yMin: log ? logMin : 0,
      xMin: data.startMs,
      xMax: now,
      stepLookup: true,
      yFormat: (h) => dur(Math.round((h * 60) / step)),
      yTickFormat: log
        ? (h) => (h >= 8760 ? `${+(h / 8760).toFixed(0)}y` : h >= 48 ? `${+(h / 24).toFixed(0)}d` : h < 1 ? `${Math.round(h * 60)}m` : `${h}h`)
        : (h) => (linTicks[linTicks.length - 1] > 72 ? `${+(h / 24).toFixed(1)}d` : `${h}h`),
      yTicks: log ? [1 / 12, 0.25, 0.5, 1, 3, 6, 12, 24, 72, 168, 720, 2160, 8760, 17520, 43800].filter((h) => h >= logMin) : linTicks,
      yMax: log ? undefined : linTicks[linTicks.length - 1],
      tooltip: (t, vals) => `<strong>Records as of ${fmtDate(t)}</strong>${vals.map((v) => {
        const rec = v.point ? v.series.records[v.series.points.indexOf(v.point)] : null;
        return `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${rec ? dur(rec.end - rec.start) : 'none yet'}</b>${rec ? ` <span class="when">set ${fmtDate(at(rec.start))}</span>` : ''}</div>`;
      }).join('')}`,
    });
    q('#progression-legend').innerHTML = lines.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('');
  }

  // Columns for the per-year heatmap: each complete local calendar year, then
  // the past 365 days in place of the unfinished one, as in the story charts.
  function yearColumns(lastSlot) {
    const tz = country.timeZone;
    const y0 = localYear(data.startMs, tz);
    const y1 = localYear(at(lastSlot), tz);
    const slotsInYear = (y) => (yearStart(y + 1, tz) - yearStart(y, tz)) / (step * 60000);
    const cols = [];
    for (let y = y0; y < y1; y++) cols.push({ label: String(y), title: String(y), slots: slotsInYear(y), pick: (s) => new Map(s.perYear).get(y) ?? null });
    cols.push({ label: '365d', title: country.live ? 'Past 365 days' : 'Latest 365 days', slots: (365 * DAY) / step, pick: (s) => s.pastYear });
    return cols;
  }

  function renderByYear(summaries) {
    const cols = yearColumns(end - 1);
    const values = summaries.map((s) => cols.map((c) => c.pick(s)));
    const full = (sp, ci) => !!sp && sp.end - sp.start >= cols[ci].slots;
    q('#by-year-legend').innerHTML = SPELL_BANDS.map((b) => `<span><span class="swatch" style="background:${b.color}"></span>${b.label}</span>`).join('');
    heatmap(q('#by-year'), {
      rows: summaries.map((s) => thresholdLabel(s.threshold)),
      cols: cols.map((c) => c.label),
      values: values.map((r) => r.map((sp) => (sp ? sp.end - sp.start : null))),
      color: (v) => bandFor(v).color,
      // A tick where the spell covers the whole column.
      mark: (ri, ci) => full(values[ri][ci], ci),
      format: dur,
      title: (r, c, v) => {
        const ci = cols.findIndex((col) => col.label === c);
        const name = cols[ci].title;
        const sp = values[summaries.findIndex((s) => thresholdLabel(s.threshold) === r)][ci];
        const whole = sp?.spell;
        const clipped = whole && (whole.start !== sp.start || whole.end !== sp.end);
        return sp ? `<strong>${name}, ${r}</strong><div>Longest in ${ci === cols.length - 1 ? `the ${name.toLowerCase()}` : name}: <b>${full(sp, ci) ? 'the whole time ✓' : dur(v)}</b></div><div>${fmtDateTime(at(sp.start))} to ${fmtDateTime(at(sp.end))}</div>${clipped ? `<div class="when">Part of a ${dur(whole.end - whole.start)} spell from ${fmtDate(at(whole.start))} to ${fmtDate(at(whole.end))}</div>` : ''}`
          : `<strong>${name}, ${r}</strong><div>No spells</div>`;
      },
    });
  }

  function renderTimeline(values) {
    const thresholds = orderedThresholds();
    const daily = state.range === 'all' || Number(state.range) > 60;
    const raw = windowPoints(data, values, state.range, timelineEnd);
    const key = `${seriesCache.key}|${state.range}|${timelineEnd}`;
    const slotsPerDay = DAY / step;
    if (envelopeCache?.key !== key) {
      const days = ENVELOPE_DAYS[state.range] ?? 1;
      // Daily means hide the short peaks (solar's best day averages about a
      // third of its best half hour), so for daily points the bands come from
      // the raw slots themselves.
      envelopeCache = { key, ...(daily
        ? windowEnvelopes(values, raw.map(([t]) => Math.round((t - data.startMs) / (step * 60000)) + slotsPerDay / 2), Math.floor((days * slotsPerDay) / 2))
        : envelopes(raw.map(([, v]) => v), days * slotsPerDay)) };
    }
    const span = ENVELOPE_LABEL[state.range] ?? '24-hour';
    q('#timeline-note').textContent = `Over each rolling ${span} window, the light band spans every ${STEP_NAMES[step] ?? `${step}-minute`} value and the darker band the middle 99%, leaving out the rarest spikes.`;
    const logScale = country.logScale ?? { min: 0.05, ticks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] };
    lineChart(q('#timeline'), {
      ...envelopeLayers(raw, envelopeCache, `${groupName()}${daily ? ' (daily mean)' : ''}`),
      refLines: thresholds.map((t, i) => ({ value: t, color: thresholdColor(i, thresholds.length) })),
      yLog: state.scale === 'log',
      fitData: state.scale !== 'log',
      yMin: state.scale === 'log' ? (state.unit === 'pct' ? 0.5 : logScale.min) : undefined,
      yTicks: state.scale === 'log' ? logScale.ticks : undefined,
      yFormat: fmtValue,
      yTickFormat: (v) => `${v}${state.unit === 'pct' ? '%' : ''}`,
      tooltip: (t, vals) => `<strong>${daily ? fmtDate(t) : fmtDateTime(t)}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${Number.isFinite(v.value) ? fmtValue(v.value) : '—'}</b></div>`).join('')}`,
    });
  }

  /** Dashes in the table and a reserved heatmap height, until the data arrives. */
  function renderPlaceholders() {
    const sample = (text) => `<span style="visibility: hidden">${text}</span>`;
    const cell = `<td class="big">—<span class="when">${sample(fmtDate(Date.now()))}</span></td>`;
    q('#records-table').innerHTML = `${tableHead()}<tbody>${orderedThresholds().map((t) => `<tr><td><span class="swatch"></span><b>${thresholdLabel(t).replace('<', '&lt;')}</b></td>${cell}${cell}<td class="big">—</td><td>—</td></tr>`).join('')}</tbody>`;
    q('#by-year-legend').innerHTML = SPELL_BANDS.map((b) => `<span><span class="swatch" style="background:${b.color}"></span>${b.label}</span>`).join('');
    // The heatmap is 28px a row plus its axis.
    q('#by-year').style.setProperty('--placeholder-height', `${34 + 28 * state.thresholds.length}px`);
  }

  function update() {
    syncControls();
    writeHash();
    if (!data) return;
    const values = currentSeries();
    const opts = { startMs: data.startMs, stepMinutes: step, timeZone: country.timeZone };
    const summaries = orderedThresholds().map((t) => summarise(values, t, state.mode, opts));
    renderQuestion();
    renderTable(summaries);
    renderProgression(summaries);
    renderByYear(summaries);
    renderTimeline(values);
  }

  readHash();
  setupControls();
  syncControls();
  renderQuestion();
  renderPlaceholders();

  return {
    state,
    /**
     * Draws the card from a dataset. `end` is one past the last slot to use
     * (default: all of it); `timelineEnd` lets the measure-over-time chart
     * stop earlier, at the last slot every source has reported.
     */
    setData(d, { end: e = d.length, timelineEnd: te = e } = {}) {
      data = d;
      step = d.stepMinutes ?? d.meta?.stepMinutes ?? 30;
      end = e;
      timelineEnd = Math.min(te, e);
      seriesCache = null;
      envelopeCache = null;
      update();
    },
    /** Redraws everything, after a resize or a change to the page's own settings. */
    update,
  };
}
