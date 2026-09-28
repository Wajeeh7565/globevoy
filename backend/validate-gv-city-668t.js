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
process.env.ENABLE_INACTIVE_CITY_RECOVERY_668S = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const activation = require('./services/verified-city-activation');
const cityRegistry = require('./services/city-registry');
const routeGraph = require('./services/domain/routing/global-route-graph');
const lambda = require('./lambda');
const snapshot = require('./data/verified-city-activation-1000-668t.json');
const retry = require('./data/verified-city-retry-queues-668t.json');
const baseline = require('./data/verified-city-activation-1000-668r.json');
const recovery = require('./data/provider-live-inactive-recovery150-668s-source.json');
const activeFile = require('./data/verified-city-production-active-439-668t.json');
const reviewFile = require('./data/verified-city-review-561-668t.json');
const registry = require('./data/unified-city-registry-1000-668b.json');

const checks = [];
function check(name, pass, details = {}) { checks.push({ name, pass: Boolean(pass), details }); if (!pass) console.error('FAIL', name, details); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function ids(records) { return records.map(record => record.cityId); }
function parseBody(response) { return JSON.parse(response.body); }
function get(id, includeEvidence = true) { return activation.activationForCity(id, { includeEvidence }); }

(async () => {
  const active = snapshot.records.filter(record => record.liveRecommendationEligible === true);
  const inactive = snapshot.records.filter(record => record.liveRecommendationEligible !== true);
  const current = snapshot.records.filter(record => record.selectionTier === 'current-500');
  const expansion = snapshot.records.filter(record => record.selectionTier === 'expansion-500');
  const source668S = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668S');
  const source668SActive = source668S.filter(record => record.liveRecommendationEligible);
  const source668SReview = source668S.filter(record => !record.liveRecommendationEligible);
  const recoveryIds = new Set(recovery.records.map(record => record.cityId));

  check('service version is 668T', activation.VERSION === 'GV-CITY-668T', activation.VERSION);
  check('668T feature flag is enabled', activation.enabled() === true);
  check('snapshot identity is correct', snapshot.taskId === 'GV-CITY-668T' && snapshot.status === 'merged-verified-activation-snapshot');
  check('668R baseline identity is correct', baseline.taskId === 'GV-CITY-668R' && baseline.summary.auditedCount === 1000 && baseline.summary.productionActiveCount === 421);
  check('668S source identity is correct', recovery.taskId === 'GV-CITY-668S' && recovery.mode === 'Recovery150' && recovery.completedCount === 150 && recovery.productionActiveCount === 18 && recovery.reviewCount === 132);
  check('eight source audits are preserved', Array.isArray(snapshot.sourceAudits) && snapshot.sourceAudits.length === 8, snapshot.sourceAudits?.map(item => item.taskId));
  check('668R baseline SHA is pinned', snapshot.sourceSnapshots?.[0]?.sourceFileSha256 === sha256(path.join(__dirname, 'data', 'verified-city-activation-1000-668r.json')));
  check('668S recovery SHA is pinned', snapshot.sourceAudits[7].sourceFileSha256 === sha256(path.join(__dirname, 'data', 'provider-live-inactive-recovery150-668s-source.json')));
  check('all recovery cities existed inactive in 668R', recovery.records.every(record => baseline.records.some(item => item.cityId === record.cityId && item.liveRecommendationEligible !== true)));

  check('snapshot contains 1000 unique audited cities', snapshot.records.length === 1000 && new Set(ids(snapshot.records)).size === 1000);
  check('668S replaces exactly 150 records', source668S.length === 150 && new Set(source668S.map(record => record.cityId)).size === 150);
  check('668S contributes 18 active and 132 reviewed inactive', source668SActive.length === 18 && source668SReview.length === 132, { active: source668SActive.length, review: source668SReview.length });
  check('snapshot contains exactly 439 production-active cities', active.length === 439, active.length);
  check('snapshot contains exactly 561 reviewed inactive cities', inactive.length === 561, inactive.length);
  check('active modes are 412 direct/metro and 27 gateway', active.filter(record => record.activation.mode === 'direct-or-metro').length === 412 && active.filter(record => record.activation.mode === 'gateway-supported').length === 27, snapshot.summary.activeModeCounts);
  check('Current-500 remains fully audited', current.length === 500 && snapshot.policy.current500AuditComplete === true && snapshot.policy.current500AuditedCount === 500);
  check('Current-500 split is 318 active and 182 inactive', current.filter(record => record.liveRecommendationEligible).length === 318 && current.filter(record => !record.liveRecommendationEligible).length === 182, snapshot.summary.current500);
  check('Expansion-500 remains fully audited', expansion.length === 500 && snapshot.policy.expansion500AuditComplete === true && snapshot.policy.expansion500AuditedCount === 500);
  check('Expansion-500 split is 121 active and 379 inactive', expansion.filter(record => record.liveRecommendationEligible).length === 121 && expansion.filter(record => !record.liveRecommendationEligible).length === 379, snapshot.summary.expansion500);
  check('registry remains fully audited with no unaudited cities', registry.records.length === 1000 && snapshot.summary.unauditedCount === 0 && snapshot.policy.fullRegistryAuditComplete === true);
  check('estimate-only total is 561', snapshot.summary.estimateOnlyCount === 561);
  check('provider-covered count is 492', snapshot.summary.providerCoveredCount === 492);
  check('recovered-active summary is 18', snapshot.summary.recoveredActiveCount === 18 && snapshot.summary.recoveryReviewedInactiveCount === 132);
  check('classification counts are exact', snapshot.summary.classificationCounts['live-both'] === 463 && snapshot.summary.classificationCounts['live-stays-only'] === 327 && snapshot.summary.classificationCounts['gateway-supported'] === 29 && snapshot.summary.classificationCounts['unresolved'] === 109 && snapshot.summary.classificationCounts['live-flights-only'] === 25 && snapshot.summary.classificationCounts['estimate-only'] === 43 && snapshot.summary.classificationCounts['provider-error'] === 4, snapshot.summary.classificationCounts);

  check('all active cities use production provider evidence', active.every(record => record.evidence.travelpayouts.evidenceMode === 'production-provider-response' && record.evidence.agoda.evidenceMode === 'production-provider-response'));
  check('all active cities passed recommendation readiness', active.every(record => record.recommendationReadiness?.eligible === true));
  check('all active cities have no retry queues', active.every(record => Array.isArray(record.retryQueues) && record.retryQueues.length === 0));
  check('all inactive cities remain discoverable estimate-only', inactive.every(record => record.discoveryEligible === true && record.recommendationMode === 'estimate-only'));
  check('no inactive city is accidentally activated', inactive.every(record => record.activation.eligible === false));
  check('all records use 668T policy version', snapshot.records.every(record => record.activation.policyVersion === 'GV-CITY-668T'));
  check('gateway-active cities retain gateway evidence', active.filter(record => record.activation.mode === 'gateway-supported').every(record => record.evidence.travelpayouts.gateway && record.evidence.travelpayouts.gatewayRequiredForDestination === true));
  check('all 18 recovered active cities are direct/metro', source668SActive.every(record => record.activation.mode === 'direct-or-metro'));
  check('recovery thresholds remain strict', snapshot.policy.recoveryThresholdsRelaxed === false && recovery.thresholdsRelaxed === false);

  const expectedRecovered = ['honolulu-us','luxor-eg','lagos-ng','abuja-ng','asuncion-py','granada-es','aswan-eg','luxembourg-lu','karaganda-kz','cusco-pe','innsbruck-at','cork-ie','luanda-ao','semarang-id','santiago-do','fort-myers-us','kingston-jm','guwahati-in'];
  check('recovered city set is exact', expectedRecovered.length === source668SActive.length && expectedRecovered.every(id => source668SActive.some(record => record.cityId === id)), source668SActive.map(record => record.cityId));
  check('recovered cities split 9 Current-500 and 9 Expansion-500', source668SActive.filter(record => record.selectionTier === 'current-500').length === 9 && source668SActive.filter(record => record.selectionTier === 'expansion-500').length === 9);

  const queueCounts = snapshot.summary.retryQueueCounts;
  check('missing-flight queue count is 423', queueCounts['missing-flight-observations'] === 423);
  check('unresolved-Agoda queue count is 130', queueCounts['unresolved-agoda-mapping'] === 130);
  check('no-live-hotel-rate queue count is 51', queueCounts['no-live-hotel-rate'] === 51);
  check('hotel-quality queue count is 50', queueCounts['hotel-quality-failure'] === 50);
  check('flight-comfort queue count is 54', queueCounts['flight-comfort-failure'] === 54);
  check('retry snapshot allows overlapping membership', retry.queueMembershipCanOverlap === true && retry.reviewCityCount === 561);
  check('retry snapshot queue counts match activation snapshot', Object.entries(retry.queues).every(([name, value]) => value.count === queueCounts[name]));

  check('active JSON has 439 unique records', activeFile.count === 439 && activeFile.records.length === 439 && new Set(activeFile.cityIds).size === 439);
  check('review JSON has 561 unique records', reviewFile.count === 561 && reviewFile.records.length === 561 && new Set(reviewFile.cityIds).size === 561);
  check('active and review files partition all audited records', new Set([...activeFile.cityIds, ...reviewFile.cityIds]).size === 1000 && activeFile.cityIds.every(id => !reviewFile.cityIds.includes(id)));

  const honolulu = get('honolulu-us');
  const luxor = get('luxor-eg');
  const cusco = get('cusco-pe');
  const brasilia = get('brasilia-br');
  const recife = get('recife-br');
  const taormina = get('taormina-it');
  const asmara = get('asmara-er');
  const eindhoven = get('eindhoven-nl');
  const baku = get('baku-az');

  check('Honolulu is recovered active from 668S', honolulu.liveRecommendationEligible === true && honolulu.activation.sourceAuditTaskId === 'GV-CITY-668S' && honolulu.evidence.travelpayouts.destinationCode === 'HNL');
  check('Luxor is recovered active from 668S', luxor.liveRecommendationEligible === true && luxor.activation.sourceAuditTaskId === 'GV-CITY-668S' && luxor.evidence.travelpayouts.destinationCode === 'LXR');
  check('Cusco is recovered active from flight lane', cusco.liveRecommendationEligible === true && source668S.find(record => record.cityId === 'cusco-pe')?.recovery?.lane === 'flight-recovery');
  check('Brasilia remains inactive under unchanged comfort limits', brasilia.liveRecommendationEligible === false && brasilia.retryQueues.includes('flight-comfort-failure'));
  check('Recife remains inactive under unchanged comfort limits', recife.liveRecommendationEligible === false && recife.retryQueues.includes('flight-comfort-failure'));
  check('Taormina remains inactive despite gateway classification', taormina.liveRecommendationEligible === false && taormina.classification === 'gateway-supported');
  check('Asmara remains inactive without qualified stay evidence', asmara.liveRecommendationEligible === false && asmara.classification === 'live-flights-only');
  check('Eindhoven remains active from 668Q', eindhoven.liveRecommendationEligible === true && eindhoven.activation.sourceAuditTaskId === 'GV-CITY-668Q');
  check('Baku remains active from 668M', baku.liveRecommendationEligible === true && baku.activation.sourceAuditTaskId === 'GV-CITY-668M');

  const summary = activation.summary();
  const activeSearch = activation.search({ status: 'active', limit: 100 });
  const reviewSearch = activation.search({ status: 'review', limit: 100 });
  const unauditedSearch = activation.search({ status: 'unaudited', limit: 100 });
  const expansionSearch = activation.search({ tier: 'expansion-500', limit: 100 });
  const gatewaySearch = activation.search({ status: 'gateway-supported', limit: 100 });
  check('activation summary reports full 668T counts', summary.version === 'GV-CITY-668T' && summary.summary.auditedCount === 1000 && summary.summary.productionActiveCount === 439);
  check('active search returns 439 total matches', activeSearch.totalMatches === 439);
  check('review search returns 561 total matches', reviewSearch.totalMatches === 561);
  check('unaudited search returns zero matches', unauditedSearch.totalMatches === 0);
  check('Expansion-500 search returns all 500 cities', expansionSearch.totalMatches === 500);
  check('gateway search returns 27 active matches', gatewaySearch.totalMatches === 27);

  const registryActive = cityRegistry.searchRegistry({ live: 'true', limit: 100 });
  const registryExpansion = cityRegistry.searchRegistry({ tier: 'expansion-500', limit: 100 });
  check('city registry live filter exposes 439 active cities', registryActive.totalMatches === 439);
  check('city registry keeps all 500 Expansion-500 cities discoverable', registryExpansion.totalMatches === 500);

  const selectedRows = cityRegistry.routeGraphSelection([]);
  const selectedHonolulu = selectedRows.find(row => row.unifiedRegistry?.cityId === 'honolulu-us');
  const selectedBrasilia = selectedRows.find(row => row.unifiedRegistry?.cityId === 'brasilia-br');
  check('route graph selection still contains all 1000 cities', selectedRows.length === 1000);
  check('route graph selection annotates 439 live-eligible rows', selectedRows.filter(row => row.liveRecommendationEligible === true).length === 439);
  check('Honolulu row is marked verified live capability', selectedHonolulu?.providerSupportStatus === 'verified-live-provider-capability-668t');
  check('Brasilia row is marked audited estimate-only', selectedBrasilia?.providerSupportStatus === 'audited-estimate-only-668t');
  check('provider-driven discovery accepts active Honolulu observation', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'HNL' })) === true);
  check('provider-driven discovery blocks reviewed Brasilia observation', routeGraph._internal.providerObservationRow({ destinationCode: 'BSB' }) === null);

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaActive = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: { status: 'active', limit: '100' } }));
  const lambdaRetry = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation/retry-queues', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaRegistry = parseBody(await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: { live: 'true', limit: '100' } }));
  const lambdaRecovery = parseBody(await lambda.handler({ rawPath: '/api/inactive-city-recovery-wave1', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  check('Lambda activation summary endpoint works', lambdaSummary.version === 'GV-CITY-668T' && lambdaSummary.summary.productionActiveCount === 439 && lambdaSummary.summary.auditedCount === 1000);
  check('Lambda activation search endpoint works', lambdaActive.totalMatches === 439 && lambdaActive.count === 100);
  check('Lambda retry endpoint works', lambdaRetry.queues['missing-flight-observations'].count === 423);
  check('Lambda city-registry live filter uses 668T activation', lambdaRegistry.totalMatches === 439 && lambdaRegistry.count === 100);
  check('668S recovery-plan endpoint remains preserved', lambdaRecovery.version === 'GV-CITY-668S' && lambdaRecovery.summary?.selectedCount === 150);

  const methodDenied = await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('activation endpoint remains read-only', methodDenied.statusCode === 405);

  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'false';
  check('668T flag-off disables new enforcement in current process', activation.enabled() === false && activation.liveRecommendationEligible('brasilia-br') === true);
  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';

  const rollbackScript = "process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L='true'; process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N='true'; process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668P='true'; process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668R='true'; delete process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T; const a=require('./services/verified-city-activation'); const s=a.summary(); process.stdout.write(JSON.stringify({version:a.VERSION,active:s.summary.productionActiveCount,audited:s.summary.auditedCount}));";
  const rollback = JSON.parse(execFileSync(process.execPath, ['-e', rollbackScript], { cwd: __dirname, encoding: 'utf8' }));
  check('cold-start rollback returns to 668R snapshot', rollback.version === 'GV-CITY-668R' && rollback.active === 421 && rollback.audited === 1000, rollback);

  const passed = checks.filter(item => item.pass).length;
  const result = { taskId: 'GV-CITY-668T', generatedAt: new Date().toISOString(), passed, failed: checks.length - passed, total: checks.length, checks };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668T.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
