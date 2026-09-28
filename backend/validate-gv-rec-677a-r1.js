'use strict';
Object.assign(process.env, {
  ENABLE_SMART_DURATION_FLIGHT_SELECTION_677A: 'true',
  ENABLE_TRANSPORT_MODE_INTEGRITY_677A_R1: 'true',
  ENABLE_BUDGET_ADAPTIVE_ROUTES_620A: 'true',
  ENABLE_ROUTE_AMBITION_RANKING_659A: 'true',
  ENABLE_STAKEHOLDER_READINESS_669E: 'true'
});

const fs = require('fs');
const path = require('path');
const generated = require('./generated-tour');
const adaptive = require('./budget-adaptive-routes');
const travellerPricing = require('./services/domain/pricing/traveller-pricing');
const canonicalEvidence = require('./services/domain/pricing/canonical-total-evidence');
const feasibility = require('./services/domain/routing/route-feasibility');
const partnerLinks = require('./services/partner-links');

const checks = [];
function check(name, passed, details = null) {
  const item = { name, passed: Boolean(passed), details };
  checks.push(item);
  console.log(`${item.passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  if (!item.passed) process.exitCode = 1;
}

check('R1 transport integrity version is packaged', generated.TRANSPORT_MODE_INTEGRITY_VERSION_677A_R1 === 'GV-REC-677A-R1', generated.TRANSPORT_MODE_INTEGRITY_VERSION_677A_R1);
check('R1 transport integrity feature flag is enabled', generated._internal.transportModeIntegrity677AR1Enabled() === true);

const impossibleGround = {
  from: { city: 'Cancun', country: 'Mexico', countryCode: 'MX', code: 'CUN', airportCode: 'CUN' },
  to: { city: 'New York', country: 'United States', countryCode: 'US', code: 'JFK', airportCode: 'JFK' },
  mode: 'ground',
  transportType: 'rail-or-bus',
  distanceKm: 2500,
  estimatedTransportUsd: 310,
  estimatedFlightUsd: 0,
  estimateSource: 'regional-ground-transport-planning-fallback'
};
const repaired = generated._internal.normalizeTransportModeIntegrity677AR1(impossibleGround);
check('Cancun to New York cannot remain a ground transfer', repaired.mode === 'flight' && repaired.transportType === 'flight', repaired);
check('repaired impossible ground leg keeps amount but moves it to flight estimate', Number(repaired.estimatedFlightUsd) === 310 && Number(repaired.estimatedTransportUsd) === 310, { estimatedTransportUsd: repaired.estimatedTransportUsd, estimatedFlightUsd: repaired.estimatedFlightUsd });
check('repair records auditable transport-mode integrity provenance', repaired.transportModeIntegrity?.repaired === true && repaired.estimateSource === 'transport-mode-integrity-flight-repair-677a-r1', repaired.transportModeIntegrity);

const regionalGround = {
  from: { city: 'Ottawa', country: 'Canada', countryCode: 'CA', code: 'YOW', airportCode: 'YOW' },
  to: { city: 'Montreal', country: 'Canada', countryCode: 'CA', code: 'YUL', airportCode: 'YUL' },
  mode: 'ground',
  transportType: 'rail-or-bus',
  distanceKm: 165,
  estimatedTransportUsd: 45
};
const preservedGround = generated._internal.normalizeTransportModeIntegrity677AR1(regionalGround);
check('legitimate Ottawa to Montreal regional ground transfer is preserved', preservedGround.mode === 'ground' && generated._internal.pureGroundLeg677AR1(preservedGround) === true, preservedGround.transportModeIntegrity);

const composite = {
  from: { city: 'Ground-access city', countryCode: 'IT', code: 'AAA', airportCode: 'AAA' },
  to: { city: 'Flight destination', countryCode: 'FR', code: 'BBB', airportCode: 'BBB' },
  mode: 'composite',
  transportType: 'bus-or-shuttle+flight',
  distanceKm: 900,
  segments: [
    { mode: 'ground-transfer', transportType: 'bus-or-shuttle', distanceKm: 40 },
    { mode: 'flight', transportType: 'flight', distanceKm: 860 }
  ]
};
const compositeNormalized = generated._internal.normalizeTransportModeIntegrity677AR1(composite);
check('composite route with a flight segment is flight-bearing', generated._internal.legHasFlightComponent677AR1(compositeNormalized) === true);
check('composite route with a flight segment is not treated as pure ground', generated._internal.pureGroundLeg677AR1(compositeNormalized) === false, compositeNormalized.transportModeIntegrity);

const pricedComposite = travellerPricing.priceTransportLeg({ ...composite, estimatedTransportUsd: 100, estimatedFlightUsd: 100 }, { adults: 2, children: 0, infants: 0 });
check('traveller pricing treats composite flight-bearing route as a flight fare', pricedComposite.pricingIntegrity?.unitBasis === 'per-passenger-flight-fare' && Number(pricedComposite.estimatedFlightUsd) === 200, { unitBasis: pricedComposite.pricingIntegrity?.unitBasis, estimatedFlightUsd: pricedComposite.estimatedFlightUsd, multiplier: pricedComposite.pricingIntegrity?.multiplier });
check('canonical pricing does not classify composite flight-bearing route as ground', canonicalEvidence._internal.isGroundLeg(composite) === false);
const compositeHours = feasibility._internal.estimateLegTravelHours(composite, 900);
check('route-feasibility travel time uses flight logic for composite flight-bearing route', compositeHours < 10, { estimatedHours: compositeHours });
const linkedComposite = partnerLinks.enrichFlightLeg({ ...composite, departureDate: '2026-09-10', estimatedTransportUsd: 100, estimatedFlightUsd: 100 }, { adults: 1, currency: 'CAD' });
check('partner links expose flight comparison behavior for composite flight-bearing route', linkedComposite.bookingStatus !== 'ground-partner-link-pending' && linkedComposite.booking?.label === 'Compare this flight', { bookingStatus: linkedComposite.bookingStatus, label: linkedComposite.booking?.label, route: linkedComposite.booking?.route });

check('missing country codes are not treated as same-country ground friendly', adaptive._internal.groundFriendlyCountries({}, {}) === false);
check('different non-European countries are not ground-friendly by default', adaptive._internal.groundFriendlyCountries({ countryCode: 'MX' }, { countryCode: 'US' }) === false);
check('nearby European countries remain eligible for ground planning', adaptive._internal.groundFriendlyCountries({ countryCode: 'AT' }, { countryCode: 'SK' }) === true);

const idx = adaptive._internal.indexes();
const cancun = idx.byId.get('cancun-mx');
const newYork = idx.byId.get('new-york-us');
const ottawa = idx.byId.get('ottawa-ca');
const montreal = idx.byId.get('montreal-ca');
check('foundation records for transport-integrity benchmark exist', Boolean(cancun && newYork && ottawa && montreal), { cancun: !!cancun, newYork: !!newYork, ottawa: !!ottawa, montreal: !!montreal });
if (cancun && newYork) {
  const selected = adaptive._internal.chooseLeg(cancun, newYork, { allowFlights: true, maxGroundLegKm: 700 }, idx);
  check('adaptive route planner selects a flight for Cancun to New York', selected?.mode === 'flight', selected);
}
if (ottawa && montreal) {
  const selected = adaptive._internal.chooseLeg(ottawa, montreal, { allowFlights: true, maxGroundLegKm: 700 }, idx);
  check('adaptive route planner still permits Ottawa to Montreal ground transport', ['ground', 'ground-transfer'].includes(selected?.mode), selected);
  const publicOttawa = adaptive._internal.publicNode(ottawa);
  check('adaptive public route nodes retain country metadata', publicOttawa.country === 'Canada' && publicOttawa.countryCode === 'CA', publicOttawa);
}

const result = {
  release: 'GV-REC-677A-R1',
  generatedAt: new Date().toISOString(),
  passed: !process.exitCode,
  checkCount: checks.length,
  passedCount: checks.filter(item => item.passed).length,
  failedCount: checks.filter(item => !item.passed).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677A_R1_BACKEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-REC-677A-R1 backend validation failed.');
console.log(`GV-REC-677A-R1 backend validation passed (${result.passedCount}/${result.checkCount}).`);
