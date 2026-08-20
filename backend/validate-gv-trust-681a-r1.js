'use strict';

const assert = require('node:assert/strict');
const {
  PRICE_EVIDENCE_VERSION, SOURCE_TYPES, normalizeFlightEvidence,
  normalizeHotelEvidence, automaticDateFloor, automaticDateAllowed
} = require('./services/price-evidence-integrity');
const { buildCanonicalLedger } = require('./services/canonical-total-evidence');
const { buildAviasalesOneWaySearchUrl, buildAgodaCitySearchUrl } = require('./services/partner-links');
const { initialAutomaticStartDate } = require('./generated-tour');

const checks = [];
function test(name, fn) { fn(); checks.push({ name, status: 'PASS' }); }

test('DUB-BJV €39 root-cause fixture remains cached, not live/bookable', () => {
  const evidence = normalizeFlightEvidence({
    origin: 'DUB', destination: 'BJV', departureDate: '2026-08-26', price: 39,
    currency: 'EUR', source: 'travelpayouts-aviasales-one-way', sourceType: 'CACHED',
    providerBacked: true, observedAt: '2026-08-11T12:00:00Z', bookingLink: 'https://www.aviasales.com/search/DUB2608BJV1'
  }, { origin: 'DUB', destination: 'BJV', departureDate: '2026-08-26', currency: 'EUR' });
  assert.equal(evidence.sourceType, SOURCE_TYPES.CACHED);
  assert.equal(evidence.isBookable, false);
  assert.equal(evidence.amount, 39);
});

test('one-way and round-trip observations keep distinct evidence identities', () => {
  const oneWay = normalizeFlightEvidence({ origin: 'DUB', destination: 'BJV', departureDate: '2026-08-26', price: 39, currency: 'EUR', source: 'one-way', sourceType: 'CACHED' }, { origin: 'DUB', destination: 'BJV', currency: 'EUR' });
  const roundTrip = normalizeFlightEvidence({ origin: 'DUB', destination: 'BJV', departureDate: '2026-08-26', price: 76, currency: 'EUR', source: 'round-trip-calendar', sourceType: 'CACHED' }, { origin: 'DUB', destination: 'BJV', currency: 'EUR' });
  assert.notEqual(oneWay.evidenceId, roundTrip.evidenceId);
});

test('route, date and currency contamination is rejected', () => {
  for (const mutation of [{ destination: 'LAX' }, { departureDate: '2026-08-27' }, { currency: 'EUR' }]) {
    const evidence = normalizeFlightEvidence({ origin: 'JFK', destination: 'CUN', departureDate: '2026-08-26', price: 210, currency: 'USD', sourceType: 'CACHED', ...mutation }, { origin: 'JFK', destination: 'CUN', departureDate: '2026-08-26', currency: 'USD' });
    assert.equal(evidence.sourceType, SOURCE_TYPES.UNAVAILABLE);
    assert.equal(evidence.isBookable, false);
  }
});

test('automatic flexible selection enforces +14 days', () => {
  const now = new Date('2026-08-12T12:00:00Z');
  assert.equal(automaticDateFloor({ now, minimumLeadDays: 14 }), '2026-08-26');
  assert.equal(automaticDateAllowed('2026-08-25', { now, minimumLeadDays: 14 }), false);
  assert.equal(automaticDateAllowed('2026-08-26', { now, minimumLeadDays: 14 }), true);
});

test('explicit exact-date request remains exact', () => {
  assert.equal(initialAutomaticStartDate({ dateMode: 'exact', flexible: 'false', departureDate: '2026-08-12' }), '2026-08-12');
});

test('hotel evidence never claims booking confirmation', () => {
  const evidence = normalizeHotelEvidence({ city: 'Toronto', hotelId: '123', checkIn: '2026-09-10', checkOut: '2026-09-13', estimatedStayUsd: 480, currency: 'USD', source: 'Agoda', sourceType: 'LIVE' }, { checkIn: '2026-09-10', checkOut: '2026-09-13', currency: 'USD' });
  assert.equal(evidence.sourceType, SOURCE_TYPES.LIVE);
  assert.equal(evidence.isBookable, false);
  assert.equal(evidence.isExactDate, true);
});

test('canonical ledger separates planning total from current-provider total', () => {
  const cached = normalizeFlightEvidence({ origin: 'YYZ', destination: 'JFK', departureDate: '2026-09-10', price: 150, currency: 'USD', sourceType: 'CACHED' }, { origin: 'YYZ', destination: 'JFK', departureDate: '2026-09-10', currency: 'USD' });
  const ledger = buildCanonicalLedger({ legs: [{ mode: 'flight', from: { airportCode: 'YYZ' }, to: { airportCode: 'JFK' }, departureDate: '2026-09-10', estimatedFlightUsd: 150, providerDateEvidence: { price: 150, currency: 'USD', origin: 'YYZ', destination: 'JFK', departureDate: '2026-09-10', sourceType: 'CACHED', priceEvidence: cached } }], stops: [] }, { currency: 'USD' });
  assert.equal(ledger.planningTotalUsd, 150);
  assert.equal(ledger.currentProviderTotalUsd, 0);
  assert.equal(ledger.sourceTypeCounts.CACHED, 1);
});

test('flight and hotel handoffs preserve route, dates, party and currency', () => {
  assert.equal(buildAviasalesOneWaySearchUrl({ origin: 'LAX', destination: 'HOU', departureDate: '2026-08-26', adults: 2 }), 'https://www.aviasales.com/search/LAX2608HOU2');
  const hotelUrl = new URL(buildAgodaCitySearchUrl({ cityId: 1649, checkIn: '2026-08-26', checkOut: '2026-08-29', currency: 'USD', city: 'Toronto', adults: 2, children: 1, rooms: 1 }));
  assert.equal(hotelUrl.searchParams.get('checkIn'), '2026-08-26');
  assert.equal(hotelUrl.searchParams.get('checkOut'), '2026-08-29');
  assert.equal(hotelUrl.searchParams.get('adults'), '2');
  assert.equal(hotelUrl.searchParams.get('children'), '1');
  assert.equal(hotelUrl.searchParams.get('currency'), 'USD');
});

test('major-city and random-origin scenarios retain exact airport identity', () => {
  for (const [origin, destination, currency] of [['DUB','BJV','EUR'],['JFK','CUN','USD'],['LAX','HOU','USD'],['YYZ','LIS','CAD'],['LIS','ATH','EUR']]) {
    const evidence = normalizeFlightEvidence({ origin, destination, departureDate: '2026-09-15', price: 200, currency, sourceType: 'CACHED' }, { origin, destination, departureDate: '2026-09-15', currency });
    assert.equal(evidence.routeMatch, true);
    assert.equal(evidence.currencyMatch, true);
    assert.equal(evidence.origin, origin);
  }
});

const report = { version: PRICE_EVIDENCE_VERSION, generatedAt: new Date().toISOString(), passed: checks.length, failed: 0, checks };
require('node:fs').writeFileSync('VALIDATION_GV_TRUST_681A_R1.json', JSON.stringify(report, null, 2));
console.log(`PASS ${checks.length}/${checks.length} — ${PRICE_EVIDENCE_VERSION}`);
