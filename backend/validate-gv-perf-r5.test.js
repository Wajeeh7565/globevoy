'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const discovery = require('./services/domain/live-fares/affordable-flight-discovery-684b');

const stagingEnv = {
  ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true',
  CORS_ORIGIN: discovery.STAGING_ORIGIN_684B
};
const nonStagingEnv = {
  ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true',
  CORS_ORIGIN: 'https://www.globevoy.com'
};

function stop(city, code) {
  return { cityId: city.toLowerCase().replace(/\s+/g, '-') + '-x', city, airportCode: code, code };
}

function flightLeg(from, to, date) {
  return {
    from: { airportCode: from, code: from },
    to: { airportCode: to, code: to },
    mode: 'flight',
    transportType: 'flight',
    departureDate: date,
    estimatedTransportUsd: 250,
    estimatedFlightUsd: 250
  };
}

function tour(id, city, code, totalUsd, budgetUsd = 1103, flightLegCount = 2) {
  const legs = flightLegCount === 3
    ? [
        flightLeg('YYZ', code, '2026-11-15'),
        flightLeg(code, 'GUA', '2026-11-19'),
        flightLeg('GUA', 'YYZ', '2026-11-23')
      ]
    : [
        flightLeg('YYZ', code, '2026-11-15'),
        flightLeg(code, 'YYZ', '2026-11-23')
      ];
  return {
    tourId: id,
    origin: { city: 'Toronto', airportCode: 'YYZ', code: 'YYZ' },
    stops: flightLegCount === 3 ? [stop(city, code), stop('Guatemala City', 'GUA')] : [stop(city, code)],
    legs,
    estimatedTotalUsd: totalUsd,
    totalBudgetUsd: budgetUsd
  };
}

function liveResult(inputTour, totalUsd, requests) {
  return {
    tour: { ...inputTour, estimatedTotalUsd: totalUsd },
    summary: {
      attempted: true,
      applied: true,
      reason: null,
      afterTotalUsd: totalUsd,
      providerRequests: requests
    }
  };
}

test('R5 is exact-staging and selected-flight-rescue only', () => {
  assert.equal(discovery.PERF_R5_VERSION, 'GV-PERF-R5');
  assert.equal(discovery.cheapestFirstRescueR5Enabled(stagingEnv, { selectedFlightFallback: true }), true);
  assert.equal(discovery.cheapestFirstRescueR5Enabled(stagingEnv, { selectedFlightFallback: false }), false);
  assert.equal(discovery.cheapestFirstRescueR5Enabled(nonStagingEnv, { selectedFlightFallback: true }), false);
});

test('R5 reorders the same bounded shortlist cheapest-first without changing membership', () => {
  const current = tour('current-mexico', 'Mexico City', 'MEX', 1019);
  const flashy = tour('flashy-mex-guatemala', 'Mexico City', 'MEX', 1134, 1103, 3);
  const cheap = tour('cheap-cancun', 'Cancun', 'CUN', 1040);

  const options = {
    totalUsd: t => t.estimatedTotalUsd,
    budgetCeiling: t => t.totalBudgetUsd,
    scoreCandidate: t => t.tourId === 'flashy-mex-guatemala' ? 900 : 600
  };
  const normal = discovery.buildShortlist684B([current, flashy, cheap], current, { pickRole: 'best-balance' }, options);
  const r5 = discovery.buildShortlist684B([current, flashy, cheap], current, { pickRole: 'best-balance' }, {
    ...options,
    preferCheapestFirst: true
  });

  assert.deepEqual(normal.map(row => row.tour.tourId), ['flashy-mex-guatemala', 'cheap-cancun']);
  assert.deepEqual(r5.map(row => row.tour.tourId), ['cheap-cancun', 'flashy-mex-guatemala']);
  assert.deepEqual(
    normal.map(row => row.tour.tourId).sort(),
    r5.map(row => row.tour.tourId).sort()
  );
  assert.equal(r5.length, 2);
});

