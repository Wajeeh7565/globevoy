'use strict';

const fs = require('fs');
const path = require('path');
process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.TRAVELPAYOUTS_TOKEN = 'validation-token-not-production';
process.env.AGODA_SITE_ID = 'validation-site';
process.env.AGODA_API_KEY = 'validation-key-not-production';
process.env.GV_PROVIDER_COVERAGE_ADMIN_TOKEN = 'validation-admin-token';
process.env.GV_PROVIDER_COVERAGE_MAX_BATCH = '10';
process.env.GLOBEVOY_USE_MOCKS = 'false';
process.env.ENABLE_PRICE_AUDIT_610D = 'false';

const service = require('./services/admin/audits/provider-live-coverage');
const lambda = require('./lambda');
const staticAudit = require('./data/provider-mappings-1000-668b.json');
const review66 = require('./data/provider-live-review-66-668d.json');
const cheapFlights = require('./services/providers/flights/cheap-one-way-flights');

const checks = [];
function check(name, pass, details = {}) {
  checks.push({ name, pass: Boolean(pass), details });
  if (!pass) console.error('FAIL', name, details);
}
function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) };
}
function flightRow({ price = 200, duration = 300, transfers = 0, date = '2026-10-18' } = {}) {
  return {
    departure_at: `${date}T10:00:00Z`,
    return_at: `${date}T15:00:00Z`,
    price,
    airline: 'XX',
    flight_number: '101',
    transfers,
    duration,
    link: '/search/YTO1810PAR1'
  };
}
function hotelRow(overrides = {}) {
  return {
    hotelName: 'Validation Grand Hotel',
    dailyRate: 150,
    landingURL: 'https://www.agoda.com/partners/partnersearch.aspx?hid=123',
    reviewScore: 8.7,
    starRating: 4,
    reviewCount: 250,
    ...overrides
  };
}
function urlParam(url, key) {
  try { return new URL(String(url)).searchParams.get(key); } catch (_) { return null; }
}
function bodyFrom(options = {}) {
  try { return JSON.parse(options.body || '{}'); } catch (_) { return {}; }
}

function allLiveFetch(url, options = {}) {
  if (String(url).includes('api.travelpayouts.com')) return Promise.resolve(response({ data: [flightRow()] }));
  return Promise.resolve(response({ results: [hotelRow()] }));
}
function multiWindowFetch(url, options = {}) {
  const text = String(url);
  if (text.includes('api.travelpayouts.com')) {
    const destination = urlParam(url, 'destination');
    const month = urlParam(url, 'departure_at');
    if (['CUN', 'BZE'].includes(destination)) return Promise.resolve(response({ data: [flightRow({ date: `${month}-18` })] }));
    if (destination === 'ALG' && month === '2026-09') return Promise.resolve(response({ data: [] }));
    if (destination === 'ALG' && month === '2026-10') return Promise.resolve(response({ data: [flightRow({ date: '2026-10-20' })] }));
    return Promise.resolve(response({ data: [flightRow({ date: `${month}-18` })] }));
  }
  const body = bodyFrom(options);
  const checkIn = body?.criteria?.checkInDate;
  if (checkIn === '2026-11-18') return Promise.resolve(response({ results: [hotelRow()] }));
  return Promise.resolve(response({ results: [] }));
}
function unqualifiedAgodaFetch(url, options = {}) {
  if (String(url).includes('api.travelpayouts.com')) return Promise.resolve(response({ data: [flightRow()] }));
  return Promise.resolve(response({ results: [hotelRow({ hotelName: 'Budget Backpacker Hostel', reviewScore: 6.2, starRating: 2, reviewCount: 8 })] }));
}
function emptyFetch(url) {
  if (String(url).includes('api.travelpayouts.com')) return Promise.resolve(response({ data: [] }));
  return Promise.resolve(response({ results: [] }));
}
function providerErrorFetch() { return Promise.resolve(response({ message: 'temporary provider failure' }, 503)); }

