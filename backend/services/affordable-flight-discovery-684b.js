'use strict';

// GV-REC-684B — controlled affordable-flight route discovery pilot.
//
// 684A proved that Globevoy can replace the FINAL selected schedule with exact-
// date Duffel LIVE flight evidence. 684B moves one carefully bounded step earlier:
// when the planning/ranking layer would otherwise return no route or a ground-only
// route for a non-lowest-cost role, inspect a tiny shortlist of plausible flight-
// bearing candidates and let complete 684A LIVE evidence decide whether one truly
// fits the user's budget.
//
// Safety posture:
//   * R3 activation is code-only and still depends on the existing 684A public pilot;
//   * default origin remains hard-allowlisted to YYZ only;
//   * an exact staging-origin runtime overlay may narrow/expand only within the
//     separately reviewed five-origin 703B cohort;
//   * single-adult pilot, matching 684A;
//   * at most two candidate routes checked per request;
//   * candidates may be at most 15% over the planning budget, but NOTHING over the
//     actual user budget is selected unless complete exact-date 684A LIVE evidence
//     reprices it under budget;
//   * lowest-cost role is preserved: a genuinely cheaper ground trip can remain the
//     lowest-cost option; 684B is meant to restore flight discovery to balance /
//     memorable/default lanes rather than force flying everywhere;
//   * no order, payment, booking or ticketing capability.

const { normalizeParty } = require('./traveller-pricing');

const VERSION_684B = 'GV-REC-684B-R3';
// R3 is code-gated because the Lambda environment is already at the AWS 4KB
// aggregate environment-variable ceiling. No new Lambda environment keys are
// introduced. Activation is still bounded by the existing 684A public pilot.
// The default remains YYZ-only. GV-FLIGHT-703D may inject an in-process staging
// override before generated-tour loads; that override is accepted only for the
// exact staging CORS origin and only inside the already-proven five-origin cohort.
const CODE_ENABLED_684B_R3 = true;
const DEFAULT_ORIGINS_684B = Object.freeze(['YYZ']);
const STAGING_ORIGIN_684B = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const STAGING_ORIGIN_ENV_684B = 'GV_DUFFEL_AFFORDABLE_DISCOVERY_ORIGINS_684B';
const STAGING_MAX_ORIGINS_684B = Object.freeze(['YYZ', 'JFK', 'LAX', 'DUB', 'DXB']);
const MAX_CANDIDATE_CHECKS_684B = 2;
const MAX_FLIGHT_LEGS_684B = 3;
const PLANNING_OVERAGE_RATIO_684B = 1.15;

function envTrue(name, env = process.env) {
  return String(env?.[name] || '').trim().toLowerCase() === 'true';
}

