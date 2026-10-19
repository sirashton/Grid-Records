import { loadData, metricSeries, BATTERY_SOURCES, lastComplete } from './data.js';
import { summarise, formatDuration, slotTime } from './records.js';
import { lineChart, barChart, fmtDate, fmtDateTime } from './charts.js';
import gb from './countries/gb.js';
import { windowPoints as corePoints } from './core/dataset.js';
import { createRecordsTool } from './core/records-tool.js';
import { recentRecords } from './recent.js';
import { envelopes, envelopeLayers } from './envelope.js';
import { MIX, FOSSIL, LOW_CARBON, yearlyMix, monthlyShares, yearlyHoursBelow, facts } from './story.js';
import { renderBatteryOrigins } from './origins.js';
import { renderSolar } from './solar-view.js';
import { startAnalytics } from './analytics.js';
import { sparkTile, donut, nowLeftHtml, fitDonutText, setupNowHover, liveFavicon, windowFigures, groupFigures, hoverFigures, tweenFigures, infoButton, fmtGw, num } from './now-panel.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = (id) => document.getElementById(id);

// The page's own settings; the Records card keeps the rest.
const state = { battery: 'pn', batteryRange: '14' };

let data;
let records;

const mountRecords = () => createRecordsTool({
  host: $('records'),
  country: gb,
  series: (d, members, unit) => metricSeries(d, members, { unit, batterySource: state.battery }),
  seriesKey: () => state.battery,
  hash: {
    read: (p) => { if (BATTERY_SOURCES[p.get('b')]) state.battery = p.get('b'); },
    write: (p) => p.set('b', state.battery),
  },
});

