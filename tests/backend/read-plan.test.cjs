'use strict';
// Offline: read plan and onward shortlist for big trips (GV-RECS-READS-001, FARE_MAP_READ_PLAN=on).
const test = require('node:test');
const assert = require('node:assert/strict');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { fixture } = require('./fare-map-fixtures.cjs');
const B = require('../performance/recommendation-benchmark.cjs');
const flexible = f => { const q = { ...f.query }; delete q.destinationCount; delete q.nights; return q; };

test('onward potential: counts nearby cities in other countries, from the registry only', () => {
  const real = optimizer._internal.onwardPotential(optimizer._internal.rows());
  assert.ok(real.size > 100);
  for (const [, v] of real) { assert.ok(v.cities >= 0 && v.cities <= 12); assert.ok(v.countries >= 0); }
  assert.ok(real.get('lisbon-pt').countries > real.get('sydney-au').countries, 'Europe is denser across borders than Australia');
});

test('read plan: big budgets stay inside the read limit, explore 4 cities, and the default is unchanged', async () => {
  B.setOriginCodes(['YTO']);
  const run = env => optimizer.search({ origin: 'Toronto (YYZ)', budget: 10000, currency: 'CAD', adults: 1 }, { env: { ENABLE_FARE_MAP_OPTIMIZER: 'true', FARE_MAP_TABLE: 'benchmark', ...env }, now: B.NOW, readRoutes: B.fareReader() });
  const base = await run({}), plan = await run({ FARE_MAP_HUGE_MAX_CITIES: '4', FARE_MAP_READ_PLAN: 'on' });
  assert.equal(base.diagnostics.readPlan, false, 'off by default');
  assert.equal(plan.diagnostics.readPlan, true);
  assert.ok(plan.diagnostics.reads <= 96, String(plan.diagnostics.reads));
  const most = r => Math.max(...(r.pool || []).map(t => t.stops.length));
  assert.ok(most(plan) >= most(base), `${most(plan)} vs ${most(base)} cities`);
  const again = await run({ FARE_MAP_HUGE_MAX_CITIES: '4', FARE_MAP_READ_PLAN: 'on' });
  assert.deepEqual(again.pool.map(t => t.stops.map(s => s.cityId).join('>')), plan.pool.map(t => t.stops.map(s => s.cityId).join('>')), 'deterministic');
});

test('read plan does nothing for small budgets', async () => {
  const f = fixture();
  const r = await optimizer.search({ ...flexible(f), budget: 1500 }, { ...f.options, rows: f.rows, env: { ...f.options.env, FARE_MAP_READ_PLAN: 'on' } });
  assert.equal(r.diagnostics.bigBudget, false);
  assert.equal(r.diagnostics.readPlan, false);
});

test('refresh rotation: unseen trips that repeat the fewest seen cities, countries and months come first', () => {
  const t = (ids, m) => ({ stops: ids.map(id => ({ cityId: id, countryCode: id.split('-').pop().toUpperCase() })), legs: [{ departureDate: m + '-10' }] });
  const pool = [t(['nashville-us'], '2026-12'), t(['austin-us'], '2026-12'), t(['nashville-us', 'memphis-us'], '2027-01'), t(['lisbon-pt', 'madrid-es'], '2027-03'), t(['cancun-mx'], '2026-12')];
  const next = optimizer.rotateQueue(pool, ['nashville-us']);
  assert.equal(next.length, 4, 'the seen trip is gone');
  assert.equal(next[0].stops[0].cityId, 'lisbon-pt', 'no seen city, country or month');
  assert.equal(next.at(-1).stops[0].cityId, 'nashville-us', 'repeating Nashville goes last');
  assert.deepEqual(optimizer.rotateQueue(pool, []).map(x => x.stops[0].cityId), pool.map(x => x.stops[0].cityId), 'no seen trips: pool order');
});
