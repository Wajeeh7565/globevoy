'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const filename = path.join(__dirname, 'generated-tour.js');
const source = fs.readFileSync(filename, 'utf8');
const realRequire = createRequire(filename);
const numericFields = ['globalRouteGraphMs', 'legacyRouteEngineMs', 'candidatePreparationMs',
  'routeSelectionMs', 'initial684BMs', 'cheapFlightEnrichmentMs', 'publicLiveFare684AMs',
  'liveProviderVerificationMs', 'finalizationMs', 'totalMs'];
const plain = value => JSON.parse(JSON.stringify(value));

// Evaluate the complete production module. Only test dependencies/local business
// collaborators are replaced; getGeneratedTour and its instrumentation run unchanged.
function harness(config = {}, moduleSource = source) {
  let now = 0n;
  const calls = [];
  const advance = ms => { now += BigInt(ms) * 1000000n; };
  const r2 = { version: 'GV-PERF-R2', scope: '684a-exact-initial', active: true,
    initialQuotaKnown: false, initialQuotaRemaining: null, initialBatchSize: 3,
    configuredInitialCeiling: 3, exactPhysicalConcurrencyPeak: 3,
    metroConfiguredCeiling: 2, metroPhysicalConcurrencyPeak: 0 };
  const first = { id: 'first', stops: [{ airportCode: 'LHR' }], estimatedTotalUsd: 300 };
  const selected = { id: 'selected', stops: [{ airportCode: 'JFK' }], estimatedTotalUsd: 250 };
  const enrichment = async tour => { calls.push('enrich'); advance(17); return {
    tour, summary: { scannedLegCount: 3, liveProviderCallsMade: 3 }
  }; };
  let entryChecks = 0;
  const deps = {
    './multicity-routes': { getMultiCityTours: async () => {
      calls.push('legacy'); advance(5);
      if (config.legacyThrows) throw new Error('legacy failure');
      return { tours: [first, selected], requested: { origin: 'YYZ' }, diagnostics: { baseline: true } };
    } },
    './services/global-route-graph': {
      globalRouteGraphEnabled: () => config.graph !== false,
      generateProviderDrivenGlobalRouteCandidates: async () => {
        calls.push('graph'); advance(3);
        if (config.graphWait) await config.graphWait;
        return { tours: config.emptyGraph ? [] : [first], diagnostics: { enabled: true } };
      }
    },
    './services/domain/routing/route-feasibility': {
      guardEnabled: () => false, maxStopsForTrip: () => 3,
      guardCandidateTours: rows => ({ tours: rows }),
      evaluateTour: tour => { calls.push('guard'); advance(23); return {
        accepted: !config.guardRejects, tour, reasons: [], warnings: [], metrics: {}
      }; }
    },
    './services/travel-entry-eligibility': {
      recommendationEligibility: () => {
        calls.push('entry'); advance(7); entryChecks += 1;
        return { hardBlocked: Boolean(config.entryBlocked && entryChecks <= 2), summary: {}, checks: [] };
      }
    },
    './services/affordable-flight-discovery-684b': {
      discoverAffordableFlightTour684B: async (_rows, tour) => {
        calls.push('684B'); advance(11);
        if (config.discoveryApplies) return { tour: selected,
          enrichment: { tour: selected, summary: { liveProviderCallsMade: 3 } },
          summary: { applied: true } };
        return { summary: { applied: false, reason: 'not-needed' } };
      },
      status684B: () => { advance(3); return { enabled: true }; }
    },
    './services/public-live-fare-pilot-684a': {
      applyPublicLiveFarePilot684A: async tour => {
        calls.push('684A'); advance(23);
        return { tour, summary: { applied: true, overBudget: Boolean(config.overBudget),
          exactConcurrencyExperimentR2: r2, latency: { exactConcurrencyExperimentR2: r2, physicalProviderRequests: 3 } } };
      },
      status684A: () => { advance(2); return { enabled: true }; }
    },
    './services/live-provider-verification': {
      verifyTourWithLiveProviders: async tour => {
        calls.push('verify'); advance(29); return { tour, summary: { overBudget: Boolean(config.overBudget) } };
      }
    }
  };
  const locals = {
    generatedTourEnabled: () => config.enabled !== false,
    prepareFlexibleLeadTimeQuery680BR1: q => q,
    resolveAdaptiveDuration674A: q => ({ mode: config.refine ? 'adaptive' : 'fixed', nights: q.__smartDurationDecision677A ? 8 : 7 }),
    normalizeTravelPace680BR1: () => 'balanced', preferenceTheme680BR1: () => null,
    allTourStopsProductionActive: () => true,
    priceTourForParty: t => { calls.push('party-price'); advance(2); return t; },
    smartDurationFlightSelection677AEnabled: () => Boolean(config.refine),
    roleScopedCandidatePool670a: rows => rows,
    selectBudgetSafeTour: rows => rows[0],
    resolveSmartDuration677A: () => ({ mode: 'adaptive', nights: 8 }),
    selectTourWithOptionalProviderRanking: async rows => {
      calls.push('select'); advance(13);
      assert.deepEqual(plain(rows.map(t => t.id)), config.legacyThrows ? ['first'] : ['first', 'selected']);
      if (config.noSelection) return null;
      const chosen = rows[rows.length - 1];
      return { tour: chosen, ...(config.reuse ? { enrichment: await enrichment(chosen) } : {}), routeRanking: {} };
    },
    enrichTourWithCheapFlights: enrichment,
    isOverUserBudget: () => false,
    strictBudgetFit684BR3: () => ({ overBudget: Boolean(config.overBudget) }),
    requestedPickRole670a: () => null,
    exactDateWindow669d: () => null,
    buildVisualizerTour: t => { calls.push('visualize'); advance(19); return { ...t }; },
    decoratePickTour670a: t => t,
    globalFallbackResponse: async () => {
      calls.push('fallback'); advance(31);
      return config.fallback ? { ok: true, supported: true, tour: selected, diagnostics: { fallback: true } } : null;
    },
    attemptBudgetSafeRouteRecovery669c: async () => { calls.push('recovery'); advance(37); return null; }
  };
  const sandbox = {
    module: { exports: {} }, exports: {}, __dirname, __filename: filename,
    process: { env: {}, hrtime: { bigint: () => now } },
    console, URL, Buffer,
    require: id => ({ ...realRequire(id), ...(deps[id] || {}) }),
    __localsR3: locals
  };
  // Test-only assignments to existing local function declarations, never source edits.
  const injected = Object.keys(locals).map(name => `${name} = __localsR3.${name};`).join('\n');
  vm.runInNewContext(moduleSource + '\n' + injected, sandbox, { filename });
  return { run: q => sandbox.module.exports.getGeneratedTour(q), calls, r2, selected, advance };
}
function timings(result) {
  const p = result.diagnostics.performanceR3;
  assert.equal(p.version, 'GV-PERF-R3');
  assert.deepEqual(Object.keys(p).sort(), ['version', 'cheapFlightEnrichmentReused', ...numericFields].sort());
  for (const key of numericFields) assert.ok(Number.isFinite(p[key]) && p[key] >= 0, key);
  assert.equal(typeof p.cheapFlightEnrichmentReused, 'boolean');
  return p;
}

