'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');

const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
process.env.CORS_ORIGIN = `${STAGING_ORIGIN}/`;
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B = 'true';
process.env.ENABLE_STAGING_REVIEWED_RECOVERY_702D = 'true';
process.env.ENABLE_GENERATED_TOUR_651A = 'true';
process.env.ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B = 'true';
process.env.ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B = 'true';

const baseline = require('./services/cities/registry/verified-city-activation');
const acapulcoBefore = baseline.activationForCity('acapulco-mx', { includeEvidence: false });
const aalesundBefore = baseline.activationForCity('aalesund-no', { includeEvidence: false });
const aalborgBefore = baseline.activationForCity('aalborg-dk', { includeEvidence: false });
const overlay = require('./services/cities/recovery/staging/staging-reviewed-recovery-702d');

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

  // Run the wrapper smoke in a clean Node process. The in-process tests above
  // intentionally load generated-tour first; staging cold starts load the wrapper
  // first, which is required by later pre-load QA overlays such as GV-FLIGHT-703C.
  const wrapperSmokeRaw = execFileSync(process.execPath, ['-e', `
    const origin = ${JSON.stringify(STAGING_ORIGIN)};
    const wrapper = require('./staging-lambda-702d');
    const event = {
      rawPath: '/api/current-500-completion-audit',
      headers: { Origin: origin },
      queryStringParameters: {},
      requestContext: { http: { method: 'GET' } }
    };
    wrapper.handler(event).then(response => {
      console.log(JSON.stringify({
        version: wrapper.VERSION,
        statusCode: response.statusCode,
        cors: response.headers['Access-Control-Allow-Origin'],
        qa: response.headers['X-Globevoy-Staging-QA'],
        recovery: response.headers['X-Globevoy-Staging-Recovery'],
        duffelBudget: response.headers['X-Globevoy-Staging-Duffel-Budget'],
        duffelBudgetCap: response.headers['X-Globevoy-Staging-Duffel-Budget-Cap']
      }));
    }).catch(error => { console.error(error); process.exit(1); });
  `], {
    cwd: __dirname,
    encoding: 'utf8',
    env: {
      ...process.env,
      CORS_ORIGIN: `${STAGING_ORIGIN}/`,
      ENABLE_VERIFIED_CITY_ACTIVATION_668T: 'true',
      ENABLE_MVP_VALIDATION_REPAIRS_669B: 'true',
      ENABLE_STAGING_REVIEWED_RECOVERY_702D: 'true',
      ENABLE_GENERATED_TOUR_651A: 'true',
      ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B: 'true',
      ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B: 'true'
    }
  }).trim();
  const wrapperSmoke = JSON.parse(wrapperSmokeRaw.split(/\r?\n/).filter(Boolean).pop());

  await check('702D Lambda wrapper is explicit and reports QA headers', async () => {
    assert.strictEqual(wrapperSmoke.version, 'GV-REC-702D-STAGING-QA-R1');
    assert.strictEqual(wrapperSmoke.statusCode, 200);
    assert.strictEqual(wrapperSmoke.cors, STAGING_ORIGIN);
    assert.strictEqual(wrapperSmoke.qa, 'GV-REC-702D-STAGING-QA-R1');
    assert.strictEqual(wrapperSmoke.recovery, 'GV-REC-702D');
    assert.strictEqual(wrapperSmoke.duffelBudget, 'GV-FLIGHT-703C');
    assert.strictEqual(wrapperSmoke.duffelBudgetCap, '8');
  });

  console.log(`GV-REC-702D validation passed (${passed}/${passed}).`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
