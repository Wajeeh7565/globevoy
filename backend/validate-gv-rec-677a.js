'use strict';
process.env.ENABLE_SMART_DURATION_FLIGHT_SELECTION_677A = 'true';
process.env.ENABLE_ROUTE_FEASIBILITY_GUARD_664A = 'true';

const fs = require('fs');
const path = require('path');
const generated = require('./generated-tour');
const cheapFlights = require('./services/cheap-one-way-flights');

const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: Boolean(passed), details });
  console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  if (!passed) process.exitCode = 1;
}

function baseTour(overrides = {}) {
  return {
    totalBudgetUsd: 1000,
    usableTripBudgetUsd: 900,
    totalTransportEstimateUsd: 250,
    totalHotelEstimateUsd: 360,
    totalNights: 6,
    stops: [
      { city: 'Cairo', nights: 3, recommendedMinNights: 4, recommendedMaxNights: 7, hotel: { estimatedNightlyUsd: 60, estimatedStayUsd: 180 } },
      { city: 'Antalya', nights: 3, recommendedMinNights: 4, recommendedMaxNights: 7, hotel: { estimatedNightlyUsd: 60, estimatedStayUsd: 180 } }
    ],
    legs: [
      { mode: 'flight', distanceKm: 2400, durationMinutes: 240, transfers: 0 },
      { mode: 'flight', distanceKm: 1200, durationMinutes: 150, transfers: 0 },
      { mode: 'flight', distanceKm: 3000, durationMinutes: 300, transfers: 0 }
    ],
    ...overrides
  };
}

const baseDecision = { version: 'GV-UX-674A', mode: 'adaptive', nights: 6 };
check('677A generated-tour version is packaged', ['2.9.0-gv-rec-677a-smart-duration-flight-selection','2.10.0-gv-rec-677b-smart-flight-date-selection','2.10.1-gv-rec-677b-r1-itinerary-date-integrity','2.10.2-gv-rec-677b-r2-flight-quality-guardrails','2.10.3-gv-rec-677b-r3-route-relative-flight-quality','2.11.0-gv-rec-677c-whole-trip-route-optimization','2.12.0-gv-rec-677d-destination-value-proximity'].includes(generated.GENERATED_TOUR_VERSION), generated.GENERATED_TOUR_VERSION);
check('677A smart duration version is exported', generated.SMART_DURATION_VERSION_677A === 'GV-REC-677A', generated.SMART_DURATION_VERSION_677A);
check('677A feature flag is enabled for validation', generated._internal.smartDurationFlightSelection677AEnabled() === true);

const cairoAntalya = generated._internal.resolveSmartDuration677A(baseTour(), { budget: 1000, currency: 'USD', passengers: 1, adults: 1 }, baseDecision);
check('Cairo + Antalya is expanded beyond six rushed nights', cairoAntalya.nights >= 8 && cairoAntalya.routeMinimumNights === 8, cairoAntalya);
check('smart duration records route travel burden', cairoAntalya.estimatedTravelHours > 0 && cairoAntalya.stopNightBounds.length === 2, { travel: cairoAntalya.estimatedTravelHours, bounds: cairoAntalya.stopNightBounds });

const longHaulTour = baseTour({
  totalBudgetUsd: 2600,
  usableTripBudgetUsd: 2340,
  totalTransportEstimateUsd: 900,
  totalHotelEstimateUsd: 720,
  totalNights: 8,
  stops: [
    { city: 'Tokyo', nights: 4, recommendedMinNights: 5, recommendedMaxNights: 9, hotel: { estimatedNightlyUsd: 90, estimatedStayUsd: 360 } },
    { city: 'Seoul', nights: 4, recommendedMinNights: 4, recommendedMaxNights: 7, hotel: { estimatedNightlyUsd: 90, estimatedStayUsd: 360 } }
  ],
  legs: [
    { mode: 'flight', distanceKm: 10300, durationMinutes: 840, transfers: 1 },
    { mode: 'flight', distanceKm: 1150, durationMinutes: 150, transfers: 0 },
    { mode: 'flight', distanceKm: 10600, durationMinutes: 860, transfers: 1 }
  ]
});
const longHaul = generated._internal.resolveSmartDuration677A(longHaulTour, { budget: 2600, currency: 'USD', passengers: 1, adults: 1 }, { ...baseDecision, nights: 8 });
check('long-haul route gets recovery time beyond city minimums', longHaul.nights >= 10 && longHaul.travelRecoveryNights >= 1, longHaul);

