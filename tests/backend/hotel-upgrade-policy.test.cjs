'use strict';
// Offline: hotel upgrades by trip role (GV-HOTEL-UPGRADE-002, HOTEL_UPGRADE_POLICY=roles).
// Lowest cost: none. Best use: up to +50% per stay. Something different: up to +25%.
// Upgrades must be meaningful, never forced, and keep the trip within 90% of the
// entered budget (the reserve counted once). Off by default: the legacy rule is unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const hotels = require('../../backend/services/domain/live-fares/nuitee-live-stays')._internal;
const { applyNuiteeLiveStays } = require('../../backend/services/domain/live-fares/nuitee-live-stays');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { fixture } = require('./fare-map-fixtures.cjs');
const { plus } = optimizer._internal;

const offer = (id, rating, amount, boardName = 'Room only') => ({ hotelId: id, rating, amount, boardName });
const rows = () => [
  { applied: true, stayWindow: { nights: 5 }, offer: offer('a1', 7.4, 400), pool: [offer('a1', 7.4, 400), offer('a2', 7.6, 420), offer('a3', 8.6, 580), offer('a4', 9.3, 700)] },
  { applied: true, stayWindow: { nights: 3 }, offer: offer('b1', 7.8, 300), pool: [offer('b1', 7.8, 300), offer('b2', 7.8, 330, 'Breakfast included'), offer('b3', 9.0, 420)] }
];

test('Best use policy: at most +50% per stay, meaningful gains only', () => {
  const r = rows(), out = hotels.upgradeHotels(r, 5000, 1, { role: 'best-balance', perStayPct: 0.5, minGain: 0.5 });
  assert.equal(r[0].offer.hotelId, 'a3', '+45% for 8.6; the 9.3 at +75% is over the per-stay limit');
  assert.equal(r[1].offer.hotelId, 'b3', '+40% for 9.0');
  assert.ok(r[0].upgraded.extraUsd <= 200 && r[1].upgraded.extraUsd <= 150);
  assert.equal(out.upgradedCount, 2); assert.equal(out.policy.role, 'best-balance');
});

test('Something different policy: at most +25% per stay; +0.2 is not an upgrade; breakfast at the same score is', () => {
  const r = rows(); hotels.upgradeHotels(r, 5000, 1, { role: 'most-memorable', perStayPct: 0.25, minGain: 0.5 });
  assert.equal(r[0].offer.hotelId, 'a1', '7.6 (+0.2) is not meaningful; 8.6 is +45%, over +25%');
  assert.equal(r[1].offer.hotelId, 'b2', 'breakfast added at the same score, +10%');
  assert.equal(hotels.meaningful(offer('x', 7.4, 1), offer('y', 7.9, 1), 0.5), true);
  assert.equal(hotels.meaningful(offer('x', 7.4, 1), offer('y', 7.6, 1), 0.5), false);
});

test('the whole-trip hotel budget still binds under a policy', () => {
  const r = rows(); const out = hotels.upgradeHotels(r, 400 + 300 + 100, 1, { role: 'best-balance', perStayPct: 0.5, minGain: 0.5 });
  assert.ok(r.reduce((s, x) => s + x.offer.amount, 0) <= 800, JSON.stringify(out));
  assert.equal(hotels.upgradeHotels(rows(), 650, 1, { perStayPct: 0.5 }).upgradedCount, 0, 'no money left: nothing changes');
});

test('rate cache: pricing the same stays twice sends each hotel search once', async () => {
  const ENV = { ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'globevoy/production/nuitee' };
  const QUERY = { currency: 'USD', budget: '3000', adults: '1', rooms: '1', origin: 'YYZ' };
  const tour = () => ({ legs: [
    { mode: 'flight', from: { code: 'YYZ' }, to: { code: 'LIS' }, departureDate: '2027-03-12', estimatedTransportUsd: 600 },
    { mode: 'flight', from: { code: 'LIS' }, to: { code: 'YYZ' }, departureDate: '2027-03-17', estimatedTransportUsd: 600 }],
  stops: [{ city: 'Lisbon', countryCode: 'PT', nights: 5, hotel: { estimatedStayUsd: 400 } }] });
  const rate = (id, rating, amount) => ({ hotel: { id, hotelId: id, name: id, rating }, rate: { hotelId: id, roomTypes: [{ offerId: 'o-' + id, offerRetailRate: { amount, currency: 'USD' }, rates: [{ name: 'Double', boardName: 'Room only', retailRate: { total: [{ amount, currency: 'USD' }], taxesAndFees: [{ included: true }] }, cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [] } }] }] } });
  const list = [rate('ok', 7.4, 380), rate('great', 9.2, 540), rate('lux', 9.6, 900)];
  let calls = 0;
  const fetch = async () => { calls++; return { status: 200, text: async () => JSON.stringify({ data: list.map(r => r.rate), hotels: list.map(r => r.hotel) }) }; };
  const prodSecret = async () => JSON.stringify({ apiKey: 'prod_test_not_real' });
  const rateCache = new Map();
  const plain = await applyNuiteeLiveStays(tour(), QUERY, { env: ENV, getSecretValue: prodSecret, fetch, rateCache });
  const up = await applyNuiteeLiveStays(tour(), QUERY, { env: ENV, getSecretValue: prodSecret, fetch, rateCache, hotelBudgetUsd: 5000, upgradePolicy: { role: 'best-balance', perStayPct: 0.5, minGain: 0.5 } });
  assert.equal(calls, 1, 'second pass reused the reply');
  assert.equal(plain.tour.stops[0].hotel.nuiteeHotelId, 'ok');
  assert.equal(up.tour.stops[0].hotel.nuiteeHotelId, 'great', '+42% to 9.2; 9.6 is +137%');
  assert.equal(up.summary.providerRequests, 0);
  assert.equal(up.tour.stops[0].hotel.budgetUpgrade.role, 'best-balance');
});

