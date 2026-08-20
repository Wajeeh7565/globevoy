'use strict';

process.env.ENABLE_DESTINATION_VALUE_PROXIMITY_677D = 'true';
process.env.ENABLE_PASSENGER_ROOM_PRICING_666A = 'true';
process.env.ENABLE_ROUTE_FEASIBILITY_GUARD_664A = 'true';

const fs = require('fs');
const path = require('path');
const generated = require('./generated-tour');
const destinationValue = require('./services/destination-value-proximity');

const checks = [];
function check(name, passed, details = null) {
  const row = { name, passed: !!passed, details };
  checks.push(row);
  if (!row.passed) {
    console.error('FAIL:', name, details || '');
    process.exitCode = 1;
  }
}

check('677D generated-tour version packaged', generated.GENERATED_TOUR_VERSION === '2.12.0-gv-rec-677d-destination-value-proximity', generated.GENERATED_TOUR_VERSION);
check('677D version exported', generated.DESTINATION_VALUE_PROXIMITY_VERSION_677D === 'GV-REC-677D', generated.DESTINATION_VALUE_PROXIMITY_VERSION_677D);
check('677D flag active', destinationValue.enabled() === true);
check('677D city foundation index loaded', destinationValue._internal.foundationRecordCount >= 500, destinationValue._internal.foundationRecordCount);

const dubai = { city: 'Dubai', cityId: 'dubai-ae', country: 'United Arab Emirates', countryCode: 'AE', airportCode: 'DXB', code: 'DXB', latitude: 25.2532, longitude: 55.3657 };
const sharjah = { city: 'Sharjah', cityId: 'sharjah-ae', country: 'United Arab Emirates', countryCode: 'AE', airportCode: 'SHJ', code: 'SHJ', latitude: 25.3286, longitude: 55.5172, nights: 3, hotel: { estimatedStayUsd: 180 } };
const muscat = { city: 'Muscat', cityId: 'muscat-om', country: 'Oman', countryCode: 'OM', airportCode: 'MCT', code: 'MCT', latitude: 23.5933, longitude: 58.2844, nights: 3, hotel: { estimatedStayUsd: 180 } };
const cairo = { city: 'Cairo', cityId: 'cairo-eg', country: 'Egypt', countryCode: 'EG', airportCode: 'CAI', code: 'CAI', latitude: 30.1219, longitude: 31.4056, nights: 3, hotel: { estimatedStayUsd: 180 } };
const bodrum = { city: 'Bodrum', cityId: 'bodrum-tr', country: 'Turkey', countryCode: 'TR', airportCode: 'BJV', code: 'BJV', latitude: 37.2506, longitude: 27.6643, nights: 3, hotel: { estimatedStayUsd: 180 } };

function candidate(stops, total = 800, nights = 6) {
  return { origin: dubai, stops, legs: [], totalNights: nights, totalBudgetUsd: 1000, estimatedTotalUsd: total, totalTransportEstimateUsd: Math.max(0, total - 360), totalHotelEstimateUsd: 360 };
}

const weak = destinationValue.candidateAdjustment(candidate([sharjah, muscat], 748), { budgetUsd: 1000, currency: 'USD', totalNights: 6, nights: 6 });
const coherent = destinationValue.candidateAdjustment(candidate([cairo, bodrum], 814), { budgetUsd: 1000, currency: 'USD', totalNights: 6, nights: 6 });
const single = destinationValue.candidateAdjustment(candidate([muscat], 620, 5), { budgetUsd: 1000, currency: 'USD', totalNights: 5, nights: 5 });

check('Dubai -> Sharjah is detected as metro-adjacent', weak.metrics.originAdjacentStops === 1 && weak.metrics.stopSignals.some(x => x.city === 'Sharjah' && x.proximityClass === 'metro-adjacent'), weak.metrics.stopSignals);
check('origin-adjacent overnight stop is marked as a day-trip candidate', weak.metrics.dayTripRangeStops === 1 && weak.metrics.stopSignals.some(x => x.city === 'Sharjah' && x.dayTripCandidate === true), weak.metrics.stopSignals);
check('weak multi-stop route receives structural wasted-slot penalty', weak.reasons.includes('origin-adjacent-stop-wastes-multistop-slot') && weak.adjustment <= -250, weak);
check('coherent Cairo + Bodrum route materially outranks Sharjah + Muscat on destination value', coherent.adjustment > weak.adjustment + 250, { weak: weak.adjustment, coherent: coherent.adjustment });
check('strong single destination receives anti-forced-multistop counterweight', single.reasons.includes('strong-single-destination-not-forced-multistop') && single.adjustment > 0, single);
const weakBalanceScore = generated._internal.threePickBalanceScore670aR2(candidate([sharjah, muscat], 748), { budgetUsd: 1000, currency: 'USD' });
const singleBalanceScore = generated._internal.threePickBalanceScore670aR2(candidate([muscat], 620, 5), { budgetUsd: 1000, currency: 'USD' });
check('677D can let one stronger destination beat a forced weak two-stop route in Best balance scoring', singleBalanceScore > weakBalanceScore, { weakBalanceScore, singleBalanceScore });

const toronto = { city: 'Toronto', cityId: 'toronto-ca', country: 'Canada', countryCode: 'CA', airportCode: 'YYZ', latitude: 43.6777, longitude: -79.6248 };
const ottawa = { city: 'Ottawa', cityId: 'ottawa-ca', country: 'Canada', countryCode: 'CA', airportCode: 'YOW', latitude: 45.3225, longitude: -75.6692, nights: 2 };
const montreal = { city: 'Montreal', cityId: 'montreal-ca', country: 'Canada', countryCode: 'CA', airportCode: 'YUL', latitude: 45.4706, longitude: -73.7408, nights: 2 };
const regional = destinationValue.candidateAdjustment({ origin: toronto, stops: [ottawa, montreal], totalNights: 4, totalBudgetUsd: 730 }, { budgetUsd: 730, currency: 'USD', totalNights: 4, nights: 4 });
check('low-budget regional route is not treated as weak merely because stops are relatively close', regional.qualityBand !== 'weak-destination-value' && regional.adjustment > -120, regional);

const cancunProfile = destinationValue.profileForNode({ city: 'Cancun', cityId: 'cancun-mx', countryCode: 'MX', airportCode: 'CUN' });
check('city taxonomy lookup resolves known destination intelligence', !!cancunProfile && cancunProfile.cityIntelligence?.recommendedMinNights >= 1, cancunProfile?.cityIntelligence || null);

const annotated = destinationValue.annotateTour(candidate([cairo, bodrum], 814), { budgetUsd: 1000, currency: 'USD', totalNights: 6, nights: 6 });
check('tour annotation carries explicit 677D diagnostics without changing stop count', annotated.destinationValueIntelligence?.version === 'GV-REC-677D' && annotated.stops.length === 2, annotated.destinationValueIntelligence || null);

const result = {
  release: 'GV-REC-677D',
  generatedAt: new Date().toISOString(),
  passed: !process.exitCode,
  checkCount: checks.length,
  passedCount: checks.filter(x => x.passed).length,
  failedCount: checks.filter(x => !x.passed).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677D_BACKEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-REC-677D backend validation failed.');
console.log(`GV-REC-677D backend validation passed (${result.passedCount}/${result.checkCount}).`);
