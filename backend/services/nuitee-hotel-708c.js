'use strict';

// GV-HOTEL-708C — staging-only Nuitee live hotel evidence adapter.
//
// Trust/safety boundary:
// - disabled unless ENABLE_NUITEE_HOTEL_708C=true;
// - reads only a Secrets Manager identifier from Lambda configuration;
// - reads the sandbox API key server-side and never returns or logs it;
// - performs Rates -> PREBOOK only; there is deliberately no BOOK/payment code;
// - never returns provider offer/prebook IDs or raw provider responses;
// - individual provider failures fail closed to the caller's saved estimate.

const worldwide701A = require('./worldwide-city-registry-701a');

const VERSION = 'GV-HOTEL-708C';
const RATE_URL = 'https://api.liteapi.travel/v3.0/hotels/rates';
const PREBOOK_URL = 'https://book.liteapi.travel/v3.0/rates/prebook';
const FLAG = 'ENABLE_NUITEE_HOTEL_708C';
const SECRET_ENV = 'NUITEE_SANDBOX_SECRET_ID';
const DEFAULT_REGION = 'us-east-2';
const MAX_STOPS = 3;
const TIMEOUT_MS = 25000;

let secretsSdk = null;
let secretsClient = null;
let cachedSecretId = '';
let cachedApiKey = '';