const shortRegional = generated._internal.resolveSmartDuration677A(baseTour({
  budgetAdaptivePolicy: { shortRegionalNightOverride: true },
  totalBudgetUsd: 900,
  usableTripBudgetUsd: 810,
  totalTransportEstimateUsd: 120,
  totalHotelEstimateUsd: 360,
  stops: [
    { city: 'Nearby A', nights: 3, recommendedMinNights: 4, recommendedMaxNights: 7, appliedNightMinimum: 2, appliedNightMaximum: 3, hotel: { estimatedNightlyUsd: 60 } },
    { city: 'Nearby B', nights: 3, recommendedMinNights: 4, recommendedMaxNights: 7, appliedNightMinimum: 2, appliedNightMaximum: 3, hotel: { estimatedNightlyUsd: 60 } }
  ],
  legs: [
    { mode: 'ground', distanceKm: 220, durationMinutes: 180 },
    { mode: 'ground', distanceKm: 180, durationMinutes: 150 },
    { mode: 'ground', distanceKm: 250, durationMinutes: 190 }
  ]
}), { budget: 900, currency: 'USD', passengers: 1, adults: 1 }, baseDecision);
check('short regional override can stay compact', shortRegional.nights === 6 && shortRegional.routeMinimumNights === 4, shortRegional);

const affordabilityRisk = generated._internal.resolveSmartDuration677A(baseTour({ totalBudgetUsd: 650, usableTripBudgetUsd: 585, totalTransportEstimateUsd: 420, totalHotelEstimateUsd: 420 }), { budget: 650, currency: 'USD', passengers: 1, adults: 1 }, baseDecision);
check('unaffordable rushed route is flagged instead of compressed below city minimums', affordabilityRisk.affordabilityRisk === true && affordabilityRisk.nights >= affordabilityRisk.routeMinimumNights, affordabilityRisk);

const exact = generated._internal.resolveAdaptiveDuration674A({ budget: 1500, currency: 'USD', dateMode: 'exact', tripLength: 'auto', nights: 7, adaptiveDuration: 'true' });
check('explicit exact-date duration remains protected', exact.mode === 'exact-dates' && exact.nights === 7, exact);

const observations = [
  { departureDate: '2026-10-01', price: 100, durationMinutes: 600, transfers: 2, timingQuality: 4 },
  { departureDate: '2026-10-02', price: 115, durationMinutes: 420, transfers: 0, timingQuality: 0 },
  { departureDate: '2026-10-03', price: 130, durationMinutes: 360, transfers: 0, timingQuality: 0 },
  { departureDate: '2026-10-04', price: 200, durationMinutes: 330, transfers: 0, timingQuality: 0 }
];
const smartFlight = cheapFlights.selectBestUsableObservation(observations);
check('smart flight selection can pay a small premium to remove connections and hours', smartFlight.departureDate === '2026-10-02' && smartFlight.price === 115, smartFlight);
check('smart flight selection records score and version', smartFlight.smartFlightSelectionVersion === 'GV-REC-677A' && Number.isFinite(smartFlight.smartFlightScore), smartFlight);
check('expensive option outside reasonable premium is not selected', smartFlight.price < 200, smartFlight);

const result = {
  release: 'GV-REC-677A',
  generatedAt: new Date().toISOString(),
  passed: !process.exitCode,
  checkCount: checks.length,
  passedCount: checks.filter(item => item.passed).length,
  failedCount: checks.filter(item => !item.passed).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677A_BACKEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-REC-677A backend validation failed.');
console.log(`GV-REC-677A backend validation passed (${result.passedCount}/${result.checkCount}).`);
