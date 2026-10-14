// Draws the "firm megawatt" section: falling panel and battery costs, and the
// cost of 1 MW around the clock from solar and batteries against gas.
import { lineChart } from './charts.js';
import { YEARS, PUBLISHED, ASSUMPTIONS as A, SOURCES, solarShape, fleetShape, sizing, mixSizing, firmCosts, monthlyLoadFactor, yearInputs } from './solarcost.js';

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const at = (year) => Date.UTC(year, 6, 1);
const gbp = (v) => `£${Math.round(v).toLocaleString('en-GB')}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let model = null;

/** Weather years used for sizing: 2015 (a mature panel fleet) to the last complete year. */
function weatherYears(data) {
  const end = new Date(data.startMs + data.length * 18e5);
  return [2015, end.getUTCFullYear() - 1];
}

function build(data) {
  const [from, to] = weatherYears(data);
  const shape = solarShape(data, from, to);
  if (!shape) return null;
  const wind = fleetShape(data, ['wind', 'wind_emb'], from, to, A.windLoadFactor);
  const sized = sizing(shape);
  const mixed = mixSizing(shape, wind);
  return { from, to, months: monthlyLoadFactor(shape, from), windMonths: monthlyLoadFactor(wind, from), rows: firmCosts(sized, mixed) };
}

export function renderSolar(data) {
  if (!data) return;
  if (!model) model = build(data);
  if (!model) return;
  const { rows, months, from, to } = model;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const firm = (r) => r.solar.find((s) => s.share === 1);
  const most = (r) => r.solar.find((s) => s.share !== 1);
  const mixFirm = (r) => r.mix.find((s) => s.share === 1);
  const mixMost = (r) => r.mix.find((s) => s.share !== 1);
  const drop = (a, b) => `${Math.round((1 - b / a) * 100)}%`;

  // Panel and battery prices.
  const kit = [
    { name: 'Solar panels, installed (£ per kW)', color: css('--f-solar'), points: rows.map((r) => [at(r.year), r.panelPerMw / 1000]), published: PUBLISHED.pv },
    { name: 'Grid batteries, installed (£ per kWh)', color: css('--f-nuclear'), points: rows.map((r) => [at(r.year), r.batteryPerMwh / 1000]), published: PUBLISHED.battery },
  ];
  $('solar-kit-text').textContent = `Since ${first.year}, the cost of building a large solar farm has fallen by ${drop(first.panelPerMw, last.panelPerMw)} and the cost of a grid battery by ${drop(first.batteryPerMwh, last.batteryPerMwh)}, after inflation. Dots mark published figures; the years between are filled in at a steady rate.`;
  lineChart($('solar-kit'), {
    series: kit.map((s) => ({ ...s, width: 3, markers: s.points.filter((p) => s.published.includes(new Date(p[0]).getUTCFullYear())) })),
    yLog: true,
    yMin: 50,
    yFormat: gbp,
    height: 240,
    tooltip: (t, vals) => `<strong>${new Date(t).getUTCFullYear()}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${gbp(v.value)}</b></div>`).join('')}`,
  });
  $('solar-kit-legend').innerHTML = kit.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join('');

  // What a firm megawatt takes.
  const now = firm(last);
  const dec = months[11];
  const jun = months[5];
  const used = 1 / (now.panels * A.solarLoadFactor);
  $('solar-facts').innerHTML = [
    ['--f-solar', '☀️', 'June', `${(jun * 100).toFixed(0)}%`, 'of a solar panel\'s capacity, on average'],
    ['--f-gas', '🌥️', 'December', `${(dec * 100).toFixed(1)}%`, `so it takes ${Math.round(1 / dec)} MW of panels to average 1 MW`],
    ['--f-nuclear', '🔋', `Cheapest kit in ${last.year}`, `${now.panels} MW + ${Math.round(now.mwh)} MWh`, 'of panels and battery for each firm MW'],
    ['--f-other', '🗑️', 'Spilled', `${Math.round((1 - used) * 100)}%`, 'of what those panels make is not needed'],
  ].map(([c, e, l, v, sub]) => `<div class="fact"><div class="label"><span class="swatch" style="background:var(${c})"></span>${l}</div><div class="big">${v}</div><div class="sub">${sub}</div></div>`).join('');

  // The comparison.
  const lines = [
    { name: 'Solar + batteries, never runs out', color: css('--f-solar'), width: 3, points: rows.map((r) => [at(r.year), firm(r).cost]) },
    { name: 'Solar + batteries, 99% of the energy', color: css('--f-solar'), width: 2, dash: '6 4', points: rows.map((r) => [at(r.year), most(r).cost]) },
    { name: 'Solar + wind + batteries, never runs out', color: css('--f-wind'), width: 3, points: rows.map((r) => [at(r.year), mixFirm(r).cost]) },
    { name: 'Solar + wind + batteries, 99% of the energy', color: css('--f-wind'), width: 2, dash: '6 4', points: rows.map((r) => [at(r.year), mixMost(r).cost]) },
    { name: 'Gas, building a new plant', color: css('--f-coal'), width: 3, points: rows.map((r) => [at(r.year), r.gas.newBuild]) },
    { name: 'Gas, running an existing plant', color: css('--f-gas'), width: 3, points: rows.map((r) => [at(r.year), r.gas.existing]) },
  ];
  lineChart($('solar-firm'), {
    series: lines.map((s) => ({ ...s, markers: s.points })),
    yLog: true,
    yMin: 30,
    yTicks: [30, 50, 100, 200, 500, 1000, 2000, 5000],
    yFormat: gbp,
    height: 320,
    tooltip: (t, vals) => {
      const r = rows.find((x) => at(x.year) === t);
      return `<strong>${r.year}</strong>${vals.map((v) => `<div><i style="background:${v.series.color}"></i>${v.series.name}: <b>${gbp(v.value)}</b> per MWh</div>`).join('')}`
        + `<div class="small">Solar: ${firm(r).panels} MW panels + ${Math.round(firm(r).mwh)} MWh battery (99%: ${most(r).panels} MW + ${Math.round(most(r).mwh)} MWh)</div>`
        + `<div class="small">With wind: ${mixFirm(r).turbines} MW wind + ${mixFirm(r).panels} MW panels + ${Math.round(mixFirm(r).mwh)} MWh (99%: ${mixMost(r).turbines} + ${mixMost(r).panels} MW + ${Math.round(mixMost(r).mwh)} MWh)</div>`
        + `<div class="small">Gas: fuel ${gbp(r.gas.fuel)}, carbon ${gbp(r.gas.carbon)} per MWh</div>`;
    },
  });
  $('solar-firm-legend').innerHTML = lines.map((s) => `<span><span class="swatch${s.dash ? ' dashed' : ''}" style="background:${s.color}; color:${s.color}"></span>${s.name}</span>`).join('');

  const ratio = firm(last).cost / last.gas.newBuild;
  const peak = rows.reduce((a, r) => (r.gas.existing > a.gas.existing ? r : a));
  $('solar-firm-text').textContent = `In ${last.year}, a firm megawatt from solar and batteries alone costs about ${gbp(firm(last).cost)} per MWh, against ${gbp(last.gas.newBuild)} from a new gas plant: ${ratio.toFixed(1)} times as much, down from ${(firm(first).cost / first.gas.newBuild).toFixed(0)} times in ${first.year}. Gas peaked at ${gbp(peak.gas.existing)} in ${peak.year}, when the gas price spiked.`;
  const mf = mixFirm(last);
  const mm = mixMost(last);
  $('solar-wind-text').textContent = `Wind blows hardest in winter, making ${Math.round(model.windMonths[11] * 100)}% of its capacity in December against solar's ${(dec * 100).toFixed(1)}%. Swap most of the panels for turbines and a firm megawatt in ${last.year} needs about ${mf.turbines} MW of wind, ${mf.panels} MW of panels and ${Math.round(mf.mwh)} MWh of battery, for about ${gbp(mf.cost)} per MWh. Letting something else cover the last 1% brings it to ${gbp(mm.cost)}, ${mm.cost <= last.gas.newBuild * 1.1 ? 'level with' : `${(mm.cost / last.gas.newBuild).toFixed(1)} times`} a new gas plant.`;

  const extra = (capex) => ((capex - A.gasCapexPerMw) * last.gas.build) / A.gasCapexPerMw;
  const surplusNote = `The ${Math.round((1 - used) * 100)}% of panel output that isn't needed is counted as worth nothing, because the question is what it costs to have solar and batteries alone do the job. Selling it would bring the solar line down.`;
  $('solar-notes').innerHTML = [
    `<b>Winter decides everything.</b> Panels make about ${Math.round(jun / dec)} times as much in June as in December, and a long, dull spell in December sets the battery size. The worst weather in ${from} to ${to} is used.`,
    `<b>The last 1% is the expensive part.</b> Letting something else cover the darkest 1% of the energy cuts the solar cost by about ${Math.round((1 - most(last).cost / firm(last).cost) * 100)}%.`,
    `<b>Spilled energy.</b> ${surplusNote}`,
    now.panelShare > 0.5
      ? `<b>Panels now cost more than the batteries.</b> In ${last.year} panels are ${Math.round(now.panelShare * 100)}% of the solar cost, so cheaper batteries alone no longer move it much.`
      : `<b>Batteries are most of the cost.</b> In ${last.year} batteries are ${Math.round((1 - now.panelShare) * 100)}% of the solar cost.`,
    `<b>Gas swings with the gas price.</b> Fuel and carbon are ${Math.round(((last.gas.fuel + last.gas.carbon) / last.gas.existing) * 100)}% of the cost of running an existing plant. New plants could cost more to build than the government's central estimate: builders have quoted £1,000 to £1,500 per kW, which would add about ${gbp(extra(1000e3))} to ${gbp(extra(1500e3))} per MWh.`,
    '<b>This is Britain.</b> Further south, with far less difference between summer and winter, the same sum needs a fraction of the panels and batteries.',
    `<b>Wind is the bigger lever in winter.</b> The wind lines assume new onshore farms producing ${A.windLoadFactor * 100}% of their capacity on average, with the timing of Britain's actual wind output. Britain's existing onshore farms manage about 25% and offshore about 36%. Long, still, cold spells set the battery size here, and the worst in ${from} to ${to} is used. The 99% line leaves the stillest 1% to something else, such as gas, imports or hydrogen, which is not costed.`,
    '<b>Solar alone is not the plan.</b> Britain\'s grid mixes wind, solar, nuclear, interconnectors and storage, and they cover each other\'s gaps. This is a yardstick for how far solar and batteries have come, not a design.',
  ].map((t) => `<li>${t}</li>`).join('');

  const k24 = YEARS.indexOf(2024);
  const i24 = yearInputs(k24);
  $('solar-method').innerHTML = [
    `Solar output comes from the NESO half-hourly solar figures on this page, for ${from} to ${to}. Each day is divided by an estimate of how many panels were installed then, and the result is scaled to an average of ${A.solarLoadFactor * 100}% of capacity, DESNZ's figure for large solar farms.`,
    `For each size of solar farm, from 10 to 150 MW per firm MW, the smallest battery that never runs out over those years is found. Charging loses ${Math.round((1 - A.roundTrip) * 100)}% of the energy. The 99% line uses the smallest battery that leaves no more than 1% of the energy unserved. Each year, the cheapest combination at that year's prices is chosen.`,
    `Panels last ${A.solarLifeYears} years and cost ${gbp(A.solarOmPerMw)} per MW a year to run. Batteries last ${A.batteryLifeYears} years (NREL), so they are bought twice in a solar farm's life, and cost ${A.batteryOmShare * 100}% of their price a year to run, which covers topping up capacity as cells wear (around 2.6% a year, Lazard). Money is borrowed at ${A.solarWacc * 100}% a year after inflation.`,
    `Panel costs are IRENA's global average for large solar farms, and battery costs IRENA's for grid batteries, with Ember's survey for ${YEARS[YEARS.length - 1]}. IRENA publishes both for every year, but only some years were available here: panels for 2010 and 2023 to 2025, batteries for 2010, 2024 and 2025. The years between are filled in at a steady rate of decline, so the shape of those lines between published points is an estimate. British batteries have cost more: Modo's survey put two-hour systems at about £325 per kWh in 2024, against ${gbp(i24.batteryPerMwh / 1000)} here. Two-hour systems pay more per kWh for their inverters than the long-running batteries this needs.`,
    `Gas: DESNZ's 2025 central estimate for a large modern plant (${gbp(A.gasCapexPerMw / 1000)} per kW, ${A.gasLifeYears} years, ${A.gasAvailability * 100}% available, so a firm MW needs ${(1 / A.gasAvailability).toFixed(2)} MW of plant, borrowed at ${A.gasWacc * 100}%). Fuel is each year's average NBP gas price; carbon is the EU ETS until 2020, the UK ETS from 2021, plus the Carbon Price Support. Running an existing plant counts fuel, carbon and upkeep but not the cost of building it.`,
    `Wind uses NESO's half-hourly wind output (including wind on local networks), treated the same way and scaled to ${A.windLoadFactor * 100}%. Costs are IRENA's global average for onshore wind (2010 and 2024, steady in between, ${YEARS[YEARS.length - 1]} held at 2024), ${gbp(A.windOmPerMw)} per MW a year to run (DESNZ 2023), and ${A.windLifeYears} years of life. Mixes of 1 to 20 MW of wind with 0 to 40 MW of panels are tried, and the cheapest kept.`,
    'All money is in 2024 pounds, using the ONS consumer price index and yearly exchange rates.',
  ].map((t) => `<p>${t}</p>`).join('')
    + `<p><b>Sources:</b></p><ul>${SOURCES.map(([name, url]) => `<li><a href="${url}">${name}</a></li>`).join('')}</ul>`;
}
