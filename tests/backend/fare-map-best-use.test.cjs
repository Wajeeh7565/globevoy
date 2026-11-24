'use strict';
// Offline: best use of budget (GV-FAREMAP-BEST-USE-001, GV-HOTEL-BUDGET-UPGRADE-001).
// The page requests three trips by role in parallel; each role must get its own route,
// the best-balance pick should spend the budget well, and only it may upgrade hotels.
const test = require('node:test');
const assert = require('node:assert/strict');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { fixture } = require('./fare-map-fixtures.cjs');
const { applyNuiteeLiveStays, _internal: hotels } = require('../../backend/services/domain/live-fares/nuitee-live-stays');

const city = c => ({ unifiedRegistry: { origin: { providerLocationCode: c }, cityId: 'global-city-' + c.toLowerCase() } });
const state = (cities, cost, nights, estimatedDate = false) => ({ cities: cities.map(city), cost, estimatedDate, key: cities.join('>'), tour: { totalNights: nights, stops: [] } });

test('best-use order: in-band (80-95% of spendable) first, most nights first, real dates before estimates', () => {
  const { bestUseOrder } = optimizer._internal;
  const rows = [state(['AAA', 'BBB'], 500, 7), state(['CCC', 'DDD'], 850, 8), state(['EEE', 'FFF'], 900, 6), state(['GGG', 'HHH'], 990, 9), state(['III', 'JJJ'], 880, 12, true)];
  assert.deepEqual(bestUseOrder(rows, 1000).map(s => s.key), ['CCC>DDD', 'EEE>FFF', 'GGG>HHH', 'AAA>BBB', 'III>JJJ']);
  // None in band: the one closest to 80% wins, not simply the cheapest.
  assert.equal(bestUseOrder([state(['AAA', 'BBB'], 400, 7), state(['CCC', 'DDD'], 700, 7)], 1000)[0].key, 'CCC>DDD');
});

test('role candidates: three different routes, lowest cost really is the cheapest left, up to two backups each', () => {
  const { roleCandidates } = optimizer._internal;
  const ranked = [state(['AAA', 'BBB'], 500, 7), state(['AAA', 'CCC'], 600, 7), state(['DDD', 'EEE'], 850, 8), state(['FFF', 'GGG'], 700, 7)];
  const out = roleCandidates(ranked, 1000);
  const first = role => out[role][0].fareMapRole + ':' + out[role][0].budgetUse;
  assert.equal(first('best-balance'), 'best-balance:0.85');
  assert.equal(first('lowest-cost'), 'lowest-cost:0.5');
  assert.equal(out['most-memorable'][0].budgetUse, 0.7, 'shares no city with the other two picks');
  for (const list of Object.values(out)) assert.ok(list.length >= 1 && list.length <= 3);
  assert.equal(roleCandidates([], 1000), null);
});

test('optimizer returns role candidates inside the protected budget; tours[] order is unchanged', async () => {
  const f = fixture();
  const r = await optimizer.search(f.query, { ...f.options, rows: f.rows });
  assert.ok(r.roleCandidates, JSON.stringify(r.reason));
  const best = r.roleCandidates['best-balance'][0], low = r.roleCandidates['lowest-cost'][0];
  assert.ok(best.estimatedTotalUsd >= low.estimatedTotalUsd);
  for (const list of Object.values(r.roleCandidates)) for (const t of list) assert.ok(t.estimatedTotalUsd <= t.usableTripBudgetUsd);
  assert.equal(r.tours[0].estimatedTotalUsd, Math.min(...r.tours.map(t => t.estimatedTotalUsd)), 'default (no role) still starts with the cheapest');
});

