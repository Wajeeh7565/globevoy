'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.ENABLE_GLOBAL_RECOMMENDATION_COVERAGE_AUDIT_702A = 'true';

const coverage702a = require('./services/admin/audits/global-recommendation-coverage-702a');
const reviewedRecovery = require('./services/reviewed-recovery-overlay-702c-r2');
const promotion = require('./services/reviewed-activation-promotion-702e');
const manifest = require('./data/gv-rec-702e-promotion-manifest.json');

const EXPECTED_IDS = ['acapulco-mx', 'aalesund-no'];
const EVIDENCE_SHA = 'ed35ad8ecd64bc3ea4b90b631bb3229abaf0d7aef758e91859038ba3eccb5ea0';
const BASE_BLOB_SHA = '50079727885aa1c46fb366578917b5eec74b49f9';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

function sorted(values) { return [...values].sort(); }

check('702E version and immutable source identities are exact', () => {
  assert.strictEqual(promotion.VERSION, 'GV-REC-702E');
  assert.strictEqual(promotion.BASELINE_VERSION, 'GV-CITY-668T');
  assert.strictEqual(manifest.version, 'GV-REC-702E-PROMOTION-CANDIDATE-R1');
  assert.strictEqual(manifest.baseActivationVersion, 'GV-CITY-668T');
  assert.strictEqual(manifest.baseActivationGitBlobSha, BASE_BLOB_SHA);
  assert.strictEqual(manifest.sourceEvidenceSha256, EVIDENCE_SHA);
});

const baseline = coverage702a._internal.auditedRecords();
const baselineSummary = coverage702a.summary();
const projected = promotion.projectedRecords();
const summary = promotion.summary();

check('668T baseline remains exactly 1000 audited records and 439 production-active', () => {
  assert.strictEqual(baseline.length, 1000);
  assert.strictEqual(baselineSummary.counts.auditedIn668T, 1000);
  assert.strictEqual(baselineSummary.counts.productionActive, 439);
  assert.strictEqual(promotion.BASELINE_ACTIVE, 439);
});

check('promotion manifest contains exactly the two reviewed cities', () => {
  assert.strictEqual(manifest.reviewedPromotionCount, 2);
  assert.strictEqual(manifest.projectedProductionActive, 441);
  assert.deepStrictEqual(sorted(manifest.cities.map(row => row.cityId)), sorted(EXPECTED_IDS));
  assert.strictEqual(new Set(manifest.cities.map(row => row.cityId)).size, 2);
});

check('reviewed evidence remains qualified for both promotion candidates', () => {
  for (const cityId of EXPECTED_IDS) {
    const reviewed = reviewedRecovery.resolve(cityId);
    assert.ok(reviewed, `${cityId} reviewed evidence missing`);
    assert.strictEqual(reviewed.reviewedRecoveryCandidate, true);
    assert.strictEqual(reviewed.freshEvidenceQualified, true);
    assert.strictEqual(reviewed.historicalBoundarySatisfied, true);
    assert.strictEqual(reviewed.activationWritten, false);
    assert.strictEqual(reviewed.requiresExactItineraryVerification, true);
  }
});

check('historical 668T state for both cities is inactive only for missing flight observations', () => {
  for (const cityId of EXPECTED_IDS) {
    const row = baseline.find(record => record.cityId === cityId);
    assert.ok(row, `${cityId} missing from baseline`);
    assert.strictEqual(row.readiness.productionActive, false);
    assert.strictEqual(row.readiness.tier, 'mapped-reviewed-inactive');
    assert.strictEqual(row.readiness.primaryGap, 'retry-queue:missing-flight-observations');
    assert.ok(row.activation.retryQueues.includes('missing-flight-observations'));
  }
});

