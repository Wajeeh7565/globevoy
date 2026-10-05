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
  ENABLE_WHOLE_TRIP_ROUTE_OPTIMIZATION_677C: 'true',
  ENABLE_DESTINATION_VALUE_PROXIMITY_677D: 'true'
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

async function scenario(query, label) {
  const response = await generated.getGeneratedTour(query);
  check(`${label} generated tour returned`, response.supported === true && !!response.tour, response.reason || null);
  if (!response.tour) return response;
  check(`${label} returns 677D version`, response.version === '2.12.0-gv-rec-677d-destination-value-proximity', response.version);
  check(`${label} 677D diagnostics active`, response.diagnostics?.destinationValueProximity?.enabled === true && response.diagnostics?.destinationValueProximity?.version === 'GV-REC-677D', response.diagnostics?.destinationValueProximity || null);
  check(`${label} whole-trip 677C preserved`, response.diagnostics?.wholeTripRouteOptimization?.enabled === true && response.diagnostics?.wholeTripRouteOptimization?.version === 'GV-REC-677C', response.diagnostics?.wholeTripRouteOptimization || null);
  check(`${label} R3 flight-quality guardrails preserved`, response.diagnostics?.smartFlightQualityGuardrails?.version === 'GV-REC-677B-R3', response.diagnostics?.smartFlightQualityGuardrails || null);
  check(`${label} itinerary date plan consistent`, response.tour?.itineraryDatePlan?.consistent === true, response.tour?.itineraryDatePlan || null);
  return response;
}

(async () => {
  const toronto = await scenario({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '1', passengers: '1', tripLength: 'auto', adaptiveDuration: 'true', maxStops: '2' }, 'Toronto C$2,000');
  if (toronto.tour) {
    const q = toronto.diagnostics?.destinationValueProximity?.selectedTourQuality;
    check('Toronto C$2,000 avoids origin-adjacent wasted overnight stop', Number(q?.metrics?.originAdjacentStops || 0) === 0, q || null);
  }

  const dubai = await scenario({ origin: 'Dubai (DXB)', budget: '1000', currency: 'USD', adults: '1', passengers: '1', tripLength: 'auto', adaptiveDuration: 'true', maxStops: '2' }, 'Dubai US$1,000');
  if (dubai.tour) {
    const q = dubai.diagnostics?.destinationValueProximity?.selectedTourQuality;
    check('Dubai US$1,000 does not spend an overnight stop on a metro-adjacent origin city when stronger candidates exist', Number(q?.metrics?.originAdjacentStops || 0) === 0, { route: dubai.tour.stops?.map(x => x.city), quality: q || null });
    check('Dubai selected destination-value band is not weak', !['weak-destination-value', 'low-destination-value'].includes(String(q?.qualityBand || '')), q || null);
  }

  const high = await scenario({ origin: 'Toronto (YYZ)', budget: '4000', currency: 'CAD', adults: '1', passengers: '1', tripLength: 'auto', adaptiveDuration: 'true', maxStops: '3' }, 'Toronto C$4,000');
  if (high.tour) {
    const q = high.diagnostics?.destinationValueProximity?.selectedTourQuality;
    check('higher-budget route preserves useful destination count', high.tour.stops.length >= 2 && high.tour.stops.length <= 3, high.tour.stops.map(x => x.city));
    check('higher-budget route avoids origin-adjacent wasted stop', Number(q?.metrics?.originAdjacentStops || 0) === 0, q || null);
  }

  const fixed = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '1', passengers: '1', tripLength: '7', nights: '7', totalNights: '7', adaptiveDuration: 'false', maxStops: '2' });
  check('677D preserves explicit seven-night duration', fixed.supported === true && Number(fixed.tour?.totalNights) === 7, fixed.tour?.totalNights || fixed.reason || null);

  const exact = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2500', currency: 'CAD', adults: '1', passengers: '1', dateMode: 'exact', departureDate: '2026-10-10', returnDate: '2026-10-17', tripLength: '7', nights: '7', totalNights: '7', maxStops: '2' });
  const exactLegs = exact.tour?.backendLegs || exact.tour?.legs || [];
  const firstDate = exactLegs[0]?.departureDate || exactLegs[0]?.automaticTourDate?.departureDate || '';
  check('677D preserves exact departure date', exact.supported === true && String(firstDate).startsWith('2026-10-10') && Number(exact.tour?.totalNights) === 7, { firstDate, nights: exact.tour?.totalNights, reason: exact.reason || null });

  const result = {
    release: 'GV-REC-677D',
    generatedAt: new Date().toISOString(),
    passed: !process.exitCode,
    checkCount: checks.length,
    passedCount: checks.filter(x => x.passed).length,
    failedCount: checks.filter(x => !x.passed).length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677D_INTEGRATION.json'), JSON.stringify(result, null, 2) + '\n');
  if (process.exitCode) throw new Error('GV-REC-677D integration validation failed.');
  console.log(`GV-REC-677D integration validation passed (${result.passedCount}/${result.checkCount}).`);
})().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
