import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YEARS, COSTS, batteryForFirm, unservedShare, batteryForShare, solarShape, cheapestSolar, gasCost, yearInputs } from '../site/js/solarcost.js';

// One day: 2 MW for 12 half hours (six hours), nothing for the other 36.
const day = Array.from({ length: 48 }, (_, i) => (i >= 18 && i < 30 ? 2 : 0));
const shape = Float64Array.from([...day, ...day, ...day]);

test('every cost series has a value for each year', () => {
  for (const [k, v] of Object.entries(COSTS)) assert.equal(v.length, YEARS.length, k);
});

test('batteryForFirm finds the overnight gap, after charging losses', () => {
  // With 1 MW of panels each day has 6 MWh spare and 18 MWh short, so the
  // shortfall grows by 12 MWh a day and no battery is ever enough.
  assert.equal(batteryForFirm(shape, 1, 1), 36);
  // With 4 MW of panels the surplus (42 MWh, 21 after a 50% round trip) refills
  // the battery each day, so it only has to cover evening to next morning: 18 MWh.
  assert.equal(batteryForFirm(shape, 4, 0.5), 18);
});

test('unservedShare is zero with the firm battery and grows as it shrinks', () => {
  const need = batteryForFirm(shape, 4, 0.87);
  assert.equal(unservedShare(shape, 4, need), 0);
  assert.ok(unservedShare(shape, 4, need / 2) > 0);
  const most = batteryForShare(shape, 4, 0.9);
  assert.ok(most < need);
  assert.ok(unservedShare(shape, 4, most) <= 0.1 + 1e-9);
});

test('solarShape scales output to the load factor', () => {
  const startMs = Date.UTC(2014, 0, 1);
  const days = 365 * 3 + 1;
  const solar = new Float64Array(days * 48);
  for (let d = 0; d < days; d++) for (let k = 18; k < 30; k++) solar[d * 48 + k] = 100 + d; // a growing fleet
  const s = solarShape({ columns: { solar }, length: solar.length, startMs }, 2015, 2015, 0.1);
  assert.equal(s.length, 365 * 48);
  const mean = s.reduce((a, v) => a + v, 0) / s.length;
  assert.ok(Math.abs(mean - 0.1) < 1e-9);
  assert.equal(solarShape({ columns: { solar }, length: solar.length, startMs }, 2013, 2015), null);
});

test('cheapestSolar trades panels against batteries', () => {
  const options = [{ panels: 10, mwh: 1000 }, { panels: 50, mwh: 100 }, { panels: 200, mwh: 10 }];
  const best = cheapestSolar(options, { panelPerMw: 500000, batteryPerMwh: 100000 });
  assert.equal(best.panels, 50);
  assert.ok(best.cost > 0 && best.panelShare > 0 && best.panelShare < 1);
});

test('a new gas plant costs more than running an existing one, and gas tracks fuel prices', () => {
  const k22 = YEARS.indexOf(2022);
  const k20 = YEARS.indexOf(2020);
  const g22 = gasCost(yearInputs(k22));
  const g20 = gasCost(yearInputs(k20));
  assert.ok(g22.newBuild > g22.existing);
  assert.ok(g22.existing > g20.existing * 2);
});
