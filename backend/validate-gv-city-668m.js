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
process.env.GLOBEVOY_USE_MOCKS = 'false';

const plan = require('./data/expansion-500-priority-audit-150-668m.json');
const registry = require('./data/unified-city-registry-1000-668b.json');
const activationSnapshot = require('./data/verified-city-activation-545-668l.json');
const priority = require('./services/admin/audits/expansion-priority-city-audit');
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
  const candidates = remaining.filter(record => record.validation?.bothProvidersMapped === true);
  const expectedRegions = { Asia: 45, Americas: 35, Europe: 25, Africa: 20, Oceania: 15, Other: 10 };
  const regionCounts = Object.fromEntries(Object.keys(expectedRegions).map(region => [region, records.filter(record => record.worldRegion === region).length]));
  const expectedIds = [];
  for (const [region, target] of Object.entries(expectedRegions)) {
    expectedIds.push(...candidates.filter(record => record.worldRegion === region).sort(compare).slice(0, target).map(record => record.cityId));
  }
  expectedIds.sort((a, b) => compare(registryById.get(a), registryById.get(b)));

  check('plan identifies GV-CITY-668M', plan.version === 'GV-CITY-668M' && plan.taskId === 'GV-CITY-668M');
  check('plan status is Expansion-500 priority wave 1', plan.status === 'expansion-500-priority-audit-wave-1-plan-ready');
  check('registry contains 1000 cities and 500 Expansion-500 cities', registry.records.length === 1000 && expansion.length === 500);
  check('668L source snapshot contains 545 audited cities', activationSnapshot.taskId === 'GV-CITY-668L' && activationSnapshot.records.length === 545 && new Set(activationSnapshot.records.map(record => record.cityId)).size === 545);
  check('668L baseline contains 45 audited expansion cities', activationSnapshot.summary.expansion500.audited === 45);
  check('455 expansion cities remain unaudited before 668M', remaining.length === 455);
  check('candidate pool contains 350 cities with both mappings', candidates.length === 350);
  check('plan contains exactly 150 cities', records.length === 150 && ids.length === 150);
  check('plan city IDs are unique', new Set(ids).size === 150);
  check('all selected cities are Expansion-500', records.every(record => record.selectionTier === 'expansion-500'));
  check('no selected city was already audited in 668L', records.every(record => !auditedIds.has(record.cityId)));
  check('all selected cities resolve in registry', records.every(record => registryById.has(record.cityId)));
  check('all selected cities have both static provider mappings', records.every(record => record.bothProvidersMapped === true));
  check('all selected cities are product-review targets', records.every(record => record.productReviewRequired === true));
  check('region quotas match the 668M plan', JSON.stringify(regionCounts) === JSON.stringify(expectedRegions), regionCounts);
  check('selected city set matches deterministic top-per-region scoring', JSON.stringify(ids) === JSON.stringify(expectedIds));
  check('all plan ranks are contiguous', records.every((record, index) => record.rank === index + 1));
  check('all priority scores match source calculations', records.every(record => record.priorityScore === score(registryById.get(record.cityId))));
  check('plan summary counts are exact', plan.summary.expansionRegistryCount === 500 && plan.summary.expansionAuditedBeforeRun === 45 && plan.summary.remainingExpansionBeforeRun === 455 && plan.summary.candidatePoolCount === 350 && plan.summary.selectedCount === 150);
  check('plan projects 195 Expansion-500 audited', plan.summary.projectedExpansionAuditedAfterRun === 195);
  check('plan projects 695 total audited', plan.summary.projectedTotalAuditedAfterRun === 695);
  check('plan reports 146 international-airport signals', plan.summary.internationalAirportSignalCount === 146);
  check('plan contains no gateway transfers', plan.summary.gatewayTransferCount === 0 && records.every(record => record.requiresGatewayTransfer === false));
  check('smoke cities are in the plan', ['baku-az','santo-domingo-do','bucharest-ro','lagos-ng','nadi-fj'].every(id => ids.includes(id)));
  check('activation baseline is pinned to 545 audited and 322 active', plan.source.auditedCityCountBeforeRun === 545 && plan.source.productionActiveCountBeforeRun === 322);
  check('plan explicitly leaves 668L activation unchanged', plan.policy.activationPolicy.includes('do not modify') && plan.policy.activationPolicy.includes('668L'));

  const summary = priority.summary();
  const allSearch = priority.search({ limit: 200 });
  const asiaSearch = priority.search({ region: 'Asia', limit: 100 });
  const airportSearch = priority.search({ internationalAirport: 'true', limit: 200 });
  const qSearch = priority.search({ q: 'Bucharest', limit: 10 });
  check('668M service version and feature flag are active', priority.VERSION === 'GV-CITY-668M' && priority.enabled() === true);
  check('668M summary reports 150 selected', summary.version === 'GV-CITY-668M' && summary.summary.selectedCount === 150);
  check('668M summary preserves the 668L baseline', summary.activationState.currentVersion === 'GV-CITY-668L' && summary.activationState.auditedCount === 545 && summary.activationState.productionActiveCount === 322 && summary.activationState.unchangedUntilAuditImport === true);
  check('668M summary projects 695 total audited', summary.auditProjection.totalAuditedAfterRun === 695 && summary.auditProjection.expansion500AuditedAfterRun === 195);
  check('668M search returns all 150 records', allSearch.totalMatches === 150 && allSearch.records.length === 150);
  check('668M search filters 45 Asian cities', asiaSearch.totalMatches === 45 && asiaSearch.records.every(record => record.worldRegion === 'Asia'));
  check('668M search filters 146 airport-signal cities', airportSearch.totalMatches === 146 && airportSearch.records.every(record => record.internationalAirportSignal === true));
  check('668M search resolves Bucharest', qSearch.totalMatches === 1 && qSearch.records[0].cityId === 'bucharest-ro');

  const lambdaSummary = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} }));
  const lambdaList = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: { limit: '150' } }));
  const lambdaRegion = parseBody(await lambda.handler({ rawPath: '/api/expansion-500-priority-audit', requestContext: { http: { method: 'GET' } }, queryStringParameters: { region: 'Africa', limit: '50' } }));
  const methodDenied = await lambda.handler({ rawPath: '/api/expansion-500-priority-audit', requestContext: { http: { method: 'POST' } }, queryStringParameters: {} });
  check('Lambda 668M summary endpoint works', lambdaSummary.version === 'GV-CITY-668M' && lambdaSummary.summary.selectedCount === 150);
  check('Lambda 668M list endpoint returns 150', lambdaList.totalMatches === 150 && lambdaList.records.length === 150);
  check('Lambda 668M region filter returns 20 African cities', lambdaRegion.totalMatches === 20);
  check('Lambda 668M endpoint is read-only', methodDenied.statusCode === 405);

  check('668L production activation remains at 322 before import', activation.summary().summary.productionActiveCount === 322);
  check('Baku remains unaudited estimate-only before import', activation.activationForCity('baku-az', { includeEvidence: false }).auditStatus === 'unaudited' && activation.activationForCity('baku-az', { includeEvidence: false }).liveRecommendationEligible === false);
  check('existing verified Toronto remains active', activation.activationForCity('toronto-ca', { includeEvidence: false }).liveRecommendationEligible === true);

  const ps = fs.readFileSync(path.join(__dirname, 'Run-GV-CITY-668M-Expansion500-Priority-Audit.ps1'), 'utf8');
  check('PowerShell runner supports Smoke5, Priority50, and Expansion150', ['Smoke5','Priority50','Expansion150'].every(value => ps.includes(value)));
  check('PowerShell runner uses the 668M endpoint and safe URL interpolation', ps.includes('/api/expansion-500-priority-audit') && ps.includes('"${PlanUrl}?limit=150"'));
  check('PowerShell runner supports checkpoint resume', ps.includes('[switch]$Resume') && ps.includes('CHECKPOINT.json') && ps.includes('Find-LatestCheckpoint'));
  check('PowerShell runner never embeds the admin token', !/GV_PROVIDER_COVERAGE_ADMIN_TOKEN\s*=/.test(ps) && ps.includes("Read-Host 'Admin token' -AsSecureString"));
  check('PowerShell runner uses bounded two-city batches', ps.includes('$ChunkSize = 2'));
  check('PowerShell runner keeps strict 668E audit policy', ps.includes('agodaQualityMaxResult = 30') && ps.includes('maxComfortTransfers = 1') && ps.includes('monthCount = 3'));
  check('PowerShell runner computes projected activation from deployed baseline', ps.includes('$BaselineActive = [int]$PlanSummary.activationState.productionActiveCount') && ps.includes('$ProjectedActive = $BaselineActive + $ProductionActive.Count'));
  check('PowerShell runner marks activation import as required', ps.includes('activationImportRequired = $true'));

  process.env.ENABLE_EXPANSION_500_PRIORITY_AUDIT_668M = 'false';
  check('flag-off disables 668M plan status', priority.enabled() === false && priority.summary().status === 'feature-disabled');
  process.env.ENABLE_EXPANSION_500_PRIORITY_AUDIT_668M = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668M',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668M.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
