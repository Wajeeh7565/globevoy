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
  ENABLE_ITINERARY_DATE_INTEGRITY_677B_R1: 'true'
});
delete process.env.TRAVELPAYOUTS_TOKEN;
const generated = require('./generated-tour');
const checks = [];
function check(name, passed, details = null) {
  console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  checks.push(Boolean(passed));
  if (!passed) process.exitCode = 1;
}
(async () => {
  const auto = await generated.getGeneratedTour({ origin:'Toronto (YYZ)', budget:'2000', currency:'CAD', adults:'1', passengers:'1', tripLength:'auto', adaptiveDuration:'true', maxStops:'2' });
  check('automatic route is returned', auto.supported === true && !!auto.tour, {reason:auto.reason || null});
  check('automatic route dates remain consistent', auto.tour?.itineraryDatePlan?.consistent === true, auto.tour?.itineraryDatePlan || null);
  check('R1 diagnostics are active', auto.diagnostics?.smartFlightDateSelection?.version === 'GV-REC-677B-R1', auto.diagnostics?.smartFlightDateSelection || null);
  check('R1 keeps first departure flexibility', Number(auto.diagnostics?.smartFlightDateSelection?.firstLegMaxAutomaticDateShiftDays) === 3, auto.diagnostics?.smartFlightDateSelection || null);
  check('R1 disables downstream independent shifts', Number(auto.diagnostics?.smartFlightDateSelection?.downstreamLegMaxAutomaticDateShiftDays) === 0 && auto.diagnostics?.smartFlightDateSelection?.independentDownstreamDateShifts === false, auto.diagnostics?.smartFlightDateSelection || null);
  check('677A smart duration remains active', auto.tour?.smartDurationDecision?.version === 'GV-REC-677A', auto.tour?.smartDurationDecision || null);
  check('R1 transport integrity remains active', auto.diagnostics?.transportModeIntegrity?.version === 'GV-REC-677A-R1', auto.diagnostics?.transportModeIntegrity || null);

  const fixed = await generated.getGeneratedTour({ origin:'Toronto (YYZ)', budget:'2000', currency:'CAD', adults:'1', passengers:'1', tripLength:'7', nights:'7', totalNights:'7', adaptiveDuration:'false', maxStops:'2' });
  check('explicit seven-night route is returned', fixed.supported === true && !!fixed.tour, {reason:fixed.reason || null});
  check('explicit seven-night duration is unchanged', Number(fixed.tour?.totalNights) === 7, fixed.tour?.totalNights);
  check('explicit route dates remain consistent', fixed.tour?.itineraryDatePlan?.consistent === true, fixed.tour?.itineraryDatePlan || null);

  const exact = await generated.getGeneratedTour({ origin:'Toronto (YYZ)', budget:'2500', currency:'CAD', adults:'1', passengers:'1', dateMode:'exact', departureDate:'2026-10-10', returnDate:'2026-10-17', tripLength:'7', nights:'7', totalNights:'7', maxStops:'2' });
  check('exact-date route is returned', exact.supported === true && !!exact.tour, {reason:exact.reason || null});
  const first = exact.tour?.backendLegs?.[0] || exact.tour?.legs?.[0];
  check('exact user departure remains unchanged', String(first?.departureDate || first?.automaticTourDate?.departureDate || '').slice(0,10) === '2026-10-10', first?.departureDate || null);

  if (process.exitCode) throw new Error('GV-REC-677B-R1 integration validation failed.');
  console.log(`GV-REC-677B-R1 integration validation passed (${checks.filter(Boolean).length}/${checks.length}).`);
})().catch(err => { console.error(err.stack || err); process.exit(1); });
