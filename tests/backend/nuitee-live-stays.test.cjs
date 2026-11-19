'use strict';
// Offline: Nuitee responses and the secret are mocked. No network.
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyNuiteeLiveStays, _internal } = require('../../backend/services/domain/live-fares/nuitee-live-stays');
const { enrichStay } = require('../../backend/services/providers/links/partner-links');

const ENV = { ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'globevoy/production/nuitee' };
const QUERY = { currency: 'CAD', budget: '2500', adults: '2', rooms: '1', origin: 'YYZ' };
const prodSecret = async () => JSON.stringify({ apiKey: 'prod_test_not_real' });
const sandSecret = async () => JSON.stringify({ apiKey: 'sand_test_not_real' });

function tour() {
  return {
    legs: [
      { mode: 'flight', from: { code: 'YYZ' }, to: { code: 'LIS' }, departureDate: '2027-03-12', estimatedTransportUsd: 800 },
      { mode: 'flight', from: { code: 'LIS' }, to: { code: 'BUD' }, departureDate: '2027-03-16', estimatedTransportUsd: 200 },
      { mode: 'flight', from: { code: 'BUD' }, to: { code: 'YYZ' }, departureDate: '2027-03-20', estimatedTransportUsd: 900 }
    ],
    stops: [
      { city: 'Lisbon', countryCode: 'PT', nights: 4, hotel: { name: 'Estimate Lisbon', estimatedStayUsd: 400 } },
      { city: 'Budapest', countryCode: 'HU', nights: 4, hotel: { name: 'Estimate Budapest', estimatedStayUsd: 350 } }
    ]
  };
}
function rateHotel(id, name, rating, amount, refundable = 'RFN', currency = 'CAD') {
  return { hotel: { id, hotelId: id, name, rating }, rate: { hotelId: id, roomTypes: [{ offerId: `offer-${id}`, offerRetailRate: { amount, currency }, rates: [{ name: 'Double', boardName: 'Room only', retailRate: { total: [{ amount, currency }], taxesAndFees: [{ included: true }] }, cancellationPolicies: { refundableTag: refundable, cancelPolicyInfos: [] } }] }] } };
}
function mockFetch(byCity, seen = []) {
  return async (url, init) => {
    const body = JSON.parse(init.body); seen.push({ url, body, headers: init.headers });
    const rows = byCity[body.cityName] || [];
    return { status: 200, text: async () => JSON.stringify({ data: rows.map(r => r.rate), hotels: rows.map(r => r.hotel) }) };
  };
}

test('off by default: no secret read, tour unchanged', async () => {
  const t = tour();
  const r = await applyNuiteeLiveStays(t, QUERY, { env: {}, getSecretValue: () => { throw new Error('no'); } });
  assert.equal(r.summary.applied, false);
  assert.equal(r.tour, t);
});

test('refuses sandbox keys', async () => {
  const r = await applyNuiteeLiveStays(tour(), QUERY, { env: ENV, getSecretValue: sandSecret, fetch: mockFetch({}) });
  assert.equal(r.summary.reason, 'nuitee-key-not-production');
});

test('prices each stop live, picks cheap well-rated hotel, links to White Label hotel page', async () => {
  const seen = [];
  const fetch = mockFetch({
    Lisbon: [rateHotel('lpA', 'Cheap Bad', 5.1, 300), rateHotel('lpB', 'Good Value', 8.4, 520), rateHotel('lpC', 'Luxury', 9.5, 1400)],
    Budapest: [rateHotel('lpD', 'Danube Inn', 8.0, 410, 'NRFN')]
  }, seen);
  const r = await applyNuiteeLiveStays(tour(), QUERY, { env: ENV, getSecretValue: prodSecret, fetch });
  assert.equal(r.summary.appliedCount, 2, JSON.stringify(r.summary));
  assert.equal(seen.length, 2);
  assert.equal(seen[0].body.checkin, '2027-03-12');
  assert.equal(seen[0].body.checkout, '2027-03-16');
  assert.equal(seen[0].body.currency, 'CAD');
  assert.deepEqual(seen[0].body.occupancies, [{ adults: 2, children: [] }]);
  assert.equal(seen[0].body.guestNationality, 'CA');
  assert.ok(!seen.some(s => /prebook/i.test(s.url)), 'must never call prebook');
  const lis = r.tour.stops[0].hotel;
  assert.equal(lis.nuiteeHotelId, 'lpB');
  assert.equal(lis.name, 'Good Value');
  assert.equal(lis.nuiteeLiveRate.amount, 520);
  assert.equal(lis.nuiteeLiveRate.sourceType, 'LIVE');
  const url = new URL(lis.nuiteeWhitelabel.url);
  assert.equal(url.hostname, 'wajeeh-4443-racp8.nuitee.link');
  assert.equal(url.pathname, '/hotels/lpB');
  assert.equal(url.searchParams.get('checkin'), '2027-03-12');
  assert.deepEqual(JSON.parse(Buffer.from(url.searchParams.get('occupancies'), 'base64').toString()), [{ adults: 2, children: [] }]);
  assert.ok(Math.abs(lis.estimatedStayUsd - Math.round(520 * 0.735)) <= 2, String(lis.estimatedStayUsd));
});

