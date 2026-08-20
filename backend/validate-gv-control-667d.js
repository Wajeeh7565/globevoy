'use strict';

process.env.ENABLE_STABLE_ROUTE_CONTROLS_667C = 'true';
process.env.ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D = 'true';
process.env.ENABLE_PASSENGER_ROOM_PRICING_666A = 'true';
process.env.ENABLE_ROUTE_FEASIBILITY_GUARD_664A = 'true';
process.env.ENABLE_CANONICAL_TOTAL_EVIDENCE_INTEGRITY_667B = 'true';

const fs = require('fs');
const path = require('path');
const controls = require('./generated-tour-controls');
const feasibility = require('./services/route-feasibility');
const pricing = require('./services/traveller-pricing');
const canonical = require('./services/canonical-total-evidence');

const checks = [];
function check(name, condition, details = null) {
  checks.push({ name, passed: Boolean(condition), details });
  if (!condition) throw new Error(`Validation failed: ${name}`);
}

const { indexes, buildControlledTour, applyPreservedDateSchedule, routeControl667dEnabled } = controls._internal;
const idx = indexes();
const origin = idx.byId.get('toronto-ca');
const tulum = idx.byId.get('tulum-mx');
const caye = idx.byId.get('caye-caulker-bz');
check('667D feature is active', routeControl667dEnabled());
check('test cities exist', Boolean(origin && tulum && caye));

const normalizedTulum = feasibility.normalizeAirportIntegrity({ origin: { city: 'Toronto', country: 'Canada', code: 'YYZ' }, stops: [{ city: 'Tulum', country: 'Mexico', code: 'TQO', airportCode: 'TQO', airportCodes: ['TQO'] }], legs: [{ from: { city: 'Toronto', code: 'YYZ' }, to: { city: 'Tulum', code: 'TQO' }, mode: 'flight' }, { from: { city: 'Tulum', code: 'TQO' }, to: { city: 'Toronto', code: 'YYZ' }, mode: 'flight' }] }, { origin: 'Toronto' });
check('Tulum uses CUN as practical gateway', normalizedTulum.stops[0].airportCode === 'CUN', normalizedTulum.stops[0]);
check('Tulum keeps local airport metadata', normalizedTulum.stops[0].localAirportCode === 'TQO', normalizedTulum.stops[0]);
check('Tulum gateway transfer metadata is present', normalizedTulum.stops[0].gatewayAirport?.transferMinutes === 105 && normalizedTulum.stops[0].requiresGroundAccessTransfer === true, normalizedTulum.stops[0].gatewayAirport);

const normalizedCaye = feasibility.normalizeAirportIntegrity({ origin: { city: 'Toronto', country: 'Canada', code: 'YYZ' }, stops: [{ city: 'Caye Caulker', country: 'Belize', code: 'CUK', airportCode: 'CUK', airportCodes: ['CUK'] }], legs: [{ from: { city: 'Toronto', code: 'YYZ' }, to: { city: 'Caye Caulker', code: 'CUK' }, mode: 'flight' }, { from: { city: 'Caye Caulker', code: 'CUK' }, to: { city: 'Toronto', code: 'YYZ' }, mode: 'flight' }] }, { origin: 'Toronto' });
check('Caye Caulker uses BZE as practical gateway', normalizedCaye.stops[0].airportCode === 'BZE', normalizedCaye.stops[0]);
check('Caye Caulker gateway is not counted as a destination', normalizedCaye.stops.length === 1 && normalizedCaye.mapCoordinates.filter(x => x.type === 'stop').length === 1, normalizedCaye.mapCoordinates);

