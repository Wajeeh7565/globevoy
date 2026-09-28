'use strict';

// GV-PROVIDER-683D — Duffel Live shadow evidence adapter.
// This service is search/evidence only. It intentionally supports only Duffel's
// offer-request endpoint and never creates orders, payments, tickets, or bookings.

const { EVIDENCE_CLASSES_683C, RANKING_GRADES_683C } = require('../flight-provider-contract-683c');

const DUFFEL_PROVIDER_ID_683D = 'duffel-live-683d';
const DUFFEL_PROVIDER_VERSION_683D = 'GV-PROVIDER-683D';
const API_BASE_683D = 'https://api.duffel.com';
const ALLOWED_PATH_683D = '/air/offer_requests';
const MAX_RETURNED_OFFERS_683D = 2500;

function envTrue(name, env = process.env) {
  return String(env?.[name] || '').trim().toLowerCase() === 'true';
}

function enabled683D(env = process.env) {
  return envTrue('ENABLE_DUFFEL_LIVE_683D', env);
}

function shadowEnabled683D(env = process.env) {
  return enabled683D(env) && envTrue('ENABLE_DUFFEL_SHADOW_683D', env);
}

function tokenMode683D(token) {
  const value = String(token || '').trim();
  if (!value) return 'none';
  if (value.startsWith('duffel_live_')) return 'live';
  if (value.startsWith('duffel_test_')) return 'test';
  return 'unknown';
}

function descriptor683D() {
  return {
    id: DUFFEL_PROVIDER_ID_683D,
    label: 'Duffel Live Flights (683D shadow)',
    evidenceClass: EVIDENCE_CLASSES_683C.LIVE_PROVIDER,
    rankingGrade: RANKING_GRADES_683C.DECISION_GRADE,
    livePricing: true,
    referralModelCompatible: false,
    supportsExactDate: true,
    supportsFlexibleDates: false,
    supportsMultiCity: true,
    // 683D is deliberately shadow-only. Promotion to production ranking is a
    // separate release after coverage, currency, expiry, and commercial QA.
    productionApproved: false
  };
}


function headerValue683D(headers, name) {
  if (!headers || !name) return null;
  try {
    if (typeof headers.get === 'function') {
      const value = headers.get(name);
      return value == null || value === '' ? null : String(value);
    }
    const target = String(name).toLowerCase();
    for (const [key, value] of Object.entries(headers || {})) {
      if (String(key).toLowerCase() === target) return value == null || value === '' ? null : String(value);
    }
  } catch (_) {}
  return null;
}

function parseRateLimitHeaders683D(headers) {
  const limitRaw = headerValue683D(headers, 'ratelimit-limit');
  const remainingRaw = headerValue683D(headers, 'ratelimit-remaining');
  const reset = headerValue683D(headers, 'ratelimit-reset');
  const requestId = headerValue683D(headers, 'x-request-id');
  const limitNumber = limitRaw == null ? NaN : Number(limitRaw);
  const remainingNumber = remainingRaw == null ? NaN : Number(remainingRaw);
  const resetAtMs = reset ? Date.parse(reset) : NaN;
  return {
    limit: Number.isFinite(limitNumber) ? limitNumber : null,
    remaining: Number.isFinite(remainingNumber) ? remainingNumber : null,
    reset: reset || null,
    resetAtMs: Number.isFinite(resetAtMs) ? resetAtMs : null,
    requestId: requestId || null
  };
}

function safeIata(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function safeIsoDate(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function safeCurrency(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function safePositiveInteger(value, fallback = 1, max = 9) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.round(n)));
}

function safeCabin(value) {
  const v = String(value || 'economy').trim().toLowerCase();
  return ['economy', 'premium_economy', 'business', 'first'].includes(v) ? v : 'economy';
}

function parseIsoDurationMinutes(value) {
  const s = String(value || '').trim();
  const match = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const total = days * 1440 + hours * 60 + minutes;
  return total > 0 ? total : null;
}

function sliceEndpoints(slice = {}) {
  const segments = Array.isArray(slice?.segments) ? slice.segments : [];
  const first = segments[0] || {};
  const last = segments[segments.length - 1] || {};
  return {
    origin: safeIata(slice?.origin?.iata_code || slice?.origin?.iata_city_code || first?.origin?.iata_code || first?.origin?.iata_city_code),
    destination: safeIata(slice?.destination?.iata_code || slice?.destination?.iata_city_code || last?.destination?.iata_code || last?.destination?.iata_city_code),
    departureDate: safeIsoDate(first?.departing_at || slice?.departing_at),
    first,
    last,
    segments
  };
}

function offerStops683D(offer = {}) {
  const slices = Array.isArray(offer?.slices) ? offer.slices : [];
  return slices.reduce((sum, slice) => sum + Math.max(0, (Array.isArray(slice?.segments) ? slice.segments.length : 0) - 1), 0);
}

function offerDurationMinutes683D(offer = {}) {
  const slices = Array.isArray(offer?.slices) ? offer.slices : [];
  const total = slices.reduce((sum, slice) => sum + (parseIsoDurationMinutes(slice?.duration) || 0), 0);
  return total > 0 ? total : null;
}

