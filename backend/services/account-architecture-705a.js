'use strict';

// GV-ACCOUNT-705A — pure account + saved-trip architecture contract.
//
// No Cognito, DynamoDB, network, JWT cryptography, AWS deployment or credential
// access happens in this module. 705A exists to lock the security/data boundary
// before 705B creates any real account infrastructure.

const VERSION = 'GV-ACCOUNT-705A';
const AUTH_PROVIDER = 'Amazon-Cognito-User-Pools';
const AUTH_FLOW = 'authorization-code-pkce';
const MANAGED_LOGIN = true;
const API_TOKEN_USE = 'access';
const TOKEN_STORAGE = 'session-storage-no-refresh-token-persistence';
const SAVED_TRIP_SCHEMA_VERSION = 'GV-SAVED-TRIP-V1';
const MAX_SAVED_STOPS = 12;
const MAX_TITLE_LENGTH = 120;
const MAX_TRIP_ID_LENGTH = 64;
const ALLOWED_SCOPES = Object.freeze(['openid', 'email', 'profile']);
const REQUIRED_API_SCOPE = 'globevoy/trips.write';
const PUBLIC_ORIGINS = Object.freeze({
  staging: 'https://staging.dy4fw8gx1ccie.amplifyapp.com',
  production: 'https://globevoy.com'
});

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function safeEnvironment(value) {
  const normalized = clean(value).toLowerCase();
  return normalized === 'staging' || normalized === 'production' ? normalized : null;
}

function safeHttpsOrigin(value) {
  const raw = clean(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname && parsed.pathname !== '/') return null;
    return parsed.origin;
  } catch (_) {
    return null;
  }
}

function appUrls705A(environment = 'staging') {
  const env = safeEnvironment(environment);
  if (!env) return null;
  const origin = PUBLIC_ORIGINS[env];
  return {
    environment: env,
    origin,
    callbackUrls: [`${origin}/auth-callback.html`],
    logoutUrls: [`${origin}/index.html`],
    wildcardCallbacksAllowed: false,
    httpCallbacksAllowed: false
  };
}

function publicClientPlan705A(environment = 'staging') {
  const urls = appUrls705A(environment);
  if (!urls) return null;
  return {
    version: VERSION,
    provider: AUTH_PROVIDER,
    environment: urls.environment,
    clientType: 'public-browser-client',
    clientSecretRequired: false,
    clientSecretAllowedInBrowser: false,
    oauthFlow: AUTH_FLOW,
    authorizationCodeGrant: true,
    pkceRequired: true,
    pkceMethod: 'S256',
    implicitGrantAllowed: false,
    clientCredentialsGrantAllowed: false,
    managedLogin: MANAGED_LOGIN,
    startEndpoint: '/oauth2/authorize',
    tokenEndpoint: '/oauth2/token',
    scopes: ALLOWED_SCOPES.slice(),
    apiAuthorizationToken: API_TOKEN_USE,
    apiAuthorizationHeader: 'Authorization: Bearer <access-token>',
    tokenStorage: TOKEN_STORAGE,
    localStorageTokensAllowed: false,
    refreshTokenPersistedInBrowser: false,
    reauthenticationStrategy: 'new-pkce-authorization-request-cognito-session-may-reduce-friction',
    identityPoolRequired: false,
    awsCredentialsAllowedInBrowser: false,
    callbackUrls: urls.callbackUrls,
    logoutUrls: urls.logoutUrls,
    wildcardCallbacksAllowed: false,
    guestPlanningAllowed: true,
    persistentSaveRequiresAuthentication: true
  };
}

function validatePublicClientConfig705A(input = {}) {
  const env = safeEnvironment(input.environment);
  const expected = env ? publicClientPlan705A(env) : null;
  const callbacks = Array.isArray(input.callbackUrls) ? input.callbackUrls.map(safeHttpsOrigin).filter(Boolean) : [];
  const logoutUrls = Array.isArray(input.logoutUrls) ? input.logoutUrls.map(value => {
    try {
      const url = new URL(clean(value));
      return url.protocol === 'https:' ? url.href : null;
    } catch (_) { return null; }
  }).filter(Boolean) : [];
  const flows = Array.isArray(input.allowedOAuthFlows) ? input.allowedOAuthFlows.map(value => clean(value).toLowerCase()) : [];
  const errors = [];

  if (!env || !expected) errors.push('invalid-environment');
  if (input.generateSecret === true || clean(input.clientSecret)) errors.push('public-client-must-not-have-secret');
  if (!flows.includes('code')) errors.push('authorization-code-grant-required');
  if (flows.includes('implicit')) errors.push('implicit-grant-forbidden');
  if (flows.includes('client_credentials') || flows.includes('client-credentials')) errors.push('client-credentials-forbidden');
  if (input.pkceRequired !== true) errors.push('pkce-required');
  if (clean(input.pkceMethod || 'S256').toUpperCase() !== 'S256') errors.push('pkce-s256-required');
  if (!callbacks.length) errors.push('callback-required');
  if (callbacks.some(url => url.includes('*'))) errors.push('wildcard-callback-forbidden');
  if (expected && JSON.stringify(callbacks) !== JSON.stringify(expected.callbackUrls)) errors.push('callback-allowlist-mismatch');
  if (expected && JSON.stringify(logoutUrls) !== JSON.stringify(expected.logoutUrls)) errors.push('logout-allowlist-mismatch');

  return {
    valid: errors.length === 0,
    errors,
    version: VERSION,
    environment: env,
    expected
  };
}

