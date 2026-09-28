'use strict';

// GV-PROVIDER-682B — Stay22 exact-stay evidence adapter.
// Read-only search integration. It never books, reserves, orders, or pays.
// The adapter may attach city-wide benchmark evidence, but only a strong
// same-property name match is eligible to replace the selected stay estimate.

const { normalizeCurrency, currencyToUsdRate } = require('../../../../budget-presentation');
const { PROPERTY_IDENTITY_VERSION_682C, buildPropertyIdentity, chooseConfidentMatch, genericPropertyName } = require('../shared/property-identity-682c');

const STAY22_EVIDENCE_VERSION_682B = 'GV-PROVIDER-682B';
const BASE_URL = 'https://api.stay22.com/v2/accommodations';
const DEFAULT_CACHE_TTL_SECONDS = 300;
const MAX_CACHE_TTL_SECONDS = 3600;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const DEFAULT_MATCH_THRESHOLD = 0.90;
const DEFAULT_QUALITY_GUEST_RATING = 7;
const DEFAULT_QUALITY_RATING_COUNT = 20;
const responseCache = new Map();

function boolEnv(name, env = process.env, fallback = false) {
  const raw = String(env?.[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function enabled(env = process.env) {
  return boolEnv('ENABLE_STAY22_EVIDENCE_682B', env, false);
}

function demoAllowed(env = process.env) {
  return boolEnv('STAY22_ALLOW_DEMO_682B', env, false);
}

function productionApproved(env = process.env) {
  return boolEnv('STAY22_PRODUCTION_APPROVED_682B', env, false);
}

function cacheTtlSeconds(env = process.env) {
  const parsed = Number(env?.GV_STAY22_CACHE_TTL_SECONDS);
  const value = Number.isFinite(parsed) ? Math.round(parsed) : DEFAULT_CACHE_TTL_SECONDS;
  return Math.max(30, Math.min(MAX_CACHE_TTL_SECONDS, value));
}

function pageSize(env = process.env) {
  const parsed = Number(env?.GV_STAY22_PAGE_SIZE);
  const value = Number.isFinite(parsed) ? Math.round(parsed) : DEFAULT_PAGE_SIZE;
  return Math.max(5, Math.min(MAX_PAGE_SIZE, value));
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(the|hotel|hotels|inn|resort|apartments?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function propertyNameScore(name, target) {
  const a = normalizeText(name);
  const b = normalizeText(target);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.97;
  const at = new Set(a.split(' ').filter(Boolean));
  const bt = new Set(b.split(' ').filter(Boolean));
  const union = new Set([...at, ...bt]);
  let intersection = 0;
  for (const token of at) if (bt.has(token)) intersection += 1;
  const jaccard = union.size ? intersection / union.size : 0;
  const targetCoverage = bt.size ? intersection / bt.size : 0;
  return Number((jaccard * 0.45 + targetCoverage * 0.55).toFixed(4));
}

function isUsefulTargetProperty(value) {
  return !genericPropertyName(value);
}

function safeIsoDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function buildAddress(query = {}) {
  const explicit = String(query.address || '').trim();
  if (explicit) return explicit;
  return [query.city, query.region, query.country].filter(Boolean).join(', ');
}

function requestShape(query = {}, env = process.env) {
  const identity = query.targetIdentity || buildPropertyIdentity({ name: query.targetProperty }, { city: query.city, country: query.country });
  return {
    address: buildAddress(query),
    checkin: safeIsoDate(query.checkIn || query.checkin),
    checkout: safeIsoDate(query.checkOut || query.checkout),
    adults: Math.max(1, Math.round(Number(query.adults || 1))),
    children: Math.max(0, Math.round(Number(query.children || 0))),
    rooms: Math.max(1, Math.round(Number(query.rooms || 1))),
    currency: normalizeCurrency(query.currency || 'CAD'),
    pageSize: pageSize(env),
    hotelsearch: identity.safeForTargetedProviderSearch ? String(identity.canonicalName).trim() : null,
    targetIdentity: identity
  };
}

function buildUrl(shape) {
  const url = new URL(BASE_URL);
  url.searchParams.set('address', shape.address);
  url.searchParams.set('checkin', shape.checkin);
  url.searchParams.set('checkout', shape.checkout);
  url.searchParams.set('adults', String(shape.adults));
  url.searchParams.set('children', String(shape.children));
  url.searchParams.set('rooms', String(shape.rooms));
  url.searchParams.set('currency', shape.currency);
  url.searchParams.set('pageSize', String(shape.pageSize));
  if (shape.hotelsearch) url.searchParams.set('hotelsearch', shape.hotelsearch);
  url.searchParams.set('page', '1');
  url.searchParams.set('lang', 'en');
  url.searchParams.set('cluster', 'false');
  return url;
}

function cacheKey(shape) {
  return [shape.address, shape.checkin, shape.checkout, shape.adults, shape.children, shape.rooms, shape.currency, shape.pageSize, shape.hotelsearch || '', shape.targetIdentity?.normalizedName || '', JSON.stringify(shape.targetIdentity?.providerRefs || [])]
    .map(value => String(value ?? '').trim().toLowerCase())
    .join('|');
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function flattenQuotes(payload = {}, query = {}) {
  const rows = [];
  const currency = normalizeCurrency(payload?.meta?.currency || query.currency || 'CAD');
  for (const stay of (Array.isArray(payload?.results) ? payload.results : [])) {
    for (const [supplier, entry] of Object.entries(stay?.suppliers || {})) {
      const total = positive(entry?.price?.total);
      if (!total) continue;
      rows.push({
        sourceClass: 'LIVE_ACCOMMODATION_QUOTE_CANDIDATE',
        rateProvider: 'Stay22',
        provider: 'stay22-direct-travel-api',
        supplier,
        propertyId: stay?.id || null,
        supplierPropertyId: entry?.id || null,
        propertyName: stay?.name || null,
        propertyType: stay?.type || null,
        total,
        currency,
        checkIn: safeIsoDate(payload?.meta?.checkin || query.checkIn || query.checkin),
        checkOut: safeIsoDate(payload?.meta?.checkout || query.checkOut || query.checkout),
        nights: positive(payload?.meta?.nights),
        guestRating: positive(stay?.rating?.value),
        hotelStars: positive(stay?.rating?.hotelStars),
        ratingCount: positive(stay?.rating?.count),
        deeplink: entry?.link || stay?.url || null,
        stay22Deeplink: stay?.url || null,
        address: stay?.location?.address || null,
        freeCancellation: stay?.policies?.freeCancellation ?? null,
        instantBook: stay?.policies?.instantBook ?? null,
        targetNameScore: propertyNameScore(stay?.name, query.targetProperty)
      });
    }
  }
  return rows.sort((a, b) => a.total - b.total || String(a.propertyName || '').localeCompare(String(b.propertyName || '')));
}

function chooseExactPropertyMatch(rows = [], targetProperty, threshold = DEFAULT_MATCH_THRESHOLD) {
  if (!isUsefulTargetProperty(targetProperty)) return null;
  const candidates = rows
    .filter(row => Number(row.targetNameScore || 0) >= threshold)
    .sort((a, b) => Number(b.targetNameScore || 0) - Number(a.targetNameScore || 0) || Number(a.total) - Number(b.total));
  if (!candidates.length) return null;
  const strongestScore = Number(candidates[0].targetNameScore || 0);
  const strongest = candidates.filter(row => Number(row.targetNameScore || 0) === strongestScore);
  return strongest.sort((a, b) => Number(a.total) - Number(b.total))[0] || candidates[0];
}

function chooseQualityBenchmark(rows = [], options = {}) {
  const guestFloor = Number(options.guestRating || DEFAULT_QUALITY_GUEST_RATING);
  const countFloor = Number(options.ratingCount || DEFAULT_QUALITY_RATING_COUNT);
  return rows.find(row => Number(row.guestRating || 0) >= guestFloor && Number(row.ratingCount || 0) >= countFloor) || null;
}

function sanitizeUrlForDiagnostics(url) {
  try {
    const parsed = new URL(String(url));
    parsed.searchParams.delete('key');
    return parsed.toString();
  } catch (_) {
    return null;
  }
}

function clonePayload(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function clearCache() {
  responseCache.clear();
}

async function fetchPayload(shape, env = process.env, options = {}) {
  const ttl = cacheTtlSeconds(env);
  const key = cacheKey(shape);
  const now = Date.now();
  const cached = responseCache.get(key);
  if (cached && cached.expiresAtMs > now) {
    return {
      ok: true,
      payload: clonePayload(cached.payload),
      fetchedAt: cached.fetchedAt,
      cache: { hit: true, ttlSeconds: ttl, expiresAt: new Date(cached.expiresAtMs).toISOString() },
      providerCache: cached.providerCache,
      rateLimit: cached.rateLimit,
      statusCode: 200,
      requestUrl: cached.requestUrl
    };
  }

  const hasKey = Boolean(String(env?.STAY22_API_KEY || '').trim());
  if (!hasKey && !demoAllowed(env)) {
    return { ok: false, reason: 'stay22-api-key-missing-and-demo-disabled', statusCode: null, cache: { hit: false, ttlSeconds: ttl } };
  }

  const url = buildUrl(shape);
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'Globevoy/682B Stay22 Evidence Adapter'
  };
  if (hasKey) headers['X-API-KEY'] = String(env.STAY22_API_KEY).trim();
  const fetchFn = options._fetchFn || globalThis.fetch;
  if (typeof fetchFn !== 'function') return { ok: false, reason: 'fetch-unavailable', statusCode: null, cache: { hit: false, ttlSeconds: ttl } };

  let response;
  let text = '';
  try {
    response = await fetchFn(url, { method: 'GET', headers });
    text = await response.text();
  } catch (error) {
    return { ok: false, reason: error.message || 'stay22-network-error', statusCode: null, cache: { hit: false, ttlSeconds: ttl }, requestUrl: sanitizeUrlForDiagnostics(url) };
  }

  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = null; }
  const rateLimit = {
    limit: response.headers?.get?.('x-ratelimit-limit') || null,
    remaining: response.headers?.get?.('x-ratelimit-remaining') || null,
    reset: response.headers?.get?.('x-ratelimit-reset') || null
  };
  const providerCache = response.headers?.get?.('x-cache') || null;
  if (!response.ok) {
    return {
      ok: false,
      reason: payload?.message || payload?.error || `HTTP ${response.status}`,
      code: payload?.code || null,
      statusCode: response.status,
      rateLimit,
      providerCache,
      cache: { hit: false, ttlSeconds: ttl },
      requestUrl: sanitizeUrlForDiagnostics(url)
    };
  }

  const fetchedAt = new Date().toISOString();
  const expiresAtMs = now + ttl * 1000;
  const requestUrl = sanitizeUrlForDiagnostics(url);
  responseCache.set(key, { payload: clonePayload(payload), fetchedAt, expiresAtMs, providerCache, rateLimit, requestUrl });
  return {
    ok: true,
    payload,
    fetchedAt,
    cache: { hit: false, ttlSeconds: ttl, expiresAt: new Date(expiresAtMs).toISOString() },
    providerCache,
    rateLimit,
    statusCode: response.status,
    requestUrl
  };
}

function toUsd(total, currency) {
  const amount = positive(total);
  if (!amount) return null;
  return Number((amount * currencyToUsdRate(normalizeCurrency(currency || 'CAD'))).toFixed(2));
}

async function fetchStay22Evidence(query = {}, env = process.env, options = {}) {
  if (!enabled(env)) return { enabled: false, version: STAY22_EVIDENCE_VERSION_682B, status: 'feature-disabled' };
  const shape = requestShape(query, env);
  if (!shape.address || !shape.checkin || !shape.checkout || shape.checkout <= shape.checkin) {
    return { enabled: true, version: STAY22_EVIDENCE_VERSION_682B, status: 'missing-location-or-stay-dates', productionEligible: false };
  }
  const fetched = await fetchPayload(shape, env, options);
  const hasKey = Boolean(String(env?.STAY22_API_KEY || '').trim());
  const approved = productionApproved(env);
  const productionEligible = hasKey && approved;
  if (!fetched.ok) {
    return {
      enabled: true,
      version: STAY22_EVIDENCE_VERSION_682B,
      status: fetched.reason || 'provider-error',
      code: fetched.code || null,
      statusCode: fetched.statusCode || null,
      productionEligible: false,
      mode: hasKey ? 'standard-key' : 'demo-no-key',
      cache: fetched.cache || null,
      rateLimit: fetched.rateLimit || null,
      requestUrl: fetched.requestUrl || null
    };
  }

  const rows = flattenQuotes(fetched.payload, { ...query, ...shape });
  const threshold = Number.isFinite(Number(options.matchThreshold)) ? Number(options.matchThreshold) : DEFAULT_MATCH_THRESHOLD;
  const targetIdentity = query.targetIdentity || shape.targetIdentity || buildPropertyIdentity({ name: query.targetProperty }, { city: query.city, country: query.country });
  const hardened = chooseConfidentMatch(rows, targetIdentity, { nameThreshold: threshold, ambiguityMargin: 0.02 });
  const exactPropertyMatch = hardened.row;
  // `hotelsearch` is a targeted property-name search, so its nearby/name results are
  // not a representative city-wide benchmark. Only un-targeted searches may produce
  // city-stay benchmark evidence.
  const cityBenchmark = shape.hotelsearch ? null : chooseQualityBenchmark(rows, options.qualityFloor || {});
  const observedAt = fetched.fetchedAt;
  const warnings = [];
  if (!hasKey) warnings.push('demo-mode-not-production-evidence');
  if (hasKey && !approved) warnings.push('commercial-production-approval-not-confirmed');
  if (targetIdentity?.status === 'generic-placeholder') warnings.push('generic-selected-stay-has-no-property-identity');
  if (targetIdentity?.safeForTargetedProviderSearch && !exactPropertyMatch) warnings.push(hardened?.decision?.reason || 'selected-property-not-confidently-matched');
  if (cityBenchmark) warnings.push('city-benchmark-must-not-replace-selected-property');

  function decorate(row, evidenceRole) {
    if (!row) return null;
    return {
      ...row,
      evidenceRole,
      totalUsd: toUsd(row.total, row.currency),
      observedAt,
      retrievedAt: new Date().toISOString(),
      productionEligible,
      providerCache: fetched.providerCache || null,
      clientCacheHit: fetched.cache?.hit === true,
      matchBasis: evidenceRole === 'same-property-rate' ? (row?.propertyIdentityMatch?.basis || hardened?.decision?.basis || 'property-identity-hardened-match') : 'quality-qualified-city-alternative',
      propertyIdentityVersion: PROPERTY_IDENTITY_VERSION_682C,
      propertyIdentityMatch: row?.propertyIdentityMatch || null
    };
  }

  return {
    enabled: true,
    version: STAY22_EVIDENCE_VERSION_682B,
    status: exactPropertyMatch ? 'same-property-rate-candidate' : (cityBenchmark ? 'city-benchmark-only' : 'no-usable-quoted-stays'),
    sourceClass: 'LIVE_ACCOMMODATION_QUOTE_CANDIDATE',
    mode: hasKey ? 'standard-key' : 'demo-no-key',
    productionEligible,
    exactStayDates: true,
    address: shape.address,
    checkIn: shape.checkin,
    checkOut: shape.checkout,
    adults: shape.adults,
    children: shape.children,
    rooms: shape.rooms,
    currency: normalizeCurrency(fetched.payload?.meta?.currency || shape.currency),
    quoteCount: rows.length,
    exactPropertyMatch: decorate(exactPropertyMatch, 'same-property-rate'),
    cityBenchmark: decorate(cityBenchmark, 'city-stay-benchmark-only'),
    targetProperty: targetIdentity?.safeForTargetedProviderSearch ? targetIdentity.canonicalName : null,
    targetIdentity,
    propertyMatchDecision: hardened?.decision || null,
    matchThreshold: threshold,
    observedAt,
    cache: fetched.cache,
    providerCache: fetched.providerCache || null,
    rateLimit: fetched.rateLimit || null,
    requestUrl: fetched.requestUrl || null,
    warnings
  };
}

module.exports = {
  STAY22_EVIDENCE_VERSION_682B,
  BASE_URL,
  DEFAULT_MATCH_THRESHOLD,
  enabled,
  demoAllowed,
  productionApproved,
  cacheTtlSeconds,
  requestShape,
  buildUrl,
  normalizeText,
  propertyNameScore,
  isUsefulTargetProperty,
  flattenQuotes,
  chooseExactPropertyMatch,
  chooseQualityBenchmark,
  fetchStay22Evidence,
  clearCache,
  _internal: { responseCache, cacheKey, fetchPayload, toUsd }
};
