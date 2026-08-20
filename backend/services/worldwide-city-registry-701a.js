'use strict';

// GV-DATA-701A — worldwide city-registry overlay.
//
// This service does not create a third destination catalogue. It joins the
// existing worldwide identity/origin catalogue with the curated 1,000-city
// registry and the verified activation layer, while preserving their different
// trust boundaries.
//
// Static city/airport/provider metadata never implies a live fare, live hotel
// inventory, or guaranteed bookability.

const globalCatalogue = require('../data/global-destination-catalogue.json');
const curatedRegistry = require('../data/unified-city-registry-1000-668b.json');
const {
  findForCatalogueRow,
  resolveRegistryCity
} = require('./city-registry');
const {
  VERSION: ACTIVATION_VERSION,
  enabled: verifiedActivationEnabled,
  activationForCity,
  summary: verifiedActivationSummary
} = require('./verified-city-activation');

const VERSION = 'GV-DATA-701A';

function enabled() {
  return String(process.env.ENABLE_WORLDWIDE_CITY_REGISTRY_701A || '').trim().toLowerCase() === 'true';
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
function safeCode(value) {
  const code = upper(value);
  return /^[A-Z]{3}$/.test(code) ? code : null;
}
function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

const worldwideRows = Array.isArray(globalCatalogue.destinations)
  ? globalCatalogue.destinations.filter(Boolean)
  : [];
const curatedRows = Array.isArray(curatedRegistry.records)
  ? curatedRegistry.records.filter(Boolean)
  : [];

let cache = null;
function indexes() {
  if (cache) return cache;

  const byCatalogueId = new Map();
  const byCode = new Map();
  const byNameCountry = new Map();
  const byName = new Map();

  for (const row of worldwideRows) {
    if (row.catalogueId && !byCatalogueId.has(row.catalogueId)) {
      byCatalogueId.set(row.catalogueId, row);
    }

    for (const value of [
      row.cityCode,
      row.providerMetroCode,
      row.primaryAirportCode,
      ...(row.flightableAirportCodes || []),
      ...(row.physicalAirportCodes || [])
    ]) {
      const code = safeCode(value);
      if (!code) continue;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(row);
    }

    const name = normalize(row.canonicalCityName || row.normalizedCityName);
    const countryCode = upper(row.countryCode);
    if (name) {
      const countryKey = `${name}|${countryCode}`;
      if (!byNameCountry.has(countryKey)) byNameCountry.set(countryKey, []);
      byNameCountry.get(countryKey).push(row);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(row);
    }
  }

  cache = { byCatalogueId, byCode, byNameCountry, byName };
  return cache;
}

function rowQuality(row = {}) {
  let score = 0;
  const confidence = clean(row.sourceConfidence).toLowerCase();
  if (confidence === 'verified') score += 50;
  else if (confidence === 'high') score += 35;
  else if (confidence === 'medium') score += 20;
  if (row.eligibilityStatus === 'eligible') score += 25;
  if (row.metadataCompletenessStatus === 'complete') score += 15;
  if ((row.flightableAirportCodes || []).length) score += 20;
  if (safeCode(row.primaryAirportCode)) score += 10;
  return score;
}

function bestWorldwideRow(rows = [], countryCode = '') {
  const cc = upper(countryCode);
  return rows
    .filter(Boolean)
    .filter(row => !cc || upper(row.countryCode) === cc)
    .slice()
    .sort((a, b) => rowQuality(b) - rowQuality(a)
      || clean(a.canonicalCityName).localeCompare(clean(b.canonicalCityName)))[0] || null;
}

function worldwideRowForCurated(record = {}) {
  const idx = indexes();
  if (record.catalogueId && idx.byCatalogueId.has(record.catalogueId)) {
    return idx.byCatalogueId.get(record.catalogueId);
  }

  const countryCode = upper(record.countryCode);
  for (const value of [
    record.origin?.providerLocationCode,
    record.origin?.preferredAirportCode,
    ...(record.origin?.airportCodes || [])
  ]) {
    const code = safeCode(value);
    if (!code) continue;
    const match = bestWorldwideRow(idx.byCode.get(code) || [], countryCode);
    if (match) return match;
  }

  const key = `${normalize(record.displayName)}|${countryCode}`;
  return bestWorldwideRow(idx.byNameCountry.get(key) || [], countryCode);
}

function activationForCurated(record) {
  if (!record) return null;
  const activation = activationForCity(record, { includeEvidence: false });
  const enforced = verifiedActivationEnabled();
  return {
    version: ACTIVATION_VERSION,
    enforced,
    auditStatus: activation.auditStatus,
    recommendationMode: enforced ? activation.recommendationMode : 'feature-controlled',
    liveRecommendationEligible: enforced && activation.liveRecommendationEligible === true,
    classification: activation.classification,
    reviewRecommended: activation.reviewRecommended === true
  };
}

function recommendationTier(curated, activation) {
  if (!curated) return 'origin-only';
  if (activation?.liveRecommendationEligible === true) return 'production-active';
  return 'estimate-only';
}

function publicWorldwideRecord(row, curated = null) {
  if (!row && !curated) return null;
  const source = row || worldwideRowForCurated(curated) || {};
  const activation = activationForCurated(curated);
  const preferredAirportCode = safeCode(curated?.origin?.preferredAirportCode)
    || safeCode(source.primaryAirportCode)
    || safeCode(source.cityCode)
    || null;
  const airportCodes = Array.from(new Set([
    ...(curated?.origin?.airportCodes || []),
    ...(source.flightableAirportCodes || []),
    ...(source.physicalAirportCodes || [])
  ].map(safeCode).filter(Boolean)));

  const displayName = curated?.displayName || source.canonicalCityName || source.normalizedCityName || null;
  const countryCode = upper(curated?.countryCode || source.countryCode) || null;

  return {
    worldwideCityId: curated?.cityId || source.catalogueId || null,
    catalogueId: source.catalogueId || curated?.catalogueId || null,
    cityId: curated?.cityId || null,
    displayName,
    country: curated?.country || source.countryName || null,
    countryCode,
    currency: curated?.currency || null,
    latitude: finite(curated?.latitude ?? source.latitude),
    longitude: finite(curated?.longitude ?? source.longitude),
    timeZone: curated?.timeZone || source.timeZone || null,
    identity: {
      tier: 'worldwide',
      source: 'global-destination-catalogue',
      sourceConfidence: source.sourceConfidence || null,
      metadataCompletenessStatus: source.metadataCompletenessStatus || null
    },
    origin: {
      eligible: curated?.origin?.eligible !== false && (
        curated?.origin?.eligible === true
        || source.eligibilityStatus === 'eligible'
        || airportCodes.length > 0
      ),
      providerLocationCode: safeCode(curated?.origin?.providerLocationCode)
        || safeCode(source.providerMetroCode)
        || safeCode(source.cityCode)
        || null,
      preferredAirportCode,
      airportCodes,
      requiresGatewayTransfer: curated?.origin?.requiresGatewayTransfer === true,
      gateway: clone(curated?.origin?.gateway || null)
    },
    destination: {
      curated: Boolean(curated),
      curatedTier: curated?.selectionTier || null,
      eligible: curated?.destination?.eligible === true,
      group: curated?.group || null,
      groupSubtype: curated?.groupSubtype || null,
      recommendedMinNights: curated?.destination?.recommendedMinNights ?? null,
      recommendedMaxNights: curated?.destination?.recommendedMaxNights ?? null,
      readinessScore: curated?.destination?.readinessScore ?? null
    },
    providers: curated ? clone(curated.providers || null) : null,
    validation: curated ? clone(curated.validation || null) : null,
    activation,
    recommendation: {
      tier: recommendationTier(curated, activation),
      liveRecommendationEligible: activation?.liveRecommendationEligible === true,
      requiresExactItineraryVerification: true
    }
  };
}

function resolveWorldwideCity(input, options = {}) {
  const raw = clean(input);
  if (!raw) return null;
  const countryCode = upper(options.countryCode);

  const curated = resolveRegistryCity(raw, { countryCode });
  if (curated) return publicWorldwideRecord(worldwideRowForCurated(curated), curated);

  const idx = indexes();
  const exactCode = safeCode(raw);
  if (exactCode) {
    const row = bestWorldwideRow(idx.byCode.get(exactCode) || [], countryCode);
    if (row) return publicWorldwideRecord(row, findForCatalogueRow(row));
  }

  const explicitCodes = [...raw.matchAll(/\(([A-Za-z]{3})\)/g)]
    .map(match => safeCode(match[1]))
    .filter(Boolean);
  for (const code of explicitCodes) {
    const row = bestWorldwideRow(idx.byCode.get(code) || [], countryCode);
    if (row) return publicWorldwideRecord(row, findForCatalogueRow(row));
  }

  const normalized = normalize(raw.split(',')[0]);
  const countryKey = countryCode ? `${normalized}|${countryCode}` : null;
  const row = countryKey
    ? bestWorldwideRow(idx.byNameCountry.get(countryKey) || [], countryCode)
    : bestWorldwideRow(idx.byName.get(normalized) || [], countryCode);
  return row ? publicWorldwideRecord(row, findForCatalogueRow(row)) : null;
}

function matchesQuery(row, q) {
  if (!q) return true;
  const values = [
    row.canonicalCityName,
    row.normalizedCityName,
    row.countryName,
    row.countryCode,
    row.cityCode,
    row.providerMetroCode,
    row.primaryAirportCode,
    ...(row.flightableAirportCodes || []),
    ...(row.physicalAirportCodes || [])
  ].map(normalize).filter(Boolean);
  return values.some(value => value.length <= 3 ? value === q : (value.includes(q) || q.includes(value)));
}

function searchWorldwideRegistry(query = {}) {
  const q = normalize(query.q || query.query || '');
  const countryCode = upper(query.countryCode || query.country || '');
  const scope = clean(query.scope || query.mode || 'all').toLowerCase();
  const requestedLimit = Number(query.limit || 25);
  const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 25));
  const matches = [];

  for (const row of worldwideRows) {
    if (countryCode && upper(row.countryCode) !== countryCode) continue;
    if (!matchesQuery(row, q)) continue;

    const curated = findForCatalogueRow(row);
    if (scope === 'destination' && curated?.destination?.eligible !== true) continue;
    if (scope === 'active') {
      if (!curated) continue;
      const activation = activationForCurated(curated);
      if (activation?.liveRecommendationEligible !== true) continue;
    }
    if (scope === 'origin') {
      const hasAirport = (row.flightableAirportCodes || []).length > 0
        || safeCode(row.primaryAirportCode)
        || curated?.origin?.eligible === true;
      if (!hasAirport) continue;
    }

    const activation = curated ? activationForCurated(curated) : null;
    let score = rowQuality(row);
    if (curated?.selectionTier === 'current-500') score += 100;
    else if (curated) score += 70;
    if (activation?.liveRecommendationEligible === true) score += 150;
    if (q && normalize(curated?.displayName || row.canonicalCityName) === q) score += 80;
    matches.push({ row, curated, score });
  }

  matches.sort((a, b) => b.score - a.score
    || clean(a.curated?.displayName || a.row.canonicalCityName)
      .localeCompare(clean(b.curated?.displayName || b.row.canonicalCityName))
    || upper(a.row.countryCode).localeCompare(upper(b.row.countryCode)));

  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    query: q,
    countryCode: countryCode || null,
    scope,
    count: Math.min(limit, matches.length),
    totalMatches: matches.length,
    records: matches.slice(0, limit).map(item => publicWorldwideRecord(item.row, item.curated)),
    disclaimer: 'Worldwide identity/origin coverage is not the same as destination approval. Only curated records can become destinations, and only verified activation plus exact itinerary checks can support live recommendation claims.'
  };
}

