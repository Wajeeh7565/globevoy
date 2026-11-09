'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const audit = require('../data/gv-flight-703a-duffel-expansion-audit.json');
const duffel = require('../services/providers/flights/duffel/duffel-live-adapter-683d');
const p2 = require('../services/providers/flights/duffel/duffel-p2-staging-683h');
const pilot = require('../services/domain/live-fares/public-live-fare-pilot-684a');
const discovery = require('../services/domain/live-fares/affordable-flight-discovery-684b');

function source(rel) {
  return fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf8');
}

function main() {
  assert.strictEqual(audit.version, 'GV-FLIGHT-703A');
  assert.strictEqual(audit.status, 'research-only-expansion-audit');
  assert.strictEqual(audit.runtimeChanged, false);
  assert.strictEqual(audit.providerCallsPerformed, false);
  assert.strictEqual(audit.productionDeploymentPerformed, false);

  assert.strictEqual(duffel.DUFFEL_PROVIDER_VERSION_683D, 'GV-PROVIDER-683D');
  assert.strictEqual(duffel.ALLOWED_PATH_683D, '/air/offer_requests');
  assert.strictEqual(duffel.descriptor683D().evidenceClass, 'LIVE_PROVIDER');
  assert.strictEqual(duffel.descriptor683D().rankingGrade, 'DECISION_GRADE');
  assert.strictEqual(duffel.descriptor683D().supportsExactDate, true);
  assert.strictEqual(duffel.descriptor683D().productionApproved, false);

  assert.strictEqual(p2.VERSION_683H, 'GV-PROVIDER-683M-R4');
  assert.strictEqual(p2.MAX_PROVIDER_CONCURRENCY_683M, 2);
  assert.strictEqual(p2.MAX_HARD_REQUEST_CAP_683H, 12);
  assert.strictEqual(p2.MAX_RATE_LIMIT_RETRIES_PER_REQUEST_683MR3, 1);
  assert.strictEqual(p2.MAX_RATE_LIMIT_WAIT_MS_683MR3, 15000);

  assert.strictEqual(pilot.VERSION_684A, 'GV-FLIGHT-684A');
  assert.deepStrictEqual(pilot.DEFAULT_ORIGINS_684A, ['YYZ', 'JFK', 'LAX', 'DUB', 'DXB']);
  assert.strictEqual(pilot.MAX_FLIGHT_LEGS_684A, 3);
  const pilotStatus = pilot.status684A({});
  assert.strictEqual(pilotStatus.singleAdultOnly, true);
  assert.strictEqual(pilotStatus.exactAirportFirst, true);
  assert.strictEqual(pilotStatus.sameCityMetroFallback, true);
  assert.strictEqual(pilotStatus.allFlightLegsAtomic, true);
  assert.strictEqual(pilotStatus.finalSelectedScheduleOnly, true);
  assert.strictEqual(pilotStatus.orderCapability, false);
  assert.strictEqual(pilotStatus.paymentCapability, false);
  assert.strictEqual(pilotStatus.bookingCapability, false);
  assert.strictEqual(pilotStatus.ticketingCapability, false);

  assert.strictEqual(discovery.VERSION_684B, 'GV-REC-684B-R3');
  assert.deepStrictEqual(discovery.DEFAULT_ORIGINS_684B, ['YYZ']);
  assert.strictEqual(discovery.MAX_CANDIDATE_CHECKS_684B, 2);
  assert.strictEqual(discovery.MAX_FLIGHT_LEGS_684B, 3);
  assert.strictEqual(discovery.PLANNING_OVERAGE_RATIO_684B, 1.15);
  const discoveryStatus = discovery.status684B({ ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true' });
  assert.strictEqual(discoveryStatus.singleAdultOnly, true);
  assert.strictEqual(discoveryStatus.completeLiveEvidenceRequired, true);
  assert.strictEqual(discoveryStatus.preservesLowestCostGroundOption, true);
  assert.strictEqual(discoveryStatus.orderCapability, false);
  assert.strictEqual(discoveryStatus.paymentCapability, false);
  assert.strictEqual(discoveryStatus.bookingCapability, false);
  assert.strictEqual(discoveryStatus.ticketingCapability, false);

  const max684ASearches = pilot.MAX_FLIGHT_LEGS_684A * 2;
  const max684BSearches = discovery.MAX_CANDIDATE_CHECKS_684B * max684ASearches;
  const rescueWorstCase = max684ASearches + max684BSearches;
  assert.strictEqual(max684ASearches, 6);
  assert.strictEqual(max684BSearches, 12);
  assert.strictEqual(rescueWorstCase, 18);
  assert.strictEqual(audit.publicLiveFare684A.maximumSearchesForThreeLegTour, max684ASearches);
  assert.strictEqual(audit.affordableDiscovery684B.maximumSearchesAcrossTwoCandidates, max684BSearches);
  assert.strictEqual(audit.aggregateRequestRisk.theoreticalGeneratedTourSearchesInOverBudgetRescuePath, rescueWorstCase);

  assert.deepStrictEqual(audit.recommended703B.origins, pilot.DEFAULT_ORIGINS_684A);
  assert.deepStrictEqual(audit.recommended703B.keep684BOrigins, discovery.DEFAULT_ORIGINS_684B);
  assert.strictEqual(audit.recommended703B.keepSingleAdultOnly, true);
  assert.strictEqual(audit.recommended703B.keepMaxFlightLegs, 3);
  assert.strictEqual(audit.recommended703CPrerequisite.requiredBeforeBroad684BExpansion, true);
  assert.strictEqual(audit.recommended703CPrerequisite.suggestedInitialHardCeiling, 12);

  const adapterSource = source('services/providers/flights/duffel/duffel-live-adapter-683d.js');
  assert(adapterSource.includes('supplier_timeout=10000'));
  assert(adapterSource.includes("'Duffel-Version': 'v2'"));
  assert(adapterSource.includes('ratelimit-remaining'));
  assert(adapterSource.includes('ratelimit-reset'));
  assert(!/air\/orders/.test(adapterSource), 'search adapter must not call order endpoint');

  const pilotSource = source('services/domain/live-fares/public-live-fare-pilot-684a.js');
  assert(pilotSource.includes("GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A"));
  assert(pilotSource.includes('tasks.length * 2'));
  assert(pilotSource.includes('allFlightLegsAtomic: true'));

  const discoverySource = source('services/domain/live-fares/affordable-flight-discovery-684b.js');
  assert(discoverySource.includes("DEFAULT_ORIGINS_684B = Object.freeze(['YYZ'])"));
  assert(discoverySource.includes('MAX_CANDIDATE_CHECKS_684B = 2'));
  assert(discoverySource.includes('allowSelectedFlightFallback'));

  const generated = source('services/domain/tours/generated-tour.js');
  assert(generated.includes('discoverAffordableFlightTour684B('));
  assert(generated.includes('applyPublicLiveFarePilot684A(enrichment.tour, routeQuery)'));
  assert(generated.includes('overBudgetFlightRescue684B'));

  for (const runtimePath of [
    'lambda.js',
    'staging-lambda.js',
    'staging-lambda-702d.js',
    'services/domain/tours/generated-tour.js',
    'services/providers/flights/duffel/duffel-live-adapter-683d.js',
    'services/providers/flights/duffel/duffel-p2-staging-683h.js',
    'services/domain/live-fares/public-live-fare-pilot-684a.js',
    'services/domain/live-fares/affordable-flight-discovery-684b.js'
  ]) {
    const text = source(runtimePath);
    assert(!text.includes('gv-flight-703a-duffel-expansion-audit'), `${runtimePath}: 703A must not be runtime imported`);
    assert(!text.includes('GV-FLIGHT-703A'), `${runtimePath}: 703A runtime wiring detected`);
  }

  console.log('GV-FLIGHT-703A validation PASS');
  console.log(JSON.stringify({
    version: audit.version,
    public684ADefaultOrigins: pilot.DEFAULT_ORIGINS_684A,
    affordable684BOrigins: discovery.DEFAULT_ORIGINS_684B,
    max684ASearches,
    max684BSearches,
    theoreticalOverBudgetRescueWorstCaseSearches: rescueWorstCase,
    providerConcurrencyPerState: p2.MAX_PROVIDER_CONCURRENCY_683M,
    providerHardCapPerState: p2.MAX_HARD_REQUEST_CAP_683H,
    recommended703B: audit.recommended703B,
    runtimeChanged: false,
    providerCallsPerformed: false,
    productionDeploymentPerformed: false
  }, null, 2));
}

main();
