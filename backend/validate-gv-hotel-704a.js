'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const readiness = require('./services/providers/stays/agoda/agoda-demand-readiness-704a');

assert.equal(readiness.VERSION, 'GV-HOTEL-704A');
assert.equal(readiness.CURRENT_SEARCH_PATH, '/api/v4/property/availability');
assert.equal(readiness.MAX_PROPERTY_IDS, 100);

const built = readiness.buildSearchRequest704A({
  propertyIds: [12157, 12157, 98765],
  checkIn: '2026-10-15',
  checkOut: '2026-10-18',
  rooms: 1,
  adults: 2,
  children: 0,
  currency: 'USD',
  language: 'en-us',
  userCountry: 'CA'
});
assert.equal(built.valid, true);
assert.deepEqual(built.request.criteria.propertyIds, [12157, 98765]);
assert.equal(built.request.criteria.checkIn, '2026-10-15');
assert.equal(built.request.criteria.checkOut, '2026-10-18');
assert.equal(built.request.criteria.rooms, 1);
assert.equal(built.request.criteria.adults, 2);
assert.equal(built.request.criteria.children, 0);
assert.equal('childrenAges' in built.request.criteria, false);
assert.equal(built.request.criteria.currency, 'USD');
assert.equal(built.request.criteria.userCountry, 'CA');
assert.equal(built.request.features.ratesPerProperty, 1);
assert.deepEqual(built.request.features.extra, readiness.REQUIRED_EXTRAS);

const family = readiness.buildSearchRequest704A({
  propertyIds: [12157],
  checkIn: '2026-10-15',
  checkOut: '2026-10-18',
  rooms: 1,
  adults: 2,
  children: 2,
  childrenAges: [5, 6],
  currency: 'USD',
  language: 'en-us',
  userCountry: 'US'
});
assert.equal(family.valid, true);
assert.deepEqual(family.request.criteria.childrenAges, [5, 6]);

assert.equal(readiness.buildSearchRequest704A({
  propertyIds: [], checkIn: '2026-10-15', checkOut: '2026-10-18', rooms: 1, adults: 1
}).valid, false);
assert.equal(readiness.buildSearchRequest704A({
  propertyIds: [12157], checkIn: '2026-10-18', checkOut: '2026-10-15', rooms: 1, adults: 1
}).errors.includes('check-out-must-follow-check-in'), true);
assert.equal(readiness.buildSearchRequest704A({
  propertyIds: [12157], checkIn: '2026-10-15', checkOut: '2026-10-18', rooms: 1, adults: 2, children: 2, childrenAges: [5]
}).errors.includes('children-ages-must-match-child-count'), true);

const tooMany = Array.from({ length: 101 }, (_, index) => index + 1);
const overCap = readiness.buildSearchRequest704A({
  propertyIds: tooMany,
  checkIn: '2026-10-15',
  checkOut: '2026-10-18',
  rooms: 1,
  adults: 1
});
assert.equal(overCap.valid, false);
assert.equal(overCap.errors.includes('property-id-cap-exceeded'), true);

const parsed = readiness.parseSearchResponse704A({
  searchId: 633141408144250000,
  properties: [
    {
      propertyId: 12157,
      propertyName: 'Example Resort',
      rooms: [
        {
          roomId: 3134583,
          blockId: 'block-live-704a',
          roomName: 'Beach Villa',
          ratePlanId: 617128,
          remainingRooms: 3,
          freeBreakfast: true,
          freeCancellation: true,
          totalPayment: {
            exclusive: 83.96,
            inclusive: 107.14,
            tax: 15.46,
            fees: 7.72
          },
          perRoomPerNightRate: {
            currency: 'USD',
            exclusive: 74.56,
            inclusive: 95.14,
            tax: 13.8,
            fees: 6.78
          }
        }
      ]
    },
    {
      propertyId: 98765,
      propertyName: 'Cheaper Example Hotel',
      rooms: [
        {
          roomId: 7,
          blockId: 'block-cheap-704a',
          roomName: 'Standard',
          totalPayment: { inclusive: 90, exclusive: 80, tax: 7, fees: 3 },
          perRoomPerNightRate: { currency: 'USD', inclusive: 45, exclusive: 40 }
        }
      ]
    }
  ]
}, { currency: 'USD' });

assert.equal(parsed.supported, true);
assert.equal(parsed.sourceType, 'LIVE');
assert.equal(parsed.observationCount, 2);
assert.equal(parsed.cheapestObservation.propertyId, 98765);
assert.equal(parsed.cheapestObservation.providerStayTotal, 90);

