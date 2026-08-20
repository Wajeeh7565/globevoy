'use strict';

// GV-CITY-668S — deterministic Inactive City Recovery Wave 1 plan.
// Selects the 150 strongest recovery targets from the 579 reviewed-inactive
// cities in the complete GV-CITY-668R snapshot. This plan is read-only: it
// never calls providers and never changes the 421-city production allowlist.

const fs = require('fs');
const path = require('path');

const registry = require('./data/unified-city-registry-1000-668b.json');
const snapshot = require('./data/verified-city-activation-1000-668r.json');
const review = require('./data/verified-city-review-579-668r.json');

const VERSION = 'GV-CITY-668S';
const TARGET_COUNT = 150;
const READINESS_LANE_COUNT = 64;
const STAY_LANE_COUNT = 6;
const FLIGHT_LANE_COUNT = 80;

function clean(value) { return String(value || '').trim(); }
function logHotelScore(count) {
  const n = Math.max(0, Number(count || 0));
  return Math.min(15, Math.log10(n + 1) * 4);
}
function recoveryScore(record, registryRecord) {
  const groupBonus = registryRecord?.group === 'GROUP_1' ? 35 : 0;
  const current500Bonus = record.selectionTier === 'current-500' ? 12 : 0;
  const airportBonus = registryRecord?.origin?.internationalAirportSignal === true ? 8 : 0;
  const directBonus = registryRecord?.origin?.requiresGatewayTransfer === true ? 0 : 3;
  const hotelCount = registryRecord?.providers?.agoda?.hotelCount || record?.evidence?.agoda?.rawHotelCount || 0;
  return Number((
    Number(registryRecord?.selectionScore || 0)
    + groupBonus
    + current500Bonus
    + airportBonus
    + directBonus
    + logHotelScore(hotelCount)
  ).toFixed(3));
}
function compare(a, b) {
  return recoveryScore(b.record, b.registryRecord) - recoveryScore(a.record, a.registryRecord)
    || Number(b.registryRecord?.selectionScore || 0) - Number(a.registryRecord?.selectionScore || 0)
    || clean(a.record.displayName).localeCompare(clean(b.record.displayName));
}
function publicRecord(item, rank, lane) {
  const record = item.record;
  const registryRecord = item.registryRecord || {};
  const flight = record.evidence?.travelpayouts || {};
  const stay = record.evidence?.agoda || {};
  return {
    rank,
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    worldRegion: registryRecord.worldRegion || record.worldRegion || null,
    selectionTier: record.selectionTier,
    group: registryRecord.group || null,
    groupSubtype: registryRecord.groupSubtype || null,
    selectionScore: Number(registryRecord.selectionScore || 0),
    recoveryScore: recoveryScore(record, registryRecord),
    recoveryLane: lane,
    previousClassification: record.classification,
    previousActivationReason: record.activation?.reason || null,
    retryQueues: Array.isArray(record.retryQueues) ? record.retryQueues.slice() : [],
    providerLocationCode: registryRecord.origin?.providerLocationCode || record.providerLocationCode || null,
    preferredAirportCode: registryRecord.origin?.preferredAirportCode || null,
    internationalAirportSignal: registryRecord.origin?.internationalAirportSignal === true,
    requiresGatewayTransfer: registryRecord.origin?.requiresGatewayTransfer === true || flight.gatewayRequiredForDestination === true,
    gateway: flight.gateway || registryRecord.origin?.gateway || null,
    previousFlightStatus: flight.status || null,
    previousFlightInventoryObserved: flight.inventoryObserved === true,
    previousFlightComfortQualified: flight.comfortQualified === true,
    previousStayStatus: stay.status || null,
    previousStayInventoryObserved: stay.inventoryObserved === true,
    previousStayQualityQualified: stay.qualityQualifiedRate === true,
    agodaMappingAccepted: Boolean(stay.agodaCityId || registryRecord.providers?.agoda?.cityId),
    agodaCityId: stay.agodaCityId || registryRecord.providers?.agoda?.cityId || null,
    agodaHotelCount: Number(registryRecord.providers?.agoda?.hotelCount || 0),
    selectionReason: lane === 'readiness-recovery'
      ? 'both providers were verified but comfort or hotel-quality qualification blocked activation'
      : lane === 'stay-recovery'
        ? 'flight capability is live and Agoda mapping is resolved; recover the stay side'
        : 'quality-qualified stay capability is live; expand flight observations and anchor coverage'
  };
}

