// Belgium's view of the shared dataset code (core/dataset.js), bound to the
// Belgium country config.

import be from '../countries/be.js';
import * as core from '../core/dataset.js';

export const FUELS = be.fuels;
export const FOSSIL = core.fuelsWhere(be, 'fossil');
export const RENEWABLE = core.fuelsWhere(be, 'renewable');
export const WIND = ['wind_onshore', 'wind_offshore'];
export const LOW_CARBON = ['nuclear', ...RENEWABLE];
// Fuels made in Belgium, pumped storage included; imports and batteries not.
export const GENERATION = core.totalFuels(be);

export const generationTotal = (data) => core.generationTotal(data, be);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, be, members, opts);
/** TWh by fuel for each Belgian calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, be);
/** Groups slots by Belgian calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, be, init, add);
