'use strict';

const { resolveOrigin } = require('../../../data/destination-meta');
const { loadGroupedCityFoundation } = require('../../../data/grouped-city-foundation');
const {
  buildDisplayBudget,
  attachTourPresentation,
  convertUsd,
  presentationPolicy
} = require('../pricing/budget-presentation');

const ROUTE_VERSION = '1.0.1-gv-route-610b-r1';
const PERSONAL_EXPENSE_RESERVE_PERCENT = 0.10;
const MIN_STOPS = 2;
const MAX_STOPS = 5;
const DEFAULT_MAX_STOPS = 4;
const DEFAULT_TOTAL_NIGHTS = 12;
const MAX_RETURNED_TOURS = 3;

function stakeholderReadiness669eEnabled() {
  return String(process.env.ENABLE_STAKEHOLDER_READINESS_669E || '').trim().toLowerCase() === 'true';
}

const ROLE_ORDER = ['lowest-cost', 'best-balance', 'most-memorable'];
const ROLE_LABELS = {
  'lowest-cost': 'Lowest cost',
  'best-balance': 'Best balance',
  'most-memorable': 'Most memorable'
};

const REGION_NIGHTLY_USD = {
  'central-europe': 112,
  'east-asia': 105,
  'eastern-europe': 82,
  'mexico-central-america-caribbean': 92,
  'middle-east': 110,
  'north-africa': 72,
  'north-america-east': 145,
  'north-america-west': 150,
  'northern-europe': 130,
  'oceania': 140,
  'south-america': 82,
  'south-asia': 64,
  'southeast-asia': 68,
  'southern-europe': 102,
  'sub-saharan-africa': 88,
  'western-europe': 122
};

const HOTEL_DEPTH_MULTIPLIER = {
  'very-strong': 0.96,
  strong: 1.00,
  standard: 1.05,
  limited: 1.12,
  unknown: 1.15
};


const REGION_MACRO = {
  'north-america-east': 'americas',
  'north-america-west': 'americas',
  'mexico-central-america-caribbean': 'americas',
  'south-america': 'americas',
  'central-europe': 'europe',
  'eastern-europe': 'europe',
  'northern-europe': 'europe',
  'southern-europe': 'europe',
  'western-europe': 'europe',
  'east-asia': 'asia',
  'south-asia': 'asia',
  'southeast-asia': 'asia',
  'middle-east': 'middle-east',
  'north-africa': 'africa',
  'sub-saharan-africa': 'africa',
  'oceania': 'oceania'
};

class MultiCityValidationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'MultiCityValidationError';
    this.code = code;
    this.statusCode = 400;
    this.details = details;
  }
}

function isMultiCityRoute610BEnabled() {
  return String(process.env.ENABLE_MULTICITY_ROUTE_610B || '').trim().toLowerCase() === 'true';
}

function buildFeatureDisabledResponse() {
  return {
    ok: false,
    supported: false,
    version: ROUTE_VERSION,
    reason: 'feature-disabled',
    requiredFlag: 'ENABLE_MULTICITY_ROUTE_610B=true',
    tours: []
  };
}

function buildValidationErrorResponse(error) {
  return {
    ok: false,
    supported: true,
    version: ROUTE_VERSION,
    error: {
      code: error.code || 'INVALID_MULTICITY_REQUEST',
      message: error.message || 'The multi-city request is invalid.',
      ...(error.details && Object.keys(error.details).length ? { details: error.details } : {})
    },
    tours: []
  };
}

function isMultiCityValidationError(error) {
  return Boolean(error && (error instanceof MultiCityValidationError || error.statusCode === 400));
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value, step = 1) {
  return Math.round(value / step) * step;
}

function normalizeBudgetUsd(query = {}) {
  if (query.budgetUsd !== undefined && String(query.budgetUsd).trim() !== '') {
    return Math.max(1, finiteNumber(query.budgetUsd, 0));
  }
  const budget = Math.max(1, finiteNumber(query.budget, 0));
  const currency = String(query.currency || 'USD').toUpperCase();
  if (currency === 'CAD') return budget * finiteNumber(process.env.CAD_TO_USD, 0.735);
  if (currency === 'AUD') return budget * finiteNumber(process.env.AUD_TO_USD, 0.66);
  if (currency === 'EUR') return budget * 1.08;
  if (currency === 'GBP') return budget * 1.27;
  return budget;
}

function normalizeMaxStops(value) {
  if (value === undefined || value === null || String(value).trim() === '') return DEFAULT_MAX_STOPS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_STOPS || parsed > MAX_STOPS) {
    throw new MultiCityValidationError(
      'UNSUPPORTED_STOP_COUNT',
      `Multi-city tours support ${MIN_STOPS} to ${MAX_STOPS} destination stops.`,
      { requestedStops: value, minimumStops: MIN_STOPS, maximumStops: MAX_STOPS }
    );
  }
  return parsed;
}

function normalizeTotalNights(value, maxStops) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return Math.max(DEFAULT_TOTAL_NIGHTS, maxStops * 2);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 4 || parsed > 35) {
    throw new MultiCityValidationError(
      'UNSUPPORTED_TOTAL_NIGHTS',
      'Multi-city duration must be a whole number from 4 to 35 nights.',
      { requestedNights: value, minimumNights: 4, maximumNights: 35 }
    );
  }
  return parsed;
}

