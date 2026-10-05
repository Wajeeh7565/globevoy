'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const adapter = require('./services/providers/flights/duffel/duffel-live-adapter-683d');
const router = require('./services/providers/flights/flight-provider-router-683c');

let passed = 0;
function pass(name) { passed += 1; console.log(`PASS ${name}`); }
function restoreEnv(name, value) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }

function duffelOffer({
  origin = 'YYZ', destination = 'LIS', date = '2026-09-09', amount = '312.80', currency = 'USD',
  liveMode = true, expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(), duration = 'PT7H5M',
  carrier = 'Air Transat', carrierCode = 'TS', flightNumber = '0480', id = 'off_validation_683d'
} = {}) {
  return {
    id,
    live_mode: liveMode,
    total_amount: amount,
    total_currency: currency,
    expires_at: expiresAt,
    owner: { name: carrier, iata_code: carrierCode },
    slices: [{
      origin: { iata_code: origin },
      destination: { iata_code: destination },
      duration,
      segments: [{
        origin: { iata_code: origin }, destination: { iata_code: destination },
        departing_at: `${date}T21:30:00`, arriving_at: '2026-09-10T09:35:00',
        operating_carrier: { name: carrier }, operating_carrier_flight_number: flightNumber
      }]
    }]
  };
}

function fakeResponse(offers, { liveMode = true, status = 200, responseHeaders = {}, errorBody = null } = {}) {
  const normalizedHeaders = Object.fromEntries(Object.entries(responseHeaders || {}).map(([k,v]) => [String(k).toLowerCase(), String(v)]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return normalizedHeaders[String(name || '').toLowerCase()] ?? null; } },
    async text() {
      if (errorBody) return JSON.stringify(errorBody);
      return JSON.stringify({ data: { id: 'orq_validation_683d', live_mode: liveMode, offers } });
    }
  };
}

