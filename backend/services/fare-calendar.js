'use strict';
// GV-DATA-409: Cached fare-calendar observations for a given origin/destination/month/nights.
// TRAVELPAYOUTS_TOKEN read from process.env only — never embedded in URLs or returned to browser.
//
// Booking links returned in observations are validated raw Aviasales URLs (not pre-wrapped).
// Affiliate wrapping is the frontend's responsibility via applyProviderWindow / wrapAffiliate.
// This prevents double-wrapping when applyProviderWindow processes the observation.
//
// Provider-supplied fields:  departureDate, returnDate (or derived from dep+nights), price, airline, bookingLink
// Safely derived fields:     nights (computed from dates), currency (echoed from request param)
// Never fabricated:          availability, observedAt, expiresAt, passenger count

const BASE_URL = 'https://api.travelpayouts.com';
const { SOURCE_TYPES, normalizeFlightEvidence, automaticDateFloor } = require('./price-evidence-integrity');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_OBS = 31;

// Hosts accepted for raw booking links from the provider.
const ALLOWED_BOOKING_HOSTS = new Set(['www.aviasales.com', 'aviasales.com', 'tp.media']);

const CURRENCY_PARAMS = {
  CAD: { currency: 'cad', market: 'ca' },
  USD: { currency: 'usd', market: 'us' },
  AUD: { currency: 'aud', market: 'au' },
  EUR: { currency: 'eur', market: 'de' },
  GBP: { currency: 'gbp', market: 'gb' }
};

const _cache = new Map();

function safeIata(v) {
  const s = String(v || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function safeMonth(v) {
  const s = String(v || '').trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
}

function safeNights(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 30 ? n : null;
}

function safeCurrency(v) {
  const s = String(v || '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(CURRENCY_PARAMS, s) ? s : null;
}

function nightsBetween(a, b) {
  const da = new Date(String(a).slice(0, 10) + 'T00:00:00Z');
  const db = new Date(String(b).slice(0, 10) + 'T00:00:00Z');
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return null;
  const n = Math.round((db - da) / 86400000);
  return n >= 1 ? n : null;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Validate and sanitize a raw booking link from the provider.
// Only HTTPS links from known Aviasales/Travelpayouts hosts are accepted.
// Relative /search/ paths are prefixed with the canonical Aviasales base URL.
// Search-code tokens (e.g. "YYZ1001LIS0810") are prefixed similarly.
// All other formats (javascript:, data:, http:, unknown hosts) return null.
function sanitizeRawBookingLink(rawLink) {
  if (!rawLink || typeof rawLink !== 'string') return null;
  const s = rawLink.trim();
  // Relative search or flight path
  if (/^\/search\/|^\/flights\//.test(s)) {
    return `https://www.aviasales.com${s}`;
  }
  // Full URL — must be HTTPS and from an allowed host
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (u.protocol !== 'https:') return null;
      if (!ALLOWED_BOOKING_HOSTS.has(u.hostname)) return null;
      return s;
    } catch (_) {
      return null;
    }
  }
  // Aviasales search-code token (e.g. "YYZ1001LIS0810" or shorter variants)
  if (/^[A-Z]{3}\d{4}[A-Z]{3}\d{4}/.test(s)) {
    return `https://www.aviasales.com/search/${s}`;
  }
  return null;
}

async function callEndpoint(endpoint, params, _fetchFn) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) throw new Error('TRAVELPAYOUTS_TOKEN not set');
  const fetchFn = _fetchFn || global.fetch;
  if (!fetchFn) throw new Error('fetch not available');

  const url = new URL(BASE_URL + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  let resp;
  try {
    resp = await fetchFn(url.toString(), {
      headers: { 'X-Access-Token': token, Accept: 'application/json' },
      signal: controller.signal
    });
    clearTimeout(tid);
  } catch (err) {
    clearTimeout(tid);
    if (err.name === 'AbortError') throw new Error('Provider request timed out');
    throw err;
  }

  const text = await resp.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    throw new Error(`Provider returned non-JSON (HTTP ${resp.status})`);
  }
  if (!resp.ok) throw new Error(`Provider error: ${parsed?.message || 'HTTP ' + resp.status}`);
  return parsed;
}

