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
//
// GV-WEB-710G-R4 compatibility: planning-only Saved Trips may have the exact
// route but no exact dates yet. During the user's explicit current-price check,
// prepare a bounded provider-observed exact-date chain in memory before Duffel
// revalidation. Nothing is persisted, booked, reserved, ordered or ticketed.

const booking707BR1 = require('./staging-booking-revalidation-707b-r1');
const booking707BBase = require('./staging-booking-revalidation-707b');
const savedTrips705C = require('./staging-saved-trips-705c');
const nuitee708C = require('./nuitee-hotel-708c');
const autoDates710E = require('./staging-multicity-auto-dates-710e-r3a');

const VERSION = 'GV-HOTEL-708C';
const FLIGHT_NORMALIZATION_VERSION = 'GV-WEB-710G-R3';
const AUTO_DATE_PREPARATION_VERSION = 'GV-WEB-710G-R4';
const ROUTE_PATH = booking707BR1.ROUTE_PATH;
const STAGING_ORIGIN = booking707BR1.STAGING_ORIGIN;

function clean(value) { return String(value == null ? '' : value).trim(); }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value, fallback = null) { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; } }
function safeDate(value) {
  const raw = clean(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isFinite(Date.parse(`${raw}T12:00:00Z`)) ? raw : null;
}
function safeIata(value) {
  const code = clean(value).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

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

function sourceRouteLegs(tour = {}) {
  if (Array.isArray(tour.backendLegs) && tour.backendLegs.length) return tour.backendLegs;
  return Array.isArray(tour.legs) ? tour.legs : [];
}

function exactFlightLegReady(leg = {}) {
  if (!routeLegHasFlightSemantics(leg)) return false;
  const evidence = isRecord(leg.providerDateEvidence) ? leg.providerDateEvidence : {};
  const origin = safeIata(leg?.from?.airportCode || leg?.from?.code || evidence.requestedOrigin);
  const destination = safeIata(leg?.to?.airportCode || leg?.to?.code || evidence.requestedDestination);
  const departureDate = safeDate(leg.departureDate || leg.dateLabel || evidence.departureDate);
  return Boolean(origin && destination && departureDate);
}

function applyAutomaticDatePlan(trip = null, plan = {}) {
  const next = clone(trip, null);
  const tour = next?.tripSnapshot?.tour;
  const selectedLegs = Array.isArray(plan?.selectedLegs) ? plan.selectedLegs : [];
  if (!isRecord(next) || !isRecord(tour) || !selectedLegs.length) return next || trip;

  const materialize = (rows = []) => rows.map((raw, index) => {
    const leg = normalizeRouteFlightLeg(raw);
    const selected = selectedLegs[index];
    if (!isRecord(leg) || !selected) return leg;
    const from = isRecord(leg.from) ? leg.from : {};
    const to = isRecord(leg.to) ? leg.to : {};
    const existingEvidence = isRecord(leg.providerDateEvidence) ? leg.providerDateEvidence : {};
    const selectedEvidence = isRecord(selected.evidence) ? selected.evidence : {};
    const fromCode = safeIata(selected?.from?.code || from.airportCode || from.code);
    const toCode = safeIata(selected?.to?.code || to.airportCode || to.code);
    const departureDate = safeDate(selected.departureDate || leg.departureDate || leg.dateLabel);
    return {
      ...leg,
      from: {
        ...from,
        city: clean(selected?.from?.city) || from.city,
        code: fromCode || from.code,
        airportCode: fromCode || from.airportCode || from.code
      },
      to: {
        ...to,
        city: clean(selected?.to?.city) || to.city,
        code: toCode || to.code,
        airportCode: toCode || to.airportCode || to.code
      },
      departureDate: departureDate || leg.departureDate,
      dateLabel: departureDate || leg.dateLabel,
      providerDateEvidence: {
        ...existingEvidence,
        ...selectedEvidence,
        departureDate: departureDate || selected.departureDate || null,
        departureTime: selected.departureTime || null,
        arrivalTime: selected.arrivalTime || null,
        displayPrice: finite(selected.price, 0) || null,
        displayCurrency: clean(selected.currency) || clean(existingEvidence.displayCurrency) || null,
        airline: clean(selected.airline) || null,
        flightNumber: clean(selected.flightNumber) || null,
        sourceType: clean(selected.sourceType || selectedEvidence.sourceType || existingEvidence.sourceType || 'CACHED'),
        requestedOrigin: fromCode || clean(selectedEvidence.requestedOrigin) || null,
        requestedDestination: toCode || clean(selectedEvidence.requestedDestination) || null,
        availabilityVerified: false
      }
    };
  });

  if (Array.isArray(tour.backendLegs) && tour.backendLegs.length) tour.backendLegs = materialize(tour.backendLegs);
  if (Array.isArray(tour.legs) && tour.legs.length) tour.legs = materialize(tour.legs);
  tour.automaticDates = {
    complete: true,
    version: plan.version || autoDates710E.VERSION,
    revision: plan.revision || autoDates710E.REVISION,
    departureDate: plan.departureDate || selectedLegs[0]?.departureDate || null,
    returnDate: plan.returnDate || selectedLegs[selectedLegs.length - 1]?.departureDate || null,
    selectedLegs,
    sourceType: plan.sourceType || 'CACHED',
    currentAvailabilityVerified: false,
    bookingCapability: false,
    paymentCapability: false,
    reservationCapability: false
  };
  tour.bookingAutoDatePreparation = {
    version: AUTO_DATE_PREPARATION_VERSION,
    sourceVersion: plan.version || autoDates710E.VERSION,
    sourceRevision: plan.revision || autoDates710E.REVISION,
    preparedAt: new Date().toISOString(),
    persistedToSavedTrip: false
  };
  return next;
}

async function prepareSavedTripAutomaticDates(trip = null, options = {}) {
  const env = options.env || process.env;
  const normalized = normalizeSavedTripFlightLegs(trip);
  const tour = normalized?.tripSnapshot?.tour;
  const routeLegs = isRecord(tour) ? sourceRouteLegs(tour) : [];
  const flightLegs = routeLegs.filter(routeLegHasFlightSemantics);
  const requiredFlightLegCount = flightLegs.length;
  const readyFlightLegCount = flightLegs.filter(exactFlightLegReady).length;
  const baseSummary = {
    version: AUTO_DATE_PREPARATION_VERSION,
    attempted: false,
    complete: requiredFlightLegCount > 0 && readyFlightLegCount === requiredFlightLegCount,
    reason: null,
    requiredFlightLegCount,
    readyFlightLegCount,
    persistedToSavedTrip: false
  };

  if (!isRecord(normalized) || clean(normalized?.tripSnapshot?.kind).toLowerCase() !== 'multi' || !isRecord(tour)) {
    return { trip: normalized || trip, summary: { ...baseSummary, complete: false, reason: 'multi-city-saved-tour-required' } };
  }
  if (!requiredFlightLegCount) {
    return { trip: normalized, summary: { ...baseSummary, complete: false, reason: 'no-flight-legs' } };
  }
  if (readyFlightLegCount === requiredFlightLegCount) {
    return { trip: normalized, summary: { ...baseSummary, complete: true, reason: 'saved-exact-dates-present' } };
  }
  if (flightLegs.length !== routeLegs.length) {
    return { trip: normalized, summary: { ...baseSummary, complete: false, reason: 'mixed-transport-route-not-supported' } };
  }
  if (!autoDates710E.enabled(env)) {
    return { trip: normalized, summary: { ...baseSummary, complete: false, reason: 'automatic-date-feature-disabled' } };
  }

  const hydrated = booking707BBase._internal.hydrateSavedTour(normalized);
  const stops = Array.isArray(tour.stops) && tour.stops.length
    ? clone(tour.stops, [])
    : (Array.isArray(hydrated?.stops) ? clone(hydrated.stops, []) : []);
  const autoTour = {
    ...clone(tour, {}),
    legs: clone(routeLegs, []).map((leg) => normalizeRouteFlightLeg(leg)),
    stops
  };
  const queryTour = hydrated || autoTour;
  const query = booking707BBase._internal.queryForTrip(normalized, queryTour);
  const materializeRouteDates = options.materializeRouteDates || autoDates710E.materializeRouteDates;

  try {
    const plan = await materializeRouteDates({ tour: autoTour, query, now: options.now });
    const selectedLegs = Array.isArray(plan?.selectedLegs) ? plan.selectedLegs : [];
    if (plan?.complete !== true || selectedLegs.length !== routeLegs.length) {
      return {
        trip: normalized,
        summary: {
          ...baseSummary,
          attempted: true,
          complete: false,
          reason: clean(plan?.reason || 'automatic-date-chain-incomplete'),
          selectedLegCount: selectedLegs.length,
          readyFlightLegCount
        }
      };
    }
    const prepared = applyAutomaticDatePlan(normalized, { ...plan, version: autoDates710E.VERSION, revision: autoDates710E.REVISION });
    const preparedLegs = sourceRouteLegs(prepared?.tripSnapshot?.tour || {});
    const preparedReadyCount = preparedLegs.filter(exactFlightLegReady).length;
    if (preparedReadyCount !== requiredFlightLegCount) {
      return {
        trip: normalized,
        summary: {
          ...baseSummary,
          attempted: true,
          complete: false,
          reason: 'automatic-date-plan-not-revalidatable',
          selectedLegCount: selectedLegs.length,
          readyFlightLegCount: preparedReadyCount
        }
      };
    }
    return {
      trip: prepared,
      summary: {
        ...baseSummary,
        attempted: true,
        complete: true,
        reason: null,
        selectedLegCount: selectedLegs.length,
        readyFlightLegCount: preparedReadyCount,
        departureDate: plan.departureDate || selectedLegs[0]?.departureDate || null,
        returnDate: plan.returnDate || selectedLegs[selectedLegs.length - 1]?.departureDate || null,
        sourceType: plan.sourceType || 'CACHED'
      }
    };
  } catch (error) {
    console.error('GV-WEB-710G-R4 automatic date preparation failed closed', { name: error?.name, message: error?.message });
    return {
      trip: normalized,
      summary: {
        ...baseSummary,
        attempted: true,
        complete: false,
        reason: clean(error?.code || error?.name || 'automatic-date-provider-error')
      }
    };
  }
}

function augmentRevalidationPayload(payload = {}, datePreparation = null, trip = null) {
  if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.revalidation)) return payload;
  const tour = trip?.tripSnapshot?.tour;
  const requiredFlightLegCount = finite(datePreparation?.requiredFlightLegCount, 0)
    || (isRecord(tour) ? sourceRouteLegs(tour).filter(routeLegHasFlightSemantics).length : 0);
  const liveFlightLegCount = finite(payload.revalidation.liveFlightLegCount, 0);
  return {
    ...payload,
    revalidation: {
      ...payload.revalidation,
      requiredFlightLegCount: finite(payload.revalidation.requiredFlightLegCount, 0) || requiredFlightLegCount,
      liveFlightLegCount,
      automaticDatePreparation: datePreparation ? clone(datePreparation, null) : null
    },
    trust: {
      ...(payload.trust || {}),
      automaticDatePreparationVersion: AUTO_DATE_PREPARATION_VERSION,
      finalPartnerConfirmationRequired: true
    }
  };
}

