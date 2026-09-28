'use strict';

process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B = 'true';
process.env.ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C = 'true';
process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665B = 'true';
process.env.ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B = 'false';

const fs = require('fs');
const path = require('path');
const activation = require('./services/verified-city-activation');
const graph = require('./services/domain/routing/global-route-graph');
const fallback = require('./global-generated-tour-fallback');
const generated = require('./generated-tour');

const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: passed === true, details });
  if (!passed) process.exitCode = 1;
}

const summary = activation.summary();
check('668T activation remains selected', summary.version === 'GV-CITY-668T', { version: summary.version });
check('439-city production allowlist remains unchanged', summary.summary?.productionActiveCount === 439, { active: summary.summary?.productionActiveCount });
check('1,000-city audit remains complete', summary.summary?.auditedCount === 1000 && summary.summary?.unauditedCount === 0, summary.summary);
check('669B active-destination and origin repairs remain enabled', generated._internal.mvpValidationRepairs669bEnabled() === true);
check('669C budget-safe recovery flag is enabled', generated._internal.budgetSafeRouteRecovery669cEnabled() === true);
check('669C recovery attempt defaults to zero', generated._internal.budgetRecoveryAttempt669c({}) === 0);
check('669C recovery attempt parses positive integers', generated._internal.budgetRecoveryAttempt669c({ __budgetRecoveryAttempt669c: '2' }) === 2);
check('669C recovery attempt rejects negative values', generated._internal.budgetRecoveryAttempt669c({ __budgetRecoveryAttempt669c: '-3' }) === 0);
check('generated-tour version identifies 669C or a superseding 669D release', (/669[cdef]/i.test(generated.GENERATED_TOUR_VERSION) || /gv-rec-677[a-d]/i.test(generated.GENERATED_TOUR_VERSION)), { version: generated.GENERATED_TOUR_VERSION });

const source = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
check('provider-over-budget branch invokes 669C recovery', source.includes('const recovered = await attemptBudgetSafeRouteRecovery669c(routeQuery, liveVerification);'));
check('669C recovery lowers stop cap by exactly one', source.includes('const nextStopCap = currentStopCap - 1;'));
check('669C recovery is bounded at one stop', source.includes('if (currentStopCap <= 1 || attempt >= 3) return null;'));
check('669C recovery does not relax thresholds', source.includes('thresholdsRelaxed: false'));
check('669C recovery preserves original provider verification diagnostics', source.includes('originalProviderVerification: liveVerification?.summary || null'));
check('unsupported over-budget response remains available after recovery exhaustion', source.includes("reason: 'provider-verified-route-over-budget'"));

const montreal = graph.resolveAnyOrigin('Montreal (YUL)');
check('Montreal origin remains YUL', montreal?.city === 'Montreal' && montreal?.airportCode === 'YUL', { city: montreal?.city, airportCode: montreal?.airportCode });
const candidates = graph.generateGlobalRouteCandidates({ origin: 'Montreal (YUL)', budget: 1500, currency: 'CAD', nights: 6, maxStops: 1 });
const stops = candidates.tours.flatMap(tour => tour.stops || []);
check('one-stop Montreal recovery candidates exist', candidates.tours.length > 0, { tourCount: candidates.tours.length });
check('one-stop Montreal candidates obey stop cap', candidates.tours.every(tour => (tour.stops || []).length <= 1), { counts: candidates.tours.map(tour => (tour.stops || []).length) });
check('one-stop Montreal candidates are production-active only', stops.length > 0 && stops.every(stop => activation.liveRecommendationEligible(stop)), { inactive: stops.filter(stop => !activation.liveRecommendationEligible(stop)).map(stop => stop.city) });
check('Havana remains excluded from Montreal recovery candidates', !stops.some(stop => stop.cityId === 'havana-cu' || stop.city === 'Havana'));

const ny = graph.resolveAnyOrigin('New York (JFK)');
check('New York origin repair remains intact', ny?.city === 'New York' && ny?.airportCode === 'JFK', { city: ny?.city, airportCode: ny?.airportCode });
const fallbackMontreal = fallback.resolveGlobalOrigin('Montreal (YUL)');
const fallbackPool = fallback._internal.candidatePool(fallbackMontreal);
check('global fallback remains production-active only', fallbackPool.length > 0 && fallbackPool.every(item => activation.liveRecommendationEligible(item.record)), { poolCount: fallbackPool.length });

const result = {
  taskId: 'GV-PROD-669C',
  version: 'GV-PROD-669C',
  generatedAt: new Date().toISOString(),
  passed: checks.every(item => item.passed),
  checkCount: checks.length,
  passedCount: checks.filter(item => item.passed).length,
  failedCount: checks.filter(item => !item.passed).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_PROD_669C.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
