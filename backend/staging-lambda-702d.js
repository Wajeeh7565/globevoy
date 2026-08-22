'use strict';

// GV-REC-702D staging QA entrypoint.
// Installs staging-only overlays BEFORE the ordinary staging Lambda loads the
// production handler. That lets generated-tour.js and city-registry.js capture
// the reviewed QA behavior at require time.
//
// Rollback: set the Lambda handler back to `staging-lambda.handler` and remove
// the staging QA flags. No production snapshot or handler is changed.

const stagingRecovery = require('./services/staging-reviewed-recovery-702d');
const INSTALLATION = stagingRecovery.install();

const stagingGateway = require('./services/staging-gateway-foundation-702f-d');
const GATEWAY_INSTALLATION = stagingGateway.install();
if (stagingGateway.enabled() && GATEWAY_INSTALLATION.ok !== true) {
  throw new Error(`GV-REC-702F-D staging gateway overlay failed closed: ${(GATEWAY_INSTALLATION.issues || []).join(',')}`);
}

const stagingDuffel703B = require('./services/staging-duffel-five-origin-703b');
const DUFFEL_703B_INSTALLATION = stagingDuffel703B.install();
if (stagingDuffel703B.enabled() && DUFFEL_703B_INSTALLATION.ok !== true) {
  throw new Error(`GV-FLIGHT-703B staging Duffel origin policy failed closed: ${DUFFEL_703B_INSTALLATION.reason || 'unknown'}`);
}

// Install 703C before staging-lambda -> lambda -> generated-tour loads 684A.
// This guarantees generated-tour captures the shared-budget-aware 684A export.
const stagingDuffelBudget703C = require('./services/staging-duffel-shared-budget-703c');
const DUFFEL_703C_INSTALLATION = stagingDuffelBudget703C.install();
if (stagingDuffelBudget703C.enabled() && DUFFEL_703C_INSTALLATION.ok !== true) {
  throw new Error(`GV-FLIGHT-703C staging shared Duffel budget failed closed: ${DUFFEL_703C_INSTALLATION.reason || 'unknown'}`);
}

// 703D must install after the 703B five-origin final-schedule policy is present,
// but before generated-tour loads 684B. It only injects the bounded staging
// affordable-discovery allowlist; it does not enable Duffel or add credentials.
const stagingAffordable703D = require('./services/staging-affordable-flight-five-origin-703d');
const DUFFEL_703D_INSTALLATION = stagingAffordable703D.install();
if (stagingAffordable703D.enabled() && DUFFEL_703D_INSTALLATION.ok !== true) {
  throw new Error(`GV-FLIGHT-703D staging affordable-flight origin policy failed closed: ${DUFFEL_703D_INSTALLATION.reason || 'unknown'}`);
}

// 703E installs after 703B/703C/703D so the origin cohort and shared cap are
// already proven. It only raises the in-process adult ceiling from one to two
// for this exact staging origin; it does not enable Duffel or add credentials.
const stagingAdults703E = require('./services/staging-duffel-two-adult-703e');
const DUFFEL_703E_INSTALLATION = stagingAdults703E.install();
if (stagingAdults703E.enabled() && DUFFEL_703E_INSTALLATION.ok !== true) {
  throw new Error(`GV-FLIGHT-703E staging two-adult policy failed closed: ${DUFFEL_703E_INSTALLATION.reason || 'unknown'}`);
}

// 705B-R3 is code-only and staging-only. It verifies Cognito access tokens
// against the fixed staging user pool and never handles passwords or AWS keys.
const stagingAccount705B = require('./services/staging-cognito-auth-705b-r3');

// 705C is staging-only owner-private saved-trip storage. It reuses the exact
// 705B verifier and derives DynamoDB ownership only from the verified token sub.
const stagingSavedTrips705C = require('./services/staging-saved-trips-705c');

// 707B-R1 preserves the owner-private 707B provider flow and repairs only the
// compact-snapshot saved-flight baseline used for price-change arithmetic.
const stagingBooking707B = require('./services/staging-booking-revalidation-707b-r1');

const staging = require('./staging-lambda');

const VERSION = 'GV-REC-702D-STAGING-QA-R1';
const SAVED_TRIPS_CORS_VERSION = 'GV-ACCOUNT-705C-R4';

function eventPath(event = {}) {
  return String(event.rawPath || event.path || '').split('?')[0];
}

function eventMethod(event = {}) {
  return String(event?.requestContext?.http?.method || event?.httpMethod || 'GET').toUpperCase();
}

function requestOrigin(event = {}) {
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (String(key || '').trim().toLowerCase() === 'origin') return String(value || '').trim();
  }
  return '';
}

