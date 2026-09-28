'use strict';

// GV-PERF-R2: real scheduler/684A code, deferred provider promises, no network.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../../backend/services/providers/flights/duffel/duffel-p2-staging-683h');
const pilot = require('../../backend/services/domain/live-fares/public-live-fare-pilot-684a');
const FLAG = 'ENABLE_GV_PERF_R2_684A_EXACT_THREE_STAGING';
const env = {
  GV_RUNTIME_ENVIRONMENT: 'staging', [FLAG]: 'true',
  ENABLE_DUFFEL_LIVE_683D: 'true', ENABLE_DUFFEL_SHADOW_683D: 'true',
  DUFFEL_ACCESS_TOKEN: 'duffel_live_fake_for_validation',
  ENABLE_BOC_FX_683G: 'true', ENABLE_FX_NORMALIZATION_683G: 'true',
  ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A: 'true'
};
const policy = { scope: '684a-exact-initial', initialMaxBatch: 3 };
const query = { adults: 1, children: 0, infants: 0, currency: 'USD' };
const turn = () => new Promise(resolve => setImmediate(resolve));
globalThis.fetch = async () => { throw new Error('Network forbidden in GV-PERF-R2 tests'); };

function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function raw(args, extra = {}) {
  return {
    supported: true,
    observations: [{ ...args, currency: 'USD', totalPrice: 100, price: 100,
      passengers: 1, airline: 'Test Air', stops: 0, transfers: 0, durationMinutes: 120,
      liveMode: true, source: 'duffel-live-683d',
      providerReference: `off_${args.origin}_${args.destination}_${args.departureDate}`,
      observedAt: '2026-09-15T00:00:00Z', expiresAt: '2026-09-16T00:00:00Z' }],
    rateLimit: { limit: 120, remaining: 100, resetAtMs: 1000 }, ...extra
  };
}
function fx(input) {
  return Promise.resolve({ supported: true, provider: 'identity-no-conversion',
    providerAmount: input.providerAmount, providerCurrency: input.providerCurrency,
    displayAmount: input.providerAmount, displayCurrency: input.displayCurrency,
    crossRate: 1, rateDate: null, conversionApplied: false,
    originalProviderEvidencePreserved: true });
}
function tour(count = 3) {
  const airports = ['YYZ', 'LHR', 'JFK', 'YYZ'];
  return { origin: { airportCode: 'YYZ' }, totalBudgetUsd: 1000,
    legs: Array.from({ length: count }, (_, i) => ({
      from: { airportCode: airports[i] }, to: { airportCode: airports[i + 1] },
      mode: 'flight', departureDate: `2026-10-0${i + 1}`, distanceKm: 1000,
      estimatedTransportUsd: 100, estimatedFlightUsd: 100, amountUsd: 100
    })), stops: [], estimatedTotalUsd: count * 100 };
}
function tasks(count = 3) {
  return tour(count).legs.map(leg => ({ origin: leg.from.airportCode,
    destination: leg.to.airportCode, departureDate: leg.departureDate,
    currency: 'USD', passengers: 1 }));
}
function diagnostics() {
  return { active: false, initialQuotaKnown: null, initialQuotaRemaining: null,
    initialBatchSize: 0, configuredInitialCeiling: 2,
    exactPhysicalConcurrencyPeak: 0, metroPhysicalConcurrencyPeak: 0 };
}
function state(remaining = null) {
  const s = h.requestState683H(env, { plannedRequestCap: 6 });
  s.exactConcurrencyExperimentR2 = diagnostics();
  if (remaining !== null) h.captureRateLimitMetadata683MR3({
    rateLimit: { remaining, resetAtMs: 1000, limit: 120 }
  }, s);
  return s;
}
function provider(makeResult = raw) {
  const calls = [];
  let current = 0, peak = 0;
  const searchExact = args => {
    const d = deferred();
    current += 1; peak = Math.max(peak, current);
    const call = { args, released: false, release(result = makeResult(args)) {
      assert.equal(call.released, false);
      call.released = true; d.resolve(result);
    } };
    calls.push(call);
    return d.promise.finally(() => { current -= 1; });
  };
  return { calls, searchExact, get peak() { return peak; } };
}
async function finish(promise, p) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 30 && !done; i += 1) {
    await turn();
    for (const c of p.calls.filter(c => !c.released).reverse()) c.release();
  }
  assert.equal(done, true, 'operation must settle without a real timer/network');
  return promise;
}
function schedule(s, p, extra = {}, selectedPolicy = policy, rows = tasks()) {
  const options = { env, searchExact: p.searchExact, now683MR3: () => 0,
    sleep683MR3: async () => {}, ...extra };
  return h.mapQuotaReservation683MR4(rows, s,
    args => h.callDuffel683H(args, s, { ...options, requestKind683M: 'exact' }),
    () => Boolean(s.abortReason || s.proactiveQuotaFailClosed683MR3 || s.requests >= s.cap),
    options, selectedPolicy);
}

