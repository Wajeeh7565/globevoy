'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const contract = require('./services/flight-provider-contract-683c');
const router = require('./services/flight-provider-router-683c');
const optimizer = require('./services/domain/routing/whole-trip-date-optimizer-681b-p2');

let passed = 0;
function pass(name) { passed += 1; console.log(`PASS ${name}`); }

(async () => {
  // 1. Contract validation is explicit and fail-closed.
  const bad = contract.validateSearchRequest683C({ origin: 'XX', destination: 'DUB', currency: 'EUR' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.includes('invalid-origin'));
  pass('683C request validation fails closed');

  // 2. Live observations normalize to the canonical fields P2 needs while retaining aliases.
  const liveProvider = contract.descriptor683C({
    id: 'mock-live', label: 'Mock Live', evidenceClass: contract.EVIDENCE_CLASSES_683C.LIVE_PROVIDER,
    rankingGrade: contract.RANKING_GRADES_683C.DECISION_GRADE, productionApproved: true,
    supportsExactDate: true, supportsFlexibleDates: true, supportsMultiCity: true
  });
  const liveObs = contract.normalizeObservation683C({
    origin: 'DUB', destination: 'TNG', departureDate: '2026-08-27', currency: 'EUR',
    totalPrice: 101, airline: 'Example Air', stops: 1, durationMinutes: 330,
    deeplink: 'https://example.test/flight', observedAt: '2026-08-13T09:00:00Z'
  }, { origin: 'DUB', destination: 'TNG', departureDate: '2026-08-27', currency: 'EUR', passengers: 1 }, liveProvider);
  assert.equal(liveObs.provider, 'mock-live');
  assert.equal(liveObs.providerEvidenceClass, 'LIVE_PROVIDER');
  assert.equal(liveObs.totalPrice, 101);
  assert.equal(liveObs.price, 101);
  assert.equal(liveObs.stops, 1);
  assert.equal(liveObs.transfers, 1);
  assert.equal(liveObs.bookingLink, 'https://example.test/flight');
  assert.equal(liveObs.priceEvidence.sourceType, 'LIVE');
  assert.equal(liveObs.priceEvidence.isBookable, true);
  pass('live provider observation canonicalizes with P2 aliases');

  // 3. Cached provider evidence is never mislabeled live/decision-grade.
  const cachedProvider = contract.descriptor683C({
    id: 'mock-cache', evidenceClass: contract.EVIDENCE_CLASSES_683C.CACHED_PROVIDER,
    productionApproved: true, supportsFlexibleDates: true
  });
  const cachedObs = contract.normalizeObservation683C({
    origin: 'DUB', destination: 'TNG', departureDate: '2026-08-27', currency: 'EUR', price: 89,
    observedAt: '2026-08-12T09:00:00Z'
  }, { origin: 'DUB', destination: 'TNG', departureDate: '2026-08-27', currency: 'EUR' }, cachedProvider);
  assert.equal(cachedObs.providerEvidenceClass, 'CACHED_PROVIDER');
  assert.equal(cachedObs.providerRankingGrade, 'PLANNING_ONLY');
  assert.equal(cachedObs.priceEvidence.sourceType, 'CACHED');
  assert.equal(cachedObs.priceEvidence.isBookable, false);
  pass('cached provider stays planning-only');

  // 4. Test-only data can never become production/live evidence by normalization.
  const testProvider = contract.descriptor683C({
    id: 'mock-test', evidenceClass: contract.EVIDENCE_CLASSES_683C.TEST_ONLY,
    productionApproved: false
  });
  const testObs = contract.normalizeObservation683C({
    origin: 'JFK', destination: 'CUN', departureDate: '2026-09-01', currency: 'USD', price: 99,
    deeplink: 'https://example.test/test-only'
  }, { origin: 'JFK', destination: 'CUN', departureDate: '2026-09-01', currency: 'USD' }, testProvider);
  assert.equal(testObs.providerEvidenceClass, 'TEST_ONLY');
  assert.equal(testObs.providerRankingGrade, 'TEST_ONLY');
  assert.notEqual(testObs.priceEvidence.sourceType, 'LIVE');
  assert.equal(testObs.priceEvidence.isBookable, false);
  pass('test-only provider cannot become live evidence');

  // 5. Adapter contract requires both search shapes.
  assert.equal(router.validateAdapter683C({ id: 'broken', descriptor: {} }).valid, false);
  assert.throws(() => router.registerAdapter683C({ id: 'broken', descriptor: {} }), /Invalid GV-PROVIDER-683C adapter/);
  pass('adapter registration contract enforced');

  // 6. Current production default remains the existing Travelpayouts cached source.
  const summary = router.adapterSummary683C();
  assert.equal(summary.version, 'GV-PROVIDER-683C');
  assert.equal(summary.defaultProvider, 'travelpayouts-aviasales-data');
  assert.equal(summary.adapters[0].evidenceClass, 'CACHED_PROVIDER');
  assert.equal(summary.adapters[0].rankingGrade, 'PLANNING_ONLY');
  assert.equal(summary.bookingCapability, false);
  pass('default provider preserves cached Travelpayouts semantics');

  // 7. Default router path preserves provider rows while adding canonical metadata.
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({ data: [
        { origin: 'DUB', destination: 'TNG', departure_at: '2026-08-27T08:00:00Z', price: 101, airline: 'XX', transfers: 1, duration: 330, link: '/search/DUB2708TNG1' },
        { origin: 'DUB', destination: 'TNG', departure_at: '2026-08-28T08:00:00Z', price: 127, airline: 'YY', transfers: 1, duration: 360, link: '/search/DUB2808TNG1' }
      ] });
    }
  });
  const oldToken = process.env.TRAVELPAYOUTS_TOKEN;
  process.env.TRAVELPAYOUTS_TOKEN = 'validation-only';
  const routed = await router.fetchFlightDates683C({ origin: 'DUB', destination: 'TNG', currency: 'EUR', month: '2026-08', limit: 31, _fetchFn: fakeFetch });
  if (oldToken === undefined) delete process.env.TRAVELPAYOUTS_TOKEN; else process.env.TRAVELPAYOUTS_TOKEN = oldToken;
  assert.equal(routed.supported, true);
  assert.equal(routed.observations.length, 2);
  assert.equal(routed.observations[0].provider, 'travelpayouts-aviasales-data');
  assert.equal(routed.observations[0].providerEvidenceClass, 'CACHED_PROVIDER');
  assert.equal(routed.providerContract.currentP2Compatibility, 'legacy-aliases-preserved');
  pass('Travelpayouts route is transparent through 683C');

  // 8. Future provider adapters can plug into the router without changing P2.
  router.registerAdapter683C({
    id: 'validation-live-provider',
    descriptor: liveProvider,
    async searchMonth(args) {
      return { supported: true, observations: [
        { origin: args.origin, destination: args.destination, departureDate: '2026-08-27', currency: args.currency, totalPrice: 101, airline: 'Mock Live', stops: 0, durationMinutes: 210, deeplink: 'https://example.test/live-a' },
        { origin: args.origin, destination: args.destination, departureDate: '2026-08-28', currency: args.currency, totalPrice: 95, airline: 'Mock Live', stops: 0, durationMinutes: 215, deeplink: 'https://example.test/live-b' }
      ] };
    },
    async searchAcrossMonths(args) { return this.searchMonth({ ...args, month: args.startMonth || args.month }); }
  });
  const future = await router.fetchFlightDates683C({ origin: 'DUB', destination: 'TNG', currency: 'EUR', month: '2026-08' }, { providerId: 'validation-live-provider' });
  assert.equal(future.supported, true);
  assert.equal(future.observations[0].providerEvidenceClass, 'LIVE_PROVIDER');
  assert.equal(future.providerContract.decisionGrade, true);
  assert.equal(future.observations[0].priceEvidence.sourceType, 'LIVE');
  pass('future live adapter plugs into router');

  // 9. P2 consumes canonical live observations unchanged via the preserved aliases.
  const providerResults = [
    { observations: future.observations },
    { observations: [contract.normalizeObservation683C({ origin: 'TNG', destination: 'OPO', departureDate: '2026-08-30', currency: 'EUR', totalPrice: 120, airline: 'Mock', stops: 0, durationMinutes: 90 }, { origin: 'TNG', destination: 'OPO', departureDate: '2026-08-30', currency: 'EUR' }, liveProvider)] },
    { observations: [contract.normalizeObservation683C({ origin: 'OPO', destination: 'DUB', departureDate: '2026-09-01', currency: 'EUR', totalPrice: 110, airline: 'Mock', stops: 0, durationMinutes: 150 }, { origin: 'OPO', destination: 'DUB', departureDate: '2026-09-01', currency: 'EUR' }, liveProvider)] }
  ];
  const candidate = optimizer.evaluateCandidate({
    startDate: '2026-08-27',
    stops: [{ nights: 3 }, { nights: 2 }],
    legs: [{ mode: 'flight' }, { mode: 'flight' }, { mode: 'flight' }],
    providerResults,
    isFlightLeg: () => true,
    isGroundLeg: () => false,
    convertProviderPriceToUsd: value => Number(value),
    flightFareUnits: 1,
    hotelEstimateUsd: 250
  });
  assert.equal(candidate.completeProviderFlightCoverage, true);
  assert.equal(candidate.providerFlightLegCount, 3);
  assert.equal(candidate.providerFlightTotalUsd, 331);
  pass('P2 consumes 683C canonical rows without rewrite');

  // 10. Unknown provider selection fails closed rather than silently falling back.
  const unavailable = await router.fetchFlightDates683C({ origin: 'DUB', destination: 'TNG', currency: 'EUR', month: '2026-08' }, { providerId: 'not-registered' });
  assert.equal(unavailable.supported, false);
  assert.match(unavailable.reason, /provider-adapter-unavailable/);
  assert.equal(unavailable.providerContract.provider.evidenceClass, 'UNAVAILABLE');
  pass('unknown provider fails closed');

  // 11. Runtime entrypoints now route flight evidence through 683C.
  for (const rel of ['generated-tour.js', 'server.js', 'lambda.js', 'services/live-provider-verification.js']) {
    const source = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    assert.match(source, /flight-provider-router-683c/);
  }
  const generated = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
  assert.match(generated, /2\.(?:15\.0-gv-provider-682c-property-identity-hardening\+683c-provider-neutral-flight-adapter|16\.0-gv-provider-683h-duffel-p2-staging-integration|16\.1-gv-provider-683j-r1-live-evidence-fail-closed|17\.0-gv-flight-684a-public-live-fare-pilot|18\.0-gv-rec-684b-affordable-flight-discovery|18\.1-gv-rec-684b-r1-code-gated-discovery|18\.2-gv-rec-684b-r2-overbudget-flight-rescue|18\.3-gv-rec-684b-r3-strict-currency-budget-fit)/);
  assert.match(generated, /flightProviderContract: adapterSummary683C\(\)/);
  pass('runtime flight evidence path is provider-neutral');

  // 12. The 683C modules contain no booking/order/payment mutation surface or secret literals.
  const contractSource = fs.readFileSync(path.join(__dirname, 'services/flight-provider-contract-683c.js'), 'utf8');
  const routerSource = fs.readFileSync(path.join(__dirname, 'services/flight-provider-router-683c.js'), 'utf8');
  const combined = `${contractSource}\n${routerSource}`;
  assert.doesNotMatch(combined, /createOrder|createBooking|chargePayment|paymentIntent|ticketOrder/i);
  assert.doesNotMatch(combined, /KAYAK_SANDBOX_API_KEY|DUFFEL_ACCESS_TOKEN|x-api-key/i);
  assert.equal(router.adapterSummary683C().secretValuesReturned, false);
  pass('no booking/payment/secret surface added');

  // 13. Registry cleanup works for test adapters and cannot remove the production default.
  assert.equal(router.unregisterAdapter683C('validation-live-provider'), true);
  assert.equal(router.unregisterAdapter683C('travelpayouts-aviasales-data'), false);
  assert.ok(router.getAdapter683C('travelpayouts-aviasales-data'));
  pass('adapter registry cleanup protects default');

  console.log(`PASS ${passed}/13 - GV-PROVIDER-683C backend`);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
