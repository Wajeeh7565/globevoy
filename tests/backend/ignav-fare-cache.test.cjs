'use strict';
// Offline: the 15-minute Ignav price memory (GV-IGNAV-CACHE-001). No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const ignav = require('../../backend/services/providers/flights/ignav/ignav');
const cache = require('../../backend/services/domain/live-fares/ignav-fare-cache');

const ENV = { ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'test-key-not-real' };
const payload = () => ({ observed_at: new Date().toISOString(), itineraries: [
  { ignav_id: 'cache-test-0001', price: { amount: 300, currency: 'CAD', status: 'verified' }, outbound: { carrier: 'TAP', duration_minutes: 420, segments: [{ marketing_carrier_code: 'TP', flight_number: '260', departure: { airport: 'YYZ', local_time: '2027-03-12T10:00:00' }, arrival: { airport: 'LIS', local_time: '2027-03-12T22:00:00' } }] } }] });
const fetchCounter = (status = 200) => { const f = async () => { f.calls++; return { ok: status === 200, status, text: async () => JSON.stringify(payload()) }; }; f.calls = 0; return f; };
const input = { origin: 'YYZ', destination: 'LIS', departureDate: '2027-03-12', adults: 1, children: 0, currency: 'CAD' };
function fakeDynamo() {
  const items = new Map();
  return { items, send: async c => { const i = c.input; const k = i.Key ? i.Key.sk.S : i.Item.sk.S;
    if (i.Item) { items.set(k, i.Item); return {}; } return { Item: items.get(k) }; } };
}
const fresh = () => cache._internal.memory.clear();

test('same flight within 15 minutes: one Ignav call, reuse is labelled and its booking proof is valid', async () => {
  fresh();
  const fetchFn = fetchCounter(), counter = {};
  const opts = { env: ENV, fetchFn, requestGuard: ignav._internal.createGuard(), sharedCache: false, counter };
  const a = await cache.searchOneWayCached(input, opts), b = await cache.searchOneWayCached(input, opts);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(fetchFn.calls, 1); assert.equal(b.fromCache, true);
  assert.deepEqual(counter, { calls: 1, cacheHits: 1 });
  assert.equal(b.cheapest.ignavId, 'cache-test-0001');
  assert.ok(ignav._internal.validProof(b.cheapest.ignavId, b.cheapest.bookingProof, ENV), 'booking proof re-signed');
  // Different party or date is a different flight search.
  await cache.searchOneWayCached({ ...input, adults: 2 }, opts);
  assert.equal(fetchFn.calls, 2);
});

test('after 15 minutes, and after a failure, Ignav is asked again', async () => {
  fresh();
  let now = Date.now();
  const fetchFn = fetchCounter();
  const opts = { env: ENV, fetchFn, requestGuard: ignav._internal.createGuard(), sharedCache: false, clock: () => now };
  await cache.searchOneWayCached(input, opts);
  now += cache.TTL_MS + 1000;
  await cache.searchOneWayCached(input, opts);
  assert.equal(fetchFn.calls, 2);
  fresh();
  const failing = fetchCounter(500), o2 = { ...opts, fetchFn: failing, clock: Date.now };
  const x = await cache.searchOneWayCached(input, o2), y = await cache.searchOneWayCached(input, o2);
  assert.equal(x.ok, false); assert.equal(y.ok, false); assert.equal(failing.calls, 2, 'failures are never remembered');
});

test('shared store: another Lambda instance reuses the stored price; store errors fall back to Ignav', async () => {
  fresh();
  const dynamo = fakeDynamo(), env = { ...ENV, FARE_MAP_TABLE: 'globevoy-fare-map' }, fetchFn = fetchCounter();
  const opts = { env, fetchFn, requestGuard: ignav._internal.createGuard(), dynamo };
  await cache.searchOneWayCached(input, opts);
  assert.equal(dynamo.items.size, 1);
  const stored = [...dynamo.items.values()][0];
  assert.equal(stored.pk.S, 'LIVE#ignav'); assert.ok(!stored.result.S.includes('bookingProof'), 'proofs are not stored');
  fresh(); // a different instance: empty memory
  const r = await cache.searchOneWayCached(input, opts);
  assert.equal(fetchFn.calls, 1); assert.equal(r.fromCache, true);
  fresh();
  const broken = { send: async () => { throw new Error('dynamo down'); } };
  const z = await cache.searchOneWayCached(input, { ...opts, dynamo: broken });
  assert.equal(z.ok, true); assert.equal(fetchFn.calls, 2);
});

test('live-fare step reports real calls and reuses remembered flights', async () => {
  fresh();
  const { applyIgnavLiveFares } = require('../../backend/services/domain/live-fares/ignav-live-fares');
  const fetchFn = fetchCounter();
  const tour = { legs: [{ mode: 'flight', from: { code: 'YYZ' }, to: { code: 'LIS' }, departureDate: '2027-03-12', estimatedTransportUsd: 400 }], stops: [] };
  const q = { currency: 'CAD', adults: '1' };
  const one = await applyIgnavLiveFares(tour, q, { env: ENV, fetchFn, fareCache: true, requestGuard: ignav._internal.createGuard() });
  const two = await applyIgnavLiveFares(tour, q, { env: ENV, fetchFn, fareCache: true, requestGuard: ignav._internal.createGuard() });
  assert.equal(one.summary.providerRequests, 1); assert.equal(two.summary.providerRequests, 0); assert.equal(two.summary.cacheHits, 1);
  assert.equal(fetchFn.calls, 1);
});
