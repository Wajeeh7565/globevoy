'use strict';

process.env.ENABLE_CANONICAL_TOTAL_EVIDENCE_INTEGRITY_667B = 'true';
process.env.ENABLE_TRANSPORT_EVIDENCE_ACTION_LABELS_667E = 'true';

const fs = require('fs');
const path = require('path');
const canonical = require('./services/domain/pricing/canonical-total-evidence');
const live = require('./services/live-provider-verification');

const checks = [];
function check(name, pass, details = null) {
  checks.push({ name, pass: Boolean(pass), details });
  if (!pass) console.error(`FAIL: ${name}`, details || '');
}

function exactStay(city, amount) {
  return {
    city,
    arrivalDate: '2026-08-01',
    departureDate: '2026-08-03',
    hotel: {
      source: 'agoda',
      estimatedStayUsd: amount,
      totalStayUsd: amount,
      providerVerification: {
        verified: true,
        exactStayDates: true,
        productionEligible: true,
        provider: 'Agoda'
      }
    }
  };
}

const regionalTour = {
  origin: { city: 'Toronto', airportCode: 'YYZ' },
  totalBudgetUsd: 1000,
  legs: [
    { mode: 'rail', operator: 'Rail or bus options', estimatedTransportUsd: 85, from: { city: 'Toronto' }, to: { city: 'Ottawa' }, departureDate: '2026-08-01' },
    { mode: 'bus', operator: 'Rail or bus options', estimatedTransportUsd: 40, from: { city: 'Ottawa' }, to: { city: 'Montreal' }, departureDate: '2026-08-03' },
    { mode: 'ground-transfer', operator: 'Rail or bus options', estimatedTransportUsd: 110, from: { city: 'Montreal' }, to: { city: 'Toronto' }, departureDate: '2026-08-05' }
  ],
  stops: [exactStay('Ottawa', 210), exactStay('Montreal', 230)]
};

const regionalLedger = canonical.buildCanonicalLedger(regionalTour, { currency: 'USD' });
check('rail, bus and ground legs are critical prices', regionalLedger.criticalTransportCount === 3, regionalLedger);
check('regional route includes transport plus stays in critical count', regionalLedger.criticalCount === 5, regionalLedger);
check('estimated ground transport prevents all-critical verification', regionalLedger.verifiedCount === 2 && regionalLedger.allCriticalVerified === false, regionalLedger);
const regionalSummary = live._internal.buildSummary({ flightResults: [], stayResults: [], pricedTour: { ...regionalTour, canonicalPricing: regionalLedger }, query: { budgetUsd: 1000 } });
check('regional route cannot claim provider-backed fit while transport is estimated', regionalSummary.budgetClaim === 'estimated-to-fit-budget', regionalSummary);

const gatewayTour = {
  origin: { city: 'Toronto', airportCode: 'YYZ' },
  totalBudgetUsd: 2000,
  legs: [
    { mode: 'flight', estimatedTransportUsd: 250, from: { city: 'Toronto', airportCode: 'YYZ' }, to: { city: 'Cancun', airportCode: 'CUN' }, departureDate: '2026-08-01', providerDateEvidence: { providerBacked: true, appliedToEstimate: true }, providerVerification: { verified: true, exactDateMatch: true, productionEligible: true } },
    { mode: 'flight', estimatedTransportUsd: 120, from: { city: 'Cancun', airportCode: 'CUN' }, to: { city: 'Belize City', airportCode: 'BZE' }, departureDate: '2026-08-04', providerDateEvidence: { providerBacked: true, appliedToEstimate: true }, providerVerification: { verified: true, exactDateMatch: true, productionEligible: true } },
    { mode: 'flight', estimatedTransportUsd: 300, from: { city: 'Belize City', airportCode: 'BZE' }, to: { city: 'Toronto', airportCode: 'YYZ' }, departureDate: '2026-08-06', providerDateEvidence: { providerBacked: true, appliedToEstimate: true }, providerVerification: { verified: true, exactDateMatch: true, productionEligible: true } }
  ],
  stops: [
    exactStay('Cancun', 300),
    { ...exactStay('Caye Caulker', 220), destinationAccessEstimateUsd: 80, destinationAccess: { gatewayCity: 'Belize City', airportCode: 'BZE', roundTripPartyUsd: 80 } }
  ]
};
const gatewayLedger = canonical.buildCanonicalLedger(gatewayTour, { currency: 'USD' });
check('gateway transfer is a critical price', gatewayLedger.components.find(item => item.kind === 'destination-access')?.evidence?.critical === true, gatewayLedger);
check('estimated gateway transfer downgrades an otherwise verified route', gatewayLedger.criticalCount === 6 && gatewayLedger.verifiedCount === 5 && gatewayLedger.allCriticalVerified === false, gatewayLedger);

const verifiedFerry = canonical.buildCanonicalLedger({
  legs: [{ mode: 'ferry', operator: 'Island Ferry', estimatedTransportUsd: 45, providerVerification: { verified: true, exactScheduleMatch: true, productionEligible: true, provider: 'Island Ferry' } }],
  stops: []
}, { currency: 'USD' });
check('production-eligible exact ferry evidence can verify a transport price', verifiedFerry.criticalCount === 1 && verifiedFerry.verifiedCount === 1 && verifiedFerry.components[0].kind === 'ferry', verifiedFerry);

const frontend = fs.readFileSync(path.join(__dirname, '..', 'gv_evidence_667e_frontend', 'scripts', 'multicity-visualizer-651b.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'gv_evidence_667e_frontend', 'multicity-visualizer.html'), 'utf8');
check('mixed and ground routes use a travel-options header label', frontend.includes("return routeHasNonFlightTransport(t)?'View travel options':'View flight options'"));
check('ferry is recognized as non-flight transport', frontend.includes("text.includes('ferry')") && frontend.includes("'View ferry options'"));
check('estimated legs do not use unverified airline names', frontend.includes('const airline=isProviderBackedLeg(leg)?airlineName') && frontend.includes("if(mode.includes('flight'))return isProviderBackedLeg(leg)?'Flight partner option':'Estimated flight option'"));
check('return cards omit irrelevant CTA when no partner URL exists', frontend.includes("const primaryButton=primaryUrl?") && frontend.includes('${primaryButton}</div>'));
check('default visualizer action is generic travel options', html.includes('>View travel options</button>') && html.includes('v=667e'));

const result = {
  task: 'GV-EVIDENCE-667E',
  passed: checks.filter(item => item.pass).length,
  failed: checks.filter(item => !item.pass).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_EVIDENCE_667E.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: result.passed, failed: result.failed }, null, 2));
if (result.failed) process.exit(1);
