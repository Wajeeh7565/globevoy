'use strict';

const fs = require('fs');
const path = require('path');
const registry = require('./data/unified-city-registry-1000.json');
const cityService = require('./services/city-registry');

const checks = [];
function check(name, condition, details = {}) {
  checks.push({ name, passed: Boolean(condition), details });
  if (!condition) throw new Error(`Validation failed: ${name}`);
}

process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665B = 'true';
process.env.ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B = 'false';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const rows = registry.records || [];
check('registry has exactly 1000 records', rows.length === 1000, { count: rows.length });
check('current foundation tier has 500 records', rows.filter(r => r.selectionTier === 'current-500').length === 500);
check('expansion tier has 500 records', rows.filter(r => r.selectionTier === 'expansion-500').length === 500);
check('all records are origin eligible', rows.every(r => r.origin && r.origin.eligible === true));
check('all records are destination eligible', rows.every(r => r.destination && r.destination.eligible === true));
check('all records have valid coordinates', rows.every(r => Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude)) && Math.abs(Number(r.latitude)) <= 90 && Math.abs(Number(r.longitude)) <= 180));
check('all records have a practical airport', rows.every(r => /^[A-Z]{3}$/.test(String(r.origin?.preferredAirportCode || ''))));
check('all records have currency and country', rows.every(r => r.country && /^[A-Z]{2}$/.test(String(r.countryCode || '')) && /^[A-Z]{3}$/.test(String(r.currency || ''))));
check('city IDs are unique', new Set(rows.map(r => r.cityId)).size === rows.length);
check('registry spans at least 200 countries/territories', new Set(rows.map(r => r.countryCode)).size >= 200, { countries: new Set(rows.map(r => r.countryCode)).size });
check('mapped provider subset is reported honestly', registry.summary.bothProvidersMappedCount === rows.filter(r => r.validation?.bothProvidersMapped).length, { count: registry.summary.bothProvidersMappedCount });
check('expansion records require live provider checks', rows.filter(r => r.selectionTier === 'expansion-500').every(r => r.validation?.requiresLiveProviderCheck === true));

for (const [name, expectedCode] of [['Toronto','YYZ'],['Rabat','RBA'],['Faisalabad','LYP'],['Algiers','ALG'],['Lima','LIM'],['Tehran','IKA'],['Suwon','ICN'],['Lucca','PSA']]) {
  const result = cityService.resolveRegistryCity(name);
  check(`${name} resolves in unified registry`, !!result, { result: result && { city: result.displayName, code: result.origin?.preferredAirportCode } });
  check(`${name} uses expected practical airport`, result?.origin?.preferredAirportCode === expectedCode, { expectedCode, actual: result?.origin?.preferredAirportCode });
}

const expansionSearch = cityService.searchRegistry({ q: 'Suwon', mode: 'origin', limit: 10 });
check('registry search returns Suwon as origin', expansionSearch.records.some(r => r.displayName === 'Suwon' && r.origin?.gateway?.airportCode === 'ICN'));
const destinationSearch = cityService.searchRegistry({ q: 'Rabat', mode: 'destination', limit: 10 });
check('registry search returns Rabat as destination', destinationSearch.records.some(r => r.displayName === 'Rabat' && r.destination?.eligible));

const globalGraph = require('./services/global-route-graph');
const idx = globalGraph._internal.indexes();
check('route graph exposes exactly 1000 registry destinations when enabled', idx.registrySelected.length === 1000, { count: idx.registrySelected.length });
check('deterministic fallback remains limited to reviewed current 500', idx.trusted.length === 500, { count: idx.trusted.length });
check('route graph includes 500 expansion discoveries', idx.eligibleDiscoveries.length === 500, { count: idx.eligibleDiscoveries.length });
check('global raw origin fallback remains broader than registry', idx.rows.length > 9000, { rawRows: idx.rows.length });

const suwon = globalGraph.resolveAnyOrigin('Suwon');
check('Suwon origin resolves through a practical airport', suwon?.airportCode === 'ICN', { suwon });
const rabat = globalGraph.resolveAnyOrigin('Rabat');
check('Rabat origin resolves directly', rabat?.airportCode === 'RBA', { rabat });

(async () => {
  const lambda = require('./lambda');
  const summaryResponse = await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} });
  const summaryPayload = JSON.parse(summaryResponse.body);
  check('Lambda city-registry summary endpoint returns 1000 records', summaryResponse.statusCode === 200 && summaryPayload.summary?.recordCount === 1000, { statusCode: summaryResponse.statusCode, summary: summaryPayload.summary });
  const searchResponse = await lambda.handler({ rawPath: '/api/city-registry', requestContext: { http: { method: 'GET' } }, queryStringParameters: { q: 'Suwon', mode: 'origin', limit: '5' } });
  const searchPayload = JSON.parse(searchResponse.body);
  check('Lambda city-registry search endpoint returns Suwon', searchResponse.statusCode === 200 && searchPayload.records?.some(r => r.displayName === 'Suwon'), { records: searchPayload.records?.map(r => r.displayName) });

  const generated = await globalGraph.generateGlobalRouteCandidates({ origin: 'Rabat', budget: 1500, currency: 'USD', nights: 6, adults: 1 });
  check('Rabat can generate automatic candidates from registry', Array.isArray(generated.tours) && generated.tours.length > 0, { count: generated.tours?.length || 0, diagnostics: generated.diagnostics });
  check('generated destinations come from registry', (generated.tours || []).every(tour => (tour.stops || []).every(stop => rows.some(r => r.cityId === stop.cityId))), { sampleStops: generated.tours?.[0]?.stops?.map(s => s.cityId) });

  const htmlFiles = ['index.html','explore.html','mixed-results.html','trip.html'];
  for (const file of htmlFiles) {
    const content = fs.readFileSync(path.join(__dirname, '..', 'gv_city_668a_frontend', file), 'utf8');
    check(`${file} loads registry before supported origins`, content.indexOf('city-registry-1000.js') >= 0 && content.indexOf('city-registry-1000.js') < content.indexOf('supported-origins.js'));
  }
  const frontendRegistry = fs.readFileSync(path.join(__dirname, '..', 'gv_city_668a_frontend', 'runtime', 'city-registry-1000.js'), 'utf8');
  check('frontend registry exposes GlobevoyCityRegistry', frontendRegistry.includes('window.GlobevoyCityRegistry'));
  check('frontend supported origins prioritizes registry', fs.readFileSync(path.join(__dirname, '..', 'gv_city_668a_frontend', 'runtime', 'supported-origins.js'), 'utf8').includes('GlobevoyCityRegistry.hasOrigin'));

  const output = {
    taskId: 'GV-CITY-668A',
    passed: checks.every(c => c.passed),
    checkCount: checks.length,
    summary: registry.summary,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668A.json'), JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ passed: output.passed, checkCount: output.checkCount, summary: output.summary }, null, 2));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
