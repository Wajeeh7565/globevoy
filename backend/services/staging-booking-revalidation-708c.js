'use strict';

// GV-HOTEL-708C — additive staging wrapper around GV-WEB-707B-R1.
//
// 707B-R1 remains authoritative for owner-private Saved Trip reads, Duffel
// flight evidence, flight handoff safety and corrected arithmetic. This wrapper
// adds bounded Nuitee Rates -> PREBOOK hotel evidence only when its feature flag
// is enabled. Hotel failure never removes the existing planning estimate.
//
// GV-WEB-710G-R3 compatibility: Results-saved multi-city snapshots can contain
// route-engine flight legs without an explicit mode/transportType marker. The
// booking revalidator intentionally recognises only declared flight semantics,
// so normalize only route-engine legs that already carry flight-specific
// evidence/estimates. This happens in-memory at read time and does not rewrite
// the owner's Saved Trip record.

const booking707BR1 = require('./staging-booking-revalidation-707b-r1');
const booking707BBase = require('./staging-booking-revalidation-707b');
const savedTrips705C = require('./staging-saved-trips-705c');
const nuitee708C = require('./nuitee-hotel-708c');

const VERSION = 'GV-HOTEL-708C';
const FLIGHT_NORMALIZATION_VERSION = 'GV-WEB-710G-R3';
const ROUTE_PATH = booking707BR1.ROUTE_PATH;
const STAGING_ORIGIN = booking707BR1.STAGING_ORIGIN;

function clean(value) { return String(value == null ? '' : value).trim(); }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value, fallback = null) { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; } }

function routeLegHasFlightSemantics(leg = {}) {
  if (!isRecord(leg)) return false;
  const declared = `${clean(leg.mode)} ${clean(leg.transportType)}`.toLowerCase();
  if (declared.includes('flight')) return true;
  if (/\b(train|rail|bus|coach|ferry|car|drive|ship)\b/.test(declared)) return false;

  const estimateSource = clean(leg.estimateSource).toLowerCase();
  const evidence = isRecord(leg.providerDateEvidence) ? leg.providerDateEvidence : {};
  return finite(leg.estimatedFlightUsd, 0) > 0
    || estimateSource.includes('flight')
    || /\b(air|plane|aviation)\b/.test(declared)
    || Boolean(clean(evidence.flightNumber))
    || (Boolean(clean(evidence.requestedOrigin)) && Boolean(clean(evidence.requestedDestination)));
}

function normalizeRouteFlightLeg(leg = {}) {
  if (!isRecord(leg) || !routeLegHasFlightSemantics(leg)) return leg;
  const declared = `${clean(leg.mode)} ${clean(leg.transportType)}`.toLowerCase();
  if (declared.includes('flight')) return leg;
  return {
    ...leg,
    mode: clean(leg.mode) || 'flight',
    transportType: 'flight'
  };
}

function normalizeSavedTripFlightLegs(trip = null) {
  if (!isRecord(trip)) return trip;
  const next = clone(trip, null);
  if (!isRecord(next) || clean(next?.tripSnapshot?.kind).toLowerCase() !== 'multi') return next || trip;
  const tour = next?.tripSnapshot?.tour;
  if (!isRecord(tour)) return next;

  for (const key of ['backendLegs', 'legs']) {
    if (!Array.isArray(tour[key])) continue;
    tour[key] = tour[key].map((leg) => normalizeRouteFlightLeg(leg));
  }
  return next;
}

function withHeader(response = {}, value = VERSION) {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      'X-Globevoy-Hotel-Revalidation': value,
      'X-Globevoy-Trip-Leg-Normalization': FLIGHT_NORMALIZATION_VERSION
    }
  };
}

