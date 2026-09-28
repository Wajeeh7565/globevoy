'use strict';

// GV-PROVIDER-683M-R4 — Quota-reservation Duffel scheduling on the request-scoped production canary.
// Preserves default 683M concurrency<=2, request-scoped deduplication, latency diagnostics, R2 reset-aware
// 429 recovery, and R3 proactive quota protection. R4 sizes each independent-leg batch from observed
// provider quota: remaining>=2 may reserve a pair, remaining=1 runs serial, and remaining=0 uses the
// existing bounded reset gate or fails closed without launching another provider request.
// GV-PERF-R2 permits only 684A's explicitly flagged staging initial exact batch to use three.
// Preserves the 683J-R2 evidence non-downgrade repair. Normal production traffic remains OFF.
// A production canary can activate only for a single HTTP request after the Lambda/server
// entrypoint validates the existing admin token AND X-GV-Provider-Canary: 683K, then injects
// the private __gvProviderCanary683K marker. No new production environment variable is required.
// Preserves 683I-R1 dynamic request budgeting, 683H-R1 canonical price aliases,
// 683G-R1 FX normalization, and 683F-R1 metro-airport recovery.
// Normal P2 ranking can activate only when four independent staging gates are true:
// ENABLE_DUFFEL_P2_683H=true
// ACK_DUFFEL_P2_STAGING_ONLY_683H=true
// ENABLE_DUFFEL_P2_STAGING_ACTIVATION_683J=true
// GV_RUNTIME_ENVIRONMENT=staging
// This makes accidental activation on a production runtime fail closed.
// Builds a bounded itinerary-aware request budget so two complete live schedules can
// be compared even when same-city metro fallback is required. Preserves the 683H-R1
// canonical price alias repair and all shadow/staging safety gates.
// Staging/simulation only. The normal generated-tour flow stays unchanged unless
// BOTH ENABLE_DUFFEL_P2_683H=true and ACK_DUFFEL_P2_STAGING_ONLY_683H=true.
// This service calls only Duffel offer requests through the 683D adapter and
// Bank of Canada FX through 683G-R1. It has no order/payment/ticketing capability.

const fs = require('fs');
const path = require('path');
const duffel683D = require('./providers/flights/duffel/duffel-live-adapter-683d');
const { normalizeObservation683C } = require('./providers/flights/flight-provider-contract-683c');
const { normalizeAmount683G, enabled683G, status683G } = require('./shared/fx-normalization-683g');
const { scheduleForStart, evaluateCandidate, selectCandidate } = require('./domain/routing/whole-trip-date-optimizer-681b-p2');
const { normalizeParty } = require('./domain/pricing/traveller-pricing');

const VERSION_683H = 'GV-PROVIDER-683M-R4';
const METRO_REGISTRY_PATH_683H = path.join(__dirname, '..', 'data', 'airport-metro-groups-683h.json');
const DEFAULT_MAX_CANDIDATES_683H = 2;
const DEFAULT_REQUEST_CAP_683H = 8;
const DEFAULT_MAX_METRO_ALTERNATES_683H = 1;
const MAX_HARD_REQUEST_CAP_683H = 12;
const MAX_DYNAMIC_METRO_ALLOWANCE_683IR1 = 4;
const MAX_PROVIDER_CONCURRENCY_683M = 2;
const MAX_RATE_LIMIT_RETRIES_PER_REQUEST_683MR3 = 1;
const MAX_RATE_LIMIT_WAIT_MS_683MR3 = 15000;
const RATE_LIMIT_RESET_GUARD_MS_683MR3 = 250;
const LOW_QUOTA_SERIAL_THRESHOLD_683MR3 = 1;
const QUOTA_RESERVATION_MAX_BATCH_683MR4 = MAX_PROVIDER_CONCURRENCY_683M;
const MAX_PROACTIVE_QUOTA_WAITS_PER_REQUEST_683MR3 = 1;
const PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3 = '683m-r4-provider-quota-window-fail-closed';

let metroRegistryCache683H = null;

function envTrue(name, env = process.env) {
  return String(env?.[name] || '').trim().toLowerCase() === 'true';
}

function boundedInt(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback;
}

function config683H(env = process.env) {
  const requestCap = boundedInt(env.GV_DUFFEL_P2_REQUEST_CAP_683H, DEFAULT_REQUEST_CAP_683H, 4, MAX_HARD_REQUEST_CAP_683H);
  return {
    maxCandidates: boundedInt(env.GV_DUFFEL_P2_MAX_CANDIDATES_683H, DEFAULT_MAX_CANDIDATES_683H, 2, 3),
    // 683I-R1 treats this as the base/floor request budget. The itinerary-aware
    // planner can raise it only when the exact two-schedule search plus bounded
    // same-city metro recovery needs more room, never above the hard ceiling.
    requestCap,
    baseRequestCap: requestCap,
    hardRequestCap: MAX_HARD_REQUEST_CAP_683H,
    dynamicRequestBudget: true,
    maxDynamicMetroAllowance: MAX_DYNAMIC_METRO_ALLOWANCE_683IR1,
    maxMetroAlternatesPerLeg: boundedInt(env.GV_DUFFEL_P2_MAX_METRO_ALTERNATES_683H, DEFAULT_MAX_METRO_ALTERNATES_683H, 0, 2),
    providerConcurrency683M: MAX_PROVIDER_CONCURRENCY_683M,
    requestScopedDedupe683M: true,
    latencyDiagnostics683M: true,
    rateLimitRecovery683MR3: {
      enabled: true,
      maxRetriesPerRequest: MAX_RATE_LIMIT_RETRIES_PER_REQUEST_683MR3,
      maxWaitMs: MAX_RATE_LIMIT_WAIT_MS_683MR3,
      resetGuardMs: RATE_LIMIT_RESET_GUARD_MS_683MR3,
      resetHeaderRequired: true,
      retryOnly429: true,
      retryConsumesRequestBudget: true
    },
    proactiveQuotaScheduling683MR3: {
      enabled: true,
      lowQuotaSerialThreshold: LOW_QUOTA_SERIAL_THRESHOLD_683MR3,
      maxProactiveWaitsPerRequest: MAX_PROACTIVE_QUOTA_WAITS_PER_REQUEST_683MR3,
      maxWaitMs: MAX_RATE_LIMIT_WAIT_MS_683MR3,
      resetHeaderRequiredAtZero: true,
      quotaFailClosedReason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3
    },
    quotaReservationScheduling683MR4: {
      enabled: true,
      maxBatchSize: QUOTA_RESERVATION_MAX_BATCH_683MR4,
      remainingTwoAllowsPair: true,
      remainingOneForcesSerial: true,
      remainingZeroUsesBoundedResetGate: true,
      unknownQuotaUsesBoundedConcurrency: true
    }
  };
}

function dependencyReady683H(env = process.env) {
  const duffelStatus = duffel683D.status683D(env);
  const fxStatus = status683G(env);
  return duffelStatus.enabled === true
    && duffelStatus.shadowEnabled === true
    && duffelStatus.tokenMode === 'live'
    && fxStatus.enabled === true;
}

function runtimeEnvironment683J(env = process.env) {
  return String(env?.GV_RUNTIME_ENVIRONMENT || '').trim().toLowerCase();
}

function stagingIdentity683J(env = process.env) {
  return runtimeEnvironment683J(env) === 'staging';
}

function exactThreeStagingEnabledGvPerfR2(env = process.env) {
  return stagingIdentity683J(env)
    && envTrue('ENABLE_GV_PERF_R2_684A_EXACT_THREE_STAGING', env);
}

function activationEnabled683J(env = process.env) {
  return envTrue('ENABLE_DUFFEL_P2_STAGING_ACTIVATION_683J', env);
}

function productionCanaryAuthorized683K(context = {}, env = process.env) {
  return String(context?.__gvProviderCanary683K || '') === 'authorized-production-canary'
    && !stagingIdentity683J(env);
}

function stagingActivationReady683J(env = process.env) {
  return envTrue('ENABLE_DUFFEL_P2_683H', env)
    && envTrue('ACK_DUFFEL_P2_STAGING_ONLY_683H', env)
    && activationEnabled683J(env)
    && stagingIdentity683J(env)
    && dependencyReady683H(env);
}

function activationRefusedReason683J(env = process.env, context = {}) {
  if (productionCanaryAuthorized683K(context, env)) {
    if (!dependencyReady683H(env)) return '683k-production-canary-dependencies-not-ready';
    return null;
  }
  if (!envTrue('ENABLE_DUFFEL_P2_683H', env)) return '683j-duffel-p2-enable-flag-off';
  if (!envTrue('ACK_DUFFEL_P2_STAGING_ONLY_683H', env)) return '683j-staging-acknowledgement-missing';
  if (!activationEnabled683J(env)) return '683j-activation-flag-off';
  if (!stagingIdentity683J(env)) return '683j-runtime-not-staging';
  if (!dependencyReady683H(env)) return '683j-dependencies-not-ready';
  return null;
}

function enabled683H(env = process.env, context = {}) {
  return activationRefusedReason683J(env, context) === null;
}

function simulationAvailable683H(env = process.env) {
  return dependencyReady683H(env);
}

