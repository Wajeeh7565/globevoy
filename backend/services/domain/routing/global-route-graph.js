'use strict';

// GV-GLOBAL-665B — provider-driven global route discovery with travel-time guardrails.
// Generates route candidates automatically from a unified global city/airport
// catalogue. It does not invent provider fares or live hotel availability.
// Provider enrichment and LLM curation happen later in generated-tour.js.

const globalCatalogue = require('../../../data/global-destination-catalogue.json');
const { cityRegistryEnabled, routeGraphSelection } = require('../../city-registry');
const {
  enabled: verifiedActivationEnabled,
  activationForCity,
  liveRecommendationEligible
} = require('../../verified-city-activation');
const { loadGroupedCityFoundation } = require('../../../data/grouped-city-foundation');
const { attachTourPresentation, currencyToUsdRate } = require('../../../budget-presentation');
const { fetchTravelpayoutsCandidates } = require('../../travelpayouts');
const { normalizeParty, providerFarePartyTotalUsd } = require('../pricing/traveller-pricing');
const {
  evaluateTour,
  maxStopsForTrip,
  requestedNights,
  _internal: { haversineKm, macroRegion, estimateLegTravelHours }
} = require('./route-feasibility');

const GLOBAL_ROUTE_GRAPH_VERSION = 'GV-GLOBAL-665B+GV-MVP-666A+GV-CITY-668A+GV-CITY-668J+GV-PROD-669B+GV-PROD-669C+GV-PROD-669F';
const RESERVE_PERCENT = 0.05;
const MAX_CANDIDATES = 24;
const MAX_PROVIDER_FIRST_DESTINATIONS = 4;
const PROVIDER_SECOND_LEG_MONTHS = 1;

const NIGHTLY_USD_BY_REGION = Object.freeze({
  'north-america': 118,
  'latin-america-caribbean': 76,
  europe: 102,
  'mena-caucasus': 78,
  asia: 66,
  oceania: 124,
  'sub-saharan-africa': 72,
  other: 86,
  unknown: 88
});

const REGION_NEIGHBOURS = Object.freeze({
  'north-america': new Set(['north-america', 'latin-america-caribbean']),
  'latin-america-caribbean': new Set(['latin-america-caribbean', 'north-america']),
  europe: new Set(['europe', 'mena-caucasus']),
  'mena-caucasus': new Set(['mena-caucasus', 'europe', 'asia']),
  asia: new Set(['asia', 'mena-caucasus', 'oceania']),
  oceania: new Set(['oceania', 'asia']),
  'sub-saharan-africa': new Set(['sub-saharan-africa', 'mena-caucasus']),
  other: new Set(['other']),
  unknown: new Set(['unknown'])
});

function enabled() {
  const explicit665B = String(process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665B || '').trim().toLowerCase();
  if (explicit665B) return explicit665B === 'true';
  const explicit665A = String(process.env.ENABLE_GLOBAL_ROUTE_GRAPH_665A || '').trim().toLowerCase();
  if (explicit665A) return explicit665A === 'true';
  return true;
}

function providerDiscoveryEnabled() {
  const explicit = String(process.env.ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B || '').trim().toLowerCase();
  if (explicit) return explicit === 'true';
  return true;
}

function mvpValidationRepairs669bEnabled() {
  const explicit = String(process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B || '').trim().toLowerCase();
  return explicit ? explicit === 'true' : true;
}

