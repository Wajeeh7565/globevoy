'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const pilot = require('./services/domain/live-fares/public-live-fare-pilot-684a');
const p2 = require('./services/providers/flights/duffel/duffel-p2-staging-683h');
const liveVerification = require('./services/domain/live-fares/live-provider-verification');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}
async function testAsync(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

const readyEnv = {
  ENABLE_DUFFEL_LIVE_683D: 'true',
  ENABLE_DUFFEL_SHADOW_683D: 'true',
  DUFFEL_ACCESS_TOKEN: 'duffel_live_fake_for_684a_validation',
  ENABLE_BOC_FX_683G: 'true',
  ENABLE_FX_NORMALIZATION_683G: 'true',
  ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true'
};

function fxMock(input) {
  const amount = Number(input.providerAmount);
  const from = String(input.providerCurrency || 'USD').toUpperCase();
  const target = String(input.displayCurrency || 'USD').toUpperCase();
  const usd = from === 'USD' ? amount : amount;
  const factor = target === 'CAD' ? 1.4 : 1;
  return Promise.resolve({
    supported: true,
    provider: target === from ? 'identity-no-conversion' : 'bank-of-canada-valet-daily',
    providerAmount: amount,
    providerCurrency: from,
    displayAmount: Number((usd * factor).toFixed(2)),
    displayCurrency: target,
    crossRate: factor,
    rateDate: target === from ? null : '2026-08-14',
    conversionApplied: target !== from,
    originalProviderEvidencePreserved: true
  });
}

function rawLive(origin, destination, departureDate, amount) {
  return {
    supported: true,
    reason: null,
    observations: [{
      origin, destination, departureDate,
      currency: 'USD', totalPrice: amount, price: amount, passengers: 1,
      airline: '684A Test Air', stops: 0, transfers: 0, durationMinutes: 120,
      liveMode: true, source: 'duffel-live-683d',
      providerReference: `off_${origin}_${destination}_${departureDate}`,
      observedAt: '2026-08-14T20:00:00Z', expiresAt: '2026-08-15T02:00:00Z'
    }],
    rateLimit: { limit: 120, remaining: 100, reset: 'Fri, 15 Aug 2026 01:00:00 GMT' }
  };
}

function sampleTour() {
  return {
    origin: { city: 'Toronto', airportCode: 'YYZ', code: 'YYZ' },
    totalBudgetUsd: 900,
    legs: [
      { from: { city: 'Toronto', airportCode: 'YYZ' }, to: { city: 'Guatemala City', airportCode: 'GUA' }, mode: 'flight', departureDate: '2026-08-29', estimatedTransportUsd: 100, estimatedFlightUsd: 100, amountUsd: 100 },
      { from: { city: 'Guatemala City', airportCode: 'GUA' }, to: { city: 'San Jose', airportCode: 'SJO' }, mode: 'flight', departureDate: '2026-09-01', estimatedTransportUsd: 100, estimatedFlightUsd: 100, amountUsd: 100 },
      { from: { city: 'San Jose', airportCode: 'SJO' }, to: { city: 'Toronto', airportCode: 'YYZ' }, mode: 'flight', departureDate: '2026-09-04', estimatedTransportUsd: 100, estimatedFlightUsd: 100, amountUsd: 100 }
    ],
    stops: [
      { city: 'Guatemala City', nights: 3, hotel: { estimatedNightlyUsd: 50, estimatedStayUsd: 150, totalStayUsd: 150 } },
      { city: 'San Jose', nights: 3, hotel: { estimatedNightlyUsd: 50, estimatedStayUsd: 150, totalStayUsd: 150 } }
    ],
    estimatedTotalUsd: 600
  };
}

(async () => {
  test('684A version locked', () => assert.equal(pilot.VERSION_684A, 'GV-FLIGHT-684A'));
  test('684A defaults to major-origin allowlist', () => assert.deepEqual(pilot.configuredOrigins684A({}), ['YYZ','JFK','LAX','DUB','DXB']));
  test('684A flag off is no-op', () => {
    const result = pilot.eligibility684A(sampleTour(), { adults: 1, children: 0, infants: 0 }, { ...readyEnv, ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'false' });
    assert.equal(result.eligible, false); assert.equal(result.reason, '684a-pilot-flag-off');
  });
  test('684A rejects non-pilot origin', () => {
    const tour = sampleTour(); tour.legs[0].from.airportCode = 'YVR';
    const result = pilot.eligibility684A(tour, { adults: 1, children: 0, infants: 0 }, readyEnv);
    assert.equal(result.eligible, false); assert.equal(result.reason, '684a-origin-outside-pilot-allowlist');
  });
  test('684A remains single-adult during pilot', () => {
    const result = pilot.eligibility684A(sampleTour(), { adults: 2, children: 0, infants: 0 }, readyEnv);
    assert.equal(result.eligible, false); assert.equal(result.reason, '684a-single-adult-pilot-only');
  });
  test('684A skips existing 683K production canary to avoid duplicate Duffel calls', () => {
    const result = pilot.eligibility684A(sampleTour(), { adults: 1, children: 0, infants: 0, __gvProviderCanary683K: 'authorized-production-canary' }, readyEnv);
    assert.equal(result.eligible, false); assert.equal(result.reason, '684a-skipped-existing-683k-production-canary');
  });
  test('684A requires exact route and date for every flight leg', () => {
    const tour = sampleTour(); delete tour.legs[1].departureDate;
    const result = pilot.eligibility684A(tour, { adults: 1, children: 0, infants: 0 }, readyEnv);
    assert.equal(result.eligible, false); assert.equal(result.reason, '684a-missing-exact-route-or-date');
  });

  await testAsync('684A applies all exact live flight legs atomically and reprices tour', async () => {
    const amounts = { 'YYZ-GUA': 200, 'GUA-SJO': 120, 'SJO-YYZ': 260 };
    const searchExact = async (args) => rawLive(args.origin, args.destination, args.departureDate, amounts[`${args.origin}-${args.destination}`]);
    const result = await pilot.applyPublicLiveFarePilot684A(sampleTour(), { adults: 1, children: 0, infants: 0, currency: 'USD' }, { env: readyEnv, searchExact, normalizeFx: fxMock });
    assert.equal(result.summary.applied, true);
    assert.equal(result.summary.requiredFlightLegCount, 3);
    assert.equal(result.summary.liveFlightLegCount, 3);
    assert.equal(result.summary.providerRequests, 3);
    assert.equal(result.tour.legs[0].estimatedTransportUsd, 200);
    assert.equal(result.tour.legs[1].estimatedTransportUsd, 120);
    assert.equal(result.tour.legs[2].estimatedTransportUsd, 260);
    assert.equal(result.tour.estimatedTotalUsd, 880);
    assert.equal(result.summary.beforeTotalUsd, 600);
    assert.equal(result.summary.afterTotalUsd, 880);
    assert.equal(result.summary.priceDeltaUsd, 280);
    for (const leg of result.tour.legs) {
      assert.equal(leg.liveFareVerified, true);
      assert.equal(leg.providerDateEvidence.sourceType, 'LIVE');
      assert.equal(leg.providerDateEvidence.productionEligible, true);
      assert.equal(leg.providerDateEvidence.priceEvidence.productionEligible, true);
      assert.equal(leg.providerDateEvidence.publicLiveFareEvidence684A.version, 'GV-FLIGHT-684A');
      assert.equal(leg.providerDateEvidence.airportMode683H, 'EXACT');
      assert.equal(leg.providerDateEvidence.metroAirportFallback683H, null);
    }
  });

  await testAsync('684A live repricing exposes over-budget state before legacy verification', async () => {
    const searchExact = async (args) => rawLive(args.origin, args.destination, args.departureDate, 260);
    const result = await pilot.applyPublicLiveFarePilot684A(sampleTour(), { adults: 1, children: 0, infants: 0, currency: 'USD', budget: 900 }, { env: readyEnv, searchExact, normalizeFx: fxMock });
    assert.equal(result.summary.applied, true);
    assert.equal(result.summary.afterTotalUsd, 1080);
    assert.equal(result.summary.budgetCeilingUsd, 905);
    assert.equal(result.summary.overBudget, true);
  });

  await testAsync('684A fails closed atomically if one live flight leg is unavailable', async () => {
    const searchExact = async (args) => {
      if (args.origin === 'GUA') return { supported: false, reason: 'no-valid-exact-live-offers', observations: [] };
      return rawLive(args.origin, args.destination, args.departureDate, 200);
    };
    const original = sampleTour();
    const result = await pilot.applyPublicLiveFarePilot684A(original, { adults: 1, children: 0, infants: 0, currency: 'USD' }, { env: readyEnv, searchExact, normalizeFx: fxMock });
    assert.equal(result.summary.applied, false);
    assert.equal(result.summary.reason, '684a-incomplete-live-flight-coverage-fail-closed');
    assert.equal(result.tour, original);
    assert.deepEqual(result.tour.legs.map(x => x.estimatedTransportUsd), [100,100,100]);
  });

  await testAsync('684A live evidence survives later 683J-R2 verification non-downgrade', async () => {
    const searchExact = async (args) => rawLive(args.origin, args.destination, args.departureDate, 180);
    const result = await pilot.applyPublicLiveFarePilot684A(sampleTour(), { adults: 1, children: 0, infants: 0, currency: 'USD' }, { env: readyEnv, searchExact, normalizeFx: fxMock });
    const preserved = liveVerification._internal.preserveExistingLiveDecisionGrade683JR2(result.tour.legs[0], { adults: 1, children: 0, infants: 0 });
    assert.ok(preserved);
    assert.equal(preserved.leg.liveFareVerified, true);
    assert.equal(preserved.leg.providerVerification.verified, true);
    assert.equal(preserved.leg.providerVerification.productionEligible, true);
    assert.equal(preserved.leg.providerVerification.provider, 'duffel-live-683d');
  });

  test('684A does not unlock full 683H P2 ordinary production ranking', () => {
    const env = { ...readyEnv, GV_RUNTIME_ENVIRONMENT: 'production', ENABLE_DUFFEL_P2_683H: 'true', ACK_DUFFEL_P2_STAGING_ONLY_683H: 'true', ENABLE_DUFFEL_P2_STAGING_ACTIVATION_683J: 'true' };
    const status = p2.status683H(env, {});
    assert.equal(status.normalFlowEnabled, false);
    assert.equal(status.productionCanary683KAuthorized, false);
    assert.equal(status.rankingEnabled, false);
  });

  test('684A generated-tour integration runs pilot before legacy verification on both final paths', () => {
    const source = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
    const matches = [...source.matchAll(/const publicLiveFare684A = await applyPublicLiveFarePilot684A\(enrichment\.tour, routeQuery\);\s*(?:performanceR3\.publicLiveFare684AMs = elapsedR3\(publicLiveFareStartedR3\);\s*const verificationStartedR3 = process\.hrtime\.bigint\(\);\s*)?const liveVerification = await verifyTourWithLiveProviders\(publicLiveFare684A\.tour, routeQuery\);/g)];
    assert.equal(matches.length, 2);
    assert.match(source, /liveVerification\.summary\?\.overBudget \|\| publicLiveFare684A\.summary\?\.overBudget/);
    assert.match(source, /over-budget-after-684a-live-fare/);
  });

  test('684A adds no Duffel order/payment/booking/ticketing API', () => {
    const source = fs.readFileSync(path.join(__dirname, 'services/domain/live-fares/public-live-fare-pilot-684a.js'), 'utf8');
    assert.doesNotMatch(source, /\/air\/orders|payment_intent|createOrder\s*\(|createBooking\s*\(|createTicket\s*\(/i);
    assert.match(source, /orderCapability: false/);
    assert.match(source, /paymentCapability: false/);
    assert.match(source, /bookingCapability: false/);
    assert.match(source, /ticketingCapability: false/);
  });

  test('canonical flight provider label is provider-derived, not hardcoded Aviasales', () => {
    const source = fs.readFileSync(path.join(__dirname, 'services/domain/pricing/canonical-total-evidence.js'), 'utf8');
    assert.match(source, /verification\.provider \|\| evidence\.providerLabel \|\| evidence\.source/);
  });

  test('684A exposes safe status with all-or-nothing and exact-airport posture', () => {
    const status = pilot.status684A(readyEnv);
    assert.equal(status.enabled, true);
    assert.equal(status.exactAirportOnly, true);
    assert.equal(status.allFlightLegsAtomic, true);
    assert.equal(status.singleAdultOnly, true);
    assert.equal(status.orderCapability, false);
  });

  console.log(`PASS ${passed}/${passed} - GV-FLIGHT-684A local validator`);
})().catch(error => { console.error(error); process.exit(1); });
