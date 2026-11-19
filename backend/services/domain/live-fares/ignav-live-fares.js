'use strict';

// GV-FLIGHT-IGNAV-002 — apply Ignav live fares to the FINAL selected tour.
//
// Runs only after the existing Duffel 684A pilot did not price the tour (for
// example, a non-YYZ origin). Per leg: each flight leg with a verified Ignav fare in the requested currency
// gets live evidence; legs without one keep their previous estimate
// (summary.partial). A fully live tour has partial=false. It never books or pays.
//
// Applied evidence is marked LIVE / DECISION_GRADE with an exact route/date
// canonical record, so the later 667A verification preserves it instead of
// downgrading it to cached Travelpayouts data.

const ignav = require('../../providers/flights/ignav/ignav');
const { normalizeParty, priceTransportLeg, applyTravellerPricingToTour } = require('../pricing/traveller-pricing');
const { currencyToUsdRate, normalizeCurrency } = require('../pricing/budget-presentation');
const { SOURCE_TYPES, normalizeFlightEvidence } = require('../pricing/price-evidence-integrity');
const { strictBudgetFit685CR1 } = require('../pricing/whole-trip-fare-reconciliation-685c-r1');

const VERSION = 'GV-FLIGHT-IGNAV-002';
const MAX_FLIGHT_LEGS = 4;

