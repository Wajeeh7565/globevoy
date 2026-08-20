'use strict';

const crypto = require('node:crypto');

const PRICE_EVIDENCE_VERSION = 'GV-TRUST-681A-R1';
const SOURCE_TYPES = Object.freeze({ LIVE: 'LIVE', CACHED: 'CACHED', ESTIMATED: 'ESTIMATED', UNAVAILABLE: 'UNAVAILABLE' });

function text(value) { return String(value || '').trim(); }
function code(value) { const out = text(value).toUpperCase(); return /^[A-Z]{3}$/.test(out) ? out : null; }
function currency(value) { const out = text(value).toUpperCase(); return /^[A-Z]{3}$/.test(out) ? out : null; }
function date(value) { const out = text(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null; }
function timestamp(value) { const out = text(value); return Number.isFinite(Date.parse(out)) ? new Date(out).toISOString() : null; }
function finite(value) { const out = Number(value); return Number.isFinite(out) && out >= 0 ? out : null; }
function sourceType(value, fallback = SOURCE_TYPES.UNAVAILABLE) {
  const out = text(value).toUpperCase();
  return Object.prototype.hasOwnProperty.call(SOURCE_TYPES, out) ? SOURCE_TYPES[out] : fallback;
}
function evidenceId(parts) {
  return `gve-${crypto.createHash('sha256').update(parts.map(item => text(item)).join('|')).digest('hex').slice(0, 20)}`;
}

function normalizeFlightEvidence(input = {}, request = {}) {
  const amount = finite(input.amount ?? input.price);
  const origin = code(input.origin || request.origin);
  const destination = code(input.destination || request.destination);
  const departureDate = date(input.departureDate || request.departureDate);
  const observedCurrency = currency(input.currency || request.currency);
  const requestedOrigin = code(request.origin);
  const requestedDestination = code(request.destination);
  const requestedDate = date(request.departureDate);
  const requestedCurrency = currency(request.currency);
  const routeMatch = Boolean(origin && destination && (!requestedOrigin || origin === requestedOrigin) && (!requestedDestination || destination === requestedDestination));
  const dateMatch = Boolean(departureDate && (!requestedDate || departureDate === requestedDate));
  const currencyMatch = Boolean(observedCurrency && (!requestedCurrency || observedCurrency === requestedCurrency));
  let type = sourceType(input.sourceType, amount === null ? SOURCE_TYPES.UNAVAILABLE : (input.providerBacked ? SOURCE_TYPES.CACHED : SOURCE_TYPES.ESTIMATED));
  if ((type === SOURCE_TYPES.LIVE || type === SOURCE_TYPES.CACHED) && (!routeMatch || !dateMatch || !currencyMatch)) type = SOURCE_TYPES.UNAVAILABLE;
  const observedAt = timestamp(input.observedAt);
  const retrievedAt = timestamp(input.retrievedAt || input.providerFetchedAt || input.fetchedAt);
  const isExactDate = Boolean(input.isExactDate ?? input.exactDateMatch ?? (requestedDate && dateMatch));
  const isBookable = Boolean(type === SOURCE_TYPES.LIVE && input.bookingLink && routeMatch && dateMatch && currencyMatch && input.productionEligible !== false);
  return {
    version: PRICE_EVIDENCE_VERSION,
    amount,
    currency: observedCurrency,
    origin,
    destination,
    departureDate,
    source: text(input.source || 'unknown'),
    sourceType: type,
    observedAt,
    retrievedAt,
    cacheTimestamp: timestamp(input.cacheTimestamp || input.cachedAt),
    cacheHit: Boolean(input.cacheHit),
    confidence: type === SOURCE_TYPES.LIVE ? 'HIGH' : type === SOURCE_TYPES.CACHED ? 'MEDIUM' : type === SOURCE_TYPES.ESTIMATED ? 'LOW' : 'NONE',
    isExactDate,
    isBookable,
    routeMatch,
    dateMatch,
    currencyMatch,
    passengers: Number(input.passengers || request.passengers || 0) || null,
    evidenceId: text(input.evidenceId) || evidenceId(['flight', origin, destination, departureDate, observedCurrency, amount, input.source, observedAt, retrievedAt])
  };
}

function normalizeHotelEvidence(input = {}, request = {}) {
  const amount = finite(input.amount ?? input.stayTotal ?? input.estimatedStayUsd);
  const observedCurrency = currency(input.currency || request.currency || 'USD');
  const checkIn = date(input.checkIn || request.checkIn);
  const checkOut = date(input.checkOut || request.checkOut);
  const exactDates = Boolean(checkIn && checkOut && (!request.checkIn || checkIn === date(request.checkIn)) && (!request.checkOut || checkOut === date(request.checkOut)));
  let type = sourceType(input.sourceType, amount === null ? SOURCE_TYPES.UNAVAILABLE : (input.providerObserved ? SOURCE_TYPES.CACHED : SOURCE_TYPES.ESTIMATED));
  if ((type === SOURCE_TYPES.LIVE || type === SOURCE_TYPES.CACHED) && (!exactDates || (request.currency && observedCurrency !== currency(request.currency)))) type = SOURCE_TYPES.UNAVAILABLE;
  const observedAt = timestamp(input.observedAt);
  const retrievedAt = timestamp(input.retrievedAt || input.checkedAt);
  return {
    version: PRICE_EVIDENCE_VERSION,
    amount,
    currency: observedCurrency,
    city: text(input.city || request.city) || null,
    propertyId: text(input.propertyId || input.hotelId) || null,
    propertyName: text(input.propertyName || input.hotelName) || null,
    checkIn,
    checkOut,
    nights: Number(input.nights || request.nights || 0) || null,
    rooms: Number(input.rooms || request.rooms || 0) || null,
    source: text(input.source || 'unknown'),
    sourceType: type,
    observedAt,
    retrievedAt,
    confidence: type === SOURCE_TYPES.LIVE ? 'HIGH' : type === SOURCE_TYPES.CACHED ? 'MEDIUM' : type === SOURCE_TYPES.ESTIMATED ? 'LOW' : 'NONE',
    isExactDate: exactDates,
    isBookable: false,
    taxBasis: text(input.taxBasis || 'unknown'),
    feeBasis: text(input.feeBasis || 'unknown'),
    amountBasis: text(input.amountBasis || 'stay-total'),
    evidenceId: text(input.evidenceId) || evidenceId(['hotel', input.city || request.city, input.propertyId || input.hotelId, checkIn, checkOut, observedCurrency, amount, input.source, observedAt, retrievedAt])
  };
}

function automaticDateFloor({ now = new Date(), minimumLeadDays = 14 } = {}) {
  const base = new Date(now);
  if (Number.isNaN(base.getTime())) throw new Error('Invalid current date');
  base.setUTCHours(12, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + Math.max(0, Math.round(Number(minimumLeadDays) || 14)));
  return base.toISOString().slice(0, 10);
}

function automaticDateAllowed(value, options = {}) {
  const candidate = date(value);
  return Boolean(candidate && candidate >= automaticDateFloor(options));
}

module.exports = { PRICE_EVIDENCE_VERSION, SOURCE_TYPES, normalizeFlightEvidence, normalizeHotelEvidence, automaticDateFloor, automaticDateAllowed };
