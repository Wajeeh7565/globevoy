'use strict';

const PRICE_AUDIT_VERSION = 'GV-PRICE-610D-1';
const DEFAULT_MIN_ABSOLUTE_NIGHTLY_USD = 12;
const DEFAULT_MIN_BASELINE_RATIO = 0.25;

const SUPPORTED_CURRENCIES = Object.freeze(['CAD', 'USD', 'EUR', 'GBP', 'AUD']);

function isPriceAudit610DEnabled() {
  return String(process.env.ENABLE_PRICE_AUDIT_610D || '').trim().toLowerCase() === 'true';
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCurrency(value) {
  const code = String(value || '').trim().toUpperCase();
  return SUPPORTED_CURRENCIES.includes(code) ? code : null;
}

function convertToUsd(amount, currency) {
  const value = positiveNumber(amount);
  const code = normalizeCurrency(currency);
  if (!value || !code) return null;
  if (code === 'USD') return value;
  if (code === 'CAD') return value * Number(process.env.CAD_TO_USD || 0.735);
  if (code === 'AUD') return value * Number(process.env.AUD_TO_USD || 0.66);
  if (code === 'EUR') return value * Number(process.env.EUR_TO_USD || 1.08);
  if (code === 'GBP') return value * Number(process.env.GBP_TO_USD || 1.27);
  return null;
}


function resolveDeclaredCurrency(primary, secondary, fallback) {
  const first = String(primary || '').trim();
  if (first) return normalizeCurrency(first);
  const second = String(secondary || '').trim();
  if (second) return normalizeCurrency(second);
  return normalizeCurrency(fallback);
}

function firstRate(candidates) {
  for (const candidate of candidates) {
    const value = positiveNumber(candidate.value);
    if (value) return { ...candidate, value };
  }
  return null;
}

function classifyAgodaRate(hotel = {}, requestCurrency, nights) {
  const stayNights = Math.max(1, Math.round(Number(nights) || 1));
  const hotelCurrency = normalizeCurrency(hotel.currency);

  // Affiliate Long Tail API: `dailyRate` is an explicit daily sell rate,
  // exclusive of taxes and service fees. Prefer this old-endpoint contract.
  const topLevelDaily = positiveNumber(hotel.dailyRate);
  if (topLevelDaily) {
    return {
      accepted: true,
      sourceField: 'dailyRate',
      providerContract: 'agoda-affiliate-long-tail-v2',
      unit: 'per-room-per-night',
      taxBasis: 'exclusive',
      amount: topLevelDaily,
      currency: resolveDeclaredCurrency(hotel.currency, null, requestCurrency),
      nights: stayNights
    };
  }

  // Newer Agoda Search API response shapes are supported defensively when
  // explicit unit semantics are available.
  const perNight = firstRate([
    { value: hotel?.perRoomPerNightRate?.inclusive, sourceField: 'perRoomPerNightRate.inclusive', taxBasis: 'inclusive' },
    { value: hotel?.perRoomPerNightRate?.exclusive, sourceField: 'perRoomPerNightRate.exclusive', taxBasis: 'exclusive' }
  ]);
  if (perNight) {
    return {
      accepted: true,
      sourceField: perNight.sourceField,
      providerContract: 'agoda-json-search-api',
      unit: 'per-room-per-night',
      taxBasis: perNight.taxBasis,
      amount: perNight.value,
      currency: resolveDeclaredCurrency(hotel?.perRoomPerNightRate?.currency, hotel.currency, requestCurrency),
      nights: stayNights
    };
  }

  const total = firstRate([
    { value: hotel?.totalPayment?.inclusive, sourceField: 'totalPayment.inclusive', taxBasis: 'inclusive' },
    { value: hotel?.totalPayment?.exclusive, sourceField: 'totalPayment.exclusive', taxBasis: 'exclusive' }
  ]);
  if (total) {
    return {
      accepted: true,
      sourceField: total.sourceField,
      providerContract: 'agoda-json-search-api',
      unit: 'total-stay',
      taxBasis: total.taxBasis,
      amount: total.value,
      currency: resolveDeclaredCurrency(hotel?.totalPayment?.currency, hotel.currency, requestCurrency),
      nights: stayNights
    };
  }

  const method = String(hotel?.rate?.method || '').trim().toUpperCase();
  const explicitRate = firstRate([
    { value: hotel?.rate?.inclusive, sourceField: 'rate.inclusive', taxBasis: 'inclusive' },
    { value: hotel?.rate?.exclusive, sourceField: 'rate.exclusive', taxBasis: 'exclusive' }
  ]);
  if (explicitRate && ['PRPN', 'PN', 'PB'].includes(method)) {
    return {
      accepted: true,
      sourceField: explicitRate.sourceField,
      providerContract: 'agoda-json-search-api',
      unit: method === 'PB' ? 'total-stay' : 'per-room-per-night',
      taxBasis: explicitRate.taxBasis,
      amount: explicitRate.value,
      currency: resolveDeclaredCurrency(hotel?.rate?.currency, hotel.currency, requestCurrency),
      nights: stayNights,
      method
    };
  }

  const ambiguousFields = [
    ['price', hotel.price],
    ['roomRate', hotel.roomRate],
    ['averageNightlyRate', hotel.averageNightlyRate],
    ['pricing.dailyRate', hotel?.pricing?.dailyRate]
  ].filter(([, value]) => positiveNumber(value));

  return {
    accepted: false,
    reason: ambiguousFields.length ? 'ambiguous-price-unit' : 'no-supported-price-field',
    ambiguousFields: ambiguousFields.map(([field]) => field),
    currency: hotelCurrency || normalizeCurrency(requestCurrency),
    nights: stayNights
  };
}

function buildPlausibilityBounds(destination = {}) {
  const fallbackNightlyUsd = positiveNumber(destination.fallbackNightlyUsd);
  const absoluteFloor = positiveNumber(process.env.AGODA_MIN_LIVE_NIGHTLY_USD) || DEFAULT_MIN_ABSOLUTE_NIGHTLY_USD;
  const ratio = positiveNumber(process.env.AGODA_MIN_BASELINE_RATIO) || DEFAULT_MIN_BASELINE_RATIO;
  const baselineFloor = fallbackNightlyUsd ? fallbackNightlyUsd * ratio : 0;
  return {
    fallbackNightlyUsd,
    minimumNightlyUsd: Math.max(absoluteFloor, baselineFloor),
    minimumBaselineRatio: ratio,
    absoluteFloor
  };
}

function auditAgodaHotelRate({ hotel = {}, requestCurrency, nights, destination = {} }) {
  const classification = classifyAgodaRate(hotel, requestCurrency, nights);
  if (!classification.accepted) {
    return {
      accepted: false,
      reason: classification.reason,
      classification,
      warnings: ['hotel-price-unit-unverified']
    };
  }

  if (!classification.currency) {
    return {
      accepted: false,
      reason: 'unsupported-or-missing-provider-currency',
      classification,
      warnings: ['hotel-price-currency-unverified']
    };
  }

  const amountUsd = convertToUsd(classification.amount, classification.currency);
  if (!amountUsd) {
    return {
      accepted: false,
      reason: 'currency-conversion-unavailable',
      classification,
      warnings: ['hotel-price-currency-unverified']
    };
  }

  const totalStayUsd = classification.unit === 'total-stay'
    ? amountUsd
    : amountUsd * classification.nights;
  const averageNightlyUsd = totalStayUsd / classification.nights;
  const bounds = buildPlausibilityBounds(destination);
  if (averageNightlyUsd < bounds.minimumNightlyUsd) {
    return {
      accepted: false,
      reason: 'implausibly-low-live-rate',
      classification,
      averageNightlyUsd,
      totalStayUsd,
      bounds,
      warnings: ['hotel-price-below-safety-floor', 'live-rate-rejected']
    };
  }

  const warnings = ['availability-not-guaranteed'];
  if (classification.taxBasis === 'exclusive') warnings.push('taxes-and-fees-excluded');

  return {
    accepted: true,
    classification,
    averageNightlyUsd,
    totalStayUsd,
    bounds,
    warnings,
    priceEvidence: {
      auditVersion: PRICE_AUDIT_VERSION,
      classification: classification.unit === 'total-stay' ? 'live-provider-total' : 'live-provider-nightly',
      provider: 'Agoda',
      providerContract: classification.providerContract,
      sourceField: classification.sourceField,
      unit: classification.unit,
      taxBasis: classification.taxBasis,
      taxesAndFeesIncluded: classification.taxBasis === 'inclusive',
      providerCurrency: classification.currency,
      requestedCurrency: normalizeCurrency(requestCurrency),
      nights: classification.nights,
      providerAmount: Number(classification.amount.toFixed(2)),
      providerStayTotal: Number((classification.unit === 'total-stay'
        ? classification.amount
        : classification.amount * classification.nights).toFixed(2)),
      averageNightlyUsd: Number(averageNightlyUsd.toFixed(2)),
      totalStayUsd: Number(totalStayUsd.toFixed(2)),
      plausibilityFloorUsd: Number(bounds.minimumNightlyUsd.toFixed(2)),
      confidence: 'high',
      warnings
    }
  };
}

function median(items, selector) {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => selector(a) - selector(b));
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

function auditAgodaHotelSample({ hotels = [], requestCurrency, nights, destination = {}, limit = 5 }) {
  const audited = hotels.map(hotel => ({
    hotel,
    audit: auditAgodaHotelRate({ hotel, requestCurrency, nights, destination })
  }));
  const accepted = audited.filter(item => item.audit.accepted).slice(0, Math.max(1, Number(limit) || 5));
  const rejected = audited.filter(item => !item.audit.accepted);
  const selected = median(accepted, item => item.audit.averageNightlyUsd);

  return {
    auditVersion: PRICE_AUDIT_VERSION,
    selected,
    accepted,
    rejected,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    rejectionReasons: rejected.reduce((acc, item) => {
      const reason = item.audit.reason || 'unknown';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {})
  };
}

function buildPlanningEstimateEvidence({ destination = {}, nights, reason = 'provider-price-unavailable' }) {
  const nightlyUsd = positiveNumber(destination.fallbackNightlyUsd) || 85;
  const stayNights = Math.max(1, Math.round(Number(nights) || 1));
  return {
    auditVersion: PRICE_AUDIT_VERSION,
    classification: 'planning-estimate',
    provider: null,
    providerContract: null,
    sourceField: 'destination.fallbackNightlyUsd',
    unit: 'per-room-per-night',
    taxBasis: 'unknown',
    taxesAndFeesIncluded: false,
    providerCurrency: 'USD',
    requestedCurrency: null,
    nights: stayNights,
    providerAmount: nightlyUsd,
    providerStayTotal: nightlyUsd * stayNights,
    averageNightlyUsd: nightlyUsd,
    totalStayUsd: nightlyUsd * stayNights,
    plausibilityFloorUsd: null,
    confidence: 'medium',
    reason,
    warnings: ['planning-estimate-not-live-price', 'final-price-requires-partner-confirmation']
  };
}

module.exports = {
  PRICE_AUDIT_VERSION,
  SUPPORTED_CURRENCIES,
  isPriceAudit610DEnabled,
  normalizeCurrency,
  resolveDeclaredCurrency,
  convertToUsd,
  classifyAgodaRate,
  buildPlausibilityBounds,
  auditAgodaHotelRate,
  auditAgodaHotelSample,
  buildPlanningEstimateEvidence
};
