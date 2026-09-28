'use strict';

// GV-WEB-707B-R1 — saved-flight baseline accounting repair.
//
// 705C-R3 intentionally compacts saved multi-city snapshots. Some historical
// display-currency aliases are removed while the canonical USD transport
// estimates remain. 707B originally treated those compact legs as a zero saved
// flight baseline, which made the whole fresh Duffel total look like a price
// increase and then added that fresh total on top of the already-combined saved
// trip total. R1 restores the saved baseline from canonical USD leg estimates
// using the saved tour's USD->display exchange rate.
//
// Provider/search/auth/ownership/handoff behavior remains owned by 707B. R1
// changes arithmetic only and preserves fail-closed behavior.

const base707B = require('./staging-booking-revalidation-707b');
const savedTrips705C = require('./accounts/saved-trips/staging-saved-trips-705c');

const VERSION = 'GV-WEB-707B-R1';
const ROUTE_PATH = base707B.ROUTE_PATH;
const STAGING_ORIGIN = base707B.STAGING_ORIGIN;

function clean(value) { return String(value == null ? '' : value).trim(); }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function flightLike(leg = {}) {
  const text = `${clean(leg.mode)} ${clean(leg.transportType)}`.toLowerCase();
  if (text.includes('flight')) return true;
  return (Array.isArray(leg.segments) ? leg.segments : []).some((segment) => `${clean(segment?.mode)} ${clean(segment?.transportType)}`.toLowerCase().includes('flight'));
}

function displayRate(tour = {}) {
  const rate = finite(tour?.displayBudget?.exchangeRateFromUsd || tour?.canonicalPricing?.exchangeRateFromUsd, 0);
  return rate > 0 ? rate : 1;
}

function savedLegDisplayAmount(leg = {}, tour = {}) {
  const direct = finite(
    leg.estimatedDisplayTotal
      || leg.partyTotalAmountDisplay
      || leg?.providerDateEvidence?.partyTotalAmountDisplay,
    0
  );
  if (direct > 0) return direct;
  const usd = finite(leg.estimatedTransportUsd || leg.estimatedFlightUsd || leg.amountUsd, 0);
  return usd > 0 ? usd * displayRate(tour) : 0;
}

function savedFlightDisplayTotal(trip = {}, tour = {}) {
  const explicit = finite(trip?.priceSnapshot?.flightEstimate, 0);
  if (explicit > 0) return explicit;
  const canonical = finite(tour?.canonicalPricing?.transportDisplayTotal, 0);
  if (canonical > 0) return canonical;
  const legs = Array.isArray(tour.backendLegs) ? tour.backendLegs : (Array.isArray(tour.legs) ? tour.legs : []);
  return legs.filter(flightLike).reduce((sum, leg) => sum + savedLegDisplayAmount(leg, tour), 0);
}

function freshFlightDisplayTotal(payload = {}) {
  const fromRows = (Array.isArray(payload.flights) ? payload.flights : [])
    .reduce((sum, row) => sum + finite(row?.freshAmount, 0), 0);
  if (fromRows > 0) return fromRows;
  return finite(payload?.revalidation?.freshFlightTotal, 0);
}

function correctedState(savedAmount, freshAmount) {
  return base707B._internal.changeState(savedAmount, freshAmount);
}

function correctSuccessfulPayload(payload = {}, trip = null) {
  if (!trip || payload?.revalidation?.applied !== true || payload?.revalidation?.allFlightLegsLive !== true) {
    return payload;
  }
  const tour = base707B._internal.hydrateSavedTour(trip);
  if (!tour) return payload;

  const savedFlight = savedFlightDisplayTotal(trip, tour);
  const freshFlight = freshFlightDisplayTotal(payload);
  const savedTrip = finite(base707B._internal.savedTripDisplayTotal(trip, tour), finite(payload?.snapshot?.savedTripTotal, 0));
  if (!(savedFlight > 0) || !(freshFlight > 0)) return payload;

  const delta = freshFlight - savedFlight;
  const freshTrip = savedTrip > 0 ? Math.max(0, savedTrip + delta) : finite(payload?.revalidation?.freshTripEstimate, 0);
  const beforeLegs = Array.isArray(tour.legs) ? tour.legs : [];
  const correctedFlights = (Array.isArray(payload.flights) ? payload.flights : []).map((row) => {
    const index = Number.isInteger(row?.index) ? row.index : -1;
    const savedLeg = index >= 0 ? beforeLegs[index] : null;
    return savedLeg ? { ...row, savedAmount: savedLegDisplayAmount(savedLeg, tour) } : row;
  });

  return {
    ...payload,
    snapshot: {
      ...(payload.snapshot || {}),
      savedFlightTotal: Math.round(savedFlight),
      savedTripTotal: Math.round(savedTrip)
    },
    revalidation: {
      ...(payload.revalidation || {}),
      state: correctedState(savedFlight, freshFlight),
      freshFlightTotal: Math.round(freshFlight),
      flightDelta: Math.round(delta),
      freshTripEstimate: Math.round(freshTrip),
      calculationVersion: VERSION
    },
    flights: correctedFlights,
    trust: {
      ...(payload.trust || {}),
      bookingRevalidationCalculationVersion: VERSION
    }
  };
}

function withR1Header(response = {}) {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      'X-Globevoy-Booking-Revalidation-Calculation': VERSION
    }
  };
}

async function handleBookingRevalidation707B(event = {}, options = {}) {
  const env = options.env || process.env;
  let capturedTrip = null;
  const upstreamGetTrip = options.getTrip;
  const getTrip = async (sub, tripId) => {
    capturedTrip = upstreamGetTrip
      ? await upstreamGetTrip(sub, tripId)
      : await savedTrips705C._internal.getTrip(sub, tripId, { ...options, env });
    return capturedTrip;
  };

  const response = await base707B.handleBookingRevalidation707B(event, { ...options, getTrip });
  if (response?.statusCode !== 200 || !capturedTrip) return withR1Header(response);

  let payload;
  try { payload = JSON.parse(String(response.body || '{}')); }
  catch (_) { return withR1Header(response); }

  const corrected = correctSuccessfulPayload(payload, capturedTrip);
  return withR1Header({ ...response, body: JSON.stringify(corrected) });
}

function preflight(event = {}) {
  return withR1Header(base707B.preflight(event));
}

function status707B(env = process.env) {
  return {
    ...base707B.status707B(env),
    calculationVersion: VERSION,
    savedFlightBaseline: 'display-alias-or-canonical-usd-times-saved-display-rate'
  };
}

module.exports = {
  VERSION,
  ROUTE_PATH,
  STAGING_ORIGIN,
  handleBookingRevalidation707B,
  preflight,
  status707B,
  _internal: {
    displayRate,
    savedLegDisplayAmount,
    savedFlightDisplayTotal,
    freshFlightDisplayTotal,
    correctSuccessfulPayload
  }
};