function worldwideRegistrySummary() {
  const countries = new Set();
  let flightableWorldwideCount = 0;
  for (const row of worldwideRows) {
    if (row.countryCode) countries.add(upper(row.countryCode));
    if ((row.flightableAirportCodes || []).length > 0 || safeCode(row.primaryAirportCode)) {
      flightableWorldwideCount += 1;
    }
  }

  const activation = verifiedActivationSummary();
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    worldwideCatalogueVersion: globalCatalogue.version || null,
    curatedRegistryVersion: curatedRegistry.version || null,
    activationVersion: ACTIVATION_VERSION,
    activationEnabled: verifiedActivationEnabled(),
    counts: {
      worldwideIdentityCities: worldwideRows.length,
      worldwideCountriesAndTerritories: countries.size,
      worldwideFlightableOrGatewayCandidates: flightableWorldwideCount,
      curatedDestinationCities: curatedRows.length,
      productionActiveCitiesInSelectedSnapshot: Number(activation.summary?.productionActiveCount || 0)
    },
    layers: {
      worldwide: 'identity and origin-resolution surface',
      curated1000: 'reviewed destination-candidate surface',
      productionActive: 'sampled provider-capability allowlist when activation is enabled',
      itineraryVerification: 'exact route/date/price verification remains mandatory'
    },
    sourceSummary: clone(globalCatalogue.summary || null),
    disclaimer: 'Counts describe registry coverage and sampled capability. They do not guarantee a current fare, hotel room, schedule, or bookable itinerary.'
  };
}

module.exports = {
  VERSION,
  worldwideRegistryEnabled: enabled,
  worldwideRegistrySummary,
  resolveWorldwideCity,
  searchWorldwideRegistry,
  _internal: {
    normalize,
    safeCode,
    rowQuality,
    worldwideRowForCurated,
    publicWorldwideRecord,
    worldwideRows,
    curatedRows
  }
};
