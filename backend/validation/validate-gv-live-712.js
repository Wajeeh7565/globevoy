'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

// Deterministic provider-injection tests. No credentials, AWS access, payment,
// reservation, or external provider calls are used by this validation suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const hotel = require('../services/providers/stays/nuitee/nuitee-hotel-708c');
const ledger = require('../services/domain/pricing/current-trip-total-712');
const wrapper = require('../services/booking/revalidation/staging-booking-revalidation-708c');
const base = require('../services/booking/revalidation/staging-booking-revalidation-707b');
const { parseHotelGuestContext } = require('../services/booking/context/hotel-guest-context-712');

const NOW = '2026-09-10T12:00:00.000Z';
const EXPIRY = '2026-09-10T12:05:00.000Z';
const ENV = { ENABLE_NUITEE_HOTEL_708C: 'true', NUITEE_GUEST_NATIONALITY: 'CA' };
const response = (payload, status = 200) => ({ status, async text() { return JSON.stringify(payload); } });
const clone = (x) => structuredClone(x);
function tour() {
  const cities = ['Toronto', 'Dublin'];
  const airports = ['YUL', 'YYZ', 'DUB', 'YUL'];
  return {
    stops: cities.map((city, index) => ({ city, countryCode: index ? 'IE' : 'CA', nights: 3, checkin: index ? '2026-10-13' : '2026-10-10', checkout: index ? '2026-10-16' : '2026-10-13', hotel: { estimatedStayUsd: 100 } })),
    legs: ['2026-10-10', '2026-10-13', '2026-10-16'].map((departureDate, index) => ({ mode: 'flight', from: { airportCode: airports[index], city: ['Montreal', ...cities][index] }, to: { airportCode: airports[index + 1], city: [...cities, 'Montreal'][index] }, departureDate, estimatedTransportUsd: 100 })),
    passengerPricing: { adults: 2, children: 0, infants: 0, rooms: 1, travellers: 2 },
    displayBudget: { currency: 'CAD', totalBudget: 2000, reserveAmount: 200, exchangeRateFromUsd: 1.35 }
  };
}
function trip() {
  const t = tour();
  return { tripId: 'trip71201', name: 'Toronto and Dublin', tripSnapshot: { kind: 'multi', tour: { ...t, backendLegs: t.legs, stays: t.stops, cities: t.stops } }, priceSnapshot: { currency: 'CAD', totalBudget: 2000, reserve: 200, flightEstimate: 300, stayEstimate: 200, tripEstimate: 500 } };
}
function rates(city) {
  return { data: [{ hotelId: city, roomTypes: [{ offerId: `private-${city}`, offerRetailRate: { amount: 180.25, currency: 'CAD' }, rates: [{ name: 'Queen room', boardName: 'Room only', retailRate: { total: [{ amount: 180.25, currency: 'CAD' }], taxesAndFees: [{ included: true }] } }] }] }], hotels: [{ id: city, name: `${city} Hotel`, main_photo: 'https://images.example/hotel.jpg' }] };
}
function prebook(city, overrides = {}) {
  return { data: { prebookId: `private-prebook-${city}`, offerId: `private-${city}`, hotelId: city, price: 200.45, currency: 'CAD', roomTypes: [{ rates: [{ name: 'Queen room', retailRate: { total: [{ amount: 200.45, currency: 'CAD' }], taxesAndFees: [{ included: true }] }, cancellationPolicies: { refundableTag: 'RFN', cancelPolicyInfos: [] } }] }], ...overrides } };
}
function fakeProvider(options = {}) {
  const requests = [];
  return { requests, fetch: async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body });
    assert.equal(init.method, 'POST');
    assert.ok([hotel.RATE_URL, hotel.PREBOOK_URL].includes(url), 'only Rates and PREBOOK are callable');
    if (url === hotel.RATE_URL) return response(options.rates ? options.rates(body) : rates(body.cityName));
    assert.equal(body.usePaymentSdk, false);
    const city = body.offerId.replace('private-', '');
    return response(options.prebook ? options.prebook(city) : prebook(city), options.prebookStatus || 200);
  } };
}
async function verify(options = {}, query = {}) {
  const provider = fakeProvider(options);
  const result = await hotel.verifyTourHotels(options.tour || tour(), { adults: 2, travellers: 2, rooms: 1, currency: 'CAD', ...query }, { env: ENV, apiKey: options.key || 'prod_test_fixture', now: NOW, fetch: provider.fetch });
  return { result, requests: provider.requests };
}
function livePayload() {
  return { ok: true, snapshot: { currency: 'CAD', savedTripTotal: 500 }, revalidation: { provider: 'Duffel' },
    flights: tour().legs.map((leg, index) => ({ index, sourceType: 'LIVE', productionEligible: true, providerPassengerCount: 2, departureDate: leg.departureDate, freshAmount: 100.15, currency: 'CAD', observedAt: NOW, expiresAt: EXPIRY, handoffEnabled: true, handoffUrl: 'https://www.aviasales.com/search/' })),
    hotels: tour().stops.map((stop, index) => ({ ...stop, index, productionEligible: true, priceVerified: true, availabilityVerified: true, sandbox: false, environment: 'production', dateConfirmed: true, travellerCount: 2, roomCount: 1, taxesAndFeesPresent: true, excludedFeesPresent: false, freshAmount: 200.45, currency: 'CAD', observedAt: NOW, expiresAt: EXPIRY, handoffUrl: 'https://www.agoda.com/search' })) };
}
function price(payload = livePayload(), saved = trip(), now = NOW) { return ledger.buildCurrentPricing(payload, saved, { now }); }