function normalizeTheme(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ['nature', 'food', 'culture', 'beach', 'nightlife', 'relaxation'].includes(normalized)
    ? normalized
    : null;
}

function parsePreferredStops(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim().toLowerCase()).filter(Boolean);
  return String(value || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
}

function radians(degrees) {
  return degrees * Math.PI / 180;
}

function haversineKm(a, b) {
  const lat1 = radians(finiteNumber(a.latitude ?? a.lat));
  const lat2 = radians(finiteNumber(b.latitude ?? b.lat));
  const dLat = lat2 - lat1;
  const dLng = radians(finiteNumber(b.longitude ?? b.lng) - finiteNumber(a.longitude ?? a.lng));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function normalizeCityKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildFoundationIndexes() {
  const foundation = loadGroupedCityFoundation();
  const records = foundation.records || [];
  const byId = new Map();
  const byLocationCode = new Map();
  const byAirportCode = new Map();
  const byCityCountry = new Map();

  for (const record of records) {
    byId.set(String(record.cityId || '').toLowerCase(), record);
    const locationCode = String(record.providerSupport?.flight?.locationCode || '').toUpperCase();
    if (locationCode) byLocationCode.set(locationCode, record);
    for (const airportCode of record.providerSupport?.flight?.airportCodes || []) {
      byAirportCode.set(String(airportCode).toUpperCase(), record);
    }
    byCityCountry.set(`${normalizeCityKey(record.displayCity)}|${String(record.countryCode || '').toUpperCase()}`, record);
  }

  return { foundation, records, byId, byLocationCode, byAirportCode, byCityCountry };
}

function resolveOriginRecord(origin, indexes) {
  if (!origin) return null;
  const cityMatch = indexes.byCityCountry.get(`${normalizeCityKey(origin.city)}|${String(origin.countryCode || '').toUpperCase()}`) || null;
  // GV-PROD-669E: prefer the requested city identity before a shared provider
  // location code. This prevents Vancouver (YVR) from being labelled Whistler.
  if (stakeholderReadiness669eEnabled() && cityMatch) return cityMatch;
  return indexes.byLocationCode.get(String(origin.code || '').toUpperCase())
    || indexes.byAirportCode.get(String(origin.airportCode || '').toUpperCase())
    || cityMatch
    || null;
}

function originNode(origin, originRecord) {
  return {
    cityId: originRecord?.cityId || `origin-${String(origin.code || '').toLowerCase()}`,
    city: originRecord?.displayCity || origin.city,
    country: originRecord?.country || null,
    countryCode: originRecord?.countryCode || origin.countryCode || null,
    code: origin.code,
    airportCode: origin.airportCode,
    latitude: finiteNumber(originRecord?.latitude, 0),
    longitude: finiteNumber(originRecord?.longitude, 0),
    isOrigin: true
  };
}

function candidateEligible(record, originRecord) {
  if (!record || record.initialLaunchSet !== true) return false;
  if (record.providerSupport?.bothProviderReady !== true) return false;
  if (record.multiCitySuitability?.status !== 'strong') return false;
  if (String(record.multiCitySuitability?.activationTier || '').toUpperCase() !== 'CORE') return false;
  if (!['GROUP_1', 'GROUP_2'].includes(record.group)) return false;
  if (!Number.isFinite(Number(record.latitude)) || !Number.isFinite(Number(record.longitude))) return false;
  if (originRecord && record.cityId === originRecord.cityId) return false;
  const originCode = String(originRecord?.providerSupport?.flight?.locationCode || '').toUpperCase();
  const destinationCode = String(record.providerSupport?.flight?.locationCode || '').toUpperCase();
  if (originCode && destinationCode && originCode === destinationCode) return false;
  return true;
}

function hotelDepthScore(depth) {
  if (depth === 'very-strong') return 100;
  if (depth === 'strong') return 88;
  if (depth === 'standard') return 74;
  if (depth === 'limited') return 55;
  return 40;
}

function themeStrength(record, theme) {
  if (!theme) return 0;
  return finiteNumber(record.cityIntelligence?.themeScores?.[theme], 0) * 20;
}

function baseCandidateScore(record, theme) {
  const readiness = finiteNumber(record.multiCitySuitability?.readinessScore, 0);
  const transit = finiteNumber(record.cityIntelligence?.publicTransitPracticality, 0) * 10;
  const hotel = hotelDepthScore(record.multiCitySuitability?.hotelDepth);
  const taxonomy = record.taxonomyReviewRequired ? 75 : 100;
  return readiness * 0.42 + hotel * 0.22 + transit * 0.16 + taxonomy * 0.10 + themeStrength(record, theme) * 0.10;
}

function corridorCandidates(records, originRecord, theme) {
  const originCompatible = new Set(originRecord?.multiCitySuitability?.compatibleRegionClusters || []);
  const originCluster = originRecord?.multiCitySuitability?.regionCluster || null;
  const candidates = records.filter(record => candidateEligible(record, originRecord));
  return candidates
    .map(record => {
      const cluster = record.multiCitySuitability.regionCluster;
      const compatible = !originRecord
        || cluster === originCluster
        || originCompatible.has(cluster)
        || (record.multiCitySuitability.compatibleRegionClusters || []).includes(originCluster);
      const compatibilityBonus = compatible ? 18 : 0;
      const originDistance = originRecord ? haversineKm(originRecord, record) : 0;
      const longHaulPenalty = originDistance > 13000 ? 12 : originDistance > 9500 ? 6 : 0;
      return {
        record,
        cluster,
        compatible,
        originDistance,
        score: baseCandidateScore(record, theme) + compatibilityBonus - longHaulPenalty
      };
    })
    .filter(item => item.compatible)
    .sort((a, b) => b.score - a.score || a.record.cityId.localeCompare(b.record.cityId));
}

function clusterScore(items, originRecord) {
  const anchors = items.filter(item => item.record.group === 'GROUP_1').length;
  const discoveries = items.filter(item => item.record.group === 'GROUP_2').length;
  if (!anchors || !discoveries) return -Infinity;
  const top = items.slice(0, 8);
  const avg = top.reduce((sum, item) => sum + item.score, 0) / Math.max(1, top.length);
  const meanDistance = top.reduce((sum, item) => sum + item.originDistance, 0) / Math.max(1, top.length);
  const distanceFit = originRecord ? Math.max(0, 20 - meanDistance / 700) : 0;
  return avg + Math.min(anchors, 5) * 2 + Math.min(discoveries, 8) + distanceFit;
}

function chooseTargetClusters(items, originRecord) {
  const byCluster = new Map();
  for (const item of items) {
    if (!byCluster.has(item.cluster)) byCluster.set(item.cluster, []);
    byCluster.get(item.cluster).push(item);
  }
  return [...byCluster.entries()]
    .map(([cluster, clusterItems]) => ({ cluster, items: clusterItems, score: clusterScore(clusterItems, originRecord) }))
    .filter(entry => Number.isFinite(entry.score))
    .sort((a, b) => b.score - a.score || a.cluster.localeCompare(b.cluster))
    .slice(0, 6);
}

function buildCorridorPool(allItems, targetCluster) {
  const targetItems = allItems.filter(item => item.cluster === targetCluster);
  const targetRecords = targetItems.map(item => item.record);
  const acceptedClusters = new Set([targetCluster]);
  for (const record of targetRecords.slice(0, 6)) {
    for (const cluster of record.multiCitySuitability?.compatibleRegionClusters || []) acceptedClusters.add(cluster);
  }
  return allItems
    .filter(item => acceptedClusters.has(item.cluster))
    .sort((a, b) => {
      const aSame = a.cluster === targetCluster ? 1 : 0;
      const bSame = b.cluster === targetCluster ? 1 : 0;
      return bSame - aSame || b.score - a.score || a.record.cityId.localeCompare(b.record.cityId);
    })
    .slice(0, 30);
}

function recordThemeVector(record) {
  const themes = record.cityIntelligence?.themeScores || {};
  return ['nature', 'food', 'culture', 'beach', 'nightlife', 'relaxation'].map(key => finiteNumber(themes[key], 0));
}

function vectorDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) sum += Math.abs(a[i] - b[i]);
  return sum;
}

