'use strict';

// GV-CITY-668A — unified 1,000-city origin + destination registry.
// Static airport/city validation does not imply live fare or hotel inventory.

const registry668A = require('../data/unified-city-registry-1000.json');
const registry668B = require('../data/unified-city-registry-1000-668b.json');
const {
  VERSION: ACTIVATION_VERSION,
  enabled: verifiedActivationEnabled,
  summary: verifiedActivationSummary,
  activationForCity,
  annotateCatalogueRow
} = require('./cities/registry/verified-city-activation');

const VERSION = 'GV-CITY-668B';

function providerMappingEnabled() {
  return String(process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B || '').trim().toLowerCase() === 'true';
}
function activeRegistry() { return providerMappingEnabled() ? registry668B : registry668A; }
function activeVersion() { return providerMappingEnabled() ? 'GV-CITY-668B' : 'GV-CITY-668A'; }

function enabled() {
  return String(process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A || '').trim().toLowerCase() === 'true';
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
function clone(value) { return JSON.parse(JSON.stringify(value)); }

let cache = null;
function indexes() {
  const mode = providerMappingEnabled() ? '668B' : '668A';
  if (cache && cache.mode === mode) return cache.value;
  const registry = activeRegistry();
  const records = Array.isArray(registry.records) ? registry.records.filter(Boolean) : [];
  const byId = new Map();
  const byCatalogueId = new Map();
  const byCode = new Map();
  const byNameCountry = new Map();
  const bySearch = new Map();

  for (const record of records) {
    byId.set(record.cityId, record);
    if (record.catalogueId) byCatalogueId.set(record.catalogueId, record);
    const key = `${normalize(record.displayName)}|${upper(record.countryCode)}`;
    if (!byNameCountry.has(key)) byNameCountry.set(key, record);
    const codes = [
      record.origin?.providerLocationCode,
      record.origin?.preferredAirportCode,
      ...(record.origin?.airportCodes || [])
    ];
    for (const value of codes) {
      const code = safeCode(value);
      if (code && !byCode.has(code)) byCode.set(code, record);
    }
    const tokens = [
      record.displayName,
      record.country,
      record.countryCode,
      record.cityId,
      ...(record.aliases || []),
      ...(record.normalizedSearchNames || [])
    ];
    for (const value of tokens) {
      const token = normalize(value);
      if (!token) continue;
      if (!bySearch.has(token)) bySearch.set(token, []);
      bySearch.get(token).push(record);
    }
  }

  const value = { records, byId, byCatalogueId, byCode, byNameCountry, bySearch };
  cache = { mode, value };
  return value;
}

function publicRecord(record) {
  if (!record) return null;
  const verifiedActivation = activationForCity(record, { includeEvidence: false });
  return {
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    currency: record.currency,
    latitude: record.latitude,
    longitude: record.longitude,
    timeZone: record.timeZone,
    worldRegion: record.worldRegion,
    aliases: record.aliases,
    selectionTier: record.selectionTier,
    group: record.group,
    groupSubtype: record.groupSubtype,
    origin: record.origin,
    destination: record.destination,
    providers: record.providers,
    validation: record.validation,
    verifiedActivation
  };
}

function resolveCity(input, options = {}) {
  const idx = indexes();
  const raw = clean(input);
  if (!raw) return null;
  const countryCode = upper(options.countryCode);
  const directCode = safeCode(raw);
  if (directCode && idx.byCode.has(directCode)) return clone(idx.byCode.get(directCode));
  if (idx.byId.has(raw)) return clone(idx.byId.get(raw));

  const normalized = normalize(raw);
  const codeMatches = [...raw.matchAll(/\b([A-Za-z]{3})\b/g)].map(match => safeCode(match[1])).filter(Boolean);
  for (const code of codeMatches) {
    const result = idx.byCode.get(code);
    if (result && (!countryCode || upper(result.countryCode) === countryCode)) return clone(result);
  }

  const exact = idx.bySearch.get(normalized) || [];
  const exactCountry = exact.find(item => !countryCode || upper(item.countryCode) === countryCode);
  if (exactCountry) return clone(exactCountry);

  const cityPart = normalize(raw.split(',')[0]);
  for (const record of idx.records) {
    if (countryCode && upper(record.countryCode) !== countryCode) continue;
    if (normalize(record.displayName) === cityPart) return clone(record);
  }
  return null;
}

function searchRegistry(query = {}) {
  const idx = indexes();
  const q = normalize(query.q || query.query || '');
  const mode = clean(query.mode || 'all').toLowerCase();
  const tier = clean(query.tier || '').toLowerCase();
  const countryCode = upper(query.countryCode || query.country || '');
  const activationFilter = clean(query.activation || query.verifiedActivation || '').toLowerCase();
  const liveOnly = clean(query.live || query.productionActive || '').toLowerCase() === 'true';
  const retryQueue = clean(query.queue || query.retryQueue || '').toLowerCase();
  const requestedLimit = Number(query.limit || 25);
  const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 25));

  const scored = [];
  for (const record of idx.records) {
    if (mode === 'origin' && record.origin?.eligible !== true) continue;
    if (mode === 'destination' && record.destination?.eligible !== true) continue;
    if (tier && clean(record.selectionTier).toLowerCase() !== tier) continue;
    if (countryCode && upper(record.countryCode) !== countryCode) continue;
    const activation = activationForCity(record, { includeEvidence: false });
    if (liveOnly && activation.liveRecommendationEligible !== true) continue;
    if (retryQueue && !(activation.retryQueues || []).includes(retryQueue)) continue;
    if (activationFilter) {
      const matchesActivation =
        (['active','production-active','verified-active'].includes(activationFilter) && activation.liveRecommendationEligible === true) ||
        (['review','reviewed-inactive','inactive'].includes(activationFilter) && activation.auditStatus === 'reviewed-inactive') ||
        (activationFilter === 'unaudited' && activation.auditStatus === 'unaudited') ||
        (activationFilter === 'estimate-only' && activation.recommendationMode === 'estimate-only') ||
        activation.auditStatus === activationFilter || activation.classification === activationFilter;
      if (!matchesActivation) continue;
    }

    const tokens = [
      record.displayName,
      record.country,
      record.countryCode,
      record.cityId,
      record.origin?.providerLocationCode,
      record.origin?.preferredAirportCode,
      ...(record.origin?.airportCodes || []),
      ...(record.aliases || [])
    ].map(normalize).filter(Boolean);
    if (q && !tokens.some(token => token.length <= 3 ? token === q : (token.includes(q) || q.includes(token)))) continue;

    let score = record.selectionTier === 'current-500' ? 100 : 50;
    if (record.validation?.bothProvidersMapped) score += 20;
    if (verifiedActivationEnabled() && activation.liveRecommendationEligible === true) score += 60;
    else if (verifiedActivationEnabled() && activation.auditStatus === 'reviewed-inactive') score -= 10;
    if (q && normalize(record.displayName) === q) score += 50;
    if (q && tokens.includes(q)) score += 25;
    score += Number(record.destination?.readinessScore || 0) / 10;
    scored.push({ record, score });
  }

  scored.sort((a, b) => b.score - a.score || clean(a.record.displayName).localeCompare(clean(b.record.displayName)) || clean(a.record.country).localeCompare(clean(b.record.country)));
  return {
    ok: true,
    enabled: enabled(),
    version: activeVersion(),
    verifiedActivationVersion: ACTIVATION_VERSION,
    verifiedActivationEnabled: verifiedActivationEnabled(),
    registryVersion: activeRegistry().version,
    query: q,
    mode,
    count: Math.min(limit, scored.length),
    totalMatches: scored.length,
    records: scored.slice(0, limit).map(item => publicRecord(item.record)),
    disclaimer: verifiedActivationEnabled()
      ? 'The registry remains a discovery surface. Only records marked verifiedActivation.liveRecommendationEligible are approved for live recommendation capability; exact itinerary availability is still rechecked.'
      : 'Static registry validation does not guarantee live fares, hotel inventory, or bookability. Partner APIs confirm final availability.'
  };
}