function status683H(env = process.env, context = {}) {
  const cfg = config683H(env);
  const canary = productionCanaryAuthorized683K(context, env);
  const staging = stagingActivationReady683J(env);
  const enabled = enabled683H(env, context);
  return {
    version: VERSION_683H,
    stagingOnly: false,
    normalFlowEnabled: enabled,
    simulationAvailable: simulationAvailable683H(env),
    explicitEnableFlag: envTrue('ENABLE_DUFFEL_P2_683H', env),
    stagingAcknowledgement: envTrue('ACK_DUFFEL_P2_STAGING_ONLY_683H', env),
    activation683J: activationEnabled683J(env),
    runtimeEnvironment: runtimeEnvironment683J(env) || 'unset',
    stagingRuntimeConfirmed: stagingIdentity683J(env),
    stagingActivationReady683J: staging,
    productionCanary683KAuthorized: canary,
    productionCanary683KSupported: dependencyReady683H(env),
    productionCanaryRequestOnly: true,
    productionCanaryHeader: 'X-GV-Provider-Canary: 683K',
    activationRefusedReason: activationRefusedReason683J(env, context),
    provider: duffel683D.DUFFEL_PROVIDER_ID_683D,
    providerEndpoint: duffel683D.ALLOWED_PATH_683D,
    fxProvider: status683G(env).provider,
    candidateCap: cfg.maxCandidates,
    requestCap: cfg.requestCap,
    baseRequestCap: cfg.baseRequestCap,
    hardRequestCap: cfg.hardRequestCap,
    requestBudgetMode: 'dynamic-itinerary-bounded',
    maxDynamicMetroAllowance: cfg.maxDynamicMetroAllowance,
    maxMetroAlternatesPerLeg: cfg.maxMetroAlternatesPerLeg,
    exactDateEveryFlightLegRequired: true,
    exactAirportFirst: true,
    sameCityMetroFallbackOnly: true,
    singleAdultOnly: true,
    productionApproved: false,
    rankingEnabled: enabled,
    rankingScope: canary ? 'P2-production-canary-request-only-683k'
      : (staging ? 'P2-isolated-staging-only-683j' : 'shadow-simulation-only'),
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false,
    secretValuesReturned: false,
    latencyOptimization683M: {
      enabled: enabled,
      version: VERSION_683H,
      boundedConcurrency: MAX_PROVIDER_CONCURRENCY_683M,
      requestScopedDedupe: true,
      ordinaryProductionStillOff: !canary && !staging,
      productionApproved: false,
      rateLimitRecovery683MR3: {
        enabled: true,
        maxRetriesPerRequest: MAX_RATE_LIMIT_RETRIES_PER_REQUEST_683MR3,
        maxWaitMs: MAX_RATE_LIMIT_WAIT_MS_683MR3,
        resetHeaderRequired: true,
        retryConsumesRequestBudget: true
      },
      proactiveQuotaScheduling683MR3: {
        enabled: true,
        lowQuotaSerialThreshold: LOW_QUOTA_SERIAL_THRESHOLD_683MR3,
        maxProactiveWaitsPerRequest: MAX_PROACTIVE_QUOTA_WAITS_PER_REQUEST_683MR3,
        maxWaitMs: MAX_RATE_LIMIT_WAIT_MS_683MR3,
        resetHeaderRequiredAtZero: true,
        quotaFailClosedReason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3
      },
      quotaReservationScheduling683MR4: {
        enabled: true,
        maxBatchSize: QUOTA_RESERVATION_MAX_BATCH_683MR4,
        remainingTwoAllowsPair: true,
        remainingOneForcesSerial: true,
        remainingZeroUsesBoundedResetGate: true,
        unknownQuotaUsesBoundedConcurrency: true
      }
    }
  };
}

function safeIsoDate(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function safeIata(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function stopNights(stop = {}) {
  const value = Number(stop.nights || stop.minimumSuggestedNights || 0);
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 2;
}

function legCode(endpoint = {}) {
  return safeIata(endpoint.airportCode || endpoint.code || endpoint.iata || endpoint.iataCode);
}

function isFlightLeg683H(leg = {}) {
  const text = `${String(leg.mode || '')} ${String(leg.transportType || '')}`.toLowerCase();
  if (text.includes('flight')) return true;
  return (Array.isArray(leg.segments) ? leg.segments : []).some(segment => `${String(segment?.mode || '')} ${String(segment?.transportType || '')}`.toLowerCase().includes('flight'));
}

function isGroundLeg683H(leg = {}) {
  if (isFlightLeg683H(leg)) return false;
  const text = `${String(leg.mode || '')} ${String(leg.transportType || '')}`.trim();
  return Boolean(text);
}

function loadMetroRegistry683H() {
  if (metroRegistryCache683H) return metroRegistryCache683H;
  const raw = JSON.parse(fs.readFileSync(METRO_REGISTRY_PATH_683H, 'utf8'));
  const groups = raw && raw.groups && typeof raw.groups === 'object' ? raw.groups : {};
  const airportIndex = new Map();
  for (const [cityCode, rows] of Object.entries(groups)) {
    for (const row of (Array.isArray(rows) ? rows : [])) {
      const code = safeIata(row?.code);
      if (!code) continue;
      airportIndex.set(code, { ...row, code, cityCode });
    }
  }
  metroRegistryCache683H = {
    version: raw.version || null,
    source: raw.source || null,
    groupCount: Number(raw.groupCount || Object.keys(groups).length),
    groups,
    airportIndex
  };
  return metroRegistryCache683H;
}

function distanceKm683H(a, b) {
  const lat1 = Number(a?.lat); const lon1 = Number(a?.lon);
  const lat2 = Number(b?.lat); const lon2 = Number(b?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const R = 6371;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Number((2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))).toFixed(2));
}

function metroAlternates683H(code, registry = loadMetroRegistry683H()) {
  const c = safeIata(code);
  const exact = registry.airportIndex.get(c);
  if (!exact) return [];
  return (Array.isArray(registry.groups[exact.cityCode]) ? registry.groups[exact.cityCode] : [])
    .filter(row => safeIata(row.code) && safeIata(row.code) !== c)
    .map(row => ({ ...row, code: safeIata(row.code), cityCode: exact.cityCode, shiftKm: distanceKm683H(exact, row) }))
    .sort((a, b) => Number(a.shiftKm ?? Infinity) - Number(b.shiftKm ?? Infinity) || a.code.localeCompare(b.code));
}

function buildMetroFallbackCandidates683H({ origin, destination, departureDate } = {}, registry = loadMetroRegistry683H(), maxCandidates = 1) {
  const o = safeIata(origin); const d = safeIata(destination); const date = safeIsoDate(departureDate);
  if (!o || !d || !date || maxCandidates <= 0) return [];
  const originExact = registry.airportIndex.get(o);
  const destinationExact = registry.airportIndex.get(d);
  const originAlts = metroAlternates683H(o, registry);
  const destinationAlts = metroAlternates683H(d, registry);
  const out = [];
  for (const alt of destinationAlts) {
    out.push({ origin: o, destination: alt.code, departureDate: date, airportMode: 'METRO_DESTINATION_ALTERNATE', changedAirports: 1, originMetroCode: originExact?.cityCode || null, destinationMetroCode: alt.cityCode, originAirportShiftKm: 0, destinationAirportShiftKm: alt.shiftKm, airportShiftKmTotal: alt.shiftKm });
  }
  for (const alt of originAlts) {
    out.push({ origin: alt.code, destination: d, departureDate: date, airportMode: 'METRO_ORIGIN_ALTERNATE', changedAirports: 1, originMetroCode: alt.cityCode, destinationMetroCode: destinationExact?.cityCode || null, originAirportShiftKm: alt.shiftKm, destinationAirportShiftKm: 0, airportShiftKmTotal: alt.shiftKm });
  }
  for (const oa of originAlts) {
    for (const da of destinationAlts) {
      out.push({ origin: oa.code, destination: da.code, departureDate: date, airportMode: 'METRO_BOTH_ALTERNATE', changedAirports: 2, originMetroCode: oa.cityCode, destinationMetroCode: da.cityCode, originAirportShiftKm: oa.shiftKm, destinationAirportShiftKm: da.shiftKm, airportShiftKmTotal: Number(((oa.shiftKm || 0) + (da.shiftKm || 0)).toFixed(2)) });
    }
  }
  return out.sort((a, b) => Number(a.changedAirports) - Number(b.changedAirports) || Number(a.airportShiftKmTotal ?? Infinity) - Number(b.airportShiftKmTotal ?? Infinity) || `${a.origin}-${a.destination}`.localeCompare(`${b.origin}-${b.destination}`)).slice(0, Math.max(0, maxCandidates));
}

function fallbackEligible683H(result = {}) {
  if (result?.supported === true) return false;
  const reason = String(result?.reason || '').toLowerCase();
  return reason === 'no-valid-exact-live-offers';
}

function chooseCheapestObservation683H(result = {}) {
  const rows = Array.isArray(result?.observations) ? result.observations : [];
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => Number(a.totalPrice ?? a.price) - Number(b.totalPrice ?? b.price)
    || Number(a.stops ?? a.transfers ?? 0) - Number(b.stops ?? b.transfers ?? 0)
    || Number(a.durationMinutes || Infinity) - Number(b.durationMinutes || Infinity))[0] || null;
}