function countryKey(record) {
  return String(record?.countryCode || record?.country || '').trim().toUpperCase();
}

function canAddWithinCountryCap(chosen, candidate, cap = 2) {
  const key = countryKey(candidate.record || candidate);
  if (!key) return true;
  return chosen.filter(item => countryKey(item.record || item) === key).length < cap;
}

function pickByRole(pool, stopCount, role, offset = 0) {
  const anchors = pool.filter(item => item.record.group === 'GROUP_1');
  const discoveries = pool.filter(item => item.record.group === 'GROUP_2');
  if (!anchors.length || !discoveries.length) return null;

  let anchorTarget;
  if (stopCount === 2) anchorTarget = 1;
  else if (role === 'most-memorable') anchorTarget = Math.min(2, stopCount - 1);
  else if (role === 'lowest-cost') anchorTarget = 1;
  else anchorTarget = Math.max(1, Math.floor(stopCount / 2));
  const discoveryTarget = stopCount - anchorTarget;

  const chosen = [];
  const anchorStart = offset % Math.min(anchors.length, 5);
  const firstAnchor = anchors[anchorStart];
  chosen.push(firstAnchor);

  while (chosen.filter(item => item.record.group === 'GROUP_1').length < anchorTarget) {
    const next = anchors.find(item =>
      !chosen.some(existing => existing.record.cityId === item.record.cityId)
      && canAddWithinCountryCap(chosen, item)
    );
    if (!next) break;
    chosen.push(next);
  }

  while (chosen.filter(item => item.record.group === 'GROUP_2').length < discoveryTarget) {
    let ranked = discoveries.filter(item =>
      !chosen.some(existing => existing.record.cityId === item.record.cityId)
      && canAddWithinCountryCap(chosen, item)
    );
    if (!ranked.length) break;
    if (role === 'most-memorable' && chosen.length) {
      ranked = ranked
        .map(item => ({
          item,
          diversity: chosen.reduce((sum, existing) => sum + vectorDistance(recordThemeVector(item.record), recordThemeVector(existing.record)), 0)
        }))
        .sort((a, b) => b.diversity - a.diversity || b.item.score - a.item.score || a.item.record.cityId.localeCompare(b.item.record.cityId))
        .map(entry => entry.item);
    } else if (role === 'lowest-cost') {
      ranked = ranked.slice().sort((a, b) => a.originDistance - b.originDistance || b.score - a.score || a.record.cityId.localeCompare(b.record.cityId));
    }
    chosen.push(ranked[0]);
  }

  if (chosen.length !== stopCount) return null;
  return chosen.map(item => item.record);
}

