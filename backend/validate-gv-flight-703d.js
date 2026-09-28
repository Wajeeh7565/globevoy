'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const policy703B = require('./services/providers/flights/duffel/staging/staging-duffel-five-origin-703b');
const policy703D = require('./services/providers/flights/staging/staging-affordable-flight-five-origin-703d');
const discovery684B = require('./services/domain/live-fares/affordable-flight-discovery-684b');
const shared703C = require('./services/providers/flights/duffel/staging/staging-duffel-shared-budget-703c');

const ROOT = __dirname;
const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com/';
const EXPECTED_ORIGINS = ['YYZ', 'JFK', 'LAX', 'DUB', 'DXB'];

function candidateTour(origin, suffix = 'candidate', flightLegCount = 1) {
  const legs = [];
  let from = origin;
  for (let index = 0; index < flightLegCount; index += 1) {
    const to = index === flightLegCount - 1 ? 'MIA' : ['ORD', 'ATL', 'BOS'][index] || 'MIA';
    legs.push({
      mode: 'flight',
      transportType: 'flight',
      from: { airportCode: from },
      to: { airportCode: to },
      departureDate: `2026-10-${String(15 + index).padStart(2, '0')}`,
      estimatedTransportUsd: 150,
      estimatedFlightUsd: 150
    });
    from = to;
  }
  return {
    origin: { airportCode: origin },
    estimatedTotalUsd: 700,
    totalBudgetUsd: 1000,
    legs,
    stops: [{ cityId: `${origin.toLowerCase()}-${suffix}` }]
  };
}

