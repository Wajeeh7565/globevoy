'use strict';

const fs = require('fs');
const path = require('path');

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668L = 'true';
process.env.ENABLE_EXPANSION_500_PRIORITY_AUDIT_668M = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N = 'true';
process.env.ENABLE_EXPANSION_500_PRIORITY_AUDIT_668O = 'true';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const plan = require('./data/expansion-500-priority-audit-150-668o.json');
const registry = require('./data/unified-city-registry-1000-668b.json');
const activationSnapshot = require('./data/verified-city-activation-695-668n.json');
const wave2 = require('./services/admin/audits/expansion-priority-city-audit-wave2');
const activation = require('./services/cities/registry/verified-city-activation');
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
  const expansion = (registry.records || []).filter(record => record.selectionTier === 'expansion-500');
  const remaining = expansion.filter(record => !auditedIds.has(record.cityId));
  const candidates = remaining.filter(record => record.validation?.bothProvidersMapped === true).sort(compare);
  const expectedIds = candidates.slice(0, 150).map(record => record.cityId);
  const regionCounts = records.reduce((acc, record) => {
    acc[record.worldRegion] = (acc[record.worldRegion] || 0) + 1;
    return acc;
  }, {});
  const mappingCounts = records.reduce((acc, record) => {
    const key = record.agodaMappingType || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const smokeIds = ['bhubaneswar-in', 'belem-br', 'belgrade-rs', 'yaounde-cm', 'noumea-nc'];

  check('plan identifies GV-CITY-668O', plan.version === 'GV-CITY-668O' && plan.taskId === 'GV-CITY-668O');
  check('plan status is Expansion-500 priority wave 2', plan.status === 'expansion-500-priority-audit-wave-2-plan-ready');
  check('registry contains 1000 cities and 500 Expansion-500 cities', registry.records.length === 1000 && expansion.length === 500);
  check('668N source snapshot contains 695 unique audited cities', activationSnapshot.taskId === 'GV-CITY-668N' && activationSnapshot.records.length === 695 && new Set(activationSnapshot.records.map(record => record.cityId)).size === 695);
  check('668N source snapshot contains 393 active cities', activationSnapshot.summary.productionActiveCount === 393);
  check('668N baseline contains 195 audited expansion cities', activationSnapshot.summary.expansion500.audited === 195);
  check('305 expansion cities remain unaudited before 668O', remaining.length === 305);
  check('candidate pool contains 200 cities with both mappings', candidates.length === 200);
  check('plan contains exactly 150 cities', records.length === 150 && ids.length === 150);
  check('plan city IDs are unique', new Set(ids).size === 150);
  check('all selected cities are Expansion-500', records.every(record => record.selectionTier === 'expansion-500'));
  check('no selected city was already audited in 668N', records.every(record => !auditedIds.has(record.cityId)));
  check('all selected cities resolve in registry', records.every(record => registryById.has(record.cityId)));
  check('all selected cities have both static provider mappings', records.every(record => record.bothProvidersMapped === true));
  check('all selected cities are product-review targets', records.every(record => record.productReviewRequired === true));
  check('selected city order matches global deterministic score', JSON.stringify(ids) === JSON.stringify(expectedIds));
  check('all plan ranks are contiguous', records.every((record, index) => record.rank === index + 1));
  check('all priority scores match source calculations', records.every(record => record.priorityScore === score(registryById.get(record.cityId))));
  check('plan summary counts are exact', plan.summary.expansionRegistryCount === 500 && plan.summary.expansionAuditedBeforeRun === 195 && plan.summary.remainingExpansionBeforeRun === 305 && plan.summary.candidatePoolCount === 200 && plan.summary.selectedCount === 150 && plan.summary.notSelectedCandidateCount === 50 && plan.summary.staticallyIncompleteRemainingCount === 105);
  check('plan projects 345 Expansion-500 audited', plan.summary.projectedExpansionAuditedAfterRun === 345);
  check('plan projects 845 total audited and 155 remaining', plan.summary.projectedTotalAuditedAfterRun === 845 && plan.summary.projectedRemainingUnauditedAfterRun === 155);
  check('plan reports 63 international-airport signals', plan.summary.internationalAirportSignalCount === 63);
  check('plan reports no preapproved gateway transfers', plan.summary.gatewayTransferCount === 0);
  check('region distribution is exact', JSON.stringify(regionCounts) === JSON.stringify({ Asia: 58, Africa: 26, Americas: 37, Europe: 22, Oceania: 7 }), regionCounts);
  check('mapping distribution is exact', JSON.stringify(mappingCounts) === JSON.stringify({ 'exact-city-country': 115, 'alias-city-country': 7, 'coordinate-confirmed-market': 21, 'fuzzy-city-country': 6, 'explicit-nearby-or-regional-market': 1 }), mappingCounts);
  check('priority score range is exact', plan.summary.maximumPriorityScore === 134.798 && plan.summary.minimumPriorityScore === 101.955);
  check('all Smoke5 cities are in the selected plan', smokeIds.every(id => ids.includes(id)));

  const serviceSummary = wave2.summary();
  const serviceList = wave2.search({ limit: 150 });
  const serviceAfrica = wave2.search({ region: 'Africa', limit: 100 });
  const serviceAirport = wave2.search({ internationalAirport: 'true', limit: 100 });
  const serviceBelgrade = wave2.search({ q: 'Belgrade', limit: 10 });
  check('wave 2 service is enabled and versioned', wave2.VERSION === 'GV-CITY-668O' && wave2.enabled() === true && serviceSummary.enabled === true);
  check('service summary preserves 668N activation baseline', serviceSummary.activationState.currentVersion === 'GV-CITY-668N' && serviceSummary.activationState.auditedCount === 695 && serviceSummary.activationState.productionActiveCount === 393);
  check('service projection reports 345 expansion and 845 total audited', serviceSummary.auditProjection.expansion500AuditedAfterRun === 345 && serviceSummary.auditProjection.totalAuditedAfterRun === 845 && serviceSummary.auditProjection.remainingUnauditedAfterRun === 155);
  check('service list returns all 150 plan rows', serviceList.totalMatches === 150 && serviceList.records.length === 150);
  check('service region filter returns 26 African cities', serviceAfrica.totalMatches === 26);
  check('service airport filter returns 63 cities', serviceAirport.totalMatches === 63 && serviceAirport.records.length === 63);
  check('service text search resolves Belgrade', serviceBelgrade.totalMatches === 1 && serviceBelgrade.records[0]?.cityId === 'belgrade-rs');

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit-wave2', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaList = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit-wave2', requestContext: { http: { method: 'GET' } }, queryStringParameters: { limit: '150' } }));
  const lambdaAsia = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit-wave2', requestContext: { http: { method: 'GET' } }, queryStringParameters: { region: 'Asia', limit: '100' } }));
  const oldWave = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const methodDenied = await lambda.handler({ rawPath: '/api/expansion-500-priority-audit-wave2', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('Lambda 668O summary endpoint works', lambdaSummary.version === 'GV-CITY-668O' && lambdaSummary.summary.selectedCount === 150);
  check('Lambda 668O list endpoint returns 150', lambdaList.totalMatches === 150 && lambdaList.records.length === 150);
  check('Lambda 668O region filter returns 58 Asian cities', lambdaAsia.totalMatches === 58);
  check('Lambda 668O endpoint is read-only', methodDenied.statusCode === 405);
  check('668M endpoint remains preserved', oldWave.version === 'GV-CITY-668M' && oldWave.summary?.selectedCount === 150);

  check('668N production activation remains at 393 before import', activation.summary().summary.productionActiveCount === 393 && activation.summary().summary.auditedCount === 695);
  check('selected Bhubaneswar remains unaudited before import', activation.activationForCity('bhubaneswar-in', { includeEvidence: false }).auditStatus === 'unaudited' && activation.activationForCity('bhubaneswar-in', { includeEvidence: false }).liveRecommendationEligible === false);
  check('selected Belgrade remains unaudited before import', activation.activationForCity('belgrade-rs', { includeEvidence: false }).auditStatus === 'unaudited');
  check('existing verified Baku remains active', activation.activationForCity('baku-az', { includeEvidence: false }).liveRecommendationEligible === true);

  const ps = fs.readFileSync(path.join(__dirname, 'Run-GV-CITY-668O-Expansion500-Priority-Audit.ps1'), 'utf8');
  check('PowerShell runner supports Smoke5, Priority50, and Expansion150', ['Smoke5','Priority50','Expansion150'].every(value => ps.includes(value)));
  check('PowerShell runner uses the 668O endpoint and safe URL interpolation', ps.includes('/api/expansion-500-priority-audit-wave2') && ps.includes('"${PlanUrl}?limit=150"'));
  check('PowerShell runner supports checkpoint resume', ps.includes('[switch]$Resume') && ps.includes('CHECKPOINT.json') && ps.includes('Find-LatestCheckpoint'));
  check('PowerShell runner never embeds the admin token', !/GV_PROVIDER_COVERAGE_ADMIN_TOKEN\s*=/.test(ps) && ps.includes("Read-Host 'Admin token' -AsSecureString"));
  check('PowerShell runner uses bounded two-city batches', ps.includes('$ChunkSize = 2'));
  check('PowerShell runner keeps strict 668E audit policy', ps.includes('agodaQualityMaxResult = 30') && ps.includes('maxComfortTransfers = 1') && ps.includes('monthCount = 3'));
  check('PowerShell runner computes projected activation from deployed baseline', ps.includes('$BaselineActive = [int]$PlanSummary.activationState.productionActiveCount') && ps.includes('$ProjectedActive = $BaselineActive + $ProductionActive.Count'));
  check('PowerShell runner marks wave 2 and activation import required', ps.includes('expansionWave = 2') && ps.includes('activationImportRequired = $true'));
  check('PowerShell Smoke5 list is the approved five-city sample', smokeIds.every(id => ps.includes(`'${id}'`)));

  process.env.ENABLE_EXPANSION_500_PRIORITY_AUDIT_668O = 'false';
  check('flag-off disables 668O plan status', wave2.enabled() === false && wave2.summary().status === 'feature-disabled');
  process.env.ENABLE_EXPANSION_500_PRIORITY_AUDIT_668O = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668O',
    generatedAt: new Date().toISOString(),
    summary: {
      selectedCount: records.length,
      candidatePoolCount: candidates.length,
      projectedExpansion500AuditedCount: 345,
      projectedTotalAuditedCount: 845,
      projectedRemainingUnauditedCount: 155,
      regionCounts,
      internationalAirportSignalCount: 63
    },
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668O.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length, summary: result.summary }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
