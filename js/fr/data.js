// France's view of the shared dataset code (core/dataset.js), bound to the
// France country config.

import fr from '../countries/fr.js';
import * as core from '../core/dataset.js';

export const FUELS = fr.fuels;
export const FOSSIL = core.fuelsWhere(fr, 'fossil');
export const RENEWABLE = core.fuelsWhere(fr, 'renewable');
export const WIND = ['wind_onshore', 'wind_offshore'];
export const LOW_CARBON = ['nuclear', ...RENEWABLE];
// Fuels made in France, pumped storage included; imports and batteries not.
export const GENERATION = core.totalFuels(fr);

export const generationTotal = (data) => core.generationTotal(data, fr);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, fr, members, opts);
/** TWh by fuel for each French calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, fr);
/** Groups slots by French calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, fr, init, add);