function mergeHotelRows(existingRows = [], hotelResult = {}) {
  const evidenceByIndex = new Map((Array.isArray(hotelResult.rows) ? hotelResult.rows : []).map((row) => [row.index, row]));
  return (Array.isArray(existingRows) ? existingRows : []).map((saved) => {
    const evidence = evidenceByIndex.get(saved.index);
    if (!evidence || evidence.state === 'unavailable') {
      return {
        ...saved,
        provider: evidence?.provider || null,
        providerState: evidence?.state || 'unavailable',
        providerReason: evidence?.reason || hotelResult.reason || null,
        checkin: evidence?.checkin || null,
        checkout: evidence?.checkout || null,
        dateBasis: evidence?.dateBasis || null,
        evidence: 'Planning estimate only — hotel provider recheck still required before booking.'
      };
    }
    return {
      ...saved,
      provider: evidence.provider,
      providerState: evidence.state,
      state: evidence.availabilityVerified === true ? 'verified' : 'provider',
      availabilityVerified: evidence.availabilityVerified === true,
      hotelName: evidence.hotelName || null,
      address: evidence.address || null,
      rating: evidence.rating ?? null,
      photoUrl: evidence.photoUrl || null,
      roomName: evidence.roomName || null,
      boardName: evidence.boardName || null,
      freshAmount: finite(evidence.freshAmount, 0) || null,
      currency: clean(evidence.currency || saved.currency).toUpperCase(),
      checkin: evidence.checkin || null,
      checkout: evidence.checkout || null,
      dateBasis: evidence.dateBasis || null,
      refundableTag: evidence.refundableTag || 'UNKNOWN',
      cancellationDetailsPresent: evidence.cancellationDetailsPresent === true,
      taxesAndFeesPresent: evidence.taxesAndFeesPresent === true,
      excludedFeesPresent: evidence.excludedFeesPresent === true,
      evidence: evidence.evidence || 'Provider-backed hotel rate — recheck before booking',
      observedAt: evidence.observedAt || null,
      providerReason: evidence.reason || null,
      finalPriceRequiresPartnerConfirmation: true,
      handoffLabel: saved.handoffUrl ? 'Compare on Agoda' : null
    };
  });
}

function hotelSummary(payload = {}, hotelResult = {}, trip = null) {
  const existing = Array.isArray(payload.hotels) ? payload.hotels : [];
  const rowBaseline = existing.reduce((sum, row) => sum + finite(row.savedEstimate, 0), 0);
  // Prefer the exact saved stay snapshot when available. The compact per-stop
  // rows can be rounded/reconstructed from canonical USD values and must not
  // become a second arithmetic baseline (the same class of issue fixed in R1).
  const snapshotBaseline = finite(trip?.priceSnapshot?.stayEstimate, 0);
  const savedHotelEstimate = snapshotBaseline > 0 ? snapshotBaseline : rowBaseline;
  const freshHotelTotal = hotelResult.allVerified === true ? finite(hotelResult.freshHotelTotal, 0) : 0;
  const hotelDelta = hotelResult.allVerified === true ? freshHotelTotal - savedHotelEstimate : null;
  const freshTripEstimate = finite(payload?.revalidation?.freshTripEstimate, 0);
  const hotelAdjustedTripEstimate = hotelResult.allVerified === true && freshTripEstimate > 0
    ? Math.max(0, freshTripEstimate + hotelDelta)
    : null;
  return {
    version: VERSION,
    enabled: hotelResult.enabled === true,
    attempted: hotelResult.attempted === true,
    provider: 'Nuitee',
    reason: hotelResult.reason || null,
    totalCount: finite(hotelResult.totalCount, existing.length),
    providerBackedCount: finite(hotelResult.providerBackedCount, 0),
    verifiedCount: finite(hotelResult.verifiedCount, 0),
    allVerified: hotelResult.allVerified === true,
    providerRequests: finite(hotelResult.providerRequests, 0),
    savedHotelEstimate: Math.round(savedHotelEstimate),
    freshHotelTotal: hotelResult.allVerified === true ? Math.round(freshHotelTotal) : null,
    hotelDelta: hotelDelta === null ? null : Math.round(hotelDelta),
    hotelAdjustedTripEstimate: hotelAdjustedTripEstimate === null ? null : Math.round(hotelAdjustedTripEstimate),
    observedAt: hotelResult.observedAt || null,
    bookingCapability: false,
    paymentCapability: false,
    reservationCapability: false
  };
}