function main() {
  assert.equal(policy703D.VERSION, 'GV-FLIGHT-703D');
  assert.deepEqual(policy703D.ORIGINS, EXPECTED_ORIGINS);
  assert.deepEqual(policy703B.ORIGINS, EXPECTED_ORIGINS, '703D must reuse the proven 703B cohort');
  assert.equal(policy703D.REQUIRED_SHARED_BUDGET_VERSION, 'GV-FLIGHT-703C');
  assert.equal(policy703D.REQUIRED_SHARED_BUDGET_CAP, 8);
  assert.equal(shared703C.SHARED_PHYSICAL_REQUEST_CAP, 8, '703C shared cap must remain 8');

  // 703D cannot install until the 703B five-origin policy is already present.
  const missing703BEnv = { CORS_ORIGIN: STAGING_ORIGIN };
  const missing703B = policy703D.install(missing703BEnv);
  assert.equal(missing703B.ok, false);
  assert.equal(missing703B.applied, false);
  assert.equal(missing703B.reason, '703d-requires-703b-five-origin-policy-first');
  assert.equal(missing703BEnv[policy703D.ORIGIN_ENV], undefined);

  // Normal isolated staging installation: 703B first, then 703D.
  const stagingEnv = { CORS_ORIGIN: STAGING_ORIGIN };
  const install703B = policy703B.install(stagingEnv);
  assert.equal(install703B.ok, true);
  assert.equal(install703B.applied, true);
  const install703D = policy703D.install(stagingEnv);
  assert.equal(install703D.ok, true);
  assert.equal(install703D.applied, true);
  assert.deepEqual(install703D.origins, EXPECTED_ORIGINS);
  assert.equal(stagingEnv[policy703D.ORIGIN_ENV], EXPECTED_ORIGINS.join(','));
  assert.equal(install703D.publicLiveFarePilotEnabledBy703D, false);
  assert.equal(install703D.providerCredentialsChanged, false);
  assert.equal(install703D.awsEnvironmentVariablesAdded, 0);
  assert.equal(install703D.sharedBudgetCapRequired, 8);
  assert.equal(install703D.candidateCapPreserved, 2);
  assert.equal(install703D.maxFlightLegsPreserved, 3);
  assert.equal(install703D.singleAdultGuardPreserved, true);
  assert.equal(install703D.productionChanged, false);

  // 703D changes only the staging 684B allowlist; it does not turn Duffel on.
  const stagingStatusOff = discovery684B.status684B(stagingEnv);
  assert.deepEqual(stagingStatusOff.originAllowlist, EXPECTED_ORIGINS);
  assert.equal(stagingStatusOff.enabled, false, '703D must not enable 684A/Duffel by itself');
  assert.equal(stagingStatusOff.candidateCap, 2);
  assert.equal(stagingStatusOff.maxFlightLegs, 3);
  assert.equal(stagingStatusOff.singleAdultOnly, true);
  assert.equal(stagingStatusOff.completeLiveEvidenceRequired, true);
  assert.equal(stagingStatusOff.preservesLowestCostGroundOption, true);
  assert.equal(stagingStatusOff.orderCapability, false);
  assert.equal(stagingStatusOff.paymentCapability, false);
  assert.equal(stagingStatusOff.bookingCapability, false);
  assert.equal(stagingStatusOff.ticketingCapability, false);

  // Exact production/non-staging origins ignore the in-process override entirely.
  const productionEnv = {
    CORS_ORIGIN: 'https://globevoy.com/',
    [policy703D.ORIGIN_ENV]: EXPECTED_ORIGINS.join(','),
    ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true'
  };
  const prodInstall = policy703D.install(productionEnv);
  assert.equal(prodInstall.ok, true);
  assert.equal(prodInstall.applied, false);
  assert.deepEqual(discovery684B.status684B(productionEnv).originAllowlist, ['YYZ']);

  // Conflicting staging values fail closed rather than silently broadening scope.
  const conflictEnv = { CORS_ORIGIN: STAGING_ORIGIN };
  assert.equal(policy703B.install(conflictEnv).ok, true);
  conflictEnv[policy703D.ORIGIN_ENV] = 'YYZ,JFK';
  const conflict = policy703D.install(conflictEnv);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.applied, false);
  assert.equal(conflict.reason, '703d-existing-684b-origin-allowlist-conflict');

  // With the pre-existing 684A gate explicitly enabled for operator QA, each of
  // the five origins is eligible for the same bounded 684B path.
  const operatorEnv = {
    ...stagingEnv,
    ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true'
  };
  for (const origin of EXPECTED_ORIGINS) {
    const tour = candidateTour(origin);
    const eligibility = discovery684B.eligibility684B(
      [tour],
      null,
      {
        origin,
        adults: 1,
        children: 0,
        infants: 0,
        pickRole: 'best-balance'
      },
      operatorEnv
    );
    assert.equal(eligibility.eligible, true, `${origin} should be eligible in 703D operator QA`);
    assert.equal(eligibility.origin, origin);
    assert.deepEqual(eligibility.allowedOrigins, EXPECTED_ORIGINS);
  }

  const outsideTour = candidateTour('SFO');
  const outside = discovery684B.eligibility684B(
    [outsideTour],
    null,
    { origin: 'SFO', adults: 1, children: 0, infants: 0, pickRole: 'best-balance' },
    operatorEnv
  );
  assert.equal(outside.eligible, false);
  assert.equal(outside.reason, '684b-origin-outside-pilot-allowlist');

  const multiAdult = discovery684B.eligibility684B(
    [candidateTour('JFK')],
    null,
    { origin: 'JFK', adults: 2, children: 0, infants: 0, pickRole: 'best-balance' },
    operatorEnv
  );
  assert.equal(multiAdult.eligible, false);
  assert.equal(multiAdult.reason, '684b-single-adult-pilot-only');

  const lowestCost = discovery684B.eligibility684B(
    [candidateTour('JFK')],
    null,
    { origin: 'JFK', adults: 1, children: 0, infants: 0, pickRole: 'lowest-cost' },
    operatorEnv
  );
  assert.equal(lowestCost.eligible, false);
  assert.equal(lowestCost.reason, '684b-lowest-cost-role-preserves-cheapest-ground-option');

  const tooManyLegs = discovery684B.buildShortlist684B(
    [candidateTour('JFK', 'four-leg', 4)],
    null,
    { origin: 'JFK', budgetUsd: 1000 },
    {}
  );
  assert.deepEqual(tooManyLegs, [], 'four-flight-leg candidates must remain excluded');

  // Wrapper ordering and diagnostics must prove this is staging-only and installed
  // before the ordinary staging Lambda loads generated-tour/684B.
  const wrapperSource = fs.readFileSync(path.join(ROOT, 'staging-lambda-702d.js'), 'utf8');
  const productionSource = fs.readFileSync(path.join(ROOT, 'lambda.js'), 'utf8');
  const discoverySource = fs.readFileSync(path.join(ROOT, 'services', 'domain', 'live-fares', 'affordable-flight-discovery-684b.js'), 'utf8');
  const overlaySource = fs.readFileSync(path.join(ROOT, 'services', 'providers', 'flights', 'staging', 'staging-affordable-flight-five-origin-703d.js'), 'utf8');

  const install703BIndex = wrapperSource.indexOf('stagingDuffel703B.install()');
  const install703DIndex = wrapperSource.indexOf('stagingAffordable703D.install()');
  const stagingLoadIndex = wrapperSource.indexOf("require('./staging-lambda')");
  assert(install703BIndex >= 0, '703B install missing');
  assert(install703DIndex > install703BIndex, '703D must install after 703B');
  assert(stagingLoadIndex > install703DIndex, '703D must install before ordinary staging Lambda loads');
  assert.match(wrapperSource, /X-Globevoy-Staging-Duffel-Discovery/);
  assert.doesNotMatch(productionSource, /GV-FLIGHT-703D|staging-affordable-flight-five-origin-703d|GV_DUFFEL_AFFORDABLE_DISCOVERY_ORIGINS_684B/);

  // Default 684B safety limits remain unchanged; the new override is staging-only
  // and cannot expand beyond the five reviewed origins without another code change.
  assert.match(discoverySource, /DEFAULT_ORIGINS_684B\s*=\s*Object\.freeze\(\['YYZ'\]\)/);
  assert.match(discoverySource, /STAGING_MAX_ORIGINS_684B\s*=\s*Object\.freeze\(\['YYZ', 'JFK', 'LAX', 'DUB', 'DXB'\]\)/);
  assert.match(discoverySource, /MAX_CANDIDATE_CHECKS_684B\s*=\s*2/);
  assert.match(discoverySource, /MAX_FLIGHT_LEGS_684B\s*=\s*3/);

  // No provider endpoint, credential, enable-flag mutation, booking, payment,
  // order or ticketing capability is added by 703D.
  assert.doesNotMatch(overlaySource, /api\.duffel\.com|DUFFEL_ACCESS_TOKEN|createOrder|paymentIntent|ticketOrder/i);
  assert.doesNotMatch(overlaySource, /ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A\s*=/);

  const output = {
    version: policy703D.VERSION,
    affordableDiscoveryOrigins: EXPECTED_ORIGINS,
    default684BOriginsOutsideStaging: ['YYZ'],
    sharedDuffelBudgetVersion: policy703D.REQUIRED_SHARED_BUDGET_VERSION,
    sharedDuffelBudgetCap: policy703D.REQUIRED_SHARED_BUDGET_CAP,
    candidateCap: stagingStatusOff.candidateCap,
    maxFlightLegs: stagingStatusOff.maxFlightLegs,
    singleAdultOnly: stagingStatusOff.singleAdultOnly,
    completeLiveEvidenceRequired: stagingStatusOff.completeLiveEvidenceRequired,
    publicDuffelEnabledBy703D: false,
    providerCallsPerformed: false,
    awsEnvironmentVariablesAdded: 0,
    productionChanged: false
  };

  console.log('GV-FLIGHT-703D validation PASS');
  console.log(JSON.stringify(output, null, 2));
}

main();