test('production Rates → PREBOOK verifies every stay and uses changed final party price', async () => {
  const { result, requests } = await verify();
  assert.equal(result.allLive, true);
  assert.equal(result.freshHotelTotal, 400.9);
  assert.equal(requests.length, 4);
  assert.equal(result.rows[0].deltaFromSearch, 20.19999999999999);
  assert.equal(result.rows[0].travellerCount, 2);
  assert.deepEqual(requests[0].body.occupancies, [{ adults: 2, children: [] }]);
  assert.equal(result.rows[0].expiresAt, EXPIRY);
  assert.doesNotMatch(JSON.stringify(result), /private-|prod_test_fixture|prebookId|offerId|X-API-Key/);
});

test('sandbox keys and sandbox provider responses never produce a live total', async () => {
  for (const key of ['sand_test', 'sandbox_test']) {
    const { result } = await verify({ key });
    assert.equal(result.allVerified, true);
    assert.equal(result.allLive, false);
    assert.equal(result.freshHotelTotal, null);
    assert.equal(result.rows[0].sandbox, true);
  }
  const { result } = await verify({ prebook: (city) => ({ ...prebook(city), sandbox: true }) });
  assert.equal(result.allLive, false);
});

test('all adults and exact ages are passed; no adult clamping or guest multiplication', () => {
  assert.deepEqual(hotel._internal.occupancyForQuery({ adults: 5, rooms: 2, travellers: 5 }).occupancies, [{ adults: 3, children: [] }, { adults: 2, children: [] }]);
  const query = { adults: 2, children: 1, infants: 1, travellers: 4, rooms: 1, childrenAges: [8], infantAges: [1] };
  assert.deepEqual(hotel._internal.occupancyForQuery(query).occupancies, [{ adults: 2, children: [8, 1] }]);
  for (const invalid of [{ ...query, childrenAges: [] }, { ...query, rooms: 2 }, { adults: 2, travellers: 4 }, { adults: 1, rooms: 2 }]) assert.throws(() => hotel._internal.occupancyForQuery(invalid));
});

test('multi-room prices sum all rates, reject mixed currencies, and retain explicit assignments', () => {
  const data = { roomTypes: [{ rates: [{ retailRate: { total: [{ amount: 120, currency: 'CAD' }] } }, { retailRate: { total: [{ amount: 180, currency: 'CAD' }] } }] }] };
  assert.deepEqual(hotel._internal.prebookPrice({ data }), { amount: 300, currency: 'CAD' });
  data.roomTypes[0].rates[1].retailRate.total[0].currency = 'USD';
  assert.equal(hotel._internal.prebookPrice({ data }).amount, null);
  assert.throws(() => hotel._internal.occupancyForQuery({ adults: 2, children: 1, rooms: 2, travellers: 3, occupancies: [{ adults: 2, children: [7] }] }));
  assert.equal(hotel._internal.occupancyForQuery({ adults: 2, children: 1, rooms: 2, travellers: 3, occupancies: [{ adults: 1, children: [7] }, { adults: 1, children: [] }] }).roomCount, 2);
});

