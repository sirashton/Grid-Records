// Ontario's view of the shared dataset code (core/dataset.js), bound to the
// IESO country config.

import on from '../countries/on.js';
import * as core from '../core/dataset.js';

export const FUELS = on.fuels;
export const FOSSIL = core.fuelsWhere(on, 'fossil');
export const RENEWABLE = core.fuelsWhere(on, 'renewable');
export const LOW_CARBON = core.fuelsWhere(on, 'lowCarbon');
export const GENERATION = core.totalFuels(on);

export const generationTotal = (data) => core.generationTotal(data, on);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, on, members, opts);
/** TWh by fuel for each Ontario (Toronto time) calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, on);
/** Groups slots by Ontario (Toronto time) calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, on, init, add);
