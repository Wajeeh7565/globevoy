'use strict';
// GV-DATA-403: Server-side Travelpayouts REST adapter for anchor-round-trip flex-date windows.
// Token read from process.env.TRAVELPAYOUTS_TOKEN only. Never embedded in URLs or returned to browser.

const { buildFallbackAviasalesLink, wrapAviasalesAffiliateLink } = require('./travelpayouts');

const BASE_URL = 'https://api.travelpayouts.com';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// City-code normalization: any of the listed codes → provider-standard city code.
const ANCHOR_CODE_MAP = {
  YYZ: 'YTO', YTO: 'YTO',
  FCO: 'ROM', ROM: 'ROM',
  CDG: 'PAR', PAR: 'PAR',
  NYC: 'NYC', JFK: 'NYC', EWR: 'NYC'
};

// Three pilot routes only. All other origin/destination pairs use existing estimate logic.
const SUPPORTED_ROUTES = {
  'YTO:LIS': {
    origin: 'YTO', dest: 'LIS', currency: 'cad', market: 'ca',
    secondaryCity: 'OPO', secondaryCityName: 'Porto',
    anchorCityName: 'Lisbon'
  },
  'YTO:ROM': {
    origin: 'YTO', dest: 'ROM', currency: 'cad', market: 'ca',
    secondaryCity: 'FLR', secondaryCityName: 'Florence',
    anchorCityName: 'Rome'
  },
  'NYC:PAR': {
    origin: 'NYC', dest: 'PAR', currency: 'usd', market: 'us',
    secondaryCity: 'SXB', secondaryCityName: 'Strasbourg',
    anchorCityName: 'Paris'
  }
};

const _cache = new Map();

function normalizeAnchorCode(code) {
  const upper = String(code || '').toUpperCase().trim();
  return Object.prototype.hasOwnProperty.call(ANCHOR_CODE_MAP, upper)
    ? ANCHOR_CODE_MAP[upper]
    : null;
}

// Like normalizeAnchorCode but passes through the raw code when not in the map.
// Used for destinations: FCO→ROM, but LIS stays LIS (already correct).
function _resolveCode(code) {
  const upper = String(code || '').toUpperCase().trim();
  return ANCHOR_CODE_MAP[upper] ?? upper;
}

function isSupportedRoute(originCode, destCode) {
  const origin = normalizeAnchorCode(originCode);
  if (!origin) return false;
  const dest = _resolveCode(destCode);
  return Object.prototype.hasOwnProperty.call(SUPPORTED_ROUTES, `${origin}:${dest}`);
}

function resolveRoute(originCode, destCode) {
  const origin = normalizeAnchorCode(originCode);
  if (!origin) return null;
  const dest = _resolveCode(destCode);
  return SUPPORTED_ROUTES[`${origin}:${dest}`] ?? null;
}

function nightsBetween(departure, returning) {
  if (!departure || !returning) return null;
  const d = new Date(String(departure).slice(0, 10) + 'T00:00:00Z');
  const r = new Date(String(returning).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || Number.isNaN(r.getTime())) return null;
  const n = Math.round((r - d) / 86400000);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

function resolveBookingLink(rawLink, origin, dest, departure, returning) {
  const raw = typeof rawLink === 'string' ? rawLink.trim() : '';
  if (raw) {
    if (/^https:\/\/tp\.media\/r\?/i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return wrapAviasalesAffiliateLink(raw);
    const absolute = raw.startsWith('/search/') || raw.startsWith('/flights/')
      ? `https://www.aviasales.com${raw}`
      : `https://www.aviasales.com/search/${raw}`;
    return wrapAviasalesAffiliateLink(absolute);
  }
  return buildFallbackAviasalesLink({
    originCode: origin, destinationCode: dest,
    bestDepartureDate: departure, bestReturnDate: returning
  });
}

function extractRows(data) {
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data)) return data;
  return [];
}

function filterAndSortWindows(rows) {
  return rows
    .map(r => ({
      departure_at: String(r.departure_at || '').slice(0, 10),
      return_at: String(r.return_at || '').slice(0, 10),
      price: r.price ?? null,
      currency: r.currency ?? null,
      airline: r.airline ?? null,
      link: r.link ?? null
    }))
    .filter(r => {
      const n = nightsBetween(r.departure_at, r.return_at);
      return n !== null && n >= 7 && n <= 14;
    })
    .map(r => ({ ...r, nights: nightsBetween(r.departure_at, r.return_at) }))
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
}

function buildAnchorRoundTripItinerary(window, route) {
  return {
    structure: 'anchor-round-trip',
    anchorCity: route.dest,
    anchorCityName: route.anchorCityName,
    secondaryCity: route.secondaryCity,
    secondaryCityName: route.secondaryCityName,
    groundNote: `Both ground directions (${route.anchorCityName} ↔ ${route.secondaryCityName}) are included. Traveller returns to ${route.anchorCityName} before flying home.`,
    legs: [
      { step: 1, type: 'flight', from: route.origin, to: route.dest, date: window.departure_at, note: `Outbound flight to ${route.anchorCityName}` },
      { step: 2, type: 'ground', from: route.dest, to: route.secondaryCity, note: `Ground transfer to ${route.secondaryCityName}` },
      { step: 3, type: 'ground', from: route.secondaryCity, to: route.dest, note: `Return ground transfer to ${route.anchorCityName}` },
      { step: 4, type: 'flight', from: route.dest, to: route.origin, date: window.return_at, note: `Return flight home` }
    ]
  };
}

