'use strict';

const { resolveOrigin } = require('../../../data/destination-meta');
const { loadGroupedCityFoundation } = require('../../../data/grouped-city-foundation');
const groundAccess = require('../../../data/ground-access-mapping-620a.json');
const {
  buildDisplayBudget,
  attachTourPresentation,
  convertUsd,
  presentationPolicy
} = require('../pricing/budget-presentation');

const ADAPTIVE_ROUTE_VERSION = '1.1.0-gv-rank-659a-route-ambition';
const RESERVE_PERCENT = 0.10;
const MIN_STOPS = 2;
const MAX_STOPS = 3;
const MAX_RETURNED_TOURS = 3;
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

const EUROPE_COUNTRIES = new Set([
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','LV','LT','LU','MT','NL','NO','PL','PT','RO','SK','SI','ES','SE','CH','GB'
]);

function enabled() {
  return String(process.env.ENABLE_BUDGET_ADAPTIVE_ROUTES_620A || '').trim().toLowerCase() === 'true';
}

function stakeholderReadiness669eEnabled() {
  return String(process.env.ENABLE_STAKEHOLDER_READINESS_669E || '').trim().toLowerCase() === 'true';
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

function routeAmbitionRankingEnabled() {
  return String(process.env.ENABLE_ROUTE_AMBITION_RANKING_659A || 'true').trim().toLowerCase() !== 'false';
}

// 659B: stretch ambition lets Mehdi's benchmark case (Montreal, C$1500) reach
// international value tours. Default OFF; zero behavior change until enabled.
function stretchAmbition659BEnabled() {
  return String(process.env.ENABLE_STRETCH_AMBITION_659B || '').trim().toLowerCase() === 'true';
}

function regionalMixedBand() {
  return {
    id: 'regional-mixed',
    maxStops: 3,
    autoNights: 6,
    maxOriginRadiusKm: 2200,
    maxGroundLegKm: 700,
    allowFlights: true,
    maxFlightLegs: 2,
    hotelMultiplier: 0.80,
    targetUtilisation: 0.80,
    ambitionLevel: 'regional'
  };
}

function budgetBand(budgetUsd) {
  if (budgetUsd < 900) {
    return {
      id: 'low-regional',
      maxStops: 2,
      autoNights: 4,
      maxOriginRadiusKm: 850,
      maxGroundLegKm: 650,
      allowFlights: false,
      hotelMultiplier: 0.68,
      targetUtilisation: 0.82
    };
  }
  if (!routeAmbitionRankingEnabled() && budgetUsd < 2200) {
    return {
      id: 'regional-mixed',
      maxStops: 3,
      autoNights: 6,
      maxOriginRadiusKm: 2200,
      maxGroundLegKm: 700,
      allowFlights: true,
      maxFlightLegs: 2,
      hotelMultiplier: 0.80,
      targetUtilisation: 0.80,
      ambitionLevel: 'regional'
    };
  }
  if (stretchAmbition659BEnabled() && budgetUsd >= 1000 && budgetUsd < 1350) {
    return {
      id: 'stretch-value',
      maxStops: 3,
      autoNights: 6,
      maxOriginRadiusKm: 5200,
      maxGroundLegKm: 700,
      allowFlights: true,
      maxFlightLegs: 3,
      hotelMultiplier: 0.74,
      targetUtilisation: 0.85,
      ambitionLevel: 'international',
      preferredDistanceMinKm: 1500,
      preferredDistanceMaxKm: 5200,
      fallbackBandId: 'regional-mixed'
    };
  }
  if (budgetUsd < 1350) {
    return {
      id: 'regional-mixed',
      maxStops: 3,
      autoNights: 6,
      maxOriginRadiusKm: 2200,
      maxGroundLegKm: 700,
      allowFlights: true,
      maxFlightLegs: 2,
      hotelMultiplier: 0.80,
      targetUtilisation: 0.80,
      ambitionLevel: 'regional'
    };
  }
  if (budgetUsd < 2200) {
    return {
      id: 'ambitious-value',
      maxStops: 3,
      autoNights: 6,
      maxOriginRadiusKm: 6800,
      maxGroundLegKm: 700,
      allowFlights: true,
      maxFlightLegs: 4,
      hotelMultiplier: 0.78,
      targetUtilisation: 0.82,
      ambitionLevel: 'international',
      preferredDistanceMinKm: 2400,
      preferredDistanceMaxKm: 6200
    };
  }
  return {
    id: 'standard-guarded',
    useLegacy: true,
    targetUtilisation: 0.78
  };
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

function indexes() {
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
    for (const code of record.providerSupport?.flight?.airportCodes || []) byAirportCode.set(String(code).toUpperCase(), record);
    byCityCountry.set(`${normalizeCityKey(record.displayCity)}|${String(record.countryCode || '').toUpperCase()}`, record);
  }
  const groundByCity = new Map((groundAccess.records || []).map(record => [record.cityId, record]));
  const groundByPair = new Map();
  for (const record of groundAccess.records || []) {
    groundByPair.set(`${record.hubCityId}|${record.cityId}`, record);
    groundByPair.set(`${record.cityId}|${record.hubCityId}`, record);
  }
  return { foundation, records, byId, byLocationCode, byAirportCode, byCityCountry, groundByCity, groundByPair };
}

function resolveOriginRecord(origin, idx) {
  const cityMatch = idx.byCityCountry.get(`${normalizeCityKey(origin.city)}|${String(origin.countryCode || '').toUpperCase()}`) || null;
  // GV-PROD-669E: shared provider location codes must not overwrite the city the
  // traveller actually entered. YVR can support Vancouver and Whistler, but a
  // Vancouver request must keep Vancouver as the displayed origin.
  if (stakeholderReadiness669eEnabled() && cityMatch) return cityMatch;
  return idx.byLocationCode.get(String(origin.code || '').toUpperCase())
    || idx.byAirportCode.get(String(origin.airportCode || '').toUpperCase())
    || cityMatch
    || null;
}

function originPublic(origin, record) {
  return {
    cityId: record.cityId,
    city: record.displayCity || origin.city,
    country: record.country,
    countryCode: record.countryCode,
    code: record.providerSupport?.flight?.locationCode || origin.code,
    airportCode: origin.airportCode,
    latitude: record.latitude,
    longitude: record.longitude,
    isOrigin: true
  };
}

function isCoreFlightable(record, originRecord) {
  if (!record || record.cityId === originRecord.cityId) return false;
  if (!['GROUP_1', 'GROUP_2'].includes(record.group)) return false;
  if (record.providerSupport?.bothProviderReady !== true) return false;
  if (record.multiCitySuitability?.status !== 'strong') return false;
  if (String(record.multiCitySuitability?.activationTier || '').toUpperCase() !== 'CORE') return false;
  if (!Number.isFinite(Number(record.latitude)) || !Number.isFinite(Number(record.longitude))) return false;
  const originLocation = String(originRecord.providerSupport?.flight?.locationCode || '').toUpperCase();
  const destinationLocation = String(record.providerSupport?.flight?.locationCode || '').toUpperCase();
  if (originLocation && destinationLocation && originLocation === destinationLocation) return false;
  return true;
}

function isGroundDiscovery(record, idx, originRecord) {
  if (!record || record.cityId === originRecord.cityId) return false;
  const mapping = idx.groundByCity.get(record.cityId);
  if (!mapping) return false;
  if (record.group !== 'GROUP_2') return false;
  if (!record.providerSupport?.hotel?.cityId) return false;
  return Boolean(idx.byId.get(mapping.hubCityId));
}

function hotelDepthMultiplier(record) {
  const depth = record.multiCitySuitability?.hotelDepth || record.providerSupport?.hotel?.depth || 'unknown';
  return HOTEL_DEPTH_MULTIPLIER[depth] || HOTEL_DEPTH_MULTIPLIER.unknown;
}

function nightlyUsd(record, band) {
  const cluster = record.multiCitySuitability?.regionCluster;
  const base = REGION_NIGHTLY_USD[cluster] || 100;
  const groupMultiplier = record.group === 'GROUP_1' ? 1.04 : 0.94;
  return roundTo(base * hotelDepthMultiplier(record) * groupMultiplier * band.hotelMultiplier, 5);
}

function explicitGroundMapping(from, to, idx) {
  return idx.groundByPair.get(`${from.cityId}|${to.cityId}`) || null;
}

function groundFriendlyCountries(a, b) {
  const aCode = String(a?.countryCode || '').trim().toUpperCase();
  const bCode = String(b?.countryCode || '').trim().toUpperCase();
  if (!aCode || !bCode) return false;
  if (aCode === bCode) return true;
  return EUROPE_COUNTRIES.has(aCode) && EUROPE_COUNTRIES.has(bCode);
}

function estimateGroundCostUsd(distanceKm, mode) {
  if (mode === 'local-transfer') return roundTo(clamp(18 + distanceKm * 0.24, 20, 95), 5);
  if (mode === 'bus' || mode === 'bus-or-shuttle') return roundTo(clamp(18 + distanceKm * 0.10, 25, 75), 5);
  return roundTo(clamp(28 + distanceKm * 0.16, 35, 120), 5);
}

function estimateFlightUsd(distanceKm) {
  let value;
  if (distanceKm < 500) value = 58 + distanceKm * 0.105;
  else if (distanceKm < 1500) value = 78 + distanceKm * 0.085;
  else if (distanceKm < 4000) value = 110 + distanceKm * 0.072;
  else if (distanceKm < 8000) value = 155 + distanceKm * 0.064;
  else value = 220 + distanceKm * 0.058;
  return roundTo(Math.max(65, value), 5);
}

function chooseSimpleMode(from, to, band, idx) {
  const distanceKm = Math.round(haversineKm(from, to));
  const mapping = explicitGroundMapping(from, to, idx);
  if (mapping) {
    return {
      mode: 'ground-transfer',
      transportType: distanceKm <= 45 ? 'local-transfer' : 'bus-or-shuttle',
      distanceKm,
      costUsd: estimateGroundCostUsd(mapping.distanceKm, 'local-transfer'),
      mapping
    };
  }
  if (groundFriendlyCountries(from, to) && distanceKm <= band.maxGroundLegKm) {
    const transportType = distanceKm <= 260 ? 'bus-or-shuttle' : 'rail-or-bus';
    return {
      mode: 'ground',
      transportType,
      distanceKm,
      costUsd: estimateGroundCostUsd(distanceKm, transportType)
    };
  }
  if (!band.allowFlights) return null;
  return {
    mode: 'flight',
    transportType: 'flight',
    distanceKm,
    costUsd: estimateFlightUsd(distanceKm)
  };
}

function compositeFromGroundCityToNode(from, to, band, idx) {
  const mapping = idx.groundByCity.get(from.cityId);
  if (!mapping) return null;
  const hub = idx.byId.get(mapping.hubCityId);
  if (!hub) return null;
  const ground = chooseSimpleMode(from, hub, { ...band, allowFlights: false, maxGroundLegKm: 120 }, idx);
  const onward = chooseSimpleMode(hub, to, band, idx);
  if (!ground || !onward) return null;
  return {
    mode: 'composite',
    transportType: `${ground.transportType}+${onward.transportType}`,
    distanceKm: ground.distanceKm + onward.distanceKm,
    costUsd: ground.costUsd + onward.costUsd,
    segments: [
      segment(from, hub, ground, 1),
      segment(hub, to, onward, 2)
    ],
    groundAccess: mapping
  };
}

function compositeFromNodeToGroundCity(from, to, band, idx) {
  const mapping = idx.groundByCity.get(to.cityId);
  if (!mapping) return null;
  const hub = idx.byId.get(mapping.hubCityId);
  if (!hub) return null;
  const inbound = chooseSimpleMode(from, hub, band, idx);
  const ground = chooseSimpleMode(hub, to, { ...band, allowFlights: false, maxGroundLegKm: 120 }, idx);
  if (!inbound || !ground) return null;
  return {
    mode: 'composite',
    transportType: `${inbound.transportType}+${ground.transportType}`,
    distanceKm: inbound.distanceKm + ground.distanceKm,
    costUsd: inbound.costUsd + ground.costUsd,
    segments: [
      segment(from, hub, inbound, 1),
      segment(hub, to, ground, 2)
    ],
    groundAccess: mapping
  };
}

function chooseLeg(from, to, band, idx) {
  if (idx.groundByCity.has(from.cityId) && !explicitGroundMapping(from, to, idx)) {
    return compositeFromGroundCityToNode(from, to, band, idx);
  }
  if (idx.groundByCity.has(to.cityId) && !explicitGroundMapping(from, to, idx)) {
    return compositeFromNodeToGroundCity(from, to, band, idx);
  }
  return chooseSimpleMode(from, to, band, idx);
}

function publicNode(record) {
  return {
    cityId: record.cityId,
    city: record.displayCity,
    country: record.country || null,
    countryCode: record.countryCode || null,
    code: record.providerSupport?.flight?.locationCode || null,
    airportCode: (record.providerSupport?.flight?.airportCodes || [])[0] || record.providerSupport?.flight?.locationCode || null,
    latitude: record.latitude,
    longitude: record.longitude
  };
}

function segment(from, to, selected, segmentNumber) {
  return {
    segmentNumber,
    from: publicNode(from),
    to: publicNode(to),
    mode: selected.mode,
    transportType: selected.transportType,
    distanceKm: selected.distanceKm,
    estimatedTransportUsd: selected.costUsd,
    estimateSource: selected.mode === 'flight'
      ? 'origin-aware-distance-band-planning-fallback'
      : 'regional-ground-transport-planning-fallback',
    livePriceVerified: false
  };
}

function buildLegs(originRecord, orderedStops, band, idx) {
  const nodes = [originRecord, ...orderedStops, originRecord];
  const legs = [];
  let flightLegCount = 0;
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const selected = chooseLeg(from, to, band, idx);
    if (!selected) return null;
    if (selected.mode === 'flight') flightLegCount += 1;
    if (selected.mode === 'composite') flightLegCount += (selected.segments || []).filter(item => item.mode === 'flight').length;
    legs.push({
      legNumber: i + 1,
      from: publicNode(from),
      to: publicNode(to),
      mode: selected.mode,
      transportType: selected.transportType,
      distanceKm: selected.distanceKm,
      estimatedTransportUsd: selected.costUsd,
      estimatedFlightUsd: selected.mode === 'ground' || selected.mode === 'ground-transfer' ? 0 : selected.costUsd,
      estimateSource: selected.mode === 'flight'
        ? 'origin-aware-distance-band-planning-fallback'
        : selected.mode === 'composite'
          ? 'composite-ground-and-flight-planning-fallback'
          : 'regional-ground-transport-planning-fallback',
      liveFareVerified: false,
      providerVerificationRequired: true,
      ...(selected.segments ? { segments: selected.segments } : {}),
      ...(selected.groundAccess ? {
        groundAccess: {
          hubCityId: selected.groundAccess.hubCityId,
          destinationCityId: selected.groundAccess.cityId,
          transferDistanceKm: selected.groundAccess.distanceKm,
          accessTier: selected.groundAccess.accessTier,
          labelledTransferRequired: true
        }
      } : {})
    });
  }
  if (band.maxFlightLegs !== undefined && flightLegCount > band.maxFlightLegs) return null;
  return { legs, flightLegCount };
}

