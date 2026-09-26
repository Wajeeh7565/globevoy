'use strict';

const fs = require('fs');
const path = require('path');
process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.TRAVELPAYOUTS_TOKEN = 'validation-token-not-production';
process.env.AGODA_SITE_ID = 'validation-site';
process.env.AGODA_API_KEY = 'validation-key-not-production';
process.env.GV_PROVIDER_COVERAGE_ADMIN_TOKEN = 'validation-admin-token';
process.env.GV_PROVIDER_COVERAGE_MAX_BATCH = '10';
process.env.GLOBEVOY_USE_MOCKS = 'false';

const service = require('./services/admin/audits/provider-live-coverage');
const lambda = require('./lambda');
const snapshot = require('./data/provider-live-coverage-1000-668c.json');
const pilot = require('./data/provider-live-pilot-100-668c.json');
const staticAudit = require('./data/provider-mappings-1000-668b.json');
const cheapFlights = require('./services/cheap-one-way-flights');

const checks = [];
function check(name, pass, details = {}) {
  checks.push({ name, pass: Boolean(pass), details });
  if (!pass) console.error('FAIL', name, details);
}
function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}
function liveFetch(url) {
  const text = String(url || '');
  if (text.includes('api.travelpayouts.com')) {
    return Promise.resolve(response({ data: [{
      departure_at: '2026-09-18T10:00:00Z',
      return_at: '2026-09-18T15:00:00Z',
      price: 399,
      airline: 'XX',
      flight_number: '101',
      transfers: 0,
      duration: 300,
      link: '/search/YTO1809PAR1'
    }] }));
  }
  return Promise.resolve(response({ results: [{
    hotelName: 'Validation Grand Hotel',
    dailyRate: 150,
    landingURL: 'https://www.agoda.com/partners/partnersearch.aspx?hid=123',
    reviewScore: 8.7,
    starRating: 4,
    reviewCount: 250
  }] }));
}
function emptyFetch(url) {
  if (String(url).includes('api.travelpayouts.com')) return Promise.resolve(response({ data: [] }));
  return Promise.resolve(response({ results: [] }));
}
function providerErrorFetch() { return Promise.resolve(response({ message: 'temporary provider failure' }, 503)); }

