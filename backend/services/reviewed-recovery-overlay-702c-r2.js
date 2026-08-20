'use strict';

const coverage702a = require('./global-recommendation-coverage-702a');
const evidence = require('../data/gv-rec-702c-r2-reviewed-evidence-manifest.json');

const VERSION = 'GV-REC-702C-R2';
const BASELINE_ACTIVE = 439;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function evidenceQualifies(city = {}) {
  return city?.flight?.status === 'live'
    && city?.flight?.providerMappingVerified === true
    && city?.flight?.productionEligible === true
    && city?.flight?.inventoryObserved === true
    && city?.flight?.comfortQualified === true
    && city?.flight?.evidenceMode === 'production-provider-response'
    && city?.stay?.status === 'live'
    && city?.stay?.providerMappingVerified === true
    && city?.stay?.productionEligible === true
    && city?.stay?.inventoryObserved === true
    && city?.stay?.qualityQualifiedRate === true;
}

function baselineRecord(cityId) {
  return coverage702a._internal.auditedRecords().find(record => record.cityId === cityId) || null;
}

function reviewedRecords() {
  return (Array.isArray(evidence.cities) ? evidence.cities : []).map(city => {
    const baseline = baselineRecord(city.cityId);
    const baselineEligible = baseline
      && baseline.readiness?.productionActive === false
      && baseline.readiness?.tier === 'mapped-reviewed-inactive'
      && baseline.readiness?.primaryGap === city.historicalPrimaryGap;
    const freshEvidenceQualified = evidenceQualifies(city);
    return {
      cityId: city.cityId,
      displayName: city.displayName,
      countryCode: city.countryCode,
      baseline: baseline ? {
        productionActive: baseline.readiness?.productionActive === true,
        readinessTier: baseline.readiness?.tier || null,
        primaryGap: baseline.readiness?.primaryGap || null,
        activationReason: baseline.readiness?.activationReason || null,
        lastVerifiedAt: baseline.activation?.lastVerifiedAt || null
      } : null,
      freshEvidence: clone({ flight: city.flight, stay: city.stay }),
      historicalBoundarySatisfied: Boolean(baselineEligible),
      freshEvidenceQualified,
      reviewedRecoveryCandidate: Boolean(baselineEligible && freshEvidenceQualified),
      projectedLiveRecommendationEligibleIfPromoted: Boolean(baselineEligible && freshEvidenceQualified),
      currentlyProductionActive: false,
      activationWritten: false,
      projectionOnly: true,
      requiresExactItineraryVerification: true
    };
  });
}

function summary() {
  const records = reviewedRecords();
  const candidates = records.filter(record => record.reviewedRecoveryCandidate);
  return {
    ok: true,
    version: VERSION,
    status: 'reviewed-recovery-overlay-ready',
    sourceEvidenceVersion: evidence.sourceEvidenceVersion,
    sourceEvidenceSha256: evidence.sourceEvidenceSha256,
    sourceGeneratedAt: evidence.sourceGeneratedAt,
    baselineActivationVersion: 'GV-CITY-668T',
    baselineProductionActive: BASELINE_ACTIVE,
    reviewedRecoveryCandidates: candidates.length,
    projectedProductionActiveIfPromoted: BASELINE_ACTIVE + candidates.length,
    actualActivationWritten: false,
    thresholdsRelaxed: evidence.thresholdsRelaxed === true,
    requiresExactItineraryVerification: true,
    records,
    disclaimer: 'This overlay is projection-only. It does not modify GV-CITY-668T, the recommendation allowlist, or production behavior.'
  };
}

function resolve(input) {
  const normalized = String(input || '').trim().toLowerCase();
  if (!normalized) return null;
  return reviewedRecords().find(record =>
    record.cityId.toLowerCase() === normalized
    || record.displayName.toLowerCase() === normalized
    || record.countryCode.toLowerCase() === normalized
  ) || null;
}

module.exports = {
  VERSION,
  BASELINE_ACTIVE,
  summary,
  resolve,
  _internal: { evidence, evidenceQualifies, baselineRecord, reviewedRecords }
};