function nightBounds(record, band) {
  const normalMin = clamp(Math.round(finiteNumber(record.multiCitySuitability?.recommendedMinNights, 2)), 2, 12);
  const normalMax = clamp(Math.round(finiteNumber(record.multiCitySuitability?.recommendedMaxNights, Math.max(normalMin, 5))), normalMin, 14);
  if (band.id === 'low-regional') return { min: 2, max: Math.max(2, Math.min(normalMax, 3)), policy: 'budget-adaptive-short-regional' };
  if (band.id === 'regional-mixed') return { min: Math.min(normalMin, 2), max: Math.min(normalMax, 5), policy: 'budget-adaptive-regional' };
  return { min: normalMin, max: normalMax, policy: 'recommended-range' };
}

function allocateNights(records, totalNights, band) {
  const bounds = new Map(records.map(record => [record.cityId, nightBounds(record, band)]));
  const minTotal = records.reduce((sum, record) => sum + bounds.get(record.cityId).min, 0);
  const maxTotal = records.reduce((sum, record) => sum + bounds.get(record.cityId).max, 0);
  if (totalNights < minTotal || totalNights > maxTotal) return null;
  const allocation = new Map(records.map(record => [record.cityId, bounds.get(record.cityId).min]));
  let remaining = totalNights - minTotal;
  while (remaining > 0) {
    const next = records
      .filter(record => allocation.get(record.cityId) < bounds.get(record.cityId).max)
      .sort((a, b) => {
        const aRemaining = bounds.get(a.cityId).max - allocation.get(a.cityId);
        const bRemaining = bounds.get(b.cityId).max - allocation.get(b.cityId);
        return bRemaining - aRemaining || a.cityId.localeCompare(b.cityId);
      })[0];
    if (!next) return null;
    allocation.set(next.cityId, allocation.get(next.cityId) + 1);
    remaining -= 1;
  }
  return { allocation, bounds };
}