(async () => {
  cheapFlights._clearCache();
  check('snapshot has exactly 1000 records', snapshot.records.length === 1000, { count: snapshot.records.length });
  check('snapshot city ids are unique', new Set(snapshot.records.map(record => record.cityId)).size === 1000);
  check('snapshot starts pending', snapshot.summary.pendingCount === 1000 && snapshot.summary.productionActiveCount === 0);
  check('snapshot never preclaims live verification', snapshot.records.every(record => !record.lastVerifiedAt && record.classification === 'pending' && record.productionActivation?.eligible === false));
  check('pilot has exactly 100 unique cities', pilot.cityIds.length === 100 && new Set(pilot.cityIds).size === 100);
  check('pilot includes Toronto', pilot.cityIds.includes('toronto-ca'));
  check('pilot includes gateway Suwon', pilot.cityIds.includes('suwon-kr'));
  check('pilot includes unresolved Agoda Tehran', pilot.cityIds.includes('tehran-ir'));

  const summary = service.snapshotSummary();
  check('summary reports 668C', summary.version === 'GV-CITY-668C' && summary.summary.recordCount === 1000 && summary.enabled === true);
  const search = service.searchSnapshot({ q: 'Toronto' });
  check('snapshot search finds Toronto', search.totalMatches >= 1 && search.records.some(record => record.cityId === 'toronto-ca'));
  const pending = service.searchSnapshot({ classification: 'pending', limit: 100 });
  check('classification search works', pending.totalMatches === 1000 && pending.records.every(record => record.classification === 'pending'));
  const active = service.searchSnapshot({ active: 'true' });
  check('initial active search is empty', active.totalMatches === 0);

  check('admin token authorizes exact header', service.isAuthorized({ 'x-gv-admin-token': 'validation-admin-token' }) === true);
  check('admin token authorizes bearer header', service.isAuthorized({ authorization: 'Bearer validation-admin-token' }) === true);
  check('admin token rejects incorrect value', service.isAuthorized({ 'x-gv-admin-token': 'wrong' }) === false);

  cheapFlights._clearCache();
  const toronto = await service.verifyCityCoverage('toronto-ca', { month: '2026-09', checkIn: '2026-09-18' }, { _fetchFn: liveFetch });
  check('injected live responses are recognized functionally', toronto.live.travelpayouts.status === 'live' && toronto.live.agoda.status === 'live');
  check('injected responses are not production eligible', toronto.live.travelpayouts.productionEligible === false && toronto.live.agoda.productionEligible === false);
  check('injected responses cannot activate city', toronto.classification === 'live-both' && toronto.productionActivation.eligible === false);
  check('live test returns bounded evidence only', toronto.live.travelpayouts.sample.bookingLinkPresent === true && !('token' in toronto.live.travelpayouts));

  cheapFlights._clearCache();
  const suwon = await service.verifyCityCoverage('suwon-kr', { month: '2026-09', checkIn: '2026-09-18' }, { _fetchFn: liveFetch });
  check('gateway city classification is preserved', suwon.classification === 'gateway-supported' && suwon.staticMapping.travelpayouts.mappingType === 'gateway-airport');
  check('gateway test evidence still cannot activate', suwon.productionActivation.eligible === false);

  cheapFlights._clearCache();
  const tehran = await service.verifyCityCoverage('tehran-ir', { month: '2026-09', checkIn: '2026-09-18' }, { _fetchFn: liveFetch });
  check('unresolved Agoda remains honest', tehran.live.agoda.status === 'unresolved-static-mapping' && tehran.classification === 'live-flights-only');
  check('unresolved Agoda city is inactive', tehran.productionActivation.eligible === false);

  cheapFlights._clearCache();
  const noResults = await service.verifyCityCoverage('paris-fr', { month: '2026-09', checkIn: '2026-09-18' }, { _fetchFn: emptyFetch });
  check('empty provider results become estimate only', noResults.classification === 'estimate-only' && noResults.productionActivation.eligible === false);

  cheapFlights._clearCache();
  const errors = await service.verifyCityCoverage('paris-fr', { month: '2026-09', checkIn: '2026-09-18' }, { _fetchFn: providerErrorFetch });
  check('provider errors are surfaced without activation', errors.classification === 'provider-error' && errors.productionActivation.eligible === false);

  const unknown = await service.verifyCityCoverage('not-a-city', {}, { _fetchFn: liveFetch });
  check('unknown city fails safely', unknown.ok === false && unknown.error === 'unknown-city-id');

  cheapFlights._clearCache();
  const oversizedIds = staticAudit.records.slice(0, 20).map(record => record.cityId);
  const batch = await service.verifyBatch({ cityIds: oversizedIds, concurrency: 3, month: '2026-09', checkIn: '2026-09-18' }, { _fetchFn: liveFetch, ignoreFeatureFlag: true });
  check('batch is hard capped at 10', batch.requestedCount === 10 && batch.records.length === 10);
  check('batch reports no production-active mock cities', batch.productionActiveCount === 0);
  check('batch reports non-persistence truthfully', batch.persistence === 'not-persisted-by-lambda-response');

  const merged = service.mergeResultsIntoSnapshot([toronto, suwon, tehran]);
  check('merge preserves 1000 records', merged.records.length === 1000);
  check('merge records three verifications', merged.summary.verifiedAtLeastOnceCount === 3);
  check('merge still has zero production-active test evidence', merged.summary.productionActiveCount === 0);
  check('merge preserves untouched pending records', merged.summary.pendingCount === 997);

  const classified = service._internal.classifyCoverage(
    staticAudit.records.find(record => record.cityId === 'paris-fr'),
    { status: 'live', productionEligible: true },
    { status: 'live', productionEligible: true }
  );
  check('production classification requires both eligible providers', classified.classification === 'live-both' && classified.productionActivation.eligible === true);
  const missingStay = service._internal.classifyCoverage(
    staticAudit.records.find(record => record.cityId === 'paris-fr'),
    { status: 'live', productionEligible: true },
    { status: 'no-live-qualified-rate', productionEligible: false }
  );
  check('one live provider cannot activate city', missingStay.productionActivation.eligible === false && missingStay.classification === 'live-flights-only');

  const getResponse = await lambda.handler({ rawPath: '/api/provider-live-coverage', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} });
  const getBody = JSON.parse(getResponse.body);
  check('Lambda summary endpoint works', getResponse.statusCode === 200 && getBody.version === 'GV-CITY-668C' && getBody.summary.recordCount === 1000);
  const getSearch = await lambda.handler({ rawPath: '/api/provider-live-coverage', requestContext: { http: { method: 'GET' } }, queryStringParameters: { q: 'Rabat' } });
  const getSearchBody = JSON.parse(getSearch.body);
  check('Lambda live coverage search works', getSearch.statusCode === 200 && getSearchBody.records.some(record => record.cityId === 'rabat-ma'));
  const denied = await lambda.handler({ rawPath: '/api/provider-live-coverage/verify', requestContext: { http: { method: 'POST' } }, headers: {}, body: JSON.stringify({ cityIds: ['toronto-ca'] }) });
  check('Lambda verifier rejects unauthenticated calls', denied.statusCode === 403);
  const wrongMethod = await lambda.handler({ rawPath: '/api/provider-live-coverage/verify', requestContext: { http: { method: 'GET' } }, headers: {}, queryStringParameters: {} });
  check('Lambda verifier requires POST', wrongMethod.statusCode === 405);

  process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'false';
  const disabled = await service.verifyBatch({ cityIds: ['toronto-ca'] }, { _fetchFn: liveFetch });
  check('feature flag disables verification', disabled.ok === false && disabled.error === 'feature-disabled');
  process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';

  const pass = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668C',
    generatedAt: new Date().toISOString(),
    passed: pass,
    failed: checks.length - pass,
    total: checks.length,
    packagedSnapshotSummary: snapshot.summary,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668C.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: pass, failed: checks.length - pass, total: checks.length }, null, 2));
  if (pass !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
