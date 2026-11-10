'use strict';

// Production account API wrapper. Leaves every established public production
// recommendation/tour route owned by backend/lambda.js.
// Deployment is opt-in and requires a dedicated production Cognito pool,
// separate DynamoDB table, correct IAM/CORS, packaging and browser acceptance.
const legacy = require('./lambda');
const auth = require('./services/accounts/auth/production-cognito-auth');
const saved = require('./services/accounts/saved-trips/staging-saved-trips-705c');
const profile = require('./services/accounts/travel-profile/staging-travel-profile-710f-r1');
const stagingAuth = require('./services/accounts/auth/staging-cognito-auth-705b-r3');

const PRIVATE_ROUTES = new Set(['/api/account/session', '/api/saved-trips', '/api/account/travel-profile']);
const { clean, queryParam, validTripId, parseBody: parseTripBody } = saved._internal;
const json = (statusCode, body, origin = '') => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', Vary: 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {})
  },
  body: JSON.stringify(body)
});
const methodOf = stagingAuth._internal.methodOf;
const pathOf = stagingAuth._internal.pathOf;
function parseProfileBody(event) {
  let raw = event.body == null ? '' : String(event.body);
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw, 'utf8') > 32 * 1024) throw saved._internal.apiError(413, 'request-body-too-large');
  let value;
  try { value = raw ? JSON.parse(raw) : {}; }
  catch (_) { throw saved._internal.apiError(400, 'invalid-json'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw saved._internal.apiError(400, 'json-object-required');
  if (profile._internal.containsForbiddenKeys(value)) throw saved._internal.apiError(400, 'sensitive-document-or-credential-data-not-allowed');
  return value;
}
function optionsFor(cfg, options = {}) {
  return {
    ...options,
    env: { GLOBEVOY_SAVED_TRIPS_TABLE: cfg.table },
    // Verified owner-sub is obtained independently by this production verifier.
    verifyToken: undefined
  };
}
function deny(error, origin) {
  const reason = error?.code || 'invalid-or-expired-access-token';
  return json(401, { ok: false, authenticated: false, error: 'invalid-or-expired-access-token', reason }, origin);
}
async function privateHandler(event = {}, options = {}) {
  const env = options.env || process.env;
  const cfg = auth.config(env);
  const path = pathOf(event);
  const method = methodOf(event);
  if (!PRIVATE_ROUTES.has(path)) return (options.publicHandler || legacy.handler)(event);
  if (!cfg) return json(503, { ok: false, error: 'production-accounts-not-configured' });
  const origin = auth.allowedOrigin(event, cfg);
  if (!origin) return json(403, { ok: false, error: 'origin-not-allowed' });
  const allowedMethods = path === '/api/saved-trips' ? 'GET,POST,PUT,DELETE,OPTIONS'
    : path === '/api/account/travel-profile' ? 'GET,PUT,OPTIONS' : 'GET,OPTIONS';
  if (method === 'OPTIONS') return {
    statusCode: 204,
    headers: {
      'Cache-Control': 'no-store', Vary: 'Origin',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': allowedMethods,
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Max-Age': '600'
    }, body: ''
  };
  if (!allowedMethods.split(',').includes(method)) return json(405, { ok: false, error: 'method-not-allowed' }, origin);

  let user;
  try { user = await auth.verifyAccessToken(event, { env, fetch: options.fetch, nowMs: options.nowMs }); }
  catch (err) { return deny(err, origin); }

  if (path === '/api/account/session') return json(200, {
    ok: true, authenticated: true, version: 'GV-ACCOUNT-705B-R3',
    user: { sub: user.sub, username: user.username || null },
    token: { tokenUse: 'access', scopes: user.scopes, expiresAt: user.expiresAt },
    safety: { passwordReturned: false, tokenReturned: false, awsCredentialsReturned: false }
  }, origin);

  const dbOptions = optionsFor(cfg, options);
  try {
    if (path === '/api/saved-trips') {
      const tripId = queryParam(event, 'tripId');
      if (method === 'GET') {
        if (tripId) {
          if (!validTripId(tripId)) throw saved._internal.apiError(400, 'invalid-trip-id');
          const trip = await saved._internal.getTrip(user.sub, tripId, dbOptions);
          if (!trip) throw saved._internal.apiError(404, 'saved-trip-not-found');
          return json(200, { ok: true, version: saved.VERSION, trip, pricing: { requiresRevalidationBeforeProviderHandoff: true } }, origin);
        }
        const trips = await saved._internal.listTrips(user.sub, dbOptions);
        return json(200, { ok: true, version: saved.VERSION, trips, count: trips.length, pricing: { requiresRevalidationBeforeProviderHandoff: true } }, origin);
      }
      if (method === 'POST') {
        if (tripId) throw saved._internal.apiError(400, 'trip-id-not-accepted-on-create');
        const trip = await saved._internal.createTrip(user.sub, parseTripBody(event), dbOptions);
        return json(201, { ok: true, version: saved.VERSION, trip }, origin);
      }
      if (!validTripId(tripId)) throw saved._internal.apiError(400, 'valid-trip-id-required');
      if (method === 'PUT') {
        const trip = await saved._internal.updateTrip(user.sub, tripId, parseTripBody(event), dbOptions);
        return json(200, { ok: true, version: saved.VERSION, trip }, origin);
      }
      const deleted = await saved._internal.deleteTrip(user.sub, tripId, dbOptions);
      return json(200, { ok: true, version: saved.VERSION, deleted: { tripId: deleted?.tripId || tripId } }, origin);
    }

    if (method === 'GET') {
      const row = await profile._internal.getProfile(user.sub, dbOptions);
      return json(200, {
        ok: true, version: profile.VERSION, exists: Boolean(row),
        profile: row || { ...profile._internal.normalizeProfile({}), updatedAt: null },
        privacy: { ownerPrivate: true, passportNumbersStored: false, paymentDataStored: false }
      }, origin);
    }
    const row = await profile._internal.putProfile(user.sub, parseProfileBody(event), dbOptions);
    return json(200, {
      ok: true, version: profile.VERSION, exists: true, profile: row,
      privacy: { ownerPrivate: true, passportNumbersStored: false, paymentDataStored: false }
    }, origin);
  } catch (err) {
    if (err?.statusCode) return json(err.statusCode, { ok: false, error: err.code }, origin);
    if (err?.name === 'ConditionalCheckFailedException') return json(409, { ok: false, error: 'saved-trip-conflict' }, origin);
    // Never expose DynamoDB errors or stack traces to the browser.
    console.error('GV production private account route failed', { name: err?.name, path });
    return json(500, { ok: false, error: 'account-service-temporarily-unavailable' }, origin);
  }
}

module.exports = { handler: privateHandler, _internal: { parseProfileBody } };