// Normalize raw API rows into canonical observation objects.
// Deduplication: for rows with the same departureDate, keep the cheapest.
// Duration filter: skip observations where |actual_nights - requested_nights| > 1.
// Sort: by price asc, then by departureDate asc for a deterministic order.
function normalizeObservations(rawData, nights, currency, metadata = {}) {
  const rows = Array.isArray(rawData?.data) ? rawData.data
    : Array.isArray(rawData) ? rawData : [];

  // Collect cheapest observation per departure date
  const cheapestByDep = new Map(); // dep -> { r, price }
  for (const r of rows) {
    const dep = String(r.departure_at || '').slice(0, 10);
    if (!dep || !/^\d{4}-\d{2}-\d{2}$/.test(dep)) continue;
    const price = Number(r.price ?? r.value ?? 0);
    if (!Number.isFinite(price) || price <= 0) continue;
    const existing = cheapestByDep.get(dep);
    if (!existing || price < existing.price) {
      cheapestByDep.set(dep, { r, price });
    }
  }

  const out = [];
  for (const [dep, { r, price }] of cheapestByDep) {
    // returnDate: from provider when available, otherwise safely derived as dep + nights
    let ret = String(r.return_at || '').slice(0, 10);
    if (!ret || !/^\d{4}-\d{2}-\d{2}$/.test(ret)) {
      // Derivation is safe: API was called with min/max_trip_duration = nights±1
      ret = addDays(dep, nights);
    }

    const n = nightsBetween(dep, ret);
    // returnDate must be after departureDate
    if (n === null) continue;
    // Client-side duration guard: must be within ±1 night of requested duration
    if (Math.abs(n - nights) > 1) continue;

    // Booking link: validated raw URL only — NOT pre-wrapped in affiliate link.
    // Frontend wraps via applyProviderWindow to avoid double-wrapping.
    const rawLink = String(r.link || r.ticket_link || '');
    const bookingLink = rawLink ? sanitizeRawBookingLink(rawLink) : null;

    const observation = {
      origin: metadata.origin || null,
      destination: metadata.destination || null,
      departureDate: dep,     // provider-supplied
      returnDate: ret,        // provider-supplied or safely derived
      nights: n,              // computed from actual dates
      price,                  // provider-supplied, finite, > 0
      currency,               // echoed from request param
      airline: r.airline || null,  // provider-supplied or null
      bookingLink,             // sanitized provider URL or null
      source: 'travelpayouts-aviasales-round-trip-calendar',
      sourceType: SOURCE_TYPES.CACHED,
      observedAt: metadata.observedAt || null,
      retrievedAt: metadata.retrievedAt || null,
      endpointUsed: metadata.endpointUsed || null,
      cacheHit: Boolean(metadata.cacheHit)
    };
    observation.priceEvidence = normalizeFlightEvidence(observation, {
      origin: metadata.origin,
      destination: metadata.destination,
      currency,
      sourceType: SOURCE_TYPES.CACHED
    });
    observation.evidenceId = observation.priceEvidence.evidenceId;
    out.push(observation);
  }

  // Sort by price asc, then by departureDate asc (deterministic)
  out.sort((a, b) => a.price - b.price || a.departureDate.localeCompare(b.departureDate));

  // Cap at MAX_OBS (one per calendar day max)
  return out.slice(0, MAX_OBS);
}

