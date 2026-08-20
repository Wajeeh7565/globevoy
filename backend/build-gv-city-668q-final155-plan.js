'use strict';

// GV-CITY-668Q — deterministic plan for the final 155 unaudited
// Expansion-500 cities after the verified GV-CITY-668P activation snapshot.
// The plan is read-only: it never calls providers and never modifies activation.

const fs = require('fs');
const path = require('path');

const registry = require('./data/unified-city-registry-1000-668b.json');
const staticAudit = require('./data/provider-mappings-1000-668b.json');
const activation = require('./data/verified-city-activation-845-668p.json');

const VERSION = 'GV-CITY-668Q';
const TARGET_COUNT = 155;

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
  return Number((
    Number(record.selectionScore || 0)
    + (record.origin?.internationalAirportSignal === true ? 8 : 0)
    + agodaMappingScore(record.providers?.agoda?.mappingType)
    + logHotelScore(record.providers?.agoda?.hotelCount)
  ).toFixed(3));
}
function compareWithinLane(a, b) {
  return priorityScore(b) - priorityScore(a)
    || Number(b.selectionScore || 0) - Number(a.selectionScore || 0)
    || Number(b.providers?.agoda?.hotelCount || 0) - Number(a.providers?.agoda?.hotelCount || 0)
    || clean(a.displayName).localeCompare(clean(b.displayName));
}
function compare(a, b) {
  const laneA = a.validation?.bothProvidersMapped === true ? 0 : 1;
  const laneB = b.validation?.bothProvidersMapped === true ? 0 : 1;
  return laneA - laneB || compareWithinLane(a, b);
}
function publicRecord(record, staticRecord, rank) {
  const bothMapped = record.validation?.bothProvidersMapped === true;
  const travelMapped = staticRecord?.travelpayouts?.mappingAccepted === true;
  const agodaMapped = staticRecord?.agoda?.mappingAccepted === true;
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
    auditLane: bothMapped ? 'fully-mapped-final-50' : 'agoda-unresolved-final-105',
    selectionReason: bothMapped
      ? 'remaining-both-static-providers-mapped-final-coverage-wave'
      : 'remaining-agoda-unresolved-final-coverage-wave',
    providerLocationCode: record.origin?.providerLocationCode || null,
    preferredAirportCode: record.origin?.preferredAirportCode || null,
    internationalAirportSignal: record.origin?.internationalAirportSignal === true,
    requiresGatewayTransfer: record.origin?.requiresGatewayTransfer === true,
    gateway: record.origin?.gateway || null,
    travelpayoutsMappingAccepted: travelMapped,
    travelpayoutsMappingType: staticRecord?.travelpayouts?.mappingType || record.providers?.travelpayouts?.mappingType || null,
    agodaMappingAccepted: agodaMapped,
    agodaMappingStatus: staticRecord?.agoda?.status || record.providers?.agoda?.status || null,
    agodaMappingType: staticRecord?.agoda?.mappingType || record.providers?.agoda?.mappingType || null,
    agodaCityId: staticRecord?.agoda?.cityId || record.providers?.agoda?.cityId || null,
    agodaHotelCount: Number(staticRecord?.agoda?.hotelCount || record.providers?.agoda?.hotelCount || 0),
    bothProvidersMapped: bothMapped,
    productReviewRequired: record.validation?.requiresProductReview === true
  };
}

const staticById = new Map((staticAudit.records || []).map(record => [record.cityId, record]));
const auditedIds = new Set((activation.records || []).map(record => record.cityId));
const expansion500 = (registry.records || []).filter(record => record.selectionTier === 'expansion-500');
const remaining = expansion500.filter(record => !auditedIds.has(record.cityId)).sort(compare);
const records = remaining.map((record, index) => publicRecord(record, staticById.get(record.cityId), index + 1));
const ids = records.map(record => record.cityId);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
const fullyMapped = records.filter(record => record.bothProvidersMapped === true);
const agodaUnresolved = records.filter(record => record.agodaMappingAccepted !== true);

if (registry.records.length !== 1000) throw new Error(`Registry contains ${registry.records.length}, expected 1000.`);
if (expansion500.length !== 500) throw new Error(`Expansion registry contains ${expansion500.length}, expected 500.`);
if (activation.taskId !== 'GV-CITY-668P') throw new Error(`Expected GV-CITY-668P activation baseline, found ${activation.taskId}.`);
if (Number(activation.summary?.auditedCount) !== 845) throw new Error('668P audited baseline must be 845.');
if (Number(activation.summary?.productionActiveCount) !== 420) throw new Error('668P active baseline must be 420.');
if (Number(activation.summary?.expansion500?.audited) !== 345) throw new Error('668P expansion audited baseline must be 345.');
if (remaining.length !== TARGET_COUNT) throw new Error(`Expected 155 remaining expansion cities, found ${remaining.length}.`);
if (records.length !== TARGET_COUNT || duplicateIds.length) throw new Error('668Q plan must contain 155 unique cities.');
if (records.some(record => auditedIds.has(record.cityId))) throw new Error('668Q plan includes an already audited city.');
if (records.some(record => record.selectionTier !== 'expansion-500')) throw new Error('668Q plan includes a non-expansion city.');
if (records.some(record => record.travelpayoutsMappingAccepted !== true)) throw new Error('668Q plan includes a city without an accepted Travelpayouts mapping.');
if (fullyMapped.length !== 50) throw new Error(`Expected 50 fully mapped remaining cities, found ${fullyMapped.length}.`);
if (agodaUnresolved.length !== 105) throw new Error(`Expected 105 Agoda-unresolved remaining cities, found ${agodaUnresolved.length}.`);
if (records.some(record => record.productReviewRequired !== true)) throw new Error('Every final-wave city must remain a product-review target.');

