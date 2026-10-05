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
  ENABLE_SMART_DURATION_FLIGHT_SELECTION_677A: 'true'
});
delete process.env.TRAVELPAYOUTS_TOKEN;
const generated = require('./generated-tour');
const checks = [];
function check(name, passed, details = null) { checks.push({ name, passed: Boolean(passed), details }); console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`); if (!passed) process.exitCode = 1; }
(async () => {
  const auto = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '1', passengers: '1', tripLength: 'auto', adaptiveDuration: 'true', maxStops: '2' });
  check('automatic generated tour remains supported', auto.supported === true && auto.tour, { reason: auto.reason || null });
  check('automatic route uses 677A smart duration', auto.tour?.smartDurationDecision?.version === 'GV-REC-677A' && auto.tour?.smartDurationDecision?.smartEnabled === true, auto.tour?.smartDurationDecision || null);
  check('smart duration is reflected in visible tour nights', Number(auto.tour?.totalNights) === Number(auto.tour?.smartDurationDecision?.nights), { totalNights: auto.tour?.totalNights, decision: auto.tour?.smartDurationDecision?.nights });
  check('smart flight-selection policy is active in generated-tour diagnostics', auto.diagnostics?.smartFlightSelection?.enabled === true && auto.diagnostics?.smartFlightSelection?.version === 'GV-REC-677A', auto.diagnostics?.smartFlightSelection || null);
  check('automatic route date plan remains synchronized', auto.tour?.itineraryDatePlan?.consistent === true, auto.tour?.itineraryDatePlan || null);
  check('city activation remains verified on generated route', Array.isArray(auto.tour?.cities) && auto.tour.cities.length > 0, auto.tour?.cities?.map(c => c.city));

  const fixed = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '1', passengers: '1', tripLength: '7', nights: '7', totalNights: '7', adaptiveDuration: 'false', maxStops: '2' });
  check('user-selected seven-night route remains supported', fixed.supported === true && fixed.tour, { reason: fixed.reason || null });
  check('user-selected duration remains exactly seven nights', Number(fixed.tour?.totalNights) === 7, fixed.tour?.totalNights);
  check('smart duration does not override user-selected duration', fixed.tour?.smartDurationDecision == null && fixed.tour?.adaptiveDurationDecision?.mode === 'user-selected', fixed.tour?.adaptiveDurationDecision || null);
  check('fixed route date plan remains synchronized', fixed.tour?.itineraryDatePlan?.consistent === true, fixed.tour?.itineraryDatePlan || null);

  const result = { release: 'GV-REC-677A', generatedAt: new Date().toISOString(), passed: !process.exitCode, checkCount: checks.length, passedCount: checks.filter(x => x.passed).length, failedCount: checks.filter(x => !x.passed).length, checks };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677A_INTEGRATION.json'), JSON.stringify(result, null, 2) + '\n');
  if (process.exitCode) throw new Error('GV-REC-677A integration validation failed.');
  console.log(`GV-REC-677A integration validation passed (${result.passedCount}/${result.checkCount}).`);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
