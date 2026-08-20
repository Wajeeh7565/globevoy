'use strict';

// GV-LIVE-667B: one canonical, visible pricing ledger for the final itinerary.
// Header totals, card totals, budget status and evidence counts are derived from
// this same ledger after provider verification and passenger/room pricing.

const { attachTourPresentation, normalizeCurrency, usdToCurrencyRate } = require('../budget-presentation');
const { SOURCE_TYPES, normalizeFlightEvidence, normalizeHotelEvidence } = require('./price-evidence-integrity');

const CANONICAL_INTEGRITY_VERSION = 'GV-EVIDENCE-667E';

function enabled() {
  const raw = String(process.env.ENABLE_CANONICAL_TOTAL_EVIDENCE_INTEGRITY_667B || '').trim().toLowerCase();
  return raw ? raw === 'true' : false;
}

function transportEvidenceEnabled() {
  const raw = String(process.env.ENABLE_TRANSPORT_EVIDENCE_ACTION_LABELS_667E || '').trim().toLowerCase();
  return raw ? raw === 'true' : false;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function safeDate(value) {
  const raw = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function isGroundLeg(leg = {}) {
  const text = `${String(leg.mode || '')} ${String(leg.transportType || '')} ${String(leg.operator || '')}`.toLowerCase();
  const segments = Array.isArray(leg.segments) ? leg.segments : [];
  const hasFlight = text.includes('flight') || segments.some(segment => `${String(segment?.mode || '')} ${String(segment?.transportType || '')}`.toLowerCase().includes('flight'));
  if (hasFlight) return false;
  return text.includes('ground')
    || text.includes('rail')
    || text.includes('bus')
    || text.includes('ferry')
    || text.includes('boat')
    || text.includes('shuttle')
    || text.includes('transfer')
    || text.trim().length > 0;
}

function transportKind(leg = {}) {
  const text = String(leg.mode || leg.transportType || leg.operator || '').toLowerCase();
  if (text.includes('rail')) return 'rail';
  if (text.includes('bus')) return 'bus';
  if (text.includes('ferry') || text.includes('boat')) return 'ferry';
  if (text.includes('shuttle')) return 'shuttle';
  return 'ground-transfer';
}

function groundTransportEvidence(leg = {}) {
  const verification = leg.transportProviderVerification || leg.groundTransportVerification || leg.providerVerification || {};
  const productionEligible = verification.productionEligible === true;
  const exactRouteDate = verification.exactDateMatch === true
    || verification.exactScheduleMatch === true
    || verification.exactRouteDate === true;
  const verified = Boolean(verification.verified && productionEligible && exactRouteDate);
  return {
    verified,
    critical: transportEvidenceEnabled(),
    provider: verified ? (verification.provider || leg.operator || 'Ground transport provider') : 'Globevoy planning model',
    category: verified ? 'exact-ground-transport-evidence' : 'ground-transfer-estimate',
    sourceType: verified ? SOURCE_TYPES.LIVE : SOURCE_TYPES.ESTIMATED,
    status: verification.status || (verified ? 'exact-ground-transport-evidence' : 'ground-transport-estimate'),
    checkedAt: verification.checkedAt || null,
    observedAt: verified ? (verification.observedAt || null) : null,
    productionEligible
  };
}

function accessEvidence(access = {}, category = 'gateway-transfer-estimate') {
  const verification = access.providerVerification || access.transportProviderVerification || {};
  const productionEligible = verification.productionEligible === true;
  const exactRouteDate = verification.exactDateMatch === true
    || verification.exactScheduleMatch === true
    || verification.exactRouteDate === true;
  const verified = Boolean(verification.verified && productionEligible && exactRouteDate);
  return {
    verified,
    critical: transportEvidenceEnabled(),
    provider: verified ? (verification.provider || access.provider || 'Transfer provider') : 'Globevoy planning model',
    category: verified ? 'exact-transfer-provider-evidence' : category,
    sourceType: verified ? SOURCE_TYPES.LIVE : SOURCE_TYPES.ESTIMATED,
    status: verification.status || (verified ? 'exact-transfer-provider-evidence' : category),
    checkedAt: verification.checkedAt || null,
    observedAt: verified ? (verification.observedAt || null) : null,
    productionEligible
  };
}

function endpoint(node = {}) {
  return {
    city: node.city || node.displayCity || node.name || null,
    airportCode: safeCode(node.airportCode || node.code || node.displayCode)
  };
}

function flightEvidence(leg = {}) {
  const verification = leg.providerVerification || {};
  const evidence = leg.providerDateEvidence || leg.cheapestOneWay || {};
  const productionEligible = verification.productionEligible !== false;
  const canonical = evidence.priceEvidence || normalizeFlightEvidence({ ...evidence, sourceType: evidence.sourceType || (verification.verified ? SOURCE_TYPES.LIVE : SOURCE_TYPES.ESTIMATED) }, {
    origin: endpoint(leg.from || {}).airportCode,
    destination: endpoint(leg.to || {}).airportCode,
    departureDate: safeDate(evidence.departureDate) || safeDate(leg.departureDate),
    currency: evidence.currency,
    sourceType: evidence.sourceType || SOURCE_TYPES.ESTIMATED
  });
  const verified = !!(
    verification.verified &&
    verification.exactDateMatch &&
    productionEligible &&
    evidence.providerBacked !== false &&
    evidence.appliedToEstimate !== false &&
    canonical.sourceType === SOURCE_TYPES.LIVE
  );
  return {
    verified,
    critical: true,
    provider: verified ? (verification.provider || evidence.providerLabel || evidence.source || 'Flight provider') : 'Globevoy planning model',
    category: verified ? 'exact-date-provider-evidence' : (canonical.sourceType === SOURCE_TYPES.CACHED ? 'cached-provider-observation' : 'planning-estimate'),
    sourceType: canonical.sourceType,
    evidenceId: canonical.evidenceId,
    isBookable: canonical.isBookable,
    status: verification.status || (verified ? 'exact-date-provider-observation' : 'not-verified'),
    cacheHit: verified ? Boolean(verification.cacheHit || evidence.cacheHit) : false,
    checkedAt: verification.checkedAt || null,
    observedAt: canonical.observedAt || verification.observedAt || evidence.observedAt || null,
    productionEligible
  };
}

function stayEvidence(stop = {}) {
  const hotel = stop.hotel || {};
  const verification = hotel.providerVerification || {};
  const productionEligible = verification.productionEligible === true;
  const canonical = hotel.priceEvidence || normalizeHotelEvidence({ ...hotel, sourceType: hotel.sourceType || (verification.verified ? SOURCE_TYPES.LIVE : SOURCE_TYPES.ESTIMATED) }, {
    checkIn: safeDate(stop.arrivalDate || stop.checkIn || hotel.checkIn),
    checkOut: safeDate(stop.departureDate || stop.checkOut || hotel.checkOut),
    currency: hotel.currency || 'USD',
    sourceType: hotel.sourceType || SOURCE_TYPES.ESTIMATED
  });
  const rateProvider = String(verification.rateProvider || verification.provider || hotel?.priceEvidence?.source || hotel.source || '').trim();
  const supportedRateProvider = /^(agoda|stay22)/i.test(rateProvider);
  const verified = !!(
    verification.verified &&
    verification.exactStayDates &&
    productionEligible &&
    supportedRateProvider &&
    canonical.sourceType === SOURCE_TYPES.LIVE
  );
  return {
    verified,
    critical: true,
    provider: verified ? (verification.rateProvider || verification.provider || 'Provider') : 'Globevoy planning model',
    category: verified ? 'exact-stay-provider-evidence' : (canonical.sourceType === SOURCE_TYPES.CACHED ? 'cached-provider-observation' : 'planning-estimate'),
    sourceType: canonical.sourceType,
    evidenceId: canonical.evidenceId,
    isBookable: canonical.isBookable,
    status: verification.status || (verified ? 'exact-stay-provider-rate-evidence' : 'not-verified'),
    checkedAt: verification.checkedAt || null,
    observedAt: canonical.observedAt || verification.observedAt || hotel.observedAt || null,
    productionEligible
  };
}

function displayAmount(usd, rate) {
  return Math.round(Math.max(0, finite(usd, 0)) * rate);
}

function buildCanonicalLedger(tour = {}, query = {}) {
  const currency = normalizeCurrency(query.currency || tour?.displayBudget?.currency || 'CAD');
  const exchangeRateFromUsd = usdToCurrencyRate(currency);
  const components = [];
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  const stops = Array.isArray(tour.stops) ? tour.stops : [];

  legs.forEach((leg, index) => {
    const ground = isGroundLeg(leg);
    const amountUsd = Math.max(0, finite(leg.estimatedTransportUsd || leg.estimatedFlightUsd || leg.amountUsd, 0));
    const evidence = ground ? groundTransportEvidence(leg) : flightEvidence(leg);
    components.push({
      key: `transport:${index}`,
      kind: ground ? transportKind(leg) : 'flight',
      index,
      visibleOnCard: true,
      amountUsd: Math.round(amountUsd),
      planningAmountUsd: Math.round(amountUsd),
      currentProviderAmountUsd: evidence.sourceType === SOURCE_TYPES.LIVE ? Math.round(amountUsd) : null,
      amountDisplay: displayAmount(amountUsd, exchangeRateFromUsd),
      currency,
      route: {
        from: endpoint(leg.from || {}),
        to: endpoint(leg.to || {}),
        departureDate: safeDate((leg.providerDateEvidence || leg.cheapestOneWay || {}).departureDate)
          || safeDate(leg?.automaticTourDate?.departureDate)
          || safeDate(leg.departureDate)
          || safeDate(leg.dateLabel)
      },
      evidence
    });
  });

  stops.forEach((stop, index) => {
    const amountUsd = Math.max(0, finite(stop?.hotel?.estimatedStayUsd || stop?.hotel?.totalStayUsd, 0));
    components.push({
      key: `stay:${index}`,
      kind: 'stay',
      index,
      visibleOnCard: true,
      amountUsd: Math.round(amountUsd),
      planningAmountUsd: Math.round(amountUsd),
      currentProviderAmountUsd: stayEvidence(stop).sourceType === SOURCE_TYPES.LIVE ? Math.round(amountUsd) : null,
      amountDisplay: displayAmount(amountUsd, exchangeRateFromUsd),
      currency,
      stay: {
        city: stop.city || null,
        checkIn: safeDate(stop.arrivalDate || stop.checkIn || stop?.hotel?.checkIn),
        checkOut: safeDate(stop.departureDate || stop.checkOut || stop?.hotel?.checkOut),
        rooms: Number(stop?.hotel?.pricingIntegrity?.roomCount || stop?.hotel?.rooms || 1)
      },
      evidence: stayEvidence(stop)
    });
  });

  stops.forEach((stop, index) => {
    const access = stop.destinationAccess || null;
    const amountUsd = Math.max(0, finite(stop.destinationAccessEstimateUsd || access?.roundTripPartyUsd, 0));
    if (!access || amountUsd <= 0) return;
    components.push({
      key: `destination-access:${index}`,
      kind: 'destination-access',
      index,
      visibleOnCard: true,
      amountUsd: Math.round(amountUsd),
      planningAmountUsd: Math.round(amountUsd),
      currentProviderAmountUsd: accessEvidence(access, 'destination-gateway-transfer-estimate').sourceType === SOURCE_TYPES.LIVE ? Math.round(amountUsd) : null,
      amountDisplay: displayAmount(amountUsd, exchangeRateFromUsd),
      currency,
      access,
      evidence: accessEvidence(access, 'destination-gateway-transfer-estimate')
    });
  });

  const originAccessUsd = Math.max(0, finite(tour.originAccessEstimateUsd || tour?.originAccess?.roundTripPartyUsd, 0));
  if (originAccessUsd > 0) {
    components.push({
      key: 'origin-access',
      kind: 'origin-access',
      index: -1,
      visibleOnCard: true,
      amountUsd: Math.round(originAccessUsd),
      planningAmountUsd: Math.round(originAccessUsd),
      currentProviderAmountUsd: accessEvidence(tour.originAccess || {}, 'airport-access-estimate').sourceType === SOURCE_TYPES.LIVE ? Math.round(originAccessUsd) : null,
      amountDisplay: displayAmount(originAccessUsd, exchangeRateFromUsd),
      currency,
      access: tour.originAccess || null,
      evidence: accessEvidence(tour.originAccess || {}, 'airport-access-estimate')
    });
  }

  const transportComponents = components.filter(component => component.kind === 'flight' || component.kind === 'ground-transfer' || component.kind === 'rail' || component.kind === 'bus' || component.kind === 'ferry' || component.kind === 'shuttle' || component.kind === 'origin-access' || component.kind === 'destination-access');
  const stayComponents = components.filter(component => component.kind === 'stay');
  const criticalComponents = components.filter(component => component.evidence?.critical);
  const verifiedComponents = criticalComponents.filter(component => component.evidence?.verified);
  const canonicalTotalUsd = components.reduce((sum, component) => sum + component.amountUsd, 0);
  const canonicalDisplayTotal = components.reduce((sum, component) => sum + component.amountDisplay, 0);
  const sourceTypeCounts = Object.fromEntries(Object.values(SOURCE_TYPES).map(type => [type, components.filter(component => component.evidence?.sourceType === type).length]));
  const currentProviderTotalUsd = components.reduce((sum, component) => sum + finite(component.currentProviderAmountUsd, 0), 0);

  return {
    enabled: true,
    version: CANONICAL_INTEGRITY_VERSION,
    currency,
    exchangeRateFromUsd: Number(exchangeRateFromUsd.toFixed(6)),
    components,
    transportTotalUsd: transportComponents.reduce((sum, component) => sum + component.amountUsd, 0),
    transportDisplayTotal: transportComponents.reduce((sum, component) => sum + component.amountDisplay, 0),
    stayTotalUsd: stayComponents.reduce((sum, component) => sum + component.amountUsd, 0),
    stayDisplayTotal: stayComponents.reduce((sum, component) => sum + component.amountDisplay, 0),
    originAccessUsd: originAccessUsd ? Math.round(originAccessUsd) : 0,
    destinationAccessUsd: components.filter(component => component.kind === 'destination-access').reduce((sum, component) => sum + component.amountUsd, 0),
    canonicalTotalUsd,
    planningTotalUsd: canonicalTotalUsd,
    currentProviderTotalUsd,
    sourceTypeCounts,
    hasMixedEvidence: Object.values(sourceTypeCounts).filter(Boolean).length > 1,
    canonicalDisplayTotal,
    visibleCardTotalUsd: canonicalTotalUsd,
    visibleCardDisplayTotal: canonicalDisplayTotal,
    totalsMatchVisibleCards: true,
    criticalCount: criticalComponents.length,
    verifiedCount: verifiedComponents.length,
    criticalTransportCount: transportComponents.filter(component => component.evidence?.critical).length,
    verifiedTransportCount: transportComponents.filter(component => component.evidence?.critical && component.evidence?.verified).length,
    providerCoverage: criticalComponents.length ? Number((verifiedComponents.length / criticalComponents.length).toFixed(3)) : 0,
    allCriticalVerified: criticalComponents.length > 0 && verifiedComponents.length === criticalComponents.length,
    generatedAt: new Date().toISOString()
  };
}

function componentBy(ledger, key) {
  return (ledger?.components || []).find(component => component.key === key) || null;
}

function applyCanonicalIntegrity(tour = {}, query = {}) {
  if (!tour || typeof tour !== 'object') return tour;
  const ledger = buildCanonicalLedger(tour, query);
  const legs = (Array.isArray(tour.legs) ? tour.legs : []).map((leg, index) => ({
    ...leg,
    canonicalPricing: componentBy(ledger, `transport:${index}`)
  }));
  const stops = (Array.isArray(tour.stops) ? tour.stops : []).map((stop, index) => ({
    ...stop,
    hotel: {
      ...(stop.hotel || {}),
      canonicalPricing: componentBy(ledger, `stay:${index}`)
    }
  }));
  const budget = finite(tour.totalBudgetUsd || query.budgetUsd, 0);
  const withCanonicalTotals = {
    ...tour,
    legs,
    stops,
    totalTransportEstimateUsd: ledger.transportTotalUsd,
    totalFlightEstimateUsd: ledger.transportTotalUsd,
    totalHotelEstimateUsd: ledger.stayTotalUsd,
    estimatedTotalUsd: ledger.canonicalTotalUsd,
    amountLeftUsd: budget ? budget - ledger.canonicalTotalUsd : finite(tour.amountLeftUsd, 0),
    affordabilityStatus: budget && ledger.canonicalTotalUsd > budget ? 'over-user-budget' : 'within-budget',
    canonicalPricing: ledger,
    passengerPricing: {
      ...(tour.passengerPricing || {}),
      totalTransportEstimateUsd: ledger.transportTotalUsd,
      totalHotelEstimateUsd: ledger.stayTotalUsd,
      estimatedTotalUsd: ledger.canonicalTotalUsd
    }
  };

  // Refresh the display budget after provider evidence replaces planning amounts.
  const presented = attachTourPresentation({ ...withCanonicalTotals, displayBudget: undefined }, query);
  const displayBudget = {
    ...(presented.displayBudget || {}),
    flightEstimate: ledger.transportDisplayTotal,
    accommodationEstimate: ledger.stayDisplayTotal,
    tripEstimate: ledger.canonicalDisplayTotal
  };
  displayBudget.amountLeft = Number(displayBudget.usableTripBudget || 0) - ledger.canonicalDisplayTotal;
  displayBudget.affordabilityStatus = displayBudget.amountLeft >= 0 ? 'within-protected-budget' : 'over-protected-budget';
  displayBudget.equation = {
    formula: 'totalBudget - reserveAmount - canonicalVisibleTotal = amountLeft',
    leftSide: Number(displayBudget.totalBudget || 0) - Number(displayBudget.reserveAmount || 0) - ledger.canonicalDisplayTotal,
    rightSide: displayBudget.amountLeft,
    consistent: Number(displayBudget.totalBudget || 0) - Number(displayBudget.reserveAmount || 0) - ledger.canonicalDisplayTotal === displayBudget.amountLeft
  };

  return { ...presented, displayBudget, canonicalPricing: ledger };
}

module.exports = {
  CANONICAL_INTEGRITY_VERSION,
  enabled,
  transportEvidenceEnabled,
  buildCanonicalLedger,
  applyCanonicalIntegrity,
  _internal: { isGroundLeg, transportKind, groundTransportEvidence, accessEvidence, flightEvidence, stayEvidence, componentBy }
};