function savedTripsPreflight705CR4(event = {}) {
  const origin = requestOrigin(event);
  const fixedOrigin = stagingSavedTrips705C.STAGING_ORIGIN;
  const baseHeaders = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Globevoy-Saved-Trips': stagingSavedTrips705C.VERSION,
    'X-Globevoy-Saved-Trips-Cors': SAVED_TRIPS_CORS_VERSION
  };
  if (origin !== fixedOrigin) {
    return {
      statusCode: 403,
      headers: baseHeaders,
      body: JSON.stringify({ ok: false, error: 'staging-origin-not-allowed' })
    };
  }
  return {
    statusCode: 204,
    headers: {
      ...baseHeaders,
      'Access-Control-Allow-Origin': fixedOrigin,
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Max-Age': '600'
    },
    body: ''
  };
}

async function handler(event = {}) {
  return stagingDuffelBudget703C.runWithBudget(async () => {
    const path = eventPath(event);
    const method = eventMethod(event);
    // Keep the exact historical 705B route expression while adding sibling routes.
    const isAccountRoute = eventPath(event) === '/api/account/session';
    const isSavedTripsRoute = path === stagingSavedTrips705C.ROUTE_PATH;
    const isBookingRevalidationRoute = path === stagingBooking707B.ROUTE_PATH;
    let response;
    if (method === 'OPTIONS' && isSavedTripsRoute) {
      // 705C CRUD needs PUT/DELETE in addition to the production GET/POST CORS
      // baseline. Keep this expansion isolated to the exact staging route.
      response = savedTripsPreflight705CR4(event);
    } else if (method === 'OPTIONS' && isBookingRevalidationRoute) {
      response = stagingBooking707B.preflight(event);
    } else if (method !== 'OPTIONS' && isAccountRoute) {
      response = await stagingAccount705B.handleAccountSession705B(event);
    } else if (method !== 'OPTIONS' && isSavedTripsRoute) {
      response = await stagingSavedTrips705C.handleSavedTrips705C(event);
    } else if (method !== 'OPTIONS' && isBookingRevalidationRoute) {
      response = await stagingBooking707B.handleBookingRevalidation707B(event);
    } else {
      // Existing staging/prod gateway remains authoritative for OPTIONS/CORS and
      // every non-account route. This preserves all historical behavior.
      response = await staging.handler(event);
    }
    const headers = { ...(response?.headers || {}) };
    const budget = stagingDuffelBudget703C.snapshot();
    headers['X-Globevoy-Staging-QA'] = VERSION;
    headers['X-Globevoy-Staging-Recovery'] = stagingRecovery.enabled() ? stagingRecovery.VERSION : 'disabled';
    headers['X-Globevoy-Staging-Gateway'] = stagingGateway.enabled() ? stagingGateway.VERSION : 'disabled';
    headers['X-Globevoy-Staging-Duffel'] = stagingDuffel703B.enabled() ? stagingDuffel703B.VERSION : 'disabled';
    headers['X-Globevoy-Staging-Duffel-Budget'] = stagingDuffelBudget703C.enabled() ? stagingDuffelBudget703C.VERSION : 'disabled';
    headers['X-Globevoy-Staging-Duffel-Budget-Cap'] = String(budget.cap);
    headers['X-Globevoy-Staging-Duffel-Budget-Used'] = String(budget.used);
    headers['X-Globevoy-Staging-Duffel-Discovery'] = stagingAffordable703D.enabled() ? stagingAffordable703D.VERSION : 'disabled';
    headers['X-Globevoy-Staging-Duffel-Adults'] = stagingAdults703E.enabled() ? stagingAdults703E.VERSION : 'disabled';
    headers['X-Globevoy-Staging-Duffel-Max-Adults'] = String(DUFFEL_703E_INSTALLATION?.maxAdults || 1);
    headers['X-Globevoy-Staging-Account'] = stagingAccount705B.enabled() ? stagingAccount705B.VERSION : 'disabled';
    headers['X-Globevoy-Staging-Saved-Trips'] = stagingSavedTrips705C.enabled() ? stagingSavedTrips705C.VERSION : 'disabled';
    headers['X-Globevoy-Staging-Booking-Revalidation'] = stagingBooking707B.VERSION;
    return { ...response, headers };
  }, {
    requestId: event?.requestContext?.requestId || event?.requestContext?.http?.requestId || null
  });
}

module.exports = {
  VERSION,
  SAVED_TRIPS_CORS_VERSION,
  INSTALLATION,
  GATEWAY_INSTALLATION,
  DUFFEL_703B_INSTALLATION,
  DUFFEL_703C_INSTALLATION,
  DUFFEL_703D_INSTALLATION,
  DUFFEL_703E_INSTALLATION,
  handler,
  status: stagingRecovery.status,
  gatewayStatus: stagingGateway.status,
  duffel703BStatus: stagingDuffel703B.status,
  duffel703CStatus: stagingDuffelBudget703C.status,
  duffel703DStatus: stagingAffordable703D.status,
  duffel703EStatus: stagingAdults703E.status,
  account705BStatus: stagingAccount705B.status705B,
  savedTrips705CStatus: stagingSavedTrips705C.status705C,
  booking707BStatus: stagingBooking707B.status707B,
  _internal: {
    eventPath,
    eventMethod,
    requestOrigin,
    savedTripsPreflight705CR4
  }
};