test('staging selected-flight rescue stops after cheaper candidate succeeds', async () => {
  const current = tour('current-mexico', 'Mexico City', 'MEX', 1019);
  const flashy = tour('flashy-mex-guatemala', 'Mexico City', 'MEX', 1134, 1103, 3);
  const cheap = tour('cheap-cancun', 'Cancun', 'CUN', 1040);
  const calls = [];

  const result = await discovery.discoverAffordableFlightTour684B(
    [current, flashy, cheap],
    current,
    { adults: 1, passengers: 1, pickRole: 'best-balance', origin: 'Toronto (YYZ)' },
    {
      env: stagingEnv,
      allowSelectedFlightFallback: true,
      totalUsd: t => t.estimatedTotalUsd,
      budgetCeiling: t => t.totalBudgetUsd,
      scoreCandidate: t => t.tourId === 'flashy-mex-guatemala' ? 900 : 600,
      enrichTour: async t => ({ tour: t, summary: {} }),
      applyLiveFare: async t => {
        calls.push(t.tourId);
        if (t.tourId === 'cheap-cancun') return liveResult(t, 945, 2);
        return liveResult(t, 1378, 3);
      },
      isOverBudget: t => t.estimatedTotalUsd > t.totalBudgetUsd
    }
  );

  assert.deepEqual(calls, ['cheap-cancun']);
  assert.equal(result.summary.applied, true);
  assert.equal(result.summary.selectedRoute, 'cancun-x');
  assert.equal(result.summary.providerRequests, 2);
  assert.equal(result.summary.candidatesAttempted, 1);
  assert.equal(result.summary.rescueOrderingR5.active, true);
  assert.equal(result.summary.rescueOrderingR5.strategy, 'cheapest-planning-total-first');
  assert.deepEqual(result.summary.rescueOrderingR5.candidateOrder, ['cancun-x', 'mexico-city-x>guatemala-city-x']);
});

test('non-staging selected-flight rescue preserves role-ranked-first behavior', async () => {
  const current = tour('current-mexico', 'Mexico City', 'MEX', 1019);
  const flashy = tour('flashy-mex-guatemala', 'Mexico City', 'MEX', 1134, 1103, 3);
  const cheap = tour('cheap-cancun', 'Cancun', 'CUN', 1040);
  const calls = [];

  const result = await discovery.discoverAffordableFlightTour684B(
    [current, flashy, cheap],
    current,
    { adults: 1, passengers: 1, pickRole: 'best-balance', origin: 'Toronto (YYZ)' },
    {
      env: nonStagingEnv,
      allowSelectedFlightFallback: true,
      totalUsd: t => t.estimatedTotalUsd,
      budgetCeiling: t => t.totalBudgetUsd,
      scoreCandidate: t => t.tourId === 'flashy-mex-guatemala' ? 900 : 600,
      enrichTour: async t => ({ tour: t, summary: {} }),
      applyLiveFare: async t => {
        calls.push(t.tourId);
        return liveResult(t, 1080, t.tourId === 'flashy-mex-guatemala' ? 3 : 2);
      },
      isOverBudget: t => t.estimatedTotalUsd > t.totalBudgetUsd
    }
  );

  assert.deepEqual(calls, ['flashy-mex-guatemala']);
  assert.equal(result.summary.selectedRoute, 'mexico-city-x>guatemala-city-x');
  assert.equal(result.summary.rescueOrderingR5.active, false);
  assert.equal(result.summary.rescueOrderingR5.strategy, 'role-ranked-first');
});

test('R5 adds no new environment variable or capability', () => {
  const status = discovery.status684B(stagingEnv);
  assert.equal(status.environmentVariablesAdded, 0);
  assert.equal(status.stagingCheapestFirstRescueR5, true);
  assert.equal(status.orderCapability, false);
  assert.equal(status.paymentCapability, false);
  assert.equal(status.bookingCapability, false);
  assert.equal(status.ticketingCapability, false);
});