check('702E projection is ready and changes exactly two records', () => {
  assert.strictEqual(summary.status, 'promotion-candidate-ready');
  assert.strictEqual(summary.baselineProductionActive, 439);
  assert.strictEqual(summary.baselineRecordCount, 1000);
  assert.strictEqual(summary.reviewedPromotionCount, 2);
  assert.strictEqual(summary.changedRecordCount, 2);
  assert.deepStrictEqual(sorted(summary.changedCityIds), sorted(EXPECTED_IDS));
  assert.strictEqual(summary.rejectedPromotionCount, 0);
  assert.strictEqual(summary.projectedProductionActive, 441);
});

check('both projected promotions use strict live-both direct-or-metro semantics', () => {
  for (const cityId of EXPECTED_IDS) {
    const row = promotion.resolve(cityId);
    assert.ok(row, `${cityId} projection missing`);
    assert.strictEqual(row.promotionCandidate, true);
    assert.strictEqual(row.promotionPolicyVersion, 'GV-REC-702E');
    assert.strictEqual(row.activation.auditStatus, 'reviewed-active-candidate');
    assert.strictEqual(row.activation.liveRecommendationEligible, true);
    assert.strictEqual(row.activation.recommendationMode, 'verified-live-provider-capability');
    assert.strictEqual(row.activation.classification, 'live-both');
    assert.strictEqual(row.activation.activationMode, 'direct-or-metro');
    assert.strictEqual(row.activation.activationReason, 'gv-rec-702e-reviewed-recovery-candidate');
    assert.deepStrictEqual(row.activation.retryQueues, []);
    assert.strictEqual(row.readiness.tier, 'production-active');
    assert.strictEqual(row.readiness.productionActive, true);
    assert.strictEqual(row.readiness.primaryGap, null);
    assert.deepStrictEqual(row.readiness.gapCodes, []);
    assert.strictEqual(row.readiness.requiresExactItineraryVerification, true);
    assert.strictEqual(row.actualProductionActivationWritten, false);
    assert.strictEqual(row.sourceEvidenceSha256, EVIDENCE_SHA);
  }
});

check('all 998 non-promoted projected records remain exactly equal to 668T coverage records', () => {
  assert.strictEqual(projected.length, baseline.length);
  let unchanged = 0;
  for (let index = 0; index < baseline.length; index += 1) {
    const before = baseline[index];
    const after = projected[index];
    if (EXPECTED_IDS.includes(before.cityId)) continue;
    assert.deepStrictEqual(after, before, `unexpected projection mutation for ${before.cityId}`);
    unchanged += 1;
  }
  assert.strictEqual(unchanged, 998);
});

check('unrelated Aalborg remains inactive in the candidate projection', () => {
  const baselineAalborg = baseline.find(record => record.cityId === 'aalborg-dk');
  const projectedAalborg = promotion.resolve('aalborg-dk');
  assert.ok(baselineAalborg && projectedAalborg);
  assert.deepStrictEqual(projectedAalborg, baselineAalborg);
  assert.strictEqual(projectedAalborg.readiness.productionActive, false);
});

check('candidate never relaxes thresholds or claims a production write/deployment', () => {
  assert.strictEqual(manifest.thresholdsRelaxed, false);
  assert.strictEqual(manifest.requiresExactItineraryVerification, true);
  assert.strictEqual(manifest.actualProductionActivationWritten, false);
  assert.strictEqual(manifest.productionDeploymentPerformed, false);
  assert.strictEqual(summary.thresholdsRelaxed, false);
  assert.strictEqual(summary.requiresExactItineraryVerification, true);
  assert.strictEqual(summary.actualProductionActivationWritten, false);
  assert.strictEqual(summary.productionDeploymentPerformed, false);
});

check('702E candidate is not imported by any Lambda or production activation runtime', () => {
  const root = __dirname;
  for (const rel of ['lambda.js', 'staging-lambda.js', 'services/verified-city-activation.js']) {
    const source = fs.readFileSync(path.join(root, rel), 'utf8');
    assert.ok(!source.includes('reviewed-activation-promotion-702e'), `${rel} imports 702E candidate`);
    assert.ok(!source.includes('gv-rec-702e-promotion-manifest'), `${rel} imports 702E manifest`);
  }
});

console.log(`GV-REC-702E validation passed (${passed}/${passed}).`);
