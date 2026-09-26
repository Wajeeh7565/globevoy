'use strict';

const fs = require('fs');
const path = require('path');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N = 'true';
process.env.ENABLE_EXPANSION_500_PRIORITY_AUDIT_668O = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668P = 'true';
process.env.ENABLE_EXPANSION_500_FINAL_AUDIT_668Q = 'true';
process.env.TRAVELPAYOUTS_TOKEN = 'validation-token-not-production';
process.env.AGODA_SITE_ID = 'validation-site';
process.env.AGODA_API_KEY = 'validation-key-not-production';
process.env.GV_PROVIDER_COVERAGE_ADMIN_TOKEN = 'validation-admin-token';
process.env.GV_PROVIDER_COVERAGE_MAX_BATCH = '10';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const plan = require('./data/expansion-500-final-audit-155-668q.json');
const registry = require('./data/unified-city-registry-1000-668b.json');
const staticAudit = require('./data/provider-mappings-1000-668b.json');
const activationSnapshot = require('./data/verified-city-activation-845-668p.json');
const finalAudit = require('./services/admin/audits/final-expansion-city-audit');
const activation = require('./services/verified-city-activation');
const providerCoverage = require('./services/provider-live-coverage');
const lambda = require('./lambda');

function clean(value) { return String(value || '').trim(); }
function logHotelScore(count) {
  const n = Math.max(0, Number(count || 0));
  return Math.min(20, Math.log10(n + 1) * 5);
}
function agodaMappingScore(type) {
  const value = clean(type).toLowerCase();
  if (['inherited-exact', 'reconfirmed-exact', 'exact-city-country'].includes(value)) return 6;
  if (['inherited-validated', 'alias-city-country', 'fuzzy-city-country'].includes(value)) return 4;
  if (value.includes('coordinate')) return 3;
  if (value.includes('nearby') || value.includes('regional')) return 1;
  return 0;
}
function score(record) {
  return Number((
    Number(record.selectionScore || 0)
    + (record.origin?.internationalAirportSignal === true ? 8 : 0)
    + agodaMappingScore(record.providers?.agoda?.mappingType)
    + logHotelScore(record.providers?.agoda?.hotelCount)
  ).toFixed(3));
}
function compareWithinLane(a, b) {
  return score(b) - score(a)
    || Number(b.selectionScore || 0) - Number(a.selectionScore || 0)
    || Number(b.providers?.agoda?.hotelCount || 0) - Number(a.providers?.agoda?.hotelCount || 0)
    || clean(a.displayName).localeCompare(clean(b.displayName));
}
function compare(a, b) {
  const laneA = a.validation?.bothProvidersMapped === true ? 0 : 1;
  const laneB = b.validation?.bothProvidersMapped === true ? 0 : 1;
  return laneA - laneB || compareWithinLane(a, b);
}
function parseBody(response) {
  try { return JSON.parse(response.body || '{}'); } catch (_) { return {}; }
}
function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}
function flightRow({ price = 210, duration = 300, transfers = 0, date = '2026-10-18' } = {}) {
  return {
    departure_at: `${date}T10:00:00Z`, return_at: `${date}T15:00:00Z`, price,
    airline: 'XX', flight_number: '101', transfers, duration, link: '/search/validation'
  };
}
function goodHotel() {
  return {
    hotelId: 9001,
    hotelName: 'Validation Grand Hotel',
    dailyRate: 120,
    currency: 'CAD',
    landingURL: 'https://www.agoda.com/partners/partnersearch.aspx?hid=9001',
    reviewScore: 8.7,
    starRating: 4,
    reviewCount: 250
  };
}