function applyHotelEvidence(payload = {}, hotelResult = {}, trip = null) {
  if (!payload || payload.ok !== true || !Array.isArray(payload.hotels) || !payload.hotels.length) return payload;
  const summary = hotelSummary(payload, hotelResult, trip);
  return {
    ...payload,
    hotels: mergeHotelRows(payload.hotels, hotelResult),
    hotelRevalidation: summary,
    trust: {
      ...(payload.trust || {}),
      hotelEvidenceFreshlyChecked: summary.attempted,
      hotelAvailabilityVerified: summary.allVerified,
      hotelEvidenceProvider: 'Nuitee',
      hotelEvidenceVersion: VERSION,
      finalPartnerConfirmationRequired: true
    },
    bookingBoundary: {
      ...(payload.bookingBoundary || {}),
      noBooking: true,
      noPayment: true,
      noOrderCreation: true,
      noReservation: true
    }
  };
}

async function handleBookingRevalidation707B(event = {}, options = {}) {
  const env = options.env || process.env;
  let capturedTrip = null;
  const upstreamGetTrip = options.getTrip;
  const getTrip = async (sub, tripId) => {
    const loadedTrip = upstreamGetTrip
      ? await upstreamGetTrip(sub, tripId)
      : await savedTrips705C._internal.getTrip(sub, tripId, { ...options, env });
    capturedTrip = normalizeSavedTripFlightLegs(loadedTrip);
    return capturedTrip;
  };

  const response = await booking707BR1.handleBookingRevalidation707B(event, { ...options, getTrip });
  if (response?.statusCode !== 200 || !capturedTrip || !nuitee708C.enabled(env)) {
    return withHeader(response, nuitee708C.enabled(env) ? VERSION : 'disabled');
  }

  let payload;
  try { payload = JSON.parse(String(response.body || '{}')); }
  catch (_) { return withHeader(response); }
  if (capturedTrip?.tripSnapshot?.kind !== 'multi' || payload?.ok !== true || !Array.isArray(payload.hotels) || !payload.hotels.length) {
    return withHeader(response);
  }

  const tour = booking707BBase._internal.hydrateSavedTour(capturedTrip);
  if (!tour) return withHeader(response);
  const query = booking707BBase._internal.queryForTrip(capturedTrip, tour);
  const verifyTourHotels = options.verifyTourHotels || nuitee708C.verifyTourHotels;

  let hotelResult;
  try {
    hotelResult = await verifyTourHotels(tour, query, {
      ...(options.nuitee || {}),
      env,
      fetch: options.nuiteeFetch || options.nuitee?.fetch || globalThis.fetch
    });
  } catch (error) {
    console.error('GV-HOTEL-708C hotel verification failed closed', { name: error?.name, message: error?.message });
    hotelResult = {
      version: VERSION,
      enabled: true,
      attempted: true,
      provider: 'Nuitee',
      reason: clean(error?.code || error?.name || 'provider-error'),
      totalCount: payload.hotels.length,
      verifiedCount: 0,
      providerBackedCount: 0,
      allVerified: false,
      providerRequests: 0,
      rows: []
    };
  }

  const augmented = applyHotelEvidence(payload, hotelResult, capturedTrip);
  return withHeader({ ...response, body: JSON.stringify(augmented) });
}

function preflight(event = {}) {
  return withHeader(booking707BR1.preflight(event), nuitee708C.enabled() ? VERSION : 'disabled');
}

function status707B(env = process.env) {
  return {
    ...booking707BR1.status707B(env),
    hotelEvidence: nuitee708C.status708C(env),
    tripLegNormalization: FLIGHT_NORMALIZATION_VERSION
  };
}

module.exports = {
  VERSION,
  FLIGHT_NORMALIZATION_VERSION,
  ROUTE_PATH,
  STAGING_ORIGIN,
  handleBookingRevalidation707B,
  preflight,
  status707B,
  _internal: {
    routeLegHasFlightSemantics,
    normalizeRouteFlightLeg,
    normalizeSavedTripFlightLegs,
    mergeHotelRows,
    hotelSummary,
    applyHotelEvidence
  }
};