function permutations(records) {
  if (records.length <= 1) return [records.slice()];
  const out = [];
  function visit(prefix, remaining) {
    if (!remaining.length) {
      out.push(prefix);
      return;
    }
    for (let i = 0; i < remaining.length; i += 1) {
      visit(prefix.concat(remaining[i]), remaining.slice(0, i).concat(remaining.slice(i + 1)));
    }
  }
  visit([], records.slice());
  return out;
}

function compactStop(record, nights, bounds, band, idx) {
  const nightly = nightlyUsd(record, band);
  const mapping = idx.groundByCity.get(record.cityId);
  return {
    cityId: record.cityId,
    city: record.displayCity,
    country: record.country,
    countryCode: record.countryCode,
    code: record.providerSupport?.flight?.locationCode || mapping?.locationCode || null,
    airportCodes: record.providerSupport?.flight?.airportCodes || [],
    group: record.group,
    groupSubtype: record.groupSubtype,
    regionCluster: record.multiCitySuitability?.regionCluster || null,
    latitude: record.latitude,
    longitude: record.longitude,
    nights,
    recommendedMinNights: record.multiCitySuitability?.recommendedMinNights || null,
    recommendedMaxNights: record.multiCitySuitability?.recommendedMaxNights || null,
    appliedNightMinimum: bounds.min,
    appliedNightMaximum: bounds.max,
    durationPolicy: bounds.policy,
    hotel: {
      provider: 'Agoda',
      providerCityId: record.providerSupport?.hotel?.cityId || null,
      hotelCoverageCount: record.providerSupport?.hotel?.hotelCount || 0,
      coverageDepth: record.providerSupport?.hotel?.depth || null,
      estimatedNightlyUsd: nightly,
      estimatedStayUsd: nightly * nights,
      lodgingStyle: band.id === 'low-regional' ? 'budget-value' : 'value',
      estimateSource: 'budget-adaptive-region-hotel-planning-fallback',
      livePriceVerified: false
    },
    ...(mapping ? {
      groundAccess: {
        hubCityId: mapping.hubCityId,
        airportCode: mapping.airportCode,
        transferDistanceKm: mapping.distanceKm,
        accessTier: mapping.accessTier,
        directFlightDestination: false,
        labelledTransferRequired: true
      }
    } : {}),
    replaceable: true,
    removable: true
  };
}

