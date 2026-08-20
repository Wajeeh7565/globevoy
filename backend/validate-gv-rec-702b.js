'use strict';

const assert = require('assert');

const STAGING_ORIGIN = 'https://staging.example.amplifyapp.com';
const AS_OF = '2026-08-20T12:00:00.000Z';
process.env.CORS_ORIGIN = `${STAGING_ORIGIN}/`;
process.env.ENABLE_WORLDWIDE_CITY_REGISTRY_701A = 'true';
process.env.ENABLE_GLOBAL_RECOMMENDATION_COVERAGE_AUDIT_702A = 'true';
process.env.ENABLE_GLOBAL_RECOVERY_PRIORITY_702B = 'true';

const priority = require('./services/global-recovery-priority-702b');
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
function parse(response) { return JSON.parse(response.body || '{}'); }

(async () => {
  await check('702B service version marker is exact', () => {
    assert.strictEqual(priority.VERSION, 'GV-REC-702B');
  });
  await check('702B staging API marker is exact', () => {
    assert.strictEqual(staging.GLOBAL_RECOVERY_API_VERSION, 'GV-REC-702B');
  });

  const summary = priority.summary({ asOf: AS_OF });
  console.log('GV-REC-702B SUMMARY', JSON.stringify({ counts: summary.counts, lanes: summary.lanes, primaryGaps: summary.primaryGaps, policy: summary.policy }));

  await check('702B preserves the exact 431 mapped-reviewed-inactive pool', () => {
    assert.strictEqual(summary.counts.mappedReviewedInactive, 431);
  });
  await check('702B recognizes 132 surviving cities from July Recovery150', () => {
    assert.strictEqual(summary.counts.previousRecoverySurvivors, 132);
  });
  await check('702B identifies 299 mapped inactive cities not re-run in Recovery150', () => {
    assert.strictEqual(summary.counts.notPreviouslyRecoveryAudited, 299);
  });
  await check('702B preserves July Recovery150 source facts', () => {
    assert.strictEqual(summary.policy.previousRecoveryTaskId, 'GV-CITY-668S');
    assert.strictEqual(summary.policy.previousRecoverySelectedCount, 150);
    assert.strictEqual(summary.policy.previousRecoveryProductionReadyCount, 18);
    assert.strictEqual(summary.policy.reviewAfterDays, 30);
  });
  await check('702B lane counts reconcile to all 431 candidates', () => {
    const total = Object.values(summary.lanes).reduce((sum, value) => sum + Number(value || 0), 0);
    assert.strictEqual(total, 431);
  });
  await check('702B has a bounded due-now first-recovery wave by Aug 20', () => {
    assert.ok(Array.isArray(summary.recommendedFirstWave));
    assert.ok(summary.recommendedFirstWave.length > 0);
    assert.ok(summary.recommendedFirstWave.length <= 50);
    assert.ok(summary.recommendedFirstWave.every(record => record.lane === 'due-now-first-recovery'));
  });
  await check('first-recovery wave excludes July Recovery150 survivors', () => {
    assert.ok(summary.recommendedFirstWave.every(record => record.previousRecovery668S === false));
    assert.ok(summary.recommendedFirstWave.every(record => record.reviewDue === true));
  });
  await check('702B never grants activation and always preserves exact verification', () => {
    const all = priority._internal.buildRecords({ asOf: AS_OF }).records;
    assert.strictEqual(all.length, 431);
    assert.ok(all.every(record => record.activationAllowedByThisPlan === false));
    assert.ok(all.every(record => record.requiresExactItineraryVerification === true));
  });

  const recoverySurvivors = priority.search({ asOf: AS_OF, previousRecovery: 'true', limit: 200 });
  await check('search isolates exactly 132 prior Recovery150 survivors', () => {
    assert.strictEqual(recoverySurvivors.totalMatches, 132);
    assert.ok(recoverySurvivors.records.every(record => record.previousRecovery668S === true));
  });
  await check('July 22 recovery survivors are not prematurely due on Aug 20', () => {
    assert.ok(recoverySurvivors.records.every(record => record.reviewDue === false));
    assert.ok(recoverySurvivors.records.every(record => record.lane === 'defer-recent-recovery'));
  });

  const firstRecovery = priority.search({ asOf: AS_OF, lane: 'due-now-first-recovery', limit: 200 });
  await check('due-now first-recovery search never repeats Recovery150', () => {
    assert.ok(firstRecovery.totalMatches > 0);
    assert.ok(firstRecovery.records.every(record => record.previousRecovery668S === false));
    assert.ok(firstRecovery.records.every(record => record.reviewDue === true));
  });

  const apiSummaryResponse = await staging.handler(event('/api/global-recovery-priority'));
  const apiSummary = parse(apiSummaryResponse);
  await check('702B staging endpoint returns HTTP 200 and the 431 pool', () => {
    assert.strictEqual(apiSummaryResponse.statusCode, 200);
    assert.strictEqual(apiSummary.apiVersion, 'GV-REC-702B');
    assert.strictEqual(apiSummary.status, 'recovery-priority-ready');
    assert.strictEqual(apiSummary.counts.mappedReviewedInactive, 431);
  });
  await check('702B staging endpoint keeps exact staging CORS and recovery header', () => {
    assert.strictEqual(apiSummaryResponse.headers['Access-Control-Allow-Origin'], STAGING_ORIGIN);
    assert.strictEqual(apiSummaryResponse.headers['X-Globevoy-Recovery'], 'GV-REC-702B');
  });

  const apiSearchResponse = await staging.handler(event('/api/global-recovery-priority', {
    lane: 'due-now-first-recovery',
    asOf: AS_OF,
    limit: '10'
  }));
  const apiSearch = parse(apiSearchResponse);
  await check('702B API returns prioritized non-duplicate re-check records', () => {
    assert.strictEqual(apiSearch.status, 'search');
    assert.ok(apiSearch.totalMatches > 0);
    assert.ok(apiSearch.records.every(record => record.previousRecovery668S === false));
    assert.ok(apiSearch.records.every(record => record.activationAllowedByThisPlan === false));
  });

  const postResponse = await staging.handler(event('/api/global-recovery-priority', {}, 'POST'));
  await check('702B endpoint remains GET-only', () => {
    assert.strictEqual(postResponse.statusCode, 405);
    assert.strictEqual(parse(postResponse).error, 'GET required');
  });

  const wrongOriginResponse = await staging.handler(event('/api/global-recovery-priority', {}, 'GET', 'https://not-staging.example.com'));
  await check('unknown origin fails before 702B execution', () => {
    assert.strictEqual(wrongOriginResponse.statusCode, 403);
    assert.strictEqual(parse(wrongOriginResponse).error, 'staging-origin-not-allowed');
  });

  process.env.ENABLE_GLOBAL_RECOVERY_PRIORITY_702B = 'false';
  const disabledResponse = await staging.handler(event('/api/global-recovery-priority', { lane: 'due-now-first-recovery' }));
  const disabled = parse(disabledResponse);
  await check('feature-off 702B search fails closed without records', () => {
    assert.strictEqual(disabledResponse.statusCode, 200);
    assert.strictEqual(disabled.enabled, false);
    assert.strictEqual(disabled.status, 'feature-disabled');
    assert.deepStrictEqual(disabled.records, []);
  });
  process.env.ENABLE_GLOBAL_RECOVERY_PRIORITY_702B = 'true';

  const coverageResponse = await staging.handler(event('/api/global-recommendation-coverage'));
  await check('702A coverage endpoint remains intact after 702B wrapper extension', () => {
    assert.strictEqual(coverageResponse.statusCode, 200);
    assert.strictEqual(parse(coverageResponse).apiVersion, 'GV-REC-702A');
  });

  console.log(`GV-REC-702B validation passed (${passed}/${passed}).`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
