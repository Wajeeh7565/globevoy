'use strict';

process.env.ENABLE_WHOLE_TRIP_ROUTE_OPTIMIZATION_677C = 'true';
process.env.ENABLE_PASSENGER_ROOM_PRICING_666A = 'true';
process.env.ENABLE_ROUTE_FEASIBILITY_GUARD_664A = 'true';

const fs = require('fs');
const path = require('path');
const generated = require('./generated-tour');
const optimizer = require('./services/domain/routing/whole-trip-route-optimizer');

const checks = [];
function check(name, passed, details = null) {
  const row = { name, passed: !!passed, details };
  checks.push(row);
  if (!row.passed) {
    console.error('FAIL:', name, details || '');
    process.exitCode = 1;
  }
}

check('677C generated-tour version packaged', ['2.11.0-gv-rec-677c-whole-trip-route-optimization','2.12.0-gv-rec-677d-destination-value-proximity'].includes(generated.GENERATED_TOUR_VERSION), generated.GENERATED_TOUR_VERSION);
check('677C version exported', generated.WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C === 'GV-REC-677C', generated.WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C);
check('677C optimizer flag active', optimizer.enabled() === true);

const origin = { city: 'Origin', country: 'United States', countryCode: 'US', airportCode: 'AAA', code: 'AAA', latitude: 0, longitude: 0 };
function stop(city, code, lat, lng) {
  return { city, country: 'United States', countryCode: 'US', airportCode: code, code, latitude: lat, longitude: lng, nights: 4, hotel: { estimatedNightlyUsd: 50, estimatedStayUsd: 200 } };
}
const A = stop('A', 'AAB', 1, 0);
const B = stop('B', 'AAC', 0, 1);
const C = stop('C', 'AAD', 5, 5);
const synthetic = {
  origin,
  stops: [C, A, B],
  legs: [],
  totalNights: 12,
  totalBudgetUsd: 3000,
  usableTripBudgetUsd: 2700,
  estimatedTotalUsd: 1200,
  totalTransportEstimateUsd: 600,
  totalHotelEstimateUsd: 600
};
const query = { budgetUsd: 3000, currency: 'USD', adults: 1, passengers: 1, totalNights: 12, nights: 12, adaptiveDuration: 'true', maxStops: 3 };
const optimized = optimizer.optimizeTourOrder(synthetic, query);
check('677C evaluates all six three-stop orders', optimized.diagnostics.evaluatedOrders === 6, optimized.diagnostics);
check('677C changes a materially inefficient order', optimized.diagnostics.changed === true, optimized.diagnostics);
check('677C reduces whole-trip planning penalty', Number(optimized.diagnostics.improvementScore) > 3, optimized.diagnostics);
check('677C selected route remains three stops', optimized.tour.stops.length === 3, optimized.tour.stops.map(x => x.city));
check('677C rebuilt route has one leg per movement including return', optimized.tour.legs.length === 4, optimized.tour.legs.length);

const locked = optimizer.optimizeTourOrder(synthetic, { ...query, savedStops: 'C,A,B' });
check('saved/manual route order is preserved', locked.diagnostics.changed === false && locked.diagnostics.skippedReason === 'explicit-or-saved-route-order-preserved', locked.diagnostics);

const twoStop = { ...synthetic, stops: [A, B], totalNights: 8 };
const twoResult = optimizer.optimizeTourOrder(twoStop, { ...query, totalNights: 8, nights: 8, maxStops: 2 });
check('equivalent two-stop cycle does not churn order without material gain', twoResult.diagnostics.changed === false, twoResult.diagnostics);

const dubai = { city: 'Dubai', country: 'United Arab Emirates', countryCode: 'AE', airportCode: 'DXB', code: 'DXB', latitude: 25.2532, longitude: 55.3657 };
const delhi = { city: 'Delhi', country: 'India', countryCode: 'IN', airportCode: 'DEL', code: 'DEL', latitude: 28.5562, longitude: 77.1, nights: 3, hotel: { estimatedStayUsd: 180 } };
const sharjah = { city: 'Sharjah', country: 'United Arab Emirates', countryCode: 'AE', airportCode: 'SHJ', code: 'SHJ', latitude: 25.3286, longitude: 55.5172, nights: 3, hotel: { estimatedStayUsd: 180 } };
const cairo = { city: 'Cairo', country: 'Egypt', countryCode: 'EG', airportCode: 'CAI', code: 'CAI', latitude: 30.1219, longitude: 31.4056, nights: 3, hotel: { estimatedStayUsd: 180 } };
const bodrum = { city: 'Bodrum', country: 'Turkey', countryCode: 'TR', airportCode: 'BJV', code: 'BJV', latitude: 37.2506, longitude: 27.6643, nights: 3, hotel: { estimatedStayUsd: 180 } };
function candidate(stops, total) {
  return { origin: dubai, stops, legs: [], totalNights: 6, totalBudgetUsd: 1000, estimatedTotalUsd: total, totalTransportEstimateUsd: total - 360, totalHotelEstimateUsd: 360 };
}
const mixed = optimizer.candidateAdjustment(candidate([delhi, sharjah], 734), { budgetUsd: 1000, currency: 'USD', totalNights: 6, nights: 6 });
const coherent = optimizer.candidateAdjustment(candidate([cairo, bodrum], 819), { budgetUsd: 1000, currency: 'USD', totalNights: 6, nights: 6 });
check('677C detects origin-adjacent stop mixed with far destination', mixed.metrics.mixedOriginAdjacency === true && mixed.reasons.includes('origin-adjacent-stop-mixed-with-far-destination'), mixed);
check('677C penalizes mixed origin-adjacent/far itinerary more strongly than coherent alternative', mixed.adjustment < coherent.adjustment, { mixed: mixed.adjustment, coherent: coherent.adjustment });

const result = {
  release: 'GV-REC-677C',
  generatedAt: new Date().toISOString(),
  passed: !process.exitCode,
  checkCount: checks.length,
  passedCount: checks.filter(x => x.passed).length,
  failedCount: checks.filter(x => !x.passed).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677C_BACKEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-REC-677C backend validation failed.');
console.log(`GV-REC-677C backend validation passed (${result.passedCount}/${result.checkCount}).`);
