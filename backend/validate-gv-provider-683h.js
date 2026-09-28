'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const h = require('./services/duffel-p2-staging-683h');
const p2 = require('./services/domain/routing/whole-trip-date-optimizer-681b-p2');
const liveVerification683JR2 = require('./services/domain/live-fares/live-provider-verification');

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (e) { console.error(`FAIL ${name}`); throw e; }
}
async function testAsync(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (e) { console.error(`FAIL ${name}`); throw e; }
}

const readyEnv = {
  ENABLE_DUFFEL_LIVE_683D: 'true',
  ENABLE_DUFFEL_SHADOW_683D: 'true',
  DUFFEL_ACCESS_TOKEN: 'duffel_live_fake_for_unit_test',
  ENABLE_BOC_FX_683G: 'true',
  ENABLE_FX_NORMALIZATION_683G: 'true'
};
const enabledEnv = { ...readyEnv, ENABLE_DUFFEL_P2_683H: 'true', ACK_DUFFEL_P2_STAGING_ONLY_683H: 'true', ENABLE_DUFFEL_P2_STAGING_ACTIVATION_683J: 'true', GV_RUNTIME_ENVIRONMENT: 'staging' };

function fxMock(input) {
  const amount = Number(input.providerAmount);
  const target = String(input.displayCurrency || 'USD').toUpperCase();
  const rates = { USD: 1, CAD: 1.4, EUR: 0.87, GBP: 0.74, AUD: 1.42 };
  return Promise.resolve({
    supported: true,
    provider: target === String(input.providerCurrency || '').toUpperCase() ? 'identity-no-conversion' : 'bank-of-canada-valet-daily',
    providerAmount: amount,
    providerCurrency: String(input.providerCurrency || '').toUpperCase(),
    displayAmount: Number((amount * (rates[target] || 1)).toFixed(2)),
    displayCurrency: target,
    crossRate: rates[target] || 1,
    rateDate: target === String(input.providerCurrency || '').toUpperCase() ? null : '2026-08-13',
    conversionApplied: target !== String(input.providerCurrency || '').toUpperCase(),
    originalProviderEvidencePreserved: true
  });
}

function liveResult(origin, destination, departureDate, amount = 100, currency = 'USD') {
  return {
    supported: true,
    reason: null,
    observations: [{
      origin, destination, departureDate, currency, totalPrice: amount, price: amount,
      airline: 'Test Air', stops: 0, transfers: 0, durationMinutes: 120,
      liveMode: true, source: 'duffel-live-683d', providerReference: `off_${origin}_${destination}_${departureDate}`,
      observedAt: '2026-08-14T03:00:00Z', expiresAt: '2026-08-14T04:00:00Z'
    }]
  };
}

function rawDuffel683DResult(origin, destination, departureDate, amount = 100, currency = 'USD') {
  // Matches searchExactDate683D()'s raw observation shape: totalPrice is present,
  // but the provider-neutral `price` alias is not added until 683H-R1.
  return {
    supported: true,
    reason: null,
    observations: [{
      origin, destination, departureDate, currency, totalPrice: amount,
      airline: 'Raw Duffel Test Air', stops: 0, durationMinutes: 120,
      liveMode: true, source: 'duffel-live-683d', providerReference: `off_raw_${origin}_${destination}_${departureDate}`,
      observedAt: '2026-08-14T03:00:00Z', expiresAt: '2026-08-14T04:00:00Z'
    }]
  };
}