test('overnight arrival sets the correct local hotel check-in; derived nights stay unconfirmed', () => {
  const t = tour();
  delete t.stops[0].checkin;
  delete t.stops[0].checkout;
  t.legs[0].providerDateEvidence = { arrivalDate: '2026-10-11', sourceType: 'LIVE', productionEligible: true };
  const stay = hotel._internal.deriveStayWindow(t, t.stops[0], 0);
  assert.equal(stay.checkin, '2026-10-11');
  assert.equal(stay.nights, 2);
  assert.equal(stay.dateConfirmed, true);
  delete t.legs[0].providerDateEvidence;
  assert.equal(hotel._internal.deriveStayWindow(t, t.stops[0], 0).dateConfirmed, false);
  assert.equal(hotel._internal.validIsoDate('2026-02-30'), '');
  t.stops[0].checkin = '2026-10-10'; t.stops[0].checkout = '2026-10-13';
  t.legs[0].providerDateEvidence = { arrivalDate: '2026-10-11' };
  assert.equal(hotel._internal.deriveStayWindow(t, t.stops[0], 0).reason, 'stay-flight-date-mismatch');
});

test('missing nationality and child ages fail before any provider request', async () => {
  let calls = 0;
  const options = { env: { ENABLE_NUITEE_HOTEL_708C: 'true' }, now: NOW, apiKey: 'prod_test', fetch: async () => { calls++; throw new Error('unexpected'); } };
  const result = await hotel.verifyTourHotels(tour(), { adults: 2, rooms: 1, currency: 'CAD' }, options);
  assert.equal(calls, 0);
  assert.equal(result.rows[0].reason, 'guest-nationality-required');
  options.env.NUITEE_GUEST_NATIONALITY = 'CA';
  const childResult = await hotel.verifyTourHotels(tour(), { adults: 2, children: 1, rooms: 1, currency: 'CAD' }, options);
  assert.equal(childResult.rows[0].reason, 'child-ages-required');
  assert.equal(calls, 0);
});

test('missing PREBOOK confirmation, mismatch, malformed price and provider errors fail closed', async () => {
  for (const override of [{ prebookId: null }, { price: null, roomTypes: [] }, { currency: 'USD' }, { offerId: 'different' }, { hotelId: 'different' }, { checkin: '2026-11-01' }]) {
    const { result } = await verify({ prebook: (city) => prebook(city, override) });
    assert.equal(result.allLive, false);
    assert.equal(result.rows[0].priceVerified, false);
    assert.equal(result.freshHotelTotal, null);
  }
  const { result } = await verify({ prebookStatus: 409 });
  assert.equal(result.allLive, false);
  assert.match(result.rows[0].reason, /prebook-http-409/);
});

test('excluded and unknown hotel fees cannot be hidden inside a trustworthy total', async () => {
  for (const fees of [undefined, [{ included: false, amount: 20 }], [{}]]) {
    const { result } = await verify({ prebook: (city) => {
      const value = prebook(city); value.data.roomTypes[0].rates[0].retailRate.taxesAndFees = fees; return value;
    } });
    assert.equal(result.allLive, false);
    assert.equal(result.freshHotelTotal, null);
  }
});

test('empty inventory remains unavailable; feature disabled makes no requests', async () => {
  assert.equal((await verify({ rates: () => ({ data: [] }) })).result.allLive, false);
  const result = await hotel.verifyTourHotels(tour(), {}, { env: {}, fetch: () => assert.fail('must not fetch') });
  assert.equal(result.enabled, false);
});

test('provider abort is graceful and every required stay is reported', async () => {
  const result = await hotel.verifyTourHotels(tour(), { adults: 2, currency: 'CAD' }, { env: ENV, apiKey: 'prod_test', now: NOW, timeoutMs: 3, fetch: async (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'AbortError' })))) });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.every((row) => row.reason === 'rates-timeout'), true);
  assert.equal(result.freshHotelTotal, null);
});

test('4+ stops are checked; >12 stops are explicitly incomplete with at most two workers', async () => {
  const t = tour();
  t.stops = Array.from({ length: 13 }, (_, i) => ({ ...tour().stops[0], city: `City${i}`, checkin: '2026-10-10', checkout: '2026-10-13' }));
  t.legs = [];
  let active = 0; let maxActive = 0;
  const provider = fakeProvider();
  const result = await hotel.verifyTourHotels(t, { adults: 2, travellers: 2, rooms: 1, currency: 'CAD' }, { env: ENV, apiKey: 'prod_test', now: NOW, fetch: async (...args) => { active++; maxActive = Math.max(maxActive, active); await new Promise((resolve) => setImmediate(resolve)); const value = await provider.fetch(...args); active--; return value; } });
  assert.equal(result.totalCount, 13);
  assert.equal(result.rows.length, 13);
  assert.equal(result.verifiedCount, 12);
  assert.equal(result.allLive, false);
  assert.equal(result.rows[12].reason, 'hotel-stop-limit-exceeded');
  assert.equal(result.freshHotelTotal, null);
  assert.ok(maxActive <= 2);
});

