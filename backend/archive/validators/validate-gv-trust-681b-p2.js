'use strict';

Object.assign(process.env, {
  ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B: 'true',
  ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A: 'true',
  ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B: 'true',
  ENABLE_SMART_FLIGHT_DATE_SELECTION_677B: 'true',
  ENABLE_ITINERARY_DATE_INTEGRITY_677B_R1: 'true',
  ENABLE_WHOLE_TRIP_DATE_OPTIMIZER_681B_P2: 'true',
  ENABLE_PASSENGER_ROOM_PRICING_666A: 'true',
  TRAVELPAYOUTS_TOKEN: 'fixture-token'
});

const fs = require('node:fs');
const assert = require('node:assert/strict');
const generated = require('./generated-tour');
const optimizer = require('./services/domain/routing/whole-trip-date-optimizer-681b-p2');

const checks = [];
function test(name, fn) { fn(); checks.push({ name, status: 'PASS' }); }
async function testAsync(name, fn) { await fn(); checks.push({ name, status: 'PASS' }); }

const flightLegs = [
  { mode: 'flight', transportType: 'flight', from: { city: 'Dublin', airportCode: 'DUB' }, to: { city: 'Tangier', airportCode: 'TNG' }, estimatedTransportUsd: 170 },
  { mode: 'flight', transportType: 'flight', from: { city: 'Tangier', airportCode: 'TNG' }, to: { city: 'Porto', airportCode: 'OPO' }, estimatedTransportUsd: 120 },
  { mode: 'flight', transportType: 'flight', from: { city: 'Porto', airportCode: 'OPO' }, to: { city: 'Dublin', airportCode: 'DUB' }, estimatedTransportUsd: 150 }
];
const stops = [
  { city: 'Tangier', nights: 3, hotel: { estimatedNightlyUsd: 50, estimatedStayUsd: 150 } },
  { city: 'Porto', nights: 2, hotel: { estimatedNightlyUsd: 70, estimatedStayUsd: 140 } }
];

function result(rows) { return { supported: true, observations: rows.map(([departureDate, price, durationMinutes = 240, transfers = 0]) => ({ departureDate, price, currency: 'EUR', durationMinutes, transfers })) }; }
const providerResults = [
  result([['2026-08-27', 101], ['2026-08-28', 127], ['2026-08-29', 90]]),
  result([['2026-08-30', 140], ['2026-08-31', 70]]),
  result([['2026-09-01', 110], ['2026-09-02', 80]])
];

test('P2 release version is exported', () => {
  assert.equal(generated.WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2, 'GV-TRUST-681B-P2');
  assert.equal(optimizer.WHOLE_TRIP_DATE_OPTIMIZER_VERSION_681B_P2, 'GV-TRUST-681B-P2');
});

test('whole-trip schedule preserves city nights across every leg', () => {
  assert.deepEqual(optimizer.scheduleForStart({ startDate: '2026-08-27', stops, legCount: 3 }), ['2026-08-27', '2026-08-30', '2026-09-01']);
  assert.deepEqual(optimizer.scheduleForStart({ startDate: '2026-08-28', stops, legCount: 3 }), ['2026-08-28', '2026-08-31', '2026-09-02']);
});

test('candidate start dates come only from provider-backed first-leg observations inside the window', () => {
  assert.deepEqual(optimizer.candidateStartDates({ firstLegResult: providerResults[0], minimumDate: '2026-08-27', maximumShiftDays: 1 }), ['2026-08-27', '2026-08-28']);
});

test('whole-trip candidate requires exact-date provider evidence for every flight leg', () => {
  const complete = optimizer.evaluateCandidate({
    startDate: '2026-08-27', stops, legs: flightLegs, providerResults,
    isFlightLeg: () => true, isGroundLeg: () => false,
    convertProviderPriceToUsd: price => Number(price), flightFareUnits: 1,
    hotelEstimateUsd: 290
  });
  const incomplete = optimizer.evaluateCandidate({
    startDate: '2026-08-29', stops, legs: flightLegs, providerResults,
    isFlightLeg: () => true, isGroundLeg: () => false,
    convertProviderPriceToUsd: price => Number(price), flightFareUnits: 1,
    hotelEstimateUsd: 290
  });
  assert.equal(complete.completeProviderFlightCoverage, true);
  assert.equal(complete.mixedEvidenceTotalUsd, 641);
  assert.equal(incomplete.completeProviderFlightCoverage, false);
  assert.ok(incomplete.missingFlightLegs.length >= 1);
});

