'use strict';

const assert = require('assert');

// Enable validation-only injected evidence before loading modules that inspect env.
process.env.ENABLE_STAY22_EVIDENCE_682B = 'true';
process.env.STAY22_ALLOW_DEMO_682B = 'true';
process.env.STAY22_PRODUCTION_APPROVED_682B = 'true';
process.env.STAY22_API_KEY = 'validation-only-key';
process.env.ENABLE_STAY22_P2_DATE_PRICING_682B = 'true';
process.env.GV_ALLOW_INJECTED_PROVIDER_EVIDENCE_FOR_VALIDATION = 'true';

const stay22 = require('./services/stay22-evidence-682b');
const live = require('./services/domain/live-fares/live-provider-verification');
const canonical = require('./services/domain/pricing/canonical-total-evidence');
const optimizer = require('./services/domain/routing/whole-trip-date-optimizer-681b-p2');
const generated = require('./generated-tour');

let passed = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function response(payload, status = 200, headers = {}) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [String(k).toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: key => lower[String(key).toLowerCase()] ?? null },
    text: async () => JSON.stringify(payload)
  };
}
function stayPayload({ name = 'Hilton Garden Inn Ottawa Downtown', total = 789, currency = 'USD', checkin = '2026-08-27', checkout = '2026-08-30', alternative = true } = {}) {
  const results = [{
    id: 'target-1', name, type: 'Hotel',
    rating: { value: 8.4, hotelStars: 4, count: 522 },
    location: { address: 'Ottawa, Canada' },
    suppliers: { booking: { id: 'booking-target', link: 'https://www.stay22.com/target', price: { total } } }
  }];
  if (alternative) results.push({
    id: 'alt-1', name: 'Budget Alternative Suites', type: 'Hotel',
    rating: { value: 8.1, hotelStars: 3, count: 310 },
    location: { address: 'Ottawa, Canada' },
    suppliers: { expedia: { id: 'exp-alt', link: 'https://www.stay22.com/alt', price: { total: Math.max(50, total - 300) } } }
  });
  return { meta: { currency, checkin, checkout, nights: 3 }, results };
}

const baseQuery = {
  city: 'Ottawa', country: 'Canada', checkIn: '2026-08-27', checkOut: '2026-08-30',
  adults: 1, children: 0, rooms: 1, currency: 'USD', targetProperty: 'Hilton Garden Inn Ottawa Downtown'
};

test('682B version and feature flag are active', () => {
  assert.equal(stay22.STAY22_EVIDENCE_VERSION_682B, 'GV-PROVIDER-682B');
  assert.equal(stay22.enabled(process.env), true);
  assert.equal(generated.STAY22_EVIDENCE_VERSION_682B, 'GV-PROVIDER-682B');
});

test('request preserves exact stay inputs and diagnostics never expose key', async () => {
  stay22.clearCache();
  let seenUrl = null;
  let seenHeaders = null;
  const result = await stay22.fetchStay22Evidence(baseQuery, process.env, {
    _fetchFn: async (url, options) => { seenUrl = new URL(String(url)); seenHeaders = options.headers; return response(stayPayload(), 200); }
  });
  assert.equal(seenUrl.searchParams.get('checkin'), '2026-08-27');
  assert.equal(seenUrl.searchParams.get('checkout'), '2026-08-30');
  assert.equal(seenUrl.searchParams.get('adults'), '1');
  assert.equal(seenUrl.searchParams.get('rooms'), '1');
  assert.equal(seenUrl.searchParams.get('currency'), 'USD');
  assert.equal(seenUrl.searchParams.get('hotelsearch'), 'Hilton Garden Inn Ottawa Downtown');
  assert.equal(seenHeaders['X-API-KEY'], 'validation-only-key');
  assert(!String(result.requestUrl || '').includes('validation-only-key'));
  assert(!String(result.requestUrl || '').includes('key='));
});