test('whole trip Live uses precise flight + hotel cents and all required handoffs', () => {
  const p = price();
  assert.equal(p.status, 'live');
  assert.equal(p.currentTotal, 701.35);
  assert.equal(p.flightsTotal, 300.45);
  assert.equal(p.hotelsTotal, 400.9);
  assert.equal(p.bookingReady, true);
  assert.equal(p.expiresAt, EXPIRY);
  const payload = livePayload(); payload.hotels[1].handoffUrl = null;
  assert.equal(price(payload).currentTotal, 701.35);
  assert.equal(price(payload).bookingReady, false);
});

test('one estimated/sandbox/missing/duplicate/wrong-currency component prevents whole trip Live', () => {
  const mutations = [
    (p) => { p.hotels[0].productionEligible = false; },
    (p) => { p.hotels[0].sandbox = true; },
    (p) => { p.hotels.pop(); },
    (p) => { p.flights.push(clone(p.flights[0])); },
    (p) => { p.flights[0].currency = 'USD'; },
    (p) => { p.hotels[0].currency = 'USD'; },
    (p) => { p.flights[0].providerPassengerCount = 1; },
    (p) => { p.hotels[0].travellerCount = 1; },
    (p) => { p.hotels[0].excludedFeesPresent = true; },
    (p) => { p.hotels[0].dateConfirmed = false; }
  ];
  for (const mutate of mutations) {
    const payload = livePayload(); mutate(payload); const p = price(payload);
    assert.equal(p.status, 'partial'); assert.equal(p.currentTotal, null); assert.equal(p.bookingReady, false); assert.ok(p.expiresAt);
  }
});

test('expired and future observations are rejected and missing money never becomes zero', () => {
  assert.equal(price(livePayload(), trip(), EXPIRY).status, 'estimate');
  const payload = livePayload();
  for (const row of [...payload.flights, ...payload.hotels]) row.observedAt = '2026-09-10T12:01:00.000Z';
  assert.equal(price(payload).currentTotal, null);
  for (const row of [...payload.flights, ...payload.hotels]) { row.observedAt = NOW; row.freshAmount = null; }
  const p = price(payload);
  assert.equal(p.status, 'estimate'); assert.equal(p.currentKnownSubtotal, null); assert.equal(p.currentTotal, null);
});

test('budget failure does not alter or fabricate the current total', () => {
  const saved = trip(); saved.priceSnapshot.totalBudget = 600;
  assert.equal(price(livePayload(), saved).withinBudget, false);
  assert.equal(price(livePayload(), saved).currentTotal, 701.35);
  const cheap = livePayload(); cheap.flights.forEach((row) => { row.freshAmount = 1.23; });
  assert.equal(price(cheap, saved).withinBudget, false); // reserve is still protected
  saved.priceSnapshot.reserve = 0;
  assert.equal(price(cheap, saved).withinBudget, true);
});

test('browser guest context accepts nationality/room ages only and rejects route/price injection', () => {
  assert.deepEqual(parseHotelGuestContext({ guestNationality: 'ca', occupancies: [{ adults: 1, children: [7] }] }), { guestNationality: 'CA', occupancies: [{ adults: 1, children: [7] }] });
  for (const value of [{ guestNationality: 'Canada' }, { guestNationality: 'CA', price: 1 }, { guestNationality: 'CA', occupancies: [{ adults: 0 }] }, { guestNationality: 'CA', occupancies: [{ adults: 1, children: [18] }] }]) assert.throws(() => parseHotelGuestContext(value));
  assert.throws(() => base._internal.parseBody({ body: JSON.stringify({ tripId: 'trip71201', currency: 'USD' }) }));
});

test('stops-only saved tour hydrates hotel rows for current-price verification', () => {
  const saved = trip();

  delete saved.tripSnapshot.tour.stays;
  delete saved.tripSnapshot.tour.cities;

  const hydrated = base._internal.hydrateSavedTour(saved);

  assert.ok(hydrated);
  assert.equal(hydrated.stops.length, 2);
  assert.deepEqual(
    hydrated.stops.map((row) => row.city),
    ['Toronto', 'Dublin']
  );

  const query = base._internal.queryForTrip(saved, hydrated);

  const rows = base._internal.sanitizeHotelRows(hydrated, query, {
    enrichStay: () => ({
      hotel: { bookingUrl: 'https://www.agoda.com/search' }
    })
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.city),
    ['Toronto', 'Dublin']
  );
});

