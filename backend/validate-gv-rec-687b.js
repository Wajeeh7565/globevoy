'use strict';

const fs = require('fs');
const path = require('path');
const diversity = require('./services/domain/routing/route-diversity-687b');

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) { pass += 1; console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail += 1; console.error(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`); }
}

function stop(cityId, city, country, airportCode, group = 'Group 1') {
  return { cityId, city, country, airportCode, group };
}
function tour(id, total, stops, extra = {}) {
  return {
    id,
    tourId: id,
    origin: { city: 'Toronto', country: 'Canada', airportCode: 'YYZ' },
    stops,
    estimatedTotalUsd: total,
    totalDistanceKm: extra.totalDistanceKm || 1500,
    legs: extra.legs || [{ providerBacked: true }, { providerBacked: false }],
    totalNights: 7,
    ...extra
  };
}

const candidates = [
  tour('regional', 720, [stop('cle','Cleveland','United States','CLE'), stop('pit','Pittsburgh','United States','PIT')], { totalDistanceKm: 900 }),
  tour('latin', 1020, [stop('pty','Panama City','Panama','PTY'), stop('ctg','Cartagena','Colombia','CTG')], { totalDistanceKm: 7600 }),
  tour('mexico', 940, [stop('mex','Mexico City','Mexico','MEX'), stop('mid','Merida','Mexico','MID')], { totalDistanceKm: 6200 }),
  tour('local', 760, [stop('yul','Montreal','Canada','YUL'), stop('yqb','Quebec City','Canada','YQB')], { totalDistanceKm: 1300 }),
  tour('gem', 990, [stop('gua','Guatemala City','Guatemala','GUA','Group 2'), stop('sal','San Salvador','El Salvador','SAL','Group 2')], { totalDistanceKm: 6600 })
];

async function main() {
  const old = {
    enable: process.env.ENABLE_AI_ASSISTED_ROUTE_DIVERSITY_687B,
    llm: process.env.ENABLE_LLM_ROUTE_CURATOR_662A,
    alt: process.env.GV_AI_ROUTE_DIVERSITY_687B
  };
  process.env.ENABLE_AI_ASSISTED_ROUTE_DIVERSITY_687B = 'true';
  process.env.ENABLE_LLM_ROUTE_CURATOR_662A = 'false'; // validation must not make network/LLM calls
  delete process.env.GV_AI_ROUTE_DIVERSITY_687B;
  const base = { budget: '2000', currency: 'CAD', totalNights: '7', __gvRequestOrigin687B: diversity.PRODUCTION_ORIGIN_687B };

  check('Version marker', diversity.VERSION === 'GV-REC-687B-P3');
  check('Five supported portfolio roles', diversity.SUPPORTED_ROLES.length === 5 && diversity.SUPPORTED_ROLES.includes('something-different') && diversity.SUPPORTED_ROLES.includes('hidden-gem'));
  check('Role normalization — inspiring', diversity.normalizeRole('Most inspiring') === 'most-memorable');
  check('Role normalization — something different', diversity.normalizeRole('wildcard') === 'something-different');
  check('Role normalization — hidden gem', diversity.normalizeRole('under the radar gem') === 'hidden-gem');
  check('Route key deterministic', diversity.routeKey(candidates[1]) === 'pty>ctg');
  check('Excluded routes parse JSON', JSON.stringify(diversity.parseExcludedRouteKeys({ diversityExcludedRoutes: '["cle>pit","pty>ctg"]' })) === JSON.stringify(['cle>pit','pty>ctg']));

  const low = await diversity.selectDiverseRoleCandidate(candidates, { ...base, routeRole: 'lowest-cost' });
  check('Lowest cost remains literal deterministic cheapest', low.tour?.id === 'regional', low.tour?.id);
  check('Lowest cost never delegated to AI', low.diagnostics.aiAttempted === false && low.tour?.aiAssistedRouteDiversity687B?.selectedBy === 'deterministic-lowest-cost');

  const best = await diversity.selectDiverseRoleCandidate(candidates, { ...base, routeRole: 'best-balance', diversityExcludedRoutes: JSON.stringify([diversity.routeKey(low.tour)]) });
  check('Best overall does not repeat exact lowest-cost route', diversity.routeKey(best.tour) !== diversity.routeKey(low.tour), diversity.routeKey(best.tour));
  check('Best overall selected from original valid candidate set', candidates.some(t => t.id === best.tour?.id), best.tour?.id);

  const inspiring = await diversity.selectDiverseRoleCandidate(candidates, { ...base, routeRole: 'most-memorable', diversityExcludedRoutes: JSON.stringify([diversity.routeKey(low.tour), diversity.routeKey(best.tour)]) });
  check('Most inspiring excludes both earlier exact routes', ![diversity.routeKey(low.tour), diversity.routeKey(best.tour)].includes(diversity.routeKey(inspiring.tour)), diversity.routeKey(inspiring.tour));

  const different = await diversity.selectDiverseRoleCandidate(candidates, { ...base, routeRole: 'something-different', diversityExcludedRoutes: JSON.stringify(['pty>ctg','mex>mid']) });
  check('Something different avoids exact previously shown routes', !['pty>ctg','mex>mid'].includes(diversity.routeKey(different.tour)), diversity.routeKey(different.tour));
  check('Something different emits overlap diagnostics', Number.isFinite(different.tour?.aiAssistedRouteDiversity687B?.maxOverlapRatioWithEarlierRoutes));

  const gem = await diversity.selectDiverseRoleCandidate(candidates, { ...base, routeRole: 'hidden-gem', diversityExcludedRoutes: JSON.stringify(['cle>pit','pty>ctg','mex>mid','yul>yqb']) });
  check('Hidden gem can select Group 2 candidate', gem.tour?.id === 'gem', gem.tour?.id);
  check('AI safety marker forbids invention', gem.tour?.aiAssistedRouteDiversity687B?.aiMayInventTravelFacts === false);

  const previewOrigin = await diversity.selectDiverseRoleCandidate(candidates, { ...base, __gvRequestOrigin687B: diversity.PREVIEW_ORIGIN_687B, routeRole: 'best-balance' });
  check('Preview-origin fallback returns unmodified candidate pool', previewOrigin.tour === null && previewOrigin.tours.length === candidates.length && previewOrigin.diagnostics.selectedBy === 'feature-disabled');

  const source = fs.readFileSync(path.join(__dirname, 'generated-tour.js'), 'utf8');
  check('Generated-tour integration imports 687B service', source.includes("require('./services/domain/routing/route-diversity-687b')"));
  check('687B selection occurs before legacy role-scoped narrowing', source.indexOf('selectDiverseRoleCandidate687B(guarded.tours, query)') > -1 && source.indexOf('selectDiverseRoleCandidate687B(guarded.tours, query)') < source.indexOf('const orderOptimizationRows'));
  check('Generated-tour exposes diversity diagnostics', source.includes('aiAssistedRouteDiversity687B') && source.includes('AI may rank only already-valid candidate IDs'));
  check('New roles recognized by generated-tour', source.includes("'something-different', 'hidden-gem'"));
  check('CORS repair remains present in Lambda package', fs.readFileSync(path.join(__dirname, 'lambda.js'), 'utf8').includes('resolveCorsOrigin') || fs.readFileSync(path.join(__dirname, 'lambda.js'), 'utf8').includes('ALLOWED_CORS_ORIGINS'));

  // Restore env
  if (old.enable === undefined) delete process.env.ENABLE_AI_ASSISTED_ROUTE_DIVERSITY_687B; else process.env.ENABLE_AI_ASSISTED_ROUTE_DIVERSITY_687B = old.enable;
  if (old.llm === undefined) delete process.env.ENABLE_LLM_ROUTE_CURATOR_662A; else process.env.ENABLE_LLM_ROUTE_CURATOR_662A = old.llm;
  if (old.alt === undefined) delete process.env.GV_AI_ROUTE_DIVERSITY_687B; else process.env.GV_AI_ROUTE_DIVERSITY_687B = old.alt;

  console.log(`\nGV-REC-687B: ${pass}/${pass + fail} PASS`);
  if (fail) process.exit(1);
}

main().catch(error => { console.error(error); process.exit(1); });