function originDisplayIntegrity669fEnabled() {
  const explicit = String(process.env.ENABLE_ORIGIN_DISPLAY_INTEGRITY_669F || '').trim().toLowerCase();
  if (explicit) return explicit === 'true';
  // 669F completes the stakeholder-readiness origin repair that began in 669E.
  // Keep the fix active when the existing 669E flag is already enabled.
  return String(process.env.ENABLE_STAKEHOLDER_READINESS_669E || '').trim().toLowerCase() === 'true';
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clean(value) { return String(value || '').trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function normalize(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function round5(value) { return Math.round(value / 5) * 5; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function safeCode(value) { const c = upper(value); return /^[A-Z]{3}$/.test(c) ? c : null; }

function countryNameMap(destinations) {
  const map = new Map();
  for (const row of destinations) {
    if (row?.countryCode && row?.countryName) map.set(upper(row.countryCode), row.countryName);
  }
  return map;
}

function originCodes(row = {}) {
  return Array.from(new Set([
    row.cityCode,
    row.providerMetroCode,
    row.primaryAirportCode,
    ...(row.flightableAirportCodes || []),
    ...(row.physicalAirportCodes || []),
    row.unifiedRegistry?.origin?.providerLocationCode,
    row.unifiedRegistry?.origin?.preferredAirportCode,
    ...(row.unifiedRegistry?.origin?.airportCodes || [])
  ].map(safeCode).filter(Boolean)));
}

function originCodeOwnershipScore(row = {}, code) {
  const target = safeCode(code);
  if (!target) return -Infinity;
  const registryOrigin = row.unifiedRegistry?.origin || {};
  const requiresGateway = registryOrigin.requiresGatewayTransfer === true;
  let score = destinationQuality(row);
  if (safeCode(row.primaryAirportCode) === target) score += 80;
  if (safeCode(row.cityCode) === target || safeCode(row.providerMetroCode) === target) score += 55;
  if ((row.flightableAirportCodes || []).map(upper).includes(target)) score += 35;
  if (registryOrigin.preferredAirportCode && safeCode(registryOrigin.preferredAirportCode) === target) score += 30;
  if (requiresGateway) score -= 120;
  else if (row.unifiedRegistry) score += 70;
  return score;
}

function setPreferredCodeOwner(map, code, row) {
  const target = safeCode(code);
  if (!target || !row) return;
  const current = map.get(target);
  if (!current || originCodeOwnershipScore(row, target) > originCodeOwnershipScore(current, target)) {
    map.set(target, row);
  }
}

let cache = null;
function indexes() {
  if (cache) return cache;
  const rows = Array.isArray(globalCatalogue.destinations) ? globalCatalogue.destinations.filter(Boolean) : [];
  const countries = countryNameMap(rows);
  const byCode = new Map();
  const byName = new Map();
  const flightable = [];
  const trusted = [];
  const eligibleDiscoveries = [];
  const registrySelected = [];

  for (const row of rows) {
    const normalizedName = normalize(row.canonicalCityName || row.normalizedCityName);
    if (normalizedName) {
      if (!byName.has(normalizedName)) byName.set(normalizedName, []);
      byName.get(normalizedName).push(row);
    }
    for (const c of [row.cityCode, row.providerMetroCode, row.primaryAirportCode, ...(row.flightableAirportCodes || []), ...(row.physicalAirportCodes || [])]) {
      const code = safeCode(c);
      if (code) setPreferredCodeOwner(byCode, code, row);
    }
    if (Array.isArray(row.flightableAirportCodes) && row.flightableAirportCodes.length && Number.isFinite(Number(row.latitude)) && Number.isFinite(Number(row.longitude))) {
      flightable.push(row);
      if (row.trusted500Status === true || row.class === 'TRUSTED_500') trusted.push(row);
      else if ((row.class === 'GLOBAL_ELIGIBLE' || row.eligibilityStatus === 'eligible') && ['high', 'verified'].includes(String(row.sourceConfidence || '').toLowerCase())) eligibleDiscoveries.push(row);
    }
  }

  // GV-CITY-668A: when enabled, the unified 1,000-city registry becomes
  // the destination candidate surface. The wider 9,665-city catalogue remains
  // available for origin resolution and nearest-airport fallback.
  if (cityRegistryEnabled()) {
    const selected = routeGraphSelection(rows);
    trusted.length = 0;
    eligibleDiscoveries.length = 0;
    const selectedKeys = new Set();
    for (const row of selected) {
      const key = row.unifiedRegistry?.cityId || row.catalogueId || `${normalize(row.canonicalCityName)}|${upper(row.countryCode)}`;
      if (selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      registrySelected.push(row);
      if (row.unifiedRegistry?.selectionTier === 'current-500') trusted.push(row);
      else eligibleDiscoveries.push(row);
      if (!flightable.includes(row)) flightable.push(row);
      const normalizedName = normalize(row.canonicalCityName || row.normalizedCityName);
      if (normalizedName) {
        const list = byName.get(normalizedName) || [];
        if (!list.includes(row)) list.unshift(row);
        byName.set(normalizedName, list);
      }
      for (const c of [row.cityCode, row.providerMetroCode, row.primaryAirportCode, ...(row.flightableAirportCodes || []), ...(row.physicalAirportCodes || [])]) {
        const code = safeCode(c);
        if (code) setPreferredCodeOwner(byCode, code, row);
      }
      if (row.countryCode && row.countryName) countries.set(upper(row.countryCode), row.countryName);
    }
  }

  // Enrich known trusted cities with Group 1 / Group 2 and hotel metadata.
  const foundation = loadGroupedCityFoundation();
  const foundationRows = Array.isArray(foundation.records) ? foundation.records : [];
  const foundationByCode = new Map();
  const foundationByNameCountry = new Map();
  for (const row of foundationRows) {
    const code = safeCode(row.providerSupport?.flight?.locationCode);
    if (code) foundationByCode.set(code, row);
    for (const airport of row.providerSupport?.flight?.airportCodes || []) {
      const a = safeCode(airport); if (a) foundationByCode.set(a, row);
    }
    foundationByNameCountry.set(`${normalize(row.displayCity)}|${upper(row.countryCode)}`, row);
  }

  // Prefer trusted, complete and flightable records for ambiguous names.
  for (const list of byName.values()) {
    list.sort((a, b) => destinationQuality(b) - destinationQuality(a) || clean(a.canonicalCityName).localeCompare(clean(b.canonicalCityName)));
  }

  cache = { rows, countries, byCode, byName, flightable, trusted, eligibleDiscoveries, registrySelected, foundationByCode, foundationByNameCountry };
  return cache;
}

function destinationQuality(row = {}) {
  let score = 0;
  const registryRecord = row.unifiedRegistry || null;
  const activation = row.verifiedActivation || activationForCity(row, { includeEvidence: false });
  if (verifiedActivationEnabled()) {
    if (activation.liveRecommendationEligible === true) score += 65;
    else if (activation.auditStatus === 'reviewed-inactive') score -= 18;
    else if (activation.auditStatus === 'unaudited') score -= 8;
  }
  if (registryRecord) {
    score += registryRecord.selectionTier === 'current-500' ? 70 : 42;
    score += Math.min(20, Number(registryRecord.destination?.readinessScore || 0) / 5);
    if (registryRecord.validation?.bothProvidersMapped) score += 18;
    if (registryRecord.origin?.requiresGatewayTransfer) score -= 8;
  }
  if (row.trusted500Status === true || row.class === 'TRUSTED_500') score += 100;
  if (row.class === 'GLOBAL_ELIGIBLE' || row.eligibilityStatus === 'eligible') score += 35;
  if (String(row.sourceConfidence || '').toLowerCase() === 'verified') score += 20;
  if (String(row.sourceConfidence || '').toLowerCase() === 'high') score += 12;
  if (row.metadataCompletenessStatus === 'complete') score += 8;
  score += Math.min(10, num(row.flightableAirportCount, (row.flightableAirportCodes || []).length) * 3);
  return score;
}

function parseOriginInput(input) {
  const raw = clean(input);
  let codes;
  if (mvpValidationRepairs669bEnabled()) {
    // Only treat explicit airport-code syntax as an IATA signal. The old broad
    // three-letter-token scan interpreted the word "New" in "New York (JFK)"
    // as airport code NEW and incorrectly resolved the origin to New Orleans.
    const parenthesized = [...raw.matchAll(/\(([A-Za-z]{3})\)/g)].map(m => upper(m[1]));
    const exact = /^\s*([A-Za-z]{3})\s*$/.exec(raw);
    const explicitUpper = [...raw.matchAll(/(?:^|[\s,\/-])([A-Z]{3})(?=$|[\s,\)/-])/g)].map(m => upper(m[1]));
    codes = [...new Set([...parenthesized, ...(exact ? [upper(exact[1])] : []), ...explicitUpper])];
  } else {
    codes = [...new Set([...raw.matchAll(/\b([A-Za-z]{3})\b/g)].map(m => upper(m[1])))];
  }
  const normalized = normalize(raw);
  const commaParts = raw.split(',').map(normalize).filter(Boolean);
  return { raw, normalized, codes, cityPart: commaParts[0] || normalized, countryPart: commaParts[1] || '' };
}

function preferredAirport(row = {}) {
  const name = normalize(row.canonicalCityName);
  const cityCode = upper(row.cityCode || row.providerMetroCode);
  const airports = (row.flightableAirportCodes || []).map(upper).filter(Boolean);
  if ((name === 'toronto' || cityCode === 'YTO') && airports.includes('YYZ')) return 'YYZ';
  if ((name === 'tehran' || cityCode === 'THR') && airports.includes('IKA')) return 'IKA';
  if ((name === 'montreal' || cityCode === 'YMQ') && airports.includes('YUL')) return 'YUL';
  if ((name === 'london' || cityCode === 'LON') && airports.includes('LHR')) return 'LHR';
  if ((name === 'seoul' || cityCode === 'SEL') && airports.includes('ICN')) return 'ICN';
  if ((name === 'new york' || name === 'new york city' || cityCode === 'NYC') && airports.includes('JFK')) return 'JFK';
  return safeCode(row.primaryAirportCode) || airports[0] || safeCode(row.cityCode) || null;
}

function recordCountryName(row, idx) {
  return clean(row.countryName) || idx.countries.get(upper(row.countryCode)) || upper(row.countryCode) || 'Unknown';
}

function nearestGateway(row, idx) {
  if (!Number.isFinite(Number(row.latitude)) || !Number.isFinite(Number(row.longitude))) return null;
  const sameCountry = idx.flightable.filter(item => upper(item.countryCode) === upper(row.countryCode));
  const source = sameCountry.length ? sameCountry : idx.flightable;
  let best = null;
  for (const candidate of source) {
    if (candidate === row) continue;
    const km = haversineKm(row, candidate);
    const qualityPenalty = (candidate.trusted500Status === true || candidate.class === 'TRUSTED_500') ? 0 : 35;
    const score = km + qualityPenalty;
    if (!best || score < best.score) best = { row: candidate, km, score };
  }
  const maxKm = sameCountry.length ? 350 : 180;
  return best && best.km <= maxKm ? best : null;
}

function publicOrigin(row, requestedInput, idx, requestedAirportCode = null) {
  const directAirports = Array.isArray(row.flightableAirportCodes) ? row.flightableAirportCodes.filter(Boolean) : [];
  let gateway = null;
  let airportSource = row;
  if (!directAirports.length) {
    gateway = nearestGateway(row, idx);
    if (!gateway) return null;
    airportSource = gateway.row;
  }
  const requestedCode = safeCode(requestedAirportCode);
  const supportedCodes = originCodes(airportSource);
  const airportCode = requestedCode && supportedCodes.includes(requestedCode)
    ? requestedCode
    : preferredAirport(airportSource);
  if (!airportCode) return null;
  const airports = Array.isArray(airportSource.flightableAirportCodes) ? airportSource.flightableAirportCodes.map(upper).filter(Boolean) : [airportCode];
  const country = recordCountryName(row, idx) || recordCountryName(airportSource, idx);
  const result = {
    cityId: `global-city-${upper(row.cityCode || airportCode).toLowerCase()}`,
    city: row.canonicalCityName,
    displayCity: row.canonicalCityName,
    country,
    countryCode: upper(row.countryCode || airportSource.countryCode),
    code: airportCode,
    airportCode,
    airportCodes: Array.from(new Set([airportCode, ...airports])),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    timeZone: row.timeZone || airportSource.timeZone || null,
    requestedOrigin: clean(requestedInput),
    isGlobalOrigin: true,
    sourceConfidence: row.sourceConfidence || 'gateway-resolved',
    globalEligibilityClass: row.class || row.eligibilityStatus || 'GLOBAL_GATEWAY_RESOLVED',
    providerSupportStatus: airportSource.providerSupportStatus || 'flightable-airport-supported'
  };
  if (gateway) {
    result.gatewayAirport = {
      airportCode,
      gatewayCity: airportSource.canonicalCityName,
      distanceKm: Math.round(gateway.km),
      transferMode: 'ground-access',
      note: `${row.canonicalCityName} uses ${airportSource.canonicalCityName} (${airportCode}) as the practical flight gateway.`
    };
    result.originResolutionType = 'nearby-flight-gateway';
    result.requiresGroundAccessTransfer = true;
  } else {
    result.originResolutionType = 'direct-flightable-city';
  }
  return result;
}

function resolveAnyOrigin(input) {
  const idx = indexes();
  const parsed = parseOriginInput(input);
  if (!parsed.normalized) return null;

  const explicitCode = parsed.codes.find(code => safeCode(code)) || null;
  const codeOnlyInput = /^[a-z]{3}$/.test(parsed.normalized);

  // GV-PROD-669F: preserve the traveller's explicit city identity before
  // resolving a shared airport or metro code. YVR is a direct Vancouver airport
  // and also a gateway for Whistler; "Vancouver (YVR)" must therefore remain
  // Vancouver while "Whistler (YVR)" must remain Whistler.
  if (originDisplayIntegrity669fEnabled() && !codeOnlyInput) {
    let namedCandidates = idx.byName.get(parsed.cityPart) || idx.byName.get(parsed.normalized) || [];
    if (parsed.countryPart) {
      const countryNeedle = normalize(parsed.countryPart);
      const filtered = namedCandidates.filter(row =>
        normalize(recordCountryName(row, idx)) === countryNeedle ||
        normalize(row.countryCode) === countryNeedle
      );
      if (filtered.length) namedCandidates = filtered;
    }
    for (const row of namedCandidates) {
      const resolved = publicOrigin(row, input, idx, explicitCode);
      if (resolved) return resolved;
    }
  }

  for (const code of parsed.codes) {
    const row = idx.byCode.get(code);
    if (row) return publicOrigin(row, input, idx, code);
  }

  let candidates = idx.byName.get(parsed.cityPart) || idx.byName.get(parsed.normalized) || [];
  if (parsed.countryPart) {
    const countryNeedle = normalize(parsed.countryPart);
    const filtered = candidates.filter(row => normalize(recordCountryName(row, idx)) === countryNeedle || normalize(row.countryCode) === countryNeedle);
    if (filtered.length) candidates = filtered;
  }
  if (!candidates.length) {
    // Prefix search is intentionally conservative to avoid silently choosing a wrong city.
    const matches = [];
    for (const [name, rows] of idx.byName.entries()) {
      if (name.startsWith(parsed.normalized)) matches.push(...rows);
      if (matches.length > 20) break;
    }
    candidates = matches.sort((a, b) => destinationQuality(b) - destinationQuality(a));
  }
  for (const row of candidates) {
    const resolved = publicOrigin(row, input, idx, explicitCode);
    if (resolved) return resolved;
  }
  return null;
}

function budgetUsd(query = {}) {
  if (query.budgetUsd !== undefined && clean(query.budgetUsd)) return Math.max(1, num(query.budgetUsd));
  const rate = currencyToUsdRate(upper(query.currency || 'USD'));
  return Math.max(1, num(query.budget)) * rate;
}

function totalNights(query = {}) {
  const requested = requestedNights(query, {});
  return clamp(Math.round(requested || 6), 4, 14);
}

function currentMonthUtc() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthKey(value) {
  const raw = clean(value);
  if (/^\d{4}-\d{2}/.test(raw)) return raw.slice(0, 7);
  return currentMonthUtc();
}

function addMonths(month, offset) {
  const base = /^\d{4}-\d{2}$/.test(clean(month)) ? clean(month) : currentMonthUtc();
  const d = new Date(`${base}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + Number(offset || 0));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function addDaysIso(dateValue, days) {
  const raw = clean(dateValue).slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : new Date(`${currentMonthUtc()}-15T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(Number(days || 0)));
  return d.toISOString().slice(0, 10);
}

function providerDurationMinutes(value) {
  let n = num(value, 0);
  if (n > 2500 && n < 200000) n /= 60;
  return n > 0 ? Math.round(n) : null;
}

function validatedDestination(row = {}) {
  return !!row && (row.registryDestinationEligible === true || row.trusted500Status === true || row.class === 'TRUSTED_500' || !!foundationFor(row));
}

function productionDestinationEligible(row = {}) {
  if (!validatedDestination(row)) return false;
  if (mvpValidationRepairs669bEnabled() && verifiedActivationEnabled() && !liveRecommendationEligible(row)) return false;
  return true;
}

async function scanProviderDestinations(originCode, startMonth, months = 6, limit = 80) {
  if (!providerDiscoveryEnabled() || !process.env.TRAVELPAYOUTS_TOKEN || String(process.env.GLOBEVOY_USE_MOCKS || '').toLowerCase() === 'true') {
    return { supported: false, reason: 'provider-discovery-unavailable', observations: [], scannedMonths: [] };
  }
  const scanMonths = Array.from({ length: Math.max(1, Math.min(6, Number(months) || 6)) }, (_, index) => addMonths(startMonth || currentMonthUtc(), index));
  const results = await Promise.allSettled(scanMonths.map(month => fetchTravelpayoutsCandidates({ originCode, month, limit })));
  const bestByDestination = new Map();
  let providerResponseCount = 0;
  for (let index = 0; index < results.length; index += 1) {
    const settled = results[index];
    if (settled.status !== 'fulfilled' || settled.value?.source !== 'travelpayouts') continue;
    providerResponseCount += 1;
    for (const candidate of Array.isArray(settled.value.candidates) ? settled.value.candidates : []) {
      const code = safeCode(candidate.destination_city_iata || candidate.destinationCode || candidate.code);
      const fareUsd = num(candidate.normalizedFlightUsd || candidate.value, 0);
      if (!code || fareUsd <= 0) continue;
      const observation = {
        destinationCode: code,
        fareUsd,
        departureDate: clean(candidate.departure_at).slice(0, 10) || null,
        durationMinutes: providerDurationMinutes(candidate.trip_duration || candidate.duration),
        bookingLink: candidate.bookingLink || null,
        source: 'travelpayouts-one-way-discovery',
        scanMonth: scanMonths[index]
      };
      const current = bestByDestination.get(code);
      if (!current || observation.fareUsd < current.fareUsd) bestByDestination.set(code, observation);
    }
  }
  const observations = [...bestByDestination.values()].sort((a, b) => a.fareUsd - b.fareUsd || String(a.departureDate).localeCompare(String(b.departureDate)));
  return {
    supported: providerResponseCount > 0 && observations.length > 0,
    reason: observations.length ? null : 'no-provider-destination-observations',
    source: providerResponseCount ? 'travelpayouts' : null,
    providerResponseCount,
    scannedMonths: scanMonths,
    observations
  };
}

function stopCount(query = {}, budget = 0, nights = 6) {
  const cap = maxStopsForTrip({ ...query, nights }, { totalNights: nights });
  if (nights >= 8 && budget >= 1800) return Math.min(3, cap);
  return Math.min(2, cap);
}

function allocateNights(nights, count) {
  const total = Math.max(count * 2, Math.round(nights));
  if (count === 2) {
    const first = Math.ceil(total / 2);
    return [first, total - first];
  }
  if (count === 3) {
    const out = [3, 3, 2];
    let sum = 8;
    let i = 0;
    while (sum < total) { out[i % 3] += 1; sum += 1; i += 1; }
    while (sum > total) {
      const floors = [3, 3, 2];
      const j = out.findIndex((value, index) => value > floors[index]);
      if (j < 0) break;
      out[j] -= 1; sum -= 1;
    }
    return out;
  }
  return Array(count).fill(2);
}

function regionBase(row) {
  return NIGHTLY_USD_BY_REGION[macroRegion(recordCountryName(row, indexes()))] || NIGHTLY_USD_BY_REGION.unknown;
}

function nightlyUsd(row) {
  const idx = indexes();
  const foundation = idx.foundationByCode.get(preferredAirport(row)) || idx.foundationByNameCountry.get(`${normalize(row.canonicalCityName)}|${upper(row.countryCode)}`);
  if (foundation) {
    const cluster = foundation.multiCitySuitability?.regionCluster;
    const depth = foundation.providerSupport?.hotel?.depth || foundation.multiCitySuitability?.hotelDepth || 'standard';
    const clusterMap = {
      'central-europe': 88, 'east-asia': 82, 'eastern-europe': 70,
      'mexico-central-america-caribbean': 76, 'middle-east': 86, 'north-africa': 58,
      'north-america-east': 118, 'north-america-west': 124, 'northern-europe': 108,
      oceania: 118, 'south-america': 66, 'south-asia': 48, 'southeast-asia': 52,
      'southern-europe': 84, 'sub-saharan-africa': 72, 'western-europe': 98
    };
    const base = clusterMap[cluster] || regionBase(row);
    const depthMul = depth === 'very-strong' ? 0.92 : depth === 'strong' ? 0.96 : depth === 'limited' ? 1.08 : 1;
    return round5(base * depthMul);
  }
  const qualityMul = row.trusted500Status === true ? 1.03 : 0.94;
  return round5(regionBase(row) * qualityMul);
}

function transportEstimate(from, to) {
  const km = haversineKm(from, to);
  const sameCountry = upper(from.countryCode) === upper(to.countryCode);
  if (sameCountry && km <= 650) {
    return { mode: 'ground', transportType: km <= 250 ? 'rail-or-bus' : 'rail-or-bus', distanceKm: Math.round(km), costUsd: round5(clamp(22 + km * 0.13, 25, 125)) };
  }
  let cost;
  if (km < 700) cost = 55 + km * 0.075;
  else if (km < 1800) cost = 78 + km * 0.055;
  else if (km < 4000) cost = 110 + km * 0.043;
  else if (km < 8500) cost = 170 + km * 0.037;
  else cost = 245 + km * 0.032;
  return { mode: 'flight', transportType: 'flight', distanceKm: Math.round(km), costUsd: round5(clamp(cost, 60, 560)) };
}

function foundationFor(row = {}) {
  const idx = indexes();
  const code = preferredAirport(row);
  return idx.foundationByCode.get(code) || idx.foundationByNameCountry.get(`${normalize(row.canonicalCityName)}|${upper(row.countryCode)}`) || null;
}

function groupRole(row = {}) {
  return row.unifiedRegistry?.group || foundationFor(row)?.group || (row.trusted500Status ? 'GROUP_1' : 'UNKNOWN');
}

function destinationRecord(row, nights) {
  const idx = indexes();
  const airportCode = preferredAirport(row);
  const country = recordCountryName(row, idx);
  const foundation = foundationFor(row);
  const nightly = nightlyUsd(row);
  const verifiedActivation = row.verifiedActivation || activationForCity(row, { includeEvidence: false });
  return {
    cityId: row.unifiedRegistry?.cityId || foundation?.cityId || `global-destination-${upper(row.cityCode || airportCode).toLowerCase()}`,
    city: row.canonicalCityName,
    displayCity: row.canonicalCityName,
    country,
    countryCode: upper(row.countryCode),
    code: airportCode,
    airportCode,
    airportCodes: Array.from(new Set([airportCode, ...(row.flightableAirportCodes || []).map(upper).filter(Boolean)])),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    group: row.unifiedRegistry?.group || foundation?.group || (row.trusted500Status ? 'GROUP_1' : 'GROUP_2'),
    groupSubtype: row.unifiedRegistry?.groupSubtype || foundation?.groupSubtype || (row.trusted500Status ? 'familiar-anchor' : 'automatic-hidden-value-discovery'),
    regionCluster: foundation?.multiCitySuitability?.regionCluster || macroRegion(country),
    nights,
    hotel: {
      provider: 'Agoda',
      providerCityId: row.unifiedRegistry?.providers?.agoda?.cityId || foundation?.providerSupport?.hotel?.cityId || null,
      hotelCoverageCount: row.unifiedRegistry?.providers?.agoda?.hotelCount || foundation?.providerSupport?.hotel?.hotelCount || 0,
      coverageDepth: foundation?.providerSupport?.hotel?.depth || null,
      estimatedNightlyUsd: nightly,
      estimatedStayUsd: nightly * nights,
      estimateSource: 'global-route-graph-hotel-planning-estimate-665b',
      livePriceVerified: false,
      name: `${row.canonicalCityName} central value stay`,
      reviewSummary: 'Guest review and live rate are confirmed on the partner website.',
      providerCapabilityVerified: verifiedActivation.liveRecommendationEligible === true,
      exactRateVerificationRequired: true
    },
    replaceable: true,
    removable: true,
    globalRouteGraphTier: row.unifiedRegistry?.selectionTier || (row.trusted500Status ? 'trusted-anchor' : 'automatic-discovery'),
    registryValidationStatus: row.unifiedRegistry?.validation?.status || null,
    verifiedActivationStatus: verifiedActivation.auditStatus,
    liveRecommendationEligible: verifiedActivation.liveRecommendationEligible === true,
    recommendationMode: verifiedActivation.recommendationMode,
    productionActivation: verifiedActivation.activation || null
  };
}

function routeDistance(origin, rows) {
  const nodes = [origin, ...rows, origin];
  return nodes.slice(0, -1).reduce((sum, node, i) => sum + haversineKm(node, nodes[i + 1]), 0);
}

function shortestTwoStopDistance(origin, a, b) {
  return Math.min(
    haversineKm(origin, a) + haversineKm(a, b) + haversineKm(b, origin),
    haversineKm(origin, b) + haversineKm(b, a) + haversineKm(a, origin)
  );
}

function pairCoherence(origin, a, b) {
  const ordered = haversineKm(origin, a) + haversineKm(a, b) + haversineKm(b, origin);
  const shortest = shortestTwoStopDistance(origin, a, b);
  const ratio = shortest > 0 ? ordered / shortest : 1;
  const between = haversineKm(a, b);
  const regionA = macroRegion(recordCountryName(a, indexes()));
  const regionB = macroRegion(recordCountryName(b, indexes()));
  const compatible = (REGION_NEIGHBOURS[regionA] || new Set([regionA])).has(regionB);
  return { ratio, between, regionA, regionB, compatible };
}

function estimateRoute(origin, rows, nightsAllocation, query = {}) {
  const party = normalizeParty(query);
  const nodes = [origin, ...rows, origin];
  const legs = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const raw = transportEstimate(nodes[i], nodes[i + 1]);
    const multiplier = raw.mode === 'flight' ? party.flightFareUnits : party.travellers;
    legs.push({ ...raw, unitCostUsd: raw.costUsd, costUsd: Math.round(raw.costUsd * multiplier), pricingMultiplier: multiplier });
  }
  const transport = legs.reduce((sum, leg) => sum + leg.costUsd, 0);
  const hotels = rows.reduce((sum, row, i) => sum + nightlyUsd(row) * nightsAllocation[i] * party.rooms, 0);
  return {
    total: Math.round(transport + hotels),
    transport: Math.round(transport),
    hotels: Math.round(hotels),
    legs,
    party,
    roomCount: party.rooms
  };
}

function maxAnchorDistanceKm(budget, nights) {
  if (nights <= 7 && budget < 1800) return 4500;
  if (nights <= 7 && budget < 2600) return 6500;
  if (nights <= 10 && budget < 1800) return 6000;
  if (nights <= 10 && budget < 3000) return 8500;
  return 11500;
}

function anchorScore(row, origin, budget, nights) {
  const idx = indexes();
  const distance = haversineKm(origin, row);
  const trusted = row.trusted500Status === true || row.class === 'TRUSTED_500';
  const sameCountry = upper(row.countryCode) === upper(origin.countryCode);
  const originRegion = macroRegion(origin.country);
  const destinationRegion = macroRegion(recordCountryName(row, idx));
  const regionCompatible = (REGION_NEIGHBOURS[originRegion] || new Set([originRegion])).has(destinationRegion);
  const targetMax = maxAnchorDistanceKm(budget, nights);
  const regionalTarget = {
    'north-america': 2900,
    'latin-america-caribbean': 2200,
    europe: 1700,
    'mena-caucasus': 1900,
    asia: 1500,
    oceania: 2100,
    'sub-saharan-africa': 2200
  }[originRegion] || 2000;
  const targetDistance = budget < 900 ? Math.min(1000, regionalTarget) : budget < 1800 ? regionalTarget : budget < 2600 ? regionalTarget * 1.45 : regionalTarget * 2;
  const tooFarPenalty = Math.max(0, distance - targetMax) / 35;
  const tooNearPenalty = budget >= 1300 && distance < 350 ? (350 - distance) / 5 : 0;
  const distanceSweet = Math.max(-80, 78 - Math.abs(distance - targetDistance) / 32);
  const quality = destinationQuality(row);
  const internationalBonus = sameCountry ? (budget < 900 ? 5 : -35) : 35;
  const regionPenalty = regionCompatible ? 30 : (budget < 2200 ? -220 : -70);
  const foundation = foundationFor(row);
  const groupBonus = groupRole(row) === 'GROUP_1' ? 45 : 0;
  const anchorSubtype = String(foundation?.groupSubtype || '').toLowerCase();
  const anchorBonus = foundation?.initialLaunchSet === true ? 32 : 0;
  const subtypeBonus = anchorSubtype.includes('famous') ? 28 : anchorSubtype.includes('airport-hub') ? 24 : anchorSubtype === 'anchor' ? 14 : 0;
  const hotelCountBonus = Math.min(28, Math.log10(Math.max(1, num(foundation?.providerSupport?.hotel?.hotelCount, 1))) * 9);
  const readinessBonus = num(foundation?.multiCitySuitability?.readinessScore, 70) * 0.18;
  const hotelPenalty = nightlyUsd(row) * Math.max(2, Math.floor(nights / 2)) / 28;
  return quality + distanceSweet + internationalBonus + regionPenalty + groupBonus + anchorBonus + subtypeBonus + hotelCountBonus + readinessBonus - tooFarPenalty - tooNearPenalty - hotelPenalty;
}

function anchorPool(origin, budget, nights) {
  const idx = indexes();
  const originCodes = new Set([origin.code, origin.airportCode, ...(origin.airportCodes || [])].map(upper).filter(Boolean));
  const originRegion = macroRegion(origin.country);
  const allowed = REGION_NEIGHBOURS[originRegion] || new Set([originRegion]);
  const rows = idx.trusted
    .filter(row => productionDestinationEligible(row))
    .filter(row => !originCodes.has(preferredAirport(row)))
    .filter(row => groupRole(row) === 'GROUP_1')
    .filter(row => haversineKm(origin, row) >= 120)
    .filter(row => haversineKm(origin, row) <= maxAnchorDistanceKm(budget, nights))
    .filter(row => budget >= 2200 || allowed.has(macroRegion(recordCountryName(row, idx))))
    .map(row => ({ row, score: anchorScore(row, origin, budget, nights), distance: haversineKm(origin, row) }))
    .sort((a, b) => b.score - a.score || a.distance - b.distance);
  const selected = [];
  const seen = new Set();
  const perRegion = new Map();
  function add(row) {
    const key = preferredAirport(row) || row.catalogueId;
    if (!key || seen.has(key)) return;
    selected.push(row); seen.add(key);
  }
  for (const item of rows) {
    const region = macroRegion(recordCountryName(item.row, idx));
    const count = perRegion.get(region) || 0;
    if (count >= 14) continue;
    add(item.row);
    perRegion.set(region, count + 1);
    if (selected.length >= 42) break;
  }
  // Add nearby major anchors so a medium-budget origin can discover coherent
  // regional routes rather than only the globally highest-scoring hubs.
  rows.slice().sort((a, b) => a.distance - b.distance).slice(0, 14).forEach(item => add(item.row));
  return selected.slice(0, 52);
}

function secondStopPool(origin, anchor, budget, nights) {
  const idx = indexes();
  const anchorRegion = macroRegion(recordCountryName(anchor, idx));
  const anchorGroup = groupRole(anchor);
  const candidates = idx.trusted
    .filter(row => productionDestinationEligible(row))
    .filter(row => row !== anchor)
    .filter(row => preferredAirport(row) !== preferredAirport(anchor))
    .filter(row => preferredAirport(row) !== origin.airportCode)
    .filter(row => groupRole(row) === 'GROUP_1' || groupRole(row) === 'GROUP_2')
    .map(row => {
      const coherence = pairCoherence(origin, anchor, row);
      const differentCountry = upper(row.countryCode) !== upper(anchor.countryCode);
      const rowGroup = groupRole(row);
      const mixedGroup = anchorGroup !== rowGroup;
      const betweenFit = coherence.between >= 120 && coherence.between <= (budget >= 2200 ? 2200 : 1500);
      const compatible = coherence.compatible || (coherence.regionA === anchorRegion && coherence.regionB === anchorRegion);
      const score = destinationQuality(row)
        + (differentCountry ? 35 : -12)
        + (mixedGroup ? 36 : 8)
        + (rowGroup === 'GROUP_2' ? 20 : 10)
        + (betweenFit ? 42 : -Math.abs(coherence.between - 650) / 28)
        + (compatible ? 35 : -100)
        - Math.max(0, coherence.ratio - 1.2) * 220
        - nightlyUsd(row) * 0.1;
      return { row, score, coherence };
    })
    .filter(item => item.coherence.between >= 80 && item.coherence.between <= 2400)
    .filter(item => item.coherence.ratio <= 1.48)
    .filter(item => item.coherence.compatible)
    .sort((a, b) => b.score - a.score);
  return candidates.slice(0, 40).map(item => item.row);
}

function thirdStopPool(origin, a, b, budget) {
  const idx = indexes();
  const regions = new Set([macroRegion(recordCountryName(a, idx)), macroRegion(recordCountryName(b, idx))]);
  return idx.trusted
    .filter(row => productionDestinationEligible(row))
    .filter(row => ![preferredAirport(a), preferredAirport(b), origin.airportCode].includes(preferredAirport(row)))
    .filter(row => regions.has(macroRegion(recordCountryName(row, idx))))
    .map(row => {
      const d1 = haversineKm(b, row);
      const d2 = haversineKm(row, origin);
      const direct = haversineKm(b, origin);
      const detour = direct > 0 ? (d1 + d2) / direct : 1;
      const score = destinationQuality(row) + (upper(row.countryCode) !== upper(b.countryCode) ? 22 : 0) - Math.abs(d1 - 550) / 25 - Math.max(0, detour - 1.45) * 120;
      return { row, score, d1, detour };
    })
    .filter(item => item.d1 >= 100 && item.d1 <= 1400 && item.detour <= 1.8)
    .sort((x, y) => y.score - x.score)
    .slice(0, 18)
    .map(item => item.row);
}

function buildTour(origin, rows, query, nightsAllocation, estimate, score, theme, providerDiscovery = null) {
  const stops = rows.map((row, i) => destinationRecord(row, nightsAllocation[i]));
  const verifiedActiveStopCount = stops.filter(stop => stop.liveRecommendationEligible === true).length;
  const estimateOnlyStopCount = stops.length - verifiedActiveStopCount;
  const originPublic = {
    ...origin,
    isOrigin: true,
    evidenceLabel: origin.gatewayAirport ? `Nearest practical airport: ${origin.gatewayAirport.airportCode}` : 'Flightable origin city'
  };
  const nodes = [originPublic, ...stops, originPublic];
  const providerLegs = Array.isArray(providerDiscovery?.legs) ? providerDiscovery.legs : [];
  const legs = estimate.legs.map((leg, i) => {
    const evidence = providerLegs[i] || null;
    const providerFareApplied = !!evidence && Number(evidence.fareUsd) > 0;
    const durationMinutes = providerDurationMinutes(evidence?.durationMinutes) || null;
    const estimatedTransportUsd = providerFareApplied ? providerFarePartyTotalUsd(evidence.fareUsd, query) : leg.costUsd;
    return {
      legNumber: i + 1,
      from: {
        cityId: nodes[i].cityId, city: nodes[i].city, country: nodes[i].country,
        countryCode: nodes[i].countryCode, code: nodes[i].code, airportCode: nodes[i].airportCode,
        latitude: nodes[i].latitude, longitude: nodes[i].longitude
      },
      to: {
        cityId: nodes[i + 1].cityId, city: nodes[i + 1].city, country: nodes[i + 1].country,
        countryCode: nodes[i + 1].countryCode, code: nodes[i + 1].code, airportCode: nodes[i + 1].airportCode,
        latitude: nodes[i + 1].latitude, longitude: nodes[i + 1].longitude
      },
      mode: leg.mode,
      transportType: leg.transportType,
      distanceKm: leg.distanceKm,
      durationMinutes,
      estimatedDoorToDoorHours: estimateLegTravelHours({ ...leg, durationMinutes }, leg.distanceKm),
      estimatedTransportUsd,
      estimatedFlightUsd: leg.mode === 'flight' ? estimatedTransportUsd : 0,
      pricingIntegrity: {
        version: 'GV-MVP-666A',
        unitAmountUsd: providerFareApplied ? Math.round(Number(evidence.fareUsd)) : Number(leg.unitCostUsd || leg.costUsd || 0),
        unitBasis: leg.mode === 'flight' ? 'per-passenger-flight-fare' : 'per-traveller-transfer',
        partyTotalUsd: estimatedTransportUsd
      },
      estimateSource: providerFareApplied ? 'travelpayouts-provider-route-discovery-665b' : (leg.mode === 'flight' ? 'global-route-graph-flight-planning-estimate-665b' : 'global-route-graph-transfer-planning-estimate-665b'),
      liveFareVerified: providerFareApplied,
      providerObservation: providerFareApplied ? {
        source: evidence.source || 'travelpayouts-one-way-discovery',
        departureDate: evidence.departureDate || null,
        amountUsd: Math.round(Number(evidence.fareUsd)),
        perPassengerAmountUsd: Math.round(Number(evidence.fareUsd)),
        partyTotalAmountUsd: estimatedTransportUsd,
        bookingLink: evidence.bookingLink || null
      } : null,
      providerVerificationRequired: !providerFareApplied
    };
  });
  const budget = budgetUsd(query);
  const reserve = Math.round(budget * RESERVE_PERCENT);
  const id = `gv665b-${upper(origin.airportCode).toLowerCase()}-${rows.map(r => upper(r.cityCode || preferredAirport(r)).toLowerCase()).join('-')}`;
  const raw = {
    tourId: id,
    routeId: id,
    tourRole: theme === 'hidden-value' ? 'most-memorable' : 'best-balance',
    tourRoleLabel: theme === 'hidden-value' ? 'Most memorable' : 'Best balance',
    recommendationLabel: theme === 'hidden-value' ? 'Hidden-value route' : 'Coherent value route',
    routeTheme: theme,
    origin: originPublic,
    stops,
    legs,
    totalNights: stops.reduce((sum, stop) => sum + stop.nights, 0),
    totalDistanceKm: Math.round(routeDistance(origin, rows)),
    totalFlightEstimateUsd: estimate.transport,
    totalTransportEstimateUsd: estimate.transport,
    totalHotelEstimateUsd: estimate.hotels,
    estimatedTotalUsd: estimate.total,
    totalBudgetUsd: budget,
    reservePercent: RESERVE_PERCENT,
    reserveAmountUsd: reserve,
    usableTripBudgetUsd: budget - reserve,
    amountLeftUsd: budget - estimate.total,
    affordabilityStatus: estimate.total <= budget ? 'within-budget' : 'over-budget',
    pricingStatus: 'global-route-graph-665b-provider-first-planning-fallback',
    selectionSource: 'on-demand-provider-aware-global-route-graph-665b',
    evidenceLabel: 'Generated route',
    providerVerificationRequired: true,
    affordabilityClaim: providerLegs.filter(Boolean).length >= Math.max(1, legs.filter(leg => leg.mode === 'flight').length - 1)
      ? 'provider-supported-budget-estimate'
      : 'estimated-to-fit-budget',
    routeConfidence: {
      level: providerLegs.filter(Boolean).length ? 'provider-informed' : 'planning-estimate',
      providerDiscoveredLegCount: providerLegs.filter(Boolean).length,
      totalLegCount: legs.length,
      travelTimeGuardApplied: true,
      exactBookablePriceClaimed: false,
      passengerPricingApplied: true,
      adults: normalizeParty(query).adults,
      children: normalizeParty(query).children,
      rooms: normalizeParty(query).rooms,
      verifiedActivationApplied: verifiedActivationEnabled(),
      verifiedActiveStopCount,
      estimateOnlyStopCount,
      exactItineraryVerificationStillRequired: true
    },
    globalRouteGraph: {
      enabled: true,
      version: GLOBAL_ROUTE_GRAPH_VERSION,
      generatedWithoutManualRouteTemplate: true,
      originResolutionType: origin.originResolutionType,
      gatewayAirport: origin.gatewayAirport || null,
      candidateScore: Math.round(score)
    },
    mapCoordinates: [
      { type: 'origin', cityId: originPublic.cityId, city: originPublic.city, latitude: originPublic.latitude, longitude: originPublic.longitude },
      ...stops.map(stop => ({ type: 'stop', cityId: stop.cityId, city: stop.city, latitude: stop.latitude, longitude: stop.longitude })),
      { type: 'return', cityId: originPublic.cityId, city: originPublic.city, latitude: originPublic.latitude, longitude: originPublic.longitude }
    ],
    routeExplanation: [
      'Globevoy generated this route automatically from the global city and airport graph; no fixed itinerary template was used.',
      'The route passed trip-length, travel-time, usable-destination-time, geography, airport and budget checks before AI curation.',
      'Provider-discovered flight legs are used when available; unverified flights and stays remain clearly labelled as planning estimates.',
      verifiedActivationEnabled()
        ? `${verifiedActiveStopCount} of ${stops.length} stops are in the imported 668J provider-capability allowlist; all exact itinerary prices remain subject to final verification.`
        : 'Verified city activation is disabled, so the earlier discovery behavior is preserved.'
    ],
    editableActions: { removeStop: stops.length > 2, replaceStop: true, addStop: stops.length < maxStopsForTrip(query, { totalNights: stops.reduce((s, x) => s + x.nights, 0) }), reorderStops: false, undo: true }
  };
  return attachTourPresentation(raw, query);
}

function routeScore(origin, rows, estimate, budget, coherence, theme) {
  const utilization = estimate.total / Math.max(1, budget);
  const budgetScore = utilization <= 1 ? 110 - Math.abs(0.78 - utilization) * 100 : -300 - (utilization - 1) * 500;
  const countryDiversity = new Set(rows.map(r => upper(r.countryCode))).size * 28;
  const trustedCount = rows.filter(r => r.trusted500Status === true).length;
  const discoveryCount = rows.length - trustedCount;
  const discoveryScore = Math.min(40, discoveryCount * 22);
  const coherenceScore = coherence ? (coherence.compatible ? 40 : -80) - Math.max(0, coherence.ratio - 1.15) * 160 : 20;
  const distance = routeDistance(origin, rows);
  const reachScore = Math.min(75, distance / 180);
  const themeScore = theme === 'hidden-value' ? 20 : 10;
  return budgetScore + countryDiversity + trustedCount * 20 + discoveryScore + coherenceScore + reachScore + themeScore;
}


function providerObservationRow(observation = {}) {
  const idx = indexes();
  const row = idx.byCode.get(safeCode(observation.destinationCode));
  if (!productionDestinationEligible(row)) return null;
  if (!mvpValidationRepairs669bEnabled() && verifiedActivationEnabled() && !liveRecommendationEligible(row)) return null;
  return row;
}

function providerCandidateScore(observation, row, origin, budget, nights, query = {}) {
  const fareShare = providerFarePartyTotalUsd(observation.fareUsd, query) / Math.max(1, budget);
  const distance = haversineKm(origin, row);
  const durationMinutes = providerDurationMinutes(observation.durationMinutes);
  const travelHours = estimateLegTravelHours({ mode: 'flight', durationMinutes }, distance);
  return destinationQuality(row)
    + Math.max(-80, 75 - fareShare * 135)
    + Math.min(55, distance / 160)
    - Math.max(0, travelHours - (nights <= 5 ? 7 : 10)) * 18
    - nightlyUsd(row) * 0.08;
}

function providerEvidenceForPair(firstObservation, secondObservation) {
  return {
    source: 'travelpayouts-provider-driven-route-discovery-665b',
    legs: [
      firstObservation ? { ...firstObservation, source: 'travelpayouts-one-way-discovery' } : null,
      secondObservation ? { ...secondObservation, source: 'travelpayouts-one-way-discovery' } : null,
      null
    ]
  };
}

async function generateProviderDrivenCandidates(query = {}) {
  if (!providerDiscoveryEnabled()) return { tours: [], diagnostics: { enabled: false, version: GLOBAL_ROUTE_GRAPH_VERSION } };
  const origin = resolveAnyOrigin(query.origin || query.originCode || query.from || query.startingCity);
  if (!origin) return { tours: [], diagnostics: { enabled: true, version: GLOBAL_ROUTE_GRAPH_VERSION, reason: 'origin-not-resolved' } };
  // GV-PERF-R4: response-only wall-clock breakdown for the provider-driven graph.
  // It records existing awaits and CPU work; it does not change scan count/order.
  const providerDrivenStartedR4 = process.hrtime.bigint();
  const elapsedR4 = start => Number(process.hrtime.bigint() - start) / 1e6;
  const performanceR4 = {
    version: 'GV-PERF-R4',
    firstProviderScanMs: 0,
    secondProviderScansMs: 0,
    secondProviderScanCount: 0,
    providerCandidateBuildMs: 0
  };
  const budget = budgetUsd(query);
  const nights = totalNights(query);
  const startMonth = monthKey(query.month || query.departureMonth || query.startMonth);
  const firstProviderScanStartedR4 = process.hrtime.bigint();
  const firstScan = await scanProviderDestinations(origin.airportCode, startMonth, 6, 100);
  performanceR4.firstProviderScanMs = elapsedR4(firstProviderScanStartedR4);
  if (!firstScan.supported) {
    performanceR4.providerCandidateBuildMs = Math.max(0, elapsedR4(providerDrivenStartedR4) - performanceR4.firstProviderScanMs);
    return { tours: [], origin, diagnostics: { enabled: true, version: GLOBAL_ROUTE_GRAPH_VERSION, providerDriven: true, providerAvailable: false, reason: firstScan.reason, scannedMonths: firstScan.scannedMonths || [], performanceR4 } };
  }

  const firstOptions = firstScan.observations
    .map(observation => ({ observation, row: providerObservationRow(observation) }))
    .filter(item => item.row && providerFarePartyTotalUsd(item.observation.fareUsd, query) <= budget * 0.52)
    .map(item => ({ ...item, score: providerCandidateScore(item.observation, item.row, origin, budget, nights, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PROVIDER_FIRST_DESTINATIONS);

  const candidates = [];
  const seen = new Set();
  const pairAllocations = allocateNights(nights, 2);

  for (const first of firstOptions) {
    // A provider-discovered single destination is always a valid comfort fallback.
    const singleRows = [first.row];
    const singleEstimate = estimateRoute(origin, singleRows, [nights], query);
    singleEstimate.transport = Math.round(providerFarePartyTotalUsd(first.observation.fareUsd, query) + singleEstimate.legs[1].costUsd);
    singleEstimate.total = Math.round(singleEstimate.transport + singleEstimate.hotels);
    if (singleEstimate.total <= budget * 1.03) {
      const score = routeScore(origin, singleRows, singleEstimate, budget, null, 'provider-discovered-single') + 45;
      const tour = buildTour(origin, singleRows, query, [nights], singleEstimate, score, 'provider-discovered-single', {
        source: 'travelpayouts-provider-driven-route-discovery-665b',
        legs: [{ ...first.observation, source: 'travelpayouts-one-way-discovery' }, null]
      });
      const guard = evaluateTour(tour, { ...query, nights });
      const key = preferredAirport(first.row);
      if (guard.accepted && key && !seen.has(key)) { candidates.push({ tour: guard.tour, score, anchorKey: key }); seen.add(key); }
    }

    if (maxStopsForTrip({ ...query, nights }, { totalNights: nights }) < 2) continue;
    const nextMonth = monthKey(addDaysIso(first.observation.departureDate, pairAllocations[0]));
    const secondProviderScanStartedR4 = process.hrtime.bigint();
    const secondScan = await scanProviderDestinations(preferredAirport(first.row), nextMonth, PROVIDER_SECOND_LEG_MONTHS, 80);
    performanceR4.secondProviderScanCount += 1;
    performanceR4.secondProviderScansMs += elapsedR4(secondProviderScanStartedR4);
    if (!secondScan.supported) continue;
    const secondOptions = secondScan.observations
      .map(observation => ({ observation, row: providerObservationRow(observation) }))
      .filter(item => item.row)
      .filter(item => preferredAirport(item.row) !== preferredAirport(first.row) && preferredAirport(item.row) !== origin.airportCode)
      .filter(item => providerFarePartyTotalUsd(item.observation.fareUsd, query) <= budget * 0.36)
      .map(item => ({ ...item, coherence: pairCoherence(origin, first.row, item.row) }))
      .filter(item => item.coherence.compatible && item.coherence.ratio <= 1.38)
      .filter(item => {
        if (nights > 5) return true;
        const firstDistance = haversineKm(origin, first.row);
        return firstDistance < 3000 && item.coherence.between <= 900;
      })
      .sort((a, b) => {
        const aScore = destinationQuality(a.row) - a.observation.fareUsd * 0.14 - a.coherence.between * 0.015;
        const bScore = destinationQuality(b.row) - b.observation.fareUsd * 0.14 - b.coherence.between * 0.015;
        return bScore - aScore;
      })
      .slice(0, 8);

    for (const second of secondOptions) {
      const rows = [first.row, second.row];
      const estimate = estimateRoute(origin, rows, pairAllocations, query);
      estimate.transport = Math.round(providerFarePartyTotalUsd(first.observation.fareUsd, query) + providerFarePartyTotalUsd(second.observation.fareUsd, query) + estimate.legs[2].costUsd);
      estimate.total = Math.round(estimate.transport + estimate.hotels);
      if (estimate.total > budget * 1.03) continue;
      const coherence = pairCoherence(origin, first.row, second.row);
      const score = routeScore(origin, rows, estimate, budget, coherence, 'provider-connected-story') + 70;
      const tour = buildTour(origin, rows, query, pairAllocations, estimate, score, 'provider-connected-story', providerEvidenceForPair(first.observation, second.observation));
      const guard = evaluateTour(tour, { ...query, nights });
      if (!guard.accepted) continue;
      const key = rows.map(row => preferredAirport(row)).join('>');
      if (!seen.has(key)) { candidates.push({ tour: guard.tour, score, anchorKey: preferredAirport(first.row) }); seen.add(key); }
    }
  }

  candidates.sort((a, b) => b.score - a.score || num(a.tour.estimatedTotalUsd) - num(b.tour.estimatedTotalUsd));
  performanceR4.providerCandidateBuildMs = Math.max(
    0,
    elapsedR4(providerDrivenStartedR4) - performanceR4.firstProviderScanMs - performanceR4.secondProviderScansMs
  );
  return {
    tours: candidates.slice(0, MAX_CANDIDATES).map(item => item.tour),
    origin,
    diagnostics: {
      enabled: true,
      version: GLOBAL_ROUTE_GRAPH_VERSION,
      providerDriven: true,
      providerAvailable: true,
      scannedMonths: firstScan.scannedMonths,
      firstLegObservationCount: firstScan.observations.length,
      firstDestinationCount: firstOptions.length,
      feasibleProviderConnectedRouteCount: candidates.length,
      fallbackRequired: candidates.length === 0,
      performanceR4
    }
  };
}

async function generateProviderDrivenGlobalRouteCandidates(query = {}) {
  const provider = await generateProviderDrivenCandidates(query);
  const fallbackStartedR4 = process.hrtime.bigint();
  const fallback = generateGlobalRouteCandidates(query);
  const deterministicFallbackMsR4 = Number(process.hrtime.bigint() - fallbackStartedR4) / 1e6;
  const performanceR4 = {
    version: 'GV-PERF-R4',
    firstProviderScanMs: Number(provider.diagnostics?.performanceR4?.firstProviderScanMs || 0),
    secondProviderScansMs: Number(provider.diagnostics?.performanceR4?.secondProviderScansMs || 0),
    secondProviderScanCount: Number(provider.diagnostics?.performanceR4?.secondProviderScanCount || 0),
    providerCandidateBuildMs: Number(provider.diagnostics?.performanceR4?.providerCandidateBuildMs || 0),
    deterministicFallbackMs: deterministicFallbackMsR4
  };
  const combined = [];
  const seen = new Set();
  for (const tour of [...(provider.tours || []), ...(fallback.tours || [])]) {
    const key = (tour.stops || []).map(stop => upper(stop.airportCode || stop.code || stop.city)).join('>');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    combined.push(tour);
    if (combined.length >= MAX_CANDIDATES) break;
  }
  return {
    tours: combined,
    origin: provider.origin || fallback.origin,
    diagnostics: {
      enabled: true,
      version: GLOBAL_ROUTE_GRAPH_VERSION,
      providerDriven: provider.diagnostics || null,
      deterministicFallback: fallback.diagnostics || null,
      combinedFeasibleRouteCount: combined.length,
      performanceR4
    }
  };
}

function generateGlobalRouteCandidates(query = {}) {
  if (!enabled()) return { tours: [], diagnostics: { enabled: false, version: GLOBAL_ROUTE_GRAPH_VERSION } };
  const origin = resolveAnyOrigin(query.origin || query.originCode || query.from || query.startingCity);
  if (!origin) return { tours: [], diagnostics: { enabled: true, version: GLOBAL_ROUTE_GRAPH_VERSION, reason: 'origin-not-resolved' } };
  const budget = budgetUsd(query);
  const nights = totalNights(query);
  const desiredStops = stopCount(query, budget, nights);
  const allocations = allocateNights(nights, desiredStops);
  const anchors = anchorPool(origin, budget, nights);
  const candidates = [];
  const seen = new Set();

  for (const anchor of anchors) {
    const seconds = secondStopPool(origin, anchor, budget, nights);
    let acceptedForAnchor = 0;

    // Always keep a comfortable single-destination candidate. It is a serious
    // fallback when a short trip cannot support an enjoyable multi-city route.
    const singleRows = [anchor];
    const singleAllocation = [nights];
    const singleEstimate = estimateRoute(origin, singleRows, singleAllocation, query);
    if (singleEstimate.total <= budget * 1.03) {
      const singleScore = routeScore(origin, singleRows, singleEstimate, budget, null, 'single-destination-value') - 22;
      const singleTour = buildTour(origin, singleRows, query, singleAllocation, singleEstimate, singleScore, 'single-destination-value');
      const singleGuard = evaluateTour(singleTour, { ...query, nights });
      const singleKey = preferredAirport(anchor);
      if (singleGuard.accepted && singleKey && !seen.has(singleKey)) {
        candidates.push({ tour: singleGuard.tour, score: singleScore, anchorKey: singleKey });
        seen.add(singleKey);
      }
    }
    // GV-PROD-669C: an explicit one-stop recovery must not continue building
    // two-stop deterministic candidates. This lets the generated-tour layer
    // retry a provider-over-budget route with one verified destination rather
    // than rejecting the user's whole request or relaxing the budget.
    if (desiredStops < 2) continue;
    for (const second of seconds.slice(0, 14)) {
      let rows = [anchor, second];
      let nightsAllocation = desiredStops === 2 ? allocations : allocateNights(nights, 2);
      let coherence = pairCoherence(origin, anchor, second);
      let estimate = estimateRoute(origin, rows, nightsAllocation, query);
      if (estimate.total > budget * 1.03) continue;
      const theme = groupRole(second) === 'GROUP_2' || groupRole(anchor) !== groupRole(second) ? 'hidden-value' : 'regional-story';
      let score = routeScore(origin, rows, estimate, budget, coherence, theme);
      let tour = buildTour(origin, rows, query, nightsAllocation, estimate, score, theme);
      let guard = evaluateTour(tour, { ...query, nights });
      if (guard.accepted) {
        const key = rows.map(r => preferredAirport(r)).sort().join('|');
        if (!seen.has(key)) { candidates.push({ tour: guard.tour, score, anchorKey: preferredAirport(anchor) }); seen.add(key); acceptedForAnchor += 1; }
      }

      if (desiredStops >= 3) {
        for (const third of thirdStopPool(origin, anchor, second, budget).slice(0, 7)) {
          rows = [anchor, second, third];
          nightsAllocation = allocations;
          estimate = estimateRoute(origin, rows, nightsAllocation, query);
          if (estimate.total > budget * 1.03) continue;
          const regions = new Set(rows.map(r => macroRegion(recordCountryName(r, indexes()))));
          if (regions.size > 2) continue;
          score = routeScore(origin, rows, estimate, budget, coherence, 'extended-regional-story') - 5;
          tour = buildTour(origin, rows, query, nightsAllocation, estimate, score, 'extended-regional-story');
          guard = evaluateTour(tour, { ...query, nights });
          if (!guard.accepted) continue;
          const key = rows.map(r => preferredAirport(r)).sort().join('|');
          if (!seen.has(key)) { candidates.push({ tour: guard.tour, score, anchorKey: preferredAirport(anchor) }); seen.add(key); acceptedForAnchor += 1; }
        }
      }
      if (acceptedForAnchor >= 4) break;
    }
  }

  candidates.sort((a, b) => b.score - a.score || num(a.tour.estimatedTotalUsd) - num(b.tour.estimatedTotalUsd));
  const diversified = [];
  const perAnchor = new Map();
  for (const item of candidates) {
    const key = item.anchorKey || 'unknown';
    const count = perAnchor.get(key) || 0;
    if (count >= 2) continue;
    diversified.push(item);
    perAnchor.set(key, count + 1);
    if (diversified.length >= MAX_CANDIDATES) break;
  }
  const tours = diversified.map(item => item.tour);
  return {
    tours,
    origin,
    diagnostics: {
      enabled: true,
      version: GLOBAL_ROUTE_GRAPH_VERSION,
      generatedWithoutManualRouteTemplates: true,
      originResolved: true,
      originCity: origin.city,
      originAirportCode: origin.airportCode,
      originResolutionType: origin.originResolutionType,
      gatewayAirport: origin.gatewayAirport || null,
      catalogueCityCount: indexes().rows.length,
      trustedAnchorCount: indexes().trusted.filter(row => row.unifiedRegistry?.selectionTier === 'current-500' || row.trusted500Status === true).length,
      registryDestinationCount: cityRegistryEnabled() ? indexes().registrySelected.length : null,
      automaticDiscoveryCount: indexes().trusted.filter(row => groupRole(row) === 'GROUP_2').length,
      anchorCandidateCount: anchors.length,
      feasibleRouteCandidateCount: tours.length,
      requestedNights: nights,
      desiredStopCount: desiredStops,
      budgetUsd: Math.round(budget),
      verifiedActivationEnabled: verifiedActivationEnabled(),
      verifiedActiveDestinationCount: verifiedActivationEnabled() ? indexes().registrySelected.filter(row => liveRecommendationEligible(row)).length : null
    }
  };
}

module.exports = {
  GLOBAL_ROUTE_GRAPH_VERSION,
  globalRouteGraphEnabled: enabled,
  resolveAnyOrigin,
  generateGlobalRouteCandidates,
  generateProviderDrivenGlobalRouteCandidates,
  _internal: {
    indexes,
    preferredAirport,
    nearestGateway,
    allocateNights,
    transportEstimate,
    nightlyUsd,
    pairCoherence,
    maxAnchorDistanceKm,
    anchorPool,
    secondStopPool,
    scanProviderDestinations,
    generateProviderDrivenCandidates,
    providerObservationRow,
    destinationQuality,
    destinationRecord,
    productionDestinationEligible,
    parseOriginInput,
    mvpValidationRepairs669bEnabled,
    originDisplayIntegrity669fEnabled,
    originCodes,
    originCodeOwnershipScore
  }
};