test('strong same-property match wins over cheaper city alternative', async () => {
  stay22.clearCache();
  const result = await stay22.fetchStay22Evidence(baseQuery, process.env, { _fetchFn: async () => response(stayPayload()) });
  assert(result.exactPropertyMatch);
  assert.equal(result.exactPropertyMatch.propertyName, 'Hilton Garden Inn Ottawa Downtown');
  assert.equal(result.exactPropertyMatch.total, 789);
  assert.equal(result.cityBenchmark, null);
  assert.equal(result.exactPropertyMatch.evidenceRole, 'same-property-rate');
  assert.equal(result.exactPropertyMatch.total, 789);
});

test('production eligibility requires both key and explicit approval', async () => {
  stay22.clearCache();
  const noKey = { ...process.env, STAY22_API_KEY: '', STAY22_ALLOW_DEMO_682B: 'true', STAY22_PRODUCTION_APPROVED_682B: 'true' };
  const demo = await stay22.fetchStay22Evidence(baseQuery, noKey, { _fetchFn: async () => response(stayPayload()) });
  assert.equal(demo.productionEligible, false);
  stay22.clearCache();
  const unapproved = { ...process.env, STAY22_API_KEY: 'k', STAY22_PRODUCTION_APPROVED_682B: 'false' };
  const candidate = await stay22.fetchStay22Evidence(baseQuery, unapproved, { _fetchFn: async () => response(stayPayload()) });
  assert.equal(candidate.productionEligible, false);
  stay22.clearCache();
  const approved = { ...process.env, STAY22_API_KEY: 'k', STAY22_PRODUCTION_APPROVED_682B: 'true' };
  const liveCandidate = await stay22.fetchStay22Evidence(baseQuery, approved, { _fetchFn: async () => response(stayPayload()) });
  assert.equal(liveCandidate.productionEligible, true);
});

test('untargeted search can attach city benchmark without exact-property semantics', async () => {
  stay22.clearCache();
  const payload = stayPayload({ name: 'Completely Different Property', total: 420, alternative: false });
  const result = await stay22.fetchStay22Evidence({ ...baseQuery, targetProperty: null }, process.env, { _fetchFn: async () => response(payload) });
  assert.equal(result.exactPropertyMatch, null);
  assert(result.cityBenchmark);
  assert.equal(result.status, 'city-benchmark-only');
  assert.equal(result.cityBenchmark.evidenceRole, 'city-stay-benchmark-only');
});

test('memory cache avoids duplicate Stay22 network calls', async () => {
  stay22.clearCache();
  let calls = 0;
  const fetchFn = async () => { calls += 1; return response(stayPayload()); };
  const first = await stay22.fetchStay22Evidence(baseQuery, process.env, { _fetchFn: fetchFn });
  const second = await stay22.fetchStay22Evidence(baseQuery, process.env, { _fetchFn: fetchFn });
  assert.equal(calls, 1);
  assert.equal(first.cache.hit, false);
  assert.equal(second.cache.hit, true);
});

test('verifyStay applies only approved exact same-property rate and preserves Agoda handoff', async () => {
  stay22.clearCache();
  const stop = {
    city: 'Ottawa', country: 'Canada', nights: 3, arrivalDate: '2026-08-27', departureDate: '2026-08-30',
    hotel: {
      name: 'Hilton Garden Inn Ottawa Downtown', hotelName: 'Hilton Garden Inn Ottawa Downtown',
      estimatedStayUsd: 549, estimatedNightlyUsd: 183,
      providerHotel: { provider: 'Agoda', hotelName: 'Hilton Garden Inn Ottawa Downtown', hotelId: 'agoda-123', bookingUrl: 'https://www.agoda.com/example', linkType: 'provider-search-results' }
    }
  };
  const result = await live._internal.verifyStay(stop, { currency: 'USD', adults: 1, rooms: 1 }, {
    _stay22FetchFn: async () => response(stayPayload()),
    _agodaFetchFn: async () => response({ message: 'not used for winning evidence' }, 503)
  });
  assert.equal(result.outcome, 'verified-stay22');
  assert.equal(result.stop.hotel.estimatedStayUsd, 789);
  assert.equal(result.stop.hotel.providerVerification.rateProvider, 'Stay22');
  assert.equal(result.stop.hotel.providerVerification.productionEligible, true);
  assert.equal(result.stop.hotel.providerHotel.provider, 'Agoda');
  assert.equal(result.stop.hotel.providerHotel.bookingUrl, 'https://www.agoda.com/example');
  assert.equal(result.stop.hotel.providerVerification.bookingHandoffUnchanged, true);
});

