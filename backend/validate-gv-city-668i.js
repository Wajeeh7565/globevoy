'use strict';

const fs = require('fs');
const path = require('path');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668H = 'true';
process.env.ENABLE_REMAINING_CURRENT_500_AUDIT_668I = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const plan = require('./data/remaining-current-500-audit-150-668i.json');
const registry = require('./data/unified-city-registry-1000-668b.json');
const activationSnapshot = require('./data/verified-city-activation-250-668h.json');
const priority = require('./services/remaining-current-city-audit');
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
  const remaining = current500.filter(record => !auditedIds.has(record.cityId));
  const candidates = remaining.filter(record => record.validation?.bothProvidersMapped === true && record.group !== 'REVIEW_REQUIRED');
  const expectedRegions = { Americas: 60, Europe: 45, Asia: 25, Africa: 10, Oceania: 5, Other: 5 };
  const regionCounts = Object.fromEntries(Object.keys(expectedRegions).map(region => [region, records.filter(record => record.worldRegion === region).length]));
  const expectedIds = [];
  for (const [region, target] of Object.entries(expectedRegions)) {
    expectedIds.push(...candidates.filter(record => record.worldRegion === region).sort(compare).slice(0, target).map(record => record.cityId));
  }
  expectedIds.sort((a, b) => compare(registryById.get(a), registryById.get(b)));

  check('plan identifies GV-CITY-668I', plan.version === 'GV-CITY-668I' && plan.taskId === 'GV-CITY-668I');
  check('plan status is remaining Current-500 priority audit', plan.status === 'remaining-current-500-priority-audit-plan-ready');
  check('registry contains 1000 cities and 500 Current-500 cities', registry.records.length === 1000 && current500.length === 500);
  check('668H source snapshot contains 250 audited cities', activationSnapshot.taskId === 'GV-CITY-668H' && activationSnapshot.records.length === 250 && new Set(activationSnapshot.records.map(record => record.cityId)).size === 250);
  check('668H baseline contains 205 audited Current-500 cities', activationSnapshot.summary.current500.audited === 205);
  check('295 Current-500 cities remain unaudited before 668I', remaining.length === 295);
  check('four remaining cities are REVIEW_REQUIRED and excluded', remaining.filter(record => record.group === 'REVIEW_REQUIRED').length === 4);
  check('candidate pool contains 291 mapped non-review cities', candidates.length === 291);

  check('plan contains exactly 150 cities', records.length === 150 && ids.length === 150);
  check('plan city IDs are unique', new Set(ids).size === 150);
  check('all selected cities are Current-500', records.every(record => record.selectionTier === 'current-500'));
  check('no selected city was already audited in 668H', records.every(record => !auditedIds.has(record.cityId)));
  check('all selected cities resolve in registry', records.every(record => registryById.has(record.cityId)));
  check('all selected cities have both static provider mappings', records.every(record => record.bothProvidersMapped === true));
  check('all selected cities are Group 2 discoveries', records.every(record => record.group === 'GROUP_2'));
  check('region quotas match the 668I balanced plan', JSON.stringify(regionCounts) === JSON.stringify(expectedRegions), regionCounts);
  check('selected city set matches deterministic top-per-region scoring', JSON.stringify(ids) === JSON.stringify(expectedIds));
  check('all plan ranks are contiguous', records.every((record, index) => record.rank === index + 1));
  check('all priority scores match source-record calculations', records.every(record => record.priorityScore === score(registryById.get(record.cityId))));
  check('plan summary counts are exact', plan.summary.current500RegistryCount === 500 && plan.summary.current500AuditedBeforeRun === 205 && plan.summary.remainingCurrent500BeforeRun === 295 && plan.summary.candidatePoolCount === 291 && plan.summary.selectedCount === 150);
  check('plan summary reports 83 international-airport signals', plan.summary.internationalAirportSignalCount === 83);
  check('plan summary reports 61 product-review items', plan.summary.productReviewRequiredCount === 61);
  check('plan summary reports four approved gateway candidates', plan.summary.gatewayTransferCount === 4);
  check('all four gateway candidates preserve gateway data', records.filter(record => record.requiresGatewayTransfer).length === 4 && records.filter(record => record.requiresGatewayTransfer).every(record => record.gateway?.airportCode));
  check('smoke cities are in the 668I priority list', ['philadelphia-us','bologna-it','da-nang-vn','durban-za','melbourne-au'].every(id => ids.includes(id)));
  check('activation baseline is pinned to 250 audited and 176 active', plan.source.auditedCityCountBeforeRun === 250 && plan.source.productionActiveCountBeforeRun === 176);
  check('plan explicitly leaves 668H activation unchanged', plan.policy.activationPolicy.includes('do not modify') && plan.policy.activationPolicy.includes('668H'));

  const summary = priority.summary();
  const allSearch = priority.search({ limit: 200 });
  const europeSearch = priority.search({ region: 'Europe', limit: 100 });
  const productReviewSearch = priority.search({ productReviewRequired: 'true', limit: 100 });
  const gatewaySearch = priority.search({ gateway: 'true', limit: 20 });
  const qSearch = priority.search({ q: 'Philadelphia', limit: 10 });
  check('668I service version and feature flag are active', priority.VERSION === 'GV-CITY-668I' && priority.enabled() === true);
  check('668I summary reports 150 selected', summary.version === 'GV-CITY-668I' && summary.summary.selectedCount === 150);
  check('668I summary preserves the 668H baseline', summary.activationState.currentVersion === 'GV-CITY-668H' && summary.activationState.auditedCount === 250 && summary.activationState.productionActiveCount === 176 && summary.activationState.unchangedUntilAuditImport === true);
  check('668I search returns all 150 records', allSearch.totalMatches === 150 && allSearch.records.length === 150);
  check('668I search filters 45 European cities', europeSearch.totalMatches === 45 && europeSearch.records.every(record => record.worldRegion === 'Europe'));
  check('668I search filters 61 product-review cities', productReviewSearch.totalMatches === 61 && productReviewSearch.records.every(record => record.productReviewRequired === true));
  check('668I search filters four gateway candidates', gatewaySearch.totalMatches === 4 && gatewaySearch.records.every(record => record.requiresGatewayTransfer === true));
  check('668I search resolves Philadelphia', qSearch.totalMatches === 1 && qSearch.records[0].cityId === 'philadelphia-us');

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/remaining-current-city-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaList = parseBody(await lambda.handler({ rawPath: '/api/remaining-current-city-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: { limit: '150' } }));
  const lambdaRegion = parseBody(await lambda.handler({ rawPath: '/api/remaining-current-city-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: { region: 'Africa', limit: '50' } }));
  const methodDenied = await lambda.handler({ rawPath: '/api/remaining-current-city-audit', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('Lambda 668I summary endpoint works', lambdaSummary.version === 'GV-CITY-668I' && lambdaSummary.summary.selectedCount === 150);
  check('Lambda 668I list endpoint returns 150', lambdaList.totalMatches === 150 && lambdaList.records.length === 150);
  check('Lambda 668I region filter returns ten African cities', lambdaRegion.totalMatches === 10);
  check('Lambda 668I endpoint is read-only', methodDenied.statusCode === 405);

  check('668H production activation remains at 176 before import', activation.summary().summary.productionActiveCount === 176);
  check('Philadelphia remains unaudited estimate-only before import', activation.activationForCity('philadelphia-us', { includeEvidence: false }).auditStatus === 'unaudited' && activation.activationForCity('philadelphia-us', { includeEvidence: false }).liveRecommendationEligible === false);
  check('existing verified Osaka remains active', activation.activationForCity('osaka-jp', { includeEvidence: false }).liveRecommendationEligible === true);

  const ps = fs.readFileSync(path.join(__dirname, 'Run-GV-CITY-668I-Remaining-Current500-Audit.ps1'), 'utf8');
  check('PowerShell runner supports Smoke5, Priority50, and Remaining150', ['Smoke5','Priority50','Remaining150'].every(value => ps.includes(value)));
  check('PowerShell runner uses the 668I endpoint and fixed URL interpolation', ps.includes('/api/remaining-current-city-audit') && ps.includes('"${PlanUrl}?limit=150"'));
  check('PowerShell runner supports checkpoint resume', ps.includes('[switch]$Resume') && ps.includes('CHECKPOINT.json') && ps.includes('Find-LatestCheckpoint'));
  check('PowerShell runner never embeds the admin token', !/GV_PROVIDER_COVERAGE_ADMIN_TOKEN\s*=/.test(ps) && ps.includes("Read-Host 'Admin token' -AsSecureString"));
  check('PowerShell runner uses bounded two-city batches', ps.includes('$ChunkSize = 2'));
  check('PowerShell runner keeps strict 668E audit policy', ps.includes('agodaQualityMaxResult = 30') && ps.includes('maxComfortTransfers = 1') && ps.includes('monthCount = 3'));
  check('PowerShell runner computes projected activation from deployed baseline', ps.includes('$BaselineActive = [int]$PlanSummary.activationState.productionActiveCount') && ps.includes('$ProjectedActive = $BaselineActive + $ProductionActive.Count'));
  check('PowerShell runner marks activation import as required', ps.includes('activationImportRequired = $true'));

  process.env.ENABLE_REMAINING_CURRENT_500_AUDIT_668I = 'false';
  check('flag-off disables 668I plan status', priority.enabled() === false && priority.summary().status === 'feature-disabled');
  process.env.ENABLE_REMAINING_CURRENT_500_AUDIT_668I = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668I',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668I.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
