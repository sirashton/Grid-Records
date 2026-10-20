// Texas's view of the shared dataset code (core/dataset.js), bound to the
// ERCOT country config.

import tx from '../countries/tx.js';
import * as core from '../core/dataset.js';

export const FUELS = tx.fuels;
export const FOSSIL = core.fuelsWhere(tx, 'fossil');
export const RENEWABLE = core.fuelsWhere(tx, 'renewable');
export const LOW_CARBON = ['nuclear', ...RENEWABLE];
export const GENERATION = core.totalFuels(tx);

export const generationTotal = (data) => core.generationTotal(data, tx);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, tx, members, opts);
/** TWh by fuel for each Texas calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, tx);
/** Groups slots by Texas calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, tx, init, add);
