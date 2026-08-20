'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const service = require('./services/travel-entry-eligibility');
const lambda = require('./lambda');

const checks = [];
function check(name, condition, details) {
  checks.push({ name, passed: Boolean(condition), details: details ?? null });
  if (!condition) process.exitCode = 1;
}
function tour(countryCode, city = 'Destination') {
  return { origin: { city: 'Toronto', country: 'Canada', countryCode: 'CA', code: 'YYZ' }, cities: [{ city, countryCode, code: countryCode === 'US' ? 'MIA' : 'CDG' }] };
}
function profile(passportCountryCode, extra = {}) {
  return { passportCountryCode, residenceCountryCode: 'CA', entryAware: true, ...extra };
}
async function main() {
  check('release version', service.ENTRY_ELIGIBILITY_VERSION === 'GV-ENTRY-675A', service.ENTRY_ELIGIBILITY_VERSION);
  check('built-in U.S. rule has a recorded implementation review date', service.US_RULE_REVIEWED_AT === '2026-07-29', service.US_RULE_REVIEWED_AT);
  check('full suspension list contains Iran', service.US_FULL_SUSPENSION.has('IR'));
  check('full suspension list has 20 entries including PA travel documents', service.US_FULL_SUSPENSION.size === 20, service.US_FULL_SUSPENSION.size);
  check('partial tourist list contains Nigeria', service.US_PARTIAL_TOURIST_SUSPENSION.has('NG'));
  check('partial tourist list has 19 countries', service.US_PARTIAL_TOURIST_SUSPENSION.size === 19, service.US_PARTIAL_TOURIST_SUSPENSION.size);

  const iranUs = service.staticEligibility({ profile: profile('IR'), tour: tour('US', 'Miami') });
  check('Iranian passport without exception is blocked for US tourist route', iranUs.hardBlocked === true && iranUs.overallStatus === 'blocked', iranUs);
  check('blocked US check uses current restriction status', iranUs.checks[0]?.status === 'not-currently-eligible', iranUs.checks[0]);

  const protectedVisa = service.staticEligibility({ profile: profile('IR', { validUsVisaOn20260101: true }), tour: tour('US', 'Miami') });
  check('protected pre-2026 valid visa changes hard block to exception check', protectedVisa.hardBlocked === false && protectedVisa.checks[0]?.status === 'exception-check-required', protectedVisa.checks[0]);

  const lpr = service.staticEligibility({ profile: profile('IR', { usLawfulPermanentResident: true }), tour: tour('US', 'Miami') });
  check('US lawful permanent resident is not hard blocked', lpr.hardBlocked === false && lpr.checks[0]?.status === 'exception-check-required', lpr.checks[0]);

  const secondNotSelected = service.staticEligibility({ profile: profile('IR', { secondPassportCountryCode: 'CA' }), tour: tour('US', 'Miami') });
  check('merely storing a second passport does not bypass a restriction', secondNotSelected.hardBlocked === true, secondNotSelected.checks[0]);

  const dual = service.staticEligibility({ profile: profile('IR', { secondPassportCountryCode: 'CA', useSecondPassportForTrip: true }), tour: tour('US', 'Miami') });
  check('dual national explicitly using non-restricted second passport is not hard blocked', dual.hardBlocked === false && dual.checks[0]?.status === 'verification-required' && dual.profile.travelPassportCountryCode === 'CA', dual.checks[0]);

  const disabledIranUs = service.staticEligibility({ profile: profile('IR', { entryAware: false }), tour: tour('US', 'Miami') });
  check('disabling personalization does not bypass an authoritative hard block', disabledIranUs.hardBlocked === true && disabledIranUs.overallStatus === 'blocked', disabledIranUs);

  const nigeriaUs = service.staticEligibility({ profile: profile('NG'), tour: tour('US', 'New York') });
  check('partially suspended tourist nationality is blocked without existing document', nigeriaUs.hardBlocked === true && nigeriaUs.checks[0]?.status === 'visa-issuance-restricted', nigeriaUs.checks[0]);

  const iranFrance = service.staticEligibility({ profile: profile('IR'), tour: tour('FR', 'Paris') });
  check('non-US route is not guessed and requires live verification', iranFrance.hardBlocked === false && iranFrance.checks[0]?.status === 'verification-required', iranFrance.checks[0]);
  check('transit remains unknown until exact flight selection', iranFrance.transit?.status === 'unknown-until-flight-selected', iranFrance.transit);

  const noProfile = service.staticEligibility({ profile: {}, tour: tour('FR', 'Paris') });
  check('missing profile yields profile-required rather than false clearance', noProfile.overallStatus === 'profile-required' && noProfile.hardBlocked === false, noProfile);

  const recommendation = service.recommendationEligibility(tour('US', 'Miami'), { passportCountryCode: 'IR', residenceCountryCode: 'CA', entryProfile: '1' });
  check('recommendation guard blocks US candidate for Iranian passport', recommendation.recommendationEligible === false, recommendation);

  const post = await lambda.handler({
    rawPath: '/api/travel-entry-eligibility',
    requestContext: { http: { method: 'POST' } },
    body: JSON.stringify({ profile: profile('IR'), tour: tour('US', 'Miami'), allowProvider: false })
  });
  const postBody = JSON.parse(post.body);
  check('Lambda endpoint returns 200', post.statusCode === 200, post.statusCode);
  check('Lambda endpoint returns blocked route result', postBody.version === 'GV-ENTRY-675A' && postBody.hardBlocked === true, postBody);

  const get = await lambda.handler({ rawPath: '/api/travel-entry-eligibility', requestContext: { http: { method: 'GET' } } });
  check('Lambda endpoint requires POST', get.statusCode === 405, get.statusCode);

  const generatedSource = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
  check('generated-tour imports entry eligibility guard', generatedSource.includes("require('./services/travel-entry-eligibility')"));
  check('generated-tour filters hard-blocked candidates before ranking', generatedSource.includes('candidateEntryEligibility.hardBlocked') && generatedSource.includes('entryBlockedCandidates'));
  check('generated-tour attaches entry eligibility to final tour', generatedSource.includes('guardedVisualizerTour.entryEligibility'));

  const result = {
    release: 'GV-ENTRY-675A',
    generatedAt: new Date().toISOString(),
    checkCount: checks.length,
    passedCount: checks.filter(x => x.passed).length,
    failedCount: checks.filter(x => !x.passed).length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_ENTRY_675A_BACKEND.json'), JSON.stringify(result, null, 2) + '\n');
  if (process.exitCode) throw new Error('GV-ENTRY-675A backend validation failed.');
  console.log(`GV-ENTRY-675A backend validation passed (${result.passedCount}/${result.checkCount}).`);
}
main().catch(error => { console.error(error.stack || error); process.exit(1); });
