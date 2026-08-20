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
process.env.GLOBEVOY_USE_MOCKS = 'false';

const activation = require('./services/verified-city-activation');
const cityRegistry = require('./services/city-registry');
const routeGraph = require('./services/global-route-graph');
const lambda = require('./lambda');
const snapshot = require('./data/verified-city-activation-845-668p.json');
const retry = require('./data/verified-city-retry-queues-668p.json');
const baseline = require('./data/verified-city-activation-695-668n.json');
const expansion150 = require('./data/provider-live-expansion150-668o-source.json');
const activeFile = require('./data/verified-city-production-active-420-668p.json');
const reviewFile = require('./data/verified-city-review-425-668p.json');
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
  const source668O = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668O');
  const source668OActive = source668O.filter(record => record.liveRecommendationEligible);
  const source668OReview = source668O.filter(record => !record.liveRecommendationEligible);

  check('service version is 668P', activation.VERSION === 'GV-CITY-668P', activation.VERSION);
  check('668P feature flag is enabled', activation.enabled() === true);
  check('snapshot identity is correct', snapshot.taskId === 'GV-CITY-668P' && snapshot.status === 'merged-verified-activation-snapshot');
  check('668N baseline identity is correct', baseline.taskId === 'GV-CITY-668N' && baseline.summary.auditedCount === 695 && baseline.summary.productionActiveCount === 393);
  check('668O source identity is correct', expansion150.taskId === 'GV-CITY-668O' && expansion150.mode === 'Expansion150' && expansion150.completedCount === 150 && expansion150.productionActiveCount === 27 && expansion150.reviewCount === 123);
  check('six source audits are preserved', Array.isArray(snapshot.sourceAudits) && snapshot.sourceAudits.length === 6, snapshot.sourceAudits?.map(item => item.taskId));
  check('668N baseline SHA is pinned', snapshot.sourceSnapshots?.[0]?.sourceFileSha256 === sha256(path.join(__dirname, 'data', 'verified-city-activation-695-668n.json')));
  check('668O source SHA is pinned', snapshot.sourceAudits[5].sourceFileSha256 === sha256(path.join(__dirname, 'data', 'provider-live-expansion150-668o-source.json')));
  check('668N and 668O city sets do not overlap', baseline.records.every(record => !expansion150.records.some(item => item.cityId === record.cityId)));

  check('snapshot contains 845 unique audited cities', snapshot.records.length === 845 && new Set(ids(snapshot.records)).size === 845);
  check('668O contributes exactly 150 records', source668O.length === 150);
  check('668O contributes 27 active and 123 reviewed inactive', source668OActive.length === 27 && source668OReview.length === 123, { active: source668OActive.length, review: source668OReview.length });
  check('snapshot contains exactly 420 production-active cities', active.length === 420, active.length);
  check('snapshot contains exactly 425 reviewed inactive cities', inactive.length === 425, inactive.length);
  check('active modes are 393 direct/metro and 27 gateway', active.filter(record => record.activation.mode === 'direct-or-metro').length === 393 && active.filter(record => record.activation.mode === 'gateway-supported').length === 27, snapshot.summary.activeModeCounts);
  check('Current-500 remains fully audited', current.length === 500 && snapshot.policy.current500AuditComplete === true && snapshot.policy.current500AuditedCount === 500);
  check('Current-500 split remains 309 active and 191 inactive', current.filter(record => record.liveRecommendationEligible).length === 309 && current.filter(record => !record.liveRecommendationEligible).length === 191, snapshot.summary.current500);
  check('Expansion-500 split is 111 active of 345 audited', expansion.length === 345 && expansion.filter(record => record.liveRecommendationEligible).length === 111 && expansion.filter(record => !record.liveRecommendationEligible).length === 234, snapshot.summary.expansion500);
  check('registry count is 1000 and unaudited count is 155', registry.records.length === 1000 && snapshot.summary.unauditedCount === 155);
  check('estimate-only total is 580', snapshot.summary.estimateOnlyCount === 580);
  check('provider-covered count is 481', snapshot.summary.providerCoveredCount === 481);
  check('classification counts are exact', snapshot.summary.classificationCounts['live-both'] === 452 && snapshot.summary.classificationCounts['live-stays-only'] === 308 && snapshot.summary.classificationCounts['gateway-supported'] === 29 && snapshot.summary.classificationCounts['unresolved'] === 18 && snapshot.summary.classificationCounts['live-flights-only'] === 12 && snapshot.summary.classificationCounts['estimate-only'] === 25 && snapshot.summary.classificationCounts['provider-error'] === 1, snapshot.summary.classificationCounts);

  check('all active cities use production provider evidence', active.every(record => record.evidence.travelpayouts.evidenceMode === 'production-provider-response' && record.evidence.agoda.evidenceMode === 'production-provider-response'));
  check('all active cities passed recommendation readiness', active.every(record => record.recommendationReadiness?.eligible === true));
  check('all active cities have no retry queues', active.every(record => Array.isArray(record.retryQueues) && record.retryQueues.length === 0));
  check('all inactive audited cities remain discoverable estimate-only', inactive.every(record => record.discoveryEligible === true && record.recommendationMode === 'estimate-only'));
  check('no inactive city is accidentally activated', inactive.every(record => record.activation.eligible === false));
  check('all records use 668P policy version', snapshot.records.every(record => record.activation.policyVersion === 'GV-CITY-668P'));
  check('gateway-active cities retain gateway evidence', active.filter(record => record.activation.mode === 'gateway-supported').every(record => record.evidence.travelpayouts.gateway && record.evidence.travelpayouts.gatewayRequiredForDestination === true));
  check('668O active cities are direct or metro only', source668OActive.every(record => record.activation.mode === 'direct-or-metro'));

  const queueCounts = snapshot.summary.retryQueueCounts;
  check('missing-flight queue count is 348', queueCounts['missing-flight-observations'] === 348);
  check('unresolved-Agoda queue count is 25', queueCounts['unresolved-agoda-mapping'] === 25);
  check('no-live-hotel-rate queue count is 31', queueCounts['no-live-hotel-rate'] === 31);
  check('hotel-quality queue count is 42', queueCounts['hotel-quality-failure'] === 42);
  check('flight-comfort queue count is 61', queueCounts['flight-comfort-failure'] === 61);
  check('retry snapshot allows overlapping membership', retry.queueMembershipCanOverlap === true && retry.reviewCityCount === 425);
  check('retry snapshot queue counts match activation snapshot', Object.entries(retry.queues).every(([name, value]) => value.count === queueCounts[name]));

  check('active JSON has 420 unique records', activeFile.count === 420 && activeFile.records.length === 420 && new Set(activeFile.cityIds).size === 420);
  check('review JSON has 425 unique records', reviewFile.count === 425 && reviewFile.records.length === 425 && new Set(reviewFile.cityIds).size === 425);
  check('active and review files partition all audited records', new Set([...activeFile.cityIds, ...reviewFile.cityIds]).size === 845 && activeFile.cityIds.every(id => !reviewFile.cityIds.includes(id)));

  const hatYai = get('hat-yai-th');
  const belgrade = get('belgrade-rs');
  const dili = get('dili-tl');
  const kutaisi = get('kutaisi-ge');
  const bhubaneswar = get('bhubaneswar-in');
  const grodno = get('grodno-by');
  const baku = get('baku-az');
  const lagos = get('lagos-ng');
  const toronto = get('toronto-ca', false);
  const moscow = get('moscow-ru', false);

  check('Hat Yai is newly active from 668O', hatYai.liveRecommendationEligible === true && hatYai.activation.sourceAuditTaskId === 'GV-CITY-668O' && hatYai.evidence.travelpayouts.destinationCode === 'HDY');
  check('Belgrade is newly active from 668O', belgrade.liveRecommendationEligible === true && belgrade.activation.sourceAuditTaskId === 'GV-CITY-668O' && belgrade.evidence.travelpayouts.destinationCode === 'BEG');
  check('Dili is newly active from 668O', dili.liveRecommendationEligible === true && dili.activation.sourceAuditTaskId === 'GV-CITY-668O');
  check('Kutaisi remains inactive after comfort failure', kutaisi.liveRecommendationEligible === false && kutaisi.retryQueues.includes('flight-comfort-failure'));
  check('Bhubaneswar remains inactive after missing flight observations', bhubaneswar.liveRecommendationEligible === false && bhubaneswar.retryQueues.includes('missing-flight-observations'));
  check('Grodno remains inactive after provider error', grodno.liveRecommendationEligible === false && grodno.classification === 'provider-error');
  check('Baku remains active from 668M', baku.liveRecommendationEligible === true && baku.activation.sourceAuditTaskId === 'GV-CITY-668M');
  check('Lagos remains inactive after earlier comfort failure', lagos.liveRecommendationEligible === false && lagos.retryQueues.includes('flight-comfort-failure'));
  check('Toronto remains active from earlier audit', toronto.liveRecommendationEligible === true && toronto.activation.sourceAuditTaskId === 'GV-CITY-668E');
  check('Moscow remains unaudited expansion estimate-only', moscow.auditStatus === 'unaudited' && moscow.liveRecommendationEligible === false && moscow.recommendationMode === 'estimate-only');

  const allSearch = activation.search({ limit: 100 });
  const activeSearch = activation.search({ status: 'active', limit: 100 });
  const reviewSearch = activation.search({ status: 'review', limit: 100 });
  const gatewaySearch = activation.search({ status: 'gateway-supported', limit: 100 });
  const expansionSearch = activation.search({ tier: 'expansion-500', limit: 100 });
  check('activation search sees all 1000 discovery cities', allSearch.totalMatches === 1000);
  check('active search returns 420 total matches', activeSearch.totalMatches === 420);
  check('review search returns 425 total matches', reviewSearch.totalMatches === 425);
  check('gateway search returns 27 total matches', gatewaySearch.totalMatches === 27);
  check('Expansion-500 search returns 500 discovery cities', expansionSearch.totalMatches === 500);

  const registryActive = cityRegistry.searchRegistry({ live: 'true', limit: 100 });
  const registryExpansion = cityRegistry.searchRegistry({ tier: 'expansion-500', limit: 100 });
  check('city registry live filter exposes 420 active cities', registryActive.totalMatches === 420);
  check('city registry keeps all 500 Expansion-500 cities discoverable', registryExpansion.totalMatches === 500);

  const selectedRows = cityRegistry.routeGraphSelection([]);
  const selectedHatYai = selectedRows.find(row => row.unifiedRegistry?.cityId === 'hat-yai-th');
  const selectedKutaisi = selectedRows.find(row => row.unifiedRegistry?.cityId === 'kutaisi-ge');
  const selectedMoscow = selectedRows.find(row => row.unifiedRegistry?.cityId === 'moscow-ru');
  check('route graph selection still contains all 1000 cities', selectedRows.length === 1000);
  check('route graph selection annotates 420 live-eligible rows', selectedRows.filter(row => row.liveRecommendationEligible === true).length === 420);
  check('Hat Yai row is marked verified live capability', selectedHatYai?.providerSupportStatus === 'verified-live-provider-capability-668p');
  check('Kutaisi row is marked audited estimate-only', selectedKutaisi?.providerSupportStatus === 'audited-estimate-only-668p');
  check('Moscow row is marked unaudited estimate-only', selectedMoscow?.providerSupportStatus === 'unaudited-estimate-only-668p');
  check('provider-driven discovery accepts active Hat Yai observation', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'HDY' })) === true);
  check('provider-driven discovery blocks reviewed Kutaisi observation', routeGraph._internal.providerObservationRow({ destinationCode: 'KUT' }) === null);

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaActive = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: { status: 'active', limit: '100' } }));
  const lambdaRetry = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation/retry-queues', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaRegistry = parseBody(await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: { live: 'true', limit: '100' } }));
  const lambdaWave1 = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaWave2 = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit-wave2', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  check('Lambda activation summary endpoint works', lambdaSummary.version === 'GV-CITY-668P' && lambdaSummary.summary.productionActiveCount === 420 && lambdaSummary.summary.auditedCount === 845);
  check('Lambda activation search endpoint works', lambdaActive.totalMatches === 420 && lambdaActive.count === 100);
  check('Lambda retry endpoint works', lambdaRetry.queues['missing-flight-observations'].count === 348);
  check('Lambda city-registry live filter uses 668P activation', lambdaRegistry.totalMatches === 420 && lambdaRegistry.count === 100);
  check('668M Wave 1 endpoint remains preserved', lambdaWave1.version === 'GV-CITY-668M' && lambdaWave1.summary?.selectedCount === 150);
  check('668O Wave 2 endpoint remains preserved', lambdaWave2.version === 'GV-CITY-668O' && lambdaWave2.summary?.selectedCount === 150);

  const methodDenied = await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('activation endpoint remains read-only', methodDenied.statusCode === 405);

  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668P = 'false';
  check('668P flag-off disables new enforcement in current process', activation.enabled() === false && activation.liveRecommendationEligible('kutaisi-ge') === true);
  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668P = 'true';

  const rollbackScript = "process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L='true'; process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N='true'; delete process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668P; const a=require('./services/verified-city-activation'); const s=a.summary(); process.stdout.write(JSON.stringify({version:a.VERSION,active:s.summary.productionActiveCount,audited:s.summary.auditedCount}));";
  const rollback = JSON.parse(execFileSync(process.execPath, ['-e', rollbackScript], { cwd: __dirname, encoding: 'utf8' }));
  check('cold-start rollback returns to 668N snapshot', rollback.version === 'GV-CITY-668N' && rollback.active === 393 && rollback.audited === 695, rollback);

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668P',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668P.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