test('staging endpoint composes current flights and PREBOOK hotels using owner trip context', async () => {
  const saved = trip();
  const provider = fakeProvider();
  const event = { rawPath: wrapper.ROUTE_PATH, requestContext: { http: { method: 'POST' } }, headers: { origin: wrapper.STAGING_ORIGIN, authorization: 'Bearer fixture' }, body: JSON.stringify({ tripId: saved.tripId, hotelGuestContext: { guestNationality: 'GB' } }) };
  const options = {
    now: NOW,
    env: { ...ENV, CORS_ORIGIN: wrapper.STAGING_ORIGIN, GLOBEVOY_COGNITO_USER_POOL_ID: 'us-east-2_MSd9RRHD8', GLOBEVOY_COGNITO_APP_CLIENT_ID: 'o2ohbv50253hjli5s34rbvv79', GLOBEVOY_SAVED_TRIPS_TABLE: 'globevoy-staging-saved-trips' },
    bearerToken: () => 'fixture', verifyToken: async () => ({ sub: 'owner-712' }),
    getTrip: async (sub, id) => { assert.equal(sub, 'owner-712'); assert.equal(id, saved.tripId); return saved; },
    applyLiveFarePilot: async (t) => ({ tour: { ...t, legs: t.legs.map((leg, index) => ({ ...leg, providerDateEvidence: { sourceType: 'LIVE', productionEligible: true, providerPassengerCount: 2, displayPrice: 100.15, displayCurrency: 'CAD', observedAt: NOW, expiresAt: EXPIRY, departureDate: leg.departureDate, arrivalDate: leg.departureDate, airline: 'Fixture Air', airlineLogoUrl: 'https://images.example/airline.svg' } })) }, summary: { attempted: true, applied: true, allFlightLegsLive: true, requiredFlightLegCount: 3, liveFlightLegCount: 3 } }),
    enrichFlightLeg: () => ({ bookingUrl: 'https://www.aviasales.com/search/', booking: { trust: { ctaLabel: 'Search flights' } } }),
    enrichStay: () => ({ hotel: { bookingUrl: 'https://www.agoda.com/search' } }),
    nuitee: { apiKey: 'prod_test_fixture' }, nuiteeFetch: provider.fetch
  };
  const res = await wrapper.handleBookingRevalidation707B(event, options);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.currentPricing.status, 'live');
  assert.equal(payload.currentPricing.currentTotal, 701.35);
  assert.equal(payload.hotelRevalidation.hotelAdjustedTripEstimate, 701.35);
  assert.equal(payload.trust.wholeTripLive, true);
  assert.equal(payload.hotels[0].guestNationality, 'GB');
  assert.equal(payload.flights[0].airlineName, 'Fixture Air');
  assert.equal(saved.tripSnapshot.tour.passengerPricing.guestNationality, undefined, 'owner snapshot is not mutated');
  assert.doesNotMatch(res.body, /private-|prod_test_fixture/);
  event.body = JSON.stringify({ tripId: saved.tripId, hotelGuestContext: { guestNationality: 'GB', occupancies: [{ adults: 1 }] } });
  assert.equal((await wrapper.handleBookingRevalidation707B(event, options)).statusCode, 422);
  options.env.ENABLE_NUITEE_HOTEL_708C = 'false';
  event.body = JSON.stringify({ tripId: saved.tripId });
  const disabled = JSON.parse((await wrapper.handleBookingRevalidation707B(event, options)).body);
  assert.equal(disabled.currentPricing.status, 'partial');
  assert.equal(disabled.currentPricing.currentTotal, null);
});

test('no production Lambda activation or new booking/order/payment endpoints', () => {
  const production = fs.readFileSync(`${BACKEND_ROOT}/lambda.js`, 'utf8');
  assert.doesNotMatch(production, /nuitee-hotel-708c|current-trip-total-712/);
  const adapter = fs.readFileSync(`${BACKEND_ROOT}/services/providers/stays/nuitee/nuitee-hotel-708c.js`, 'utf8');
  assert.doesNotMatch(adapter, /rates\/book|air\/orders/);
});
