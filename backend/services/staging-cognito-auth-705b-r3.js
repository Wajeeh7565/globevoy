'use strict';

// GV-ACCOUNT-705B-R3 — staging-only Cognito access-token verification.
//
// This module contains no AWS credentials and performs no Cognito mutation.
// It verifies bearer access tokens against the fixed staging user pool JWKS,
// exact issuer/client/scope claims and the exact staging browser origin.

const crypto = require('node:crypto');

const VERSION = 'GV-ACCOUNT-705B-R3';
const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const REGION = 'us-east-2';
const USER_POOL_ID = 'us-east-2_MSd9RRHD8';
const CLIENT_ID = 'o2ohbv50253hjli5s34rbvv79';
const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${USER_POOL_ID}`;
const JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const REQUIRED_SCOPE = 'globevoy/trips.write';
const JWKS_CACHE_MS = 6 * 60 * 60 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5000;
const MAX_TOKEN_LENGTH = 16384;

let jwksCache = { fetchedAt: 0, keys: [] };

class CognitoAuthError705B extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'CognitoAuthError705B';
    this.code = code;
  }
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeHttpsOrigin(value) {
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

function headerValue(headers = {}, name = '') {
  const target = clean(name).toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (clean(key).toLowerCase() === target) return clean(value);
  }
  return '';
}

function methodOf(event = {}) {
  return clean(event?.requestContext?.http?.method || event?.httpMethod || 'GET').toUpperCase();
}

function pathOf(event = {}) {
  return clean(event?.rawPath || event?.path || '').split('?')[0];
}

function enabled(env = process.env) {
  return normalizeHttpsOrigin(env?.CORS_ORIGIN) === STAGING_ORIGIN;
}

function base64UrlDecode(value) {
  const raw = clean(value);
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new CognitoAuthError705B('malformed-jwt');
  try {
    return Buffer.from(raw, 'base64url');
  } catch (_) {
    throw new CognitoAuthError705B('malformed-jwt');
  }
}

function parseJwt(token) {
  const raw = clean(token);
  if (!raw || raw.length > MAX_TOKEN_LENGTH) throw new CognitoAuthError705B('invalid-token-length');
  const parts = raw.split('.');
  if (parts.length !== 3 || parts.some(part => !part)) throw new CognitoAuthError705B('malformed-jwt');
  let header;
  let claims;
  try {
    header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
    claims = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
  } catch (error) {
    if (error instanceof CognitoAuthError705B) throw error;
    throw new CognitoAuthError705B('malformed-jwt');
  }
  if (!header || typeof header !== 'object' || !claims || typeof claims !== 'object') {
    throw new CognitoAuthError705B('malformed-jwt');
  }
  return {
    raw,
    header,
    claims,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: base64UrlDecode(parts[2])
  };
}

function bearerToken(event = {}) {
  const authorization = headerValue(event.headers || {}, 'authorization');
  const match = authorization.match(/^Bearer\s+([^\s]+)$/i);
  if (!match) throw new CognitoAuthError705B('bearer-access-token-required');
  return match[1];
}

function validateClaims(claims = {}, nowMs = Date.now()) {
  const now = Math.floor(nowMs / 1000);
  const errors = [];
  const scope = clean(claims.scope).split(/\s+/).filter(Boolean);
  const exp = Number(claims.exp);
  const nbf = claims.nbf == null ? null : Number(claims.nbf);
  const iat = claims.iat == null ? null : Number(claims.iat);

  if (clean(claims.iss) !== ISSUER) errors.push('issuer-mismatch');
  if (clean(claims.client_id) !== CLIENT_ID) errors.push('client-id-mismatch');
  if (clean(claims.token_use).toLowerCase() !== 'access') errors.push('access-token-required');
  if (!clean(claims.sub)) errors.push('subject-required');
  if (!Number.isFinite(exp) || exp <= now) errors.push('token-expired');
  if (Number.isFinite(nbf) && nbf > now + 60) errors.push('token-not-yet-valid');
  if (Number.isFinite(iat) && iat > now + 60) errors.push('token-issued-in-future');
  if (!scope.includes(REQUIRED_SCOPE)) errors.push('required-scope-missing');

  return { valid: errors.length === 0, errors, scope, exp };
}

async function fetchJwks(fetchImpl = globalThis.fetch, options = {}) {
  if (typeof fetchImpl !== 'function') throw new CognitoAuthError705B('jwks-fetch-unavailable');
  const now = Number(options.nowMs || Date.now());
  const force = options.force === true;
  if (!force && jwksCache.keys.length && now - jwksCache.fetchedAt < JWKS_CACHE_MS) {
    return jwksCache.keys;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JWKS_FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(JWKS_URL, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal
    });
  } catch (_) {
    throw new CognitoAuthError705B('jwks-fetch-failed');
  } finally {
    clearTimeout(timer);
  }

  if (!response || response.ok !== true) throw new CognitoAuthError705B('jwks-fetch-failed');
  let body;
  try {
    body = await response.json();
  } catch (_) {
    throw new CognitoAuthError705B('jwks-invalid-response');
  }
  const keys = Array.isArray(body?.keys) ? body.keys.filter(key => key && typeof key === 'object') : [];
  if (!keys.length) throw new CognitoAuthError705B('jwks-empty');
  jwksCache = { fetchedAt: now, keys };
  return keys;
}

function signingKey(keys = [], kid = '') {
  const match = keys.find(key => clean(key?.kid) === clean(kid));
  if (!match) return null;
  if (clean(match.kty) !== 'RSA') throw new CognitoAuthError705B('invalid-signing-key-type');
  if (match.alg && clean(match.alg) !== 'RS256') throw new CognitoAuthError705B('invalid-signing-key-algorithm');
  if (match.use && clean(match.use) !== 'sig') throw new CognitoAuthError705B('invalid-signing-key-use');
  return match;
}

async function verifyCognitoAccessToken705B(token, options = {}) {
  const parsed = parseJwt(token);
  if (clean(parsed.header.alg) !== 'RS256') throw new CognitoAuthError705B('rs256-required');
  const kid = clean(parsed.header.kid);
  if (!kid) throw new CognitoAuthError705B('signing-kid-required');

  const fetchImpl = options.fetch || globalThis.fetch;
  let keys = await fetchJwks(fetchImpl, { nowMs: options.nowMs });
  let jwk = signingKey(keys, kid);
  if (!jwk) {
    keys = await fetchJwks(fetchImpl, { nowMs: options.nowMs, force: true });
    jwk = signingKey(keys, kid);
  }
  if (!jwk) throw new CognitoAuthError705B('signing-key-not-found');

  let key;
  try {
    key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  } catch (_) {
    throw new CognitoAuthError705B('signing-key-invalid');
  }

  const signatureValid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parsed.signingInput, 'utf8'),
    key,
    parsed.signature
  );
  if (!signatureValid) throw new CognitoAuthError705B('invalid-token-signature');

  const claimCheck = validateClaims(parsed.claims, Number(options.nowMs || Date.now()));
  if (!claimCheck.valid) throw new CognitoAuthError705B(claimCheck.errors[0]);

  return {
    version: VERSION,
    verified: true,
    tokenUse: 'access',
    sub: clean(parsed.claims.sub),
    username: clean(parsed.claims.username) || null,
    clientId: clean(parsed.claims.client_id),
    issuer: clean(parsed.claims.iss),
    scopes: claimCheck.scope,
    expiresAt: claimCheck.exp
  };
}

function response(statusCode, payload, requestOrigin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'X-Globevoy-Account': VERSION
  };
  if (requestOrigin === STAGING_ORIGIN) headers['Access-Control-Allow-Origin'] = STAGING_ORIGIN;
  return { statusCode, headers, body: JSON.stringify(payload) };
}

async function handleAccountSession705B(event = {}, options = {}) {
  const requestOrigin = normalizeHttpsOrigin(headerValue(event.headers || {}, 'origin'));
  if (!enabled(options.env || process.env)) {
    return response(404, { ok: false, authenticated: false, error: 'account-auth-not-enabled' }, requestOrigin);
  }
  if (requestOrigin !== STAGING_ORIGIN) {
    return response(403, { ok: false, authenticated: false, error: 'staging-origin-not-allowed' }, '');
  }
  if (pathOf(event) !== '/api/account/session') {
    return response(404, { ok: false, authenticated: false, error: 'not-found' }, requestOrigin);
  }
  if (methodOf(event) !== 'GET') {
    return response(405, { ok: false, authenticated: false, error: 'GET required' }, requestOrigin);
  }

  try {
    const token = bearerToken(event);
    const verified = await verifyCognitoAccessToken705B(token, {
      fetch: options.fetch || globalThis.fetch,
      nowMs: options.nowMs
    });
    return response(200, {
      ok: true,
      authenticated: true,
      version: VERSION,
      user: {
        sub: verified.sub,
        username: verified.username
      },
      token: {
        tokenUse: verified.tokenUse,
        scopes: verified.scopes,
        expiresAt: verified.expiresAt
      },
      safety: {
        passwordReturned: false,
        tokenReturned: false,
        awsCredentialsReturned: false
      }
    }, requestOrigin);
  } catch (error) {
    const reason = error instanceof CognitoAuthError705B ? error.code : 'verification-failed';
    return response(401, {
      ok: false,
      authenticated: false,
      error: 'invalid-or-expired-access-token',
      reason
    }, requestOrigin);
  }
}

function status705B(env = process.env) {
  return {
    version: VERSION,
    enabled: enabled(env),
    environment: 'staging',
    origin: STAGING_ORIGIN,
    region: REGION,
    userPoolId: USER_POOL_ID,
    clientId: CLIENT_ID,
    issuer: ISSUER,
    requiredScope: REQUIRED_SCOPE,
    tokenUse: 'access',
    jwksUrl: JWKS_URL,
    productionChanged: false,
    clientSecretRequired: false,
    passwordHandledByGlobevoy: false
  };
}

function resetJwksCacheForTests() {
  jwksCache = { fetchedAt: 0, keys: [] };
}

module.exports = {
  VERSION,
  STAGING_ORIGIN,
  REGION,
  USER_POOL_ID,
  CLIENT_ID,
  ISSUER,
  JWKS_URL,
  REQUIRED_SCOPE,
  CognitoAuthError705B,
  enabled,
  verifyCognitoAccessToken705B,
  handleAccountSession705B,
  status705B,
  _internal: {
    clean,
    normalizeHttpsOrigin,
    headerValue,
    methodOf,
    pathOf,
    base64UrlDecode,
    parseJwt,
    bearerToken,
    validateClaims,
    fetchJwks,
    signingKey,
    response,
    resetJwksCacheForTests
  }
};