function notExpired683D(expiresAt, nowMs = Date.now()) {
  const ts = Date.parse(String(expiresAt || ''));
  if (!Number.isFinite(ts)) return false;
  // Small safety margin so an offer that is about to expire is not promoted as
  // usable evidence during the rest of the request lifecycle.
  return ts > nowMs + 30000;
}

function validateExactSearch683D(input = {}) {
  const origin = safeIata(input.origin);
  const destination = safeIata(input.destination);
  const departureDate = safeIsoDate(input.departureDate || input.date);
  const requestedCurrency = safeCurrency(input.currency || 'USD');
  const passengers = safePositiveInteger(input.passengers || input.adults || 1, 1, 9);
  const errors = [];
  if (!origin) errors.push('invalid-origin');
  if (!destination) errors.push('invalid-destination');
  if (origin && destination && origin === destination) errors.push('same-origin-destination');
  if (!departureDate) errors.push('invalid-departure-date');
  if (!requestedCurrency) errors.push('invalid-currency');
  return {
    valid: errors.length === 0,
    errors,
    request: { origin, destination, departureDate, currency: requestedCurrency, passengers, cabinClass: safeCabin(input.cabinClass || input.cabin_class) }
  };
}

function exactOfferMatch683D(offer = {}, request = {}) {
  const slices = Array.isArray(offer?.slices) ? offer.slices : [];
  if (slices.length !== 1) return false;
  const endpoints = sliceEndpoints(slices[0]);
  return endpoints.origin === request.origin
    && endpoints.destination === request.destination
    && endpoints.departureDate === request.departureDate;
}

function normalizeLiveOffer683D(offer = {}, request = {}, context = {}) {
  if (offer?.live_mode !== true || context.requestLiveMode !== true) return null;
  if (!exactOfferMatch683D(offer, request)) return null;
  if (!notExpired683D(offer?.expires_at, context.nowMs)) return null;

  const slices = Array.isArray(offer?.slices) ? offer.slices : [];
  const endpoint = sliceEndpoints(slices[0] || {});
  const amount = Number(offer?.total_amount);
  const currency = safeCurrency(offer?.total_currency);
  if (!Number.isFinite(amount) || amount <= 0 || !currency) return null;

  return {
    origin: request.origin,
    destination: request.destination,
    departureDate: request.departureDate,
    currency,
    // Duffel documents offer.total_amount as the total price for ALL passengers.
    // Preserve that semantic explicitly so downstream traveller-pricing never
    // applies a second passenger multiplier to live Duffel evidence.
    totalPrice: amount,
    fareAmountBasis: 'party-total',
    providerPartyTotalAmount: amount,
    passengers: request.passengers,
    providerPassengerCount: request.passengers,
    airline: offer?.owner?.name || endpoint.first?.operating_carrier?.name || endpoint.first?.marketing_carrier?.name || null,
    stops: offerStops683D(offer),
    durationMinutes: offerDurationMinutes683D(offer),
    deeplink: null,
    observedAt: context.retrievedAt,
    providerReference: offer?.id || null,
    expiresAt: offer?.expires_at || null,
    liveMode: true,
    providerEndpoint: ALLOWED_PATH_683D,
    departureTime: String(endpoint.first?.departing_at || '').slice(11, 16) || null,
    arrivalTime: String(endpoint.last?.arriving_at || '').slice(11, 16) || null,
    // Keep the destination-local arrival day: overnight flights change hotel check-in.
    arrivalDate: String(endpoint.last?.arriving_at || '').slice(0, 10) || null,
    airlineLogoUrl: offer?.owner?.logo_symbol_url || offer?.owner?.logo_lockup_url || null,
    flightNumber: endpoint.first?.operating_carrier_flight_number || endpoint.first?.marketing_carrier_flight_number || null,
    requestedCurrency: request.currency,
    currencyMismatch: currency !== request.currency,
    source: DUFFEL_PROVIDER_ID_683D,
    rawMeta: {
      ownerIata: offer?.owner?.iata_code || null,
      sliceCount: slices.length,
      responseTimeMs: context.responseTimeMs,
      resultCount: context.resultCount,
      fareAmountBasis: 'party-total',
      providerPassengerCount: request.passengers
    }
  };
}

function makeUnavailable683D(reason, extra = {}) {
  return {
    supported: false,
    reason,
    observations: [],
    shadowOnly: true,
    providerVersion: DUFFEL_PROVIDER_VERSION_683D,
    ...extra
  };
}

