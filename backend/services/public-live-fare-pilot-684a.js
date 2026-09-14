'use strict';

// GV-FLIGHT-684A — request-scoped public live-fare evidence pilot.
//
// Purpose: use the already-validated Duffel LIVE exact-date search machinery on
// the FINAL selected generated-tour schedule, before Globevoy makes its final
// budget decision. This is deliberately narrower than 683H P2 ranking:
//   * exact airport/date first, with one registry-approved same-city alternate
//     only when valid exact offers all fail the unchanged 685C quality policy;
//   * one adult by default; staging GV-FLIGHT-703E may allow exactly two adults;
//   * at most three flight legs;
//   * all flight legs must resolve LIVE or none of the Duffel prices are applied;
//   * R4 quota reservation, dedupe, bounded concurrency and 429 recovery are reused;
//   * no order, payment, booking or ticketing capability is added.

const {
  VERSION_683H,
  MAX_HARD_REQUEST_CAP_683H,
  simulationAvailable683H,
  requestState683H,
  mapQuotaReservation683MR4,
  callDuffel683H,
  normalizeLiveObservation683H,
  latencyDiagnostics683M,
  loadMetroRegistry683H,
  buildMetroFallbackCandidates683H,
  applyResolvedAirports683H
} = require('./duffel-p2-staging-683h');
const { VERSION_685C, VERSION_685C_R2, selectLiveFareOffers685C } = require('./live-fare-selection-685c');
const {
  VERSION_685C_R1,
  strictBudgetFit685CR1,
  reconcileWholeTripFares685CR1
} = require('./whole-trip-fare-reconciliation-685c-r1');
const { normalizeParty, priceTransportLeg, applyTravellerPricingToTour } = require('./traveller-pricing');
const adultScope703E = require('./duffel-adult-scope-703e');
const { currencyToUsdRate, normalizeCurrency } = require('../budget-presentation');

const VERSION_684A = 'GV-FLIGHT-684A';
const VERSION_685C_R3 = 'GV-FLIGHT-685C-R3';
const FLAG_684A = 'ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A';
const MAX_FLIGHT_LEGS_684A = 3;
const DEFAULT_ORIGINS_684A = Object.freeze(['YYZ', 'JFK', 'LAX', 'DUB', 'DXB']);

function envTrue(name, env = process.env) {
  return String(env?.[name] || '').trim().toLowerCase() === 'true';
}

function safeIata(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function safeDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function endpointCode(node = {}) {
  return safeIata(node.airportCode || node.code || node.displayCode || node.iata || node.iataCode);
}

function flightLeg684A(leg = {}) {
  const text = `${String(leg.mode || '')} ${String(leg.transportType || '')}`.toLowerCase();
  if (text.includes('flight')) return true;
  return (Array.isArray(leg.segments) ? leg.segments : []).some(segment => `${String(segment?.mode || '')} ${String(segment?.transportType || '')}`.toLowerCase().includes('flight'));
}

function officialDate684A(leg = {}) {
  const evidence = leg.providerDateEvidence || leg.cheapestOneWay || {};
  return safeDate(leg.departureDate)
    || safeDate(leg.dateLabel)
    || safeDate(leg?.automaticTourDate?.departureDate)
    || safeDate(evidence.departureDate);
}

function configuredOrigins684A(env = process.env) {
  const configured = String(env?.GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A || '').trim();
  const rows = configured
    ? configured.split(',').map(safeIata).filter(Boolean)
    : DEFAULT_ORIGINS_684A.slice();
  return [...new Set(rows)];
}

function totalUsd684A(tour = {}) {
  const direct = Number(tour.estimatedTotalUsd || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  return legs.reduce((sum, leg) => sum + Number(leg.estimatedTransportUsd || leg.estimatedFlightUsd || leg.amountUsd || 0), 0)
    + stops.reduce((sum, stop) => sum + Number(stop?.hotel?.estimatedStayUsd || stop?.hotel?.totalStayUsd || 0), 0)
    + Number(tour.originAccessEstimateUsd || 0)
    + Number(tour.destinationAccessEstimateUsd || 0);
}

function existingFlightTotalUsd684A(tour = {}, tasks = buildTasks684A(tour)) {
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  return tasks.reduce((sum, task) => {
    const leg = legs[task.index] || {};
    return sum + Number(leg.estimatedTransportUsd || leg.estimatedFlightUsd || leg.amountUsd || 0);
  }, 0);
}

function nonFlightTotalUsd684A(tour = {}, tasks = buildTasks684A(tour)) {
  return Math.max(0, totalUsd684A(tour) - existingFlightTotalUsd684A(tour, tasks));
}

function budgetCeilingUsd684A(tour = {}, query = {}) {
  const direct = Number(tour.totalBudgetUsd || query.budgetUsd || 0);
  if (Number.isFinite(direct) && direct > 0) return direct + Math.max(5, direct * 0.005);
  const amount = Number(query.budget || 0);
  if (!Number.isFinite(amount) || amount <= 0) return Infinity;
  const rate = currencyToUsdRate(normalizeCurrency(query.currency || 'CAD'));
  const converted = amount * rate;
  return converted + Math.max(5, converted * 0.005);
}

function buildTasks684A(tour = {}) {
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const tasks = [];
  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index];
    if (!flightLeg684A(leg)) continue;
    tasks.push({
      index,
      origin: endpointCode(leg.from || {}),
      destination: endpointCode(leg.to || {}),
      departureDate: officialDate684A(leg),
      distanceKm: Number(leg.distanceKm || leg.routeDistanceKm || 0) || null
    });
  }
  return tasks;
}

