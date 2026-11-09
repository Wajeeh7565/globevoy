'use strict';
// GV-TOUR-653A: estimated generated-tour fallback for searchable origins that
// are flightable in the global catalogue but not yet in the 500-city foundation.
// It preserves budget guardrails and labels evidence honestly as estimated.

const globalCatalogue = require('../../../data/global-destination-catalogue.json');
const { loadGroupedCityFoundation } = require('../../../data/grouped-city-foundation');
const { attachTourPresentation, currencyToUsdRate } = require('../pricing/budget-presentation');
const { guardEnabled, maxStopsForTrip } = require('../routing/route-feasibility');
const { GLOBAL_ROUTE_GRAPH_VERSION, globalRouteGraphEnabled, generateGlobalRouteCandidates } = require('../routing/global-route-graph');
const { enabled: verifiedActivationEnabled, liveRecommendationEligible } = require('../../cities/registry/verified-city-activation');

const GLOBAL_FALLBACK_VERSION = '2.0.1-gv-prod-669b-active-destination-origin-repair';
const RESERVE_PERCENT = 0.10;
const MIN_STOPS = 1;
const PREFERRED_MIN_STOPS = 2;
const MAX_STOPS = 3;

const REGION_NIGHTLY_USD = {
  'central-europe': 88,
  'east-asia': 82,
  'eastern-europe': 70,
  'mexico-central-america-caribbean': 76,
  'middle-east': 86,
  'north-africa': 58,
  'north-america-east': 118,
  'north-america-west': 124,
  'northern-europe': 108,
  'oceania': 118,
  'south-america': 66,
  'south-asia': 48,
  'southeast-asia': 52,
  'southern-europe': 84,
  'sub-saharan-africa': 72,
  'western-europe': 98
};


const COUNTRY_PREFERRED_CITY_IDS = {
  AF: ['delhi-in', 'dubai-ae', 'doha-qa', 'muscat-om', 'istanbul-tr'],
  PK: ['dubai-ae', 'muscat-om', 'doha-qa', 'istanbul-tr', 'delhi-in'],
  IR: ['istanbul-tr', 'dubai-ae', 'doha-qa', 'muscat-om', 'batumi-ge'],
  KR: ['tokyo-jp', 'osaka-jp', 'taipei-tw', 'fukuoka-jp', 'bangkok-th'],
  JP: ['seoul-kr', 'taipei-tw', 'osaka-jp', 'fukuoka-jp', 'bangkok-th'],
  IN: ['dubai-ae', 'muscat-om', 'doha-qa', 'bangkok-th', 'istanbul-tr'],
  BD: ['delhi-in', 'bangkok-th', 'kuala-lumpur-my', 'dubai-ae'],
  AE: ['muscat-om', 'doha-qa', 'istanbul-tr', 'delhi-in']
};

const COUNTRY_CLUSTER_HINTS = {
  AF: ['south-asia', 'middle-east', 'central-europe', 'southeast-asia'],
  PK: ['south-asia', 'middle-east', 'southeast-asia', 'central-europe'],
  IN: ['south-asia', 'middle-east', 'southeast-asia'],
  BD: ['south-asia', 'southeast-asia', 'middle-east'],
  LK: ['south-asia', 'southeast-asia', 'middle-east'],
  NP: ['south-asia', 'southeast-asia'],
  IR: ['middle-east', 'eastern-europe', 'southern-europe', 'central-europe'],
  KR: ['east-asia', 'southeast-asia'],
  JP: ['east-asia', 'southeast-asia'],
  CN: ['east-asia', 'southeast-asia'],
  TW: ['east-asia', 'southeast-asia'],
  AE: ['middle-east', 'south-asia', 'eastern-europe'],
  SA: ['middle-east', 'north-africa', 'eastern-europe'],
  QA: ['middle-east', 'south-asia', 'north-africa'],
  TR: ['eastern-europe', 'middle-east', 'southern-europe'],
  EG: ['north-africa', 'middle-east', 'southern-europe'],
  MA: ['north-africa', 'western-europe', 'southern-europe'],
  ZA: ['sub-saharan-africa', 'middle-east', 'western-europe']
};

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundTo(value, step = 1) {
  return Math.round(value / step) * step;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function normalizeKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function mvpValidationRepairs669bEnabled() {
  const explicit = String(process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B || '').trim().toLowerCase();
  return explicit ? explicit === 'true' : true;
}

function inputTokens(value) {
  const raw = String(value || '');
  const normalized = normalizeKey(raw);
  const parenCodes = [...raw.matchAll(/\(([A-Za-z]{3})\)/g)].map(m => m[1].toUpperCase());
  if (mvpValidationRepairs669bEnabled()) {
    const exact = /^\s*([A-Za-z]{3})\s*$/.exec(raw);
    const explicitUpper = [...raw.matchAll(/(?:^|[\s,\/-])([A-Z]{3})(?=$|[\s,\)/-])/g)].map(m => m[1].toUpperCase());
    return { raw, normalized, codes: [...new Set([...parenCodes, ...(exact ? [exact[1].toUpperCase()] : []), ...explicitUpper])] };
  }
  const bareCodes = normalized.split(' ').filter(part => /^[a-z]{3}$/i.test(part)).map(part => part.toUpperCase());
  return { raw, normalized, codes: [...new Set([...parenCodes, ...bareCodes])] };
}