function clean(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function finite(value, fallback = null) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function enabled(env = process.env) { return clean(env[FLAG]).toLowerCase() === 'true'; }
function validCountryCode(value) { const code = upper(value); return /^[A-Z]{2}$/.test(code) ? code : ''; }
function validIsoDate(value) { const text = clean(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T12:00:00Z`)) ? text : ''; }
function safeHttpsUrl(value) { const text = clean(value); return /^https:\/\//i.test(text) ? text : ''; }
function clone(value, fallback = null) { try { return JSON.parse(JSON.stringify(value)); } catch (_) { return fallback; } }

function dateMinusDays(isoDate, days) {
  const value = validIsoDate(isoDate);
  if (!value) return '';
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - Math.max(0, Math.round(finite(days, 0) || 0)));
  return date.toISOString().slice(0, 10);
}

function departureDate(leg = {}) {
  return validIsoDate(
    leg?.providerDateEvidence?.departureDate
      || leg?.departureDate
      || leg?.departOn
      || leg?.date
      || leg?.dateLabel
  );
}

function deriveStayWindow(tour = {}, stop = {}, index = 0) {
  const explicitCheckin = validIsoDate(stop.checkin || stop.checkIn || stop.arrivalDate);
  const explicitCheckout = validIsoDate(stop.checkout || stop.checkOut || stop.departureDate);
  const nights = Math.max(1, Math.round(finite(stop.nights, 1) || 1));
  if (explicitCheckin && explicitCheckout && explicitCheckout > explicitCheckin) {
    return { checkin: explicitCheckin, checkout: explicitCheckout, nights, dateBasis: 'saved-stay-dates' };
  }

  // For stop N, leg N+1 is the flight leaving that stop. Its departure date is
  // the safest checkout anchor available in compact Saved Trips. Deriving
  // check-in by subtracting the saved night count avoids treating an overnight
  // inbound flight's departure date as a hotel-arrival date.
  const legs = Array.isArray(tour.legs) ? tour.legs : (Array.isArray(tour.backendLegs) ? tour.backendLegs : []);
  const checkout = departureDate(legs[index + 1] || {});
  const checkin = checkout ? dateMinusDays(checkout, nights) : '';
  if (checkin && checkout && checkout > checkin) {
    return { checkin, checkout, nights, dateBasis: 'saved-nights-plus-outbound-date' };
  }
  return { checkin: '', checkout: '', nights, dateBasis: 'unavailable' };
}

function resolveCountryCode(stop = {}) {
  const direct = validCountryCode(stop.countryCode || stop.isoCountryCode);
  if (direct) return direct;
  for (const candidate of [stop.airportCode, stop.code, stop.city]) {
    const resolved = worldwide701A.resolveWorldwideCity(clean(candidate));
    const code = validCountryCode(resolved?.countryCode);
    if (code) return code;
  }
  return '';
}

function firstImageUrl(value, depth = 0, keyHint = '') {
  if (!value || depth > 6) return '';
  if (typeof value === 'string') {
    const url = safeHttpsUrl(value);
    if (!url) return '';
    if (/(photo|image|thumbnail|main)/i.test(keyHint) || /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) return url;
    return '';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstImageUrl(item, depth + 1, keyHint);
      if (found) return found;
    }
    return '';
  }
  if (typeof value !== 'object') return '';
  const preferred = Object.entries(value).sort(([a], [b]) => {
    const ar = /(main.?photo|main.?image|thumbnail|photo|image)/i.test(a) ? 0 : 1;
    const br = /(main.?photo|main.?image|thumbnail|photo|image)/i.test(b) ? 0 : 1;
    return ar - br;
  });
  for (const [key, item] of preferred) {
    const found = firstImageUrl(item, depth + 1, key);
    if (found) return found;
  }
  return '';
}

function providerHotelId(hotel = {}) { return clean(hotel.hotelId || hotel.id); }
function hotelName(hotel = {}) { return clean(hotel.name || hotel.hotelName || hotel?.hotel?.name || hotel?.hotel?.hotelName); }
function hotelRating(hotel = {}) { return finite(hotel.rating ?? hotel.reviewScore ?? hotel?.hotel?.rating, null); }
function hotelAddress(hotel = {}) {
  const value = hotel.address || hotel?.hotel?.address;
  if (typeof value === 'string') return clean(value);
  if (!value || typeof value !== 'object') return '';
  const parts = [value.address, value.addressLine, value.line1, value.line2, value.city, value.cityName, value.state, value.stateCode, value.postalCode, value.countryCode]
    .map(clean).filter(Boolean);
  return [...new Set(parts)].join(', ');
}

function offerFromRoomType(rateHotel = {}, roomType = {}, contentHotel = null) {
  const rate = Array.isArray(roomType.rates) ? roomType.rates[0] : null;
  const offerRetail = roomType.offerRetailRate || {};
  const rateTotal = rate?.retailRate?.total?.[0] || {};
  const amount = finite(offerRetail.amount, null) ?? finite(rateTotal.amount, null);
  const currency = upper(offerRetail.currency || rateTotal.currency);
  const fees = Array.isArray(rate?.retailRate?.taxesAndFees) ? rate.retailRate.taxesAndFees : [];
  const identity = contentHotel || rateHotel;
  return {
    offerId: clean(roomType.offerId),
    hotelName: hotelName(identity),
    address: hotelAddress(identity),
    rating: hotelRating(identity),
    photoUrl: firstImageUrl(identity),
    amount,
    currency,
    roomName: clean(rate?.name),
    boardName: clean(rate?.boardName || rate?.boardType),
    refundableTag: clean(rate?.cancellationPolicies?.refundableTag) || 'UNKNOWN',
    cancellationDetailsPresent: Array.isArray(rate?.cancellationPolicies?.cancelPolicyInfos),
    taxesAndFeesPresent: Array.isArray(rate?.retailRate?.taxesAndFees),
    excludedFeesPresent: fees.some((fee) => fee?.included === false)
  };
}

function selectOffer(payload = {}) {
  const rateHotels = Array.isArray(payload.data) ? payload.data : [];
  const contentHotels = Array.isArray(payload.hotels) ? payload.hotels : [];
  const contentById = new Map(contentHotels.map((hotel) => [providerHotelId(hotel), hotel]).filter(([id]) => Boolean(id)));
  const offers = [];
  for (const rateHotel of rateHotels) {
    const content = contentById.get(providerHotelId(rateHotel)) || null;
    for (const roomType of Array.isArray(rateHotel.roomTypes) ? rateHotel.roomTypes : []) {
      offers.push(offerFromRoomType(rateHotel, roomType, content));
    }
  }
  const valid = offers.filter((offer) => offer.offerId && offer.amount !== null && offer.amount > 0 && offer.currency);
  valid.sort((a, b) => a.amount - b.amount);
  return valid.find((offer) => offer.refundableTag === 'RFN') || valid[0] || null;
}

function prebookPrice(payload = {}) {
  const data = payload.data || {};
  const direct = finite(data.price, null);
  if (direct !== null) return { amount: direct, currency: upper(data.currency) };
  let amount = 0;
  let currency = '';
  let found = false;
  for (const roomType of Array.isArray(data.roomTypes) ? data.roomTypes : []) {
    for (const rate of Array.isArray(roomType.rates) ? roomType.rates : []) {
      const total = rate?.retailRate?.total?.[0] || {};
      const next = finite(total.amount, null);
      if (next !== null) {
        amount += next;
        currency ||= upper(total.currency);
        found = true;
      }
    }
  }
  return found ? { amount, currency } : { amount: null, currency: '' };
}

function prebookEvidence(payload = {}) {
  const data = payload.data || {};
  let refundableTag = '';
  let cancellationDetailsPresent = false;
  let taxesAndFeesPresent = false;
  let excludedFeesPresent = false;
  for (const roomType of Array.isArray(data.roomTypes) ? data.roomTypes : []) {
    for (const rate of Array.isArray(roomType.rates) ? roomType.rates : []) {
      refundableTag ||= clean(rate?.cancellationPolicies?.refundableTag);
      cancellationDetailsPresent ||= Array.isArray(rate?.cancellationPolicies?.cancelPolicyInfos);
      const fees = rate?.retailRate?.taxesAndFees;
      taxesAndFeesPresent ||= Array.isArray(fees);
      if (Array.isArray(fees)) excludedFeesPresent ||= fees.some((fee) => fee?.included === false);
    }
  }
  return { refundableTag: refundableTag || 'UNKNOWN', cancellationDetailsPresent, taxesAndFeesPresent, excludedFeesPresent };
}

function parseSecretValue(secretValue) {
  const raw = clean(secretValue);
  if (!raw) return '';
  if (raw.startsWith('sand_')) return raw;
  try {
    const parsed = JSON.parse(raw);
    for (const key of ['apiKey', 'sandboxApiKey', 'NUITEE_SANDBOX_API_KEY']) {
      const value = clean(parsed?.[key]);
      if (value.startsWith('sand_')) return value;
    }
  } catch (_) {}
  return '';
}

async function getApiKey(env = process.env, options = {}) {
  if (clean(options.apiKey).startsWith('sand_')) return clean(options.apiKey);
  const secretId = clean(options.secretId || env[SECRET_ENV]);
  if (!secretId) throw Object.assign(new Error('nuitee-secret-not-configured'), { code: 'secret-not-configured' });
  if (cachedSecretId === secretId && cachedApiKey) return cachedApiKey;

  let secretValue = '';
  if (typeof options.getSecretValue === 'function') {
    secretValue = await options.getSecretValue(secretId);
  } else {
    if (!secretsSdk) secretsSdk = require('@aws-sdk/client-secrets-manager');
    if (!secretsClient) {
      secretsClient = new secretsSdk.SecretsManagerClient({ region: clean(env.AWS_REGION || env.AWS_DEFAULT_REGION || DEFAULT_REGION) });
    }
    const result = await secretsClient.send(new secretsSdk.GetSecretValueCommand({ SecretId: secretId }));
    secretValue = result?.SecretString || (result?.SecretBinary ? Buffer.from(result.SecretBinary).toString('utf8') : '');
  }

  const apiKey = parseSecretValue(secretValue);
  if (!apiKey) throw Object.assign(new Error('nuitee-sandbox-key-invalid'), { code: 'invalid-secret' });
  cachedSecretId = secretId;
  cachedApiKey = apiKey;
  return apiKey;
}

async function postJson(url, body, apiKey, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch-unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), finite(options.timeoutMs, TIMEOUT_MS) || TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); } catch (_) { payload = null; }
    }
    return { status: response.status, latencyMs: Date.now() - started, payload };
  } finally {
    clearTimeout(timer);
  }
}

function searchBody(stop, query, stayWindow, countryCode, env = process.env) {
  const adults = Math.max(1, Math.min(2, Math.round(finite(query.adults || query.travellers, 1) || 1)));
  const guestNationality = validCountryCode(env.NUITEE_GUEST_NATIONALITY) || 'CA';
  return {
    occupancies: [{ adults }],
    currency: upper(query.currency || 'CAD') || 'CAD',
    guestNationality,
    checkin: stayWindow.checkin,
    checkout: stayWindow.checkout,
    cityName: clean(stop.city),
    countryCode,
    timeout: 10,
    limit: 8,
    maxRatesPerHotel: 1,
    roomMapping: true,
    includeHotelData: true,
    stream: false
  };
}

async function verifyStop(stop = {}, index = 0, tour = {}, query = {}, env = process.env, options = {}) {
  const observedAt = new Date().toISOString();
  const stayWindow = deriveStayWindow(tour, stop, index);
  const countryCode = resolveCountryCode(stop);
  if (!clean(stop.city) || !countryCode || !stayWindow.checkin || !stayWindow.checkout) {
    return {
      index,
      city: clean(stop.city),
      state: 'unavailable',
      availabilityVerified: false,
      attempted: false,
      reason: !countryCode ? 'country-code-unresolved' : 'stay-dates-unavailable',
      checkin: stayWindow.checkin || null,
      checkout: stayWindow.checkout || null,
      dateBasis: stayWindow.dateBasis,
      providerRequests: 0,
      observedAt
    };
  }

  const apiKey = await getApiKey(env, options);
  const search = await postJson(RATE_URL, searchBody(stop, query, stayWindow, countryCode, env), apiKey, options);
  if (search.status !== 200) {
    return { index, city: clean(stop.city), state: 'unavailable', availabilityVerified: false, attempted: true, reason: `rates-http-${search.status}`, checkin: stayWindow.checkin, checkout: stayWindow.checkout, dateBasis: stayWindow.dateBasis, providerRequests: 1, observedAt };
  }
  const offer = selectOffer(search.payload || {});
  if (!offer) {
    return { index, city: clean(stop.city), state: 'unavailable', availabilityVerified: false, attempted: true, reason: 'no-priced-offer', checkin: stayWindow.checkin, checkout: stayWindow.checkout, dateBasis: stayWindow.dateBasis, providerRequests: 1, observedAt };
  }

  const providerBacked = {
    index,
    city: clean(stop.city),
    countryCode,
    checkin: stayWindow.checkin,
    checkout: stayWindow.checkout,
    dateBasis: stayWindow.dateBasis,
    provider: 'Nuitee',
    state: 'provider',
    availabilityVerified: false,
    attempted: true,
    hotelName: offer.hotelName || null,
    address: offer.address || null,
    rating: offer.rating,
    photoUrl: offer.photoUrl || null,
    roomName: offer.roomName || null,
    boardName: offer.boardName || null,
    freshAmount: offer.amount,
    currency: offer.currency,
    refundableTag: offer.refundableTag,
    cancellationDetailsPresent: offer.cancellationDetailsPresent,
    taxesAndFeesPresent: offer.taxesAndFeesPresent,
    excludedFeesPresent: offer.excludedFeesPresent,
    evidence: 'Provider-backed hotel rate — recheck before booking',
    finalPriceRequiresPartnerConfirmation: true,
    providerRequests: 1,
    searchLatencyMs: search.latencyMs,
    observedAt
  };

  const prebook = await postJson(PREBOOK_URL, { offerId: offer.offerId, usePaymentSdk: false }, apiKey, options);
  if (prebook.status !== 200) {
    return { ...providerBacked, reason: `prebook-http-${prebook.status}`, providerRequests: 2, prebookLatencyMs: prebook.latencyMs };
  }
  const finalPrice = prebookPrice(prebook.payload || {});
  if (!(finalPrice.amount > 0)) {
    return { ...providerBacked, reason: 'prebook-final-price-missing', providerRequests: 2, prebookLatencyMs: prebook.latencyMs };
  }
  const evidence = prebookEvidence(prebook.payload || {});
  return {
    ...providerBacked,
    state: 'verified',
    availabilityVerified: true,
    freshAmount: finalPrice.amount,
    currency: finalPrice.currency || offer.currency,
    deltaFromSearch: finalPrice.amount - offer.amount,
    refundableTag: evidence.refundableTag,
    cancellationDetailsPresent: evidence.cancellationDetailsPresent,
    taxesAndFeesPresent: evidence.taxesAndFeesPresent,
    excludedFeesPresent: evidence.excludedFeesPresent,
    evidence: 'Price and availability rechecked by provider',
    reason: null,
    providerRequests: 2,
    prebookLatencyMs: prebook.latencyMs
  };
}

async function verifyTourHotels(tour = {}, query = {}, options = {}) {
  const env = options.env || process.env;
  const stops = Array.isArray(tour.stops) ? tour.stops.slice(0, MAX_STOPS) : [];
  if (!enabled(env)) {
    return { version: VERSION, enabled: false, attempted: false, provider: 'Nuitee', reason: 'feature-disabled', totalCount: stops.length, verifiedCount: 0, providerBackedCount: 0, allVerified: false, providerRequests: 0, rows: [] };
  }
  if (!clean(options.secretId || env[SECRET_ENV]) && !clean(options.apiKey)) {
    return { version: VERSION, enabled: true, attempted: false, provider: 'Nuitee', reason: 'secret-not-configured', totalCount: stops.length, verifiedCount: 0, providerBackedCount: 0, allVerified: false, providerRequests: 0, rows: [] };
  }

  const rows = [];
  for (let index = 0; index < stops.length; index += 1) {
    try {
      rows.push(await verifyStop(stops[index], index, tour, query, env, options));
    } catch (error) {
      rows.push({ index, city: clean(stops[index]?.city), state: 'unavailable', availabilityVerified: false, attempted: true, reason: clean(error?.code || error?.name || 'provider-error'), providerRequests: 0, observedAt: new Date().toISOString() });
    }
  }
  const verifiedCount = rows.filter((row) => row.availabilityVerified === true).length;
  const providerBackedCount = rows.filter((row) => row.state === 'verified' || row.state === 'provider').length;
  const providerRequests = rows.reduce((sum, row) => sum + Math.max(0, Math.round(finite(row.providerRequests, 0) || 0)), 0);
  const allVerified = stops.length > 0 && verifiedCount === stops.length;
  const freshHotelTotal = allVerified ? rows.reduce((sum, row) => sum + finite(row.freshAmount, 0), 0) : null;
  return {
    version: VERSION,
    enabled: true,
    attempted: rows.some((row) => row.attempted === true),
    provider: 'Nuitee',
    reason: allVerified ? null : (rows.find((row) => row.availabilityVerified !== true)?.reason || 'incomplete-hotel-coverage'),
    totalCount: stops.length,
    verifiedCount,
    providerBackedCount,
    allVerified,
    providerRequests,
    freshHotelTotal,
    observedAt: rows.map((row) => clean(row.observedAt)).filter(Boolean).sort().at(-1) || null,
    rows
  };
}

function status708C(env = process.env) {
  return {
    version: VERSION,
    environment: 'staging',
    enabled: enabled(env),
    provider: 'Nuitee',
    secretConfigured: Boolean(clean(env[SECRET_ENV])),
    ratesEndpoint: 'configured-server-side',
    prebookEndpoint: 'configured-server-side',
    bookingCapability: false,
    paymentCapability: false,
    reservationCapability: false,
    maximumStops: MAX_STOPS
  };
}

module.exports = {
  VERSION,
  RATE_URL,
  PREBOOK_URL,
  FLAG,
  SECRET_ENV,
  enabled,
  verifyTourHotels,
  status708C,
  _internal: {
    validCountryCode,
    validIsoDate,
    dateMinusDays,
    departureDate,
    deriveStayWindow,
    resolveCountryCode,
    firstImageUrl,
    selectOffer,
    prebookPrice,
    prebookEvidence,
    parseSecretValue,
    searchBody,
    verifyStop,
    clone
  }
};
