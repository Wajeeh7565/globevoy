'use strict';

// GV-REC-677C — deterministic whole-trip route optimization V1.
// This layer does not invent provider fares. It compares the complete route as a
// system: stop order, travel burden, geographic backtracking, total-group budget
// pressure and destination redundancy. Provider/date enrichment still happens in
// the existing 677B pipeline after a route is selected.

const { evaluateTour, _internal: feasibility } = require('./route-feasibility');
const { _internal: globalGraph } = require('./global-route-graph');
const { normalizeParty, priceTransportLeg, applyTravellerPricingToTour } = require('../pricing/traveller-pricing');
const { currencyToUsdRate, normalizeCurrency } = require('../pricing/budget-presentation');

const WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C = 'GV-REC-677C';
const MAX_PERMUTATION_STOPS_677C = 4;

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value) {
  return String(value || '').trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function enabled() {
  return String(process.env.ENABLE_WHOLE_TRIP_ROUTE_OPTIMIZATION_677C || '').trim().toLowerCase() === 'true';
}

function nodeKey(node = {}) {
  return upper(node.airportCode || node.code || node.cityId || node.city || node.displayCity);
}

function cityLabel(node = {}) {
  return text(node.city || node.displayCity || node.name || node.cityId || nodeKey(node));
}

function routeKey(stops = []) {
  return stops.map(nodeKey).filter(Boolean).join('>');
}

function permutations(values) {
  if (values.length <= 1) return [values.slice()];
  const out = [];
  for (let i = 0; i < values.length; i += 1) {
    const head = values[i];
    const tail = values.slice(0, i).concat(values.slice(i + 1));
    for (const rest of permutations(tail)) out.push([head, ...rest]);
  }
  return out;
}

function explicitOrderLocked(query = {}, tour = {}) {
  const lockTokens = [
    query.savedStops,
    query.savedStopRefs,
    query.preferredStops,
    query.stopRefs,
    query.routeOrder,
    query.manualRoute,
    query.lockRouteOrder
  ];
  const explicit = lockTokens.some(value => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && String(value).trim() !== '' && String(value).trim().toLowerCase() !== 'false';
  });
  if (explicit) return true;
  if (tour?.routeControl?.preserveOrder === true || tour?.routeOrderLocked === true) return true;
  return false;
}

function hasOrderSensitiveGateway(tour = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  return stops.some(stop => stop?.groundAccess || (stop?.gatewayAirport && String(stop.gatewayAirport.transferMode || '').toLowerCase() !== 'local-airport'));
}

function budgetUsd(query = {}, tour = {}) {
  const direct = num(tour.totalBudgetUsd || query.budgetUsd, 0);
  if (direct > 0) return direct;
  const amount = num(query.budget || query.totalBudget, 0);
  if (!(amount > 0)) return 0;
  return amount * currencyToUsdRate(normalizeCurrency(query.currency || 'USD'));
}

function totalEstimateUsd(tour = {}) {
  const direct = num(tour.estimatedTotalUsd, 0);
  if (direct > 0) return direct;
  const transport = num(tour.totalTransportEstimateUsd || tour.totalFlightEstimateUsd, 0);
  const hotels = num(tour.totalHotelEstimateUsd, 0) || (Array.isArray(tour.stops)
    ? tour.stops.reduce((sum, stop) => sum + num(stop?.hotel?.estimatedStayUsd || stop?.hotel?.totalStayUsd, 0), 0)
    : 0);
  return transport + hotels;
}

function pairDistanceKm(a, b) {
  return feasibility?.haversineKm ? num(feasibility.haversineKm(a, b), 0) : 0;
}

function planningLeg(from, to, query = {}, legNumber = 1) {
  const estimate = globalGraph?.transportEstimate
    ? globalGraph.transportEstimate(from, to)
    : { mode: 'flight', transportType: 'flight', distanceKm: Math.round(pairDistanceKm(from, to)), costUsd: 160 };
  const unitAmountUsd = Math.max(0, num(estimate.costUsd, 0));
  const raw = {
    legNumber,
    from: { ...from },
    to: { ...to },
    mode: estimate.mode || 'flight',
    transportType: estimate.transportType || estimate.mode || 'flight',
    distanceKm: Math.round(num(estimate.distanceKm, pairDistanceKm(from, to))),
    durationMinutes: null,
    estimatedDoorToDoorHours: feasibility?.estimateLegTravelHours
      ? Number(num(feasibility.estimateLegTravelHours(estimate, num(estimate.distanceKm, 0)), 0).toFixed(2))
      : null,
    estimatedTransportUsd: unitAmountUsd,
    estimatedFlightUsd: String(estimate.mode || '').toLowerCase() === 'flight' ? unitAmountUsd : 0,
    amountUsd: unitAmountUsd,
    estimateSource: 'whole-trip-route-optimizer-planning-estimate-677c',
    liveFareVerified: false,
    providerObservation: null,
    providerVerificationRequired: true,
    fromCode: nodeKey(from),
    toCode: nodeKey(to)
  };
  return priceTransportLeg(raw, query, { party: normalizeParty(query), unitAmountUsd });
}