function eligibility684A(tour = {}, query = {}, env = process.env) {
  if (!envTrue(FLAG_684A, env)) return { eligible: false, reason: '684a-pilot-flag-off' };
  // Preserve the existing 683K production-canary path exactly. Canary requests
  // already run the full guarded P2 flow; running 684A afterwards would duplicate
  // Duffel calls and distort quota/latency diagnostics.
  if (String(query?.__gvProviderCanary683K || '') === 'authorized-production-canary') {
    return { eligible: false, reason: '684a-skipped-existing-683k-production-canary' };
  }
  if (!simulationAvailable683H(env)) return { eligible: false, reason: '684a-live-provider-dependencies-not-ready' };

  const party = normalizeParty(query);
  const adultScope = adultScope703E.adultPartyEligibility703E(party, env);
  if (!adultScope.eligible) {
    return {
      eligible: false,
      reason: adultScope.maxAdults === 1 ? '684a-single-adult-pilot-only' : '684a-one-or-two-adults-staging-pilot-only',
      party,
      maxAdults: adultScope.maxAdults
    };
  }

  const tasks = buildTasks684A(tour);
  if (!tasks.length) return { eligible: false, reason: '684a-no-flight-legs', party, tasks };
  if (tasks.length > MAX_FLIGHT_LEGS_684A) return { eligible: false, reason: '684a-flight-leg-cap-exceeded', party, tasks };
  if (tasks.some(task => !task.origin || !task.destination || !task.departureDate)) {
    return { eligible: false, reason: '684a-missing-exact-route-or-date', party, tasks };
  }

  const firstOrigin = tasks[0].origin;
  const allowedOrigins = configuredOrigins684A(env);
  if (!allowedOrigins.includes(firstOrigin)) {
    return { eligible: false, reason: '684a-origin-outside-pilot-allowlist', party, tasks, firstOrigin, allowedOrigins };
  }

  return { eligible: true, reason: null, party, tasks, firstOrigin, allowedOrigins, maxAdults: adultScope.maxAdults };
}

function completeAppliedEvidence684A(tour = {}) {
  const tasks = buildTasks684A(tour);
  if (!tasks.length) return { complete: false, tasks, liveCount: 0, selectionCount: 0, currencySafetyCount: 0, reconciliationCount: 0, metroCount: 0 };
  let liveCount = 0;
  let selectionCount = 0;
  let currencySafetyCount = 0;
  let reconciliationCount = 0;
  let metroCount = 0;
  for (const task of tasks) {
    const leg = Array.isArray(tour.legs) ? tour.legs[task.index] : null;
    const evidence = leg?.providerDateEvidence || leg?.cheapestOneWay || {};
    const marker = evidence?.publicLiveFareEvidence684A || leg?.publicLiveFarePilot684A || {};
    if (marker?.version === VERSION_684A && evidence?.sourceType === 'LIVE' && evidence?.productionEligible === true) liveCount += 1;
    if (evidence?.fareSelection685C?.version === VERSION_685C || marker?.fareSelectionVersion === VERSION_685C) selectionCount += 1;
    if (evidence?.fareSelection685C?.providerCurrencySafetyVersion === VERSION_685C_R2 || marker?.providerCurrencySafetyVersion === VERSION_685C_R2) currencySafetyCount += 1;
    if (evidence?.wholeTripFareReconciliation685CR1?.version === VERSION_685C_R1 || marker?.wholeTripFareReconciliationVersion === VERSION_685C_R1) reconciliationCount += 1;
    if (String(evidence?.airportMode683H || '').startsWith('METRO_')) metroCount += 1;
  }
  return { complete: liveCount === tasks.length, tasks, liveCount, selectionCount, currencySafetyCount, reconciliationCount, metroCount };
}

function qualityTriggeredMetroFallbackEligible685CR3(row = {}) {
  const diagnostics = row?.selection?.diagnostics || {};
  return row?.raw?.supported === true
    && Array.isArray(row.raw.observations)
    && row.raw.observations.length > 0
    && row?.selection?.supported !== true
    && row?.selection?.reason === '685c-no-quality-eligible-live-offers'
    && Number(diagnostics.validOfferCount || 0) > 0
    && Number(diagnostics.qualityEligibleOfferCount || 0) === 0;
}