function routeDistanceKm(origin, orderedStops) {
  const nodes = [origin, ...orderedStops, origin];
  let total = 0;
  for (let i = 0; i < nodes.length - 1; i += 1) total += haversineKm(nodes[i], nodes[i + 1]);
  return total;
}

function permutationKey(records) {
  return records.map(record => record.cityId).join('|');
}

function optimizeRouteOrder(origin, records) {
  if (records.length <= 1) return records.slice();
  let best = null;
  let bestDistance = Infinity;
  let bestKey = '';
  const inputRank = new Map(records.map((record, index) => [record.cityId, index]));

  function preferenceTieKey(sequence) {
    return sequence
      .map(record => `${String(inputRank.get(record.cityId) ?? 999).padStart(3, '0')}:${record.cityId}`)
      .join('|');
  }

  function visit(prefix, remaining) {
    if (!remaining.length) {
      const distance = routeDistanceKm(origin, prefix);
      const key = preferenceTieKey(prefix);
      if (distance + 1e-9 < bestDistance || (Math.abs(distance - bestDistance) <= 1e-9 && (!best || key < bestKey))) {
        best = prefix.slice();
        bestDistance = distance;
        bestKey = key;
      }
      return;
    }
    const orderedRemaining = remaining.slice().sort((a, b) => a.cityId.localeCompare(b.cityId));
    for (let i = 0; i < orderedRemaining.length; i += 1) {
      const next = orderedRemaining[i];
      visit(prefix.concat(next), orderedRemaining.slice(0, i).concat(orderedRemaining.slice(i + 1)));
    }
  }

  visit([], records.slice());
  return best || records.slice();
}

function recommendedNightBounds(stop) {
  const min = clamp(Math.round(finiteNumber(stop.multiCitySuitability?.recommendedMinNights, 2)), 2, 14);
  const max = clamp(Math.round(finiteNumber(stop.multiCitySuitability?.recommendedMaxNights, Math.max(min, 6))), min, 14);
  return { min, max };
}

function allocateNights(stops, totalNights) {
  const bounds = new Map(stops.map(stop => [stop.cityId, recommendedNightBounds(stop)]));
  const minimumTotal = stops.reduce((sum, stop) => sum + bounds.get(stop.cityId).min, 0);
  const maximumTotal = stops.reduce((sum, stop) => sum + bounds.get(stop.cityId).max, 0);
  if (totalNights < minimumTotal || totalNights > maximumTotal) return null;

  const allocation = new Map(stops.map(stop => [stop.cityId, bounds.get(stop.cityId).min]));
  let remaining = totalNights - minimumTotal;

  while (remaining > 0) {
    const eligible = stops
      .filter(stop => allocation.get(stop.cityId) < bounds.get(stop.cityId).max)
      .sort((a, b) => {
        const aBounds = bounds.get(a.cityId);
        const bBounds = bounds.get(b.cityId);
        const aCurrent = allocation.get(a.cityId);
        const bCurrent = allocation.get(b.cityId);
        const aFill = (aCurrent - aBounds.min) / Math.max(1, aBounds.max - aBounds.min);
        const bFill = (bCurrent - bBounds.min) / Math.max(1, bBounds.max - bBounds.min);
        return aFill - bFill
          || (bBounds.max - bCurrent) - (aBounds.max - aCurrent)
          || a.cityId.localeCompare(b.cityId);
      });
    if (!eligible.length) return null;
    const stop = eligible[0];
    allocation.set(stop.cityId, allocation.get(stop.cityId) + 1);
    remaining -= 1;
  }

  return allocation;
}

function estimateFlightUsd(distanceKm, from, to) {
  let value;
  if (distanceKm < 500) value = 58 + distanceKm * 0.105;
  else if (distanceKm < 1500) value = 78 + distanceKm * 0.085;
  else if (distanceKm < 4000) value = 110 + distanceKm * 0.072;
  else if (distanceKm < 8000) value = 155 + distanceKm * 0.064;
  else value = 220 + distanceKm * 0.058;

  const fromCluster = from.multiCitySuitability?.regionCluster;
  const toCluster = to.multiCitySuitability?.regionCluster;
  if (fromCluster && toCluster && fromCluster !== toCluster) value *= 1.08;
  if (distanceKm > 9000) value *= 1.06;
  return roundTo(Math.max(65, value), 5);
}

function estimateNightlyUsd(record) {
  const cluster = record.multiCitySuitability?.regionCluster;
  const base = REGION_NIGHTLY_USD[cluster] || 100;
  const depth = record.multiCitySuitability?.hotelDepth || 'unknown';
  const depthMultiplier = HOTEL_DEPTH_MULTIPLIER[depth] || HOTEL_DEPTH_MULTIPLIER.unknown;
  const groupMultiplier = record.group === 'GROUP_1' ? 1.06 : 0.96;
  return roundTo(base * depthMultiplier * groupMultiplier, 5);
}