function verifiedPrincipal705A(claims = {}, context = {}) {
  const sub = clean(claims.sub);
  const tokenUse = clean(claims.token_use).toLowerCase();
  const clientId = clean(claims.client_id || claims.aud);
  const issuer = clean(claims.iss);
  const scope = clean(claims.scope).split(/\s+/).filter(Boolean);
  const verified = context.jwtVerified === true;
  const errors = [];
  if (!verified) errors.push('jwt-must-be-cryptographically-verified-first');
  if (!sub) errors.push('verified-sub-required');
  if (tokenUse !== API_TOKEN_USE) errors.push('access-token-required-for-api');
  if (!issuer) errors.push('issuer-required');
  if (!clientId) errors.push('client-id-required');
  if (context.expectedIssuer && issuer !== clean(context.expectedIssuer)) errors.push('issuer-mismatch');
  if (context.expectedClientId && clientId !== clean(context.expectedClientId)) errors.push('client-id-mismatch');
  if (context.requiredScope && !scope.includes(clean(context.requiredScope))) errors.push('required-scope-missing');
  return {
    valid: errors.length === 0,
    errors,
    version: VERSION,
    principal: errors.length ? null : {
      sub,
      issuer,
      clientId,
      tokenUse,
      scope,
      email: clean(claims.email) || null,
      emailVerified: claims.email_verified === true || String(claims.email_verified).toLowerCase() === 'true'
    }
  };
}

