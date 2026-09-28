'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const policy = require('./services/providers/flights/duffel/staging/staging-duffel-five-origin-703b');
const live684A = require('./services/domain/live-fares/public-live-fare-pilot-684a');
const discovery684B = require('./services/domain/live-fares/affordable-flight-discovery-684b');

function main() {
  const expectedOrigins = ['YYZ', 'JFK', 'LAX', 'DUB', 'DXB'];
  assert.strictEqual(policy.VERSION, 'GV-FLIGHT-703B');
  assert.deepStrictEqual(policy.ORIGINS, expectedOrigins);

  const stagingEnv = {
    CORS_ORIGIN: 'https://staging.dy4fw8gx1ccie.amplifyapp.com/'
  };
  const installed = policy.install(stagingEnv);
  assert.strictEqual(installed.ok, true);
  assert.strictEqual(installed.applied, true);
  assert.deepStrictEqual(installed.origins, expectedOrigins);
  assert.strictEqual(stagingEnv.GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A, expectedOrigins.join(','));
  assert.strictEqual(installed.publicLiveFarePilotEnabledBy703B, false);
  assert.strictEqual(installed.providerCredentialsChanged, false);
  assert.strictEqual(installed.affordableDiscovery684BExpanded, false);
  assert.strictEqual(installed.productionChanged, false);

  const productionEnv = { CORS_ORIGIN: 'https://globevoy.com/' };
  const prodInstall = policy.install(productionEnv);
  assert.strictEqual(prodInstall.ok, true);
  assert.strictEqual(prodInstall.applied, false);
  assert.strictEqual(productionEnv.GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A, undefined);

  const conflictEnv = {
    CORS_ORIGIN: 'https://staging.dy4fw8gx1ccie.amplifyapp.com/',
    GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A: 'YYZ'
  };
  const conflict = policy.install(conflictEnv);
  assert.strictEqual(conflict.ok, false);
  assert.strictEqual(conflict.applied, false);
  assert.strictEqual(conflict.reason, '703b-existing-684a-origin-allowlist-conflict');

  const status684A = live684A.status684A(stagingEnv);
  assert.deepStrictEqual(status684A.originAllowlist, expectedOrigins);
  assert.strictEqual(status684A.enabled, false, '703B must not enable 684A by itself');
  assert.strictEqual(status684A.maxFlightLegs, 3);
  assert.strictEqual(status684A.singleAdultOnly, true);
  assert.strictEqual(status684A.allFlightLegsAtomic, true);
  assert.strictEqual(status684A.exactAirportFirst, true);
  assert.strictEqual(status684A.sameCityMetroFallback, true);
  assert.strictEqual(status684A.orderCapability, false);
  assert.strictEqual(status684A.paymentCapability, false);
  assert.strictEqual(status684A.bookingCapability, false);
  assert.strictEqual(status684A.ticketingCapability, false);

  const status684B = discovery684B.status684B(stagingEnv);
  assert.deepStrictEqual(status684B.originAllowlist, ['YYZ'], '684B discovery must remain YYZ-only');
  assert.strictEqual(status684B.candidateCap, 2);
  assert.strictEqual(status684B.maxFlightLegs, 3);
  assert.strictEqual(status684B.singleAdultOnly, true);
  assert.strictEqual(status684B.orderCapability, false);
  assert.strictEqual(status684B.paymentCapability, false);
  assert.strictEqual(status684B.bookingCapability, false);
  assert.strictEqual(status684B.ticketingCapability, false);

  const wrapper = fs.readFileSync(path.join(__dirname, 'staging-lambda-702d.js'), 'utf8');
  const installIndex = wrapper.indexOf('stagingDuffel703B.install()');
  const stagingLoadIndex = wrapper.indexOf("require('./staging-lambda')");
  assert(installIndex >= 0, '703B staging policy install missing');
  assert(stagingLoadIndex > installIndex, '703B policy must install before staging Lambda loads');
  assert(wrapper.includes("X-Globevoy-Staging-Duffel"), '703B diagnostic header missing');

  const source = fs.readFileSync(path.join(__dirname, 'services', 'providers', 'flights', 'duffel', 'staging', 'staging-duffel-five-origin-703b.js'), 'utf8');
  assert(!/process\.env\.ENABLE_DUFFEL/.test(source), '703B must not enable Duffel flags');
  assert(!/env\.ENABLE_DUFFEL/.test(source), '703B must not mutate Duffel enable flags');
  assert(!source.includes('DUFFEL_ACCESS_TOKEN ='), '703B must not inject Duffel credentials');

  console.log('GV-FLIGHT-703B validation PASS');
  console.log(JSON.stringify({
    version: policy.VERSION,
    stagingOrigins: expectedOrigins,
    publicLiveFarePilotEnabledBy703B: false,
    affordableDiscovery684BOrigins: status684B.originAllowlist,
    maxFlightLegs: status684A.maxFlightLegs,
    singleAdultOnly: status684A.singleAdultOnly,
    allFlightLegsAtomic: status684A.allFlightLegsAtomic,
    productionChanged: false,
    providerCallsPerformed: false
  }, null, 2));
}

main();
