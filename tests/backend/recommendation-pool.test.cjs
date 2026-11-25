'use strict';
// Offline: unified recommendation pool (GV-POOL-001) and big budgets (GV-BIG-BUDGET-001).
// One search builds a scored, varied pool; one request returns up to three live-checked
// trips; seen trips are skipped so refresh rotates; labels follow live prices.
const test = require('node:test');
const assert = require('node:assert/strict');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { fixture } = require('./fare-map-fixtures.cjs');
const { plus, buildPool, poolSimilarity, stayValid } = optimizer._internal;

const flexible = f => { const q = { ...f.query }; delete q.destinationCount; delete q.nights; return q; };
const search = (f, query, options = {}) => optimizer.search(query, { ...f.options, rows: f.rows, ...options });
const key = t => t.stops.map(s => s.cityId).join('>');

// Live flights and hotels at the planned prices (no provider calls).
const liveFlights = async t => { const tour = structuredClone(t); tour.legs.forEach(l => { l.liveFareVerified = true; l.providerDateEvidence = { ...l.providerDateEvidence, provider: 'ignav', sourceType: 'LIVE', productionEligible: true, segments: [{ arriveLocal: plus(l.departureDate, 0) + 'T15:00:00' }] }; }); return { tour, summary: { applied: true, providerRequests: tour.legs.length } }; };
const liveHotels = async t => { const tour = structuredClone(t); (tour.stops || []).forEach(st => { const usd = Number(st.hotel?.estimatedStayUsd) || 100; st.hotel = { ...st.hotel, nuiteeLiveRate: { amount: usd, currency: 'USD', totalUsd: usd } }; }); return { tour, summary: { applied: true, appliedCount: tour.stops.length, stopCount: tour.stops.length } }; };
const LIVE_ENV = { FARE_MAP_REQUIRE_LIVE: 'true', ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline', ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'offline-reference' };

async function poolRequest(f, extra = {}, hooks = {}) {
  const old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  try {
    return await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour({ ...flexible(f), pool: '1', ...extra },
      { env: { ...f.options.env, ...LIVE_ENV }, fareMap: { ...f.options, rows: f.rows }, applyIgnavLiveFares: hooks.flights || liveFlights, applyNuiteeLiveStays: hooks.hotels || liveHotels });
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
}

test('the search returns a scored pool of distinct trips, at most 12, the same for the same search', async () => {
  const f = fixture();
  const a = await search(f, flexible(f)), b = await search(f, flexible(f));
  assert.ok(a.pool.length >= 3 && a.pool.length <= optimizer.POOL_SIZE, 'pool ' + a.pool.length);
  assert.equal(new Set(a.pool.map(key)).size, a.pool.length, 'no repeated trip');
  assert.deepEqual(a.pool.map(key), b.pool.map(key), 'deterministic: rotation is stable');
  a.pool.forEach((t, i) => { assert.equal(t.poolRank, i + 1); assert.ok(Number.isFinite(t.poolScore)); });
  assert.equal(a.diagnostics.poolSize, a.pool.length);
});

test('variety: the next pick avoids cities already picked when a different trip exists', () => {
  const row = (c, cl, lat = 0) => ({ unifiedRegistry: { origin: { providerLocationCode: c }, cityId: c.toLowerCase(), latitude: lat, longitude: 0, destination: { regionCluster: cl } } });
  const st = (cities, cost, date) => ({ cities: cities.map(([c, cl]) => row(c, cl)), cost, key: cities.map(x => x[0]).join('>'), estimatedDate: false, edges: [{ departureDate: date }], tour: { totalNights: 8, stops: cities.map(([c]) => ({ cityId: c })), legs: [{ departureDate: date }] } });
  const ranked = [st([['LIS', 'southern-europe'], ['MAD', 'southern-europe']], 850, '2027-03-01'), st([['LIS', 'southern-europe'], ['POR', 'southern-europe']], 860, '2027-03-02'), st([['CUN', 'mexico-central-america-caribbean']], 840, '2027-04-01')];
  const pool = buildPool(ranked, 1000, {});
  assert.equal(pool.length, 3);
  const lisbon = t => t.stops.some(s => s.cityId === 'LIS');
  assert.ok(!(lisbon(pool[0]) && lisbon(pool[1])), 'the first two picks are not both Lisbon trips');
  assert.ok(pool.slice(0, 2).some(t => t.stops[0].cityId === 'CUN'), 'Cancun is picked early for variety');
  assert.equal(poolSimilarity({ cities: new Set(['A']), families: new Set(['x']), month: 'm', size: 1 }, { cities: new Set(['A']), families: new Set(['y']), month: 'n', size: 2 }), 1);
});

test('pool request: up to three live trips, labels follow live prices, nothing estimated', async () => {
  const f = fixture();
  const r = await poolRequest(f);
  assert.equal(r.poolMode, true);
  assert.ok(r.tours.length >= 1 && r.tours.length <= 3, String(r.tours.length));
  for (const t of r.tours) assert.ok(t.backendLegs.every(l => l.providerDateEvidence?.sourceType === 'LIVE'));
  const roles = r.tours.map(t => t.tourRole);
  assert.equal(new Set(roles).size, roles.length, 'each label once');
  if (r.tours.length > 1) {
    const cheap = r.tours.find(t => t.tourRole === 'lowest-cost');
    const others = r.tours.filter(t => t.tourRole !== 'best-balance');
    assert.equal(cheap.estimatedTotalUsd, Math.min(...others.map(t => t.estimatedTotalUsd)), 'Lowest cost is the real cheapest among the non-main trips');
  }
  assert.equal(r.poolShownRoutes.length, r.tours.length);
  assert.ok(r.diagnostics.poolChecks <= 8);
});

test('refresh rotates: trips already seen are skipped until the pool is used up', async () => {
  const f = fixture();
  const first = await poolRequest(f);
  const second = await poolRequest(f, { seenRoutes: JSON.stringify(first.poolShownRoutes) });
  const seen = new Set(first.poolShownRoutes);
  for (const k of second.poolShownRoutes) assert.ok(!seen.has(k), 'no repeat: ' + k);
  if (first.poolSize > first.tours.length) assert.ok(second.tours.length >= 1, 'next trips come from the pool');
  const all = [...first.poolShownRoutes, ...second.poolShownRoutes];
  const third = await poolRequest(f, { seenRoutes: JSON.stringify(all) });
  assert.equal(third.poolRemaining + third.tours.length + all.length <= first.poolSize, true);
});

test('a trip that fails its live check is replaced by the next pool trip', async () => {
  const f = fixture();
  let n = 0;
  const flakyFlights = async t => { n++; return n === 1 ? { tour: t, summary: { applied: false, reason: 'provider-unavailable' } } : liveFlights(t); };
  const r = await poolRequest(f, {}, { flights: flakyFlights });
  assert.ok(r.diagnostics.fareMapLiveAttempts.includes('fare-map-flights-not-all-live'));
  assert.ok(r.tours.length >= Math.min(3, r.poolSize - 1), 'filled from the pool');
});

test('the old per-option requests are unchanged by pool mode', async () => {
  const f = fixture();
  const old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  try {
    const r = await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour({ ...f.query, routeRole: 'best-balance' }, { env: f.options.env, fareMap: { ...f.options, rows: f.rows } });
    assert.ok(r.tour); assert.ok(!r.poolMode);
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
});

test('big budgets: up to 3 cities and 3 extra nights per city; off switch and explicit caps respected', async () => {
  assert.equal(optimizer.BIG_BUDGET_FROM_USD, 2900);
  const row = { unifiedRegistry: { destination: { minimumRecommendedNights: 2, maximumRecommendedNights: 6 } } };
  assert.equal(stayValid(row, 8), false); assert.equal(stayValid(row, 8, 3), true); assert.equal(stayValid(row, 10, 3), false);
  const f = fixture();
  const big = await search(f, { ...flexible(f), budget: 9000 });
  assert.equal(big.diagnostics.bigBudget, true); assert.equal(big.requested.maxStops, 3);
  const off = await search(f, { ...flexible(f), budget: 9000 }, { env: { ...f.options.env, FARE_MAP_BIG_BUDGET: 'off' } });
  assert.equal(off.diagnostics.bigBudget, false); assert.equal(off.requested.maxStops, 2);
  const capped = await search(f, { ...flexible(f), budget: 9000 }, { env: { ...f.options.env, FARE_MAP_MAX_CITIES: '2' } });
  assert.equal(capped.requested.maxStops, 2);
  const small = await search(f, { ...flexible(f), budget: 2000 });
  assert.equal(small.diagnostics.bigBudget, false);
});

// GV-ROUTE-001: trips that glue far-apart regions together are never picked.
test('odd routes: the live Punta Cana > Vancouver > Manila trip is rejected, normal trips are not', () => {
  const O = require('../../backend/services/domain/fare-map/fare-map-optimizer.js');
  const c = (lat, lng, region) => ({ unifiedRegistry: { latitude: lat, longitude: lng, worldRegion: region } });
  const zig = { detour: 1.24, cities: [c(18.58, -68.4, 'caribbean'), c(49.28, -123.12, 'north-america'), c(14.6, 120.98, 'southeast-asia')] };
  const iberia = { detour: 1.05, cities: [c(41.39, 2.17, 'southern-europe'), c(38.72, -9.14, 'southern-europe')] };
  const east = { detour: 1.1, cities: [c(45.42, -75.7, 'north-america'), c(40.71, -74, 'north-america'), c(44.65, -63.57, 'north-america')] };
  const three = { detour: 1.2, cities: [c(25.2, 55.27, 'middle-east'), c(41.0, 28.97, 'europe'), c(30.04, 31.24, 'africa')] };
  assert.ok(O.MAX_SPREAD_KM === 4500);
  assert.ok(O._internal.routeShape(zig).spreadKm > 4500);
  assert.equal(O._internal.oddRoute(zig), true);
  assert.equal(O._internal.oddRoute(three), true, 'three cities in three different regions');
  assert.equal(O._internal.oddRoute(iberia), false);
  assert.equal(O._internal.oddRoute(east), false);
  assert.equal(O._internal.oddRoute({ detour: 1.3, cities: iberia.cities }), true, 'old detour rule still applies');
});
