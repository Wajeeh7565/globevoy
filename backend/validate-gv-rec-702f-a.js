'use strict';

const assert = require('assert');
const semantics = require('./services/flight-cache-semantics-702f-a');
const coverage702a = require('./services/admin/audits/global-recommendation-coverage-702a');
const {
  EVIDENCE_CLASSES_683C,
  RANKING_GRADES_683C
} = require('./services/flight-provider-contract-683c');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`[PASS] ${name}`);
}

const audit = semantics.baselineSemantics();
const coverage = coverage702a.summary();

check('702F-A is read-only and activation-free', () => {
  assert.equal(audit.ok, true);
  assert.equal(audit.version, 'GV-REC-702F-A');
  assert.equal(audit.productionImpact.activationWritten, false);
  assert.equal(audit.productionImpact.runtimeImported, false);
  assert.equal(audit.productionImpact.changes668T, false);
});

check('baseline remains the reviewed 1000-city / 439-active 668T state', () => {
  assert.equal(audit.counts.curatedCities, 1000);
  assert.equal(coverage.counts.curatedDestinationCities, 1000);
  assert.equal(coverage.counts.productionActive, 439);
});

check('all 1000 curated destinations retain a reviewed Travelpayouts static mapping', () => {
  assert.equal(audit.counts.staticTravelpayoutsMappingsVerified, 1000);
  assert.equal(coverage.counts.travelpayoutsMapped, 1000);
});

check('historical cache-miss retry population is separated from static mapping validity', () => {
  assert.equal(audit.counts.historicalMissingFlightObservationRetryQueue, 423);
  assert.equal(audit.counts.mappedCitiesWithHistoricalMissingFlightObservation, 423);
  assert.equal(audit.counts.primaryMissingFlightObservationGap, 335);
});

check('Acapulco cache miss preserves static mapping and does not claim unavailability', () => {
  const result = semantics.normalizeTravelpayoutsResult('acapulco-mx', {
    status: 'no-live-observations',
    observationCount: 0,
    inventoryObserved: false
  });
  assert.equal(result.staticProviderMappingVerified, true);
  assert.equal(result.cacheObservationStatus, semantics.CACHE_STATES.MISS);
  assert.equal(result.availabilityConclusion, 'unknown-not-proven-unavailable');
  assert.equal(result.liveVerificationRecommended, true);
  assert.equal(result.productionEligibleFromThisLayer, false);
  assert.equal(result.exactDateLiveVerificationSatisfied, false);
});

check('Aalesund cache miss is interpreted identically and remains non-decision-grade', () => {
  const result = semantics.normalizeTravelpayoutsResult('aalesund-no', {
    status: 'no-live-observations',
    observations: []
  });
  assert.equal(result.staticProviderMappingVerified, true);
  assert.equal(result.cacheObservationStatus, semantics.CACHE_STATES.MISS);
  assert.equal(result.evidenceClass, EVIDENCE_CLASSES_683C.UNAVAILABLE);
  assert.equal(result.rankingGrade, RANKING_GRADES_683C.UNAVAILABLE);
  assert.equal(result.decisionGradeFromTravelpayoutsCacheAlone, false);
});

check('positive Travelpayouts observation is cached planning evidence, never exact live evidence', () => {
  const result = semantics.normalizeTravelpayoutsResult('acapulco-mx', {
    status: 'live',
    inventoryObserved: true,
    observationCount: 3
  });
  assert.equal(result.staticProviderMappingVerified, true);
  assert.equal(result.cacheObservationStatus, semantics.CACHE_STATES.OBSERVED);
  assert.equal(result.evidenceClass, EVIDENCE_CLASSES_683C.CACHED_PROVIDER);
  assert.equal(result.rankingGrade, RANKING_GRADES_683C.PLANNING_ONLY);
  assert.equal(result.exactDateLiveVerificationSatisfied, false);
  assert.equal(result.decisionGradeFromTravelpayoutsCacheAlone, false);
  assert.equal(result.productionEligibleFromThisLayer, false);
});

check('provider error does not invalidate an otherwise reviewed static mapping', () => {
  const result = semantics.normalizeTravelpayoutsResult('acapulco-mx', {
    status: 'provider-error',
    observationCount: 0
  });
  assert.equal(result.staticProviderMappingVerified, true);
  assert.equal(result.cacheObservationStatus, semantics.CACHE_STATES.PROVIDER_ERROR);
  assert.equal(result.availabilityConclusion, 'unknown-provider-query-failed');
  assert.equal(result.productionEligibleFromThisLayer, false);
});

check('unknown/unresolved city fails closed', () => {
  const result = semantics.normalizeTravelpayoutsResult('definitely-not-a-globevoy-city', {
    status: 'unresolved-static-mapping'
  });
  assert.equal(result.staticProviderMappingVerified, false);
  assert.equal(result.cacheObservationStatus, semantics.CACHE_STATES.STATIC_UNRESOLVED);
  assert.equal(result.availabilityConclusion, 'static-provider-mapping-unresolved');
  assert.equal(result.liveVerificationRecommended, false);
  assert.equal(result.productionEligibleFromThisLayer, false);
});

console.log(`\nGV-REC-702F-A validation complete: ${passed}/9 checks passed.`);
console.log(JSON.stringify({
  version: audit.version,
  counts: audit.counts,
  baselineProductionActive: coverage.counts.productionActive,
  interpretation: audit.semantics,
  productionImpact: audit.productionImpact
}, null, 2));
