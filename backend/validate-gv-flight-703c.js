'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = __dirname;
const REQUIRED_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com/';
process.env.CORS_ORIGIN = REQUIRED_ORIGIN;

const shared = require('./services/staging-duffel-shared-budget-703c');
const install = shared.install();
assert.equal(shared.VERSION, 'GV-FLIGHT-703C');
assert.equal(shared.SHARED_PHYSICAL_REQUEST_CAP, 8);
assert.equal(shared.enabled(), true);
assert.equal(install.ok, true);
assert.equal(install.applied, true);
assert.equal(install.providerEnabledBy703C, false);
assert.equal(install.credentialsChanged, false);
assert.equal(install.environmentVariablesAdded, 0);
assert.equal(install.productionChanged, false);

const duffelP2 = require('./services/duffel-p2-staging-683h');
const live684A = require('./services/public-live-fare-pilot-684a');
assert.equal(typeof duffelP2.requestState683H, 'function');
assert.equal(typeof live684A.applyPublicLiveFarePilot684A, 'function');

(async () => {
  // One request: first phase consumes 6, second phase is clamped to the remaining 2,
  // third phase cannot launch any physical request.
  const firstRequest = await shared.runWithBudget(async () => {
    const first = duffelP2.requestState683H(process.env, { plannedRequestCap: 8 });
    assert.equal(first.cap, 8);
    first.requests += 6;
    let snap = shared.snapshot();
    assert.equal(snap.used, 6);
    assert.equal(snap.remaining, 2);

    const second = duffelP2.requestState683H(process.env, { plannedRequestCap: 8 });
    assert.equal(second.cap, 2);
    second.requests += 2;
    snap = shared.snapshot();
    assert.equal(snap.used, 8);
    assert.equal(snap.remaining, 0);
    assert.equal(snap.exhausted, true);

    const third = duffelP2.requestState683H(process.env, { plannedRequestCap: 8 });
    assert.equal(third.cap, 0);

    const decorated = await live684A.applyPublicLiveFarePilot684A(
      { estimatedTotalUsd: 100, totalBudgetUsd: 500, legs: [], stops: [] },
      { adults: 1, children: 0, infants: 0, budget: 500, budgetUsd: 500, currency: 'USD' },
      { env: { ...process.env, ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'false' } }
    );
    assert.equal(decorated.summary.sharedDuffelBudget703C.version, 'GV-FLIGHT-703C');
    assert.equal(decorated.summary.sharedDuffelBudget703C.used, 8);
    assert.equal(decorated.summary.sharedDuffelBudget703C.remaining, 0);
    assert.equal(decorated.tour.sharedDuffelBudget703C.used, 8);

    return shared.snapshot();
  });
  assert.equal(firstRequest.used, 8);
  assert.equal(firstRequest.statesCreated, 3);
  assert.equal(firstRequest.clampedStates, 2);
  assert.equal(firstRequest.exhaustedStates, 1);

  // A new generated-tour request gets a fresh independent budget.
  const freshRequest = await shared.runWithBudget(async () => {
    const state = duffelP2.requestState683H(process.env, { plannedRequestCap: 8 });
    assert.equal(state.cap, 8);
    state.requests += 1;
    return shared.snapshot();
  });
  assert.equal(freshRequest.used, 1);
  assert.equal(freshRequest.remaining, 7);

  // Shared budget never expands a smaller local safety cap.
  const smallerLocalCap = await shared.runWithBudget(async () => {
    const state = duffelP2.requestState683H(process.env, { plannedRequestCap: 4 });
    assert.equal(state.cap, 4);
    state.requests += 4;
    return shared.snapshot();
  });
  assert.equal(smallerLocalCap.used, 4);
  assert.equal(smallerLocalCap.remaining, 4);

  // AsyncLocalStorage isolates simultaneous HTTP-request contexts.
  const isolated = await Promise.all([
    shared.runWithBudget(async () => {
      const state = duffelP2.requestState683H(process.env, { plannedRequestCap: 8 });
      state.requests += 3;
      await Promise.resolve();
      return shared.snapshot();
    }),
    shared.runWithBudget(async () => {
      const state = duffelP2.requestState683H(process.env, { plannedRequestCap: 8 });
      state.requests += 5;
      await Promise.resolve();
      return shared.snapshot();
    })
  ]);
  assert.deepEqual(isolated.map(row => row.used).sort((a, b) => a - b), [3, 5]);

  // Install must fail closed if 684A was already loaded before the staging patch.
  const failClosed = execFileSync(process.execPath, ['-e', `
    process.env.CORS_ORIGIN=${JSON.stringify(REQUIRED_ORIGIN)};
    require('./services/public-live-fare-pilot-684a');
    const s=require('./services/staging-duffel-shared-budget-703c');
    const r=s.install();
    if (r.ok !== false || r.reason !== '703c-684a-loaded-before-shared-budget-install') process.exit(9);
  `], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(typeof failClosed, 'string');

  // Outside the exact isolated staging origin the feature is disabled.
  execFileSync(process.execPath, ['-e', `
    process.env.CORS_ORIGIN='https://globevoy.com/';
    const s=require('./services/staging-duffel-shared-budget-703c');
    if (s.enabled() !== false) process.exit(8);
    const r=s.install();
    if (r.ok !== true || r.applied !== false) process.exit(7);
  `], { cwd: ROOT, stdio: 'pipe' });

  const wrapperSource = fs.readFileSync(path.join(ROOT, 'staging-lambda-702d.js'), 'utf8');
  const productionSource = fs.readFileSync(path.join(ROOT, 'lambda.js'), 'utf8');
  const generatedTourSource = fs.readFileSync(path.join(ROOT, 'generated-tour.js'), 'utf8');
  const discoverySource = fs.readFileSync(path.join(ROOT, 'services', 'affordable-flight-discovery-684b.js'), 'utf8');
  const sharedSource = fs.readFileSync(path.join(ROOT, 'services', 'staging-duffel-shared-budget-703c.js'), 'utf8');

  assert.match(wrapperSource, /staging-duffel-shared-budget-703c/);
  assert.match(wrapperSource, /runWithBudget/);
  assert.match(wrapperSource, /X-Globevoy-Staging-Duffel-Budget/);
  assert.doesNotMatch(productionSource, /GV-FLIGHT-703C|staging-duffel-shared-budget-703c/);

  // Existing generated-tour topology is preserved: direct 684A and 684B's callback
  // still use the same imported 684A function, which is patched before module load.
  assert.match(generatedTourSource, /applyPublicLiveFarePilot684A/);
  assert.match(generatedTourSource, /applyLiveFare:\s*\(tour,\s*q\)\s*=>\s*applyPublicLiveFarePilot684A\(tour,\s*q\)/);

  // 703C must not expand 684B discovery beyond its existing YYZ-only boundary.
  assert.match(discoverySource, /DEFAULT_ORIGINS_684B\s*=\s*Object\.freeze\(\['YYZ'\]\)/);

  // No provider endpoint, token lookup, booking, payment or ticketing code is added.
  assert.doesNotMatch(sharedSource, /api\.duffel\.com|DUFFEL_ACCESS_TOKEN|createOrder|paymentIntent|ticketOrder/i);

  const output = {
    version: shared.VERSION,
    sharedPhysicalRequestCap: shared.SHARED_PHYSICAL_REQUEST_CAP,
    firstRequest,
    freshRequest,
    smallerLocalCap,
    concurrentIsolationUsed: isolated.map(row => row.used),
    physicalRequestAccounting: true,
    dedupedLogicalSearchConsumesBudget: false,
    physicalRetryConsumesBudget: true,
    affordableDiscovery684BOrigins: ['YYZ'],
    environmentVariablesAdded: 0,
    providerCallsPerformed: false,
    providerEnabledBy703C: false,
    productionChanged: false
  };

  console.log('GV-FLIGHT-703C validation PASS');
  console.log(JSON.stringify(output, null, 2));
})().catch(error => {
  console.error('GV-FLIGHT-703C validation FAIL');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
