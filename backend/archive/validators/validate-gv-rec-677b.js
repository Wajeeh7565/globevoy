'use strict';
Object.assign(process.env, {
  ENABLE_SMART_DURATION_FLIGHT_SELECTION_677A: 'true',
  ENABLE_TRANSPORT_MODE_INTEGRITY_677A_R1: 'true',
  ENABLE_SMART_FLIGHT_DATE_SELECTION_677B: 'true',
  ENABLE_ROUTE_FEASIBILITY_GUARD_664A: 'true'
});

const fs = require('fs');
const path = require('path');
const generated = require('./generated-tour');
const cheapFlights = require('./services/providers/flights/cheap-one-way-flights');

const checks = [];
function check(name, passed, details = null) {
  const item = { name, passed: Boolean(passed), details };
  checks.push(item);
  console.log(`${item.passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  if (!item.passed) process.exitCode = 1;
}

check('677B generated-tour version is packaged', ['2.10.0-gv-rec-677b-smart-flight-date-selection','2.10.1-gv-rec-677b-r1-itinerary-date-integrity','2.10.2-gv-rec-677b-r2-flight-quality-guardrails','2.10.3-gv-rec-677b-r3-route-relative-flight-quality','2.11.0-gv-rec-677c-whole-trip-route-optimization','2.12.0-gv-rec-677d-destination-value-proximity'].includes(generated.GENERATED_TOUR_VERSION), generated.GENERATED_TOUR_VERSION);
check('677B version constant is exported', generated.SMART_FLIGHT_DATE_SELECTION_VERSION_677B === 'GV-REC-677B', generated.SMART_FLIGHT_DATE_SELECTION_VERSION_677B);
check('677B feature flag is enabled', generated._internal.smartFlightDateSelection677BEnabled() === true);
check('677B defaults automatic flight/date flexibility to three days', generated._internal.automaticLegWindowDays({}) === 3, generated._internal.automaticLegWindowDays({}));
check('explicit narrower date alignment remains authoritative', generated._internal.automaticLegWindowDays({ legDateAlignmentDays: 1 }) === 1, generated._internal.automaticLegWindowDays({ legDateAlignmentDays: 1 }));

const resultWindow = {
  observations: [
    { departureDate: '2026-10-01', price: 100 },
    { departureDate: '2026-10-02', price: 105 },
    { departureDate: '2026-10-04', price: 110 },
    { departureDate: '2026-10-05', price: 90 }
  ]
};
const windowRows = generated._internal.filterObservationsWithinDateWindow(resultWindow, '2026-10-01', {});
check('677B route cadence window includes target through plus three days', windowRows.map(x => x.departureDate).join(',') === '2026-10-01,2026-10-02,2026-10-04', windowRows.map(x => x.departureDate));
check('677B route cadence excludes plus-four-day fare even when cheaper', !windowRows.some(x => x.departureDate === '2026-10-05'), windowRows.map(x => x.departureDate));

const qualityObservations = [
  { departureDate: '2026-10-01', price: 100, durationMinutes: 600, transfers: 2, timingQuality: 4, departureTime: '05:00', arrivalTime: '01:30' },
  { departureDate: '2026-10-02', price: 115, durationMinutes: 420, transfers: 0, timingQuality: 0, departureTime: '10:00', arrivalTime: '17:00' },
  { departureDate: '2026-10-03', price: 130, durationMinutes: 360, transfers: 0, timingQuality: 0, departureTime: '09:00', arrivalTime: '15:00' },
  { departureDate: '2026-10-04', price: 200, durationMinutes: 330, transfers: 0, timingQuality: 0, departureTime: '09:00', arrivalTime: '14:30' }
];
const smart = cheapFlights.selectBestUsableObservation(qualityObservations, { targetDate: '2026-10-01', maxDateShiftDays: 3, budgetPressure: 0.70 });
check('677B pays a modest premium to remove two stops and save travel time', smart.departureDate === '2026-10-02' && smart.price === 115, smart);
check('677B records date-shift and comfort tradeoff evidence', smart.smartFlightDateSelectionVersion === 'GV-REC-677B' && smart.dateShiftDays === 1 && smart.connectionsSavedVsCheapest === 2 && smart.durationMinutesSavedVsCheapest === 180, smart.smartFlightTradeoff);
check('677B does not choose the expensive comfort option outside premium ceiling', smart.price < 200, smart);
check('677B selection reason is auditable', String(smart.selectionReason || '').includes('677b'), smart.selectionReason);

const timingObservations = [
  { departureDate: '2026-11-10', price: 145, durationMinutes: 420, transfers: 0, timingQuality: 2, departureTime: '20:30', arrivalTime: '01:30' },
  { departureDate: '2026-11-10', price: 152, durationMinutes: 430, transfers: 0, timingQuality: 0, departureTime: '10:00', arrivalTime: '17:10' }
];
const timingChoice = cheapFlights.selectBestUsableObservation(timingObservations, { targetDate: '2026-11-10', maxDateShiftDays: 0, budgetPressure: 0.65 });
check('677B avoids an overnight arrival for a small fare difference', timingChoice.price === 152 && timingChoice.arrivalTime === '17:10', timingChoice);

const dateValueObservations = [
  { departureDate: '2026-12-01', price: 180, durationMinutes: 480, transfers: 1, timingQuality: 1, departureTime: '11:00', arrivalTime: '19:00' },
  { departureDate: '2026-12-02', price: 135, durationMinutes: 470, transfers: 1, timingQuality: 1, departureTime: '11:00', arrivalTime: '18:50' }
];
const dateValueChoice = cheapFlights.selectBestUsableObservation(dateValueObservations, { targetDate: '2026-12-01', maxDateShiftDays: 3, budgetPressure: 0.80 });
check('677B can shift one day when the fare saving is meaningful', dateValueChoice.departureDate === '2026-12-02' && dateValueChoice.dateShiftDays === 1, dateValueChoice);

const exact = generated._internal.resolveAdaptiveDuration674A({ budget: 1800, currency: 'CAD', dateMode: 'exact', departureDate: '2026-09-10', returnDate: '2026-09-17', nights: 7, adaptiveDuration: 'true' });
check('exact user dates remain protected from smart date movement', exact.mode === 'exact-dates' && exact.nights === 7, exact);

const result = {
  release: 'GV-REC-677B',
  generatedAt: new Date().toISOString(),
  passed: !process.exitCode,
  checkCount: checks.length,
  passedCount: checks.filter(x => x.passed).length,
  failedCount: checks.filter(x => !x.passed).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677B_BACKEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-REC-677B backend validation failed.');
console.log(`GV-REC-677B backend validation passed (${result.passedCount}/${result.checkCount}).`);
