// Poland's view of the shared dataset code (core/dataset.js), bound to the
// Poland country config.

import pl from '../countries/pl.js';
import * as core from '../core/dataset.js';

export const FUELS = pl.fuels;
export const FOSSIL = core.fuelsWhere(pl, 'fossil');
export const RENEWABLE = core.fuelsWhere(pl, 'renewable');
export const COAL = ['coal', 'lignite'];
export const WIND = ['wind_onshore', 'wind_offshore'];
// Fuels made in Poland, pumped storage included; imports and batteries not.
export const GENERATION = core.totalFuels(pl);

export const generationTotal = (data) => core.generationTotal(data, pl);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, pl, members, opts);
/** TWh by fuel for each Polish calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, pl);
/** Groups slots by Polish calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, pl, init, add);