let globalIndexCache = null;
function globalIndex() {
  if (globalIndexCache) return globalIndexCache;
  const destinations = Array.isArray(globalCatalogue.destinations) ? globalCatalogue.destinations : [];
  const byCode = new Map();
  const byName = new Map();
  const byNameCountry = new Map();
  for (const record of destinations) {
    const airports = Array.isArray(record.flightableAirportCodes) ? record.flightableAirportCodes.filter(Boolean) : [];
    if (!record || !record.canonicalCityName || !airports.length) continue;
    const cityCode = String(record.cityCode || record.providerMetroCode || airports[0] || '').toUpperCase();
    const primaryAirportCode = String(record.primaryAirportCode || airports[0] || cityCode || '').toUpperCase();
    const aliases = [cityCode, primaryAirportCode, record.providerMetroCode, ...(record.physicalAirportCodes || []), ...(record.flightableAirportCodes || [])]
      .filter(Boolean)
      .map(value => String(value).toUpperCase());
    for (const code of aliases) byCode.set(code, record);
    const name = normalizeKey(record.canonicalCityName);
    if (name && !byName.has(name)) byName.set(name, record);
    const countryName = normalizeKey(record.countryName);
    const countryCode = String(record.countryCode || '').toUpperCase();
    if (name && countryCode) byNameCountry.set(`${name}|${countryCode}`, record);
    if (name && countryName) byNameCountry.set(`${name}|${countryName}`, record);
  }
  globalIndexCache = { destinations, byCode, byName, byNameCountry };
  return globalIndexCache;
}

function resolveGlobalOrigin(input) {
  const { normalized, codes } = inputTokens(input);
  if (!normalized) return null;
  const idx = globalIndex();
  for (const code of codes) {
    const match = idx.byCode.get(code);
    if (match) return originFromGlobal(match, input);
  }
  const exact = idx.byName.get(normalized);
  if (exact) return originFromGlobal(exact, input);
  const parts = normalized.split(' ');
  if (parts.length > 1) {
    const possibleCountry = parts[parts.length - 1].toUpperCase();
    const cityPart = parts.slice(0, -1).join(' ');
    const byCountry = idx.byNameCountry.get(`${cityPart}|${possibleCountry}`) || idx.byNameCountry.get(`${cityPart}|${parts[parts.length - 1]}`);
    if (byCountry) return originFromGlobal(byCountry, input);
  }
  const prefix = idx.destinations
    .filter(record => normalizeKey(record.canonicalCityName).startsWith(normalized) && Array.isArray(record.flightableAirportCodes) && record.flightableAirportCodes.length)
    .sort((a, b) => String(a.canonicalCityName).localeCompare(String(b.canonicalCityName)))[0];
  return prefix ? originFromGlobal(prefix, input) : null;
}

