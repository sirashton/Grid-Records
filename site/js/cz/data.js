// Czechia's view of the shared dataset code (core/dataset.js), bound to the
// Czechia country config.

import cz from '../countries/cz.js';
import * as core from '../core/dataset.js';

export const FUELS = cz.fuels;
export const FOSSIL = core.fuelsWhere(cz, 'fossil');
export const RENEWABLE = core.fuelsWhere(cz, 'renewable');
export const WIND = ['wind'];
export const LOW_CARBON = ['nuclear', ...RENEWABLE];
// Fuels made in Czechia, pumped storage included; imports and batteries not.
export const GENERATION = core.totalFuels(cz);

export const generationTotal = (data) => core.generationTotal(data, cz);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, cz, members, opts);
/** TWh by fuel for each Czech calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, cz);
/** Groups slots by Czech calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, cz, init, add);
