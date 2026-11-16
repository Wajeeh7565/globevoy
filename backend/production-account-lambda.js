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

const booking = require('./services/booking/revalidation/staging-booking-revalidation-707b-r1');
const bookingBase = require('./services/booking/revalidation/staging-booking-revalidation-707b');
const bookingPreparation = require('./services/booking/revalidation/staging-booking-revalidation-708c')._internal;
const liveIntegrity = require('./services/providers/flights/duffel/live-evidence-integrity-005');
const currentPricing = require('./services/domain/pricing/current-trip-total-712');
const BOOKING_ROUTE = '/api/account/booking-revalidate';

const PRIVATE_ROUTES = new Set([BOOKING_ROUTE, '/api/account/session', '/api/saved-trips', '/api/account/travel-profile']);
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
function parseBookingBody(event) {
  let raw = String(event.body || '');
  if (Buffer.byteLength(raw) > 8192) throw saved._internal.apiError(413, 'request-body-too-large');
  if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
  if (Buffer.byteLength(raw) > 4096) throw saved._internal.apiError(413, 'request-body-too-large');
  let body;
  try { body = JSON.parse(raw); } catch (_) { throw saved._internal.apiError(400, 'invalid-json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !validTripId(body.tripId)) throw saved._internal.apiError(400, 'trip-id-only-request-required');
  return body.tripId;
}
function productionFlightEvidence(before, after, query, nowMs) {
  if (!Array.isArray(after?.legs) || after.legs.length !== before.legs.length) return false;
  const flights = before.legs.map((leg,index)=>({leg,index})).filter(({leg})=>/flight/.test(leg.mode+' '+leg.transportType));
  return flights.length > 0 && flights.every(({leg,index})=>{
    const e = after.legs[index]?.providerDateEvidence || after.legs[index]?.cheapestOneWay || {};
    const observed = Date.parse(e.observedAt);
    return liveIntegrity.isDuffelEvidence(e) && observed <= nowMs && nowMs-observed <= currentPricing.MAX_AGE_MS
      && liveIntegrity.usableDuffelEvidence(e,{origin:leg.from?.airportCode || leg.from?.code,destination:leg.to?.airportCode || leg.to?.code,departureDate:leg.departureDate || leg.dateLabel,passengers:query.passengers,currency:query.currency},nowMs)
      && Number(e.displayPrice || e.partyTotalAmountDisplay)>0;
  });
}
async function revalidateProductionTrip(trip, options) {
  // Reuse 708C normalization, 707B reconstruction/Duffel and R1 arithmetic.
  // Deliberately do not invoke the staging HTTP handler or Nuitee verification.
  const normalized = bookingPreparation.normalizeSavedTripFlightLegs(trip);
  // Saved Trips contain browser-created historical snapshots, not trusted live
  // evidence. Force a fresh pilot search rather than its evidence-reuse fast path.
  for (const key of ['legs','backendLegs']) for (const leg of normalized?.tripSnapshot?.tour?.[key] || []) {
    for (const field of ['providerDateEvidence','cheapestOneWay','providerVerification','priceEvidence','publicLiveFarePilot684A']) delete leg[field];
    leg.liveFareVerified = false;
  }
  const payload = await booking.revalidateOwnedTrip(normalized, {...options,env:options.env || process.env,
    validateLiveTour:(before,after,query,summary)=>summary.attempted===true && Number(summary.providerRequests)>0 && summary.reused!==true && productionFlightEvidence(before,after,query,Number(options.nowMs ?? Date.now()))});
  payload.revalidation.passengers = bookingBase._internal.queryForTrip(normalized, bookingBase._internal.hydrateSavedTour(normalized) || {}).passengers;
  payload.flights = payload.flights.map(row=>({...row,exactMatch:payload.revalidation.applied===true}));
  return currentPricing.applyCurrentPricing(payload, normalized, {now:options.nowMs ?? Date.now()});
}
async function privateHandler(event = {}, options = {}) {
  const cfg = auth.config(options.accountConfig);
  const path = pathOf(event);
  const method = methodOf(event);
  if (!PRIVATE_ROUTES.has(path)) return (options.publicHandler || legacy.handler)(event, options.lambdaContext);
  if (!cfg) return json(503, { ok: false, error: 'production-accounts-not-configured' });
  const origin = auth.allowedOrigin(event, cfg);
  if (!origin) return json(403, { ok: false, error: 'origin-not-allowed' });
  const allowedMethods = path === BOOKING_ROUTE ? 'POST,OPTIONS' : path === '/api/saved-trips' ? 'GET,POST,PUT,DELETE,OPTIONS'
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
  try { user = await auth.verifyAccessToken(event, { accountConfig: options.accountConfig, fetch: options.fetch, nowMs: options.nowMs }); }
  catch (err) { return deny(err, origin); }

  if (path === '/api/account/session') return json(200, {
    ok: true, authenticated: true, version: 'GV-ACCOUNT-705B-R3',
    user: { sub: user.sub, username: user.username || null },
    capabilities: {bookingRevalidation:true},
    token: { tokenUse: 'access', scopes: user.scopes, expiresAt: user.expiresAt },
    safety: { passwordReturned: false, tokenReturned: false, awsCredentialsReturned: false }
  }, origin);

  const dbOptions = optionsFor(cfg, options);
  try {
    if (path === BOOKING_ROUTE) {
      const tripId = parseBookingBody(event);
      const trip = await saved._internal.getTrip(user.sub, tripId, dbOptions);
      if (!trip) throw saved._internal.apiError(404, 'saved-trip-not-found');
      return json(200, await revalidateProductionTrip(trip, options), origin);
    }
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

module.exports = { handler: (event, context) => privateHandler(event, context && typeof context.getRemainingTimeInMillis === 'function' ? {lambdaContext:context} : context), _internal: { parseProfileBody } };
