'use strict';

const cityIntelligenceArtifact = require('./data/city-intelligence-510c.json');

const ANCHOR_ROLES = new Set([
  'group1-famous-anchor',
  'group1-airport-hub',
  'group1-anchor',
  'group1'
]);

const DISCOVERY_ROLES = new Set([
  'group2-hidden-gem-value',
  'group2-secondary',
  'group2-candidate',
  'group2-discovery',
  'group2'
]);

const PREFERENCE_ALIASES = Object.freeze({
  nature: 'nature',
  outdoor: 'nature',
  outdoors: 'nature',
  food: 'food',
  cuisine: 'food',
  culture: 'culture',
  historic: 'culture',
  history: 'culture',
  beach: 'beach',
  coast: 'beach',
  coastal: 'beach',
  nightlife: 'nightlife',
  'night-life': 'nightlife',
  relaxed: 'relaxation',
  relax: 'relaxation',
  relaxation: 'relaxation'
});

function normalizedText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stableSlug(value) {
  return normalizedText(value).replace(/\s+/g, '-');
}

function cityCountryKey(city, country) {
  return `${normalizedText(city)}|${normalizedText(country)}`;
}

const INTELLIGENCE_BY_ID = new Map();
const INTELLIGENCE_BY_CITY_COUNTRY = new Map();

for (const record of cityIntelligenceArtifact.records || []) {
  if (record.cityId) INTELLIGENCE_BY_ID.set(String(record.cityId).toLowerCase(), record);
  INTELLIGENCE_BY_CITY_COUNTRY.set(cityCountryKey(record.city, record.country), record);
}

function normalizeGroupRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (ANCHOR_ROLES.has(role)) return 'group1-anchor';
  if (DISCOVERY_ROLES.has(role)) return 'group2-discovery';
  return 'unknown';
}

function normalizePreference(value) {
  const raw = normalizedText(value).replace(/\s+/g, '-');
  if (!raw || raw === 'any' || raw === 'none' || raw === 'neutral' || raw === 'no-preference') return null;
  return PREFERENCE_ALIASES[raw] || null;
}

function parseDaysRange(value) {
  const values = String(value || '').match(/\d+(?:\.\d+)?/g);
  if (!values || !values.length) return null;
  const numbers = values.map(Number).filter(Number.isFinite);
  if (!numbers.length) return null;
  const minDays = Math.max(1, Math.round(numbers[0]));
  const maxDays = Math.max(minDays, Math.round(numbers[1] ?? numbers[0]));
  return {
    minNights: Math.max(2, minDays - 1),
    maxNights: Math.max(2, maxDays - 1),
    source: 'destination-days-field'
  };
}

function explicitPositiveInteger(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function resolveDuration(destination, record) {
  const hardMinimumNights = explicitPositiveInteger(
    destination.hardMinimumNights,
    destination.minimumRequiredNights,
    destination.minimumStayNights
  );

  const recordMin = explicitPositiveInteger(record?.recommendedMinNights);
  const recordMax = explicitPositiveInteger(record?.recommendedMaxNights);
  if (recordMin && recordMax && recordMax >= recordMin) {
    return {
      hardMinimumNights,
      recommendedMinNights: recordMin,
      recommendedMaxNights: recordMax,
      source: 'canonical-city-intelligence'
    };
  }

  const destinationMin = explicitPositiveInteger(destination.recommendedMinNights, destination.minimumSuggestedNights);
  const destinationMax = explicitPositiveInteger(destination.recommendedMaxNights, destination.maximumSuggestedNights);
  if (destinationMin && destinationMax && destinationMax >= destinationMin) {
    return {
      hardMinimumNights,
      recommendedMinNights: destinationMin,
      recommendedMaxNights: destinationMax,
      source: 'structured-destination-duration'
    };
  }

  const parsedRange = parseDaysRange(destination.days);
  if (parsedRange) {
    return {
      hardMinimumNights,
      recommendedMinNights: parsedRange.minNights,
      recommendedMaxNights: parsedRange.maxNights,
      source: parsedRange.source
    };
  }

  const typicalNights = explicitPositiveInteger(destination.nights);
  if (typicalNights) {
    return {
      hardMinimumNights,
      recommendedMinNights: Math.max(2, typicalNights - 1),
      recommendedMaxNights: typicalNights + 1,
      source: 'destination-typical-nights'
    };
  }

  return {
    hardMinimumNights,
    recommendedMinNights: null,
    recommendedMaxNights: null,
    source: 'unavailable'
  };
}

function boundedThemeScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(5, parsed));
}

