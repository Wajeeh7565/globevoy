'use strict';

const fs = require('fs');
const path = require('path');
const { enrichFlightLeg } = require('./services/partner-links');
const generatedTourModule = require('./generated-tour');
const generatedTour = generatedTourModule._internal;
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

check(
  '673F-R1 generated-tour version is packaged',
  ['2.7.3-gv-prod-673f-r1-release-integrity','2.8.0-gv-ux-674a-duration-choice-controls','2.9.0-gv-rec-677a-smart-duration-flight-selection','2.10.0-gv-rec-677b-smart-flight-date-selection','2.10.1-gv-rec-677b-r1-itinerary-date-integrity','2.10.2-gv-rec-677b-r2-flight-quality-guardrails','2.10.3-gv-rec-677b-r3-route-relative-flight-quality','2.11.0-gv-rec-677c-whole-trip-route-optimization','2.12.0-gv-rec-677d-destination-value-proximity'].includes(generatedTourModule.GENERATED_TOUR_VERSION),
  generatedTourModule.GENERATED_TOUR_VERSION
);

const staleEvidenceLeg = {
  from: { city: 'Dubai', code: 'DXB' },
  to: { city: 'Cairo', code: 'CAI' },
  automaticTourDate: { departureDate: '2026-08-29' },
  providerDateEvidence: {
    departureDate: '2026-09-15',
    bookingLink: 'https://www.aviasales.com/search/DXB1509CAI1',
    providerBacked: true,
    appliedToEstimate: false,
    productionEligible: false
  },
  providerVerification: {
    verified: true,
    exactDateMatch: false,
    productionEligible: false
  }
};
const repairedLeg = enrichFlightLeg(staleEvidenceLeg, { adults: 1, currency: 'CAD' });
check('rejected provider URL is removed', !String(repairedLeg.booking?.url).includes('DXB1509CAI1'), repairedLeg.booking?.url);
check('replacement URL uses displayed departure date', String(repairedLeg.booking?.url).includes('DXB2908CAI1'), repairedLeg.booking?.url);
check('replacement is labelled comparison, not exact ticket', repairedLeg.booking?.status === 'prefilled-comparison-link' && repairedLeg.booking?.exactTicketClaimed === false);

const candidates = [
  { id: 'wrong-explicit-low', tourRole: 'lowest-cost', estimatedTotalUsd: 900, totalBudgetUsd: 2000, origin: { countryCode: 'CA' }, stops: [{ cityId: 'a', countryCode: 'US' }] },
  { id: 'actual-low', estimatedTotalUsd: 500, totalBudgetUsd: 2000, origin: { countryCode: 'CA' }, stops: [{ cityId: 'b', countryCode: 'MX' }] },
  { id: 'balanced', tourRole: 'best-balance', estimatedTotalUsd: 1500, totalBudgetUsd: 2000, totalDistanceKm: 4000, origin: { countryCode: 'CA' }, stops: [{ cityId: 'c', countryCode: 'GB' }, { cityId: 'd', countryCode: 'PT' }] },
  { id: 'memorable', tourRole: 'most-memorable', estimatedTotalUsd: 1600, totalBudgetUsd: 2000, totalDistanceKm: 9000, origin: { countryCode: 'CA' }, stops: [{ cityId: 'e', countryCode: 'JP', group: 'Group 2' }, { cityId: 'f', countryCode: 'KR', group: 'Group 2' }] }
];
const roles = generatedTour.threePickRoleAssignments670aR2(candidates, { budget: '2000', currency: 'USD' });
check('lowest-cost role is the actual minimum', roles['lowest-cost']?.id === 'actual-low', roles['lowest-cost']?.id);
check('three role routes remain distinct', new Set(Object.values(roles).map(generatedTour.routeKey670aR2)).size === 3);
check('reassigned role records current release', ['GV-PROD-673F-R1','GV-UX-674A'].includes(roles['lowest-cost']?.mapFirstRoleAssignment?.version), roles['lowest-cost']?.mapFirstRoleAssignment?.version);
check('reassigned role remains derived from safe candidate pool', roles['best-balance']?.mapFirstRoleAssignment?.derivedFromSafeCandidatePool === true);

if (process.exitCode) throw new Error('GV-PROD-673F-R1 backend validation failed.');
const result = {
  release: 'GV-PROD-673F-R1',
  generatedAt: new Date().toISOString(),
  passed: true,
  checkCount: checks.length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_PROD_673F_R1.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`GV-PROD-673F-R1 backend validation passed (${checks.length}/${checks.length}).`);