function compactStop(record, nights) {
  const nightly = estimateNightlyUsd(record);
  return {
    cityId: record.cityId,
    city: record.displayCity,
    country: record.country,
    countryCode: record.countryCode,
    code: record.providerSupport?.flight?.locationCode || null,
    airportCodes: record.providerSupport?.flight?.airportCodes || [],
    group: record.group,
    groupSubtype: record.groupSubtype,
    regionCluster: record.multiCitySuitability?.regionCluster || null,
    latitude: record.latitude,
    longitude: record.longitude,
    nights,
    recommendedMinNights: record.multiCitySuitability?.recommendedMinNights || null,
    recommendedMaxNights: record.multiCitySuitability?.recommendedMaxNights || null,
    hotel: {
      provider: 'Agoda',
      providerCityId: record.providerSupport?.hotel?.cityId || null,
      hotelCoverageCount: record.providerSupport?.hotel?.hotelCount || 0,
      coverageDepth: record.providerSupport?.hotel?.depth || null,
      estimatedNightlyUsd: nightly,
      estimatedStayUsd: nightly * nights,
      estimateSource: 'region-hotel-planning-fallback',
      livePriceVerified: false
    },
    themeScores: record.cityIntelligence?.themeScores || {},
    publicTransitPracticality: record.cityIntelligence?.publicTransitPracticality || null,
    readinessScore: record.multiCitySuitability?.readinessScore || null,
    replaceable: true,
    removable: true
  };
}

function buildLegs(origin, orderedStops) {
  const nodes = [origin, ...orderedStops, origin];
  const legs = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const distanceKm = Math.round(haversineKm(from, to));
    legs.push({
      legNumber: i + 1,
      from: {
        cityId: from.cityId,
        city: from.displayCity || from.city,
        code: from.providerSupport?.flight?.locationCode || from.code || null,
        latitude: from.latitude,
        longitude: from.longitude
      },
      to: {
        cityId: to.cityId,
        city: to.displayCity || to.city,
        code: to.providerSupport?.flight?.locationCode || to.code || null,
        latitude: to.latitude,
        longitude: to.longitude
      },
      distanceKm,
      estimatedFlightUsd: estimateFlightUsd(distanceKm, from, to),
      estimateSource: 'distance-band-flight-planning-fallback',
      liveFareVerified: false,
      providerVerificationRequired: true
    });
  }
  return legs;
}

function planSignature(stops) {
  return stops.map(stop => stop.cityId).slice().sort().join('|');
}

function themeDiversity(stops) {
  if (stops.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < stops.length; i += 1) {
    for (let j = i + 1; j < stops.length; j += 1) {
      total += vectorDistance(recordThemeVector(stops[i]), recordThemeVector(stops[j]));
      pairs += 1;
    }
  }
  return pairs ? total / pairs : 0;
}

function routeCompactness(origin, stops, totalDistance) {
  const farthest = Math.max(...stops.map(stop => haversineKm(origin, stop)), 1);
  const theoretical = farthest * 2;
  return clamp(100 - ((totalDistance / theoretical) - 1) * 35, 0, 100);
}


function internationalNoveltyScore(origin, stops) {
  const originCluster = origin?.multiCitySuitability?.regionCluster || null;
  const originMacro = REGION_MACRO[originCluster] || originCluster;
  if (!originMacro || !stops.length) return 0;
  const outside = stops.filter(stop => {
    const cluster = stop.multiCitySuitability?.regionCluster || null;
    return (REGION_MACRO[cluster] || cluster) !== originMacro;
  }).length;
  return outside / stops.length * 100;
}

function planScore(plan, role, usableBudget) {
  const utilisation = plan.estimatedTotalUsd / Math.max(1, usableBudget);
  const budgetFit = utilisation <= 1
    ? clamp(100 - Math.abs(0.78 - utilisation) * 115, 0, 100)
    : 0;
  const readiness = plan.stopRecords.reduce((sum, stop) => sum + finiteNumber(stop.multiCitySuitability?.readinessScore, 0), 0) / plan.stopRecords.length;
  const compactness = routeCompactness(plan.originRecord, plan.stopRecords, plan.totalDistanceKm);
  const diversity = clamp(themeDiversity(plan.stopRecords) * 5, 0, 100);
  const anchorCount = plan.stopRecords.filter(stop => stop.group === 'GROUP_1').length;
  const discoveryCount = plan.stopRecords.filter(stop => stop.group === 'GROUP_2').length;
  const mixScore = anchorCount >= 1 && discoveryCount >= 1 ? 100 : 0;
  const internationalNovelty = internationalNoveltyScore(plan.originRecord, plan.stopRecords);

  const stopCountScore = clamp((plan.stopRecords.length - MIN_STOPS) / (MAX_STOPS - MIN_STOPS) * 100, 0, 100);
  if (role === 'lowest-cost') {
    const costScore = clamp(120 - utilisation * 105, 0, 100);
    return costScore * 0.40 + compactness * 0.25 + readiness * 0.20 + mixScore * 0.15;
  }
  if (role === 'most-memorable') {
    const famous = clamp(anchorCount / Math.max(1, plan.stopRecords.length) * 100, 0, 100);
    return diversity * 0.27 + famous * 0.15 + readiness * 0.18 + budgetFit * 0.12 + compactness * 0.10 + stopCountScore * 0.18;
  }
  return budgetFit * 0.22 + compactness * 0.20 + readiness * 0.17 + diversity * 0.08 + mixScore * 0.12 + stopCountScore * 0.08 + internationalNovelty * 0.13;
}

