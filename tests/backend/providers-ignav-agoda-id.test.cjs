'use strict';

// Offline tests: no network, no real credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const ignav = require('../../backend/services/providers/flights/ignav/ignav');
const agoda = require('../../backend/services/providers/stays/agoda/agoda');

const ENV = { ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'test-key-not-real' };

function mockFetch(status, payload, seen = []) {
  return async (url, init) => {
    seen.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
  };
}

const ONE_WAY = {
  observed_at: '2027-01-10T12:00:00Z',
  itineraries: [
    { ignav_id: 'expensive0001', price: { amount: 640, currency: 'CAD', status: 'verified' }, outbound: { carrier: 'Air Canada', duration_minutes: 420, segments: [{ marketing_carrier_code: 'AC', flight_number: '834', departure: { airport: 'YYZ' }, arrival: { airport: 'LIS' }, duration_minutes: 420 }] } },
    { ignav_id: 'cheapest0001', price: { amount: 512.4, currency: 'CAD', status: 'verified' }, outbound: { carrier: 'TAP', duration_minutes: 610, segments: [{ marketing_carrier_code: 'TP', flight_number: '260', departure: { airport: 'YYZ' }, arrival: { airport: 'OPO' } }, { marketing_carrier_code: 'TP', flight_number: '1943', departure: { airport: 'OPO' }, arrival: { airport: 'LIS' } }] } },
    { ignav_id: 'placeholder01', price: { amount: 0, currency: 'CAD', status: 'unverified' }, outbound: { segments: [] } }
  ]
};

test('Ignav is off unless explicitly enabled and keyed', async () => {
  assert.equal(ignav.configured({}), false);
  assert.equal(ignav.configured({ ENABLE_IGNAV_FLIGHTS: 'true' }), false);
  const result = await ignav.searchOneWay({ origin: 'YYZ', destination: 'LIS', departureDate: '2027-03-12' }, { env: {}, fetchFn: mockFetch(200, ONE_WAY) });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ignav-not-configured');
});

test('Ignav one-way: picks cheapest verified fare, ignores unverified placeholders, maps CAD to CA market', async () => {
  const seen = [];
  const result = await ignav.searchOneWay({ origin: 'yyz', destination: 'LIS', departureDate: '2027-03-12', currency: 'CAD' }, { env: ENV, fetchFn: mockFetch(200, ONE_WAY, seen) });
  assert.equal(result.ok, true);
  assert.equal(result.market, 'CA');
  assert.equal(result.usableCount, 2);
  assert.equal(result.cheapest.ignavId, 'cheapest0001');
  assert.equal(result.cheapest.partyTotalAmount, 512.4);
  assert.equal(result.cheapest.currency, 'CAD');
  assert.equal(result.cheapest.stops, 1);
  const sent = JSON.parse(seen[0].init.body);
  assert.deepEqual(sent, { origin: 'YYZ', destination: 'LIS', departure_date: '2027-03-12', adults: 1, children: 0, market: 'CA' });
  assert.equal(seen[0].init.headers['X-Api-Key'], 'test-key-not-real');
});

test('Ignav rejects bad input without calling the API', async () => {
  const seen = [];
  const bad = await ignav.searchOneWay({ origin: 'YYZ', destination: 'YYZ', departureDate: '2027-03-12' }, { env: ENV, fetchFn: mockFetch(200, ONE_WAY, seen) });
  assert.equal(bad.reason, 'invalid-route-or-date');
  const badDate = await ignav.searchOneWay({ origin: 'YYZ', destination: 'LIS', departureDate: '2027-02-30' }, { env: ENV, fetchFn: mockFetch(200, ONE_WAY, seen) });
  assert.equal(badDate.reason, 'invalid-route-or-date');
  assert.equal(seen.length, 0);
});

test('Ignav HTTP errors become safe reasons (no body echo)', async () => {
  const r402 = await ignav.searchOneWay({ origin: 'YYZ', destination: 'LIS', departureDate: '2027-03-12' }, { env: ENV, fetchFn: mockFetch(402, { secret: 'x' }) });
  assert.deepEqual([r402.ok, r402.reason, r402.status], [false, 'ignav-billing-required', 402]);
  const r429 = await ignav.searchOneWay({ origin: 'YYZ', destination: 'LIS', departureDate: '2027-03-12' }, { env: ENV, fetchFn: mockFetch(429, {}) });
  assert.equal(r429.reason, 'ignav-rate-limited');
});