// Pool request with fake live checks: record every hotel pricing call.
const LIVE_ENV = { FARE_MAP_REQUIRE_LIVE: 'true', ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline', ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'offline-reference' };
const liveFlights = async t => { const tour = structuredClone(t); tour.legs.forEach(l => { l.liveFareVerified = true; l.providerDateEvidence = { ...l.providerDateEvidence, provider: 'ignav', sourceType: 'LIVE', productionEligible: true, segments: [{ arriveLocal: plus(l.departureDate, 0) + 'T15:00:00' }] }; }); return { tour, summary: { applied: true, providerRequests: tour.legs.length } }; };
function hotelHook(calls) {
  const pricing = require('../../backend/services/domain/pricing/traveller-pricing');
  return async (t, q, options) => {
    calls.push({ budget: options.hotelBudgetUsd ?? null, policy: options.upgradePolicy || null, cache: options.rateCache instanceof Map, key: t.stops.map(s => s.cityId).join('>') });
    let tour = structuredClone(t);
    let left = options.hotelBudgetUsd ? options.hotelBudgetUsd - tour.stops.reduce((s, st) => s + (Number(st.hotel?.estimatedStayUsd) || 100), 0) : 0;
    tour.stops.forEach(st => {
      let usd = Number(st.hotel?.estimatedStayUsd) || 100, extra = 0;
      if (options.upgradePolicy) { extra = Math.min(Math.floor(usd * options.upgradePolicy.perStayPct), left); left -= extra; }
      usd += extra;
      st.hotel = { ...st.hotel, estimatedStayUsd: usd, totalStayUsd: usd, nuiteeLiveRate: { amount: usd, currency: 'USD', totalUsd: usd }, ...(extra > 0 ? { budgetUpgrade: { extraUsd: extra } } : {}) };
    });
    tour = pricing.applyTravellerPricingToTour(tour, q);
    return { tour, summary: { applied: true, appliedCount: tour.stops.length, stopCount: tour.stops.length } };
  };
}
async function poolRequest(f, env, calls) {
  const old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  const q = { ...f.query }; delete q.destinationCount; delete q.nights;
  try {
    return await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour({ ...q, budget: String(Number(q.budget) * 3), pool: '1' },
      { env: { ...f.options.env, ...LIVE_ENV, ...env }, fareMap: { ...f.options, rows: f.rows }, applyIgnavLiveFares: liveFlights, applyNuiteeLiveStays: hotelHook(calls) });
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
}

test('pool + roles policy: priced without upgrades first, then each role gets its own limit', async () => {
  const f = fixture(), calls = [];
  const r = await poolRequest(f, { HOTEL_UPGRADE_POLICY: 'roles' }, calls);
  assert.ok(r.tours.length >= 2, String(r.tours.length));
  const first = calls.filter(c => !c.policy);
  assert.ok(first.length >= r.tours.length && first.every(c => c.budget === null), 'first pass: no hotel budget for any trip');
  assert.ok(calls.every(c => c.cache), 'every pass shares the rate cache');
  const byRole = Object.fromEntries(r.tours.map(t => [t.tourRole, t]));
  const key = t => t.stops.map(s => s.cityId).join('>');
  if (byRole['lowest-cost']) {
    assert.ok(!calls.some(c => c.policy && c.key === key(byRole['lowest-cost'])), 'Lowest cost: never upgraded');
    assert.ok(byRole['lowest-cost'].stops.every(s => !s.hotel.budgetUpgrade));
  }
  for (const c of calls.filter(c => c.policy)) {
    assert.ok(['best-balance', 'most-memorable'].includes(c.policy.role));
    assert.equal(c.policy.perStayPct, c.policy.role === 'best-balance' ? 0.5 : 0.25);
  }
  for (const t of r.tours) {
    assert.ok(t.estimatedTotalUsd <= t.usableTripBudgetUsd, 'within 90% of the entered budget');
    // The per-stay limit itself is checked on real offers above; here the hook only sees the policy.
    if (t.tourRole === 'lowest-cost') assert.ok(t.stops.every(s => !s.hotel.budgetUpgrade));
  }
  const up = calls.find(c => c.policy?.role === 'best-balance');
  if (up) {
    const t = byRole['best-balance'];
    const nonHotel = t.estimatedTotalUsd - t.stops.reduce((s, st) => s + st.hotel.totalStayUsd, 0);
    assert.ok(Math.abs(up.budget - Math.floor(t.usableTripBudgetUsd - nonHotel)) <= 1, `hotel budget ${up.budget} = 90% of budget minus non-hotel ${nonHotel} (reserve once, no 3% cushion)`);
  }
});

test('legacy (policy unset): unchanged, no second pricing pass', async () => {
  const f = fixture(), calls = [];
  await poolRequest(f, {}, calls);
  assert.ok(calls.every(c => !c.policy), 'no role policy without HOTEL_UPGRADE_POLICY=roles');
});