function preferredPrimaryAirport(record, airports) {
  const city = String(record?.canonicalCityName || record?.displayCity || '').trim().toLowerCase();
  const cityCode = String(record?.cityCode || record?.providerMetroCode || '').trim().toUpperCase();
  const normalizedAirports = (Array.isArray(airports) ? airports : []).map(code => String(code || '').toUpperCase()).filter(Boolean);
  if ((city === 'montreal' || city === 'montréal' || cityCode === 'YMQ') && normalizedAirports.includes('YUL')) return 'YUL';
  if (guardEnabled() && (city === 'toronto' || cityCode === 'YTO') && normalizedAirports.includes('YYZ')) return 'YYZ';
  if (guardEnabled() && (city === 'tehran' || cityCode === 'THR') && normalizedAirports.includes('IKA')) return 'IKA';
  if ((city === 'new york' || city === 'new york city' || cityCode === 'NYC') && normalizedAirports.includes('JFK')) return 'JFK';
  if ((city === 'london' || cityCode === 'LON') && normalizedAirports.includes('LHR')) return 'LHR';
  return String(record.primaryAirportCode || normalizedAirports[0] || record.cityCode || '').toUpperCase();
}

function originFromGlobal(record, requestedInput) {
  const airports = Array.isArray(record.flightableAirportCodes) ? record.flightableAirportCodes.filter(Boolean) : [];
  const primaryAirportCode = preferredPrimaryAirport(record, airports);
  const publicCode = primaryAirportCode || String(record.cityCode || record.providerMetroCode || '').toUpperCase();
  return {
    cityId: `global-origin-${String(record.cityCode || primaryAirportCode || record.canonicalCityName).toLowerCase()}`,
    city: record.canonicalCityName,
    displayCity: record.canonicalCityName,
    country: record.countryName,
    countryCode: record.countryCode,
    code: publicCode,
    airportCode: primaryAirportCode,
    airportCodes: airports,
    latitude: finiteNumber(record.latitude),
    longitude: finiteNumber(record.longitude),
    sourceConfidence: record.sourceConfidence || null,
    globalEligibilityClass: record.class || record.eligibilityStatus || null,
    providerSupportStatus: record.providerSupportStatus || null,
    requestedOrigin: String(requestedInput || '').trim(),
    isGlobalOriginFallback: true
  };
}

function foundationRecords() {
  const foundation = loadGroupedCityFoundation();
  return Array.isArray(foundation.records) ? foundation.records : [];
}

function foundationById() {
  return new Map(foundationRecords().map(record => [record.cityId, record]));
}

function regionClustersForOrigin(origin) {
  const hinted = COUNTRY_CLUSTER_HINTS[String(origin.countryCode || '').toUpperCase()];
  if (hinted && hinted.length) return hinted;
  return [];
}

function candidateEligible(record, origin) {
  if (!record || record.initialLaunchSet !== true) return false;
  if (record.providerSupport?.bothProviderReady !== true) return false;
  if (record.multiCitySuitability?.status !== 'strong') return false;
  if (String(record.multiCitySuitability?.activationTier || '').toUpperCase() !== 'CORE') return false;
  if (!['GROUP_1', 'GROUP_2'].includes(record.group)) return false;
  if (!Number.isFinite(Number(record.latitude)) || !Number.isFinite(Number(record.longitude))) return false;
  const code = String(record.providerSupport?.flight?.locationCode || '').toUpperCase();
  const airportCodes = (record.providerSupport?.flight?.airportCodes || []).map(c => String(c).toUpperCase());
  const originCodes = [origin.code, origin.airportCode, ...(origin.airportCodes || [])].map(c => String(c || '').toUpperCase()).filter(Boolean);
  if (originCodes.includes(code) || airportCodes.some(code => originCodes.includes(code))) return false;
  if (record.cityId === origin.cityId) return false;
  if (mvpValidationRepairs669bEnabled() && verifiedActivationEnabled() && !liveRecommendationEligible(record)) return false;
  return true;
}

function nightlyUsd(record) {
  const cluster = record.multiCitySuitability?.regionCluster;
  const base = REGION_NIGHTLY_USD[cluster] || 82;
  const depth = record.multiCitySuitability?.hotelDepth || record.providerSupport?.hotel?.depth || 'unknown';
  const depthMul = depth === 'very-strong' ? 0.90 : depth === 'strong' ? 0.95 : depth === 'standard' ? 1.0 : depth === 'limited' ? 1.08 : 1.12;
  const groupMul = record.group === 'GROUP_1' ? 1.02 : 0.92;
  return roundTo(base * depthMul * groupMul, 5);
}