function planningMetricsForOrder(tour = {}, orderedStops = [], query = {}) {
  const origin = tour.origin || {};
  const nodes = [origin, ...orderedStops, origin];
  const legs = [];
  for (let i = 0; i < nodes.length - 1; i += 1) legs.push(planningLeg(nodes[i], nodes[i + 1], query, i + 1));
  const shell = applyTravellerPricingToTour({ ...tour, stops: orderedStops.map(stop => ({ ...stop })), legs }, query);
  const guard = evaluateTour(shell, query);
  const metrics = guard.metrics || {};
  const transportUsd = legs.reduce((sum, leg) => sum + num(leg.estimatedTransportUsd, 0), 0);
  const hotelUsd = orderedStops.reduce((sum, stop) => sum + num(stop?.hotel?.estimatedStayUsd || stop?.hotel?.totalStayUsd, 0), 0);
  const totalUsd = transportUsd + hotelUsd;
  const travelHours = num(metrics.estimatedTravelHours, legs.reduce((sum, leg) => sum + num(leg.estimatedDoorToDoorHours, 0), 0));
  const backtrackingRatio = num(metrics.backtrackingRatio, 1);
  const orderedDistanceKm = num(metrics.orderedDistanceKm, legs.reduce((sum, leg) => sum + num(leg.distanceKm, 0), 0));
  const budget = budgetUsd(query, tour);
  const utilization = budget > 0 ? totalUsd / budget : 0.75;
  const penalty = travelHours * 2.25
    + Math.max(0, backtrackingRatio - 1) * 180
    + Math.max(0, utilization - 0.82) * 90
    + orderedDistanceKm / 850;
  return {
    accepted: guard.accepted,
    reasons: guard.reasons || [],
    legs,
    totalUsd: Math.round(totalUsd),
    transportUsd: Math.round(transportUsd),
    hotelUsd: Math.round(hotelUsd),
    travelHours: Number(travelHours.toFixed(1)),
    backtrackingRatio: Number(backtrackingRatio.toFixed(3)),
    orderedDistanceKm: Math.round(orderedDistanceKm),
    utilization: Number(utilization.toFixed(3)),
    penalty: Number(penalty.toFixed(3))
  };
}

function stripSchedule(stop = {}) {
  const next = { ...stop };
  delete next.arrivalDate;
  delete next.departureDate;
  delete next.dateSource;
  delete next.itineraryDate;
  return next;
}

function rebuildTourOrder(tour = {}, orderedStops = [], query = {}, metrics = null) {
  const origin = { ...(tour.origin || {}) };
  const stops = orderedStops.map(stripSchedule);
  const nodes = [origin, ...stops, origin];
  const legs = [];
  for (let i = 0; i < nodes.length - 1; i += 1) legs.push(planningLeg(nodes[i], nodes[i + 1], query, i + 1));
  const mapCoordinates = [
    { type: 'origin', cityId: origin.cityId, city: cityLabel(origin), latitude: origin.latitude, longitude: origin.longitude },
    ...stops.map(stop => ({ type: 'stop', cityId: stop.cityId, city: cityLabel(stop), latitude: stop.latitude, longitude: stop.longitude })),
    { type: 'return', cityId: origin.cityId, city: cityLabel(origin), latitude: origin.latitude, longitude: origin.longitude }
  ];
  let next = {
    ...tour,
    origin,
    stops,
    legs,
    mapCoordinates,
    itineraryDatePlan: null,
    routeOrderOptimization: {
      version: WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C,
      orderKey: routeKey(stops),
      providerVerificationRequired: true,
      scoreBasis: 'planning-distance+travel-burden+backtracking+budget-pressure; provider fares are verified after selection'
    },
    editableActions: { ...(tour.editableActions || {}), reorderStops: true },
    routeExplanation: [
      ...(Array.isArray(tour.routeExplanation) ? tour.routeExplanation : []),
      'GV-REC-677C compared the complete stop order before provider/date enrichment and selected the lower-burden feasible sequence.'
    ]
  };
  next = applyTravellerPricingToTour(next, query);
  const distanceKm = metrics?.orderedDistanceKm || legs.reduce((sum, leg) => sum + num(leg.distanceKm, 0), 0);
  next.totalDistanceKm = Math.round(distanceKm);
  return next;
}

