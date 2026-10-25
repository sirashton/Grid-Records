// The United States' view of the shared dataset code (core/dataset.js), bound to the
// EIA-930 country config.

import us from '../countries/us.js';
import * as core from '../core/dataset.js';

export const FUELS = us.fuels;
export const FOSSIL = core.fuelsWhere(us, 'fossil');
export const RENEWABLE = core.fuelsWhere(us, 'renewable');
export const LOW_CARBON = ['nuclear', ...RENEWABLE];
// Fuels generated in the lower 48, pumped storage included; imports and batteries not.
export const GENERATION = core.totalFuels(us);

export const generationTotal = (data) => core.generationTotal(data, us);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, us, members, opts);
/** TWh by fuel for each calendar year (US Eastern time), with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, us);
/** Groups slots by calendar year (US Eastern time), plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, us, init, add);