function estimateTransportUsd(distanceKm, from, to) {
  if (String(from.countryCode || '').toUpperCase() === String(to.countryCode || '').toUpperCase() && distanceKm <= 700) {
    return { mode: 'ground', transportType: distanceKm <= 260 ? 'bus-or-shuttle' : 'rail-or-bus', costUsd: roundTo(clamp(24 + distanceKm * 0.13, 25, 125), 5) };
  }
  let value;
  if (distanceKm < 700) value = 60 + distanceKm * 0.07;
  else if (distanceKm < 1800) value = 82 + distanceKm * 0.055;
  else if (distanceKm < 4000) value = 112 + distanceKm * 0.043;
  else if (distanceKm < 8500) value = 175 + distanceKm * 0.038;
  else value = 245 + distanceKm * 0.034;
  return { mode: 'flight', transportType: 'flight', costUsd: roundTo(clamp(value, 65, 520), 5) };
}

function stopCountForBudget(budgetUsd) {
  if (budgetUsd < 1350) return 2;
  if (budgetUsd < 2800) return 2;
  return MAX_STOPS;
}

function nightsForBudget(budgetUsd, stopCount) {
  if (stopCount <= 1) {
    if (budgetUsd < 900) return 2;
    if (budgetUsd < 1350) return 3;
    if (budgetUsd < 2500) return 4;
    return 5;
  }
  if (budgetUsd < 900) return stopCount;
  if (budgetUsd < 1350) return stopCount * 2;
  if (budgetUsd < 2500) return stopCount === 2 ? 5 : 6;
  return stopCount === 2 ? 6 : 8;
}

function normalizeBudgetUsd(query = {}) {
  if (query.budgetUsd !== undefined && String(query.budgetUsd).trim() !== '') {
    return Math.max(1, finiteNumber(query.budgetUsd, 0));
  }
  const amount = Math.max(1, finiteNumber(query.budget, 0));
  const rate = currencyToUsdRate(String(query.currency || 'USD').toUpperCase());
  return amount * rate;
}

function displayCurrency(query = {}) {
  return String(query.currency || 'USD').toUpperCase();
}

function scoreCandidate(record, origin, preferredClusters) {
  const cluster = record.multiCitySuitability?.regionCluster || '';
  const dist = haversineKm(origin, record);
  const readiness = finiteNumber(record.multiCitySuitability?.readinessScore, 70);
  const clusterBonus = preferredClusters.includes(cluster) ? 45 : 0;
  const groupBonus = record.group === 'GROUP_2' ? 8 : 4;
  const distanceFit = dist < 3500 ? (35 - dist / 120) : (dist < 8500 ? 8 - (dist - 3500) / 900 : -12);
  return clusterBonus + readiness * 0.40 + groupBonus + distanceFit - nightlyUsd(record) * 0.04;
}

function candidatePool(origin) {
  const preferred = regionClustersForOrigin(origin);
  const rows = foundationRecords()
    .filter(record => candidateEligible(record, origin))
    .map(record => ({ record, score: scoreCandidate(record, origin, preferred), cluster: record.multiCitySuitability?.regionCluster || '', distanceKm: haversineKm(origin, record) }))
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm || a.record.cityId.localeCompare(b.record.cityId));
  const preferredRows = preferred.length ? rows.filter(row => preferred.includes(row.cluster)) : [];
  const nearRows = rows.slice().sort((a, b) => a.distanceKm - b.distanceKm).slice(0, 30);
  return [...new Map([...preferredRows, ...rows.slice(0, 60), ...nearRows].map(row => [row.record.cityId, row])).values()];
}

function allCombos(items, size, limit = 48) {
  const out = [];
  const source = items.slice(0, Math.min(items.length, size === 2 ? 26 : 18));
  function visit(start, combo) {
    if (out.length >= limit) return;
    if (combo.length === size) { out.push(combo.slice()); return; }
    for (let i = start; i < source.length; i += 1) visit(i + 1, combo.concat(source[i]));
  }
  visit(0, []);
  return out;
}

function routeDistance(origin, records) {
  const ordered = optimizeOrder(origin, records);
  const nodes = [origin, ...ordered, origin];
  return nodes.slice(0, -1).reduce((sum, node, i) => sum + haversineKm(node, nodes[i + 1]), 0);
}

