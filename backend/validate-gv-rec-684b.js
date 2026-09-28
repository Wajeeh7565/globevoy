'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const discovery = require('./services/domain/live-fares/affordable-flight-discovery-684b');
const pilot684A = require('./services/domain/live-fares/public-live-fare-pilot-684a');
const generated = require('./generated-tour');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}
async function testAsync(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const readyEnv = {
  ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true',
  GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A: 'YYZ'
};

function stop(city, code) {
  return { cityId: `${city.toLowerCase().replace(/\s+/g, '-')}-x`, city, airportCode: code, code, country: code === 'MEX' ? 'Mexico' : (code === 'GUA' ? 'Guatemala' : 'Canada') };
}
function flightLeg(fromCode, toCode, date, amount = 280) {
  return {
    from: { airportCode: fromCode, code: fromCode },
    to: { airportCode: toCode, code: toCode },
    mode: 'flight', transportType: 'flight', departureDate: date,
    estimatedTransportUsd: amount, estimatedFlightUsd: amount
  };
}
function groundLeg(fromCode, toCode, amount = 60) {
  return {
    from: { airportCode: fromCode, code: fromCode },
    to: { airportCode: toCode, code: toCode },
    mode: 'ground', transportType: 'rail-or-bus', estimatedTransportUsd: amount
  };
}
function groundTour() {
  return {
    tourId: 'ground-ottawa-montreal',
    origin: { city: 'Toronto', airportCode: 'YYZ', code: 'YYZ', country: 'Canada' },
    stops: [stop('Ottawa', 'YOW'), stop('Montreal', 'YUL')],
    legs: [groundLeg('YYZ', 'YOW'), groundLeg('YOW', 'YUL'), groundLeg('YUL', 'YYZ')],
    estimatedTotalUsd: 900,
    totalBudgetUsd: 1100
  };
}
function mexicoTour(total = 980) {
  return {
    tourId: 'flight-mexico-city',
    origin: { city: 'Toronto', airportCode: 'YYZ', code: 'YYZ', country: 'Canada' },
    stops: [stop('Mexico City', 'MEX')],
    legs: [flightLeg('YYZ', 'MEX', '2026-09-08', 320), flightLeg('MEX', 'YYZ', '2026-09-14', 310)],
    estimatedTotalUsd: total,
    totalBudgetUsd: 1100
  };
}
function guatemalaTour(total = 1040) {
  return {
    tourId: 'flight-guatemala-city',
    origin: { city: 'Toronto', airportCode: 'YYZ', code: 'YYZ', country: 'Canada' },
    stops: [stop('Guatemala City', 'GUA')],
    legs: [flightLeg('YYZ', 'GUA', '2026-09-08', 350), flightLeg('GUA', 'YYZ', '2026-09-14', 330)],
    estimatedTotalUsd: total,
    totalBudgetUsd: 1100
  };
}

function liveResult(tour, totalUsd, requests = 2) {
  return {
    tour: { ...tour, estimatedTotalUsd: totalUsd },
    summary: { attempted: true, applied: true, reason: null, afterTotalUsd: totalUsd, providerRequests: requests, requiredFlightLegCount: 2, liveFlightLegCount: 2 }
  };
}

(async () => {
  test('684B-R3 version locked', () => assert.equal(discovery.VERSION_684B, 'GV-REC-684B-R3'));
  test('684B-R3 generated-tour version locked', () => assert.equal(generated.GENERATED_TOUR_VERSION, '2.18.3-gv-rec-684b-r3-strict-currency-budget-fit'));
  test('684B defaults to YYZ-only discovery allowlist', () => assert.deepEqual(discovery.configuredOrigins684B({}), ['YYZ']));
  test('684B-R3 adds no new Lambda environment gate', () => {
    const e = discovery.eligibility684B([mexicoTour()], groundTour(), { adults: 1, pickRole: 'best-balance' }, readyEnv);
    assert.equal(discovery.CODE_ENABLED_684B_R3, true); assert.equal(e.eligible, true);
    const source = fs.readFileSync(path.join(__dirname, 'services', 'domain', 'live-fares', 'affordable-flight-discovery-684b.js'), 'utf8');
    assert(!source.includes('ENABLE_AFFORDABLE_FLIGHT_DISCOVERY_684B'));
    assert(!source.includes('GV_AFFORDABLE_FLIGHT_DISCOVERY_ORIGINS_684B'));
  });
  test('684B requires 684A public live-fare pilot', () => {
    const e = discovery.eligibility684B([mexicoTour()], groundTour(), { adults: 1, pickRole: 'best-balance' }, { ...readyEnv, ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'false' });
    assert.equal(e.eligible, false); assert.equal(e.reason, '684b-requires-684a-live-fare-pilot');
  });
  test('684B preserves lowest-cost ground lane', () => {
    const e = discovery.eligibility684B([mexicoTour()], groundTour(), { adults: 1, pickRole: 'lowest-cost' }, readyEnv);
    assert.equal(e.eligible, false); assert.match(e.reason, /lowest-cost/);
  });
  test('684B skips discovery when selected route already flies', () => {
    const e = discovery.eligibility684B([guatemalaTour()], mexicoTour(), { adults: 1, pickRole: 'best-balance' }, readyEnv);
    assert.equal(e.eligible, false); assert.equal(e.reason, '684b-selected-route-already-has-flight');
  });
  test('684B-R3 preserves bounded fallback after selected flight is proven over budget', () => {
    const e = discovery.eligibility684B([guatemalaTour()], mexicoTour(), { adults: 1, pickRole: 'best-balance' }, readyEnv, { allowSelectedFlightFallback: true });
    assert.equal(e.eligible, true); assert.equal(e.selectedFlightFallback, true);
  });
  test('684B remains single-adult during pilot', () => {
    const e = discovery.eligibility684B([mexicoTour()], groundTour(), { adults: 2, passengers: 2, pickRole: 'best-balance' }, readyEnv);
    assert.equal(e.eligible, false); assert.equal(e.reason, '684b-single-adult-pilot-only');
  });
  test('684B rejects non-YYZ origin', () => {
    const lax = mexicoTour(); lax.origin = { airportCode: 'LAX', code: 'LAX' }; lax.legs[0].from = { airportCode: 'LAX', code: 'LAX' };
    const e = discovery.eligibility684B([lax], null, { adults: 1, pickRole: 'best-balance', origin: 'Los Angeles (LAX)' }, readyEnv);
    assert.equal(e.eligible, false); assert.equal(e.reason, '684b-origin-outside-pilot-allowlist');
  });
  test('684B shortlist admits modest planning overestimate for live verification', () => {
    const candidate = mexicoTour(1200); // 9.1% above 1100; allowed for discovery only.
    const rows = discovery.buildShortlist684B([candidate], groundTour(), { pickRole: 'best-balance' }, {
      totalUsd: t => t.estimatedTotalUsd,
      budgetCeiling: t => t.totalBudgetUsd,
      scoreCandidate: () => 100
    });
    assert.equal(rows.length, 1); assert.equal(rows[0].planningTotalUsd, 1200);
  });
  test('684B shortlist rejects planning candidate beyond 15% expansion', () => {
    const candidate = mexicoTour(1300);
    const rows = discovery.buildShortlist684B([candidate], groundTour(), { pickRole: 'best-balance' }, {
      totalUsd: t => t.estimatedTotalUsd,
      budgetCeiling: t => t.totalBudgetUsd,
      scoreCandidate: () => 100
    });
    assert.equal(rows.length, 0);
  });
  test('684B candidate checks are hard capped at two', () => {
    const a = mexicoTour(980), b = guatemalaTour(990), c = mexicoTour(1000); c.stops = [stop('Cancun','CUN')]; c.legs = [flightLeg('YYZ','CUN','2026-09-08'), flightLeg('CUN','YYZ','2026-09-14')]; c.tourId='cancun';
    const rows = discovery.buildShortlist684B([a,b,c], groundTour(), { pickRole: 'best-balance' }, {
      totalUsd: t => t.estimatedTotalUsd, budgetCeiling: t => t.totalBudgetUsd, scoreCandidate: t => t.tourId === 'cancun' ? 300 : (t.tourId.includes('guatemala') ? 200 : 100)
    });
    assert.equal(rows.length, 2); assert.equal(rows[0].tour.tourId, 'cancun');
  });
  test('684B reserves one shortlist slot for cheapest plausible flight route', () => {
    const cheap = mexicoTour(900);
    const flashyA = guatemalaTour(1030);
    const flashyB = mexicoTour(1040); flashyB.tourId='flashy-b'; flashyB.stops=[stop('Cancun','CUN')]; flashyB.legs=[flightLeg('YYZ','CUN','2026-09-08'),flightLeg('CUN','YYZ','2026-09-14')];
    const rows = discovery.buildShortlist684B([cheap, flashyA, flashyB], groundTour(), { pickRole: 'best-balance' }, {
      totalUsd: t => t.estimatedTotalUsd, budgetCeiling: t => t.totalBudgetUsd,
      scoreCandidate: t => t.tourId === 'flashy-b' ? 300 : (t.tourId.includes('guatemala') ? 250 : 10)
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].tour.tourId, 'flashy-b');
    assert(rows.some(row => row.tour.tourId === 'flight-mexico-city'));
  });
  await testAsync('684B rescues complete live flight route under budget', async () => {
    const result = await discovery.discoverAffordableFlightTour684B([mexicoTour()], groundTour(), { adults: 1, passengers: 1, pickRole: 'best-balance' }, {
      env: readyEnv,
      totalUsd: t => t.estimatedTotalUsd,
      budgetCeiling: t => t.totalBudgetUsd,
      scoreCandidate: () => 100,
      enrichTour: async t => ({ tour: t, summary: { source: 'mock-enrich' } }),
      applyLiveFare: async t => liveResult(t, 1020, 2),
      isOverBudget: t => t.estimatedTotalUsd > t.totalBudgetUsd
    });
    assert.equal(result.summary.applied, true); assert.equal(result.summary.selectedRoute, 'mexico-city-x'); assert.equal(result.summary.providerRequests, 2); assert.equal(result.tour.affordableFlightDiscovery684B.applied, true);
  });
  await testAsync('684B refuses live-priced candidate that remains over budget', async () => {
    const result = await discovery.discoverAffordableFlightTour684B([mexicoTour()], groundTour(), { adults: 1, passengers: 1, pickRole: 'best-balance' }, {
      env: readyEnv, totalUsd: t => t.estimatedTotalUsd, budgetCeiling: t => t.totalBudgetUsd, scoreCandidate: () => 100,
      enrichTour: async t => ({ tour: t }), applyLiveFare: async t => liveResult(t, 1180, 2), isOverBudget: t => t.estimatedTotalUsd > t.totalBudgetUsd
    });
    assert.equal(result.summary.applied, false); assert.equal(result.summary.reason, '684b-no-complete-live-flight-route-within-budget');
  });
  await testAsync('684B tries second candidate after first live failure', async () => {
    const first = mexicoTour(960), second = guatemalaTour(990); let calls = 0;
    const result = await discovery.discoverAffordableFlightTour684B([first, second], groundTour(), { adults: 1, passengers: 1, pickRole: 'most-memorable' }, {
      env: readyEnv, totalUsd: t => t.estimatedTotalUsd, budgetCeiling: t => t.totalBudgetUsd,
      scoreCandidate: t => t.tourId.includes('mexico') ? 200 : 100,
      enrichTour: async t => ({ tour: t }),
      applyLiveFare: async t => { calls += 1; return calls === 1 ? { tour: t, summary: { attempted: true, applied: false, reason: '684a-incomplete-live-flight-coverage-fail-closed', providerRequests: 1 } } : liveResult(t, 1000, 2); },
      isOverBudget: t => t.estimatedTotalUsd > t.totalBudgetUsd
    });
    assert.equal(calls, 2); assert.equal(result.summary.applied, true); assert.equal(result.summary.selectedRoute, 'guatemala-city-x'); assert.equal(result.summary.providerRequests, 3);
  });
  await testAsync('684B stops candidate retries after quota fail-closed', async () => {
    const first = mexicoTour(960), second = guatemalaTour(990); let calls = 0;
    const result = await discovery.discoverAffordableFlightTour684B([first, second], groundTour(), { adults: 1, passengers: 1, pickRole: 'most-memorable' }, {
      env: readyEnv, totalUsd: t => t.estimatedTotalUsd, budgetCeiling: t => t.totalBudgetUsd,
      scoreCandidate: t => t.tourId.includes('mexico') ? 200 : 100,
      enrichTour: async t => ({ tour: t }),
      applyLiveFare: async t => { calls += 1; return { tour: t, summary: { attempted: true, applied: false, reason: '684a-provider-quota-fail-closed', providerRequests: 1 } }; },
      isOverBudget: t => t.estimatedTotalUsd > t.totalBudgetUsd
    });
    assert.equal(calls, 1); assert.equal(result.summary.applied, false); assert.equal(result.summary.providerRequests, 1);
  });
  await testAsync('684B-R3 preserves alternative rescue after selected flight route is live-over-budget', async () => {
    const current = mexicoTour(1000);
    const alternative = guatemalaTour(1010);
    const result = await discovery.discoverAffordableFlightTour684B([current, alternative], current, { adults: 1, passengers: 1, pickRole: 'best-balance' }, {
      env: readyEnv,
      allowSelectedFlightFallback: true,
      totalUsd: t => t.estimatedTotalUsd,
      budgetCeiling: t => t.totalBudgetUsd,
      scoreCandidate: () => 100,
      enrichTour: async t => ({ tour: t, summary: { source: 'mock-enrich' } }),
      applyLiveFare: async t => liveResult(t, 1040, 2),
      isOverBudget: t => t.estimatedTotalUsd > t.totalBudgetUsd
    });
    assert.equal(result.summary.applied, true);
    assert.equal(result.summary.selectedFlightFallbackMode, true);
    assert.equal(result.summary.selectedRoute, 'guatemala-city-x');
  });
  test('684B-R3 rejects C$1,505 against an entered C$1,500 budget', () => {
    const fit = generated._internal.strictBudgetFit684BR3({ estimatedTotalUsd: 1106 }, { budget: 1500, currency: 'CAD' });
    assert.equal(fit.currency, 'CAD'); assert.equal(fit.totalDisplay, 1505); assert.equal(fit.budgetDisplay, 1500); assert.equal(fit.overBudget, true);
  });
  test('684B-R3 accepts a displayed C$1,499 total against C$1,500', () => {
    const fit = generated._internal.strictBudgetFit684BR3({ estimatedTotalUsd: 1102 }, { budget: 1500, currency: 'CAD' });
    assert.equal(fit.totalDisplay, 1499); assert.equal(fit.overBudget, false);
  });
  test('684B-R3 strict display-budget comparison is currency safe for USD EUR GBP and AUD', () => {
    const cases = [
      ['USD', 1501],
      ['EUR', 1621],
      ['GBP', 1906],
      ['AUD', 991]
    ];
    for (const [currency, totalUsd] of cases) {
      const fit = generated._internal.strictBudgetFit684BR3({ estimatedTotalUsd: totalUsd }, { budget: 1500, currency });
      assert.equal(fit.budgetDisplay, 1500, currency);
      assert(fit.totalDisplay > 1500, `${currency} fixture must display over budget`);
      assert.equal(fit.overBudget, true, currency);
    }
  });
  test('684B-R3 falls back to strict explicit USD budget when display budget is absent', () => {
    const over = generated._internal.strictBudgetFit684BR3({ estimatedTotalUsd: 1101 }, { budgetUsd: 1100 });
    const under = generated._internal.strictBudgetFit684BR3({ estimatedTotalUsd: 1099 }, { budgetUsd: 1100 });
    assert.equal(over.source, 'explicit-budget-usd'); assert.equal(over.overBudget, true); assert.equal(under.overBudget, false);
  });
  test('684B-R3 live discovery callbacks use strict budget fit rather than planning tolerance', () => {
    const source = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
    assert.match(source, /isOverBudget:\s*isOverUserBudgetStrict684BR3/);
    assert.match(source, /strictLiveBudgetFit684BR3/);
    assert.match(source, /strictFinalBudgetFitMain684BR3/);
  });
  test('684B-R3 keeps planning tolerance separate from final public strict fit', () => {
    const source = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
    assert.match(source, /function budgetCeilingUsd\([\s\S]*Math\.max\(5, direct \* 0\.005\)/);
    assert.match(source, /function strictBudgetFit684BR3/);
    assert.match(source, /totalDisplay > budgetDisplay/);
  });
  test('684A recognizes complete pre-applied live evidence for request reuse', () => {
    const tour = mexicoTour(1000);
    tour.legs = tour.legs.map((leg, i) => ({ ...leg, providerDateEvidence: {
      origin: i === 0 ? 'YYZ' : 'MEX', destination: i === 0 ? 'MEX' : 'YYZ', departureDate: leg.departureDate,
      sourceType: 'LIVE', productionEligible: true, publicLiveFareEvidence684A: { version: 'GV-FLIGHT-684A' }
    }}));
    const check = pilot684A._internal.completeAppliedEvidence684A(tour);
    assert.equal(check.complete, true); assert.equal(check.liveCount, 2);
  });
  await testAsync('684A reuses 684B live evidence without another provider request', async () => {
    const tour = mexicoTour(1000);
    tour.legs = tour.legs.map((leg, i) => ({ ...leg, providerDateEvidence: {
      origin: i === 0 ? 'YYZ' : 'MEX', destination: i === 0 ? 'MEX' : 'YYZ', departureDate: leg.departureDate,
      sourceType: 'LIVE', productionEligible: true, publicLiveFareEvidence684A: { version: 'GV-FLIGHT-684A' }
    }}));
    const result = await pilot684A.applyPublicLiveFarePilot684A(tour, { budgetUsd: 1100 }, { env: { ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true' } });
    assert.equal(result.summary.applied, true); assert.equal(result.summary.reused, true); assert.equal(result.summary.providerRequests, 0);
  });
  test('684B generated-tour integration occurs before no-route fallback', () => {
    const source = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
    const discoveryAt = source.indexOf('discoverAffordableFlightTour684B(');
    const fallbackAt = source.indexOf("globalFallbackResponse(routeQuery, 'base-routes-exceeded-user-budget'");
    assert(discoveryAt > 0 && fallbackAt > discoveryAt);
    assert.match(source, /affordableFlightDiscovery684B\.enrichment/);
    assert.match(source, /tourRole:\s*requestedDiscoveryRole684B/);
    assert.match(source, /allowSelectedFlightFallback:\s*true/);
    assert.match(source, /routeStillOverBudgetAfterLive684B/);
  });
  test('684B generated-tour exposes diagnostics and version', () => {
    const source = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
    assert.match(source, /2\.18\.3-gv-rec-684b-r3-strict-currency-budget-fit/);
    assert.match(source, /affordableFlightDiscovery684B:/);
    assert.match(source, /VERSION_684B/);
  });
  test('684B adds no Duffel order payment booking or ticketing API', () => {
    const source = fs.readFileSync(path.join(__dirname, 'services', 'domain', 'live-fares', 'affordable-flight-discovery-684b.js'), 'utf8').toLowerCase();
    assert(!source.includes('/air/orders'));
    assert(!source.includes('/orders/'));
    assert(!source.includes('createpayment'));
    assert(!source.includes('createticket'));
  });
  test('684B status is bounded and fail-closed', () => {
    const status = discovery.status684B(readyEnv);
    assert.equal(status.enabled, true); assert.equal(status.activationMode, 'code-only-yyz-reuses-684a-gate-with-strict-currency-safe-budget-fit'); assert.equal(status.environmentVariablesAdded, 0); assert.deepEqual(status.originAllowlist, ['YYZ']); assert.equal(status.candidateCap, 2); assert.equal(status.maxFlightLegs, 3); assert.equal(status.planningOverageRatio, 1.15); assert.equal(status.completeLiveEvidenceRequired, true); assert.equal(status.overBudgetSelectedFlightRescue, true); assert.equal(status.strictUserCurrencyBudgetFitR3, true); assert.equal(status.preservesLowestCostGroundOption, true);
  });

  console.log(`PASS ${passed}/${passed} - GV-REC-684B local validator`);
})().catch(error => {
  console.error('FAIL', error && error.stack ? error.stack : error);
  process.exit(1);
});
