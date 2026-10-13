import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attributeBatteries, sumDays, byMonth, shares, KEYS } from '../site/js/fifo.js';

const cols = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Float64Array.from(v)]));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
const k = (key) => KEYS.indexOf(key);

// Six half hours: charge 1 GW on wind, charge 1 GW on gas, then discharge.
function data(bat, extra = {}) {
  const n = bat.dis.length;
  return {
    startMs: Date.UTC(2026, 0, 1),
    length: n,
    columns: cols({
      wind: [10000, 0, 0, 0, 0, 0].slice(0, n),
      gas: [0, 10000, 5000, 5000, 5000, 5000].slice(0, n),
      other: [1000, 1000, 1000, 1000, 1000, 1000].slice(0, n),
      b1610_dis: bat.dis,
      b1610_chg: bat.chg,
      ...extra,
    }),
  };
}

test('discharge comes out in the order it was charged, less losses', () => {
  const d = data({ dis: [0, 0, 850, 850, 0, 0], chg: [-1000, -1000, 0, 0, 0, 0] });
  const { days, store } = attributeBatteries(d, { efficiency: 0.85, durationHours: 100 });
  const t = sumDays(days);
  near(t.charged, 1000);
  // First 425 MWh out is the wind half hour (wind 10000 of 11000, other 1000).
  near(t.discharged[k('wind')], 425 * (10000 / 11000));
  near(t.discharged[k('gas')], 425 * (10000 / 11000));
  near(t.unknown, 0);
  near(store.mwh, 0);
});

test('only net flow counts, and battery output is taken out of Other', () => {
  // Gross 500 out and 1500 in nets to 1000 in; Other drops from 1000 to 500.
  const d = data({ dis: [500, 0], chg: [-1500, 0] });
  const { store } = attributeBatteries(d, { efficiency: 1, durationHours: 100 });
  near(store.mwh, 500);
  near(store.mix[k('wind')], 500 * (10000 / 10500));
  near(store.mix[k('other')], 500 * (500 / 10500));
});

test('discharge with nothing stored is unexplained', () => {
  const d = data({ dis: [0, 2000, 0], chg: [-1000, 0, 0] });
  const t = sumDays(attributeBatteries(d, { efficiency: 1, durationHours: 100 }).days);
  near(t.unknown, 500);
  near(t.discharged.reduce((a, v) => a + v, 0), 500);
});

test('overflow writes off the oldest energy first', () => {
  // Capacity is 1 hour at the 1 GW peak, so 1000 MWh; 1500 MWh goes in.
  const d = data({ dis: [0, 0, 0, 1000, 1000, 0], chg: [-1000, -1000, -1000, 0, 0, 0] });
  const { days, store } = attributeBatteries(d, { efficiency: 1, durationHours: 1 });
  const t = sumDays(days);
  near(t.writtenOff, 500);
  // The wind half hour was dropped, so all output is from the two gas half hours.
  assert.ok(t.discharged[k('wind')] < 1e-6);
  near(t.discharged[k('gas')], 500 * (10000 / 11000) + 500 * (5000 / 6000));
  near(store.mwh, 0);
});

test('PN fills in where B1610 has no data', () => {
  const d = data({ dis: [NaN, 1000], chg: [NaN, 0] }, { pn_dis: [0, 0], pn_chg: [-1000, 0] });
  const t = sumDays(attributeBatteries(d, { efficiency: 1, durationHours: 100 }).days);
  assert.deepEqual(t.sources, { b1610: 1, pn: 1 });
  near(t.unknown, 0);
});

test('shares compare battery output with the grid', () => {
  const d = data({ dis: [0, 0, 1000, 0], chg: [-1000, -1000, 0, 0] });
  const [m] = byMonth(attributeBatteries(d, { efficiency: 1, durationHours: 100 }).days);
  const s = shares(m);
  near(s.dischargedMwh, 500);
  near(s.fossil, 0);
  near(s.lowCarbon, (10000 / 11000) * 100);
  // Other is 1000 MW less in the discharging half hour.
  near(s.gridFossil, (20000 / 33000) * 100);
});