async function fetchFareCalendar({ origin, destination, currency, month, nights, minimumLeadDays = 14, now, _fetchFn } = {}) {
  const safeOriginVal = safeIata(origin);
  const safeDestVal = safeIata(destination);
  const safeCurrVal = safeCurrency(currency);
  const safeMonthVal = safeMonth(month);
  const safeNightsVal = safeNights(nights);

  if (!safeOriginVal) return { supported: false, reason: 'invalid-origin', observations: [] };
  if (!safeDestVal) return { supported: false, reason: 'invalid-destination', observations: [] };
  if (!safeCurrVal) return { supported: false, reason: 'invalid-currency', observations: [] };
  if (!safeMonthVal) return { supported: false, reason: 'invalid-month', observations: [] };
  if (!safeNightsVal) return { supported: false, reason: 'invalid-nights', observations: [] };

  if (!process.env.TRAVELPAYOUTS_TOKEN) {
    return { supported: false, reason: 'provider-unavailable', observations: [], cacheHit: false };
  }

  const { currency: tpCurr, market } = CURRENCY_PARAMS[safeCurrVal];
  const ck = buildCacheKey(safeOriginVal, safeDestVal, safeCurrVal, safeMonthVal, safeNightsVal);

  const cached = _cache.get(ck);
  if (cached && Date.now() < cached.expiresAt) {
    return { ...cached.data, cacheHit: true, observations: cached.data.observations.map(row => ({ ...row, cacheHit: true, priceEvidence: { ...row.priceEvidence, cacheHit: true, cacheTimestamp: cached.data.fetchedAt } })) };
  }

  let observations = [];
  let endpointUsed = null;
  const fetchedAt = new Date().toISOString();

  // Primary: grouped_prices with per-departure-date calendar data
  try {
    const raw = await callEndpoint('/aviasales/v3/grouped_prices', {
      origin: safeOriginVal,
      destination: safeDestVal,
      currency: tpCurr,
      market,
      group_by: 'departure_at',
      min_trip_duration: Math.max(1, safeNightsVal - 1),
      max_trip_duration: safeNightsVal + 1,
      departure_at: safeMonthVal,
      one_way: 'false',
      show_to_affiliates: 'true',
      limit: 31
    }, _fetchFn);
    endpointUsed = 'grouped_prices';
    observations = normalizeObservations(raw, safeNightsVal, safeCurrVal, { origin: safeOriginVal, destination: safeDestVal, observedAt: fetchedAt, retrievedAt: fetchedAt, endpointUsed });
  } catch (_) { /* fall through to fallback */ }

  // Fallback: prices_for_dates when grouped_prices fails or returns nothing
  if (observations.length === 0) {
    const [y, m] = safeMonthVal.split('-').map(Number);
    const nextMo = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
    try {
      const raw = await callEndpoint('/aviasales/v3/prices_for_dates', {
        origin: safeOriginVal,
        destination: safeDestVal,
        departure_at: safeMonthVal,
        return_at: nextMo,
        currency: tpCurr,
        market,
        one_way: 'false',
        sorting: 'price',
        show_to_affiliates: 'true',
        limit: 31
      }, _fetchFn);
      endpointUsed = 'prices_for_dates';
      observations = normalizeObservations(raw, safeNightsVal, safeCurrVal, { origin: safeOriginVal, destination: safeDestVal, observedAt: fetchedAt, retrievedAt: fetchedAt, endpointUsed });
    } catch (_) { /* both endpoints failed */ }
  }

  const minimumAutomaticDepartureDate = automaticDateFloor({ now: now || new Date(), minimumLeadDays });
  observations = observations.map(row => ({ ...row, automaticSelectable: row.departureDate >= minimumAutomaticDepartureDate }));
  const result = {
    supported: true,
    origin: safeOriginVal,
    destination: safeDestVal,
    currency: safeCurrVal,
    month: safeMonthVal,
    nights: safeNightsVal,
    observations,
    endpointUsed,
    source: 'travelpayouts-cache',
    sourceType: SOURCE_TYPES.CACHED,
    fetchedAt,
    minimumAutomaticDepartureDate,
    cacheHit: false
  };

  _cache.set(ck, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

function buildCacheKey(origin, destination, currency, month, nights) {
  return `fc:${origin}:${destination}:${currency}:${month}:${nights}`;
}

function _clearCache() { _cache.clear(); }
function _getCacheSize() { return _cache.size; }
function _setCacheEntry(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + (ttlMs ?? CACHE_TTL_MS) });
}

module.exports = {
  fetchFareCalendar,
  buildCacheKey,
  sanitizeRawBookingLink,
  _clearCache,
  _getCacheSize,
  _setCacheEntry
};
