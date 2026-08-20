'use strict';

const assert = require('assert');

const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
process.env.CORS_ORIGIN = `${STAGING_ORIGIN}/`;
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B = 'true';
process.env.ENABLE_STAGING_REVIEWED_RECOVERY_702D = 'true';
process.env.ENABLE_GENERATED_TOUR_651A = 'true';
process.env.ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B = 'true';
process.env.ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B = 'true';

const baseline = require('./services/verified-city-activation');
const acapulcoBefore = baseline.activationForCity('acapulco-mx', { includeEvidence: false });
const aalesundBefore = baseline.activationForCity('aalesund-no', { includeEvidence: false });
const aalborgBefore = baseline.activationForCity('aalborg-dk', { includeEvidence: false });
const overlay = require('./services/staging-reviewed-recovery-702d');

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}
function event(path, method = 'GET', origin = STAGING_ORIGIN) {
  return {
    rawPath: path,
    headers: origin ? { Origin: origin } : {},
    queryStringParameters: {},
    requestContext: { http: { method } }
  };
}

(async () => {
  await check('702D version and exact staging origin are pinned', () => {
    assert.strictEqual(overlay.VERSION, 'GV-REC-702D');
    assert.strictEqual(overlay.REQUIRED_STAGING_ORIGIN, STAGING_ORIGIN);
  });

  await check('668T baseline still has Acapulco and Aalesund inactive before overlay install', () => {
    assert.strictEqual(acapulcoBefore.liveRecommendationEligible, false);
    assert.strictEqual(aalesundBefore.liveRecommendationEligible, false);
    assert.strictEqual(aalborgBefore.liveRecommendationEligible, false);
  });

  await check('702D only enables when exact staging origin + 668T + QA flag are all present', () => {
    assert.strictEqual(overlay.enabled(), true);
    assert.strictEqual(overlay.enabled({
      CORS_ORIGIN: STAGING_ORIGIN,
      ENABLE_VERIFIED_CITY_ACTIVATION_668T: 'true',
      ENABLE_STAGING_REVIEWED_RECOVERY_702D: 'false'
    }), false);
    assert.strictEqual(overlay.enabled({
      CORS_ORIGIN: 'https://globevoy.com',
      ENABLE_VERIFIED_CITY_ACTIVATION_668T: 'true',
      ENABLE_STAGING_REVIEWED_RECOVERY_702D: 'true'
    }), false);
    assert.strictEqual(overlay.enabled({
      CORS_ORIGIN: STAGING_ORIGIN,
      ENABLE_VERIFIED_CITY_ACTIVATION_668T: 'false',
      ENABLE_STAGING_REVIEWED_RECOVERY_702D: 'true'
    }), false);
  });

  const install = overlay.install({ baseline });
  await check('702D installs a dynamic staging-only eligibility overlay', () => {
    assert.strictEqual(install.installed, true);
    assert.strictEqual(install.enabled, true);
    assert.strictEqual(install.projectedStagingQaActive, 441);
    assert.strictEqual(install.actualProductionActivationWritten, false);
  });

  const acapulco = baseline.activationForCity('acapulco-mx', { includeEvidence: false });
  const aalesund = baseline.activationForCity('aalesund-no', { includeEvidence: false });
  const aalborg = baseline.activationForCity('aalborg-dk', { includeEvidence: false });

  await check('Acapulco and Aalesund become staging-QA eligible', () => {
    for (const record of [acapulco, aalesund]) {
      assert.strictEqual(record.liveRecommendationEligible, true);
      assert.strictEqual(record.auditStatus, 'reviewed-staging-qa');
      assert.strictEqual(record.activation.policyVersion, 'GV-REC-702D');
      assert.strictEqual(record.stagingReviewedRecovery.stagingQaOnly, true);
      assert.strictEqual(record.stagingReviewedRecovery.actualProductionActivationWritten, false);
      assert.strictEqual(record.stagingReviewedRecovery.requiresExactItineraryVerification, true);
    }
  });

  await check('Aalborg and unrelated inactive cities remain blocked', () => {
    assert.strictEqual(aalborg.liveRecommendationEligible, false);
    assert.strictEqual(baseline.liveRecommendationEligible('aalborg-dk'), false);
  });

  await check('historical 668T summary remains exactly 439 active', () => {
    const summary = baseline.summary();
    assert.strictEqual(summary.version, 'GV-CITY-668T');
    assert.strictEqual(summary.summary.productionActiveCount, 439);
  });

  const generatedTour = require('./generated-tour');
  await check('generated-tour production-active gate accepts the two reviewed QA recoveries', () => {
    assert.strictEqual(generatedTour._internal.allTourStopsProductionActive({
      stops: [
        { cityId: 'acapulco-mx', displayName: 'Acapulco', countryCode: 'MX' },
        { cityId: 'aalesund-no', displayName: 'Aalesund', countryCode: 'NO' }
      ]
    }), true);
  });

  await check('generated-tour gate still rejects Aalborg', () => {
    assert.strictEqual(generatedTour._internal.allTourStopsProductionActive({
      stops: [{ cityId: 'aalborg-dk', displayName: 'Aalborg', countryCode: 'DK' }]
    }), false);
  });

  process.env.ENABLE_STAGING_REVIEWED_RECOVERY_702D = 'false';
  await check('turning the 702D flag off immediately restores the 668T decision', () => {
    assert.strictEqual(baseline.liveRecommendationEligible('acapulco-mx'), false);
    assert.strictEqual(baseline.liveRecommendationEligible('aalesund-no'), false);
  });
  process.env.ENABLE_STAGING_REVIEWED_RECOVERY_702D = 'true';

  const status = overlay.status();
  await check('702D status reports 439 baseline, 2 reviewed recoveries, 441 staging-QA effective', () => {
    assert.strictEqual(status.baselineProductionActive, 439);
    assert.strictEqual(status.reviewedRecoveryCandidates, 2);
    assert.strictEqual(status.effectiveStagingQaActiveIfEnabled, 441);
    assert.strictEqual(status.actualProductionActivationWritten, false);
    assert.strictEqual(status.thresholdsRelaxed, false);
  });

  const wrapper = require('./staging-lambda-702d');
  await check('702D Lambda wrapper is explicit and reports QA headers', async () => {
    assert.strictEqual(wrapper.VERSION, 'GV-REC-702D-STAGING-QA-R1');
    const response = await wrapper.handler(event('/api/current-500-completion-audit'));
    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.headers['Access-Control-Allow-Origin'], STAGING_ORIGIN);
    assert.strictEqual(response.headers['X-Globevoy-Staging-QA'], 'GV-REC-702D-STAGING-QA-R1');
    assert.strictEqual(response.headers['X-Globevoy-Staging-Recovery'], 'GV-REC-702D');
  });

  console.log(`GV-REC-702D validation passed (${passed}/${passed}).`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