function metroFallbackEvidence685CR3(task = {}, candidate = {}, registry = {}) {
  return {
    version: VERSION_683H,
    qualityTriggeredFallbackVersion: VERSION_685C_R3,
    triggerReason: '685c-no-quality-eligible-live-offers',
    registryVersion: registry?.version || null,
    registrySource: registry?.source || null,
    requestedOrigin: task.origin,
    requestedDestination: task.destination,
    resolvedOrigin: candidate.origin,
    resolvedDestination: candidate.destination,
    airportMode683H: candidate.airportMode,
    changedAirports: Number(candidate.changedAirports || 0),
    airportShiftKmTotal: Number(candidate.airportShiftKmTotal || 0),
    originAirportShiftKm: Number(candidate.originAirportShiftKm || 0),
    destinationAirportShiftKm: Number(candidate.destinationAirportShiftKm || 0),
    originMetroCode: candidate.originMetroCode || null,
    destinationMetroCode: candidate.destinationMetroCode || null,
    sameCityRegistryVerified: true,
    groundAccessEstimateAdjusted: false,
    caveat: 'same-city airport substitution; ground-access estimate is not repriced in the Duffel P2 evaluation'
  };
}

function decorateMetroOffer685CR3(offer, evidence = {}) {
  if (!offer || typeof offer !== 'object') return offer;
  return {
    ...offer,
    origin: evidence.resolvedOrigin || offer.origin,
    destination: evidence.resolvedDestination || offer.destination,
    requestedOrigin: evidence.requestedOrigin || null,
    requestedDestination: evidence.requestedDestination || null,
    resolvedOrigin: evidence.resolvedOrigin || offer.origin || null,
    resolvedDestination: evidence.resolvedDestination || offer.destination || null,
    airportMode683H: evidence.airportMode683H || null,
    metroAirportFallback683H: evidence
  };
}

function decorateMetroSelection685CR3(selection = {}, evidence = {}) {
  return {
    ...selection,
    selectedOffer: decorateMetroOffer685CR3(selection.selectedOffer, evidence),
    cheapestAcceptableOffer: decorateMetroOffer685CR3(selection.cheapestAcceptableOffer, evidence),
    bestBalanceOffer: decorateMetroOffer685CR3(selection.bestBalanceOffer, evidence)
  };
}

function promotedEvidence684A(observation = {}, task = {}) {
  const priceEvidence = observation.priceEvidence && typeof observation.priceEvidence === 'object'
    ? { ...observation.priceEvidence, productionEligible: true }
    : observation.priceEvidence;
  return {
    ...observation,
    origin: observation.resolvedOrigin || observation.origin || task.origin,
    destination: observation.resolvedDestination || observation.destination || task.destination,
    requestedOrigin: task.origin,
    requestedDestination: task.destination,
    resolvedOrigin: observation.resolvedOrigin || observation.origin || task.origin,
    resolvedDestination: observation.resolvedDestination || observation.destination || task.destination,
    departureDate: task.departureDate,
    airportMode683H: observation.airportMode683H || 'EXACT',
    metroAirportFallback683H: observation.metroAirportFallback683H || null,
    providerBacked: true,
    appliedToEstimate: true,
    productionEligible: true,
    sourceType: 'LIVE',
    providerEvidenceClass: 'LIVE_PROVIDER',
    providerRankingGrade: 'DECISION_GRADE',
    priceEvidence,
    rankingFx683H: observation.rankingFx683H ? {
      ...observation.rankingFx683H,
      stagingOnly: false,
      productionCanary683K: false,
      publicLiveFarePilot684A: true
    } : null,
    publicLiveFareEvidence684A: {
      version: VERSION_684A,
      fareSelectionVersion: VERSION_685C,
      providerCurrencySafetyVersion: VERSION_685C_R2,
      qualityTriggeredMetroFallbackVersion: VERSION_685C_R3,
      wholeTripFareReconciliationVersion: VERSION_685C_R1,
      exactAirportOnly: !String(observation.airportMode683H || '').startsWith('METRO_'),
      exactAirportFirst: true,
      sameCityMetroFallback: true,
      exactDate: true,
      finalSelectedScheduleOnly: true,
      allFlightLegsAtomic: true,
      providerSearchOnly: true,
      providerFareAmountBasis: 'party-total',
      providerPassengerCount: Number(observation.providerPassengerCount || observation.passengers || 1),
      orderCapability: false,
      paymentCapability: false,
      bookingCapability: false,
      ticketingCapability: false
    }
  };
}

