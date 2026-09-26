'use strict';

const assert = require('assert');
const overlay = require('./services/reviewed-recovery-overlay-702c-r2');
const coverage702a = require('./services/admin/audits/global-recommendation-coverage-702a');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

check('702C-R2 version is exact', () => {
  assert.strictEqual(overlay.VERSION, 'GV-REC-702C-R2');
});

check('702A historical baseline remains exactly 439 active', () => {
  assert.strictEqual(coverage702a.summary().counts.productionActive, 439);
  assert.strictEqual(overlay.BASELINE_ACTIVE, 439);
});

const manifest = overlay._internal.evidence;
check('source evidence provenance is pinned to uploaded reviewed package', () => {
  assert.strictEqual(manifest.sourceEvidenceVersion, 'GV-REC-702C-RECOVERY2-REVIEW-EVIDENCE-R1');
  assert.strictEqual(manifest.sourceEvidenceSha256, 'ed35ad8ecd64bc3ea4b90b631bb3229abaf0d7aef758e91859038ba3eccb5ea0');
  assert.strictEqual(manifest.sourceGeneratedAt, '2026-08-20T09:39:37Z');
});

check('evidence package never wrote activation or relaxed thresholds', () => {
  assert.strictEqual(manifest.activationWritten, false);
  assert.strictEqual(manifest.thresholdsRelaxed, false);
  assert.strictEqual(manifest.requiresExactItineraryVerification, true);
});

check('review manifest contains exactly Acapulco and Aalesund', () => {
  assert.deepStrictEqual(manifest.cities.map(city => city.cityId).sort(), ['aalesund-no', 'acapulco-mx']);
});

for (const city of manifest.cities) {
  check(`${city.displayName} was historically mapped-reviewed-inactive for missing flight observations`, () => {
    const baseline = overlay._internal.baselineRecord(city.cityId);
    assert.ok(baseline);
    assert.strictEqual(baseline.readiness.productionActive, false);
    assert.strictEqual(baseline.readiness.tier, 'mapped-reviewed-inactive');
    assert.strictEqual(baseline.readiness.primaryGap, 'retry-queue:missing-flight-observations');
  });

  check(`${city.displayName} fresh flight evidence passes unchanged qualification`, () => {
    assert.strictEqual(city.flight.status, 'live');
    assert.strictEqual(city.flight.providerMappingVerified, true);
    assert.strictEqual(city.flight.productionEligible, true);
    assert.strictEqual(city.flight.inventoryObserved, true);
    assert.strictEqual(city.flight.comfortQualified, true);
    assert.strictEqual(city.flight.evidenceMode, 'production-provider-response');
  });

  check(`${city.displayName} fresh stay evidence passes unchanged qualification`, () => {
    assert.strictEqual(city.stay.status, 'live');
    assert.strictEqual(city.stay.providerMappingVerified, true);
    assert.strictEqual(city.stay.productionEligible, true);
    assert.strictEqual(city.stay.inventoryObserved, true);
    assert.strictEqual(city.stay.qualityQualifiedRate, true);
  });
}

const summary = overlay.summary();
check('overlay recognizes exactly two reviewed recovery candidates', () => {
  assert.strictEqual(summary.reviewedRecoveryCandidates, 2);
  assert.strictEqual(summary.records.length, 2);
  assert.ok(summary.records.every(record => record.reviewedRecoveryCandidate === true));
});

check('overlay projects 439 to 441 only if later promoted', () => {
  assert.strictEqual(summary.baselineProductionActive, 439);
  assert.strictEqual(summary.projectedProductionActiveIfPromoted, 441);
  assert.strictEqual(summary.actualActivationWritten, false);
});

check('overlay is projection-only and cannot silently activate a city', () => {
  assert.ok(summary.records.every(record => record.currentlyProductionActive === false));
  assert.ok(summary.records.every(record => record.activationWritten === false));
  assert.ok(summary.records.every(record => record.projectionOnly === true));
  assert.ok(summary.records.every(record => record.requiresExactItineraryVerification === true));
});

check('702C-R2 preserves strict thresholds and exact itinerary verification', () => {
  assert.strictEqual(summary.thresholdsRelaxed, false);
  assert.strictEqual(summary.requiresExactItineraryVerification, true);
});

console.log(`GV-REC-702C-R2 validation passed (${passed}/${passed}).`);
