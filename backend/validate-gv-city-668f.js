'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668F = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const activation = require('./services/cities/registry/verified-city-activation');
const cityRegistry = require('./services/cities/registry/city-registry');
const routeGraph = require('./services/domain/routing/global-route-graph');
const lambda = require('./lambda');
const snapshot = require('./data/verified-city-activation-100-668f.json');
const retry = require('./data/verified-city-retry-queues-668f.json');
const source = require('./data/provider-live-pilot-100-668e-source.json');
const registry = require('./data/unified-city-registry-1000-668b.json');

const checks = [];
function check(name, pass, details = {}) {
  checks.push({ name, pass: Boolean(pass), details });
  if (!pass) console.error('FAIL', name, details);
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function ids(records) { return records.map(record => record.cityId); }
function find(id) { return snapshot.records.find(record => record.cityId === id); }
function parseBody(response) { return JSON.parse(response.body); }

(async () => {
  const active = snapshot.records.filter(record => record.liveRecommendationEligible === true);
  const inactive = snapshot.records.filter(record => record.liveRecommendationEligible !== true);
  const current = snapshot.records.filter(record => record.selectionTier === 'current-500');
  const expansion = snapshot.records.filter(record => record.selectionTier === 'expansion-500');

  check('service version is 668F', activation.VERSION === 'GV-CITY-668F');
  check('668F feature flag is enabled', activation.enabled() === true);
  check('snapshot task and status are correct', snapshot.taskId === 'GV-CITY-668F' && snapshot.status === 'verified-activation-snapshot');
  check('source audit is the completed 668E Pilot100', source.taskId === 'GV-CITY-668E' && source.mode === 'Pilot100' && source.completedCount === 100);
  check('source audit SHA is pinned', snapshot.sourceAudit.sourceFileSha256 === sha256(path.join(__dirname, 'data', 'provider-live-pilot-100-668e-source.json')), snapshot.sourceAudit);
  check('snapshot contains 100 unique audited cities', snapshot.records.length === 100 && new Set(ids(snapshot.records)).size === 100);
  check('snapshot contains exactly 56 production-active cities', active.length === 56, active.length);
  check('snapshot contains exactly 44 reviewed inactive cities', inactive.length === 44, inactive.length);
  check('active modes are 51 direct/metro and 5 gateway', active.filter(record => record.activation.mode === 'direct-or-metro').length === 51 && active.filter(record => record.activation.mode === 'gateway-supported').length === 5, snapshot.summary.activeModeCounts);
  check('current-500 split is 43 active of 55 audited', current.length === 55 && current.filter(record => record.liveRecommendationEligible).length === 43, snapshot.summary.current500);
  check('expansion-500 split is 13 active of 45 audited', expansion.length === 45 && expansion.filter(record => record.liveRecommendationEligible).length === 13, snapshot.summary.expansion500);
  check('registry count is 1000 and unaudited count is 900', registry.records.length === 1000 && snapshot.summary.unauditedCount === 900);
  check('estimate-only total is 944', snapshot.summary.estimateOnlyCount === 944);
  check('provider-covered count is 58', snapshot.summary.providerCoveredCount === 58);

  check('all active cities use production provider evidence', active.every(record => record.evidence.travelpayouts.evidenceMode === 'production-provider-response' && record.evidence.agoda.evidenceMode === 'production-provider-response'));
  check('all active cities passed recommendation readiness', active.every(record => record.recommendationReadiness?.eligible === true));
  check('all active cities have no retry queues', active.every(record => Array.isArray(record.retryQueues) && record.retryQueues.length === 0));
  check('all inactive audited cities remain discoverable estimate-only', inactive.every(record => record.discoveryEligible === true && record.recommendationMode === 'estimate-only'));
  check('no inactive city is accidentally activated', inactive.every(record => record.activation.eligible === false));
  check('gateway-active cities retain gateway evidence', active.filter(record => record.activation.mode === 'gateway-supported').every(record => record.evidence.travelpayouts.gateway && record.evidence.travelpayouts.gatewayRequiredForDestination === true));

  const queueCounts = snapshot.summary.retryQueueCounts;
  check('missing-flight queue count is 35', queueCounts['missing-flight-observations'] === 35);
  check('unresolved-Agoda queue count is 25', queueCounts['unresolved-agoda-mapping'] === 25);
  check('no-live-hotel-rate queue count is 4', queueCounts['no-live-hotel-rate'] === 4);
  check('hotel-quality queue count is 2', queueCounts['hotel-quality-failure'] === 2);
  check('flight-comfort queue count is 3', queueCounts['flight-comfort-failure'] === 3);
  check('retry snapshot allows overlapping membership', retry.queueMembershipCanOverlap === true && retry.reviewCityCount === 44);

  const toronto = activation.activationForCity('toronto-ca', { includeEvidence: false });
  const tulum = activation.activationForCity('tulum-mx');
  const tehran = activation.activationForCity('tehran-ir', { includeEvidence: false });
  const caye = activation.activationForCity('caye-caulker-bz', { includeEvidence: false });
  const abuja = activation.activationForCity('abuja-ng', { includeEvidence: false });
  const aitutaki = activation.activationForCity('aitutaki-ck', { includeEvidence: false });
  const ankara = activation.activationForCity('ankara-tr', { includeEvidence: false });

  check('Toronto resolves as verified active', toronto.liveRecommendationEligible === true && toronto.auditStatus === 'verified-active', toronto);
  check('Tulum retains CUN gateway activation', tulum.liveRecommendationEligible === true && tulum.activation.mode === 'gateway-supported' && tulum.evidence.travelpayouts.gateway?.airportCode === 'CUN', tulum.evidence?.travelpayouts);
  check('Tehran remains estimate-only for unresolved Agoda mapping', tehran.liveRecommendationEligible === false && tehran.retryQueues.includes('unresolved-agoda-mapping'), tehran);
  check('Caye Caulker remains estimate-only for missing flight observations', caye.liveRecommendationEligible === false && caye.retryQueues.includes('missing-flight-observations'), caye);
  check('Abuja remains estimate-only for flight comfort', abuja.liveRecommendationEligible === false && abuja.retryQueues.includes('flight-comfort-failure'), abuja);
  check('Aitutaki keeps both quality and comfort work items', aitutaki.retryQueues.includes('hotel-quality-failure') && aitutaki.retryQueues.includes('flight-comfort-failure'), aitutaki);
  check('Ankara is unaudited and estimate-only', ankara.auditStatus === 'unaudited' && ankara.liveRecommendationEligible === false && ankara.recommendationMode === 'estimate-only', ankara);

  check('live eligibility helper allows active city', activation.liveRecommendationEligible('toronto-ca') === true);
  check('live eligibility helper blocks reviewed inactive city', activation.liveRecommendationEligible('tehran-ir') === false);
  check('live eligibility helper blocks unaudited city', activation.liveRecommendationEligible('ankara-tr') === false);

  const activeSearch = activation.search({ status: 'active', limit: 100 });
  const reviewSearch = activation.search({ status: 'review', limit: 100 });
  const unauditedSearch = activation.search({ status: 'unaudited', limit: 1 });
  const missingFlights = activation.search({ queue: 'missing-flight-observations', limit: 100 });
  check('activation search returns 56 active cities', activeSearch.totalMatches === 56 && activeSearch.records.length === 56);
  check('activation search returns 44 reviewed inactive cities', reviewSearch.totalMatches === 44 && reviewSearch.records.length === 44);
  check('activation search counts 900 unaudited cities', unauditedSearch.totalMatches === 900 && unauditedSearch.records.length === 1);
  check('activation search exposes 35 missing-flight work items', missingFlights.totalMatches === 35);
  check('activation search can include evidence on demand', activation.search({ q: 'Toronto', includeEvidence: 'true', limit: 1 }).records[0]?.evidence?.travelpayouts?.evidenceMode === 'production-provider-response');

  const summary = activation.summary();
  const retrySummary = activation.retryQueues();
  check('public summary reports 56 active and 944 estimate-only', summary.summary.productionActiveCount === 56 && summary.summary.estimateOnlyCount === 944, summary.summary);
  check('public summary preserves exact itinerary verification requirement', summary.policy.exactItineraryProviderVerificationStillRequired === true && summary.policy.exactItineraryVerificationLayers.includes('GV-LIVE-667B'), summary.policy);
  check('retry endpoint data exposes all five queues', Object.keys(retrySummary.queues).length === 5, Object.keys(retrySummary.queues));

  const registrySummary = cityRegistry.registrySummary();
  const registryLive = cityRegistry.searchRegistry({ live: 'true', limit: 100 });
  const registryTehran = cityRegistry.searchRegistry({ q: 'Tehran', limit: 1 });
  check('city registry summary embeds 668F activation summary', registrySummary.verifiedActivationVersion === 'GV-CITY-668F' && registrySummary.verifiedActivation.summary.productionActiveCount === 56);
  check('city registry live filter returns exactly 56 cities', registryLive.totalMatches === 56 && registryLive.records.every(record => record.verifiedActivation.liveRecommendationEligible === true));
  check('city registry keeps Tehran discoverable but estimate-only', registryTehran.totalMatches === 1 && registryTehran.records[0].verifiedActivation.liveRecommendationEligible === false && registryTehran.records[0].verifiedActivation.recommendationMode === 'estimate-only', registryTehran.records[0]);

  const selectedRows = cityRegistry.routeGraphSelection([]);
  const selectedToronto = selectedRows.find(row => row.unifiedRegistry?.cityId === 'toronto-ca');
  const selectedTehran = selectedRows.find(row => row.unifiedRegistry?.cityId === 'tehran-ir');
  const selectedAnkara = selectedRows.find(row => row.unifiedRegistry?.cityId === 'ankara-tr');
  check('route graph selection still contains all 1000 discovery cities', selectedRows.length === 1000);
  check('route graph selection annotates 56 live-eligible rows', selectedRows.filter(row => row.liveRecommendationEligible === true).length === 56);
  check('Toronto row is marked verified live capability', selectedToronto?.providerSupportStatus === 'verified-live-provider-capability-668f');
  check('Tehran row is marked audited estimate-only', selectedTehran?.providerSupportStatus === 'audited-estimate-only-668f');
  check('Ankara row is marked unaudited estimate-only', selectedAnkara?.providerSupportStatus === 'unaudited-estimate-only-668f');

  check('provider-driven discovery accepts active Toronto observation', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'YTO' })) === true);
  check('provider-driven discovery blocks reviewed Tehran observation', routeGraph._internal.providerObservationRow({ destinationCode: 'THR' }) === null);
  check('destination records expose exact verification requirement', routeGraph._internal.destinationRecord(selectedToronto, 3).hotel.exactRateVerificationRequired === true);
  check('destination records expose activation status', routeGraph._internal.destinationRecord(selectedTehran, 3).recommendationMode === 'estimate-only');

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaActive = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: { status: 'active', limit: '100' } }));
  const lambdaRetry = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation/retry-queues', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaRegistry = parseBody(await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: { live: 'true', limit: '100' } }));
  check('Lambda activation summary endpoint works', lambdaSummary.version === 'GV-CITY-668F' && lambdaSummary.summary.productionActiveCount === 56);
  check('Lambda activation search endpoint works', lambdaActive.totalMatches === 56 && lambdaActive.count === 56);
  check('Lambda retry-queue endpoint works', lambdaRetry.queues['missing-flight-observations'].count === 35);
  check('Lambda city-registry live filter uses activation', lambdaRegistry.totalMatches === 56);

  const methodDenied = await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('activation endpoint is read-only', methodDenied.statusCode === 405);

  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668F = 'false';
  check('flag-off rollback disables enforcement', activation.enabled() === false && activation.liveRecommendationEligible('tehran-ir') === true);
  check('flag-off rollback restores provider observation behavior', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'THR' })) === true);
  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668F = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668F',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668F.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
