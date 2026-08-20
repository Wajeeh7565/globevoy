'use strict';

const COMPONENT_WEIGHTS = Object.freeze({
  budgetFitAndValue: 22,
  preferenceMatch: 24,
  travelPracticality: 18,
  tripDurationFit: 12,
  hotelValueAndEvidence: 12,
  providerDataConfidence: 7,
  seasonalDateSuitability: 5
});

const MONTH_INDEX = Object.freeze({
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12
});

function clamp(value, min = 0, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * multiplier) / multiplier;
}

function component(rawScore, weight, evidence = {}, missing = []) {
  const bounded = round(clamp(rawScore));
  return {
    rawScore: bounded,
    weight,
    weightedScore: round((bounded * weight) / 100),
    evidence,
    missing: Array.from(new Set((missing || []).filter(Boolean)))
  };
}

function scoreBudgetFitAndValue(cost) {
  const usable = Math.max(1, Number(cost?.usableTripBudget) || 1);
  const total = Math.max(0, Number(cost?.estimatedFlightAndStayTotal ?? cost?.total) || 0);
  const use = total / usable;
  let raw;

  // A smooth planning-value curve. It rewards a useful use of the available
  // trip budget, peaks before the hard ceiling, and does not grant every cheap
  // result the same score.
  if (use <= 0.20) raw = 48 + (use / 0.20) * 10;
  else if (use <= 0.45) raw = 58 + ((use - 0.20) / 0.25) * 24;
  else if (use <= 0.68) raw = 82 + ((use - 0.45) / 0.23) * 16;
  else if (use <= 0.82) raw = 98 - ((use - 0.68) / 0.14) * 9;
  else raw = 89 - ((Math.min(use, 1) - 0.82) / 0.18) * 24;

  return component(raw, COMPONENT_WEIGHTS.budgetFitAndValue, {
    coreTotalUsd: round(total),
    usableBudgetUsd: round(usable),
    budgetUse: round(use, 4),
    fitBand: use < 0.45 ? 'large-unused-budget' : (use <= 0.82 ? 'healthy-planning-band' : 'near-usable-budget-ceiling')
  });
}

function scorePreferenceMatch(intelligence, preference) {
  if (!preference) {
    return component(60, COMPONENT_WEIGHTS.preferenceMatch, {
      preference: null,
      source: 'neutral-no-preference',
      themeStrength: null
    });
  }

  const themeStrength = intelligence?.themeScores?.[preference];
  if (!Number.isFinite(Number(themeStrength))) {
    return component(55, COMPONENT_WEIGHTS.preferenceMatch, {
      preference,
      source: intelligence?.themeSource || 'unavailable',
      themeStrength: null,
      confidence: 'missing-neutral-low'
    }, ['canonical-theme-strength-unavailable']);
  }

  const strength = clamp(Number(themeStrength), 0, 5);
  const raw = 20 + strength * 16;
  return component(raw, COMPONENT_WEIGHTS.preferenceMatch, {
    preference,
    source: intelligence.themeSource,
    themeStrength: strength,
    scale: '0-to-5'
  });
}

