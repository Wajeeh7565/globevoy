'use strict';

const assert = require('assert');

const STAGING_ORIGIN = 'https://staging.example.amplifyapp.com';
process.env.CORS_ORIGIN = `${STAGING_ORIGIN}/`;
process.env.ENABLE_WORLDWIDE_CITY_REGISTRY_701A = 'true';
process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';

const staging = require('./staging-lambda');

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

function event(path, query = {}, method = 'GET', origin = STAGING_ORIGIN) {
  return {
    rawPath: path,
    headers: origin ? { Origin: origin } : {},
    queryStringParameters: query,
    requestContext: { http: { method } }
  };
}

function parse(response) {
  return JSON.parse(response.body || '{}');
}

(async () => {
  await check('701B API version marker is exact', () => {
    assert.strictEqual(staging.WORLDWIDE_API_VERSION, 'GV-DATA-701B');
  });

  const summaryResponse = await staging.handler(event('/api/worldwide-city-registry'));
  const summary = parse(summaryResponse);

  await check('worldwide endpoint returns HTTP 200', () => {
    assert.strictEqual(summaryResponse.statusCode, 200);
    assert.strictEqual(summary.ok, true);
    assert.strictEqual(summary.status, 'ready');
  });

  await check('worldwide endpoint keeps staging CORS and diagnostic headers', () => {
    assert.strictEqual(summaryResponse.headers['Access-Control-Allow-Origin'], STAGING_ORIGIN);
    assert.strictEqual(summaryResponse.headers['X-Globevoy-Staging'], 'GV-PLATFORM-700A-STAGING-API-R1');
    assert.strictEqual(summaryResponse.headers['X-Globevoy-Data'], 'GV-DATA-701B');
  });

  await check('summary preserves 9,665 worldwide identities', () => {
    assert.strictEqual(summary.counts.worldwideIdentityCities, 9665);
  });

  await check('summary preserves exactly 1,000 curated destinations', () => {
    assert.strictEqual(summary.counts.curatedDestinationCities, 1000);
  });

  await check('summary selects 439 production-active cities under 668T validation', () => {
    assert.strictEqual(summary.counts.productionActiveCitiesInSelectedSnapshot, 439);
  });

  const torontoResponse = await staging.handler(event('/api/worldwide-city-registry', {
    resolve: 'Toronto',
    countryCode: 'CA'
  }));
  const toronto = parse(torontoResponse);

  await check('resolve mode returns Toronto as a curated city', () => {
    assert.strictEqual(torontoResponse.statusCode, 200);
    assert.strictEqual(toronto.status, 'resolved');
    assert.strictEqual(toronto.found, true);
    assert.strictEqual(toronto.record.displayName, 'Toronto');
    assert.strictEqual(toronto.record.countryCode, 'CA');
    assert.strictEqual(toronto.record.destination.curated, true);
  });

  await check('resolve mode preserves Toronto YYZ integrity', () => {
    assert.strictEqual(toronto.record.origin.preferredAirportCode, 'YYZ');
    assert.ok(toronto.record.origin.airportCodes.includes('YYZ'));
  });

  await check('resolve mode never removes exact itinerary verification', () => {
    assert.strictEqual(toronto.record.recommendation.requiresExactItineraryVerification, true);
  });

  const lahoreResponse = await staging.handler(event('/api/worldwide-city-registry', {
    resolve: 'Lahore',
    countryCode: 'PK'
  }));
  const lahore = parse(lahoreResponse);

  await check('resolve mode supports worldwide origin lookup for Lahore', () => {
    assert.strictEqual(lahore.status, 'resolved');
    assert.strictEqual(lahore.record.countryCode, 'PK');
    assert.strictEqual(lahore.record.origin.eligible, true);
  });

  const destinationResponse = await staging.handler(event('/api/worldwide-city-registry', {
    scope: 'destination',
    limit: '20'
  }));
  const destinations = parse(destinationResponse);

  await check('destination scope returns only curated destination records', () => {
    assert.strictEqual(destinations.status, 'search');
    assert.ok(destinations.records.length > 0);
    assert.ok(destinations.records.every(record => record.destination.curated === true));
    assert.ok(destinations.records.every(record => record.destination.eligible === true));
  });

  const activeResponse = await staging.handler(event('/api/worldwide-city-registry', {
    scope: 'active',
    limit: '20'
  }));
  const active = parse(activeResponse);

  await check('active scope returns only activation-approved cities', () => {
    assert.strictEqual(active.status, 'search');
    assert.ok(active.records.length > 0);
    assert.ok(active.records.every(record => record.recommendation.tier === 'production-active'));
    assert.ok(active.records.every(record => record.recommendation.liveRecommendationEligible === true));
  });

  const postResponse = await staging.handler(event('/api/worldwide-city-registry', {}, 'POST'));

  await check('worldwide endpoint is read-only GET', () => {
    assert.strictEqual(postResponse.statusCode, 405);
    assert.strictEqual(parse(postResponse).error, 'GET required');
  });

  const unknownOriginResponse = await staging.handler(event(
    '/api/worldwide-city-registry',
    {},
    'GET',
    'https://not-staging.example.com'
  ));

  await check('unknown browser origin fails before worldwide endpoint execution', () => {
    assert.strictEqual(unknownOriginResponse.statusCode, 403);
    assert.strictEqual(parse(unknownOriginResponse).error, 'staging-origin-not-allowed');
  });

  const missingOriginResponse = await staging.handler(event('/api/worldwide-city-registry', {}, 'GET', ''));

  await check('missing browser origin remains rejected', () => {
    assert.strictEqual(missingOriginResponse.statusCode, 403);
    assert.strictEqual(parse(missingOriginResponse).error, 'staging-origin-required');
  });

  process.env.ENABLE_WORLDWIDE_CITY_REGISTRY_701A = 'false';
  const disabledResponse = await staging.handler(event('/api/worldwide-city-registry', { q: 'Toronto' }));
  const disabled = parse(disabledResponse);

  await check('feature-off query fails closed without returning worldwide records', () => {
    assert.strictEqual(disabledResponse.statusCode, 200);
    assert.strictEqual(disabled.enabled, false);
    assert.strictEqual(disabled.status, 'feature-disabled');
    assert.deepStrictEqual(disabled.records, []);
  });

  process.env.ENABLE_WORLDWIDE_CITY_REGISTRY_701A = 'true';
  const delegatedResponse = await staging.handler(event('/api/current-500-completion-audit'));

  await check('existing staging API routes still delegate to verified production handler', () => {
    assert.strictEqual(delegatedResponse.statusCode, 200);
    assert.strictEqual(delegatedResponse.headers['Access-Control-Allow-Origin'], STAGING_ORIGIN);
    assert.strictEqual(delegatedResponse.headers['X-Globevoy-Staging'], 'GV-PLATFORM-700A-STAGING-API-R1');
    assert.strictEqual(parse(delegatedResponse).version, 'GV-CITY-668K');
  });

  console.log(`GV-DATA-701B validation passed (${passed}/${passed}).`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
