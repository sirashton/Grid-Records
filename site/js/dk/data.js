// Denmark's view of the shared dataset code (core/dataset.js), bound to the
// Denmark country config.

import dk from '../countries/dk.js';
import * as core from '../core/dataset.js';

export const FUELS = dk.fuels;
export const FOSSIL = core.fuelsWhere(dk, 'fossil');
export const RENEWABLE = core.fuelsWhere(dk, 'renewable');
export const WIND = ['wind_onshore', 'wind_offshore'];
// The interconnectors, as data columns (positive into Denmark), with labels.
export const BORDERS = [
  ['net_no', 'Norway'],
  ['net_se', 'Sweden'],
  ['net_de', 'Germany'],
  ['net_nl', 'Netherlands'],
  ['net_gb', 'Great Britain'],
];
// Fuels made in Denmark; net imports not.
export const GENERATION = core.totalFuels(dk);

export const generationTotal = (data) => core.generationTotal(data, dk);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, dk, members, opts);
/** Groups slots by Danish calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, dk, init, add);