function registrySummary() {
  const registry = activeRegistry();
  return {
    ok: true,
    enabled: enabled(),
    providerMappingEnabled: providerMappingEnabled(),
    version: activeVersion(),
    verifiedActivationVersion: ACTIVATION_VERSION,
    verifiedActivationEnabled: verifiedActivationEnabled(),
    registryVersion: registry.version,
    status: registry.status,
    summary: clone(registry.summary || {}),
    policy: clone(registry.policy || {}),
    verifiedActivation: verifiedActivationSummary(),
    disclaimer: verifiedActivationEnabled()
      ? `The 1,000 records remain discoverable. The imported ${ACTIVATION_VERSION} snapshot marks ${verifiedActivationSummary().summary?.productionActiveCount || 0} as verified-live capability and all reviewed or unaudited cities as estimate-only until exact itinerary verification.`
      : 'The 1,000 records are unified origin/destination candidates. Static provider mappings still require live provider verification before fare, room, or bookability claims.'
  };
}

function findForCatalogueRow(row = {}) {
  const idx = indexes();
  if (row.catalogueId && idx.byCatalogueId.has(row.catalogueId)) return idx.byCatalogueId.get(row.catalogueId);
  for (const value of [row.cityCode, row.providerMetroCode, row.primaryAirportCode, ...(row.flightableAirportCodes || []), ...(row.physicalAirportCodes || [])]) {
    const code = safeCode(value);
    if (code && idx.byCode.has(code)) {
      const record = idx.byCode.get(code);
      if (!row.countryCode || upper(record.countryCode) === upper(row.countryCode)) return record;
    }
  }
  return idx.byNameCountry.get(`${normalize(row.canonicalCityName)}|${upper(row.countryCode)}`) || null;
}