function buildPlan(origin, originRecord, records, totalNights, budgetUsd, role, targetCluster, options = {}) {
  if (!options.allowCountryOverflow) {
    const countryCounts = new Map();
    for (const record of records) {
      const key = countryKey(record);
      const count = (countryCounts.get(key) || 0) + 1;
      countryCounts.set(key, count);
      if (key && count > 2) return null;
    }
  }
  const ordered = optimizeRouteOrder(originRecord, records);
  const nights = allocateNights(ordered, totalNights);
  if (!nights) return null;
  const legs = buildLegs(originRecord, ordered);
  const stops = ordered.map(stop => compactStop(stop, nights.get(stop.cityId)));
  const totalFlightEstimateUsd = legs.reduce((sum, leg) => sum + leg.estimatedFlightUsd, 0);
  const totalHotelEstimateUsd = stops.reduce((sum, stop) => sum + stop.hotel.estimatedStayUsd, 0);
  const estimatedTotalUsd = totalFlightEstimateUsd + totalHotelEstimateUsd;
  const reserveAmountUsd = Math.round(budgetUsd * PERSONAL_EXPENSE_RESERVE_PERCENT);
  const usableBudgetUsd = budgetUsd - reserveAmountUsd;
  const amountLeftUsd = usableBudgetUsd - estimatedTotalUsd;
  const totalDistanceKm = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);

  const plan = {
    originRecord,
    stopRecords: ordered,
    stops,
    legs,
    targetCluster,
    totalDistanceKm,
    totalFlightEstimateUsd,
    totalHotelEstimateUsd,
    estimatedTotalUsd,
    reserveAmountUsd,
    usableBudgetUsd,
    amountLeftUsd,
    withinBudget: amountLeftUsd >= 0,
    role
  };
  plan.score = planScore(plan, role, usableBudgetUsd);
  return plan;
}

function buildPreferredPlan(origin, originRecord, preferredIds, indexes, totalNights, budgetUsd) {
  if (!preferredIds.length) return null;
  const records = preferredIds.map(id => indexes.byId.get(id)).filter(Boolean);
  const unique = [...new Map(records.map(record => [record.cityId, record])).values()];
  if (unique.length < MIN_STOPS || unique.length > MAX_STOPS) return null;
  if (unique.some(record => !candidateEligible(record, originRecord))) return null;
  if (!unique.some(record => record.group === 'GROUP_1') || !unique.some(record => record.group === 'GROUP_2')) {
    // A user-entered concept may be anchor-heavy. Preserve it for preview but
    // do not allow it to displace all mixed automatic options.
  }
  const preferredPlan = buildPlan(origin, originRecord, unique, totalNights, budgetUsd, 'best-balance', 'preferred-stops', { allowCountryOverflow: true });
  if (preferredPlan) preferredPlan.preferred = true;
  return preferredPlan;
}

function generatePlanCandidates(origin, originRecord, indexes, query) {
  const budgetUsd = normalizeBudgetUsd(query);
  const maxStops = normalizeMaxStops(query.maxStops ?? query.stops);
  const totalNights = normalizeTotalNights(query.totalNights ?? query.nights, maxStops);
  const theme = normalizeTheme(query.theme ?? query.preference);
  const preferredStops = parsePreferredStops(query.preferredStops);
  const allItems = corridorCandidates(indexes.records, originRecord, theme);
  const targetClusters = chooseTargetClusters(allItems, originRecord);
  const plans = [];

  const preferredPlan = buildPreferredPlan(origin, originRecord, preferredStops, indexes, totalNights, budgetUsd);
  if (preferredPlan) plans.push(preferredPlan);

  for (const clusterEntry of targetClusters) {
    const pool = buildCorridorPool(allItems, clusterEntry.cluster);
    for (const role of ROLE_ORDER) {
      for (let stopCount = MIN_STOPS; stopCount <= maxStops; stopCount += 1) {
        if (totalNights < stopCount * 2) continue;
        for (let offset = 0; offset < 4; offset += 1) {
          const records = pickByRole(pool, stopCount, role, offset);
          if (!records) continue;
          const plan = buildPlan(origin, originRecord, records, totalNights, budgetUsd, role, clusterEntry.cluster, { allowCountryOverflow: false });
          if (plan) plans.push(plan);
        }
      }
    }
  }

  const deduped = new Map();
  for (const plan of plans) {
    const signature = planSignature(plan.stopRecords);
    const current = deduped.get(signature);
    if (!current || plan.score > current.score) deduped.set(signature, plan);
  }

  return {
    budgetUsd,
    maxStops,
    totalNights,
    theme,
    preferredStops,
    candidateCount: allItems.length,
    targetClusters: targetClusters.map(entry => entry.cluster),
    plans: [...deduped.values()]
  };
}

