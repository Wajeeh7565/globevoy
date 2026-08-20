'use strict';

const assert = require('assert');

const STAGING_ORIGIN = 'https://staging.example.amplifyapp.com';
process.env.CORS_ORIGIN = `${STAGING_ORIGIN}/`;
process.env.ENABLE_GLOBAL_RECOMMENDATION_COVERAGE_AUDIT_702A = 'true';
process.env.ENABLE_WORLDWIDE_CITY_REGISTRY_701A = 'true';
process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';

const audit = require('./services/global-recommendation-coverage-702a');
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
  await check('702A service version marker is exact', () => {
    assert.strictEqual(audit.VERSION, 'GV-REC-702A');
    assert.strictEqual(audit.FLAG_NAME, 'ENABLE_GLOBAL_RECOMMENDATION_COVERAGE_AUDIT_702A');
    assert.strictEqual(audit.enabled(), true);
  });

  await check('702A staging API version marker is exact', () => {
    assert.strictEqual(staging.GLOBAL_COVERAGE_API_VERSION, 'GV-REC-702A');
  });

  const summary = audit.summary();
  console.log('GV-REC-702A SUMMARY ' + JSON.stringify({
    counts: summary.counts,
    readinessTiers: summary.readinessTiers,
    primaryGaps: summary.primaryGaps,
    retryQueues: summary.retryQueues,
    regions: summary.regions,
    selectionTiers: summary.selectionTiers,
    expansionMath: summary.expansionMath
  }));

  await check('audit preserves exactly 1,000 curated destination records', () => {
    assert.strictEqual(summary.counts.curatedDestinationCities, 1000);
  });

  await check('audit pins the reviewed 668T activation baseline at 439 production-active cities', () => {
    assert.strictEqual(summary.counts.productionActive, 439);
    assert.strictEqual(summary.expansionMath.currentlyProductionActive, 439);
    assert.strictEqual(summary.expansionMath.curatedButNotProductionActive, 561);
  });

  await check('complete 668T snapshot covers all 1,000 curated cities', () => {
    assert.strictEqual(summary.counts.auditedIn668T, 1000);
    assert.strictEqual(summary.counts.unaudited, 0);
    assert.strictEqual(summary.counts.reviewedInactive, 561);
  });

  await check('readiness tier counts cover the full curated registry exactly once', () => {
    const total = Object.values(summary.readinessTiers).reduce((sum, value) => sum + Number(value || 0), 0);
    assert.strictEqual(total, 1000);
  });

  await check('regional totals and active totals reconcile to the global baseline', () => {
    const totals = Object.values(summary.regions).reduce((acc, value) => {
      acc.total += Number(value?.total || 0);
      acc.active += Number(value?.productionActive || 0);
      return acc;
    }, { total: 0, active: 0 });
    assert.strictEqual(totals.total, 1000);
    assert.strictEqual(totals.active, 439);
  });

  await check('selection-tier totals reconcile to the global baseline', () => {
    const totals = Object.values(summary.selectionTiers).reduce((acc, value) => {
      acc.total += Number(value?.total || 0);
      acc.active += Number(value?.productionActive || 0);
      return acc;
    }, { total: 0, active: 0 });
    assert.strictEqual(totals.total, 1000);
    assert.strictEqual(totals.active, 439);
  });

  await check('mapping and route counts remain bounded by the 1,000-city registry', () => {
    for (const key of ['destinationEligible', 'routeIdentityReady', 'travelpayoutsMapped', 'agodaMapped', 'bothProvidersMapped', 'gatewayDependent']) {
      assert.ok(summary.counts[key] >= 0 && summary.counts[key] <= 1000, key);
    }
  });

  const records = audit._internal.auditedRecords();
  const activeSample = records.find(record => record.readiness.productionActive === true);
  const inactiveSample = records.find(record => record.readiness.productionActive === false);

  await check('audit has both active and inactive samples', () => {
    assert.ok(activeSample);
    assert.ok(inactiveSample);
  });

  await check('production-active records carry no blocker and still require exact itinerary verification', () => {
    assert.strictEqual(activeSample.readiness.tier, 'production-active');
    assert.strictEqual(activeSample.readiness.primaryGap, null);
    assert.strictEqual(activeSample.readiness.requiresExactItineraryVerification, true);
  });

  await check('inactive records retain a blocker and exact itinerary verification boundary', () => {
    assert.ok(inactiveSample.readiness.primaryGap);
    assert.strictEqual(inactiveSample.readiness.productionActive, false);
    assert.strictEqual(inactiveSample.readiness.requiresExactItineraryVerification, true);
  });

  await check('every audited record keeps active/blocker states mutually consistent', () => {
    assert.ok(records.every(record => record.readiness.requiresExactItineraryVerification === true));
    assert.ok(records.every(record => record.readiness.productionActive
      ? record.readiness.primaryGap === null
      : Boolean(record.readiness.primaryGap)));
  });

  await check('resolve returns the same active sample by city ID', () => {
    const resolved = audit.resolve(activeSample.cityId);
    assert.ok(resolved);
    assert.strictEqual(resolved.cityId, activeSample.cityId);
    assert.strictEqual(resolved.readiness.productionActive, true);
  });

  const activeSearch = audit.search({ active: 'true', limit: 200 });
  await check('active search reports exactly 439 matches and only active records', () => {
    assert.strictEqual(activeSearch.totalMatches, 439);
    assert.ok(activeSearch.records.length > 0);
    assert.ok(activeSearch.records.every(record => record.readiness.productionActive === true));
  });

  const inactiveSearch = audit.search({ active: 'false', limit: 200 });
  await check('inactive search reports exactly 561 matches and only inactive records', () => {
    assert.strictEqual(inactiveSearch.totalMatches, 561);
    assert.ok(inactiveSearch.records.length > 0);
    assert.ok(inactiveSearch.records.every(record => record.readiness.productionActive === false));
  });

  const mappedInactive = audit.search({ active: 'false', mapped: 'true', limit: 200 });
  await check('mapped inactive search exposes the targeted re-audit pool without activating it', () => {
    assert.ok(mappedInactive.totalMatches >= summary.counts.mappedReviewedInactive);
    assert.ok(mappedInactive.records.every(record => record.readiness.productionActive === false));
    assert.ok(mappedInactive.records.every(record => record.staticProviderMappings.bothProvidersMapped === true));
  });

  const summaryResponse = await staging.handler(event('/api/global-recommendation-coverage'));
  const apiSummary = parse(summaryResponse);

  await check('702A staging endpoint returns the deterministic summary', () => {
    assert.strictEqual(summaryResponse.statusCode, 200);
    assert.strictEqual(apiSummary.ok, true);
    assert.strictEqual(apiSummary.enabled, true);
    assert.strictEqual(apiSummary.status, 'coverage-audit-ready');
    assert.strictEqual(apiSummary.counts.curatedDestinationCities, 1000);
    assert.strictEqual(apiSummary.counts.productionActive, 439);
  });

  await check('702A staging endpoint keeps exact staging CORS and audit header', () => {
    assert.strictEqual(summaryResponse.headers['Access-Control-Allow-Origin'], STAGING_ORIGIN);
    assert.strictEqual(summaryResponse.headers['X-Globevoy-Staging'], 'GV-PLATFORM-700A-STAGING-API-R1');
    assert.strictEqual(summaryResponse.headers['X-Globevoy-Audit'], 'GV-REC-702A');
  });

  const resolveResponse = await staging.handler(event('/api/global-recommendation-coverage', {
    resolve: inactiveSample.cityId
  }));
  const resolvedPayload = parse(resolveResponse);

  await check('702A API resolves an inactive city without promoting it', () => {
    assert.strictEqual(resolveResponse.statusCode, 200);
    assert.strictEqual(resolvedPayload.status, 'resolved');
    assert.strictEqual(resolvedPayload.found, true);
    assert.strictEqual(resolvedPayload.record.cityId, inactiveSample.cityId);
    assert.strictEqual(resolvedPayload.record.readiness.productionActive, false);
    assert.ok(resolvedPayload.record.readiness.primaryGap);
  });

  const postResponse = await staging.handler(event('/api/global-recommendation-coverage', {}, 'POST'));
  await check('702A endpoint is GET-only', () => {
    assert.strictEqual(postResponse.statusCode, 405);
    assert.strictEqual(parse(postResponse).error, 'GET required');
  });

  const unknownOriginResponse = await staging.handler(event(
    '/api/global-recommendation-coverage', {}, 'GET', 'https://not-staging.example.com'
  ));
  await check('unknown origin fails before 702A endpoint execution', () => {
    assert.strictEqual(unknownOriginResponse.statusCode, 403);
    assert.strictEqual(parse(unknownOriginResponse).error, 'staging-origin-not-allowed');
  });

  process.env.ENABLE_GLOBAL_RECOMMENDATION_COVERAGE_AUDIT_702A = 'false';
  const disabledResponse = await staging.handler(event('/api/global-recommendation-coverage', { active: 'false' }));
  const disabled = parse(disabledResponse);

  await check('feature-off 702A search fails closed without records', () => {
    assert.strictEqual(disabledResponse.statusCode, 200);
    assert.strictEqual(disabled.enabled, false);
    assert.strictEqual(disabled.status, 'feature-disabled');
    assert.deepStrictEqual(disabled.records, []);
  });

  process.env.ENABLE_GLOBAL_RECOMMENDATION_COVERAGE_AUDIT_702A = 'true';
  const worldwideResponse = await staging.handler(event('/api/worldwide-city-registry'));
  await check('701B worldwide endpoint remains intact after 702A wrapper extension', () => {
    assert.strictEqual(worldwideResponse.statusCode, 200);
    assert.strictEqual(parse(worldwideResponse).apiVersion, 'GV-DATA-701B');
  });

  console.log(`GV-REC-702A validation passed (${passed}/${passed}).`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