function optimizeOrder(origin, records) {
  if (records.length <= 1) return records.slice();
  let best = records.slice();
  let bestDistance = Infinity;
  function permute(prefix, remaining) {
    if (!remaining.length) {
      const nodes = [origin, ...prefix, origin];
      const dist = nodes.slice(0, -1).reduce((sum, node, i) => sum + haversineKm(node, nodes[i + 1]), 0);
      if (dist < bestDistance) { bestDistance = dist; best = prefix.slice(); }
      return;
    }
    remaining.forEach((record, index) => permute(prefix.concat(record), remaining.slice(0, index).concat(remaining.slice(index + 1))));
  }
  permute([], records.slice());
  return best;
}

function buildPlan(origin, records, query, actionLabel = 'global fallback') {
  const budgetUsd = normalizeBudgetUsd(query);
  const stopCount = records.length;
  const requested = Number(query.totalNights ?? query.nights ?? query.tripNights);
  const totalNights = Number.isFinite(requested) && requested > 0
    ? Math.max(stopCount * 2, Math.min(14, Math.round(requested)))
    : nightsForBudget(budgetUsd, stopCount);
  const baseNights = Math.max(1, Math.floor(totalNights / stopCount));
  let remainder = totalNights - baseNights * stopCount;
  const ordered = optimizeOrder(origin, records);
  const stops = ordered.map((record) => {
    const nights = baseNights + (remainder-- > 0 ? 1 : 0);
    const nightly = nightlyUsd(record);
    const locationCode = record.providerSupport?.flight?.locationCode || null;
    const airportCodes = [...new Set([locationCode, ...(record.providerSupport?.flight?.airportCodes || [])].filter(Boolean))];
    return {
      cityId: record.cityId,
      city: record.displayCity,
      country: record.country,
      countryCode: record.countryCode,
      code: locationCode,
      airportCodes,
      group: record.group,
      groupSubtype: record.groupSubtype,
      regionCluster: record.multiCitySuitability?.regionCluster || null,
      latitude: record.latitude,
      longitude: record.longitude,
      nights,
      hotel: {
        provider: 'Agoda',
        providerCityId: record.providerSupport?.hotel?.cityId || null,
        hotelCoverageCount: record.providerSupport?.hotel?.hotelCount || 0,
        coverageDepth: record.providerSupport?.hotel?.depth || null,
        estimatedNightlyUsd: nightly,
        estimatedStayUsd: nightly * nights,
        estimateSource: 'global-origin-route-hotel-planning-fallback',
        livePriceVerified: false,
        name: `${record.displayCity} central value stay`,
        reviewSummary: 'Guest review estimate pending partner confirmation.'
      },
      replaceable: true,
      removable: true
    };
  });
  const nodes = [origin, ...ordered, origin];
  const legs = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const from = nodes[i];
    const to = nodes[i + 1];
    const distanceKm = Math.round(haversineKm(from, to));
    const estimate = estimateTransportUsd(distanceKm, from, to);
    legs.push({
      legNumber: i + 1,
      from: {
        cityId: from.cityId,
        city: from.displayCity || from.city,
        code: from.providerSupport?.flight?.locationCode || from.code || from.airportCode || null,
        airportCode: from.airportCode || null,
        latitude: from.latitude,
        longitude: from.longitude
      },
      to: {
        cityId: to.cityId,
        city: to.displayCity || to.city,
        code: to.providerSupport?.flight?.locationCode || to.code || to.airportCode || null,
        airportCode: to.airportCode || null,
        latitude: to.latitude,
        longitude: to.longitude
      },
      mode: estimate.mode,
      transportType: estimate.transportType,
      distanceKm,
      estimatedTransportUsd: estimate.costUsd,
      estimatedFlightUsd: estimate.mode === 'flight' ? estimate.costUsd : 0,
      estimateSource: estimate.mode === 'flight' ? 'global-origin-distance-flight-planning-fallback' : 'global-origin-ground-planning-fallback',
      liveFareVerified: false,
      providerVerificationRequired: true
    });
  }
  const totalTransport = legs.reduce((sum, leg) => sum + finiteNumber(leg.estimatedTransportUsd), 0);
  const totalHotel = stops.reduce((sum, stop) => sum + finiteNumber(stop.hotel?.estimatedStayUsd), 0);
  const total = Math.round(totalTransport + totalHotel);
  const reserve = Math.round(budgetUsd * RESERVE_PERCENT);
  const usable = budgetUsd - reserve;
  const originPublic = {
    cityId: origin.cityId,
    city: origin.city,
    country: origin.country,
    countryCode: origin.countryCode,
    code: origin.code,
    airportCode: origin.airportCode,
    airportCodes: origin.airportCodes,
    latitude: origin.latitude,
    longitude: origin.longitude,
    isOrigin: true,
    originResolutionType: 'global-flightable-city',
    providerSupportStatus: origin.providerSupportStatus,
    evidenceLabel: 'Limited provider coverage'
  };
  const raw = {
    tourId: `gv653a-${String(origin.code || origin.airportCode || 'global').toLowerCase()}-${ordered.map(r => r.cityId).join('-')}`,
    routeId: `gv653a-${String(origin.code || origin.airportCode || 'global').toLowerCase()}-${ordered.map(r => r.cityId).join('-')}`,
    tourRole: 'global-origin-fallback',
    tourRoleLabel: 'Estimated route',
    origin: originPublic,
    stops,
    legs,
    totalNights: stops.reduce((sum, stop) => sum + stop.nights, 0),
    totalDistanceKm: legs.reduce((sum, leg) => sum + leg.distanceKm, 0),
    totalFlightEstimateUsd: totalTransport,
    totalTransportEstimateUsd: totalTransport,
    totalHotelEstimateUsd: totalHotel,
    estimatedTotalUsd: total,
    totalBudgetUsd: budgetUsd,
    reservePercent: RESERVE_PERCENT,
    reserveAmountUsd: reserve,
    usableTripBudgetUsd: usable,
    amountLeftUsd: usable - total,
    affordabilityStatus: usable >= total ? 'within-protected-budget' : 'over-protected-budget',
    pricingStatus: 'global-origin-estimated-route-provider-verification-required',
    selectionSource: 'global-generated-tour-fallback-653a',
    evidenceLabel: 'Estimated route',
    providerVerificationRequired: true,
    mapCoordinates: [
      { type: 'origin', cityId: originPublic.cityId, city: originPublic.city, latitude: originPublic.latitude, longitude: originPublic.longitude },
      ...stops.map(stop => ({ type: 'stop', cityId: stop.cityId, city: stop.city, latitude: stop.latitude, longitude: stop.longitude })),
      { type: 'return', cityId: originPublic.cityId, city: originPublic.city, latitude: originPublic.latitude, longitude: originPublic.longitude }
    ],
    routeExplanation: [
      `${origin.city} is not fully promoted in the core route foundation yet, so Globevoy generated an estimated route from its flightable airport code (${origin.airportCode || origin.code}).`,
      'Transport and hotel values are planning estimates until partner/provider confirmation.',
      'The raw flight-search work stays hidden from the user; only the final tour package is shown.'
    ],
    generatedTourFallback: {
      enabled: true,
      version: GLOBAL_FALLBACK_VERSION,
      source: 'global-destination-catalogue+trusted-500-destination-foundation',
      originResolution: {
        requestedOrigin: origin.requestedOrigin,
        resolvedCity: origin.city,
        resolvedCode: origin.code,
        resolvedAirportCode: origin.airportCode,
        class: origin.globalEligibilityClass
      }
    },
    editableActions: {
      removeStop: stops.length > MIN_STOPS,
      replaceStop: false,
      addStop: false,
      reorderStops: false,
      undo: true
    }
  };
  const presented = attachTourPresentation(raw, query);
  return { raw: presented, score: scorePlan({ total, usable, records: ordered, origin, totalDistance: routeDistance(origin, ordered) }), total, usable, actionLabel };
}