const priced = pricing.applyTravellerPricingToTour({
  origin: normalizedCaye.origin,
  stops: [{ ...normalizedCaye.stops[0], nights: 2, hotel: { estimatedNightlyUsd: 100 } }],
  legs: [
    { mode: 'flight', estimatedTransportUsd: 200, from: { code: 'YYZ' }, to: { code: 'BZE' } },
    { mode: 'flight', estimatedTransportUsd: 200, from: { code: 'BZE' }, to: { code: 'YYZ' } }
  ],
  totalBudgetUsd: 2000,
  reservePercent: 0.1
}, { adults: 2, passengers: 2, rooms: 1 });
check('destination gateway transfer is priced', priced.destinationAccessEstimateUsd === 160, priced.destinationAccesses);
check('gateway transfer is included in total transport', priced.totalTransportEstimateUsd === 960, { route: priced.routeTransportEstimateUsd, gateway: priced.destinationAccessEstimateUsd, total: priced.totalTransportEstimateUsd });

const canonicalTour = canonical.applyCanonicalIntegrity(priced, { currency: 'USD', budgetUsd: 2000, adults: 2, passengers: 2, rooms: 1 });
const accessComponent = canonicalTour.canonicalPricing.components.find(c => c.key === 'destination-access:0');
check('canonical ledger contains destination gateway transfer', Boolean(accessComponent && accessComponent.amountUsd === 160), accessComponent);
check('canonical header total includes visible gateway transfer', canonicalTour.canonicalPricing.canonicalTotalUsd === 1160, canonicalTour.canonicalPricing);

const baseDateTour = {
  origin: { city: 'Toronto' },
  stops: [{ city: 'Cancun', nights: 3 }, { city: 'Caye Caulker', nights: 2 }],
  legs: [{}, {}, {}]
};
const preserved = applyPreservedDateSchedule(baseDateTour, '2026-07-25');
check('shuffle preserves selected departure date', preserved.preserved && preserved.tour.legs[0].departureDate === '2026-07-25', preserved.tour.legs);
check('later legs remain chronological after preserved-date shuffle', preserved.tour.legs.map(l => l.departureDate).join(',') === '2026-07-25,2026-07-28,2026-07-30', preserved.tour.legs);
check('stay windows match preserved dates', preserved.tour.stops[0].arrivalDate === '2026-07-25' && preserved.tour.stops[1].departureDate === '2026-07-30', preserved.tour.stops);

const controlled = buildControlledTour([tulum, caye], origin, { origin: 'Toronto', currency: 'CAD', budget: 3000, adults: 1, passengers: 1, rooms: 1, totalNights: 5 }, { action: 'shuffle' });
check('controlled route preserves destination names while using gateways', controlled.cities.map(c => c.city).join(',') === 'Tulum,Caye Caulker', controlled.cities);
check('controlled route exposes Tulum gateway code', controlled.cities[0].gatewayAirportCode === 'CUN', controlled.cities[0]);
check('controlled route exposes Caye Caulker gateway code', controlled.cities[1].gatewayAirportCode === 'BZE', controlled.cities[1]);

const frontendPath = path.resolve(__dirname, '../gv_control_667d_frontend/scripts/multicity-visualizer-651b.js');
const frontend = fs.readFileSync(frontendPath, 'utf8');
check('frontend sends current departure date during shuffle', frontend.includes('params.currentDepartureDate=currentDeparture'));
check('frontend requests date preservation', frontend.includes("params.preserveDates='true'"));
check('frontend renders gateway transfer row', frontend.includes('Gateway transfer · estimate'));
check('frontend adds gateway transfer to visible card total', frontend.includes('transportAmount+hotelAmount+destinationAccessAmount'));

const output = {
  version: controls.CONTROL_VERSION,
  task: 'GV-CONTROL-667D',
  passed: checks.filter(c => c.passed).length,
  total: checks.length,
  checks,
  samplePreservedDates: preserved.tour.legs.map(l => l.departureDate),
  sampleGateways: {
    Tulum: normalizedTulum.stops[0].gatewayAirport,
    CayeCaulker: normalizedCaye.stops[0].gatewayAirport
  }
};
fs.writeFileSync(path.resolve(__dirname, 'VALIDATION_GV_CONTROL_667D.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
