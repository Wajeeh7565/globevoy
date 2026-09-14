'use strict';

const assert = require('assert');
const discovery = require('./services/affordable-flight-discovery-684b');
const pilot684A = require('./services/public-live-fare-pilot-684a');

const readyEnv = {
  ENABLE_DUFFEL_LIVE_683D: 'true',
  ENABLE_DUFFEL_SHADOW_683D: 'true',
  DUFFEL_ACCESS_TOKEN: 'duffel_live_fake_for_gv_perf_validation',
  ENABLE_BOC_FX_683G: 'true',
  ENABLE_FX_NORMALIZATION_683G: 'true',
  ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true'
};

function fxMock(input) {
  const amount = Number(input.providerAmount);
  const from = String(input.providerCurrency || 'USD').toUpperCase();
  const target = String(input.displayCurrency || 'USD').toUpperCase();
  return Promise.resolve({
    supported: true,
    provider: target === from ? 'identity-no-conversion' : 'bank-of-canada-valet-daily',
    providerAmount: amount,
    providerCurrency: from,
    displayAmount: amount,
    displayCurrency: target,
    crossRate: 1,
    rateDate: target === from ? null : '2026-09-14',
    conversionApplied: target !== from,
    originalProviderEvidencePreserved: true
  });
}

function rawLive(origin, destination, departureDate, amount) {
  return {
    supported: true,
    reason: null,
    observations: [{
      origin,
      destination,
      departureDate,
      currency: 'USD',
      totalPrice: amount,
      price: amount,
      passengers: 1,
      airline: 'GV Perf Test Air',
      stops: 0,
      transfers: 0,
      durationMinutes: 120,
      liveMode: true,
      source: 'duffel-live-683d',
      providerReference: `off_${origin}_${destination}_${departureDate}`,
      observedAt: '2026-09-14T16:00:00Z',
      expiresAt: '2026-09-14T22:00:00Z'
    }],
    rateLimit: { limit: 120, remaining: 100, reset: 'Mon, 14 Sep 2026 23:00:00 GMT' }
  };
}

function flightLeg(fromCode, toCode, departureDate, amount = 150) {
  return {
    from: { airportCode: fromCode, code: fromCode },
    to: { airportCode: toCode, code: toCode },
    mode: 'flight',
    transportType: 'flight',
    departureDate,
    estimatedTransportUsd: amount,
    estimatedFlightUsd: amount,
    amountUsd: amount
  };
}

function groundLeg(fromCode, toCode, amount = 60) {
  return {
    from: { airportCode: fromCode, code: fromCode },
    to: { airportCode: toCode, code: toCode },
    mode: 'ground',
    transportType: 'rail-or-bus',
    estimatedTransportUsd: amount,
    amountUsd: amount
  };
}

function candidateTour() {
  return {
    tourId: 'yyz-dub-gla-perf',
    origin: { city: 'Toronto', airportCode: 'YYZ', code: 'YYZ', country: 'Canada' },
    stops: [
      {
        cityId: 'dublin-ie',
        city: 'Dublin',
        country: 'Ireland',
        airportCode: 'DUB',
        code: 'DUB',
        nights: 3,
        hotel: { estimatedNightlyUsd: 50, estimatedStayUsd: 150, totalStayUsd: 150 }
      },
      {
        cityId: 'glasgow-gb',
        city: 'Glasgow',
        country: 'United Kingdom',
        airportCode: 'GLA',
        code: 'GLA',
        nights: 3,
        hotel: { estimatedNightlyUsd: 50, estimatedStayUsd: 150, totalStayUsd: 150 }
      }
    ],
    legs: [
      flightLeg('YYZ', 'DUB', '2026-10-10'),
      flightLeg('DUB', 'GLA', '2026-10-13'),
      flightLeg('GLA', 'YYZ', '2026-10-16')
    ],
    estimatedTotalUsd: 750,
    totalBudgetUsd: 1300
  };
}