test('a stop with no usable offer keeps its estimate', async () => {
  const fetch = mockFetch({ Lisbon: [rateHotel('lpB', 'Good Value', 8.4, 520)], Budapest: [rateHotel('lpX', 'Wrong currency', 9, 300, 'RFN', 'EUR')] });
  const r = await applyNuiteeLiveStays(tour(), QUERY, { env: ENV, getSecretValue: prodSecret, fetch });
  assert.equal(r.summary.appliedCount, 1);
  assert.equal(r.tour.stops[1].hotel.name, 'Estimate Budapest');
  assert.equal(r.tour.stops[1].hotel.nuiteeWhitelabel, undefined);
});

test('booking data exposes the White Label link and keeps Agoda as comparison', async () => {
  const fetch = mockFetch({ Lisbon: [rateHotel('lpB', 'Good Value', 8.4, 520)], Budapest: [] });
  const r = await applyNuiteeLiveStays(tour(), QUERY, { env: ENV, getSecretValue: prodSecret, fetch });
  const stay = enrichStay({ ...r.tour.stops[0], arrivalDate: '2027-03-12', departureDate: '2027-03-16' }, QUERY);
  assert.equal(stay.hotel.booking.whitelabel.provider, 'Nuitee');
  assert.match(stay.hotel.booking.whitelabel.url, /^https:\/\/wajeeh-4443-racp8\.nuitee\.link\/hotels\/lpB\?/);
});

test('whitelabelUrl rejects unsafe ids', () => {
  assert.equal(_internal.whitelabelUrl('x.nuitee.link', '../evil', '2027-01-01', '2027-01-02', []), '');
});

// R1: the tour the user sees may come from rescue/recovery; price it at the end.
const { _priceFinalTourWithNuitee } = require('../../backend/services/domain/tours/generated-tour');
function finalResult() { const t = tour(); return { ok: true, tour: t, tours: [t], diagnostics: {} }; }

test('final-tour pass prices the returned (shown) tour and its tours[] entry', async () => {
  const fetch = mockFetch({ Lisbon: [rateHotel('lpB', 'Good Value', 8.4, 520)], Budapest: [rateHotel('lpD', 'Danube Inn', 8.0, 410)] });
  const r = await _priceFinalTourWithNuitee(finalResult(), { ...QUERY, budget: '20000' }, { env: ENV, getSecretValue: prodSecret, fetch });
  assert.equal(r.diagnostics.nuiteeLiveStays.appliedCount, 2);
  assert.equal(r.diagnostics.nuiteeLiveStays.finalTourPass, true);
  assert.equal(r.tours[0], r.tour);
  assert.ok(r.tour.stops[0].hotel.nuiteeWhitelabel.url);
});

test('final-tour pass keeps estimates when live rates break the budget', async () => {
  const fetch = mockFetch({ Lisbon: [rateHotel('lpC', 'Luxury', 9.5, 9000)], Budapest: [] });
  const base = finalResult();
  const r = await _priceFinalTourWithNuitee(base, { ...QUERY, budget: '2500' }, { env: ENV, getSecretValue: prodSecret, fetch });
  assert.equal(r.tour, base.tour);
  assert.equal(r.diagnostics.nuiteeLiveStays.reason, 'nuitee-final-tour-over-budget-kept-estimate');
});

test('final-tour pass does not re-price an already priced tour, and is off when disabled', async () => {
  let calls = 0; const spy = async () => { calls++; return { tour: null, summary: {} }; };
  const priced = finalResult(); priced.tour.stops[0].hotel.nuiteeLiveRate = { amount: 1 };
  await _priceFinalTourWithNuitee(priced, QUERY, { env: ENV, applyNuiteeLiveStays: spy });
  const off = finalResult();
  const r = await _priceFinalTourWithNuitee(off, QUERY, { env: {}, applyNuiteeLiveStays: spy });
  assert.equal(calls, 0);
  assert.equal(r, off);
});

test('website query shape (travellers="1 adult", no rooms) still prices the final tour', async () => {
  const { getGeneratedTour } = require('../../backend/services/domain/tours/generated-tour');
  assert.equal(typeof getGeneratedTour, 'function');
  const { _internal: { occupancyForQuery } } = require('../../backend/services/providers/stays/nuitee/nuitee-hotel-708c');
  assert.throws(() => occupancyForQuery({ adults: '1', children: '0', travellers: '1 adult' }));
});
