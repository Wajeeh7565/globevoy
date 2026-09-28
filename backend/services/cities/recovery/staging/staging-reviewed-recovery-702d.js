'use strict';

// GV-REC-702D — staging-only QA eligibility overlay.
//
// This module NEVER edits the 668T snapshot. It can only overlay the two
// GV-REC-702C-R2 reviewed recovery candidates in the dedicated staging Lambda,
// and only when the exact staging origin + 668T baseline + explicit QA flag are
// all present. The overlay is dynamic and fails closed when any condition is
// removed.

const reviewedRecovery = require('../reviewed-recovery-overlay-702c-r2');

const VERSION = 'GV-REC-702D';
const FLAG_NAME = 'ENABLE_STAGING_REVIEWED_RECOVERY_702D';
const BASELINE_FLAG = 'ENABLE_VERIFIED_CITY_ACTIVATION_668T';
const REQUIRED_STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const INSTALL_MARK = Symbol.for('globevoy.gv-rec-702d.installed');

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }

function normalizeHttpsOrigin(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    if (parsed.pathname && parsed.pathname !== '/') return '';
    return parsed.origin;
  } catch (_) {
    return '';
  }
}

function enabled(env = process.env) {
  return lower(env[FLAG_NAME]) === 'true'
    && lower(env[BASELINE_FLAG]) === 'true'
    && normalizeHttpsOrigin(env.CORS_ORIGIN) === REQUIRED_STAGING_ORIGIN;
}

function reviewedCandidateForActivation(activation = {}) {
  const cityId = clean(activation.cityId);
  if (!cityId) return null;
  const candidate = reviewedRecovery.resolve(cityId);
  return candidate?.reviewedRecoveryCandidate === true ? candidate : null;
}

function applyOverlay(activation = {}, options = {}) {
  if (!enabled(options.env || process.env)) return activation;
  if (activation?.liveRecommendationEligible === true) return activation;
  const candidate = reviewedCandidateForActivation(activation);
  if (!candidate) return activation;

  const checkedAt = candidate?.freshEvidence?.flight?.checkedAt
    || reviewedRecovery._internal?.evidence?.sourceGeneratedAt
    || null;

  return {
    ...activation,
    auditStatus: 'reviewed-staging-qa',
    liveRecommendationEligible: true,
    recommendationMode: 'verified-live-provider-capability',
    classification: 'reviewed-recovery-staging-qa',
    activation: {
      ...(activation.activation || {}),
      eligible: true,
      mode: 'direct-or-metro',
      reason: 'gv-rec-702d-staging-reviewed-recovery-qa',
      policyVersion: VERSION,
      sourcePolicyVersion: 'GV-CITY-668T',
      lastVerifiedAt: checkedAt
    },
    reviewRecommended: false,
    retryQueues: [],
    stagingReviewedRecovery: {
      version: VERSION,
      sourceProjectionVersion: reviewedRecovery.VERSION,
      sourceEvidenceSha256: reviewedRecovery.summary().sourceEvidenceSha256,
      reviewedRecoveryCandidate: true,
      actualProductionActivationWritten: false,
      stagingQaOnly: true,
      requiresExactItineraryVerification: true
    },
    disclaimer: 'Staging QA overlay only. This does not modify the production activation snapshot and every exact itinerary still requires route/date/price verification.'
  };
}

function install(options = {}) {
  const baseline = options.baseline || require('../../../verified-city-activation');
  if (baseline[INSTALL_MARK]) {
    return {
      ok: true,
      version: VERSION,
      installed: true,
      alreadyInstalled: true,
      enabled: enabled(options.env || process.env)
    };
  }

  const originalActivationForCity = baseline.activationForCity.bind(baseline);
  const originalLiveRecommendationEligible = baseline.liveRecommendationEligible.bind(baseline);

  function activationForCity(input, activationOptions = {}) {
    const base = originalActivationForCity(input, activationOptions);
    return applyOverlay(base, { env: process.env });
  }

  function liveRecommendationEligible(input, activationOptions = {}) {
    // Preserve the legacy rollback contract when verified activation itself is
    // disabled. 702D never turns the global activation gate on by itself.
    if (!baseline.enabled()) return originalLiveRecommendationEligible(input, activationOptions);
    return activationForCity(input, { ...activationOptions, includeEvidence: false }).liveRecommendationEligible === true;
  }

  baseline.activationForCity = activationForCity;
  baseline.liveRecommendationEligible = liveRecommendationEligible;
  Object.defineProperty(baseline, INSTALL_MARK, { value: true, enumerable: false });

  return {
    ok: true,
    version: VERSION,
    installed: true,
    alreadyInstalled: false,
    enabled: enabled(options.env || process.env),
    sourceProjectionVersion: reviewedRecovery.VERSION,
    reviewedRecoveryCandidates: reviewedRecovery.summary().reviewedRecoveryCandidates,
    projectedStagingQaActive: reviewedRecovery.summary().projectedProductionActiveIfPromoted,
    actualProductionActivationWritten: false
  };
}

function status(env = process.env) {
  const projection = reviewedRecovery.summary();
  return {
    ok: true,
    version: VERSION,
    enabled: enabled(env),
    requiredStagingOrigin: REQUIRED_STAGING_ORIGIN,
    baselineActivationVersion: projection.baselineActivationVersion,
    baselineProductionActive: projection.baselineProductionActive,
    reviewedRecoveryCandidates: projection.reviewedRecoveryCandidates,
    effectiveStagingQaActiveIfEnabled: projection.projectedProductionActiveIfPromoted,
    actualProductionActivationWritten: false,
    thresholdsRelaxed: projection.thresholdsRelaxed,
    requiresExactItineraryVerification: true,
    sourceEvidenceSha256: projection.sourceEvidenceSha256
  };
}

module.exports = {
  VERSION,
  FLAG_NAME,
  BASELINE_FLAG,
  REQUIRED_STAGING_ORIGIN,
  enabled,
  applyOverlay,
  install,
  status,
  _internal: { normalizeHttpsOrigin, reviewedCandidateForActivation, INSTALL_MARK }
};