for (const [name, override, count, expected] of [
  ['flag absent', { [FLAG]: undefined }, 3, 2],
  ['flag off', { [FLAG]: 'false' }, 3, 2],
  ['production despite flag', { GV_RUNTIME_ENVIRONMENT: 'production' }, 3, 2],
  ['missing runtime', { GV_RUNTIME_ENVIRONMENT: '' }, 3, 2],
  ['one leg', {}, 1, 1], ['two legs', {}, 2, 2],
  ['three exact legs, initially unknown quota', {}, 3, 3]
]) test(name, async () => {
  const p = provider();
  const resultPromise = pilot.applyPublicLiveFarePilot684A(tour(count), { ...query }, {
    env: { ...env, ...override }, searchExact: p.searchExact, normalizeFx: fx,
    // Spoofed generic options must not activate the sixth-argument policy.
    schedulingPolicy: policy, initialMaxBatch: 3
  });
  await turn(); assert.equal(p.calls.length, expected);
  const result = await finish(resultPromise, p);
  assert.equal(result.summary.applied, true);
  const d = result.summary.exactConcurrencyExperimentR2;
  assert.equal(d.active, expected === 3);
  assert.equal(d.initialQuotaKnown, false);
  assert.equal(d.initialQuotaRemaining, null);
  assert.equal(d.initialBatchSize, expected);
  assert.equal(d.configuredInitialCeiling, expected === 3 ? 3 : 2);
  assert.equal(d.exactPhysicalConcurrencyPeak, expected);
  assert.equal(d.metroPhysicalConcurrencyPeak, 0);
  assert.equal(result.summary.providerRequests, count);
  assert.equal(result.summary.latency.concurrencyPeak, expected);
  assert.equal(result.summary.latency.boundedConcurrency, expected === 3 ? 3 : 2);
  assert.equal(result.summary.latency.quotaReservationScheduling683MR4.maxBatchSize, expected === 3 ? 3 : 2);
  for (const [i, leg] of result.tour.legs.entries()) {
    assert.equal(leg.providerDateEvidence.origin, tour(count).legs[i].from.airportCode);
    assert.equal(leg.providerDateEvidence.sourceType, 'LIVE');
    assert.equal(leg.providerDateEvidence.productionEligible, true);
  }
});

test('global configuration and other schedulers stay at two with flag enabled', async () => {
  assert.equal(h.MAX_PROVIDER_CONCURRENCY_683M, 2);
  assert.equal(h.QUOTA_RESERVATION_MAX_BATCH_683MR4, 2);
  assert.equal(h.config683H(env).providerConcurrency683M, 2);
  assert.equal(h.status683H(env).latencyOptimization683M.boundedConcurrency, 2);
  for (const selected of [null, { ...policy, scope: 'metro' }, { ...policy, initialMaxBatch: 4 }]) {
    const s = state(), p = provider();
    const pending = schedule(s, p, { schedulingPolicy: policy }, selected);
    await turn(); assert.equal(p.calls.length, 2);
    await finish(pending, p); assert.equal(p.peak, 2);
    assert.equal(s.exactConcurrencyExperimentR2.active, false);
  }
  const s = state(), p = provider();
  const pending = h.mapLimit683M(tasks(), 3, args => h.callDuffel683H(args, s, { env, searchExact: p.searchExact }));
  await turn(); assert.equal(p.calls.length, 2);
  await finish(pending, p); assert.equal(p.peak, 2);
});

