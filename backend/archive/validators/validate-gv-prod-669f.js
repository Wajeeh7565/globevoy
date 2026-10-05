'use strict';

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B = 'true';
process.env.ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C = 'true';
process.env.ENABLE_EXACT_DATE_FAMILY_OCCUPANCY_669D = 'true';
process.env.ENABLE_STAKEHOLDER_READINESS_669E = 'true';
process.env.ENABLE_ORIGIN_DISPLAY_INTEGRITY_669F = 'true';
process.env.ENABLE_STABLE_ROUTE_CONTROLS_667C = 'true';
process.env.ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D = 'true';
process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665B = 'true';
process.env.ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B = 'false';

const fs = require('fs');
const path = require('path');
const activation = require('./services/cities/registry/verified-city-activation');
const graph = require('./services/domain/routing/global-route-graph');
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
check('669F generated-tour version is packaged', (/669f/i.test(generated.GENERATED_TOUR_VERSION) || /gv-rec-677[a-d]/i.test(generated.GENERATED_TOUR_VERSION)), { version: generated.GENERATED_TOUR_VERSION });
check('669F global route graph version is packaged', /669f/i.test(graph.GLOBAL_ROUTE_GRAPH_VERSION), { version: graph.GLOBAL_ROUTE_GRAPH_VERSION });
check('669F origin integrity flag is active', graph._internal.originDisplayIntegrity669fEnabled() === true);

const cases = [
  ['Vancouver (YVR)', 'Vancouver', 'YVR'],
  ['Vancouver', 'Vancouver', 'YVR'],
  ['YVR', 'Vancouver', 'YVR'],
  ['Whistler', 'Whistler', 'YVR'],
  ['Whistler (YVR)', 'Whistler', 'YVR'],
  ['New York (JFK)', 'New York', 'JFK'],
  ['Paris (BVA)', 'Paris', 'BVA'],
  ['Paris', 'Paris', 'CDG'],
  ['Suwon, South Korea', 'Suwon', 'ICN']
];
for (const [input, city, code] of cases) {
  const resolved = graph.resolveAnyOrigin(input);
  check(`${input} preserves city identity and airport intent`, resolved?.city === city && resolved?.airportCode === code, {
    input, city: resolved?.city, airportCode: resolved?.airportCode, resolutionType: resolved?.originResolutionType
  });
}

const graphResult = graph.generateGlobalRouteCandidates({
  origin: 'Vancouver (YVR)', budget: 2600, currency: 'CAD', adults: 2, passengers: 2,
  nights: 8, totalNights: 8, maxStops: 3, variant: '669f-validation'
});
check('Global route candidate response keeps Vancouver origin', graphResult?.origin?.city === 'Vancouver' && graphResult?.origin?.airportCode === 'YVR', graphResult?.origin);
check('Generated graph tours keep Vancouver origin', Array.isArray(graphResult?.tours) && graphResult.tours.length > 0 && graphResult.tours.every(tour => tour?.origin?.city === 'Vancouver' && tour?.origin?.airportCode === 'YVR'), {
  count: graphResult?.tours?.length,
  origins: graphResult?.tours?.slice(0, 3).map(tour => ({ city: tour?.origin?.city, airportCode: tour?.origin?.airportCode }))
});
check('Route graph still sees 439 verified-active destinations', graphResult?.diagnostics?.verifiedActiveDestinationCount === 439, graphResult?.diagnostics);

const vancouver = resolveOrigin('Vancouver (YVR)');
const vAdaptive = adaptive._internal.resolveOriginRecord(vancouver, adaptive._internal.indexes());
const vMulti = multicity._internal.resolveOriginRecord(vancouver, multicity._internal.buildFoundationIndexes());
const vControl = controls._internal.resolveOriginRecord({ origin: 'Vancouver (YVR)' }, controls._internal.indexes());
check('Adaptive resolver remains Vancouver', vAdaptive?.displayCity === 'Vancouver' && vAdaptive?.cityId === 'vancouver-ca', { city: vAdaptive?.displayCity, cityId: vAdaptive?.cityId });
check('Legacy resolver remains Vancouver', vMulti?.displayCity === 'Vancouver' && vMulti?.cityId === 'vancouver-ca', { city: vMulti?.displayCity, cityId: vMulti?.cityId });
check('Route-control resolver remains Vancouver', vControl?.displayCity === 'Vancouver' && vControl?.cityId === 'vancouver-ca', { city: vControl?.displayCity, cityId: vControl?.cityId });

const yvrOwner = graph._internal.indexes().byCode.get('YVR');
check('Shared YVR code owner prefers direct Vancouver over gateway Whistler', yvrOwner?.canonicalCityName === 'Vancouver', {
  owner: yvrOwner?.canonicalCityName,
  requiresGatewayTransfer: yvrOwner?.unifiedRegistry?.origin?.requiresGatewayTransfer
});

const source = fs.readFileSync(path.join(__dirname, 'services', 'domain', 'routing', 'global-route-graph.js'), 'utf8');
check('669F city-first path is packaged', source.includes('preserve the traveller\'s explicit city identity') && source.includes('originDisplayIntegrity669fEnabled() && !codeOnlyInput'));
check('669F airport override path is packaged', source.includes('requestedAirportCode = null') && source.includes('supportedCodes.includes(requestedCode)'));
check('669F shared-code ownership guard is packaged', source.includes('originCodeOwnershipScore') && source.includes('requiresGateway) score -= 120'));

const result = {
  taskId: 'GV-PROD-669F',
  version: 'GV-PROD-669F',
  generatedAt: new Date().toISOString(),
  passed: checks.every(item => item.passed),
  checkCount: checks.length,
  passedCount: checks.filter(item => item.passed).length,
  failedCount: checks.filter(item => !item.passed).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_PROD_669F.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
