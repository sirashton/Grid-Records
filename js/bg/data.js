// Bulgaria's view of the shared dataset code (core/dataset.js), bound to the
// Bulgaria country config.

import bg from '../countries/bg.js';
import * as core from '../core/dataset.js';

export const FUELS = bg.fuels;
export const FOSSIL = core.fuelsWhere(bg, 'fossil');
export const RENEWABLE = core.fuelsWhere(bg, 'renewable');
export const LOW_CARBON = ['nuclear', ...RENEWABLE];
// Fuels made in Bulgaria, pumped storage included; imports and batteries not.
export const GENERATION = core.totalFuels(bg);

export const generationTotal = (data) => core.generationTotal(data, bg);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, bg, members, opts);
/** TWh by fuel for each Bulgarian calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, bg);
/** Groups slots by Bulgarian calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, bg, init, add);
