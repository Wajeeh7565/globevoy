'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { fixture } = require('./fare-map-fixtures.cjs');

test('route variants retain a cheap and a meaningfully longer date without crowding the pool', async () => {
  const f = fixture(4);
  const [first] = f.dest;
  const last = optimizer._internal.code(first);
  const home = f.map.get(last + '#2027-03').find(fare => fare.destination === f.originCode);
  f.map.get(last + '#2027-03').push({ ...home, departureDate: '2027-03-06', priceUsd: 50 });

  const q = { ...f.query, nights: undefined, destinationCount: undefined, maxStops: 1, budget: 3000 };
  const search = async flag => optimizer.search(q, { ...f.options, rows: f.rows, traceSearch: true,
    env: { ...f.options.env, FARE_MAP_ROUTE_VARIANTS: flag } });
  const baseline = await search('');
  const enabled = await search('on');
  const forCity = response => response.diagnostics.searchTrace.afterDedup.filter(x => x.route === last);
  assert.equal(forCity(baseline).length, 1);
  assert.equal(forCity(enabled).length, 2);
  assert.deepEqual(forCity(enabled).map(x => x.nights).sort(), [5, 8]);
  assert.equal(enabled.diagnostics.alternativeRouteVariants, 1);
  assert.equal(enabled.diagnostics.reads, baseline.diagnostics.reads);
  assert.deepEqual(enabled.diagnostics.searchTrace.beforeDedup, baseline.diagnostics.searchTrace.beforeDedup);
  assert.ok(enabled.diagnostics.searchTrace.depths.every(d => d.retained + d.discarded === d.generated));
  const key = t => t.stops.map(s => s.cityId).join('>');
  for (const tours of [enabled.pool, ...Object.values(enabled.roleCandidates)]) {
    assert.equal(tours.length, new Set(tours.map(key)).size);
    assert.ok(tours.every(t => t.estimatedTotalUsd <= t.usableTripBudgetUsd));
  }
});