function haversineKm(origin, destination) {
  const lat1 = Number(origin?.lat);
  const lon1 = Number(origin?.lng);
  const lat2 = Number(destination?.lat);
  const lon2 = Number(destination?.lng);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const rad = value => (value * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distancePracticality(distanceKm, nights) {
  if (!Number.isFinite(distanceKm)) return 55;
  if (distanceKm <= 1000) return 92;
  if (distanceKm <= 3000) return nights >= 4 ? 88 : 75;
  if (distanceKm <= 6000) return nights >= 6 ? 82 : (nights >= 4 ? 70 : 55);
  if (distanceKm <= 9000) return nights >= 9 ? 80 : (nights >= 6 ? 68 : 50);
  return nights >= 11 ? 76 : (nights >= 8 ? 63 : 44);
}

function scoreTravelPracticality({ destination, originDestination, intelligence, nights }) {
  const distanceKm = haversineKm(originDestination, destination);
  const transit = Number(intelligence?.publicTransitPracticality);
  const transitScore = Number.isFinite(transit) ? 40 + clamp(transit, 0, 5) * 12 : 55;
  const gatewayValid = Boolean(destination?.code || destination?.travelpayoutsLocationCode || destination?.primaryAirportCode || destination?.nearestMajorAirportCode);
  const gatewayConsistency = gatewayValid ? 90 : 0;
  const routeDistanceScore = distancePracticality(distanceKm, nights);
  const raw = transitScore * 0.45 + routeDistanceScore * 0.35 + gatewayConsistency * 0.20;

  return component(raw, COMPONENT_WEIGHTS.travelPracticality, {
    publicTransitPracticality: Number.isFinite(transit) ? transit : null,
    transitSource: Number.isFinite(transit) ? 'canonical-city-intelligence' : 'unavailable',
    originDistanceKm: Number.isFinite(distanceKm) ? Math.round(distanceKm) : null,
    routeDistanceScore: round(routeDistanceScore),
    gatewayConsistency: gatewayValid ? 'valid-structured-code' : 'invalid'
  }, [
    Number.isFinite(transit) ? null : 'public-transit-practicality-unavailable',
    Number.isFinite(distanceKm) ? null : 'origin-distance-unavailable'
  ]);
}

function scoreTripDurationFit(intelligence, nights) {
  const min = Number(intelligence?.recommendedMinNights);
  const max = Number(intelligence?.recommendedMaxNights);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
    return component(55, COMPONENT_WEIGHTS.tripDurationFit, {
      requestedNights: nights,
      recommendedMinNights: null,
      recommendedMaxNights: null,
      source: intelligence?.durationSource || 'unavailable'
    }, ['recommended-duration-unavailable']);
  }

  let distanceOutside = 0;
  if (nights < min) distanceOutside = min - nights;
  else if (nights > max) distanceOutside = nights - max;

  let raw;
  if (distanceOutside === 0) raw = 96;
  else if (distanceOutside === 1) raw = 76;
  else if (distanceOutside === 2) raw = 56;
  else raw = Math.max(20, 56 - (distanceOutside - 2) * 12);

  return component(raw, COMPONENT_WEIGHTS.tripDurationFit, {
    requestedNights: nights,
    recommendedMinNights: min,
    recommendedMaxNights: max,
    distanceOutsideRange: distanceOutside,
    source: intelligence.durationSource
  });
}

function ratingEvidenceScore(signals = {}) {
  const rating = Number(signals.rating);
  const reviewCount = Number(signals.reviewCount);
  if (!Number.isFinite(rating)) return 30;
  const normalizedCount = Number.isFinite(reviewCount) ? Math.max(0, reviewCount) : 0;
  const priorRating = 7.5;
  const priorWeight = 50;
  const adjusted = ((rating * normalizedCount) + (priorRating * priorWeight)) / (normalizedCount + priorWeight);
  return clamp((adjusted - 5) * 20);
}

function reviewVolumeScore(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return 20;
  if (count >= 1000) return 100;
  if (count >= 500) return 92;
  if (count >= 200) return 82;
  if (count >= 100) return 72;
  if (count >= 25) return 58;
  return 35;
}

function hotelPriceValueScore(hotelBudgetStatus) {
  if (hotelBudgetStatus === 'comfortable') return 92;
  if (hotelBudgetStatus === 'reasonable') return 82;
  if (hotelBudgetStatus === 'tight') return 58;
  if (hotelBudgetStatus === 'expensive-stay') return 32;
  return 45;
}

function calculateHotelValueAndEvidence(hotelMetadata = {}) {
  const signals = hotelMetadata.hotelQualitySignals || {};
  const rating = ratingEvidenceScore(signals);
  const volume = reviewVolumeScore(signals.reviewCount);
  const stars = Number.isFinite(Number(signals.stars)) ? clamp((Number(signals.stars) / 5) * 100) : 0;
  const priceValue = hotelPriceValueScore(hotelMetadata.hotelBudgetStatus);
  const locationEvidence = Number.isFinite(Number(signals.locationScore)) ? clamp(Number(signals.locationScore) * 10) : 0;
  const cleanlinessEvidence = Number.isFinite(Number(signals.cleanlinessScore)) ? clamp(Number(signals.cleanlinessScore) * 10) : 0;

  let raw = priceValue * 0.30 + rating * 0.25 + volume * 0.15 + locationEvidence * 0.15 + cleanlinessEvidence * 0.10 + stars * 0.05;
  const hasReviewEvidence = Number.isFinite(Number(signals.rating)) || Number.isFinite(Number(signals.reviewCount));
  const hasLocationOrCleanliness = locationEvidence > 0 || cleanlinessEvidence > 0;
  if (!hasReviewEvidence && !hasLocationOrCleanliness) raw = Math.min(raw, 55);
  if (hotelMetadata.hotelSourceConfidence !== 'live-agoda') raw = Math.min(raw, 62);

  return {
    rawScore: round(clamp(raw)),
    evidence: {
      priceValueScore: round(priceValue),
      bayesianReviewScore: round(rating),
      reviewVolumeScore: round(volume),
      locationEvidenceScore: round(locationEvidence),
      cleanlinessEvidenceScore: round(cleanlinessEvidence),
      starSignalScore: round(stars),
      sourceConfidence: hotelMetadata.hotelSourceConfidence || 'unknown'
    },
    missing: [
      Number.isFinite(Number(signals.rating)) ? null : 'hotel-rating-unavailable',
      Number.isFinite(Number(signals.reviewCount)) ? null : 'hotel-review-count-unavailable',
      locationEvidence > 0 ? null : 'hotel-location-evidence-unavailable',
      cleanlinessEvidence > 0 ? null : 'hotel-cleanliness-evidence-unavailable'
    ].filter(Boolean)
  };
}

function scoreHotelValueAndEvidence(hotelMetadata) {
  const scored = calculateHotelValueAndEvidence(hotelMetadata);
  return component(scored.rawScore, COMPONENT_WEIGHTS.hotelValueAndEvidence, scored.evidence, scored.missing);
}

function sourceConfidence(source, kind) {
  const value = String(source || '').toLowerCase();
  if (kind === 'flight') {
    if (value === 'travelpayouts') return 96;
    if (value.includes('cache')) return 82;
    if (value.includes('replay')) return 72;
    if (value.includes('fallback-after')) return 30;
    if (value.includes('mock') || value.includes('fallback')) return 44;
    return 25;
  }
  if (value === 'agoda') return 96;
  if (value.includes('cache')) return 82;
  if (value.includes('replay')) return 72;
  if (value.includes('fallback-after')) return 30;
  if (value.includes('fallback')) return 44;
  return 25;
}

function scoreProviderDataConfidence({ flight, stay, intelligence }) {
  const flightScore = sourceConfidence(flight?.source, 'flight');
  const stayScore = sourceConfidence(stay?.source, 'stay');
  const mapping = intelligence?.providerMapping || {};
  const mappingScore = mapping.flightMapped && mapping.hotelMapped ? 92 : (mapping.flightMapped || mapping.hotelMapped ? 70 : 45);
  const raw = flightScore * 0.45 + stayScore * 0.35 + mappingScore * 0.20;
  const isFallback = flightScore <= 44 || stayScore <= 44;
  return component(raw, COMPONENT_WEIGHTS.providerDataConfidence, {
    flightSource: flight?.source || 'unknown',
    staySource: stay?.source || 'unknown',
    flightEvidenceScore: flightScore,
    stayEvidenceScore: stayScore,
    providerMappingScore: mappingScore,
    evidenceClass: isFallback ? 'approved-labelled-fallback' : 'provider-evidence',
    fallback: isFallback
  });
}

function parseRequestedMonth(month, departureDate) {
  const rawDate = String(departureDate || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) return Number(rawDate.slice(5, 7));
  const rawMonth = String(month || '');
  if (/^\d{4}-\d{2}$/.test(rawMonth)) return Number(rawMonth.slice(5, 7));
  return null;
}

function seasonMonths(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes('year-round') || raw.includes('year round') || raw === 'all year') return new Set(Array.from({ length: 12 }, (_, index) => index + 1));
  const tokens = raw.match(/[a-z]+/g) || [];
  const months = tokens.map(token => MONTH_INDEX[token]).filter(Boolean);
  if (!months.length) return null;
  if (months.length === 1) return new Set(months);
  const start = months[0];
  const end = months[1];
  const result = new Set();
  let current = start;
  for (let guard = 0; guard < 12; guard += 1) {
    result.add(current);
    if (current === end) break;
    current = current === 12 ? 1 : current + 1;
  }
  return result;
}