for (const reuse of [false, true]) test(`successful timing and selection; enrichment reused=${reuse}`, async () => {
  const h = harness({ reuse }); const result = await h.run({ adults: 1 });
  assert.equal(result.supported, true); assert.equal(result.tour.id, 'selected');
  assert.equal(result.tours[0], result.tour); assert.equal(result.tour.estimatedTotalUsd, 250);
  const p = timings(result);
  assert.equal(p.globalRouteGraphMs, 3); assert.equal(p.legacyRouteEngineMs, 5);
  assert.equal(p.candidatePreparationMs, 18);
  assert.equal(p.routeSelectionMs, reuse ? 30 : 13);
  assert.equal(p.initial684BMs, 11);
  assert.equal(p.cheapFlightEnrichmentMs, reuse ? 0 : 17);
  assert.equal(p.cheapFlightEnrichmentReused, reuse);
  assert.equal(p.publicLiveFare684AMs, 23); assert.equal(p.liveProviderVerificationMs, 29);
  assert.equal(p.finalizationMs, 54); assert.equal(p.totalMs, 173);
  assert.equal(h.calls.filter(x => x === 'enrich').length, 1);
  assert.deepEqual(h.calls.filter(x => ['684B','684A','verify'].includes(x)), ['684B','684A','verify']);
  assert.deepEqual(plain(result.diagnostics.publicLiveFarePilot684A.exactConcurrencyExperimentR2), h.r2);
  assert.deepEqual(plain(result.pricingPolicy.publicLiveFarePilot684A.summary.latency.exactConcurrencyExperimentR2), h.r2);
  assert.equal(result.diagnostics.publicLiveFarePilot684A.latency.physicalProviderRequests, 3);
  assert.equal(result.tour.performanceR3, undefined);
});

test('684B supplied enrichment is reused without an explicit cheap-flight call', async () => {
  const h = harness({ discoveryApplies: true }); const result = await h.run({});
  const p = timings(result); assert.equal(p.cheapFlightEnrichmentReused, true);
  assert.equal(p.cheapFlightEnrichmentMs, 0); assert.equal(h.calls.includes('enrich'), false);
  assert.equal(h.calls.filter(x => x === '684B').length, 1);
});