async function applyPublicLiveFarePilot684A(tour = {}, query = {}, options = {}) {
  const env = options.env || process.env;
  const beforeTotalUsd = totalUsd684A(tour);
  const budgetCeilingUsd = budgetCeilingUsd684A(tour, query);
  const reused = completeAppliedEvidence684A(tour);
  if (reused.complete) {
    const reusedStrictBudgetFit = strictBudgetFit685CR1(beforeTotalUsd, tour, query);
    return {
      tour,
      summary: {
        enabled: envTrue(FLAG_684A, env),
        version: VERSION_684A,
        providerEngineVersion: VERSION_683H,
        fareSelectionVersion: reused.selectionCount === reused.tasks.length ? VERSION_685C : null,
        providerCurrencySafetyVersion: reused.currencySafetyCount === reused.tasks.length ? VERSION_685C_R2 : null,
        qualityTriggeredMetroFallbackVersion: VERSION_685C_R3,
        legacyLiveSelectionReused: reused.selectionCount !== reused.tasks.length,
        wholeTripFareReconciliationVersion: reused.reconciliationCount === reused.tasks.length ? VERSION_685C_R1 : null,
        legacyIndependentLegSelectionReused: reused.reconciliationCount !== reused.tasks.length,
        attempted: false,
        applied: true,
        reused: true,
        reason: '684a-complete-live-evidence-already-applied',
        beforeTotalUsd: Math.round(beforeTotalUsd),
        afterTotalUsd: Math.round(beforeTotalUsd),
        priceDeltaUsd: 0,
        budgetCeilingUsd: Number.isFinite(budgetCeilingUsd) ? Math.round(budgetCeilingUsd) : null,
        overBudget: reusedStrictBudgetFit.overBudget,
        strictBudgetFit: reusedStrictBudgetFit,
        exactAirportOnly: reused.metroCount === 0,
        exactAirportFirst: true,
        sameCityMetroFallback: true,
        allFlightLegsAtomic: true,
        maxFlightLegs: MAX_FLIGHT_LEGS_684A,
        originAllowlist: configuredOrigins684A(env),
        singleAdultOnly: adultScope703E.configuredMaxAdults703E(env) === 1,
        maxAdults: adultScope703E.configuredMaxAdults703E(env),
        twoAdultStagingPilot: adultScope703E.configuredMaxAdults703E(env) === 2,
        childrenAllowed: false,
        infantsAllowed: false,
        providerFareAmountBasis: 'party-total',
        requiredFlightLegCount: reused.tasks.length,
        liveFlightLegCount: reused.liveCount,
        allFlightLegsLive: true,
        providerRequests: 0,
        exactRequests: 0,
        metroRequests: 0,
        fxFailures: 0,
        orderCapability: false,
        paymentCapability: false,
        bookingCapability: false,
        ticketingCapability: false
      }
    };
  }
  const eligibility = eligibility684A(tour, query, env);
  const baseSummary = {
    enabled: envTrue(FLAG_684A, env),
    version: VERSION_684A,
    providerEngineVersion: VERSION_683H,
    fareSelectionVersion: VERSION_685C,
    providerCurrencySafetyVersion: VERSION_685C_R2,
    qualityTriggeredMetroFallbackVersion: VERSION_685C_R3,
    wholeTripFareReconciliationVersion: VERSION_685C_R1,
    attempted: false,
    applied: false,
    reason: eligibility.reason || null,
    beforeTotalUsd: Math.round(beforeTotalUsd),
    afterTotalUsd: Math.round(beforeTotalUsd),
    priceDeltaUsd: 0,
    budgetCeilingUsd: Number.isFinite(budgetCeilingUsd) ? Math.round(budgetCeilingUsd) : null,
    overBudget: null,
    exactAirportOnly: true,
    allFlightLegsAtomic: true,
    maxFlightLegs: MAX_FLIGHT_LEGS_684A,
    originAllowlist: eligibility.allowedOrigins || configuredOrigins684A(env),
    singleAdultOnly: adultScope703E.configuredMaxAdults703E(env) === 1,
    maxAdults: adultScope703E.configuredMaxAdults703E(env),
    twoAdultStagingPilot: adultScope703E.configuredMaxAdults703E(env) === 2,
    childrenAllowed: false,
    infantsAllowed: false,
    providerFareAmountBasis: 'party-total',
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
  };
  if (!eligibility.eligible) return { tour, summary: baseSummary };

  const displayCurrency = String(query.currency || 'USD').trim().toUpperCase() || 'USD';
  const tasks = eligibility.tasks;
  const budgetPressure = Number.isFinite(budgetCeilingUsd) && budgetCeilingUsd > 0
    ? Math.max(0, beforeTotalUsd / budgetCeilingUsd)
    : 0;
  const state = requestState683H(env, {
    mode: '685c-r3-final-selected-schedule-quality-triggered-metro',
    plannedRequestCap: Math.min(MAX_HARD_REQUEST_CAP_683H, Math.max(4, tasks.length * 2)),
    exactRequestBudget: tasks.length,
    metroFallbackBudget: tasks.length,
    requiredRequestBudget: tasks.length * 2,
    boundedByHardCap: tasks.length * 2 > MAX_HARD_REQUEST_CAP_683H
  });

  const rows = await mapQuotaReservation683MR4(
    tasks,
    state,
    async (task) => {
      if (state.abortReason || state.proactiveQuotaFailClosed683MR3 || state.requests >= state.cap) {
        return { task, supported: false, reason: state.proactiveQuotaFailClosedReason683MR3 || state.abortReason || '684a-request-cap-reached' };
      }
      state.exactRequests += 1;
      const raw = await callDuffel683H({
        origin: task.origin,
        destination: task.destination,
        departureDate: task.departureDate,
        currency: displayCurrency,
        passengers: eligibility.party.adults
      }, state, {
        ...options,
        env,
        requestKind683M: 'exact'
      });
      if (!raw?.supported) return { task, supported: false, reason: raw?.reason || '684a-live-exact-unavailable', raw };
      const selection = selectLiveFareOffers685C(raw, {
        ...task,
        currency: displayCurrency,
        passengers: eligibility.party.travellers,
        budgetPressure
      }, query);
      if (!selection?.supported || !selection.selectedOffer) {
        return { task, supported: false, reason: selection?.reason || '684a-no-live-offer-observation', raw, selection };
      }
      return { task, supported: true, raw, selection };
    },
    () => Boolean(state.abortReason) || state.proactiveQuotaFailClosed683MR3 === true || state.requests >= state.cap,
    options
  );

  const exactRows = tasks.map((task, index) => {
    const row = rows[index] || { task, supported: false, reason: state.proactiveQuotaFailClosedReason683MR3 || state.abortReason || '684a-provider-schedule-incomplete' };
    return {
      ...row,
      exactSelection: row.selection || null,
      metroFallbackTriggered: qualityTriggeredMetroFallbackEligible685CR3(row),
      metroFallbackAttempted: false,
      metroFallbackUsed: false,
      metroFallbackCandidateAvailable: false,
      requestedOrigin: task.origin,
      requestedDestination: task.destination,
      resolvedOrigin: task.origin,
      resolvedDestination: task.destination,
      exactOfferCount: row?.selection?.diagnostics?.offerCount ?? (Array.isArray(row?.raw?.observations) ? row.raw.observations.length : 0),
      exactQualityEligibleOfferCount: row?.selection?.diagnostics?.qualityEligibleOfferCount ?? 0,
      metroOfferCount: 0,
      metroQualityEligibleOfferCount: 0,
      metroProviderRequests: 0
    };
  });

  const metroRegistry = options.metroRegistry683H || loadMetroRegistry683H();
  const metroPlans = [];
  for (let index = 0; index < exactRows.length; index += 1) {
    const row = exactRows[index];
    if (!row.metroFallbackTriggered) continue;
    const candidate = buildMetroFallbackCandidates683H(row.task, metroRegistry, 1)[0] || null;
    row.metroFallbackCandidateAvailable = Boolean(candidate);
    if (candidate) metroPlans.push({ rowIndex: index, row, candidate });
  }

  const metroRows = await mapQuotaReservation683MR4(
    metroPlans,
    state,
    async (plan) => {
      const { row, candidate } = plan;
      if (state.abortReason || state.proactiveQuotaFailClosed683MR3 || state.requests >= state.cap) {
        return { ...row, reason: state.proactiveQuotaFailClosedReason683MR3 || state.abortReason || '685c-r3-request-cap-reached' };
      }
      state.metroRequests += 1;
      const evidence = metroFallbackEvidence685CR3(row.task, candidate, metroRegistry);
      const raw = await callDuffel683H({
        origin: candidate.origin,
        destination: candidate.destination,
        departureDate: candidate.departureDate,
        currency: displayCurrency,
        passengers: eligibility.party.adults
      }, state, {
        ...options,
        env,
        requestKind683M: 'metro'
      });
      if (!raw?.supported) {
        return {
          ...row,
          reason: raw?.reason || '685c-r3-live-metro-unavailable',
          metroRaw: raw,
          metroFallbackAttempted: true,
          metroProviderRequests: 1,
          resolvedOrigin: candidate.origin,
          resolvedDestination: candidate.destination
        };
      }
      const selection = selectLiveFareOffers685C(raw, {
        ...row.task,
        origin: candidate.origin,
        destination: candidate.destination,
        currency: displayCurrency,
        passengers: eligibility.party.travellers,
        budgetPressure
      }, query);
      const decorated = selection?.supported && selection.selectedOffer
        ? decorateMetroSelection685CR3(selection, evidence)
        : selection;
      return {
        ...row,
        supported: Boolean(decorated?.supported && decorated.selectedOffer),
        reason: decorated?.supported ? null : (decorated?.reason || '685c-r3-no-live-metro-offer-observation'),
        raw,
        selection: decorated,
        metroRaw: raw,
        metroSelection: decorated,
        metroFallbackAttempted: true,
        metroFallbackUsed: Boolean(decorated?.supported && decorated.selectedOffer),
        resolvedOrigin: candidate.origin,
        resolvedDestination: candidate.destination,
        metroOfferCount: decorated?.diagnostics?.offerCount ?? raw.observations.length,
        metroQualityEligibleOfferCount: decorated?.diagnostics?.qualityEligibleOfferCount ?? 0,
        metroProviderRequests: 1,
        metroAirportFallback683H: evidence
      };
    },
    () => Boolean(state.abortReason) || state.proactiveQuotaFailClosed683MR3 === true || state.requests >= state.cap,
    options
  );

  const metroByIndex = new Map();
  metroPlans.forEach((plan, index) => {
    if (metroRows[index]) metroByIndex.set(plan.rowIndex, metroRows[index]);
  });
  const searchRows = exactRows.map((row, index) => metroByIndex.get(index) || row);
  const searchComplete = searchRows.length === tasks.length && searchRows.every(row => row?.supported === true && row?.selection);
  const normalizedAlternativeRows = [];
  if (searchComplete) {
    // R1 normalizes only the two already-returned 685C alternatives per leg,
    // sequentially and with same-offer dedupe. This is bounded to six
    // normalizations for the three-leg pilot and makes no additional Duffel call.
    for (const row of searchRows) {
      const requestedRole = row.selection.requestedRole;
      const candidates = [{ key: 'cheapest', offer: row.selection.cheapestAcceptableOffer }];
      if (requestedRole === 'best-balance') candidates.push({ key: 'bestBalance', offer: row.selection.bestBalanceOffer });
      const alternatives = {};
      const normalizedByOffer = new Map();
      const normalizationFailures = [];
      for (const candidate of candidates) {
        const offer = candidate.offer;
        if (!offer) continue;
        const offerKey = `${String(offer.providerReference || '')}|${Number(offer.totalPrice || offer.price || 0)}|${String(offer.currency || '')}`;
        let normalized = normalizedByOffer.get(offerKey);
        if (!normalized) {
          const fxStarted = Date.now();
          normalized = await normalizeLiveObservation683H(offer, displayCurrency, { ...options, env });
          state.fxLatencyMs683M += Math.max(0, Date.now() - fxStarted);
          normalizedByOffer.set(offerKey, normalized);
        }
        if (!normalized?.supported) {
          state.fxFailures += 1;
          normalizationFailures.push({ role: candidate.key, reason: normalized?.reason || '684a-live-normalization-failed' });
          continue;
        }
        alternatives[candidate.key] = {
          score: Number(offer?.fareSelection685C?.selectedScore),
          observation: {
            ...normalized.observation,
            selectedFareRole: offer.selectedFareRole,
            fareSelection685C: offer.fareSelection685C,
            requestedOrigin: offer.requestedOrigin || row.task.origin,
            requestedDestination: offer.requestedDestination || row.task.destination,
            resolvedOrigin: offer.resolvedOrigin || offer.origin || row.task.origin,
            resolvedDestination: offer.resolvedDestination || offer.destination || row.task.destination,
            airportMode683H: offer.airportMode683H || 'EXACT',
            metroAirportFallback683H: offer.metroAirportFallback683H || null
          }
        };
      }
      normalizedAlternativeRows.push({
        ...row,
        supported: Boolean(alternatives.cheapest),
        reason: alternatives.cheapest ? null : '684a-cheapest-live-normalization-failed',
        alternatives,
        normalizationFailures
      });
    }
  }

  const alternativesComplete = searchComplete
    && normalizedAlternativeRows.length === tasks.length
    && normalizedAlternativeRows.every(row => row.supported && row.alternatives?.cheapest?.observation);
  const requestedRole = searchRows[0]?.selection?.requestedRole || 'cheapest';
  const reconciliation = alternativesComplete
    ? reconcileWholeTripFares685CR1(normalizedAlternativeRows, {
        requestedRole,
        nonFlightTotalUsd: nonFlightTotalUsd684A(tour, tasks),
        tour,
        query
      })
    : { supported: false, reason: '685c-r1-incomplete-normalized-alternative-coverage', version: VERSION_685C_R1 };
  const reconciliationComplete = reconciliation?.supported === true
    && Array.isArray(reconciliation.selectedChoices)
    && reconciliation.selectedChoices.length === tasks.length;
  const normalizedRows = reconciliationComplete
    ? normalizedAlternativeRows.map((row, index) => {
        const choice = reconciliation.selectedChoices[index];
        const selectedObservation = {
          ...choice.observation,
          selectedFareRole: choice.role,
          wholeTripFareReconciliation685CR1: {
            ...reconciliation.metadata,
            selectedLegIndex: index,
            selectedLegRole: choice.role,
            selectedLegProviderReference: choice.observation.providerReference
          }
        };
        return { ...row, supported: true, observation: promotedEvidence684A(selectedObservation, row.task), selectedChoice: choice };
      })
    : (normalizedAlternativeRows.length ? normalizedAlternativeRows : searchRows);
  const complete = reconciliationComplete && normalizedRows.every(row => row?.supported === true && row?.observation);
  const diagnostics = normalizedRows.map(row => ({
    index: row?.task?.index ?? null,
    origin: row?.task?.origin || null,
    destination: row?.task?.destination || null,
    departureDate: row?.task?.departureDate || null,
    supported: row?.supported === true,
    reason: row?.reason || null,
    metroFallbackTriggered: row?.metroFallbackTriggered === true,
    metroFallbackCandidateAvailable: row?.metroFallbackCandidateAvailable === true,
    metroFallbackAttempted: row?.metroFallbackAttempted === true,
    metroFallbackUsed: row?.metroFallbackUsed === true,
    requestedOrigin: row?.requestedOrigin || row?.task?.origin || null,
    requestedDestination: row?.requestedDestination || row?.task?.destination || null,
    resolvedOrigin: row?.observation?.resolvedOrigin || row?.resolvedOrigin || row?.task?.origin || null,
    resolvedDestination: row?.observation?.resolvedDestination || row?.resolvedDestination || row?.task?.destination || null,
    exactOfferCount: row?.exactOfferCount ?? 0,
    exactQualityEligibleOfferCount: row?.exactQualityEligibleOfferCount ?? 0,
    metroOfferCount: row?.metroOfferCount ?? 0,
    metroQualityEligibleOfferCount: row?.metroQualityEligibleOfferCount ?? 0,
    metroProviderRequests: row?.metroProviderRequests ?? 0,
    providerAmount: row?.observation?.providerAmount ?? null,
    providerCurrency: row?.observation?.providerCurrency || null,
    fareAmountBasis: row?.observation?.fareAmountBasis || null,
    providerPassengerCount: Number(row?.observation?.providerPassengerCount || row?.observation?.passengers || 0) || null,
    displayPrice: row?.observation?.displayPrice ?? null,
    displayCurrency: row?.observation?.displayCurrency || null,
    rankingPriceUsd: row?.observation?.rankingPriceUsd ?? null,
    providerReference: row?.observation?.providerReference || null,
    observedAt: row?.observation?.observedAt || null,
    expiresAt: row?.observation?.expiresAt || null,
    fareSelectionVersion: row?.selection?.version || null,
    providerCurrencySafetyVersion: row?.selection?.providerCurrencySafetyVersion || null,
    selectionReason: row?.selection?.reason || null,
    requestedFareRole: row?.selection?.requestedRole || null,
    selectedFareRole: row?.observation?.selectedFareRole || null,
    wholeTripFareReconciliationVersion: reconciliation?.version || null,
    normalizationFailures: row?.normalizationFailures || [],
    offerCount: row?.selection?.diagnostics?.offerCount ?? null,
    validOfferCount: row?.selection?.diagnostics?.validOfferCount ?? null,
    qualityEligibleOfferCount: row?.selection?.diagnostics?.qualityEligibleOfferCount ?? null,
    rejectedOfferCount: row?.selection?.diagnostics?.rejectedOfferCount ?? row?.selection?.diagnostics?.rejections?.length ?? null,
    rejectionReasonCounts: row?.selection?.diagnostics?.rejectionReasonCounts || {},
    rankingProviderCurrency: row?.selection?.diagnostics?.rankingProviderCurrency || null,
    requestedDisplayCurrency: row?.selection?.diagnostics?.requestedDisplayCurrency || null,
    providerDisplayCurrencyMismatch: row?.selection?.diagnostics?.providerDisplayCurrencyMismatch === true,
    cheapestAcceptableProviderReference: row?.selection?.cheapestAcceptableOffer?.providerReference || null,
    cheapestAcceptableAmount: row?.selection?.cheapestAcceptableOffer?.totalPrice ?? null,
    bestBalanceProviderReference: row?.selection?.bestBalanceOffer?.providerReference || null,
    bestBalanceAmount: row?.selection?.bestBalanceOffer?.totalPrice ?? null
  }));

  const latency = latencyDiagnostics683M(state);
  if (!complete) {
    return {
      tour,
      summary: {
        ...baseSummary,
        attempted: true,
        applied: false,
        reason: state.proactiveQuotaFailClosed683MR3
          ? '684a-provider-quota-fail-closed'
          : (state.abortReason
              ? `684a-provider-aborted:${state.abortReason}`
              : (searchComplete
                  ? (reconciliation?.reason || '684a-incomplete-live-flight-coverage-fail-closed')
                  : '684a-incomplete-live-flight-coverage-fail-closed')),
        requiredFlightLegCount: tasks.length,
        liveFlightLegCount: normalizedRows.filter(row => row?.supported === true).length,
        providerRequests: Number(state.requests || 0),
        exactRequests: Number(state.exactRequests || 0),
        metroRequests: Number(state.metroRequests || 0),
        exactAirportOnly: !normalizedRows.some(row => row?.metroFallbackUsed),
        exactAirportFirst: true,
        sameCityMetroFallback: true,
        fxFailures: Number(state.fxFailures || 0),
        wholeTripFareReconciliation: reconciliation,
        diagnostics,
        latency
      }
    };
  }

  const party = eligibility.party;
  const legs = (Array.isArray(tour.legs) ? tour.legs : []).map(leg => ({ ...leg }));
  for (const row of normalizedRows) {
    const task = row.task;
    const observation = row.observation;
    const original = legs[task.index] || {};
    const resolvedOriginal = applyResolvedAirports683H(original, observation);
    legs[task.index] = priceTransportLeg({
      ...resolvedOriginal,
      mode: 'flight',
      transportType: 'flight',
      departureDate: task.departureDate,
      dateLabel: task.departureDate,
      liveFareVerified: true,
      providerFareObserved: true,
      providerVerificationRequired: false,
      providerDateEvidence: observation,
      cheapestOneWay: observation,
      estimateSource: 'duffel-public-live-fare-evidence-pilot-684a',
      publicLiveFarePilot684A: observation.publicLiveFareEvidence684A
    }, query, {
      party,
      amountBasis: 'party-total',
      partyTotalAmountUsd: Number(observation.rankingPriceUsd)
    });
  }

  const patched = applyTravellerPricingToTour({ ...tour, legs }, query);
  const afterTotalUsd = totalUsd684A(patched);
  const strictBudgetFit = strictBudgetFit685CR1(afterTotalUsd, tour, query);

  // GV-PERF-R1 staging diagnostic only: keep the just-priced route on the request
  // object through a Symbol so it is invisible to normal JSON serialization. The
  // bounded 684B rescue can snapshot it before pricing a replacement candidate.
  const preRescueDiagnosticSymbol684A = Symbol.for('globevoy.pre-rescue-live-fare-diagnostic-684a');
  query[preRescueDiagnosticSymbol684A] = {
    version: 'GV-PERF-R1',
    route: (Array.isArray(tour.stops) ? tour.stops : [])
      .map(stop => String(stop?.cityId || stop?.airportCode || stop?.code || stop?.city || '').trim().toLowerCase())
      .filter(Boolean)
      .join('>') || null,
    beforeLiveUsd: Math.round(beforeTotalUsd),
    afterLiveUsd: Math.round(afterTotalUsd),
    livePriceDeltaUsd: Math.round(afterTotalUsd - beforeTotalUsd),
    overBudget: strictBudgetFit.overBudget === true,
    providerRequests: Number(state.requests || 0)
  };

  return {
    tour: {
      ...patched,
      publicLiveFarePilot684A: {
        version: VERSION_684A,
        fareSelectionVersion: VERSION_685C,
        providerCurrencySafetyVersion: VERSION_685C_R2,
        wholeTripFareReconciliationVersion: VERSION_685C_R1,
        qualityTriggeredMetroFallbackVersion: VERSION_685C_R3,
        applied: true,
        liveFlightLegCount: tasks.length,
        requiredFlightLegCount: tasks.length,
        allFlightLegsLive: true,
        exactAirportOnly: normalizedRows.every(row => !row.metroFallbackUsed),
        exactAirportFirst: true,
        sameCityMetroFallback: true,
        metroFallbackUsed: normalizedRows.some(row => row.metroFallbackUsed),
        allFlightLegsAtomic: true,
        wholeTripFareReconciliation685CR1: reconciliation.metadata
      }
    },
    summary: {
      ...baseSummary,
      attempted: true,
      applied: true,
      reason: null,
      requiredFlightLegCount: tasks.length,
      liveFlightLegCount: tasks.length,
      allFlightLegsLive: true,
      providerRequests: Number(state.requests || 0),
      exactRequests: Number(state.exactRequests || 0),
      metroRequests: Number(state.metroRequests || 0),
      exactAirportOnly: normalizedRows.every(row => !row.metroFallbackUsed),
      exactAirportFirst: true,
      sameCityMetroFallback: true,
      fxFailures: Number(state.fxFailures || 0),
      wholeTripFareReconciliation: reconciliation.metadata,
      beforeTotalUsd: Math.round(beforeTotalUsd),
      afterTotalUsd: Math.round(afterTotalUsd),
      priceDeltaUsd: Math.round(afterTotalUsd - beforeTotalUsd),
      budgetCeilingUsd: Number.isFinite(budgetCeilingUsd) ? Math.round(budgetCeilingUsd) : null,
      overBudget: strictBudgetFit.overBudget,
      strictBudgetFit,
      diagnostics,
      latency
    }
  };
}

