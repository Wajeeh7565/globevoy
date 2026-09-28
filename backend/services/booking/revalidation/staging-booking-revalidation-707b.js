'use strict';

// GV-WEB-707B — staging-only owner-private booking-time flight revalidation.
//
// Security/trust boundary:
// - browser supplies only a Saved Trip ID, never provider credentials or route data;
// - Cognito access token is verified and DynamoDB ownership comes only from token sub;
// - the exact owner-private 705C snapshot is loaded server-side;
// - existing 684A/685C Duffel LIVE search/reconciliation is reused unchanged;
// - only sanitized evidence and generated comparison URLs are returned;
// - no order, payment, booking or ticketing capability is introduced.

const auth705B = require('../../accounts/auth/staging-cognito-auth-705b-r3');
const savedTrips705C = require('../../accounts/saved-trips/staging-saved-trips-705c');
const liveFare684A = require('../../domain/live-fares/public-live-fare-pilot-684a');
const { enrichFlightLeg, enrichStay } = require('../../providers/links/partner-links');
const { parseHotelGuestContext } = require('../context/hotel-guest-context-712');

const VERSION = 'GV-WEB-707B';
const ROUTE_PATH = '/api/account/booking-revalidate';
const STAGING_ORIGIN = auth705B.STAGING_ORIGIN;
const MAX_BODY_BYTES = 4096;
const CHANGE_MIN_ABSOLUTE = 5;
const CHANGE_MIN_RATIO = 0.01;

function clean(value) { return String(value == null ? '' : value).trim(); }
function finite(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function validTripId(value) { return /^[A-Za-z0-9_-]{8,80}$/.test(clean(value)); }
function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function clone(value, fallback = null) { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; } }
function flightLike(leg = {}) {
  const text = `${clean(leg.mode)} ${clean(leg.transportType)}`.toLowerCase();
  if (text.includes('flight')) return true;
  return (Array.isArray(leg.segments) ? leg.segments : []).some((segment) => `${clean(segment?.mode)} ${clean(segment?.transportType)}`.toLowerCase().includes('flight'));
}
function headerValue(headers = {}, name = '') { return auth705B._internal.headerValue(headers, name); }
function normalizeOrigin(value) { return auth705B._internal.normalizeHttpsOrigin(value); }
function methodOf(event = {}) { return auth705B._internal.methodOf(event); }
function pathOf(event = {}) { return auth705B._internal.pathOf(event); }

function response(statusCode, payload, requestOrigin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Globevoy-Booking-Revalidation': VERSION
  };
  if (requestOrigin === STAGING_ORIGIN) headers['Access-Control-Allow-Origin'] = STAGING_ORIGIN;
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function preflight(event = {}) {
  const origin = normalizeOrigin(headerValue(event.headers || {}, 'origin'));
  if (origin !== STAGING_ORIGIN) return response(403, { ok: false, error: 'staging-origin-not-allowed' }, '');
  return {
    statusCode: 204,
    headers: {
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Origin': STAGING_ORIGIN,
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Max-Age': '600',
      'X-Globevoy-Booking-Revalidation': VERSION
    },
    body: ''
  };
}

