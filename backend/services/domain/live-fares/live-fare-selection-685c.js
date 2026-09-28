'use strict';

// GV-FLIGHT-685C — deterministic selection among already-returned Duffel LIVE
// offers. This module is pure: it performs no provider, booking, order, payment,
// ticketing, or FX calls. The existing 684A pilot remains responsible for the
// bounded exact-date request and for normalizing only the selected observation.

const {
  smartObservationScore677B,
  routeRelativeFlightQualityAssessment677BR3,
  scoreTiming,
  SMART_FLIGHT_DATE_SELECTION_VERSION_677B,
  SMART_FLIGHT_ROUTE_RELATIVE_QUALITY_VERSION_677B_R3
} = require('../../cheap-one-way-flights');

const VERSION_685C = 'GV-FLIGHT-685C';
const VERSION_685C_R2 = 'GV-FLIGHT-685C-R2';
const PROVIDER_SOURCE_685C = 'duffel-live-683d';

function safeText(value) { return String(value || '').trim(); }
function safeIata(value) { const out = safeText(value).toUpperCase(); return /^[A-Z]{3}$/.test(out) ? out : null; }
function safeDate(value) { const out = safeText(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null; }
function safeCurrency(value) { const out = safeText(value).toUpperCase(); return /^[A-Z]{3}$/.test(out) ? out : null; }
function finitePositive(value) { const out = Number(value); return Number.isFinite(out) && out > 0 ? out : null; }

function requestedRole685C(query = {}) {
  const preference = `${safeText(query.flightPreference)} ${safeText(query.pickRole)} ${safeText(query.routeRole)} ${safeText(query.tourRole)}`.toLowerCase();
  if (/lowest|cheapest|low-cost|lowest-cost/.test(preference)) return 'cheapest';
  if (/best|balance|overall|memorable|recommended/.test(preference)) return 'best-balance';
  // Preserve 684A's prior cheapest behavior for callers that provide no role.
  return 'cheapest';
}

function rejectionReasons685C(observation = {}, request = {}) {
  const reasons = [];
  const amount = finitePositive(observation.totalPrice ?? observation.price);
  const currency = safeCurrency(observation.currency);
  const passengers = Number(observation.passengers);
  const stops = Number(observation.stops ?? observation.transfers);
  const duration = finitePositive(observation.durationMinutes);
  if (safeText(observation.source).toLowerCase() !== PROVIDER_SOURCE_685C) reasons.push('not-duffel-live-source');
  if (observation.liveMode !== true) reasons.push('not-live-mode');
  if (safeIata(observation.origin) !== safeIata(request.origin)) reasons.push('origin-mismatch');
  if (safeIata(observation.destination) !== safeIata(request.destination)) reasons.push('destination-mismatch');
  if (safeDate(observation.departureDate) !== safeDate(request.departureDate)) reasons.push('departure-date-mismatch');
  if (!amount) reasons.push('invalid-total-amount');
  if (!currency) reasons.push('invalid-currency');
  if (!Number.isInteger(passengers) || passengers !== Number(request.passengers || 1)) reasons.push('passenger-mismatch');
  if (!Number.isInteger(stops) || stops < 0 || stops > 2) reasons.push('invalid-or-excessive-connections');
  if (!duration) reasons.push('incomplete-itinerary-duration');
  if (!safeText(observation.providerReference)) reasons.push('missing-provider-reference');
  if (!Number.isFinite(Date.parse(safeText(observation.observedAt)))) reasons.push('invalid-observed-at');
  const observedAt = Date.parse(safeText(observation.observedAt));
  const expiresAt = Date.parse(safeText(observation.expiresAt));
  if (!Number.isFinite(expiresAt) || (Number.isFinite(observedAt) && expiresAt <= observedAt)) reasons.push('invalid-offer-expiry');
  return [...new Set(reasons)];
}

function rejectionReasonCounts685C(rejections = []) {
  const counts = {};
  for (const rejection of Array.isArray(rejections) ? rejections : []) {
    for (const reason of Array.isArray(rejection?.reasons) ? rejection.reasons : []) {
      const safeReason = safeText(reason) || 'unknown-rejection';
      counts[safeReason] = Number(counts[safeReason] || 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function normalizedCandidate685C(observation = {}) {
  return {
    ...observation,
    price: Number(observation.totalPrice ?? observation.price),
    totalPrice: Number(observation.totalPrice ?? observation.price),
    transfers: Number(observation.stops ?? observation.transfers),
    stops: Number(observation.stops ?? observation.transfers),
    timingQuality: scoreTiming({
      durationMinutes: Number(observation.durationMinutes),
      transfers: Number(observation.stops ?? observation.transfers),
      departureTime: observation.departureTime,
      arrivalTime: observation.arrivalTime
    })
  };
}

function stableOfferOrder685C(a = {}, b = {}) {
  return Number(a.price) - Number(b.price)
    || Number(a.transfers) - Number(b.transfers)
    || Number(a.durationMinutes) - Number(b.durationMinutes)
    || safeText(a.providerReference).localeCompare(safeText(b.providerReference));
}

function premiumPolicy685C(cheapestPrice, budgetPressure = 0) {
  const pressure = Math.max(0, Number(budgetPressure || 0));
  // These are the existing GV-REC-677B smart-flight premium limits.
  const relativePremium = pressure >= 0.9 ? 0.16 : pressure >= 0.78 ? 0.20 : 0.26;
  const absolutePremium = Math.max(35, Number(cheapestPrice) * relativePremium);
  return { relativePremium, absolutePremium, priceCeiling: Number(cheapestPrice) + absolutePremium };
}

function decorateSelection685C(observation, metadata = {}) {
  if (!observation) return null;
  return {
    ...observation,
    provider: 'Duffel',
    selectedFareRole: metadata.selectedRole,
    fareSelection685C: {
      version: VERSION_685C,
      providerCurrencySafetyVersion: VERSION_685C_R2,
      provider: 'Duffel',
      requestedRole: metadata.requestedRole,
      selectedRole: metadata.selectedRole,
      qualityPolicyVersion: SMART_FLIGHT_ROUTE_RELATIVE_QUALITY_VERSION_677B_R3,
      scoringPolicyVersion: SMART_FLIGHT_DATE_SELECTION_VERSION_677B,
      cheapestAcceptableProviderReference: metadata.cheapest?.providerReference || null,
      cheapestAcceptableAmount: metadata.cheapest?.price ?? null,
      bestBalanceProviderReference: metadata.bestBalance?.providerReference || null,
      bestBalanceAmount: metadata.bestBalance?.price ?? null,
      selectedScore: Number.isFinite(Number(metadata.selectedScore)) ? Number(metadata.selectedScore) : null,
      pricePremiumVsCheapest: Number((Number(observation.price) - Number(metadata.cheapest?.price || observation.price)).toFixed(2)),
      validOfferCount: Number(metadata.validOfferCount || 0),
      qualityEligibleOfferCount: Number(metadata.qualityEligibleOfferCount || 0),
      rejectedOfferCount: Number(metadata.rejectedOfferCount || 0),
      deterministic: true
    }
  };
}

function selectLiveFareOffers685C(result = {}, request = {}, query = {}) {
  const observations = Array.isArray(result.observations) ? result.observations : [];
  const requestedRole = requestedRole685C(query);
  if (result.supported !== true || !observations.length) {
    return { supported: false, reason: result.reason || '685c-no-live-offers', version: VERSION_685C, providerCurrencySafetyVersion: VERSION_685C_R2, requestedRole, diagnostics: { offerCount: observations.length, rejectionReasonCounts: {}, rejections: [] } };
  }

  const rejections = [];
  const valid = [];
  observations.forEach((observation, index) => {
    const reasons = rejectionReasons685C(observation, request);
    if (reasons.length) rejections.push({ index, providerReference: observation?.providerReference || null, reasons });
    else valid.push(normalizedCandidate685C(observation));
  });
  if (!valid.length) {
    return { supported: false, reason: '685c-no-valid-route-date-passenger-currency-offers', version: VERSION_685C, providerCurrencySafetyVersion: VERSION_685C_R2, requestedRole, diagnostics: { offerCount: observations.length, validOfferCount: 0, qualityEligibleOfferCount: 0, rejectedOfferCount: rejections.length, rejectionReasonCounts: rejectionReasonCounts685C(rejections), rejections } };
  }


  // The request currency is a display preference, not a provider-evidence
  // requirement. Ranking raw amounts is safe only when all otherwise-valid
  // observations share one provider currency. Canonical 683G/683H FX remains
  // responsible for conversion after 685C selects its bounded alternatives.
  const providerCurrencies = [...new Set(valid.map(row => safeCurrency(row.currency)).filter(Boolean))].sort();
  if (providerCurrencies.length !== 1) {
    return {
      supported: false,
      reason: '685c-mixed-provider-currencies-unsafe-for-ranking',
      version: VERSION_685C,
      providerCurrencySafetyVersion: VERSION_685C_R2,
      requestedRole,
      diagnostics: {
        offerCount: observations.length,
        validOfferCount: valid.length,
        qualityEligibleOfferCount: 0,
        rejectedOfferCount: rejections.length,
        providerCurrencies,
        requestedDisplayCurrency: safeCurrency(request.currency),
        rejectionReasonCounts: rejectionReasonCounts685C(rejections),
        rejections
      }
    };
  }
  const rankingProviderCurrency = providerCurrencies[0];

  const fastestDuration = Math.min(...valid.map(row => Number(row.durationMinutes)).filter(Number.isFinite));
  const context = {
    targetDate: safeDate(request.departureDate),
    maxDateShiftDays: 0,
    distanceKm: Number(request.distanceKm || 0) || null,
    budgetPressure: Math.max(0, Number(request.budgetPressure || query.budgetPressure || 0))
  };
  const assessed = valid.map(row => ({
    row,
    quality: routeRelativeFlightQualityAssessment677BR3(row, context, fastestDuration)
  }));
  const qualityEligible = assessed.filter(item => item.quality?.status !== 'severe');
  assessed.filter(item => item.quality?.status === 'severe').forEach(item => rejections.push({
    providerReference: item.row.providerReference || null,
    reasons: ['severe-existing-flight-quality-guardrail', ...(item.quality.warnings || [])]
  }));
  if (!qualityEligible.length) {
    return { supported: false, reason: '685c-no-quality-eligible-live-offers', version: VERSION_685C, providerCurrencySafetyVersion: VERSION_685C_R2, requestedRole, diagnostics: { offerCount: observations.length, validOfferCount: valid.length, qualityEligibleOfferCount: 0, rejectedOfferCount: rejections.length, rankingProviderCurrency, requestedDisplayCurrency: safeCurrency(request.currency), rejectionReasonCounts: rejectionReasonCounts685C(rejections), rejections } };
  }

  const cheapestItem = qualityEligible.slice().sort((a, b) => stableOfferOrder685C(a.row, b.row))[0];
  const cheapest = cheapestItem.row;
  const premium = premiumPolicy685C(cheapest.price, context.budgetPressure);
  const balancePool = qualityEligible.filter(item => Number(item.row.price) <= premium.priceCeiling);
  const ranked = balancePool.map(item => ({
    ...item,
    score: smartObservationScore677B(item.row, cheapest, fastestDuration, context)
  })).sort((a, b) => a.score - b.score || stableOfferOrder685C(a.row, b.row));
  const bestItem = ranked[0] || { ...cheapestItem, score: 0 };
  const bestBalance = bestItem.row;
  const selectedRole = requestedRole === 'best-balance' ? 'best-balance' : 'cheapest';
  const selectedItem = selectedRole === 'best-balance' ? bestItem : { ...cheapestItem, score: smartObservationScore677B(cheapest, cheapest, fastestDuration, context) };
  const metadata = {
    requestedRole,
    selectedRole,
    cheapest,
    bestBalance,
    selectedScore: selectedItem.score,
    validOfferCount: valid.length,
    qualityEligibleOfferCount: qualityEligible.length,
    rejectedOfferCount: rejections.length
  };

  return {
    supported: true,
    reason: null,
    version: VERSION_685C,
    providerCurrencySafetyVersion: VERSION_685C_R2,
    requestedRole,
    selectedRole,
    selectedOffer: decorateSelection685C(selectedItem.row, metadata),
    cheapestAcceptableOffer: decorateSelection685C(cheapest, { ...metadata, selectedRole: 'cheapest', selectedScore: smartObservationScore677B(cheapest, cheapest, fastestDuration, context) }),
    bestBalanceOffer: decorateSelection685C(bestBalance, { ...metadata, selectedRole: 'best-balance', selectedScore: bestItem.score }),
    diagnostics: {
      offerCount: observations.length,
      validOfferCount: valid.length,
      qualityEligibleOfferCount: qualityEligible.length,
      rejectedOfferCount: rejections.length,
      rankingProviderCurrency,
      requestedDisplayCurrency: safeCurrency(request.currency),
      providerDisplayCurrencyMismatch: rankingProviderCurrency !== safeCurrency(request.currency),
      premiumPolicy: premium,
      fastestDuration,
      rejectionReasonCounts: rejectionReasonCounts685C(rejections),
      rejections
    }
  };
}

module.exports = {
  VERSION_685C,
  VERSION_685C_R2,
  requestedRole685C,
  rejectionReasons685C,
  rejectionReasonCounts685C,
  premiumPolicy685C,
  selectLiveFareOffers685C,
  _internal: { safeIata, safeDate, safeCurrency, normalizedCandidate685C, stableOfferOrder685C, decorateSelection685C }
};