function routeDistance(legs) {
  return legs.reduce((sum, leg) => sum + finiteNumber(leg.distanceKm, 0), 0);
}

function transportCost(legs) {
  return legs.reduce((sum, leg) => sum + finiteNumber(leg.estimatedTransportUsd, 0), 0);
}

function countryMix(records) {
  return new Set(records.map(record => record.countryCode)).size;
}

function outsideOriginCountryCount(originRecord, records) {
  const originCountry = String(originRecord?.countryCode || '').toUpperCase();
  if (!originCountry) return 0;
  return records.filter(record => String(record.countryCode || '').toUpperCase() !== originCountry).length;
}

function averageOriginDistance(originRecord, records) {
  if (!records.length) return 0;
  return records.reduce((sum, record) => sum + haversineKm(originRecord, record), 0) / records.length;
}

function ambitionDistanceScore(distanceKm, band) {
  if (band.ambitionLevel !== 'international') return 0;
  const min = finiteNumber(band.preferredDistanceMinKm, 2400);
  const max = finiteNumber(band.preferredDistanceMaxKm, 6200);
  if (distanceKm < min) return clamp((distanceKm / min) * 55, 0, 55);
  if (distanceKm <= max) return 100;
  return clamp(100 - ((distanceKm - max) / 2200) * 55, 25, 100);
}

