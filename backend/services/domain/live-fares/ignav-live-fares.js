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
const { searchOneWayCached } = require('./ignav-fare-cache');
const { normalizeParty, priceTransportLeg, applyTravellerPricingToTour } = require('../pricing/traveller-pricing');
const { currencyToUsdRate, normalizeCurrency } = require('../pricing/budget-presentation');
const { SOURCE_TYPES, normalizeFlightEvidence } = require('../pricing/price-evidence-integrity');
const { strictBudgetFit685CR1 } = require('../pricing/whole-trip-fare-reconciliation-685c-r1');

const VERSION = 'GV-FLIGHT-IGNAV-002';
const MAX_FLIGHT_LEGS = 4;

function safeIata(value) { const c = String(value || '').trim().toUpperCase(); return /^[A-Z]{3}$/.test(c) ? c : null; }
function safeDate(value) { const t = String(value || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; }
// City (metro) codes such as LON, PAR or NYC return no Ignav fares; search the
// city's main airport from the registry instead (LON -> LHR, NYC -> JFK).
let metroAirports = null;
function metroAirport(code) {
  if (!metroAirports) {
    metroAirports = new Map();
    try {
      for (const r of require('../../../data/unified-city-registry-1000.json').records || []) {
        const o = r.origin || {}, metro = safeIata(o.providerLocationCode), main = safeIata(o.preferredAirportCode);
        if (metro && main && metro !== main && !(o.airportCodes || []).includes(metro)) metroAirports.set(metro, main);
      }
    } catch (_) { /* registry unavailable: keep codes as given */ }
  }
  return metroAirports.get(code) || code;
}
function endpointCode(node = {}) {
  const code = safeIata(node.airportCode || node.code || node.displayCode || node.iata || node.iataCode);
  return code ? metroAirport(code) : null;
}
function km(a = {}, b = {}) {
  const [la1, lo1, la2, lo2] = [a.latitude ?? a.lat, a.longitude ?? a.lng ?? a.lon, b.latitude ?? b.lat, b.longitude ?? b.lng ?? b.lon].map(Number);
  if (![la1, lo1, la2, lo2].every(Number.isFinite)) return null;
  const r = Math.PI / 180, h = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
function isFlightLeg(leg = {}) {
  const text = `${leg.mode || ''} ${leg.transportType || ''}`.toLowerCase();
  if (text.includes('flight')) return true;
  const segments = Array.isArray(leg.segments) ? leg.segments : [];
  if (segments.some(s => `${s?.mode || ''} ${s?.transportType || ''}`.toLowerCase().includes('flight'))) return true;
  // Some generated legs carry no mode at all. Ground legs always name theirs (train,
  // bus, drive), so an untyped leg between two airports at least 300 km apart is a flight.
  if (text.trim() || segments.some(s => `${s?.mode || ''}${s?.transportType || ''}`.trim())) return false;
  if (!endpointCode(leg.from) || !endpointCode(leg.to)) return false;
  const distance = Number(leg.distanceKm) || km(leg.from, leg.to);
  return distance == null || distance >= 300;
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
  const fourCityLoop = env.FARE_MAP_FOUR_CITY_LIVE === 'on' && tour.selectionSource === 'fare-map-beam' &&
    tour.stops?.length === 4 && legs.length === 5 && tasks.length === 5 &&
    tasks[0].origin && tasks[0].origin === tasks.at(-1).destination &&
    tasks.slice(1).every((task, index) => tasks[index].destination === task.origin);
  const limit = fourCityLoop ? 5 : MAX_FLIGHT_LEGS;
  if (tasks.length > limit) return { tour, summary: { ...baseSummary, reason: 'too-many-flight-legs', flightLegCount: tasks.length } };
  if (tasks.some(t => !t.origin || !t.destination || !t.departureDate)) return { tour, summary: { ...baseSummary, reason: 'flight-leg-missing-airport-or-date' } };

  // Results are remembered for 15 minutes (ignav-fare-cache), so the page's three
  // parallel trips, retries and a return visit don't pay for the same flight twice.
  // Tests that inject fetchFn without a cache option keep calling Ignav directly.
  const counter = { calls: 0, cacheHits: 0 };
  const search = options.fareCache === false || (options.fetchFn && options.fareCache !== true) ? ignav.searchOneWay : searchOneWayCached;
  const results = await Promise.all(tasks.map(task => search({
    origin: task.origin, destination: task.destination, departureDate: task.departureDate,
    adults: party.adults, children: party.children, currency
  }, { env, fetchFn: options.fetchFn, requestGuard: options.requestGuard, dynamo: options.dynamo, counter })));
  if (search === ignav.searchOneWay) counter.calls = tasks.length;

  const failed = results.map((r, i) => ({ r, task: tasks[i] }))
    .filter(({ r }) => !r.ok || !r.cheapest || r.cheapest.currency !== currency);
  const summaryBase = { ...baseSummary, attempted: true, providerRequests: counter.calls, cacheHits: counter.cacheHits, requiredFlightLegCount: tasks.length, currency };
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