function safeIata(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function normalizeWebOrigin684B(value = '') {
  const raw = String(value == null ? '' : value).trim();
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

function parsedOriginAllowlist684B(value = '') {
  return [...new Set(String(value == null ? '' : value)
    .split(',')
    .map(code => safeIata(code))
    .filter(Boolean))];
}

function configuredOrigins684B(env = process.env) {
  if (normalizeWebOrigin684B(env?.CORS_ORIGIN) !== STAGING_ORIGIN_684B) {
    return DEFAULT_ORIGINS_684B.slice();
  }

  const staged = parsedOriginAllowlist684B(env?.[STAGING_ORIGIN_ENV_684B]);
  if (!staged.length || staged.some(code => !STAGING_MAX_ORIGINS_684B.includes(code))) {
    return DEFAULT_ORIGINS_684B.slice();
  }
  return staged;
}

function enabled684BR1(env = process.env) {
  return CODE_ENABLED_684B_R3 && envTrue('ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A', env);
}

function endpointCode(node = {}) {
  return safeIata(node.airportCode || node.code || node.displayCode || node.iata || node.iataCode);
}

function legHasFlight684B(leg = {}) {
  const text = `${String(leg.mode || '')} ${String(leg.transportType || '')}`.toLowerCase();
  if (text.includes('flight')) return true;
  return (Array.isArray(leg.segments) ? leg.segments : []).some(segment => `${String(segment?.mode || '')} ${String(segment?.transportType || '')}`.toLowerCase().includes('flight'));
}

function flightLegs684B(tour = {}) {
  return (Array.isArray(tour.legs) ? tour.legs : []).filter(legHasFlight684B);
}

function hasFlight684B(tour = {}) {
  return flightLegs684B(tour).length > 0;
}

function firstFlightOrigin684B(tour = {}) {
  const leg = (Array.isArray(tour.legs) ? tour.legs : []).find(legHasFlight684B);
  return leg ? endpointCode(leg.from || {}) : null;
}

function tourOrigin684B(tour = {}, query = {}) {
  const direct = endpointCode(tour.origin || {});
  if (direct) return direct;
  const fromLeg = firstFlightOrigin684B(tour);
  if (fromLeg) return fromLeg;
  const input = String(query.origin || query.originCode || query.from || '').toUpperCase();
  const paren = input.match(/\(([A-Z]{3})\)/);
  if (paren) return paren[1];
  const bare = input.match(/\b([A-Z]{3})\b/);
  return bare ? bare[1] : null;
}

function normalizeRole684B(query = {}) {
  const raw = String(query.pickRole || query.routeRole || query.tourRole || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (raw.includes('lowest') || raw === 'cost') return 'lowest-cost';
  if (raw.includes('memorable') || raw.includes('discover')) return 'most-memorable';
  if (raw.includes('balance') || raw.includes('recommended')) return 'best-balance';
  return raw || 'default';
}

function routeKey684B(tour = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  return stops.map(stop => String(stop?.cityId || stop?.airportCode || stop?.code || stop?.city || '').trim().toLowerCase()).filter(Boolean).join('>');
}

function defaultTotalUsd684B(tour = {}) {
  const direct = Number(tour.estimatedTotalUsd || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 0;
}

function defaultBudgetCeilingUsd684B(tour = {}, query = {}) {
  const direct = Number(tour?.totalBudgetUsd || query.budgetUsd || 0);
  return Number.isFinite(direct) && direct > 0 ? direct : Infinity;
}

function terminalLiveFailure684B(summary = {}) {
  const reason = String(summary?.reason || '').toLowerCase();
  return /quota|rate-limit|provider-aborted|request-cap|authorization|unauthorized|forbidden/.test(reason);
}

function eligibility684B(tours = [], currentTour = null, query = {}, env = process.env, context = {}) {
  const role = normalizeRole684B(query);
  const list = Array.isArray(tours) ? tours.filter(Boolean) : [];
  if (!CODE_ENABLED_684B_R3) return { eligible: false, reason: '684b-r3-code-gate-off', role };
  if (!envTrue('ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A', env)) return { eligible: false, reason: '684b-requires-684a-live-fare-pilot', role };
  if (String(query?.__gvProviderCanary683K || '') === 'authorized-production-canary') return { eligible: false, reason: '684b-skipped-existing-683k-production-canary', role };
  if (role === 'lowest-cost') return { eligible: false, reason: '684b-lowest-cost-role-preserves-cheapest-ground-option', role };
  const selectedFlightFallback = Boolean(currentTour && hasFlight684B(currentTour) && context.allowSelectedFlightFallback === true);
  if (currentTour && hasFlight684B(currentTour) && !selectedFlightFallback) return { eligible: false, reason: '684b-selected-route-already-has-flight', role };

  const party = normalizeParty(query);
  if (party.adults !== 1 || party.children !== 0 || party.infants !== 0 || party.travellers !== 1) {
    return { eligible: false, reason: '684b-single-adult-pilot-only', role, party };
  }

  const origin = tourOrigin684B(currentTour || list[0] || {}, query);
  const allowedOrigins = configuredOrigins684B(env);
  if (!origin || !allowedOrigins.includes(origin)) {
    return { eligible: false, reason: '684b-origin-outside-pilot-allowlist', role, origin, allowedOrigins, party };
  }
  if (!list.length) return { eligible: false, reason: '684b-no-candidate-routes', role, origin, allowedOrigins, party, selectedFlightFallback };
  return { eligible: true, reason: null, role, origin, allowedOrigins, party, selectedFlightFallback };
}

function buildShortlist684B(tours = [], currentTour = null, query = {}, options = {}) {
  const totalUsd = typeof options.totalUsd === 'function' ? options.totalUsd : defaultTotalUsd684B;
  const budgetCeiling = typeof options.budgetCeiling === 'function' ? options.budgetCeiling : defaultBudgetCeilingUsd684B;
  const scoreCandidate = typeof options.scoreCandidate === 'function' ? options.scoreCandidate : (() => 0);
  const currentKey = routeKey684B(currentTour || {});
  const origin = tourOrigin684B(currentTour || (Array.isArray(tours) ? tours[0] : null) || {}, query);
  const rows = [];
  for (const tour of Array.isArray(tours) ? tours : []) {
    if (!tour || !hasFlight684B(tour)) continue;
    const key = routeKey684B(tour);
    if (currentKey && key && key === currentKey) continue;
    const flightLegCount = flightLegs684B(tour).length;
    if (flightLegCount < 1 || flightLegCount > MAX_FLIGHT_LEGS_684B) continue;
    if (origin && firstFlightOrigin684B(tour) !== origin) continue;
    const planningTotalUsd = Number(totalUsd(tour, query) || 0);
    const ceilingUsd = Number(budgetCeiling(tour, query));
    if (!(planningTotalUsd > 0)) continue;
    if (Number.isFinite(ceilingUsd) && planningTotalUsd > ceilingUsd * PLANNING_OVERAGE_RATIO_684B) continue;
    rows.push({
      tour,
      key,
      flightLegCount,
      planningTotalUsd,
      ceilingUsd: Number.isFinite(ceilingUsd) ? ceilingUsd : null,
      score: Number(scoreCandidate(tour, query) || 0)
    });
  }
  const ranked = rows.slice().sort((a, b) => b.score - a.score || a.planningTotalUsd - b.planningTotalUsd || a.key.localeCompare(b.key));
  if (ranked.length <= 1) return ranked;

  // Keep the first slot role-aware, but reserve the second slot for the cheapest
  // plausible flight route. This directly protects the MVP from the failure mode
  // where two flashy multi-city candidates crowd out a genuinely affordable
  // single-destination flight such as YYZ-MEX.
  const shortlist = [ranked[0]];
  const cheapest = rows.slice().sort((a, b) => a.planningTotalUsd - b.planningTotalUsd || b.score - a.score || a.key.localeCompare(b.key))[0];
  if (cheapest && cheapest.key !== shortlist[0].key) shortlist.push(cheapest);
  if (shortlist.length < MAX_CANDIDATE_CHECKS_684B) {
    const next = ranked.find(row => !shortlist.some(chosen => chosen.key === row.key));
    if (next) shortlist.push(next);
  }
  return shortlist.slice(0, MAX_CANDIDATE_CHECKS_684B);
}

async function discoverAffordableFlightTour684B(tours = [], currentTour = null, query = {}, options = {}) {
  const env = options.env || process.env;
  const eligibility = eligibility684B(tours, currentTour, query, env, { allowSelectedFlightFallback: options.allowSelectedFlightFallback === true });
  const baseSummary = {
    version: VERSION_684B,
    enabled: enabled684BR1(env),
    attempted: false,
    applied: false,
    reason: eligibility.reason || null,
    role: eligibility.role || normalizeRole684B(query),
    origin: eligibility.origin || tourOrigin684B(currentTour || (Array.isArray(tours) ? tours[0] : null) || {}, query),
    originAllowlist: eligibility.allowedOrigins || configuredOrigins684B(env),
    candidateCap: MAX_CANDIDATE_CHECKS_684B,
    maxFlightLegs: MAX_FLIGHT_LEGS_684B,
    planningOverageRatio: PLANNING_OVERAGE_RATIO_684B,
    candidateCount: 0,
    candidatesAttempted: 0,
    providerRequests: 0,
    selectedRoute: null,
    selectedPlanningTotalUsd: null,
    selectedLiveTotalUsd: null,
    livePriceDeltaUsd: null,
    singleAdultOnly: true,
    completeLiveEvidenceRequired: true,
    selectedFlightFallbackMode: eligibility.selectedFlightFallback === true,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
  };
  if (!eligibility.eligible) return { tour: currentTour, enrichment: null, summary: baseSummary };

  const enrichTour = options.enrichTour;
  const applyLiveFare = options.applyLiveFare;
  const isOverBudget = options.isOverBudget;
  if (typeof enrichTour !== 'function' || typeof applyLiveFare !== 'function' || typeof isOverBudget !== 'function') {
    return { tour: currentTour, enrichment: null, summary: { ...baseSummary, reason: '684b-missing-discovery-dependencies' } };
  }

  const shortlist = buildShortlist684B(tours, currentTour, query, options);
  const candidateDiagnostics = [];
  let providerRequests = 0;
  for (const row of shortlist) {
    const normalizedCandidate = typeof options.normalizeTour === 'function' ? options.normalizeTour(row.tour, query) : row.tour;
    const enrichment = await enrichTour(normalizedCandidate, query);
    const live = await applyLiveFare(enrichment?.tour || normalizedCandidate, query);
    providerRequests += Number(live?.summary?.providerRequests || 0);
    const overBudget = live?.summary?.applied === true ? Boolean(isOverBudget(live.tour, query)) : null;
    candidateDiagnostics.push({
      route: row.key,
      planningTotalUsd: Math.round(row.planningTotalUsd),
      score: Math.round(row.score),
      flightLegCount: row.flightLegCount,
      liveAttempted: live?.summary?.attempted === true,
      liveApplied: live?.summary?.applied === true,
      liveReason: live?.summary?.reason || null,
      liveTotalUsd: live?.summary?.applied === true ? Math.round(Number(live?.summary?.afterTotalUsd || 0)) : null,
      providerRequests: Number(live?.summary?.providerRequests || 0),
      overBudget
    });
    if (live?.summary?.applied !== true) {
      if (terminalLiveFailure684B(live?.summary)) break;
      continue;
    }
    if (overBudget) continue;

    const selectedTour = {
      ...live.tour,
      affordableFlightDiscovery684B: {
        version: VERSION_684B,
        applied: true,
        role: eligibility.role,
        route: row.key,
        planningTotalUsd: Math.round(row.planningTotalUsd),
        liveTotalUsd: Math.round(Number(live?.summary?.afterTotalUsd || 0)),
        completeLiveEvidenceRequired: true
      }
    };
    const summary = {
      ...baseSummary,
      attempted: true,
      applied: true,
      reason: null,
      candidateCount: shortlist.length,
      candidatesAttempted: candidateDiagnostics.length,
      providerRequests,
      selectedRoute: row.key,
      selectedPlanningTotalUsd: Math.round(row.planningTotalUsd),
      selectedLiveTotalUsd: Math.round(Number(live?.summary?.afterTotalUsd || 0)),
      livePriceDeltaUsd: Math.round(Number(live?.summary?.afterTotalUsd || 0) - row.planningTotalUsd),
      selectedFlightLegCount: row.flightLegCount,
      candidateDiagnostics
    };
    return {
      tour: selectedTour,
      enrichment: {
        ...(enrichment || {}),
        tour: selectedTour,
        publicLiveFarePilot684A: live.summary,
        affordableFlightDiscovery684B: summary
      },
      summary
    };
  }

  return {
    tour: currentTour,
    enrichment: null,
    summary: {
      ...baseSummary,
      attempted: shortlist.length > 0,
      applied: false,
      reason: shortlist.length ? '684b-no-complete-live-flight-route-within-budget' : '684b-no-plausible-flight-candidates',
      candidateCount: shortlist.length,
      candidatesAttempted: candidateDiagnostics.length,
      providerRequests,
      candidateDiagnostics
    }
  };
}

function status684B(env = process.env) {
  return {
    version: VERSION_684B,
    enabled: enabled684BR1(env),
    activationMode: 'code-only-default-yyz-with-bounded-staging-origin-override',
    environmentVariablesAdded: 0,
    originAllowlist: configuredOrigins684B(env),
    candidateCap: MAX_CANDIDATE_CHECKS_684B,
    maxFlightLegs: MAX_FLIGHT_LEGS_684B,
    planningOverageRatio: PLANNING_OVERAGE_RATIO_684B,
    singleAdultOnly: true,
    preservesLowestCostGroundOption: true,
    completeLiveEvidenceRequired: true,
    overBudgetSelectedFlightRescue: true,
    strictUserCurrencyBudgetFitR3: true,
    requires684A: true,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
  };
}

module.exports = {
  VERSION_684B,
  CODE_ENABLED_684B_R3,
  DEFAULT_ORIGINS_684B,
  STAGING_ORIGIN_684B,
  STAGING_ORIGIN_ENV_684B,
  STAGING_MAX_ORIGINS_684B,
  MAX_CANDIDATE_CHECKS_684B,
  MAX_FLIGHT_LEGS_684B,
  PLANNING_OVERAGE_RATIO_684B,
  configuredOrigins684B,
  enabled684BR1,
  eligibility684B,
  buildShortlist684B,
  discoverAffordableFlightTour684B,
  status684B,
  _internal: {
    safeIata,
    normalizeWebOrigin684B,
    parsedOriginAllowlist684B,
    endpointCode,
    legHasFlight684B,
    flightLegs684B,
    hasFlight684B,
    firstFlightOrigin684B,
    tourOrigin684B,
    normalizeRole684B,
    routeKey684B,
    defaultTotalUsd684B,
    defaultBudgetCeilingUsd684B,
    terminalLiveFailure684B
  }
};