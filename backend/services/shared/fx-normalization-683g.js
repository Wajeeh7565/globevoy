'use strict';

// GV-PROVIDER-683G — provider-currency / display-currency normalization.
// Uses Bank of Canada Valet daily indicative exchange-rate observations.
// This module is display/evidence normalization only. It never alters the
// provider's original amount/currency and is not enabled for P1/P2 ranking.

const FX_VERSION_683G = 'GV-PROVIDER-683G-R1';
const FX_PROVIDER_683G = 'bank-of-canada-valet-daily';
const VALET_BASE_683G = 'https://www.bankofcanada.ca/valet/observations';
const SUPPORTED_CURRENCIES_683G = Object.freeze(['USD', 'CAD', 'AUD', 'EUR', 'GBP']);
const SERIES_TO_CAD_683G = Object.freeze({
  USD: 'FXUSDCAD',
  EUR: 'FXEURCAD',
  GBP: 'FXGBPCAD',
  AUD: 'FXAUDCAD'
});
const DEFAULT_CACHE_TTL_SECONDS_683G = 21600; // 6h; BoC daily FX updates once per business day.
const DEFAULT_MAX_AGE_HOURS_683G = 120; // fail closed if latest rate is older than 5 days.
const MAX_DATE_SKEW_DAYS_683G = 2;
const seriesCache683G = new Map();

function envTrue(name, env = process.env) {
  return String(env?.[name] || '').trim().toLowerCase() === 'true';
}

function enabled683G(env = process.env) {
  return envTrue('ENABLE_BOC_FX_683G', env) && envTrue('ENABLE_FX_NORMALIZATION_683G', env);
}

function safeCurrency(value) {
  const c = String(value || '').trim().toUpperCase();
  return SUPPORTED_CURRENCIES_683G.includes(c) ? c : null;
}

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function configuredCacheTtlMs(env = process.env) {
  const raw = Number(env.GV_BOC_FX_CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL_SECONDS_683G);
  const seconds = Number.isFinite(raw) ? Math.max(300, Math.min(86400, raw)) : DEFAULT_CACHE_TTL_SECONDS_683G;
  return seconds * 1000;
}