for (const [name, remaining, expected] of [
  ['known quota 3', 3, 3], ['known quota 20', 20, 3],
  ['known quota 2', 2, 2], ['known quota 1', 1, 1],
  ['known quota 0 resets serially', 0, 1]
]) test(name, async () => {
  const s = state(remaining), p = provider(); const waits = [];
  const pending = schedule(s, p, { sleep683MR3: async ms => { waits.push(ms); } });
  await turn(); assert.equal(p.calls.length, expected);
  assert.equal(s.exactConcurrencyExperimentR2.initialQuotaKnown, true);
  assert.equal(s.exactConcurrencyExperimentR2.initialQuotaRemaining, remaining);
  assert.equal(s.exactConcurrencyExperimentR2.initialBatchSize, expected);
  await finish(pending, p);
  assert.equal(s.requests, 3);
  assert.ok(p.peak <= Math.max(2, expected));
  if (remaining >= 3) assert.equal(s.exactConcurrencyExperimentR2.exactPhysicalConcurrencyPeak, 3);
  if (remaining === 0) { assert.equal(waits.length, 1); assert.equal(waits[0], 1250); }
});

test('zero quota never launches before reset; post-reset first call is serial', async () => {
  const s = state(0), p = provider(), reset = deferred(); let waits = 0;
  const pending = schedule(s, p, { sleep683MR3: () => { waits += 1; return reset.promise; } });
  await turn(); assert.equal(waits, 1); assert.equal(p.calls.length, 0);
  reset.resolve(); await turn(); assert.equal(p.calls.length, 1);
  p.calls[0].release(); await turn(); assert.equal(p.calls.length, 3);
  await finish(pending, p);
  assert.equal(s.exactConcurrencyExperimentR2.initialBatchSize, 1);
  assert.equal(p.peak, 2);
});

for (const resetAtMs of [null, 60000]) test(`zero quota fails closed with reset ${resetAtMs}`, async () => {
  const s = state(0), p = provider(); s.quotaResetAtMs683MR3 = resetAtMs;
  const result = await schedule(s, p, { sleep683MR3: async () => assert.fail('must not sleep') });
  assert.equal(p.calls.length, 0); assert.equal(result.filter(Boolean).length, 0);
  assert.equal(s.proactiveQuotaFailClosed683MR3, true);
});

test('post-reset unknown quota retains serial first observation', async () => {
  const s = state(), p = provider(); h.clearQuotaWindowAfterReset683MR3(s);
  const pending = schedule(s, p); await turn(); assert.equal(p.calls.length, 1);
  await finish(pending, p); assert.equal(p.peak, 2);
  assert.equal(s.exactConcurrencyExperimentR2.active, false);
});

test('same-window out-of-order metadata cannot replenish reserved quota', () => {
  const s = state(3); s.quotaRemaining683MR3 = 0;
  for (const remaining of [2, 0, 1]) h.captureRateLimitMetadata683MR3({ rateLimit: { remaining, resetAtMs: 1000 } }, s);
  assert.equal(s.quotaRemaining683MR3, 0);
});

test('684A metro phase has three tasks but physical concurrency remains two', async () => {
  const exactKeys = new Set(tasks().map(a => `${a.origin}|${a.destination}`));
  const p = provider(args => {
    const result = raw(args);
    if (exactKeys.has(`${args.origin}|${args.destination}`)) result.observations[0].durationMinutes = 5000;
    return result;
  });
  const pending = pilot.applyPublicLiveFarePilot684A(tour(), { ...query }, {
    env, searchExact: p.searchExact, normalizeFx: fx
  });
  await turn(); assert.equal(p.calls.length, 3);
  for (const c of p.calls.slice().reverse()) c.release();
  await turn(); assert.equal(p.calls.length, 5);
  assert.ok(p.calls.slice(3).every(c => !exactKeys.has(`${c.args.origin}|${c.args.destination}`)));
  const result = await finish(pending, p);
  assert.equal(result.summary.applied, true);
  assert.equal(result.summary.metroRequests, 3);
  assert.equal(result.summary.providerRequests, 6);
  assert.equal(result.summary.exactConcurrencyExperimentR2.exactPhysicalConcurrencyPeak, 3);
  assert.equal(result.summary.exactConcurrencyExperimentR2.metroPhysicalConcurrencyPeak, 2);
  assert.equal(result.summary.exactConcurrencyExperimentR2.initialBatchSize, 3);
});

for (const cap of [0, 1, 2, 3]) test(`physical request cap ${cap} cannot be overshot`, async () => {
  const s = state(20), p = provider(); s.cap = cap;
  const pending = schedule(s, p); await turn(); assert.equal(p.calls.length, cap);
  await finish(pending, p); assert.equal(s.requests, cap); assert.equal(p.calls.length, cap);
});