async function searchExactDate683D(args = {}, options = {}) {
  const env = options.env || process.env;
  if (!shadowEnabled683D(env) && options.allowWithoutShadowFlag !== true) {
    return makeUnavailable683D('duffel-683d-shadow-disabled');
  }

  const validation = validateExactSearch683D(args);
  if (!validation.valid) return makeUnavailable683D(validation.errors[0] || 'invalid-request', { validationErrors: validation.errors });

  const token = String(env.DUFFEL_ACCESS_TOKEN || '').trim();
  const tokenMode = tokenMode683D(token);
  if (tokenMode !== 'live') {
    return makeUnavailable683D(tokenMode === 'none' ? 'duffel-live-token-required' : 'duffel-live-token-required-not-test-token', { tokenMode });
  }

  const fetchImpl = options.fetch || args._fetchFn || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return makeUnavailable683D('fetch-unavailable');

  const request = validation.request;
  const endpoint = `${API_BASE_683D}${ALLOWED_PATH_683D}?return_offers=true&supplier_timeout=10000&view=offers`;
  const started = Date.now();
  let response;
  let payload;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Duffel-Version': 'v2',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        data: {
          cabin_class: request.cabinClass,
          max_connections: 2,
          slices: [{ origin: request.origin, destination: request.destination, departure_date: request.departureDate }],
          passengers: Array.from({ length: request.passengers }, () => ({ type: 'adult' }))
        }
      })
    });
    const rateLimit = parseRateLimitHeaders683D(response?.headers);
    const text = await response.text();
    try { payload = text ? JSON.parse(text) : {}; }
    catch (_) { return makeUnavailable683D(`duffel-non-json-http-${response.status}`, { statusCode: response.status, requestCount: 1, rateLimit }); }
    if (!response.ok) {
      const firstError = payload?.errors?.[0] || {};
      return makeUnavailable683D(firstError.message || `duffel-http-${response.status}`, {
        statusCode: response.status,
        errorCode: firstError.code || null,
        errorType: firstError.type || null,
        requestCount: 1,
        responseTimeMs: Date.now() - started,
        rateLimit
      });
    }
  } catch (error) {
    return makeUnavailable683D(`duffel-request-error:${String(error?.message || 'unknown')}`, {
      requestCount: 1,
      responseTimeMs: Date.now() - started
    });
  }

  const offers = Array.isArray(payload?.data?.offers) ? payload.data.offers.slice(0, MAX_RETURNED_OFFERS_683D) : [];
  const retrievedAt = new Date().toISOString();
  const nowMs = Date.parse(retrievedAt);
  const context = {
    requestLiveMode: payload?.data?.live_mode === true,
    retrievedAt,
    nowMs,
    responseTimeMs: Date.now() - started,
    resultCount: offers.length
  };
  const observations = offers.map(offer => normalizeLiveOffer683D(offer, request, context)).filter(Boolean);

  return {
    supported: observations.length > 0,
    reason: observations.length > 0 ? null : (context.requestLiveMode ? 'no-valid-exact-live-offers' : 'duffel-live-mode-not-confirmed'),
    observations,
    shadowOnly: true,
    providerVersion: DUFFEL_PROVIDER_VERSION_683D,
    requestCount: 1,
    statusCode: response?.status || 200,
    responseTimeMs: context.responseTimeMs,
    rateLimit: parseRateLimitHeaders683D(response?.headers),
    requestLiveMode: context.requestLiveMode,
    rawOfferCount: offers.length,
    acceptedOfferCount: observations.length,
    requestedCurrency: request.currency,
    returnedCurrencies: [...new Set(observations.map(row => row.currency))],
    currencyMismatchObserved: observations.some(row => row.currencyMismatch === true),
    allowedEndpoint: ALLOWED_PATH_683D,
    secretFieldsReturned: false
  };
}

// 683D is deliberately not wired into ranking/P2. The provider-neutral registry
// can see the adapter, but its standard search methods fail closed. Shadow QA must
// call searchExactDate683D (via the guarded shadow endpoint or local smoke).
async function searchMonth683D() {
  return makeUnavailable683D('duffel-683d-shadow-only-not-ranking-enabled');
}

async function searchAcrossMonths683D() {
  return makeUnavailable683D('duffel-683d-shadow-only-not-ranking-enabled');
}

function status683D(env = process.env) {
  return {
    version: DUFFEL_PROVIDER_VERSION_683D,
    providerId: DUFFEL_PROVIDER_ID_683D,
    enabled: enabled683D(env),
    shadowEnabled: shadowEnabled683D(env),
    tokenMode: tokenMode683D(env.DUFFEL_ACCESS_TOKEN),
    allowedEndpoint: ALLOWED_PATH_683D,
    productionApproved: false,
    rankingEnabled: false,
    orderCapability: false,
    paymentCapability: false,
    ticketingCapability: false,
    secretValuesReturned: false
  };
}

module.exports = {
  DUFFEL_PROVIDER_ID_683D,
  DUFFEL_PROVIDER_VERSION_683D,
  API_BASE_683D,
  ALLOWED_PATH_683D,
  enabled683D,
  shadowEnabled683D,
  tokenMode683D,
  descriptor683D,
  headerValue683D,
  parseRateLimitHeaders683D,
  validateExactSearch683D,
  parseIsoDurationMinutes,
  notExpired683D,
  exactOfferMatch683D,
  normalizeLiveOffer683D,
  searchExactDate683D,
  searchMonth683D,
  searchAcrossMonths683D,
  status683D
};
