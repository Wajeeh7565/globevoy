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
// prepare an in-memory schedule before Duffel revalidation. R4.2 preserves exact
// airport evidence (for example YYZ instead of metro code YTO), uses provider
// observations to choose the first departure date, and may derive later dates
// strictly from the saved stop-night allocation when provider date-cache coverage
// is sparse. Derived dates are planning-only until Duffel verifies them LIVE.
// Nothing is persisted, booked, reserved, ordered or ticketed.

const booking707BR1 = require('./staging-booking-revalidation-707b-r1');
const booking707BBase = require('./staging-booking-revalidation-707b');
const savedTrips705C = require('./staging-saved-trips-705c');
const nuitee708C = require('./nuitee-hotel-708c');
const autoDates710E = require('./staging-multicity-auto-dates-710e-r3a');
const current712 = require('./domain/pricing/current-trip-total-712');
const liveFare684A = require('./domain/live-fares/public-live-fare-pilot-684a');

const VERSION = 'GV-LIVE-712';
const FLIGHT_NORMALIZATION_VERSION = 'GV-WEB-710G-R3';
const AUTO_DATE_PREPARATION_VERSION = 'GV-WEB-710G-R4.2';
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
function addDays(dateString, days) {
  const date = safeDate(dateString);
  if (!date) return null;
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Math.round(finite(days, 0)));
  return value.toISOString().slice(0, 10);
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

function samePlace(a = {}, b = {}) {
  const aId = clean(a?.cityId);
  const bId = clean(b?.cityId);
  if (aId && bId) return aId === bId;
  const aCity = clean(a?.city).toLowerCase();
  const bCity = clean(b?.city).toLowerCase();
  return Boolean(aCity && bCity && aCity === bCity);
}

function preferredAirportCode(node = {}, tour = {}, stops = []) {
  const explicit = safeIata(node?.airportCode);
  if (explicit) return explicit;

  if (isRecord(tour?.origin) && samePlace(node, tour.origin)) {
    const originAirport = safeIata(tour.origin.airportCode);
    if (originAirport) return originAirport;
  }

  const stop = (Array.isArray(stops) ? stops : []).find((row) => samePlace(node, row));
  if (isRecord(stop)) {
    const stopAirport = safeIata(stop.airportCode);
    if (stopAirport) return stopAirport;

    // A single saved airport candidate is safe to materialize. When a city has
    // multiple possible airports, do not silently choose the first one.
    const stopAirportCodes = Array.isArray(stop.airportCodes)
      ? [...new Set(stop.airportCodes.map(safeIata).filter(Boolean))]
      : [];
    if (stopAirportCodes.length === 1) return stopAirportCodes[0];
  }

  return safeIata(node?.code);
}