test('cheapest first flight cannot beat a more complete whole-trip schedule', () => {
  const a = optimizer.evaluateCandidate({
    startDate: '2026-08-27', stops, legs: flightLegs, providerResults,
    isFlightLeg: () => true, isGroundLeg: () => false,
    convertProviderPriceToUsd: price => Number(price), flightFareUnits: 1,
    hotelEstimateUsd: 290
  });
  const b = optimizer.evaluateCandidate({
    startDate: '2026-08-28', stops, legs: flightLegs, providerResults,
    isFlightLeg: () => true, isGroundLeg: () => false,
    convertProviderPriceToUsd: price => Number(price), flightFareUnits: 1,
    hotelEstimateUsd: 290
  });
  // A has the cheaper first flight (101 vs 127), but B has cheaper later legs.
  const selection = optimizer.selectCandidate([a, b], { budgetCeilingUsd: 1000 });
  assert.equal(selection.selected.startDate, '2026-08-28');
  assert.equal(selection.selected.mixedEvidenceTotalUsd, 567);
  assert.equal(selection.completeCandidateCount, 2);
});

test('incomplete schedules never win cheapest even when their first leg is cheapest', () => {
  const complete = optimizer.evaluateCandidate({
    startDate: '2026-08-27', stops, legs: flightLegs, providerResults,
    isFlightLeg: () => true, isGroundLeg: () => false,
    convertProviderPriceToUsd: price => Number(price), flightFareUnits: 1,
    hotelEstimateUsd: 290
  });
  const incomplete = optimizer.evaluateCandidate({
    startDate: '2026-08-29', stops, legs: flightLegs, providerResults,
    isFlightLeg: () => true, isGroundLeg: () => false,
    convertProviderPriceToUsd: price => Number(price), flightFareUnits: 1,
    hotelEstimateUsd: 290
  });
  const selection = optimizer.selectCandidate([incomplete, complete], { budgetCeilingUsd: 1000 });
  assert.equal(selection.selected.startDate, '2026-08-27');
  assert.equal(selection.completeCandidateCount, 1);
});

test('budget-fit complete candidate is preferred over an over-budget complete candidate', () => {
  const low = { ...optimizer.evaluateCandidate({ startDate: '2026-08-27', stops, legs: flightLegs, providerResults, isFlightLeg: () => true, isGroundLeg: () => false, convertProviderPriceToUsd: price => Number(price), flightFareUnits: 1, hotelEstimateUsd: 290 }), mixedEvidenceTotalUsd: 700 };
  const high = { ...low, startDate: '2026-08-28', mixedEvidenceTotalUsd: 900 };
  const selection = optimizer.selectCandidate([high, low], { budgetCeilingUsd: 750 });
  assert.equal(selection.selected.startDate, '2026-08-27');
  assert.equal(selection.budgetFitCandidateCount, 1);
});

test('severe or limited provider schedules cannot win P2 just because they are cheaper', () => {
  const safe = { ...optimizer.evaluateCandidate({ startDate: '2026-08-27', stops, legs: flightLegs, providerResults, isFlightLeg: () => true, isGroundLeg: () => false, convertProviderPriceToUsd: price => Number(price), flightFareUnits: 1, hotelEstimateUsd: 290 }), mixedEvidenceTotalUsd: 700, qualityEligible: true, limitedProviderLegs: 0 };
  const limited = { ...safe, startDate: '2026-08-28', mixedEvidenceTotalUsd: 500, qualityEligible: false, limitedProviderLegs: 1 };
  const selection = optimizer.selectCandidate([limited, safe], { budgetCeilingUsd: 1000 });
  assert.equal(selection.selected.startDate, '2026-08-27');
  assert.equal(selection.qualityEligibleCandidateCount, 1);
});

