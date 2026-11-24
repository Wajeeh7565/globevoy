'use strict';
// Offline: trip shapes and options (GV-TRIP-SHAPE-001, GV-THREE-OPTIONS-002, GV-ONE-SITE-001).
// One-city trips for small budgets, three different options, a plain "no trip" message
// instead of a failure, and live checks that work for one city as well as two.
const test = require('node:test');
const assert = require('node:assert/strict');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { fixture } = require('./fare-map-fixtures.cjs');
const { plus, cityVibes, tripStory, roleCandidates, regionFamily } = optimizer._internal;

// Adds a flight home four days after arrival, so one-city trips can complete.
function withShortReturns(f) {
  for (const r of f.dest) {
    const c = optimizer._internal.code(r), key = c + '#2027-03', rows = f.map.get(key) || [];
    rows.push({ origin: c, destination: f.originCode, month: '2027-03', departureDate: '2027-03-05', priceUsd: 70, source: 'travelpayouts-cached', observedAt: rows[0].observedAt, stops: 0, durationMinutes: 90 });
    f.map.set(key, rows);
  }
  return f;
}
const flexible = f => { const q = { ...f.query }; delete q.destinationCount; delete q.nights; return q; };
const search = (f, query, options = {}) => optimizer.search(query, { ...f.options, rows: f.rows, ...options });

test('one-city trips: a flight home after the first city completes a trip; maxStops 1 gives only those', async () => {
  const f = withShortReturns(fixture());
  const r = await search(f, flexible(f));
  assert.ok(r.tours.length, JSON.stringify(r.reason));
  assert.deepEqual(r.diagnostics.cityCounts, [1, 2]);
  const one = await search(f, { ...flexible(f), maxStops: 1 });
  assert.ok(one.tours.length);
  for (const t of one.tours) {
    assert.equal(t.stops.length, 1); assert.equal(t.legs.length, 2); assert.equal(t.cityCount, 1);
    assert.equal(t.legs[1].to.airportCode, 'LHR'); assert.ok(t.estimatedTotalUsd <= t.usableTripBudgetUsd);
    assert.match(t.tripStory, /One base for \d+ nights/);
  }
});

test('a small budget gets a one-city trip instead of nothing', async () => {
  const f = withShortReturns(fixture());
  const two = await search(f, { ...f.query, budget: 560 });
  assert.equal(two.tours.length, 0, 'two cities do not fit 560');
  const r = await search(f, { ...flexible(f), budget: 560 });
  assert.ok(r.tours.length, JSON.stringify(r.reason));
  assert.ok(r.tours.every(t => t.stops.length === 1));
});

test('city vibes name what stands out, not what every city has; the story reads as one sentence per trip', () => {
  const lisbon = cityVibes('lisbon-pt'), vienna = cityVibes('vienna-at');
  assert.ok(lisbon.length >= 1 && lisbon.length <= 2);
  assert.notDeepEqual(lisbon, vienna);
  const story = tripStory([{ city: 'Lisbon', cityId: 'lisbon-pt', nights: 4, regionFamily: 'europe' }, { city: 'Vienna', cityId: 'vienna-at', nights: 4, regionFamily: 'europe' }]);
  assert.match(story, /^Lisbon for .+, then Vienna for .+\. Two different sides of Europe\.$/);
});

test('three options: best use, cheapest, and one from another part of the world when there is one', () => {
  const row = (c, cluster) => ({ unifiedRegistry: { origin: { providerLocationCode: c }, cityId: 'global-city-' + c.toLowerCase(), latitude: 0, longitude: 0, destination: { regionCluster: cluster } } });
  const st = (cities, cost) => ({ cities: cities.map(([c, cl]) => row(c, cl)), cost, estimatedDate: false, key: cities.map(x => x[0]).join('>'), tour: { totalNights: 7, stops: [] } });
  const ranked = [st([['BUF', 'north-america-east']], 500), st([['DTW', 'north-america-east']], 520), st([['CLE', 'north-america-east'], ['PIT', 'north-america-east']], 860), st([['LIS', 'southern-europe']], 840)];
  const out = roleCandidates(ranked, 1000);
  const city = role => out[role][0].fareMapRole && out[role][0].budgetUse;
  assert.equal(city('best-balance'), 0.86); assert.equal(city('lowest-cost'), 0.5);
  assert.equal(out['most-memorable'][0].budgetUse, 0.84, 'Lisbon: a new part of the world');
  assert.equal(regionFamily(row('LIS', 'southern-europe')), 'europe');
});