function optimizeTourOrder(tour = {}, query = {}) {
  const stops = Array.isArray(tour.stops) ? tour.stops.filter(Boolean) : [];
  const originalKey = routeKey(stops);
  const baseDiagnostics = {
    enabled: enabled(),
    version: WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C,
    routeOrderOptimization: enabled(),
    originalOrder: stops.map(cityLabel),
    selectedOrder: stops.map(cityLabel),
    originalOrderKey: originalKey,
    selectedOrderKey: originalKey,
    changed: false,
    evaluatedOrders: 1,
    skippedReason: null
  };
  if (!enabled()) return { tour, diagnostics: { ...baseDiagnostics, skippedReason: 'feature-disabled' } };
  if (stops.length <= 1) return { tour, diagnostics: { ...baseDiagnostics, skippedReason: 'single-destination-route' } };
  if (stops.length > MAX_PERMUTATION_STOPS_677C) return { tour, diagnostics: { ...baseDiagnostics, skippedReason: 'too-many-stops-for-v1-permutation' } };
  if (explicitOrderLocked(query, tour)) return { tour, diagnostics: { ...baseDiagnostics, skippedReason: 'explicit-or-saved-route-order-preserved' } };
  if (hasOrderSensitiveGateway(tour)) return { tour, diagnostics: { ...baseDiagnostics, skippedReason: 'gateway-or-ground-access-order-preserved' } };

  const candidates = permutations(stops).map(order => ({ order, key: routeKey(order), metrics: planningMetricsForOrder(tour, order, query) }))
    .filter(item => item.metrics.accepted);
  if (!candidates.length) return { tour, diagnostics: { ...baseDiagnostics, evaluatedOrders: 0, skippedReason: 'no-permutation-passed-feasibility-guard' } };
  candidates.sort((a, b) => a.metrics.penalty - b.metrics.penalty || a.metrics.totalUsd - b.metrics.totalUsd || a.key.localeCompare(b.key));
  const best = candidates[0];
  const original = candidates.find(item => item.key === originalKey) || { key: originalKey, metrics: planningMetricsForOrder(tour, stops, query), order: stops };
  const improvement = num(original.metrics.penalty, 0) - num(best.metrics.penalty, 0);
  const travelHoursSaved = num(original.metrics.travelHours, 0) - num(best.metrics.travelHours, 0);
  const distanceSavedKm = num(original.metrics.orderedDistanceKm, 0) - num(best.metrics.orderedDistanceKm, 0);
  // Avoid churn when two orders are effectively equivalent. Two-stop cycles are
  // often distance-symmetric, so V1 should not reorder them without a real gain.
  const meaningful = best.key !== originalKey && (improvement >= 3 || travelHoursSaved >= 0.75 || distanceSavedKm >= 150);
  const selectedTour = meaningful ? rebuildTourOrder(tour, best.order, query, best.metrics) : tour;
  return {
    tour: selectedTour,
    diagnostics: {
      ...baseDiagnostics,
      selectedOrder: (meaningful ? best.order : stops).map(cityLabel),
      selectedOrderKey: meaningful ? best.key : originalKey,
      changed: meaningful,
      evaluatedOrders: candidates.length,
      originalMetrics: original.metrics,
      selectedMetrics: meaningful ? best.metrics : original.metrics,
      improvementScore: Number(improvement.toFixed(3)),
      travelHoursSaved: Number(travelHoursSaved.toFixed(1)),
      distanceSavedKm: Math.round(distanceSavedKm),
      skippedReason: meaningful ? null : 'no-material-whole-trip-order-improvement'
    }
  };
}

function providerQualityMetrics(tour = {}) {
  const legs = Array.isArray(tour.legs) ? tour.legs : [];
  let limited = 0;
  let caution = 0;
  let qualityRatioExcess = 0;
  for (const leg of legs) {
    const evidence = leg?.cheapestOneWay || leg?.providerDateEvidence || leg?.providerObservation || null;
    if (!evidence) continue;
    const status = String(evidence.flightQualityStatus || '').toLowerCase();
    if (status === 'limited-provider-options') limited += 1;
    if (status === 'caution') caution += 1;
    const ratio = num(evidence.durationRatioVsExpected, 0);
    if (ratio > 1) qualityRatioExcess += ratio - 1;
  }
  return { limitedProviderLegs: limited, cautionProviderLegs: caution, qualityRatioExcess: Number(qualityRatioExcess.toFixed(3)) };
}

