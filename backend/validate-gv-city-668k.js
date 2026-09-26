'use strict';

const fs = require('fs');
const path = require('path');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668J = 'true';
process.env.ENABLE_CURRENT_500_COMPLETION_AUDIT_668K = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const plan = require('./data/current-500-completion-audit-145-668k.json');
const registry = require('./data/unified-city-registry-1000-668b.json');
const activationSnapshot = require('./data/verified-city-activation-400-668j.json');
const completion = require('./services/admin/audits/current-500-completion-audit');
const activation = require('./services/verified-city-activation');
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
    + (record.group === 'GROUP_1' ? 30 : 0)
    + (record.origin?.internationalAirportSignal === true ? 8 : 0)
    + (record.validation?.requiresProductReview === false ? 8 : 0)
    + agodaMappingScore(record.providers?.agoda?.mappingType)
    + logHotelScore(record.providers?.agoda?.hotelCount)
    - (record.origin?.requiresGatewayTransfer === true ? 3 : 0)
  ).toFixed(3));
}
function compare(a, b) {
  return score(b) - score(a)
    || Number(b.selectionScore || 0) - Number(a.selectionScore || 0)
    || Number(b.providers?.agoda?.hotelCount || 0) - Number(a.providers?.agoda?.hotelCount || 0)
    || clean(a.displayName).localeCompare(clean(b.displayName));
}
function parseBody(response) {
  try { return JSON.parse(response.body || '{}'); } catch (_) { return {}; }
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
  const current500 = (registry.records || []).filter(record => record.selectionTier === 'current-500');
  const remaining = current500.filter(record => !auditedIds.has(record.cityId)).sort(compare);
  const expectedIds = remaining.map(record => record.cityId);
  const regionCounts = records.reduce((acc, record) => {
    acc[record.worldRegion] = (acc[record.worldRegion] || 0) + 1;
    return acc;
  }, {});

  check('plan identifies GV-CITY-668K', plan.version === 'GV-CITY-668K' && plan.taskId === 'GV-CITY-668K');
  check('plan status is Current-500 completion audit', plan.status === 'current-500-completion-audit-plan-ready');
  check('registry contains 1000 cities and 500 Current-500 cities', registry.records.length === 1000 && current500.length === 500);
  check('668J source snapshot contains 400 unique audited cities', activationSnapshot.taskId === 'GV-CITY-668J' && activationSnapshot.records.length === 400 && new Set(activationSnapshot.records.map(record => record.cityId)).size === 400);
  check('668J baseline contains 355 audited Current-500 cities', activationSnapshot.summary.current500.audited === 355);
  check('668J baseline contains 259 production-active cities', activationSnapshot.summary.productionActiveCount === 259);
  check('exactly 145 Current-500 cities remain before 668K', remaining.length === 145);

  check('plan contains exactly 145 cities', records.length === 145 && ids.length === 145);
  check('plan city IDs are unique', new Set(ids).size === 145);
  check('all selected cities are Current-500', records.every(record => record.selectionTier === 'current-500'));
  check('no selected city was already audited in 668J', records.every(record => !auditedIds.has(record.cityId)));
  check('all selected cities resolve in registry', records.every(record => registryById.has(record.cityId)));
  check('all selected cities have both static provider mappings', records.every(record => record.bothProvidersMapped === true));
  check('plan includes every remaining Current-500 city in deterministic order', JSON.stringify(ids) === JSON.stringify(expectedIds));
  check('all plan ranks are contiguous', records.every((record, index) => record.rank === index + 1));
  check('all priority scores match source calculations', records.every(record => record.priorityScore === score(registryById.get(record.cityId))));
  check('355 plus 145 completes 500/500', plan.summary.current500AuditedBeforeRun === 355 && plan.summary.selectedCount === 145 && plan.summary.projectedCurrent500AuditedAfterRun === 500);
  check('post-audit total projection is 545', plan.summary.projectedTotalAuditedAfterRun === 545);
  check('plan includes 141 Group 2 records', records.filter(record => record.group === 'GROUP_2').length === 141 && plan.summary.group2DiscoveryCount === 141);
  check('plan includes four REVIEW_REQUIRED records', records.filter(record => record.group === 'REVIEW_REQUIRED').length === 4 && plan.summary.reviewRequiredCount === 4);
  check('all four REVIEW_REQUIRED cities are present', ['edmonton-ca','moncton-ca','orlando-us','tbilisi-ge'].every(id => ids.includes(id)));
  check('plan contains 42 approved gateway records', records.filter(record => record.requiresGatewayTransfer).length === 42 && plan.summary.gatewayTransferCount === 42);
  check('all gateway records preserve airport data', records.filter(record => record.requiresGatewayTransfer).every(record => record.gateway?.airportCode));
  check('plan contains 25 international-airport signals', plan.summary.internationalAirportSignalCount === 25);
  check('plan contains 70 product-review-required records', plan.summary.productReviewRequiredCount === 70);
  check('region counts are exact', JSON.stringify(regionCounts) === JSON.stringify({ Asia: 9, Americas: 54, Europe: 57, Africa: 9, Other: 16 }), regionCounts);
  check('smoke cities are in the completion list', ['sapporo-jp','orlando-us','kyoto-jp','copenhagen-dk','sharm-el-sheikh-eg'].every(id => ids.includes(id)));
  check('plan explicitly leaves 668J activation unchanged', plan.policy.activationPolicy.includes('do not modify') && plan.policy.activationPolicy.includes('668J'));
  check('plan completion rule explicitly reaches 500/500', plan.policy.completionRule.includes('500/500'));

  const summary = completion.summary();
  const allSearch = completion.search({ limit: 200 });
  const europeSearch = completion.search({ region: 'Europe', limit: 100 });
  const reviewSearch = completion.search({ group: 'REVIEW_REQUIRED', limit: 20 });
  const productReviewSearch = completion.search({ productReviewRequired: 'true', limit: 100 });
  const gatewaySearch = completion.search({ gateway: 'true', limit: 100 });
  const qSearch = completion.search({ q: 'Sapporo', limit: 10 });
  check('668K service version and feature flag are active', completion.VERSION === 'GV-CITY-668K' && completion.enabled() === true);
  check('668K summary reports 145 selected', summary.version === 'GV-CITY-668K' && summary.summary.selectedCount === 145);
  check('668K summary preserves the 668J baseline', summary.activationState.currentVersion === 'GV-CITY-668J' && summary.activationState.auditedCount === 400 && summary.activationState.productionActiveCount === 259 && summary.activationState.current500AuditedCount === 355 && summary.activationState.unchangedUntilAuditImport === true);
  check('668K summary projects 500 Current-500 and 545 total audited', summary.completionProjection.current500AuditedAfterRun === 500 && summary.completionProjection.totalAuditedAfterRun === 545);
  check('668K search returns all 145 records', allSearch.totalMatches === 145 && allSearch.records.length === 145);
  check('668K search filters 57 European cities', europeSearch.totalMatches === 57 && europeSearch.records.every(record => record.worldRegion === 'Europe'));
  check('668K search filters four REVIEW_REQUIRED cities', reviewSearch.totalMatches === 4 && reviewSearch.records.every(record => record.group === 'REVIEW_REQUIRED'));
  check('668K search filters 70 product-review cities', productReviewSearch.totalMatches === 70 && productReviewSearch.records.every(record => record.productReviewRequired === true));
  check('668K search filters 42 gateway candidates', gatewaySearch.totalMatches === 42 && gatewaySearch.records.every(record => record.requiresGatewayTransfer === true));
  check('668K search resolves Sapporo', qSearch.totalMatches === 1 && qSearch.records[0].cityId === 'sapporo-jp');

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/current-500-completion-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaList = parseBody(await lambda.handler({ rawPath: '/api/current-500-completion-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: { limit: '145' } }));
  const lambdaRegion = parseBody(await lambda.handler({ rawPath: '/api/current-500-completion-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: { region: 'Africa', limit: '50' } }));
  const methodDenied = await lambda.handler({ rawPath: '/api/current-500-completion-audit', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('Lambda 668K summary endpoint works', lambdaSummary.version === 'GV-CITY-668K' && lambdaSummary.summary.selectedCount === 145);
  check('Lambda 668K list endpoint returns 145', lambdaList.totalMatches === 145 && lambdaList.records.length === 145);
  check('Lambda 668K region filter returns nine African cities', lambdaRegion.totalMatches === 9);
  check('Lambda 668K endpoint is read-only', methodDenied.statusCode === 405);

  check('668J production activation remains at 259 before import', activation.summary().summary.productionActiveCount === 259);
  check('Sapporo remains unaudited estimate-only before import', activation.activationForCity('sapporo-jp', { includeEvidence: false }).auditStatus === 'unaudited' && activation.activationForCity('sapporo-jp', { includeEvidence: false }).liveRecommendationEligible === false);
  check('existing verified Osaka remains active', activation.activationForCity('osaka-jp', { includeEvidence: false }).liveRecommendationEligible === true);

  const ps = fs.readFileSync(path.join(__dirname, 'Run-GV-CITY-668K-Complete-Current500-Audit.ps1'), 'utf8');
  check('PowerShell runner supports Smoke5, Priority50, and Final145', ['Smoke5','Priority50','Final145'].every(value => ps.includes(value)));
  check('PowerShell runner uses the 668K endpoint and safe URL interpolation', ps.includes('/api/current-500-completion-audit') && ps.includes('"${PlanUrl}?limit=145"'));
  check('PowerShell runner supports checkpoint resume', ps.includes('[switch]$Resume') && ps.includes('CHECKPOINT.json') && ps.includes('Find-LatestCheckpoint'));
  check('PowerShell runner never embeds the admin token', !/GV_PROVIDER_COVERAGE_ADMIN_TOKEN\s*=/.test(ps) && ps.includes("Read-Host 'Admin token' -AsSecureString"));
  check('PowerShell runner uses bounded two-city batches', ps.includes('$ChunkSize = 2'));
  check('PowerShell runner keeps strict 668E audit policy', ps.includes('agodaQualityMaxResult = 30') && ps.includes('maxComfortTransfers = 1') && ps.includes('monthCount = 3'));
  check('PowerShell runner computes projected activation from deployed baseline', ps.includes('$BaselineActive = [int]$PlanSummary.activationState.productionActiveCount') && ps.includes('$ProjectedActive = $BaselineActive + $ProductionActive.Count'));
  check('PowerShell runner records Current-500 completion projection', ps.includes('projectedCurrent500AuditedCount') && ps.includes('current500CompletionExpected = $true'));
  check('PowerShell runner marks activation import as required', ps.includes('activationImportRequired = $true'));

  process.env.ENABLE_CURRENT_500_COMPLETION_AUDIT_668K = 'false';
  check('flag-off disables 668K plan status', completion.enabled() === false && completion.summary().status === 'feature-disabled');
  process.env.ENABLE_CURRENT_500_COMPLETION_AUDIT_668K = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668K',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668K.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