test('P2 can be explicitly disabled for rollback', () => {
  assert.equal(generated._internal.wholeTripDateOptimizer681BP2Enabled(), true);
  process.env.ENABLE_WHOLE_TRIP_DATE_OPTIMIZER_681B_P2 = 'false';
  assert.equal(generated._internal.wholeTripDateOptimizer681BP2Enabled(), false);
  process.env.ENABLE_WHOLE_TRIP_DATE_OPTIMIZER_681B_P2 = 'true';
});

function fixtureRows(origin, destination, month) {
  const key = `${origin}-${destination}-${month}`;
  const fixtures = {
    'DUB-TNG-2026-08': [['2026-08-27',101],['2026-08-28',127]],
    'TNG-OPO-2026-08': [['2026-08-30',140],['2026-08-31',70]],
    'OPO-DUB-2026-08': [],
    'DUB-TNG-2026-09': [],
    'TNG-OPO-2026-09': [],
    'OPO-DUB-2026-09': [['2026-09-01',110],['2026-09-02',80]]
  };
  return (fixtures[key] || []).map(([date, price]) => ({ departure_at: `${date}T10:00:00+00:00`, price, duration: 240, transfers: 0, airline: 'ZZ' }));
}

async function integration() {
  const realFetch = global.fetch;
  global.fetch = async (url) => {
    const u = new URL(url);
    const origin = u.searchParams.get('origin');
    const destination = u.searchParams.get('destination');
    const month = u.searchParams.get('departure_at');
    const body = { success: true, data: fixtureRows(origin, destination, month) };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  try {
    const tour = {
      title: 'Dublin test circuit',
      origin: { city: 'Dublin', airportCode: 'DUB', code: 'DUB' },
      legs: flightLegs.map(x => ({ ...x })),
      stops: stops.map(x => ({ ...x, hotel: { ...x.hotel } })),
      totalBudgetUsd: 900,
      estimatedTotalUsd: 730
    };
    const query = { currency: 'EUR', budget: 900, pickRole: 'lowest-cost', preferredMonth: '2026-08', passengers: 1, rooms: 1 };
    const enriched = await generated.enrichTourWithCheapFlights(tour, query);
    const summary = enriched.summary.wholeTripDateOptimization;
    assert.equal(summary.version, 'GV-TRUST-681B-P2');
    assert.equal(summary.applied, true);
    assert.equal(summary.completeCandidateCount, 2);
    assert.equal(summary.selectedStartDate, '2026-08-28');
    assert.deepEqual(summary.selectedSchedule, ['2026-08-28','2026-08-31','2026-09-02']);
    assert.deepEqual(enriched.tour.legs.map(leg => leg.departureDate), ['2026-08-28','2026-08-31','2026-09-02']);
    assert.ok(enriched.tour.legs.every(leg => leg?.cheapestOneWay?.selectionReason === 'whole-trip-date-optimizer-681b-p2'));
    assert.equal(enriched.tour.stops[0].arrivalDate, '2026-08-28');
    assert.equal(enriched.tour.stops[0].departureDate, '2026-08-31');
    assert.equal(enriched.tour.stops[1].arrivalDate, '2026-08-31');
    assert.equal(enriched.tour.stops[1].departureDate, '2026-09-02');
  } finally {
    global.fetch = realFetch;
  }
}

(async () => {
  await testAsync('integration applies the cheapest complete route schedule, not the cheapest first leg', integration);
  const report = { version: 'GV-TRUST-681B-P2', generatedAt: new Date().toISOString(), passed: checks.length, failed: 0, checks };
  fs.writeFileSync('VALIDATION_GV_TRUST_681B_P2.json', JSON.stringify(report, null, 2));
  console.log(`PASS ${checks.length}/${checks.length} - GV-TRUST-681B-P2 backend`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
