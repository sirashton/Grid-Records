// Greece's view of the shared dataset code (core/dataset.js), bound to the
// Greece country config.

import gr from '../countries/gr.js';
import * as core from '../core/dataset.js';

export const FUELS = gr.fuels;
export const FOSSIL = core.fuelsWhere(gr, 'fossil');
export const RENEWABLE = core.fuelsWhere(gr, 'renewable');
export const WIND = ['wind'];
// No nuclear: low carbon is the renewables.
export const LOW_CARBON = RENEWABLE;
// Fuels made in Greece, pumped storage included; imports and batteries not.
export const GENERATION = core.totalFuels(gr);

export const generationTotal = (data) => core.generationTotal(data, gr);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, gr, members, opts);
/** TWh by fuel for each Greek calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, gr);
/** Groups slots by Greek calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, gr, init, add);
