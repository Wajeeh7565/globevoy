'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const backendDir = path.resolve(__dirname, '../../backend');
const filename = path.join(backendDir, 'services/domain/tours/generated-tour.js');
const source = fs.readFileSync(filename, 'utf8');
const realRequire = createRequire(filename);
const plain = value => JSON.parse(JSON.stringify(value));

function harness(config = {}) {
  let now = 0n;
  const calls = [];
  const advance = ms => { now += BigInt(ms) * 1000000n; };
  const graphR4 = {
    version: 'GV-PERF-R4',
    firstProviderScanMs: 23,
    secondProviderScansMs: 61,
    secondProviderScanCount: 4,
    providerCandidateBuildMs: 7,
    deterministicFallbackMs: 9
  };
  const r2 = {
    version: 'GV-PERF-R2',
    scope: '684a-exact-initial',
    active: false,
    initialQuotaKnown: false,
    initialQuotaRemaining: null,
    initialBatchSize: 2,
    configuredInitialCeiling: 2,
    exactPhysicalConcurrencyPeak: 2,
    metroConfiguredCeiling: 2,
    metroPhysicalConcurrencyPeak: 0
  };
  const first = { id: 'first', stops: [{ airportCode: 'LHR' }], estimatedTotalUsd: 300 };
  const selected = { id: 'selected', stops: [{ airportCode: 'MEX' }], estimatedTotalUsd: 250 };
  const rescued = { id: 'rescued', stops: [{ airportCode: 'CUN' }], estimatedTotalUsd: 220 };
  let discoveryCalls = 0;
  let verifyCalls = 0;

  const enrich = async tour => {
    calls.push('enrich');
    advance(17);
    return { tour, summary: { scannedLegCount: 2, liveProviderCallsMade: 2 } };
  };

  const deps = {
    '../routing/multicity-routes': {
      getMultiCityTours: async () => {
        calls.push('legacy');
        advance(5);
        return { tours: [first, selected], requested: { origin: 'YYZ' }, diagnostics: { baseline: true } };
      }
    },
    '../routing/global-route-graph': {
      globalRouteGraphEnabled: () => true,
      generateProviderDrivenGlobalRouteCandidates: async () => {
        calls.push('graph');
        advance(100);
        return {
          tours: [first],
          diagnostics: { enabled: true, performanceR4: graphR4 }
        };
      }
    },
    '../routing/route-feasibility': {
      guardEnabled: () => false,
      maxStopsForTrip: () => 3,
      guardCandidateTours: rows => ({ tours: rows }),
      evaluateTour: tour => {
        calls.push('guard');
        advance(13);
        return { accepted: true, tour, reasons: [], warnings: [], metrics: {} };
      }
    },
    '../eligibility/travel-entry-eligibility': {
      recommendationEligibility: () => ({ hardBlocked: false, summary: {}, checks: [] })
    },
    '../live-fares/affordable-flight-discovery-684b': {
      discoverAffordableFlightTour684B: async (_rows, tour) => {
        discoveryCalls += 1;
        if (discoveryCalls === 1) {
          calls.push('684B-initial');
          advance(11);
          return {
            summary: {
              applied: false,
              reason: config.rescue ? '684b-selected-route-already-has-flight' : 'not-needed'
            }
          };
        }
        calls.push('684B-rescue');
        advance(41);
        return {
          tour: rescued,
          enrichment: {
            tour: rescued,
            summary: { scannedLegCount: 2, liveProviderCallsMade: 2 },
            publicLiveFarePilot684A: { applied: true, overBudget: false }
          },
          summary: { applied: true, providerRequests: 5 }
        };
      },
      status684B: () => {
        if (config.responseAssemblyAdvance !== false) advance(2);
        return { enabled: true };
      }
    },
    '../live-fares/public-live-fare-pilot-684a': {
      applyPublicLiveFarePilot684A: async tour => {
        calls.push('684A');
        advance(23);
        return {
          tour,
          summary: {
            applied: true,
            overBudget: Boolean(config.rescue || config.overBudgetNoRescue),
            exactConcurrencyExperimentR2: r2,
            latency: { exactConcurrencyExperimentR2: r2, physicalProviderRequests: 2 }
          }
        };
      },
      status684A: () => {
        if (config.responseAssemblyAdvance !== false) advance(3);
        return { enabled: true };
      }
    },
    '../live-fares/live-provider-verification': {
      verifyTourWithLiveProviders: async tour => {
        verifyCalls += 1;
        calls.push(verifyCalls === 1 ? 'verify-initial' : 'verify-rescue');
        advance(verifyCalls === 1 ? 29 : 17);
        return {
          tour,
          summary: { overBudget: verifyCalls === 1 && Boolean(config.rescue || config.overBudgetNoRescue) }
        };
      }
    }
  };

  const locals = {
    generatedTourEnabled: () => true,
    prepareFlexibleLeadTimeQuery680BR1: q => q,
    resolveAdaptiveDuration674A: () => ({ mode: 'fixed', nights: 8 }),
    normalizeTravelPace680BR1: () => 'balanced',
    preferenceTheme680BR1: () => null,
    allTourStopsProductionActive: () => true,
    priceTourForParty: t => t,
    smartDurationFlightSelection677AEnabled: () => false,
    roleScopedCandidatePool670a: rows => rows,
    selectBudgetSafeTour: rows => rows[0],
    selectTourWithOptionalProviderRanking: async rows => {
      calls.push('select');
      advance(13);
      return { tour: rows[rows.length - 1], routeRanking: {} };
    },
    enrichTourWithCheapFlights: enrich,
    isOverUserBudget: () => false,
    isOverUserBudgetStrict684BR3: tour => tour?.id === 'selected' && Boolean(config.rescue || config.overBudgetNoRescue),
    strictBudgetFit684BR3: tour => ({
      overBudget: tour?.id === 'selected' && Boolean(config.rescue || config.overBudgetNoRescue)
    }),
    requestedPickRole670a: () => null,
    exactDateWindow669d: () => null,
    buildVisualizerTour: tour => {
      calls.push('visualize');
      advance(19);
      return { ...tour };
    },
    decoratePickTour670a: t => t,
    globalFallbackResponse: async () => null,
    attemptBudgetSafeRouteRecovery669c: async () => {
      calls.push('recovery');
      advance(37);
      return null;
    }
  };

  const sandbox = {
    module: { exports: {} },
    exports: {},
    __dirname: path.dirname(filename),
    __filename: filename,
    process: { env: {}, hrtime: { bigint: () => now } },
    console,
    URL,
    Buffer,
    require: id => ({ ...realRequire(id), ...(deps[id] || {}) }),
    __localsR4: locals
  };
  const injected = Object.keys(locals).map(name => `${name} = __localsR4.${name};`).join('\n');
  vm.runInNewContext(source + '\n' + injected, sandbox, { filename });
  return { run: q => sandbox.module.exports.getGeneratedTour(q), calls, graphR4, r2, rescued };
}

