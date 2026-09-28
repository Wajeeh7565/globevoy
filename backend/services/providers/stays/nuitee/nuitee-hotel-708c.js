'use strict';

// GV-HOTEL-708C — staging-only Nuitee live hotel evidence adapter.
//
// Trust/safety boundary:
// - disabled unless ENABLE_NUITEE_HOTEL_708C=true;
// - reads only a Secrets Manager identifier from Lambda configuration;
// - reads a sandbox or production API key server-side and never returns/logs it;
// - performs Rates -> PREBOOK only; there is deliberately no BOOK/payment code;
// - never returns provider offer/prebook IDs or raw provider responses;
// - individual provider failures fail closed to the caller's saved estimate.

const worldwide701A = require('../../../cities/registry/worldwide-city-registry-701a');

const VERSION = 'GV-LIVE-712'; // Successor to GV-HOTEL-708C; existing route/flag retained.
const RATE_URL = 'https://api.liteapi.travel/v3.0/hotels/rates';
const PREBOOK_URL = 'https://book.liteapi.travel/v3.0/rates/prebook';
const FLAG = 'ENABLE_NUITEE_HOTEL_708C';
const SECRET_ENV = 'NUITEE_SANDBOX_SECRET_ID';
const LIVE_SECRET_ENV = 'NUITEE_SECRET_ID';
const DEFAULT_REGION = 'us-east-2';
const MAX_STOPS = 12;
const TIMEOUT_MS = 15000;
const FRESHNESS_MS = 5 * 60 * 1000;

let secretsSdk = null;
let secretsClient = null;
let cachedSecretId = '';
let cachedApiKey = '';

