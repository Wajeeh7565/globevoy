'use strict';

// GV-CITY-668H — deterministic merge of the reviewed GV-CITY-668F baseline
// (sourced from the completed 668E Pilot100) with the completed 668G Priority150
// audit. This script never calls providers.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const pilotPath = path.join(root, 'data', 'provider-live-pilot-100-668e-source.json');
const priorityPath = path.join(root, 'data', 'provider-live-priority-150-668g-source.json');
const registryPath = path.join(root, 'data', 'unified-city-registry-1000-668b.json');
const activationPath = path.join(root, 'data', 'verified-city-activation-250-668h.json');
const retryPath = path.join(root, 'data', 'verified-city-retry-queues-668h.json');
const activeJsonPath = path.join(root, 'data', 'verified-city-production-active-176-668h.json');
const reviewJsonPath = path.join(root, 'data', 'verified-city-review-74-668h.json');
const activeCsvPath = path.join(root, 'data', 'verified-city-production-active-176-668h.csv');
const reviewCsvPath = path.join(root, 'data', 'verified-city-review-74-668h.csv');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function writeCsv(file, headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(headers.map(header => csvCell(row[header])).join(','));
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}
function queueTags(record) {
  const tags = [];
  const flight = record.live?.travelpayouts || {};
  const stay = record.live?.agoda || {};
  if (flight.status === 'no-live-observations') tags.push('missing-flight-observations');
  if (stay.status === 'unresolved-static-mapping') tags.push('unresolved-agoda-mapping');
  if (['no-live-rate', 'no-live-observations', 'no-live-qualified-rate'].includes(stay.status)) tags.push('no-live-hotel-rate');
  if (stay.status === 'live-inventory-unqualified') tags.push('hotel-quality-failure');
  if (flight.inventoryObserved === true && flight.comfort?.qualified === false) tags.push('flight-comfort-failure');
  return [...new Set(tags)];
}
function compactFlight(flight = {}, staticFlight = {}) {
  return {
    provider: flight.provider || 'Travelpayouts/Aviasales',
    status: flight.status || null,
    evidenceMode: flight.evidenceMode || null,
    providerMappingVerified: flight.providerMappingVerified === true,
    inventoryObserved: flight.inventoryObserved === true,
    productionEligible: flight.productionEligible === true,
    comfortQualified: flight.comfortQualified === true || flight.comfort?.qualified === true,
    destinationCode: flight.destinationCode || null,
    destinationKind: flight.destinationKind || null,
    mappingType: flight.mappingType || null,
    gatewayFallbackUsed: flight.gatewayFallbackUsed === true,
    gatewayRequiredForDestination: Boolean(staticFlight.gateway?.airportCode || staticFlight.mappingType === 'gateway-airport'),
    gateway: flight.gateway || staticFlight.gateway || null,
    verifiedOrigin: flight.verifiedOrigin || null,
    verificationMonth: flight.verificationMonth || null,
    scannedMonths: Array.isArray(flight.scannedMonths) ? flight.scannedMonths : [],
    anchorOrigins: Array.isArray(flight.anchorOrigins) ? flight.anchorOrigins : [],
    observationCount: Number(flight.observationCount || 0),
    sample: flight.sample || null,
    comfort: flight.comfort || null,
    checkedAt: flight.checkedAt || null
  };
}
function compactStay(stay = {}) {
  return {
    provider: stay.provider || 'Agoda',
    status: stay.status || null,
    evidenceMode: stay.evidenceMode || null,
    providerMappingVerified: stay.providerMappingVerified === true,
    inventoryObserved: stay.inventoryObserved === true,
    productionEligible: stay.productionEligible === true,
    qualityQualifiedRate: stay.qualityQualifiedRate === true,
    agodaCityId: stay.agodaCityId ?? null,
    mappingType: stay.mappingType || null,
    checkIn: stay.checkIn || null,
    checkOut: stay.checkOut || null,
    occupancy: stay.occupancy || null,
    occupancyFallbackUsed: stay.occupancyFallbackUsed === true,
    rawHotelCount: Number(stay.rawHotelCount || 0),
    pricedHotelCount: Number(stay.pricedHotelCount || 0),
    structuralQualityCount: Number(stay.structuralQualityCount || 0),
    qualityQualifiedCount: Number(stay.qualityQualifiedCount || 0),
    candidateRetrievalMode: stay.candidateRetrievalMode || null,
    selectedStrategy: stay.selectedStrategy || null,
    rejectionReasons: stay.rejectionReasons || {},
    sample: stay.sample || null,
    reason: stay.reason || null,
    checkedAt: stay.checkedAt || null
  };
}
function validateSource(source, expected) {
  const records = Array.isArray(source.records) ? source.records.filter(Boolean) : [];
  if (source.taskId !== expected.taskId || source.mode !== expected.mode) {
    throw new Error(`Unexpected source identity for ${expected.taskId}/${expected.mode}.`);
  }
  if (Number(source.completedCount) !== expected.count || records.length !== expected.count) {
    throw new Error(`${expected.taskId} must contain exactly ${expected.count} completed records.`);
  }
  if (new Set(records.map(record => record.cityId)).size !== expected.count) {
    throw new Error(`${expected.taskId} contains duplicate city IDs.`);
  }
  if (records.some(record => record.ok !== true || record.version !== 'GV-CITY-668E')) {
    throw new Error(`${expected.taskId} contains a failed or non-668E engine record.`);
  }
  const active = records.filter(record => record.productionActivation?.eligible === true);
  if (active.length !== expected.active) {
    throw new Error(`${expected.taskId} expected ${expected.active} active records, got ${active.length}.`);
  }
  for (const record of active) {
    if (record.live?.travelpayouts?.evidenceMode !== 'production-provider-response' ||
        record.live?.agoda?.evidenceMode !== 'production-provider-response') {
      throw new Error(`Active city ${record.cityId} lacks production-provider evidence.`);
    }
    if (record.recommendationReadiness?.eligible !== true) {
      throw new Error(`Active city ${record.cityId} is not recommendation-ready.`);
    }
  }
  return records;
}