const expectedIds = [...remaining].sort(compare).map(record => record.cityId);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) throw new Error('668Q selected order does not match the deterministic final-wave ordering.');

const byRegion = records.reduce((acc, record) => {
  const key = record.worldRegion || 'Unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const byAuditLane = records.reduce((acc, record) => {
  acc[record.auditLane] = (acc[record.auditLane] || 0) + 1;
  return acc;
}, {});
const agodaStatuses = records.reduce((acc, record) => {
  const key = record.agodaMappingStatus || 'unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const output = {
  version: VERSION,
  taskId: VERSION,
  status: 'final-155-expansion-coverage-audit-plan-ready',
  generatedAt: new Date().toISOString(),
  source: {
    registryVersion: registry.version,
    staticMappingTaskId: staticAudit.taskId,
    activationTaskId: activation.taskId,
    activationSnapshotVersion: activation.version,
    auditedCityCountBeforeRun: Number(activation.summary?.auditedCount || 845),
    productionActiveCountBeforeRun: Number(activation.summary?.productionActiveCount || 420),
    current500AuditedBeforeRun: Number(activation.summary?.current500?.audited || 500),
    expansion500AuditedBeforeRun: Number(activation.summary?.expansion500?.audited || 345),
    expansion500ProductionActiveBeforeRun: Number(activation.summary?.expansion500?.productionActive || 111),
    remainingExpansionBeforeRun: remaining.length
  },
  policy: {
    targetTier: 'expansion-500',
    wave: 'final',
    targetCount: TARGET_COUNT,
    exclusion: 'all 845 cities already present in the 668P verified activation snapshot',
    inclusion: 'every remaining Expansion-500 city; no city is skipped for incomplete Agoda mapping',
    orderingPolicy: 'audit the 50 fully mapped cities first, then the 105 Agoda-unresolved cities; deterministic readiness order inside each lane',
    providerAuditPolicy: 'inherit GV-CITY-668E multi-window flights, regional anchors, approved gateway repair, flight comfort, and diversified Agoda quality retrieval where mappings permit',
    unresolvedMappingPolicy: 'record unresolved static mapping as audited evidence; never manufacture or substitute an Agoda market',
    activationPolicy: 'audit results do not modify the 668P 420-city allowlist until reviewed and imported'
  },
  summary: {
    expansionRegistryCount: expansion500.length,
    expansionAuditedBeforeRun: Number(activation.summary?.expansion500?.audited || 345),
    expansionActiveBeforeRun: Number(activation.summary?.expansion500?.productionActive || 111),
    remainingExpansionBeforeRun: remaining.length,
    selectedCount: records.length,
    fullyMappedFinalCount: fullyMapped.length,
    agodaUnresolvedFinalCount: agodaUnresolved.length,
    travelpayoutsMappedCount: records.filter(record => record.travelpayoutsMappingAccepted).length,
    projectedExpansionAuditedAfterRun: 500,
    projectedTotalAuditedAfterRun: 1000,
    projectedRemainingUnauditedAfterRun: 0,
    internationalAirportSignalCount: records.filter(record => record.internationalAirportSignal).length,
    productReviewRequiredCount: records.filter(record => record.productReviewRequired).length,
    gatewayTransferCount: records.filter(record => record.requiresGatewayTransfer).length,
    byRegion,
    byAuditLane,
    agodaMappingStatuses: agodaStatuses,
    minimumPriorityScore: Math.min(...records.map(record => record.priorityScore)),
    maximumPriorityScore: Math.max(...records.map(record => record.priorityScore))
  },
  cityIds: ids,
  records
};

fs.writeFileSync(path.join(__dirname, 'data', 'expansion-500-final-audit-155-668q.json'), JSON.stringify(output, null, 2));
const csvHeader = [
  'rank','cityId','displayName','country','countryCode','worldRegion','group','selectionScore','priorityScore','auditLane',
  'providerLocationCode','preferredAirportCode','internationalAirportSignal','requiresGatewayTransfer',
  'travelpayoutsMappingType','agodaMappingAccepted','agodaMappingStatus','agodaMappingType','agodaHotelCount','productReviewRequired','selectionReason'
];
const escape = value => {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csvRows = [csvHeader.join(',')].concat(records.map(record => csvHeader.map(key => escape(record[key])).join(',')));
fs.writeFileSync(path.join(__dirname, 'data', 'expansion-500-final-audit-155-668q.csv'), `${csvRows.join('\n')}\n`);
console.log(JSON.stringify(output.summary, null, 2));
