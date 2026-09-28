'use strict';

// GV-FLIGHT-703C — staging-only shared physical Duffel request budget.
//
// Purpose:
//   * one generated-tour HTTP request gets one shared Duffel budget;
//   * every 684A invocation created during that request is clamped to the
//     remaining shared budget;
//   * physical request accounting follows the existing requestState683H
//     `requests` counter, so deduped logical lookups do not consume budget and
//     physical retries do consume budget;
//   * no provider, token, booking/payment/ticketing, production handler or
//     production configuration is enabled by this module.
//
// This is deliberately installed only by the isolated staging QA wrapper BEFORE
// generated-tour.js loads public-live-fare-pilot-684a.js.

const { AsyncLocalStorage } = require('node:async_hooks');

const VERSION = 'GV-FLIGHT-703C';
const REQUIRED_STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const SHARED_PHYSICAL_REQUEST_CAP = 8;

const storage = new AsyncLocalStorage();
let installed = false;
let installResult = null;
let originals = null;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeOrigin(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    if (parsed.pathname && parsed.pathname !== '/') return '';
    return parsed.origin;
  } catch (_) {
    return '';
  }
}

function enabled(env = process.env) {
  return normalizeOrigin(env.CORS_ORIGIN) === REQUIRED_STAGING_ORIGIN;
}

function createStore(meta = {}) {
  return {
    version: VERSION,
    cap: SHARED_PHYSICAL_REQUEST_CAP,
    used: 0,
    statesCreated: 0,
    clampedStates: 0,
    exhaustedStates: 0,
    requestId: clean(meta.requestId) || null,
    startedAt: Date.now()
  };
}

function currentStore() {
  return storage.getStore() || null;
}

function snapshot(store = currentStore()) {
  if (!store) {
    return {
      version: VERSION,
      active: false,
      cap: SHARED_PHYSICAL_REQUEST_CAP,
      used: 0,
      remaining: SHARED_PHYSICAL_REQUEST_CAP,
      exhausted: false,
      statesCreated: 0,
      clampedStates: 0,
      exhaustedStates: 0,
      requestId: null
    };
  }
  const cap = Number(store.cap || SHARED_PHYSICAL_REQUEST_CAP);
  const used = Math.max(0, Number(store.used || 0));
  return {
    version: VERSION,
    active: true,
    cap,
    used,
    remaining: Math.max(0, cap - used),
    exhausted: used >= cap,
    statesCreated: Number(store.statesCreated || 0),
    clampedStates: Number(store.clampedStates || 0),
    exhaustedStates: Number(store.exhaustedStates || 0),
    requestId: store.requestId || null
  };
}

function runWithBudget(fn, meta = {}, env = process.env) {
  if (typeof fn !== 'function') throw new TypeError('703c runWithBudget requires a function');
  if (!enabled(env)) return fn();
  return storage.run(createStore(meta), fn);
}

function proxiedRequestState(originalRequestState, env, budgetPlan) {
  const state = originalRequestState(env, budgetPlan);
  const store = currentStore();
  if (!store) return state;

  const originalCap = Math.max(0, Number(state.cap || 0));
  const remaining = Math.max(0, Number(store.cap || SHARED_PHYSICAL_REQUEST_CAP) - Number(store.used || 0));
  const sharedCap = Math.min(originalCap, remaining);

  store.statesCreated += 1;
  if (sharedCap < originalCap) store.clampedStates += 1;
  if (sharedCap <= 0) store.exhaustedStates += 1;

  state.cap = sharedCap;
  state.sharedDuffelBudget703C = {
    version: VERSION,
    originalLocalCap: originalCap,
    sharedCapAtStateCreation: sharedCap,
    sharedRemainingAtStateCreation: remaining
  };

  return new Proxy(state, {
    set(target, prop, value) {
      if (prop === 'requests') {
        const before = Math.max(0, Number(target.requests || 0));
        const after = Math.max(0, Number(value || 0));
        const delta = Math.max(0, after - before);
        if (delta > 0) {
          const available = Math.max(0, Number(store.cap || SHARED_PHYSICAL_REQUEST_CAP) - Number(store.used || 0));
          if (delta > available) {
            // This should be unreachable because each state cap is clamped to the
            // shared remaining budget. Throw before the provider request launches
            // rather than silently allowing an accounting overshoot.
            throw new Error('703c-shared-duffel-budget-accounting-overrun');
          }
          store.used += delta;
        }
      }
      target[prop] = value;
      return true;
    }
  });
}

