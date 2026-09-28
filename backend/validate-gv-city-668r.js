'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L = 'true';
process.env.ENABLE_EXPANSION_500_PRIORITY_AUDIT_668M = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N = 'true';
process.env.ENABLE_EXPANSION_500_PRIORITY_AUDIT_668O = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668P = 'true';
process.env.ENABLE_EXPANSION_500_FINAL_AUDIT_668Q = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668R = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const activation = require('./services/cities/registry/verified-city-activation');
const cityRegistry = require('./services/city-registry');
const routeGraph = require('./services/domain/routing/global-route-graph');
const lambda = require('./lambda');
const snapshot = require('./data/verified-city-activation-1000-668r.json');
const retry = require('./data/verified-city-retry-queues-668r.json');
const baseline = require('./data/verified-city-activation-845-668p.json');
const final155 = require('./data/provider-live-final155-668q-source.json');
const activeFile = require('./data/verified-city-production-active-421-668r.json');
const reviewFile = require('./data/verified-city-review-579-668r.json');
const registry = require('./data/unified-city-registry-1000-668b.json');

const checks = [];
function check(name, pass, details = {}) {
  checks.push({ name, pass: Boolean(pass), details });
  if (!pass) console.error('FAIL', name, details);
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function ids(records) { return records.map(record => record.cityId); }
function parseBody(response) { return JSON.parse(response.body); }
function get(id, includeEvidence = true) { return activation.activationForCity(id, { includeEvidence }); }

(async () => {
  const active = snapshot.records.filter(record => record.liveRecommendationEligible === true);
  const inactive = snapshot.records.filter(record => record.liveRecommendationEligible !== true);
  const current = snapshot.records.filter(record => record.selectionTier === 'current-500');
  const expansion = snapshot.records.filter(record => record.selectionTier === 'expansion-500');
  const source668Q = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668Q');
  const source668QActive = source668Q.filter(record => record.liveRecommendationEligible);
  const source668QReview = source668Q.filter(record => !record.liveRecommendationEligible);

  check('service version is 668R', activation.VERSION === 'GV-CITY-668R', activation.VERSION);
  check('668R feature flag is enabled', activation.enabled() === true);
  check('snapshot identity is correct', snapshot.taskId === 'GV-CITY-668R' && snapshot.status === 'merged-verified-activation-snapshot');
  check('668P baseline identity is correct', baseline.taskId === 'GV-CITY-668P' && baseline.summary.auditedCount === 845 && baseline.summary.productionActiveCount === 420);
  check('668Q source identity is correct', final155.taskId === 'GV-CITY-668Q' && final155.mode === 'Final155' && final155.completedCount === 155 && final155.productionActiveCount === 1 && final155.reviewCount === 154);
  check('seven source audits are preserved', Array.isArray(snapshot.sourceAudits) && snapshot.sourceAudits.length === 7, snapshot.sourceAudits?.map(item => item.taskId));
  check('668P baseline SHA is pinned', snapshot.sourceSnapshots?.[0]?.sourceFileSha256 === sha256(path.join(__dirname, 'data', 'verified-city-activation-845-668p.json')));
  check('668Q source SHA is pinned', snapshot.sourceAudits[6].sourceFileSha256 === sha256(path.join(__dirname, 'data', 'provider-live-final155-668q-source.json')));
  check('668P and 668Q city sets do not overlap', baseline.records.every(record => !final155.records.some(item => item.cityId === record.cityId)));

  check('snapshot contains 1000 unique audited cities', snapshot.records.length === 1000 && new Set(ids(snapshot.records)).size === 1000);
  check('668Q contributes exactly 155 records', source668Q.length === 155);
  check('668Q contributes 1 active and 154 reviewed inactive', source668QActive.length === 1 && source668QReview.length === 154, { active: source668QActive.length, review: source668QReview.length });
  check('snapshot contains exactly 421 production-active cities', active.length === 421, active.length);
  check('snapshot contains exactly 579 reviewed inactive cities', inactive.length === 579, inactive.length);
  check('active modes are 394 direct/metro and 27 gateway', active.filter(record => record.activation.mode === 'direct-or-metro').length === 394 && active.filter(record => record.activation.mode === 'gateway-supported').length === 27, snapshot.summary.activeModeCounts);
  check('Current-500 remains fully audited', current.length === 500 && snapshot.policy.current500AuditComplete === true && snapshot.policy.current500AuditedCount === 500);
  check('Current-500 split remains 309 active and 191 inactive', current.filter(record => record.liveRecommendationEligible).length === 309 && current.filter(record => !record.liveRecommendationEligible).length === 191, snapshot.summary.current500);
  check('Expansion-500 is fully audited', expansion.length === 500 && snapshot.policy.expansion500AuditComplete === true && snapshot.policy.expansion500AuditedCount === 500);
  check('Expansion-500 split is 112 active and 388 inactive', expansion.filter(record => record.liveRecommendationEligible).length === 112 && expansion.filter(record => !record.liveRecommendationEligible).length === 388, snapshot.summary.expansion500);
  check('registry is fully audited with no unaudited cities', registry.records.length === 1000 && snapshot.summary.unauditedCount === 0 && snapshot.policy.fullRegistryAuditComplete === true);
  check('estimate-only total is 579', snapshot.summary.estimateOnlyCount === 579);
  check('provider-covered count is 485', snapshot.summary.providerCoveredCount === 485);
  check('classification counts are exact', snapshot.summary.classificationCounts['live-both'] === 456 && snapshot.summary.classificationCounts['live-stays-only'] === 335 && snapshot.summary.classificationCounts['gateway-supported'] === 29 && snapshot.summary.classificationCounts['unresolved'] === 109 && snapshot.summary.classificationCounts['live-flights-only'] === 27 && snapshot.summary.classificationCounts['estimate-only'] === 43 && snapshot.summary.classificationCounts['provider-error'] === 1, snapshot.summary.classificationCounts);

  check('all active cities use production provider evidence', active.every(record => record.evidence.travelpayouts.evidenceMode === 'production-provider-response' && record.evidence.agoda.evidenceMode === 'production-provider-response'));
  check('all active cities passed recommendation readiness', active.every(record => record.recommendationReadiness?.eligible === true));
  check('all active cities have no retry queues', active.every(record => Array.isArray(record.retryQueues) && record.retryQueues.length === 0));
  check('all inactive audited cities remain discoverable estimate-only', inactive.every(record => record.discoveryEligible === true && record.recommendationMode === 'estimate-only'));
  check('no inactive city is accidentally activated', inactive.every(record => record.activation.eligible === false));
  check('all records use 668R policy version', snapshot.records.every(record => record.activation.policyVersion === 'GV-CITY-668R'));
  check('gateway-active cities retain gateway evidence', active.filter(record => record.activation.mode === 'gateway-supported').every(record => record.evidence.travelpayouts.gateway && record.evidence.travelpayouts.gatewayRequiredForDestination === true));
  check('668Q active city is direct or metro', source668QActive.every(record => record.activation.mode === 'direct-or-metro'));

  const queueCounts = snapshot.summary.retryQueueCounts;
  check('missing-flight queue count is 463', queueCounts['missing-flight-observations'] === 463);
  check('unresolved-Agoda queue count is 130', queueCounts['unresolved-agoda-mapping'] === 130);
  check('no-live-hotel-rate queue count is 50', queueCounts['no-live-hotel-rate'] === 50);
  check('hotel-quality queue count is 52', queueCounts['hotel-quality-failure'] === 52);
  check('flight-comfort queue count is 66', queueCounts['flight-comfort-failure'] === 66);
  check('retry snapshot allows overlapping membership', retry.queueMembershipCanOverlap === true && retry.reviewCityCount === 579);
  check('retry snapshot queue counts match activation snapshot', Object.entries(retry.queues).every(([name, value]) => value.count === queueCounts[name]));

  check('active JSON has 421 unique records', activeFile.count === 421 && activeFile.records.length === 421 && new Set(activeFile.cityIds).size === 421);
  check('review JSON has 579 unique records', reviewFile.count === 579 && reviewFile.records.length === 579 && new Set(reviewFile.cityIds).size === 579);
  check('active and review files partition all audited records', new Set([...activeFile.cityIds, ...reviewFile.cityIds]).size === 1000 && activeFile.cityIds.every(id => !reviewFile.cityIds.includes(id)));

  const eindhoven = get('eindhoven-nl');
  const hargeisa = get('hargeisa-so');
  const ivalo = get('ivalo-fi');
  const guernsey = get('guernsey-gg');
  const moscow = get('moscow-ru');
  const hatYai = get('hat-yai-th');
  const baku = get('baku-az');

  check('Eindhoven is newly active from 668Q', eindhoven.liveRecommendationEligible === true && eindhoven.activation.sourceAuditTaskId === 'GV-CITY-668Q' && eindhoven.evidence.travelpayouts.destinationCode === 'EIN');
  check('Hargeisa remains estimate-only after hotel-quality failure', hargeisa.liveRecommendationEligible === false && hargeisa.retryQueues.includes('hotel-quality-failure'));
  check('Ivalo remains estimate-only after flight-comfort failure', ivalo.liveRecommendationEligible === false && ivalo.retryQueues.includes('flight-comfort-failure'));
  check('Guernsey remains estimate-only after hotel-quality failure', guernsey.liveRecommendationEligible === false && guernsey.retryQueues.includes('hotel-quality-failure'));
  check('Moscow is now audited but inactive', moscow.auditStatus === 'reviewed-inactive' && moscow.liveRecommendationEligible === false);
  check('Hat Yai remains active from 668O', hatYai.liveRecommendationEligible === true && hatYai.activation.sourceAuditTaskId === 'GV-CITY-668O');
  check('Baku remains active from 668M', baku.liveRecommendationEligible === true && baku.activation.sourceAuditTaskId === 'GV-CITY-668M');

  const summary = activation.summary();
  const activeSearch = activation.search({ status: 'active', limit: 100 });
  const reviewSearch = activation.search({ status: 'review', limit: 100 });
  const unauditedSearch = activation.search({ status: 'unaudited', limit: 100 });
  const expansionSearch = activation.search({ tier: 'expansion-500', limit: 100 });
  const gatewaySearch = activation.search({ status: 'gateway-supported', limit: 100 });
  check('activation summary reports full 668R counts', summary.version === 'GV-CITY-668R' && summary.summary.auditedCount === 1000 && summary.summary.productionActiveCount === 421);
  check('active search returns 421 total matches', activeSearch.totalMatches === 421);
  check('review search returns 579 total matches', reviewSearch.totalMatches === 579);
  check('unaudited search returns zero matches', unauditedSearch.totalMatches === 0);
  check('Expansion-500 search returns all 500 cities', expansionSearch.totalMatches === 500);
  check('gateway search returns 27 total matches', gatewaySearch.totalMatches === 27);

  const registryActive = cityRegistry.searchRegistry({ live: 'true', limit: 100 });
  const registryExpansion = cityRegistry.searchRegistry({ tier: 'expansion-500', limit: 100 });
  check('city registry live filter exposes 421 active cities', registryActive.totalMatches === 421);
  check('city registry keeps all 500 Expansion-500 cities discoverable', registryExpansion.totalMatches === 500);

  const selectedRows = cityRegistry.routeGraphSelection([]);
  const selectedEindhoven = selectedRows.find(row => row.unifiedRegistry?.cityId === 'eindhoven-nl');
  const selectedHargeisa = selectedRows.find(row => row.unifiedRegistry?.cityId === 'hargeisa-so');
  const selectedMoscow = selectedRows.find(row => row.unifiedRegistry?.cityId === 'moscow-ru');
  check('route graph selection still contains all 1000 cities', selectedRows.length === 1000);
  check('route graph selection annotates 421 live-eligible rows', selectedRows.filter(row => row.liveRecommendationEligible === true).length === 421);
  check('Eindhoven row is marked verified live capability', selectedEindhoven?.providerSupportStatus === 'verified-live-provider-capability-668r');
  check('Hargeisa row is marked audited estimate-only', selectedHargeisa?.providerSupportStatus === 'audited-estimate-only-668r');
  check('Moscow row is now audited estimate-only', selectedMoscow?.providerSupportStatus === 'audited-estimate-only-668r');
  check('provider-driven discovery accepts active Eindhoven observation', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'EIN' })) === true);
  check('provider-driven discovery blocks reviewed Hargeisa observation', routeGraph._internal.providerObservationRow({ destinationCode: 'HGA' }) === null);

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaActive = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: { status: 'active', limit: '100' } }));
  const lambdaRetry = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation/retry-queues', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaRegistry = parseBody(await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: { live: 'true', limit: '100' } }));
  const lambdaWave1 = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaWave2 = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit-wave2', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaFinal = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-final-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  check('Lambda activation summary endpoint works', lambdaSummary.version === 'GV-CITY-668R' && lambdaSummary.summary.productionActiveCount === 421 && lambdaSummary.summary.auditedCount === 1000);
  check('Lambda activation search endpoint works', lambdaActive.totalMatches === 421 && lambdaActive.count === 100);
  check('Lambda retry endpoint works', lambdaRetry.queues['missing-flight-observations'].count === 463);
  check('Lambda city-registry live filter uses 668R activation', lambdaRegistry.totalMatches === 421 && lambdaRegistry.count === 100);
  check('668M Wave 1 endpoint remains preserved', lambdaWave1.version === 'GV-CITY-668M' && lambdaWave1.summary?.selectedCount === 150);
  check('668O Wave 2 endpoint remains preserved', lambdaWave2.version === 'GV-CITY-668O' && lambdaWave2.summary?.selectedCount === 150);
  check('668Q Final155 endpoint remains preserved', lambdaFinal.version === 'GV-CITY-668Q' && lambdaFinal.summary?.selectedCount === 155);

  const methodDenied = await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('activation endpoint remains read-only', methodDenied.statusCode === 405);

  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668R = 'false';
  check('668R flag-off disables new enforcement in current process', activation.enabled() === false && activation.liveRecommendationEligible('hargeisa-so') === true);
  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668R = 'true';

  const rollbackScript = "process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L='true'; process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N='true'; process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668P='true'; delete process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668R; const a=require('./services/cities/registry/verified-city-activation'); const s=a.summary(); process.stdout.write(JSON.stringify({version:a.VERSION,active:s.summary.productionActiveCount,audited:s.summary.auditedCount}));";
  const rollback = JSON.parse(execFileSync(process.execPath, ['-e', rollbackScript], { cwd: __dirname, encoding: 'utf8' }));
  check('cold-start rollback returns to 668P snapshot', rollback.version === 'GV-CITY-668P' && rollback.active === 420 && rollback.audited === 845, rollback);

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668R',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668R.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