const example = parsed.observations.find(row => row.propertyId === 12157);
assert(example);
assert.equal(example.providerStayTotal, 107.14);
assert.equal(example.providerNightlyInclusive, 95.14);
assert.equal(example.tax, 15.46);
assert.equal(example.fees, 7.72);
assert.equal(example.providerCurrency, 'USD');
assert.equal(example.availabilityConfirmed, true);
assert.equal(example.livePriceEligible, true);
assert.equal(example.priceBasis, 'total-payment-inclusive-per-search-occupancy');
assert.equal(example.finalBookingPriceRequiresPrecheck, true);
assert.equal(example.orderCapability, false);
assert.equal(example.paymentCapability, false);
assert.equal(example.bookingCapability, false);

// Critical integrity rule: Agoda totalPayment.inclusive is the complete search
// occupancy total. Do not re-multiply it from a nightly rate or room count.
assert.notEqual(example.providerStayTotal, Number((example.providerNightlyInclusive * 3).toFixed(2)));

const empty = readiness.parseSearchResponse704A({ searchId: 1, properties: [{ propertyId: 12157, rooms: [] }] }, { currency: 'USD' });
assert.equal(empty.supported, false);
assert.equal(empty.sourceType, 'UNAVAILABLE');
assert.equal(empty.observationCount, 0);
assert.equal(empty.cheapestObservation, null);

const audit = readiness.auditCurrentIntegration704A({});
assert.equal(audit.configuredEndpointClass, 'legacy-affiliate-lt-v1');
assert.equal(audit.currentLegacyRequestIdentity, 'city-id-based');
assert.equal(audit.demandSearchIdentity, 'property-id-list-based');
assert.equal(audit.legacyCityIdMappingAloneSufficientForDemandSearch, false);
assert.equal(audit.propertyCatalogRequired, true);
assert.equal(audit.contentFeedOrContentApiRequiredForPropertyDiscovery, true);
assert.equal(audit.searchResponseSchemaCompatibleWithLegacyParser, false);
assert.equal(audit.migrationMustUseNewAdapterBoundary, true);
assert.equal(audit.recommendedAuthentication, 'oauth2');
assert.equal(audit.apiKeyAuthenticationStatus, 'supported-but-deprecated-by-end-of-2026');
assert.equal(audit.apiKeyIpWhitelistingRequired, true);
assert.equal(audit.partnerOnboardingRequired, true);
assert.equal(audit.liveTrafficEnabledBy704A, false);
assert.equal(audit.credentialsReadBy704A, false);
assert.equal(audit.credentialsReturnedBy704A, false);
assert.equal(audit.productionChanged, false);

// The 704A module must remain pure: no network calls, secrets, production or
// transaction wiring. Existing 679A integration stays untouched in this task.
const moduleText = fs.readFileSync(path.join(__dirname, 'services', 'providers', 'stays', 'agoda', 'agoda-demand-readiness-704a.js'), 'utf8');
for (const forbidden of [
  'globalThis.fetch(',
  'fetch(',
  'AGODA_API_KEY',
  'AGODA_SITE_ID',
  'Authorization:',
  'update-function-code',
  'Book API',
  'precheck(',
  'createBooking'
]) {
  assert.equal(moduleText.includes(forbidden), false, `704A readiness module contains forbidden live/writable token: ${forbidden}`);
}

const legacyText = fs.readFileSync(path.join(__dirname, 'services', 'providers', 'stays', 'agoda', 'agoda.js'), 'utf8');
assert(legacyText.includes("https://affiliateapi7643.agoda.com/affiliateservice/lt_v1"));
assert(legacyText.includes('destination.agodaCityId'));
assert(legacyText.includes('AGODA_SITE_ID'));
assert(legacyText.includes('AGODA_API_KEY'));

console.log('GV-HOTEL-704A validation PASS');
console.log(JSON.stringify({
  version: readiness.VERSION,
  modernSearchPath: readiness.CURRENT_SEARCH_PATH,
  currentAdapterClass: audit.configuredEndpointClass,
  migrationBoundaryRequired: audit.migrationMustUseNewAdapterBoundary,
  propertyCatalogRequired: audit.propertyCatalogRequired,
  liveTrafficEnabled: audit.liveTrafficEnabledBy704A,
  deterministicObservations: parsed.observationCount,
  cheapestSyntheticTotal: parsed.cheapestObservation.providerStayTotal
}, null, 2));
