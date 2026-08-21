'use strict';

// GV-FLIGHT-703E — shared adult-party scope for the staging-only two-adult
// Duffel fare-integrity pilot. Production/default behavior remains one adult.

const VERSION = 'GV-FLIGHT-703E';
const REQUIRED_STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const MAX_ADULTS_ENV = 'GV_DUFFEL_MAX_ADULTS_703E';
const DEFAULT_MAX_ADULTS = 1;
const STAGING_MAX_ADULTS = 2;

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

function configuredMaxAdults703E(env = process.env) {
  if (normalizeOrigin(env?.CORS_ORIGIN) !== REQUIRED_STAGING_ORIGIN) return DEFAULT_MAX_ADULTS;
  const requested = Number(clean(env?.[MAX_ADULTS_ENV]));
  return requested === STAGING_MAX_ADULTS ? STAGING_MAX_ADULTS : DEFAULT_MAX_ADULTS;
}

function adultPartyEligibility703E(party = {}, env = process.env) {
  const maxAdults = configuredMaxAdults703E(env);
  const adults = Number(party?.adults || 0);
  const children = Number(party?.children || 0);
  const infants = Number(party?.infants || 0);
  const travellers = Number(party?.travellers || 0);
  const eligible = Number.isInteger(adults)
    && adults >= 1
    && adults <= maxAdults
    && children === 0
    && infants === 0
    && travellers === adults;
  return {
    eligible,
    maxAdults,
    adults,
    children,
    infants,
    travellers,
    reason: eligible
      ? null
      : (maxAdults === 1 ? 'single-adult-only' : 'one-or-two-adults-only-no-children-infants')
  };
}

function status703E(env = process.env) {
  const maxAdults = configuredMaxAdults703E(env);
  return {
    version: VERSION,
    requiredStagingOrigin: REQUIRED_STAGING_ORIGIN,
    maxAdultsEnv: MAX_ADULTS_ENV,
    defaultMaxAdults: DEFAULT_MAX_ADULTS,
    stagingMaxAdults: STAGING_MAX_ADULTS,
    configuredMaxAdults: maxAdults,
    twoAdultStagingScopeActive: maxAdults === STAGING_MAX_ADULTS,
    childrenAllowed: false,
    infantsAllowed: false
  };
}

module.exports = {
  VERSION,
  REQUIRED_STAGING_ORIGIN,
  MAX_ADULTS_ENV,
  DEFAULT_MAX_ADULTS,
  STAGING_MAX_ADULTS,
  configuredMaxAdults703E,
  adultPartyEligibility703E,
  status703E,
  _internal: { normalizeOrigin }
};