function catalogueRowFromRecord(record, existingRow = null) {
  const row = existingRow ? { ...existingRow } : {};
  const airports = (record.origin?.airportCodes || []).map(safeCode).filter(Boolean);
  Object.assign(row, {
    catalogueId: record.catalogueId || row.catalogueId || `registry:${record.cityId}`,
    canonicalCityName: record.displayName,
    normalizedCityName: normalize(record.displayName),
    cityCode: safeCode(record.origin?.providerLocationCode) || safeCode(record.origin?.preferredAirportCode),
    providerMetroCode: safeCode(record.origin?.providerLocationCode) || safeCode(record.origin?.preferredAirportCode),
    countryCode: upper(record.countryCode),
    countryName: record.country,
    latitude: Number(record.latitude),
    longitude: Number(record.longitude),
    timeZone: record.timeZone || null,
    physicalAirportCodes: airports,
    flightableAirportCodes: airports,
    flightableAirportCount: airports.length,
    primaryAirportCode: safeCode(record.origin?.preferredAirportCode) || airports[0] || null,
    sourceConfidence: record.validation?.sourceConfidence || 'high',
    eligibilityStatus: 'eligible',
    eligibilityReasons: [],
    trusted500Status: record.selectionTier === 'current-500',
    providerSupportStatus: record.validation?.bothProvidersMapped ? 'both-providers-mapped' : 'static-flightable-hotel-pending',
    metadataCompletenessStatus: 'complete',
    class: record.selectionTier === 'current-500' ? 'TRUSTED_500' : 'REGISTRY_1000',
    registryDestinationEligible: record.destination?.eligible === true,
    unifiedRegistry: record
  });
  return annotateCatalogueRow(row, record);
}

function routeGraphSelection(globalRows = []) {
  const idx = indexes();
  const existingByCatalogue = new Map();
  const existingByCode = new Map();
  const existingByNameCountry = new Map();
  for (const row of globalRows) {
    if (row.catalogueId) existingByCatalogue.set(row.catalogueId, row);
    for (const value of [row.cityCode, row.providerMetroCode, row.primaryAirportCode, ...(row.flightableAirportCodes || []), ...(row.physicalAirportCodes || [])]) {
      const code = safeCode(value);
      if (code && !existingByCode.has(code)) existingByCode.set(code, row);
    }
    existingByNameCountry.set(`${normalize(row.canonicalCityName)}|${upper(row.countryCode)}`, row);
  }

  const selected = [];
  for (const record of idx.records) {
    let row = existingByCatalogue.get(record.catalogueId) || null;
    if (!row) {
      for (const value of [record.origin?.providerLocationCode, record.origin?.preferredAirportCode, ...(record.origin?.airportCodes || [])]) {
        const code = safeCode(value);
        const candidate = code ? existingByCode.get(code) : null;
        if (candidate && upper(candidate.countryCode) === upper(record.countryCode)) { row = candidate; break; }
      }
    }
    if (!row) row = existingByNameCountry.get(`${normalize(record.displayName)}|${upper(record.countryCode)}`) || null;
    selected.push(catalogueRowFromRecord(record, row));
  }
  return selected;
}

module.exports = {
  VERSION,
  cityRegistryEnabled: enabled,
  providerMappingEnabled,
  registrySummary,
  searchRegistry,
  resolveRegistryCity: resolveCity,
  findForCatalogueRow,
  routeGraphSelection,
  _internal: { indexes, catalogueRowFromRecord, normalize, safeCode, activeRegistry, registry668A, registry668B }
};
