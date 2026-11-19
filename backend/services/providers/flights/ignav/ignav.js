'use strict';

// GV-FLIGHT-IGNAV-001 — Ignav live flight fare adapter (read-only).
//
// Ignav (https://ignav.com/docs) returns live one-way fares and, per itinerary,
// an opaque `ignav_id` that can be exchanged for airline/OTA booking links.
//
// Boundaries:
// - Search and booking-link lookup only. No orders, payments or ticketing.
// - The API key is read server-side from IGNAV_API_KEY and never returned.
// - Ignav booking links do NOT pay a referral commission; callers must label
//   them honestly and may add a separate affiliate comparison link.
// - Prices are returned in the currency of the requested `market`; we never
//   relabel them. `price.status` "unverified" amounts are not treated as fares.
// - Disabled unless ENABLE_IGNAV_FLIGHTS=true, so deploying this file changes
//   nothing until the flag is set.

const { createHmac, timingSafeEqual } = require('node:crypto');
const VERSION = 'GV-FLIGHT-IGNAV-001';
const BASE_URL = 'https://ignav.com/api';
const DEFAULT_TIMEOUT_MS = 15000;
const MARKET_BY_CURRENCY = Object.freeze({ CAD: 'CA', USD: 'US', GBP: 'GB', EUR: 'DE', AUD: 'AU' });

function clean(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function iata(value) { const code = upper(value); return /^[A-Z]{3}$/.test(code) ? code : null; }
function isoDate(value) {
  const text = clean(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}
function boundedInt(value, fallback, min, max) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function safeHttpsUrl(value) {
  const text = clean(value);
  try { const url = new URL(text); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null; }
  catch (_) { return null; }
}

function enabled(env = process.env) {
  return clean(env.ENABLE_IGNAV_FLIGHTS).toLowerCase() === 'true';
}

function configured(env = process.env) {
  return enabled(env) && clean(env.IGNAV_API_KEY).length > 0;
}

function marketFor({ market, currency } = {}) {
  const explicit = upper(market);
  if (/^[A-Z]{2}$/.test(explicit)) return explicit;
  return MARKET_BY_CURRENCY[upper(currency)] || 'US';
}

class IgnavError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.name = 'IgnavError';
    this.code = code;
    this.status = status;
  }
}

// Local circuit breaker, not an account-wide billing cap. Limits reset on cold start.
function createGuard(clock = Date.now) {
  let minute = [], hour = [], blockedUntil = 0;
  return {
    reserve() {
      const now = clock(); minute = minute.filter(t => t > now - 60000); hour = hour.filter(t => t > now - 3600000);
      if (now < blockedUntil || minute.length >= 10 || hour.length >= 60) return false;
      minute.push(now); hour.push(now); return true;
    },
    block() { blockedUntil = clock() + 60000; }
  };
}
const guard = createGuard();
function bookingProof(id, env, seconds = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', clean(env.IGNAV_API_KEY)).update(`ignav-booking:${id}:${seconds}`).digest('hex');
  return `${seconds}.${signature}`;
}
function validProof(id, proof, env) {
  if (typeof proof !== 'string' || !/^\d{10}\.[a-f0-9]{64}$/.test(proof)) return false;
  const seconds = Number(proof.split('.')[0]);
  const age = Math.floor(Date.now() / 1000) - seconds;
  return age >= 0 && age <= 900 && timingSafeEqual(Buffer.from(proof), Buffer.from(bookingProof(id, env, seconds)));
}

