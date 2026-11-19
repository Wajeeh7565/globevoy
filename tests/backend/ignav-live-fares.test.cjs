'use strict';

// Offline: Ignav is mocked; any real network call fails the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyIgnavLiveFares } = require('../../backend/services/domain/live-fares/ignav-live-fares');
const { enrichFlightLeg } = require('../../backend/services/providers/links/partner-links');

const ENV = { ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'test-not-real' };
const node = (code, city) => ({ airportCode: code, code, city });
function tour() {
  return {
    estimatedTotalUsd: 1500,
    legs: [
      { mode: 'flight', transportType: 'flight', from: node('YYZ', 'Toronto'), to: node('LIS', 'Lisbon'), departureDate: '2027-02-02', estimatedTransportUsd: 400, estimatedFlightUsd: 400 },
      { mode: 'flight', transportType: 'flight', from: node('LIS', 'Lisbon'), to: node('BUD', 'Budapest'), departureDate: '2027-02-06', estimatedTransportUsd: 120, estimatedFlightUsd: 120 },
      { mode: 'flight', transportType: 'flight', from: node('BUD', 'Budapest'), to: node('YYZ', 'Toronto'), departureDate: '2027-02-10', estimatedTransportUsd: 500, estimatedFlightUsd: 500 }
    ],
    stops: [{ city: 'Lisbon', hotel: { estimatedStayUsd: 240 } }, { city: 'Budapest', hotel: { estimatedStayUsd: 240 } }]
  };
}
const FARES = { 'YYZ-LIS': 502, 'LIS-BUD': 136, 'BUD-YYZ': 725 };
function fareFetch({ failRoute, currency = 'CAD' } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    const key = `${body.origin}-${body.destination}`;
    if (key === failRoute) return { ok: true, status: 200, text: async () => JSON.stringify({ itineraries: [] }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ observed_at: '2026-11-19T05:00:00Z', itineraries: [
      { ignav_id: `id${key.replace('-', '')}00`, price: { amount: FARES[key], currency, status: 'verified' }, outbound: { carrier: 'X', duration_minutes: 300, segments: [{ marketing_carrier_code: 'XX', flight_number: '1', departure: { airport: body.origin }, arrival: { airport: body.destination } }] } }
    ] }) };
  };
  fn.calls = calls;
  return fn;
}
const QUERY = { currency: 'CAD', budget: '2500', adults: '1', origin: 'YYZ' };

test('disabled: no calls, tour unchanged', async () => {
  const t = tour();
  const r = await applyIgnavLiveFares(t, QUERY, { env: {}, fetchFn: () => { throw new Error('network'); } });
  assert.equal(r.summary.applied, false);
  assert.equal(r.summary.reason, 'ignav-disabled');
  assert.equal(r.tour, t);
});

test('all legs priced atomically in CAD, evidence is LIVE decision-grade with ignavId', async () => {
  const f = fareFetch();
  const r = await applyIgnavLiveFares(tour(), QUERY, { env: ENV, fetchFn: f });
  assert.equal(r.summary.applied, true, JSON.stringify(r.summary));
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map(c => c.market), ['CA', 'CA', 'CA']);
  const ev = r.tour.legs[0].providerDateEvidence;
  assert.equal(ev.source, 'ignav-live-one-way');
  assert.equal(ev.providerPartyTotalAmount, 502);
  assert.equal(ev.currency, 'CAD');
  assert.equal(ev.ignavId, 'idYYZLIS00');
  assert.equal(ev.priceEvidence.sourceType, 'LIVE');
  assert.equal(ev.priceEvidence.isExactDate, true);
  assert.equal(r.tour.legs[0].liveFareVerified, true);
  assert.ok(r.summary.afterTotalUsd > 0);
  assert.equal(typeof r.summary.overBudget, 'boolean');
});

test('one missing leg fails closed: no Ignav price applied anywhere', async () => {
  const t = tour();
  const r = await applyIgnavLiveFares(t, QUERY, { env: ENV, fetchFn: fareFetch({ failRoute: 'LIS-BUD' }) });
  assert.equal(r.summary.applied, false);
  assert.equal(r.summary.reason, 'ignav-incomplete-live-coverage-fail-closed');
  assert.equal(r.summary.failedLegs[0].destination, 'BUD');
  assert.equal(r.tour, t);
});

test('currency mismatch fails closed', async () => {
  const r = await applyIgnavLiveFares(tour(), QUERY, { env: ENV, fetchFn: fareFetch({ currency: 'USD' }) });
  assert.equal(r.summary.applied, false);
  assert.equal(r.summary.failedLegs[0].reason, 'currency-mismatch');
});

test('infants are not sent to Ignav', async () => {
  const r = await applyIgnavLiveFares(tour(), { ...QUERY, infants: '1' }, { env: ENV, fetchFn: fareFetch() });
  assert.equal(r.summary.reason, 'ignav-infants-not-supported');
});

test('booking button carries the Ignav lookup and no commission claim', async () => {
  const r = await applyIgnavLiveFares(tour(), QUERY, { env: ENV, fetchFn: fareFetch() });
  const leg = enrichFlightLeg(r.tour.legs[0], QUERY);
  assert.equal(leg.booking.liveBookingLinks.ignavId, 'idYYZLIS00');
  assert.equal(leg.booking.liveBookingLinks.endpoint, '/api/flight-booking-links');
  assert.equal(leg.booking.liveBookingLinks.commissionEarned, false);
  assert.equal(leg.priceProvenance.provider, 'Ignav');
  assert.equal(leg.booking.referralPriceGuaranteed, false);
});

test('667A live verification preserves Ignav evidence without re-querying flights', async () => {
  const r = await applyIgnavLiveFares(tour(), QUERY, { env: ENV, fetchFn: fareFetch() });
  const saved = { flag: process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A, fetch: global.fetch };
  process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A = 'true';
  const hits = [];
  global.fetch = async (url) => { hits.push(String(url)); throw new Error('offline'); };
  try {
    delete require.cache[require.resolve('../../backend/services/domain/live-fares/live-provider-verification')];
    const { verifyTourWithLiveProviders } = require('../../backend/services/domain/live-fares/live-provider-verification');
    const v = await verifyTourWithLiveProviders(r.tour, QUERY);
    for (const leg of v.tour.legs) {
      assert.equal((leg.providerDateEvidence || {}).source, 'ignav-live-one-way');
      assert.equal(leg.liveFareVerified, true);
    }
    assert.equal(hits.some(u => /travelpayouts|aviasales|duffel/i.test(u)), false, hits.join(','));
  } finally {
    if (saved.flag === undefined) delete process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A; else process.env.ENABLE_LIVE_PROVIDER_VERIFICATION_667A = saved.flag;
    global.fetch = saved.fetch;
  }
});