(async () => {
  check('service version is 668D', service.VERSION === 'GV-CITY-668D');
  check('review list contains 66 cities', review66.cityIds.length === 66 && new Set(review66.cityIds).size === 66);
  check('review list includes Tulum and Caye Caulker', review66.cityIds.includes('tulum-mx') && review66.cityIds.includes('caye-caulker-bz'));
  check('668D feature is enabled', service.enabled() === true);

  const months = service._internal.flightMonths({ month: '2026-09', monthCount: 3 });
  check('flight verification scans three months', months.join(',') === '2026-09,2026-10,2026-11', months);
  const checkIns = service._internal.stayCheckIns({ checkIn: '2026-09-18', stayWindowCount: 3, stayWindowSpacingDays: 30 });
  check('stay verification scans three windows', checkIns.join(',') === '2026-09-18,2026-10-18,2026-11-17', checkIns);

  const tulumRecord = staticAudit.records.find(record => record.cityId === 'tulum-mx');
  const tulumCandidates = service._internal.flightDestinationCandidates(tulumRecord);
  check('Tulum gateway candidate is CUN', tulumCandidates[0]?.code === 'CUN' && tulumCandidates[0]?.kind === 'gateway', tulumCandidates);
  check('Tulum direct TQO remains an alternate', tulumCandidates.some(candidate => candidate.code === 'TQO' && candidate.kind === 'direct'), tulumCandidates);
  const cayeRecord = staticAudit.records.find(record => record.cityId === 'caye-caulker-bz');
  const cayeCandidates = service._internal.flightDestinationCandidates(cayeRecord);
  check('Caye Caulker gateway candidate is BZE', cayeCandidates[0]?.code === 'BZE' && cayeCandidates[0]?.kind === 'gateway', cayeCandidates);
  check('Caye Caulker direct CUK remains an alternate', cayeCandidates.some(candidate => candidate.code === 'CUK'), cayeCandidates);

  const pakistanRecord = staticAudit.records.find(record => record.cityId === 'islamabad-pk');
  const pakistanAnchors = service._internal.anchorsForRecord(pakistanRecord, {});
  check('Pakistan uses regional connection hubs', pakistanAnchors.includes('DXB') && pakistanAnchors.includes('DOH') && pakistanAnchors.includes('IST'), pakistanAnchors);
  const cubaRecord = staticAudit.records.find(record => record.cityId === 'havana-cu');
  const cubaAnchors = service._internal.anchorsForRecord(cubaRecord, {});
  check('Caribbean uses MIA and NYC anchors', cubaAnchors.includes('MIA') && cubaAnchors.includes('NYC'), cubaAnchors);

  const comfortable = service._internal.assessFlightComfort({ durationMinutes: 600, transfers: 1 });
  check('reasonable flight is comfort-qualified', comfortable.qualified === true, comfortable);
  const tooLong = service._internal.assessFlightComfort({ durationMinutes: 1925, transfers: 1 });
  check('Tokyo-style 1925 minute sample fails comfort', tooLong.qualified === false && tooLong.reasons.includes('duration-too-long'), tooLong);
  const tooManyStops = service._internal.assessFlightComfort({ durationMinutes: 700, transfers: 2 });
  check('two-transfer sample fails comfort', tooManyStops.qualified === false && tooManyStops.reasons.includes('too-many-transfers'), tooManyStops);

  cheapFlights._clearCache();
  const tulum = await service.verifyCityCoverage('tulum-mx', {
    months: ['2026-09'], checkIns: ['2026-11-18'], anchorOrigins: ['YTO'], adults: 1
  }, { _fetchFn: multiWindowFetch });
  check('Tulum live verification uses CUN gateway', tulum.live.travelpayouts.destinationCode === 'CUN' && tulum.live.travelpayouts.gatewayFallbackUsed === true, tulum.live.travelpayouts);
  check('Tulum remains a destination while gateway is metadata', tulum.cityId === 'tulum-mx' && tulum.staticMapping.travelpayouts.gateway?.airportCode === 'CUN');
  check('Tulum provider classification is gateway-supported', tulum.classification === 'gateway-supported', tulum.classification);
  check('injected Tulum evidence cannot activate production', tulum.productionActivation.eligible === false);

  cheapFlights._clearCache();
  const caye = await service.verifyCityCoverage('caye-caulker-bz', {
    months: ['2026-09'], checkIns: ['2026-11-18'], anchorOrigins: ['MIA'], adults: 1
  }, { _fetchFn: multiWindowFetch });
  check('Caye Caulker live verification uses BZE gateway', caye.live.travelpayouts.destinationCode === 'BZE' && caye.live.travelpayouts.gatewayFallbackUsed === true, caye.live.travelpayouts);

  cheapFlights._clearCache();
  const algiers = await service._internal.verifyTravelpayouts(
    staticAudit.records.find(record => record.cityId === 'algiers-dz'),
    { months: ['2026-09', '2026-10'], anchorOrigins: ['PAR'], maxFlightAttempts: 4 },
    { _fetchFn: multiWindowFetch }
  );
  check('multi-month flight retry finds later inventory', algiers.status === 'live' && algiers.verificationMonth === '2026-10', algiers);
  check('multi-month attempts retain empty first window', algiers.attempts.some(attempt => attempt.month === '2026-09' && attempt.observationCount === 0), algiers.attempts);

  const parisRecord = staticAudit.records.find(record => record.cityId === 'paris-fr');
  const agodaLater = await service._internal.verifyAgoda(parisRecord, {
    checkIns: ['2026-09-18', '2026-10-18', '2026-11-18'], adults: 1, nights: 2
  }, { _fetchFn: multiWindowFetch });
  check('multi-window Agoda retry finds later rate', agodaLater.status === 'live' && agodaLater.checkIn === '2026-11-18', agodaLater);
  check('Agoda attempts include earlier empty windows', agodaLater.attempts.filter(attempt => attempt.status === 'no-live-rate').length === 2, agodaLater.attempts);

  const agodaUnqualified = await service._internal.verifyAgoda(parisRecord, {
    checkIns: ['2026-09-18'], adults: 1, nights: 2
  }, { _fetchFn: unqualifiedAgodaFetch });
  check('raw Agoda inventory is separated from quality rate', agodaUnqualified.status === 'live-inventory-unqualified' && agodaUnqualified.inventoryObserved === true && agodaUnqualified.qualityQualifiedRate === false, agodaUnqualified);

  const productionReady = service._internal.classifyCoverage(parisRecord,
    { status: 'live', inventoryObserved: true, providerMappingVerified: true, productionEligible: true, comfortQualified: true, comfort: { qualified: true, reasons: [] } },
    { status: 'live', inventoryObserved: true, providerMappingVerified: true, productionEligible: true, qualityQualifiedRate: true }
  );
  check('production activation requires all separated signals', productionReady.providerCoverage.eligible === true && productionReady.recommendationReadiness.eligible === true && productionReady.productionActivation.eligible === true, productionReady);

  const comfortReview = service._internal.classifyCoverage(parisRecord,
    { status: 'live', inventoryObserved: true, providerMappingVerified: true, productionEligible: true, comfortQualified: false, comfort: { qualified: false, reasons: ['duration-too-long'] } },
    { status: 'live', inventoryObserved: true, providerMappingVerified: true, productionEligible: true, qualityQualifiedRate: true }
  );
  check('provider-covered city can still fail route comfort', comfortReview.providerCoverage.eligible === true && comfortReview.productionActivation.eligible === false && comfortReview.recommendationReadiness.reasons.some(reason => reason.includes('duration-too-long')), comfortReview);

  const stayQualityReview = service._internal.classifyCoverage(parisRecord,
    { status: 'live', inventoryObserved: true, providerMappingVerified: true, productionEligible: true, comfortQualified: true, comfort: { qualified: true, reasons: [] } },
    { status: 'live-inventory-unqualified', inventoryObserved: true, providerMappingVerified: true, productionEligible: false, qualityQualifiedRate: false }
  );
  check('provider-covered city can fail stay quality', stayQualityReview.providerCoverage.eligible === true && stayQualityReview.productionActivation.eligible === false && stayQualityReview.recommendationReadiness.reasons.includes('stay-quality:no-qualified-live-rate'), stayQualityReview);

  cheapFlights._clearCache();
  const injectedLive = await service.verifyCityCoverage('paris-fr', {
    months: ['2026-09'], checkIns: ['2026-11-18'], anchorOrigins: ['LON'], adults: 1
  }, { _fetchFn: allLiveFetch });
  check('injected providers are recognized functionally', injectedLive.live.travelpayouts.status === 'live' && injectedLive.live.agoda.status === 'live');
  check('injected evidence never verifies production mapping', injectedLive.providerCoverage.eligible === false && injectedLive.productionActivation.eligible === false);

  cheapFlights._clearCache();
  const empty = await service.verifyCityCoverage('paris-fr', {
    months: ['2026-09'], checkIns: ['2026-09-18'], anchorOrigins: ['LON'], adults: 1
  }, { _fetchFn: emptyFetch });
  check('empty multi-window result remains estimate-only', empty.classification === 'estimate-only' && empty.productionActivation.eligible === false, empty);

  cheapFlights._clearCache();
  const errors = await service.verifyCityCoverage('paris-fr', {
    months: ['2026-09'], checkIns: ['2026-09-18'], anchorOrigins: ['LON'], adults: 1
  }, { _fetchFn: providerErrorFetch });
  check('provider errors remain visible', errors.classification === 'provider-error' && errors.productionActivation.eligible === false, errors);

  const unknown = await service.verifyCityCoverage('not-a-city', {}, { _fetchFn: allLiveFetch });
  check('unknown city fails safely', unknown.ok === false && unknown.error === 'unknown-city-id');

  cheapFlights._clearCache();
  const oversizedIds = staticAudit.records.slice(0, 20).map(record => record.cityId);
  const batch = await service.verifyBatch({
    cityIds: oversizedIds, concurrency: 3, months: ['2026-09'], checkIns: ['2026-11-18'], anchorOrigins: ['LON'], adults: 1
  }, { _fetchFn: allLiveFetch, ignoreFeatureFlag: true });
  check('batch remains hard capped at 10', batch.requestedCount === 10 && batch.records.length === 10);
  check('batch exposes provider coverage and production counts separately', Number.isInteger(batch.providerCoverageEligibleCount) && Number.isInteger(batch.productionActiveCount));
  check('batch includes 668D verification policy', batch.verificationPolicy.gatewayFallbackRepair === true && batch.verificationPolicy.comfortQualificationRequired === true, batch.verificationPolicy);
  check('batch never activates injected evidence', batch.productionActiveCount === 0);

  const merged = service.mergeResultsIntoSnapshot([tulum, caye, injectedLive]);
  check('snapshot merge preserves 1000 records', merged.records.length === 1000);
  check('snapshot merge marks 668D policy', merged.taskId === 'GV-CITY-668D' && merged.policy.multiWindowFlightVerification === true);
  check('snapshot summary separates provider coverage count', Number.isInteger(merged.summary.providerCoverageEligibleCount));

  const summary = service.snapshotSummary();
  check('public summary reports 668D', summary.version === 'GV-CITY-668D' && summary.policy.gatewayFallbackRepair === true, summary);
  check('admin token accepts exact header', service.isAuthorized({ 'x-gv-admin-token': 'validation-admin-token' }) === true);
  check('admin token rejects wrong header', service.isAuthorized({ 'x-gv-admin-token': 'wrong' }) === false);

  const getResponse = await lambda.handler({ rawPath: '/api/provider-live-coverage', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} });
  const getBody = JSON.parse(getResponse.body);
  check('Lambda summary endpoint reports 668D', getResponse.statusCode === 200 && getBody.version === 'GV-CITY-668D');
  const denied = await lambda.handler({ rawPath: '/api/provider-live-coverage/verify', requestContext: { http: { method: 'POST' } }, headers: {}, body: JSON.stringify({ cityIds: ['toronto-ca'] }) });
  check('Lambda verifier remains protected', denied.statusCode === 403);
  const wrongMethod = await lambda.handler({ rawPath: '/api/provider-live-coverage/verify', requestContext: { http: { method: 'GET' } }, headers: {} });
  check('Lambda verifier still requires POST', wrongMethod.statusCode === 405);

  process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'false';
  process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'false';
  const disabled = await service.verifyBatch({ cityIds: ['toronto-ca'] }, { _fetchFn: allLiveFetch });
  check('both feature flags can disable verification', disabled.ok === false && disabled.error === 'feature-disabled');
  process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
  process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668D',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668D.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