test('stretch idea: only a bigger trip a little over budget, never a main pick', async () => {
  const f = withShortReturns(fixture());
  const r = await search(f, { ...flexible(f), budget: 420 });
  const main = ['best-balance', 'lowest-cost', 'most-memorable'].flatMap(k => r.roleCandidates?.[k] || []);
  assert.ok(main.every(t => t.estimatedTotalUsd <= t.usableTripBudgetUsd));
  for (const t of r.roleCandidates?.stretch || []) {
    assert.ok(t.estimatedTotalUsd > t.usableTripBudgetUsd); assert.ok(t.stretchExtraUsd >= 20 && t.stretchExtraUsd <= 150);
    assert.equal(t.tourRole, 'stretch');
  }
});

test('no trip: a plain message and a budget that would work; the old engine is not started', async () => {
  const f = fixture(), old = { flag: process.env.ENABLE_GENERATED_TOUR_651A, fetch: global.fetch };
  process.env.ENABLE_GENERATED_TOUR_651A = 'true'; global.fetch = () => assert.fail('No provider or old-engine requests');
  try {
    const gt = require('../../backend/services/domain/tours/generated-tour');
    const r = await gt.getGeneratedTour({ ...f.query, budget: 150 }, { env: f.options.env, fareMap: { ...f.options, rows: f.rows } });
    assert.equal(r.tour, null); assert.ok(!r.fareMapFallback);
    assert.ok(r.noTrip && r.noTrip.title && r.noTrip.message, JSON.stringify(r.noTrip));
    assert.ok(r.noTrip.suggestedBudget > 150, 'says what budget would work');
    assert.doesNotMatch(r.noTrip.message, /fare-map|route-|provider/);
  } finally { global.fetch = old.fetch; if (old.flag === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old.flag; }
});

test('live check works for a one-city trip: both flights live, exact hotel dates', async () => {
  const f = withShortReturns(fixture()), old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  const env = { ...f.options.env, ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline' };
  const applyIgnavLiveFares = async t => { const tour = structuredClone(t); tour.legs.forEach(l => { l.liveFareVerified = true; l.providerDateEvidence = { ...l.providerDateEvidence, provider: 'ignav', sourceType: 'LIVE', productionEligible: true, segments: [{ arriveLocal: plus(l.departureDate, 0) + 'T15:00:00' }] }; }); return { tour, summary: { applied: true, providerRequests: tour.legs.length } }; };
  try {
    const r = await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour({ ...flexible(f), maxStops: 1 }, { env, fareMap: { ...f.options, rows: f.rows }, applyIgnavLiveFares, applyNuiteeLiveStays: async t => ({ tour: t, summary: { applied: false } }) });
    assert.ok(r.tour, JSON.stringify(r.reason));
    assert.equal(r.tour.cities.length, 1); assert.equal(r.tour.backendLegs.length, 2);
    assert.equal(r.diagnostics.arrivalDatesVerified, true);
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
});

test('backups are never another option\'s trip, so a failed live check cannot show one trip twice', () => {
  const row = c => ({ unifiedRegistry: { origin: { providerLocationCode: c }, cityId: 'global-city-' + c.toLowerCase(), latitude: 0, longitude: 0, destination: { regionCluster: 'southern-europe' } } });
  const ranked = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH', 'III'].map((c, i) => ({ cities: [row(c)], cost: 500 + i * 50, estimatedDate: false, key: c, tour: { totalNights: 6, stops: [] } }));
  const out = roleCandidates(ranked, 1000), seen = new Map();
  for (const [role, list] of Object.entries(out)) for (const t of list) {
    const k = t.estimatedTotalUsd + ':' + t.budgetUse;
    assert.ok(!seen.has(k), `${role} reuses ${seen.get(k)}'s trip`); seen.set(k, role);
  }
  assert.equal(Object.keys(out).length, 3);
});

test('above about C$1,500 the options are two-city trips; one city only when no two-city trip fits', async () => {
  const f = withShortReturns(fixture());
  assert.equal(optimizer.MULTI_CITY_FROM_USD, 1100);
  const big = await search(f, { ...flexible(f), budget: 5000 });
  assert.equal(big.diagnostics.multiCityFirst, true);
  for (const list of Object.values(big.roleCandidates)) for (const t of list) assert.equal(t.stops.length, 2);
  const small = await search(f, { ...flexible(f), budget: 1000 });
  assert.equal(small.diagnostics.multiCityFirst, false);
  assert.ok(small.tours.some(t => t.stops.length === 1));
  const onlyOne = await search(f, { ...flexible(f), budget: 5000, maxStops: 1 });
  assert.ok(onlyOne.tours.length && onlyOne.tours.every(t => t.stops.length === 1), 'maxStops 1 is still honoured');
});

test('zigzag two-city routes are left out while sensible ones exist', () => {
  const row = c => ({ unifiedRegistry: { origin: { providerLocationCode: c }, cityId: 'global-city-' + c.toLowerCase(), latitude: 0, longitude: 0, destination: { regionCluster: 'southern-europe' } } });
  const st = (a, b, cost, detour) => ({ cities: [row(a), row(b)], cost, detour, estimatedDate: false, key: a + '>' + b, tour: { totalNights: 8, stops: [] } });
  const out = roleCandidates([st('FLL', 'YVR', 850, 1.46), st('LIS', 'MUC', 860, 1.08), st('BCN', 'LIS', 700, 1.02), st('MBJ', 'YYC', 600, 1.84)], 1000);
  const all = Object.values(out).flat();
  assert.ok(all.length >= 2);
  assert.ok(all.every(t => t.budgetUse !== 0.85 && t.budgetUse !== 0.6), 'no zigzag route offered');
  const onlyZigzag = roleCandidates([st('FLL', 'YVR', 850, 1.46)], 1000);
  assert.equal(onlyZigzag['best-balance'].length, 1, 'better a zigzag than nothing');
});

test('an extra option that cannot be live-checked is left out; only the main pick may show estimates', async () => {
  const f = fixture(), old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  const env = { ...f.options.env, FARE_MAP_REQUIRE_LIVE: 'true', ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline' };
  const noLive = async t => ({ tour: t, summary: { applied: false, reason: 'provider-unavailable', providerRequests: 1 } });
  const gt = require('../../backend/services/domain/tours/generated-tour');
  try {
    const run = role => gt.getGeneratedTour({ ...f.query, routeRole: role, pickRole: role }, { env, fareMap: { ...f.options, rows: f.rows }, applyIgnavLiveFares: noLive });
    const extra = await run('most-memorable');
    assert.equal(extra.tour, null, 'no estimate-only extra option');
    const main = await run('best-balance');
    assert.ok(main.tour, 'main pick still shows a trip rather than a blank page');
    assert.ok(main.diagnostics.fareMapLiveAttempts.some(a => /^shown-/.test(a)), 'shown with its estimates labelled');
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
});

test('no cached fare home: the outbound fare stands in, and the trip is shown only if the return comes back live', async () => {
  const f = fixture();
  for (const [k, v] of f.map) if (!k.startsWith(f.originCode + '#')) f.map.set(k, v.filter(r => r.destination !== f.originCode));
  const r = await search(f, flexible(f));
  assert.ok(r.tours.length && r.diagnostics.mirroredReturnSeeds > 0);
  for (const t of r.tours) { assert.equal(t.fareMap.mirroredReturn, true); assert.equal(t.legs.at(-1).providerDateEvidence.dateEstimated, true); }
  const old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  const env = { ...f.options.env, FARE_MAP_REQUIRE_LIVE: 'true', ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline' };
  const gt = require('../../backend/services/domain/tours/generated-tour');
  const live = home => async t => { const tour = structuredClone(t); tour.legs.forEach((l, i) => { if (!home && i === tour.legs.length - 1) return; l.liveFareVerified = true; l.providerDateEvidence = { ...l.providerDateEvidence, provider: 'ignav', sourceType: 'LIVE', productionEligible: true, segments: [{ arriveLocal: plus(l.departureDate, 0) + 'T15:00:00' }] }; }); return { tour, summary: { applied: true, partial: !home, providerRequests: tour.legs.length } }; };
  try {
    const opts = applyIgnavLiveFares => ({ env, fareMap: { ...f.options, rows: f.rows }, applyIgnavLiveFares, applyNuiteeLiveStays: async t => ({ tour: t, summary: { applied: false } }) });
    const unconfirmed = await gt.getGeneratedTour({ ...flexible(f), routeRole: 'best-balance' }, opts(live(false)));
    assert.equal(unconfirmed.tour, null, 'a stand-in return is never shown unconfirmed');
    const confirmed = await gt.getGeneratedTour({ ...flexible(f), routeRole: 'best-balance', maxStops: 1 }, opts(live(true)));
    assert.ok(confirmed.tour, JSON.stringify(confirmed.diagnostics?.fareMapLiveAttempts));
    assert.equal(confirmed.tour.backendLegs.at(-1).providerDateEvidence.sourceType, 'LIVE');
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
});

test('real hotels over budget: cheapest real rooms tried once, else the trip is dropped and the page says live prices are higher', async () => {
  const f = fixture(), old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  const env = { ...f.options.env, FARE_MAP_REQUIRE_LIVE: 'true', ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline', ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'offline-reference' };
  const flights = async t => { const tour = structuredClone(t); tour.legs.forEach(l => { l.liveFareVerified = true; l.providerDateEvidence = { ...l.providerDateEvidence, provider: 'ignav', sourceType: 'LIVE', productionEligible: true, segments: [{ arriveLocal: plus(l.departureDate, 0) + 'T15:00:00' }] }; }); return { tour, summary: { applied: true, providerRequests: tour.legs.length } }; };
  const choices = [];
  const pricey = async (t, q, options) => { choices.push(options.hotelChoice || 'default'); let tour = structuredClone(t); tour.stops.forEach(st => { const usd = 5000, n = Math.max(1, st.nights || 1); st.hotel = { ...st.hotel, pricingIntegrity: { ...(st.hotel?.pricingIntegrity || {}), nightlyPerRoomUsd: usd / n }, estimatedNightlyUsd: usd / n, estimatedStayUsd: usd, totalStayUsd: usd, nuiteeLiveRate: { amount: usd, currency: 'USD', totalUsd: usd } }; }); tour = require('../../backend/services/domain/pricing/traveller-pricing').applyTravellerPricingToTour(tour, q); return { tour, summary: { applied: true, appliedCount: tour.stops.length, stopCount: tour.stops.length } }; };
  try {
    const r = await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour({ ...f.query, routeRole: 'best-balance' }, { env, fareMap: { ...f.options, rows: f.rows }, applyIgnavLiveFares: flights, applyNuiteeLiveStays: pricey });
    assert.equal(r.tour, null, 'never shown with the cheaper estimate');
    assert.ok(choices.includes('cheapest'), 'cheapest real rooms were tried');
    assert.match(r.noTrip.title, /Live prices came in just above your budget/);
    assert.equal(r.noTrip.suggestedBudget, Math.ceil(5000 * 1.15 / 50) * 50);
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
});

test('a repeat request with diversityExcludedRoutes never returns an excluded trip', async () => {
  const f = fixture(), old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  const gt = require('../../backend/services/domain/tours/generated-tour');
  try {
    const opts = { env: f.options.env, fareMap: { ...f.options, rows: f.rows } };
    const first = await gt.getGeneratedTour({ ...f.query, routeRole: 'best-balance' }, opts);
    const key = first.tour.cities.map(c => String(c.cityId || c.id || c.city).toLowerCase()).join('>');
    const again = await gt.getGeneratedTour({ ...f.query, routeRole: 'best-balance', diversityExcludedRoutes: JSON.stringify([key]) }, opts);
    assert.ok(again.tour);
    assert.notEqual(again.tour.cities.map(c => String(c.cityId || c.id || c.city).toLowerCase()).join('>'), key);
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
});