function recordAmbitionScore(originRecord, record, band) {
  const distance = haversineKm(originRecord, record);
  const outside = String(record.countryCode || '').toUpperCase() !== String(originRecord.countryCode || '').toUpperCase();
  const groupAnchor = record.group === 'GROUP_1' ? 16 : 8;
  const readiness = finiteNumber(record.multiCitySuitability?.readinessScore, 50) * 0.18;
  const hotel = record.providerSupport?.bothProviderReady ? 10 : 0;
  if (band.ambitionLevel !== 'international') {
    return readiness + hotel + groupAnchor - distance / 900;
  }
  return ambitionDistanceScore(distance, band) + (outside ? 55 : -45) + groupAnchor + readiness + hotel;
}

function shortlistByBand(originRecord, eligible, band, limit) {
  const rows = eligible
    .map(record => ({ record, distance: haversineKm(originRecord, record), ambition: recordAmbitionScore(originRecord, record, band) }))
    .filter(item => item.distance <= band.maxOriginRadiusKm)
    .sort((a, b) => {
      if (band.ambitionLevel === 'international') return b.ambition - a.ambition || a.distance - b.distance || a.record.cityId.localeCompare(b.record.cityId);
      return a.distance - b.distance || finiteNumber(b.record.multiCitySuitability?.readinessScore, 0) - finiteNumber(a.record.multiCitySuitability?.readinessScore, 0) || a.record.cityId.localeCompare(b.record.cityId);
    });
  return rows.slice(0, limit).map(item => item.record);
}

function themeDiversity(records) {
  if (records.length < 2) return 0;
  const keys = ['nature','food','culture','beach','nightlife','relaxation'];
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      total += keys.reduce((sum, key) => sum + Math.abs(finiteNumber(records[i].cityIntelligence?.themeScores?.[key],0) - finiteNumber(records[j].cityIntelligence?.themeScores?.[key],0)), 0);
      pairs += 1;
    }
  }
  return pairs ? total / pairs : 0;
}

function scorePlan(plan, role, band) {
  const utilisation = plan.estimatedTotalUsd / Math.max(1, plan.usableBudgetUsd);
  const budgetFit = utilisation <= 1 ? clamp(100 - Math.abs(band.targetUtilisation - utilisation) * 130, 0, 100) : 0;
  const groundShare = plan.legs.filter(leg => leg.mode !== 'flight').length / Math.max(1, plan.legs.length) * 100;
  const readiness = plan.records.reduce((sum, record) => sum + finiteNumber(record.multiCitySuitability?.readinessScore, 50), 0) / plan.records.length;
  const mix = plan.records.some(record => record.group === 'GROUP_1') && plan.records.some(record => record.group === 'GROUP_2') ? 100 : 55;
  const diversity = clamp(themeDiversity(plan.records) * 5, 0, 100);
  const international = countryMix(plan.records) > 1 ? 100 : 65;
  const avgDistance = averageOriginDistance(plan.originRecord, plan.records);
  const ambition = ambitionDistanceScore(avgDistance, band);
  const outsideShare = outsideOriginCountryCount(plan.originRecord, plan.records) / Math.max(1, plan.records.length) * 100;
  const localPenalty = band.ambitionLevel === 'international' && outsideShare === 0 ? 45 : 0;
  if (role === 'lowest-cost') return budgetFit * 0.38 + groundShare * 0.22 + readiness * 0.18 + mix * 0.10 + ambition * 0.07 + outsideShare * 0.05 - localPenalty;
  if (role === 'most-memorable') return diversity * 0.22 + international * 0.17 + readiness * 0.16 + budgetFit * 0.15 + mix * 0.08 + ambition * 0.14 + outsideShare * 0.08 - localPenalty;
  return budgetFit * 0.25 + readiness * 0.16 + mix * 0.14 + groundShare * 0.08 + diversity * 0.08 + international * 0.08 + ambition * 0.13 + outsideShare * 0.08 - localPenalty;
}

function buildPlan(originRecord, records, totalNights, budgetUsd, band, idx) {
  const nightPlan = allocateNights(records, totalNights, band);
  if (!nightPlan) return null;
  let best = null;
  for (const ordered of permutations(records)) {
    const built = buildLegs(originRecord, ordered, band, idx);
    if (!built) continue;
    const stops = ordered.map(record => compactStop(record, nightPlan.allocation.get(record.cityId), nightPlan.bounds.get(record.cityId), band, idx));
    const transportUsd = transportCost(built.legs);
    const hotelUsd = stops.reduce((sum, stop) => sum + stop.hotel.estimatedStayUsd, 0);
    const estimatedTotalUsd = transportUsd + hotelUsd;
    const reserveAmountUsd = Math.round(budgetUsd * RESERVE_PERCENT);
    const usableBudgetUsd = budgetUsd - reserveAmountUsd;
    const candidate = {
      originRecord,
      records: ordered,
      stops,
      legs: built.legs,
      flightLegCount: built.flightLegCount,
      totalDistanceKm: routeDistance(built.legs),
      totalTransportEstimateUsd: transportUsd,
      totalFlightEstimateUsd: transportUsd,
      totalHotelEstimateUsd: hotelUsd,
      estimatedTotalUsd,
      reserveAmountUsd,
      usableBudgetUsd,
      amountLeftUsd: usableBudgetUsd - estimatedTotalUsd,
      withinBudget: estimatedTotalUsd <= usableBudgetUsd,
      band
    };
    if (!best || candidate.estimatedTotalUsd < best.estimatedTotalUsd || (candidate.estimatedTotalUsd === best.estimatedTotalUsd && candidate.totalDistanceKm < best.totalDistanceKm)) best = candidate;
  }
  return best;
}

