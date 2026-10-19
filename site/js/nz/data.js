// New Zealand's view of the shared dataset code (core/dataset.js), bound to
// the NZ country config.

import nz from '../countries/nz.js';
import * as core from '../core/dataset.js';

export const FUELS = nz.fuels;
export const FOSSIL = core.fuelsWhere(nz, 'fossil');
export const RENEWABLE = core.fuelsWhere(nz, 'renewable');

export const generationTotal = (data) => core.generationTotal(data, nz);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, nz, members, opts);
/** TWh by fuel for each NZ calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, nz);
/** Hours in each year with fossil generation below each threshold (MW). */
export const yearlyHoursBelow = (data, names, thresholdsMw) => core.yearlyHoursBelow(data, nz, names, thresholdsMw);
/** GWh by fuel for each NZ calendar day of the latest n whole days before slot end. */
export const dailyEnergy = (data, end, n) => core.dailyEnergy(data, nz, end, n);
