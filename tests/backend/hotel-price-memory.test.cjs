'use strict';
// Offline: hotel price memory (GV-HOTEL-MEMORY-001). Real Nuitee prices from live
// checks are remembered per city as a ratio to the model, and the search plans that
// city with it; storage errors never block a search.
const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../../backend/services/domain/live-fares/hotel-price-memory');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { fixture } = require('./fare-map-fixtures.cjs');

// A fake DynamoDB that keeps the one memory item.
function fakeDynamo() {
  const item = {};
  return {
    item,
    async send(c) {
      const name = c.constructor.name, input = c.input;
      if (name === 'GetItemCommand') return { Item: Object.keys(item).length ? { pk: { S: 'MEM#hotel' }, sk: { S: 'ratios' }, ...item } : undefined };
      if (name === 'PutItemCommand') { for (const k of Object.keys(item)) delete item[k]; const { pk, sk, ...rest } = input.Item; Object.assign(item, rest); return {}; }
      throw new Error('unexpected ' + name);
    }
  };
}
const env = { FARE_MAP_TABLE: 'globevoy-fare-map' };

test('records live vs model per city as a rolling ratio, and reads it back', async () => {
  memory._internal.reset();
  const dynamo = fakeDynamo(), opts = { env, dynamo, fresh: true };
  assert.equal(await memory.record([{ cityId: 'barcelona-es', estimateUsd: 400, liveUsd: 600 }], opts), 1);
  let map = await memory.load(opts);
  assert.equal(memory.ratioFor(map, 'barcelona-es'), 1.5);
  await memory.record([{ cityId: 'barcelona-es', estimateUsd: 400, liveUsd: 800 }], opts);
  map = await memory.load(opts);
  assert.equal(memory.ratioFor(map, 'barcelona-es'), 1.75, 'average of 1.5 and 2.0');
  assert.equal(memory.ratioFor(map, 'lisbon-pt'), null);
  await memory.record([{ cityId: 'x-y', estimateUsd: 100, liveUsd: 9999 }, { cityId: 'bad', estimateUsd: 0, liveUsd: 5 }], opts);
  assert.equal(memory.ratioFor(await memory.load(opts), 'x-y'), 3, 'clamped at 3x; bad rows skipped');
});

test('storage errors and no table: empty memory, nothing thrown', async () => {
  memory._internal.reset();
  const broken = { send: async () => { throw new Error('down'); } };
  assert.equal((await memory.load({ env, dynamo: broken, fresh: true })).size, 0);
  assert.equal(await memory.record([{ cityId: 'a-b', estimateUsd: 1, liveUsd: 2 }], { env, dynamo: broken }), 1);
  assert.equal((await memory.load({ env: {}, fresh: true })).size, 0);
  memory._internal.reset();
});

test('the search plans a city with its learned ratio instead of the general margin', async () => {
  const f = fixture();
  const base = await optimizer.search(f.query, { ...f.options, rows: f.rows });
  assert.ok(base.tours.length);
  const t = base.tours[0], cities = t.stops.map(s => s.cityId);
  // Teach the memory that these cities cost 3x the model: the trip no longer fits.
  const ratios = new Map(cities.map(c => [memory._internal.attr(c), { ratio: 3, n: 3, at: Date.now() }]));
  const learned = await optimizer.search(f.query, { ...f.options, rows: f.rows, hotelRatios: ratios });
  assert.ok(learned.diagnostics.learnedHotelCities > 0);
  assert.ok(!learned.tours.some(x => x.stops.map(s => s.cityId).join('>') === cities.join('>')), 'that trip is no longer offered');
  // Learned cheaper than the margin (ratio 1.0): planned at 1.05x, so more trips fit.
  const cheap = new Map(f.rows.map(r => [memory._internal.attr(r.unifiedRegistry.cityId), { ratio: 1, n: 3, at: Date.now() }]));
  const relaxed = await optimizer.search({ ...f.query, budget: 900 }, { ...f.options, rows: f.rows, hotelRatios: cheap });
  const strict = await optimizer.search({ ...f.query, budget: 900 }, { ...f.options, rows: f.rows });
  assert.ok(relaxed.tours.length >= strict.tours.length);
});

test('a live hotel check records what each hotel cost against the model', async () => {
  memory._internal.reset();
  const f = fixture(), old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  const plus = optimizer._internal.plus, dynamo = fakeDynamo();
  const envLive = { ...f.options.env, FARE_MAP_REQUIRE_LIVE: 'true', ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline', ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'offline-reference' };
  const flights = async t => { const tour = structuredClone(t); tour.legs.forEach(l => { l.liveFareVerified = true; l.providerDateEvidence = { ...l.providerDateEvidence, provider: 'ignav', sourceType: 'LIVE', productionEligible: true, segments: [{ arriveLocal: plus(l.departureDate, 0) + 'T15:00:00' }] }; }); return { tour, summary: { applied: true, providerRequests: tour.legs.length } }; };
  const hotels = async (t, q) => { let tour = structuredClone(t); tour.stops.forEach(st => { const usd = Math.round((Number(st.hotel?.estimatedStayUsd) || 100) * 1.2); st.hotel = { ...st.hotel, estimatedStayUsd: usd, totalStayUsd: usd, nuiteeLiveRate: { amount: usd, currency: 'USD', totalUsd: usd } }; }); tour = require('../../backend/services/domain/pricing/traveller-pricing').applyTravellerPricingToTour(tour, q); return { tour, summary: { applied: true, appliedCount: tour.stops.length, stopCount: tour.stops.length } }; };
  try {
    const r = await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour({ ...f.query, routeRole: 'best-balance', pickRole: 'best-balance' }, { env: envLive, fareMap: { ...f.options, rows: f.rows, dynamo }, applyIgnavLiveFares: flights, applyNuiteeLiveStays: hotels });
    assert.ok(r.tour, JSON.stringify(r.diagnostics?.fareMapLiveAttempts));
    assert.ok(r.diagnostics.hotelObservations >= 1, 'observations recorded');
    const stored = Object.keys(dynamo.item).filter(k => k.startsWith('r_'));
    assert.ok(stored.length >= 1);
    for (const k of stored) assert.ok(Math.abs(Number(dynamo.item[k].N) - 1.2) < 0.15, k + ' ' + dynamo.item[k].N);
  } finally { memory._internal.reset(); if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
});