function candidateMetrics(tour = {}, query = {}) {
  const guard = evaluateTour(tour, query);
  const metrics = guard.metrics || {};
  const origin = tour.origin || {};
  const stops = Array.isArray(tour.stops) ? tour.stops : [];
  const originDistances = stops.map(stop => pairDistanceKm(origin, stop));
  const farthestOriginKm = originDistances.length ? Math.max(...originDistances) : 0;
  const adjacentOriginStops = originDistances.filter(distance => distance > 0 && distance < 100).length;
  let nearDuplicatePairs = 0;
  for (let i = 0; i < stops.length; i += 1) {
    for (let j = i + 1; j < stops.length; j += 1) {
      const distance = pairDistanceKm(stops[i], stops[j]);
      if (distance > 0 && distance < 80) nearDuplicatePairs += 1;
    }
  }
  const mixedOriginAdjacency = adjacentOriginStops > 0 && farthestOriginKm > 650;
  const budget = budgetUsd(query, tour);
  const total = totalEstimateUsd(tour);
  const utilization = budget > 0 ? total / budget : 0.75;
  const provider = providerQualityMetrics(tour);
  return {
    accepted: guard.accepted,
    orderedDistanceKm: num(metrics.orderedDistanceKm, num(tour.totalDistanceKm, 0)),
    shortestCycleDistanceKm: num(metrics.shortestCycleDistanceKm, 0),
    backtrackingRatio: num(metrics.backtrackingRatio, 1),
    estimatedTravelHours: num(metrics.estimatedTravelHours, 0),
    travelBurdenRatio: num(metrics.travelBurdenRatio, 0),
    adjacentOriginStops,
    farthestOriginKm: Math.round(farthestOriginKm),
    mixedOriginAdjacency,
    nearDuplicatePairs,
    budgetUsd: Math.round(budget),
    estimatedTotalUsd: Math.round(total),
    budgetUtilization: Number(utilization.toFixed(3)),
    ...provider
  };
}

function candidateAdjustment(tour = {}, query = {}) {
  if (!enabled()) return { adjustment: 0, metrics: candidateMetrics(tour, query), reasons: ['feature-disabled'] };
  const metrics = candidateMetrics(tour, query);
  let adjustment = 0;
  const reasons = [];
  // Reward a compact route and penalize geographic/comfort waste. This is an
  // adjustment to existing Lowest/Balance/Memorable scoring, not a replacement.
  adjustment -= Math.max(0, metrics.backtrackingRatio - 1) * 145;
  adjustment -= Math.max(0, metrics.estimatedTravelHours - 18) * 1.7;
  adjustment -= Math.max(0, metrics.travelBurdenRatio - 0.34) * 110;
  adjustment -= metrics.nearDuplicatePairs * 90;
  adjustment -= metrics.limitedProviderLegs * 45;
  adjustment -= metrics.cautionProviderLegs * 18;
  adjustment -= metrics.qualityRatioExcess * 20;
  if (metrics.mixedOriginAdjacency) {
    adjustment -= 170;
    reasons.push('origin-adjacent-stop-mixed-with-far-destination');
  }
  if (metrics.nearDuplicatePairs) reasons.push('near-duplicate-destinations');
  if (metrics.limitedProviderLegs) reasons.push('limited-provider-flight-quality');
  if (metrics.backtrackingRatio > 1.22) reasons.push('geographic-backtracking');
  if (metrics.budgetUtilization > 0.97) {
    adjustment -= (metrics.budgetUtilization - 0.97) * 180;
    reasons.push('thin-budget-margin');
  }
  return { adjustment: Number(adjustment.toFixed(3)), metrics, reasons };
}

module.exports = {
  WHOLE_TRIP_ROUTE_OPTIMIZATION_VERSION_677C,
  enabled,
  optimizeTourOrder,
  candidateMetrics,
  candidateAdjustment,
  _internal: {
    nodeKey,
    cityLabel,
    routeKey,
    permutations,
    explicitOrderLocked,
    hasOrderSensitiveGateway,
    planningLeg,
    planningMetricsForOrder,
    rebuildTourOrder,
    providerQualityMetrics
  }
};
