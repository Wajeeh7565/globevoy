'use strict';
Object.assign(process.env, {
  ENABLE_SMART_DURATION_FLIGHT_SELECTION_677A: 'true',
  ENABLE_TRANSPORT_MODE_INTEGRITY_677A_R1: 'true',
  ENABLE_SMART_FLIGHT_DATE_SELECTION_677B: 'true',
  ENABLE_ITINERARY_DATE_INTEGRITY_677B_R1: 'true',
  ENABLE_ROUTE_FEASIBILITY_GUARD_664A: 'true'
});

const generated = require('./generated-tour');
const cheapFlights = require('./services/providers/flights/cheap-one-way-flights');
const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: Boolean(passed), details });
  console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  if (!passed) process.exitCode = 1;
}

check('R1 generated-tour version is packaged', ['2.10.1-gv-rec-677b-r1-itinerary-date-integrity','2.10.2-gv-rec-677b-r2-flight-quality-guardrails','2.10.3-gv-rec-677b-r3-route-relative-flight-quality','2.11.0-gv-rec-677c-whole-trip-route-optimization','2.12.0-gv-rec-677d-destination-value-proximity'].includes(generated.GENERATED_TOUR_VERSION), generated.GENERATED_TOUR_VERSION);
check('R1 integrity version is packaged', generated.SMART_FLIGHT_DATE_INTEGRITY_VERSION_677B_R1 === 'GV-REC-677B-R1', generated.SMART_FLIGHT_DATE_INTEGRITY_VERSION_677B_R1);
check('R1 flag is enabled', generated._internal.smartFlightDateIntegrity677BR1Enabled() === true);
check('first departure keeps the 677B three-day window', generated._internal.automaticLegWindowDays({}, 0) === 3, generated._internal.automaticLegWindowDays({}, 0));
check('downstream leg date shift is disabled', generated._internal.automaticLegWindowDays({}, 1) === 0, generated._internal.automaticLegWindowDays({}, 1));
check('return leg date shift is disabled', generated._internal.automaticLegWindowDays({}, 3) === 0, generated._internal.automaticLegWindowDays({}, 3));

const rows = { observations: [
  { departureDate: '2026-10-01', price: 180, durationMinutes: 480, transfers: 1 },
  { departureDate: '2026-10-02', price: 135, durationMinutes: 470, transfers: 1 }
]};
const firstWindow = generated._internal.filterObservationsWithinDateWindow(rows, '2026-10-01', {}, 0);
const laterWindow = generated._internal.filterObservationsWithinDateWindow(rows, '2026-10-01', {}, 1);
check('first leg may consider next-day value', firstWindow.length === 2, firstWindow.map(r => r.departureDate));
check('later leg considers only canonical date', laterWindow.length === 1 && laterWindow[0].departureDate === '2026-10-01', laterWindow.map(r => r.departureDate));

const firstChoice = cheapFlights.selectBestUsableObservation(firstWindow, { targetDate: '2026-10-01', maxDateShiftDays: generated._internal.automaticLegWindowDays({},0), budgetPressure: 0.8 });
const laterChoice = cheapFlights.selectBestUsableObservation(laterWindow, { targetDate: '2026-10-01', maxDateShiftDays: generated._internal.automaticLegWindowDays({},1), budgetPressure: 0.8 });
check('first leg can still use smart date value', firstChoice && ['2026-10-01','2026-10-02'].includes(firstChoice.departureDate), firstChoice);
check('downstream smart choice cannot move date', laterChoice && laterChoice.departureDate === '2026-10-01' && Number(laterChoice.dateShiftDays || 0) === 0, laterChoice);

const unsafe = generated._internal.itineraryDateConsistency(
  [{ nights: 3, arrivalDate: '2026-10-01', departureDate: '2026-10-04' }],
  [{ departureDate: '2026-10-01' }, { departureDate: '2026-10-05' }]
);
const safe = generated._internal.itineraryDateConsistency(
  [{ nights: 3, arrivalDate: '2026-10-01', departureDate: '2026-10-04' }],
  [{ departureDate: '2026-10-01' }, { departureDate: '2026-10-04' }]
);
check('regression fixture proves independent downstream shift causes mismatch', unsafe.consistent === false && unsafe.issues.some(x => x.code === 'next-leg-mismatch'), unsafe);
check('canonical downstream date remains consistent', safe.consistent === true, safe);

if (process.exitCode) throw new Error('GV-REC-677B-R1 validation failed.');
console.log(`GV-REC-677B-R1 validation passed (${checks.filter(x=>x.passed).length}/${checks.length}).`);
