'use strict';

// GV-PLATFORM-700A staging-only Lambda entrypoint.
//
// Purpose:
// - keep backend/lambda.js byte-identical to the verified production runtime;
// - allow exactly one configured staging browser origin through CORS;
// - make the isolated staging Lambda exercise the same 687B origin-gated path as
//   production without adding a second feature-flag environment variable.
//
// IMPORTANT: configure the staging Lambda handler as `staging-lambda.handler`.
// Do not use this entrypoint for the production function.

const { handler: productionHandler } = require('./lambda');

const VERSION = 'GV-PLATFORM-700A-STAGING-API-R1';
const PRODUCTION_ORIGIN = 'https://globevoy.com';

function headerValue(headers = {}, name = '') {
  const target = String(name || '').trim().toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key || '').trim().toLowerCase() === target) return String(value || '').trim();
  }
  return '';
}

function normalizeHttpsOrigin(value = '') {
  const raw = String(value || '').trim();
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

function configuredStagingOrigin(env = process.env) {
  const configured = normalizeHttpsOrigin(env.CORS_ORIGIN || '');
  // Fail closed if this staging-only entrypoint is accidentally pointed at the
  // real production browser origin.
  if (!configured || configured === PRODUCTION_ORIGIN) return '';
  return configured;
}

function replaceHeader(headers = {}, name = '', value = '') {
  const target = String(name || '').trim().toLowerCase();
  const next = {};
  for (const [key, existing] of Object.entries(headers || {})) {
    if (String(key || '').trim().toLowerCase() !== target) next[key] = existing;
  }
  if (value) next[name] = value;
  return next;
}

function stagingError(statusCode, message, requestOrigin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin'
  };
  if (requestOrigin) headers['Access-Control-Allow-Origin'] = requestOrigin;
  return {
    statusCode,
    headers,
    body: JSON.stringify({ ok: false, staging: true, version: VERSION, error: message })
  };
}

async function handler(event = {}) {
  const configuredOrigin = configuredStagingOrigin(process.env);
  const requestOrigin = normalizeHttpsOrigin(headerValue(event.headers || {}, 'origin'));

  if (!configuredOrigin) {
    return stagingError(500, 'staging-origin-not-configured');
  }

  // The staging Function URL is browser-only. Missing or unknown origins fail
  // before the verified production handler executes.
  if (!requestOrigin) {
    return stagingError(403, 'staging-origin-required');
  }
  if (requestOrigin !== configuredOrigin) {
    return stagingError(403, 'staging-origin-not-allowed');
  }

  // The verified 687B production runtime uses a trusted browser-origin marker
  // as its activation gate. This wrapper is deployed only to an isolated
  // staging Lambda, so we intentionally map the already-validated staging
  // origin to the production-origin marker for internal execution.
  const forwardedHeaders = replaceHeader(event.headers || {}, 'Origin', PRODUCTION_ORIGIN);
  const forwardedEvent = { ...event, headers: forwardedHeaders };

  const response = await productionHandler(forwardedEvent);
  const responseHeaders = replaceHeader(response && response.headers ? response.headers : {}, 'Access-Control-Allow-Origin', configuredOrigin);
  responseHeaders.Vary = 'Origin';
  responseHeaders['X-Globevoy-Staging'] = VERSION;

  return {
    ...response,
    headers: responseHeaders
  };
}

module.exports = {
  VERSION,
  PRODUCTION_ORIGIN,
  handler,
  _internal: {
    headerValue,
    normalizeHttpsOrigin,
    configuredStagingOrigin,
    replaceHeader,
    stagingError
  }
};
