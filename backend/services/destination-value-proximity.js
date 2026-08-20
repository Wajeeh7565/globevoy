'use strict';

// GV-REC-677D — deterministic destination value & proximity intelligence V1.
//
// This layer does not invent attractions, demand, fares, visa rules or subjective
// "best city" claims. It uses product-approved city taxonomy, city-intelligence
// metadata, geography, nights and total-group budget to answer a narrower question:
// is each stop valuable enough to consume scarce overnight time in this itinerary?
//
// The main failure mode addressed here is an origin-adjacent city consuming several
// hotel nights in a multi-stop trip (for example Dubai -> Sharjah -> ...), when a
// stronger destination or a simpler one-stop route exists in the candidate pool.

const foundation = require('../data/grouped-city-foundation.json');
const { _internal: feasibility } = require('./route-feasibility');
const { currencyToUsdRate, normalizeCurrency } = require('../budget-presentation');

const DESTINATION_VALUE_PROXIMITY_VERSION_677D = 'GV-REC-677D';
const ORIGIN_METRO_ADJACENT_KM_677D = 65;
const ORIGIN_DAY_TRIP_KM_677D = 130;
const ORIGIN_NEARBY_KM_677D = 220;
const STOP_NEAR_DUPLICATE_KM_677D = 80;
const STOP_DAY_TRIP_PAIR_KM_677D = 170;