function scoreSeasonalDateSuitability({ destination, month, departureDate }) {
  const requestedMonth = parseRequestedMonth(month, departureDate);
  const supportedMonths = seasonMonths(destination?.season);
  if (!requestedMonth || !supportedMonths) {
    return component(55, COMPONENT_WEIGHTS.seasonalDateSuitability, {
      requestedMonth,
      structuredSeason: destination?.season || null,
      source: 'unavailable-or-unparseable'
    }, ['structured-season-suitability-unavailable']);
  }
  const inSeason = supportedMonths.has(requestedMonth);
  return component(inSeason ? 90 : 45, COMPONENT_WEIGHTS.seasonalDateSuitability, {
    requestedMonth,
    structuredSeason: destination.season,
    inStructuredSeason: inSeason,
    source: 'destination-season-field'
  });
}

function buildCompositeScore(context) {
  const components = {
    budgetFitAndValue: scoreBudgetFitAndValue(context.cost),
    preferenceMatch: scorePreferenceMatch(context.intelligence, context.preference),
    travelPracticality: scoreTravelPracticality(context),
    tripDurationFit: scoreTripDurationFit(context.intelligence, context.nights),
    hotelValueAndEvidence: scoreHotelValueAndEvidence(context.hotelMetadata),
    providerDataConfidence: scoreProviderDataConfidence(context),
    seasonalDateSuitability: scoreSeasonalDateSuitability(context)
  };
  const total = round(Object.values(components).reduce((sum, item) => sum + item.weightedScore, 0));
  const weightedTotal = round(Object.values(COMPONENT_WEIGHTS).reduce((sum, weight) => sum + weight, 0));
  const hotelEvidence = components.hotelValueAndEvidence.rawScore;
  const providerEvidence = components.providerDataConfidence.rawScore;
  const evidenceConfidence = round(providerEvidence * 0.65 + hotelEvidence * 0.35);

  const strongest = Object.entries(components)
    .sort((a, b) => b[1].weightedScore - a[1].weightedScore || a[0].localeCompare(b[0]))[0];

  return {
    total: clamp(total),
    weightsTotal: weightedTotal,
    evidenceConfidence,
    activePreferenceScore: components.preferenceMatch.rawScore,
    practicalityScore: components.travelPracticality.rawScore,
    components,
    reasonCode: strongest ? `strongest-${strongest[0]}` : 'balanced-score'
  };
}