test('used request state and cap headroom never reactivate initial-three policy', async () => {
  const s = state(20), p = provider(); s.requests = 4;
  const pending = schedule(s, p); await turn(); assert.equal(p.calls.length, 2);
  await finish(pending, p); assert.equal(s.requests, 6);
  assert.equal(s.exactConcurrencyExperimentR2.active, false);
});

test('concurrent dedupe shares one physical call, preserves three indexed results', async () => {
  const s = state(), p = provider(); const a = tasks()[0];
  const pending = schedule(s, p, {}, policy, [a, { ...a }, { ...a }]);
  await turn(); assert.equal(p.calls.length, 1);
  const result = await finish(pending, p);
  assert.equal(s.requests, 1); assert.equal(s.deduplicatedRequests683M, 2);
  assert.equal(result[0], result[1]); assert.equal(result[1], result[2]);
  assert.equal(s.exactConcurrencyExperimentR2.initialBatchSize, 3);
  assert.equal(s.exactConcurrencyExperimentR2.exactPhysicalConcurrencyPeak, 1);
});

test('429 reset gate permits only one budgeted retry, then ends', async () => {
  const s = state(), p = provider(), reset = deferred(); let waits = 0;
  const pending = schedule(s, p, { sleep683MR3: () => { waits += 1; return reset.promise; } });
  await turn(); assert.equal(p.calls.length, 3);
  p.calls[0].release({ supported: false, statusCode: 429, rateLimit: { remaining: 0, resetAtMs: 1000 } });
  p.calls[1].release(); p.calls[2].release(); await turn();
  assert.equal(waits, 1); assert.equal(p.calls.length, 3);
  assert.ok(s._rateLimitGatePromise683MR3);
  reset.resolve(); await turn(); assert.equal(p.calls.length, 4);
  await finish(pending, p);
  assert.equal(s.requests, 4); assert.equal(s.rateLimitRetryCount683MR3, 1);
  assert.equal(s.rateLimitRecoverySucceeded683MR3, 1);
  assert.equal(s._rateLimitGatePromise683MR3, null);
  assert.equal(s.exactConcurrencyExperimentR2.exactPhysicalConcurrencyPeak, 3);
});

test('simultaneous 429s share one retry lease and fail closed without a retry burst', async () => {
  const s = state(), p = provider(), reset = deferred();
  const pending = schedule(s, p, { sleep683MR3: () => reset.promise });
  await turn();
  for (const c of p.calls) c.release({ supported: false, statusCode: 429, rateLimit: { remaining: 0, resetAtMs: 1000 } });
  await turn(); assert.equal(s.rateLimitRetryCount683MR3, 1);
  assert.equal(s.proactiveQuotaFailClosed683MR3, true);
  assert.equal(p.calls.length, 3);
  reset.resolve(); await turn();
  await finish(pending, p); assert.equal(p.calls.length, 4);
  assert.equal(s.rateLimitEvents683MR3, 3); assert.equal(s.rateLimitRetryCount683MR3, 1);
});

for (const [name, resetAtMs, cap] of [
  ['missing reset', undefined, 6], ['excessive reset wait', 60000, 6], ['cap exhausted', 1000, 3]
]) test(`429 ${name} cannot launch a retry`, async () => {
  const s = state(), p = provider(); s.cap = cap;
  const pending = schedule(s, p, { sleep683MR3: async () => assert.fail('must not wait') });
  await turn(); p.calls[0].release({ supported: false, statusCode: 429, rateLimit: { remaining: 0, resetAtMs } });
  const result = await finish(pending, p);
  assert.equal(p.calls.length, 3); assert.equal(s.rateLimitRetryCount683MR3, 0);
  assert.equal(s.proactiveQuotaFailClosed683MR3, true); assert.equal(result[0].supported, false);
});

test('retry still throttled fails closed after four total physical requests', async () => {
  const s = state(), p = provider();
  const pending = schedule(s, p);
  await turn(); p.calls[0].release({ supported: false, statusCode: 429, rateLimit: { resetAtMs: 1000 } });
  p.calls[1].release(); p.calls[2].release(); await turn();
  assert.equal(p.calls.length, 4);
  p.calls[3].release({ supported: false, statusCode: 429, rateLimit: { resetAtMs: 2000 } });
  await finish(pending, p); assert.equal(s.rateLimitRetryCount683MR3, 1);
  assert.equal(s.proactiveQuotaFailClosed683MR3, true); assert.equal(s.requests, 4);
});

