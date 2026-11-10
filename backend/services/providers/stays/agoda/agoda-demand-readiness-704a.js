'use strict';

// GV-HOTEL-704A — pure Agoda Demand API readiness contract.
//
// This module performs no network requests, does not read or return credentials,
// does not enable Agoda traffic, and does not modify the existing 679A legacy
// adapter. It exists to make the modern Agoda Demand Search contract explicit
// before Globevoy wires any provider call into recommendations.

const VERSION = 'GV-HOTEL-704A';
const CURRENT_SEARCH_PATH = '/api/v4/property/availability';
const LEGACY_DEFAULT_ENDPOINT = 'https://affiliateapi7643.agoda.com/affiliateservice/lt_v1';
const MAX_PROPERTY_IDS = 100;
const DEFAULT_LANGUAGE = 'en-us';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_USER_COUNTRY = 'CA';
const DEFAULT_RATES_PER_PROPERTY = 1;
const REQUIRED_EXTRAS = Object.freeze([
  'dailyRate',
  'taxDetail',
  'rateDetail',
  'cancellationDetail',
  'surchargeDetail'
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function positiveInt(value, fallback = null, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function isoDate(value) {
  const raw = clean(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? null : raw;
}

function currency(value) {
  const raw = clean(value || DEFAULT_CURRENCY).toUpperCase();
  return /^[A-Z]{3}$/.test(raw) ? raw : null;
}

function country(value) {
  const raw = clean(value || DEFAULT_USER_COUNTRY).toUpperCase();
  return /^[A-Z]{2}$/.test(raw) ? raw : null;
}

function language(value) {
  const raw = clean(value || DEFAULT_LANGUAGE).toLowerCase();
  return /^[a-z]{2}-[a-z]{2}$/.test(raw) ? raw : null;
}

function propertyIds(values = []) {
  const rows = Array.isArray(values) ? values : [values];
  const normalized = [];
  const seen = new Set();
  for (const value of rows) {
    const id = positiveInt(value, null, 1);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
    if (normalized.length > MAX_PROPERTY_IDS) break;
  }
  return normalized;
}

function buildSearchRequest704A(input = {}) {
  const ids = propertyIds(input.propertyIds);
  const checkIn = isoDate(input.checkIn);
  const checkOut = isoDate(input.checkOut);
  const rooms = positiveInt(input.rooms, null, 1, 9);
  const adults = positiveInt(input.adults, null, 1, 18);
  const children = positiveInt(input.children, 0, 0, 12);
  const childrenAges = Array.isArray(input.childrenAges)
    ? input.childrenAges.map(value => positiveInt(value, null, 0, 17)).filter(value => value !== null)
    : [];
  const requestedCurrency = currency(input.currency);
  const requestedLanguage = language(input.language);
  const userCountry = country(input.userCountry);
  const ratesPerProperty = positiveInt(input.ratesPerProperty, DEFAULT_RATES_PER_PROPERTY, 1, 100);
  const errors = [];

  if (!ids.length) errors.push('missing-property-ids');
  if (ids.length > MAX_PROPERTY_IDS) errors.push('property-id-cap-exceeded');
  if (!checkIn) errors.push('invalid-check-in');
  if (!checkOut) errors.push('invalid-check-out');
  if (checkIn && checkOut && checkOut <= checkIn) errors.push('check-out-must-follow-check-in');
  if (!rooms) errors.push('invalid-room-count');
  if (!adults) errors.push('invalid-adult-count');
  if (children === null) errors.push('invalid-child-count');
  if (children > 0 && childrenAges.length !== children) errors.push('children-ages-must-match-child-count');
  if (children === 0 && childrenAges.length) errors.push('children-ages-require-children');
  if (!requestedCurrency) errors.push('invalid-currency');
  if (!requestedLanguage) errors.push('invalid-language');
  if (!userCountry) errors.push('invalid-user-country');

  return {
    valid: errors.length === 0,
    errors,
    version: VERSION,
    request: errors.length ? null : {
      waitTime: positiveInt(input.waitTime, 10, 1, 60),
      criteria: {
        propertyIds: ids,
        checkIn,
        checkOut,
        rooms,
        adults,
        children,
        ...(children > 0 ? { childrenAges } : {}),
        language: requestedLanguage,
        currency: requestedCurrency,
        userCountry
      },
      features: {
        ratesPerProperty,
        extra: REQUIRED_EXTRAS.slice()
      }
    }
  };
}

function amount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null;
}

function roomObservation704A(property = {}, room = {}, context = {}) {
  const propertyId = positiveInt(property.propertyId, null, 1);
  const roomId = positiveInt(room.roomId, null, 1);
  const totalInclusive = amount(room?.totalPayment?.inclusive);
  const totalExclusive = amount(room?.totalPayment?.exclusive);
  const tax = amount(room?.totalPayment?.tax);
  const fees = amount(room?.totalPayment?.fees);
  const nightlyInclusive = amount(room?.perRoomPerNightRate?.inclusive);
  const nightlyExclusive = amount(room?.perRoomPerNightRate?.exclusive);
  const providerCurrency = currency(room?.perRoomPerNightRate?.currency || room?.rate?.currency || context.currency);
  const available = Boolean(propertyId && roomId && room.blockId && totalInclusive !== null && providerCurrency);

  return {
    version: VERSION,
    provider: 'Agoda-Demand',
    propertyId,
    propertyName: property.propertyName || property.translatedPropertyName || null,
    roomId,
    roomName: room.roomName || room.translatedRoomName || null,
    blockId: room.blockId || null,
    ratePlanId: positiveInt(room.ratePlanId, null, 1),
    providerCurrency,
    providerStayTotal: totalInclusive,
    providerStayTotalExclusive: totalExclusive,
    providerNightlyInclusive: nightlyInclusive,
    providerNightlyExclusive: nightlyExclusive,
    tax,
    fees,
    remainingRooms: positiveInt(room.remainingRooms, null, 0),
    freeBreakfast: room.freeBreakfast === true,
    freeCancellation: room.freeCancellation === true,
    availabilityConfirmed: available,
    livePriceEligible: available,
    priceBasis: 'total-payment-inclusive-per-search-occupancy',
    nightlyBasis: nightlyInclusive !== null ? 'per-room-per-night-inclusive' : null,
    taxBasis: 'inclusive-total-payment-with-separate-tax-and-fee-fields',
    finalBookingPriceRequiresPrecheck: true,
    providerSearchOnly: true,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false,
    ticketingCapability: false
  };
}

function parseSearchResponse704A(payload = {}, context = {}) {
  const properties = Array.isArray(payload?.properties) ? payload.properties : [];
  const observations = [];
  for (const property of properties) {
    for (const room of (Array.isArray(property?.rooms) ? property.rooms : [])) {
      const row = roomObservation704A(property, room, context);
      if (row.availabilityConfirmed) observations.push(row);
    }
  }
  observations.sort((a, b) => Number(a.providerStayTotal) - Number(b.providerStayTotal)
    || Number(a.propertyId) - Number(b.propertyId)
    || Number(a.roomId) - Number(b.roomId));
  return {
    version: VERSION,
    supported: observations.length > 0,
    reason: observations.length ? null : 'agoda-demand-no-available-live-room-rate',
    searchId: payload?.searchId == null ? null : String(payload.searchId),
    observationCount: observations.length,
    observations,
    cheapestObservation: observations[0] || null,
    sourceType: observations.length ? 'LIVE' : 'UNAVAILABLE',
    completeLiveEvidenceRequired: true,
    providerSearchOnly: true,
    orderCapability: false,
    paymentCapability: false,
    bookingCapability: false
  };
}

function auditCurrentIntegration704A(env = {}) {
  const configuredEndpoint = clean(env.AGODA_ENDPOINT || LEGACY_DEFAULT_ENDPOINT);
  const legacyEndpointDetected = /affiliateapi7643\.agoda\.com|affiliateservice\/lt_v1/i.test(configuredEndpoint);
  return {
    version: VERSION,
    currentLegacyAdapter: 'backend/services/providers/stays/agoda/agoda.js',
    configuredEndpointClass: legacyEndpointDetected ? 'legacy-affiliate-lt-v1' : 'custom-or-unknown',
    legacyDefaultEndpoint: LEGACY_DEFAULT_ENDPOINT,
    currentDemandSearchPath: CURRENT_SEARCH_PATH,
    currentLegacyRequestIdentity: 'city-id-based',
    demandSearchIdentity: 'property-id-list-based',
    legacyCityIdMappingAloneSufficientForDemandSearch: false,
    propertyCatalogRequired: true,
    contentFeedOrContentApiRequiredForPropertyDiscovery: true,
    searchResponseSchemaCompatibleWithLegacyParser: false,
    migrationMustUseNewAdapterBoundary: true,
    recommendedAuthentication: 'oauth2',
    apiKeyAuthenticationStatus: 'supported-but-deprecated-by-end-of-2026',
    apiKeyIpWhitelistingRequired: true,
    partnerOnboardingRequired: true,
    certificationBeforeLiveRecommended: true,
    liveTrafficEnabledBy704A: false,
    credentialsReadBy704A: false,
    credentialsReturnedBy704A: false,
    productionChanged: false
  };
}

module.exports = {
  VERSION,
  CURRENT_SEARCH_PATH,
  LEGACY_DEFAULT_ENDPOINT,
  MAX_PROPERTY_IDS,
  REQUIRED_EXTRAS,
  buildSearchRequest704A,
  parseSearchResponse704A,
  auditCurrentIntegration704A,
  _internal: {
    clean,
    positiveInt,
    isoDate,
    currency,
    country,
    language,
    propertyIds,
    amount,
    roomObservation704A
  }
};