function clean(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function finite(value, fallback = null) { if (value == null || value === '' || typeof value === 'boolean') return fallback; const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function enabled(env = process.env) { return clean(env[FLAG]).toLowerCase() === 'true'; }
function validCountryCode(value) { const code = upper(value); return /^[A-Z]{2}$/.test(code) ? code : ''; }
function validIsoDate(value) { const text = clean(value).slice(0, 10); const time = Date.parse(`${text}T12:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? text : ''; }
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
  const explicitCheckin = validIsoDate(stop.checkin || stop.checkIn || stop.arrivalDate || stop.hotel?.checkin);
  const explicitCheckout = validIsoDate(stop.checkout || stop.checkOut || stop.departureDate || stop.hotel?.checkout);
  const nights = finite(stop.nights, null);
  const legs = Array.isArray(tour.legs) ? tour.legs : (Array.isArray(tour.backendLegs) ? tour.backendLegs : []);
  const inbound = legs[index]?.providerDateEvidence || {};
  const arrival = validIsoDate(inbound.arrivalDate || legs[index]?.arrivalDate);
  const checkout = departureDate(legs[index + 1] || {});
  const invalid = { checkin: '', checkout: '', nights, dateBasis: 'unavailable', dateConfirmed: false };
  if (explicitCheckin && explicitCheckout && explicitCheckout > explicitCheckin) {
    if ((arrival && arrival !== explicitCheckin) || (checkout && checkout !== explicitCheckout)) return { ...invalid, reason: 'stay-flight-date-mismatch' };
    return { checkin: explicitCheckin, checkout: explicitCheckout, nights: (Date.parse(explicitCheckout) - Date.parse(explicitCheckin)) / 86400000, dateBasis: 'saved-stay-dates', dateConfirmed: true };
  }
  if (explicitCheckin || explicitCheckout || clean(stop.checkin || stop.checkIn || stop.checkout || stop.checkOut)) return { ...invalid, reason: 'stay-dates-invalid' };
  if (arrival && checkout && checkout > arrival) {
    return { checkin: arrival, checkout, nights: (Date.parse(checkout) - Date.parse(arrival)) / 86400000, dateBasis: 'flight-arrival-and-outbound-date', dateConfirmed: inbound.sourceType === 'LIVE' && inbound.productionEligible === true };
  }
  // Historical snapshots omit arrival day. A searched window may be displayed,
  // but its derived check-in cannot qualify a whole trip as Live.
  if (!Number.isInteger(nights) || nights < 1) return invalid;
  const checkin = checkout ? dateMinusDays(checkout, nights) : '';
  if (checkin && checkout && checkout > checkin) {
    return { checkin, checkout, nights, dateBasis: 'saved-nights-plus-outbound-date', dateConfirmed: false };
  }
  return invalid;
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
  // A roomType is an offer containing every requested room. Never price only
  // rates[0] for a multi-room offer.
  const aggregate = prebookPrice({ data: { roomTypes: [roomType] } });
  const amount = finite(offerRetail.amount, null) ?? aggregate.amount;
  const currency = upper(offerRetail.currency || rateTotal.currency);
  const fees = Array.isArray(rate?.retailRate?.taxesAndFees) ? rate.retailRate.taxesAndFees : [];
  const identity = contentHotel || rateHotel;
  return {
    offerId: clean(roomType.offerId),
    hotelId: providerHotelId(rateHotel),
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

function selectOffer(payload = {}, currency = '', hotelId = '') {
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
  const valid = offers.filter((offer) => offer.offerId && offer.amount !== null && offer.amount > 0 && offer.currency && (!currency || offer.currency === currency) && (!hotelId || offer.hotelId === hotelId));
  valid.sort((a, b) => a.amount - b.amount);
  return valid.find((offer) => offer.refundableTag === 'RFN') || valid[0] || null;
}

function prebookPrice(payload = {}) {
  const data = payload.data || {};
  const direct = finite(data.price, null);
  if (direct !== null) {
    const currencies = (Array.isArray(data.roomTypes) ? data.roomTypes : []).flatMap((room) => [room.offerRetailRate?.currency, ...(room.rates || []).flatMap((rate) => (rate.retailRate?.total || []).map((total) => total.currency))]).filter(Boolean).map(upper);
    if (currencies.some((code) => code !== upper(data.currency))) return { amount: null, currency: '' };
    return { amount: direct > 0 ? direct : null, currency: upper(data.currency) };
  }
  let amount = 0;
  let currency = '';
  let found = false;
  for (const roomType of Array.isArray(data.roomTypes) ? data.roomTypes : []) {
    const offer = roomType.offerRetailRate;
    if (offer) {
      const next = finite(offer.amount, null);
      const nextCurrency = upper(offer.currency);
      if (!(next > 0) || !nextCurrency || (currency && currency !== nextCurrency)) return { amount: null, currency: '' };
      amount += next;
      currency = nextCurrency;
      found = true;
      continue;
    }
    for (const rate of Array.isArray(roomType.rates) ? roomType.rates : []) {
      const total = rate?.retailRate?.total?.[0] || {};
      const next = finite(total.amount, null);
      const nextCurrency = upper(total.currency);
      if (!(next > 0) || !nextCurrency || (currency && nextCurrency !== currency)) return { amount: null, currency: '' };
      if (next !== null) {
        amount += next;
        currency = nextCurrency;
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
  let taxesAndFeesPresent = true;
  let excludedFeesPresent = false;
  let rateCount = 0;
  const roomNames = [];
  for (const roomType of Array.isArray(data.roomTypes) ? data.roomTypes : []) {
    for (const rate of Array.isArray(roomType.rates) ? roomType.rates : []) {
      rateCount += 1;
      if (clean(rate.name)) roomNames.push(clean(rate.name));
      refundableTag ||= clean(rate?.cancellationPolicies?.refundableTag);
      cancellationDetailsPresent ||= Array.isArray(rate?.cancellationPolicies?.cancelPolicyInfos);
      const fees = rate?.retailRate?.taxesAndFees;
      taxesAndFeesPresent &&= Array.isArray(fees) && fees.every((fee) => typeof fee?.included === 'boolean');
      if (Array.isArray(fees)) excludedFeesPresent ||= fees.some((fee) => fee?.included !== true);
    }
  }
  return { refundableTag: refundableTag || 'UNKNOWN', cancellationDetailsPresent, taxesAndFeesPresent: rateCount > 0 && taxesAndFeesPresent, excludedFeesPresent, roomNames };
}

function keyMode(key) { return /^(sand_|sandbox_)/.test(clean(key)) ? 'sandbox' : clean(key).startsWith('prod_') ? 'production' : 'unknown'; }

function parseSecretValue(secretValue) {
  const raw = clean(secretValue);
  if (!raw) return '';
  if (keyMode(raw) !== 'unknown') return raw;
  try {
    const parsed = JSON.parse(raw);
    for (const key of ['apiKey', 'sandboxApiKey', 'NUITEE_API_KEY', 'NUITEE_SANDBOX_API_KEY']) {
      const value = clean(parsed?.[key]);
      if (keyMode(value) !== 'unknown') return value;
    }
  } catch (_) {}
  return '';
}

async function getApiKey(env = process.env, options = {}) {
  if (keyMode(options.apiKey) !== 'unknown') return clean(options.apiKey);
  const secretId = clean(options.secretId || env[LIVE_SECRET_ENV] || env[SECRET_ENV]);
  if (!secretId) throw Object.assign(new Error('nuitee-secret-not-configured'), { code: 'secret-not-configured' });
  if (!options.getSecretValue && cachedSecretId === secretId && cachedApiKey) return cachedApiKey;

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
  if (!apiKey) throw Object.assign(new Error('nuitee-key-invalid'), { code: 'invalid-secret' });
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

function occupancyForQuery(query = {}) {
  const fail = (code) => { throw Object.assign(new Error(code), { code }); };
  const count = (value, fallback) => { const n = finite(value, fallback); if (!Number.isInteger(n) || n < 0 || n > 64) fail('traveller-count-invalid'); return n; };
  const explicit = query.occupancies || query.roomOccupancies;
  const ages = (values) => Array.isArray(values) && values.every((age) => Number.isInteger(age) && age >= 0 && age <= 17);
  let rows;
  if (Array.isArray(explicit) && explicit.length) {
    rows = explicit.map((row) => {
      const children = row.children || [];
      if (!ages(children)) fail('child-ages-required');
      const adults = count(row.adults, 0);
      if (!adults) fail('room-adult-required');
      return { adults, children: [...children] };
    });
  } else {
    const adults = count(query.adults, query.travellers ?? 1);
    const rooms = count(query.rooms, 1);
    const children = count(query.children, 0);
    const infants = count(query.infants, 0);
    const childAges = query.childrenAges || query.childAges || [];
    const infantAges = query.infantAges || [];
    if (!ages(childAges) || childAges.length !== children || !ages(infantAges) || infantAges.length !== infants) fail('child-ages-required');
    if (rooms < 1 || rooms > 8 || adults < rooms) fail('room-occupancy-invalid');
    if (rooms > 1 && children + infants > 0) fail('room-assignments-required');
    rows = Array.from({ length: rooms }, (_, index) => ({ adults: Math.floor(adults / rooms) + (index < adults % rooms ? 1 : 0), children: index === 0 ? [...childAges, ...infantAges] : [] }));
  }
  if (rows.length > 8) fail('room-limit-exceeded');
  const adults = rows.reduce((n, row) => n + row.adults, 0);
  const minors = rows.reduce((n, row) => n + row.children.length, 0);
  const travellerCount = adults + minors;
  if (query.adults != null && count(query.adults) !== adults) fail('occupancy-traveller-mismatch');
  if (query.children != null && count(query.children) + count(query.infants, 0) !== minors) fail('occupancy-traveller-mismatch');
  if (query.rooms != null && count(query.rooms) !== rows.length) fail('occupancy-room-mismatch');
  if ((query.travellers ?? query.passengers) != null && count(query.travellers ?? query.passengers) !== travellerCount) fail('occupancy-traveller-mismatch');
  return { occupancies: rows, roomCount: rows.length, travellerCount };
}

function searchBody(stop, query, stayWindow, countryCode, env = process.env) {
  const occupancy = occupancyForQuery(query);
  const guestNationality = validCountryCode(query.guestNationality || query.nationality || env.NUITEE_GUEST_NATIONALITY);
  if (!guestNationality) throw Object.assign(new Error('guest-nationality-required'), { code: 'guest-nationality-required' });
  const hotelId = clean(stop.hotel?.nuiteeHotelId || (stop.hotel?.provider === 'Nuitee' ? stop.hotel?.hotelId : ''));
  return {
    occupancies: occupancy.occupancies,
    currency: upper(query.currency || 'CAD') || 'CAD',
    guestNationality,
    checkin: stayWindow.checkin,
    checkout: stayWindow.checkout,
    ...(hotelId ? { hotelIds: [hotelId] } : { cityName: clean(stop.city), countryCode }),
    timeout: 10,
    limit: 8,
    maxRatesPerHotel: 1,
    roomMapping: true,
    includeHotelData: true,
    stream: false
  };
}

async function verifyStop(stop = {}, index = 0, tour = {}, query = {}, env = process.env, options = {}) {
  const now = () => options.now ? new Date(options.now).getTime() : Date.now();
  const observedAt = new Date(now()).toISOString();
  const stayWindow = deriveStayWindow(tour, stop, index);
  const countryCode = resolveCountryCode(stop);
  if (!clean(stop.city) || !countryCode || !stayWindow.checkin || !stayWindow.checkout || stayWindow.checkin < observedAt.slice(0, 10)) {
    return {
      index,
      city: clean(stop.city),
      state: 'unavailable',
      availabilityVerified: false,
      attempted: false,
      reason: stayWindow.reason || (!countryCode ? 'country-code-unresolved' : stayWindow.checkin && stayWindow.checkin < observedAt.slice(0, 10) ? 'stay-dates-in-past' : 'stay-dates-unavailable'),
      checkin: stayWindow.checkin || null,
      checkout: stayWindow.checkout || null,
      dateBasis: stayWindow.dateBasis,
      providerRequests: 0,
      observedAt
    };
  }

  const body = searchBody(stop, query, stayWindow, countryCode, env);
  const occupancy = occupancyForQuery(query);
  const apiKey = await getApiKey(env, options);
  const search = await postJson(RATE_URL, body, apiKey, options);
  if (search.status !== 200 || search.payload?.error) {
    return { index, city: clean(stop.city), state: 'unavailable', availabilityVerified: false, attempted: true, reason: `rates-http-${search.status}`, checkin: stayWindow.checkin, checkout: stayWindow.checkout, dateBasis: stayWindow.dateBasis, providerRequests: 1, observedAt };
  }
  const offer = selectOffer(search.payload || {}, body.currency, body.hotelIds?.[0] || '');
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
    dateConfirmed: stayWindow.dateConfirmed,
    nights: stayWindow.nights,
    ...occupancy,
    guestNationality: body.guestNationality,
    provider: 'Nuitee',
    state: 'provider',
    availabilityVerified: false,
    priceVerified: false,
    productionEligible: false,
    environment: keyMode(apiKey),
    sandbox: keyMode(apiKey) !== 'production' || search.payload?.sandbox === true || search.payload?.data?.sandbox === true,
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

  let prebook;
  try { prebook = await postJson(PREBOOK_URL, { offerId: offer.offerId, usePaymentSdk: false }, apiKey, options); }
  catch (error) { return { ...providerBacked, reason: error?.name === 'AbortError' ? 'prebook-timeout' : 'prebook-provider-error', providerRequests: 2 }; }
  if (prebook.status !== 200 || prebook.payload?.error) {
    return { ...providerBacked, reason: `prebook-http-${prebook.status}`, providerRequests: 2, prebookLatencyMs: prebook.latencyMs };
  }
  const finalPrice = prebookPrice(prebook.payload || {});
  const data = prebook.payload?.data || {};
  if (!clean(data.prebookId)) return { ...providerBacked, reason: 'prebook-confirmation-missing', providerRequests: 2 };
  if ((data.offerId && data.offerId !== offer.offerId) || (data.hotelId && data.hotelId !== offer.hotelId)) return { ...providerBacked, reason: 'prebook-offer-mismatch', providerRequests: 2 };
  if ((data.checkin && validIsoDate(data.checkin) !== body.checkin) || (data.checkout && validIsoDate(data.checkout) !== body.checkout)) return { ...providerBacked, reason: 'prebook-date-mismatch', providerRequests: 2 };
  if (!(finalPrice.amount > 0) || !finalPrice.currency) {
    return { ...providerBacked, reason: 'prebook-final-price-missing', providerRequests: 2, prebookLatencyMs: prebook.latencyMs };
  }
  if (finalPrice.currency !== body.currency) return { ...providerBacked, reason: 'prebook-currency-mismatch', providerRequests: 2 };
  const evidence = prebookEvidence(prebook.payload || {});
  const sandbox = providerBacked.sandbox || prebook.payload?.sandbox === true || data.sandbox === true;
  const checkedAt = new Date(now()).toISOString();
  const providerExpiry = Date.parse(data.expiresAt || data.expires_at || '');
  const expiresAt = new Date(Math.min(now() + FRESHNESS_MS, Number.isFinite(providerExpiry) ? providerExpiry : Infinity)).toISOString();
  const productionEligible = !sandbox && keyMode(apiKey) === 'production' && stayWindow.dateConfirmed === true && evidence.taxesAndFeesPresent && !evidence.excludedFeesPresent && Date.parse(expiresAt) > now();
  return {
    ...providerBacked,
    state: 'verified',
    availabilityVerified: true,
    priceVerified: true,
    productionEligible,
    sandbox,
    environment: sandbox ? 'sandbox' : 'production',
    expiresAt,
    observedAt: checkedAt,
    freshAmount: finalPrice.amount,
    currency: finalPrice.currency,
    deltaFromSearch: finalPrice.amount - offer.amount,
    refundableTag: evidence.refundableTag,
    cancellationDetailsPresent: evidence.cancellationDetailsPresent,
    taxesAndFeesPresent: evidence.taxesAndFeesPresent,
    excludedFeesPresent: evidence.excludedFeesPresent,
    roomNames: evidence.roomNames,
    evidence: sandbox ? 'Test rate checked ΓÇö not a live booking price' : 'Price and availability rechecked by provider',
    reason: sandbox ? 'sandbox-evidence' : !stayWindow.dateConfirmed ? 'hotel-arrival-date-unconfirmed' : !evidence.taxesAndFeesPresent ? 'hotel-fees-unconfirmed' : evidence.excludedFeesPresent ? 'hotel-payable-fees-excluded' : Date.parse(expiresAt) <= now() ? 'prebook-expired' : null,
    providerRequests: 2,
    prebookLatencyMs: prebook.latencyMs
  };
}

async function verifyTourHotels(tour = {}, query = {}, options = {}) {
  const env = options.env || process.env;
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  if (!enabled(env)) {
    return { version: VERSION, enabled: false, attempted: false, provider: 'Nuitee', reason: 'feature-disabled', totalCount: stops.length, verifiedCount: 0, providerBackedCount: 0, allVerified: false, providerRequests: 0, rows: [] };
  }
  if (!clean(options.secretId || env[LIVE_SECRET_ENV] || env[SECRET_ENV]) && !clean(options.apiKey)) {
    return { version: VERSION, enabled: true, attempted: false, provider: 'Nuitee', reason: 'secret-not-configured', totalCount: stops.length, verifiedCount: 0, providerBackedCount: 0, allVerified: false, providerRequests: 0, rows: [] };
  }

  const rows = new Array(stops.length);
  const deadline = Date.now() + Math.max(0, Math.min(55000, finite(options.totalTimeoutMs, 55000)));
  let nextIndex = 0;
  const unavailable = (index, reason, attempted = false) => ({ index, city: clean(stops[index]?.city), provider: 'Nuitee', state: 'unavailable', availabilityVerified: false, productionEligible: false, attempted, reason, providerRequests: attempted ? 1 : 0, observedAt: new Date(options.now || Date.now()).toISOString() });
  // Two bounded workers keep long routes responsive; every required stay gets
  // an explicit result even when it exceeds the provider-call budget.
  async function worker() {
    while (nextIndex < stops.length) {
      const index = nextIndex++;
      if (index >= MAX_STOPS || Date.now() >= deadline) { rows[index] = unavailable(index, index >= MAX_STOPS ? 'hotel-stop-limit-exceeded' : 'hotel-time-budget-exceeded'); continue; }
      try {
        rows[index] = await verifyStop(stops[index], index, tour, query, env, { ...options, timeoutMs: Math.min(finite(options.timeoutMs, TIMEOUT_MS), Math.max(1, (deadline - Date.now()) / 2)) });
      } catch (error) {
        const reason = error?.name === 'AbortError' ? 'rates-timeout' : clean(error?.code || 'provider-unavailable');
        rows[index] = unavailable(index, reason, error?.name === 'AbortError' || !error?.code);
      }
    }
  }
  await Promise.all([worker(), worker()]);
  const verifiedCount = rows.filter((row) => row.availabilityVerified === true).length;
  const liveCount = rows.filter((row) => row.productionEligible === true && Date.parse(row.expiresAt) > new Date(options.now || Date.now()).getTime()).length;
  const providerBackedCount = rows.filter((row) => row.state === 'verified' || row.state === 'provider').length;
  const providerRequests = rows.reduce((sum, row) => sum + Math.max(0, Math.round(finite(row.providerRequests, 0) || 0)), 0);
  const currencies = new Set(rows.map((row) => row.currency).filter(Boolean));
  const allVerified = stops.length > 0 && verifiedCount === stops.length && currencies.size === 1;
  const allLive = stops.length > 0 && liveCount === stops.length && currencies.size === 1;
  const freshHotelTotal = allLive ? rows.reduce((sum, row) => sum + finite(row.freshAmount, 0), 0) : null;
  return {
    version: VERSION,
    enabled: true,
    attempted: rows.some((row) => row.attempted === true),
    provider: 'Nuitee',
    reason: allLive ? null : (rows.find((row) => row.productionEligible !== true)?.reason || 'incomplete-hotel-coverage'),
    totalCount: stops.length,
    verifiedCount,
    liveCount,
    providerBackedCount,
    allVerified,
    allLive,
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
    secretConfigured: Boolean(clean(env[LIVE_SECRET_ENV] || env[SECRET_ENV])),
    freshnessSeconds: FRESHNESS_MS / 1000,
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
  LIVE_SECRET_ENV,
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
    occupancyForQuery,
    keyMode,
    parseSecretValue,
    searchBody,
    verifyStop,
    clone
  }
};