function scorePlan(plan) {
  const budgetFit = plan.total <= plan.usable ? 100 - Math.abs(0.78 - plan.total / Math.max(1, plan.usable)) * 70 : -200 - (plan.total - plan.usable) / 8;
  const groupMix = plan.records.some(r => r.group === 'GROUP_1') && plan.records.some(r => r.group === 'GROUP_2') ? 30 : 0;
  const readiness = plan.records.reduce((sum, r) => sum + finiteNumber(r.multiCitySuitability?.readinessScore, 70), 0) / Math.max(1, plan.records.length);
  const compact = Math.max(0, 40 - plan.totalDistance / 500);
  return budgetFit + groupMix + readiness * 0.35 + compact;
}

function preferredFallbackEligible(record, origin) {
  if (!record) return false;
  if (record.providerSupport?.bothProviderReady !== true) return false;
  if (record.multiCitySuitability?.status !== 'strong') return false;
  if (String(record.multiCitySuitability?.activationTier || '').toUpperCase() !== 'CORE') return false;
  if (!['GROUP_1', 'GROUP_2'].includes(record.group)) return false;
  if (!Number.isFinite(Number(record.latitude)) || !Number.isFinite(Number(record.longitude))) return false;
  const code = String(record.providerSupport?.flight?.locationCode || '').toUpperCase();
  const airports = (record.providerSupport?.flight?.airportCodes || []).map(c => String(c).toUpperCase());
  const originCodes = [origin.code, origin.airportCode, ...(origin.airportCodes || [])].map(c => String(c || '').toUpperCase()).filter(Boolean);
  if (originCodes.includes(code) || airports.some(code => originCodes.includes(code))) return false;
  if (mvpValidationRepairs669bEnabled() && verifiedActivationEnabled() && !liveRecommendationEligible(record)) return false;
  return true;
}