function addDaysIso683H(value, days) {
  const s = safeIsoDate(value);
  if (!s) return null;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function seedCandidateStarts683H(candidateStarts = [], minimumDate, maximumShiftDays = 14, maxCandidates = DEFAULT_MAX_CANDIDATES_683H) {
  const out = [...new Set((Array.isArray(candidateStarts) ? candidateStarts : []).map(safeIsoDate).filter(Boolean))];
  const min = safeIsoDate(minimumDate);
  const maxShift = Math.max(0, Math.min(30, Number.isFinite(Number(maximumShiftDays)) ? Math.round(Number(maximumShiftDays)) : 14));
  if (out.length < 2 && min && !out.includes(min)) out.push(min);
  if (out.length < 2 && min && maxShift > 0) {
    const offset = Math.min(7, maxShift);
    const second = addDaysIso683H(min, offset);
    if (second && !out.includes(second)) out.push(second);
  }
  if (out.length < 2 && min && maxShift > 0) {
    const edge = addDaysIso683H(min, maxShift);
    if (edge && !out.includes(edge)) out.push(edge);
  }
  return out.slice(0, Math.max(2, maxCandidates));
}

function selectCandidateStarts683H(candidateStarts = [], firstLegResult = {}, maxCandidates = DEFAULT_MAX_CANDIDATES_683H) {
  const unique = [...new Set((Array.isArray(candidateStarts) ? candidateStarts : []).map(safeIsoDate).filter(Boolean))];
  const byDate = new Map((Array.isArray(firstLegResult?.observations) ? firstLegResult.observations : [])
    .filter(row => safeIsoDate(row?.departureDate) && Number(row?.price) > 0)
    .map(row => [safeIsoDate(row.departureDate), Number(row.price)]));
  const ranked = unique.map(date => ({ date, price: byDate.has(date) ? byDate.get(date) : Infinity }))
    .sort((a, b) => Number(a.price) - Number(b.price) || a.date.localeCompare(b.date));
  if (!ranked.length) return [];
  const selected = [];
  const earliest = unique.slice().sort()[0];
  if (earliest) selected.push(earliest);
  for (const row of ranked) {
    if (!selected.includes(row.date)) selected.push(row.date);
    if (selected.length >= maxCandidates) break;
  }
  return selected.slice(0, Math.max(2, maxCandidates));
}

function passengerEligibility683H(query = {}) {
  const party = normalizeParty(query);
  const eligible = party.adults === 1 && party.children === 0 && party.infants === 0;
  return { eligible, party, reason: eligible ? null : '683h-single-adult-only-initial-staging-gate' };
}

function metroSensitiveFlightLegCount683IR1(legs = [], registry = loadMetroRegistry683H()) {
  return (Array.isArray(legs) ? legs : []).reduce((count, leg) => {
    if (!isFlightLeg683H(leg) || isGroundLeg683H(leg)) return count;
    const origin = legCode(leg?.from);
    const destination = legCode(leg?.to);
    const sensitive = (origin && metroAlternates683H(origin, registry).length > 0)
      || (destination && metroAlternates683H(destination, registry).length > 0);
    return count + (sensitive ? 1 : 0);
  }, 0);
}

function planRequestBudget683IR1({ legs = [], candidateCount = DEFAULT_MAX_CANDIDATES_683H } = {}, env = process.env) {
  const cfg = config683H(env);
  const candidates = Math.max(2, Math.min(cfg.maxCandidates, Number.isFinite(Number(candidateCount)) ? Math.round(Number(candidateCount)) : cfg.maxCandidates));
  const flightLegCount = (Array.isArray(legs) ? legs : []).filter(leg => isFlightLeg683H(leg) && !isGroundLeg683H(leg)).length;
  const metroSensitiveFlightLegCount = metroSensitiveFlightLegCount683IR1(legs);
  const exactRequestBudget = flightLegCount * candidates;
  const rawMetroFallbackBudget = metroSensitiveFlightLegCount * candidates * cfg.maxMetroAlternatesPerLeg;
  const metroFallbackBudget = Math.min(cfg.maxDynamicMetroAllowance, rawMetroFallbackBudget);
  const requiredRequestBudget = exactRequestBudget + metroFallbackBudget;
  const plannedRequestCap = Math.min(cfg.hardRequestCap, Math.max(cfg.baseRequestCap, requiredRequestBudget));
  return {
    mode: 'dynamic-itinerary-bounded',
    candidateCount: candidates,
    flightLegCount,
    metroSensitiveFlightLegCount,
    exactRequestBudget,
    rawMetroFallbackBudget,
    metroFallbackBudget,
    requiredRequestBudget,
    baseRequestCap: cfg.baseRequestCap,
    plannedRequestCap,
    hardRequestCap: cfg.hardRequestCap,
    boundedByHardCap: requiredRequestBudget > cfg.hardRequestCap
  };
}

function requestState683H(env = process.env, budgetPlan = null) {
  const cfg = config683H(env);
  const plan = budgetPlan && typeof budgetPlan === 'object' ? budgetPlan : null;
  const cap = plan ? boundedInt(plan.plannedRequestCap, cfg.requestCap, 4, cfg.hardRequestCap) : cfg.requestCap;
  return {
    requests: 0,
    cap,
    baseCap: cfg.baseRequestCap,
    hardCap: cfg.hardRequestCap,
    exactRequests: 0,
    metroRequests: 0,
    fxFailures: 0,
    providerAbortEvents: 0,
    abortReason: null,
    requestBudgetMode: plan?.mode || 'fixed-base',
    exactRequestBudget: plan?.exactRequestBudget ?? null,
    metroFallbackBudget: plan?.metroFallbackBudget ?? null,
    metroSensitiveFlightLegCount: plan?.metroSensitiveFlightLegCount ?? null,
    requiredRequestBudget: plan?.requiredRequestBudget ?? null,
    boundedByHardCap: plan?.boundedByHardCap === true,
    // 683M latency optimization diagnostics. These are request-scoped only.
    providerConcurrencyLimit683M: MAX_PROVIDER_CONCURRENCY_683M,
    providerConcurrencyCurrent683M: 0,
    providerConcurrencyPeak683M: 0,
    deduplicatedRequests683M: 0,
    providerLatencyTotalMs683M: 0,
    providerLatencyMaxMs683M: 0,
    providerLatenciesMs683M: [],
    exactProviderLatencyMs683M: 0,
    metroProviderLatencyMs683M: 0,
    fxLatencyMs683M: 0,
    liveBuildMs683M: 0,
    // 683M-R4 provider-reset-aware 429 recovery diagnostics. A retry is permitted
    // at most once for the whole generated-tour request and still consumes the
    // normal physical request budget/hard cap.
    rateLimitEvents683MR3: 0,
    rateLimitRetryCount683MR3: 0,
    rateLimitRecoverySucceeded683MR3: 0,
    rateLimitRecoveryFailed683MR3: 0,
    rateLimitWaitMs683MR3: 0,
    rateLimitMissingReset683MR3: 0,
    rateLimitResetTooFar683MR3: 0,
    rateLimitRetryBlockedByCap683MR3: 0,
    rateLimitLastLimit683MR3: null,
    rateLimitLastRemaining683MR3: null,
    rateLimitLastReset683MR3: null,
    rateLimitLastRequestId683MR3: null,
    // 683M-R4 proactive quota window state. remaining is conservative within the same
    // reset window: concurrent responses can only move it downward.
    quotaLimit683MR3: null,
    quotaRemaining683MR3: null,
    quotaReset683MR3: null,
    quotaResetAtMs683MR3: null,
    quotaMetadataObservations683MR3: 0,
    quotaSerialMode683MR3: false,
    quotaSerialModeSwitches683MR3: 0,
    proactiveQuotaWaitCount683MR3: 0,
    proactiveQuotaWaitMs683MR3: 0,
    proactiveQuotaFailClosed683MR3: false,
    proactiveQuotaFailClosedCount683MR3: 0,
    proactiveQuotaFailClosedReason683MR3: null,
    proactiveQuotaResetTooFar683MR3: 0,
    proactiveQuotaMissingReset683MR3: 0,
    // 683M-R4 quota-reservation scheduler diagnostics.
    quotaReservationBatches683MR4: 0,
    quotaReservationSlots683MR4: 0,
    quotaReservationLimitedBatches683MR4: 0,
    quotaReservationExactTwoBatches683MR4: 0,
    quotaReservationSerialBatches683MR4: 0,
    quotaReservationLastBatchSize683MR4: 0,
    _proactiveQuotaWaitLeaseUsed683MR3: false,
    _rateLimitRetryLeaseUsed683MR3: false,
    _rateLimitGatePromise683MR3: null,
    _requestCache683M: new Map()
  };
}

function percentile683M(values = [], q = 0.5) {
  const rows = (Array.isArray(values) ? values : []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return 0;
  const idx = Math.max(0, Math.min(rows.length - 1, Math.ceil(q * rows.length) - 1));
  return Math.round(rows[idx]);
}

function latencyDiagnostics683M(state = {}) {
  const latencies = Array.isArray(state.providerLatenciesMs683M) ? state.providerLatenciesMs683M : [];
  return {
    version: VERSION_683H,
    boundedConcurrency: Number(state.providerConcurrencyLimit683M || MAX_PROVIDER_CONCURRENCY_683M),
    concurrencyPeak: Number(state.providerConcurrencyPeak683M || 0),
    ...(state.exactConcurrencyExperimentR2 ? { exactConcurrencyExperimentR2: { ...state.exactConcurrencyExperimentR2 } } : {}),
    physicalProviderRequests: Number(state.requests || 0),
    logicalExactSearches: Number(state.exactRequests || 0),
    logicalMetroSearches: Number(state.metroRequests || 0),
    deduplicatedRequests: Number(state.deduplicatedRequests683M || 0),
    providerLatencyTotalMs: Math.round(Number(state.providerLatencyTotalMs683M || 0)),
    providerLatencyP50Ms: percentile683M(latencies, 0.5),
    providerLatencyP95Ms: percentile683M(latencies, 0.95),
    providerLatencyMaxMs: Math.round(Number(state.providerLatencyMaxMs683M || 0)),
    exactProviderLatencyMs: Math.round(Number(state.exactProviderLatencyMs683M || 0)),
    metroProviderLatencyMs: Math.round(Number(state.metroProviderLatencyMs683M || 0)),
    fxLatencyMs: Math.round(Number(state.fxLatencyMs683M || 0)),
    liveBuildMs: Math.round(Number(state.liveBuildMs683M || 0)),
    rateLimitRecovery683MR3: {
      enabled: true,
      rateLimitEvents: Number(state.rateLimitEvents683MR3 || 0),
      retryCount: Number(state.rateLimitRetryCount683MR3 || 0),
      recoveredCount: Number(state.rateLimitRecoverySucceeded683MR3 || 0),
      failedCount: Number(state.rateLimitRecoveryFailed683MR3 || 0),
      waitMs: Math.round(Number(state.rateLimitWaitMs683MR3 || 0)),
      missingResetCount: Number(state.rateLimitMissingReset683MR3 || 0),
      resetTooFarCount: Number(state.rateLimitResetTooFar683MR3 || 0),
      retryBlockedByCapCount: Number(state.rateLimitRetryBlockedByCap683MR3 || 0),
      lastLimit: state.rateLimitLastLimit683MR3 ?? null,
      lastRemaining: state.rateLimitLastRemaining683MR3 ?? null,
      lastReset: state.rateLimitLastReset683MR3 || null,
      lastRequestId: state.rateLimitLastRequestId683MR3 || null,
      maxRetriesPerRequest: MAX_RATE_LIMIT_RETRIES_PER_REQUEST_683MR3,
      maxWaitMs: MAX_RATE_LIMIT_WAIT_MS_683MR3,
      resetHeaderRequired: true,
      retryConsumesRequestBudget: true
    },
    proactiveQuotaScheduling683MR3: {
      enabled: true,
      lowQuotaSerialThreshold: LOW_QUOTA_SERIAL_THRESHOLD_683MR3,
      quotaLimit: state.quotaLimit683MR3 ?? null,
      quotaRemaining: state.quotaRemaining683MR3 ?? null,
      quotaReset: state.quotaReset683MR3 || null,
      quotaMetadataObservations: Number(state.quotaMetadataObservations683MR3 || 0),
      serialMode: state.quotaSerialMode683MR3 === true,
      serialModeSwitches: Number(state.quotaSerialModeSwitches683MR3 || 0),
      proactiveWaitCount: Number(state.proactiveQuotaWaitCount683MR3 || 0),
      proactiveWaitMs: Math.round(Number(state.proactiveQuotaWaitMs683MR3 || 0)),
      quotaFailClosed: state.proactiveQuotaFailClosed683MR3 === true,
      quotaFailClosedCount: Number(state.proactiveQuotaFailClosedCount683MR3 || 0),
      quotaFailClosedReason: state.proactiveQuotaFailClosedReason683MR3 || null,
      resetTooFarCount: Number(state.proactiveQuotaResetTooFar683MR3 || 0),
      missingResetCount: Number(state.proactiveQuotaMissingReset683MR3 || 0),
      maxProactiveWaitsPerRequest: MAX_PROACTIVE_QUOTA_WAITS_PER_REQUEST_683MR3,
      maxWaitMs: MAX_RATE_LIMIT_WAIT_MS_683MR3
    },
    quotaReservationScheduling683MR4: {
      enabled: true,
      maxBatchSize: state.exactConcurrencyExperimentR2?.active === true ? 3 : QUOTA_RESERVATION_MAX_BATCH_683MR4,
      batches: Number(state.quotaReservationBatches683MR4 || 0),
      reservedSlots: Number(state.quotaReservationSlots683MR4 || 0),
      quotaLimitedBatches: Number(state.quotaReservationLimitedBatches683MR4 || 0),
      exactRemainingTwoPairBatches: Number(state.quotaReservationExactTwoBatches683MR4 || 0),
      serialBatches: Number(state.quotaReservationSerialBatches683MR4 || 0),
      lastBatchSize: Number(state.quotaReservationLastBatchSize683MR4 || 0),
      rule: state.exactConcurrencyExperimentR2?.active === true
        ? '684A staging initial exact batch<=3 (unknown quota allowed); later/metro batches<=2; quota/reset and request-cap gates retained'
        : 'batch=min(2,remaining-quota,outstanding); remaining=0 uses bounded reset gate before launch'
    }
  };
}

function providerRequestKey683M(args = {}) {
  return [
    safeIata(args.origin) || '',
    safeIata(args.destination) || '',
    safeIsoDate(args.departureDate) || '',
    String(args.currency || 'USD').toUpperCase(),
    Math.max(1, Math.round(Number(args.passengers || 1)))
  ].join('|');
}

async function mapLimit683M(items = [], limit = MAX_PROVIDER_CONCURRENCY_683M, worker, shouldStop = () => false) {
  const rows = Array.isArray(items) ? items : [];
  const results = new Array(rows.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(MAX_PROVIDER_CONCURRENCY_683M, Number(limit) || MAX_PROVIDER_CONCURRENCY_683M, rows.length || 1));
  async function runWorker() {
    while (true) {
      if (shouldStop()) return;
      const index = cursor;
      cursor += 1;
      if (index >= rows.length) return;
      results[index] = await worker(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}

function nullableFiniteNumber683MR3(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function quotaReservationBatchSize683MR4(state = {}, outstanding = MAX_PROVIDER_CONCURRENCY_683M, initialCeiling = QUOTA_RESERVATION_MAX_BATCH_683MR4) {
  // Only the explicitly guarded initial 684A scheduler call supplies three.
  const ceiling = initialCeiling === 3 ? 3 : QUOTA_RESERVATION_MAX_BATCH_683MR4;
  if (state.proactiveQuotaFailClosed683MR3 === true) return 0;
  const pending = Math.max(0, Math.floor(Number(outstanding) || 0));
  if (pending <= 0) return 0;
  const remaining = nullableFiniteNumber683MR3(state.quotaRemaining683MR3);
  if (remaining == null) {
    // After a proactive reset wait, keep the first new-window observation serial;
    // otherwise unknown quota uses two, or the explicit staging R2 initial ceiling.
    return Math.min(state.quotaSerialMode683MR3 === true ? 1 : ceiling, pending);
  }
  if (remaining <= 0) return 0;
  return Math.max(1, Math.min(ceiling, pending, Math.floor(remaining)));
}

function quotaAwareConcurrency683MR3(state = {}) {
  return quotaReservationBatchSize683MR4(state, MAX_PROVIDER_CONCURRENCY_683M);
}

async function mapQuotaReservation683MR4(items = [], state = {}, worker, shouldStop = () => false, options = {}, schedulingPolicy = null) {
  const rows = Array.isArray(items) ? items : [];
  const results = new Array(rows.length);
  let cursor = 0;
  // Separate sixth argument: generic provider options cannot propagate this override
  // into metro fallback or other callers. Never persist the scheduling policy on state.
  const freshInitialState = () => state.requests === 0
    && state.quotaReservationBatches683MR4 === 0
    && state.providerConcurrencyCurrent683M === 0
    && !state.abortReason && !state.proactiveQuotaFailClosed683MR3
    && !state.quotaSerialMode683MR3 && !state._rateLimitGatePromise683MR3
    && !state._rateLimitRetryLeaseUsed683MR3 && !state._proactiveQuotaWaitLeaseUsed683MR3
    && state.rateLimitEvents683MR3 === 0 && state.rateLimitRetryCount683MR3 === 0
    && state.proactiveQuotaWaitCount683MR3 === 0;
  const initialThree = schedulingPolicy?.scope === '684a-exact-initial'
    && schedulingPolicy?.initialMaxBatch === 3 && rows.length === 3
    && exactThreeStagingEnabledGvPerfR2(options.env || process.env)
    && freshInitialState();
  const experiment = state.exactConcurrencyExperimentR2;
  // 684A attaches diagnostics before its exact call, even when the flag is off.
  // Metro must not overwrite that first phase's diagnostics.
  const recordInitial = experiment && experiment.initialQuotaKnown === null;
  if (recordInitial) {
    const remaining = nullableFiniteNumber683MR3(state.quotaRemaining683MR3);
    experiment.active = initialThree;
    experiment.initialQuotaKnown = remaining != null;
    experiment.initialQuotaRemaining = remaining;
    experiment.configuredInitialCeiling = initialThree ? 3 : QUOTA_RESERVATION_MAX_BATCH_683MR4;
  }
  if (initialThree) state.providerConcurrencyLimit683M = 3; // diagnostic only
  while (cursor < rows.length) {
    if (shouldStop() || state.proactiveQuotaFailClosed683MR3 === true) break;
    await waitForRateLimitGate683MR3(state);
    if (shouldStop() || state.proactiveQuotaFailClosed683MR3 === true) break;

    // If the locally reserved quota is exhausted, resolve the provider reset gate
    // before choosing a batch. No Duffel request is launched while remaining=0.
    const quotaGate = await ensureQuotaBeforeLaunch683MR3(state, options);
    if (!quotaGate.allowed || shouldStop() || state.proactiveQuotaFailClosed683MR3 === true) break;

    const outstanding = rows.length - cursor;
    const remainingBeforeBatch = nullableFiniteNumber683MR3(state.quotaRemaining683MR3);
    // Recheck after the reset gate: waiting consumes the initial-three exception.
    const initialException = initialThree && cursor === 0 && freshInitialState();
    const ceiling = initialException ? 3 : QUOTA_RESERVATION_MAX_BATCH_683MR4;
    const quotaTake = quotaReservationBatchSize683MR4(state, outstanding, ceiling);
    const take = initialException ? Math.min(quotaTake, Math.max(0, state.cap - state.requests)) : quotaTake;
    if (take <= 0) break;
    if (recordInitial && cursor === 0) experiment.initialBatchSize = take;

    state.quotaReservationBatches683MR4 += 1;
    state.quotaReservationSlots683MR4 += take;
    state.quotaReservationLastBatchSize683MR4 = take;
    if (take === 1) state.quotaReservationSerialBatches683MR4 += 1;
    if (remainingBeforeBatch != null && quotaTake < Math.min(ceiling, outstanding)) state.quotaReservationLimitedBatches683MR4 += 1;
    if (remainingBeforeBatch === 2 && outstanding >= 2 && take === 2) state.quotaReservationExactTwoBatches683MR4 += 1;

    const batch = [];
    for (let i = 0; i < take; i += 1) {
      const index = cursor + i;
      batch.push(Promise.resolve(worker(rows[index], index)).then(value => { results[index] = value; }));
    }
    cursor += take;
    await Promise.all(batch);
  }
  return results;
}

// Compatibility wrapper retained for older unit helpers; all live R4 schedule work
// routes through the quota-reservation scheduler above.
async function mapQuotaAware683MR3(items = [], state = {}, worker, shouldStop = () => false, options = {}) {
  return mapQuotaReservation683MR4(items, state, worker, shouldStop, options);
}

function providerAbortReason683IR1(result = {}) {
  const status = Number(result?.statusCode || 0);
  const reason = String(result?.reason || '').trim().toLowerCase();
  if (status === 429 || reason.includes('too many requests') || reason.includes('rate limit') || reason.includes('rate-limit')) return 'rate-limit';
  if ([401, 403].includes(status) || reason.includes('unauthor') || reason.includes('forbidden') || reason.includes('authentication') || reason.includes('token-required') || reason.includes('token required')) return 'authorization';
  return null;
}

async function normalizeLiveObservation683H(observation, displayCurrency, options = {}) {
  const providerAmount = Number(observation?.totalPrice ?? observation?.price);
  const providerCurrency = String(observation?.currency || '').toUpperCase();
  const providerContext = {
    origin: observation?.origin,
    destination: observation?.destination,
    departureDate: observation?.departureDate,
    // Canonical evidence is validated in the currency actually returned by Duffel.
    // Display currency is handled separately by 683G; it must not invalidate an
    // otherwise exact live provider observation merely because FX is required.
    currency: providerCurrency,
    passengers: observation?.passengers || 1
  };
  const canonical = normalizeObservation683C(observation, providerContext, duffel683D.descriptor683D());
  if (!canonical || canonical?.priceEvidence?.sourceType !== 'LIVE' || canonical?.priceEvidence?.isExactDate !== true || canonical?.priceEvidence?.routeMatch !== true || canonical?.priceEvidence?.dateMatch !== true) {
    return { supported: false, reason: '683j-r1-canonical-live-evidence-unavailable', canonical };
  }

  const fxFn = options.normalizeFx || normalizeAmount683G;
  const common = { env: options.env || process.env, fetch: options.fetchFx || options.fetch, nowMs: options.nowMs };
  const usd = await fxFn({ providerAmount, providerCurrency, displayCurrency: 'USD' }, { ...common, allowWithoutFlags: options.allowWithoutFxFlags === true });
  if (!usd?.supported) return { supported: false, reason: `683h-ranking-fx-unavailable:${usd?.reason || 'unknown'}`, fx: usd };
  const display = String(displayCurrency || 'USD').toUpperCase() === 'USD'
    ? usd
    : await fxFn({ providerAmount, providerCurrency, displayCurrency }, { ...common, allowWithoutFlags: options.allowWithoutFxFlags === true });
  if (!display?.supported) return { supported: false, reason: `683h-display-fx-unavailable:${display?.reason || 'unknown'}`, fx: display };
  const requestedDisplayCurrency = String(displayCurrency || observation?.requestedCurrency || providerCurrency || 'USD').toUpperCase();
  const productionCanary683K = productionCanaryAuthorized683K(options.canaryContext || {}, options.env || process.env);
  return {
    supported: true,
    observation: {
      ...canonical,
      // Keep Duffel's original offer amount/currency as canonical evidence, then
      // attach separate ranking/display aliases. This prevents provenance from
      // disappearing when the observation reaches the final generated-tour leg.
      totalPrice: providerAmount,
      price: providerAmount,
      providerAmount,
      providerCurrency,
      requestedCurrency: String(observation?.requestedCurrency || requestedDisplayCurrency).toUpperCase(),
      currencyMismatch: providerCurrency !== requestedDisplayCurrency,
      rankingPriceUsd: Number(usd.displayAmount),
      displayPrice: Number(display.displayAmount),
      displayCurrency: String(display.displayCurrency || requestedDisplayCurrency).toUpperCase(),
      fxNormalization683G: display,
      // Preserve the R1 marker for compatibility, and add an R2 marker that
      // explicitly authorizes non-downgrade handling at the final-tour boundary.
      canonicalLiveEvidence683JR1: {
        version: 'GV-PROVIDER-683J-R1',
        source: canonical.source,
        sourceType: canonical.sourceType,
        evidenceId: canonical.evidenceId,
        exactDate: canonical.priceEvidence?.isExactDate === true,
        routeMatch: canonical.priceEvidence?.routeMatch === true,
        dateMatch: canonical.priceEvidence?.dateMatch === true,
        providerCurrency
      },
      canonicalLiveEvidence683JR2: {
        version: 'GV-PROVIDER-683J-R2',
        source: canonical.source,
        sourceType: canonical.sourceType,
        evidenceId: canonical.evidenceId,
        exactDate: canonical.priceEvidence?.isExactDate === true,
        routeMatch: canonical.priceEvidence?.routeMatch === true,
        dateMatch: canonical.priceEvidence?.dateMatch === true,
        providerCurrency,
        providerEvidenceClass: canonical.providerEvidenceClass || 'LIVE_PROVIDER',
        providerRankingGrade: canonical.providerRankingGrade || 'DECISION_GRADE',
        nonDowngradeEligible: true,
        preservationPolicy: 'live-decision-grade-non-downgrade'
      },
      rankingFx683H: {
        version: VERSION_683H,
        stagingOnly: !productionCanary683K,
        productionCanary683K,
        source: usd.provider,
        rateDate: usd.rateDate,
        crossRate: usd.crossRate,
        providerAmount,
        providerCurrency,
        rankingAmountUsd: Number(usd.displayAmount),
        originalProviderEvidencePreserved: true
      }
    },
    fxUsd: usd,
    fxDisplay: display
  };
}

function liveSelectionFailClosedReason683JR1({ applied = false, duffelAppliedToRanking = false, selection = {} } = {}) {
  if (!duffelAppliedToRanking || applied) return null;
  if (Number(selection?.completeCandidateCount || 0) < 2) return '683j-r1-fewer-than-two-complete-live-schedules';
  if (Number(selection?.qualityEligibleCandidateCount || 0) === 0) return '683j-r1-no-live-quality-eligible-schedule';
  if (Number(selection?.budgetFitCandidateCount || 0) === 0) return '683j-r1-no-live-budget-fit-schedule';
  return '683j-r1-live-selection-not-applied';
}

function nowMs683MR3(options = {}) {
  if (typeof options.now683MR3 === 'function') {
    const value = Number(options.now683MR3());
    if (Number.isFinite(value)) return value;
  }
  const direct = Number(options.nowMs683MR3);
  return Number.isFinite(direct) ? direct : Date.now();
}

function sleep683MR3(ms, options = {}) {
  const waitMs = Math.max(0, Math.round(Number(ms) || 0));
  if (typeof options.sleep683MR3 === 'function') return options.sleep683MR3(waitMs);
  return new Promise(resolve => setTimeout(resolve, waitMs));
}

function captureRateLimitMetadata683MR3(result = {}, state = {}) {
  const meta = result?.rateLimit && typeof result.rateLimit === 'object' ? result.rateLimit : {};
  const wasSerial = state.quotaSerialMode683MR3 === true;
  const metaLimit = nullableFiniteNumber683MR3(meta.limit);
  const metaRemaining = nullableFiniteNumber683MR3(meta.remaining);
  if (metaLimit != null) state.rateLimitLastLimit683MR3 = metaLimit;
  if (metaRemaining != null) state.rateLimitLastRemaining683MR3 = metaRemaining;
  if (meta.reset) state.rateLimitLastReset683MR3 = String(meta.reset);
  if (meta.requestId) state.rateLimitLastRequestId683MR3 = String(meta.requestId);

  const limit = metaLimit;
  const remaining = metaRemaining;
  const resetFromMeta = nullableFiniteNumber683MR3(meta.resetAtMs);
  const resetFromText = meta.reset ? Date.parse(String(meta.reset)) : NaN;
  const resetAtMs = resetFromMeta != null ? resetFromMeta : (Number.isFinite(resetFromText) ? resetFromText : null);
  if (limit != null) state.quotaLimit683MR3 = limit;
  if (resetAtMs != null) {
    const oldReset = nullableFiniteNumber683MR3(state.quotaResetAtMs683MR3);
    const sameWindow = oldReset != null && Math.abs(resetAtMs - oldReset) <= 1000;
    const newerWindow = oldReset == null || resetAtMs > oldReset + 1000;
    if (newerWindow) {
      state.quotaResetAtMs683MR3 = resetAtMs;
      state.quotaReset683MR3 = meta.reset ? String(meta.reset) : new Date(resetAtMs).toUTCString();
      state.quotaRemaining683MR3 = remaining != null ? remaining : null;
      state.quotaSerialMode683MR3 = Number.isFinite(remaining) && remaining <= LOW_QUOTA_SERIAL_THRESHOLD_683MR3;
    } else if (sameWindow && remaining != null) {
      const oldRemaining = nullableFiniteNumber683MR3(state.quotaRemaining683MR3);
      state.quotaRemaining683MR3 = oldRemaining != null ? Math.min(oldRemaining, remaining) : remaining;
    }
  } else if (remaining != null) {
    const oldRemaining = nullableFiniteNumber683MR3(state.quotaRemaining683MR3);
    state.quotaRemaining683MR3 = oldRemaining != null ? Math.min(oldRemaining, remaining) : remaining;
  }
  if (remaining != null || resetAtMs != null || limit != null) state.quotaMetadataObservations683MR3 += 1;
  const currentRemaining = nullableFiniteNumber683MR3(state.quotaRemaining683MR3);
  const shouldSerial = currentRemaining != null && currentRemaining <= LOW_QUOTA_SERIAL_THRESHOLD_683MR3;
  if (shouldSerial && !wasSerial) state.quotaSerialModeSwitches683MR3 += 1;
  if (shouldSerial) state.quotaSerialMode683MR3 = true;
  return meta;
}

function rateLimitWaitPlan683MR3(result = {}, options = {}) {
  const meta = result?.rateLimit && typeof result.rateLimit === 'object' ? result.rateLimit : {};
  const resetAtFromMeta = nullableFiniteNumber683MR3(meta.resetAtMs);
  const resetAtFromText = meta.reset ? Date.parse(String(meta.reset)) : NaN;
  const resetAtMs = resetAtFromMeta != null ? resetAtFromMeta : (Number.isFinite(resetAtFromText) ? resetAtFromText : null);
  if (resetAtMs == null) return { eligible: false, reason: 'rate-limit-reset-header-missing-or-invalid', waitMs: 0, resetAtMs: null };
  const nowMs = nowMs683MR3(options);
  const waitMs = Math.max(RATE_LIMIT_RESET_GUARD_MS_683MR3, Math.round(resetAtMs - nowMs + RATE_LIMIT_RESET_GUARD_MS_683MR3));
  if (waitMs > MAX_RATE_LIMIT_WAIT_MS_683MR3) {
    return { eligible: false, reason: 'rate-limit-reset-wait-exceeds-safety-cap', waitMs, resetAtMs };
  }
  return { eligible: true, reason: null, waitMs, resetAtMs };
}

function markQuotaFailClosed683MR3(state = {}, reason = 'provider-quota-unavailable') {
  if (state.proactiveQuotaFailClosed683MR3 !== true) {
    state.proactiveQuotaFailClosed683MR3 = true;
    state.proactiveQuotaFailClosedCount683MR3 += 1;
    state.proactiveQuotaFailClosedReason683MR3 = String(reason || 'provider-quota-unavailable');
  }
}

function proactiveQuotaWaitPlan683MR3(state = {}, options = {}) {
  const remaining = nullableFiniteNumber683MR3(state.quotaRemaining683MR3);
  if (remaining == null || remaining > 0) return { required: false, eligible: true, reason: null, waitMs: 0 };
  const resetAtMs = nullableFiniteNumber683MR3(state.quotaResetAtMs683MR3);
  if (resetAtMs == null) return { required: true, eligible: false, reason: 'proactive-quota-reset-missing-or-invalid', waitMs: 0 };
  const waitMs = Math.max(RATE_LIMIT_RESET_GUARD_MS_683MR3, Math.round(resetAtMs - nowMs683MR3(options) + RATE_LIMIT_RESET_GUARD_MS_683MR3));
  if (waitMs > MAX_RATE_LIMIT_WAIT_MS_683MR3) return { required: true, eligible: false, reason: 'proactive-quota-reset-wait-exceeds-safety-cap', waitMs, resetAtMs };
  if (state._proactiveQuotaWaitLeaseUsed683MR3 || state.proactiveQuotaWaitCount683MR3 >= MAX_PROACTIVE_QUOTA_WAITS_PER_REQUEST_683MR3) {
    return { required: true, eligible: false, reason: 'proactive-quota-wait-lease-already-used', waitMs: 0, resetAtMs };
  }
  return { required: true, eligible: true, reason: null, waitMs, resetAtMs };
}

function clearQuotaWindowAfterReset683MR3(state = {}) {
  state.quotaRemaining683MR3 = null;
  state.quotaResetAtMs683MR3 = null;
  state.quotaReset683MR3 = null;
  // Stay serial until a fresh provider response proves the new window has headroom.
  state.quotaSerialMode683MR3 = true;
}

async function ensureQuotaBeforeLaunch683MR3(state = {}, options = {}) {
  if (options.skipProactiveQuotaGate683MR3 === true) return { allowed: true, waited: false };
  if (state.proactiveQuotaFailClosed683MR3 === true) return { allowed: false, waited: false, reason: state.proactiveQuotaFailClosedReason683MR3 };
  const plan = proactiveQuotaWaitPlan683MR3(state, options);
  if (!plan.required) return { allowed: true, waited: false };
  if (!plan.eligible) {
    if (plan.reason === 'proactive-quota-reset-missing-or-invalid') state.proactiveQuotaMissingReset683MR3 += 1;
    if (plan.reason === 'proactive-quota-reset-wait-exceeds-safety-cap') state.proactiveQuotaResetTooFar683MR3 += 1;
    markQuotaFailClosed683MR3(state, plan.reason);
    return { allowed: false, waited: false, reason: plan.reason, waitMs: plan.waitMs || 0 };
  }
  state._proactiveQuotaWaitLeaseUsed683MR3 = true;
  state.proactiveQuotaWaitCount683MR3 += 1;
  state.proactiveQuotaWaitMs683MR3 += plan.waitMs;
  await sleep683MR3(plan.waitMs, options);
  clearQuotaWindowAfterReset683MR3(state);
  return { allowed: true, waited: true, waitMs: plan.waitMs };
}

async function waitForRateLimitGate683MR3(state = {}) {
  const gate = state?._rateLimitGatePromise683MR3;
  if (gate && typeof gate.then === 'function') {
    try { await gate; } catch (_) {}
  }
}

function markProviderAbort683MR3(state = {}, reason) {
  if (!state.abortReason) {
    state.abortReason = reason;
    state.providerAbortEvents += 1;
  }
}

async function physicalDuffelRequest683MR3(args, state, options = {}) {
  const quotaGate = await ensureQuotaBeforeLaunch683MR3(state, options);
  if (!quotaGate.allowed) return { supported: false, reason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3, quotaFailClosed683MR3: true, quotaReason683MR3: quotaGate.reason || null, observations: [] };
  if (state.requests >= state.cap) return { supported: false, reason: '683i-r1-provider-request-cap-reached', observations: [] };
  const localRemaining = nullableFiniteNumber683MR3(state.quotaRemaining683MR3);
  if (localRemaining != null && localRemaining > 0) state.quotaRemaining683MR3 = Math.max(0, localRemaining - 1);
  state.requests += 1;
  state.providerConcurrencyCurrent683M += 1;
  state.providerConcurrencyPeak683M = Math.max(state.providerConcurrencyPeak683M, state.providerConcurrencyCurrent683M);
  const exactFn = options.searchExact || duffel683D.searchExactDate683D;
  const kind = options.requestKind683M === 'metro' ? 'metro' : 'exact';
  const experiment = state.exactConcurrencyExperimentR2;
  const phaseCurrent = experiment
    ? (state._physicalConcurrencyByKindGvPerfR2 ||= { exact: 0, metro: 0 }) : null;
  if (phaseCurrent) {
    phaseCurrent[kind] += 1;
    const peakKey = kind === 'metro' ? 'metroPhysicalConcurrencyPeak' : 'exactPhysicalConcurrencyPeak';
    experiment[peakKey] = Math.max(experiment[peakKey], phaseCurrent[kind]);
  }
  const started = Date.now();
  try {
    const result = await exactFn(args, { env: options.env || process.env, fetch: options.fetchDuffel || options.fetch, allowWithoutShadowFlag: options.allowWithoutShadowFlag === true });
    captureRateLimitMetadata683MR3(result, state);
    return result;
  } finally {
    if (phaseCurrent) phaseCurrent[kind] -= 1;
    const elapsed = Math.max(0, Date.now() - started);
    state.providerLatencyTotalMs683M += elapsed;
    state.providerLatencyMaxMs683M = Math.max(state.providerLatencyMaxMs683M, elapsed);
    state.providerLatenciesMs683M.push(elapsed);
    if (kind === 'metro') state.metroProviderLatencyMs683M += elapsed;
    else state.exactProviderLatencyMs683M += elapsed;
    state.providerConcurrencyCurrent683M = Math.max(0, state.providerConcurrencyCurrent683M - 1);
  }
}

async function callDuffel683H(args, state, options = {}) {
  if (state.abortReason) return { supported: false, reason: `683i-r1-provider-aborted:${state.abortReason}`, observations: [] };
  const key = providerRequestKey683M(args);
  const cache = state._requestCache683M instanceof Map ? state._requestCache683M : null;
  if (cache?.has(key)) {
    state.deduplicatedRequests683M += 1;
    return cache.get(key);
  }
  if (state.requests >= state.cap) return { supported: false, reason: '683i-r1-provider-request-cap-reached', observations: [] };

  const promise = (async () => {
    const first = await physicalDuffelRequest683MR3(args, state, options);
    const firstAbort = providerAbortReason683IR1(first);
    if (firstAbort === 'authorization') {
      markProviderAbort683MR3(state, 'authorization');
      return first;
    }
    if (firstAbort !== 'rate-limit') return first;

    state.rateLimitEvents683MR3 += 1;
    const plan = rateLimitWaitPlan683MR3(first, options);
    if (!plan.eligible) {
      if (plan.reason === 'rate-limit-reset-header-missing-or-invalid') state.rateLimitMissingReset683MR3 += 1;
      if (plan.reason === 'rate-limit-reset-wait-exceeds-safety-cap') state.rateLimitResetTooFar683MR3 += 1;
      state.rateLimitRecoveryFailed683MR3 += 1;
      markQuotaFailClosed683MR3(state, plan.reason);
      return { ...first, reason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3, quotaFailClosed683MR3: true, quotaReason683MR3: plan.reason, recovery683MR3: { attempted: false, recovered: false, reason: plan.reason, waitMs: plan.waitMs } };
    }
    if (state._rateLimitRetryLeaseUsed683MR3 || state.rateLimitRetryCount683MR3 >= MAX_RATE_LIMIT_RETRIES_PER_REQUEST_683MR3) {
      state.rateLimitRecoveryFailed683MR3 += 1;
      markQuotaFailClosed683MR3(state, 'rate-limit-retry-lease-already-used');
      return { ...first, reason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3, quotaFailClosed683MR3: true, quotaReason683MR3: 'rate-limit-retry-lease-already-used', recovery683MR3: { attempted: false, recovered: false, reason: 'rate-limit-retry-lease-already-used', waitMs: 0 } };
    }
    if (state.requests >= state.cap) {
      state.rateLimitRetryBlockedByCap683MR3 += 1;
      state.rateLimitRecoveryFailed683MR3 += 1;
      markQuotaFailClosed683MR3(state, 'rate-limit-retry-blocked-by-request-cap');
      return { ...first, reason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3, quotaFailClosed683MR3: true, quotaReason683MR3: 'rate-limit-retry-blocked-by-request-cap', recovery683MR3: { attempted: false, recovered: false, reason: 'rate-limit-retry-blocked-by-request-cap', waitMs: 0 } };
    }

    state._rateLimitRetryLeaseUsed683MR3 = true;
    state.rateLimitRetryCount683MR3 += 1;
    state.rateLimitWaitMs683MR3 += plan.waitMs;

    let resolveGate;
    const gate = new Promise(resolve => { resolveGate = resolve; });
    state._rateLimitGatePromise683MR3 = gate;
    try {
      await sleep683MR3(plan.waitMs, options);
      if (state.abortReason) {
        state.rateLimitRecoveryFailed683MR3 += 1;
        return { ...first, recovery683MR3: { attempted: true, recovered: false, reason: `provider-aborted-during-rate-limit-wait:${state.abortReason}`, waitMs: plan.waitMs } };
      }
      if (state.requests >= state.cap) {
        state.rateLimitRetryBlockedByCap683MR3 += 1;
        state.rateLimitRecoveryFailed683MR3 += 1;
        markQuotaFailClosed683MR3(state, 'rate-limit-retry-blocked-by-request-cap');
        return { ...first, reason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3, quotaFailClosed683MR3: true, quotaReason683MR3: 'rate-limit-retry-blocked-by-request-cap', recovery683MR3: { attempted: true, recovered: false, reason: 'rate-limit-retry-blocked-by-request-cap', waitMs: plan.waitMs } };
      }
      clearQuotaWindowAfterReset683MR3(state);
      const retry = await physicalDuffelRequest683MR3(args, state, { ...options, skipProactiveQuotaGate683MR3: true });
      const retryAbort = providerAbortReason683IR1(retry);
      if (retryAbort === 'rate-limit') {
        state.rateLimitEvents683MR3 += 1;
        state.rateLimitRecoveryFailed683MR3 += 1;
        markQuotaFailClosed683MR3(state, 'rate-limit-retry-still-throttled');
        return { ...retry, reason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3, quotaFailClosed683MR3: true, quotaReason683MR3: 'rate-limit-retry-still-throttled', recovery683MR3: { attempted: true, recovered: false, reason: 'rate-limit-retry-still-throttled', waitMs: plan.waitMs } };
      }
      if (retryAbort === 'authorization') {
        state.rateLimitRecoveryFailed683MR3 += 1;
        markProviderAbort683MR3(state, 'authorization');
        return { ...retry, recovery683MR3: { attempted: true, recovered: false, reason: 'authorization-after-rate-limit-retry', waitMs: plan.waitMs } };
      }
      state.rateLimitRecoverySucceeded683MR3 += 1;
      return { ...retry, recovery683MR3: { attempted: true, recovered: true, reason: null, waitMs: plan.waitMs } };
    } finally {
      try { resolveGate(); } catch (_) {}
      if (state._rateLimitGatePromise683MR3 === gate) state._rateLimitGatePromise683MR3 = null;
    }
  })();

  if (cache) cache.set(key, promise);
  try {
    return await promise;
  } catch (error) {
    if (cache?.get(key) === promise) cache.delete(key);
    throw error;
  }
}

async function resolveExactLeg683H({ origin, destination, departureDate, displayCurrency = 'USD' } = {}, state, options = {}) {
  const env = options.env || process.env;
  const cfg = config683H(env);
  // 683M-R4: after any concurrent 429, pause new provider launches until the
  // single reset-aware recovery attempt finishes. In-flight calls are allowed
  // to finish; no extra burst is created during the provider reset window.
  await waitForRateLimitGate683MR3(state);
  if (state.proactiveQuotaFailClosed683MR3) return { supported: false, reason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3, coverageMode: 'UNAVAILABLE', quotaReason683MR3: state.proactiveQuotaFailClosedReason683MR3 };
  const exactArgs = { origin, destination, departureDate, currency: displayCurrency || 'USD', passengers: 1 };
  if (state.abortReason) return { supported: false, reason: `683i-r1-provider-aborted:${state.abortReason}`, coverageMode: 'UNAVAILABLE' };
  if (state.requests >= state.cap) return { supported: false, reason: '683i-r1-provider-request-cap-reached', coverageMode: 'UNAVAILABLE' };
  state.exactRequests += 1;
  const exact = await callDuffel683H(exactArgs, state, { ...options, requestKind683M: 'exact' });
  if (exact?.supported) {
    const cheapest = chooseCheapestObservation683H(exact);
    const fxStarted683M = Date.now();
    const normalized = cheapest ? await normalizeLiveObservation683H(cheapest, displayCurrency, options) : null;
    state.fxLatencyMs683M += Math.max(0, Date.now() - fxStarted683M);
    if (normalized?.supported) {
      return { supported: true, coverageMode: 'EXACT', requestedOrigin: origin, requestedDestination: destination, resolvedOrigin: origin, resolvedDestination: destination, airportMode: 'EXACT', exactResult: exact, observation: { ...normalized.observation, requestedOrigin: origin, requestedDestination: destination, resolvedOrigin: origin, resolvedDestination: destination, airportMode683H: 'EXACT', metroAirportFallback683H: null } };
    }
    if (normalized && !normalized.supported) state.fxFailures += 1;
    return { supported: false, reason: normalized?.reason || '683h-exact-normalization-failed', coverageMode: 'UNAVAILABLE', exactResult: exact };
  }
  if (!fallbackEligible683H(exact) || cfg.maxMetroAlternatesPerLeg <= 0) {
    return { supported: false, reason: exact?.reason || '683h-exact-live-unavailable', coverageMode: 'UNAVAILABLE', exactResult: exact };
  }
  const fallbacks = buildMetroFallbackCandidates683H({ origin, destination, departureDate }, loadMetroRegistry683H(), cfg.maxMetroAlternatesPerLeg);
  for (const candidate of fallbacks) {
    await waitForRateLimitGate683MR3(state);
    if (state.abortReason || state.proactiveQuotaFailClosed683MR3 || state.requests >= state.cap) break;
    state.metroRequests += 1;
    const alt = await callDuffel683H({ origin: candidate.origin, destination: candidate.destination, departureDate, currency: displayCurrency || 'USD', passengers: 1 }, state, { ...options, requestKind683M: 'metro' });
    if (!alt?.supported) continue;
    const cheapest = chooseCheapestObservation683H(alt);
    const fxStarted683M = Date.now();
    const normalized = cheapest ? await normalizeLiveObservation683H(cheapest, displayCurrency, options) : null;
    state.fxLatencyMs683M += Math.max(0, Date.now() - fxStarted683M);
    if (!normalized?.supported) { if (normalized) state.fxFailures += 1; continue; }
    return {
      supported: true,
      coverageMode: 'METRO_ALTERNATE',
      requestedOrigin: origin,
      requestedDestination: destination,
      resolvedOrigin: candidate.origin,
      resolvedDestination: candidate.destination,
      airportMode: candidate.airportMode,
      exactResult: exact,
      fallbackResult: alt,
      observation: {
        ...normalized.observation,
        requestedOrigin: origin,
        requestedDestination: destination,
        resolvedOrigin: candidate.origin,
        resolvedDestination: candidate.destination,
        origin: candidate.origin,
        destination: candidate.destination,
        airportMode683H: candidate.airportMode,
        metroAirportFallback683H: {
          version: VERSION_683H,
          changedAirports: candidate.changedAirports,
          airportShiftKmTotal: candidate.airportShiftKmTotal,
          originMetroCode: candidate.originMetroCode,
          destinationMetroCode: candidate.destinationMetroCode,
          groundAccessEstimateAdjusted: false,
          caveat: 'same-city airport substitution; ground-access estimate is not repriced in the Duffel P2 evaluation'
        }
      }
    };
  }
  return { supported: false, reason: state.proactiveQuotaFailClosed683MR3 ? PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3 : (state.abortReason ? `683i-r1-provider-aborted:${state.abortReason}` : (state.requests >= state.cap ? '683i-r1-provider-request-cap-reached' : '683h-no-live-exact-or-metro-offer')), quotaReason683MR3: state.proactiveQuotaFailClosedReason683MR3 || null, coverageMode: 'UNAVAILABLE', exactResult: exact, fallbacksTried: fallbacks.length };
}

async function buildLiveProviderResults683H({ candidateStarts = [], baselineFirstLegResult = {}, legs = [], stops = [], query = {}, displayCurrency = 'USD' } = {}, options = {}) {
  const buildStarted683M = Date.now();
  const env = options.env || process.env;
  if (!simulationAvailable683H(env) && options.allowSimulationWithoutDependencies !== true) {
    return { supported: false, reason: '683h-dependencies-not-ready', providerResults: [], candidateStarts: [], state: requestState683H(env) };
  }
  const passenger = passengerEligibility683H(query);
  if (!passenger.eligible) return { supported: false, reason: passenger.reason, providerResults: [], candidateStarts: [], state: requestState683H(env), party: passenger.party };
  const cfg = config683H(env);
  const starts = selectCandidateStarts683H(candidateStarts, baselineFirstLegResult, cfg.maxCandidates);
  if (starts.length < 2) return { supported: false, reason: '683h-fewer-than-two-candidate-starts', providerResults: [], candidateStarts: starts, state: requestState683H(env) };
  const requestBudgetPlan = planRequestBudget683IR1({ legs, candidateCount: starts.length }, env);
  const state = requestState683H(env, requestBudgetPlan);
  const byLeg = Array.from({ length: legs.length }, () => []);
  const candidateDiagnostics = [];

  // 683M: candidate schedules remain sequential to avoid a burst across both dates,
  // but independent flight legs inside one schedule are searched with max concurrency 2.
  // This cuts the critical path while preserving the same candidate count and hard cap.
  for (const startDate of starts) {
    const schedule = scheduleForStart({ startDate, stops, legCount: legs.length });
    const missing = [];
    const tasks = [];
    for (let index = 0; index < legs.length; index += 1) {
      const leg = legs[index];
      if (!isFlightLeg683H(leg) || isGroundLeg683H(leg)) continue;
      const origin = legCode(leg.from); const destination = legCode(leg.to); const departureDate = schedule[index];
      if (!origin || !destination || !departureDate) {
        missing.push({ index, origin, destination, departureDate, reason: 'missing-route-or-date' });
        continue;
      }
      tasks.push({ index, origin, destination, departureDate });
    }

    const resolvedRows = await mapQuotaReservation683MR4(
      tasks,
      state,
      async (task) => {
        await waitForRateLimitGate683MR3(state);
        if (state.proactiveQuotaFailClosed683MR3) return { task, resolved: { supported: false, reason: PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3, quotaReason683MR3: state.proactiveQuotaFailClosedReason683MR3 } };
        if (state.abortReason) return { task, resolved: { supported: false, reason: `683i-r1-provider-aborted:${state.abortReason}` } };
        if (state.requests >= state.cap) return { task, resolved: { supported: false, reason: '683i-r1-provider-request-cap-reached' } };
        const resolved = await resolveExactLeg683H({ origin: task.origin, destination: task.destination, departureDate: task.departureDate, displayCurrency }, state, { ...options, canaryContext: query });
        return { task, resolved };
      },
      () => Boolean(state.abortReason) || state.proactiveQuotaFailClosed683MR3 === true || state.requests >= state.cap,
      options
    );

    for (let i = 0; i < tasks.length; i += 1) {
      const task = tasks[i];
      const row = resolvedRows[i];
      if (!row) {
        missing.push({ ...task, reason: state.proactiveQuotaFailClosed683MR3 ? PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3 : (state.abortReason ? `683i-r1-provider-aborted:${state.abortReason}` : '683i-r1-provider-request-cap-reached') });
        continue;
      }
      const resolved = row.resolved;
      if (!resolved?.supported || !resolved?.observation) {
        missing.push({ ...task, reason: resolved?.reason || 'unavailable' });
        continue;
      }
      byLeg[task.index].push(resolved.observation);
    }

    const complete = missing.length === 0;
    candidateDiagnostics.push({ startDate, schedule, complete, missing });
    if (state.abortReason || state.proactiveQuotaFailClosed683MR3) break;
  }

  const providerResults = byLeg.map((observations, index) => ({
    supported: observations.length > 0,
    reason: observations.length ? null : '683h-no-live-observations-for-leg',
    observations: observations.slice().sort((a, b) => String(a.departureDate).localeCompare(String(b.departureDate)) || Number(a.rankingPriceUsd || Infinity) - Number(b.rankingPriceUsd || Infinity)),
    providerContract: { provider: { id: duffel683D.DUFFEL_PROVIDER_ID_683D, evidenceClass: 'LIVE_PROVIDER', rankingGrade: 'DECISION_GRADE', productionApproved: false } },
    endpointUsed: duffel683D.ALLOWED_PATH_683D,
    adapterSource: 'duffel-live-p2-staging-683h',
    index
  }));
  const completeScheduleCount = candidateDiagnostics.filter(row => row.complete).length;
  const terminalReason = state.proactiveQuotaFailClosed683MR3
    ? PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3
    : (state.abortReason
      ? `683i-r1-provider-aborted:${state.abortReason}`
      : (state.requests >= state.cap && completeScheduleCount < 2 ? '683i-r1-provider-request-cap-reached' : '683h-fewer-than-two-complete-live-schedules'));
  state.liveBuildMs683M = Math.max(0, Date.now() - buildStarted683M);
  return {
    supported: completeScheduleCount >= 2,
    reason: completeScheduleCount >= 2 ? null : terminalReason,
    providerResults,
    candidateStarts: starts,
    candidateDiagnostics,
    completeScheduleCount,
    requestBudgetPlan,
    state,
    latency683M: latencyDiagnostics683M(state),
    party: passenger.party,
    stagingOnly: true,
    productionApproved: false
  };
}

function hotelEstimateUsd683H(stops = []) {
  return Math.round((Array.isArray(stops) ? stops : []).reduce((sum, stop) => {
    const direct = Number(stop?.hotelEstimateUsd || stop?.stayEstimateUsd || stop?.estimatedHotelUsd || 0);
    return sum + (Number.isFinite(direct) ? direct : 0);
  }, 0));
}

function budgetCeilingUsd683H(tour = {}, query = {}) {
  const direct = Number(tour?.totalBudgetUsd || query?.budgetUsd || 0);
  return Number.isFinite(direct) && direct > 0 ? direct + Math.max(5, direct * 0.005) : Infinity;
}

async function simulateTour683H({ tour = {}, query = {}, candidateStarts = [], baselineFirstLegResult = {}, displayCurrency = 'USD' } = {}, options = {}) {
  const legs = Array.isArray(tour?.legs) ? tour.legs : [];
  const stops = Array.isArray(tour?.stops) ? tour.stops : [];
  const live = await buildLiveProviderResults683H({ candidateStarts, baselineFirstLegResult, legs, stops, query, displayCurrency }, { ...options, allowSimulationWithoutDependencies: options.allowSimulationWithoutDependencies });
  if (!live.supported) return { supported: false, reason: live.reason, live, selected: null, status: status683H(options.env || process.env) };
  const candidates = live.candidateStarts.map(startDate => evaluateCandidate({
    startDate,
    stops,
    legs,
    providerResults: live.providerResults,
    isFlightLeg: isFlightLeg683H,
    isGroundLeg: isGroundLeg683H,
    convertProviderPriceToUsd: (price, currency, observation) => Number(observation?.rankingPriceUsd || 0),
    flightFareUnits: 1,
    originAccessEstimateUsd: Number(tour?.originAccessEstimateUsd || tour?.passengerPricing?.originAccessEstimateUsd || 0),
    destinationAccessEstimateUsd: stops.reduce((sum, stop) => sum + Number(stop?.destinationAccessEstimateUsd || stop?.destinationAccess?.roundTripPartyUsd || 0), 0),
    hotelEstimateUsd: hotelEstimateUsd683H(stops)
  })).filter(Boolean);
  const selection = selectCandidate(candidates, { budgetCeilingUsd: budgetCeilingUsd683H(tour, query) });
  const selected = selection.completeCandidateCount >= 2 ? selection.selected : null;
  return {
    supported: Boolean(selected),
    reason: selected ? null : '683h-no-selectable-complete-live-schedule',
    status: status683H(options.env || process.env),
    live,
    candidates,
    selected,
    selection: {
      completeCandidateCount: selection.completeCandidateCount,
      budgetFitCandidateCount: selection.budgetFitCandidateCount,
      qualityEligibleCandidateCount: selection.qualityEligibleCandidateCount
    },
    stagingOnly: true,
    productionApproved: false,
    rankingSimulation: true
  };
}

function applyResolvedAirports683H(leg = {}, observation = {}) {
  if (!observation || !String(observation.airportMode683H || '').startsWith('METRO_')) return leg;
  const next = { ...leg, from: { ...(leg.from || {}) }, to: { ...(leg.to || {}) } };
  const ro = safeIata(observation.resolvedOrigin); const rd = safeIata(observation.resolvedDestination);
  if (ro) { next.from.airportCode = ro; if (next.from.code) next.from.code = ro; }
  if (rd) { next.to.airportCode = rd; if (next.to.code) next.to.code = rd; }
  next.metroAirportSubstitution683H = observation.metroAirportFallback683H || { version: VERSION_683H, caveat: 'same-city airport substitution' };
  return next;
}

module.exports = {
  VERSION_683H,
  METRO_REGISTRY_PATH_683H,
  DEFAULT_MAX_CANDIDATES_683H,
  DEFAULT_REQUEST_CAP_683H,
  DEFAULT_MAX_METRO_ALTERNATES_683H,
  MAX_HARD_REQUEST_CAP_683H,
  MAX_DYNAMIC_METRO_ALLOWANCE_683IR1,
  MAX_PROVIDER_CONCURRENCY_683M,
  MAX_RATE_LIMIT_RETRIES_PER_REQUEST_683MR3,
  MAX_RATE_LIMIT_WAIT_MS_683MR3,
  RATE_LIMIT_RESET_GUARD_MS_683MR3,
  LOW_QUOTA_SERIAL_THRESHOLD_683MR3,
  QUOTA_RESERVATION_MAX_BATCH_683MR4,
  MAX_PROACTIVE_QUOTA_WAITS_PER_REQUEST_683MR3,
  PROVIDER_QUOTA_FAIL_CLOSED_REASON_683MR3,
  config683H,
  dependencyReady683H,
  runtimeEnvironment683J,
  stagingIdentity683J,
  exactThreeStagingEnabledGvPerfR2,
  activationEnabled683J,
  productionCanaryAuthorized683K,
  stagingActivationReady683J,
  activationRefusedReason683J,
  enabled683H,
  simulationAvailable683H,
  status683H,
  loadMetroRegistry683H,
  distanceKm683H,
  metroAlternates683H,
  buildMetroFallbackCandidates683H,
  fallbackEligible683H,
  chooseCheapestObservation683H,
  addDaysIso683H,
  seedCandidateStarts683H,
  selectCandidateStarts683H,
  passengerEligibility683H,
  metroSensitiveFlightLegCount683IR1,
  planRequestBudget683IR1,
  requestState683H,
  percentile683M,
  latencyDiagnostics683M,
  providerRequestKey683M,
  mapLimit683M,
  nullableFiniteNumber683MR3,
  quotaAwareConcurrency683MR3,
  quotaReservationBatchSize683MR4,
  mapQuotaReservation683MR4,
  mapQuotaAware683MR3,
  providerAbortReason683IR1,
  nowMs683MR3,
  sleep683MR3,
  captureRateLimitMetadata683MR3,
  rateLimitWaitPlan683MR3,
  markQuotaFailClosed683MR3,
  proactiveQuotaWaitPlan683MR3,
  clearQuotaWindowAfterReset683MR3,
  ensureQuotaBeforeLaunch683MR3,
  waitForRateLimitGate683MR3,
  physicalDuffelRequest683MR3,
  callDuffel683H,
  normalizeLiveObservation683H,
  liveSelectionFailClosedReason683JR1,
  resolveExactLeg683H,
  buildLiveProviderResults683H,
  simulateTour683H,
  applyResolvedAirports683H,
  isFlightLeg683H,
  isGroundLeg683H,
  legCode
};