test('route-engine wall time includes time suspended awaiting its result', async () => {
  let release;
  const graphWait = new Promise(resolve => { release = resolve; });
  const h = harness({ graphWait }); const pending = h.run({});
  assert.deepEqual(h.calls, ['graph']);
  h.advance(50); release();
  const p = timings(await pending);
  assert.equal(p.globalRouteGraphMs, 53);
  assert.equal(p.totalMs, 223);
});

test('disabled graph reports zero and does not generate graph candidates', async () => {
  const h = harness({ graph: false }); const result = await h.run({});
  assert.equal(timings(result).globalRouteGraphMs, 0); assert.equal(h.calls.includes('graph'), false);
});

test('legacy error with graph candidates times only the failed engine call', async () => {
  const h = harness({ legacyThrows: true });
  const result = await h.run({});
  assert.equal(result.tour.id, 'first');
  assert.equal(timings(result).legacyRouteEngineMs, 5);
  assert.equal(h.calls.filter(x => x === 'legacy').length, 1);
  assert.equal(h.calls.includes('fallback'), false);
});

for (const [config, reason] of [
  [{ enabled: false }, 'feature-disabled'],
  [{ entryBlocked: true }, 'no-entry-eligible-route'],
  [{ noSelection: true }, undefined],
  [{ guardRejects: true }, 'no-route-passed-feasibility-guard'],
  [{ overBudget: true }, 'provider-verified-route-over-budget']
]) test(`early return preserves outcome: ${reason || 'no selection'}`, async () => {
  const h = harness(config); const result = await h.run({});
  const p = timings(result); assert.equal(result.reason, reason);
  assert.equal(result.tour ?? null, null);
  if (config.enabled === false || config.entryBlocked || config.noSelection) {
    assert.equal(p.publicLiveFare684AMs, 0); assert.equal(h.calls.includes('684A'), false);
  }
  if (config.overBudget) assert.equal(p.finalizationMs, 37);
});

test('successful early fallback gets total wall time without inventing main phase calls', async () => {
  const h = harness({ noSelection: true, fallback: true }); const result = await h.run({});
  assert.equal(result.supported, true); assert.equal(result.tour.id, 'selected');
  const p = timings(result); assert.equal(p.totalMs, 81);
  assert.equal(p.publicLiveFare684AMs, 0); assert.equal(p.finalizationMs, 0);
  assert.equal(h.calls.includes('684A'), false);
});

test('failed legacy engine and unsuccessful fallback preserve original exception', async () => {
  const h = harness({ legacyThrows: true, emptyGraph: true });
  await assert.rejects(h.run({}), /legacy failure/);
  assert.deepEqual(h.calls, ['graph', 'legacy', 'fallback']);
});

test('smart-duration recursion retains selected-pass stages and outer total', async () => {
  const h = harness({ refine: true }); const result = await h.run({});
  const p = timings(result);
  assert.equal(result.tour.id, 'selected');
  assert.equal(p.globalRouteGraphMs, 6); assert.equal(p.legacyRouteEngineMs, 10);
  assert.equal(p.candidatePreparationMs, 36);
  assert.equal(p.routeSelectionMs, 13); assert.equal(p.publicLiveFare684AMs, 23);
  assert.equal(p.finalizationMs, 54); assert.equal(p.totalMs, 199);
  assert.equal(h.calls.filter(x => x === 'select').length, 1);
  assert.equal(h.calls.filter(x => x === '684A').length, 1);
});

test('concurrent requests have independent timing objects', async () => {
  const h = harness(); const [a, b] = await Promise.all([h.run({}), h.run({})]);
  timings(a); timings(b); assert.notEqual(a.diagnostics.performanceR3, b.diagnostics.performanceR3);
  assert.equal(h.calls.filter(x => x === '684A').length, 2);
});

// Optional local baseline comparison uses an exact, separately verified source file;
// it is never downloaded and is not required by normal test execution.
if (process.argv.includes('--compare-base')) {
  const baselinePath = process.argv[process.argv.indexOf('--compare-base') + 1];
  const baseline = fs.readFileSync(baselinePath, 'utf8');
  for (const config of [{}, { reuse: true }, { discoveryApplies: true }, { guardRejects: true },
    { overBudget: true }, { refine: true }, { entryBlocked: true }, { noSelection: true }, { noSelection: true, fallback: true }, { enabled: false }]) {
    test(`exact-base result and call parity ${JSON.stringify(config)}`, async () => {
      const before = harness(config, baseline), after = harness(config);
      const a = plain(await before.run({})), b = plain(await after.run({}));
      delete b.diagnostics.performanceR3;
      if (!a.diagnostics) delete b.diagnostics;
      assert.deepEqual(b, a); assert.deepEqual(after.calls, before.calls);
    });
  }
}
