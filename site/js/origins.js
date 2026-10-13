// Renders the "Where battery power comes from" section from the FIFO model.
import { MIX } from './story.js';
import { attributeBatteries, byMonth, sumDays, shares, DEFAULTS } from './fifo.js';
import { barChart, fmtDate } from './charts.js';

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const $ = (id) => document.getElementById(id);
const DAY_MS = 864e5;
const pc = (v) => (Number.isFinite(v) ? `${v.toFixed(v < 10 ? 1 : 0)}%` : '—');
const gwh = (mwh) => `${(mwh / 1000).toFixed(mwh < 10000 ? 1 : 0)} GWh`;

let model = null;

export function renderBatteryOrigins(data) {
  if (!data) return;
  if (model?.data !== data) model = { data, ...attributeBatteries(data) };
  const { days, store } = model;
  if (!days.length) return;

  // Headline: the latest 30 days of metered data, which is the most complete
  // record of charging. Planned output alone if there is no metered data yet.
  const metered = days.filter((d) => d.sources.b1610 > 24);
  const end = (metered.length ? metered.at(-1) : days.at(-1)).dayMs + DAY_MS;
  const from = end - 30 * DAY_MS;
  const recent = shares(sumDays(days, from, end));
  const storeTotal = store.mix.reduce((a, v) => a + v, 0);
  const top = MIX.map((m, k) => [m.label, store.mix[k]]).sort((a, b) => b[1] - a[1])[0];
  const period = `${fmtDate(from)} to ${fmtDate(end - DAY_MS)}`;
  const cards = [
    ['--fossil', '🔥', 'Charged from fossil fuels', pc(recent.fossil), `of battery output, against ${pc(recent.gridFossil)} for the grid as a whole`],
    ['--lowcarbon', '🌱', 'Charged from low carbon', pc(recent.lowCarbon), `of battery output, against ${pc(recent.gridLowCarbon)} for the grid as a whole`],
    ['--f-nuclear', '🔋', 'Batteries discharged', gwh(recent.dischargedMwh), `${period}${recent.unknown >= 1 ? `, ${pc(recent.unknown)} of it unexplained` : ''}`],
    ['--f-wind', '📦', 'In the batteries now', storeTotal > 0 ? gwh(storeTotal) : 'Empty', `by this model's reckoning${storeTotal > 0 ? `, mostly ${top[0].toLowerCase()} (${pc((top[1] / storeTotal) * 100)})` : ''}`],
  ];
  $('origin-facts').innerHTML = cards.map(([c, e, l, v, sub]) => `<div class="fact" style="--tint: color-mix(in srgb, var(${c}) 20%, #fff)"><div class="label"><span aria-hidden="true">${e}</span> ${l}</div><div class="big">${v}</div><div class="sub">${sub}</div></div>`).join('');

  const months = byMonth(days).map((m) => ({ ...m, s: shares(m) })).filter((m) => m.s.dischargedMwh > 0);
  const stacks = [
    ...MIX.map((m) => ({ name: m.label, color: css(`--f-${m.key}`), values: months.map((r) => r.s.byFuel[m.key]) })),
    { name: 'Unexplained', color: css('--grid'), values: months.map((r) => r.s.unknown) },
  ];
  const label = (ms) => new Date(ms).toLocaleString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const usesPn = (m) => m.sources.pn > m.sources.b1610;
  barChart($('origin-chart'), {
    cats: months.map((m) => label(m.monthMs)),
    stacks,
    yMax: 100,
    yFormat: pc,
    yTickFormat: (v) => `${v}%`,
    faded: (ci) => usesPn(months[ci]),
    tooltip: (ci) => {
      const m = months[ci];
      return `<strong>${new Date(m.monthMs).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</strong>`
        + `<div>Battery output: <b>${gwh(m.s.dischargedMwh)}</b></div>`
        + [...stacks].reverse().filter((s) => s.values[ci] >= 0.05).map((s) => `<div><i style="background:${s.color}"></i>${s.name}: <b>${pc(s.values[ci])}</b></div>`).join('')
        + `<div>Fossil share: <b>${pc(m.s.fossil)}</b> of explained output, grid ${pc(m.s.gridFossil)}</div>`
        + `<div class="when">${usesPn(m) ? 'Mostly planned output (PN)' : 'Mostly metered output (B1610)'}</div>`;
    },
  });
  $('origin-legend').innerHTML = [...stacks].reverse().map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('')
    + '<span>share of battery output each month; lighter months rely on planned output</span>';

  $('origin-notes').innerHTML = [
    'The whole fleet is treated as one battery. When some units charge while others discharge in the same half hour, only the net flow is counted as meeting the grid.',
    'Energy charged takes the grid\'s generation mix for that half hour, with battery output taken out of NESO\'s "Other". Imports count as imports, whatever generated them abroad.',
    `${Math.round(DEFAULTS.efficiency * 100)}% of the energy taken in comes back out, a typical round trip for lithium-ion batteries and close to what the metered data shows.`,
    `The store holds at most ${DEFAULTS.durationHours} hours of the fleet's peak power over the previous ${DEFAULTS.peakDays} days. Charge that would overflow it is written off, oldest first, so gaps in the data cannot leave months-old energy sitting in the store.`,
    'Metered output (B1610) is used where it exists, and planned output (PN) otherwise. Planned output misses charging done on National Grid\'s later instructions, so in months that rely on it a large share of discharge has no recorded charge behind it. That share is shown as unexplained rather than guessed.',
    'It is an accounting model, not physics: electrons on a shared grid are not labelled, and real batteries do not empty in strict order. It answers "what was generating when this energy was stored?", averaged across the fleet.',
  ].map((t) => `<li>${t}</li>`).join('');
}