function safeIata(value) { const c = String(value || '').trim().toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : null; }
function safeDate(value) { const t = String(value || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; }
function endpointCode(node = {}) { return safeIata(node.airportCode || node.code || node.displayCode || node.iata || node.iataCode); }
function isFlightLeg(leg = {}) {
  const text = `${leg.mode || ''} ${leg.transportType || ''}`.toLowerCase();
  if (text.includes('flight')) return true;
  return (Array.isArray(leg.segments) ? leg.segments : []).some(s => `${s?.mode || ''} ${s?.transportType || ''}`.toLowerCase().includes('flight'));
}
function legDate(leg = {}) {
  const evidence = leg.providerDateEvidence || leg.cheapestOneWay || {};
  return safeDate(leg.departureDate) || safeDate(leg.dateLabel) || safeDate(leg?.automaticTourDate?.departureDate) || safeDate(evidence.departureDate);
}
function tourTotalUsd(tour = {}) {
  const direct = Number(tour.estimatedTotalUsd || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  return legs.reduce((s, l) => s + Number(l.estimatedTransportUsd || l.estimatedFlightUsd || 0), 0)
    + stops.reduce((s, st) => s + Number(st?.hotel?.estimatedStayUsd || st?.hotel?.totalStayUsd || 0), 0);
}

function enabled(env = process.env) { return ignav.configured(env); }

function status(env = process.env) {
  return { version: VERSION, enabled: enabled(env), provider: 'ignav', atomic: false, perLeg: true, maxFlightLegs: MAX_FLIGHT_LEGS, runsWhenDuffel684ANotApplied: true, bookingCapability: false };
}

function buildEvidence(task, fare, currency, partyTotalUsd, observedAt) {
  const base = {
    source: 'ignav-live-one-way',
    provider: 'ignav',
    version: VERSION,
    origin: task.origin,
    destination: task.destination,
    departureDate: task.departureDate,
    amount: fare.partyTotalAmount,
    price: fare.partyTotalAmount,
    currency,
    providerCurrency: currency,
    displayCurrency: currency,
    displayPrice: fare.partyTotalAmount,
    partyTotalAmountDisplay: fare.partyTotalAmount,
    providerPartyTotalAmount: fare.partyTotalAmount,
    fareAmountBasis: 'party-total',
    rankingPriceUsd: Math.round(partyTotalUsd),
    passengers: fare.passengers,
    ignavId: fare.ignavId,
    bookingProof: fare.bookingProof,
    carrier: fare.carrier,
    stops: fare.stops,
    durationMinutes: fare.durationMinutes,
    segments: fare.segments,
    observedAt: observedAt || new Date().toISOString(),
    exactDateMatch: true,
    isExactDate: true,
    sourceType: SOURCE_TYPES.LIVE,
    providerEvidenceClass: 'LIVE_PROVIDER',
    providerRankingGrade: 'DECISION_GRADE',
    providerBacked: true,
    productionEligible: true,
    appliedToEstimate: true,
    bookingLinksAvailable: Boolean(fare.ignavId),
    commissionOnBookingLinks: false
  };
  return {
    ...base,
    priceEvidence: normalizeFlightEvidence(base, { origin: task.origin, destination: task.destination, departureDate: task.departureDate, currency, sourceType: SOURCE_TYPES.LIVE })
  };
}

async function applyIgnavLiveFares(tour = {}, query = {}, options = {}) {
  const env = options.env || process.env;
  const baseSummary = { ...status(env), attempted: false, applied: false };
  if (!enabled(env)) return { tour, summary: { ...baseSummary, reason: 'ignav-disabled' } };

  const party = normalizeParty(query);
  if (Number(party.infants || 0) > 0) return { tour, summary: { ...baseSummary, reason: 'ignav-infants-not-supported' } };
  const currency = normalizeCurrency(query.currency || query.displayCurrency || 'CAD');
  const usdRate = currencyToUsdRate(currency);

  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const tasks = legs.map((leg, index) => ({ leg, index }))
    .filter(({ leg }) => isFlightLeg(leg))
    .map(({ leg, index }) => ({ index, origin: endpointCode(leg.from), destination: endpointCode(leg.to), departureDate: legDate(leg) }));
  if (!tasks.length) return { tour, summary: { ...baseSummary, reason: 'no-flight-legs' } };
  if (tasks.length > MAX_FLIGHT_LEGS) return { tour, summary: { ...baseSummary, reason: 'too-many-flight-legs', flightLegCount: tasks.length } };
  if (tasks.some(t => !t.origin || !t.destination || !t.departureDate)) return { tour, summary: { ...baseSummary, reason: 'flight-leg-missing-airport-or-date' } };

  const results = await Promise.all(tasks.map(task => ignav.searchOneWay({
    origin: task.origin, destination: task.destination, departureDate: task.departureDate,
    adults: party.adults, children: party.children, currency
  }, { env, fetchFn: options.fetchFn, requestGuard: options.requestGuard })));

  const failed = results.map((r, i) => ({ r, task: tasks[i] }))
    .filter(({ r }) => !r.ok || !r.cheapest || r.cheapest.currency !== currency);
  const summaryBase = { ...baseSummary, attempted: true, providerRequests: tasks.length, requiredFlightLegCount: tasks.length, currency };
  const failedLegs = failed.map(({ r, task }) => ({ origin: task.origin, destination: task.destination, departureDate: task.departureDate,
    reason: !r.ok ? r.reason : !r.cheapest ? 'no-verified-fare' : 'currency-mismatch' }));
  // Per-leg: legs with a verified fare in the requested currency get live evidence;
  // the rest keep their existing estimate and are labelled as such. With no live leg
  // at all the tour is unchanged.
  if (failed.length === tasks.length) {
    return { tour, summary: { ...summaryBase, reason: 'ignav-no-live-coverage', liveFlightLegCount: 0, failedLegs } };
  }

  const beforeTotalUsd = tourTotalUsd(tour);
  const nextLegs = legs.map(leg => ({ ...leg }));
  const failedIndexes = new Set(failed.map(({ task }) => task.index));
  const liveTasks = tasks.map((task, i) => ({ task, i })).filter(({ task }) => !failedIndexes.has(task.index));
  liveTasks.forEach(({ task, i }) => {
    const fare = results[i].cheapest;
    const partyTotalUsd = fare.partyTotalAmount * usdRate;
    const evidence = buildEvidence(task, fare, currency, partyTotalUsd, results[i].observedAt);
    nextLegs[task.index] = priceTransportLeg({
      ...nextLegs[task.index],
      mode: 'flight',
      transportType: 'flight',
      departureDate: task.departureDate,
      dateLabel: task.departureDate,
      liveFareVerified: true,
      providerFareObserved: true,
      providerVerificationRequired: false,
      providerDateEvidence: evidence,
      cheapestOneWay: evidence,
      estimateSource: 'ignav-live-fare-evidence'
    }, query, { party, amountBasis: 'party-total', partyTotalAmountUsd: partyTotalUsd });
  });

  const patched = applyTravellerPricingToTour({ ...tour, legs: nextLegs }, query);
  const afterTotalUsd = tourTotalUsd(patched);
  const strictBudgetFit = strictBudgetFit685CR1(afterTotalUsd, tour, query);
  const partial = liveTasks.length < tasks.length;
  return {
    tour: { ...patched, ignavLiveFares: { version: VERSION, applied: true, partial, liveFlightLegCount: liveTasks.length, flightLegCount: tasks.length, currency } },
    summary: {
      ...summaryBase,
      applied: true,
      partial,
      reason: partial ? 'ignav-partial-live-coverage' : null,
      liveFlightLegCount: liveTasks.length,
      ...(partial ? { failedLegs } : {}),
      beforeTotalUsd: Math.round(beforeTotalUsd),
      afterTotalUsd: Math.round(afterTotalUsd),
      priceDeltaUsd: Math.round(afterTotalUsd - beforeTotalUsd),
      overBudget: strictBudgetFit.overBudget === true,
      strictBudgetFit
    }
  };
}

module.exports = { VERSION, enabled, status, applyIgnavLiveFares };
