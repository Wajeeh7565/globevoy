'use strict';

process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B = 'true';
process.env.ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C = 'true';
process.env.ENABLE_EXACT_DATE_FAMILY_OCCUPANCY_669D = 'true';
process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665B = 'true';
process.env.ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B = 'false';

const fs = require('fs');
const path = require('path');
const activation = require('./services/verified-city-activation');
const generated = require('./generated-tour');
const pricing = require('./services/domain/pricing/traveller-pricing');
const graph = require('./services/global-route-graph');

const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: passed === true, details });
  if (!passed) process.exitCode = 1;
}

const activationSummary = activation.summary();
check('668T activation remains selected', activationSummary.version === 'GV-CITY-668T', { version: activationSummary.version });
check('439-city production allowlist remains unchanged', activationSummary.summary?.productionActiveCount === 439, { active: activationSummary.summary?.productionActiveCount });
check('1,000-city audit remains complete', activationSummary.summary?.auditedCount === 1000 && activationSummary.summary?.unauditedCount === 0, activationSummary.summary);
check('669B repair flag remains enabled', generated._internal.mvpValidationRepairs669bEnabled() === true);
check('669C budget recovery flag remains enabled', generated._internal.budgetSafeRouteRecovery669cEnabled() === true);
check('669D exact-date/family flag is enabled', generated._internal.exactDateFamilyOccupancy669dEnabled() === true && pricing.familyOccupancy669dEnabled() === true);
check('generated-tour version identifies 669D', (/669[def]/i.test(generated.GENERATED_TOUR_VERSION) || /gv-rec-677[a-d]/i.test(generated.GENERATED_TOUR_VERSION)), { version: generated.GENERATED_TOUR_VERSION });

const family = pricing.normalizeParty({ adults: 2, children: 1, passengers: 3 });
check('two adults and one child require two planning rooms', family.rooms === 2, family);
check('family occupancy policy is labelled 669D', family.occupancyPolicyVersion === 'GV-PROD-669D' && family.familyOccupancyConservative === true, family);
const couple = pricing.normalizeParty({ adults: 2, children: 0, passengers: 2 });
check('two adults without children remain one room', couple.rooms === 1, couple);
const explicitRooms = pricing.normalizeParty({ adults: 2, children: 1, passengers: 3, rooms: 3 });
check('explicit larger room request remains honoured', explicitRooms.rooms === 3, explicitRooms);

const priced = pricing.applyTravellerPricingToTour({
  totalBudgetUsd: 3000,
  legs: [{ mode: 'flight', estimatedTransportUsd: 100 }],
  stops: [{ city: 'Test City', nights: 2, hotel: { estimatedNightlyUsd: 100 } }]
}, { adults: 2, children: 1, passengers: 3 });
check('family flight fare scales to three travellers', priced.legs[0].estimatedTransportUsd === 300, priced.legs[0].pricingIntegrity);
check('family stay scales to two rooms', priced.stops[0].hotel.pricingIntegrity?.roomCount === 2 && priced.stops[0].hotel.estimatedStayUsd === 400, priced.stops[0].hotel);
check('family pricing ledger exposes two rooms', priced.passengerPricing?.rooms === 2, priced.passengerPricing);

const exactQuery = {
  dateMode: 'exact',
  flexible: 'false',
  departureDate: '2026-11-05',
  returnDate: '2026-11-11',
  startDate: '2026-11-05',
  endDate: '2026-11-11'
};
const exactWindow = generated._internal.exactDateWindow669d(exactQuery);
check('exact date window is recognized', exactWindow?.departureDate === '2026-11-05' && exactWindow?.returnDate === '2026-11-11' && exactWindow?.nights === 6, exactWindow);
check('flexible request does not become exact', generated._internal.exactDateWindow669d({ dateMode: 'flexible', flexible: 'true', departureDate: '2026-11-05', returnDate: '2026-11-11' }) === null);
check('invalid reversed exact window is rejected', generated._internal.exactDateWindow669d({ dateMode: 'exact', departureDate: '2026-11-11', returnDate: '2026-11-05' }) === null);

const allocations = generated._internal.allocateExactNights669d([{ nights: 5 }, { nights: 2 }], 6);
check('exact-date night allocation matches requested duration', Array.isArray(allocations) && allocations.length === 2 && allocations.reduce((sum, value) => sum + value, 0) === 6, allocations);
check('six-night two-stop route preserves two-night minimum', allocations.every(value => value >= 2), allocations);

