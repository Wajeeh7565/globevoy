'use strict';

const assert = require('assert');

// Pin the validator to the current reviewed 701A baseline before loading modules
// whose snapshots are selected at require-time.
process.env.ENABLE_WORLDWIDE_CITY_REGISTRY_701A = 'true';
process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';

const {
  VERSION,
  worldwideRegistryEnabled,
  worldwideRegistrySummary,
  resolveWorldwideCity,
  searchWorldwideRegistry,
  _internal
} = require('./services/cities/registry/worldwide-city-registry-701a');
const { findForCatalogueRow } = require('./services/cities/registry/city-registry');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

check('701A version marker is exact', () => {
  assert.strictEqual(VERSION, 'GV-DATA-701A');
});

check('701A feature flag is enabled for focused validation', () => {
  assert.strictEqual(worldwideRegistryEnabled(), true);
});

const summary = worldwideRegistrySummary();

check('worldwide catalogue preserves the verified 9,665-city baseline', () => {
  assert.strictEqual(summary.counts.worldwideIdentityCities, 9665);
});

check('curated destination layer remains exactly 1,000 cities', () => {
  assert.strictEqual(summary.counts.curatedDestinationCities, 1000);
});

check('latest selected activation snapshot remains 439 production-active cities', () => {
  assert.strictEqual(summary.counts.productionActiveCitiesInSelectedSnapshot, 439);
});

check('worldwide catalogue spans at least 230 countries and territories', () => {
  assert.ok(summary.counts.worldwideCountriesAndTerritories >= 230);
});

check('worldwide identity layer is materially larger than destination layer', () => {
  assert.ok(summary.counts.worldwideIdentityCities > summary.counts.curatedDestinationCities * 5);
});

check('summary keeps worldwide, curated and production-active layers distinct', () => {
  assert.strictEqual(summary.layers.worldwide, 'identity and origin-resolution surface');
  assert.strictEqual(summary.layers.curated1000, 'reviewed destination-candidate surface');
  assert.strictEqual(summary.layers.productionActive, 'sampled provider-capability allowlist when activation is enabled');
});

const toronto = resolveWorldwideCity('Toronto');

check('Toronto resolves through the curated worldwide overlay', () => {
  assert.ok(toronto);
  assert.strictEqual(toronto.displayName, 'Toronto');
  assert.strictEqual(toronto.countryCode, 'CA');
  assert.strictEqual(toronto.destination.curated, true);
});

check('Toronto preserves YYZ airport integrity', () => {
  assert.strictEqual(toronto.origin.preferredAirportCode, 'YYZ');
  assert.ok(toronto.origin.airportCodes.includes('YYZ'));
});

check('Toronto keeps exact-itinerary verification mandatory', () => {
  assert.strictEqual(toronto.recommendation.requiresExactItineraryVerification, true);
});

const lahore = resolveWorldwideCity('Lahore', { countryCode: 'PK' });

check('Lahore resolves as a worldwide origin with country disambiguation', () => {
  assert.ok(lahore);
  assert.strictEqual(lahore.countryCode, 'PK');
  assert.strictEqual(lahore.origin.eligible, true);
  assert.ok(lahore.origin.preferredAirportCode || lahore.origin.providerLocationCode);
});

const destinationSearch = searchWorldwideRegistry({ scope: 'destination', limit: 25 });

check('destination search returns only curated destination records', () => {
  assert.ok(destinationSearch.records.length > 0);
  assert.ok(destinationSearch.records.every(record => record.destination.curated === true));
  assert.ok(destinationSearch.records.every(record => record.destination.eligible === true));
});

const activeSearch = searchWorldwideRegistry({ scope: 'active', limit: 25 });

check('active search returns only activation-approved records', () => {
  assert.ok(activeSearch.records.length > 0);
  assert.ok(activeSearch.records.every(record => record.recommendation.tier === 'production-active'));
  assert.ok(activeSearch.records.every(record => record.recommendation.liveRecommendationEligible === true));
});

const originSearch = searchWorldwideRegistry({ scope: 'origin', q: 'Rabat', countryCode: 'MA', limit: 10 });

check('worldwide origin search preserves arbitrary-origin capability', () => {
  assert.ok(originSearch.records.length >= 1);
  assert.ok(originSearch.records.some(record => record.countryCode === 'MA'));
});

const rawOnlyRow = _internal.worldwideRows.find(row =>
  row
  && row.canonicalCityName
  && row.countryCode
  && !findForCatalogueRow(row)
);

check('catalogue still contains cities outside the curated 1,000', () => {
  assert.ok(rawOnlyRow);
});

const rawOnly = _internal.publicWorldwideRecord(rawOnlyRow, null);

check('a non-curated worldwide city is origin-only, not silently promoted', () => {
  assert.strictEqual(rawOnly.destination.curated, false);
  assert.strictEqual(rawOnly.recommendation.tier, 'origin-only');
  assert.strictEqual(rawOnly.recommendation.liveRecommendationEligible, false);
});

check('non-curated worldwide records do not inherit provider approval objects', () => {
  assert.strictEqual(rawOnly.providers, null);
  assert.strictEqual(rawOnly.validation, null);
});

check('all sampled 701A outputs retain exact verification boundary', () => {
  const sampled = [toronto, lahore, rawOnly, ...destinationSearch.records, ...activeSearch.records];
  assert.ok(sampled.every(record => record.recommendation.requiresExactItineraryVerification === true));
});

console.log(`GV-DATA-701A validation passed (${passed}/${passed}).`);
