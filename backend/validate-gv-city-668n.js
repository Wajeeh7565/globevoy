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
process.env.GLOBEVOY_USE_MOCKS = 'false';

const activation = require('./services/verified-city-activation');
const cityRegistry = require('./services/city-registry');
const routeGraph = require('./services/global-route-graph');
const lambda = require('./lambda');
const snapshot = require('./data/verified-city-activation-695-668n.json');
const retry = require('./data/verified-city-retry-queues-668n.json');
const baseline = require('./data/verified-city-activation-545-668l.json');
const expansion150 = require('./data/provider-live-expansion150-668m-source.json');
const activeFile = require('./data/verified-city-production-active-393-668n.json');
const reviewFile = require('./data/verified-city-review-302-668n.json');
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
  const source668M = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668M');
  const source668MActive = source668M.filter(record => record.liveRecommendationEligible);
  const source668MReview = source668M.filter(record => !record.liveRecommendationEligible);

  check('service version is 668N', activation.VERSION === 'GV-CITY-668N', activation.VERSION);
  check('668N feature flag is enabled', activation.enabled() === true);
  check('snapshot identity is correct', snapshot.taskId === 'GV-CITY-668N' && snapshot.status === 'merged-verified-activation-snapshot');
  check('668L baseline identity is correct', baseline.taskId === 'GV-CITY-668L' && baseline.summary.auditedCount === 545 && baseline.summary.productionActiveCount === 322);
  check('668M source identity is correct', expansion150.taskId === 'GV-CITY-668M' && expansion150.mode === 'Expansion150' && expansion150.completedCount === 150 && expansion150.productionActiveCount === 71 && expansion150.reviewCount === 79);
  check('five source audits are preserved', Array.isArray(snapshot.sourceAudits) && snapshot.sourceAudits.length === 5, snapshot.sourceAudits?.map(item => item.taskId));
  check('668L baseline SHA is pinned', snapshot.sourceSnapshots?.[0]?.sourceFileSha256 === sha256(path.join(__dirname, 'data', 'verified-city-activation-545-668l.json')));
  check('668M source SHA is pinned', snapshot.sourceAudits[4].sourceFileSha256 === sha256(path.join(__dirname, 'data', 'provider-live-expansion150-668m-source.json')));
  check('668L and 668M city sets do not overlap', baseline.records.every(record => !expansion150.records.some(item => item.cityId === record.cityId)));

  check('snapshot contains 695 unique audited cities', snapshot.records.length === 695 && new Set(ids(snapshot.records)).size === 695);
  check('668M contributes exactly 150 records', source668M.length === 150);
  check('668M contributes 71 active and 79 reviewed inactive', source668MActive.length === 71 && source668MReview.length === 79, { active: source668MActive.length, review: source668MReview.length });
  check('snapshot contains exactly 393 production-active cities', active.length === 393, active.length);
  check('snapshot contains exactly 302 reviewed inactive cities', inactive.length === 302, inactive.length);
  check('active modes are 366 direct/metro and 27 gateway', active.filter(record => record.activation.mode === 'direct-or-metro').length === 366 && active.filter(record => record.activation.mode === 'gateway-supported').length === 27, snapshot.summary.activeModeCounts);
  check('Current-500 remains fully audited', current.length === 500 && snapshot.policy.current500AuditComplete === true && snapshot.policy.current500AuditedCount === 500);
  check('Current-500 split remains 309 active and 191 inactive', current.filter(record => record.liveRecommendationEligible).length === 309 && current.filter(record => !record.liveRecommendationEligible).length === 191, snapshot.summary.current500);
  check('Expansion-500 split is 84 active of 195 audited', expansion.length === 195 && expansion.filter(record => record.liveRecommendationEligible).length === 84 && expansion.filter(record => !record.liveRecommendationEligible).length === 111, snapshot.summary.expansion500);
  check('registry count is 1000 and unaudited count is 305', registry.records.length === 1000 && snapshot.summary.unauditedCount === 305);
  check('estimate-only total is 607', snapshot.summary.estimateOnlyCount === 607);
  check('provider-covered count is 436', snapshot.summary.providerCoveredCount === 436);
  check('classification counts are exact', snapshot.summary.classificationCounts['live-both'] === 407 && snapshot.summary.classificationCounts['live-stays-only'] === 226 && snapshot.summary.classificationCounts['gateway-supported'] === 29 && snapshot.summary.classificationCounts['unresolved'] === 18 && snapshot.summary.classificationCounts['live-flights-only'] === 8 && snapshot.summary.classificationCounts['estimate-only'] === 7, snapshot.summary.classificationCounts);

  check('all active cities use production provider evidence', active.every(record => record.evidence.travelpayouts.evidenceMode === 'production-provider-response' && record.evidence.agoda.evidenceMode === 'production-provider-response'));
  check('all active cities passed recommendation readiness', active.every(record => record.recommendationReadiness?.eligible === true));
  check('all active cities have no retry queues', active.every(record => Array.isArray(record.retryQueues) && record.retryQueues.length === 0));
  check('all inactive audited cities remain discoverable estimate-only', inactive.every(record => record.discoveryEligible === true && record.recommendationMode === 'estimate-only'));
  check('no inactive city is accidentally activated', inactive.every(record => record.activation.eligible === false));
  check('all records use 668N policy version', snapshot.records.every(record => record.activation.policyVersion === 'GV-CITY-668N'));
  check('gateway-active cities retain gateway evidence', active.filter(record => record.activation.mode === 'gateway-supported').every(record => record.evidence.travelpayouts.gateway && record.evidence.travelpayouts.gatewayRequiredForDestination === true));
  check('668M active cities are direct or metro only', source668MActive.every(record => record.activation.mode === 'direct-or-metro'));

  const queueCounts = snapshot.summary.retryQueueCounts;
  check('missing-flight queue count is 249', queueCounts['missing-flight-observations'] === 249);
  check('unresolved-Agoda queue count is 25', queueCounts['unresolved-agoda-mapping'] === 25);
  check('no-live-hotel-rate queue count is 8', queueCounts['no-live-hotel-rate'] === 8);
  check('hotel-quality queue count is 17', queueCounts['hotel-quality-failure'] === 17);
  check('flight-comfort queue count is 43', queueCounts['flight-comfort-failure'] === 43);
  check('retry snapshot allows overlapping membership', retry.queueMembershipCanOverlap === true && retry.reviewCityCount === 302);
  check('retry snapshot queue counts match activation snapshot', Object.entries(retry.queues).every(([name, value]) => value.count === queueCounts[name]));

  check('active JSON has 393 unique records', activeFile.count === 393 && activeFile.records.length === 393 && new Set(activeFile.cityIds).size === 393);
  check('review JSON has 302 unique records', reviewFile.count === 302 && reviewFile.records.length === 302 && new Set(reviewFile.cityIds).size === 302);
  check('active and review files partition all audited records', new Set([...activeFile.cityIds, ...reviewFile.cityIds]).size === 695 && activeFile.cityIds.every(id => !reviewFile.cityIds.includes(id)));

  const baku = get('baku-az');
  const bucharest = get('bucharest-ro');
  const nadi = get('nadi-fj');
  const lagos = get('lagos-ng');
  const kyiv = get('kyiv-ua');
  const mahe = get('mahe-island-sc');
  const toronto = get('toronto-ca', false);
  const moscow = get('moscow-ru', false);

  check('Baku is newly active from 668M', baku.liveRecommendationEligible === true && baku.activation.sourceAuditTaskId === 'GV-CITY-668M' && baku.evidence.travelpayouts.destinationCode === 'BAK');
  check('Bucharest is newly active from 668M', bucharest.liveRecommendationEligible === true && bucharest.activation.sourceAuditTaskId === 'GV-CITY-668M' && bucharest.evidence.travelpayouts.destinationCode === 'BUH');
  check('Nadi is newly active from 668M', nadi.liveRecommendationEligible === true && nadi.activation.sourceAuditTaskId === 'GV-CITY-668M');
  check('Lagos remains inactive after comfort failure', lagos.liveRecommendationEligible === false && lagos.retryQueues.includes('flight-comfort-failure'));
  check('Kyiv remains inactive after missing flight observations', kyiv.liveRecommendationEligible === false && kyiv.retryQueues.includes('missing-flight-observations'));
  check('Mahe Island remains inactive after no live hotel rate', mahe.liveRecommendationEligible === false && mahe.retryQueues.includes('no-live-hotel-rate'));
  check('Toronto remains active from earlier audit', toronto.liveRecommendationEligible === true && toronto.activation.sourceAuditTaskId === 'GV-CITY-668E');
  check('Moscow remains unaudited expansion estimate-only', moscow.auditStatus === 'unaudited' && moscow.liveRecommendationEligible === false && moscow.recommendationMode === 'estimate-only');

  const allSearch = activation.search({ limit: 100 });
  const activeSearch = activation.search({ status: 'active', limit: 100 });
  const reviewSearch = activation.search({ status: 'review', limit: 100 });
  const gatewaySearch = activation.search({ status: 'gateway-supported', limit: 100 });
  const expansionSearch = activation.search({ tier: 'expansion-500', limit: 100 });
  check('activation search sees all 1000 discovery cities', allSearch.totalMatches === 1000);
  check('active search returns 393 total matches', activeSearch.totalMatches === 393);
  check('review search returns 302 total matches', reviewSearch.totalMatches === 302);
  check('gateway search returns 27 total matches', gatewaySearch.totalMatches === 27);
  check('Expansion-500 search returns 500 discovery cities', expansionSearch.totalMatches === 500);

  const registryActive = cityRegistry.searchRegistry({ live: 'true', limit: 100 });
  const registryExpansion = cityRegistry.searchRegistry({ tier: 'expansion-500', limit: 100 });
  check('city registry live filter exposes 393 active cities', registryActive.totalMatches === 393);
  check('city registry keeps all 500 Expansion-500 cities discoverable', registryExpansion.totalMatches === 500);

  const selectedRows = cityRegistry.routeGraphSelection([]);
  const selectedBaku = selectedRows.find(row => row.unifiedRegistry?.cityId === 'baku-az');
  const selectedLagos = selectedRows.find(row => row.unifiedRegistry?.cityId === 'lagos-ng');
  const selectedMoscow = selectedRows.find(row => row.unifiedRegistry?.cityId === 'moscow-ru');
  check('route graph selection still contains all 1000 cities', selectedRows.length === 1000);
  check('route graph selection annotates 393 live-eligible rows', selectedRows.filter(row => row.liveRecommendationEligible === true).length === 393);
  check('Baku row is marked verified live capability', selectedBaku?.providerSupportStatus === 'verified-live-provider-capability-668n');
  check('Lagos row is marked audited estimate-only', selectedLagos?.providerSupportStatus === 'audited-estimate-only-668n');
  check('Moscow row is marked unaudited estimate-only', selectedMoscow?.providerSupportStatus === 'unaudited-estimate-only-668n');
  check('provider-driven discovery accepts active Baku observation', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'BAK' })) === true);
  check('provider-driven discovery blocks reviewed Lagos observation', routeGraph._internal.providerObservationRow({ destinationCode: 'LOS' }) === null);

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaActive = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: { status: 'active', limit: '100' } }));
  const lambdaRetry = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation/retry-queues', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaRegistry = parseBody(await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: { live: 'true', limit: '100' } }));
  const lambdaExpansionPlan = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  check('Lambda activation summary endpoint works', lambdaSummary.version === 'GV-CITY-668N' && lambdaSummary.summary.productionActiveCount === 393 && lambdaSummary.summary.auditedCount === 695);
  check('Lambda activation search endpoint works', lambdaActive.totalMatches === 393 && lambdaActive.count === 100);
  check('Lambda retry endpoint works', lambdaRetry.queues['missing-flight-observations'].count === 249);
  check('Lambda city-registry live filter uses 668N activation', lambdaRegistry.totalMatches === 393 && lambdaRegistry.count === 100);
  check('668M expansion audit plan endpoint remains preserved', lambdaExpansionPlan.version === 'GV-CITY-668M' && lambdaExpansionPlan.summary?.selectedCount === 150);

  const methodDenied = await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('activation endpoint remains read-only', methodDenied.statusCode === 405);

  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N = 'false';
  check('668N flag-off disables new enforcement in current process', activation.enabled() === false && activation.liveRecommendationEligible('lagos-ng') === true);
  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N = 'true';

  const rollbackScript = "process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L='true'; delete process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N; const a=require('./services/verified-city-activation'); const s=a.summary(); process.stdout.write(JSON.stringify({version:a.VERSION,active:s.summary.productionActiveCount,audited:s.summary.auditedCount}));";
  const rollback = JSON.parse(execFileSync(process.execPath, ['-e', rollbackScript], { cwd: __dirname, encoding: 'utf8' }));
  check('cold-start rollback returns to 668L snapshot', rollback.version === 'GV-CITY-668L' && rollback.active === 322 && rollback.audited === 545, rollback);

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668N',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668N.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
