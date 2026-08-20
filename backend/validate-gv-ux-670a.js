'use strict';

process.env.ENABLE_MULTICITY_ROUTE_610B = 'true';
process.env.ENABLE_BUDGET_ADAPTIVE_ROUTES_620A = 'true';
process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B = 'true';
process.env.ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C = 'true';
process.env.ENABLE_EXACT_DATE_FAMILY_OCCUPANCY_669D = 'true';
process.env.ENABLE_STAKEHOLDER_READINESS_669E = 'true';
process.env.ENABLE_ORIGIN_DISPLAY_INTEGRITY_669F = 'true';
process.env.ENABLE_MAP_FIRST_THREE_PICKS_670A = 'true';
process.env.ENABLE_STABLE_ROUTE_CONTROLS_667C = 'true';
process.env.ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D = 'true';
process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665B = 'true';
process.env.ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B = 'false';

const fs = require('fs');
const path = require('path');
const generated = require('./generated-tour');
const activation = require('./services/verified-city-activation');
const graph = require('./services/global-route-graph');
const { getMultiCityTours } = require('./multicity-routes');

const checks = [];
function check(name, passed, details = null) {
  const item = { name, passed: passed === true, details };
  checks.push(item);
  if (!item.passed) process.exitCode = 1;
}

(async () => {
  const internal = generated._internal;
  const summary = activation.summary();
  check('Generated-tour package includes the 670A role baseline plus current production repairs', ['2.7.3-gv-prod-673f-r1-release-integrity','2.8.0-gv-ux-674a-duration-choice-controls','2.9.0-gv-rec-677a-smart-duration-flight-selection','2.10.0-gv-rec-677b-smart-flight-date-selection','2.10.1-gv-rec-677b-r1-itinerary-date-integrity','2.10.2-gv-rec-677b-r2-flight-quality-guardrails','2.10.3-gv-rec-677b-r3-route-relative-flight-quality','2.11.0-gv-rec-677c-whole-trip-route-optimization','2.12.0-gv-rec-677d-destination-value-proximity'].includes(generated.GENERATED_TOUR_VERSION), { version: generated.GENERATED_TOUR_VERSION });
  check('Map-first three-pick feature flag is active', internal.mapFirstThreePicks670aEnabled() === true);
  check('668T activation baseline remains selected', summary.version === 'GV-CITY-668T', { version: summary.version });
  check('1,000-city audit remains complete', summary.summary?.auditedCount === 1000 && summary.summary?.unauditedCount === 0, summary.summary);
  check('439 production-active cities remain unchanged', summary.summary?.productionActiveCount === 439, { active: summary.summary?.productionActiveCount });

  const aliases = [
    ['lowest cost', 'lowest-cost'],
    ['cost', 'lowest-cost'],
    ['recommended', 'best-balance'],
    ['best_balance', 'best-balance'],
    ['discovery', 'most-memorable'],
    ['most memorable', 'most-memorable']
  ];
  for (const [input, expected] of aliases) {
    check(`Role alias '${input}' normalizes correctly`, internal.normalizePickRole670a(input) === expected, { input, expected, actual: internal.normalizePickRole670a(input) });
  }

  const fakeTours = [
    { id: 'low', tourRole: 'lowest-cost' },
    { id: 'balanced', tourRoleLabel: 'Best balance' },
    { id: 'memorable', recommendationLabel: 'Most memorable' }
  ];
  for (const [role, expectedId] of [['lowest-cost', 'low'], ['best-balance', 'balanced'], ['most-memorable', 'memorable']]) {
    const scoped = internal.roleScopedCandidatePool670a(fakeTours, { routeRole: role });
    check(`${role} request scopes candidate selection`, scoped.length === 1 && scoped[0].id === expectedId, { ids: scoped.map(item => item.id) });
  }
  const noMatch = internal.roleScopedCandidatePool670a(fakeTours, { routeRole: 'lowest-cost' }).length;
  check('Role scoping keeps a non-empty candidate pool', noMatch > 0, { count: noMatch });


  const unlabeledTours = [
    { id: 'u1', estimatedTotalUsd: 600, totalBudgetUsd: 2000, totalDistanceKm: 1000, origin: { countryCode: 'CA' }, stops: [{ cityId: 'a', countryCode: 'US' }] },
    { id: 'u2', estimatedTotalUsd: 1200, totalBudgetUsd: 2000, totalDistanceKm: 4000, origin: { countryCode: 'CA' }, stops: [{ cityId: 'b', countryCode: 'GB' }, { cityId: 'c', countryCode: 'PT' }] },
    { id: 'u3', estimatedTotalUsd: 1500, totalBudgetUsd: 2000, totalDistanceKm: 9000, origin: { countryCode: 'CA' }, stops: [{ cityId: 'd', countryCode: 'JP', group: 'Group 2' }, { cityId: 'e', countryCode: 'KR', group: 'Group 2' }] }
  ];
  const derived = internal.threePickRoleAssignments670aR2(unlabeledTours, { budget: '2000', currency: 'USD' });
  check('Unlabelled safe candidates receive three distinct derived roles',
    ['lowest-cost', 'best-balance', 'most-memorable'].every(role => derived[role]) && new Set(Object.values(derived).map(internal.routeKey670aR2)).size === 3,
    Object.fromEntries(Object.entries(derived).map(([role, tour]) => [role, tour.id])));

  const decorated = internal.decoratePickTour670a({ id: 'balanced', tourRole: 'best-balance' }, { routeRole: 'best-balance' });
  check('Selected tour receives pick-role metadata', decorated.pickRole === 'best-balance' && decorated.pickRoleLabel === 'Best balance' && decorated.pickRoleMatched === true, decorated);
  const mismatch = internal.decoratePickTour670a({ id: 'low', tourRole: 'lowest-cost' }, { routeRole: 'most-memorable' });
  check('Role mismatch is exposed honestly', mismatch.pickRoleMatched === false && mismatch.mapFirstThreePicks?.actualRole === 'lowest-cost', mismatch.mapFirstThreePicks);

  const query = {
    origin: 'Toronto (YYZ)', budget: '2000', currency: 'CAD', passengers: '1', adults: '1', children: '0',
    nights: '7', totalNights: '7', maxStops: '3', dateMode: 'flexible', flexible: 'true',
    preferredMonth: '2026-10', month: '2026-10', adaptiveDuration: 'true'
  };
  const response = await getMultiCityTours(query);
  const tours = Array.isArray(response?.tours) ? response.tours : [];
  const roles = tours.map(tour => internal.tourRole670a(tour));
  check('Deterministic route planner returns three candidates', response?.supported === true && tours.length === 3, { supported: response?.supported, count: tours.length, reason: response?.reason });
  check('Route planner exposes all three distinct recommendation roles', ['lowest-cost', 'best-balance', 'most-memorable'].every(role => roles.includes(role)), { roles });
  check('Three planner candidates have distinct route structures', new Set(tours.map(tour => (tour.stops || []).map(stop => stop.cityId || stop.city).join('>'))).size === 3, {
    routes: tours.map(tour => (tour.stops || []).map(stop => stop.city).join(' > '))
  });

  const originCases = [
    ['Vancouver (YVR)', 'Vancouver', 'YVR'],
    ['Whistler (YVR)', 'Whistler', 'YVR'],
    ['New York (JFK)', 'New York', 'JFK'],
    ['Suwon, South Korea', 'Suwon', 'ICN']
  ];
  for (const [input, city, airportCode] of originCases) {
    const resolved = graph.resolveAnyOrigin(input);
    check(`${input} origin-display regression remains fixed`, resolved?.city === city && resolved?.airportCode === airportCode, {
      city: resolved?.city, airportCode: resolved?.airportCode
    });
  }

  process.env.ENABLE_MAP_FIRST_THREE_PICKS_670A = 'false';
  check('Feature flag safely disables role request parsing', internal.requestedPickRole670a({ routeRole: 'lowest-cost' }) === '');
  check('Feature flag off leaves the full candidate list available', internal.roleScopedCandidatePool670a(fakeTours, { routeRole: 'lowest-cost' }).length === fakeTours.length);
  process.env.ENABLE_MAP_FIRST_THREE_PICKS_670A = 'true';

  const source = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
  check('Role-scoped selection is packaged before route curation', source.includes('const feasibleTours = roleScopedCandidatePool670a(guarded.tours, query);'));
  check('Final visualizer response is decorated with role metadata', source.includes('decoratePickTour670a(finalGuard.tour, routeQuery)'));
  check('670A diagnostics are packaged', source.includes("version: 'GV-UX-670A'") && source.includes('requestedRole: requestedPickRole670a(routeQuery)'));

  const result = {
    taskId: 'GV-UX-670A-R2',
    version: generated.GENERATED_TOUR_VERSION,
    generatedAt: new Date().toISOString(),
    passed: checks.every(item => item.passed),
    checkCount: checks.length,
    passedCount: checks.filter(item => item.passed).length,
    failedCount: checks.filter(item => !item.passed).length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_UX_670A_BACKEND.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