function main() {
  const pilot = readJson(pilotPath);
  const priority = readJson(priorityPath);
  const registry = readJson(registryPath);
  const registryRecords = Array.isArray(registry.records) ? registry.records.filter(Boolean) : [];
  const registryById = new Map(registryRecords.map(record => [record.cityId, record]));

  const pilotRecords = validateSource(pilot, { taskId: 'GV-CITY-668E', mode: 'Pilot100', count: 100, active: 56 });
  const priorityRecords = validateSource(priority, { taskId: 'GV-CITY-668G', mode: 'Priority150', count: 150, active: 120 });
  const pilotIds = new Set(pilotRecords.map(record => record.cityId));
  const overlap = priorityRecords.map(record => record.cityId).filter(cityId => pilotIds.has(cityId));
  if (overlap.length) throw new Error(`Source audits overlap: ${overlap.join(', ')}`);

  const records = [...pilotRecords, ...priorityRecords];
  if (records.length !== 250 || new Set(records.map(record => record.cityId)).size !== 250) {
    throw new Error('Merged audit must contain exactly 250 unique cities.');
  }
  const missingRegistry = records.filter(record => !registryById.has(record.cityId)).map(record => record.cityId);
  if (missingRegistry.length) throw new Error(`Audited cities missing from registry: ${missingRegistry.join(', ')}`);

  const compactRecords = records.map(record => {
    const active = record.productionActivation?.eligible === true;
    const registryRecord = registryById.get(record.cityId) || {};
    return {
      cityId: record.cityId,
      displayName: record.displayName,
      country: record.country,
      countryCode: record.countryCode,
      selectionTier: record.selectionTier,
      worldRegion: registryRecord.worldRegion || null,
      providerLocationCode: record.staticMapping?.travelpayouts?.locationCode || null,
      auditStatus: active ? 'verified-active' : 'reviewed-inactive',
      discoveryEligible: true,
      liveRecommendationEligible: active,
      recommendationMode: active ? 'verified-live-provider-capability' : 'estimate-only',
      classification: record.classification,
      providerCoverage: record.providerCoverage || null,
      recommendationReadiness: record.recommendationReadiness || null,
      activation: {
        eligible: active,
        mode: record.productionActivation?.mode || 'inactive',
        reason: record.productionActivation?.reason || null,
        policyVersion: 'GV-CITY-668H',
        sourcePolicyVersion: record.productionActivation?.activationPolicyVersion || 'GV-CITY-668E',
        sourceAuditTaskId: pilotIds.has(record.cityId) ? 'GV-CITY-668E' : 'GV-CITY-668G',
        lastVerifiedAt: record.lastVerifiedAt || null
      },
      evidence: {
        travelpayouts: compactFlight(record.live?.travelpayouts, record.staticMapping?.travelpayouts),
        agoda: compactStay(record.live?.agoda)
      },
      retryQueues: active ? [] : queueTags(record)
    };
  });

  const active = compactRecords.filter(record => record.liveRecommendationEligible);
  const review = compactRecords.filter(record => !record.liveRecommendationEligible);
  if (active.length !== 176 || review.length !== 74) {
    throw new Error(`Expected 176 active and 74 reviewed inactive records, got ${active.length}/${review.length}.`);
  }

  const current = compactRecords.filter(record => record.selectionTier === 'current-500');
  const expansion = compactRecords.filter(record => record.selectionTier === 'expansion-500');
  const classificationCounts = Object.fromEntries([...new Set(compactRecords.map(record => record.classification))]
    .sort().map(name => [name, compactRecords.filter(record => record.classification === name).length]));
  const activeModeCounts = Object.fromEntries([...new Set(active.map(record => record.activation.mode))]
    .sort().map(name => [name, active.filter(record => record.activation.mode === name).length]));

  const queueNames = ['missing-flight-observations', 'unresolved-agoda-mapping', 'no-live-hotel-rate', 'hotel-quality-failure', 'flight-comfort-failure'];
  const queues = Object.fromEntries(queueNames.map(name => [name, review.filter(record => record.retryQueues.includes(name)).map(record => record.cityId)]));
  const queuePolicies = {
    'missing-flight-observations': 'Retry using future provider windows and additional safe regional origins; absence is not treated as a bad airport mapping.',
    'unresolved-agoda-mapping': 'Keep estimate-only until a reproducible Agoda market/city mapping is available.',
    'no-live-hotel-rate': 'Retry alternate dates; keep static mapping but do not claim live stay coverage.',
    'hotel-quality-failure': 'Keep strict quality floors and retry broader candidate/date windows without weakening standards.',
    'flight-comfort-failure': 'Provider inventory exists, but the sampled route exceeded duration or transfer limits.'
  };
  const queueDetails = Object.fromEntries(queueNames.map(name => [name, {
    count: queues[name].length,
    cityIds: queues[name],
    policy: queuePolicies[name]
  }]));

  const pilotHash = sha256(pilotPath);
  const priorityHash = sha256(priorityPath);
  const generatedAt = priority.completedAt || pilot.completedAt || new Date().toISOString();
  const snapshot = {
    version: '1.0.0',
    taskId: 'GV-CITY-668H',
    status: 'merged-verified-activation-snapshot',
    generatedAt,
    sourceAudits: [
      {
        taskId: pilot.taskId,
        mode: pilot.mode,
        completedAt: pilot.completedAt,
        sourceFile: path.basename(pilotPath),
        sourceFileSha256: pilotHash,
        requestedCount: pilot.requestedCount,
        completedCount: pilot.completedCount,
        providerCoverageEligibleCount: pilot.providerCoverageEligibleCount,
        productionActiveCount: pilot.productionActiveCount,
        reviewCount: pilot.reviewCount,
        requiredEvidenceMode: 'production-provider-response'
      },
      {
        taskId: priority.taskId,
        engineVersion: priority.engineVersion || 'GV-CITY-668E',
        mode: priority.mode,
        completedAt: priority.completedAt,
        sourceFile: path.basename(priorityPath),
        sourceFileSha256: priorityHash,
        requestedCount: priority.requestedCount,
        completedCount: priority.completedCount,
        providerCoverageEligibleCount: priority.providerCoverageEligibleCount,
        productionActiveCount: priority.productionActiveCount,
        reviewCount: priority.reviewCount,
        requiredEvidenceMode: 'production-provider-response'
      }
    ],
    policy: {
      registryCityCount: registryRecords.length,
      auditedCityCount: compactRecords.length,
      allRegistryCitiesRemainDiscoverable: true,
      verifiedLiveRecommendationRequiresImportedActivation: true,
      reviewedInactiveCitiesAreEstimateOnly: true,
      unauditedCitiesAreEstimateOnly: true,
      exactItineraryProviderVerificationStillRequired: true,
      exactItineraryVerificationLayers: ['GV-LIVE-667A', 'GV-LIVE-667B'],
      activationDoesNotGuaranteeCurrentPriceOrBookability: true,
      gatewayLabelsMustRemainVisible: true,
      automaticDeactivationOnAge: false,
      reviewAfterDays: 30,
      staleCapabilityEvidenceStillRequiresExactItineraryRecheck: true
    },
    summary: {
      registryCityCount: registryRecords.length,
      auditedCount: compactRecords.length,
      productionActiveCount: active.length,
      directOrMetroCount: active.filter(record => record.activation.mode === 'direct-or-metro').length,
      gatewaySupportedCount: active.filter(record => record.activation.mode === 'gateway-supported').length,
      auditedInactiveCount: review.length,
      unauditedCount: registryRecords.length - compactRecords.length,
      estimateOnlyCount: registryRecords.length - active.length,
      providerCoveredCount: compactRecords.filter(record => record.providerCoverage?.eligible === true).length,
      current500: {
        audited: current.length,
        productionActive: current.filter(record => record.liveRecommendationEligible).length,
        reviewedInactive: current.filter(record => !record.liveRecommendationEligible).length
      },
      expansion500: {
        audited: expansion.length,
        productionActive: expansion.filter(record => record.liveRecommendationEligible).length,
        reviewedInactive: expansion.filter(record => !record.liveRecommendationEligible).length
      },
      classificationCounts,
      activeModeCounts,
      retryQueueCounts: Object.fromEntries(queueNames.map(name => [name, queues[name].length]))
    },
    records: compactRecords
  };

  const retrySnapshot = {
    version: '1.0.0',
    taskId: 'GV-CITY-668H',
    generatedAt,
    sourceSnapshot: path.basename(activationPath),
    sourceAuditSha256: { pilot100: pilotHash, priority150: priorityHash },
    reviewCityCount: review.length,
    queueMembershipCanOverlap: true,
    queues: queueDetails
  };

  fs.writeFileSync(activationPath, JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(retryPath, JSON.stringify(retrySnapshot, null, 2));
  fs.writeFileSync(activeJsonPath, JSON.stringify({
    version: '1.0.0', taskId: 'GV-CITY-668H', generatedAt, count: active.length,
    sourceAuditSha256: { pilot100: pilotHash, priority150: priorityHash },
    cityIds: active.map(record => record.cityId), records: active
  }, null, 2));
  fs.writeFileSync(reviewJsonPath, JSON.stringify({
    version: '1.0.0', taskId: 'GV-CITY-668H', generatedAt, count: review.length,
    sourceAuditSha256: { pilot100: pilotHash, priority150: priorityHash },
    cityIds: review.map(record => record.cityId), records: review
  }, null, 2));

  const activeRows = active.map(record => ({
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    selectionTier: record.selectionTier,
    sourceAuditTaskId: record.activation.sourceAuditTaskId,
    activationMode: record.activation.mode,
    classification: record.classification,
    providerLocationCode: record.providerLocationCode,
    flightDestinationCode: record.evidence.travelpayouts.destinationCode,
    flightDestinationKind: record.evidence.travelpayouts.destinationKind,
    gatewayCity: record.evidence.travelpayouts.gateway?.gatewayCity || '',
    gatewayAirportCode: record.evidence.travelpayouts.gateway?.airportCode || '',
    gatewayTransferMode: record.evidence.travelpayouts.gateway?.mode || '',
    gatewayTransferMinutes: record.evidence.travelpayouts.gateway?.minutes || '',
    agodaCityId: record.evidence.agoda.agodaCityId,
    lastVerifiedAt: record.activation.lastVerifiedAt
  }));
  const reviewRows = review.map(record => ({
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    selectionTier: record.selectionTier,
    sourceAuditTaskId: record.activation.sourceAuditTaskId,
    classification: record.classification,
    activationReason: record.activation.reason,
    retryQueues: record.retryQueues.join('|'),
    flightStatus: record.evidence.travelpayouts.status,
    stayStatus: record.evidence.agoda.status,
    lastVerifiedAt: record.activation.lastVerifiedAt
  }));
  writeCsv(activeCsvPath, Object.keys(activeRows[0]), activeRows);
  writeCsv(reviewCsvPath, Object.keys(reviewRows[0]), reviewRows);

  console.log(JSON.stringify({
    taskId: snapshot.taskId,
    sourceAuditSha256: { pilot100: pilotHash, priority150: priorityHash },
    audited: snapshot.summary.auditedCount,
    productionActive: snapshot.summary.productionActiveCount,
    reviewedInactive: snapshot.summary.auditedInactiveCount,
    unaudited: snapshot.summary.unauditedCount,
    retryQueueCounts: snapshot.summary.retryQueueCounts
  }, null, 2));
}

main();
