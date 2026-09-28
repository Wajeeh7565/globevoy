'use strict';

// GV-CITY-668R — deterministic merge of the reviewed GV-CITY-668P
// 845-city activation baseline with the completed GV-CITY-668Q Final155
// production-provider audit. This script never calls providers.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const baselinePath = path.join(root, 'data', 'verified-city-activation-845-668p.json');
const final155Path = path.join(root, 'data', 'provider-live-final155-668q-source.json');
const registryPath = path.join(root, 'data', 'unified-city-registry-1000-668b.json');
const activationPath = path.join(root, 'data', 'verified-city-activation-1000-668r.json');
const retryPath = path.join(root, 'data', 'verified-city-retry-queues-668r.json');
const activeJsonPath = path.join(root, 'data', 'verified-city-production-active-421-668r.json');
const reviewJsonPath = path.join(root, 'data', 'verified-city-review-579-668r.json');
const activeCsvPath = path.join(root, 'data', 'verified-city-production-active-421-668r.csv');
const reviewCsvPath = path.join(root, 'data', 'verified-city-review-579-668r.csv');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
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
function validateBaseline(source) {
  const records = Array.isArray(source.records) ? source.records.filter(Boolean) : [];
  if (source.taskId !== 'GV-CITY-668P' || source.status !== 'merged-verified-activation-snapshot') {
    throw new Error('Unexpected 668P baseline identity.');
  }
  if (records.length !== 845 || new Set(records.map(record => record.cityId)).size !== 845) {
    throw new Error('668P baseline must contain 845 unique audited records.');
  }
  const active = records.filter(record => record.liveRecommendationEligible === true);
  const review = records.filter(record => record.liveRecommendationEligible !== true);
  if (active.length !== 420 || review.length !== 425) {
    throw new Error(`668P baseline expected 420 active and 425 review, got ${active.length}/${review.length}.`);
  }
  for (const record of active) {
    if (record.evidence?.travelpayouts?.evidenceMode !== 'production-provider-response' ||
        record.evidence?.agoda?.evidenceMode !== 'production-provider-response' ||
        record.recommendationReadiness?.eligible !== true) {
      throw new Error(`Baseline active city ${record.cityId} lacks required production evidence/readiness.`);
    }
  }
  return records;
}
function validateFinal155(source) {
  const records = Array.isArray(source.records) ? source.records.filter(Boolean) : [];
  if (source.taskId !== 'GV-CITY-668Q' || source.mode !== 'Final155') {
    throw new Error('Unexpected 668Q source identity.');
  }
  if (Number(source.completedCount) !== 155 || records.length !== 155 || new Set(records.map(record => record.cityId)).size !== 155) {
    throw new Error('668Q source must contain exactly 155 unique completed records.');
  }
  if (records.some(record => record.ok !== true || record.version !== 'GV-CITY-668E' || record.selectionTier !== 'expansion-500')) {
    throw new Error('668Q source contains a failed, non-668E, or non-Expansion-500 record.');
  }
  const active = records.filter(record => record.productionActivation?.eligible === true);
  if (active.length !== 1 || Number(source.productionActiveCount) !== 1 || Number(source.reviewCount) !== 154) {
    throw new Error(`668Q expected 1 active and 154 review, got ${active.length}/${records.length - active.length}.`);
  }
  if (Number(source.providerCoverageEligibleCount) !== 4 ||
      Number(source.projectedMergedProductionActiveCount) !== 421 ||
      Number(source.projectedTotalAuditedCount) !== 1000 ||
      Number(source.projectedExpansion500AuditedCount) !== 500 ||
      Number(source.projectedRemainingUnauditedCount) !== 0 ||
      source.activationImportRequired !== true) {
    throw new Error('668Q source does not prove the expected 4/421/1000/500/0 merge targets.');
  }
  for (const record of active) {
    if (record.live?.travelpayouts?.evidenceMode !== 'production-provider-response' ||
        record.live?.agoda?.evidenceMode !== 'production-provider-response' ||
        record.recommendationReadiness?.eligible !== true) {
      throw new Error(`668Q active city ${record.cityId} lacks required production evidence/readiness.`);
    }
  }
  return records;
}

