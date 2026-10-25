// Brazil's view of the shared dataset code (core/dataset.js), bound to the
// Brazil country config.

import br from '../countries/br.js';
import * as core from '../core/dataset.js';

export const FUELS = br.fuels;
export const FOSSIL = core.fuelsWhere(br, 'fossil');
export const RENEWABLE = core.fuelsWhere(br, 'renewable');
export const WIND = ['wind'];
export const SOLAR = ['solar_utility', 'solar_rooftop'];
export const WIND_SOLAR = [...WIND, ...SOLAR];
export const CURTAILED = ['wind_curtailed', 'solar_curtailed'];
// Fuels made in Brazil's interconnected system; what was held back is not.
export const GENERATION = core.totalFuels(br);

export const generationTotal = (data) => core.generationTotal(data, br);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, br, members, opts);
/** TWh by fuel for each Brazilian calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, br);
/** Groups slots by Brazilian calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, br, init, add);