function evaluateEligibility({ destination, originDestination, intelligence, cost, flight, stay, nights, departureDate, returnDate }) {
  const checks = {
    canonicalDestination: Boolean(intelligence?.canonicalCityId && destination?.city && destination?.country),
    differentFromOrigin: true,
    supportedDurationPreserved: Number.isInteger(nights) && nights >= 2 && nights <= 14,
    hardMinimumNights: true,
    validDates: true,
    withinUsableBudget: Number(cost?.estimatedFlightAndStayTotal) <= Number(cost?.usableTripBudget),
    validGateway: Boolean(destination?.code || destination?.travelpayoutsLocationCode || destination?.primaryAirportCode || destination?.nearestMajorAirportCode),
    approvedEvidence: Number(flight?.flightUsd) > 0 && Number(stay?.totalStayUsd) > 0 && Boolean(flight?.source) && Boolean(stay?.source),
    internallyConsistent: destination?.recommendationEligible !== false && Number.isFinite(Number(destination?.lat)) && Number.isFinite(Number(destination?.lng))
  };

  if (originDestination) {
    const originCanonical = originDestination.globevoyCityId || originDestination.cityId;
    const sameCanonical = originCanonical && intelligence?.canonicalCityId && String(originCanonical).toLowerCase() === String(intelligence.canonicalCityId).toLowerCase();
    const sameCityCountry = String(originDestination.city || '').toLowerCase() === String(destination.city || '').toLowerCase() &&
      String(originDestination.country || '').toLowerCase() === String(destination.country || '').toLowerCase();
    const originMetro = originDestination.travelpayoutsLocationCode || originDestination.travelpayoutsCityCode || originDestination.code;
    const destinationMetro = destination.travelpayoutsLocationCode || destination.travelpayoutsCityCode || destination.code;
    const sameMetro = originMetro && destinationMetro && String(originMetro).toUpperCase() === String(destinationMetro).toUpperCase();
    checks.differentFromOrigin = !(sameCanonical || sameCityCountry || sameMetro);
  }

  const hardMinimum = Number(intelligence?.hardMinimumNights);
  if (Number.isFinite(hardMinimum) && hardMinimum > 0) checks.hardMinimumNights = nights >= hardMinimum;

  if (departureDate && !/^\d{4}-\d{2}-\d{2}$/.test(departureDate)) checks.validDates = false;
  if (returnDate && !/^\d{4}-\d{2}-\d{2}$/.test(returnDate)) checks.validDates = false;
  if (departureDate && returnDate && returnDate <= departureDate) checks.validDates = false;

  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  const flightFallback = sourceConfidence(flight?.source, 'flight') <= 44;
  const stayFallback = sourceConfidence(stay?.source, 'stay') <= 44;
  return {
    eligible: failed.length === 0,
    checks,
    failed,
    evidenceClass: flightFallback || stayFallback ? 'approved-labelled-fallback' : 'provider-evidence',
    reserveProtected: checks.withinUsableBudget,
    coreTotalUsd: Number(cost?.estimatedFlightAndStayTotal),
    usableBudgetUsd: Number(cost?.usableTripBudget)
  };
}

