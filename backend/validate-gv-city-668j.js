'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668J = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const activation = require('./services/verified-city-activation');
const cityRegistry = require('./services/city-registry');
const routeGraph = require('./services/global-route-graph');
const lambda = require('./lambda');
const snapshot = require('./data/verified-city-activation-400-668j.json');
const retry = require('./data/verified-city-retry-queues-668j.json');
const baseline = require('./data/verified-city-activation-250-668h.json');
const remaining = require('./data/provider-live-remaining-150-668i-source.json');
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

  check('service version is 668J', activation.VERSION === 'GV-CITY-668J');
  check('668J feature flag is enabled', activation.enabled() === true);
  check('snapshot task and status are correct', snapshot.taskId === 'GV-CITY-668J' && snapshot.status === 'merged-verified-activation-snapshot');
  check('668H baseline identity is correct', baseline.taskId === 'GV-CITY-668H' && baseline.summary.auditedCount === 250 && baseline.summary.productionActiveCount === 176);
  check('668I source identity is correct', remaining.taskId === 'GV-CITY-668I' && remaining.mode === 'Remaining150' && remaining.completedCount === 150 && remaining.productionActiveCount === 83 && remaining.reviewCount === 67);
  check('three source audits are preserved', Array.isArray(snapshot.sourceAudits) && snapshot.sourceAudits.length === 3);
  check('668H baseline snapshot is pinned', snapshot.sourceSnapshots?.[0]?.sourceFileSha256 === sha256(path.join(__dirname, 'data', 'verified-city-activation-250-668h.json')));
  check('668I source SHA is pinned', snapshot.sourceAudits[2].sourceFileSha256 === sha256(path.join(__dirname, 'data', 'provider-live-remaining-150-668i-source.json')));
  check('668H and 668I city sets do not overlap', baseline.records.every(record => !remaining.records.some(item => item.cityId === record.cityId)));

  check('snapshot contains 400 unique audited cities', snapshot.records.length === 400 && new Set(ids(snapshot.records)).size === 400);
  check('source attribution is 100 plus 150 plus 150', source668E.length === 100 && source668G.length === 150 && source668I.length === 150, { source668E: source668E.length, source668G: source668G.length, source668I: source668I.length });
  check('snapshot contains exactly 259 production-active cities', active.length === 259, active.length);
  check('snapshot contains exactly 141 reviewed inactive cities', inactive.length === 141, inactive.length);
  check('active modes are 250 direct/metro and 9 gateway', active.filter(record => record.activation.mode === 'direct-or-metro').length === 250 && active.filter(record => record.activation.mode === 'gateway-supported').length === 9, snapshot.summary.activeModeCounts);
  check('current-500 split is 246 active of 355 audited', current.length === 355 && current.filter(record => record.liveRecommendationEligible).length === 246 && current.filter(record => !record.liveRecommendationEligible).length === 109, snapshot.summary.current500);
  check('expansion-500 split remains 13 active of 45 audited', expansion.length === 45 && expansion.filter(record => record.liveRecommendationEligible).length === 13 && expansion.filter(record => !record.liveRecommendationEligible).length === 32, snapshot.summary.expansion500);
  check('registry count is 1000 and unaudited count is 600', registry.records.length === 1000 && snapshot.summary.unauditedCount === 600);
  check('estimate-only total is 741', snapshot.summary.estimateOnlyCount === 741);
  check('provider-covered count is 281', snapshot.summary.providerCoveredCount === 281);
  check('classification counts are stable', snapshot.summary.classificationCounts['live-both'] === 272 && snapshot.summary.classificationCounts['live-stays-only'] === 90 && snapshot.summary.classificationCounts['gateway-supported'] === 9 && snapshot.summary.classificationCounts['unresolved'] === 18 && snapshot.summary.classificationCounts['live-flights-only'] === 7 && snapshot.summary.classificationCounts['estimate-only'] === 4, snapshot.summary.classificationCounts);

  check('all active cities use production provider evidence', active.every(record => record.evidence.travelpayouts.evidenceMode === 'production-provider-response' && record.evidence.agoda.evidenceMode === 'production-provider-response'));
  check('all active cities passed recommendation readiness', active.every(record => record.recommendationReadiness?.eligible === true));
  check('all active cities have no retry queues', active.every(record => Array.isArray(record.retryQueues) && record.retryQueues.length === 0));
  check('all inactive audited cities remain discoverable estimate-only', inactive.every(record => record.discoveryEligible === true && record.recommendationMode === 'estimate-only'));
  check('no inactive city is accidentally activated', inactive.every(record => record.activation.eligible === false));
  check('all records use 668J policy version', snapshot.records.every(record => record.activation.policyVersion === 'GV-CITY-668J'));
  check('gateway-active cities retain gateway evidence', active.filter(record => record.activation.mode === 'gateway-supported').every(record => record.evidence.travelpayouts.gateway && record.evidence.travelpayouts.gatewayRequiredForDestination === true));
  check('gateway city set is exact', JSON.stringify(active.filter(record => record.activation.mode === 'gateway-supported').map(record => record.cityId).sort()) === JSON.stringify(['antigua-guatemala-gt','ayutthaya-th','como-it','hakone-jp','hoi-an-vn','kampala-ug','lucca-it','suwon-kr','tulum-mx'].sort()));

  const queueCounts = snapshot.summary.retryQueueCounts;
  check('missing-flight queue count is 112', queueCounts['missing-flight-observations'] === 112);
  check('unresolved-Agoda queue count is 25', queueCounts['unresolved-agoda-mapping'] === 25);
  check('no-live-hotel-rate queue count is 4', queueCounts['no-live-hotel-rate'] === 4);
  check('hotel-quality queue count is 2', queueCounts['hotel-quality-failure'] === 2);
  check('flight-comfort queue count is 23', queueCounts['flight-comfort-failure'] === 23);
  check('retry snapshot allows overlapping membership', retry.queueMembershipCanOverlap === true && retry.reviewCityCount === 141);
  check('retry snapshot queue counts match activation snapshot', Object.entries(retry.queues).every(([name, value]) => value.count === queueCounts[name]));

  const toronto = get('toronto-ca', false);
  const osaka = get('osaka-jp');
  const philadelphia = get('philadelphia-us');
  const hoiAn = get('hoi-an-vn');
  const hakone = get('hakone-jp');
  const como = get('como-it');
  const puertoVallarta = get('puerto-vallarta-mx', false);
  const durban = get('durban-za', false);
  const honolulu = get('honolulu-us', false);
  const tehran = get('tehran-ir', false);
  const brighton = get('brighton-gb', false);

  check('Toronto remains verified active from 668E', toronto.liveRecommendationEligible === true && toronto.activation.sourceAuditTaskId === 'GV-CITY-668E', toronto);
  check('Osaka remains verified active from 668G', osaka.liveRecommendationEligible === true && osaka.activation.sourceAuditTaskId === 'GV-CITY-668G' && osaka.evidence.travelpayouts.destinationCode === 'OSA', osaka);
  check('Philadelphia is newly active from 668I', philadelphia.liveRecommendationEligible === true && philadelphia.activation.sourceAuditTaskId === 'GV-CITY-668I' && philadelphia.evidence.travelpayouts.destinationCode === 'PHL', philadelphia);
  check('Hoi An retains DAD gateway activation', hoiAn.liveRecommendationEligible === true && hoiAn.activation.mode === 'gateway-supported' && hoiAn.evidence.travelpayouts.gateway?.airportCode === 'DAD', hoiAn.evidence?.travelpayouts);
  check('Hakone retains NRT gateway activation', hakone.liveRecommendationEligible === true && hakone.activation.mode === 'gateway-supported' && hakone.evidence.travelpayouts.gateway?.airportCode === 'NRT', hakone.evidence?.travelpayouts);
  check('Como retains BGY gateway activation', como.liveRecommendationEligible === true && como.activation.mode === 'gateway-supported' && como.evidence.travelpayouts.gateway?.airportCode === 'BGY', como.evidence?.travelpayouts);
  check('Puerto Vallarta remains estimate-only for missing flight observations', puertoVallarta.liveRecommendationEligible === false && puertoVallarta.retryQueues.includes('missing-flight-observations'), puertoVallarta);
  check('Durban remains estimate-only for flight comfort', durban.liveRecommendationEligible === false && durban.retryQueues.includes('flight-comfort-failure'), durban);
  check('Honolulu remains estimate-only from prior flight comfort review', honolulu.liveRecommendationEligible === false && honolulu.retryQueues.includes('flight-comfort-failure'), honolulu);
  check('Tehran remains estimate-only for unresolved Agoda mapping', tehran.liveRecommendationEligible === false && tehran.retryQueues.includes('unresolved-agoda-mapping'), tehran);
  check('Brighton remains unaudited and estimate-only', brighton.auditStatus === 'unaudited' && brighton.liveRecommendationEligible === false && brighton.recommendationMode === 'estimate-only', brighton);

  check('live eligibility helper allows baseline active city', activation.liveRecommendationEligible('toronto-ca') === true);
  check('live eligibility helper allows 668I active city', activation.liveRecommendationEligible('philadelphia-us') === true);
  check('live eligibility helper blocks reviewed inactive city', activation.liveRecommendationEligible('durban-za') === false);
  check('live eligibility helper blocks unaudited city', activation.liveRecommendationEligible('brighton-gb') === false);
  check('city can resolve from new provider code', activation.activationForCity('PHL', { includeEvidence: false }).cityId === 'philadelphia-us');

  const activeSearch = activation.search({ status: 'active', limit: 100 });
  const reviewSearch = activation.search({ status: 'review', limit: 100 });
  const unauditedSearch = activation.search({ status: 'unaudited', limit: 1 });
  const missingFlights = activation.search({ queue: 'missing-flight-observations', limit: 100 });
  const comfortFailures = activation.search({ queue: 'flight-comfort-failure', limit: 100 });
  const gateways = activation.search({ status: 'gateway-supported', limit: 100 });
  check('activation search counts 259 active cities', activeSearch.totalMatches === 259 && activeSearch.records.length === 100);
  check('activation search counts 141 reviewed inactive cities', reviewSearch.totalMatches === 141 && reviewSearch.records.length === 100);
  check('activation search counts 600 unaudited cities', unauditedSearch.totalMatches === 600 && unauditedSearch.records.length === 1);
  check('activation search exposes 112 missing-flight work items', missingFlights.totalMatches === 112 && missingFlights.records.length === 100);
  check('activation search exposes 23 flight-comfort work items', comfortFailures.totalMatches === 23 && comfortFailures.records.length === 23);
  check('activation search exposes nine gateway-supported cities', gateways.totalMatches === 9 && gateways.records.length === 9);
  check('activation search can include evidence on demand', activation.search({ q: 'Philadelphia', includeEvidence: 'true', limit: 1 }).records[0]?.evidence?.travelpayouts?.evidenceMode === 'production-provider-response');

  const summary = activation.summary();
  const retrySummary = activation.retryQueues();
  check('public summary reports 259 active and 741 estimate-only', summary.summary.productionActiveCount === 259 && summary.summary.estimateOnlyCount === 741, summary.summary);
  check('public summary exposes all three source audits', Array.isArray(summary.sourceAudits) && summary.sourceAudits.length === 3);
  check('public summary preserves exact itinerary verification requirement', summary.policy.exactItineraryProviderVerificationStillRequired === true && summary.policy.exactItineraryVerificationLayers.includes('GV-LIVE-667B'), summary.policy);
  check('retry endpoint data exposes all five queues', Object.keys(retrySummary.queues).length === 5, Object.keys(retrySummary.queues));

  const registrySummary = cityRegistry.registrySummary();
  const registryLive = cityRegistry.searchRegistry({ live: 'true', limit: 100 });
  const registryDurban = cityRegistry.searchRegistry({ q: 'Durban', limit: 1 });
  check('city registry summary embeds 668J activation summary', registrySummary.verifiedActivationVersion === 'GV-CITY-668J' && registrySummary.verifiedActivation.summary.productionActiveCount === 259);
  check('city registry live filter counts 259 cities', registryLive.totalMatches === 259 && registryLive.records.length === 100 && registryLive.records.every(record => record.verifiedActivation.liveRecommendationEligible === true));
  check('city registry keeps Durban discoverable but estimate-only', registryDurban.totalMatches === 1 && registryDurban.records[0].verifiedActivation.liveRecommendationEligible === false && registryDurban.records[0].verifiedActivation.recommendationMode === 'estimate-only', registryDurban.records[0]);

  const selectedRows = cityRegistry.routeGraphSelection([]);
  const selectedToronto = selectedRows.find(row => row.unifiedRegistry?.cityId === 'toronto-ca');
  const selectedPhiladelphia = selectedRows.find(row => row.unifiedRegistry?.cityId === 'philadelphia-us');
  const selectedDurban = selectedRows.find(row => row.unifiedRegistry?.cityId === 'durban-za');
  const selectedBrighton = selectedRows.find(row => row.unifiedRegistry?.cityId === 'brighton-gb');
  check('route graph selection still contains all 1000 discovery cities', selectedRows.length === 1000);
  check('route graph selection annotates 259 live-eligible rows', selectedRows.filter(row => row.liveRecommendationEligible === true).length === 259);
  check('Toronto row is marked verified live capability', selectedToronto?.providerSupportStatus === 'verified-live-provider-capability-668j');
  check('Philadelphia row is marked verified live capability', selectedPhiladelphia?.providerSupportStatus === 'verified-live-provider-capability-668j');
  check('Durban row is marked audited estimate-only', selectedDurban?.providerSupportStatus === 'audited-estimate-only-668j');
  check('Brighton row is marked unaudited estimate-only', selectedBrighton?.providerSupportStatus === 'unaudited-estimate-only-668j');

  check('provider-driven discovery accepts active Philadelphia observation', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'PHL' })) === true);
  check('provider-driven discovery blocks reviewed Puerto Vallarta observation', routeGraph._internal.providerObservationRow({ destinationCode: 'PVR' }) === null);
  check('destination records expose exact verification requirement', routeGraph._internal.destinationRecord(selectedPhiladelphia, 3).hotel.exactRateVerificationRequired === true);
  check('destination records expose inactive activation status', routeGraph._internal.destinationRecord(selectedDurban, 3).recommendationMode === 'estimate-only');

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaActive = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: { status: 'active', limit: '100' } }));
  const lambdaRetry = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation/retry-queues', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaRegistry = parseBody(await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: { live: 'true', limit: '100' } }));
  check('Lambda activation summary endpoint works', lambdaSummary.version === 'GV-CITY-668J' && lambdaSummary.summary.productionActiveCount === 259);
  check('Lambda activation search endpoint works', lambdaActive.totalMatches === 259 && lambdaActive.count === 100);
  check('Lambda retry-queue endpoint works', lambdaRetry.queues['missing-flight-observations'].count === 112);
  check('Lambda city-registry live filter uses activation', lambdaRegistry.totalMatches === 259 && lambdaRegistry.count === 100);

  const methodDenied = await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('activation endpoint is read-only', methodDenied.statusCode === 405);

  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668J = 'false';
  check('flag-off rollback disables enforcement', activation.enabled() === false && activation.liveRecommendationEligible('durban-za') === true);
  check('flag-off rollback restores provider observation behavior', Boolean(routeGraph._internal.providerObservationRow({ destinationCode: 'PVR' })) === true);
  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668J = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668J',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668J.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