const registryById = new Map((registry.records || []).map(record => [record.cityId, record]));
const inactive = (review.records || []).map(record => ({ record, registryRecord: registryById.get(record.cityId) }));
const noUnresolvedAgoda = item => !item.record.retryQueues?.includes('unresolved-agoda-mapping');

const readinessLane = inactive
  .filter(item => item.record.providerCoverage?.eligible === true)
  .sort(compare);
const stayLane = inactive
  .filter(item => noUnresolvedAgoda(item) && item.record.classification === 'live-flights-only')
  .sort(compare);
const flightLane = inactive
  .filter(item => noUnresolvedAgoda(item) && item.record.classification === 'live-stays-only')
  .sort(compare);

if (registry.records.length !== 1000) throw new Error(`Registry contains ${registry.records.length}, expected 1000.`);
if (snapshot.taskId !== 'GV-CITY-668R') throw new Error(`Expected GV-CITY-668R snapshot, found ${snapshot.taskId}.`);
if (Number(snapshot.summary?.auditedCount) !== 1000) throw new Error('668R audited baseline must be 1000.');
if (Number(snapshot.summary?.productionActiveCount) !== 421) throw new Error('668R active baseline must be 421.');
if (review.count !== 579 || inactive.length !== 579) throw new Error(`Expected 579 reviewed-inactive cities, found ${inactive.length}.`);
if (readinessLane.length !== READINESS_LANE_COUNT) throw new Error(`Expected ${READINESS_LANE_COUNT} readiness targets, found ${readinessLane.length}.`);
if (stayLane.length !== STAY_LANE_COUNT) throw new Error(`Expected ${STAY_LANE_COUNT} stay-recovery targets, found ${stayLane.length}.`);
if (flightLane.length < FLIGHT_LANE_COUNT) throw new Error(`Need at least ${FLIGHT_LANE_COUNT} flight-recovery candidates, found ${flightLane.length}.`);

const selectedItems = [
  ...readinessLane.map(item => ({ ...item, lane: 'readiness-recovery' })),
  ...stayLane.map(item => ({ ...item, lane: 'stay-recovery' })),
  ...flightLane.slice(0, FLIGHT_LANE_COUNT).map(item => ({ ...item, lane: 'flight-recovery' }))
];
const records = selectedItems.map((item, index) => publicRecord(item, index + 1, item.lane));
const ids = records.map(record => record.cityId);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

if (records.length !== TARGET_COUNT) throw new Error(`668S must select ${TARGET_COUNT} cities, found ${records.length}.`);
if (duplicates.length) throw new Error(`668S contains duplicate city IDs: ${duplicates.join(', ')}`);
if (records.some(record => !review.cityIds.includes(record.cityId))) throw new Error('668S includes a city outside the 668R reviewed-inactive set.');
if (records.some(record => snapshot.records.find(item => item.cityId === record.cityId)?.liveRecommendationEligible === true)) throw new Error('668S includes an already active city.');
if (records.some(record => record.retryQueues.includes('unresolved-agoda-mapping'))) throw new Error('668S Wave 1 must not include unresolved Agoda mappings.');