const syntheticTour = {
  origin: { city: 'San Diego', code: 'SAN', airportCode: 'SAN' },
  stops: [
    { cityId: 'a', city: 'A', country: 'One', code: 'AAA', airportCode: 'AAA', nights: 4 },
    { cityId: 'b', city: 'B', country: 'Two', code: 'BBB', airportCode: 'BBB', nights: 4 }
  ],
  legs: [
    { mode: 'flight', from: { code: 'SAN' }, to: { code: 'AAA' }, departureDate: '2027-04-18', liveFareVerified: true, cheapestOneWay: { departureDate: '2027-04-18', providerBacked: true } },
    { mode: 'flight', from: { code: 'AAA' }, to: { code: 'BBB' }, departureDate: '2027-04-21', liveFareVerified: true, cheapestOneWay: { departureDate: '2027-04-21', providerBacked: true } },
    { mode: 'flight', from: { code: 'BBB' }, to: { code: 'SAN' }, departureDate: '2027-04-24', liveFareVerified: true, cheapestOneWay: { departureDate: '2027-04-24', providerBacked: true } }
  ]
};
const aligned = generated._internal.applyExactDateWindow669d(syntheticTour, exactQuery);
const alignedDates = aligned.legs.map(leg => leg.departureDate);
check('exact departure date is preserved', alignedDates[0] === '2026-11-05', alignedDates);
check('exact return date is preserved', alignedDates[alignedDates.length - 1] === '2026-11-11', alignedDates);
check('intermediate dates remain chronological', alignedDates.join('|') === '2026-11-05|2026-11-08|2026-11-11', alignedDates);
check('stop windows synchronize to exact leg dates', aligned.stops[0].arrivalDate === '2026-11-05' && aligned.stops[0].departureDate === '2026-11-08' && aligned.stops[1].departureDate === '2026-11-11', aligned.stops);
check('stale provider dates are removed rather than relabelled', aligned.legs.every(leg => leg.liveFareVerified !== true && !leg.cheapestOneWay), aligned.legs);
check('exact-date metadata states provider evidence is still required', aligned.requestedExactDateWindow?.providerEvidenceStillRequiredForExactFare === true, aligned.requestedExactDateWindow);
const consistency = generated._internal.itineraryDateConsistency(aligned.stops, aligned.legs);
check('exact itinerary is internally consistent', consistency.consistent === true, consistency);

const exactObs = generated._internal.exactObservationForDate669d({ observations: [
  { departureDate: '2026-11-05', price: 500 },
  { departureDate: '2027-04-18', price: 100 }
] }, '2026-11-05');
check('exact-date selection never substitutes a cheaper later flight', exactObs?.departureDate === '2026-11-05' && exactObs?.price === 500, exactObs);
check('missing exact observation stays missing', generated._internal.exactObservationForDate669d({ observations: [{ departureDate: '2027-04-18', price: 100 }] }, '2026-11-05') === null);

const source = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
const pricingSource = fs.readFileSync(path.join(__dirname, 'services', 'traveller-pricing.js'), 'utf8');
check('exact mode filters provider observations to the target date', source.includes('exactObservationForDate669d(result, exactTargetDate)'));
check('exact dates are reapplied before final visualizer output', (source.match(/applyExactDateWindow669d\(enrichment\.tour, routeQuery\)/g) || []).length >= 2);
check('669C bounded budget recovery remains packaged', source.includes('const nextStopCap = currentStopCap - 1;') && source.includes('thresholdsRelaxed: false'));
check('family occupancy uses conservative two-guest default', pricingSource.includes('GV_MAX_GUESTS_PER_ROOM_669D') && pricingSource.includes('familyOccupancyConservative'));

const san = graph.resolveAnyOrigin('San Diego (SAN)');
check('San Diego origin remains SAN', san?.city === 'San Diego' && san?.airportCode === 'SAN', { city: san?.city, airportCode: san?.airportCode });
const lax = graph.resolveAnyOrigin('Los Angeles (LAX)');
check('Los Angeles origin remains LAX', lax?.city === 'Los Angeles' && lax?.airportCode === 'LAX', { city: lax?.city, airportCode: lax?.airportCode });
const ny = graph.resolveAnyOrigin('New York (JFK)');
check('New York origin repair remains intact', ny?.city === 'New York' && ny?.airportCode === 'JFK', { city: ny?.city, airportCode: ny?.airportCode });

const result = {
  taskId: 'GV-PROD-669D',
  version: 'GV-PROD-669D',
  generatedAt: new Date().toISOString(),
  passed: checks.every(item => item.passed),
  checkCount: checks.length,
  passedCount: checks.filter(item => item.passed).length,
  failedCount: checks.filter(item => !item.passed).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_PROD_669D.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
