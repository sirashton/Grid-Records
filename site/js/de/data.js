// Germany's view of the shared dataset code (core/dataset.js), bound to the
// Germany country config.

import de from '../countries/de.js';
import * as core from '../core/dataset.js';

export const FUELS = de.fuels;
export const FOSSIL = core.fuelsWhere(de, 'fossil');
export const RENEWABLE = core.fuelsWhere(de, 'renewable');
export const COAL = ['lignite', 'coal'];
export const WIND = ['wind_onshore', 'wind_offshore'];
// Fuels made in Germany, pumped storage included, imports not.
export const GENERATION = core.totalFuels(de);

export const generationTotal = (data) => core.generationTotal(data, de);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, de, members, opts);
/** TWh by fuel for each German calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, de);
/** Groups slots by German calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, de, init, add);
