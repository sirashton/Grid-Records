// The GB page's view of the shared dataset code (core/dataset.js), bound to
// the GB country config.

import gb from './countries/gb.js';
import * as core from './core/dataset.js';

export const { loadData, lastComplete } = core;
export const FUELS = gb.fuels;

export const BATTERY_SOURCES = {
  pn: 'Elexon planned output (PN)',
  b1610: 'Elexon metered output (B1610)',
};

/**
 * A metric series in GW, or as a percentage of total generation. Battery
 * discharge counts as zero before the chosen source has data.
 */
export const metricSeries = (data, members, opts) => core.metricSeries(data, gb, members, opts);
export const generationTotal = (data) => core.generationTotal(data, gb);
