// Japan's view of the shared dataset code (core/dataset.js), bound to the
// Japan country config.

import jp from '../countries/jp.js';
import * as core from '../core/dataset.js';

export const FUELS = jp.fuels;
// `thermal`: every fossil plant, the one fossil column that runs the whole history.
export const FOSSIL = core.fuelsWhere(jp, 'fossil');
// Its breakdown by fuel, from April 2024.
export const THERMAL_FUELS = ['gas', 'coal', 'oil', 'thermal_other'];
export const RENEWABLE = core.fuelsWhere(jp, 'renewable');
export const LOW_CARBON = ['nuclear', ...RENEWABLE];
// Fuels made in the nine areas, pumped storage included; batteries not.
export const GENERATION = core.totalFuels(jp);

export const generationTotal = (data) => core.generationTotal(data, jp);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, jp, members, opts);
/** TWh by fuel for each Japanese calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, jp);
/** Groups slots by Japanese calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, jp, init, add);
