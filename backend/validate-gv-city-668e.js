'use strict';

const fs = require('fs');
const path = require('path');
process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_LIVE_PROVIDER_COVERAGE_668C = 'true';
process.env.ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D = 'true';
process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';
process.env.TRAVELPAYOUTS_TOKEN = 'validation-token-not-production';
process.env.AGODA_SITE_ID = 'validation-site';
process.env.AGODA_API_KEY = 'validation-key-not-production';
process.env.GV_PROVIDER_COVERAGE_ADMIN_TOKEN = 'validation-admin-token';
process.env.GV_PROVIDER_COVERAGE_MAX_BATCH = '10';
process.env.GLOBEVOY_USE_MOCKS = 'false';
process.env.ENABLE_PRICE_AUDIT_610D = 'true';

const service = require('./services/admin/audits/provider-live-coverage');
const agodaService = require('./services/agoda');
const lambda = require('./lambda');
const staticAudit = require('./data/provider-mappings-1000-668b.json');
const quality13 = require('./data/provider-live-quality-review-13-668e.json');
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
    departure_at: `${date}T10:00:00Z`, return_at: `${date}T15:00:00Z`, price,
    airline: 'XX', flight_number: '101', transfers, duration, link: '/search/YTO1810PAR1'
  };
}
function goodHotel(overrides = {}) {
  return {
    hotelId: 9001,
    hotelName: 'Validation Grand Hotel',
    dailyRate: 120,
    currency: 'CAD',
    landingURL: 'https://www.agoda.com/partners/partnersearch.aspx?hid=9001',
    reviewScore: 8.7,
    starRating: 4,
    reviewCount: 250,
    ...overrides
  };
}
function poorHotel(index = 1, overrides = {}) {
  return {
    hotelId: 1000 + index,
    hotelName: `Budget Backpacker Hostel ${index}`,
    dailyRate: 35,
    currency: 'CAD',
    landingURL: `https://www.agoda.com/partners/partnersearch.aspx?hid=${1000 + index}`,
    reviewScore: 6.1,
    starRating: 2,
    reviewCount: 8,
    ...overrides
  };
}
function bodyFrom(options = {}) {
  try { return JSON.parse(options.body || '{}'); } catch (_) { return {}; }
}
function urlParam(url, key) {
  try { return new URL(String(url)).searchParams.get(key); } catch (_) { return null; }
}

const seenAgodaRequests = [];
function qualityRecoveryFetch(url, options = {}) {
  if (String(url).includes('api.travelpayouts.com')) {
    const month = urlParam(url, 'departure_at') || '2026-09';
    return Promise.resolve(response({ data: [flightRow({ date: `${month}-18` })] }));
  }
  const body = bodyFrom(options);
  const additional = body?.criteria?.additional || {};
  seenAgodaRequests.push({ sortBy: additional.sortBy, maxResult: additional.maxResult, minimumReviewScore: additional.minimumReviewScore, minimumStarRating: additional.minimumStarRating });
  if (additional.sortBy === 'Recommended') {
    return Promise.resolve(response({ results: Array.from({ length: 30 }, (_, index) => poorHotel(index + 1)) }));
  }
  if (additional.sortBy === 'AllGuestsReviewScore') {
    return Promise.resolve(response({ results: [goodHotel(), ...Array.from({ length: 8 }, (_, index) => poorHotel(index + 40))] }));
  }
  return Promise.resolve(response({ results: [goodHotel({ hotelId: 9100 })] }));
}

function allUnqualifiedFetch(url, options = {}) {
  if (String(url).includes('api.travelpayouts.com')) return Promise.resolve(response({ data: [flightRow()] }));
  const body = bodyFrom(options);
  const additional = body?.criteria?.additional || {};
  const bad = [
    poorHotel(1),
    goodHotel({ hotelId: 2, hotelName: 'Tiny Review Hotel', reviewCount: 2 }),
    goodHotel({ hotelId: 3, hotelName: 'Ambiguous Rate Hotel', dailyRate: undefined, price: 90 }),
    goodHotel({ hotelId: 4, hotelName: 'Impossible Price Hotel', dailyRate: 1 })
  ];
  return Promise.resolve(response({ results: bad.slice(0, additional.maxResult || 10) }));
}

function customerEstimatorFetch(url, options = {}) {
  if (String(url).includes('api.travelpayouts.com')) return Promise.resolve(response({ data: [flightRow()] }));
  const body = bodyFrom(options);
  seenAgodaRequests.push({ customerEstimator: true, sortBy: body?.criteria?.additional?.sortBy, maxResult: body?.criteria?.additional?.maxResult });
  return Promise.resolve(response({ results: [goodHotel()] }));
}