function withHeader(response = {}, value = VERSION) {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      'X-Globevoy-Hotel-Revalidation': value,
      'X-Globevoy-Trip-Leg-Normalization': FLIGHT_NORMALIZATION_VERSION,
      'X-Globevoy-Trip-Auto-Dates': AUTO_DATE_PREPARATION_VERSION
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
  let datePreparation = null;
  const upstreamGetTrip = options.getTrip;
  const getTrip = async (sub, tripId) => {
    const loadedTrip = upstreamGetTrip
      ? await upstreamGetTrip(sub, tripId)
      : await savedTrips705C._internal.getTrip(sub, tripId, { ...options, env });
    const prepared = await prepareSavedTripAutomaticDates(loadedTrip, { ...options, env });
    capturedTrip = prepared.trip;
    datePreparation = prepared.summary;
    return capturedTrip;
  };

  const response = await booking707BR1.handleBookingRevalidation707B(event, { ...options, getTrip });
  if (response?.statusCode !== 200 || !capturedTrip) return withHeader(response, nuitee708C.enabled(env) ? VERSION : 'disabled');

  let payload;
  try { payload = JSON.parse(String(response.body || '{}')); }
  catch (_) { return withHeader(response, nuitee708C.enabled(env) ? VERSION : 'disabled'); }
  payload = augmentRevalidationPayload(payload, datePreparation, capturedTrip);
  let augmentedResponse = { ...response, body: JSON.stringify(payload) };

  if (!nuitee708C.enabled(env)) return withHeader(augmentedResponse, 'disabled');
  if (capturedTrip?.tripSnapshot?.kind !== 'multi' || payload?.ok !== true || !Array.isArray(payload.hotels) || !payload.hotels.length) {
    return withHeader(augmentedResponse);
  }

  const tour = booking707BBase._internal.hydrateSavedTour(capturedTrip);
  if (!tour) return withHeader(augmentedResponse);
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
  augmentedResponse = { ...response, body: JSON.stringify(augmented) };
  return withHeader(augmentedResponse);
}

