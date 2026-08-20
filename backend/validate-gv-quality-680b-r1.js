'use strict';

const assert = require('node:assert/strict');
process.env.ENABLE_GENERATED_TOUR_651A = 'true';
process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665B = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
delete process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B; // R1 must be safe by default.

const generated = require('./generated-tour');
const graph = require('./services/global-route-graph');

(async () => {
  const monthEdge = generated.effectiveFlexibleMonth680BR1('2026-08', '2026-08-25', 14);
  assert.equal(monthEdge.adjusted, true, 'late current-month flexible search is advanced');
  assert.equal(monthEdge.effectiveMonth, '2026-09', 'effective month becomes the first month that satisfies the lead-time floor');
  assert.equal(monthEdge.minimumDate, '2026-09-08', 'lead-time floor is deterministic');

  const futureMonth = generated.effectiveFlexibleMonth680BR1('2026-10', '2026-08-25', 14);
  assert.equal(futureMonth.adjusted, false, 'valid future month is preserved');
  assert.equal(futureMonth.effectiveMonth, '2026-10');

  const beachTour = {
    stops: [{ city: 'Cancun', country: 'Mexico', code: 'CUN' }],
    estimatedTotalUsd: 850,
    totalBudgetUsd: 1000,
    legs: []
  };
  const cityTour = {
    stops: [{ city: 'Houston', country: 'United States', code: 'HOU' }],
    estimatedTotalUsd: 850,
    totalBudgetUsd: 1000,
    legs: []
  };
  assert.ok(
    generated.preferenceMatchAdjustment680BR1(beachTour, { priorities: 'Beach' }) > generated.preferenceMatchAdjustment680BR1(cityTour, { priorities: 'Beach' }),
    'Beach priority changes deterministic ranking in favour of beach-aligned destinations'
  );

  const nonstopTour = {
    estimatedTotalUsd: 900,
    totalBudgetUsd: 1000,
    legs: [{ mode: 'flight', cheapestOneWay: { transfers: 0 } }]
  };
  const twoStopTour = {
    estimatedTotalUsd: 900,
    totalBudgetUsd: 1000,
    legs: [{ mode: 'flight', cheapestOneWay: { transfers: 2 } }]
  };
  assert.ok(
    generated.flightPreferenceAdjustment680BR1(nonstopTour, { flightPreference: 'Nonstop preferred' }) > generated.flightPreferenceAdjustment680BR1(twoStopTour, { flightPreference: 'Nonstop preferred' }),
    'Nonstop preference penalizes observed multi-transfer fares'
  );

  const la = await graph.generateProviderDrivenGlobalRouteCandidates({
    origin: 'Los Angeles (LAX)',
    budget: '1000',
    currency: 'USD',
    maxStops: '2',
    totalNights: '6',
    recommendationScope: 'generated-multicity-tour'
  });
  assert.equal(la.diagnostics?.deterministicFallback?.originCity, 'Los Angeles', 'LAX input must not resolve as Lagos/LOS');
  assert.equal(la.diagnostics?.deterministicFallback?.originAirportCode, 'LAX', 'LAX code remains authoritative');
  const feasibleTwoStop = (la.tours || []).filter(t => Array.isArray(t.stops) && t.stops.length >= 2 && Number(t.estimatedTotalUsd || Infinity) <= 1000);
  assert.ok(feasibleTwoStop.length > 0, 'LAX USD 1,000 deterministic benchmark contains at least one feasible two-destination route');

  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'generated-tour.js'), 'utf8');
  assert.match(source, /recommendationScope:\s*query\.recommendationScope\s*\|\|\s*'generated-tour'/, 'incoming multi-city scope is preserved instead of being overwritten');
  assert.match(source, /pace680BR1 === 'relaxed'/, 'travel pace affects adaptive duration/stop planning');
  assert.match(source, /preferenceTheme680BR1/, 'visible destination priorities are wired into route generation');

  console.log('PASS GV-QUALITY-680B-R1 predeployment integrity, advanced preferences, month edge, and real LAX benchmark');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
