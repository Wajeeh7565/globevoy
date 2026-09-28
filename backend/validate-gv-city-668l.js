'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L = 'true';
process.env.ENABLE_CURRENT_500_COMPLETION_AUDIT_668K = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const activation = require('./services/cities/registry/verified-city-activation');
const cityRegistry = require('./services/city-registry');
const routeGraph = require('./services/domain/routing/global-route-graph');
const lambda = require('./lambda');
const snapshot = require('./data/verified-city-activation-545-668l.json');
const retry = require('./data/verified-city-retry-queues-668l.json');
const baseline = require('./data/verified-city-activation-400-668j.json');
const final145 = require('./data/provider-live-current500-final145-668k-source.json');
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
  const source668E = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668E');
  const source668G = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668G');
  const source668I = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668I');
  const source668K = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668K');

  check('service version is 668L', activation.VERSION === 'GV-CITY-668L');
  check('668L feature flag is enabled', activation.enabled() === true);
  check('snapshot identity is correct', snapshot.taskId === 'GV-CITY-668L' && snapshot.status === 'merged-verified-activation-snapshot');
  check('668J baseline identity is correct', baseline.taskId === 'GV-CITY-668J' && baseline.summary.auditedCount === 400 && baseline.summary.productionActiveCount === 259);
  check('668K source identity is correct', final145.taskId === 'GV-CITY-668K' && final145.mode === 'Final145' && final145.completedCount === 145 && final145.productionActiveCount === 63 && final145.reviewCount === 82);
  check('four source audits are preserved', Array.isArray(snapshot.sourceAudits) && snapshot.sourceAudits.length === 4);
  check('668J baseline SHA is pinned', snapshot.sourceSnapshots?.[0]?.sourceFileSha256 === sha256(path.join(__dirname, 'data', 'verified-city-activation-400-668j.json')));
  check('668K source SHA is pinned', snapshot.sourceAudits[3].sourceFileSha256 === sha256(path.join(__dirname, 'data', 'provider-live-current500-final145-668k-source.json')));
  check('668J and 668K city sets do not overlap', baseline.records.every(record => !final145.records.some(item => item.cityId === record.cityId)));

  check('snapshot contains 545 unique audited cities', snapshot.records.length === 545 && new Set(ids(snapshot.records)).size === 545);
  check('source attribution is 100 plus 150 plus 150 plus 145', source668E.length === 100 && source668G.length === 150 && source668I.length === 150 && source668K.length === 145, { source668E: source668E.length, source668G: source668G.length, source668I: source668I.length, source668K: source668K.length });
  check('snapshot contains exactly 322 production-active cities', active.length === 322, active.length);
  check('snapshot contains exactly 223 reviewed inactive cities', inactive.length === 223, inactive.length);
  check('active modes are 295 direct/metro and 27 gateway', active.filter(record => record.activation.mode === 'direct-or-metro').length === 295 && active.filter(record => record.activation.mode === 'gateway-supported').length === 27, snapshot.summary.activeModeCounts);
  check('Current-500 is fully audited', current.length === 500 && snapshot.policy.current500AuditComplete === true && snapshot.policy.current500AuditedCount === 500);
  check('Current-500 split is 309 active and 191 inactive', current.filter(record => record.liveRecommendationEligible).length === 309 && current.filter(record => !record.liveRecommendationEligible).length === 191, snapshot.summary.current500);
  check('expansion split remains 13 active of 45 audited', expansion.length === 45 && expansion.filter(record => record.liveRecommendationEligible).length === 13 && expansion.filter(record => !record.liveRecommendationEligible).length === 32, snapshot.summary.expansion500);
  check('registry count is 1000 and unaudited count is 455', registry.records.length === 1000 && snapshot.summary.unauditedCount === 455);
  check('estimate-only total is 678', snapshot.summary.estimateOnlyCount === 678);
  check('provider-covered count is 349', snapshot.summary.providerCoveredCount === 349);
  check('classification counts are exact', snapshot.summary.classificationCounts['live-both'] === 320 && snapshot.summary.classificationCounts['live-stays-only'] === 167 && snapshot.summary.classificationCounts['gateway-supported'] === 29 && snapshot.summary.classificationCounts['unresolved'] === 18 && snapshot.summary.classificationCounts['live-flights-only'] === 7 && snapshot.summary.classificationCounts['estimate-only'] === 4, snapshot.summary.classificationCounts);

  check('all active cities use production provider evidence', active.every(record => record.evidence.travelpayouts.evidenceMode === 'production-provider-response' && record.evidence.agoda.evidenceMode === 'production-provider-response'));
  check('all active cities passed recommendation readiness', active.every(record => record.recommendationReadiness?.eligible === true));
  check('all active cities have no retry queues', active.every(record => Array.isArray(record.retryQueues) && record.retryQueues.length === 0));
  check('all inactive audited cities remain discoverable estimate-only', inactive.every(record => record.discoveryEligible === true && record.recommendationMode === 'estimate-only'));
  check('no inactive city is accidentally activated', inactive.every(record => record.activation.eligible === false));
  check('all records use 668L policy version', snapshot.records.every(record => record.activation.policyVersion === 'GV-CITY-668L'));
  check('gateway-active cities retain gateway evidence', active.filter(record => record.activation.mode === 'gateway-supported').every(record => record.evidence.travelpayouts.gateway && record.evidence.travelpayouts.gatewayRequiredForDestination === true));

  const newGatewayIds = source668K.filter(record => record.liveRecommendationEligible && record.activation.mode === 'gateway-supported').map(record => record.cityId).sort();
  const expectedNewGateways = ['banff-ca','bath-gb','braga-pt','brighton-gb','cesky-krumlov-cz','guanajuato-mx','koh-lanta-th','kyoto-jp','matera-it','moshi-tz','naivasha-ke','niagara-falls-ca','ronda-es','segovia-es','siena-it','sintra-pt','toledo-es','whistler-ca'].sort();
  check('668K contributes exactly 18 active gateways', JSON.stringify(newGatewayIds) === JSON.stringify(expectedNewGateways), newGatewayIds);

  const queueCounts = snapshot.summary.retryQueueCounts;
  check('missing-flight queue count is 189', queueCounts['missing-flight-observations'] === 189);
  check('unresolved-Agoda queue count is 25', queueCounts['unresolved-agoda-mapping'] === 25);
  check('no-live-hotel-rate queue count is 4', queueCounts['no-live-hotel-rate'] === 4);
  check('hotel-quality queue count is 7', queueCounts['hotel-quality-failure'] === 7);
  check('flight-comfort queue count is 27', queueCounts['flight-comfort-failure'] === 27);
  check('retry snapshot allows overlapping membership', retry.queueMembershipCanOverlap === true && retry.reviewCityCount === 223);
  check('retry snapshot queue counts match activation snapshot', Object.entries(retry.queues).every(([name, value]) => value.count === queueCounts[name]));

  const toronto = get('toronto-ca', false);
  const philadelphia = get('philadelphia-us', false);
  const sapporo = get('sapporo-jp');
  const kyoto = get('kyoto-jp');
  const brighton = get('brighton-gb');
  const kuantan = get('kuantan-my', false);
  const chefchaouen = get('chefchaouen-ma', false);
  const capeCoast = get('cape-coast-gh', false);
  const moscow = get('moscow-ru', false);

  check('Toronto remains active from 668E', toronto.liveRecommendationEligible === true && toronto.activation.sourceAuditTaskId === 'GV-CITY-668E');
  check('Philadelphia remains active from 668I', philadelphia.liveRecommendationEligible === true && philadelphia.activation.sourceAuditTaskId === 'GV-CITY-668I');
  check('Sapporo is newly active from 668K', sapporo.liveRecommendationEligible === true && sapporo.activation.sourceAuditTaskId === 'GV-CITY-668K' && sapporo.evidence.travelpayouts.destinationCode === 'SPK');
  check('Kyoto is newly gateway-active via KIX', kyoto.liveRecommendationEligible === true && kyoto.activation.mode === 'gateway-supported' && kyoto.evidence.travelpayouts.gateway?.airportCode === 'KIX');
  check('Brighton is newly gateway-active via LHR', brighton.liveRecommendationEligible === true && brighton.activation.mode === 'gateway-supported' && brighton.evidence.travelpayouts.gateway?.airportCode === 'LHR');
  check('Kuantan stays estimate-only after missing flight observations', kuantan.liveRecommendationEligible === false && kuantan.retryQueues.includes('missing-flight-observations'));
  check('Chefchaouen stays estimate-only after flight comfort failure', chefchaouen.liveRecommendationEligible === false && chefchaouen.retryQueues.includes('flight-comfort-failure'));
  check('Cape Coast carries overlapping missing-flight and quality queues', capeCoast.liveRecommendationEligible === false && capeCoast.retryQueues.includes('missing-flight-observations') && capeCoast.retryQueues.includes('hotel-quality-failure'));
  check('Moscow remains unaudited expansion estimate-only', moscow.auditStatus === 'unaudited' && moscow.liveRecommendationEligible === false && moscow.recommendationMode === 'estimate-only');

  const summarySearch = activation.search({ limit: 100 });
  const activeSearch = activation.search({ status: 'active', limit: 100 });
  const reviewSearch = activation.search({ status: 'review', limit: 100 });
  const gatewaySearch = activation.search({ status: 'gateway-supported', limit: 100 });
  const currentSearch = activation.search({ tier: 'current-500', limit: 100 });
  check('activation service search sees 1000 discovery cities', summarySearch.totalMatches === 1000);
  check('active search returns 322 total matches', activeSearch.totalMatches === 322);
  check('review search returns 223 total matches', reviewSearch.totalMatches === 223);
  check('gateway search returns 27 total matches', gatewaySearch.totalMatches === 27);
  check('Current-500 search returns all 500 audited cities', currentSearch.totalMatches === 500 && currentSearch.records.every(record => record.auditStatus !== 'unaudited'));

  const registryActive = cityRegistry.searchRegistry({ live: 'true', limit: 100 });
  const registryCurrent = cityRegistry.searchRegistry({ tier: 'current-500', limit: 100 });
  check('city registry live filter exposes 322 active cities', registryActive.totalMatches === 322);
  check('city registry keeps all 500 Current-500 cities discoverable', registryCurrent.totalMatches === 500);

  const selectedRows = cityRegistry.routeGraphSelection([]);
  const selectedSapporo = selectedRows.find(row => row.unifiedRegistry?.cityId === 'sapporo-jp');
  const selectedKuantan = selectedRows.find(row => row.unifiedRegistry?.cityId === 'kuantan-my');
  const selectedMoscow = selectedRows.find(row => row.unifiedRegistry?.cityId === 'moscow-ru');
  check('route graph selection still contains all 1000 cities', selectedRows.length === 1000);
  check('route graph selection annotates 322 live-eligible rows', selectedRows.filter(row => row.liveRecommendationEligible === true).length === 322);
  check('Sapporo row is marked verified live capability', selectedSapporo?.providerSupportStatus === 'verified-live-provider-capability-668l');
  check('Kuantan row is marked audited estimate-only', selectedKuantan?.providerSupportStatus === 'audited-estimate-only-668l');
  check('Moscow row is marked unaudited estimate-only', selectedMoscow?.providerSupportStatus === 'unaudited-estimate-only-668l');

  check('provider-driven discovery accepts active Sapporo observation', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'SPK' })) === true);
  check('provider-driven discovery blocks reviewed Kuantan observation', routeGraph._internal.providerObservationRow({ destinationCode: 'KUA' }) === null);
  check('destination record still requires exact provider verification', routeGraph._internal.destinationRecord(selectedSapporo, 3).hotel.exactRateVerificationRequired === true);

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaActive = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: { status: 'active', limit: '100' } }));
  const lambdaRetry = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation/retry-queues', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaRegistry = parseBody(await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: { live: 'true', limit: '100' } }));
  const lambdaCompletion = parseBody(await lambda.handler({ rawPath: '/api/current-500-completion-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  check('Lambda activation summary endpoint works', lambdaSummary.version === 'GV-CITY-668L' && lambdaSummary.summary.productionActiveCount === 322 && lambdaSummary.summary.current500.audited === 500);
  check('Lambda activation search endpoint works', lambdaActive.totalMatches === 322 && lambdaActive.count === 100);
  check('Lambda retry endpoint works', lambdaRetry.queues['missing-flight-observations'].count === 189);
  check('Lambda city-registry live filter uses 668L activation', lambdaRegistry.totalMatches === 322 && lambdaRegistry.count === 100);
  check('668K completion plan endpoint remains preserved', lambdaCompletion.version === 'GV-CITY-668K' && lambdaCompletion.summary?.selectedCount === 145);

  const methodDenied = await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('activation endpoint remains read-only', methodDenied.statusCode === 405);

  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L = 'false';
  check('flag-off rollback disables enforcement', activation.enabled() === false && activation.liveRecommendationEligible('kuantan-my') === true);
  check('flag-off rollback restores provider observation behavior', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'KUA' })) === true);
  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668L',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668L.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