function compareRanked(a, b, preferenceActive = false) {
  const scoreDiff = Number(b.recommendationScore) - Number(a.recommendationScore);
  if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;
  const evidenceDiff = Number(b.scoreTrace?.evidenceConfidence || 0) - Number(a.scoreTrace?.evidenceConfidence || 0);
  if (Math.abs(evidenceDiff) > 1e-9) return evidenceDiff;
  if (preferenceActive) {
    const prefDiff = Number(b.scoreTrace?.activePreferenceScore || 0) - Number(a.scoreTrace?.activePreferenceScore || 0);
    if (Math.abs(prefDiff) > 1e-9) return prefDiff;
  }
  const practicalityDiff = Number(b.scoreTrace?.practicalityScore || 0) - Number(a.scoreTrace?.practicalityScore || 0);
  if (Math.abs(practicalityDiff) > 1e-9) return practicalityDiff;
  return String(a.canonicalCityId || a.id || '').localeCompare(String(b.canonicalCityId || b.id || ''));
}

function deduplicateRanked(items, preferenceActive = false) {
  const sorted = [...items].sort((a, b) => compareRanked(a, b, preferenceActive));
  const seenCity = new Set();
  const seenCityCountry = new Set();
  const kept = [];
  const removed = [];

  for (const item of sorted) {
    const cityId = String(item.canonicalCityId || item.id || '').toLowerCase();
    const cityName = String(item.city || '').trim().toLowerCase();
    const countryName = String(item.country || '').trim().toLowerCase();
    const cityCountry = cityName && countryName ? `${cityName}|${countryName}` : null;
    let rule = null;
    if (seenCity.has(cityId)) rule = 'canonical-city-id';
    else if (cityCountry && seenCityCountry.has(cityCountry)) rule = 'city-country-alias';

    if (rule) {
      removed.push({ canonicalCityId: item.canonicalCityId, rule });
      continue;
    }

    seenCity.add(cityId);
    if (cityCountry) seenCityCountry.add(cityCountry);
    kept.push(item);
  }

  return { kept, removed };
}