async function postJson(path, body, { env = process.env, fetchFn = globalThis.fetch, timeoutMs, requestGuard = guard } = {}) {
  if (!configured(env)) throw new IgnavError('ignav-not-configured', 'Ignav is disabled or IGNAV_API_KEY is missing.');
  if (typeof fetchFn !== 'function') throw new IgnavError('fetch-unavailable', 'fetch is not available.');
  if (!requestGuard.reserve()) throw new IgnavError('ignav-local-quota-exhausted', 'Live prices are temporarily limited.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedInt(timeoutMs ?? env.IGNAV_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 30000));
  let response;
  try {
    response = await fetchFn(`${BASE_URL}${path}`, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': clean(env.IGNAV_API_KEY) },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    throw new IgnavError(error?.name === 'AbortError' ? 'ignav-timeout' : 'ignav-network-error', 'Ignav request failed.');
  }
  if (response.status === 429) requestGuard.block();
  let text;
  try { text = await response.text(); } catch (_) { throw new IgnavError('ignav-invalid-response', 'Ignav response could not be read.'); } finally { clearTimeout(timer); }
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = null; }
  if (!response.ok) {
    // Never echo the raw body: it could contain request details.
    const code = response.status === 402 ? 'ignav-billing-required'
      : response.status === 401 || response.status === 403 ? 'ignav-unauthorized'
        : response.status === 429 ? 'ignav-rate-limited'
          : 'ignav-http-error';
    throw new IgnavError(code, `Ignav returned HTTP ${response.status}.`, response.status);
  }
  if (!payload || typeof payload !== 'object') throw new IgnavError('ignav-invalid-json', 'Ignav returned an invalid response.');
  return payload;
}

function normalizeSegment(segment = {}) {
  const dep = segment.departure || {};
  const arr = segment.arrival || {};
  return {
    carrierCode: upper(segment.marketing_carrier_code || segment.carrier_code || segment.marketing_carrier) || null,
    flightNumber: clean(segment.flight_number) || null,
    operatingCarrier: clean(segment.operating_carrier_name || segment.operating_carrier) || null,
    from: iata(segment.departure_airport || dep.airport || dep.airport_code || segment.origin) || null,
    to: iata(segment.arrival_airport || arr.airport || arr.airport_code || segment.destination) || null,
    departLocal: clean(segment.departure_time_local || dep.local_time || dep.time || segment.departure_time) || null,
    arriveLocal: clean(segment.arrival_time_local || arr.local_time || arr.time || segment.arrival_time) || null,
    durationMinutes: Number.isFinite(Number(segment.duration_minutes)) ? Number(segment.duration_minutes) : null
  };
}

function normalizeItinerary(itinerary = {}, request = {}) {
  const price = itinerary.price || {};
  const amount = Number(price.amount);
  const status = clean(price.status).toLowerCase() || 'unknown';
  const outbound = itinerary.outbound || (Array.isArray(itinerary.legs) ? itinerary.legs[0] : null) || {};
  const segments = (Array.isArray(outbound.segments) ? outbound.segments : []).map(segment => normalizeSegment(segment || {}));
  const matched = segments.length > 0 && segments[0].from === request.origin && segments.at(-1).to === request.destination &&
    isoDate(segments[0].departLocal) === request.departureDate &&
    segments.every((segment, i) => segment.from && segment.to && segment.from !== segment.to &&
      (!i || segments[i-1].to === segment.from));
  const party = itinerary.adults == null && itinerary.children == null && itinerary.passengers == null ||
    (itinerary.passengers != null ? Number(itinerary.passengers) === request.passengers :
      Number(itinerary.adults || 0) === request.adults && Number(itinerary.children || 0) === request.children);
  const usable = !itinerary.inbound && (!Array.isArray(itinerary.legs) || itinerary.legs.length === 1) && status === 'verified' && Number.isFinite(amount) && amount > 0 && /^[A-Z]{3}$/.test(upper(price.currency)) && matched && party;
  return {
    provider: 'ignav',
    version: VERSION,
    ignavId: clean(itinerary.ignav_id) || null,
    origin: request.origin,
    destination: request.destination,
    departureDate: request.departureDate,
    // Ignav prices are for the whole requested party, in the market currency.
    partyTotalAmount: Number.isFinite(amount) ? amount : null,
    currency: upper(price.currency) || null,
    priceStatus: status,
    usableFare: usable,
    passengers: request.passengers,
    carrier: clean(outbound.carrier || outbound.carrier_name) || null,
    durationMinutes: Number.isFinite(Number(outbound.duration_minutes)) ? Number(outbound.duration_minutes) : null,
    stops: segments.length > 0 ? segments.length - 1 : null,
    segments,
    cabinClass: clean(itinerary.cabin_class) || null,
    checkedBagsPerAdult: Number.isFinite(Number(itinerary?.bags?.checked)) ? Number(itinerary.bags.checked) : null,
    sourceType: usable ? 'live' : 'unavailable'
  };
}

/**
 * Live one-way fares for one route and date.
 * Returns { ok, observedAt, market, itineraries[], cheapest } — never throws for
 * provider failures; errors come back as { ok:false, reason }.
 */
async function searchOneWay(input = {}, options = {}) {
  const origin = iata(input.origin);
  const destination = iata(input.destination);
  const departureDate = isoDate(input.departureDate || input.departure_date);
  if (!origin || !destination || !departureDate || origin === destination) {
    return { ok: false, version: VERSION, reason: 'invalid-route-or-date' };
  }
  const adults = boundedInt(input.adults ?? input.passengers, 1, 1, 9);
  const children = boundedInt(input.children, 0, 0, 8);
  if (adults + children > 9) return { ok: false, version: VERSION, reason: 'too-many-passengers' };
  const market = marketFor(input);
  const body = { origin, destination, departure_date: departureDate, adults, children, market };
  if (input.maxStops !== undefined && input.maxStops !== null) body.max_stops = boundedInt(input.maxStops, 2, 0, 2);
  if (input.cabinClass) body.cabin_class = clean(input.cabinClass).toLowerCase();

  let payload;
  try { payload = await postJson('/fares/one-way', body, options); }
  catch (error) { return { ok: false, version: VERSION, reason: error.code || 'ignav-error', status: error.status || null }; }

  const observed = Date.parse(payload.observed_at);
  if (!Number.isFinite(observed) || Date.now() - observed > 900000 || observed - Date.now() > 60000)
    return { ok: false, reason: 'ignav-stale-or-missing-observation' };
  const request = { origin, destination, departureDate, adults, children, passengers: adults + children };
  if ((payload.origin != null && iata(payload.origin) !== origin) ||
      (payload.destination != null && iata(payload.destination) !== destination) ||
      (payload.departure_date != null && isoDate(payload.departure_date) !== departureDate) ||
      (payload.adults != null && Number(payload.adults) !== adults) ||
      (payload.children != null && Number(payload.children) !== children))
    return { ok: false, reason: 'ignav-response-identity-mismatch' };
  const itineraries = (Array.isArray(payload.itineraries) ? payload.itineraries : []).filter(row => row && typeof row === 'object').map(row => { const fare = normalizeItinerary(row, request); if (fare.usableFare && fare.ignavId) fare.bookingProof = bookingProof(fare.ignavId, options.env || process.env); return fare; });
  const usable = itineraries.filter(row => row.usableFare).sort((a, b) => a.partyTotalAmount - b.partyTotalAmount);
  return {
    ok: true,
    version: VERSION,
    market,
    observedAt: clean(payload.observed_at) || null,
    request,
    itineraryCount: itineraries.length,
    usableCount: usable.length,
    cheapest: usable[0] || null,
    itineraries
  };
}

function normalizeBookingLink(link = {}) {
  const url = safeHttpsUrl(link.url);
  if (!url) return null;
  const amount = Number(link?.price?.amount ?? link.price);
  return {
    providerName: clean(link.provider_name) || 'Booking site',
    providerType: clean(link.provider_type) || null,
    fareName: clean(link.fare_name) || null,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: upper(link?.price?.currency) || null,
    // exact_flight = flight preselected; search_results = route/date results page.
    specificity: clean(link.specificity) || 'unknown',
    url,
    commissionEarned: false
  };
}

/** Booking links for one itinerary returned by searchOneWay (same account). */
async function getBookingLinks(ignavId, options = {}) {
  const id = clean(ignavId);
  if (!validProof(id, options.proof, options.env || process.env)) return { ok: false, reason: 'invalid-or-expired-booking-proof' };
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) return { ok: false, version: VERSION, reason: 'invalid-ignav-id' };
  let payload;
  try { payload = await postJson('/fares/booking-links', { ignav_id: id }, options); }
  catch (error) { return { ok: false, version: VERSION, reason: error.code || 'ignav-error', status: error.status || null }; }
  const groups = Array.isArray(payload.booking_options) ? payload.booking_options : [];
  const links = groups.flatMap(group => (Array.isArray(group?.links) ? group.links : [])
    .map(normalizeBookingLink).filter(Boolean)
    .map(link => ({ ...link, legs: group.legs || null, legIndexes: group.leg_indexes || null })));
  // Prefer links that preselect the exact flight, then the cheapest.
  links.sort((a, b) => (a.specificity === 'exact_flight' ? 0 : 1) - (b.specificity === 'exact_flight' ? 0 : 1)
    || (a.amount ?? Infinity) - (b.amount ?? Infinity));
  return {
    ok: true,
    version: VERSION,
    linkCount: links.length,
    exactFlightLinkCount: links.filter(link => link.specificity === 'exact_flight').length,
    // Ignav's `specificity` is optional; when omitted we cannot claim the link preselects the flight.
    unknownSpecificityCount: links.filter(link => link.specificity === 'unknown').length,
    airlineDirectCount: links.filter(link => link.providerType === 'airline').length,
    cheapestLink: links.filter(link => link.amount != null).sort((a, b) => a.amount - b.amount)[0] || null,
    links,
    disclosure: 'Booking links come from Ignav and do not earn a referral commission; final price is confirmed on the booking site.'
  };
}

function status(env = process.env) {
  return {
    version: VERSION,
    enabled: enabled(env),
    configured: configured(env),
    provider: 'ignav',
    sourceType: 'live',
    commissionOnBookingLinks: false,
    orderCapability: false,
    paymentCapability: false
  };
}

module.exports = {
  VERSION,
  enabled,
  configured,
  status,
  searchOneWay,
  getBookingLinks,
  IgnavError,
  _internal: { createGuard, bookingProof, validProof, marketFor, normalizeItinerary, normalizeBookingLink, normalizeSegment }
};