function text(value) {
  return String(value || '').trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function lower(value) {
  return text(value).toLowerCase();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function enabled() {
  return lower(process.env.ENABLE_DESTINATION_VALUE_PROXIMITY_677D) === 'true';
}

function normalizeName(value) {
  return lower(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

function nodeCode(node = {}) {
  return upper(node.airportCode || node.code || node.gatewayAirportCode || node?.gatewayAirport?.airportCode);
}

function cityId(node = {}) {
  return lower(node.cityId || node.id);
}

function cityName(node = {}) {
  return text(node.city || node.displayCity || node.name || node.cityId || nodeCode(node));
}

function countryCode(node = {}) {
  return upper(node.countryCode || node?.country?.code);
}

function foundationIndexes() {
  const records = Array.isArray(foundation?.records) ? foundation.records : [];
  const byId = new Map();
  const byCode = new Map();
  const byNameCountry = new Map();
  const byUniqueName = new Map();
  const nameCounts = new Map();

  for (const row of records) {
    const id = lower(row?.cityId);
    if (id) byId.set(id, row);
    const codes = [
      row?.providerSupport?.flight?.locationCode,
      ...(Array.isArray(row?.providerSupport?.flight?.airportCodes) ? row.providerSupport.flight.airportCodes : [])
    ].map(upper).filter(Boolean);
    for (const code of codes) if (!byCode.has(code)) byCode.set(code, row);
    const name = normalizeName(row?.displayCity);
    const cc = upper(row?.countryCode);
    if (name && cc) byNameCountry.set(`${name}|${cc}`, row);
    if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  for (const row of records) {
    const name = normalizeName(row?.displayCity);
    if (name && nameCounts.get(name) === 1) byUniqueName.set(name, row);
  }
  return { byId, byCode, byNameCountry, byUniqueName, count: records.length };
}

const INDEX = foundationIndexes();

function profileForNode(node = {}) {
  const id = cityId(node);
  if (id && INDEX.byId.has(id)) return INDEX.byId.get(id);
  const code = nodeCode(node);
  if (code && INDEX.byCode.has(code)) return INDEX.byCode.get(code);
  const name = normalizeName(cityName(node));
  const cc = countryCode(node);
  if (name && cc && INDEX.byNameCountry.has(`${name}|${cc}`)) return INDEX.byNameCountry.get(`${name}|${cc}`);
  if (name && INDEX.byUniqueName.has(name)) return INDEX.byUniqueName.get(name);
  return null;
}

function pairDistanceKm(a = {}, b = {}) {
  if (feasibility?.haversineKm) return Math.max(0, num(feasibility.haversineKm(a, b), 0));
  return 0;
}

function totalBudgetUsd(query = {}, tour = {}) {
  const direct = num(tour.totalBudgetUsd || query.budgetUsd, 0);
  if (direct > 0) return direct;
  const amount = num(query.budget || query.totalBudget, 0);
  if (!(amount > 0)) return 0;
  return amount * currencyToUsdRate(normalizeCurrency(query.currency || 'USD'));
}

function groupOf(node = {}, profile = null) {
  return upper(node.group || node.cityGroup || node?.classification?.group || profile?.group);
}

function subtypeOf(node = {}, profile = null) {
  return lower(node.groupSubtype || node?.classification?.groupSubtype || profile?.groupSubtype || profile?.sourceGroupRole);
}

function themeScores(profile = null) {
  const source = profile?.cityIntelligence?.themeScores || {};
  return ['nature', 'food', 'culture', 'beach', 'nightlife', 'relaxation'].map(key => Math.max(0, num(source[key], 0)));
}

function cosineSimilarity(a = [], b = []) {
  if (!a.length || a.length !== b.length) return null;
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (!(aa > 0) || !(bb > 0)) return null;
  return dot / Math.sqrt(aa * bb);
}

function proximityClass(distanceKm) {
  const d = num(distanceKm, 0);
  if (!(d > 0)) return 'unknown';
  if (d <= ORIGIN_METRO_ADJACENT_KM_677D) return 'metro-adjacent';
  if (d <= ORIGIN_DAY_TRIP_KM_677D) return 'day-trip-range';
  if (d <= ORIGIN_NEARBY_KM_677D) return 'nearby-overnight-range';
  return 'destination-trip-range';
}

function lowBudgetRelaxation(budgetUsd, totalNights) {
  let factor = 1;
  if (budgetUsd > 0 && budgetUsd <= 700) factor *= 0.55;
  else if (budgetUsd > 0 && budgetUsd <= 900) factor *= 0.72;
  if (num(totalNights, 0) <= 4) factor *= 0.82;
  return factor;
}

function originStopPenalty(stop = {}, origin = {}, context = {}) {
  const distanceKm = pairDistanceKm(origin, stop);
  const nights = Math.max(0, num(stop.nights, 0));
  const sameCountry = !!countryCode(origin) && countryCode(origin) === countryCode(stop);
  const pClass = proximityClass(distanceKm);
  const multiStop = num(context.stopCount, 0) >= 2;
  const budgetFactor = lowBudgetRelaxation(num(context.budgetUsd, 0), num(context.totalNights, 0));
  const borderFactor = sameCountry ? 1 : 0.68;
  const singleStopFactor = multiStop ? 1 : 0.45;

  let penalty = 0;
  const reasons = [];
  let dayTripCandidate = false;

  if (distanceKm > 0 && distanceKm <= ORIGIN_METRO_ADJACENT_KM_677D) {
    penalty += (multiStop ? 245 : 120) + Math.max(0, nights - 1) * 38;
    dayTripCandidate = true;
    reasons.push('origin-metro-adjacent-overnight-stop');
  } else if (distanceKm > 0 && distanceKm <= ORIGIN_DAY_TRIP_KM_677D) {
    penalty += (multiStop ? 135 : 70) + Math.max(0, nights - 2) * 24;
    dayTripCandidate = true;
    reasons.push('origin-day-trip-range-overnight-stop');
  } else if (distanceKm > 0 && distanceKm <= ORIGIN_NEARBY_KM_677D && nights >= 3) {
    penalty += multiStop ? 58 : 28;
    reasons.push('origin-nearby-stop-uses-scarce-nights');
  }

  penalty *= budgetFactor * borderFactor * singleStopFactor;
  return {
    distanceKm: Math.round(distanceKm),
    proximityClass: pClass,
    sameCountry,
    nights,
    dayTripCandidate,
    penalty: Number(penalty.toFixed(3)),
    reasons
  };
}

function pairPenalty(a = {}, b = {}, context = {}) {
  const distanceKm = pairDistanceKm(a, b);
  const sameCountry = !!countryCode(a) && countryCode(a) === countryCode(b);
  const profileA = profileForNode(a);
  const profileB = profileForNode(b);
  const similarity = cosineSimilarity(themeScores(profileA), themeScores(profileB));
  const budgetFactor = lowBudgetRelaxation(num(context.budgetUsd, 0), num(context.totalNights, 0));
  let penalty = 0;
  const reasons = [];

  if (distanceKm > 0 && distanceKm <= STOP_NEAR_DUPLICATE_KM_677D) {
    penalty += 185;
    reasons.push('near-duplicate-destination-pair');
  } else if (distanceKm > 0 && distanceKm <= STOP_DAY_TRIP_PAIR_KM_677D) {
    penalty += sameCountry ? 92 : 58;
    reasons.push('destination-pair-day-trip-range');
  } else if (distanceKm > 0 && distanceKm <= 240 && sameCountry) {
    penalty += 32;
    reasons.push('destination-pair-nearby-same-country');
  }

  // Theme similarity is only used as a small reinforcing signal when the cities are
  // already geographically close. It is never used to claim two far-away cities are
  // interchangeable or subjectively "the same".
  if (distanceKm > 0 && distanceKm <= 240 && similarity !== null && similarity >= 0.94) {
    penalty += 18;
    reasons.push('nearby-pair-high-theme-overlap');
  }

  penalty *= budgetFactor;
  return {
    from: cityName(a),
    to: cityName(b),
    distanceKm: Math.round(distanceKm),
    sameCountry,
    themeSimilarity: similarity === null ? null : Number(similarity.toFixed(3)),
    penalty: Number(penalty.toFixed(3)),
    reasons
  };
}

function profileSignals(stop = {}) {
  const profile = profileForNode(stop);
  const group = groupOf(stop, profile);
  const subtype = subtypeOf(stop, profile);
  const intelligence = profile?.cityIntelligence || {};
  const readiness = num(profile?.multiCitySuitability?.readinessScore, 0);
  const minNights = num(intelligence.recommendedMinNights || profile?.multiCitySuitability?.recommendedMinNights, 0);
  const maxNights = num(intelligence.recommendedMaxNights || profile?.multiCitySuitability?.recommendedMaxNights, 0);
  return {
    profileFound: !!profile,
    group,
    groupSubtype: subtype || null,
    readinessScore: readiness || null,
    recommendedMinNights: minNights || null,
    recommendedMaxNights: maxNights || null,
    initialCoreEligible: profile?.initialCoreEligible === true,
    productionStatus: profile?.productionStatus || null,
    discoverySignal: group === 'GROUP_2' || /discovery|hidden-gem|hidden-value|secondary/.test(subtype),
    familiarAnchorSignal: group === 'GROUP_1' || /anchor|famous/.test(subtype)
  };
}

function candidateMetrics(tour = {}, query = {}) {
  const origin = tour.origin || {};
  const stops = Array.isArray(tour.stops) ? tour.stops.filter(Boolean) : [];
  const budgetUsd = totalBudgetUsd(query, tour);
  const totalNights = num(tour.totalNights || query.totalNights || query.nights, stops.reduce((s, x) => s + num(x.nights, 0), 0));
  const context = { budgetUsd, totalNights, stopCount: stops.length };

  const stopSignals = stops.map(stop => {
    const proximity = originStopPenalty(stop, origin, context);
    const profile = profileSignals(stop);
    const usefulMinimumShortfallNights = profile.recommendedMinNights
      ? Math.max(0, Number(profile.recommendedMinNights) - Number(proximity.nights || 0))
      : 0;
    const minimumStayRelaxation = lowBudgetRelaxation(budgetUsd, totalNights) * (totalNights <= 4 ? 0.28 : 1);
    const usefulMinimumPenalty = usefulMinimumShortfallNights * 82 * minimumStayRelaxation;
    return {
      city: cityName(stop),
      cityId: cityId(stop) || null,
      countryCode: countryCode(stop) || null,
      ...proximity,
      penalty: Number((Number(proximity.penalty || 0) + usefulMinimumPenalty).toFixed(3)),
      reasons: usefulMinimumShortfallNights > 0
        ? [...(proximity.reasons || []), 'destination-stay-below-useful-minimum']
        : (proximity.reasons || []),
      usefulMinimumShortfallNights,
      ...profile
    };
  });

  const pairSignals = [];
  for (let i = 0; i < stops.length; i += 1) {
    for (let j = i + 1; j < stops.length; j += 1) pairSignals.push(pairPenalty(stops[i], stops[j], context));
  }

  const group1 = stopSignals.filter(x => x.familiarAnchorSignal).length;
  const group2 = stopSignals.filter(x => x.discoverySignal).length;
  const mixedAnchorDiscovery = stops.length >= 2 && group1 > 0 && group2 > 0;
  const originAdjacentStops = stopSignals.filter(x => x.proximityClass === 'metro-adjacent').length;
  const dayTripRangeStops = stopSignals.filter(x => x.dayTripCandidate).length;
  const closePairCount = pairSignals.filter(x => x.distanceKm > 0 && x.distanceKm <= STOP_DAY_TRIP_PAIR_KM_677D).length;
  const profileCoverage = stops.length ? stopSignals.filter(x => x.profileFound).length / stops.length : 0;
  const usefulMinimumShortfallNights = stopSignals.reduce((sum, row) => sum + num(row.usefulMinimumShortfallNights, 0), 0);

  return {
    budgetUsd: Math.round(budgetUsd),
    totalNights,
    stopCount: stops.length,
    originAdjacentStops,
    dayTripRangeStops,
    closePairCount,
    group1Signals: group1,
    group2Signals: group2,
    mixedAnchorDiscovery,
    profileCoverage: Number(profileCoverage.toFixed(3)),
    usefulMinimumShortfallNights,
    stopSignals,
    pairSignals
  };
}

function candidateAdjustment(tour = {}, query = {}) {
  const metrics = candidateMetrics(tour, query);
  if (!enabled()) return { adjustment: 0, metrics, reasons: ['feature-disabled'], qualityBand: 'disabled' };

  let adjustment = 0;
  const reasons = [];
  const stopPenalty = metrics.stopSignals.reduce((sum, row) => sum + num(row.penalty, 0), 0);
  const pairPenaltyTotal = metrics.pairSignals.reduce((sum, row) => sum + num(row.penalty, 0), 0);
  adjustment -= stopPenalty;
  adjustment -= pairPenaltyTotal;

  for (const row of metrics.stopSignals) {
    for (const reason of row.reasons || []) if (!reasons.includes(reason)) reasons.push(reason);
  }
  for (const row of metrics.pairSignals) {
    for (const reason of row.reasons || []) if (!reasons.includes(reason)) reasons.push(reason);
  }

  // Preserve the product's familiar-anchor + discovery architecture. This is a
  // modest bonus, not a requirement: a strong one-destination trip can still beat
  // a weak forced two-stop route.
  if (metrics.mixedAnchorDiscovery) {
    adjustment += 34;
    reasons.push('familiar-anchor-plus-discovery-mix');
  }

  const hiddenValueStops = metrics.stopSignals.filter(row => /hidden-gem|hidden-value|discovery/.test(row.groupSubtype || '')).length;
  if (hiddenValueStops > 0) adjustment += Math.min(28, hiddenValueStops * 14);

  // A single non-adjacent, well-supported destination deserves a small counterweight
  // to the generic "more stops is better" scoring used elsewhere. This allows one
  // genuinely stronger city to beat two destinations when the second stop is mostly
  // consuming nights because it is nearby and cheap.
  if (metrics.stopCount === 1) {
    const only = metrics.stopSignals[0];
    if (only && only.distanceKm >= 250 && (num(only.readinessScore, 0) >= 95 || only.familiarAnchorSignal || only.discoverySignal)) {
      adjustment += 42;
      reasons.push('strong-single-destination-not-forced-multistop');
    }
  }

  // In a multi-stop tour, any origin-metro-adjacent overnight stop is a structural
  // use-of-time problem, so add a route-level penalty beyond the per-stop signal.
  if (metrics.stopCount >= 2 && metrics.originAdjacentStops > 0) {
    adjustment -= metrics.originAdjacentStops * 125;
    if (!reasons.includes('origin-adjacent-stop-wastes-multistop-slot')) reasons.push('origin-adjacent-stop-wastes-multistop-slot');
  }

  const rounded = Number(adjustment.toFixed(3));
  const qualityBand = rounded <= -260 ? 'weak-destination-value'
    : rounded <= -120 ? 'low-destination-value'
      : rounded < -35 ? 'acceptable-with-value-tradeoff'
        : 'strong-destination-value';

  return { adjustment: rounded, metrics, reasons, qualityBand };
}

function annotateTour(tour = {}, query = {}) {
  if (!tour || typeof tour !== 'object') return tour;
  const evaluation = candidateAdjustment(tour, query);
  return {
    ...tour,
    destinationValueIntelligence: {
      enabled: enabled(),
      version: DESTINATION_VALUE_PROXIMITY_VERSION_677D,
      qualityBand: evaluation.qualityBand,
      adjustment: evaluation.adjustment,
      reasons: evaluation.reasons,
      metrics: evaluation.metrics,
      policy: 'protect scarce overnight stops from origin-adjacent/day-trip-range redundancy; reward familiar-anchor + discovery mix modestly; allow a stronger single destination to beat a forced weak multi-stop route'
    }
  };
}

module.exports = {
  DESTINATION_VALUE_PROXIMITY_VERSION_677D,
  ORIGIN_METRO_ADJACENT_KM_677D,
  ORIGIN_DAY_TRIP_KM_677D,
  ORIGIN_NEARBY_KM_677D,
  STOP_NEAR_DUPLICATE_KM_677D,
  STOP_DAY_TRIP_PAIR_KM_677D,
  enabled,
  profileForNode,
  candidateMetrics,
  candidateAdjustment,
  annotateTour,
  _internal: {
    pairDistanceKm,
    proximityClass,
    originStopPenalty,
    pairPenalty,
    profileSignals,
    cosineSimilarity,
    themeScores,
    totalBudgetUsd,
    foundationRecordCount: INDEX.count
  }
};