// _fetchFn is injectable for tests; production always uses global fetch.
async function callRestEndpoint(endpoint, params, _fetchFn) {
  const token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token) throw new Error('TRAVELPAYOUTS_TOKEN not set');

  const fetchFn = _fetchFn || global.fetch;
  if (!fetchFn) throw new Error('fetch not available');

  const url = new URL(BASE_URL + endpoint);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const resp = await fetchFn(url.toString(), {
    headers: { 'X-Access-Token': token, Accept: 'application/json' }
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`Provider returned non-JSON response (HTTP ${resp.status})`);
  }

  if (!resp.ok) {
    const msg = data?.message || data?.error || `HTTP ${resp.status}`;
    throw new Error(`Provider error: ${msg}`);
  }

  return data;
}

function nextMonthStr(yyyyMm) {
  const parts = String(yyyyMm || '').split('-').map(Number);
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  const d = new Date(Date.UTC(parts[0], parts[1], 1)); // month is 0-based + 1 = next month
  return d.toISOString().slice(0, 7);
}

function defaultMonth() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  return next.toISOString().slice(0, 7);
}

async function fetchFlexDateWindows({ originCode, destCode, month, _fetchFn } = {}) {
  const route = resolveRoute(originCode, destCode);
  if (!route) return { supported: false, windows: [], windowCount: 0, source: 'unsupported-route' };

  const targetMonth = month || defaultMonth();
  const cacheKey = `${route.origin}:${route.dest}:${route.currency}:${targetMonth}`;

  const cached = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { ...cached.data, cacheHit: true };
  }

  let windows = [];
  let endpointUsed = null;
  let providerCalls = 0;

  // Primary: grouped_prices with 7-14 night duration filter
  try {
    const gpData = await callRestEndpoint('/aviasales/v3/grouped_prices', {
      origin: route.origin, destination: route.dest,
      currency: route.currency, market: route.market,
      group_by: 'departure_at', min_trip_duration: 7, max_trip_duration: 14,
      one_way: 'false', departure_at: targetMonth,
      show_to_affiliates: 'true', limit: 10
    }, _fetchFn);
    providerCalls += 1;
    windows = filterAndSortWindows(extractRows(gpData));
    endpointUsed = 'grouped_prices';
  } catch {
    // grouped_prices failed — fall through to prices_for_dates
  }

  // Fallback: prices_for_dates when grouped_prices yielded 0 records or errored
  if (windows.length === 0) {
    const returnMonth = nextMonthStr(targetMonth);
    try {
      const pfdData = await callRestEndpoint('/aviasales/v3/prices_for_dates', {
        origin: route.origin, destination: route.dest,
        departure_at: targetMonth, return_at: returnMonth,
        currency: route.currency, market: route.market,
        one_way: 'false', sorting: 'price',
        show_to_affiliates: 'true', limit: 10
      }, _fetchFn);
      providerCalls += 1;
      windows = filterAndSortWindows(extractRows(pfdData));
      endpointUsed = 'prices_for_dates';
    } catch {
      // Both endpoints failed — return empty
    }
  }

  const topWindows = windows.slice(0, 3).map(w => {
    const bookingLink = resolveBookingLink(w.link, route.origin, route.dest, w.departure_at, w.return_at);
    const itinerary = buildAnchorRoundTripItinerary(w, route);
    return {
      departure_at: w.departure_at,
      return_at: w.return_at,
      nights: w.nights,
      price: w.price,
      providerCurrency: route.currency.toUpperCase(),
      airline: w.airline ?? null,
      bookingLink,
      sourceWording: 'Cached flight-price observation',
      itinerary
    };
  });

  const windowCount = topWindows.length;
  const result = {
    supported: true,
    origin: route.origin,
    destination: route.dest,
    currency: route.currency.toUpperCase(),
    endpointUsed,
    providerCalls,
    windows: topWindows,
    windowCount,
    source: 'travelpayouts-rest',
    cacheHit: false
  };

  if (windowCount > 0) {
    _cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL_MS });
  }

  return result;
}

function flexWindowsSourceWording(windowCount) {
  if (windowCount > 1) return 'Flexible dates — multiple windows available';
  if (windowCount === 1) return 'Cached flight-price observation';
  return null;
}

// Test helpers — not for production use.
function _clearCache() { _cache.clear(); }
function _setCacheEntry(key, data, ttlMs) {
  _cache.set(key, { data, expiresAt: Date.now() + (ttlMs ?? CACHE_TTL_MS) });
}
function _expireCacheEntry(key) {
  const e = _cache.get(key);
  if (e) _cache.set(key, { ...e, expiresAt: 0 });
}
function _getCacheSize() { return _cache.size; }

module.exports = {
  normalizeAnchorCode,
  isSupportedRoute,
  resolveRoute,
  fetchFlexDateWindows,
  buildAnchorRoundTripItinerary,
  flexWindowsSourceWording,
  // Test helpers
  _clearCache,
  _setCacheEntry,
  _expireCacheEntry,
  _getCacheSize
};
