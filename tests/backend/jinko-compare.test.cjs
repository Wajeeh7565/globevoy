'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const jinko = require('../../backend/services/providers/flights/jinko/jinko');
const compare = require('../../backend/services/domain/live-fares/provider-compare');

const OFFER = {
  offers: [{
    offer_id: 'o1', outbound: { stops: 1, airline_name: 'Avianca', arrival_datetime: '2026-12-03T18:40:00-05:00' },
    fares: [
      { total_price: { value: 49712, decimal_places: 2, currency: 'CAD', display: 'CAD 497.12' }, searched_at: '2026-11-19T23:00:00Z', expires_at: '2026-11-19T23:30:00Z' },
      { total_price: { value: 45000, decimal_places: 2, currency: 'CAD', display: 'CAD 450.00' }, searched_at: '2026-11-19T23:00:00Z' }
    ]
  }]
};

test('jinko: minor units, cheapest fare, X-API-Key header, key from the secret', async () => {
  let seen = null;
  const r = await jinko.searchOneWay({ origin: 'yyz', destination: 'MDE', departureDate: '2026-12-03', currency: 'CAD' }, {
    env: {}, getSecretValue: async id => { assert.equal(id, 'globevoy/production/jinko'); return JSON.stringify({ apiKey: 'jnk_test_only' }); },
    fetchFn: async (url, init) => { seen = { url, init }; return { status: 200, text: async () => JSON.stringify(OFFER) }; }
  });
  assert.equal(seen.url, 'https://api.gojinko.com/v1/flight_search');
  assert.equal(seen.init.headers['X-API-Key'], 'jnk_test_only');
  const body = JSON.parse(seen.init.body);
  assert.deepEqual([body.origin, body.destination, body.departure_date, body.trip_type, body.currency], ['YYZ', 'MDE', '2026-12-03', 'oneway', 'CAD']);
  assert.equal(r.ok, true);
  assert.equal(r.cheapest.total, 450);
  assert.equal(r.cheapest.arrival, '2026-12-03T18:40:00-05:00');
});

test('jinko: errors and missing keys never throw', async () => {
  const opts = { env: {}, apiKey: 'jnk_x' };
  assert.equal((await jinko.searchOneWay({ origin: 'YYZ', destination: 'MDE', departureDate: '2026-12-03' }, { ...opts, fetchFn: async () => ({ status: 402, text: async () => '{"code":"PAYMENT_REQUIRED"}' }) })).reason, 'jinko-http-402');
  assert.equal((await jinko.searchOneWay({ origin: 'YYZ', destination: 'MDE', departureDate: '2026-12-03' }, { ...opts, fetchFn: async () => { throw new Error('x'); } })).reason, 'jinko-network-error');
  assert.equal((await jinko.searchOneWay({ origin: 'YYZ', destination: 'MDE', departureDate: 'bad' }, opts)).reason, 'invalid-route-or-date');
  assert.equal(jinko._internal.parseKey('{"apiKey":"jnk_a"}'), 'jnk_a');
  assert.equal(jinko._internal.parseKey('not-a-key'), '');
});

test('provider compare: plain Lambda events only, at most 12 routes, both providers side by side', async () => {
  assert.equal(compare.isProviderCompareEvent({ globevoyJob: 'provider-compare' }), true);
  assert.equal(compare.isProviderCompareEvent({ globevoyJob: 'provider-compare', rawPath: '/api/x', requestContext: {} }), false);
  assert.equal(compare.isProviderCompareEvent({ globevoyJob: 'fare-map' }), false);
  let calls = 0;
  const r = await compare.runProviderCompare({ routes: Array.from({ length: 20 }, () => ['YYZ', 'MDE', '2026-12-03']) }, {
    ignav: { searchOneWay: async () => { calls++; return { ok: true, observedAt: 'now', cheapest: { partyTotalAmount: 500 } }; } },
    jinko: { searchOneWay: async () => { calls++; return { ok: false, reason: 'jinko-http-402' }; } }
  });
  assert.equal(r.routes, 12);
  assert.equal(calls, 24);
  assert.deepEqual(r.summary, { ignavPriced: 12, jinkoPriced: 0 });
  assert.match(r.rows[0].ignav, /CAD 500/);
  assert.match(r.rows[0].jinko, /failed: jinko-http-402/);
});
