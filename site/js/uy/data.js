// Uruguay's view of the shared dataset code (core/dataset.js), bound to the
// ADME country config.

import uy from '../countries/uy.js';
import * as core from '../core/dataset.js';

export const FUELS = uy.fuels;
export const FOSSIL = core.fuelsWhere(uy, 'fossil');
export const RENEWABLE = core.fuelsWhere(uy, 'renewable');
export const HYDRO = ['hydro_salto', 'hydro_negro'];
export const GENERATION = core.totalFuels(uy);

export const generationTotal = (data) => core.generationTotal(data, uy);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, uy, members, opts);
/** TWh by fuel for each Uruguayan calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, uy);
/** Groups slots by Uruguayan calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, uy, init, add);
