'use strict';

// GV-CITY-668K — deterministic completion plan for every Current-500 city
// not yet present in the merged 668J activation snapshot. This plan is
// read-only: it does not call providers and does not alter activation.

const fs = require('fs');
const path = require('path');

const registry = require('./data/unified-city-registry-1000-668b.json');
const activation = require('./data/verified-city-activation-400-668j.json');

const VERSION = 'GV-CITY-668K';
const EXPECTED_CURRENT500_COUNT = 500;
const EXPECTED_BASELINE_CURRENT500_AUDITED = 355;
const EXPECTED_FINAL_COUNT = 145;

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
function selectionReason(record) {
  if (record.group === 'REVIEW_REQUIRED') return 'review-required-current500-completion';
  if (record.origin?.requiresGatewayTransfer === true) return 'approved-gateway-current500-completion';
  return 'remaining-current500-completion';
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
    selectionReason: selectionReason(record),
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
const remainingCurrent500 = allCurrent500.filter(record => !auditedIds.has(record.cityId)).sort(compare);
const records = remainingCurrent500.map((record, index) => publicRecord(record, index + 1));
const ids = records.map(record => record.cityId);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

if (allCurrent500.length !== EXPECTED_CURRENT500_COUNT) {
  throw new Error(`Current-500 registry contains ${allCurrent500.length}, expected ${EXPECTED_CURRENT500_COUNT}.`);
}
if (Number(activation.summary?.current500?.audited) !== EXPECTED_BASELINE_CURRENT500_AUDITED) {
  throw new Error(`668J Current-500 audited baseline is ${activation.summary?.current500?.audited}, expected ${EXPECTED_BASELINE_CURRENT500_AUDITED}.`);
}
if (records.length !== EXPECTED_FINAL_COUNT || duplicateIds.length) {
  throw new Error(`668K completion plan must contain ${EXPECTED_FINAL_COUNT} unique cities.`);
}
if (records.some(record => auditedIds.has(record.cityId))) throw new Error('668K plan includes an already audited city.');
if (records.some(record => record.selectionTier !== 'current-500')) throw new Error('668K plan includes a non-current-500 city.');
if (records.some(record => record.bothProvidersMapped !== true)) throw new Error('668K plan includes a city without both static provider mappings.');
if (EXPECTED_BASELINE_CURRENT500_AUDITED + records.length !== EXPECTED_CURRENT500_COUNT) {
  throw new Error('668K plan does not complete the Current-500 foundation exactly.');
}

const byRegion = records.reduce((acc, record) => {
  const key = record.worldRegion || 'Other';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const byGroup = records.reduce((acc, record) => {
  const key = record.group || 'UNKNOWN';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const mappingTypes = records.reduce((acc, record) => {
  const key = record.agodaMappingType || 'unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const output = {
  version: VERSION,
  taskId: VERSION,
  status: 'current-500-completion-audit-plan-ready',
  generatedAt: new Date().toISOString(),
  source: {
    registryVersion: registry.version,
    activationTaskId: activation.taskId,
    activationSnapshotVersion: activation.version,
    auditedCityCountBeforeRun: Number(activation.summary?.auditedCount || 400),
    productionActiveCountBeforeRun: Number(activation.summary?.productionActiveCount || 259),
    current500AuditedBeforeRun: Number(activation.summary?.current500?.audited || 355),
    current500ProductionActiveBeforeRun: Number(activation.summary?.current500?.productionActive || 246),
    expansion500AuditedBeforeRun: Number(activation.summary?.expansion500?.audited || 45),
    remainingCurrent500BeforeRun: records.length
  },
  policy: {
    targetTier: 'current-500',
    targetCount: records.length,
    inclusion: 'every Current-500 city absent from the 668J merged activation snapshot',
    candidatePolicy: 'all remaining cities; all have both static provider mappings, including four REVIEW_REQUIRED records',
    ordering: 'readiness-weighted deterministic ordering for operational convenience; every remaining city is included',
    scoring: {
      selectionScore: 'base',
      group1AnchorBonus: 30,
      internationalAirportBonus: 8,
      noProductReviewBonus: 8,
      agodaMappingBonus: '0..6',
      agodaInventoryBonus: 'logarithmic, capped at 20',
      gatewayTransferPenalty: 3
    },
    providerAuditPolicy: 'inherit GV-CITY-668E multi-window flights, regional anchors, approved gateway repair, flight comfort, and diversified Agoda quality retrieval',
    activationPolicy: 'audit results do not modify the 668J 259-city allowlist until reviewed and imported',
    completionRule: '355 already-audited Current-500 cities plus this 145-city wave equals 500/500'
  },
  summary: {
    current500RegistryCount: allCurrent500.length,
    current500AuditedBeforeRun: Number(activation.summary?.current500?.audited || 355),
    remainingCurrent500BeforeRun: records.length,
    selectedCount: records.length,
    projectedCurrent500AuditedAfterRun: EXPECTED_CURRENT500_COUNT,
    projectedTotalAuditedAfterRun: Number(activation.summary?.auditedCount || 400) + records.length,
    group1AnchorCount: records.filter(record => record.group === 'GROUP_1').length,
    group2DiscoveryCount: records.filter(record => record.group === 'GROUP_2').length,
    reviewRequiredCount: records.filter(record => record.group === 'REVIEW_REQUIRED').length,
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

const jsonPath = path.join(__dirname, 'data', 'current-500-completion-audit-145-668k.json');
fs.writeFileSync(jsonPath, JSON.stringify(output, null, 2));
const csvHeader = [
  'rank','cityId','displayName','country','countryCode','worldRegion','group','selectionScore','priorityScore',
  'providerLocationCode','preferredAirportCode','internationalAirportSignal','requiresGatewayTransfer',
  'agodaMappingType','agodaHotelCount','productReviewRequired','selectionReason'
];
const escape = value => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvRows = [csvHeader.join(',')].concat(records.map(record => csvHeader.map(key => escape(record[key])).join(',')));
fs.writeFileSync(path.join(__dirname, 'data', 'current-500-completion-audit-145-668k.csv'), `${csvRows.join('\n')}\n`);
console.log(JSON.stringify(output.summary, null, 2));
