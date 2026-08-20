'use strict';

Object.assign(process.env, {
  ENABLE_GENERATED_TOUR_651A: 'true',
  ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B: 'true',
  ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B: 'true',
  ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A: 'true',
  ENABLE_ROUTE_FEASIBILITY_GUARD_664A: 'true',
  ENABLE_PASSENGER_ROOM_PRICING_666A: 'true',
  ENABLE_GLOBAL_ROUTE_GRAPH_665B: 'true',
  ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B: 'false',
  ENABLE_CANONICAL_ITINERARY_DATE_SYNC_666B: 'true',
  ENABLE_UNIFIED_CITY_REGISTRY_668A: 'true',
  ENABLE_PROVIDER_MAPPING_COMPLETION_668B: 'true',
  ENABLE_VERIFIED_CITY_ACTIVATION_668T: 'true',
  ENABLE_MVP_VALIDATION_REPAIRS_669B: 'true',
  ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C: 'true',
  ENABLE_EXACT_DATE_FAMILY_OCCUPANCY_669D: 'true',
  ENABLE_STAKEHOLDER_READINESS_669E: 'true',
  ENABLE_ORIGIN_DISPLAY_INTEGRITY_669F: 'true',
  ENABLE_STABLE_ROUTE_CONTROLS_667C: 'true',
  ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D: 'true',
  ENABLE_SMART_DURATION_FLIGHT_SELECTION_677A: 'true',
  ENABLE_TRANSPORT_MODE_INTEGRITY_677A_R1: 'true',
  ENABLE_SMART_FLIGHT_DATE_SELECTION_677B: 'true',
  ENABLE_ITINERARY_DATE_INTEGRITY_677B_R1: 'true',
  ENABLE_FLIGHT_QUALITY_GUARDRAILS_677B_R2: 'true',
  ENABLE_ROUTE_RELATIVE_FLIGHT_QUALITY_677B_R3: 'true',
  ENABLE_WHOLE_TRIP_ROUTE_OPTIMIZATION_677C: 'true'
});

const fs = require('fs');
const path = require('path');
const generated = require('./generated-tour');
const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: !!passed, details });
  if (!passed) {
    console.error('FAIL:', name, details || '');
    process.exitCode = 1;
  }
}

(async () => {
  const auto = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '1', passengers: '1', tripLength: 'auto', adaptiveDuration: 'true', maxStops: '2' });
  check('Toronto C$2,000 generated tour returned', auto.supported === true && !!auto.tour, auto.reason || null);
  check('677C version returned', ['2.11.0-gv-rec-677c-whole-trip-route-optimization','2.12.0-gv-rec-677d-destination-value-proximity'].includes(auto.version), auto.version);
  check('677C diagnostics active', auto.diagnostics?.wholeTripRouteOptimization?.enabled === true && auto.diagnostics?.wholeTripRouteOptimization?.version === 'GV-REC-677C', auto.diagnostics?.wholeTripRouteOptimization || null);
  check('route order optimization advertised as active', auto.diagnostics?.smartFlightDateSelection?.routeOrderOptimization === true, auto.diagnostics?.smartFlightDateSelection || null);
  check('677A smart duration preserved', auto.tour?.smartDurationDecision?.version === 'GV-REC-677A', auto.tour?.smartDurationDecision || null);
  check('677B-R1 date integrity preserved', auto.diagnostics?.smartFlightDateSelection?.version === 'GV-REC-677B-R1' && Number(auto.diagnostics?.smartFlightDateSelection?.downstreamLegMaxAutomaticDateShiftDays) === 0, auto.diagnostics?.smartFlightDateSelection || null);
  check('677B-R3 quality guardrails preserved', auto.diagnostics?.smartFlightQualityGuardrails?.version === 'GV-REC-677B-R3', auto.diagnostics?.smartFlightQualityGuardrails || null);
  check('transport integrity preserved', auto.diagnostics?.transportModeIntegrity?.version === 'GV-REC-677A-R1', auto.diagnostics?.transportModeIntegrity || null);
  check('Toronto C$2,000 date plan consistent', auto.tour?.itineraryDatePlan?.consistent === true, auto.tour?.itineraryDatePlan || null);

  const dubai = await generated.getGeneratedTour({ origin: 'Dubai (DXB)', budget: '1000', currency: 'USD', adults: '1', passengers: '1', tripLength: 'auto', adaptiveDuration: 'true', maxStops: '2' });
  check('Dubai US$1,000 generated tour returned', dubai.supported === true && !!dubai.tour, dubai.reason || null);
  check('Dubai route avoids mixed origin-adjacent/far redundancy when a stronger candidate exists', dubai.diagnostics?.wholeTripRouteOptimization?.selectedCandidateQuality?.metrics?.mixedOriginAdjacency !== true, { route: dubai.tour?.stops?.map(x => x.city), quality: dubai.diagnostics?.wholeTripRouteOptimization?.selectedCandidateQuality || null });
  check('Dubai route date plan consistent', dubai.tour?.itineraryDatePlan?.consistent === true, dubai.tour?.itineraryDatePlan || null);

  const high = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '4000', currency: 'CAD', adults: '1', passengers: '1', tripLength: 'auto', adaptiveDuration: 'true', maxStops: '3' });
  check('Toronto C$4,000 generated tour returned', high.supported === true && !!high.tour, high.reason || null);
  check('higher-budget route keeps 677C candidate-set optimization active', high.diagnostics?.wholeTripRouteOptimization?.candidateSetOptimization === true, high.diagnostics?.wholeTripRouteOptimization || null);
  check('higher-budget route date plan consistent', high.tour?.itineraryDatePlan?.consistent === true, high.tour?.itineraryDatePlan || null);

  const fixed = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '1', passengers: '1', tripLength: '7', nights: '7', totalNights: '7', adaptiveDuration: 'false', maxStops: '2' });
  check('explicit 7-night duration protected under 677C', fixed.supported === true && Number(fixed.tour?.totalNights) === 7, fixed.tour?.totalNights || null);
  check('explicit-duration route date plan consistent', fixed.tour?.itineraryDatePlan?.consistent === true, fixed.tour?.itineraryDatePlan || null);

  const exact = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2500', currency: 'CAD', adults: '1', passengers: '1', dateMode: 'exact', departureDate: '2026-10-10', returnDate: '2026-10-17', tripLength: '7', nights: '7', totalNights: '7', maxStops: '2' });
  const firstLeg = exact.tour?.backendLegs?.[0] || exact.tour?.legs?.[0] || null;
  const firstDate = String(firstLeg?.departureDate || firstLeg?.automaticTourDate?.departureDate || '').slice(0, 10);
  check('exact-date route returned', exact.supported === true && !!exact.tour, exact.reason || null);
  check('exact departure remains 2026-10-10', firstDate === '2026-10-10', firstDate);
  check('exact 7-night duration protected', Number(exact.tour?.totalNights) === 7, exact.tour?.totalNights || null);

  const result = {
    release: 'GV-REC-677C',
    generatedAt: new Date().toISOString(),
    passed: !process.exitCode,
    checkCount: checks.length,
    passedCount: checks.filter(x => x.passed).length,
    failedCount: checks.filter(x => !x.passed).length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677C_INTEGRATION.json'), JSON.stringify(result, null, 2) + '\n');
  if (process.exitCode) throw new Error('GV-REC-677C integration validation failed.');
  console.log(`GV-REC-677C integration validation passed (${result.passedCount}/${result.checkCount}).`);
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