function signature(records) {
  return records.map(record => record.cityId).slice().sort().join('|');
}

function pairCandidates(originRecord, eligible, band) {
  const nearby = shortlistByBand(originRecord, eligible, band, band.ambitionLevel === 'international' ? 42 : 24);
  const pairs = [];
  for (let i = 0; i < nearby.length; i += 1) {
    for (let j = i + 1; j < nearby.length; j += 1) {
      const pair = [nearby[i], nearby[j]];
      const hasMix = pair.some(record => record.group === 'GROUP_1') && pair.some(record => record.group === 'GROUP_2');
      if (!hasMix) continue;
      if (band.id === 'low-regional' && pair[0].countryCode !== originRecord.countryCode && pair[1].countryCode !== originRecord.countryCode) continue;
      if (band.ambitionLevel === 'international' && outsideOriginCountryCount(originRecord, pair) === 0) continue;
      pairs.push(pair);
    }
  }
  return pairs.slice(0, 160);
}

function tripleCandidates(originRecord, eligible, band) {
  if (band.maxStops < 3) return [];
  const nearby = shortlistByBand(originRecord, eligible, band, band.ambitionLevel === 'international' ? 32 : 18);
  const triples = [];
  for (let i = 0; i < nearby.length; i += 1) {
    for (let j = i + 1; j < nearby.length; j += 1) {
      for (let k = j + 1; k < nearby.length; k += 1) {
        const records = [nearby[i], nearby[j], nearby[k]];
        if (!records.some(record => record.group === 'GROUP_1') || !records.some(record => record.group === 'GROUP_2')) continue;
        if (band.ambitionLevel !== 'international' && new Set(records.map(record => record.countryCode)).size > 2) continue;
        if (band.ambitionLevel === 'international' && outsideOriginCountryCount(originRecord, records) === 0) continue;
        triples.push(records);
      }
    }
  }
  return triples.slice(0, 100);
}

function groundAccessPairs(originRecord, idx, band) {
  const out = [];
  for (const mapping of groundAccess.records || []) {
    const hub = idx.byId.get(mapping.hubCityId);
    const discovery = idx.byId.get(mapping.cityId);
    if (!hub || !discovery) continue;
    if (hub.cityId === originRecord.cityId || discovery.cityId === originRecord.cityId) continue;
    if (haversineKm(originRecord, hub) > band.maxOriginRadiusKm) continue;
    out.push([hub, discovery]);
  }
  return out;
}

function adaptiveDuration(query, band) {
  const explicit = query.totalNights !== undefined && String(query.totalNights).trim() !== '' && String(query.adaptiveDuration || '').toLowerCase() !== 'true';
  if (explicit) {
    const parsed = Number(query.totalNights);
    if (Number.isInteger(parsed) && parsed >= 4 && parsed <= 21) return parsed;
  }
  return band.autoNights;
}

function maxStops(query, band) {
  const parsed = Number(query.maxStops ?? query.stops);
  if (Number.isInteger(parsed)) return clamp(parsed, MIN_STOPS, band.maxStops);
  return band.maxStops;
}

function explanation(plan) {
  const groundLegs = plan.legs.filter(leg => leg.mode !== 'flight').length;
  const names = plan.records.map(record => record.displayCity).join(' and ');
  const reasons = [
    `${names} were selected as a budget-adaptive regional combination.`,
    `${groundLegs} of ${plan.legs.length} route legs use rail, bus, shuttle, or another labelled ground connection instead of forcing a flight.`
  ];
  if (plan.stops.some(stop => stop.groundAccess)) reasons.push('A ground-access destination is linked through its approved hub and is never presented as a direct-flight city.');
  reasons.push('The full 10% personal-expense reserve remains protected; transport and hotel amounts are planning estimates until live provider verification.');
  return reasons;
}

