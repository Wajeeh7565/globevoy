'use strict';

process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B = 'true';
process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665B = 'true';
process.env.ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B = 'false';

const graph = require('./services/global-route-graph');
const fallback = require('./global-generated-tour-fallback');
const activation = require('./services/verified-city-activation');
const generated = require('./generated-tour');
const { enrichStay } = require('./services/partner-links');

const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: passed === true, details });
  if (!passed) process.exitCode = 1;
}

const summary = activation.summary();
check('668T activation remains selected', summary.version === 'GV-CITY-668T', { version: summary.version });
check('439-city production allowlist remains unchanged', summary.summary?.productionActiveCount === 439, { active: summary.summary?.productionActiveCount });
check('1,000-city audit remains complete', summary.summary?.auditedCount === 1000 && summary.summary?.unauditedCount === 0, summary.summary);
check('669B repair flag is enabled', graph._internal.mvpValidationRepairs669bEnabled() === true);

const ny = graph.resolveAnyOrigin('New York (JFK)');
check('New York parenthesized IATA resolves to New York', ny?.city === 'New York', { city: ny?.city, code: ny?.code, airportCode: ny?.airportCode });
check('New York parenthesized IATA resolves to JFK', ny?.airportCode === 'JFK' && ny?.code === 'JFK', { code: ny?.code, airportCode: ny?.airportCode });
const nyTokens = graph._internal.parseOriginInput('New York (JFK)');
check('ordinary word New is not treated as airport code NEW', !nyTokens.codes.includes('NEW') && nyTokens.codes[0] === 'JFK', nyTokens);
const fallbackNy = fallback.resolveGlobalOrigin('New York (JFK)');
check('global fallback origin resolver also selects New York/JFK', fallbackNy?.city === 'New York' && fallbackNy?.airportCode === 'JFK', { city: fallbackNy?.city, airportCode: fallbackNy?.airportCode });

const montreal = graph.resolveAnyOrigin('Montreal (YUL)');
check('Montreal origin remains stable', montreal?.city === 'Montreal' && montreal?.airportCode === 'YUL', { city: montreal?.city, airportCode: montreal?.airportCode });
const graphResult = graph.generateGlobalRouteCandidates({ origin: 'Montreal (YUL)', budget: 1500, currency: 'CAD', nights: 6, maxStops: 3 });
const graphStops = graphResult.tours.flatMap(tour => tour.stops || []);
const inactiveGraphStops = graphStops.filter(stop => !activation.liveRecommendationEligible(stop));
check('deterministic graph emits only production-active destinations', graphResult.tours.length > 0 && inactiveGraphStops.length === 0, { tourCount: graphResult.tours.length, inactive: inactiveGraphStops.map(stop => stop.city) });
check('Havana is excluded from Montreal generated-route candidates', !graphStops.some(stop => stop.cityId === 'havana-cu' || stop.city === 'Havana'));

const fallbackMontreal = fallback.resolveGlobalOrigin('Montreal (YUL)');
const fallbackPool = fallback._internal.candidatePool(fallbackMontreal);
const inactiveFallback = fallbackPool.filter(item => !activation.liveRecommendationEligible(item.record));
check('global fallback pool emits only production-active destinations', fallbackPool.length > 0 && inactiveFallback.length === 0, { poolCount: fallbackPool.length, inactive: inactiveFallback.map(item => item.record.cityId) });
check('Havana is excluded from global fallback pool', !fallbackPool.some(item => item.record.cityId === 'havana-cu'));

check('final generated-tour safety gate rejects inactive Havana', generated._internal.allTourStopsProductionActive({ stops: [{ cityId: 'havana-cu', city: 'Havana', countryCode: 'CU' }] }) === false);
check('final generated-tour safety gate accepts active New York', generated._internal.allTourStopsProductionActive({ stops: [{ cityId: 'new-york-us', city: 'New York', countryCode: 'US', code: 'JFK' }] }) === true);

const sampleActive = graphStops.find(stop => Number(stop?.hotel?.providerCityId) > 0);
const linked = enrichStay({ ...sampleActive, arrivalDate: '2026-11-05', departureDate: '2026-11-08' }, { currency: 'CAD', adults: 1, children: 0 });
check('active destination hotel link is HTTPS and date-prefilled', /^https:\/\//.test(String(linked?.hotel?.booking?.url || '')) && linked?.hotel?.booking?.checkIn === '2026-11-05' && linked?.hotel?.booking?.checkOut === '2026-11-08', { city: linked?.city, booking: linked?.hotel?.booking });

const result = {
  taskId: 'GV-PROD-669B',
  version: 'GV-PROD-669B',
  generatedAt: new Date().toISOString(),
  passed: checks.every(item => item.passed),
  checkCount: checks.length,
  passedCount: checks.filter(item => item.passed).length,
  failedCount: checks.filter(item => !item.passed).length,
  checks
};
console.log(JSON.stringify(result, null, 2));
