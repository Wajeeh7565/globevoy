'use strict';

// GV-FLIGHT-703D — staging-only bounded expansion of 684B affordable-flight discovery.
//
// This module does NOT enable Duffel, add/copy credentials, alter booking/payment/
// order/ticketing capability, or change production. It only injects the already-
// proven five-origin cohort into 684B inside the isolated staging process.

const stagingDuffel703B = require('../duffel/staging/staging-duffel-five-origin-703b');

const VERSION = 'GV-FLIGHT-703D';
const REQUIRED_STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const ORIGIN_ENV = 'GV_DUFFEL_AFFORDABLE_DISCOVERY_ORIGINS_684B';
const ORIGINS = Object.freeze(stagingDuffel703B.ORIGINS.slice());
const REQUIRED_SHARED_BUDGET_VERSION = 'GV-FLIGHT-703C';
const REQUIRED_SHARED_BUDGET_CAP = 8;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeOrigin(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    if (parsed.pathname && parsed.pathname !== '/') return '';
    return parsed.origin;
  } catch (_) {
    return '';
  }
}

function normalizedAllowlist(value = '') {
  return [...new Set(clean(value)
    .split(',')
    .map(code => code.trim().toUpperCase())
    .filter(code => /^[A-Z]{3}$/.test(code)))];
}

function enabled(env = process.env) {
  return normalizeOrigin(env.CORS_ORIGIN) === REQUIRED_STAGING_ORIGIN;
}

function install(env = process.env) {
  if (!enabled(env)) {
    return {
      ok: true,
      version: VERSION,
      enabled: false,
      applied: false,
      origins: [],
      productionChanged: false
    };
  }

  const desired = ORIGINS.slice();
  const finalScheduleOrigins = normalizedAllowlist(env[stagingDuffel703B.ORIGIN_ENV]);
  if (JSON.stringify(finalScheduleOrigins) !== JSON.stringify(desired)) {
    return {
      ok: false,
      version: VERSION,
      enabled: true,
      applied: false,
      reason: '703d-requires-703b-five-origin-policy-first',
      finalScheduleOrigins,
      desired
    };
  }

  const existingRaw = clean(env[ORIGIN_ENV]);
  if (existingRaw) {
    const existing = normalizedAllowlist(existingRaw);
    if (JSON.stringify(existing) !== JSON.stringify(desired)) {
      return {
        ok: false,
        version: VERSION,
        enabled: true,
        applied: false,
        reason: '703d-existing-684b-origin-allowlist-conflict',
        existing,
        desired
      };
    }
  }

  env[ORIGIN_ENV] = desired.join(',');
  return {
    ok: true,
    version: VERSION,
    enabled: true,
    applied: true,
    origins: desired,
    publicLiveFarePilotEnabledBy703D: false,
    providerCredentialsChanged: false,
    awsEnvironmentVariablesAdded: 0,
    sharedBudgetRequired: REQUIRED_SHARED_BUDGET_VERSION,
    sharedBudgetCapRequired: REQUIRED_SHARED_BUDGET_CAP,
    candidateCapPreserved: 2,
    maxFlightLegsPreserved: 3,
    singleAdultGuardPreserved: true,
    productionChanged: false
  };
}

function status(env = process.env) {
  return {
    version: VERSION,
    enabled: enabled(env),
    requiredStagingOrigin: REQUIRED_STAGING_ORIGIN,
    originEnv: ORIGIN_ENV,
    origins: ORIGINS.slice(),
    currentOrigins: normalizedAllowlist(env[ORIGIN_ENV]),
    finalScheduleOrigins: normalizedAllowlist(env[stagingDuffel703B.ORIGIN_ENV]),
    publicLiveFarePilotEnabledBy703D: false,
    providerCredentialsChanged: false,
    awsEnvironmentVariablesAdded: 0,
    sharedBudgetRequired: REQUIRED_SHARED_BUDGET_VERSION,
    sharedBudgetCapRequired: REQUIRED_SHARED_BUDGET_CAP,
    candidateCapPreserved: 2,
    maxFlightLegsPreserved: 3,
    singleAdultGuardPreserved: true,
    completeLiveEvidenceRequired: true,
    lowestCostGroundOptionPreserved: true,
    productionChanged: false,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
  };
}

module.exports = {
  VERSION,
  REQUIRED_STAGING_ORIGIN,
  ORIGIN_ENV,
  ORIGINS,
  REQUIRED_SHARED_BUDGET_VERSION,
  REQUIRED_SHARED_BUDGET_CAP,
  enabled,
  install,
  status,
  _internal: {
    normalizeOrigin,
    normalizedAllowlist
  }
};