function publicTour(plan, role, index, origin, query) {
  const tour = {
    tourId: `gv620a-${role}-${index + 1}-${plan.records.map(record => record.cityId).join('-')}`,
    tourRole: role,
    tourRoleLabel: ROLE_LABELS[role],
    origin,
    stops: plan.stops,
    legs: plan.legs,
    totalNights: plan.stops.reduce((sum, stop) => sum + stop.nights, 0),
    totalDistanceKm: plan.totalDistanceKm,
    totalTransportEstimateUsd: plan.totalTransportEstimateUsd,
    totalFlightEstimateUsd: plan.totalFlightEstimateUsd,
    totalHotelEstimateUsd: plan.totalHotelEstimateUsd,
    estimatedTotalUsd: plan.estimatedTotalUsd,
    totalBudgetUsd: normalizeBudgetUsd(query),
    reservePercent: RESERVE_PERCENT,
    reserveAmountUsd: plan.reserveAmountUsd,
    usableTripBudgetUsd: plan.usableBudgetUsd,
    amountLeftUsd: plan.amountLeftUsd,
    affordabilityStatus: plan.withinBudget ? 'within-protected-budget' : 'over-protected-budget',
    pricingStatus: 'budget-adaptive-planning-estimates-provider-verification-required',
    selectionSource: 'automatic-budget-adaptive-regional-generator',
    budgetAdaptivePolicy: {
      version: ADAPTIVE_ROUTE_VERSION,
      band: plan.band.id,
      transportPriority: plan.band.ambitionLevel === 'international' ? 'international-value-first-with-budget-guardrail' : (plan.band.allowFlights ? 'ground-first-with-limited-flights' : 'ground-only'),
      ambitionLevel: plan.band.ambitionLevel || 'regional',
      shortRegionalNightOverride: plan.band.id === 'low-regional'
    },
    mapCoordinates: [
      { type: 'origin', cityId: origin.cityId, city: origin.city, latitude: origin.latitude, longitude: origin.longitude },
      ...plan.stops.map(stop => ({ type: 'stop', cityId: stop.cityId, city: stop.city, latitude: stop.latitude, longitude: stop.longitude })),
      { type: 'return', cityId: origin.cityId, city: origin.city, latitude: origin.latitude, longitude: origin.longitude }
    ],
    routeExplanation: explanation(plan),
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

function selectPlans(plans) {
  const feasible = plans.filter(plan => plan.withinBudget);
  const selected = [];
  const used = new Set();
  for (const role of ROLE_ORDER) {
    const ranked = feasible
      .map(plan => ({ plan, score: scorePlan(plan, role, plan.band) }))
      .sort((a, b) => b.score - a.score || a.plan.estimatedTotalUsd - b.plan.estimatedTotalUsd || signature(a.plan.records).localeCompare(signature(b.plan.records)));
    const choice = ranked.find(item => !used.has(signature(item.plan.records)));
    if (!choice) continue;
    selected.push({ ...choice.plan, score: choice.score, role });
    used.add(signature(choice.plan.records));
  }
  return selected.slice(0, MAX_RETURNED_TOURS);
}

async function getBudgetAdaptiveMultiCityTours(query = {}, legacyGenerator) {
  const budgetUsd = normalizeBudgetUsd(query);
  let band = budgetBand(budgetUsd);
  const hasPreferredStops = (Array.isArray(query.preferredStops) && query.preferredStops.length > 0) || String(query.preferredStops || '').trim() !== '';
  if (hasPreferredStops) {
    const legacy = await legacyGenerator(query);
    return {
      ...legacy,
      adaptiveRouting: {
        enabled: true,
        version: ADAPTIVE_ROUTE_VERSION,
        band: band.id,
        decision: 'legacy-preferred-stop-contract-preserved'
      }
    };
  }
  if (band.useLegacy) {
    const legacy = await legacyGenerator(query);
    return {
      ...legacy,
      adaptiveRouting: {
        enabled: true,
        version: ADAPTIVE_ROUTE_VERSION,
        band: band.id,
        decision: 'legacy-guarded-engine-preserved-for-standard-budget'
      }
    };
  }

  const requestedOrigin = String(query.origin || query.originCode || '').trim();
  const idx = indexes();
  let origin = resolveOrigin(requestedOrigin);
  if (!origin) {
    const upper = requestedOrigin.toUpperCase();
    const record = idx.byLocationCode.get(upper)
      || idx.byAirportCode.get(upper)
      || idx.records.find(item => normalizeCityKey(item.displayCity) === normalizeCityKey(requestedOrigin));
    if (record) {
      origin = {
        city: record.displayCity,
        code: record.providerSupport?.flight?.locationCode || upper,
        airportCode: (record.providerSupport?.flight?.airportCodes || [])[0] || record.providerSupport?.flight?.locationCode || upper,
        countryCode: record.countryCode,
        requestedOrigin,
        normalizedInput: requestedOrigin.toLowerCase(),
        originResolutionSource: 'grouped-city-foundation-620a'
      };
    }
  }
  if (!origin) {
    const error = new Error('Please enter a supported origin city or airport.');
    error.code = 'INVALID_ORIGIN';
    error.statusCode = 400;
    throw error;
  }

  const originRecord = resolveOriginRecord(origin, idx);
  if (!originRecord) {
    const error = new Error('The origin resolves correctly but is not available in the grouped city foundation.');
    error.code = 'ORIGIN_NOT_IN_CITY_FOUNDATION';
    error.statusCode = 400;
    throw error;
  }

  // 659B: stretch-value budgets try an international plan first; if none fits the
  // protected budget, regenerate with the regional band so output never regresses.
  let stopCap; let totalNights; let core; let ground; let dedupedSets; let plans = []; let selected = [];
  const bandsToTry = [band];
  if (band.fallbackBandId === 'regional-mixed') bandsToTry.push(regionalMixedBand());
  for (const candidateBand of bandsToTry) {
    band = candidateBand;
    stopCap = maxStops(query, band);
    totalNights = adaptiveDuration(query, band);
    core = idx.records.filter(record => isCoreFlightable(record, originRecord));
    ground = idx.records.filter(record => isGroundDiscovery(record, idx, originRecord));
    const sets = [
      ...pairCandidates(originRecord, core, band),
      ...groundAccessPairs(originRecord, idx, band)
    ];
    if (stopCap >= 3) sets.push(...tripleCandidates(originRecord, core, band));

    dedupedSets = new Map();
    for (const records of sets) {
      if (records.length > stopCap) continue;
      const key = signature(records);
      if (!dedupedSets.has(key)) dedupedSets.set(key, records);
    }

    plans = [];
    for (const records of dedupedSets.values()) {
      const plan = buildPlan(originRecord, records, totalNights, budgetUsd, band, idx);
      if (plan) plans.push(plan);
    }
    selected = selectPlans(plans);
    if (selected.length) break;
  }
  const originOut = originPublic(origin, originRecord);
  const reserveAmountUsd = Math.round(budgetUsd * RESERVE_PERCENT);
  const usableBudgetUsd = budgetUsd - reserveAmountUsd;

  if (!selected.length) {
    const cheapest = plans.slice().sort((a, b) => a.estimatedTotalUsd - b.estimatedTotalUsd)[0] || null;
    return {
      ok: true,
      supported: true,
      version: ADAPTIVE_ROUTE_VERSION,
      mode: 'budget-adaptive-regional-planning-estimate',
      requested: {
        origin: originOut,
        budgetUsd,
        reservePercent: RESERVE_PERCENT,
        reserveAmountUsd,
        usableTripBudgetUsd: usableBudgetUsd,
        totalNights,
        maxStops: stopCap,
        displayBudget: buildDisplayBudget({ query, totalBudgetUsd: budgetUsd, reservePercent: RESERVE_PERCENT, tripUsd: 0 })
      },
      presentationPolicy: presentationPolicy(),
      tours: [],
      noFeasibleTour: {
        reason: 'no-budget-adaptive-route-within-protected-budget',
        cheapestPlanningEstimateUsd: cheapest?.estimatedTotalUsd ?? null,
        suggestedMinimumBudgetUsd: cheapest ? Math.ceil(cheapest.estimatedTotalUsd / 0.9 / 25) * 25 : null,
        cheapestPlanningEstimateDisplay: cheapest ? convertUsd(cheapest.estimatedTotalUsd, query.currency) : null,
        suggestedMinimumBudgetDisplay: cheapest ? convertUsd(Math.ceil(cheapest.estimatedTotalUsd / 0.9 / 25) * 25, query.currency) : null,
        reserveProtected: true
      },
      adaptiveRouting: {
        enabled: true,
        version: ADAPTIVE_ROUTE_VERSION,
        band: band.id,
        ambitionLevel: band.ambitionLevel || 'regional',
        autoDurationApplied: String(query.adaptiveDuration || '').toLowerCase() === 'true' || query.totalNights === undefined,
        approvedGroundAccessRecordCount: groundAccess.summary?.approvedRecordCount || 0
      },
      diagnostics: {
        eligibleCoreCount: core.length,
        eligibleGroundDiscoveryCount: ground.length,
        routeSetCount: dedupedSets.size,
        routePlanCount: plans.length,
        feasiblePlanCount: 0,
        liveProviderCallsMade: 0
      }
    };
  }

  return {
    ok: true,
    supported: true,
    version: ADAPTIVE_ROUTE_VERSION,
    mode: 'budget-adaptive-regional-planning-estimate',
    requested: {
      origin: originOut,
      budgetUsd,
      reservePercent: RESERVE_PERCENT,
      reserveAmountUsd,
      usableTripBudgetUsd: usableBudgetUsd,
      totalNights,
      maxStops: stopCap,
      displayBudget: buildDisplayBudget({ query, totalBudgetUsd: budgetUsd, reservePercent: RESERVE_PERCENT, tripUsd: 0 })
    },
    presentationPolicy: presentationPolicy(),
    pricingPolicy: {
      transport: 'ground-first-origin-aware-distance-planning-fallback',
      hotels: 'budget-adaptive-region-hotel-planning-fallback',
      liveProviderCallsMade: 0,
      providerVerificationRequiredBeforeBooking: true
    },
    adaptiveRouting: {
      enabled: true,
      version: ADAPTIVE_ROUTE_VERSION,
      band: band.id,
      ambitionLevel: band.ambitionLevel || 'regional',
      autoDurationApplied: String(query.adaptiveDuration || '').toLowerCase() === 'true' || query.totalNights === undefined,
      approvedGroundAccessRecordCount: groundAccess.summary?.approvedRecordCount || 0
    },
    tours: selected.map((plan, index) => ({ ...publicTour(plan, plan.role, index, originOut, query), score: Number(plan.score.toFixed(2)) })),
    diagnostics: {
      eligibleCoreCount: core.length,
      eligibleGroundDiscoveryCount: ground.length,
      routeSetCount: dedupedSets.size,
      routePlanCount: plans.length,
      feasiblePlanCount: plans.filter(plan => plan.withinBudget).length,
      returnedTourCount: selected.length,
      liveProviderCallsMade: 0
    }
  };
}

module.exports = {
  ADAPTIVE_ROUTE_VERSION,
  enabled,
  routeAmbitionRankingEnabled,
  getBudgetAdaptiveMultiCityTours,
  _internal: {
    normalizeBudgetUsd,
    budgetBand,
    routeAmbitionRankingEnabled,
    stakeholderReadiness669eEnabled,
    haversineKm,
    indexes,
    resolveOriginRecord,
    groundFriendlyCountries,
    publicNode,
    nightlyUsd,
    chooseLeg,
    allocateNights,
    pairCandidates,
    tripleCandidates,
    groundAccessPairs,
    buildPlan,
    selectPlans
  }
};
