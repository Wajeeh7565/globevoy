'use strict';

// GV-PROVIDER-683C — provider-neutral flight evidence contract.
// Pure normalization only. This module performs no network requests and has no
// booking/order/payment capability.

const { SOURCE_TYPES, normalizeFlightEvidence } = require('../../domain/pricing/price-evidence-integrity');

const FLIGHT_PROVIDER_CONTRACT_VERSION_683C = 'GV-PROVIDER-683C';

const EVIDENCE_CLASSES_683C = Object.freeze({
  LIVE_PROVIDER: 'LIVE_PROVIDER',
  CACHED_PROVIDER: 'CACHED_PROVIDER',
  TEST_ONLY: 'TEST_ONLY',
  UNAVAILABLE: 'UNAVAILABLE'
});

const RANKING_GRADES_683C = Object.freeze({
  DECISION_GRADE: 'DECISION_GRADE',
  PLANNING_ONLY: 'PLANNING_ONLY',
  TEST_ONLY: 'TEST_ONLY',
  UNAVAILABLE: 'UNAVAILABLE'
});

function safeIata(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function safeCurrency(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function safeIsoDate(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function safeMonth(value) {
  const s = String(value || '').trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
}

function finitePositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function positiveInteger(value, fallback = 1) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : fallback;
}

function validateSearchRequest683C(input = {}) {
  const origin = safeIata(input.origin);
  const destination = safeIata(input.destination);
  const currency = safeCurrency(input.currency || 'USD');
  const departureDate = safeIsoDate(input.departureDate);
  const month = safeMonth(input.month || (departureDate ? departureDate.slice(0, 7) : null));
  const passengers = positiveInteger(input.passengers || input.adults || 1, 1);
  const errors = [];
  if (!origin) errors.push('invalid-origin');
  if (!destination) errors.push('invalid-destination');
  if (!currency) errors.push('invalid-currency');
  if (!departureDate && !month) errors.push('missing-date-or-month');
  return {
    valid: errors.length === 0,
    errors,
    request: { origin, destination, currency, departureDate, month, passengers }
  };
}

function descriptor683C(input = {}) {
  const evidenceClass = Object.values(EVIDENCE_CLASSES_683C).includes(input.evidenceClass)
    ? input.evidenceClass
    : EVIDENCE_CLASSES_683C.UNAVAILABLE;
  let rankingGrade = input.rankingGrade;
  if (!Object.values(RANKING_GRADES_683C).includes(rankingGrade)) {
    rankingGrade = evidenceClass === EVIDENCE_CLASSES_683C.LIVE_PROVIDER
      ? RANKING_GRADES_683C.DECISION_GRADE
      : evidenceClass === EVIDENCE_CLASSES_683C.CACHED_PROVIDER
        ? RANKING_GRADES_683C.PLANNING_ONLY
        : evidenceClass === EVIDENCE_CLASSES_683C.TEST_ONLY
          ? RANKING_GRADES_683C.TEST_ONLY
          : RANKING_GRADES_683C.UNAVAILABLE;
  }
  return {
    id: String(input.id || 'unknown-provider'),
    label: String(input.label || input.id || 'Unknown provider'),
    evidenceClass,
    rankingGrade,
    livePricing: evidenceClass === EVIDENCE_CLASSES_683C.LIVE_PROVIDER,
    testOnly: evidenceClass === EVIDENCE_CLASSES_683C.TEST_ONLY,
    referralModelCompatible: input.referralModelCompatible !== false,
    supportsExactDate: input.supportsExactDate !== false,
    supportsFlexibleDates: Boolean(input.supportsFlexibleDates),
    supportsMultiCity: Boolean(input.supportsMultiCity),
    productionApproved: Boolean(input.productionApproved)
  };
}

function sourceTypeForDescriptor(desc = {}) {
  if (desc.evidenceClass === EVIDENCE_CLASSES_683C.LIVE_PROVIDER) return SOURCE_TYPES.LIVE;
  if (desc.evidenceClass === EVIDENCE_CLASSES_683C.CACHED_PROVIDER) return SOURCE_TYPES.CACHED;
  if (desc.evidenceClass === EVIDENCE_CLASSES_683C.TEST_ONLY) return SOURCE_TYPES.ESTIMATED;
  return SOURCE_TYPES.UNAVAILABLE;
}

function normalizeObservation683C(raw = {}, context = {}, provider = {}) {
  const desc = descriptor683C(provider);
  const origin = safeIata(raw.origin || context.origin);
  const destination = safeIata(raw.destination || context.destination);
  const departureDate = safeIsoDate(raw.departureDate || raw.date || context.departureDate);
  const currency = safeCurrency(raw.currency || context.currency);
  const requestedCurrency = safeCurrency(context.currency || raw.requestedCurrency || currency);
  const totalPrice = finitePositive(raw.totalPrice ?? raw.price ?? raw.amount);
  if (!origin || !destination || !departureDate || !currency || !totalPrice) return null;

  const passengers = positiveInteger(raw.passengers || context.passengers || 1, 1);
  const observedAt = raw.observedAt || raw.providerFetchedAt || context.observedAt || new Date().toISOString();
  const durationMinutes = finitePositive(raw.durationMinutes ?? raw.duration) || null;
  const stops = Number.isFinite(Number(raw.stops))
    ? Math.max(0, Math.round(Number(raw.stops)))
    : Number.isFinite(Number(raw.transfers))
      ? Math.max(0, Math.round(Number(raw.transfers)))
      : null;
  const deeplink = raw.deeplink || raw.bookingLink || raw.buyLink || null;

  const sourceType = sourceTypeForDescriptor(desc);
  const priceEvidence = raw.priceEvidence && typeof raw.priceEvidence === 'object'
    ? { ...raw.priceEvidence }
    : normalizeFlightEvidence({
        origin,
        destination,
        departureDate,
        currency,
        amount: totalPrice,
        source: desc.id,
        sourceType,
        observedAt,
        retrievedAt: observedAt,
        bookingLink: deeplink,
        exactDateMatch: true,
        providerBacked: desc.evidenceClass === EVIDENCE_CLASSES_683C.LIVE_PROVIDER || desc.evidenceClass === EVIDENCE_CLASSES_683C.CACHED_PROVIDER,
        productionEligible: desc.productionApproved && desc.evidenceClass !== EVIDENCE_CLASSES_683C.TEST_ONLY
      }, { origin, destination, departureDate, currency: requestedCurrency || currency });

  return {
    // Canonical 683C fields.
    provider: desc.id,
    providerLabel: desc.label,
    providerEvidenceClass: desc.evidenceClass,
    providerRankingGrade: desc.rankingGrade,
    origin,
    destination,
    departureDate,
    currency,
    totalPrice,
    passengerCount: passengers,
    // Preserve explicit provider amount semantics when an adapter can prove them.
    // Duffel offer.total_amount is a party total for all passengers. Other
    // providers remain unmarked and keep the existing provider-neutral behavior.
    fareAmountBasis: raw.fareAmountBasis === 'party-total' ? 'party-total' : null,
    providerPartyTotalAmount: raw.fareAmountBasis === 'party-total'
      ? finitePositive(raw.providerPartyTotalAmount ?? totalPrice)
      : null,
    providerPassengerCount: raw.fareAmountBasis === 'party-total'
      ? positiveInteger(raw.providerPassengerCount || raw.passengers || context.passengers || passengers, passengers)
      : null,
    airline: raw.airline || null,
    stops,
    durationMinutes,
    deeplink,
    observedAt,
    providerReference: raw.providerReference || raw.offerId || raw.id || null,
    // Optional live-offer lifecycle metadata. These fields are preserved for
    // shadow/live QA but do not by themselves make an observation production-eligible.
    expiresAt: raw.expiresAt || raw.offerExpiresAt || null,
    liveMode: typeof raw.liveMode === 'boolean' ? raw.liveMode : null,
    providerEndpoint: raw.providerEndpoint || null,
    requestedCurrency: safeCurrency(raw.requestedCurrency || requestedCurrency || context.currency) || null,
    currencyMismatch: typeof raw.currencyMismatch === 'boolean' ? raw.currencyMismatch : null,
    flightNumber: raw.flightNumber || null,
    rawMeta: raw.rawMeta && typeof raw.rawMeta === 'object' ? { ...raw.rawMeta } : null,
    // Legacy aliases intentionally retained so P1/P2 can consume any future
    // adapter without another optimizer rewrite.
    price: totalPrice,
    transfers: stops,
    bookingLink: deeplink,
    source: raw.source || desc.id,
    providerFetchedAt: observedAt,
    priceEvidence,
    evidenceId: raw.evidenceId || priceEvidence?.evidenceId || null,
    sourceType: raw.sourceType || priceEvidence?.sourceType || sourceType,
    flightQualityStatus: raw.flightQualityStatus || null,
    flightQualityWarnings: Array.isArray(raw.flightQualityWarnings) ? raw.flightQualityWarnings.slice() : [],
    timingQuality: Number.isFinite(Number(raw.timingQuality)) ? Number(raw.timingQuality) : null,
    departureTime: raw.departureTime || null,
    arrivalTime: raw.arrivalTime || null,
    arrivalDate: raw.arrivalDate || null,
    airlineLogoUrl: raw.airlineLogoUrl || null,
    durationLabel: raw.durationLabel || null
  };
}

function normalizeResult683C(rawResult = {}, context = {}, provider = {}) {
  const desc = descriptor683C(provider);
  const validation = validateSearchRequest683C(context);
  const rows = Array.isArray(rawResult.observations) ? rawResult.observations : [];
  const observations = rows
    .map(row => normalizeObservation683C(row, validation.request || context, desc))
    .filter(Boolean);

  const supported = Boolean(rawResult.supported) && observations.length > 0;
  const byPrice = observations.slice().sort((a, b) => Number(a.price) - Number(b.price)
    || String(a.departureDate).localeCompare(String(b.departureDate)));
  const selected = rawResult.selectedObservation
    ? normalizeObservation683C(rawResult.selectedObservation, validation.request || context, desc)
    : null;

  return {
    ...rawResult,
    supported,
    reason: supported ? null : (rawResult.reason || (validation.valid ? 'no-observations' : validation.errors[0])),
    origin: validation.request?.origin || rawResult.origin || null,
    destination: validation.request?.destination || rawResult.destination || null,
    currency: validation.request?.currency || rawResult.currency || null,
    observations,
    cheapestObservation: byPrice[0] || null,
    cheapestSuitableObservation: byPrice[0] || null,
    bestObservation: selected || byPrice[0] || null,
    bestBalanceObservation: selected || byPrice[0] || null,
    selectedObservation: selected || byPrice[0] || null,
    providerContract: {
      version: FLIGHT_PROVIDER_CONTRACT_VERSION_683C,
      provider: desc,
      observationCount: observations.length,
      decisionGrade: desc.rankingGrade === RANKING_GRADES_683C.DECISION_GRADE,
      currentP2Compatibility: 'legacy-aliases-preserved',
      secretFieldsReturned: false
    }
  };
}

module.exports = {
  FLIGHT_PROVIDER_CONTRACT_VERSION_683C,
  EVIDENCE_CLASSES_683C,
  RANKING_GRADES_683C,
  safeIata,
  safeCurrency,
  safeIsoDate,
  safeMonth,
  validateSearchRequest683C,
  descriptor683C,
  normalizeObservation683C,
  normalizeResult683C
};
