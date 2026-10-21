// Colombia's view of the shared dataset code (core/dataset.js), bound to the
// XM country config.

import co from '../countries/co.js';
import * as core from '../core/dataset.js';

export const FUELS = co.fuels;
export const FOSSIL = core.fuelsWhere(co, 'fossil');
export const RENEWABLE = core.fuelsWhere(co, 'renewable');
export const LOW_CARBON = RENEWABLE;
export const GENERATION = core.totalFuels(co);

export const generationTotal = (data) => core.generationTotal(data, co);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, co, members, opts);
/** TWh by fuel for each Colombian calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, co);
/** Groups slots by Colombian calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, co, init, add);
