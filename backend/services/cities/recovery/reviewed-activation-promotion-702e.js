'use strict';

// GV-REC-702E — reviewed production-activation candidate.
//
// This module is deliberately NOT wired into Lambda/runtime selection. It builds
// a deterministic projection over the immutable GV-CITY-668T coverage state so
// reviewers can prove exactly which records would change before any production
// activation work is approved.

const coverage702a = require('../../admin/audits/global-recommendation-coverage-702a');
const reviewedRecovery = require('./reviewed-recovery-overlay-702c-r2');
const manifest = require('../../../data/gv-rec-702e-promotion-manifest.json');

const VERSION = 'GV-REC-702E';
const BASELINE_VERSION = 'GV-CITY-668T';
const BASELINE_ACTIVE = 439;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const promotionById = new Map((manifest.cities || []).map(row => [row.cityId, row]));

function projectionForRecord(record = {}) {
  const promotion = promotionById.get(record.cityId) || null;
  if (!promotion) return clone(record);

  const reviewed = reviewedRecovery.resolve(record.cityId);
  const qualifies = reviewed?.reviewedRecoveryCandidate === true
    && reviewed?.freshEvidenceQualified === true
    && record?.readiness?.productionActive === false
    && record?.readiness?.tier === 'mapped-reviewed-inactive'
    && record?.readiness?.primaryGap === `retry-queue:${promotion.historicalRetryQueue}`;

  if (!qualifies) {
    return {
      ...clone(record),
      promotionCandidate: false,
      promotionRejected: true,
      promotionRejectReason: 'reviewed-evidence-or-historical-boundary-mismatch',
      candidateVersion: VERSION,
      actualProductionActivationWritten: false
    };
  }

  return {
    ...clone(record),
    activation: {
      ...clone(record.activation),
      auditStatus: 'reviewed-active-candidate',
      liveRecommendationEligible: true,
      recommendationMode: 'verified-live-provider-capability',
      classification: promotion.proposedClassification,
      activationMode: promotion.proposedActivationMode,
      activationReason: 'gv-rec-702e-reviewed-recovery-candidate',
      lastVerifiedAt: promotion.reviewedEvidenceCheckedAt,
      retryQueues: []
    },
    readiness: {
      ...clone(record.readiness),
      tier: 'production-active',
      productionActive: true,
      primaryGap: null,
      gapCodes: [],
      activationReason: 'gv-rec-702e-reviewed-recovery-candidate',
      classification: promotion.proposedClassification,
      requiresExactItineraryVerification: true
    },
    promotionCandidate: true,
    promotionPolicyVersion: promotion.proposedPolicyVersion,
    sourceEvidenceSha256: promotion.sourceEvidenceSha256,
    actualProductionActivationWritten: false,
    requiresExactItineraryVerification: true
  };
}

function projectedRecords() {
  return coverage702a._internal.auditedRecords().map(projectionForRecord);
}

function summary() {
  const baseline = coverage702a._internal.auditedRecords();
  const projected = projectedRecords();
  const changed = projected.filter((record, index) =>
    record.readiness.productionActive !== baseline[index].readiness.productionActive
  );
  const rejected = projected.filter(record => record.promotionRejected === true);
  const projectedActive = projected.filter(record => record.readiness.productionActive === true).length;

  return {
    ok: true,
    version: VERSION,
    status: rejected.length ? 'promotion-candidate-blocked' : 'promotion-candidate-ready',
    baselineActivationVersion: BASELINE_VERSION,
    baselineProductionActive: BASELINE_ACTIVE,
    baselineRecordCount: baseline.length,
    reviewedPromotionCount: promotionById.size,
    changedRecordCount: changed.length,
    changedCityIds: changed.map(record => record.cityId),
    rejectedPromotionCount: rejected.length,
    projectedProductionActive: projectedActive,
    sourceEvidenceSha256: manifest.sourceEvidenceSha256,
    thresholdsRelaxed: manifest.thresholdsRelaxed === true,
    requiresExactItineraryVerification: true,
    actualProductionActivationWritten: false,
    productionDeploymentPerformed: false,
    records: projected.filter(record => promotionById.has(record.cityId)),
    disclaimer: 'Candidate projection only. No Lambda/runtime code imports this service and no production activation decision is written by GV-REC-702E.'
  };
}

function resolve(input) {
  const key = String(input || '').trim().toLowerCase();
  if (!key) return null;
  return projectedRecords().find(record =>
    String(record.cityId || '').toLowerCase() === key
    || String(record.displayName || '').toLowerCase() === key
  ) || null;
}

module.exports = {
  VERSION,
  BASELINE_VERSION,
  BASELINE_ACTIVE,
  summary,
  resolve,
  projectedRecords,
  _internal: { manifest, promotionById, projectionForRecord }
};
