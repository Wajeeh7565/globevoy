'use strict';

process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B = 'true';
process.env.ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C = 'true';
process.env.ENABLE_EXACT_DATE_FAMILY_OCCUPANCY_669D = 'true';
process.env.ENABLE_STAKEHOLDER_READINESS_669E = 'true';
process.env.ENABLE_STABLE_ROUTE_CONTROLS_667C = 'true';
process.env.ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D = 'true';

const fs = require('fs');
const path = require('path');
const activation = require('./services/verified-city-activation');
const generated = require('./generated-tour');
const adaptive = require('./budget-adaptive-routes');
const multicity = require('./multicity-routes');
const controls = require('./generated-tour-controls');
const { resolveOrigin } = require('./data/destination-meta');

const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: passed === true, details });
  if (!passed) process.exitCode = 1;
}

const summary = activation.summary();
check('668T activation remains selected', summary.version === 'GV-CITY-668T', { version: summary.version });
check('1,000-city audit remains complete', summary.summary?.auditedCount === 1000 && summary.summary?.unauditedCount === 0, summary.summary);
check('439-city production allowlist remains unchanged', summary.summary?.productionActiveCount === 439, { active: summary.summary?.productionActiveCount });
check('669E generated-tour baseline remains packaged in the current release', (/(669[ef]|674a)/i.test(generated.GENERATED_TOUR_VERSION) || /gv-rec-677[a-d]/i.test(generated.GENERATED_TOUR_VERSION)), { version: generated.GENERATED_TOUR_VERSION });
check('669E route-control baseline remains packaged in the current release', /(669e|674a)/i.test(controls.CONTROL_VERSION), { version: controls.CONTROL_VERSION });
check('669E feature flag is enabled in all origin resolvers', adaptive._internal.stakeholderReadiness669eEnabled() && multicity._internal.stakeholderReadiness669eEnabled() && controls._internal.stakeholderReadiness669eEnabled());

const vancouver = resolveOrigin('Vancouver (YVR)');
const adaptiveIndex = adaptive._internal.indexes();
const multiIndex = multicity._internal.buildFoundationIndexes();
const controlIndex = controls._internal.indexes();
const vAdaptive = adaptive._internal.resolveOriginRecord(vancouver, adaptiveIndex);
const vMulti = multicity._internal.resolveOriginRecord(vancouver, multiIndex);
const vControl = controls._internal.resolveOriginRecord({ origin: 'Vancouver (YVR)' }, controlIndex);
check('Vancouver resolves to Vancouver in adaptive routing', vAdaptive?.displayCity === 'Vancouver' && vAdaptive?.cityId === 'vancouver-ca', { city: vAdaptive?.displayCity, cityId: vAdaptive?.cityId });
check('Vancouver resolves to Vancouver in legacy multi-city routing', vMulti?.displayCity === 'Vancouver' && vMulti?.cityId === 'vancouver-ca', { city: vMulti?.displayCity, cityId: vMulti?.cityId });
check('Vancouver resolves to Vancouver in route controls', vControl?.displayCity === 'Vancouver' && vControl?.cityId === 'vancouver-ca', { city: vControl?.displayCity, cityId: vControl?.cityId });

const whistler = { city: 'Whistler', countryCode: 'CA', code: 'YVR', airportCode: 'YVR' };
const whistlerRecord = adaptive._internal.resolveOriginRecord(whistler, adaptiveIndex);
check('Explicit Whistler search still resolves to Whistler', whistlerRecord?.displayCity === 'Whistler', { city: whistlerRecord?.displayCity, cityId: whistlerRecord?.cityId });

const montreal = controls._internal.resolveOriginRecord({ origin: 'Montreal (YUL)' }, controlIndex);
const restored = controls._internal.mutateStopRecords({
  action: 'restore',
  origin: 'Montreal (YUL)',
  currentStops: 'new-york-us',
  budget: '1500',
  currency: 'CAD',
  totalNights: '6'
}, controlIndex, montreal);
check('Saved one-stop route can be restored', restored.supported === true && restored.records?.length === 1 && restored.records[0]?.cityId === 'new-york-us', restored);
check('Saved-route restoration is explicitly labelled', restored.action === 'restore' && /saved route restored/i.test(restored.message || ''), { action: restored.action, message: restored.message });
check('Inactive Havana remains blocked by production-active guard', generated._internal.allTourStopsProductionActive({ stops: [{ cityId: 'havana-cu', city: 'Havana' }] }) === false);
check('Active New York remains eligible for saved-route restoration', generated._internal.allTourStopsProductionActive({ stops: [{ cityId: 'new-york-us', city: 'New York' }] }) === true);

const preserved = controls._internal.applyPreservedDateSchedule({
  stops: [{ city: 'New York', nights: 6 }],
  legs: [{ from: { city: 'Montreal' }, to: { city: 'New York' } }, { from: { city: 'New York' }, to: { city: 'Montreal' } }]
}, '2026-11-01');
check('Saved-route date preservation keeps departure date', preserved.preserved === true && preserved.tour.legs?.[0]?.departureDate === '2026-11-01', preserved.tour.legs);
check('Saved-route date preservation keeps chronological return', preserved.tour.legs?.[1]?.departureDate === '2026-11-07', preserved.tour.legs);

const controlSource = fs.readFileSync(path.join(__dirname, 'generated-tour-controls.js'), 'utf8');
const adaptiveSource = fs.readFileSync(path.join(__dirname, 'budget-adaptive-routes.js'), 'utf8');
const multicitySource = fs.readFileSync(path.join(__dirname, 'multicity-routes.js'), 'utf8');
check('Restore action keeps one-stop routes instead of forcing two stops', controlSource.includes("action === 'restore' ? 1 : MIN_STOPS"));
check('Restore action uses saved-route restoration source', controlSource.includes('saved-route-restoration-669e'));
check('All three origin resolvers prefer exact city-country match under 669E', [controlSource, adaptiveSource, multicitySource].every(source => source.includes('stakeholderReadiness669eEnabled()') && source.includes('if (stakeholderReadiness669eEnabled() && cityMatch) return cityMatch;')));

const result = {
  taskId: 'GV-PROD-669E',
  version: 'GV-PROD-669E',
  generatedAt: new Date().toISOString(),
  passed: checks.every(item => item.passed),
  checkCount: checks.length,
  passedCount: checks.filter(item => item.passed).length,
  failedCount: checks.filter(item => !item.passed).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_PROD_669E.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