function setupControls() {
  const bat = $('battery-source');
  for (const [key, label] of Object.entries(BATTERY_SOURCES)) bat.add(new Option(label, key));
  bat.value = state.battery;
  bat.addEventListener('change', () => {
    state.battery = bat.value;
    records.update();
  });
  document.querySelectorAll('#battery-range [data-range]').forEach((b) => b.addEventListener('click', () => {
    state.batteryRange = b.dataset.range;
    syncBatteryRange();
    renderBattery();
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

const syncBatteryRange = () => document.querySelectorAll('#battery-range [data-range]').forEach((b) => b.setAttribute('aria-checked', b.dataset.range === state.batteryRange));
const windowPoints = (values, days) => corePoints(data, values, days);

function redrawAll() {
  if (!data) return;
  renderStory();
  records.update();
  renderBattery();
  renderSolar(data);
  if (!$('origin-body').hidden) renderBatteryOrigins(data);
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
const info = infoButton(INFO);

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
// The left half of the Right now panel is the shared one; the right half: recent records, then batteries, mirroring the left.
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
    <div class="nr" style="--tint: var(--s3)"><span class="lbl">${info('Discharging')}Discharging</span><span class="num">${pc(bat.dis)}</span>${num(fmtGw(bat.dis))}${sparkTile(bat.disSeries, '--s3', NOW_WINDOWS[nowWindow].span)}</div>
    <div class="nr" style="--tint: var(--s1)"><span class="lbl">${info('Charging')}Charging</span><span class="num">${pc(bat.chg)}</span>${num(Number.isFinite(bat.chg) ? `−${fmtGw(Math.abs(bat.chg))}` : '—')}${sparkTile(bat.chgSeries?.map((v) => -v), '--s1', NOW_WINDOWS[nowWindow].span)}</div>
    <div class="nr" style="--tint: var(--s2)"><span class="lbl">${info('Metered net')}Metered net</span><span class="sm">${bat.meteredMs ? shortDay(bat.meteredMs) : ''}</span>${num(Number.isFinite(bat.metered) ? `${bat.metered < 0 ? '−' : ''}${fmtGw(Math.abs(bat.metered))}` : '—')}${sparkTile(bat.meteredSeries, '--s2', NOW_WINDOWS[nowWindow].span)}</div>`;
}

function renderBatterySources(coverage) {
  $('battery-sources').innerHTML = [
    ['<span class="swatch" style="background:var(--s1)"></span>Elexon Physical Notifications', 'Each battery unit\'s planned output, summed. A plan, so it misses later balancing instructions.', 'Live', 'Yes'],
    ['<span class="swatch" style="background:var(--s2)"></span>Elexon B1610 metered output', 'What each battery unit actually exported or imported, from settlement meters.', 'About 5 days', 'Yes'],
    ['<span class="swatch" style="background:var(--s3)"></span>NESO generation mix "Other"', 'Battery net discharge mixed in with other small sources. NESO plans a separate battery figure.', 'About an hour', 'No'],
  ].map((r, k) => `<tr>${[...r, coverage[k]].map((v) => `<td>${v}</td>`).join('')}</tr>`).join('');
}

// Time frames for the Right now panel: the latest half hour, or the average
// over a window. Sparklines always cover at least a day, in up to 48 steps.
const NOW_WINDOWS = {
  live: { slots: 1, label: 'Live', span: 'Past 24 hours', sub: '' },
  day: { slots: 48, label: '24 hours', span: 'Past 24 hours', sub: '24h average' },
  week: { slots: 48 * 7, label: '7 days', span: 'Past 7 days', sub: '7d average' },
  year: { slots: 48 * 365, label: '365 days', span: 'Past 365 days', sub: '365d average' },
};
let nowWindow = 'live';

function renderNow(animate = false) {
  const c = data.columns;
  const i = lastComplete(data, ['gas', 'wind']);
  const win = NOW_WINDOWS[nowWindow];
  const n = win.slots;
  const { groups, total } = groupFigures(NOW_GROUPS, c, i, n);
  const pnI = data.meta.lastSlot.pn_dis;
  const bat = { net: NaN };
  if (pnI != null) {
    const dis = windowFigures((k) => c.pn_dis[k], pnI, n);
    const chg = windowFigures((k) => c.pn_chg[k], pnI, n);
    Object.assign(bat, { dis: dis.value, chg: chg.value, net: dis.value + chg.value, disSeries: dis.series, chgSeries: chg.series });
  }
  const mI = data.meta.lastSlot.b1610_dis;
  if (mI != null && c.b1610_dis) {
    const m = windowFigures((k) => c.b1610_dis[k] + c.b1610_chg[k], mI, n);
    Object.assign(bat, { metered: m.value, meteredMs: slotTime(mI, data.startMs), meteredSeries: m.series });
  }
  nowFigures = hoverFigures({ groups, total }, win.sub, win.span);
  // The tab icon always shows the latest half hour.
  const live = n === 1 ? { groups, total } : groupFigures(NOW_GROUPS, c, i, 1);
  liveFavicon(live.groups, live.total);
  const recs = recentRecords(data, { batterySource: state.battery, limit: NOW_RECORD_ROWS });
  const target = { groups, total, bat };
  if (animate && nowShown) tweenFigures(nowShown, target, (f) => drawFigures(f, recs, win.sub), { batKeys: ['dis', 'chg', 'net', 'metered'], done: () => { nowShown = target; } });
  else drawNow(target, recs, win.sub);
  $('updated').textContent = `Generation data to ${fmtDateTime(slotTime(i, data.startMs))} (UK time). Updated every 30 minutes.`;
}

let nowShown = null;
let nowFigures = {};

function drawNow(figs, recs, sub) {
  nowShown = figs;
  drawFigures(figs, recs, sub);
}

function drawFigures(figs, recs, sub) {
  $('now-groups').innerHTML = nowLeftHtml(figs.groups, figs.total, info, NOW_WINDOWS[nowWindow].span);
  $('now-donut').innerHTML = donut(figs.groups, figs.total, sub);
  fitDonutText();
  $('now-right').innerHTML = nowRightHtml(recs, figs.bat, figs.total);
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
  $('now-groups').innerHTML = nowLeftHtml(NOW_GROUPS.map((g) => ({ ...g, now: NaN, fuels: g.fuels.map((f) => ({ ...f, value: NaN, now: NaN })) })), 0, info, '');
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
  const dt = fmtDateTime(Date.now());
  renderBatterySources([sample(`${date} to ${dt}`), sample(`${date} to ${dt}`), sample(`2009 to ${dt}`)]);
}

async function main() {
  // Before the Records card rewrites the URL, so a link that arrived with settings is still visible.
  startAnalytics();
  records = mountRecords();
  setupControls();
  syncBatteryRange();
  renderPlaceholders();
  setupNowHover(() => nowFigures);
  document.querySelectorAll('[data-now-window]').forEach((b) => b.addEventListener('click', () => {
    nowWindow = b.dataset.nowWindow;
    document.querySelectorAll('[data-now-window]').forEach((x) => x.setAttribute('aria-checked', x === b));
    if (data) renderNow(true);
  }));
  try {
    data = await loadData();
  } catch (err) {
    $('updated').textContent = 'The data could not be loaded. Please try again shortly.';
    console.error(err);
    return;
  }
  renderNow();
  renderStory();
  records.setData(data, { timelineEnd: lastComplete(data, ['gas']) + 1 });
  renderBattery();
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
