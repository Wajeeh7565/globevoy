'use strict';

// GV-FLIGHT-703E — staging-only two-adult live-fare integrity policy.
//
// This overlay changes only the in-process adult ceiling from one to two after
// the previously proven 703B/703C/703D staging safeguards are present. It does
// not enable Duffel, add/copy credentials, add an AWS Lambda environment key,
// expand origins, increase request/candidate/leg caps, or add transaction paths.

const policy703B = require('./staging-duffel-five-origin-703b');
const shared703C = require('./staging-duffel-shared-budget-703c');
const policy703D = require('../../staging/staging-affordable-flight-five-origin-703d');
const adultScope = require('../duffel-adult-scope-703e');

const VERSION = 'GV-FLIGHT-703E';
const REQUIRED_SHARED_BUDGET_VERSION = 'GV-FLIGHT-703C';
const REQUIRED_SHARED_BUDGET_CAP = 8;
const REQUIRED_ORIGINS = Object.freeze(['YYZ', 'JFK', 'LAX', 'DUB', 'DXB']);

function enabled(env = process.env) {
  return adultScope._internal.normalizeOrigin(env?.CORS_ORIGIN) === adultScope.REQUIRED_STAGING_ORIGIN;
}

function sameOrigins(actual = []) {
  return JSON.stringify(actual) === JSON.stringify(REQUIRED_ORIGINS);
}

function install(env = process.env) {
  if (!enabled(env)) {
    return { ok: true, version: VERSION, enabled: false, applied: false, maxAdults: 1, productionChanged: false };
  }

  const finalScheduleOrigins = policy703B._internal.normalizedAllowlist(env[policy703B.ORIGIN_ENV]);
  const discoveryOrigins = policy703D._internal.normalizedAllowlist(env[policy703D.ORIGIN_ENV]);
  if (!sameOrigins(finalScheduleOrigins) || !sameOrigins(discoveryOrigins)) {
    return {
      ok: false,
      version: VERSION,
      enabled: true,
      applied: false,
      reason: '703e-requires-703b-and-703d-five-origin-policies-first',
      finalScheduleOrigins,
      discoveryOrigins,
      requiredOrigins: REQUIRED_ORIGINS.slice()
    };
  }

  if (shared703C.VERSION !== REQUIRED_SHARED_BUDGET_VERSION || shared703C.SHARED_PHYSICAL_REQUEST_CAP !== REQUIRED_SHARED_BUDGET_CAP) {
    return {
      ok: false,
      version: VERSION,
      enabled: true,
      applied: false,
      reason: '703e-requires-703c-shared-budget-cap-8',
      sharedBudgetVersion: shared703C.VERSION,
      sharedBudgetCap: shared703C.SHARED_PHYSICAL_REQUEST_CAP
    };
  }

  const existing = String(env[adultScope.MAX_ADULTS_ENV] || '').trim();
  if (existing && existing !== String(adultScope.STAGING_MAX_ADULTS)) {
    return {
      ok: false,
      version: VERSION,
      enabled: true,
      applied: false,
      reason: '703e-existing-max-adults-conflict',
      existing,
      desired: adultScope.STAGING_MAX_ADULTS
    };
  }

  env[adultScope.MAX_ADULTS_ENV] = String(adultScope.STAGING_MAX_ADULTS);
  return {
    ok: true,
    version: VERSION,
    enabled: true,
    applied: true,
    maxAdults: adultScope.configuredMaxAdults703E(env),
    childrenAllowed: false,
    infantsAllowed: false,
    sharedBudgetVersion: shared703C.VERSION,
    sharedBudgetCap: shared703C.SHARED_PHYSICAL_REQUEST_CAP,
    origins: REQUIRED_ORIGINS.slice(),
    publicLiveFarePilotEnabledBy703E: false,
    providerCredentialsChanged: false,
    awsEnvironmentVariablesAdded: 0,
    candidateCapPreserved: 2,
    maxFlightLegsPreserved: 3,
    productionChanged: false,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
  };
}

function status(env = process.env) {
  return {
    version: VERSION,
    enabled: enabled(env),
    appliedAdultScope: adultScope.status703E(env),
    requiredOrigins: REQUIRED_ORIGINS.slice(),
    finalScheduleOrigins: policy703B._internal.normalizedAllowlist(env[policy703B.ORIGIN_ENV]),
    discoveryOrigins: policy703D._internal.normalizedAllowlist(env[policy703D.ORIGIN_ENV]),
    sharedBudgetVersion: shared703C.VERSION,
    sharedBudgetCap: shared703C.SHARED_PHYSICAL_REQUEST_CAP,
    publicLiveFarePilotEnabledBy703E: false,
    providerCredentialsChanged: false,
    awsEnvironmentVariablesAdded: 0,
    productionChanged: false,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
  };
}

module.exports = {
  VERSION,
  REQUIRED_SHARED_BUDGET_VERSION,
  REQUIRED_SHARED_BUDGET_CAP,
  REQUIRED_ORIGINS,
  enabled,
  install,
  status
};
