'use strict';

const fs = require('fs');
const path = require('path');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668R = 'true';
process.env.ENABLE_INACTIVE_CITY_RECOVERY_668S = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const recovery = require('./services/inactive-city-recovery-wave1');
const provider = require('./services/provider-live-coverage');
const lambda = require('./lambda');
const plan = require('./data/inactive-city-recovery-wave1-150-668s.json');
const snapshot = require('./data/verified-city-activation-1000-668r.json');
const review = require('./data/verified-city-review-579-668r.json');
const registry = require('./data/unified-city-registry-1000-668b.json');

const checks = [];
function check(name, pass, details = null) {
  checks.push({ name, pass: Boolean(pass), details });
  if (!pass) console.error('FAIL', name, details);
}
function parseBody(response) { return JSON.parse(response.body); }

(async () => {
  const records = plan.records || [];
  const ids = records.map(record => record.cityId);
  const reviewById = new Map((review.records || []).map(record => [record.cityId, record]));
  const registryById = new Map((registry.records || []).map(record => [record.cityId, record]));
  const snapshotById = new Map((snapshot.records || []).map(record => [record.cityId, record]));
  const lanes = records.reduce((acc, record) => {
    acc[record.recoveryLane] = (acc[record.recoveryLane] || 0) + 1;
    return acc;
  }, {});

  check('service version is 668S', recovery.VERSION === 'GV-CITY-668S', recovery.VERSION);
  check('668S feature is enabled', recovery.enabled() === true);
  check('plan identity is correct', plan.taskId === 'GV-CITY-668S' && plan.status === 'inactive-city-recovery-wave-1-plan-ready');
  check('plan contains 150 records', records.length === 150 && plan.summary.selectedCount === 150);
  check('plan contains 150 unique IDs', new Set(ids).size === 150);
  check('baseline is 668R', plan.source.activationTaskId === 'GV-CITY-668R');
  check('baseline audited count is 1000', plan.source.auditedCityCountBeforeRun === 1000);
  check('baseline active count is 421', plan.source.productionActiveCountBeforeRun === 421);
  check('baseline reviewed-inactive count is 579', plan.source.reviewedInactiveCountBeforeRun === 579);
  check('readiness lane contains 64', lanes['readiness-recovery'] === 64);
  check('stay lane contains 6', lanes['stay-recovery'] === 6);
  check('flight lane contains 80', lanes['flight-recovery'] === 80);
  check('lane order is deterministic', records.slice(0, 64).every(record => record.recoveryLane === 'readiness-recovery')
    && records.slice(64, 70).every(record => record.recoveryLane === 'stay-recovery')
    && records.slice(70).every(record => record.recoveryLane === 'flight-recovery'));
  check('all records come from 668R review set', ids.every(id => reviewById.has(id)));
  check('no already-active city is selected', ids.every(id => snapshotById.get(id)?.liveRecommendationEligible !== true));
  check('no unresolved Agoda target is selected', records.every(record => !record.retryQueues.includes('unresolved-agoda-mapping')));
  check('all selected cities have registry records', ids.every(id => registryById.has(id)));
  check('all 64 provider-covered inactive cities are included', review.records.filter(record => record.providerCoverage?.eligible === true).every(record => ids.includes(record.cityId)));
  check('all 6 mapped live-flights-only cities are included', review.records.filter(record => record.classification === 'live-flights-only' && !record.retryQueues.includes('unresolved-agoda-mapping')).every(record => ids.includes(record.cityId)));
  check('flight recovery targets were live-stays-only', records.filter(record => record.recoveryLane === 'flight-recovery').every(record => record.previousClassification === 'live-stays-only'));
  check('stay recovery targets were live-flights-only', records.filter(record => record.recoveryLane === 'stay-recovery').every(record => record.previousClassification === 'live-flights-only'));
  check('readiness targets were provider covered', records.filter(record => record.recoveryLane === 'readiness-recovery').every(record => reviewById.get(record.cityId)?.providerCoverage?.eligible === true));
  check('all 25 recoverable Group 1 cities are selected', review.records.filter(record => !record.retryQueues.includes('unresolved-agoda-mapping') && registryById.get(record.cityId)?.group === 'GROUP_1').every(record => ids.includes(record.cityId)));
  check('plan reports 25 Group 1 targets', plan.summary.group1Count === 25);
  check('plan reports 114 international-airport signals', plan.summary.internationalAirportSignalCount === 114);
  check('plan reports two gateway targets', plan.summary.gatewayTransferCount === 2);
  check('recovery thresholds remain strict', plan.policy.recoveryAuditPolicy.thresholdsRelaxed === false
    && plan.policy.recoveryAuditPolicy.maxComfortDurationMinutes === 1080
    && plan.policy.recoveryAuditPolicy.maxComfortTransfers === 1);
  check('recovery audit uses four flight months', plan.policy.recoveryAuditPolicy.flightMonths === 4);
  check('recovery audit uses six anchors', plan.policy.recoveryAuditPolicy.regionalAnchorCount === 6);
  check('recovery audit uses 20 flight attempts', plan.policy.recoveryAuditPolicy.maximumFlightAttempts === 20);
  check('recovery audit uses four stay windows', plan.policy.recoveryAuditPolicy.stayWindows === 4);
  check('recovery audit uses three Agoda strategies', plan.policy.recoveryAuditPolicy.agodaQualityStrategies === 3);

  const staticHonolulu = provider._internal.staticById.get('honolulu-us');
  process.env.ENABLE_INACTIVE_CITY_RECOVERY_668S = 'false';
  const standardAnchors = provider._internal.anchorsForRecord(staticHonolulu, {});
  process.env.ENABLE_INACTIVE_CITY_RECOVERY_668S = 'true';
  const recoveryAnchors = provider._internal.anchorsForRecord(staticHonolulu, { recoveryMode: true, anchorCount: 6 });
  check('standard verification keeps four anchors', standardAnchors.length === 4, standardAnchors);
  check('recovery verification expands to six anchors', recoveryAnchors.length === 6, recoveryAnchors);
  check('recovery anchors are unique', new Set(recoveryAnchors).size === recoveryAnchors.length, recoveryAnchors);
  check('recovery mode parser accepts boolean true', provider._internal.recoveryMode({ recoveryMode: true }) === true);
  check('recovery flight months can span four months', provider._internal.flightMonths({ month: '2026-09', monthCount: 4 }).length === 4);
  check('recovery stay windows can span four windows', provider._internal.stayCheckIns({ checkIn: '2026-09-05', stayWindowCount: 4 }).length === 4);

  const summary = recovery.summary();
  const allSearch = recovery.search({ limit: 200 });
  const readinessSearch = recovery.search({ lane: 'readiness-recovery', limit: 200 });
  const staySearch = recovery.search({ lane: 'stay-recovery', limit: 200 });
  const flightSearch = recovery.search({ lane: 'flight-recovery', limit: 200 });
  const groupSearch = recovery.search({ group: 'GROUP_1', limit: 200 });
  const queueSearch = recovery.search({ queue: 'flight-comfort-failure', limit: 200 });
  const honoluluSearch = recovery.search({ q: 'Honolulu', limit: 10 });
  check('summary exposes 668S counts', summary.version === 'GV-CITY-668S' && summary.summary.selectedCount === 150 && summary.activationState.productionActiveCount === 421);
  check('search returns all 150 targets', allSearch.totalMatches === 150 && allSearch.count === 150);
  check('readiness filter returns 64', readinessSearch.totalMatches === 64);
  check('stay filter returns 6', staySearch.totalMatches === 6);
  check('flight filter returns 80', flightSearch.totalMatches === 80);
  check('Group 1 filter returns 25', groupSearch.totalMatches === 25);
  check('flight-comfort queue filter returns 61', queueSearch.totalMatches === 61);
  check('text search finds Honolulu', honoluluSearch.totalMatches === 1 && honoluluSearch.records[0].cityId === 'honolulu-us');

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/inactive-city-recovery-wave1', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaLane = parseBody(await lambda.handler({ rawPath: '/api/inactive-city-recovery-wave1', requestContext: { http: { method: 'GET' } }, queryStringParameters: { lane: 'stay-recovery', limit: '150' } }));
  const methodDenied = await lambda.handler({ rawPath: '/api/inactive-city-recovery-wave1', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('Lambda summary endpoint works', lambdaSummary.version === 'GV-CITY-668S' && lambdaSummary.summary.selectedCount === 150);
  check('Lambda recovery-lane search works', lambdaLane.totalMatches === 6 && lambdaLane.records.every(record => record.recoveryLane === 'stay-recovery'));
  check('Lambda recovery endpoint is read-only', methodDenied.statusCode === 405);

  process.env.ENABLE_INACTIVE_CITY_RECOVERY_668S = 'false';
  check('feature flag disables recovery plan', recovery.enabled() === false && recovery.summary().status === 'feature-disabled');
  process.env.ENABLE_INACTIVE_CITY_RECOVERY_668S = 'true';

  check('668R snapshot remains unchanged', snapshot.summary.productionActiveCount === 421 && snapshot.summary.auditedCount === 1000 && snapshot.summary.auditedInactiveCount === 579);
  check('421 active cities remain untouched by plan', snapshot.records.filter(record => record.liveRecommendationEligible === true).length === 421);

  const passed = checks.filter(check => check.pass).length;
  const result = {
    taskId: 'GV-CITY-668S',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668S.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
