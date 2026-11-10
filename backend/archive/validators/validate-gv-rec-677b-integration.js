'use strict';
const fs = require('fs');
const path = require('path');
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
  ENABLE_SMART_FLIGHT_DATE_SELECTION_677B: 'true'
});
delete process.env.TRAVELPAYOUTS_TOKEN;

const generated = require('./generated-tour');
const checks = [];
function check(name, passed, details = null) {
  const item = { name, passed: Boolean(passed), details };
  checks.push(item);
  console.log(`${item.passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  if (!item.passed) process.exitCode = 1;
}

(async () => {
  const auto = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '1', passengers: '1', tripLength: 'auto', adaptiveDuration: 'true', maxStops: '2' });
  check('automatic generated tour remains supported under 677B', auto.supported === true && auto.tour, { reason: auto.reason || null });
  check('677A smart duration remains active under 677B', auto.tour?.smartDurationDecision?.version === 'GV-REC-677A' && auto.tour?.smartDurationDecision?.smartEnabled === true, auto.tour?.smartDurationDecision || null);
  check('677B flight/date diagnostics are active', auto.diagnostics?.smartFlightDateSelection?.enabled === true && auto.diagnostics?.smartFlightDateSelection?.version === 'GV-REC-677B', auto.diagnostics?.smartFlightDateSelection || null);
  check('677B exposes three-day automatic date flexibility', Number(auto.diagnostics?.smartFlightDateSelection?.maxAutomaticDateShiftDays) === 3, auto.diagnostics?.smartFlightDateSelection || null);
  check('677B explicitly does not claim route-order optimization', auto.diagnostics?.smartFlightDateSelection?.routeOrderOptimization === false, auto.diagnostics?.smartFlightDateSelection || null);
  check('smart flight selection diagnostic is superseded to 677B', auto.diagnostics?.smartFlightSelection?.enabled === true && auto.diagnostics?.smartFlightSelection?.version === 'GV-REC-677B', auto.diagnostics?.smartFlightSelection || null);
  check('automatic route remains synchronized', auto.tour?.itineraryDatePlan?.consistent === true, auto.tour?.itineraryDatePlan || null);
  check('R1 transport-mode integrity remains active', auto.diagnostics?.transportModeIntegrity?.enabled === true && auto.diagnostics?.transportModeIntegrity?.version === 'GV-REC-677A-R1', auto.diagnostics?.transportModeIntegrity || null);

  const fixed = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '1', passengers: '1', tripLength: '7', nights: '7', totalNights: '7', adaptiveDuration: 'false', maxStops: '2' });
  check('user-selected seven-night route remains supported', fixed.supported === true && fixed.tour, { reason: fixed.reason || null });
  check('user-selected duration remains exactly seven nights', Number(fixed.tour?.totalNights) === 7, fixed.tour?.totalNights);
  check('677B does not reactivate smart duration for explicit duration', fixed.tour?.smartDurationDecision == null && fixed.tour?.adaptiveDurationDecision?.mode === 'user-selected', fixed.tour?.adaptiveDurationDecision || null);
  check('fixed route remains synchronized', fixed.tour?.itineraryDatePlan?.consistent === true, fixed.tour?.itineraryDatePlan || null);

  const exact = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2500', currency: 'CAD', adults: '1', passengers: '1', dateMode: 'exact', departureDate: '2026-10-10', returnDate: '2026-10-17', tripLength: '7', nights: '7', totalNights: '7', maxStops: '2' });
  check('exact-date route remains supported', exact.supported === true && exact.tour, { reason: exact.reason || null });
  const firstLeg = Array.isArray(exact.tour?.backendLegs) ? exact.tour.backendLegs[0] : exact.tour?.legs?.[0];
  check('exact departure date remains unchanged under 677B', String(firstLeg?.departureDate || firstLeg?.automaticTourDate?.departureDate || '').slice(0,10) === '2026-10-10', { departureDate: firstLeg?.departureDate, automaticTourDate: firstLeg?.automaticTourDate });

  const result = { release: 'GV-REC-677B', generatedAt: new Date().toISOString(), passed: !process.exitCode, checkCount: checks.length, passedCount: checks.filter(x => x.passed).length, failedCount: checks.filter(x => !x.passed).length, checks };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677B_INTEGRATION.json'), JSON.stringify(result, null, 2) + '\n');
  if (process.exitCode) throw new Error('GV-REC-677B integration validation failed.');
  console.log(`GV-REC-677B integration validation passed (${result.passedCount}/${result.checkCount}).`);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