function normalizeThemeScores(record, destination) {
  const canonical = {};
  for (const theme of ['nature', 'food', 'culture', 'beach', 'nightlife', 'relaxation']) {
    canonical[theme] = boundedThemeScore(record?.themeScores?.[theme]);
  }

  // Only explicit structured tags may be used as a legacy fallback. Narrative
  // fields such as theme, localCost, walkability and marketing copy are never
  // consulted here.
  if (Object.values(canonical).every(value => value === null)) {
    const tags = new Set((Array.isArray(destination.styleTags) ? destination.styleTags : [])
      .map(normalizePreference)
      .filter(Boolean));
    for (const theme of Object.keys(canonical)) canonical[theme] = tags.has(theme) ? 4 : null;
    return { values: canonical, source: tags.size ? 'structured-style-tags' : 'unavailable' };
  }

  return { values: canonical, source: 'canonical-city-intelligence' };
}

function normalizeClusterCode(value) {
  const code = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code || null;
}

function resolveMetroClusterId(destination, canonicalCityId) {
  const code = normalizeClusterCode(
    destination.metroClusterId ||
    destination.travelpayoutsLocationCode ||
    destination.travelpayoutsCityCode ||
    destination.code
  );
  return code ? `metro:${code}` : `city:${canonicalCityId}`;
}

function resolveGatewayClusterId(destination, canonicalCityId) {
  const candidateCodes = [
    destination.gatewayClusterId,
    destination.primaryAirportCode,
    destination.nearestMajorAirportCode,
    ...(Array.isArray(destination.travelpayoutsAirportCodes) ? destination.travelpayoutsAirportCodes : []),
    destination.code
  ].map(normalizeClusterCode).filter(Boolean);
  return candidateCodes.length ? `gateway:${candidateCodes[0]}` : `city:${canonicalCityId}`;
}

function resolveProviderMapping(destination) {
  const travelpayoutsStatus = String(destination.providerCoverage?.travelpayouts?.status || '').toLowerCase();
  const agodaStatus = String(destination.providerCoverage?.agoda?.status || destination.agodaCoverageStatus || '').toLowerCase();
  const flightExplicit = destination.providerAvailability?.flight;
  const hotelExplicit = destination.providerAvailability?.hotel;

  const flightMapped = flightExplicit === true || destination.travelpayoutsMappingAvailable === true ||
    Boolean(destination.travelpayoutsLocationCode || destination.travelpayoutsCityCode || destination.code) ||
    ['strong', 'partial', 'verified'].includes(travelpayoutsStatus);
  const hotelMapped = hotelExplicit === true || destination.agodaMappingAvailable === true ||
    Number.isFinite(Number(destination.agodaCityId)) || ['strong', 'partial', 'verified'].includes(agodaStatus);

  return {
    flightMapped,
    hotelMapped,
    travelpayoutsStatus: travelpayoutsStatus || 'unknown',
    agodaStatus: agodaStatus || 'unknown'
  };
}

function getCityIntelligence(destination = {}) {
  const directId = String(destination.globevoyCityId || destination.cityId || '').trim().toLowerCase();
  const record = (directId && INTELLIGENCE_BY_ID.get(directId)) ||
    INTELLIGENCE_BY_CITY_COUNTRY.get(cityCountryKey(destination.city, destination.country)) ||
    null;
  const canonicalCityId = directId || record?.cityId || stableSlug(`${destination.city || 'unknown'}-${destination.country || 'unknown'}`);
  const duration = resolveDuration(destination, record);
  const themes = normalizeThemeScores(record, destination);
  const providerMapping = resolveProviderMapping(destination);

  return {
    canonicalCityId,
    groupRole: normalizeGroupRole(destination.groupRole),
    groupRoleSource: destination.groupRole ? 'destination-group-role' : 'missing',
    countryKey: normalizedText(destination.country) || 'unknown',
    metroClusterId: resolveMetroClusterId(destination, canonicalCityId),
    gatewayClusterId: resolveGatewayClusterId(destination, canonicalCityId),
    themeScores: themes.values,
    themeSource: themes.source,
    hardMinimumNights: duration.hardMinimumNights,
    recommendedMinNights: duration.recommendedMinNights,
    recommendedMaxNights: duration.recommendedMaxNights,
    durationSource: duration.source,
    publicTransitPracticality: boundedThemeScore(record?.publicTransitPracticality),
    typicalTripPace: record?.typicalTripPace || null,
    providerMapping,
    intelligenceRecordFound: Boolean(record)
  };
}

function groupRoleCounts(destinations) {
  return (Array.isArray(destinations) ? destinations : []).reduce((counts, destination) => {
    const role = normalizeGroupRole(destination?.groupRole);
    counts[role] += 1;
    return counts;
  }, {
    'group1-anchor': 0,
    'group2-discovery': 0,
    unknown: 0
  });
}

module.exports = {
  cityIntelligenceArtifact,
  getCityIntelligence,
  groupRoleCounts,
  normalizeGroupRole,
  normalizePreference,
  parseDaysRange,
  stableSlug
};
