// Western Australia's view of the shared dataset code (core/dataset.js),
// bound to the WA country config.

import wa from '../countries/wa.js';
import * as core from '../core/dataset.js';

export const FUELS = wa.fuels;
export const FOSSIL = core.fuelsWhere(wa, 'fossil');
export const RENEWABLE = core.fuelsWhere(wa, 'renewable');
export const SOLAR = ['solar_utility', 'solar_rooftop'];
export const WIND_SOLAR = ['wind', ...SOLAR];

export const generationTotal = (data) => core.generationTotal(data, wa);
/** A metric series in GW, or as a percentage of generation. Missing slots are NaN. */
export const metricSeries = (data, members, opts) => core.metricSeries(data, wa, members, opts);
/** TWh by fuel for each Perth calendar year, with the renewable share. */
export const yearlyEnergy = (data) => core.yearlyEnergy(data, wa);
/** Groups slots by Perth calendar year, plus the latest 365 days. */
export const byYear = (data, init, add) => core.byYear(data, wa, init, add);
