'use strict';

// Production-only Cognito access-token verification. Never accepts staging
// pool/client settings or falls back to staging JWTs.
const crypto = require('node:crypto');
const staging = require('./staging-cognito-auth-705b-r3');
const { parseJwt, bearerToken, signingKey, normalizeHttpsOrigin } = staging._internal;
const REQUIRED_SCOPE = 'globevoy/trips.write';
const PROD_ORIGINS = Object.freeze(['https://globevoy.com', 'https://www.globevoy.com']);
const JWKS_CACHE_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const cachedJwks = new Map();

class ProductionAuthError extends Error {
  constructor(code) { super(code); this.name = 'ProductionAuthError'; this.code = code; }
}

// Only the release packager may include this nonsecret artifact. Source defaults off.
let bundledConfig = null;
try { bundledConfig = require('./production-account-build.json'); } catch (_) { /* Fail closed. */ }

function config(input = bundledConfig) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const fields = ['schemaVersion', 'enabled', 'origin', 'pool', 'client', 'table'];
  if (Object.keys(input).length !== fields.length || Object.keys(input).some(k => !fields.includes(k))) return null;
  if (input.schemaVersion !== 1 || input.enabled !== true) return null;
  if (fields.slice(2).some(k => typeof input[k] !== 'string' || input[k] !== input[k].trim())) return null;
  const { pool, client, table, origin } = input;
  if (!PROD_ORIGINS.includes(origin)) return null;
  if (!/^us-east-2_[A-Za-z0-9]+$/.test(pool) || pool === staging.USER_POOL_ID) return null;
  if (!/^[a-z0-9]{12,64}$/.test(client) || client === staging.CLIENT_ID) return null;
  if (table !== 'globevoy-production-saved-trips') return null;
  return Object.freeze({
    origin,
    pool,
    client,
    table,
    issuer: 'https://cognito-idp.us-east-2.amazonaws.com/' + pool,
    scope: REQUIRED_SCOPE
  });
}

function allowedOrigin(event = {}, cfg) {
  const value = staging._internal.headerValue(event.headers || {}, 'origin');
  return cfg && normalizeHttpsOrigin(value) === cfg.origin ? cfg.origin : '';
}

async function jwks(cfg, fetchImpl, nowMs, force) {
  const old = cachedJwks.get(cfg.pool);
  if (!force && old && old.keys.length && nowMs - old.time < JWKS_CACHE_MS) return old.keys;
  if (typeof fetchImpl !== 'function') throw new ProductionAuthError('jwks-fetch-unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let result;
  try {
    result = await fetchImpl(cfg.issuer + '/.well-known/jwks.json', {
      method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store',
      signal: controller.signal
    });
    if (!result?.ok) throw new Error('bad-status');
    const body = await result.json();
    const keys = Array.isArray(body?.keys) ? body.keys.filter(x => x && typeof x === 'object') : [];
    if (!keys.length) throw new Error('empty-jwks');
    cachedJwks.set(cfg.pool, { keys, time: nowMs });
    return keys;
  } catch (_) {
    throw new ProductionAuthError('jwks-unavailable');
  } finally { clearTimeout(timer); }
}

async function verifyAccessToken(event, options = {}) {
  const cfg = config(options.accountConfig);
  if (!cfg) throw new ProductionAuthError('production-auth-not-configured');
  const token = bearerToken(event);
  const decoded = parseJwt(token);
  if (decoded.header.alg !== 'RS256' || !decoded.header.kid) throw new ProductionAuthError('rs256-signing-key-required');
  const nowMs = Number(options.nowMs ?? Date.now());
  const now = Math.floor(nowMs / 1000);
  const c = decoded.claims;
  // Check claims before fetching the network key. Never trust this alone;
  // the RSA verification below is mandatory.
  if (c.iss !== cfg.issuer || c.client_id !== cfg.client || c.token_use !== 'access' ||
      typeof c.sub !== 'string' || !c.sub.trim() ||
      !String(c.scope || '').split(/\s+/).includes(cfg.scope) ||
      !Number.isFinite(Number(c.exp)) || Number(c.exp) <= now ||
      (c.nbf != null && Number(c.nbf) > now + 60) ||
      (c.iat != null && Number(c.iat) > now + 60)) {
    throw new ProductionAuthError('invalid-production-token-claims');
  }
  const fetchImpl = options.fetch || globalThis.fetch;
  let keys = await jwks(cfg, fetchImpl, nowMs, false);
  let publicJwk = signingKey(keys, decoded.header.kid);
  if (!publicJwk) {
    keys = await jwks(cfg, fetchImpl, nowMs, true);
    publicJwk = signingKey(keys, decoded.header.kid);
  }
  if (!publicJwk) throw new ProductionAuthError('signing-key-not-found');
  let valid = false;
  try {
    const key = crypto.createPublicKey({ key: publicJwk, format: 'jwk' });
    valid = crypto.verify('RSA-SHA256', Buffer.from(decoded.signingInput), key, decoded.signature);
  } catch (_) { throw new ProductionAuthError('invalid-signing-key'); }
  if (!valid) throw new ProductionAuthError('invalid-token-signature');
  return { sub: c.sub.trim(), username: String(c.username || ''), scopes: String(c.scope).split(/\s+/), expiresAt: Number(c.exp) };
}

module.exports = {
  REQUIRED_SCOPE, PROD_ORIGINS, ProductionAuthError, config, allowedOrigin, verifyAccessToken,
  _internal: { resetCacheForTests() { cachedJwks.clear(); } }
};
