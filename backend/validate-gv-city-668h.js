'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668H = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const activation = require('./services/verified-city-activation');
const cityRegistry = require('./services/city-registry');
const routeGraph = require('./services/global-route-graph');
const lambda = require('./lambda');
const snapshot = require('./data/verified-city-activation-250-668h.json');
const retry = require('./data/verified-city-retry-queues-668h.json');
const pilot = require('./data/provider-live-pilot-100-668e-source.json');
const priority = require('./data/provider-live-priority-150-668g-source.json');
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
function parseBody(response) { return JSON.parse(response.body); }
function get(id, includeEvidence = true) { return activation.activationForCity(id, { includeEvidence }); }

(async () => {
  const active = snapshot.records.filter(record => record.liveRecommendationEligible === true);
  const inactive = snapshot.records.filter(record => record.liveRecommendationEligible !== true);
  const current = snapshot.records.filter(record => record.selectionTier === 'current-500');
  const expansion = snapshot.records.filter(record => record.selectionTier === 'expansion-500');
  const source668E = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668E');
  const source668G = snapshot.records.filter(record => record.activation.sourceAuditTaskId === 'GV-CITY-668G');

  check('service version is 668H', activation.VERSION === 'GV-CITY-668H');
  check('668H feature flag is enabled', activation.enabled() === true);
  check('snapshot task and status are correct', snapshot.taskId === 'GV-CITY-668H' && snapshot.status === 'merged-verified-activation-snapshot');
  check('Pilot100 source identity is correct', pilot.taskId === 'GV-CITY-668E' && pilot.mode === 'Pilot100' && pilot.completedCount === 100 && pilot.productionActiveCount === 56);
  check('Priority150 source identity is correct', priority.taskId === 'GV-CITY-668G' && priority.mode === 'Priority150' && priority.completedCount === 150 && priority.productionActiveCount === 120);
  check('both source audits are pinned', Array.isArray(snapshot.sourceAudits) && snapshot.sourceAudits.length === 2);
  check('Pilot100 SHA is pinned', snapshot.sourceAudits[0].sourceFileSha256 === sha256(path.join(__dirname, 'data', 'provider-live-pilot-100-668e-source.json')));
  check('Priority150 SHA is pinned', snapshot.sourceAudits[1].sourceFileSha256 === sha256(path.join(__dirname, 'data', 'provider-live-priority-150-668g-source.json')));
  check('source audit city sets do not overlap', new Set(pilot.records.map(record => record.cityId).filter(id => priority.records.some(record => record.cityId === id))).size === 0);

  check('snapshot contains 250 unique audited cities', snapshot.records.length === 250 && new Set(ids(snapshot.records)).size === 250);
  check('source attribution is 100 plus 150', source668E.length === 100 && source668G.length === 150, { source668E: source668E.length, source668G: source668G.length });
  check('snapshot contains exactly 176 production-active cities', active.length === 176, active.length);
  check('snapshot contains exactly 74 reviewed inactive cities', inactive.length === 74, inactive.length);
  check('active modes are 170 direct/metro and 6 gateway', active.filter(record => record.activation.mode === 'direct-or-metro').length === 170 && active.filter(record => record.activation.mode === 'gateway-supported').length === 6, snapshot.summary.activeModeCounts);
  check('current-500 split is 163 active of 205 audited', current.length === 205 && current.filter(record => record.liveRecommendationEligible).length === 163 && current.filter(record => !record.liveRecommendationEligible).length === 42, snapshot.summary.current500);
  check('expansion-500 split is 13 active of 45 audited', expansion.length === 45 && expansion.filter(record => record.liveRecommendationEligible).length === 13 && expansion.filter(record => !record.liveRecommendationEligible).length === 32, snapshot.summary.expansion500);
  check('registry count is 1000 and unaudited count is 750', registry.records.length === 1000 && snapshot.summary.unauditedCount === 750);
  check('estimate-only total is 824', snapshot.summary.estimateOnlyCount === 824);
  check('provider-covered count is 186', snapshot.summary.providerCoveredCount === 186);
  check('classification counts are stable', snapshot.summary.classificationCounts['live-both'] === 180 && snapshot.summary.classificationCounts['live-stays-only'] === 35 && snapshot.summary.classificationCounts['gateway-supported'] === 6 && snapshot.summary.classificationCounts['unresolved'] === 18 && snapshot.summary.classificationCounts['live-flights-only'] === 7 && snapshot.summary.classificationCounts['estimate-only'] === 4, snapshot.summary.classificationCounts);

  check('all active cities use production provider evidence', active.every(record => record.evidence.travelpayouts.evidenceMode === 'production-provider-response' && record.evidence.agoda.evidenceMode === 'production-provider-response'));
  check('all active cities passed recommendation readiness', active.every(record => record.recommendationReadiness?.eligible === true));
  check('all active cities have no retry queues', active.every(record => Array.isArray(record.retryQueues) && record.retryQueues.length === 0));
  check('all inactive audited cities remain discoverable estimate-only', inactive.every(record => record.discoveryEligible === true && record.recommendationMode === 'estimate-only'));
  check('no inactive city is accidentally activated', inactive.every(record => record.activation.eligible === false));
  check('gateway-active cities retain gateway evidence', active.filter(record => record.activation.mode === 'gateway-supported').every(record => record.evidence.travelpayouts.gateway && record.evidence.travelpayouts.gatewayRequiredForDestination === true));
  check('gateway city set is exact', JSON.stringify(active.filter(record => record.activation.mode === 'gateway-supported').map(record => record.cityId).sort()) === JSON.stringify(['antigua-guatemala-gt','ayutthaya-th','kampala-ug','lucca-it','suwon-kr','tulum-mx'].sort()));

  const queueCounts = snapshot.summary.retryQueueCounts;
  check('missing-flight queue count is 57', queueCounts['missing-flight-observations'] === 57);
  check('unresolved-Agoda queue count is 25', queueCounts['unresolved-agoda-mapping'] === 25);
  check('no-live-hotel-rate queue count is 4', queueCounts['no-live-hotel-rate'] === 4);
  check('hotel-quality queue count is 2', queueCounts['hotel-quality-failure'] === 2);
  check('flight-comfort queue count is 11', queueCounts['flight-comfort-failure'] === 11);
  check('retry snapshot allows overlapping membership', retry.queueMembershipCanOverlap === true && retry.reviewCityCount === 74);
  check('retry snapshot queue counts match activation snapshot', Object.entries(retry.queues).every(([name, value]) => value.count === queueCounts[name]));

  const toronto = get('toronto-ca', false);
  const osaka = get('osaka-jp');
  const kampala = get('kampala-ug');
  const tulum = get('tulum-mx');
  const tehran = get('tehran-ir', false);
  const milwaukee = get('milwaukee-us', false);
  const honolulu = get('honolulu-us', false);
  const aitutaki = get('aitutaki-ck', false);
  const ankara = get('ankara-tr', false);

  check('Toronto remains verified active from 668E', toronto.liveRecommendationEligible === true && toronto.activation.sourceAuditTaskId === 'GV-CITY-668E', toronto);
  check('Osaka is newly verified active from 668G', osaka.liveRecommendationEligible === true && osaka.activation.sourceAuditTaskId === 'GV-CITY-668G' && osaka.evidence.travelpayouts.destinationCode === 'OSA', osaka);
  check('Kampala retains EBB gateway activation', kampala.liveRecommendationEligible === true && kampala.activation.mode === 'gateway-supported' && kampala.evidence.travelpayouts.gateway?.airportCode === 'EBB', kampala.evidence?.travelpayouts);
  check('Tulum retains CUN gateway activation', tulum.liveRecommendationEligible === true && tulum.activation.mode === 'gateway-supported' && tulum.evidence.travelpayouts.gateway?.airportCode === 'CUN', tulum.evidence?.travelpayouts);
  check('Tehran remains estimate-only for unresolved Agoda mapping', tehran.liveRecommendationEligible === false && tehran.retryQueues.includes('unresolved-agoda-mapping'), tehran);
  check('Milwaukee remains estimate-only for missing flight observations', milwaukee.liveRecommendationEligible === false && milwaukee.retryQueues.includes('missing-flight-observations'), milwaukee);
  check('Honolulu remains estimate-only for flight comfort', honolulu.liveRecommendationEligible === false && honolulu.retryQueues.includes('flight-comfort-failure'), honolulu);
  check('Aitutaki keeps both quality and comfort work items', aitutaki.retryQueues.includes('hotel-quality-failure') && aitutaki.retryQueues.includes('flight-comfort-failure'), aitutaki);
  check('Ankara is unaudited and estimate-only', ankara.auditStatus === 'unaudited' && ankara.liveRecommendationEligible === false && ankara.recommendationMode === 'estimate-only', ankara);

  check('live eligibility helper allows baseline active city', activation.liveRecommendationEligible('toronto-ca') === true);
  check('live eligibility helper allows newly active city', activation.liveRecommendationEligible('osaka-jp') === true);
  check('live eligibility helper blocks reviewed inactive city', activation.liveRecommendationEligible('honolulu-us') === false);
  check('live eligibility helper blocks unaudited city', activation.liveRecommendationEligible('ankara-tr') === false);
  check('city can resolve from provider code', activation.activationForCity('OSA', { includeEvidence: false }).cityId === 'osaka-jp');

  const activeSearch = activation.search({ status: 'active', limit: 100 });
  const reviewSearch = activation.search({ status: 'review', limit: 100 });
  const unauditedSearch = activation.search({ status: 'unaudited', limit: 1 });
  const missingFlights = activation.search({ queue: 'missing-flight-observations', limit: 100 });
  const gateways = activation.search({ status: 'gateway-supported', limit: 100 });
  check('activation search counts 176 active cities', activeSearch.totalMatches === 176 && activeSearch.records.length === 100);
  check('activation search returns all 74 reviewed inactive cities', reviewSearch.totalMatches === 74 && reviewSearch.records.length === 74);
  check('activation search counts 750 unaudited cities', unauditedSearch.totalMatches === 750 && unauditedSearch.records.length === 1);
  check('activation search exposes 57 missing-flight work items', missingFlights.totalMatches === 57 && missingFlights.records.length === 57);
  check('activation search exposes six gateway-supported cities', gateways.totalMatches === 6 && gateways.records.length === 6);
  check('activation search can include evidence on demand', activation.search({ q: 'Osaka', includeEvidence: 'true', limit: 1 }).records[0]?.evidence?.travelpayouts?.evidenceMode === 'production-provider-response');

  const summary = activation.summary();
  const retrySummary = activation.retryQueues();
  check('public summary reports 176 active and 824 estimate-only', summary.summary.productionActiveCount === 176 && summary.summary.estimateOnlyCount === 824, summary.summary);
  check('public summary exposes both source audits', Array.isArray(summary.sourceAudits) && summary.sourceAudits.length === 2);
  check('public summary preserves exact itinerary verification requirement', summary.policy.exactItineraryProviderVerificationStillRequired === true && summary.policy.exactItineraryVerificationLayers.includes('GV-LIVE-667B'), summary.policy);
  check('retry endpoint data exposes all five queues', Object.keys(retrySummary.queues).length === 5, Object.keys(retrySummary.queues));

  const registrySummary = cityRegistry.registrySummary();
  const registryLive = cityRegistry.searchRegistry({ live: 'true', limit: 100 });
  const registryHonolulu = cityRegistry.searchRegistry({ q: 'Honolulu', limit: 1 });
  check('city registry summary embeds 668H activation summary', registrySummary.verifiedActivationVersion === 'GV-CITY-668H' && registrySummary.verifiedActivation.summary.productionActiveCount === 176);
  check('city registry live filter counts 176 cities', registryLive.totalMatches === 176 && registryLive.records.length === 100 && registryLive.records.every(record => record.verifiedActivation.liveRecommendationEligible === true));
  check('city registry keeps Honolulu discoverable but estimate-only', registryHonolulu.totalMatches === 1 && registryHonolulu.records[0].verifiedActivation.liveRecommendationEligible === false && registryHonolulu.records[0].verifiedActivation.recommendationMode === 'estimate-only', registryHonolulu.records[0]);

  const selectedRows = cityRegistry.routeGraphSelection([]);
  const selectedToronto = selectedRows.find(row => row.unifiedRegistry?.cityId === 'toronto-ca');
  const selectedOsaka = selectedRows.find(row => row.unifiedRegistry?.cityId === 'osaka-jp');
  const selectedHonolulu = selectedRows.find(row => row.unifiedRegistry?.cityId === 'honolulu-us');
  const selectedAnkara = selectedRows.find(row => row.unifiedRegistry?.cityId === 'ankara-tr');
  check('route graph selection still contains all 1000 discovery cities', selectedRows.length === 1000);
  check('route graph selection annotates 176 live-eligible rows', selectedRows.filter(row => row.liveRecommendationEligible === true).length === 176);
  check('Toronto row is marked verified live capability', selectedToronto?.providerSupportStatus === 'verified-live-provider-capability-668h');
  check('Osaka row is marked verified live capability', selectedOsaka?.providerSupportStatus === 'verified-live-provider-capability-668h');
  check('Honolulu row is marked audited estimate-only', selectedHonolulu?.providerSupportStatus === 'audited-estimate-only-668h');
  check('Ankara row is marked unaudited estimate-only', selectedAnkara?.providerSupportStatus === 'unaudited-estimate-only-668h');

  check('provider-driven discovery accepts active Osaka observation', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'OSA' })) === true);
  check('provider-driven discovery blocks reviewed Honolulu observation', routeGraph._internal.providerObservationRow({ destinationCode: 'HNL' }) === null);
  check('destination records expose exact verification requirement', routeGraph._internal.destinationRecord(selectedOsaka, 3).hotel.exactRateVerificationRequired === true);
  check('destination records expose inactive activation status', routeGraph._internal.destinationRecord(selectedHonolulu, 3).recommendationMode === 'estimate-only');

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaActive = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: { status: 'active', limit: '100' } }));
  const lambdaRetry = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation/retry-queues', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaRegistry = parseBody(await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: { live: 'true', limit: '100' } }));
  check('Lambda activation summary endpoint works', lambdaSummary.version === 'GV-CITY-668H' && lambdaSummary.summary.productionActiveCount === 176);
  check('Lambda activation search endpoint works', lambdaActive.totalMatches === 176 && lambdaActive.count === 100);
  check('Lambda retry-queue endpoint works', lambdaRetry.queues['missing-flight-observations'].count === 57);
  check('Lambda city-registry live filter uses activation', lambdaRegistry.totalMatches === 176 && lambdaRegistry.count === 100);

  const methodDenied = await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('activation endpoint is read-only', methodDenied.statusCode === 405);

  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668H = 'false';
  check('flag-off rollback disables enforcement', activation.enabled() === false && activation.liveRecommendationEligible('honolulu-us') === true);
  check('flag-off rollback restores provider observation behavior', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'HNL' })) === true);
  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668H = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668H',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668H.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
