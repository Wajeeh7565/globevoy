'use strict';

// GV-CITY-668M — deterministic selection of the strongest 150 unaudited
// Expansion-500 cities after the verified 668L activation snapshot. The plan
// is read-only: it never calls providers and never modifies activation.

const fs = require('fs');
const path = require('path');

const registry = require('./data/unified-city-registry-1000-668b.json');
const activation = require('./data/verified-city-activation-545-668l.json');

const VERSION = 'GV-CITY-668M';
const REGION_TARGETS = Object.freeze({
  Asia: 45,
  Americas: 35,
  Europe: 25,
  Africa: 20,
  Oceania: 15,
  Other: 10
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
    selectionReason: 'high-readiness-expansion-500-wave-1',
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
const candidates = remainingExpansion.filter(record => record.validation?.bothProvidersMapped === true);
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

if (expansion500.length !== 500) throw new Error(`Expansion registry contains ${expansion500.length}, expected 500.`);
if (Number(activation.summary?.expansion500?.audited) !== 45) throw new Error('668L expansion audited baseline must be 45.');
if (remainingExpansion.length !== 455) throw new Error(`Expected 455 remaining expansion cities, found ${remainingExpansion.length}.`);
if (records.length !== 150 || duplicateIds.length) throw new Error('668M plan must contain 150 unique cities.');
if (records.some(record => auditedIds.has(record.cityId))) throw new Error('668M plan includes an already audited city.');
if (records.some(record => record.selectionTier !== 'expansion-500')) throw new Error('668M plan includes a non-expansion city.');
if (records.some(record => record.bothProvidersMapped !== true)) throw new Error('668M plan includes a city without both static provider mappings.');

const byRegion = Object.fromEntries(Object.keys(REGION_TARGETS).map(region => [region, records.filter(record => record.worldRegion === region).length]));
const mappingTypes = records.reduce((acc, record) => {
  const key = record.agodaMappingType || 'unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

const output = {
  version: VERSION,
  taskId: VERSION,
  status: 'expansion-500-priority-audit-wave-1-plan-ready',
  generatedAt: new Date().toISOString(),
  source: {
    registryVersion: registry.version,
    activationTaskId: activation.taskId,
    activationSnapshotVersion: activation.version,
    auditedCityCountBeforeRun: Number(activation.summary?.auditedCount || 545),
    productionActiveCountBeforeRun: Number(activation.summary?.productionActiveCount || 322),
    current500AuditedBeforeRun: Number(activation.summary?.current500?.audited || 500),
    expansion500AuditedBeforeRun: Number(activation.summary?.expansion500?.audited || 45),
    expansion500ProductionActiveBeforeRun: Number(activation.summary?.expansion500?.productionActive || 13),
    remainingExpansionBeforeRun: remainingExpansion.length
  },
  policy: {
    targetTier: 'expansion-500',
    wave: 1,
    targetCount: 150,
    exclusion: 'all 545 cities already present in the 668L verified activation snapshot',
    candidatePolicy: 'both static providers mapped; highest deterministic readiness score within region targets',
    regionTargets: REGION_TARGETS,
    scoring: {
      selectionScore: 'base',
      internationalAirportBonus: 8,
      agodaMappingBonus: '0..6',
      agodaInventoryBonus: 'logarithmic, capped at 20'
    },
    providerAuditPolicy: 'inherit GV-CITY-668E multi-window flights, regional anchors, approved gateway repair, flight comfort, and diversified Agoda quality retrieval',
    activationPolicy: 'audit results do not modify the 668L 322-city allowlist until reviewed and imported'
  },
  summary: {
    expansionRegistryCount: expansion500.length,
    expansionAuditedBeforeRun: Number(activation.summary?.expansion500?.audited || 45),
    expansionActiveBeforeRun: Number(activation.summary?.expansion500?.productionActive || 13),
    remainingExpansionBeforeRun: remainingExpansion.length,
    candidatePoolCount: candidates.length,
    selectedCount: records.length,
    notSelectedCandidateCount: candidates.length - records.length,
    projectedExpansionAuditedAfterRun: Number(activation.summary?.expansion500?.audited || 45) + records.length,
    projectedTotalAuditedAfterRun: Number(activation.summary?.auditedCount || 545) + records.length,
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

fs.writeFileSync(path.join(__dirname, 'data', 'expansion-500-priority-audit-150-668m.json'), JSON.stringify(output, null, 2));
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
fs.writeFileSync(path.join(__dirname, 'data', 'expansion-500-priority-audit-150-668m.csv'), `${csvRows.join('\n')}\n`);
console.log(JSON.stringify(output.summary, null, 2));