test('final 684A reuse makes zero searches and reports inactive experiment', async () => {
  const p = provider();
  const first = await finish(pilot.applyPublicLiveFarePilot684A(tour(), { ...query }, {
    env, searchExact: p.searchExact, normalizeFx: fx
  }), p);
  assert.equal(first.summary.applied, true);
  const result = await pilot.applyPublicLiveFarePilot684A(first.tour, { ...query }, {
    env, searchExact: async () => assert.fail('reuse must not search'), normalizeFx: async () => assert.fail('reuse must not normalize')
  });
  assert.equal(result.tour, first.tour); assert.equal(result.summary.reused, true);
  assert.equal(result.summary.providerRequests, 0);
  assert.equal(result.summary.exactConcurrencyExperimentR2.active, false);
  assert.equal(result.summary.exactConcurrencyExperimentR2.initialQuotaKnown, null);
  assert.equal(result.summary.exactConcurrencyExperimentR2.initialBatchSize, 0);
  assert.equal(result.summary.exactConcurrencyExperimentR2.exactPhysicalConcurrencyPeak, 0);
});

for (const failure of ['missing-leg', 'invalid-evidence', 'fx-failure']) test(`${failure} preserves atomic fail-closed application`, async () => {
  const original = tour();
  const p = provider(args => {
    if (failure === 'missing-leg' && args.origin === 'LHR') return { supported: false, observations: [] };
    const result = raw(args);
    if (failure === 'invalid-evidence' && args.origin === 'LHR') result.observations[0].liveMode = false;
    return result;
  });
  const result = await finish(pilot.applyPublicLiveFarePilot684A(original, { ...query }, {
    env, searchExact: p.searchExact,
    normalizeFx: failure === 'fx-failure' ? async () => ({ supported: false }) : fx
  }), p);
  assert.equal(result.summary.applied, false); assert.equal(result.tour, original);
});

test('live repricing still exposes a strictly over-budget trip', async () => {
  const original = tour(); original.totalBudgetUsd = 250;
  const p = provider();
  const result = await finish(pilot.applyPublicLiveFarePilot684A(original, { ...query, budget: 250 }, {
    env, searchExact: p.searchExact, normalizeFx: fx
  }), p);
  assert.equal(result.summary.applied, true); assert.equal(result.summary.overBudget, true);
  assert.equal(result.summary.afterTotalUsd, 300);
});

for (const override of [{ [FLAG]: 'false' }, { GV_RUNTIME_ENVIRONMENT: 'production' }]) {
  test(`scheduler independently rejects override ${JSON.stringify(override)}`, async () => {
    const s = state(), p = provider();
    const pending = schedule(s, p, { env: { ...env, ...override } });
    await turn(); assert.equal(p.calls.length, 2);
    await finish(pending, p); assert.equal(p.peak, 2);
    assert.equal(s.exactConcurrencyExperimentR2.active, false);
  });
}

test('ordinary P2 candidate searches stay at two even with generic override options', async () => {
  const p = provider();
  const pending = h.buildLiveProviderResults683H({
    candidateStarts: ['2026-10-01', '2026-10-08'], legs: tour().legs,
    stops: [], query: { ...query }, displayCurrency: 'USD'
  }, { env, searchExact: p.searchExact, normalizeFx: fx,
    schedulingPolicy: policy, initialMaxBatch: 3 });
  await turn(); assert.equal(p.calls.length, 2);
  const result = await finish(pending, p);
  assert.equal(result.supported, true);
  assert.equal(result.completeScheduleCount, 2);
  assert.equal(p.calls.length, 6); assert.equal(p.peak, 2);
  assert.equal(result.latency683M.boundedConcurrency, 2);
});

test('provider rejection unwinds physical diagnostics and dedupe cache', async () => {
  const s = state();
  await assert.rejects(h.callDuffel683H(tasks()[0], s, {
    env, searchExact: async () => { throw new Error('test provider failure'); }
  }), /test provider failure/);
  assert.deepEqual(s._physicalConcurrencyByKindGvPerfR2, { exact: 0, metro: 0 });
  assert.equal(s.providerConcurrencyCurrent683M, 0);
  assert.equal(s._requestCache683M.size, 0);
});