function configuredMaxAgeHours(env = process.env) {
  const raw = Number(env.GV_BOC_FX_MAX_AGE_HOURS || DEFAULT_MAX_AGE_HOURS_683G);
  return Number.isFinite(raw) ? Math.max(24, Math.min(240, raw)) : DEFAULT_MAX_AGE_HOURS_683G;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function rateAgeHours(rateDate, nowMs = Date.now()) {
  const ts = Date.parse(`${rateDate}T00:00:00Z`);
  if (!Number.isFinite(ts)) return Infinity;
  return Math.max(0, (nowMs - ts) / 3600000);
}

function dateSkewDays(a, b) {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Infinity;
  return Math.abs(ta - tb) / 86400000;
}

function valetUrl683G(series) {
  return `${VALET_BASE_683G}/${series}/json?recent=10`;
}

function parseLatestSeriesObservation683G(payload = {}, series, nowMs = Date.now(), maxAgeHours = DEFAULT_MAX_AGE_HOURS_683G) {
  const rows = Array.isArray(payload?.observations) ? payload.observations : [];

  // Bank of Canada Valet `recent=N` responses are currently newest-first,
  // but ordering is not treated as a contract here. Select the newest valid
  // observation by date so the parser remains correct for newest-first,
  // oldest-first, or out-of-order payloads.
  let newest = null;
  for (const row of rows) {
    const rate = finitePositive(row?.[series]?.v);
    const rateDate = /^\d{4}-\d{2}-\d{2}$/.test(String(row?.d || '')) ? String(row.d) : null;
    if (!rate || !rateDate) continue;
    if (!newest || rateDate > newest.rateDate) newest = { rate, rateDate };
  }

  if (!newest) return { supported: false, reason: 'fx-rate-observation-missing', series };

  const ageHours = rateAgeHours(newest.rateDate, nowMs);
  return {
    supported: ageHours <= maxAgeHours,
    reason: ageHours <= maxAgeHours ? null : 'fx-rate-stale',
    series,
    rateToCad: newest.rate,
    rateDate: newest.rateDate,
    ageHours: Number(ageHours.toFixed(2)),
    stale: ageHours > maxAgeHours
  };
}

async function fetchSeriesRate683G(currency, options = {}) {
  const c = safeCurrency(currency);
  if (!c) return { supported: false, reason: 'unsupported-currency', currency: String(currency || '') };
  if (c === 'CAD') {
    return { supported: true, reason: null, currency: c, series: null, rateToCad: 1, rateDate: null, ageHours: 0, stale: false, cacheHit: true, identityCadPivot: true };
  }
  const series = SERIES_TO_CAD_683G[c];
  if (!series) return { supported: false, reason: 'fx-series-unavailable', currency: c };
  const env = options.env || process.env;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const maxAgeHours = configuredMaxAgeHours(env);
  const cacheKey = series;
  const cached = seriesCache683G.get(cacheKey);
  if (!options.bypassCache && cached && cached.expiresAt > nowMs) {
    const refreshedAge = rateAgeHours(cached.value.rateDate, nowMs);
    if (refreshedAge <= maxAgeHours) {
      return { ...cached.value, ageHours: Number(refreshedAge.toFixed(2)), cacheHit: true };
    }
  }

  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { supported: false, reason: 'fetch-unavailable', currency: c, series };
  const url = valetUrl683G(series);
  const started = Date.now();
  try {
    const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/json' } });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch (_) { return { supported: false, reason: `boc-non-json-http-${response.status}`, currency: c, series, statusCode: response.status }; }
    if (!response.ok) return { supported: false, reason: `boc-http-${response.status}`, currency: c, series, statusCode: response.status };
    const parsed = parseLatestSeriesObservation683G(payload, series, nowMs, maxAgeHours);
    const value = {
      ...parsed,
      currency: c,
      source: FX_PROVIDER_683G,
      url,
      retrievedAt: new Date(nowMs).toISOString(),
      responseTimeMs: Date.now() - started,
      cacheHit: false
    };
    if (value.supported) {
      seriesCache683G.set(cacheKey, { value, expiresAt: nowMs + configuredCacheTtlMs(env) });
    }
    return value;
  } catch (error) {
    return { supported: false, reason: `boc-request-error:${String(error?.message || 'unknown')}`, currency: c, series };
  }
}

function unsupported683G(reason, extra = {}) {
  return {
    supported: false,
    reason,
    version: FX_VERSION_683G,
    provider: FX_PROVIDER_683G,
    displayOnly: true,
    rankingEligible: false,
    productionApproved: false,
    ...extra
  };
}

async function normalizeAmount683G(input = {}, options = {}) {
  const env = options.env || process.env;
  if (!enabled683G(env) && options.allowWithoutFlags !== true) return unsupported683G('fx-683g-disabled');

  const amount = finitePositive(input.providerAmount ?? input.amount ?? input.totalPrice ?? input.price);
  const providerCurrency = safeCurrency(input.providerCurrency || input.currency);
  const displayCurrency = safeCurrency(input.displayCurrency || input.targetCurrency || input.requestedCurrency);
  if (!amount) return unsupported683G('invalid-provider-amount');
  if (!providerCurrency) return unsupported683G('invalid-provider-currency');
  if (!displayCurrency) return unsupported683G('invalid-display-currency');

  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const retrievedAt = new Date(nowMs).toISOString();
  if (providerCurrency === displayCurrency) {
    return {
      supported: true,
      reason: null,
      version: FX_VERSION_683G,
      provider: 'identity-no-conversion',
      providerAmount: amount,
      providerCurrency,
      displayAmount: roundMoney(amount),
      displayCurrency,
      crossRate: 1,
      rateDate: null,
      retrievedAt,
      indicative: false,
      displayOnly: true,
      rankingEligible: false,
      productionApproved: false,
      conversionApplied: false,
      originalProviderEvidencePreserved: true,
      fxEvidence: { source: 'IDENTITY', crossRate: 1, rateDate: null, stale: false, cacheHit: true }
    };
  }

  const [fromRate, toRate] = await Promise.all([
    fetchSeriesRate683G(providerCurrency, { ...options, env, nowMs }),
    fetchSeriesRate683G(displayCurrency, { ...options, env, nowMs })
  ]);
  if (!fromRate.supported) return unsupported683G(fromRate.reason || 'provider-currency-rate-unavailable', { providerCurrency, displayCurrency, failedCurrency: providerCurrency, rateEvidence: fromRate });
  if (!toRate.supported) return unsupported683G(toRate.reason || 'display-currency-rate-unavailable', { providerCurrency, displayCurrency, failedCurrency: displayCurrency, rateEvidence: toRate });

  const fromDate = fromRate.rateDate || toRate.rateDate;
  const toDate = toRate.rateDate || fromRate.rateDate;
  if (fromDate && toDate && dateSkewDays(fromDate, toDate) > MAX_DATE_SKEW_DAYS_683G) {
    return unsupported683G('fx-rate-date-skew', { providerCurrency, displayCurrency, providerRateDate: fromDate, displayRateDate: toDate });
  }

  const crossRate = fromRate.rateToCad / toRate.rateToCad;
  if (!Number.isFinite(crossRate) || crossRate <= 0) return unsupported683G('invalid-cross-rate', { providerCurrency, displayCurrency });
  const displayAmount = roundMoney(amount * crossRate);
  const effectiveRateDate = [fromRate.rateDate, toRate.rateDate].filter(Boolean).sort()[0] || null;

  return {
    supported: true,
    reason: null,
    version: FX_VERSION_683G,
    provider: FX_PROVIDER_683G,
    providerAmount: amount,
    providerCurrency,
    displayAmount,
    displayCurrency,
    crossRate: Number(crossRate.toFixed(8)),
    rateDate: effectiveRateDate,
    retrievedAt,
    indicative: true,
    displayOnly: true,
    rankingEligible: false,
    productionApproved: false,
    conversionApplied: true,
    originalProviderEvidencePreserved: true,
    fxEvidence: {
      source: FX_PROVIDER_683G,
      methodology: 'foreign-currency-to-CAD daily rates with CAD pivot cross-rate',
      providerRateToCad: fromRate.rateToCad,
      providerRateSeries: fromRate.series,
      providerRateDate: fromRate.rateDate,
      displayRateToCad: toRate.rateToCad,
      displayRateSeries: toRate.series,
      displayRateDate: toRate.rateDate,
      crossRate: Number(crossRate.toFixed(8)),
      rateDate: effectiveRateDate,
      maxAgeHours: configuredMaxAgeHours(env),
      providerRateAgeHours: fromRate.ageHours,
      displayRateAgeHours: toRate.ageHours,
      stale: false,
      cacheHit: Boolean(fromRate.cacheHit && toRate.cacheHit),
      indicative: true
    }
  };
}

async function normalizeObservation683G(observation = {}, displayCurrency, options = {}) {
  const result = await normalizeAmount683G({
    providerAmount: observation.totalPrice ?? observation.price,
    providerCurrency: observation.currency,
    displayCurrency
  }, options);
  if (!result.supported) return { supported: false, reason: result.reason, originalObservation: observation, fx: result };
  return {
    supported: true,
    reason: null,
    originalObservation: observation,
    normalizedObservation: {
      ...observation,
      // The provider's canonical evidence remains untouched.
      totalPrice: observation.totalPrice,
      price: observation.price,
      currency: observation.currency,
      providerAmount: result.providerAmount,
      providerCurrency: result.providerCurrency,
      displayPrice: result.displayAmount,
      displayCurrency: result.displayCurrency,
      fxNormalization683G: result
    },
    fx: result
  };
}

function status683G(env = process.env) {
  return {
    version: FX_VERSION_683G,
    enabled: enabled683G(env),
    provider: FX_PROVIDER_683G,
    supportedCurrencies: SUPPORTED_CURRENCIES_683G,
    cacheTtlSeconds: configuredCacheTtlMs(env) / 1000,
    maxRateAgeHours: configuredMaxAgeHours(env),
    indicativeRatesOnly: true,
    displayOnly: true,
    productionApproved: false,
    rankingEnabled: false,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    secretRequired: false,
    secretValuesReturned: false
  };
}

function clearCache683G() {
  seriesCache683G.clear();
}

module.exports = {
  FX_VERSION_683G,
  FX_PROVIDER_683G,
  SUPPORTED_CURRENCIES_683G,
  SERIES_TO_CAD_683G,
  DEFAULT_CACHE_TTL_SECONDS_683G,
  DEFAULT_MAX_AGE_HOURS_683G,
  enabled683G,
  safeCurrency,
  roundMoney,
  rateAgeHours,
  dateSkewDays,
  valetUrl683G,
  parseLatestSeriesObservation683G,
  fetchSeriesRate683G,
  normalizeAmount683G,
  normalizeObservation683G,
  status683G,
  clearCache683G
};