function roleCounts(items) {
  return items.reduce((counts, item) => {
    const role = item.groupRole || 'unknown';
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, { 'group1-anchor': 0, 'group2-discovery': 0, unknown: 0 });
}

function selectRankedRecommendations(items, { limit, preferenceActive = false } = {}) {
  const requestedLimit = Math.max(0, Number(limit) || 0);
  const deduped = deduplicateRanked(items, preferenceActive);
  const pool = deduped.kept;
  const topCount = Math.min(10, requestedLimit || pool.length, pool.length);
  const available = roleCounts(pool);
  const targetAnchor = topCount >= 10 && available['group1-anchor'] >= 4 ? 4 : Math.min(available['group1-anchor'], Math.max(1, Math.round(topCount * 0.4)));
  const targetDiscovery = topCount >= 10 && available['group2-discovery'] >= 6 ? 6 : Math.min(available['group2-discovery'], Math.max(1, topCount - targetAnchor));
  const selected = [];
  const selectedIds = new Set();
  const countryCounts = new Map();
  const selectedMetroClusters = new Set();
  const selectedGatewayClusters = new Set();
  const clusterSkips = [];
  const relaxations = [];
  const unknownRoleFillers = [];
  const selectionEvents = [];
  let countryCap = 2;
  let enforceRunRule = true;
  let enforceClusterDedupe = true;

  const addRelaxation = (code, detail) => {
    if (!relaxations.some(entry => entry.code === code)) relaxations.push({ code, detail });
  };

  function currentRoleCounts() {
    return roleCounts(selected);
  }

  function violatesRun(item) {
    if (!enforceRunRule || selected.length < 3 || item.groupRole === 'unknown') return false;
    return selected.slice(-3).every(existing => existing.groupRole === item.groupRole);
  }

  function clusterConflict(item) {
    if (!enforceClusterDedupe || selected.length >= 10) return null;
    if (item.metroClusterId && selectedMetroClusters.has(item.metroClusterId)) return 'metro-cluster';
    if (item.gatewayClusterId && selectedGatewayClusters.has(item.gatewayClusterId)) return 'gateway-cluster';
    return null;
  }

  function eligibleForSelection(item, requiredRole) {
    if (selectedIds.has(item.canonicalCityId)) return false;
    if (requiredRole && item.groupRole !== requiredRole) return false;
    const countryCount = countryCounts.get(item.countryKey) || 0;
    if (selected.length < 10 && countryCount >= countryCap) return false;
    if (selected.length < 10 && violatesRun(item)) return false;
    const conflict = clusterConflict(item);
    if (conflict) {
      clusterSkips.push({ canonicalCityId: item.canonicalCityId, rule: conflict, position: selected.length + 1 });
      return false;
    }
    return true;
  }

  function pick(requiredRole = null) {
    if (requiredRole) return pool.find(item => eligibleForSelection(item, requiredRole)) || null;
    const known = pool.find(item => item.groupRole !== 'unknown' && eligibleForSelection(item, null));
    return known || pool.find(item => eligibleForSelection(item, null)) || null;
  }

  function pickWithRelaxation(requiredRole = null) {
    let candidate = pick(requiredRole);
    if (candidate) return candidate;

    // The role-run rule is the softest presentation constraint, so relax it
    // before weakening country diversity. Hard eligibility is never relaxed.
    if (selected.length < 10 && enforceRunRule) {
      enforceRunRule = false;
      addRelaxation('role-run-rule-relaxed', 'No remaining candidate satisfied the maximum-three role-run rule.');
      candidate = pick(requiredRole);
      if (candidate) return candidate;
    }

    if (selected.length < 10 && countryCap === 2) {
      countryCap = 3;
      addRelaxation('country-cap-relaxed-to-three', 'No remaining candidate satisfied the two-per-country cap after the softer role-run rule was relaxed.');
      candidate = pick(requiredRole);
      if (candidate) return candidate;
    }

    if (selected.length < 10 && enforceClusterDedupe) {
      enforceClusterDedupe = false;
      addRelaxation('metro-gateway-dedupe-relaxed', 'No remaining candidate could fill the requested result positions without reusing a metro or gateway cluster.');
      candidate = pick(requiredRole);
      if (candidate) return candidate;
    }

    return pool.find(item => !selectedIds.has(item.canonicalCityId) && (!requiredRole || item.groupRole === requiredRole)) || null;
  }

  function chooseRequiredRole(position) {
    const counts = currentRoleCounts();
    const remainingSlots = topCount - position;
    const anchorNeeded = Math.max(0, targetAnchor - counts['group1-anchor']);
    const discoveryNeeded = Math.max(0, targetDiscovery - counts['group2-discovery']);

    if (position === 2 && available['group1-anchor'] > 0 && available['group2-discovery'] > 0) {
      if (counts['group1-anchor'] === 0) return 'group1-anchor';
      if (counts['group2-discovery'] === 0) return 'group2-discovery';
    }
    if (anchorNeeded >= remainingSlots) return 'group1-anchor';
    if (discoveryNeeded >= remainingSlots) return 'group2-discovery';
    if (counts['group1-anchor'] >= targetAnchor && discoveryNeeded > 0) return 'group2-discovery';
    if (counts['group2-discovery'] >= targetDiscovery && anchorNeeded > 0) return 'group1-anchor';
    return null;
  }

  for (let position = 0; position < topCount; position += 1) {
    const requiredRole = chooseRequiredRole(position);
    let candidate = requiredRole ? pickWithRelaxation(requiredRole) : pickWithRelaxation(null);

    if (!candidate && requiredRole) {
      addRelaxation('group-ratio-relaxed', `No remaining ${requiredRole} candidate could fill position ${position + 1}.`);
      candidate = pickWithRelaxation(null);
    }
    if (!candidate) break;

    if (candidate.groupRole === 'unknown') {
      unknownRoleFillers.push(candidate.canonicalCityId);
      addRelaxation('unknown-role-filler-used', 'Known-role candidates were insufficient under the active diversity constraints.');
    }

    selected.push(candidate);
    selectedIds.add(candidate.canonicalCityId);
    countryCounts.set(candidate.countryKey, (countryCounts.get(candidate.countryKey) || 0) + 1);
    if (candidate.metroClusterId) selectedMetroClusters.add(candidate.metroClusterId);
    if (candidate.gatewayClusterId) selectedGatewayClusters.add(candidate.gatewayClusterId);
    selectionEvents.push({
      canonicalCityId: candidate.canonicalCityId,
      position: position + 1,
      role: candidate.groupRole,
      requiredRole,
      countryCountAfterSelection: countryCounts.get(candidate.countryKey)
    });
  }

  const topSelectedIds = new Set(selectedIds);
  const remainder = pool.filter(item => !topSelectedIds.has(item.canonicalCityId));
  const ordered = [...selected, ...remainder].slice(0, requestedLimit || pool.length);
  const selectedRoleCounts = roleCounts(selected);

  ordered.forEach((item, index) => {
    item.selectionTrace = {
      position: index + 1,
      groupRole: item.groupRole,
      topTenPolicyApplied: index < 10,
      selectedByDiversityPolicy: index < selected.length,
      relaxationsActive: index < 10 ? relaxations.map(entry => entry.code) : []
    };
  });

  return {
    recommendations: ordered,
    selectionPolicy: {
      policyVersion: 'GV-REC-510C-1',
      deduplicatedPoolCount: pool.length,
      duplicateRemovals: deduped.removed,
      clusterSkips,
      topThreeRoleRequirement: {
        required: available['group1-anchor'] > 0 && available['group2-discovery'] > 0,
        anchorCount: selected.slice(0, 3).filter(item => item.groupRole === 'group1-anchor').length,
        discoveryCount: selected.slice(0, 3).filter(item => item.groupRole === 'group2-discovery').length
      },
      topTenTarget: {
        anchor: targetAnchor,
        discovery: targetDiscovery,
        selectedAnchor: selectedRoleCounts['group1-anchor'],
        selectedDiscovery: selectedRoleCounts['group2-discovery'],
        selectedUnknown: selectedRoleCounts.unknown
      },
      countryCapApplied: countryCap,
      roleRunRuleApplied: enforceRunRule,
      metroGatewayDedupeApplied: enforceClusterDedupe,
      unknownRoleFillers,
      relaxations,
      selectionEvents
    }
  };
}

module.exports = {
  COMPONENT_WEIGHTS,
  buildCompositeScore,
  calculateHotelValueAndEvidence,
  compareRanked,
  deduplicateRanked,
  evaluateEligibility,
  haversineKm,
  scoreBudgetFitAndValue,
  scorePreferenceMatch,
  scoreTripDurationFit,
  selectRankedRecommendations
};