function selectDifferentiatedPlans(plans, usableBudgetUsd) {
  const feasible = plans.filter(plan => plan.estimatedTotalUsd <= usableBudgetUsd);
  const selected = [];
  const usedSignatures = new Set();
  const preferred = feasible.find(plan => plan.preferred === true);

  for (const role of ROLE_ORDER) {
    if (role === 'best-balance' && preferred) {
      const selectedPlan = { ...preferred, role, score: planScore(preferred, role, usableBudgetUsd) };
      selected.push(selectedPlan);
      usedSignatures.add(planSignature(selectedPlan.stopRecords));
      continue;
    }
    const ranked = feasible
      .map(plan => ({ plan, score: planScore(plan, role, usableBudgetUsd) }))
      .sort((a, b) => b.score - a.score || a.plan.estimatedTotalUsd - b.plan.estimatedTotalUsd || planSignature(a.plan.stopRecords).localeCompare(planSignature(b.plan.stopRecords)));

    let choice = ranked.find(entry => !usedSignatures.has(planSignature(entry.plan.stopRecords)));
    if (!choice) choice = ranked[0];
    if (!choice) continue;
    const selectedPlan = { ...choice.plan, role, score: choice.score };
    selected.push(selectedPlan);
    usedSignatures.add(planSignature(selectedPlan.stopRecords));
  }

  return selected.slice(0, MAX_RETURNED_TOURS);
}

function tourExplanation(plan) {
  const anchors = plan.stopRecords.filter(stop => stop.group === 'GROUP_1').map(stop => stop.displayCity);
  const discoveries = plan.stopRecords.filter(stop => stop.group === 'GROUP_2').map(stop => stop.displayCity);
  const reasons = [];
  if (anchors.length) reasons.push(`Uses ${anchors.join(', ')} as familiar itinerary anchor${anchors.length > 1 ? 's' : ''}.`);
  if (discoveries.length) reasons.push(`Adds ${discoveries.join(', ')} as discovery stop${discoveries.length > 1 ? 's' : ''}.`);
  reasons.push(`The route is ordered to reduce avoidable backtracking across approximately ${Math.round(plan.totalDistanceKm).toLocaleString('en-US')} km.`);
  reasons.push(`The 10% personal-expense reserve remains protected; flight and hotel figures are planning estimates until providers verify live availability.`);
  return reasons;
}

function publicTour(plan, index, originPublic, budgetUsd, query = {}) {
  const totalBudgetUsd = budgetUsd;
  const tour = {
    tourId: `gv610b-${plan.role}-${index + 1}-${plan.stopRecords.map(stop => stop.cityId).join('-')}`,
    tourRole: plan.role,
    tourRoleLabel: ROLE_LABELS[plan.role],
    origin: originPublic,
    stops: plan.stops,
    legs: plan.legs,
    totalNights: plan.stops.reduce((sum, stop) => sum + stop.nights, 0),
    totalDistanceKm: plan.totalDistanceKm,
    totalFlightEstimateUsd: plan.totalFlightEstimateUsd,
    totalHotelEstimateUsd: plan.totalHotelEstimateUsd,
    estimatedTotalUsd: plan.estimatedTotalUsd,
    totalBudgetUsd,
    reservePercent: PERSONAL_EXPENSE_RESERVE_PERCENT,
    reserveAmountUsd: plan.reserveAmountUsd,
    usableTripBudgetUsd: plan.usableBudgetUsd,
    amountLeftUsd: plan.amountLeftUsd,
    affordabilityStatus: plan.amountLeftUsd >= 0 ? 'within-protected-budget' : 'over-protected-budget',
    pricingStatus: 'planning-estimates-provider-verification-required',
    selectionSource: plan.preferred ? 'user-preferred-stops' : 'automatic-guarded-generator',
    score: Number(plan.score.toFixed(2)),
    mapCoordinates: [
      { type: 'origin', cityId: originPublic.cityId, city: originPublic.city, latitude: originPublic.latitude, longitude: originPublic.longitude },
      ...plan.stops.map(stop => ({ type: 'stop', cityId: stop.cityId, city: stop.city, latitude: stop.latitude, longitude: stop.longitude })),
      { type: 'return', cityId: originPublic.cityId, city: originPublic.city, latitude: originPublic.latitude, longitude: originPublic.longitude }
    ],
    routeExplanation: tourExplanation(plan),
    editableActions: {
      removeStop: true,
      replaceStop: true,
      addStop: plan.stops.length < MAX_STOPS,
      reorderStops: true,
      undo: true
    }
  };
  return attachTourPresentation(tour, query);
}

