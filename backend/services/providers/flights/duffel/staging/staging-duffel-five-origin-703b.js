'use strict';

// GV-FLIGHT-703B — staging-only five-origin final-schedule Duffel policy.
// This module changes only the 684A origin allowlist inside the isolated staging
// process. It does NOT enable Duffel, add credentials, expand 684B discovery,
// or change booking/payment/ticketing capability.

const VERSION = 'GV-FLIGHT-703B';
const REQUIRED_STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const ORIGIN_ENV = 'GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A';
const ORIGINS = Object.freeze(['YYZ', 'JFK', 'LAX', 'DUB', 'DXB']);

function clean(value) { return String(value == null ? '' : value).trim(); }
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

function enabled(env = process.env) {
  return normalizeOrigin(env.CORS_ORIGIN) === REQUIRED_STAGING_ORIGIN;
}

function normalizedAllowlist(value) {
  return [...new Set(clean(value).split(',').map(v => v.trim().toUpperCase()).filter(v => /^[A-Z]{3}$/.test(v)))];
}

function install(env = process.env) {
  if (!enabled(env)) {
    return { ok: true, version: VERSION, enabled: false, applied: false, origins: [] };
  }

  const desired = ORIGINS.slice();
  const existingRaw = clean(env[ORIGIN_ENV]);
  if (existingRaw) {
    const existing = normalizedAllowlist(existingRaw);
    if (JSON.stringify(existing) !== JSON.stringify(desired)) {
      return {
        ok: false,
        version: VERSION,
        enabled: true,
        applied: false,
        reason: '703b-existing-684a-origin-allowlist-conflict',
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
    publicLiveFarePilotEnabledBy703B: false,
    providerCredentialsChanged: false,
    affordableDiscovery684BExpanded: false,
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
    publicLiveFarePilotEnabledBy703B: false,
    providerCredentialsChanged: false,
    affordableDiscovery684BExpanded: false,
    productionChanged: false,
    singleAdultGuardPreserved: true,
    maxFlightLegsPreserved: 3,
    exactDateGuardPreserved: true,
    allLegsLiveGuardPreserved: true
  };
}

module.exports = {
  VERSION,
  REQUIRED_STAGING_ORIGIN,
  ORIGIN_ENV,
  ORIGINS,
  enabled,
  install,
  status,
  _internal: { normalizeOrigin, normalizedAllowlist }
};