function parseBody(event = {}) {
  let raw = event.body == null ? '' : String(event.body);
  if (event.isBase64Encoded === true) {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (_) { throw Object.assign(new Error('invalid-request-body'), { statusCode: 400 }); }
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw Object.assign(new Error('request-body-too-large'), { statusCode: 413 });
  let body;
  try { body = raw ? JSON.parse(raw) : {}; } catch (_) { throw Object.assign(new Error('invalid-json'), { statusCode: 400 }); }
  if (!isRecord(body)) throw Object.assign(new Error('json-object-required'), { statusCode: 400 });
  const keys = Object.keys(body);
  if (keys.some((key) => !['tripId', 'hotelGuestContext'].includes(key))) throw Object.assign(new Error('trip-id-only-request-required'), { statusCode: 400 });
  const tripId = clean(body.tripId);
  if (!validTripId(tripId)) throw Object.assign(new Error('valid-trip-id-required'), { statusCode: 400 });
  const hotelGuestContext = parseHotelGuestContext(body.hotelGuestContext);
  return hotelGuestContext ? { tripId, hotelGuestContext } : { tripId };
}

async function authenticate(event = {}, options = {}) {
  const token = (options.bearerToken || auth705B._internal.bearerToken)(event);
  const verify = options.verifyToken || auth705B.verifyCognitoAccessToken705B;
  const verified = await verify(token, { fetch: options.authFetch || globalThis.fetch, nowMs: options.nowMs });
  if (!clean(verified?.sub)) throw new auth705B.CognitoAuthError705B('subject-required');
  return verified;
}

function displayCurrency(trip = {}, tour = {}) {
  return clean(trip?.priceSnapshot?.currency || tour?.displayBudget?.currency || 'CAD').toUpperCase() || 'CAD';
}

function displayRate(tour = {}) {
  const rate = finite(tour?.displayBudget?.exchangeRateFromUsd || tour?.canonicalPricing?.exchangeRateFromUsd, 0);
  return rate > 0 ? rate : 1;
}

function compactStops(tour = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  const stays = Array.isArray(tour.stays) ? tour.stays : [];
  const cities = Array.isArray(tour.cities) ? tour.cities : [];
  const rows = stops.length ? stops : (stays.length ? stays : cities);
  return rows.map((row, index) => {
    const city = cities[index] || {};
    const hotel = isRecord(row.hotel) ? row.hotel : (isRecord(city.hotel) ? city.hotel : {});
    return {
      ...clone(city, {}),
      ...clone(row, {}),
      city: clean(row.city || city.city),
      country: clean(row.country || city.country),
      code: clean(row.code || row.airportCode || city.code || city.airportCode).toUpperCase(),
      airportCode: clean(row.airportCode || row.code || city.airportCode || city.code).toUpperCase(),
      nights: Math.max(0, Math.round(finite(row.nights ?? city.nights, 0))),
      hotel: clone(hotel, {})
    };
  });
}

function hydrateSavedTour(trip = {}) {
  const source = clone(trip?.tripSnapshot?.tour, null);
  if (!isRecord(source)) return null;
  const legs = Array.isArray(source.backendLegs) ? source.backendLegs : (Array.isArray(source.legs) ? source.legs : []);
  if (!legs.length) return null;
  const stops = compactStops(source);
  const rate = displayRate(source);
  const displayedBudget = finite(trip?.priceSnapshot?.totalBudget ?? source?.displayBudget?.totalBudget, 0);
  const displayedReserve = finite(trip?.priceSnapshot?.reserve ?? source?.displayBudget?.reserveAmount, 0);
  const routeTransportUsd = legs.reduce((sum, leg) => sum + finite(leg?.estimatedTransportUsd || leg?.estimatedFlightUsd || leg?.amountUsd, 0), 0);
  const stayUsd = stops.reduce((sum, stop) => sum + finite(stop?.hotel?.estimatedStayUsd || stop?.hotel?.totalStayUsd || stop?.estimatedStayUsd, 0), 0);
  return {
    ...source,
    legs: clone(legs, []),
    stops,
    totalBudgetUsd: displayedBudget > 0 ? displayedBudget / rate : finite(source.totalBudgetUsd, 0),
    reserveAmountUsd: displayedReserve > 0 ? displayedReserve / rate : finite(source.reserveAmountUsd, 0),
    estimatedTotalUsd: routeTransportUsd + stayUsd
  };
}

function queryForTrip(trip = {}, tour = {}) {
  const party = isRecord(tour.passengerPricing) ? tour.passengerPricing : {};
  const snapshot = trip.tripSnapshot || {};
  const partyCount = Math.max(1, finite(party.adults, snapshot.travellers || 1)) + Math.max(0, finite(party.children, 0)) + Math.max(0, finite(party.infants, 0));
  return {
    adults: Math.max(1, Math.round(finite(party.adults, snapshot.travellers || 1))),
    children: Math.max(0, Math.round(finite(party.children, 0))),
    infants: Math.max(0, Math.round(finite(party.infants, 0))),
    passengers: Math.max(1, Math.round(finite(party.travellers || party.passengers, partyCount))),
    travellers: Math.max(1, Math.round(finite(party.travellers || party.passengers, partyCount))),
    rooms: Math.max(1, Math.round(finite(party.rooms, 1))),
    // Preserve exact hotel occupancy; absent ages must fail hotel verification
    // visibly rather than silently quoting an adult-only room.
    childrenAges: clone(party.childrenAges || party.childAges || snapshot.childrenAges || snapshot.childAges, []),
    infantAges: clone(party.infantAges || snapshot.infantAges, []),
    occupancies: clone(party.occupancies || party.roomOccupancies || snapshot.occupancies, null),
    guestNationality: clean(party.guestNationality || party.nationality || snapshot.guestNationality).toUpperCase() || null,
    currency: displayCurrency(trip, tour),
    budget: finite(trip?.priceSnapshot?.totalBudget ?? tour?.displayBudget?.totalBudget, 0)
  };
}

function savedFlightDisplayTotal(trip = {}, tour = {}) {
  const explicit = finite(trip?.priceSnapshot?.flightEstimate, 0);
  if (explicit > 0) return explicit;
  const canonical = finite(tour?.canonicalPricing?.transportDisplayTotal, 0);
  if (canonical > 0) return canonical;
  const legs = Array.isArray(tour.backendLegs) ? tour.backendLegs : (Array.isArray(tour.legs) ? tour.legs : []);
  return legs.filter(flightLike).reduce((sum, leg) => sum + finite(leg.estimatedDisplayTotal || leg.partyTotalAmountDisplay || leg?.providerDateEvidence?.partyTotalAmountDisplay, 0), 0);
}

function savedTripDisplayTotal(trip = {}, tour = {}) {
  return finite(trip?.priceSnapshot?.tripEstimate ?? tour?.displayBudget?.tripEstimate ?? tour?.canonicalPricing?.canonicalDisplayTotal, 0);
}

function liveFlightDisplayTotal(tour = {}, currency = 'CAD') {
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const rate = displayRate(tour);
  return legs.filter(flightLike).reduce((sum, leg) => {
    const evidence = leg.providerDateEvidence || leg.cheapestOneWay || {};
    if (clean(evidence.displayCurrency).toUpperCase() === currency && finite(evidence.displayPrice, 0) > 0) return sum + finite(evidence.displayPrice, 0);
    if (finite(evidence.partyTotalAmountDisplay, 0) > 0) return sum + finite(evidence.partyTotalAmountDisplay, 0);
    return sum + finite(evidence.rankingPriceUsd || evidence.partyTotalAmountUsd, 0) * rate;
  }, 0);
}

function changeState(savedAmount, freshAmount) {
  const saved = finite(savedAmount, 0);
  const fresh = finite(freshAmount, 0);
  if (!(fresh > 0)) return 'unavailable';
  if (!(saved > 0)) return 'verified';
  const delta = Math.abs(fresh - saved);
  const threshold = Math.max(CHANGE_MIN_ABSOLUTE, saved * CHANGE_MIN_RATIO);
  return delta > threshold ? 'changed' : 'verified';
}

function sanitizeFlightRows(beforeTour = {}, afterTour = {}, query = {}, handoffEnabled = false, options = {}) {
  const before = Array.isArray(beforeTour.legs) ? beforeTour.legs : [];
  const after = Array.isArray(afterTour.legs) ? afterTour.legs : [];
  const enrich = options.enrichFlightLeg || enrichFlightLeg;
  const rows = [];
  for (let index = 0; index < after.length; index += 1) {
    const leg = after[index] || {};
    if (!flightLike(leg)) continue;
    const savedLeg = before[index] || {};
    const evidence = leg.providerDateEvidence || leg.cheapestOneWay || {};
    const enriched = handoffEnabled ? enrich(leg, query) : {};
    rows.push({
      index,
      origin: clean(leg?.from?.airportCode || leg?.from?.code || evidence.requestedOrigin).toUpperCase(),
      destination: clean(leg?.to?.airportCode || leg?.to?.code || evidence.requestedDestination).toUpperCase(),
      resolvedOrigin: clean(evidence.resolvedOrigin || evidence.origin || leg?.from?.airportCode || leg?.from?.code).toUpperCase(),
      resolvedDestination: clean(evidence.resolvedDestination || evidence.destination || leg?.to?.airportCode || leg?.to?.code).toUpperCase(),
      departureDate: clean(evidence.departureDate || leg.departureDate || leg.dateLabel).slice(0, 10),
      savedAmount: finite(savedLeg.estimatedDisplayTotal || savedLeg.partyTotalAmountDisplay || savedLeg?.providerDateEvidence?.partyTotalAmountDisplay, 0),
      freshAmount: finite(evidence.displayPrice || evidence.partyTotalAmountDisplay, 0),
      currency: clean(evidence.displayCurrency || query.currency).toUpperCase(),
      providerReference: clean(evidence.providerReference) || null,
      observedAt: clean(evidence.observedAt) || null,
      expiresAt: clean(evidence.expiresAt) || null,
      airportMode: clean(evidence.airportMode683H || 'EXACT'),
      sourceType: clean(evidence.sourceType || '').toUpperCase(),
      productionEligible: evidence.productionEligible === true,
      providerPassengerCount: Number.isInteger(Number(evidence.providerPassengerCount)) && Number(evidence.providerPassengerCount) > 0 ? Number(evidence.providerPassengerCount) : null,
      airlineName: clean(evidence.airline) || null,
      airlineLogoUrl: /^https:\/\//i.test(clean(evidence.airlineLogoUrl)) ? clean(evidence.airlineLogoUrl) : null,
      departureTime: clean(evidence.departureTime) || null,
      arrivalTime: clean(evidence.arrivalTime) || null,
      arrivalDate: clean(evidence.arrivalDate) || null,
      durationMinutes: evidence.durationMinutes != null && Number.isFinite(Number(evidence.durationMinutes)) ? Number(evidence.durationMinutes) : null,
      stops: evidence.stops != null && Number.isInteger(Number(evidence.stops)) ? Number(evidence.stops) : null,
      handoffEnabled: Boolean(handoffEnabled && enriched.bookingUrl),
      handoffLabel: handoffEnabled && enriched?.booking?.trust?.ctaLabel ? clean(enriched.booking.trust.ctaLabel) : null,
      handoffUrl: handoffEnabled && /^https:\/\//i.test(clean(enriched.bookingUrl)) ? clean(enriched.bookingUrl) : null,
      finalPriceRequiresPartnerConfirmation: true
    });
  }
  return rows;
}

function sanitizeHotelRows(tour = {}, query = {}, options = {}) {
  const enrich = options.enrichStay || enrichStay;
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  const rate = displayRate(tour);
  return stops.map((stop, index) => {
    const enriched = enrich(stop, query);
    const hotel = stop.hotel || {};
    const displayEstimate = finite(hotel.estimatedDisplayTotal || hotel.partyStayDisplayTotal || hotel.totalStayDisplay, 0)
      || finite(hotel.estimatedStayUsd || hotel.totalStayUsd || stop.estimatedStayUsd, 0) * rate;
    const generatedUrl = clean(enriched?.hotel?.bookingUrl || enriched?.hotel?.providerUrl || enriched?.bookingUrl || '');
    return {
      index,
      city: clean(stop.city),
      country: clean(stop.country),
      nights: Math.max(0, Math.round(finite(stop.nights, 0))),
      savedEstimate: Math.round(displayEstimate),
      currency: clean(query.currency).toUpperCase(),
      state: 'estimate',
      availabilityVerified: false,
      handoffLabel: generatedUrl ? 'Search stays on Agoda' : null,
      handoffUrl: /^https:\/\//i.test(generatedUrl) ? generatedUrl : null,
      finalPriceRequiresPartnerConfirmation: true
    };
  });
}

function unavailablePayload(trip, tour, summary, query) {
  return {
    ok: true,
    version: VERSION,
    trip: { tripId: trip.tripId, name: trip.name, kind: trip?.tripSnapshot?.kind || null, updatedAt: trip.updatedAt || null },
    snapshot: {
      capturedAt: trip?.priceSnapshot?.capturedAt || trip.updatedAt || trip.createdAt || null,
      currency: query.currency,
      savedFlightTotal: Math.round(savedFlightDisplayTotal(trip, tour)),
      savedTripTotal: Math.round(savedTripDisplayTotal(trip, tour))
    },
    revalidation: {
      state: 'unavailable',
      attempted: summary?.attempted === true,
      applied: false,
      reason: clean(summary?.reason || 'fresh-provider-verification-unavailable'),
      provider: 'Duffel',
      allFlightLegsLive: false,
      handoffEnabled: false,
      orderCapability: false,
      paymentCapability: false,
      bookingCapability: false,
      ticketingCapability: false
    },
    flights: [],
    hotels: sanitizeHotelRows(tour, query),
    trust: { savedPricesAreSnapshots: true, hotelAvailabilityVerified: false, finalPartnerConfirmationRequired: true }
  };
}

async function handleBookingRevalidation707B(event = {}, options = {}) {
  const requestOrigin = normalizeOrigin(headerValue(event.headers || {}, 'origin'));
  const env = options.env || process.env;
  if (requestOrigin !== STAGING_ORIGIN) return response(403, { ok: false, error: 'staging-origin-not-allowed' }, '');
  if (pathOf(event) !== ROUTE_PATH) return response(404, { ok: false, error: 'not-found' }, requestOrigin);
  if (methodOf(event) !== 'POST') return response(405, { ok: false, error: 'method-not-allowed' }, requestOrigin);
  if (!savedTrips705C.enabled(env)) return response(503, { ok: false, error: 'saved-trips-or-auth-not-configured' }, requestOrigin);

  let parsed;
  try { parsed = parseBody(event); } catch (error) { return response(error.statusCode || 400, { ok: false, error: error.message }, requestOrigin); }

  let verified;
  try { verified = await authenticate(event, options); }
  catch (error) {
    const reason = error instanceof auth705B.CognitoAuthError705B ? error.code : 'verification-failed';
    return response(401, { ok: false, error: 'invalid-or-expired-access-token', reason }, requestOrigin);
  }

  try {
    const getTrip = options.getTrip || ((sub, tripId) => savedTrips705C._internal.getTrip(sub, tripId, { ...options, env }));
    const trip = await getTrip(clean(verified.sub), parsed.tripId);
    if (!trip) return response(404, { ok: false, error: 'saved-trip-not-found' }, requestOrigin);
    if (trip?.tripSnapshot?.kind !== 'multi') {
      return response(200, {
        ok: true,
        version: VERSION,
        trip: { tripId: trip.tripId, name: trip.name, kind: trip?.tripSnapshot?.kind || null, updatedAt: trip.updatedAt || null },
        snapshot: { capturedAt: trip?.priceSnapshot?.capturedAt || trip.updatedAt || null, currency: clean(trip?.priceSnapshot?.currency || 'CAD').toUpperCase(), savedTripTotal: Math.round(finite(trip?.priceSnapshot?.tripEstimate, 0)) },
        revalidation: { state: 'unavailable', attempted: false, applied: false, reason: '707b-multi-city-live-revalidation-pilot-only', provider: 'Duffel', allFlightLegsLive: false, handoffEnabled: false, orderCapability: false, paymentCapability: false, bookingCapability: false, ticketingCapability: false },
        flights: [], hotels: [], trust: { savedPricesAreSnapshots: true, hotelAvailabilityVerified: false, finalPartnerConfirmationRequired: true }
      }, requestOrigin);
    }

    const tour = hydrateSavedTour(trip);
    if (!tour) return response(422, { ok: false, error: 'saved-trip-route-not-revalidatable' }, requestOrigin);
    const query = queryForTrip(trip, tour);
    const applyLiveFarePilot = options.applyLiveFarePilot || liveFare684A.applyPublicLiveFarePilot684A;
    const result = await applyLiveFarePilot(tour, query, { ...options, env, fetch: options.providerFetch || globalThis.fetch });
    const summary = result?.summary || {};
    if (summary.applied !== true || summary.allFlightLegsLive !== true) {
      return response(200, unavailablePayload(trip, tour, summary, query), requestOrigin);
    }

    const freshTour = result.tour || tour;
    const savedFlight = savedFlightDisplayTotal(trip, tour);
    const freshFlight = liveFlightDisplayTotal(freshTour, query.currency);
    const savedTrip = savedTripDisplayTotal(trip, tour);
    const delta = freshFlight - savedFlight;
    const state = changeState(savedFlight, freshFlight);
    const freshTrip = savedTrip > 0 ? Math.max(0, savedTrip + delta) : Math.max(0, finite(summary.afterTotalUsd, 0) * displayRate(tour));
    const handoffEnabled = freshFlight > 0 && summary.allFlightLegsLive === true;
    const flights = sanitizeFlightRows(tour, freshTour, query, handoffEnabled, options);
    const allHandoffsSafe = flights.length > 0 && flights.every((row) => row.sourceType === 'LIVE' && row.productionEligible === true);

    return response(200, {
      ok: true,
      version: VERSION,
      trip: { tripId: trip.tripId, name: trip.name, kind: 'multi', updatedAt: trip.updatedAt || null },
      snapshot: {
        capturedAt: trip?.priceSnapshot?.capturedAt || trip.updatedAt || trip.createdAt || null,
        currency: query.currency,
        savedFlightTotal: Math.round(savedFlight),
        savedTripTotal: Math.round(savedTrip)
      },
      revalidation: {
        state,
        attempted: summary.attempted === true,
        applied: true,
        reason: null,
        provider: 'Duffel',
        allFlightLegsLive: true,
        requiredFlightLegCount: finite(summary.requiredFlightLegCount, flights.length),
        liveFlightLegCount: finite(summary.liveFlightLegCount, flights.length),
        freshFlightTotal: Math.round(freshFlight),
        flightDelta: Math.round(delta),
        freshTripEstimate: Math.round(freshTrip),
        overBudget: summary.overBudget === true,
        observedAt: flights.map((row) => row.observedAt).filter(Boolean).sort().at(-1) || null,
        handoffEnabled: Boolean(handoffEnabled && allHandoffsSafe),
        providerRequests: finite(summary.providerRequests, 0),
        exactRequests: finite(summary.exactRequests, 0),
        metroRequests: finite(summary.metroRequests, 0),
        orderCapability: false,
        paymentCapability: false,
        bookingCapability: false,
        ticketingCapability: false
      },
      flights: allHandoffsSafe ? flights : flights.map((row) => ({ ...row, handoffEnabled: false, handoffLabel: null, handoffUrl: null })),
      hotels: sanitizeHotelRows(freshTour, query, options),
      trust: {
        savedPricesAreSnapshots: true,
        flightEvidenceFreshlyChecked: true,
        hotelAvailabilityVerified: false,
        partnerHandoffIsComparisonOnly: true,
        finalPartnerConfirmationRequired: true
      }
    }, requestOrigin);
  } catch (error) {
    if (error?.code === 'hotel-guest-context-mismatch') return response(422, { ok: false, error: 'hotel-guest-context-mismatch', reason: 'Hotel guests must match the travellers and rooms in this saved trip.' }, requestOrigin);
    console.error('GV-WEB-707B booking revalidation error', { name: error?.name, message: error?.message });
    return response(503, { ok: false, error: 'fresh-revalidation-temporarily-unavailable' }, requestOrigin);
  }
}

function status707B(env = process.env) {
  return {
    version: VERSION,
    route: ROUTE_PATH,
    environment: 'staging',
    origin: STAGING_ORIGIN,
    auth: 'verified-cognito-sub-only',
    savedTripInput: 'trip-id-only-owner-private-read',
    provider: liveFare684A.status684A(env),
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
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
    parseBody,
    validTripId,
    hydrateSavedTour,
    queryForTrip,
    savedFlightDisplayTotal,
    savedTripDisplayTotal,
    liveFlightDisplayTotal,
    changeState,
    sanitizeFlightRows,
    sanitizeHotelRows
  }
};