function currentGroundTour() {
  return {
    tourId: 'regional-ground-current',
    origin: { city: 'Toronto', airportCode: 'YYZ', code: 'YYZ', country: 'Canada' },
    stops: [
      { cityId: 'ottawa-ca', city: 'Ottawa', country: 'Canada', airportCode: 'YOW', code: 'YOW' },
      { cityId: 'montreal-ca', city: 'Montreal', country: 'Canada', airportCode: 'YUL', code: 'YUL' }
    ],
    legs: [groundLeg('YYZ', 'YOW'), groundLeg('YOW', 'YUL'), groundLeg('YUL', 'YYZ')],
    estimatedTotalUsd: 650,
    totalBudgetUsd: 1300
  };
}

(async () => {
  const amounts = {
    'YYZ-DUB': 220,
    'DUB-GLA': 90,
    'GLA-YYZ': 240
  };
  let providerCalls = 0;
  const searchExact = async (args) => {
    providerCalls += 1;
    return rawLive(args.origin, args.destination, args.departureDate, amounts[`${args.origin}-${args.destination}`]);
  };

  const query = {
    adults: 1,
    children: 0,
    infants: 0,
    passengers: 1,
    currency: 'USD',
    pickRole: 'best-balance',
    budgetUsd: 1300
  };

  const first = await discovery.discoverAffordableFlightTour684B(
    [candidateTour()],
    currentGroundTour(),
    query,
    {
      env: readyEnv,
      totalUsd: tour => tour.estimatedTotalUsd,
      budgetCeiling: tour => tour.totalBudgetUsd,
      scoreCandidate: () => 100,
      normalizeTour: tour => tour,
      enrichTour: async tour => ({ tour, summary: { source: 'gv-perf-mock-enrichment' } }),
      applyLiveFare: (tour, q) => pilot684A.applyPublicLiveFarePilot684A(tour, q, {
        env: readyEnv,
        searchExact,
        normalizeFx: fxMock
      }),
      isOverBudget: tour => Number(tour.estimatedTotalUsd) > Number(tour.totalBudgetUsd)
    }
  );

  assert.equal(first.summary.applied, true, '684B must select the live-priced candidate');
  assert.equal(first.summary.providerRequests, 3, 'first 684A pass should make one exact request per flight leg');
  assert.equal(providerCalls, 3, 'mock provider should have been called exactly three times');

  const handoffEvidence = pilot684A._internal.completeAppliedEvidence684A(first.tour);
  assert.equal(handoffEvidence.tasks.length, 3, 'handoff should still contain all three flight legs');
  assert.equal(handoffEvidence.liveCount, 3, 'all three flight legs should retain reusable 684A LIVE evidence');
  assert.equal(handoffEvidence.complete, true, '684B returned tour should be immediately reusable by final 684A');

  const second = await pilot684A.applyPublicLiveFarePilot684A(first.tour, query, {
    env: readyEnv,
    searchExact,
    normalizeFx: fxMock
  });

  assert.equal(second.summary.applied, true, 'final 684A should remain applied');
  assert.equal(second.summary.reused, true, 'final 684A should reuse the 684B live evidence');
  assert.equal(second.summary.reason, '684a-complete-live-evidence-already-applied');
  assert.equal(second.summary.providerRequests, 0, 'reuse path must make zero additional provider requests');
  assert.equal(providerCalls, 3, 'no extra provider call may occur after the 684B handoff');

  console.log('PASS GV-PERF 684B -> final 684A live-evidence reuse diagnostic');
  console.log(JSON.stringify({
    first684BProviderRequests: first.summary.providerRequests,
    handoffTaskCount: handoffEvidence.tasks.length,
    handoffLiveCount: handoffEvidence.liveCount,
    handoffComplete: handoffEvidence.complete,
    final684AReused: second.summary.reused,
    final684AProviderRequests: second.summary.providerRequests,
    totalMockProviderCalls: providerCalls
  }, null, 2));
})().catch(error => {
  console.error('FAIL GV-PERF 684B -> final 684A live-evidence reuse diagnostic');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