const byLane = records.reduce((acc, record) => {
  acc[record.recoveryLane] = (acc[record.recoveryLane] || 0) + 1;
  return acc;
}, {});
const byRegion = records.reduce((acc, record) => {
  const key = record.worldRegion || 'Unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});
const byTier = records.reduce((acc, record) => {
  acc[record.selectionTier] = (acc[record.selectionTier] || 0) + 1;
  return acc;
}, {});
const queueCounts = records.reduce((acc, record) => {
  for (const queue of record.retryQueues) acc[queue] = (acc[queue] || 0) + 1;
  return acc;
}, {});

const output = {
  version: VERSION,
  taskId: VERSION,
  status: 'inactive-city-recovery-wave-1-plan-ready',
  generatedAt: new Date().toISOString(),
  source: {
    registryVersion: registry.version,
    activationTaskId: snapshot.taskId,
    activationSnapshotVersion: snapshot.version,
    auditedCityCountBeforeRun: Number(snapshot.summary?.auditedCount || 1000),
    productionActiveCountBeforeRun: Number(snapshot.summary?.productionActiveCount || 421),
    reviewedInactiveCountBeforeRun: Number(snapshot.summary?.auditedInactiveCount || 579),
    current500ActiveBeforeRun: Number(snapshot.summary?.current500?.productionActive || 309),
    expansion500ActiveBeforeRun: Number(snapshot.summary?.expansion500?.productionActive || 112)
  },
  policy: {
    wave: 1,
    targetCount: TARGET_COUNT,
    objective: 'maximize safe recovery probability without weakening production qualification thresholds',
    laneOrder: ['readiness-recovery', 'stay-recovery', 'flight-recovery'],
    laneTargets: {
      readinessRecovery: READINESS_LANE_COUNT,
      stayRecovery: STAY_LANE_COUNT,
      flightRecovery: FLIGHT_LANE_COUNT
    },
    inclusion: 'reviewed-inactive cities with resolved Agoda mappings; all 64 provider-covered-but-inactive cities, all 6 mapped live-flights-only cities, then the strongest 80 live-stays-only cities',
    exclusion: 'already active cities and all 130 unresolved Agoda mappings; mapping repair is reserved for a separate controlled wave',
    recoveryAuditPolicy: {
      flightMonths: 4,
      regionalAnchorCount: 6,
      maximumFlightAttempts: 20,
      flightResultLimit: 12,
      stayWindows: 4,
      stayWindowSpacingDays: 30,
      agodaQualityStrategies: 3,
      agodaMaximumCandidatesPerStrategy: 30,
      maxComfortDurationMinutes: 1080,
      maxComfortTransfers: 1,
      maximumGatewayTransferMinutes: 180,
      thresholdsRelaxed: false
    },
    activationPolicy: 'results remain inactive until reviewed and merged into a later activation snapshot; the 421-city allowlist is unchanged by this package'
  },
  summary: {
    reviewedInactiveBaseline: 579,
    productionActiveBaseline: 421,
    selectedCount: records.length,
    readinessRecoveryCount: byLane['readiness-recovery'] || 0,
    stayRecoveryCount: byLane['stay-recovery'] || 0,
    flightRecoveryCount: byLane['flight-recovery'] || 0,
    current500Count: byTier['current-500'] || 0,
    expansion500Count: byTier['expansion-500'] || 0,
    group1Count: records.filter(record => record.group === 'GROUP_1').length,
    internationalAirportSignalCount: records.filter(record => record.internationalAirportSignal).length,
    gatewayTransferCount: records.filter(record => record.requiresGatewayTransfer).length,
    byRegion,
    retryQueueMembershipCounts: queueCounts,
    minimumRecoveryScore: Math.min(...records.map(record => record.recoveryScore)),
    maximumRecoveryScore: Math.max(...records.map(record => record.recoveryScore)),
    projectedAuditedAfterRun: 1000,
    projectedUnauditedAfterRun: 0,
    projectedActiveAfterRun: '421 + reviewed production-ready recoveries'
  },
  cityIds: ids,
  records
};

const outJson = path.join(__dirname, 'data', 'inactive-city-recovery-wave1-150-668s.json');
const outCsv = path.join(__dirname, 'data', 'inactive-city-recovery-wave1-150-668s.csv');
fs.writeFileSync(outJson, JSON.stringify(output, null, 2));

const header = [
  'rank','cityId','displayName','country','countryCode','worldRegion','selectionTier','group','selectionScore','recoveryScore','recoveryLane',
  'previousClassification','previousActivationReason','retryQueues','providerLocationCode','preferredAirportCode','internationalAirportSignal',
  'requiresGatewayTransfer','previousFlightStatus','previousFlightInventoryObserved','previousFlightComfortQualified','previousStayStatus',
  'previousStayInventoryObserved','previousStayQualityQualified','agodaCityId','agodaHotelCount','selectionReason'
];
const escape = value => {
  const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const rows = [header.join(',')].concat(records.map(record => header.map(key => escape(record[key])).join(',')));
fs.writeFileSync(outCsv, `${rows.join('\n')}\n`);
console.log(JSON.stringify(output.summary, null, 2));