function preflight(event = {}) {
  return withHeader(booking707BR1.preflight(event), nuitee708C.enabled() ? VERSION : 'disabled');
}

function status707B(env = process.env) {
  return {
    ...booking707BR1.status707B(env),
    hotelEvidence: nuitee708C.status708C(env),
    tripLegNormalization: FLIGHT_NORMALIZATION_VERSION,
    tripReviewAutoDates: {
      version: AUTO_DATE_PREPARATION_VERSION,
      sourceVersion: autoDates710E.VERSION,
      sourceRevision: autoDates710E.REVISION,
      enabled: autoDates710E.enabled(env),
      persistedToSavedTrip: false
    }
  };
}

module.exports = {
  VERSION,
  FLIGHT_NORMALIZATION_VERSION,
  AUTO_DATE_PREPARATION_VERSION,
  ROUTE_PATH,
  STAGING_ORIGIN,
  handleBookingRevalidation707B,
  preflight,
  status707B,
  _internal: {
    routeLegHasFlightSemantics,
    normalizeRouteFlightLeg,
    normalizeSavedTripFlightLegs,
    sourceRouteLegs,
    exactFlightLegReady,
    applyAutomaticDatePlan,
    prepareSavedTripAutomaticDates,
    augmentRevalidationPayload,
    mergeHotelRows,
    hotelSummary,
    applyHotelEvidence
  }
};
