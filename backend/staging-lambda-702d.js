'use strict';

// GV-REC-702D staging QA entrypoint.
// Installs the reviewed-recovery eligibility overlay BEFORE the ordinary
// staging Lambda loads the production handler. That lets generated-tour.js
// capture the staging-only liveRecommendationEligible function at require time.
//
// Rollback: set the Lambda handler back to `staging-lambda.handler` and remove
// the 702D QA flag. No production snapshot or handler is changed.

const stagingRecovery = require('./services/staging-reviewed-recovery-702d');
const INSTALLATION = stagingRecovery.install();
const staging = require('./staging-lambda');

const VERSION = 'GV-REC-702D-STAGING-QA-R1';

async function handler(event = {}) {
  const response = await staging.handler(event);
  const headers = { ...(response?.headers || {}) };
  headers['X-Globevoy-Staging-QA'] = VERSION;
  headers['X-Globevoy-Staging-Recovery'] = stagingRecovery.enabled() ? stagingRecovery.VERSION : 'disabled';
  return { ...response, headers };
}

module.exports = {
  VERSION,
  INSTALLATION,
  handler,
  status: stagingRecovery.status
};