function decorate684AResult(result) {
  if (!result || typeof result !== 'object') return result;
  const shared = snapshot();
  const summary = result.summary && typeof result.summary === 'object'
    ? { ...result.summary, sharedDuffelBudget703C: shared }
    : result.summary;
  const tour = result.tour && typeof result.tour === 'object'
    ? { ...result.tour, sharedDuffelBudget703C: shared }
    : result.tour;
  return { ...result, summary, tour };
}

function install(env = process.env) {
  if (installed) return installResult;
  if (!enabled(env)) {
    installResult = { ok: true, version: VERSION, enabled: false, applied: false, cap: SHARED_PHYSICAL_REQUEST_CAP };
    installed = true;
    return installResult;
  }

  const liveModulePath = require.resolve('../../../../domain/live-fares/public-live-fare-pilot-684a');
  if (require.cache[liveModulePath]) {
    installResult = {
      ok: false,
      version: VERSION,
      enabled: true,
      applied: false,
      cap: SHARED_PHYSICAL_REQUEST_CAP,
      reason: '703c-684a-loaded-before-shared-budget-install'
    };
    installed = true;
    return installResult;
  }

  const duffelP2 = require('../duffel-p2-staging-683h');
  if (typeof duffelP2.requestState683H !== 'function') {
    installResult = {
      ok: false,
      version: VERSION,
      enabled: true,
      applied: false,
      cap: SHARED_PHYSICAL_REQUEST_CAP,
      reason: '703c-request-state-hook-unavailable'
    };
    installed = true;
    return installResult;
  }

  const originalRequestState = duffelP2.requestState683H;
  duffelP2.requestState683H = function requestState683H703C(passedEnv = process.env, budgetPlan = null) {
    return proxiedRequestState(originalRequestState, passedEnv, budgetPlan);
  };

  // Load 684A only after the request-state export is patched so its destructured
  // requestState683H binding captures the shared-budget-aware function.
  const live684A = require('../../../../domain/live-fares/public-live-fare-pilot-684a');
  if (typeof live684A.applyPublicLiveFarePilot684A !== 'function') {
    duffelP2.requestState683H = originalRequestState;
    installResult = {
      ok: false,
      version: VERSION,
      enabled: true,
      applied: false,
      cap: SHARED_PHYSICAL_REQUEST_CAP,
      reason: '703c-684a-hook-unavailable'
    };
    installed = true;
    return installResult;
  }

  const originalApply684A = live684A.applyPublicLiveFarePilot684A;
  live684A.applyPublicLiveFarePilot684A = async function applyPublicLiveFarePilot684A703C(...args) {
    const result = await originalApply684A(...args);
    return decorate684AResult(result);
  };

  originals = { duffelP2, live684A, originalRequestState, originalApply684A };
  installResult = {
    ok: true,
    version: VERSION,
    enabled: true,
    applied: true,
    cap: SHARED_PHYSICAL_REQUEST_CAP,
    physicalRequestAccounting: true,
    requestScoped: true,
    environmentVariablesAdded: 0,
    providerEnabledBy703C: false,
    credentialsChanged: false,
    productionChanged: false
  };
  installed = true;
  return installResult;
}

function status(env = process.env) {
  return {
    version: VERSION,
    enabled: enabled(env),
    installed,
    installation: installResult,
    requiredStagingOrigin: REQUIRED_STAGING_ORIGIN,
    sharedPhysicalRequestCap: SHARED_PHYSICAL_REQUEST_CAP,
    requestScoped: true,
    physicalRequestAccounting: true,
    dedupedLogicalSearchConsumesBudget: false,
    physicalRetryConsumesBudget: true,
    environmentVariablesAdded: 0,
    providerEnabledBy703C: false,
    credentialsChanged: false,
    affordableDiscovery684BExpanded: false,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false,
    productionChanged: false,
    current: snapshot()
  };
}

module.exports = {
  VERSION,
  REQUIRED_STAGING_ORIGIN,
  SHARED_PHYSICAL_REQUEST_CAP,
  enabled,
  install,
  runWithBudget,
  currentStore,
  snapshot,
  status,
  _internal: {
    normalizeOrigin,
    createStore,
    proxiedRequestState,
    decorate684AResult,
    originals: () => originals
  }
};
