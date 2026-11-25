'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const evidence = require('../../backend/services/domain/pricing/booking-evidence');

test('only unexpired backend evidence authenticates prices and mandatory fees', () => {
  const now = Date.now(), seen = new Date(now - 60000).toISOString();
  const env = { IGNAV_API_KEY: 'offline-test' };
  const leg = { departureDate: '2027-03-12', providerDateEvidence: { sourceType: 'LIVE', observedAt: seen } };
  const hotel = { nuiteeHotelId: 'hotel-safe', nuiteeLiveRate: {
    sourceType: 'LIVE', observedAt: seen, checkin: '2027-03-12', checkout: '2027-03-17',
    amount: 440, payAtHotelAmount: 60, currency: 'CAD', totalUsd: 368
  }};
  const tour = { fareMap: { arrivalDatesVerified: true }, backendLegs: [leg, { ...leg, departureDate: '2027-03-17' }], cities: [{ hotel }] };
  const token = evidence.issue(tour, env, now);
  assert.ok(token);
  assert.equal(evidence.verify(token, env, now).quote.cities[0].hotel.nuiteeLiveRate.payAtHotelAmount, 60);
  assert.equal(evidence.verify(token, env, now + 15 * 60000), null);
  const [body, sig] = token.split('.');
  const modified = JSON.parse(Buffer.from(body, 'base64url'));
  modified.quote.cities[0].hotel.nuiteeLiveRate.amount = 1;
  assert.equal(evidence.verify(Buffer.from(JSON.stringify(modified)).toString('base64url') + '.' + sig, env, now), null);
  hotel.nuiteeLiveRate.sourceType = 'CACHED';
  assert.equal(evidence.issue(tour, env, now), null);
});
