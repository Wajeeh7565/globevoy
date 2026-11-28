'use strict';
// GV-RECS-V2-STEP1: one budget-use target on the entered budget, and recorded miss reasons.
const test = require('node:test');
const assert = require('node:assert/strict');
const opt = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const I = opt._internal;

test('target band is a share of the ENTERED budget, measured on spendable (90%)', () => {
  assert.equal(I.targetBand({}), null);
  assert.equal(I.targetBand({ FARE_MAP_TARGET_BAND: 'x' }), null);
  const b = I.targetBand({ FARE_MAP_TARGET_BAND: '85-90' });
  assert.ok(Math.abs(b[0] - 0.85 / 0.9) < 1e-9 && b[1] === 1);
  assert.equal(I.bandFit(0.95, b), 1);
  assert.ok(I.bandFit(0.70, b) < I.bandFit(0.85, b) && I.bandFit(0.85, b) < 1);
  assert.equal(I.bandFit(0.40, b), 0);
});

test('requirement check counts trip shapes and names the main reason for a miss', () => {
  const city = cc => ({ unifiedRegistry: { countryCode: cc } });
  const st = (ccs, cost) => ({ cities: ccs.map(city), cost });
  const trace = { searchTrace: { depths: [{ depth: 0, rejected: { 'invalid-or-stale-fare': 999 } }, { depth: 1, rejected: { 'invalid-or-stale-fare': 40, 'protected-budget': 10, 'maximum-city-count': 5 }, discarded: 7 }] } };
  const one = I.requirementCheck([st(['FR'], 900), st(['US'], 950)], trace, 1500, 1000, 'CA');
  assert.deepEqual([one.need, one.multiCountry, one.missReason, one.rejections.flights], ['multi-country', 0, 'flights', 40]);
  const ok = I.requirementCheck([st(['FR', 'IT'], 960)], trace, 1500, 1000, 'CA');
  assert.deepEqual([ok.multiCountry, ok.missReason], [1, null]);
  assert.equal(I.requirementCheck([], { ...trace, bounded: true }, 1200, 1000, 'CA').missReason, 'search-time-limit');
  assert.equal(I.requirementCheck([st(['FR'], 500)], {}, 800, 700, 'CA').need, null);
});
