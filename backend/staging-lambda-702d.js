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

const staging = require('./staging-lambda');

const VERSION = 'GV-REC-702D-STAGING-QA-R1';

async function handler(event = {}) {
  const response = await staging.handler(event);
  const headers = { ...(response?.headers || {}) };
  headers['X-Globevoy-Staging-QA'] = VERSION;
  headers['X-Globevoy-Staging-Recovery'] = stagingRecovery.enabled() ? stagingRecovery.VERSION : 'disabled';
  headers['X-Globevoy-Staging-Gateway'] = stagingGateway.enabled() ? stagingGateway.VERSION : 'disabled';
  headers['X-Globevoy-Staging-Duffel'] = stagingDuffel703B.enabled() ? stagingDuffel703B.VERSION : 'disabled';
  return { ...response, headers };
}

module.exports = {
  VERSION,
  INSTALLATION,
  GATEWAY_INSTALLATION,
  DUFFEL_703B_INSTALLATION,
  handler,
  status: stagingRecovery.status,
  gatewayStatus: stagingGateway.status,
  duffel703BStatus: stagingDuffel703B.status
};
