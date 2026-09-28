'use strict';

// GV-CITY-668F — deterministic importer for the verified 668E Pilot100 result.
// This script never calls providers. It only validates and converts an already
// completed production-provider audit into a bounded activation snapshot.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const sourcePath = path.join(root, 'data', 'provider-live-pilot-100-668e-source.json');
const registryPath = path.join(root, 'data', 'unified-city-registry-1000-668b.json');
const activationPath = path.join(root, 'data', 'verified-city-activation-100-668f.json');
const retryPath = path.join(root, 'data', 'verified-city-retry-queues-668f.json');
const activeJsonPath = path.join(root, 'data', 'verified-city-production-active-56-668f.json');
const reviewJsonPath = path.join(root, 'data', 'verified-city-review-44-668f.json');
const activeCsvPath = path.join(root, 'data', 'verified-city-production-active-56-668f.csv');
const reviewCsvPath = path.join(root, 'data', 'verified-city-review-44-668f.csv');

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
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

function main() {
  const source = readJson(sourcePath);
  const registry = readJson(registryPath);
  const records = Array.isArray(source.records) ? source.records.filter(Boolean) : [];
  const registryRecords = Array.isArray(registry.records) ? registry.records.filter(Boolean) : [];

  if (source.taskId !== 'GV-CITY-668E' || source.mode !== 'Pilot100') throw new Error('Source must be the GV-CITY-668E Pilot100 result.');
  if (source.completedCount !== 100 || records.length !== 100) throw new Error('Source audit must contain exactly 100 completed city records.');
  if (new Set(records.map(record => record.cityId)).size !== 100) throw new Error('Source audit contains duplicate city IDs.');
  if (records.some(record => record.ok !== true || record.version !== 'GV-CITY-668E')) throw new Error('Every source record must be a successful 668E result.');

  const activeSource = records.filter(record => record.productionActivation?.eligible === true);
  const inactiveSource = records.filter(record => record.productionActivation?.eligible !== true);
  if (activeSource.length !== 56 || inactiveSource.length !== 44) throw new Error(`Expected 56 active and 44 review records, got ${activeSource.length}/${inactiveSource.length}.`);

  for (const record of activeSource) {
    const flightMode = record.live?.travelpayouts?.evidenceMode;
    const stayMode = record.live?.agoda?.evidenceMode;
    if (flightMode !== 'production-provider-response' || stayMode !== 'production-provider-response') {
      throw new Error(`Active city ${record.cityId} lacks production-provider evidence.`);
    }
    if (record.recommendationReadiness?.eligible !== true) throw new Error(`Active city ${record.cityId} is not recommendation-ready.`);
  }

  const now = source.completedAt || new Date().toISOString();
  const auditIds = new Set(records.map(record => record.cityId));
  const missingRegistry = records.filter(record => !registryRecords.some(item => item.cityId === record.cityId)).map(record => record.cityId);
  if (missingRegistry.length) throw new Error(`Audited cities missing from registry: ${missingRegistry.join(', ')}`);

  const compactRecords = records.map(record => {
    const active = record.productionActivation?.eligible === true;
    const queues = active ? [] : queueTags(record);
    const registryRecord = registryRecords.find(item => item.cityId === record.cityId) || {};
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
        policyVersion: 'GV-CITY-668F',
        sourcePolicyVersion: record.productionActivation?.activationPolicyVersion || 'GV-CITY-668E',
        lastVerifiedAt: record.lastVerifiedAt || null
      },
      evidence: {
        travelpayouts: compactFlight(record.live?.travelpayouts, record.staticMapping?.travelpayouts),
        agoda: compactStay(record.live?.agoda)
      },
      retryQueues: queues
    };
  });

  const active = compactRecords.filter(record => record.liveRecommendationEligible);
  const review = compactRecords.filter(record => !record.liveRecommendationEligible);
  const current = compactRecords.filter(record => record.selectionTier === 'current-500');
  const expansion = compactRecords.filter(record => record.selectionTier === 'expansion-500');
  const classificationCounts = Object.fromEntries([...new Set(compactRecords.map(record => record.classification))]
    .sort().map(name => [name, compactRecords.filter(record => record.classification === name).length]));
  const activeModeCounts = Object.fromEntries([...new Set(active.map(record => record.activation.mode))]
    .sort().map(name => [name, active.filter(record => record.activation.mode === name).length]));

  const queueNames = ['missing-flight-observations', 'unresolved-agoda-mapping', 'no-live-hotel-rate', 'hotel-quality-failure', 'flight-comfort-failure'];
  const queues = Object.fromEntries(queueNames.map(name => [name, review.filter(record => record.retryQueues.includes(name)).map(record => record.cityId)]));
  const queueDetails = Object.fromEntries(queueNames.map(name => [name, {
    count: queues[name].length,
    cityIds: queues[name],
    policy: {
      'missing-flight-observations': 'Retry using future provider windows and additional safe regional origins; absence is not treated as a bad airport mapping.',
      'unresolved-agoda-mapping': 'Keep estimate-only until a reproducible Agoda market/city mapping is available.',
      'no-live-hotel-rate': 'Retry alternate dates; keep static mapping but do not claim live stay coverage.',
      'hotel-quality-failure': 'Keep strict quality floors and retry broader candidate/date windows without weakening standards.',
      'flight-comfort-failure': 'Provider inventory exists, but the sampled route exceeded duration or transfer limits.'
    }[name]
  }]));

  const sourceHash = sha256(sourcePath);
  const snapshot = {
    version: '1.0.0',
    taskId: 'GV-CITY-668F',
    status: 'verified-activation-snapshot',
    generatedAt: now,
    sourceAudit: {
      taskId: source.taskId,
      mode: source.mode,
      completedAt: source.completedAt,
      sourceFile: path.basename(sourcePath),
      sourceFileSha256: sourceHash,
      requestedCount: source.requestedCount,
      completedCount: source.completedCount,
      providerCoverageEligibleCount: source.providerCoverageEligibleCount,
      productionActiveCount: source.productionActiveCount,
      reviewCount: source.reviewCount,
      requiredEvidenceMode: 'production-provider-response'
    },
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
      unauditedCount: registryRecords.length - auditIds.size,
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
    taskId: 'GV-CITY-668F',
    generatedAt: now,
    sourceSnapshot: path.basename(activationPath),
    sourceAuditSha256: sourceHash,
    reviewCityCount: review.length,
    queueMembershipCanOverlap: true,
    queues: queueDetails
  };

  fs.writeFileSync(activationPath, JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(retryPath, JSON.stringify(retrySnapshot, null, 2));
  fs.writeFileSync(activeJsonPath, JSON.stringify({
    version: '1.0.0', taskId: 'GV-CITY-668F', generatedAt: now, count: active.length,
    sourceAuditSha256: sourceHash, cityIds: active.map(record => record.cityId), records: active
  }, null, 2));
  fs.writeFileSync(reviewJsonPath, JSON.stringify({
    version: '1.0.0', taskId: 'GV-CITY-668F', generatedAt: now, count: review.length,
    sourceAuditSha256: sourceHash, cityIds: review.map(record => record.cityId), records: review
  }, null, 2));

  const activeRows = active.map(record => ({
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    selectionTier: record.selectionTier,
    activationMode: record.activation.mode,
    classification: record.classification,
    providerLocationCode: record.providerLocationCode,
    flightDestinationCode: record.evidence.travelpayouts.destinationCode,
    flightDestinationKind: record.evidence.travelpayouts.destinationKind,
    gatewayCity: record.evidence.travelpayouts.gateway?.gatewayCity || '',
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
    sourceAuditSha256: sourceHash,
    audited: snapshot.summary.auditedCount,
    productionActive: snapshot.summary.productionActiveCount,
    reviewedInactive: snapshot.summary.auditedInactiveCount,
    unaudited: snapshot.summary.unauditedCount,
    retryQueueCounts: snapshot.summary.retryQueueCounts
  }, null, 2));
}

main();
