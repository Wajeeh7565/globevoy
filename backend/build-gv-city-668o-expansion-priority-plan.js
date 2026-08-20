'use strict';

// GV-CITY-668O — deterministic selection of the strongest 150 unaudited
// Expansion-500 cities after the verified GV-CITY-668N activation snapshot.
// The plan is read-only: it never calls providers and never modifies activation.

const fs = require('fs');
const path = require('path');

const registry = require('./data/unified-city-registry-1000-668b.json');
const activation = require('./data/verified-city-activation-695-668n.json');

const VERSION = 'GV-CITY-668O';
const TARGET_COUNT = 150;

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
    selectionReason: 'highest-global-readiness-expansion-500-wave-2',
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
const expansion500 = (registry.records || []).filter(record => record.selectionTier === 'expansion-500');
const remainingExpansion = expansion500.filter(record => !auditedIds.has(record.cityId));
const candidates = remainingExpansion
  .filter(record => record.validation?.bothProvidersMapped === true)
  .sort(compare);
const selected = candidates.slice(0, TARGET_COUNT);
const records = selected.map((record, index) => publicRecord(record, index + 1));
const ids = records.map(record => record.cityId);
const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);

if (registry.records.length !== 1000) throw new Error(`Registry contains ${registry.records.length}, expected 1000.`);
if (expansion500.length !== 500) throw new Error(`Expansion registry contains ${expansion500.length}, expected 500.`);
if (activation.taskId !== 'GV-CITY-668N') throw new Error(`Expected GV-CITY-668N activation baseline, found ${activation.taskId}.`);
if (Number(activation.summary?.auditedCount) !== 695) throw new Error('668N audited baseline must be 695.');
if (Number(activation.summary?.productionActiveCount) !== 393) throw new Error('668N active baseline must be 393.');
if (Number(activation.summary?.expansion500?.audited) !== 195) throw new Error('668N expansion audited baseline must be 195.');
if (remainingExpansion.length !== 305) throw new Error(`Expected 305 remaining expansion cities, found ${remainingExpansion.length}.`);
if (candidates.length !== 200) throw new Error(`Expected 200 remaining cities with both static mappings, found ${candidates.length}.`);
if (records.length !== TARGET_COUNT || duplicateIds.length) throw new Error('668O plan must contain 150 unique cities.');
if (records.some(record => auditedIds.has(record.cityId))) throw new Error('668O plan includes an already audited city.');
if (records.some(record => record.selectionTier !== 'expansion-500')) throw new Error('668O plan includes a non-expansion city.');
if (records.some(record => record.bothProvidersMapped !== true)) throw new Error('668O plan includes a city without both static provider mappings.');

const expectedIds = candidates.slice(0, TARGET_COUNT).map(record => record.cityId);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) throw new Error('668O selected set does not match the global deterministic score order.');

const byRegion = records.reduce((acc, record) => {
  const key = record.worldRegion || 'Unknown';
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
  status: 'expansion-500-priority-audit-wave-2-plan-ready',
  generatedAt: new Date().toISOString(),
  source: {
    registryVersion: registry.version,
    activationTaskId: activation.taskId,
    activationSnapshotVersion: activation.version,
    auditedCityCountBeforeRun: Number(activation.summary?.auditedCount || 695),
    productionActiveCountBeforeRun: Number(activation.summary?.productionActiveCount || 393),
    current500AuditedBeforeRun: Number(activation.summary?.current500?.audited || 500),
    expansion500AuditedBeforeRun: Number(activation.summary?.expansion500?.audited || 195),
    expansion500ProductionActiveBeforeRun: Number(activation.summary?.expansion500?.productionActive || 84),
    remainingExpansionBeforeRun: remainingExpansion.length
  },
  policy: {
    targetTier: 'expansion-500',
    wave: 2,
    targetCount: TARGET_COUNT,
    exclusion: 'all 695 cities already present in the 668N verified activation snapshot',
    candidatePolicy: 'both static providers mapped; highest deterministic readiness score globally',
    diversityPolicy: 'no artificial regional quota; geography is reported transparently and score order is preserved',
    scoring: {
      selectionScore: 'base',
      internationalAirportBonus: 8,
      agodaMappingBonus: '0..6',
      agodaInventoryBonus: 'logarithmic, capped at 20'
    },
    providerAuditPolicy: 'inherit GV-CITY-668E multi-window flights, regional anchors, approved gateway repair, flight comfort, and diversified Agoda quality retrieval',
    activationPolicy: 'audit results do not modify the 668N 393-city allowlist until reviewed and imported'
  },
  summary: {
    expansionRegistryCount: expansion500.length,
    expansionAuditedBeforeRun: Number(activation.summary?.expansion500?.audited || 195),
    expansionActiveBeforeRun: Number(activation.summary?.expansion500?.productionActive || 84),
    remainingExpansionBeforeRun: remainingExpansion.length,
    candidatePoolCount: candidates.length,
    selectedCount: records.length,
    notSelectedCandidateCount: candidates.length - records.length,
    staticallyIncompleteRemainingCount: remainingExpansion.length - candidates.length,
    projectedExpansionAuditedAfterRun: Number(activation.summary?.expansion500?.audited || 195) + records.length,
    projectedTotalAuditedAfterRun: Number(activation.summary?.auditedCount || 695) + records.length,
    projectedRemainingUnauditedAfterRun: 1000 - (Number(activation.summary?.auditedCount || 695) + records.length),
    bothProvidersStaticMappedCount: records.filter(record => record.bothProvidersMapped).length,
    internationalAirportSignalCount: records.filter(record => record.internationalAirportSignal).length,
    productReviewRequiredCount: records.filter(record => record.productReviewRequired).length,
    gatewayTransferCount: records.filter(record => record.requiresGatewayTransfer).length,
    byRegion,
    agodaMappingTypes: mappingTypes,
    minimumPriorityScore: Math.min(...records.map(record => record.priorityScore)),
    maximumPriorityScore: Math.max(...records.map(record => record.priorityScore))
  },
  cityIds: ids,
  records
};

fs.writeFileSync(path.join(__dirname, 'data', 'expansion-500-priority-audit-150-668o.json'), JSON.stringify(output, null, 2));
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
fs.writeFileSync(path.join(__dirname, 'data', 'expansion-500-priority-audit-150-668o.csv'), `${csvRows.join('\n')}\n`);
console.log(JSON.stringify(output.summary, null, 2));