(async () => {
  test('683M-R4 version locked', () => assert.equal(h.VERSION_683H, 'GV-PROVIDER-683M-R4'));
  test('683M concurrency hard-bounded at two', () => assert.equal(h.MAX_PROVIDER_CONCURRENCY_683M, 2));
  test('683M status exposes bounded concurrency two', () => assert.equal(h.status683H(enabledEnv).latencyOptimization683M.boundedConcurrency, 2));
  test('683M request-scoped dedupe enabled', () => assert.equal(h.status683H(enabledEnv).latencyOptimization683M.requestScopedDedupe, true));
  test('683H defaults to two candidate schedules', () => assert.equal(h.DEFAULT_MAX_CANDIDATES_683H, 2));
  test('683I-R1 hard request cap bounded', () => { const cfg=h.config683H({ GV_DUFFEL_P2_REQUEST_CAP_683H: 99 }); assert.equal(cfg.requestCap,12); assert.equal(cfg.hardRequestCap,12); });
  test('dependencies ready with Duffel live + FX', () => assert.equal(h.dependencyReady683H(readyEnv), true));
  test('normal P2 flow remains disabled without explicit flag', () => assert.equal(h.enabled683H(readyEnv), false));
  test('normal P2 flow remains disabled without staging acknowledgement', () => assert.equal(h.enabled683H({ ...readyEnv, ENABLE_DUFFEL_P2_683H: 'true' }), false));
  test('normal P2 flow remains disabled without 683J activation flag', () => assert.equal(h.enabled683H({ ...readyEnv, ENABLE_DUFFEL_P2_683H:'true', ACK_DUFFEL_P2_STAGING_ONLY_683H:'true', GV_RUNTIME_ENVIRONMENT:'staging' }), false));
  test('normal P2 flow remains disabled when runtime is production', () => assert.equal(h.enabled683H({ ...enabledEnv, GV_RUNTIME_ENVIRONMENT:'production' }), false));
  test('normal P2 flow remains disabled when runtime identity is unset', () => assert.equal(h.enabled683H({ ...enabledEnv, GV_RUNTIME_ENVIRONMENT:'' }), false));
  test('normal P2 flow enables only behind four isolated-staging gates', () => assert.equal(h.enabled683H(enabledEnv), true));
  test('683J staging runtime helper confirms staging only', () => { assert.equal(h.stagingIdentity683J(enabledEnv), true); assert.equal(h.stagingIdentity683J({ ...enabledEnv, GV_RUNTIME_ENVIRONMENT:'prod' }), false); });
  test('683J activation refusal reason is null only when safe', () => assert.equal(h.activationRefusedReason683J(enabledEnv), null));
  test('status is never production approved', () => assert.equal(h.status683H(enabledEnv).productionApproved, false));
  test('status exposes no order capability', () => assert.equal(h.status683H(enabledEnv).orderCapability, false));
  test('status exposes no payment capability', () => assert.equal(h.status683H(enabledEnv).paymentCapability, false));
  test('status exposes no booking capability', () => assert.equal(h.status683H(enabledEnv).bookingCapability, false));
  test('status exposes no ticketing capability', () => assert.equal(h.status683H(enabledEnv).ticketingCapability, false));
  test('status marks single-adult initial staging gate', () => assert.equal(h.status683H(enabledEnv).singleAdultOnly, true));
  test('683J status confirms isolated staging identity', () => { const st=h.status683H(enabledEnv); assert.equal(st.runtimeEnvironment,'staging'); assert.equal(st.stagingRuntimeConfirmed,true); assert.equal(st.activation683J,true); assert.equal(st.rankingScope,'P2-isolated-staging-only-683j'); });
  test('683J status refuses production runtime', () => { const st=h.status683H({ ...enabledEnv, GV_RUNTIME_ENVIRONMENT:'production' }); assert.equal(st.normalFlowEnabled,false); assert.equal(st.activationRefusedReason,'683j-runtime-not-staging'); });
  const productionEnv683K = { ...readyEnv, GV_RUNTIME_ENVIRONMENT:'production' };
  const canaryContext683K = { __gvProviderCanary683K:'authorized-production-canary' };
  test('683K production default remains off without request canary', () => assert.equal(h.enabled683H(productionEnv683K, {}), false));
  test('683K production canary activates only with private request marker', () => assert.equal(h.enabled683H(productionEnv683K, canaryContext683K), true));
  test('683K production canary marker is refused on staging runtime', () => assert.equal(h.productionCanaryAuthorized683K(canaryContext683K, enabledEnv), false));
  test('683K status reports request-only production canary scope', () => { const st=h.status683H(productionEnv683K, canaryContext683K); assert.equal(st.productionCanary683KAuthorized,true); assert.equal(st.normalFlowEnabled,true); assert.equal(st.rankingScope,'P2-production-canary-request-only-683k'); assert.equal(st.productionApproved,false); });
  test('683K status without marker remains shadow/default off in production', () => { const st=h.status683H(productionEnv683K, {}); assert.equal(st.productionCanary683KAuthorized,false); assert.equal(st.normalFlowEnabled,false); assert.equal(st.rankingScope,'shadow-simulation-only'); });

  const registry = h.loadMetroRegistry683H();
  test('metro registry loaded', () => assert.ok(registry.groupCount >= 50));
  test('Rome metro group has CIA and FCO', () => assert.deepEqual((registry.groups.ROM || []).map(x => x.code), ['CIA', 'FCO']));
  test('CIA alternate is FCO', () => assert.deepEqual(h.metroAlternates683H('CIA', registry).map(x => x.code), ['FCO']));
  test('FCO alternate is CIA', () => assert.deepEqual(h.metroAlternates683H('FCO', registry).map(x => x.code), ['CIA']));
  test('unknown airport has no metro alternate', () => assert.deepEqual(h.metroAlternates683H('ZZZ', registry), []));
  test('Rome airport shift is plausible', () => assert.ok(h.metroAlternates683H('CIA', registry)[0].shiftKm > 20 && h.metroAlternates683H('CIA', registry)[0].shiftKm < 40));
  const fallbacks = h.buildMetroFallbackCandidates683H({ origin: 'RHO', destination: 'CIA', departureDate: '2026-09-01' }, registry, 2);
  test('destination metro fallback exists', () => assert.equal(fallbacks[0].destination, 'FCO'));
  test('destination metro fallback labelled', () => assert.equal(fallbacks[0].airportMode, 'METRO_DESTINATION_ALTERNATE'));
  test('fallback keeps exact date', () => assert.equal(fallbacks[0].departureDate, '2026-09-01'));
  test('fallback is same city code', () => assert.equal(fallbacks[0].destinationMetroCode, 'ROM'));
  test('fallback candidate cap enforced', () => assert.ok(h.buildMetroFallbackCandidates683H({ origin: 'LHR', destination: 'JFK', departureDate: '2026-09-01' }, registry, 1).length <= 1));
  test('no-offer result eligible for metro fallback', () => assert.equal(h.fallbackEligible683H({ supported: false, reason: 'no-valid-exact-live-offers' }), true));
  test('rate-limit result not eligible for metro fallback', () => assert.equal(h.fallbackEligible683H({ supported: false, reason: 'Too many requests hit API' }), false));

  test('candidate selector always includes earliest candidate', () => {
    const out = h.selectCandidateStarts683H(['2026-09-01','2026-09-08','2026-09-15'], { observations: [{ departureDate:'2026-09-01',price:200 },{ departureDate:'2026-09-08',price:100 },{ departureDate:'2026-09-15',price:150 }] }, 2);
    assert.deepEqual(out, ['2026-09-01','2026-09-08']);
  });
  test('candidate selector enforces configured cap', () => assert.equal(h.selectCandidateStarts683H(['2026-09-01','2026-09-08','2026-09-15'], {}, 2).length, 2));
  test('single adult eligible', () => assert.equal(h.passengerEligibility683H({ adults:1, children:0, infants:0 }).eligible, true));
  test('two adults fail initial staging gate', () => assert.equal(h.passengerEligibility683H({ adults:2 }).eligible, false));
  test('children fail initial staging gate', () => assert.equal(h.passengerEligibility683H({ adults:1, children:1 }).eligible, false));

  test('683I-R1 request budget identifies two Rome-sensitive flight legs', () => {
    const budgetLegs = [
      { from:{airportCode:'DUB'}, to:{airportCode:'RHO'}, mode:'flight' },
      { from:{airportCode:'RHO'}, to:{airportCode:'CIA'}, mode:'flight' },
      { from:{airportCode:'CIA'}, to:{airportCode:'DUB'}, mode:'flight' }
    ];
    assert.equal(h.metroSensitiveFlightLegCount683IR1(budgetLegs), 2);
  });
  test('683I-R1 dynamic request budget gives Dublin Rome path ten requests', () => {
    const budgetLegs = [
      { from:{airportCode:'DUB'}, to:{airportCode:'RHO'}, mode:'flight' },
      { from:{airportCode:'RHO'}, to:{airportCode:'CIA'}, mode:'flight' },
      { from:{airportCode:'CIA'}, to:{airportCode:'DUB'}, mode:'flight' }
    ];
    const plan = h.planRequestBudget683IR1({ legs: budgetLegs, candidateCount:2 }, enabledEnv);
    assert.equal(plan.exactRequestBudget, 6);
    assert.equal(plan.metroFallbackBudget, 4);
    assert.equal(plan.requiredRequestBudget, 10);
    assert.equal(plan.plannedRequestCap, 10);
    assert.equal(plan.boundedByHardCap, false);
  });
  test('683I-R1 simple two-leg path does not inflate above base request floor', () => {
    const simple = [
      { from:{airportCode:'DUB'}, to:{airportCode:'RHO'}, mode:'flight' },
      { from:{airportCode:'RHO'}, to:{airportCode:'DUB'}, mode:'flight' }
    ];
    const plan = h.planRequestBudget683IR1({ legs:simple, candidateCount:2 }, enabledEnv);
    assert.equal(plan.exactRequestBudget,4);
    assert.equal(plan.metroFallbackBudget,0);
    assert.equal(plan.plannedRequestCap,8);
  });
  test('683I-R1 planner never exceeds global hard ceiling', () => {
    const many = Array.from({length:8}, (_,i)=>({from:{airportCode:i%2?'JFK':'LAX'},to:{airportCode:i%2?'LAX':'JFK'},mode:'flight'}));
    const plan = h.planRequestBudget683IR1({legs:many,candidateCount:2}, enabledEnv);
    assert.equal(plan.plannedRequestCap,12);
    assert.equal(plan.boundedByHardCap,true);
  });
  test('683I-R1 classifies provider abort responses', () => {
    assert.equal(h.providerAbortReason683IR1({statusCode:429,reason:'x'}),'rate-limit');
    assert.equal(h.providerAbortReason683IR1({statusCode:401,reason:'x'}),'authorization');
    assert.equal(h.providerAbortReason683IR1({supported:false,reason:'Too many requests hit API too quickly'}),'rate-limit');
    assert.equal(h.providerAbortReason683IR1({supported:false,reason:'no-valid-exact-live-offers'}),null);
  });

  await testAsync('FX normalization preserves provider amount/currency', async () => {
    const out = await h.normalizeLiveObservation683H(liveResult('YYZ','LIS','2026-09-09',312.8).observations[0], 'CAD', { env: readyEnv, normalizeFx: fxMock });
    assert.equal(out.supported, true);
    assert.equal(out.observation.providerAmount, 312.8);
    assert.equal(out.observation.providerCurrency, 'USD');
    assert.equal(out.observation.rankingPriceUsd, 312.8);
    assert.equal(out.observation.displayPrice, 437.92);
    assert.equal(out.observation.displayCurrency, 'CAD');
  });

  await testAsync('683H-R1 adds canonical price alias to raw 683D totalPrice-only evidence', async () => {
    const state = h.requestState683H(enabledEnv);
    const out = await h.resolveExactLeg683H({ origin:'LAX', destination:'JFK', departureDate:'2026-09-01', displayCurrency:'USD' }, state, {
      env: enabledEnv,
      searchExact: async args => rawDuffel683DResult(args.origin,args.destination,args.departureDate,223.31),
      normalizeFx: fxMock
    });
    assert.equal(out.supported, true);
    assert.equal(out.observation.totalPrice, 223.31);
    assert.equal(out.observation.price, 223.31);
    assert.equal(out.observation.rankingPriceUsd, 223.31);
  });

  await testAsync('683H-R1 P2 selects two complete schedules from raw 683D totalPrice-only evidence', async () => {
    const simpleLegs = [
      { from:{airportCode:'LAX'}, to:{airportCode:'JFK'}, mode:'flight' },
      { from:{airportCode:'JFK'}, to:{airportCode:'LAX'}, mode:'flight' }
    ];
    const simpleStops = [{ city:'New York', nights:8, hotelEstimateUsd:250 }];
    const simpleStarts = ['2026-09-01','2026-09-04'];
    const tour = { totalBudgetUsd:1400, legs:simpleLegs, stops:simpleStops, originAccessEstimateUsd:20 };
    const out = await h.simulateTour683H({ tour, query:{ adults:1, budgetUsd:1400 }, candidateStarts:simpleStarts, baselineFirstLegResult:{}, displayCurrency:'USD' }, {
      env: enabledEnv,
      searchExact: async args => rawDuffel683DResult(args.origin,args.destination,args.departureDate,args.departureDate === '2026-09-01' ? 220 : 240),
      normalizeFx: fxMock
    });
    assert.equal(out.live.completeScheduleCount, 2);
    assert.equal(out.selection.completeCandidateCount, 2);
    assert.equal(out.supported, true);
    assert.ok(out.selected);
  });

  await testAsync('exact Duffel live leg resolves without metro fallback', async () => {
    const state = h.requestState683H(enabledEnv);
    const out = await h.resolveExactLeg683H({ origin:'LAX', destination:'LAS', departureDate:'2026-09-01', displayCurrency:'USD' }, state, {
      env: enabledEnv,
      searchExact: async args => liveResult(args.origin,args.destination,args.departureDate,55.98),
      normalizeFx: fxMock
    });
    assert.equal(out.supported, true);
    assert.equal(out.coverageMode, 'EXACT');
    assert.equal(state.requests, 1);
    assert.equal(out.observation.rankingPriceUsd, 55.98);
  });

  await testAsync('CIA no-offer recovers through FCO same-city fallback', async () => {
    const state = h.requestState683H(enabledEnv);
    const out = await h.resolveExactLeg683H({ origin:'RHO', destination:'CIA', departureDate:'2026-09-01', displayCurrency:'EUR' }, state, {
      env: enabledEnv,
      searchExact: async args => args.destination === 'CIA' ? { supported:false, reason:'no-valid-exact-live-offers', observations:[] } : liveResult(args.origin,args.destination,args.departureDate,165.01),
      normalizeFx: fxMock
    });
    assert.equal(out.supported, true);
    assert.equal(out.coverageMode, 'METRO_ALTERNATE');
    assert.equal(out.resolvedDestination, 'FCO');
    assert.equal(out.observation.airportMode683H, 'METRO_DESTINATION_ALTERNATE');
    assert.equal(out.observation.metroAirportFallback683H.groundAccessEstimateAdjusted, false);
  });

  await testAsync('rate limit fails closed without trying metro alternate', async () => {
    const state = h.requestState683H(enabledEnv);
    const out = await h.resolveExactLeg683H({ origin:'RHO', destination:'CIA', departureDate:'2026-09-01', displayCurrency:'EUR' }, state, {
      env: enabledEnv,
      searchExact: async () => ({ supported:false, reason:'Too many requests hit API too quickly', observations:[] }),
      normalizeFx: fxMock
    });
    assert.equal(out.supported, false);
    assert.equal(state.metroRequests, 0);
    assert.equal(state.requests, 1);
  });

  const legs = [
    { from:{airportCode:'DUB'}, to:{airportCode:'RHO'}, mode:'flight' },
    { from:{airportCode:'RHO'}, to:{airportCode:'CIA'}, mode:'flight' },
    { from:{airportCode:'CIA'}, to:{airportCode:'DUB'}, mode:'flight' }
  ];
  const stops = [{ city:'Rhodes', nights:3, hotelEstimateUsd:100 }, { city:'Rome', nights:4, hotelEstimateUsd:120 }];
  const starts = ['2026-08-28','2026-09-04'];

  await testAsync('live provider builder requires every flight leg in two schedules', async () => {
    const out = await h.buildLiveProviderResults683H({ candidateStarts:starts, baselineFirstLegResult:{ observations:[{departureDate:'2026-08-28',price:19},{departureDate:'2026-09-04',price:25}] }, legs, stops, query:{adults:1}, displayCurrency:'EUR' }, {
      env: enabledEnv,
      searchExact: async args => liveResult(args.origin,args.destination,args.departureDate,100),
      normalizeFx: fxMock
    });
    assert.equal(out.supported, true);
    assert.equal(out.completeScheduleCount, 2);
    assert.equal(out.providerResults.length, 3);
    assert.equal(out.providerResults[0].observations.length, 2);
    assert.equal(out.state.requests, 6);
  });

  await testAsync('one incomplete live schedule cannot promote Duffel into P2', async () => {
    const out = await h.buildLiveProviderResults683H({ candidateStarts:starts, baselineFirstLegResult:{}, legs, stops, query:{adults:1}, displayCurrency:'EUR' }, {
      env: enabledEnv,
      searchExact: async args => (args.departureDate === '2026-09-07' && args.destination === 'CIA') ? {supported:false,reason:'provider-adapter-error',observations:[]} : liveResult(args.origin,args.destination,args.departureDate,100),
      normalizeFx: fxMock
    });
    assert.equal(out.supported, false);
    assert.ok(out.completeScheduleCount < 2);
  });

  await testAsync('683I-R1 multi-city dynamic budget recovers both Rome legs across two schedules', async () => {
    const out = await h.buildLiveProviderResults683H({ candidateStarts:starts, baselineFirstLegResult:{}, legs, stops, query:{adults:1}, displayCurrency:'EUR' }, {
      env: enabledEnv,
      searchExact: async args => {
        if (args.destination === 'CIA' || args.origin === 'CIA') return { supported:false, reason:'no-valid-exact-live-offers', observations:[] };
        return liveResult(args.origin,args.destination,args.departureDate,100);
      },
      normalizeFx: fxMock
    });
    assert.equal(out.supported, true);
    assert.equal(out.completeScheduleCount, 2);
    assert.equal(out.requestBudgetPlan.plannedRequestCap, 10);
    assert.equal(out.state.cap, 10);
    assert.equal(out.state.requests, 10);
    assert.equal(out.state.exactRequests, 6);
    assert.equal(out.state.metroRequests, 4);
  });

  await testAsync('683I-R1 global hard request cap still fails closed', async () => {
    const manyLegs = Array.from({length:7}, (_,i)=>({from:{airportCode:i%2?'JFK':'LAX'},to:{airportCode:i%2?'LAX':'JFK'},mode:'flight'}));
    const manyStops = Array.from({length:6}, (_,i)=>({city:`S${i}`,nights:1,hotelEstimateUsd:10}));
    const env = { ...enabledEnv, GV_DUFFEL_P2_MAX_METRO_ALTERNATES_683H:'0' };
    const out = await h.buildLiveProviderResults683H({ candidateStarts:starts, baselineFirstLegResult:{}, legs:manyLegs, stops:manyStops, query:{adults:1}, displayCurrency:'USD' }, {
      env,
      searchExact: async args => liveResult(args.origin,args.destination,args.departureDate,100),
      normalizeFx: fxMock
    });
    assert.equal(out.supported, false);
    assert.equal(out.state.cap, 12);
    assert.equal(out.state.requests, 12);
    assert.match(out.reason,/request-cap/);
  });

  await testAsync('683M-R4 rate limit without reset metadata fails closed and stops the remaining provider plan', async () => {
    let calls=0;
    const out = await h.buildLiveProviderResults683H({ candidateStarts:starts, baselineFirstLegResult:{}, legs, stops, query:{adults:1}, displayCurrency:'USD' }, {
      env: enabledEnv,
      searchExact: async args => {
        calls += 1;
        if (calls === 2) return {supported:false,reason:'Too many requests hit API too quickly',statusCode:429,observations:[],rateLimit:{remaining:0,resetAtMs:null}};
        return liveResult(args.origin,args.destination,args.departureDate,100);
      },
      normalizeFx: fxMock
    });
    assert.equal(out.supported,false);
    assert.equal(out.state.abortReason,null);
    assert.equal(out.state.providerAbortEvents,0);
    assert.equal(out.state.proactiveQuotaFailClosed683MR3,true);
    assert.equal(out.reason,h.PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3);
    assert.equal(calls,2);
  });

  await testAsync('683I-R1 authorization failure aborts the remaining provider plan immediately', async () => {
    let calls=0;
    const out = await h.buildLiveProviderResults683H({ candidateStarts:starts, baselineFirstLegResult:{}, legs, stops, query:{adults:1}, displayCurrency:'USD' }, {
      env: enabledEnv,
      searchExact: async args => {
        calls += 1;
        return {supported:false,reason:'Unauthorized',statusCode:401,observations:[]};
      },
      normalizeFx: fxMock
    });
    assert.equal(out.supported,false);
    assert.equal(out.state.abortReason,'authorization');
    assert.ok(calls >= 1 && calls <= 2);
  });

  await testAsync('683M bounded concurrency runs independent legs in parallel without exceeding two', async () => {
    let active = 0; let peak = 0;
    const slow = async args => { active += 1; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 45)); active -= 1; return liveResult(args.origin,args.destination,args.departureDate,100); };
    const started = Date.now();
    const out = await h.buildLiveProviderResults683H({ candidateStarts:starts, baselineFirstLegResult:{}, legs, stops, query:{adults:1}, displayCurrency:'USD' }, { env: enabledEnv, searchExact: slow, normalizeFx: fxMock });
    const elapsed = Date.now() - started;
    assert.equal(out.supported,true);
    assert.equal(out.state.requests,6);
    assert.equal(peak,2);
    assert.equal(out.state.providerConcurrencyPeak683M,2);
    assert.equal(out.latency683M.boundedConcurrency,2);
    assert.ok(elapsed < 240, `expected bounded parallel critical path under 240ms; got ${elapsed}`);
  });

  await testAsync('683M request-scoped cache deduplicates identical provider requests', async () => {
    const state = h.requestState683H(enabledEnv);
    let calls = 0;
    const options = { env:enabledEnv, searchExact: async args => { calls += 1; await new Promise(r=>setTimeout(r,20)); return liveResult(args.origin,args.destination,args.departureDate,100); }, normalizeFx:fxMock };
    const [a,b] = await Promise.all([
      h.resolveExactLeg683H({origin:'LAX',destination:'JFK',departureDate:'2026-09-01',displayCurrency:'USD'},state,options),
      h.resolveExactLeg683H({origin:'LAX',destination:'JFK',departureDate:'2026-09-01',displayCurrency:'USD'},state,options)
    ]);
    assert.equal(a.supported,true); assert.equal(b.supported,true);
    assert.equal(calls,1);
    assert.equal(state.requests,1);
    assert.equal(state.deduplicatedRequests683M,1);
  });

  test('683M-R4 request state starts with unknown quota and full concurrency', () => {
    const state = h.requestState683H(enabledEnv);
    assert.equal(state.quotaRemaining683MR3, null);
    assert.equal(h.quotaAwareConcurrency683MR3(state), 2);
  });

  await testAsync('683M-R4 healthy quota scheduler permits peak concurrency two', async () => {
    const state = h.requestState683H(enabledEnv); state.quotaRemaining683MR3 = 8;
    let active=0, peak=0;
    const out = await h.mapQuotaAware683MR3([1,2,3,4], state, async x => { active+=1; peak=Math.max(peak,active); await new Promise(r=>setTimeout(r,20)); active-=1; return x; });
    assert.deepEqual(out,[1,2,3,4]); assert.equal(peak,2);
  });

  await testAsync('683M-R4 remaining-one quota degrades to serial concurrency one', async () => {
    const state = h.requestState683H(enabledEnv); state.quotaRemaining683MR3 = 1; state.quotaSerialMode683MR3 = true;
    let active=0, peak=0;
    const out = await h.mapQuotaReservation683MR4([1,2,3], state, async x => { active+=1; peak=Math.max(peak,active); await new Promise(r=>setTimeout(r,15)); active-=1; return x; });
    assert.deepEqual(out,[1,2,3]); assert.equal(peak,1);
  });

  await testAsync('683M-R4 remaining-two quota reserves a concurrent pair', async () => {
    const state = h.requestState683H(enabledEnv); state.quotaRemaining683MR3 = 2; state.quotaSerialMode683MR3 = false;
    let active=0, peak=0;
    const out = await h.mapQuotaReservation683MR4([1,2], state, async x => { active+=1; peak=Math.max(peak,active); await new Promise(r=>setTimeout(r,15)); active-=1; return x; });
    assert.deepEqual(out,[1,2]); assert.equal(peak,2); assert.equal(state.quotaReservationExactTwoBatches683MR4,1);
  });

  test('683M-R4 batch size equals min of two quota and outstanding work', () => {
    const state = h.requestState683H(enabledEnv);
    state.quotaRemaining683MR3 = 9; assert.equal(h.quotaReservationBatchSize683MR4(state,1),1);
    state.quotaRemaining683MR3 = 2; assert.equal(h.quotaReservationBatchSize683MR4(state,4),2);
    state.quotaRemaining683MR3 = 1; assert.equal(h.quotaReservationBatchSize683MR4(state,4),1);
    state.quotaRemaining683MR3 = 0; assert.equal(h.quotaReservationBatchSize683MR4(state,4),0);
  });

  test('683M-R4 concurrent quota metadata cannot overestimate remaining in same window', () => {
    const state = h.requestState683H(enabledEnv); const resetAtMs=5000;
    h.captureRateLimitMetadata683MR3({rateLimit:{limit:120,remaining:3,resetAtMs}},state);
    h.captureRateLimitMetadata683MR3({rateLimit:{limit:120,remaining:6,resetAtMs}},state);
    assert.equal(state.quotaRemaining683MR3,3);
    h.captureRateLimitMetadata683MR3({rateLimit:{limit:120,remaining:2,resetAtMs}},state);
    assert.equal(state.quotaRemaining683MR3,2); assert.equal(state.quotaSerialMode683MR3,false); assert.equal(state.quotaSerialModeSwitches683MR3,0);
  });

  test('683M-R4 fresh reset window with headroom exits serial mode', () => {
    const state = h.requestState683H(enabledEnv); state.quotaResetAtMs683MR3=1000; state.quotaRemaining683MR3=1; state.quotaSerialMode683MR3=true;
    h.captureRateLimitMetadata683MR3({rateLimit:{limit:120,remaining:9,resetAtMs:5000}},state);
    assert.equal(state.quotaRemaining683MR3,9); assert.equal(state.quotaSerialMode683MR3,false); assert.equal(h.quotaAwareConcurrency683MR3(state),2);
  });

  await testAsync('683M-R4 proactive zero quota waits once until provider reset', async () => {
    const state = h.requestState683H(enabledEnv); state.quotaRemaining683MR3=0; state.quotaResetAtMs683MR3=2000; let waited=0;
    const gate = await h.ensureQuotaBeforeLaunch683MR3(state,{nowMs683MR3:1000,sleep683MR3:async ms=>{waited=ms;}});
    assert.equal(gate.allowed,true); assert.equal(gate.waited,true); assert.equal(waited,1250); assert.equal(state.proactiveQuotaWaitCount683MR3,1); assert.equal(state.quotaRemaining683MR3,null); assert.equal(state.quotaSerialMode683MR3,true);
  });

  await testAsync('683M-R4 overlong proactive reset fails closed without sleeping', async () => {
    const state = h.requestState683H(enabledEnv); state.quotaRemaining683MR3=0; state.quotaResetAtMs683MR3=30000; let sleeps=0;
    const gate = await h.ensureQuotaBeforeLaunch683MR3(state,{nowMs683MR3:1000,sleep683MR3:async()=>{sleeps+=1;}});
    assert.equal(gate.allowed,false); assert.equal(sleeps,0); assert.equal(state.proactiveQuotaFailClosed683MR3,true); assert.equal(state.proactiveQuotaResetTooFar683MR3,1);
  });

  await testAsync('683M-R4 unknown quota launches immediately instead of treating null as zero', async () => {
    const state = h.requestState683H(enabledEnv); let calls=0, sleeps=0;
    const result = await h.physicalDuffelRequest683MR3({origin:'JFK',destination:'MEX',departureDate:'2026-09-01',currency:'USD',passengers:1},state,{
      searchExact:async()=>{calls+=1; return {supported:true,statusCode:200,observations:[],rateLimit:{limit:120,remaining:8,resetAtMs:5000}};},
      nowMs683MR3:1000, sleep683MR3:async()=>{sleeps+=1;}
    });
    assert.equal(result.supported,true); assert.equal(calls,1); assert.equal(sleeps,0); assert.equal(state.requests,1); assert.equal(state.proactiveQuotaFailClosed683MR3,false);
  });

  test('683M-R4 latency diagnostics expose proactive quota and reservation state', () => {
    const state = h.requestState683H(enabledEnv); state.quotaRemaining683MR3=2; state.quotaSerialMode683MR3=false; state.quotaReservationBatches683MR4=2; state.quotaReservationSlots683MR4=4; state.quotaReservationExactTwoBatches683MR4=1;
    const diag = h.latencyDiagnostics683M(state); assert.equal(diag.version,'GV-PROVIDER-683M-R4'); assert.equal(diag.proactiveQuotaScheduling683MR3.enabled,true); assert.equal(diag.proactiveQuotaScheduling683MR3.quotaRemaining,2); assert.equal(diag.proactiveQuotaScheduling683MR3.serialMode,false); assert.equal(diag.quotaReservationScheduling683MR4.enabled,true); assert.equal(diag.quotaReservationScheduling683MR4.reservedSlots,4); assert.equal(diag.quotaReservationScheduling683MR4.exactRemainingTwoPairBatches,1);
  });

  await testAsync('P2 evaluator consumes 683H rankingPriceUsd without overwriting provider price', async () => {
    const providerResults = [
      { observations:[{departureDate:'2026-09-01',price:140,currency:'CAD',rankingPriceUsd:100}] },
      { observations:[{departureDate:'2026-09-04',price:280,currency:'CAD',rankingPriceUsd:200}] }
    ];
    const candidate = p2.evaluateCandidate({ startDate:'2026-09-01', stops:[{nights:3}], legs:[{mode:'flight'},{mode:'flight'}], providerResults, isFlightLeg:()=>true, isGroundLeg:()=>false, convertProviderPriceToUsd:(price,currency,row)=>row.rankingPriceUsd, hotelEstimateUsd:100 });
    assert.equal(candidate.providerFlightTotalUsd,300);
    assert.equal(providerResults[0].observations[0].price,140);
  });

  await testAsync('simulation selects from two complete Duffel-backed schedules', async () => {
    const tour = { totalBudgetUsd:1000, legs, stops, originAccessEstimateUsd:20 };
    const out = await h.simulateTour683H({ tour, query:{ adults:1, budgetUsd:1000 }, candidateStarts:starts, baselineFirstLegResult:{ observations:[{departureDate:'2026-08-28',price:20},{departureDate:'2026-09-04',price:30}] }, displayCurrency:'USD' }, {
      env: enabledEnv,
      searchExact: async args => liveResult(args.origin,args.destination,args.departureDate,args.departureDate === '2026-08-28' ? 80 : 100),
      normalizeFx: fxMock
    });
    assert.equal(out.supported,true);
    assert.equal(out.selection.completeCandidateCount,2);
    assert.ok(out.selected);
    assert.equal(out.rankingSimulation,true);
  });

  test('metro airport application changes only airport code', () => {
    const leg = { from:{city:'Rome',airportCode:'CIA',code:'CIA'}, to:{city:'Dublin',airportCode:'DUB',code:'DUB'} };
    const patched = h.applyResolvedAirports683H(leg,{airportMode683H:'METRO_ORIGIN_ALTERNATE',resolvedOrigin:'FCO',resolvedDestination:'DUB',metroAirportFallback683H:{caveat:'x'}});
    assert.equal(patched.from.city,'Rome');
    assert.equal(patched.from.airportCode,'FCO');
    assert.equal(patched.to.airportCode,'DUB');
  });

  await testAsync('683H Lambda endpoint rejects unauthenticated POST before any provider call', async () => {
    const lambda = require('./lambda');
    const response = await lambda.handler({ rawPath:'/api/provider-p2-shadow/duffel-683h', requestContext:{ http:{ method:'POST' } }, headers:{}, body:'{}' });
    assert.equal(response.statusCode,403);
    assert.match(String(response.body),/admin-authorization-required/);
  });

  await testAsync('683H Lambda endpoint rejects non-POST method', async () => {
    const lambda = require('./lambda');
    const response = await lambda.handler({ rawPath:'/api/provider-p2-shadow/duffel-683h', requestContext:{ http:{ method:'GET' } }, headers:{} });
    assert.equal(response.statusCode,405);
  });

  const generatedSource = fs.readFileSync(path.join(__dirname,'generated-tour.js'),'utf8');

  test('683M-R4 rate-limit retry cap is one per generated-tour request', () => assert.equal(h.MAX_RATE_LIMIT_RETRIES_PER_REQUEST_683MR3, 1));
  test('683M-R4 reset wait safety cap is fifteen seconds', () => assert.equal(h.MAX_RATE_LIMIT_WAIT_MS_683MR3, 15000));
  test('683M-R4 status exposes reset-header-aware recovery', () => {
    const st = h.status683H(productionEnv683K, canaryContext683K);
    assert.equal(st.latencyOptimization683M.rateLimitRecovery683MR3.enabled, true);
    assert.equal(st.latencyOptimization683M.rateLimitRecovery683MR3.maxRetriesPerRequest, 1);
    assert.equal(st.latencyOptimization683M.rateLimitRecovery683MR3.maxWaitMs, 15000);
    assert.equal(st.latencyOptimization683M.rateLimitRecovery683MR3.retryConsumesRequestBudget, true);
  });
  test('683M-R4 wait plan rejects missing reset metadata', () => {
    const plan = h.rateLimitWaitPlan683MR3({statusCode:429,rateLimit:{}},{nowMs683MR3:1000});
    assert.equal(plan.eligible,false); assert.equal(plan.reason,'rate-limit-reset-header-missing-or-invalid');
  });
  test('683M-R4 wait plan rejects reset beyond strict safety cap', () => {
    const plan = h.rateLimitWaitPlan683MR3({statusCode:429,rateLimit:{resetAtMs:20000}},{nowMs683MR3:0});
    assert.equal(plan.eligible,false); assert.equal(plan.reason,'rate-limit-reset-wait-exceeds-safety-cap');
  });
  test('683M-R4 wait plan uses provider reset plus guard', () => {
    const plan = h.rateLimitWaitPlan683MR3({statusCode:429,rateLimit:{resetAtMs:2000}},{nowMs683MR3:1000});
    assert.equal(plan.eligible,true); assert.equal(plan.waitMs,1250);
  });
  await testAsync('683M-R4 recovers one 429 after provider reset without terminal abort', async () => {
    const state=h.requestState683H(readyEnv,{plannedRequestCap:8,mode:'test'});
    let calls=0; let waited=0;
    const out=await h.callDuffel683H({origin:'JFK',destination:'MEX',departureDate:'2026-09-01',currency:'USD',passengers:1},state,{
      searchExact:async()=>{ calls+=1; return calls===1
        ? {supported:false,statusCode:429,reason:'rate limit',rateLimit:{resetAtMs:2000,remaining:0,limit:120,reset:'Thu, 01 Jan 1970 00:00:02 GMT'}}
        : {supported:true,statusCode:200,observations:[],rateLimit:{remaining:119,limit:120}}; },
      nowMs683MR3:1000,
      sleep683MR3:async ms=>{waited=ms;}
    });
    assert.equal(out.supported,true); assert.equal(calls,2); assert.equal(waited,1250);
    assert.equal(state.requests,2); assert.equal(state.rateLimitEvents683MR3,1); assert.equal(state.rateLimitRetryCount683MR3,1);
    assert.equal(state.rateLimitRecoverySucceeded683MR3,1); assert.equal(state.rateLimitRecoveryFailed683MR3,0);
    assert.equal(state.providerAbortEvents,0); assert.equal(state.abortReason,null);
  });
  await testAsync('683M-R4 second 429 fails closed after only one retry', async () => {
    const state=h.requestState683H(readyEnv,{plannedRequestCap:8,mode:'test'});
    let calls=0;
    const out=await h.callDuffel683H({origin:'JFK',destination:'MEX',departureDate:'2026-09-01',currency:'USD',passengers:1},state,{
      searchExact:async()=>{ calls+=1; return {supported:false,statusCode:429,reason:'rate limit',rateLimit:{resetAtMs:2000,remaining:0}}; },
      nowMs683MR3:1000, sleep683MR3:async()=>{}
    });
    assert.equal(out.supported,false); assert.equal(calls,2); assert.equal(state.rateLimitEvents683MR3,2);
    assert.equal(state.rateLimitRetryCount683MR3,1); assert.equal(state.rateLimitRecoveryFailed683MR3,1);
    assert.equal(state.providerAbortEvents,0); assert.equal(state.abortReason,null);
    assert.equal(state.proactiveQuotaFailClosed683MR3,true); assert.equal(out.reason,h.PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3);
  });
  await testAsync('683M-R4 retry still consumes physical request budget', async () => {
    const state=h.requestState683H(readyEnv,{plannedRequestCap:4,mode:'test'});
    state.cap=1;
    const out=await h.callDuffel683H({origin:'JFK',destination:'MEX',departureDate:'2026-09-01',currency:'USD',passengers:1},state,{
      searchExact:async()=>({supported:false,statusCode:429,reason:'rate limit',rateLimit:{resetAtMs:2000}}),
      nowMs683MR3:1000, sleep683MR3:async()=>{}
    });
    assert.equal(out.supported,false); assert.equal(state.requests,1); assert.equal(state.rateLimitRetryCount683MR3,0);
    assert.equal(state.rateLimitRetryBlockedByCap683MR3,1); assert.equal(state.providerAbortEvents,0);
    assert.equal(state.proactiveQuotaFailClosed683MR3,true); assert.equal(out.reason,h.PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3);
  });
  const lambdaSource = fs.readFileSync(path.join(__dirname,'lambda.js'),'utf8');
  const serverSource = fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
  const serviceSource = fs.readFileSync(path.join(__dirname,'services/duffel-p2-staging-683h.js'),'utf8');
  test('generated-tour contains 683H dormant P2 hook', () => assert.match(generatedSource,/duffelP2Enabled683H/));
  test('683J generated-tour diagnostics expose request budget plan', () => assert.match(generatedSource,/requestBudgetPlan:\s*live683H\?\.requestBudgetPlan/));
  test('683J generated-tour diagnostics expose provider abort state', () => assert.match(generatedSource,/providerAbortReason:\s*live683H\?\.state\?\.abortReason/));
  test('normal-flow hook uses explicit staging acknowledgement', () => assert.match(serviceSource,/ACK_DUFFEL_P2_STAGING_ONLY_683H/));
  test('683J normal-flow hook requires explicit activation flag', () => assert.match(serviceSource,/ENABLE_DUFFEL_P2_STAGING_ACTIVATION_683J/));
  test('683J normal-flow hook requires staging runtime identity', () => assert.match(serviceSource,/GV_RUNTIME_ENVIRONMENT/));
  test('683H requires two complete live schedules', () => assert.match(serviceSource,/completeScheduleCount >= 2/));
  test('683H uses exact airport first', () => assert.match(serviceSource,/coverageMode: 'EXACT'/));
  test('683H metro fallback is labelled', () => assert.match(serviceSource,/METRO_DESTINATION_ALTERNATE/));
  test('683H records unpriced ground-access caveat on metro fallback', () => assert.match(serviceSource,/groundAccessEstimateAdjusted: false/));
  test('683H uses fresh FX normalization for ranking USD', () => assert.match(serviceSource,/rankingPriceUsd/));
  test('683I-R1 uses itinerary-aware dynamic request budget', () => assert.match(serviceSource,/dynamic-itinerary-bounded/));
  test('683I-R1 request budget counts metro-sensitive flight legs', () => assert.match(serviceSource,/metroSensitiveFlightLegCount683IR1/));
  test('683I-R1 hard ceiling remains twelve provider requests', () => assert.match(serviceSource,/MAX_HARD_REQUEST_CAP_683H = 12/));
  test('683M-R4 classifies provider rate-limit and authorization responses before safe handling', () => assert.match(serviceSource,/providerAbortReason683IR1/));
  test('683J staging status endpoint exists in Lambda', () => assert.match(lambdaSource,/\/api\/provider-p2-staging-status\/683j/));
  test('683J staging status endpoint exists in local server', () => assert.match(serverSource,/\/api\/provider-p2-staging-status\/683j/));
  test('683J staging status endpoint requires admin authorization', () => assert.match(lambdaSource,/provider-p2-staging-status\/683j[\s\S]{0,700}isLiveCoverageAuthorized/));
  test('683K canary status endpoint exists in Lambda', () => assert.match(lambdaSource,/\/api\/provider-p2-canary-status\/683k/));
  test('683M latency status endpoint exists in Lambda', () => assert.match(lambdaSource,/\/api\/provider-p2-latency-status\/683m/));
  test('683K canary status endpoint exists in local server', () => assert.match(serverSource,/\/api\/provider-p2-canary-status\/683k/));
  test('683M latency status endpoint exists in local server', () => assert.match(serverSource,/\/api\/provider-p2-latency-status\/683m/));
  test('683K canary status requires admin authorization', () => assert.match(lambdaSource,/provider-p2-canary-status\/683k[\s\S]{0,700}isLiveCoverageAuthorized/));
  test('683K generated-tour strips public private-marker spoofing', () => assert.match(lambdaSource,/delete next\.__gvProviderCanary683K/));
  test('683K generated-tour requires canary header plus admin authorization', () => { assert.match(lambdaSource,/X-GV-Provider-Canary/i); assert.match(lambdaSource,/requested && isLiveCoverageAuthorized\(headers\)/); });
  test('683K generated-tour passes request context into Duffel P2 gate', () => { assert.match(generatedSource,/duffelP2Enabled683H\(process\.env, query\)/); assert.match(generatedSource,/duffelP2Status683H\(process\.env, query\)/); });
  test('683H shadow endpoint exists in Lambda', () => assert.match(lambdaSource,/\/api\/provider-p2-shadow\/duffel-683h/));
  test('683H shadow endpoint exists in local server', () => assert.match(serverSource,/\/api\/provider-p2-shadow\/duffel-683h/));
  test('683H shadow endpoint requires admin authorization', () => assert.match(lambdaSource,/provider-p2-shadow\/duffel-683h[\s\S]{0,900}isLiveCoverageAuthorized/));
  test('683H endpoint declares ranking simulation only', () => assert.match(lambdaSource,/rankingSimulationOnly: true/));
  test('683H endpoint declares normal recommendation unchanged', () => assert.match(lambdaSource,/normalRecommendationChanged: false/));
  test('683H source has no Duffel order endpoint', () => assert.doesNotMatch(serviceSource,/\/air\/orders/));
  test('683H source has no payment endpoint', () => assert.doesNotMatch(serviceSource,/payment_intent|\/payments\//i));
  test('683H source contains no token literal', () => assert.doesNotMatch(serviceSource,/duffel_live_[A-Za-z0-9_-]{10,}/));
  test('683H never marks production approved true', () => assert.doesNotMatch(serviceSource,/productionApproved:\s*true/));

  test('683J-R1 canonicalizer is wired through 683C', () => assert.match(serviceSource,/normalizeObservation683C/));
  const liveVerifierSource = fs.readFileSync(path.join(__dirname,'services/domain/live-fares/live-provider-verification.js'),'utf8');
  test('683J-R2 final-tour common evidence propagates R2 canonical marker', () => assert.match(generatedSource,/canonicalLiveEvidence683JR2:\s*selected\.canonicalLiveEvidence683JR2/));
  test('683J-R2 final-tour common evidence propagates provider evidence class', () => assert.match(generatedSource,/providerEvidenceClass:\s*selected\.providerEvidenceClass/));
  test('683J-R2 final-tour common evidence propagates provider ranking grade', () => assert.match(generatedSource,/providerRankingGrade:\s*selected\.providerRankingGrade/));
  test('683J-R2 verifier has explicit evidence non-downgrade guard', () => assert.match(liveVerifierSource,/existing-live-decision-grade-preserved-683j-r2/));
  test('683J-R2 verifier skips redundant lower-grade provider lookup', () => assert.match(liveVerifierSource,/if \(preserved683JR2\) return preserved683JR2/));
  test('683J-R1 canonicalizer validates provider currency before display FX', () => assert.match(serviceSource,/currency:\s*providerCurrency/));
  test('683J-R1 final-tour fail-closed returns baseline provider results', () => assert.match(generatedSource,/providerResults:\s*liveSelectionFailClosed683JR1\s*\?\s*providerResults\s*:\s*activeProviderResults681BP2/));
  test('683J-R1 diagnostics expose fail-closed marker', () => assert.match(generatedSource,/liveSelectionFailClosed683JR1/));
  test('683J-R1 diagnostics expose explicit no-live-budget-fit reason', () => assert.match(serviceSource,/683j-r1-no-live-budget-fit-schedule/));
  test('683J-R1 diagnostics expose explicit no-live-quality reason', () => assert.match(serviceSource,/683j-r1-no-live-quality-eligible-schedule/));

  await testAsync('683J-R1 canonical live evidence survives FX normalization', async () => {
    const raw = rawDuffel683DResult('YYZ','LIS','2026-09-09',312.8,'USD').observations[0];
    raw.requestedCurrency = 'CAD';
    raw.providerEndpoint = '/air/offer_requests';
    const out = await h.normalizeLiveObservation683H(raw, 'CAD', { env: enabledEnv, normalizeFx: fxMock });
    assert.equal(out.supported, true);
    assert.equal(out.observation.source, 'duffel-live-683d');
    assert.equal(out.observation.sourceType, 'LIVE');
    assert.equal(out.observation.priceEvidence.sourceType, 'LIVE');
    assert.equal(out.observation.priceEvidence.isExactDate, true);
    assert.equal(out.observation.priceEvidence.routeMatch, true);
    assert.equal(out.observation.priceEvidence.dateMatch, true);
    assert.equal(out.observation.providerCurrency, 'USD');
    assert.equal(out.observation.displayCurrency, 'CAD');
    assert.equal(out.observation.currencyMismatch, true);
    assert.equal(out.observation.providerEvidenceClass, 'LIVE_PROVIDER');
    assert.equal(out.observation.providerRankingGrade, 'DECISION_GRADE');
    assert.equal(out.observation.canonicalLiveEvidence683JR2.version, 'GV-PROVIDER-683J-R2');
    assert.equal(out.observation.canonicalLiveEvidence683JR2.nonDowngradeEligible, true);
  });

  await testAsync('683J-R2 later provider verification cannot downgrade selected Duffel LIVE evidence', async () => {
    const raw = rawDuffel683DResult('JFK','MEX','2026-09-01',253,'USD').observations[0];
    const normalized = await h.normalizeLiveObservation683H(raw, 'USD', { env: enabledEnv, normalizeFx: fxMock });
    assert.equal(normalized.supported, true);
    let downstreamFetchCalls = 0;
    const ev = {
      ...normalized.observation,
      providerBacked: true,
      appliedToEstimate: true,
      perPassengerAmountUsd: normalized.observation.rankingPriceUsd
    };
    const leg = {
      mode: 'flight', transportType: 'flight', departureDate: '2026-09-01',
      from: { airportCode: 'JFK' }, to: { airportCode: 'MEX' },
      providerDateEvidence: ev, cheapestOneWay: ev
    };
    const verified = await liveVerification683JR2._internal.verifyFlightLeg(leg, { currency:'USD', adults:1 }, {
      _fetchFn: async () => { downstreamFetchCalls += 1; throw new Error('lower-grade verifier should not be called'); }
    });
    assert.equal(downstreamFetchCalls, 0);
    assert.equal(verified.outcome, 'live-provider-observation-preserved-683j-r2');
    assert.equal(verified.leg.providerDateEvidence.source, 'duffel-live-683d');
    assert.equal(verified.leg.providerDateEvidence.sourceType, 'LIVE');
    assert.equal(verified.leg.providerDateEvidence.priceEvidence.sourceType, 'LIVE');
    assert.equal(verified.leg.providerDateEvidence.canonicalLiveEvidence683JR2.version, 'GV-PROVIDER-683J-R2');
    assert.equal(verified.leg.providerVerification.verified, true);
    assert.equal(verified.leg.providerVerification.nonDowngradePreserved683JR2, true);
  });

  test('683J-R1 fail-closed classifies no budget-fit live schedule', () => {
    assert.equal(h.liveSelectionFailClosedReason683JR1({ applied:false, duffelAppliedToRanking:true, selection:{completeCandidateCount:2,qualityEligibleCandidateCount:2,budgetFitCandidateCount:0} }), '683j-r1-no-live-budget-fit-schedule');
  });
  test('683J-R1 fail-closed classifies no quality-eligible live schedule', () => {
    assert.equal(h.liveSelectionFailClosedReason683JR1({ applied:false, duffelAppliedToRanking:true, selection:{completeCandidateCount:2,qualityEligibleCandidateCount:0,budgetFitCandidateCount:2} }), '683j-r1-no-live-quality-eligible-schedule');
  });
  test('683J-R1 fail-closed classifier is inactive after successful selection', () => {
    assert.equal(h.liveSelectionFailClosedReason683JR1({ applied:true, duffelAppliedToRanking:true, selection:{completeCandidateCount:2,qualityEligibleCandidateCount:2,budgetFitCandidateCount:2} }), null);
  });

  console.log(`PASS ${passed}/${passed} - GV-PROVIDER-683M-R4 backend`);
})().catch(err => { console.error(err); process.exitCode = 1; });