(async () => {
  const oldEnable = process.env.ENABLE_DUFFEL_LIVE_683D;
  const oldShadow = process.env.ENABLE_DUFFEL_SHADOW_683D;
  const oldDuffel = process.env.DUFFEL_ACCESS_TOKEN;
  const oldAdmin = process.env.GV_PROVIDER_COVERAGE_ADMIN_TOKEN;
  const oldFetch = globalThis.fetch;

  try {
    delete process.env.ENABLE_DUFFEL_LIVE_683D;
    delete process.env.ENABLE_DUFFEL_SHADOW_683D;
    delete process.env.DUFFEL_ACCESS_TOKEN;

    // 1. Feature defaults fail closed and expose no secret value.
    const status0 = adapter.status683D();
    assert.equal(status0.enabled, false);
    assert.equal(status0.shadowEnabled, false);
    assert.equal(status0.productionApproved, false);
    assert.equal(status0.rankingEnabled, false);
    assert.equal(status0.secretValuesReturned, false);
    pass('683D defaults shadow/ranking off and secret-safe');

    // 2. Exact-search validation is strict.
    const bad = adapter.validateExactSearch683D({ origin: 'YY', destination: 'LIS', departureDate: 'bad', currency: 'CAD' });
    assert.equal(bad.valid, false);
    assert.ok(bad.errors.includes('invalid-origin'));
    assert.ok(bad.errors.includes('invalid-departure-date'));
    pass('683D exact request validation fails closed');

    // 3. Test tokens can never feed the live adapter.
    process.env.ENABLE_DUFFEL_LIVE_683D = 'true';
    process.env.ENABLE_DUFFEL_SHADOW_683D = 'true';
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_test_validation_only';
    let called = 0;
    const testToken = await adapter.searchExactDate683D({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'USD' }, { fetch: async () => { called += 1; return fakeResponse([]); } });
    assert.equal(testToken.supported, false);
    assert.match(testToken.reason, /live-token-required/);
    assert.equal(called, 0);
    pass('683D rejects Duffel test token before network');

    // 4. Live search uses only the offer-request endpoint and requested passenger count.
    process.env.DUFFEL_ACCESS_TOKEN = 'duffel_live_validation_only';
    let requestUrl = null;
    let requestInit = null;
    const raw = await adapter.searchExactDate683D({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'USD', passengers: 2 }, {
      fetch: async (url, init) => { requestUrl = url; requestInit = init; return fakeResponse([duffelOffer()]); }
    });
    assert.equal(raw.supported, true);
    assert.match(requestUrl, /\/air\/offer_requests\?/);
    assert.doesNotMatch(requestUrl, /\/air\/orders|payment|ticket/i);
    const sent = JSON.parse(requestInit.body);
    assert.equal(sent.data.slices.length, 1);
    assert.equal(sent.data.slices[0].origin, 'YYZ');
    assert.equal(sent.data.slices[0].destination, 'LIS');
    assert.equal(sent.data.slices[0].departure_date, '2026-09-09');
    assert.equal(sent.data.passengers.length, 2);
    pass('683D live call is allowlisted offer-request only');

    // 5. Shadow router canonicalizes live Duffel evidence while keeping production approval false.
    const routed = await router.fetchDuffelShadow683D({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'USD', passengers: 1 }, {
      fetch: async () => fakeResponse([duffelOffer()])
    });
    assert.equal(routed.supported, true);
    assert.equal(routed.observations.length, 1);
    const obs = routed.observations[0];
    assert.equal(obs.provider, 'duffel-live-683d');
    assert.equal(obs.providerEvidenceClass, 'LIVE_PROVIDER');
    assert.equal(obs.providerRankingGrade, 'DECISION_GRADE');
    assert.equal(obs.priceEvidence.sourceType, 'LIVE');
    assert.equal(obs.priceEvidence.isBookable, false);
    assert.equal(obs.liveMode, true);
    assert.ok(obs.expiresAt);
    assert.equal(obs.providerEndpoint, '/air/offer_requests');
    assert.equal(routed.providerContract.provider.productionApproved, false);
    pass('683D shadow evidence canonicalizes live with lifecycle metadata');

    // 6. Provider-returned currency is never overwritten by the requested currency.
    const mismatch = await router.fetchDuffelShadow683D({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'CAD' }, {
      fetch: async () => fakeResponse([duffelOffer({ currency: 'USD' })])
    });
    assert.equal(mismatch.supported, true);
    assert.equal(mismatch.observations[0].currency, 'USD');
    assert.equal(mismatch.observations[0].requestedCurrency, 'CAD');
    assert.equal(mismatch.observations[0].currencyMismatch, true);
    assert.equal(mismatch.observations[0].priceEvidence.sourceType, 'UNAVAILABLE');
    pass('683D preserves currency mismatch and blocks unsafe price evidence');

    // 7. Expired/almost-expired offers are discarded.
    const expired = await adapter.searchExactDate683D({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'USD' }, {
      fetch: async () => fakeResponse([duffelOffer({ expiresAt: new Date(Date.now() + 5000).toISOString() })])
    });
    assert.equal(expired.supported, false);
    assert.match(expired.reason, /no-valid-exact-live-offers/);
    pass('683D rejects expired or near-expiry offers');

    // 8. Wrong-route/date offers are discarded rather than relabeled exact.
    const wrong = await adapter.searchExactDate683D({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'USD' }, {
      fetch: async () => fakeResponse([duffelOffer({ origin: 'JFK', destination: 'CUN', date: '2026-09-01' })])
    });
    assert.equal(wrong.supported, false);
    pass('683D rejects route/date contamination');

    // 9. Standard provider-router selection cannot activate Duffel ranking in 683D.
    const standard = await router.fetchFlightDates683C({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', month: '2026-09', currency: 'USD' }, { providerId: 'duffel-live-683d' });
    assert.equal(standard.supported, false);
    assert.match(standard.reason, /shadow-only-not-ranking-enabled/);
    pass('683D cannot accidentally enter P1/P2 ranking');

    // 10. Travelpayouts remains the selected/default provider while Duffel is visible as shadow capability.
    const summary = router.adapterSummary683C();
    assert.equal(summary.defaultProvider, 'travelpayouts-aviasales-data');
    assert.equal(summary.selectedProvider, 'travelpayouts-aviasales-data');
    const d = summary.adapters.find(x => x.id === 'duffel-live-683d');
    assert.ok(d);
    assert.equal(d.productionApproved, false);
    assert.equal(d.evidenceClass, 'LIVE_PROVIDER');
    pass('683D preserves Travelpayouts default and exposes Duffel shadow descriptor');

    // 11. Lambda shadow endpoint is admin-gated.
    process.env.GV_PROVIDER_COVERAGE_ADMIN_TOKEN = 'validation-admin-token';
    delete require.cache[require.resolve('./lambda')];
    const lambda = require('./lambda');
    const denied = await lambda.handler({ rawPath: '/api/provider-flight-shadow/duffel-683d', requestContext: { http: { method: 'POST' } }, headers: {}, body: JSON.stringify({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'USD' }) });
    assert.equal(denied.statusCode, 403);
    pass('683D shadow API requires admin authorization');

    // 12. Authorized endpoint returns normalized shadow evidence without token material.
    globalThis.fetch = async () => fakeResponse([duffelOffer()]);
    const allowed = await lambda.handler({
      rawPath: '/api/provider-flight-shadow/duffel-683d', requestContext: { http: { method: 'POST' } },
      headers: { 'x-gv-admin-token': 'validation-admin-token' },
      body: JSON.stringify({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'USD' })
    });
    assert.equal(allowed.statusCode, 200);
    const payload = JSON.parse(allowed.body);
    assert.equal(payload.shadow, true);
    assert.equal(payload.result.observations[0].provider, 'duffel-live-683d');
    assert.equal(JSON.stringify(payload).includes('duffel_live_validation_only'), false);
    assert.equal(payload.providerStatus.secretValuesReturned, false);
    pass('683D authorized shadow API returns secret-safe evidence');

    // 13. Runtime endpoint parity exists in both Lambda and local server.
    for (const rel of ['lambda.js', 'server.js']) {
      const source = fs.readFileSync(path.join(__dirname, rel), 'utf8');
      assert.match(source, /provider-flight-shadow\/duffel-683d/);
      assert.match(source, /fetchDuffelShadow683D/);
    }
    pass('683D shadow endpoint exists in Lambda and local server');

    // 14. Duffel rate-limit headers are captured structurally on successful responses.
    const withRateHeaders = await adapter.searchExactDate683D({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'USD' }, {
      fetch: async () => fakeResponse([duffelOffer()], { responseHeaders: { 'ratelimit-limit':'120', 'ratelimit-remaining':'119', 'ratelimit-reset':'Thu, 14 Aug 2026 10:00:00 GMT', 'x-request-id':'req_success_683mr3' } })
    });
    assert.equal(withRateHeaders.rateLimit.limit,120);
    assert.equal(withRateHeaders.rateLimit.remaining,119);
    assert.ok(Number.isFinite(withRateHeaders.rateLimit.resetAtMs));
    assert.equal(withRateHeaders.rateLimit.requestId,'req_success_683mr3');
    pass('683D exposes Duffel rate-limit headers on live search results');

    // 15. A 429 keeps provider reset metadata so 683M-R4 can make an exact reset-aware decision.
    const throttled = await adapter.searchExactDate683D({ origin: 'YYZ', destination: 'LIS', departureDate: '2026-09-09', currency: 'USD' }, {
      fetch: async () => fakeResponse([], { status:429, responseHeaders:{'ratelimit-limit':'120','ratelimit-remaining':'0','ratelimit-reset':'Thu, 14 Aug 2026 10:00:00 GMT','x-request-id':'req_429_683mr3'}, errorBody:{errors:[{code:'rate_limit_exceeded',type:'rate_limit_error',message:'Too many requests'}]} })
    });
    assert.equal(throttled.supported,false); assert.equal(throttled.statusCode,429); assert.equal(throttled.errorCode,'rate_limit_exceeded');
    assert.equal(throttled.rateLimit.remaining,0); assert.ok(Number.isFinite(throttled.rateLimit.resetAtMs)); assert.equal(throttled.rateLimit.requestId,'req_429_683mr3');
    pass('683D preserves reset metadata on Duffel 429');

    // 16. Missing quota headers remain unknown rather than being coerced to zero.
    const missingRateHeaders = adapter.parseRateLimitHeaders683D({ get() { return null; } });
    assert.equal(missingRateHeaders.limit,null);
    assert.equal(missingRateHeaders.remaining,null);
    assert.equal(missingRateHeaders.resetAtMs,null);
    pass('683D missing rate-limit headers remain null rather than false zero');

    // 17. An explicit provider remaining=0 is preserved as a real zero.
    const zeroRemaining = adapter.parseRateLimitHeaders683D({ get(name) { return String(name).toLowerCase() === 'ratelimit-remaining' ? '0' : null; } });
    assert.equal(zeroRemaining.remaining,0);
    assert.equal(zeroRemaining.limit,null);
    pass('683D explicit zero remaining quota is preserved');

    // 18. Adapter source contains no mutation endpoint path or embedded live credential.
    const source = fs.readFileSync(path.join(__dirname, 'services/providers/flights/duffel/duffel-live-adapter-683d.js'), 'utf8');
    assert.equal((source.match(/\/air\/offer_requests/g) || []).length >= 1, true);
    assert.doesNotMatch(source, /['"`]\/air\/orders|['"`]\/payments|['"`]\/air\/orders\//i);
    assert.doesNotMatch(source, /duffel_live_[A-Za-z0-9_-]{12,}/);
    pass('683D adapter has no order/payment endpoint or embedded credential');

    console.log(`PASS ${passed}/18 - GV-PROVIDER-683D backend`);
  } finally {
    restoreEnv('ENABLE_DUFFEL_LIVE_683D', oldEnable);
    restoreEnv('ENABLE_DUFFEL_SHADOW_683D', oldShadow);
    restoreEnv('DUFFEL_ACCESS_TOKEN', oldDuffel);
    restoreEnv('GV_PROVIDER_COVERAGE_ADMIN_TOKEN', oldAdmin);
    globalThis.fetch = oldFetch;
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