function timingR4(result) {
  const p = result.diagnostics.performanceR4;
  assert.equal(p.version, 'GV-PERF-R4');
  for (const key of [
    'firstProviderScanMs', 'secondProviderScansMs', 'secondProviderScanCount',
    'providerCandidateBuildMs', 'deterministicFallbackMs', 'postLive684BRescueMs',
    'rescueProviderRequests', 'budgetRecoveryMs', 'visualizerMs', 'finalGuardMs',
    'responseAssemblyMs'
  ]) {
    assert.ok(Number.isFinite(p[key]) && p[key] >= 0, key);
  }
  return p;
}

test('R4 copies graph breakdown and preserves R3 response diagnostics', async () => {
  const h = harness();
  const result = await h.run({ adults: 1 });
  assert.equal(result.supported, true);
  const p = timingR4(result);
  assert.equal(p.firstProviderScanMs, h.graphR4.firstProviderScanMs);
  assert.equal(p.secondProviderScansMs, h.graphR4.secondProviderScansMs);
  assert.equal(p.secondProviderScanCount, h.graphR4.secondProviderScanCount);
  assert.equal(p.providerCandidateBuildMs, h.graphR4.providerCandidateBuildMs);
  assert.equal(p.deterministicFallbackMs, h.graphR4.deterministicFallbackMs);
  assert.equal(p.postLive684BRescueMs, 0);
  assert.equal(p.rescueProviderRequests, 0);
  assert.equal(p.budgetRecoveryMs, 0);
  assert.equal(p.visualizerMs, 19);
  assert.equal(p.finalGuardMs, 13);
  assert.equal(p.responseAssemblyMs, 5);
  assert.equal(result.diagnostics.performanceR3.version, 'GV-PERF-R3');
  assert.deepEqual(plain(result.diagnostics.publicLiveFarePilot684A.exactConcurrencyExperimentR2), h.r2);
});

test('R4 isolates post-live 684B rescue time and request count', async () => {
  const h = harness({ rescue: true });
  const result = await h.run({ adults: 1 });
  assert.equal(result.supported, true);
  assert.equal(result.tour.id, 'rescued');
  const p = timingR4(result);
  assert.equal(p.postLive684BRescueMs, 58);
  assert.equal(p.rescueProviderRequests, 5);
  assert.equal(p.budgetRecoveryMs, 0);
  assert.deepEqual(
    h.calls.filter(x => x.startsWith('684B') || x.startsWith('verify')),
    ['684B-initial', 'verify-initial', '684B-rescue', 'verify-rescue']
  );
});

test('R4 measures recursive budget recovery wait on unresolved live over-budget route', async () => {
  const h = harness({ overBudgetNoRescue: true });
  const result = await h.run({ adults: 1 });
  assert.equal(result.supported, false);
  assert.equal(result.reason, 'provider-verified-route-over-budget');
  const p = timingR4(result);
  assert.equal(p.postLive684BRescueMs, 0);
  assert.equal(p.rescueProviderRequests, 0);
  assert.equal(p.budgetRecoveryMs, 37);
  assert.equal(p.visualizerMs, 0);
  assert.equal(p.finalGuardMs, 0);
  assert.equal(p.responseAssemblyMs, 0);
});
