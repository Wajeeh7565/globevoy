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
  ENABLE_TRANSPORT_MODE_INTEGRITY_677A_R1: 'true'
});
delete process.env.TRAVELPAYOUTS_TOKEN;
const generated = require('./generated-tour');
const checks = [];
function check(name, passed, details = null) { checks.push({ name, passed: Boolean(passed), details }); console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`); if (!passed) process.exitCode = 1; }
function unsafeGroundLeg(leg = {}) {
  if (!generated._internal.pureGroundLeg677AR1(leg)) return false;
  const distance = Number(leg.distanceKm || 0);
  const fromCountry = String(leg?.from?.countryCode || '').toUpperCase();
  const toCountry = String(leg?.to?.countryCode || '').toUpperCase();
  return distance > 900 || (fromCountry && toCountry && fromCountry !== toCountry && distance > 700);
}
(async () => {
  const benchmark = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '4000', currency: 'CAD', adults: '1', passengers: '1', tripLength: 'auto', adaptiveDuration: 'true', maxStops: '3' });
  check('high-budget smart-duration benchmark remains supported', benchmark.supported === true && benchmark.tour, { route: benchmark.tour?.cities?.map(c => c.city), nights: benchmark.tour?.totalNights });
  const benchmarkLegs = benchmark.tour?.backendLegs || benchmark.tour?.legs || [];
  check('returned benchmark contains no geographically impossible pure-ground leg', benchmarkLegs.every(leg => !unsafeGroundLeg(leg)), benchmarkLegs.map(leg => ({ from: leg?.from?.city, to: leg?.to?.city, mode: leg?.mode, transportType: leg?.transportType, distanceKm: leg?.distanceKm })));
  check('R1 transport integrity diagnostics are active', benchmark.diagnostics?.transportModeIntegrity?.enabled === true && benchmark.diagnostics?.transportModeIntegrity?.version === 'GV-REC-677A-R1', benchmark.diagnostics?.transportModeIntegrity || null);
  check('677A smart duration remains active under R1', benchmark.tour?.smartDurationDecision?.version === 'GV-REC-677A', benchmark.tour?.smartDurationDecision || null);
  check('benchmark itinerary date plan remains synchronized', benchmark.tour?.itineraryDatePlan?.consistent === true, benchmark.tour?.itineraryDatePlan || null);

  const fixed = await generated.getGeneratedTour({ origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', adults: '1', passengers: '1', tripLength: '7', nights: '7', totalNights: '7', adaptiveDuration: 'false', maxStops: '2' });
  check('user-selected duration still remains exactly seven nights', fixed.supported === true && Number(fixed.tour?.totalNights) === 7, fixed.tour?.totalNights);
  check('R1 does not introduce unsafe ground legs into fixed-duration route', (fixed.tour?.backendLegs || fixed.tour?.legs || []).every(leg => !unsafeGroundLeg(leg)));

  const compositeTour = {
    origin: { city: 'Ground-access city', countryCode: 'IT', code: 'AAA', airportCode: 'AAA' },
    legs: [{
      from: { city: 'Ground-access city', countryCode: 'IT', code: 'AAA', airportCode: 'AAA' },
      to: { city: 'Flight destination', countryCode: 'FR', code: 'BBB', airportCode: 'BBB' },
      mode: 'composite',
      transportType: 'bus-or-shuttle+flight',
      distanceKm: 900,
      estimatedTransportUsd: 100,
      estimatedFlightUsd: 100,
      segments: [
        { mode: 'ground-transfer', transportType: 'bus-or-shuttle', distanceKm: 40 },
        { mode: 'flight', transportType: 'flight', distanceKm: 860 }
      ]
    }],
    stops: [{ city: 'Flight destination', countryCode: 'FR', code: 'BBB', airportCode: 'BBB', nights: 3, hotel: { estimatedStayUsd: 240 } }],
    totalBudgetUsd: 1500,
    reservePercent: 0.10,
    reserveAmountUsd: 150,
    usableTripBudgetUsd: 1350
  };
  const compositeEnrichment = await generated.enrichTourWithCheapFlights(compositeTour, { adults: '2', passengers: '2', currency: 'USD', tripLength: 'auto' });
  const compositeLeg = compositeEnrichment.tour?.legs?.[0] || {};
  const scanRow = compositeEnrichment.summary?.scanned?.[0] || compositeEnrichment.summary?.legs?.[0] || {};
  check('flight-bearing composite leg is scanned as a flight rather than skipped as ground', scanRow.reason !== 'ground-leg-not-scanned' && compositeLeg.dateSource !== 'automatic-ground-leg-after-previous-stay', { scanRow, dateSource: compositeLeg.dateSource, transportModeIntegrity: compositeLeg.transportModeIntegrity });
  check('flight-bearing composite leg keeps flight passenger-pricing semantics after enrichment', compositeLeg.pricingIntegrity?.unitBasis === 'per-passenger-flight-fare' && Number(compositeLeg.estimatedFlightUsd) > 0, { pricingIntegrity: compositeLeg.pricingIntegrity, estimatedFlightUsd: compositeLeg.estimatedFlightUsd });


  const result = { release: 'GV-REC-677A-R1', generatedAt: new Date().toISOString(), passed: !process.exitCode, checkCount: checks.length, passedCount: checks.filter(x => x.passed).length, failedCount: checks.filter(x => !x.passed).length, checks };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677A_R1_INTEGRATION.json'), JSON.stringify(result, null, 2) + '\n');
  if (process.exitCode) throw new Error('GV-REC-677A-R1 integration validation failed.');
  console.log(`GV-REC-677A-R1 integration validation passed (${result.passedCount}/${result.checkCount}).`);
})().catch(error => { console.error(error.stack || error); process.exit(1); });
