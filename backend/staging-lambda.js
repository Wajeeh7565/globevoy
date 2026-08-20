'use strict';

// GV-PLATFORM-700A staging-only Lambda entrypoint.
//
// Purpose:
// - keep backend/lambda.js byte-identical to the verified production runtime;
// - allow exactly one configured staging browser origin through CORS;
// - make the isolated staging Lambda exercise the same 687B origin-gated path as
//   production without adding a second feature-flag environment variable.
//
// GV-DATA-701B adds one bounded read-only staging endpoint for the 701A
// worldwide-registry overlay. It does not change the production handler or
// generated-tour recommendation path.
//
// IMPORTANT: configure the staging Lambda handler as `staging-lambda.handler`.
// Do not use this entrypoint for the production function.

const { handler: productionHandler } = require('./lambda');
const {
  VERSION: WORLDWIDE_REGISTRY_VERSION,
  worldwideRegistryEnabled,
  worldwideRegistrySummary,
  resolveWorldwideCity,
  searchWorldwideRegistry
} = require('./services/worldwide-city-registry-701a');

const VERSION = 'GV-PLATFORM-700A-STAGING-API-R1';
const WORLDWIDE_API_VERSION = 'GV-DATA-701B';
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

function stagingHeaders(requestOrigin = '', extra = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
    'X-Globevoy-Staging': VERSION,
    ...extra
  };
  if (requestOrigin) headers['Access-Control-Allow-Origin'] = requestOrigin;
  return headers;
}

function stagingError(statusCode, message, requestOrigin = '') {
  return {
    statusCode,
    headers: stagingHeaders(requestOrigin),
    body: JSON.stringify({ ok: false, staging: true, version: VERSION, error: message })
  };
}

function eventPath(event = {}) {
  return String(event.rawPath || event.path || '').split('?')[0];
}

function eventMethod(event = {}) {
  return String(
    event.requestContext?.http?.method
      || event.httpMethod
      || 'GET'
  ).toUpperCase();
}

function worldwideApiResponse(statusCode, payload, requestOrigin) {
  return {
    statusCode,
    headers: stagingHeaders(requestOrigin, { 'X-Globevoy-Data': WORLDWIDE_API_VERSION }),
    body: JSON.stringify({
      apiVersion: WORLDWIDE_API_VERSION,
      registryVersion: WORLDWIDE_REGISTRY_VERSION,
      staging: true,
      ...payload
    })
  };
}

function handleWorldwideRegistryApi(event = {}, requestOrigin = '') {
  if (eventMethod(event) !== 'GET') {
    return worldwideApiResponse(405, { ok: false, error: 'GET required' }, requestOrigin);
  }

  const query = event.queryStringParameters || {};
  const summary = worldwideRegistrySummary();
  const resolveInput = String(query.resolve || query.city || '').trim();
  const hasSearch = Boolean(
    String(query.q || query.query || '').trim()
    || query.scope
    || query.mode
    || query.countryCode
    || query.country
    || query.limit
  );

  if (!resolveInput && !hasSearch) {
    return worldwideApiResponse(200, { ...summary, status: worldwideRegistryEnabled() ? 'ready' : 'feature-disabled' }, requestOrigin);
  }

  if (!worldwideRegistryEnabled()) {
    return worldwideApiResponse(200, {
      ok: true,
      enabled: false,
      status: 'feature-disabled',
      counts: summary.counts,
      layers: summary.layers,
      records: [],
      disclaimer: summary.disclaimer
    }, requestOrigin);
  }

  if (resolveInput) {
    const record = resolveWorldwideCity(resolveInput, { countryCode: query.countryCode || query.country });
    return worldwideApiResponse(200, {
      ok: true,
      enabled: true,
      status: record ? 'resolved' : 'not-found',
      mode: 'resolve',
      found: Boolean(record),
      record,
      disclaimer: 'Worldwide resolution does not promote an origin-only city into the curated destination or production-active layers.'
    }, requestOrigin);
  }

  const result = searchWorldwideRegistry(query);
  return worldwideApiResponse(200, { ...result, status: 'search' }, requestOrigin);
}

async function handler(event = {}) {
  const configuredOrigin = configuredStagingOrigin(process.env);
  const requestOrigin = normalizeHttpsOrigin(headerValue(event.headers || {}, 'origin'));

  if (!configuredOrigin) {
    return stagingError(500, 'staging-origin-not-configured');
  }

  // The staging Function URL is browser-only. Missing or unknown origins fail
  // before either the read-only staging endpoint or verified production handler executes.
  if (!requestOrigin) {
    return stagingError(403, 'staging-origin-required');
  }
  if (requestOrigin !== configuredOrigin) {
    return stagingError(403, 'staging-origin-not-allowed');
  }

  if (eventPath(event) === '/api/worldwide-city-registry') {
    return handleWorldwideRegistryApi(event, configuredOrigin);
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
  WORLDWIDE_API_VERSION,
  PRODUCTION_ORIGIN,
  handler,
  _internal: {
    headerValue,
    normalizeHttpsOrigin,
    configuredStagingOrigin,
    replaceHeader,
    stagingHeaders,
    stagingError,
    eventPath,
    eventMethod,
    worldwideApiResponse,
    handleWorldwideRegistryApi
  }
};