function safeTripId(value) {
  const raw = clean(value);
  if (!raw || raw.length > MAX_TRIP_ID_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  return raw;
}

function safeText(value, max = MAX_TITLE_LENGTH) {
  const raw = clean(value).replace(/[\u0000-\u001F\u007F]/g, ' ');
  return raw ? raw.slice(0, max) : '';
}

function safeIata(value) {
  const raw = clean(value).toUpperCase();
  return /^[A-Z]{3}$/.test(raw) ? raw : null;
}

function safeIsoDate(value) {
  const raw = clean(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function safeMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function normalizeStops705A(stops = []) {
  return (Array.isArray(stops) ? stops : []).slice(0, MAX_SAVED_STOPS).map((stop, index) => ({
    index,
    cityId: safeText(stop?.cityId || stop?.id || '', 120) || null,
    city: safeText(stop?.city || stop?.displayCity || '', 120) || null,
    airportCode: safeIata(stop?.airportCode || stop?.code),
    nights: Math.max(0, Math.min(60, Math.round(Number(stop?.nights || 0) || 0)))
  })).filter(stop => stop.cityId || stop.city || stop.airportCode);
}

function savedTripKeys705A(ownerSub, tripId) {
  const sub = clean(ownerSub);
  const id = safeTripId(tripId);
  if (!sub || !id) return null;
  return {
    pk: `USER#${sub}`,
    sk: `TRIP#${id}`
  };
}

function buildSavedTripRecord705A(verifiedPrincipal = {}, input = {}, now = new Date().toISOString()) {
  const sub = clean(verifiedPrincipal.sub);
  const tripId = safeTripId(input.tripId);
  const keys = savedTripKeys705A(sub, tripId);
  const errors = [];
  if (!sub) errors.push('verified-owner-sub-required');
  if (!tripId || !keys) errors.push('valid-trip-id-required');
  const origin = safeIata(input?.trip?.originAirportCode || input?.originAirportCode);
  const stops = normalizeStops705A(input?.trip?.stops || input?.stops);
  if (!origin) errors.push('origin-airport-required');
  if (!stops.length) errors.push('at-least-one-stop-required');
  if (errors.length) return { valid: false, errors, version: VERSION, record: null };

  const timestamp = new Date(now).toISOString();
  const budgetAmount = safeMoney(input?.trip?.budget?.amount ?? input?.budgetAmount);
  const budgetCurrency = clean(input?.trip?.budget?.currency || input?.budgetCurrency || 'USD').toUpperCase();
  const adults = Math.max(1, Math.min(12, Math.round(Number(input?.trip?.travellers?.adults ?? input?.adults ?? 1) || 1)));
  const children = Math.max(0, Math.min(12, Math.round(Number(input?.trip?.travellers?.children ?? input?.children ?? 0) || 0)));
  const title = safeText(input.title || stops.map(stop => stop.city || stop.airportCode).filter(Boolean).join(' · ') || 'Saved trip');

  return {
    valid: true,
    errors: [],
    version: VERSION,
    record: {
      ...keys,
      entityType: 'SAVED_TRIP',
      schemaVersion: SAVED_TRIP_SCHEMA_VERSION,
      ownerSub: sub,
      tripId,
      title,
      createdAt: safeIsoDate(input.createdAt) ? input.createdAt : timestamp,
      updatedAt: timestamp,
      trip: {
        originAirportCode: origin,
        stops,
        dateMode: safeText(input?.trip?.dateMode || input?.dateMode, 24) || null,
        departureDate: safeIsoDate(input?.trip?.departureDate || input?.departureDate),
        returnDate: safeIsoDate(input?.trip?.returnDate || input?.returnDate),
        budget: {
          amount: budgetAmount,
          currency: /^[A-Z]{3}$/.test(budgetCurrency) ? budgetCurrency : 'USD'
        },
        travellers: { adults, children },
        recommendationRole: safeText(input?.trip?.recommendationRole || input?.recommendationRole, 40) || null
      },
      evidencePolicy: {
        savedPriceIsSnapshotOnly: true,
        savedPriceMustNotBeClaimedLiveOnReopen: true,
        revalidateProvidersWhenTripIsReopened: true,
        rawProviderResponsesStored: false,
        providerCredentialsStored: false,
        paymentDataStored: false,
        passportNumbersOrScansStored: false
      }
    }
  };
}

function migrationPlan705A() {
  return {
    version: VERSION,
    currentBrowserProfileKey: 'globevoy.travel.profile.v1',
    currentProfileClass: 'browser-only-unverified-travel-profile',
    autoUploadExistingBrowserProfileOnSignIn: false,
    explicitMigrationConfirmationRequired: true,
    cognitoEmailBecomesAccountEmailSource: true,
    browserEmailMustNotOverrideVerifiedAccountEmail: true,
    migratablePreferences: [
      'displayName',
      'passportCountryCode',
      'residenceCountryCode',
      'secondPassportCountryCode',
      'useSecondPassportForTrip',
      'entryAware',
      'adults',
      'children',
      'childAges'
    ],
    prohibitedProfileFields: ['password', 'passportNumber', 'passportScan', 'paymentCard', 'cvv'],
    guestPlanningRemainsAvailable: true,
    guestDraftMayRemainLocalUntilUserChoosesSave: true
  };
}

function storagePlan705A() {
  return {
    version: VERSION,
    recommendedStore: 'Amazon-DynamoDB',
    tablePattern: 'single-table-user-owned-trips',
    partitionKey: 'PK=USER#<verified-cognito-sub>',
    sortKey: 'SK=TRIP#<trip-id>',
    ownerSource: 'verified-access-token-sub-only',
    ownerAcceptedFromRequestBody: false,
    listTripsOperation: 'Query-by-user-partition',
    crossUserReadAllowed: false,
    crossUserWriteAllowed: false,
    publicSharingIn705: false,
    rawProviderResponsesStored: false,
    reopenRequiresPriceRevalidation: true
  };
}

function architectureStatus705A() {
  return {
    version: VERSION,
    implementationPhase: 'architecture-contract-only',
    authProvider: AUTH_PROVIDER,
    authFlow: AUTH_FLOW,
    managedLogin: MANAGED_LOGIN,
    apiTokenUse: API_TOKEN_USE,
    recommendedJwtVerifierForNode: 'aws-jwt-verify',
    requiredJwtChecks: ['signature', 'exp', 'iss', 'client_id', 'token_use', 'scope-when-required'],
    staging: publicClientPlan705A('staging'),
    production: publicClientPlan705A('production'),
    migration: migrationPlan705A(),
    savedTrips: storagePlan705A(),
    cognitoResourcesCreatedBy705A: false,
    dynamodbResourcesCreatedBy705A: false,
    frontendRuntimeChangedBy705A: false,
    backendRuntimeChangedBy705A: false,
    productionChanged: false
  };
}

module.exports = {
  VERSION,
  AUTH_PROVIDER,
  AUTH_FLOW,
  API_TOKEN_USE,
  TOKEN_STORAGE,
  SAVED_TRIP_SCHEMA_VERSION,
  MAX_SAVED_STOPS,
  MAX_TITLE_LENGTH,
  ALLOWED_SCOPES,
  REQUIRED_API_SCOPE,
  PUBLIC_ORIGINS,
  appUrls705A,
  publicClientPlan705A,
  validatePublicClientConfig705A,
  verifiedPrincipal705A,
  savedTripKeys705A,
  buildSavedTripRecord705A,
  migrationPlan705A,
  storagePlan705A,
  architectureStatus705A,
  _internal: { clean, safeEnvironment, safeHttpsOrigin, safeTripId, safeText, safeIata, safeIsoDate, safeMoney, normalizeStops705A }
};