async function getLegacyMultiCityTours(query = {}) {
  if (!isMultiCityRoute610BEnabled()) return buildFeatureDisabledResponse();

  const requestedOrigin = String(query.origin || query.originCode || '').trim();
  const origin = resolveOrigin(requestedOrigin);
  if (!origin) {
    throw new MultiCityValidationError('INVALID_ORIGIN', 'Please enter a supported origin city or airport.', { requestedOrigin });
  }

  const indexes = buildFoundationIndexes();
  const originRecord = resolveOriginRecord(origin, indexes);
  if (!originRecord) {
    throw new MultiCityValidationError(
      'ORIGIN_NOT_IN_CITY_FOUNDATION',
      'The origin resolves correctly but is not yet available in the grouped city foundation.',
      { requestedOrigin, resolvedCode: origin.code }
    );
  }

  const generated = generatePlanCandidates(origin, originRecord, indexes, query);
  const reserveAmountUsd = Math.round(generated.budgetUsd * PERSONAL_EXPENSE_RESERVE_PERCENT);
  const usableBudgetUsd = generated.budgetUsd - reserveAmountUsd;
  const selected = selectDifferentiatedPlans(generated.plans, usableBudgetUsd);
  const originPublic = originNode(origin, originRecord);

  if (!selected.length) {
    const cheapest = generated.plans.slice().sort((a, b) => a.estimatedTotalUsd - b.estimatedTotalUsd)[0] || null;
    return {
      ok: true,
      supported: true,
      version: ROUTE_VERSION,
      mode: 'guarded-planning-estimate',
      requested: {
        origin: originPublic,
        budgetUsd: generated.budgetUsd,
        reservePercent: PERSONAL_EXPENSE_RESERVE_PERCENT,
        reserveAmountUsd,
        usableTripBudgetUsd: usableBudgetUsd,
        totalNights: generated.totalNights,
        maxStops: generated.maxStops,
        theme: generated.theme,
        displayBudget: buildDisplayBudget({
          query,
          totalBudgetUsd: generated.budgetUsd,
          reservePercent: PERSONAL_EXPENSE_RESERVE_PERCENT,
          flightUsd: 0,
          accommodationUsd: 0,
          tripUsd: 0
        })
      },
      presentationPolicy: presentationPolicy(),
      tours: [],
      noFeasibleTour: {
        reason: 'no-route-within-protected-budget',
        cheapestPlanningEstimateUsd: cheapest ? cheapest.estimatedTotalUsd : null,
        suggestedMinimumBudgetUsd: cheapest ? Math.ceil(cheapest.estimatedTotalUsd / (1 - PERSONAL_EXPENSE_RESERVE_PERCENT) / 50) * 50 : null,
        cheapestPlanningEstimateDisplay: cheapest ? convertUsd(cheapest.estimatedTotalUsd, query.currency) : null,
        suggestedMinimumBudgetDisplay: cheapest ? convertUsd(Math.ceil(cheapest.estimatedTotalUsd / (1 - PERSONAL_EXPENSE_RESERVE_PERCENT) / 50) * 50, query.currency) : null,
        displayCurrency: buildDisplayBudget({ query, totalBudgetUsd: generated.budgetUsd, tripUsd: 0 }).currency,
        reserveProtected: true
      },
      diagnostics: {
        launchCandidateCount: generated.candidateCount,
        routePlanCount: generated.plans.length,
        targetClusters: generated.targetClusters,
        liveProviderCallsMade: 0
      }
    };
  }

  return {
    ok: true,
    supported: true,
    version: ROUTE_VERSION,
    mode: 'guarded-planning-estimate',
    requested: {
      origin: originPublic,
      budgetUsd: generated.budgetUsd,
      reservePercent: PERSONAL_EXPENSE_RESERVE_PERCENT,
      reserveAmountUsd,
      usableTripBudgetUsd: usableBudgetUsd,
      totalNights: generated.totalNights,
      maxStops: generated.maxStops,
      theme: generated.theme,
      preferredStopsAccepted: generated.preferredStops,
      displayBudget: buildDisplayBudget({
        query,
        totalBudgetUsd: generated.budgetUsd,
        reservePercent: PERSONAL_EXPENSE_RESERVE_PERCENT,
        flightUsd: 0,
        accommodationUsd: 0,
        tripUsd: 0
      })
    },
    presentationPolicy: presentationPolicy(),
    pricingPolicy: {
      flights: 'distance-band-planning-fallback',
      hotels: 'region-hotel-planning-fallback-with-agoda-coverage-evidence',
      liveProviderCallsMade: 0,
      providerVerificationRequiredBeforeBooking: true
    },
    tours: selected.map((plan, index) => publicTour(plan, index, originPublic, generated.budgetUsd, query)),
    diagnostics: {
      launchCandidateCount: generated.candidateCount,
      routePlanCount: generated.plans.length,
      feasiblePlanCount: generated.plans.filter(plan => plan.estimatedTotalUsd <= usableBudgetUsd).length,
      targetClusters: generated.targetClusters,
      returnedTourCount: selected.length,
      responseCandidateCap: 30,
      liveProviderCallsMade: 0
    }
  };
}


async function getMultiCityTours(query = {}) {
  if (!isMultiCityRoute610BEnabled()) return buildFeatureDisabledResponse();
  const adaptive = require('./budget-adaptive-routes');
  if (adaptive.enabled()) return adaptive.getBudgetAdaptiveMultiCityTours(query, getLegacyMultiCityTours);
  return getLegacyMultiCityTours(query);
}

module.exports = {
  ROUTE_VERSION,
  PERSONAL_EXPENSE_RESERVE_PERCENT,
  MultiCityValidationError,
  isMultiCityRoute610BEnabled,
  buildFeatureDisabledResponse,
  buildValidationErrorResponse,
  isMultiCityValidationError,
  getMultiCityTours,
  getLegacyMultiCityTours,
  _internal: {
    normalizeBudgetUsd,
    stakeholderReadiness669eEnabled,
    normalizeMaxStops,
    normalizeTotalNights,
    haversineKm,
    buildFoundationIndexes,
    resolveOriginRecord,
    estimateFlightUsd,
    estimateNightlyUsd,
    allocateNights,
    optimizeRouteOrder,
    routeDistanceKm,
    recommendedNightBounds,
    generatePlanCandidates,
    selectDifferentiatedPlans
  }
};