(async () => {
  check('service version is 668E', service.VERSION === 'GV-CITY-668E');
  check('668E feature is enabled', service.enabled() === true && agodaService.qualityCandidateRetrievalEnabled() === true);
  check('quality review list contains 13 unique cities', quality13.cityIds.length === 13 && new Set(quality13.cityIds).size === 13, quality13.cityIds);
  check('quality review list includes key false negatives', ['lahore-pk','bangkok-th','delhi-in','jakarta-id'].every(id => quality13.cityIds.includes(id)));

  const strategies = agodaService.buildQualityCandidateStrategies({ strategyCount: 3, maxResult: 99 });
  check('three supported quality strategies are available', strategies.map(item => item.sortBy).join(',') === 'Recommended,AllGuestsReviewScore,StarRatingDesc', strategies);
  check('Agoda city-search maxResult is hard capped at 30', strategies.every(item => item.maxResult === 30), strategies);
  const defaultStrategies = agodaService.buildQualityCandidateStrategies({});
  check('default audit uses two bounded quality strategies', defaultStrategies.length === 2 && defaultStrategies[0].sortBy === 'Recommended' && defaultStrategies[1].sortBy === 'AllGuestsReviewScore', defaultStrategies);

  const rejectionReasons = agodaService.qualityRejectionReasons(poorHotel(1));
  check('low-trust hotel exposes structural rejection reasons', ['low-trust-property-type','review-score-below-7','star-rating-below-3','review-count-below-25'].every(reason => rejectionReasons.includes(reason)), rejectionReasons);

  const parisRecord = staticAudit.records.find(record => record.cityId === 'paris-fr');
  const destination = { id: 'paris-fr', city: 'Paris', agodaCityId: Number(parisRecord.agoda.cityId), fallbackNightlyUsd: 85 };
  seenAgodaRequests.length = 0;
  const probe = await agodaService.fetchAgodaCoverageProbe({
    destination, nights: 2, checkIn: '2026-09-18', currency: 'CAD', adults: 2, rooms: 1,
    qualityCandidateStrategyCount: 2, qualityCandidateMaxResult: 30, _fetchFn: qualityRecoveryFetch
  });
  check('first poor candidate slice does not end the audit', probe.strategyAttempts.length === 2 && probe.strategyAttempts[0].status === 'live-inventory-unqualified', probe.strategyAttempts);
  check('second review-sorted slice recovers a qualified hotel', probe.qualityQualifiedRate === true && probe.selectedStrategy?.sortBy === 'AllGuestsReviewScore', probe);
  check('quality recovery returns the trusted hotel sample', probe.sample?.hotelName === 'Validation Grand Hotel' && probe.sample?.rating === 8.7, probe.sample);
  check('quality retrieval requests 30 candidates per strategy', seenAgodaRequests.length === 2 && seenAgodaRequests.every(item => item.maxResult === 30), seenAgodaRequests);
  check('quality retrieval requests provider quality filters', seenAgodaRequests.every(item => item.minimumReviewScore === 7 && item.minimumStarRating === 3), seenAgodaRequests);
  check('rejection diagnostics retain low-trust reasons', Number(probe.rejectionReasons['low-trust-property-type'] || 0) >= 1, probe.rejectionReasons);

  const badProbe = await agodaService.fetchAgodaCoverageProbe({
    destination, nights: 2, checkIn: '2026-09-18', currency: 'CAD', adults: 2, rooms: 1,
    qualityCandidateStrategyCount: 2, qualityCandidateMaxResult: 30, _fetchFn: allUnqualifiedFetch
  });
  check('unqualified inventory remains visible but not recommendation-ready', badProbe.inventoryObserved === true && badProbe.qualityQualifiedRate === false, badProbe);
  check('ambiguous price unit is recorded', Number(badProbe.rejectionReasons['ambiguous-price-unit'] || 0) >= 1, badProbe.rejectionReasons);
  check('implausibly low price is recorded', Number(badProbe.rejectionReasons['implausibly-low-live-rate'] || 0) >= 1, badProbe.rejectionReasons);
  check('thin review evidence is recorded', Number(badProbe.rejectionReasons['review-count-below-25'] || 0) >= 1, badProbe.rejectionReasons);

  seenAgodaRequests.length = 0;
  await agodaService.fetchAgodaStayEstimate({ destination, nights: 2, month: '2026-09-18', currency: 'CAD', adults: 2, rooms: 1, _fetchFn: customerEstimatorFetch });
  const customerRequest = seenAgodaRequests.find(item => item.customerEstimator);
  check('customer stay estimator remains price-sorted and unchanged', customerRequest?.sortBy === 'PriceAsc' && customerRequest?.maxResult === 10, customerRequest);

  cheapFlights._clearCache();
  seenAgodaRequests.length = 0;
  const recoveredCity = await service.verifyCityCoverage('bangkok-th', {
    months: ['2026-09'], checkIns: ['2026-09-18'], anchorOrigins: ['SIN'], adults: 2, rooms: 1,
    agodaQualityStrategyCount: 2, agodaQualityMaxResult: 30
  }, { _fetchFn: qualityRecoveryFetch });
  check('city verifier exposes 668E candidate mode', recoveredCity.live.agoda.candidateRetrievalMode === 'quality-diversified-668e', recoveredCity.live.agoda);
  check('city verifier records selected review strategy', recoveredCity.live.agoda.selectedStrategy?.sortBy === 'AllGuestsReviewScore', recoveredCity.live.agoda.selectedStrategy);
  check('functional provider coverage is restored by broader candidates', recoveredCity.classification === 'live-both', recoveredCity.classification);
  check('injected evidence still cannot activate production', recoveredCity.productionActivation.eligible === false && recoveredCity.providerCoverage.eligible === false, recoveredCity.productionActivation);

  const policyBatch = await service.verifyBatch({
    cityIds: ['bangkok-th'], months: ['2026-09'], checkIns: ['2026-09-18'], anchorOrigins: ['SIN'], adults: 2,
    agodaQualityStrategyCount: 2, agodaQualityMaxResult: 30
  }, { _fetchFn: qualityRecoveryFetch, ignoreFeatureFlag: true });
  check('batch reports 668E Agoda quality policy', policyBatch.version === 'GV-CITY-668E' && policyBatch.verificationPolicy.agodaQualityCandidateRetrieval === true, policyBatch.verificationPolicy);
  check('batch reports bounded strategy and result counts', policyBatch.verificationPolicy.agodaQualityStrategyCount === 2 && policyBatch.verificationPolicy.agodaQualityMaxResult === 30, policyBatch.verificationPolicy);

  const summary = service.snapshotSummary();
  check('public summary reports 668E', summary.version === 'GV-CITY-668E' && summary.policy.agodaQualityCandidateRetrieval === true, summary);
  check('public summary documents supported sort strategies', summary.policy.agodaCandidateSorts.includes('Recommended') && summary.policy.agodaCandidateSorts.includes('AllGuestsReviewScore'), summary.policy);

  const merged = service.mergeResultsIntoSnapshot([recoveredCity]);
  check('snapshot merge preserves 1000 records', merged.records.length === 1000);
  check('snapshot merge marks 668E policy', merged.taskId === 'GV-CITY-668E' && merged.policy.agodaQualityCandidateRetrieval === true, merged.policy);
  check('snapshot merge uses new version', merged.version === '1.2.0');

  const getResponse = await lambda.handler({ rawPath: '/api/provider-live-coverage', requestContext: { http: { method: 'GET' } }, queryStringParameters: {} });
  const getBody = JSON.parse(getResponse.body);
  check('Lambda summary endpoint reports 668E', getResponse.statusCode === 200 && getBody.version === 'GV-CITY-668E');
  const denied = await lambda.handler({ rawPath: '/api/provider-live-coverage/verify', requestContext: { http: { method: 'POST' } }, headers: {}, body: JSON.stringify({ cityIds: ['toronto-ca'] }) });
  check('Lambda verifier remains protected', denied.statusCode === 403);
  check('admin token still authorizes exact value', service.isAuthorized({ 'x-gv-admin-token': 'validation-admin-token' }) === true);
  check('admin token still rejects wrong value', service.isAuthorized({ 'x-gv-admin-token': 'wrong' }) === false);

  // Key 668D regressions retained.
  const tulumRecord = staticAudit.records.find(record => record.cityId === 'tulum-mx');
  const tulumCandidates = service._internal.flightDestinationCandidates(tulumRecord);
  check('Tulum CUN gateway repair remains intact', tulumCandidates[0]?.code === 'CUN' && tulumCandidates[0]?.kind === 'gateway', tulumCandidates);
  const cayeRecord = staticAudit.records.find(record => record.cityId === 'caye-caulker-bz');
  const cayeCandidates = service._internal.flightDestinationCandidates(cayeRecord);
  check('Caye Caulker BZE gateway repair remains intact', cayeCandidates[0]?.code === 'BZE' && cayeCandidates[0]?.kind === 'gateway', cayeCandidates);
  check('three flight months remain supported', service._internal.flightMonths({ month: '2026-09', monthCount: 3 }).join(',') === '2026-09,2026-10,2026-11');
  check('three stay windows remain supported', service._internal.stayCheckIns({ checkIn: '2026-09-18', stayWindowCount: 3, stayWindowSpacingDays: 30 }).length === 3);
  const tooLong = service._internal.assessFlightComfort({ durationMinutes: 1925, transfers: 1 });
  check('flight comfort guard remains strict', tooLong.qualified === false && tooLong.reasons.includes('duration-too-long'), tooLong);

  process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'false';
  const legacyStrategies = agodaService.buildQualityCandidateStrategies({});
  check('668E can roll back to legacy candidate retrieval', legacyStrategies.length === 1 && legacyStrategies[0].sortBy === 'PriceAsc' && legacyStrategies[0].maxResult === 10, legacyStrategies);
  process.env.ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E = 'true';

  const passed = checks.filter(item => item.pass).length;
  const result = {
    taskId: 'GV-CITY-668E',
    generatedAt: new Date().toISOString(),
    passed,
    failed: checks.length - passed,
    total: checks.length,
    checks
  };
  fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_CITY_668E.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
  if (passed !== checks.length) process.exitCode = 1;
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
