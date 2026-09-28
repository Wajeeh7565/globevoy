'use strict';
process.env.ENABLE_GENERATED_TOUR_651A = 'true';
process.env.ENABLE_STABLE_ROUTE_CONTROLS_667C = 'true';
process.env.ENABLE_STAKEHOLDER_READINESS_669E = 'true';
process.env.ENABLE_ROUTE_FEASIBILITY_GUARD_664A = 'true';

const fs = require('fs');
const path = require('path');
const generated = require('./generated-tour');
const controls = require('./generated-tour-controls');
const feasibility = require('./services/domain/routing/route-feasibility');

const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: Boolean(passed), details });
  console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  if (!passed) process.exitCode = 1;
}

(async () => {
  check('674A generated-tour version is packaged', ['2.8.0-gv-ux-674a-duration-choice-controls','2.9.0-gv-rec-677a-smart-duration-flight-selection','2.10.0-gv-rec-677b-smart-flight-date-selection','2.10.1-gv-rec-677b-r1-itinerary-date-integrity','2.10.2-gv-rec-677b-r2-flight-quality-guardrails','2.10.3-gv-rec-677b-r3-route-relative-flight-quality','2.11.0-gv-rec-677c-whole-trip-route-optimization','2.12.0-gv-rec-677d-destination-value-proximity'].includes(generated.GENERATED_TOUR_VERSION), generated.GENERATED_TOUR_VERSION);
  check('674A route-control version is packaged', controls.CONTROL_VERSION === '2.1.0-gv-ux-674a-choice-controls', controls.CONTROL_VERSION);

  const autoLegacy = generated._internal.resolveAdaptiveDuration674A({ budget: 3000, currency: 'USD', adults: 1, passengers: 1, tripLength: 'auto', nights: 5, adaptiveDuration: 'true' });
  check('legacy auto nights=5 is ignored', autoLegacy.mode === 'adaptive' && autoLegacy.nights === 12, autoLegacy);
  const autoCanadian = generated._internal.resolveAdaptiveDuration674A({ budget: 3000, currency: 'CAD', adults: 1, passengers: 1, tripLength: 'auto', adaptiveDuration: 'true' });
  check('CAD 3000 adaptive duration is 10 nights', autoCanadian.nights === 10, autoCanadian);
  const explicit = generated._internal.resolveAdaptiveDuration674A({ budget: 3000, currency: 'CAD', tripLength: '5', nights: 5, adaptiveDuration: 'false' });
  check('explicit five-night choice is preserved', explicit.mode === 'user-selected' && explicit.nights === 5, explicit);
  const exact = generated._internal.resolveAdaptiveDuration674A({ budget: 3000, currency: 'CAD', dateMode: 'exact', tripLength: 'auto', nights: 7, adaptiveDuration: 'true' });
  check('exact-date duration is preserved', exact.mode === 'exact-dates' && exact.nights === 7, exact);

  check('5 nights supports at most 2 stops', feasibility.maxStopsForNights(5) === 2, feasibility.maxStopsForNights(5));
  check('9 nights supports at most 2 stops', feasibility.maxStopsForNights(9) === 2, feasibility.maxStopsForNights(9));
  check('10 nights may support 3 stops', feasibility.maxStopsForNights(10) === 3, feasibility.maxStopsForNights(10));
  check('14 nights may support 3 stops', feasibility.maxStopsForNights(14) === 3, feasibility.maxStopsForNights(14));
  check('15 nights may support 4 stops', feasibility.maxStopsForNights(15) === 4, feasibility.maxStopsForNights(15));

  const idx = controls._internal.indexes();
  const origin = controls._internal.resolveOriginRecord({ origin: 'Toronto (YYZ)' }, idx);
  const eligible = idx.records.filter(record => record.providerSupport?.bothProviderReady === true
    && record.multiCitySuitability?.status === 'strong'
    && String(record.multiCitySuitability?.activationTier || '').toUpperCase() === 'CORE'
    && record.cityId !== origin?.cityId);
  const current = eligible.slice(0, 2);
  check('test route records resolved', Boolean(origin) && current.length === 2, { origin: origin?.cityId, current: current.map(r => r.cityId) });

  const baseQuery = { origin: 'Toronto (YYZ)', budget: '3000', currency: 'CAD', totalNights: '10', nights: '10', adaptiveDuration: 'false', stopIndex: '0', variant: 'gv674a-validation' };
  const options = controls._internal.replacementOptions674A(baseQuery, idx, origin, current, 0, 4);
  check('shuffle returns four replacement choices', options.length === 4, options.map(option => option.city));
  check('replacement choices are distinct', new Set(options.map(option => option.cityId)).size === options.length, options.map(option => option.cityId));
  check('replacement choices stay within the displayed budget estimate', options.every(option => option.estimatedTotalUsd <= 3000 * 0.735 * 1.025), options.map(option => option.estimatedTotalUsd));

  const chosen = options[1];
  const refs = current.map(record => ({ cityId: record.cityId, city: record.displayCity, countryCode: record.countryCode }));
  const mutation = controls._internal.mutateStopRecords({ ...baseQuery, action: 'replace', replacementCityId: chosen.cityId, currentStopRefs: JSON.stringify(refs), currentStops: refs.map(item => item.cityId).join(',') }, idx, origin);
  check('selected replacement is honoured', mutation.supported && mutation.records[0].cityId === chosen.cityId, { chosen: chosen.cityId, actual: mutation.records?.[0]?.cityId });

  const addTen = controls._internal.mutateStopRecords({ ...baseQuery, action: 'add', currentStopRefs: JSON.stringify(refs), currentStops: refs.map(item => item.cityId).join(',') }, idx, origin);
  check('10-night route may add a third city when budget-safe', addTen.supported && addTen.records.length === 3, { supported: addTen.supported, count: addTen.records?.length, message: addTen.message });
  const addFive = controls._internal.mutateStopRecords({ ...baseQuery, totalNights: '5', nights: '5', action: 'add', currentStopRefs: JSON.stringify(refs), currentStops: refs.map(item => item.cityId).join(',') }, idx, origin);
  check('5-night route blocks a third city', addFive.supported === false && addFive.reason === 'trip-max-stops', { reason: addFive.reason, message: addFive.message });

  const payload = await controls.getGeneratedTourControl({ ...baseQuery, action: 'replacement-options', currentStopRefs: JSON.stringify(refs), currentStops: refs.map(item => item.cityId).join(','), optionLimit: '4' });
  check('replacement-options API contract returns four choices', payload.supported && payload.replacementOptions?.length === 4 && payload.routeControl?.optionCount === 4, { supported: payload.supported, count: payload.replacementOptions?.length });

  const result = {
    release: 'GV-UX-674A',
    generatedAt: new Date().toISOString(),
    passed: !process.exitCode,
    checkCount: checks.length,
    passedCount: checks.filter(item => item.passed).length,
    failedCount: checks.filter(item => !item.passed).length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_UX_674A_BACKEND.json'), JSON.stringify(result, null, 2) + '\n');
  if (process.exitCode) throw new Error('GV-UX-674A backend validation failed.');
  console.log(`GV-UX-674A backend validation passed (${result.passedCount}/${result.checkCount}).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