function resolveAutomaticDateLegAirports(tour = {}, routeLegs = [], stops = []) {
  return (Array.isArray(routeLegs) ? routeLegs : []).map((raw) => {
    const leg = normalizeRouteFlightLeg(clone(raw, raw));
    if (!isRecord(leg)) return leg;
    const from = isRecord(leg.from) ? leg.from : {};
    const to = isRecord(leg.to) ? leg.to : {};
    const fromCode = preferredAirportCode(from, tour, stops);
    const toCode = preferredAirportCode(to, tour, stops);
    return {
      ...leg,
      from: { ...from, code: fromCode || from.code, airportCode: fromCode || from.airportCode || null },
      to: { ...to, code: toCode || to.code, airportCode: toCode || to.airportCode || null }
    };
  });
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

function deriveDownstreamDatePlan(autoTour = {}, providerPlan = {}) {
  const legs = Array.isArray(autoTour?.legs) ? autoTour.legs : [];
  const stops = Array.isArray(autoTour?.stops) ? autoTour.stops : [];
  const providerSelected = Array.isArray(providerPlan?.selectedLegs) ? providerPlan.selectedLegs : [];
  const first = providerSelected[0];
  const firstDate = safeDate(first?.departureDate);
  if (providerPlan?.complete === true || providerPlan?.reason !== 'no-complete-provider-date-chain') return null;
  if (!legs.length || legs.length !== stops.length + 1 || !firstDate) return null;

  const firstLeg = legs[0] || {};
  const firstFrom = preferredAirportCode(firstLeg.from || {}, autoTour, stops);
  const firstTo = preferredAirportCode(firstLeg.to || {}, autoTour, stops);
  if (!firstFrom || !firstTo) return null;

  const selectedLegs = [{
    ...clone(first, {}),
    legNumber: finite(first?.legNumber, 0) || finite(firstLeg?.legNumber, 0) || 1,
    from: { ...(clone(firstLeg.from, {}) || {}), ...(clone(first?.from, {}) || {}), code: firstFrom, airportCode: firstFrom },
    to: { ...(clone(firstLeg.to, {}) || {}), ...(clone(first?.to, {}) || {}), code: firstTo, airportCode: firstTo },
    departureDate: firstDate,
    sourceType: clean(first?.sourceType || first?.evidence?.sourceType || 'CACHED') || 'CACHED',
    availabilityVerified: false
  }];

  for (let index = 1; index < legs.length; index += 1) {
    const previousDate = safeDate(selectedLegs[index - 1]?.departureDate);
    const savedNights = Number(stops[index - 1]?.nights);
    if (!Number.isInteger(savedNights) || savedNights < 1) return null;
    const departureDate = addDays(previousDate, savedNights);
    const leg = legs[index] || {};
    const fromCode = preferredAirportCode(leg.from || {}, autoTour, stops);
    const toCode = preferredAirportCode(leg.to || {}, autoTour, stops);
    if (!departureDate || !fromCode || !toCode) return null;
    selectedLegs.push({
      legNumber: finite(leg?.legNumber, 0) || index + 1,
      from: { ...(clone(leg.from, {}) || {}), code: fromCode, airportCode: fromCode },
      to: { ...(clone(leg.to, {}) || {}), code: toCode, airportCode: toCode },
      departureDate,
      targetDate: departureDate,
      price: null,
      currency: null,
      sourceType: 'DERIVED',
      selectionReason: 'saved-stop-nights-derived-for-live-revalidation',
      availabilityVerified: false,
      evidence: {
        sourceType: 'DERIVED',
        dateBasis: 'saved-stop-nights',
        providerBacked: false,
        productionEligible: false,
        currentAvailabilityVerified: false,
        requestedOrigin: fromCode,
        requestedDestination: toCode,
        departureDate
      }
    });
  }

  return {
    ...clone(providerPlan, {}),
    complete: true,
    reason: null,
    selectedLegs,
    departureDate: selectedLegs[0]?.departureDate || null,
    returnDate: selectedLegs[selectedLegs.length - 1]?.departureDate || null,
    sourceType: 'MIXED_PLANNING',
    dateBasis: 'provider-first-leg-plus-saved-stop-nights',
    providerObservedDateLegCount: 1,
    derivedDateLegCount: Math.max(0, selectedLegs.length - 1),
    originalProviderChainReason: clean(providerPlan?.reason) || null,
    currentAvailabilityVerified: false
  };
}

function automaticDateDiagnostics(plan = {}) {
  const diagnostics = (Array.isArray(plan?.diagnostics) ? plan.diagnostics : []).map((row) => ({
    legNumber: finite(row?.legNumber, 0) || null,
    origin: safeIata(row?.origin),
    destination: safeIata(row?.destination),
    targetDate: safeDate(row?.targetDate),
    candidateDepartureDate: safeDate(row?.candidateDepartureDate),
    providerSupported: Boolean(row?.providerSupported),
    providerReason: clean(row?.providerReason) || null,
    scannedMonths: Array.isArray(row?.scannedMonths)
      ? row.scannedMonths.map((month) => clean(isRecord(month) ? month.month : month)).filter(Boolean)
      : [],
    eligibleObservationCount: finite(row?.eligibleObservationCount, 0),
    monthObservationCount: finite(row?.monthObservationCount, 0),
    cacheHit: Boolean(row?.cacheHit)
  }));

  const chainSearch = isRecord(plan?.chainSearch)
    ? {
        strategy: clean(plan.chainSearch.strategy) || null,
        preservedStopNights: Boolean(plan.chainSearch.preservedStopNights),
        attemptedStartDates: finite(plan.chainSearch.attemptedStartDates, 0),
        viableChains: finite(plan.chainSearch.viableChains, 0),
        attempts: (Array.isArray(plan.chainSearch.attempts) ? plan.chainSearch.attempts : []).map((attempt) => ({
          startDate: safeDate(attempt?.startDate),
          complete: Boolean(attempt?.complete),
          observedLegs: finite(attempt?.observedLegs, 0),
          reason: clean(attempt?.reason) || null,
          failedLegNumber: finite(attempt?.failedLegNumber, 0) || null,
          targetDate: safeDate(attempt?.targetDate)
        }))
      }
    : null;

  return {
    failedLegNumber: finite(plan?.failedLegNumber, 0) || null,
    targetDate: safeDate(plan?.targetDate),
    automaticFloor: safeDate(plan?.automaticFloor),
    horizonStartMonth: clean(plan?.horizonStartMonth) || null,
    horizonMonths: finite(plan?.horizonMonths, 0) || null,
    diagnostics,
    chainSearch
  };
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
    stops
  };
  autoTour.legs = resolveAutomaticDateLegAirports(autoTour, clone(routeLegs, []), stops);
  const queryTour = hydrated || autoTour;
  const query = booking707BBase._internal.queryForTrip(normalized, queryTour);
  const materializeRouteDates = options.materializeRouteDates || autoDates710E.materializeRouteDates;

  try {
    const providerPlan = await materializeRouteDates({ tour: autoTour, query, now: options.now });
    const derivedPlan = deriveDownstreamDatePlan(autoTour, providerPlan);
    const plan = derivedPlan || providerPlan;
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
          readyFlightLegCount,
          ...automaticDateDiagnostics(plan)
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
        sourceType: plan.sourceType || 'CACHED',
        dateBasis: clean(plan.dateBasis) || null,
        providerObservedDateLegCount: finite(plan.providerObservedDateLegCount, selectedLegs.length),
        derivedDateLegCount: finite(plan.derivedDateLegCount, 0),
        originalProviderChainReason: clean(plan.originalProviderChainReason) || null,
        exactAirportResolutionApplied: true,
        currentAvailabilityVerified: false
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
        state: 'estimate',
        availabilityVerified: false,
        productionEligible: false,
        priceVerified: false,
        freshAmount: null,
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
      productionEligible: evidence.productionEligible === true,
      priceVerified: evidence.priceVerified === true,
      environment: evidence.environment || 'unknown',
      sandbox: evidence.sandbox !== false,
      dateConfirmed: evidence.dateConfirmed === true,
      occupancies: clone(evidence.occupancies, null),
      roomCount: evidence.roomCount || null,
      travellerCount: evidence.travellerCount || null,
      guestNationality: evidence.guestNationality || null,
      expiresAt: evidence.expiresAt || null,
      hotelName: evidence.hotelName || null,
      address: evidence.address || null,
      rating: evidence.rating ?? null,
      photoUrl: evidence.photoUrl || null,
      roomName: evidence.roomName || null,
      roomNames: clone(evidence.roomNames, []),
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

function hotelSummary(payload = {}, hotelResult = {}, trip = null, options = {}) {
  const existing = Array.isArray(payload.hotels) ? payload.hotels : [];
  const rowBaseline = existing.reduce((sum, row) => sum + finite(row.savedEstimate, 0), 0);
  // Prefer the exact saved stay snapshot when available. The compact per-stop
  // rows can be rounded/reconstructed from canonical USD values and must not
  // become a second arithmetic baseline (the same class of issue fixed in R1).
  const snapshotBaseline = finite(trip?.priceSnapshot?.stayEstimate, 0);
  const savedHotelEstimate = snapshotBaseline > 0 ? snapshotBaseline : rowBaseline;
  const current = current712.buildCurrentPricing({ ...payload, hotels: mergeHotelRows(existing, hotelResult) }, trip || {}, options);
  const freshHotelTotal = current.hotelsTotal;
  const hotelDelta = freshHotelTotal !== null ? Number((freshHotelTotal - savedHotelEstimate).toFixed(2)) : null;
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
    allLive: current.requiredHotels > 0 && current.liveHotels === current.requiredHotels,
    liveCount: current.liveHotels,
    providerRequests: finite(hotelResult.providerRequests, 0),
    savedHotelEstimate: Math.round(savedHotelEstimate),
    freshHotelTotal,
    hotelDelta,
    // Legacy alias now means the same complete, current total as the ledger.
    hotelAdjustedTripEstimate: current.currentTotal,
    observedAt: hotelResult.observedAt || null,
    bookingCapability: false,
    paymentCapability: false,
    reservationCapability: false
  };
}

function applyHotelEvidence(payload = {}, hotelResult = {}, trip = null, options = {}) {
  if (!payload || payload.ok !== true || !Array.isArray(payload.hotels) || !payload.hotels.length) return payload;
  const summary = hotelSummary(payload, hotelResult, trip, options);
  return current712.applyCurrentPricing({
    ...payload,
    hotels: mergeHotelRows(payload.hotels, hotelResult),
    hotelRevalidation: summary,
    trust: {
      ...(payload.trust || {}),
      hotelEvidenceFreshlyChecked: summary.attempted,
      hotelAvailabilityVerified: summary.allLive,
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
  }, trip || {}, options);
}

async function handleBookingRevalidation707B(event = {}, options = {}) {
  const startedAt = Date.now();
  const env = options.env || process.env;
  let capturedTrip = null;
  let capturedFreshTour = null;
  let datePreparation = null;
  const upstreamGetTrip = options.getTrip;
  const getTrip = async (sub, tripId) => {
    let loadedTrip = upstreamGetTrip
      ? await upstreamGetTrip(sub, tripId)
      : await savedTrips705C._internal.getTrip(sub, tripId, { ...options, env });
    const context = booking707BBase._internal.parseBody(event).hotelGuestContext;
    if (loadedTrip && context) {
      const hydrated = booking707BBase._internal.hydrateSavedTour(loadedTrip);
      if (hydrated) {
        const savedQuery = booking707BBase._internal.queryForTrip(loadedTrip, hydrated);
        if (context.occupancies) {
          try { nuitee708C._internal.occupancyForQuery({ ...savedQuery, occupancies: context.occupancies }); }
          catch (_) { throw Object.assign(new Error('hotel-guest-context-mismatch'), { code: 'hotel-guest-context-mismatch' }); }
        }
        loadedTrip = clone(loadedTrip, loadedTrip);
        loadedTrip.tripSnapshot.tour.passengerPricing = { ...(loadedTrip.tripSnapshot.tour.passengerPricing || {}), ...context };
      }
    }
    const prepared = await prepareSavedTripAutomaticDates(loadedTrip, { ...options, env });
    capturedTrip = prepared.trip;
    datePreparation = prepared.summary;
    return capturedTrip;
  };

  const upstreamLive = options.applyLiveFarePilot || liveFare684A.applyPublicLiveFarePilot684A;
  const applyLiveFarePilot = async (tour, query, liveOptions) => {
    const result = await upstreamLive(tour, query, liveOptions);
    capturedFreshTour = result?.tour || null;
    return result;
  };
  const response = await booking707BR1.handleBookingRevalidation707B(event, { ...options, getTrip, applyLiveFarePilot });
  if (response?.statusCode !== 200 || !capturedTrip) return withHeader(response, nuitee708C.enabled(env) ? VERSION : 'disabled');

  let payload;
  try { payload = JSON.parse(String(response.body || '{}')); }
  catch (_) { return withHeader(response, nuitee708C.enabled(env) ? VERSION : 'disabled'); }
  payload = augmentRevalidationPayload(payload, datePreparation, capturedTrip);
  payload = current712.applyCurrentPricing(payload, capturedTrip, options);
  let augmentedResponse = { ...response, body: JSON.stringify(payload) };

  if (!nuitee708C.enabled(env)) return withHeader(augmentedResponse, 'disabled');
  if (capturedTrip?.tripSnapshot?.kind !== 'multi' || payload?.ok !== true || !Array.isArray(payload.hotels) || !payload.hotels.length) {
    return withHeader(augmentedResponse);
  }

  const savedTour = booking707BBase._internal.hydrateSavedTour(capturedTrip);
  // Price hotels for the itinerary Duffel just returned, including its local
  // arrival dates. Rehydrating the old snapshot loses overnight flight arrival.
  const tour = capturedFreshTour && Array.isArray(capturedFreshTour.legs) && capturedFreshTour.legs.length === savedTour?.legs?.length ? { ...savedTour, legs: capturedFreshTour.legs } : savedTour;
  if (!tour) return withHeader(augmentedResponse);
  const query = booking707BBase._internal.queryForTrip(capturedTrip, tour);
  const verifyTourHotels = options.verifyTourHotels || nuitee708C.verifyTourHotels;

  let hotelResult;
  try {
    hotelResult = await verifyTourHotels(tour, query, {
      ...(options.nuitee || {}),
      env,
      now: options.now || options.nuitee?.now,
      // The staging Lambda has a 60-second ceiling. Flight/auth/date work has
      // already consumed part of it; reserve eight seconds to finish safely.
      totalTimeoutMs: Math.max(0, Math.min(finite(options.nuitee?.totalTimeoutMs, 55000), 52000 - (Date.now() - startedAt))),
      fetch: options.nuiteeFetch || options.nuitee?.fetch || globalThis.fetch
    });
  } catch (error) {
    console.error('GV-LIVE-712 hotel verification failed closed', { name: error?.name });
    hotelResult = {
      version: VERSION,
      enabled: true,
      attempted: true,
      provider: 'Nuitee',
      reason: 'hotel-provider-unavailable',
      totalCount: payload.hotels.length,
      verifiedCount: 0,
      providerBackedCount: 0,
      allVerified: false,
      providerRequests: 0,
      rows: []
    };
  }

  const augmented = applyHotelEvidence(payload, hotelResult, capturedTrip, options);
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
    preferredAirportCode,
    resolveAutomaticDateLegAirports,
    deriveDownstreamDatePlan,
    exactFlightLegReady,
    applyAutomaticDatePlan,
    prepareSavedTripAutomaticDates,
    augmentRevalidationPayload,
    mergeHotelRows,
    hotelSummary,
    applyHotelEvidence
  }
};