test('unmatched city benchmark never replaces selected hotel estimate', async () => {
  stay22.clearCache();
  const stop = {
    city: 'Ottawa', country: 'Canada', nights: 3, arrivalDate: '2026-08-27', departureDate: '2026-08-30',
    hotel: { name: 'Hilton Garden Inn Ottawa Downtown', estimatedStayUsd: 549, estimatedNightlyUsd: 183 }
  };
  const unmatched = stayPayload({ name: 'Different Ottawa Hotel', total: 300, alternative: false });
  const result = await live._internal.verifyStay(stop, { currency: 'USD', adults: 1, rooms: 1 }, {
    _stay22FetchFn: async () => response(unmatched),
    _agodaFetchFn: async () => response({ message: 'provider unavailable' }, 503)
  });
  assert.notEqual(result.outcome, 'verified-stay22');
  assert.equal(result.stop.hotel.estimatedStayUsd, 549);
  assert.equal(result.stop.hotel.estimatedStayUsd, 549);
  assert.equal(result.stop.hotel.providerVerification.verified, false);
});

test('canonical ledger counts approved Stay22 exact rate as verified critical stay', async () => {
  stay22.clearCache();
  const stop = {
    city: 'Ottawa', country: 'Canada', nights: 3, arrivalDate: '2026-08-27', departureDate: '2026-08-30',
    hotel: { name: 'Hilton Garden Inn Ottawa Downtown', estimatedStayUsd: 549, estimatedNightlyUsd: 183 }
  };
  const verified = await live._internal.verifyStay(stop, { currency: 'USD', adults: 1, rooms: 1 }, {
    _stay22FetchFn: async () => response(stayPayload()),
    _agodaFetchFn: async () => response({}, 503)
  });
  const evidence = canonical._internal.stayEvidence(verified.stop);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.provider, 'Stay22');
  assert.equal(evidence.sourceType, 'LIVE');
});

test('P2 mixed total can use exact Stay22 same-property total without changing flight coverage rule', async () => {
  const providerResults = [
    { observations: [{ departureDate: '2026-08-27', price: 100, currency: 'USD', durationMinutes: 120, transfers: 0 }] },
    { observations: [{ departureDate: '2026-08-30', price: 80, currency: 'USD', durationMinutes: 90, transfers: 0 }] },
    { observations: [{ departureDate: '2026-09-01', price: 90, currency: 'USD', durationMinutes: 110, transfers: 0 }] }
  ];
  const legs = [{ mode: 'flight' }, { mode: 'flight' }, { mode: 'flight' }];
  const stops = [{ nights: 3 }, { nights: 2 }];
  const baseline = optimizer.evaluateCandidate({
    startDate: '2026-08-27', stops, legs, providerResults,
    isFlightLeg: () => true, convertProviderPriceToUsd: p => Number(p), hotelEstimateUsd: 500
  });
  const withStay22 = optimizer.evaluateCandidate({
    startDate: '2026-08-27', stops, legs, providerResults,
    isFlightLeg: () => true, convertProviderPriceToUsd: p => Number(p), hotelEstimateUsd: 500,
    hotelPricing: { totalUsd: 420, exactMatchedStayCount: 1, requiredStayCount: 2, basis: 'stay22-same-property-exact-stay-rates-plus-unmatched-planning-estimates', evidence: [{ applied: true }] }
  });
  assert.equal(withStay22.completeProviderFlightCoverage, true);
  assert.equal(withStay22.hotelEstimateUsd, 420);
  assert.equal(withStay22.stay22ExactMatchedStayCount, 1);
  assert.equal(baseline.mixedEvidenceTotalUsd - withStay22.mixedEvidenceTotalUsd, 80);
});

(async () => {
  for (const item of tests) {
    await item.fn();
    passed += 1;
  }
  console.log(`PASS ${passed}/${tests.length} - GV-PROVIDER-682B backend`);
})().catch(error => {
  console.error('FAIL - GV-PROVIDER-682B backend');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