function preferredCountryPlans(origin, query, maxStopCount) {
  const ids = COUNTRY_PREFERRED_CITY_IDS[String(origin.countryCode || '').toUpperCase()] || [];
  if (!ids.length) return [];
  const byId = foundationById();
  const records = ids.map(id => byId.get(id)).filter(record => preferredFallbackEligible(record, origin));
  const plans = [];
  const pairs = [];
  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) pairs.push([records[i], records[j]]);
  }
  for (const record of records.slice(0, 8)) {
    const plan = buildPlan(origin, [record], query, 'preferred global corridor budget fallback');
    plan.score += 60;
    plans.push(plan);
  }
  for (const pair of pairs.slice(0, 12)) {
    const plan = buildPlan(origin, pair, query, 'preferred global corridor');
    plan.score += 95;
    plans.push(plan);
  }
  if (maxStopCount >= 3 && records.length >= 3) {
    for (let i = 0; i < Math.min(records.length - 2, 4); i += 1) {
      const plan = buildPlan(origin, [records[i], records[i + 1], records[i + 2]], query, 'preferred global corridor');
      plan.score += 75;
      plans.push(plan);
    }
  }
  return plans;
}

function findBestGlobalTour(query = {}) {
  if (globalRouteGraphEnabled()) {
    const graph = generateGlobalRouteCandidates(query);
    if (Array.isArray(graph.tours) && graph.tours.length) {
      const selected = graph.tours[0];
      return {
        ok: true,
        supported: true,
        version: GLOBAL_FALLBACK_VERSION,
        mode: 'global-generated-tour-route-graph',
        requested: { origin: graph.origin || selected.origin || null, budgetUsd: normalizeBudgetUsd(query) },
        pricingPolicy: { source: 'on-demand-global-route-graph-planning-estimates', userVisibleRawFlightSearch: false, providerVerificationRequiredBeforeBooking: true },
        tour: selected,
        tours: graph.tours,
        diagnostics: { generatedTourFallback: true, globalFallbackVersion: GLOBAL_FALLBACK_VERSION, globalRouteGraphVersion: GLOBAL_ROUTE_GRAPH_VERSION, ...(graph.diagnostics || {}) }
      };
    }
  }
  const origin = resolveGlobalOrigin(query.origin || query.originCode || query.from || query.startingCity);
  if (!origin) return null;
  const budgetUsd = normalizeBudgetUsd(query);
  const usable = budgetUsd * (1 - RESERVE_PERCENT);
  const maxStopCount = guardEnabled() ? Math.min(stopCountForBudget(budgetUsd), maxStopsForTrip(query)) : stopCountForBudget(budgetUsd);
  const poolRows = candidatePool(origin);
  if (!poolRows.length) return null;
  const groups = new Set();
  const rows = poolRows.filter(row => {
    groups.add(row.record.group);
    return true;
  });
  const candidates = [...preferredCountryPlans(origin, query, maxStopCount)];
  for (const size of [1, Math.min(maxStopCount, 2), ...(maxStopCount >= 3 ? [3] : [])]) {
    if (size < MIN_STOPS) continue;
    for (const combo of allCombos(rows, size, size === 2 ? 96 : 60)) {
      const records = combo.map(row => row.record);
      if (new Set(records.map(r => r.countryCode)).size < Math.min(2, records.length)) continue;
      if (!records.some(r => r.group === 'GROUP_1')) continue;
      // Prefer a mixed anchor/discovery route when possible, but do not let this
      // block major-hub fallbacks for regions where the curated discovery pool is thin.
      if (records.length > 1 && !records.some(r => r.group === 'GROUP_2') && groups.has('GROUP_2') && !COUNTRY_PREFERRED_CITY_IDS[String(origin.countryCode || '').toUpperCase()]) continue;
      candidates.push(buildPlan(origin, records, query));
    }
  }
  const feasible = candidates.filter(plan => plan.total <= budgetUsd);
  if (!feasible.length) return null;
  const protectedFeasible = feasible.filter(plan => plan.total <= usable);
  const feasiblePool = protectedFeasible.length ? protectedFeasible : feasible;
  const preferredMultiStop = feasiblePool.filter(plan => Array.isArray(plan.raw?.stops) && plan.raw.stops.length >= PREFERRED_MIN_STOPS);
  const simpleFallbackPool = feasiblePool.filter(plan => Array.isArray(plan.raw?.stops) && plan.raw.stops.length < PREFERRED_MIN_STOPS);
  const ranked = (preferredMultiStop.length ? preferredMultiStop : simpleFallbackPool)
    .sort((a, b) => b.score - a.score || a.total - b.total);
  const selected = ranked[0] || null;
  if (selected && Array.isArray(selected.raw?.stops) && selected.raw.stops.length < PREFERRED_MIN_STOPS) {
    selected.raw.tourRole = 'budget-fit-simple-route';
    selected.raw.tourRoleLabel = 'Simple route';
    selected.raw.recommendationLabel = 'Budget-fit simple route';
    selected.raw.simpleRouteFallback = {
      enabled: true,
      reason: 'only-one-destination-stop-fit-current-budget',
      preferredMinimumStops: PREFERRED_MIN_STOPS,
      message: 'Only 1 destination stop fits this budget. Increase the budget to unlock a stronger 2-city tour.'
    };
    selected.raw.routeExplanation = [
      'Only 1 destination stop fits this budget while keeping the estimate inside the entered budget.',
      'Increase the budget to unlock a stronger 2-city tour.',
      ...(Array.isArray(selected.raw.routeExplanation) ? selected.raw.routeExplanation : [])
    ];
  }
  if (!selected) return null;
  return {
    ok: true,
    supported: true,
    version: GLOBAL_FALLBACK_VERSION,
    mode: 'global-generated-tour-fallback',
    requested: {
      origin: selected.raw.origin,
      budgetUsd,
      reservePercent: RESERVE_PERCENT,
      reserveAmountUsd: Math.round(budgetUsd * RESERVE_PERCENT),
      usableTripBudgetUsd: usable,
      displayBudget: selected.raw.displayBudget || null
    },
    pricingPolicy: {
      source: 'estimated-route-global-origin-fallback',
      userVisibleRawFlightSearch: false,
      providerVerificationRequiredBeforeBooking: true
    },
    tour: selected.raw,
    tours: [selected.raw],
    diagnostics: {
      generatedTourFallback: true,
      globalFallbackVersion: GLOBAL_FALLBACK_VERSION,
      originClass: origin.globalEligibilityClass,
      originProviderSupportStatus: origin.providerSupportStatus,
      candidateCount: rows.length,
      routePlanCount: candidates.length,
      feasiblePlanCount: feasible.length,
      protectedFeasiblePlanCount: protectedFeasible.length,
      selectedEstimatedTotalUsd: selected.total,
      selectedWithinUsableBudget: selected.total <= usable
    }
  };
}

module.exports = {
  GLOBAL_FALLBACK_VERSION,
  resolveGlobalOrigin,
  findBestGlobalTour,
  _internal: { normalizeKey, haversineKm, estimateTransportUsd, nightlyUsd, candidatePool, inputTokens, mvpValidationRepairs669bEnabled }
};
