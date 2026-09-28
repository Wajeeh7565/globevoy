'use strict';

// GV-CITY-668I — deterministic selection of the next 150 unaudited
// Current-500 cities after the merged 668H activation snapshot. The plan
// favors high-readiness Group 2 discoveries while preserving useful world-
// region coverage. It does not call providers or alter production activation.

const fs = require('fs');
const path = require('path');

const registry = require('./data/unified-city-registry-1000-668b.json');
const activation = require('./data/verified-city-activation-250-668h.json');

const VERSION = 'GV-CITY-668I';
const REGION_TARGETS = Object.freeze({
  Americas: 60,
  Europe: 45,
  Asia: 25,
  Africa: 10,
  Oceania: 5,
  Other: 5
});

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
function priorityScore(record) {
  const hotelCount = Number(record.providers?.agoda?.hotelCount || 0);
  return Number((
    Number(record.selectionScore || 0)
    + (record.group === 'GROUP_1' ? 30 : 0)
    + (record.origin?.internationalAirportSignal === true ? 8 : 0)
    + (record.validation?.requiresProductReview === false ? 8 : 0)
    + agodaMappingScore(record.providers?.agoda?.mappingType)
    + logHotelScore(hotelCount)
    - (record.origin?.requiresGatewayTransfer === true ? 3 : 0)
  ).toFixed(3));
}
function compare(a, b) {
  return priorityScore(b) - priorityScore(a)
    || Number(b.selectionScore || 0) - Number(a.selectionScore || 0)
    || Number(b.providers?.agoda?.hotelCount || 0) - Number(a.providers?.agoda?.hotelCount || 0)
    || clean(a.displayName).localeCompare(clean(b.displayName));
}
function publicRecord(record, rank) {
  return {
    rank,
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    worldRegion: record.worldRegion,
    selectionTier: record.selectionTier,
    selectionScore: record.selectionScore,
    priorityScore: priorityScore(record),
    group: record.group,
    groupSubtype: record.groupSubtype,
    selectionReason: record.origin?.requiresGatewayTransfer === true
      ? 'high-readiness-current-500-with-approved-gateway'
      : 'high-readiness-group2-current-500',
    providerLocationCode: record.origin?.providerLocationCode || null,
    preferredAirportCode: record.origin?.preferredAirportCode || null,
    internationalAirportSignal: record.origin?.internationalAirportSignal === true,
    requiresGatewayTransfer: record.origin?.requiresGatewayTransfer === true,
    gateway: record.origin?.gateway || null,
    agodaMappingType: record.providers?.agoda?.mappingType || null,
    agodaCityId: record.providers?.agoda?.cityId || null,
    agodaHotelCount: Number(record.providers?.agoda?.hotelCount || 0),
    bothProvidersMapped: record.validation?.bothProvidersMapped === true,
    productReviewRequired: record.validation?.requiresProductReview === true
  };
}

const auditedIds = new Set((activation.records || []).map(record => record.cityId));
const allCurrent500 = (registry.records || []).filter(record => record.selectionTier === 'current-500');
const remainingCurrent500 = allCurrent500.filter(record => !auditedIds.has(record.cityId));
const excludedReviewRequired = remainingCurrent500.filter(record => record.group === 'REVIEW_REQUIRED');
const candidates = remainingCurrent500.filter(record =>
  record.validation?.bothProvidersMapped === true
  && record.group !== 'REVIEW_REQUIRED'
);

const selected = [];
for (const [region, target] of Object.entries(REGION_TARGETS)) {
  const regional = candidates.filter(record => record.worldRegion === region).sort(compare);
  if (regional.length < target) {
    throw new Error(`Region ${region} produced ${regional.length}, expected at least ${target}.`);
  }
  selected.push(...regional.slice(0, target));
}
selected.sort(compare);

const records = selected.map((record, index) => publicRecord(record, index + 1));
const ids = records.map(record => record.cityId);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
if (records.length !== 150 || duplicateIds.length) throw new Error('668I selection must contain 150 unique cities.');
if (records.some(record => auditedIds.has(record.cityId))) throw new Error('668I selection includes an already audited city.');
if (records.some(record => record.selectionTier !== 'current-500')) throw new Error('668I selection includes a non-current-500 city.');
if (records.some(record => record.bothProvidersMapped !== true)) throw new Error('668I selection includes a city without both static provider mappings.');