(async () => {
  const checks = [];
  function check(name, pass, details = undefined) {
    checks.push({ name, pass: Boolean(pass), ...(details === undefined ? {} : { details }) });
    if (!pass) console.error('FAIL', name, details);
  }

  const records = plan.records || [];
  const ids = records.map(record => record.cityId);
  const auditedIds = new Set((activationSnapshot.records || []).map(record => record.cityId));
  const registryById = new Map((registry.records || []).map(record => [record.cityId, record]));
  const staticById = new Map((staticAudit.records || []).map(record => [record.cityId, record]));
  const expansion = (registry.records || []).filter(record => record.selectionTier === 'expansion-500');
  const remaining = expansion.filter(record => !auditedIds.has(record.cityId)).sort(compare);
  const expectedIds = remaining.map(record => record.cityId);
  const fullyMapped = records.filter(record => record.bothProvidersMapped === true);
  const unresolved = records.filter(record => record.agodaMappingAccepted !== true);
  const regionCounts = records.reduce((acc, record) => {
    acc[record.worldRegion] = (acc[record.worldRegion] || 0) + 1;
    return acc;
  }, {});
  const laneCounts = records.reduce((acc, record) => {
    acc[record.auditLane] = (acc[record.auditLane] || 0) + 1;
    return acc;
  }, {});
  const statusCounts = records.reduce((acc, record) => {
    acc[record.agodaMappingStatus] = (acc[record.agodaMappingStatus] || 0) + 1;
    return acc;
  }, {});
  const smokeIds = ['ndjamena-td', 'alor-setar-my', 'liege-be', 'moscow-ru', 'monrovia-lr'];

  check('plan identifies GV-CITY-668Q', plan.version === 'GV-CITY-668Q' && plan.taskId === 'GV-CITY-668Q');
  check('plan status is final 155 coverage audit', plan.status === 'final-155-expansion-coverage-audit-plan-ready');
  check('registry contains 1000 cities and 500 Expansion-500 cities', registry.records.length === 1000 && expansion.length === 500);
  check('668P source snapshot contains 845 unique audited cities', activationSnapshot.taskId === 'GV-CITY-668P' && activationSnapshot.records.length === 845 && new Set(activationSnapshot.records.map(record => record.cityId)).size === 845);
  check('668P source snapshot contains 420 active cities', activationSnapshot.summary.productionActiveCount === 420);
  check('668P baseline contains 345 audited expansion cities', activationSnapshot.summary.expansion500.audited === 345);
  check('exactly 155 expansion cities remain unaudited', remaining.length === 155);
  check('plan contains exactly 155 cities', records.length === 155 && ids.length === 155);
  check('plan city IDs are unique', new Set(ids).size === 155);
  check('all selected cities are Expansion-500', records.every(record => record.selectionTier === 'expansion-500'));
  check('no selected city was already audited in 668P', records.every(record => !auditedIds.has(record.cityId)));
  check('all selected cities resolve in registry and static audit', records.every(record => registryById.has(record.cityId) && staticById.has(record.cityId)));
  check('all final cities retain accepted Travelpayouts mappings', records.every(record => record.travelpayoutsMappingAccepted === true));
  check('all final cities remain product-review targets', records.every(record => record.productReviewRequired === true));
  check('final wave contains 50 fully mapped cities', fullyMapped.length === 50);
  check('final wave contains 105 Agoda-unresolved cities', unresolved.length === 105);
  check('fully mapped lane comes before unresolved lane', records.slice(0, 50).every(record => record.auditLane === 'fully-mapped-final-50') && records.slice(50).every(record => record.auditLane === 'agoda-unresolved-final-105'));
  check('selected city order matches deterministic final-wave ordering', JSON.stringify(ids) === JSON.stringify(expectedIds));
  check('all plan ranks are contiguous', records.every((record, index) => record.rank === index + 1));
  check('all priority scores match source calculations', records.every(record => record.priorityScore === score(registryById.get(record.cityId))));
  check('boundary IDs are stable', ids[0] === 'ndjamena-td' && ids[49] === 'balboa-pa' && ids[50] === 'moscow-ru');
  check('all Smoke5 cities are present in the plan', smokeIds.every(id => ids.includes(id)));
  check('Smoke5 spans both audit lanes', smokeIds.filter(id => fullyMapped.some(record => record.cityId === id)).length === 3 && smokeIds.filter(id => unresolved.some(record => record.cityId === id)).length === 2);
  check('region distribution is exact', JSON.stringify(regionCounts) === JSON.stringify({ Africa: 44, Asia: 42, Europe: 17, Oceania: 24, Americas: 16, Other: 12 }), regionCounts);
  check('audit lane distribution is exact', JSON.stringify(laneCounts) === JSON.stringify({ 'fully-mapped-final-50': 50, 'agoda-unresolved-final-105': 105 }), laneCounts);
  check('Agoda unresolved status distribution is exact', statusCounts['unresolved-country-absent-from-feed'] === 34 && statusCounts['unresolved-no-safe-market'] === 71, statusCounts);
  check('plan summary baseline counts are exact', plan.summary.expansionAuditedBeforeRun === 345 && plan.summary.expansionActiveBeforeRun === 111 && plan.summary.remainingExpansionBeforeRun === 155);
  check('plan summary lane counts are exact', plan.summary.fullyMappedFinalCount === 50 && plan.summary.agodaUnresolvedFinalCount === 105 && plan.summary.travelpayoutsMappedCount === 155);
  check('plan projects 500 Expansion-500 audited', plan.summary.projectedExpansionAuditedAfterRun === 500);
  check('plan projects 1000 total audited and zero remaining', plan.summary.projectedTotalAuditedAfterRun === 1000 && plan.summary.projectedRemainingUnauditedAfterRun === 0);
  check('plan reports 42 international-airport signals', plan.summary.internationalAirportSignalCount === 42);
  check('plan reports no preapproved gateway transfers', plan.summary.gatewayTransferCount === 0);
  check('priority score range is exact', plan.summary.maximumPriorityScore === 144 && plan.summary.minimumPriorityScore === 88);
  check('unresolved plan records never invent Agoda IDs', unresolved.every(record => record.agodaCityId === null && record.agodaMappingType === 'unresolved'));

  const serviceSummary = finalAudit.summary();
  const serviceList = finalAudit.search({ limit: 155 });
  const serviceMapped = finalAudit.search({ fullyMapped: 'true', limit: 155 });
  const serviceUnresolved = finalAudit.search({ agodaResolved: 'false', limit: 155 });
  const serviceAfrica = finalAudit.search({ region: 'Africa', limit: 155 });
  const serviceMoscow = finalAudit.search({ q: 'Moscow', limit: 10 });
  const serviceLane = finalAudit.search({ lane: 'fully-mapped-final-50', limit: 100 });
  check('final audit service is enabled and versioned', finalAudit.VERSION === 'GV-CITY-668Q' && finalAudit.enabled() === true && serviceSummary.enabled === true);
  check('service summary preserves 668P activation baseline', serviceSummary.activationState.currentVersion === 'GV-CITY-668P' && serviceSummary.activationState.auditedCount === 845 && serviceSummary.activationState.productionActiveCount === 420);
  check('service projection reports complete audit coverage', serviceSummary.auditProjection.expansion500AuditedAfterRun === 500 && serviceSummary.auditProjection.totalAuditedAfterRun === 1000 && serviceSummary.auditProjection.remainingUnauditedAfterRun === 0);
  check('service list returns all 155 plan rows', serviceList.totalMatches === 155 && serviceList.records.length === 155);
  check('service fully mapped filter returns 50', serviceMapped.totalMatches === 50 && serviceMapped.records.length === 50);
  check('service unresolved Agoda filter returns 105', serviceUnresolved.totalMatches === 105 && serviceUnresolved.records.length === 105);
  check('service Africa filter returns 44', serviceAfrica.totalMatches === 44 && serviceAfrica.records.length === 44);
  check('service text search resolves Moscow', serviceMoscow.totalMatches === 1 && serviceMoscow.records[0]?.cityId === 'moscow-ru');
  check('service lane filter returns final mapped 50', serviceLane.totalMatches === 50);

  const activationSummary = activation.summary();
  const moscowActivation = activation.activationForCity('moscow-ru');
  const ndjamenaActivation = activation.activationForCity('ndjamena-td');
  check('668P activation remains current baseline', activation.VERSION === 'GV-CITY-668P' && activationSummary.summary.auditedCount === 845 && activationSummary.summary.productionActiveCount === 420);
  check('Moscow remains unaudited before 668Q import', moscowActivation.auditStatus === 'unaudited' && moscowActivation.liveRecommendationEligible === false);
  check('Ndjamena remains unaudited before 668Q import', ndjamenaActivation.auditStatus === 'unaudited' && ndjamenaActivation.liveRecommendationEligible === false);

  const seen = { travel: 0, agoda: 0 };
  async function injectedFetch(url, options = {}) {
    if (String(url).includes('api.travelpayouts.com')) {
      seen.travel += 1;
      return response({ data: [flightRow()] });
    }
    seen.agoda += 1;
    return response({ results: [goodHotel()] });
  }
  const mappedProbe = await providerCoverage.verifyCityCoverage('ndjamena-td', {
    months: ['2026-10'], checkIns: ['2026-10-18'], anchorOrigins: ['CAI'], adults: 2, rooms: 1,
    agodaQualityStrategyCount: 1, agodaQualityMaxResult: 10
  }, { _fetchFn: injectedFetch });
  const agodaBeforeUnresolved = seen.agoda;
  const unresolvedProbe = await providerCoverage.verifyCityCoverage('moscow-ru', {
    months: ['2026-10'], checkIns: ['2026-10-18'], anchorOrigins: ['LON'], adults: 2, rooms: 1,
    agodaQualityStrategyCount: 1, agodaQualityMaxResult: 10
  }, { _fetchFn: injectedFetch });
  check('fully mapped final city can exercise both provider paths', mappedProbe.classification === 'live-both' && mappedProbe.staticMapping.travelpayouts.mappingAccepted === true && mappedProbe.staticMapping.agoda.mappingAccepted === true, mappedProbe.classification);
  check('injected mapped evidence cannot activate production', mappedProbe.productionActivation.eligible === false && mappedProbe.providerCoverage.eligible === false);
  check('Agoda-unresolved final city still audits flight evidence', unresolvedProbe.classification === 'live-flights-only' && unresolvedProbe.live.travelpayouts.status === 'live');
  check('Agoda-unresolved final city remains inactive', unresolvedProbe.productionActivation.eligible === false && unresolvedProbe.live.agoda.status === 'unresolved-static-mapping');
  check('unresolved Agoda mapping does not call Agoda provider', seen.agoda === agodaBeforeUnresolved);

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-final-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaList = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-final-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: { limit: '155' } }));
  const lambdaUnresolved = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-final-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: { agodaResolved: 'false', limit: '155' } }));
  const lambdaActivation = parseBody(await lambda.handler({ rawPath: '/api/verified-city-activation', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaWave2 = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit-wave2', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const methodDenied = await lambda.handler({ rawPath: '/api/expansion-500-final-audit', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('Lambda 668Q summary endpoint works', lambdaSummary.version === 'GV-CITY-668Q' && lambdaSummary.summary.selectedCount === 155);
  check('Lambda 668Q list endpoint returns 155', lambdaList.totalMatches === 155 && lambdaList.records.length === 155);
  check('Lambda 668Q unresolved filter returns 105', lambdaUnresolved.totalMatches === 105 && lambdaUnresolved.records.length === 105);
  check('Lambda activation endpoint remains on 668P', lambdaActivation.version === 'GV-CITY-668P' && lambdaActivation.summary.productionActiveCount === 420);
  check('668O Wave 2 endpoint remains preserved', lambdaWave2.version === 'GV-CITY-668O' && lambdaWave2.summary.selectedCount === 150);
  check('668Q plan endpoint is read-only', methodDenied.statusCode === 405);

  const runner = fs.readFileSync(path.join(__dirname, 'Run-GV-CITY-668Q-Final155-Coverage-Audit.ps1'), 'utf8');
  check('runner supports Smoke5 and Final155 modes', runner.includes("[ValidateSet('Smoke5', 'Final155')]") && runner.includes("$Mode = 'Smoke5'"));
  check('runner uses the 668Q final plan endpoint', runner.includes('/api/expansion-500-final-audit'));
  check('runner uses the protected provider verifier', runner.includes('/api/provider-live-coverage/verify') && runner.includes('x-gv-admin-token'));
  check('runner masks and does not persist the audit token', runner.includes("Read-Host 'Admin token' -AsSecureString") && !runner.includes('Set-Content -Path $PlainToken'));
  check('runner projects 1000 audited and zero remaining', runner.includes('Projected total audited after this run') && runner.includes('Projected remaining unaudited'));
  check('runner supports resumable checkpoints', runner.includes('[switch]$Resume') && runner.includes('CHECKPOINT.json') && runner.includes('-Resume -RunId'));
  check('runner exports all, active, review and live-result files', ['-ALL.csv','-PRODUCTION-ACTIVE.csv','-REVIEW.csv','-LIVE-RESULTS.json'].every(value => runner.includes(value)));
  check('runner includes the exact five smoke cities', smokeIds.every(id => runner.includes(`'${id}'`)));

  process.env.ENABLE_EXPANSION_500_FINAL_AUDIT_668Q = 'false';
  check('668Q flag-off disables only the plan service', finalAudit.enabled() === false && finalAudit.summary().status === 'feature-disabled');
  check('668Q flag-off does not change 668P activation', activation.summary().summary.productionActiveCount === 420);
  process.env.ENABLE_EXPANSION_500_FINAL_AUDIT_668Q = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668Q',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668Q.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