function main() {
  const baseline = readJson(baselinePath);
  const final155 = readJson(final155Path);
  const registry = readJson(registryPath);
  const registryRecords = Array.isArray(registry.records) ? registry.records.filter(Boolean) : [];
  const registryById = new Map(registryRecords.map(record => [record.cityId, record]));

  const baselineRecords = validateBaseline(baseline);
  const finalRecords = validateFinal155(final155);
  const baselineIds = new Set(baselineRecords.map(record => record.cityId));
  const overlap = finalRecords.map(record => record.cityId).filter(cityId => baselineIds.has(cityId));
  if (overlap.length) throw new Error(`668P and 668Q overlap: ${overlap.join(', ')}`);

  const importedBaseline = baselineRecords.map(record => ({
    ...clone(record),
    activation: {
      ...clone(record.activation),
      policyVersion: 'GV-CITY-668R',
      importedFromSnapshotTaskId: 'GV-CITY-668P'
    }
  }));

  const compactFinal = finalRecords.map(record => {
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
        policyVersion: 'GV-CITY-668R',
        sourcePolicyVersion: record.productionActivation?.activationPolicyVersion || 'GV-CITY-668E',
        sourceAuditTaskId: 'GV-CITY-668Q',
        importedFromSnapshotTaskId: null,
        lastVerifiedAt: record.lastVerifiedAt || null
      },
      evidence: {
        travelpayouts: compactFlight(record.live?.travelpayouts, record.staticMapping?.travelpayouts),
        agoda: compactStay(record.live?.agoda)
      },
      retryQueues: active ? [] : queueTags(record)
    };
  });

  const records = [...importedBaseline, ...compactFinal];
  if (records.length !== 1000 || new Set(records.map(record => record.cityId)).size !== 1000) {
    throw new Error('Merged audit must contain exactly 1,000 unique cities.');
  }
  const missingRegistry = records.filter(record => !registryById.has(record.cityId)).map(record => record.cityId);
  if (missingRegistry.length) throw new Error(`Audited cities missing from registry: ${missingRegistry.join(', ')}`);

  const active = records.filter(record => record.liveRecommendationEligible === true);
  const review = records.filter(record => record.liveRecommendationEligible !== true);
  if (active.length !== 421 || review.length !== 579) {
    throw new Error(`Expected 421 active and 579 reviewed inactive, got ${active.length}/${review.length}.`);
  }

  const current = records.filter(record => record.selectionTier === 'current-500');
  const expansion = records.filter(record => record.selectionTier === 'expansion-500');
  if (current.length !== 500) throw new Error(`Current-500 audit completion regressed: ${current.length}/500.`);
  if (expansion.length !== 500) throw new Error(`Expansion-500 audit completion expected 500, got ${expansion.length}.`);

  const classificationCounts = Object.fromEntries([...new Set(records.map(record => record.classification))]
    .sort().map(name => [name, records.filter(record => record.classification === name).length]));
  const activeModeCounts = Object.fromEntries([...new Set(active.map(record => record.activation.mode))]
    .sort().map(name => [name, active.filter(record => record.activation.mode === name).length]));

  const queueNames = ['missing-flight-observations', 'unresolved-agoda-mapping', 'no-live-hotel-rate', 'hotel-quality-failure', 'flight-comfort-failure'];
  const queues = Object.fromEntries(queueNames.map(name => [name, review.filter(record => (record.retryQueues || []).includes(name)).map(record => record.cityId)]));
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

  const baselineHash = sha256(baselinePath);
  const final155Hash = sha256(final155Path);
  const generatedAt = final155.completedAt || new Date().toISOString();
  const sourceAudits = [
    ...(Array.isArray(baseline.sourceAudits) ? clone(baseline.sourceAudits) : []),
    {
      taskId: final155.taskId,
      engineVersion: final155.engineVersion || 'GV-CITY-668E',
      mode: final155.mode,
      completedAt: final155.completedAt,
      sourceFile: path.basename(final155Path),
      sourceFileSha256: final155Hash,
      requestedCount: final155.requestedCount,
      completedCount: final155.completedCount,
      providerCoverageEligibleCount: final155.providerCoverageEligibleCount,
      productionActiveCount: final155.productionActiveCount,
      reviewCount: final155.reviewCount,
      requiredEvidenceMode: 'production-provider-response'
    }
  ];

  const snapshot = {
    version: '1.0.0',
    taskId: 'GV-CITY-668R',
    status: 'merged-verified-activation-snapshot',
    generatedAt,
    sourceSnapshots: [{
      taskId: baseline.taskId,
      generatedAt: baseline.generatedAt,
      sourceFile: path.basename(baselinePath),
      sourceFileSha256: baselineHash,
      auditedCount: baseline.summary?.auditedCount,
      productionActiveCount: baseline.summary?.productionActiveCount
    }],
    sourceAudits,
    policy: {
      registryCityCount: registryRecords.length,
      auditedCityCount: records.length,
      fullRegistryAuditComplete: true,
      current500AuditComplete: true,
      current500AuditedCount: current.length,
      expansion500AuditComplete: true,
      expansion500AuditedCount: expansion.length,
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
      auditedCount: records.length,
      productionActiveCount: active.length,
      directOrMetroCount: active.filter(record => record.activation.mode === 'direct-or-metro').length,
      gatewaySupportedCount: active.filter(record => record.activation.mode === 'gateway-supported').length,
      auditedInactiveCount: review.length,
      unauditedCount: registryRecords.length - records.length,
      estimateOnlyCount: registryRecords.length - active.length,
      providerCoveredCount: records.filter(record => record.providerCoverage?.eligible === true).length,
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
    records
  };

  const retrySnapshot = {
    version: '1.0.0',
    taskId: 'GV-CITY-668R',
    generatedAt,
    sourceSnapshot: path.basename(activationPath),
    sourceSnapshotSha256: { baseline845: baselineHash },
    sourceAuditSha256: { final155: final155Hash },
    reviewCityCount: review.length,
    queueMembershipCanOverlap: true,
    queues: queueDetails
  };

  fs.writeFileSync(activationPath, JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(retryPath, JSON.stringify(retrySnapshot, null, 2));
  fs.writeFileSync(activeJsonPath, JSON.stringify({
    version: '1.0.0', taskId: 'GV-CITY-668R', generatedAt, count: active.length,
    sourceSnapshotSha256: { baseline845: baselineHash }, sourceAuditSha256: { final155: final155Hash },
    cityIds: active.map(record => record.cityId), records: active
  }, null, 2));
  fs.writeFileSync(reviewJsonPath, JSON.stringify({
    version: '1.0.0', taskId: 'GV-CITY-668R', generatedAt, count: review.length,
    sourceSnapshotSha256: { baseline845: baselineHash }, sourceAuditSha256: { final155: final155Hash },
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
    retryQueues: (record.retryQueues || []).join('|'),
    flightStatus: record.evidence.travelpayouts.status,
    stayStatus: record.evidence.agoda.status,
    lastVerifiedAt: record.activation.lastVerifiedAt
  }));
  writeCsv(activeCsvPath, Object.keys(activeRows[0]), activeRows);
  writeCsv(reviewCsvPath, Object.keys(reviewRows[0]), reviewRows);

  console.log(JSON.stringify({
    taskId: snapshot.taskId,
    baselineSnapshotSha256: baselineHash,
    final155AuditSha256: final155Hash,
    audited: snapshot.summary.auditedCount,
    current500Audited: snapshot.summary.current500.audited,
    expansion500Audited: snapshot.summary.expansion500.audited,
    productionActive: snapshot.summary.productionActiveCount,
    reviewedInactive: snapshot.summary.auditedInactiveCount,
    unaudited: snapshot.summary.unauditedCount,
    directOrMetro: snapshot.summary.directOrMetroCount,
    gatewaySupported: snapshot.summary.gatewaySupportedCount,
    retryQueueCounts: snapshot.summary.retryQueueCounts
  }, null, 2));
}

main();