test('Ignav booking links: exact-flight first, https only, no commission claim', async () => {
  const payload = { booking_options: [{ legs: ['outbound'], links: [
    { provider_name: 'Some OTA', provider_type: 'ota', price: { amount: 505, currency: 'CAD' }, url: 'https://ota.example/search?x=1', specificity: 'search_results' },
    { provider_name: 'TAP', provider_type: 'airline', price: { amount: 512.4, currency: 'CAD' }, url: 'https://www.flytap.com/book?f=1', specificity: 'exact_flight' },
    { provider_name: 'Bad', url: 'http://insecure.example/' }
  ] }] };
  const result = await ignav.getBookingLinks('cheapest0001', { env: ENV, fetchFn: mockFetch(200, payload) });
  assert.equal(result.ok, true);
  assert.equal(result.linkCount, 2);
  assert.equal(result.links[0].providerName, 'TAP');
  assert.equal(result.links[0].specificity, 'exact_flight');
  assert.equal(result.links.every(link => link.commissionEarned === false), true);
  assert.equal(result.unknownSpecificityCount, 0);
  assert.equal(result.airlineDirectCount, 1);
  assert.equal(result.cheapestLink.providerName, 'Some OTA');
  const noSpec = await ignav.getBookingLinks('cheapest0001', { env: ENV, fetchFn: mockFetch(200, { booking_options: [{ links: [{ provider_name: 'FlightHub', provider_type: 'third_party', price: { amount: 482, currency: 'CAD' }, url: 'https://www.flighthub.com/x' }] }] }) });
  assert.equal(noSpec.exactFlightLinkCount, 0);
  assert.equal(noSpec.unknownSpecificityCount, 1);
  assert.equal(noSpec.cheapestLink.amount, 482);
  const invalid = await ignav.getBookingLinks('bad id!', { env: ENV, fetchFn: mockFetch(200, payload) });
  assert.equal(invalid.reason, 'invalid-ignav-id');
});

function withAgodaEnv(fn) {
  const saved = { AGODA_SITE_ID: process.env.AGODA_SITE_ID, AGODA_API_KEY: process.env.AGODA_API_KEY, GLOBEVOY_USE_MOCKS: process.env.GLOBEVOY_USE_MOCKS };
  process.env.AGODA_SITE_ID = '1'; process.env.AGODA_API_KEY = 'test-not-real'; delete process.env.GLOBEVOY_USE_MOCKS;
  return Promise.resolve(fn()).finally(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test('Agoda hotel-ID search sends hotelId (not cityId) and prices the exact stay', () => withAgodaEnv(async () => {
  const seen = [];
  const payload = { results: [
    { hotelId: 1001, hotelName: 'Lisboa Plaza', dailyRate: 80, landingURL: 'http://www.agoda.com/partners/partnersearch.aspx?cid=1&hid=1001&checkin=2027-03-13&checkout=2027-03-17', reviewScore: 8.6, starRating: 4 },
    { hotelId: 9999, hotelName: 'Not requested', dailyRate: 10, landingURL: 'https://www.agoda.com/partners/partnersearch.aspx?hid=9999' }
  ] };
  const result = await agoda.fetchAgodaHotelListRates({ hotelIds: [1001, '1002', 'x', -5], checkIn: '2027-03-13', checkOut: '2027-03-17', currency: 'CAD', adults: 2, rooms: 1, _fetchFn: mockFetch(200, payload, seen) });
  const body = JSON.parse(seen[0].init.body);
  assert.deepEqual(body.criteria.hotelId, [1001, 1002]);
  assert.equal(body.criteria.cityId, undefined);
  assert.equal(body.criteria.additional.occupancy.numberOfAdult, 2);
  assert.equal(result.ok, true);
  assert.equal(result.hotels.length, 1, 'unrequested hotel 9999 must be dropped');
  const hotel = result.hotels[0];
  assert.equal(hotel.hotelId, 1001);
  assert.equal(hotel.nights, 4);
  assert.equal(hotel.stayTotal, 320);
  assert.equal(hotel.linkHasHotelId, true);
  assert.match(hotel.landingUrl, /^https:\/\/www\.agoda\.com\//);
  assert.equal(hotel.sourceType, 'live');
  assert.deepEqual(result.unavailableHotelIds, [1002]);
}));

test('Agoda hotel-ID search validates input and fails closed', () => withAgodaEnv(async () => {
  const seen = [];
  assert.equal((await agoda.fetchAgodaHotelListRates({ hotelIds: [], checkIn: '2027-03-13', checkOut: '2027-03-17', _fetchFn: mockFetch(200, {}, seen) })).reason, 'no-valid-hotel-ids');
  assert.equal((await agoda.fetchAgodaHotelListRates({ hotelIds: [1], checkIn: '2027-03-17', checkOut: '2027-03-13', _fetchFn: mockFetch(200, {}, seen) })).reason, 'invalid-stay-dates');
  assert.equal(seen.length, 0);
  const failed = await agoda.fetchAgodaHotelListRates({ hotelIds: [1], checkIn: '2027-03-13', checkOut: '2027-03-14', _fetchFn: mockFetch(500, { error: 'x' }) });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'agoda-request-failed');
}));