test('trip builder: each requested role gets its own route; only best-balance passes a hotel budget', async () => {
  const f = fixture(), old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  const plus = optimizer._internal.plus;
  const env = { ...f.options.env, FARE_MAP_REQUIRE_LIVE: 'true', ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline', ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'offline-reference' };
  const liveFlights = async t => { const tour = structuredClone(t); tour.legs.forEach(l => { l.liveFareVerified = true; l.providerDateEvidence = { ...l.providerDateEvidence, provider: 'ignav', sourceType: 'LIVE', productionEligible: true, segments: [{ arriveLocal: plus(l.departureDate, 1) + 'T09:00:00' }] }; }); return { tour, summary: { applied: true, partial: false, providerRequests: 3 } }; };
  const seen = {};
  const liveHotels = role => async (t, q, options) => {
    seen[role] = options.hotelBudgetUsd ?? null;
    let tour = structuredClone(t);
    tour.stops.forEach(st => { const usd = st.hotel?.estimatedStayUsd || 0; st.hotel = { ...st.hotel, estimatedStayUsd: usd, totalStayUsd: usd, nuiteeLiveRate: { amount: usd, currency: 'USD', totalUsd: usd } }; });
    tour = require('../../backend/services/domain/pricing/traveller-pricing').applyTravellerPricingToTour(tour, f.query);
    return { tour, summary: { applied: true, appliedCount: tour.stops.length, stopCount: tour.stops.length } };
  };
  const gt = require('../../backend/services/domain/tours/generated-tour');
  try {
    const roles = ['best-balance', 'lowest-cost', 'most-memorable'];
    const results = await Promise.all(roles.map(role => gt.getGeneratedTour({ ...f.query, routeRole: role, pickRole: role }, { env, fareMap: { ...f.options, rows: f.rows }, applyIgnavLiveFares: liveFlights, applyNuiteeLiveStays: liveHotels(role) })));
    const keys = results.map(r => { assert.ok(r.tour, r.reason); return r.tour.stops.map(s => s.cityId).join('>'); });
    assert.equal(new Set(keys).size, 3, 'three different trips: ' + keys.join(' | '));
    results.forEach((r, i) => { assert.equal(r.diagnostics.fareMapRole, roles[i]); assert.equal(r.tour.tourRole, roles[i]); assert.ok(r.tour.stops.every(st => st.hotel?.nuiteeLiveRate)); });
    assert.ok(Number.isFinite(seen['best-balance']) && seen['best-balance'] > 0, 'best-balance gets a hotel budget');
    const best = results[0].tour;
    assert.ok(seen['best-balance'] <= best.usableTripBudgetUsd * 0.97, 'hotel budget keeps a 3% cushion');
    assert.equal(seen['lowest-cost'], null); assert.equal(seen['most-memorable'], null);
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
});

test('hotel upgrade: better-rated hotels only, longest stay first, never past the hotel budget', () => {
  const offer = (id, rating, amount) => ({ hotelId: id, rating, amount });
  const rows = [
    { applied: true, stayWindow: { nights: 3 }, offer: offer('a1', 7.2, 200), pool: [offer('a1', 7.2, 200), offer('a2', 8.9, 320), offer('a3', 6.0, 150)] },
    { applied: true, stayWindow: { nights: 5 }, offer: offer('b1', 7.5, 300), pool: [offer('b1', 7.5, 300), offer('b2', 9.1, 420), offer('b3', 9.6, 900)] }
  ];
  const r = hotels.upgradeHotels(rows, 650, 1);
  assert.equal(rows[1].offer.hotelId, 'b2', 'longer stay upgraded first, to the best it can afford');
  assert.equal(rows[0].offer.hotelId, 'a1', 'not enough left to upgrade the shorter stay');
  assert.equal(r.upgradedCount, 1); assert.ok(r.leftUsd >= 0);
  assert.ok(rows.reduce((s, x) => s + x.offer.amount, 0) <= 650);
  assert.equal(hotels.upgradeHotels(rows, undefined, 1), null, 'no hotel budget: no upgrade');
  assert.equal(hotels.upgradeHotels([{ ...rows[0] }, { applied: false }], 5000, 1).reason, 'not-all-hotels-priced');
});

test('live hotel pass: with a hotel budget it upgrades and labels the change; without it the cheap good hotel stays', async () => {
  const ENV = { ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'globevoy/production/nuitee' };
  const QUERY = { currency: 'USD', budget: '3000', adults: '1', rooms: '1', origin: 'YYZ' };
  const tour = () => ({ legs: [
    { mode: 'flight', from: { code: 'YYZ' }, to: { code: 'LIS' }, departureDate: '2027-03-12', estimatedTransportUsd: 600 },
    { mode: 'flight', from: { code: 'LIS' }, to: { code: 'BUD' }, departureDate: '2027-03-16', estimatedTransportUsd: 150 },
    { mode: 'flight', from: { code: 'BUD' }, to: { code: 'YYZ' }, departureDate: '2027-03-20', estimatedTransportUsd: 650 }],
  stops: [{ city: 'Lisbon', countryCode: 'PT', nights: 4, hotel: { estimatedStayUsd: 400 } }, { city: 'Budapest', countryCode: 'HU', nights: 4, hotel: { estimatedStayUsd: 350 } }] });
  const rate = (id, rating, amount) => ({ hotel: { id, hotelId: id, name: id, rating }, rate: { hotelId: id, roomTypes: [{ offerId: 'offer-' + id, offerRetailRate: { amount, currency: 'USD' }, rates: [{ name: 'Double', boardName: 'Room only', retailRate: { total: [{ amount, currency: 'USD' }], taxesAndFees: [{ included: true }] }, cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [] } }] }] } });
  const byCity = { Lisbon: [rate('lis-ok', 7.4, 380), rate('lis-great', 9.2, 560)], Budapest: [rate('bud-ok', 7.8, 300), rate('bud-great', 9.0, 520)] };
  const fetch = async (url, init) => { const rows = byCity[JSON.parse(init.body).cityName] || []; return { status: 200, text: async () => JSON.stringify({ data: rows.map(r => r.rate), hotels: rows.map(r => r.hotel) }) }; };
  const prodSecret = async () => JSON.stringify({ apiKey: 'prod_test_not_real' });
  const plain = await applyNuiteeLiveStays(tour(), QUERY, { env: ENV, getSecretValue: prodSecret, fetch });
  assert.deepEqual(plain.tour.stops.map(s => s.hotel.nuiteeHotelId), ['lis-ok', 'bud-ok']);
  assert.equal(plain.summary.budgetUpgrade, null);
  const up = await applyNuiteeLiveStays(tour(), QUERY, { env: ENV, getSecretValue: prodSecret, fetch, hotelBudgetUsd: 900 });
  assert.deepEqual(up.tour.stops.map(s => s.hotel.nuiteeHotelId), ['lis-great', 'bud-ok'], JSON.stringify(up.summary.budgetUpgrade));
  assert.equal(up.tour.stops[0].hotel.budgetUpgrade.fromHotelId, 'lis-ok');
  assert.ok(up.tour.stops.reduce((s, st) => s + st.hotel.totalStayUsd, 0) <= 900);
  assert.equal(up.summary.budgetUpgrade.upgradedCount, 1);
});

test('when every live check fails, the checked trip is shown as an estimate and the old search never runs', async () => {
  const f = fixture(), old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  const env = { ...f.options.env, FARE_MAP_REQUIRE_LIVE: 'true', ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline' };
  let calls = 0;
  const gt = require('../../backend/services/domain/tours/generated-tour');
  try {
    const r = await gt.getGeneratedTour({ ...f.query, routeRole: 'best-balance' }, { env, fareMap: { ...f.options, rows: f.rows },
      applyIgnavLiveFares: async t => { calls++; return { tour: { ...t, legs: t.legs.slice(0, 1) }, summary: { applied: true, providerRequests: 3 } }; } });
    assert.ok(r.tour, 'a trip is shown instead of an empty page');
    assert.equal(r.fareMapFallback, undefined, 'no second (old-engine) search');
    assert.equal(r.diagnostics.fareMapLiveOnlyUnmet, true);
    assert.equal(r.diagnostics.fareMapLiveAttempts.at(-1), 'shown-estimate-no-live-trip');
    // GV-HOTEL-MARGIN-001: the main pick may also try two cheaper lowest-cost trips.
    assert.ok(calls <= 5, 'at most five trips checked: ' + calls);
    assert.equal(r.diagnostics.ignavCalls, calls * 3, 'the response reports exactly how many Ignav calls were made');
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
});