function status684A(env = process.env) {
  return {
    version: VERSION_684A,
    fareSelectionVersion: VERSION_685C,
    providerCurrencySafetyVersion: VERSION_685C_R2,
    qualityTriggeredMetroFallbackVersion: VERSION_685C_R3,
    wholeTripFareReconciliationVersion: VERSION_685C_R1,
    enabled: envTrue(FLAG_684A, env),
    flag: FLAG_684A,
    providerDependenciesReady: simulationAvailable683H(env),
    originAllowlist: configuredOrigins684A(env),
    maxFlightLegs: MAX_FLIGHT_LEGS_684A,
    singleAdultOnly: adultScope703E.configuredMaxAdults703E(env) === 1,
    maxAdults: adultScope703E.configuredMaxAdults703E(env),
    twoAdultStagingPilot: adultScope703E.configuredMaxAdults703E(env) === 2,
    childrenAllowed: false,
    infantsAllowed: false,
    providerFareAmountBasis: 'party-total',
    exactAirportOnly: false,
    exactAirportFirst: true,
    sameCityMetroFallback: true,
    maxMetroAlternatesPerFailedQualityLeg: 1,
    allFlightLegsAtomic: true,
    finalSelectedScheduleOnly: true,
    deterministicLiveOfferSelection: true,
    wholeTripBudgetAwareSelection: true,
    maxFareCombinations: 8,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
  };
}

module.exports = {
  VERSION_684A,
  VERSION_685C,
  VERSION_685C_R2,
  VERSION_685C_R3,
  VERSION_685C_R1,
  FLAG_684A,
  MAX_FLIGHT_LEGS_684A,
  DEFAULT_ORIGINS_684A,
  configuredOrigins684A,
  configuredMaxAdults684A: adultScope703E.configuredMaxAdults703E,
  eligibility684A,
  applyPublicLiveFarePilot684A,
  status684A,
  _internal: { safeIata, safeDate, endpointCode, flightLeg684A, officialDate684A, buildTasks684A, completeAppliedEvidence684A, qualityTriggeredMetroFallbackEligible685CR3, metroFallbackEvidence685CR3, decorateMetroOffer685CR3, decorateMetroSelection685CR3, promotedEvidence684A, totalUsd684A, existingFlightTotalUsd684A, nonFlightTotalUsd684A, budgetCeilingUsd684A }
};
