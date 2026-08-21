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

const staging = require('./staging-lambda');

const VERSION = 'GV-REC-702D-STAGING-QA-R1';

async function handler(event = {}) {
  return stagingDuffelBudget703C.runWithBudget(async () => {
    const response = await staging.handler(event);
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
    return { ...response, headers };
  }, {
    requestId: event?.requestContext?.requestId || event?.requestContext?.http?.requestId || null
  });
}

module.exports = {
  VERSION,
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
  duffel703EStatus: stagingAdults703E.status
};