const byRegion = Object.fromEntries(Object.keys(REGION_TARGETS).map(region => [region, records.filter(record => record.worldRegion === region).length]));
const byGroup = records.reduce((acc, record) => { acc[record.group] = (acc[record.group] || 0) + 1; return acc; }, {});
const mappingTypes = records.reduce((acc, record) => { const key = record.agodaMappingType || 'unknown'; acc[key] = (acc[key] || 0) + 1; return acc; }, {});

const output = {
  version: VERSION,
  taskId: VERSION,
  status: 'remaining-current-500-priority-audit-plan-ready',
  generatedAt: new Date().toISOString(),
  source: {
    registryVersion: registry.version,
    activationTaskId: activation.taskId,
    activationSnapshotVersion: activation.version,
    auditedCityCountBeforeRun: Number(activation.summary?.auditedCount || 250),
    productionActiveCountBeforeRun: Number(activation.summary?.productionActiveCount || 176),
    current500AuditedBeforeRun: Number(activation.summary?.current500?.audited || 205),
    current500ProductionActiveBeforeRun: Number(activation.summary?.current500?.productionActive || 163),
    remainingCurrent500BeforeRun: remainingCurrent500.length
  },
  policy: {
    targetTier: 'current-500',
    targetCount: 150,
    exclusion: 'all 250 cities already present in the 668H merged activation snapshot',
    candidatePolicy: 'both static providers mapped and not REVIEW_REQUIRED',
    group1Status: 'all Current-500 Group 1 anchors are already audited; this wave contains Group 2 discoveries',
    regionTargets: REGION_TARGETS,
    scoring: {
      selectionScore: 'base',
      group1AnchorBonus: 30,
      internationalAirportBonus: 8,
      noProductReviewBonus: 8,
      agodaMappingBonus: '0..6',
      agodaInventoryBonus: 'logarithmic, capped at 20',
      gatewayTransferPenalty: 3
    },
    providerAuditPolicy: 'inherit GV-CITY-668E multi-window flights, regional anchors, gateway repair, flight comfort, and diversified Agoda quality retrieval',
    activationPolicy: 'audit results do not modify the 668H 176-city allowlist until reviewed and imported'
  },
  summary: {
    current500RegistryCount: allCurrent500.length,
    current500AuditedBeforeRun: Number(activation.summary?.current500?.audited || 205),
    remainingCurrent500BeforeRun: remainingCurrent500.length,
    reviewRequiredExcludedCount: excludedReviewRequired.length,
    candidatePoolCount: candidates.length,
    selectedCount: records.length,
    notSelectedCandidateCount: candidates.length - records.length,
    group1AnchorCount: records.filter(record => record.group === 'GROUP_1').length,
    group2DiscoveryCount: records.filter(record => record.group === 'GROUP_2').length,
    bothProvidersStaticMappedCount: records.filter(record => record.bothProvidersMapped).length,
    internationalAirportSignalCount: records.filter(record => record.internationalAirportSignal).length,
    productReviewRequiredCount: records.filter(record => record.productReviewRequired).length,
    gatewayTransferCount: records.filter(record => record.requiresGatewayTransfer).length,
    byRegion,
    byGroup,
    agodaMappingTypes: mappingTypes,
    minimumPriorityScore: Math.min(...records.map(record => record.priorityScore)),
    maximumPriorityScore: Math.max(...records.map(record => record.priorityScore))
  },
  cityIds: ids,
  records
};

const jsonPath = path.join(__dirname, 'data', 'remaining-current-500-audit-150-668i.json');
fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
const csvHeader = [
  'rank','cityId','displayName','country','countryCode','worldRegion','group','selectionScore','priorityScore',
  'providerLocationCode','preferredAirportCode','internationalAirportSignal','requiresGatewayTransfer',
  'agodaMappingType','agodaHotelCount','productReviewRequired','selectionReason'
];
const escape = value => { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
const csvRows = [csvHeader.join(',')].concat(records.map(record => csvHeader.map(key => escape(record[key])).join(',')));
fs.writeFileSync(path.join(__dirname, 'data', 'remaining-current-500-audit-150-668i.csv'), `${csvRows.join('\n')}\n`);
console.log(JSON.stringify(output.summary, null, 2));
