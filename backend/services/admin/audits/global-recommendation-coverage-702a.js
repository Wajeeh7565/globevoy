'use strict';

// GV-REC-702A — deterministic, read-only recommendation coverage audit.
//
// This module answers a narrower question than the recommendation engine:
// "For each curated destination, which reviewed foundation/activation signals
// are present, and what still blocks production-active recommendation status?"
//
// It intentionally uses reviewed static/sampled datasets only. It does NOT call
// Duffel, Travelpayouts, Agoda, Stay22, or any other provider, and it does not
// change ranking, routing, pricing, destination activation, or booking claims.

const registry = require('../../../data/unified-city-registry-1000-668b.json');
const providerMappings = require('../../../data/provider-mappings-1000-668b.json');
const activationSnapshot = require('../../../data/verified-city-activation-1000-668t.json');

const VERSION = 'GV-REC-702A';
const FLAG_NAME = 'ENABLE_GLOBAL_RECOMMENDATION_COVERAGE_AUDIT_702A';

function clean(value) { return String(value || '').trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function lower(value) { return clean(value).toLowerCase(); }
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
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
function safeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
function validLocationCode(value) {
  return /^[A-Z]{3}$/.test(upper(value));
}
function enabled() {
  return lower(process.env[FLAG_NAME]) === 'true';
}

const registryRecords = Array.isArray(registry.records) ? registry.records.filter(Boolean) : [];
const mappingRecords = Array.isArray(providerMappings.records) ? providerMappings.records.filter(Boolean) : [];
const activationRecords = Array.isArray(activationSnapshot.records) ? activationSnapshot.records.filter(Boolean) : [];

const mappingById = new Map(mappingRecords.map(record => [record.cityId, record]));
const activationById = new Map(activationRecords.map(record => [record.cityId, record]));

function routeIdentity(record = {}, activation = null, mapping = null) {
  const providerLocationCode = upper(
    record.origin?.providerLocationCode
      || activation?.providerLocationCode
      || mapping?.travelpayouts?.locationCode
  );
  const preferredAirportCode = upper(record.origin?.preferredAirportCode);
  const gatewayAirportCode = upper(record.origin?.gateway?.airportCode || record.origin?.gateway?.code);
  const usableCodes = [providerLocationCode, preferredAirportCode, gatewayAirportCode]
    .filter(validLocationCode);
  return {
    providerLocationCode: validLocationCode(providerLocationCode) ? providerLocationCode : null,
    preferredAirportCode: validLocationCode(preferredAirportCode) ? preferredAirportCode : null,
    gatewayAirportCode: validLocationCode(gatewayAirportCode) ? gatewayAirportCode : null,
    hasUsableLocationCode: usableCodes.length > 0,
    requiresGatewayTransfer: record.origin?.requiresGatewayTransfer === true
  };
}

function staticMappingState(mapping = null) {
  return {
    travelpayoutsMapped: mapping?.coverage?.travelpayoutsMapped === true,
    agodaMapped: mapping?.coverage?.agodaMapped === true,
    bothProvidersMapped: mapping?.coverage?.bothProvidersMapped === true,
    travelpayoutsStatus: mapping?.travelpayouts?.status || null,
    travelpayoutsMappingType: mapping?.travelpayouts?.mappingType || null,
    agodaStatus: mapping?.agoda?.status || null,
    agodaMappingType: mapping?.agoda?.mappingType || null
  };
}

function activationState(activation = null) {
  if (!activation) {
    return {
      audited: false,
      auditStatus: 'unaudited',
      liveRecommendationEligible: false,
      recommendationMode: 'estimate-only',
      classification: 'not-in-668t-snapshot',
      activationMode: null,
      activationReason: 'not-in-668t-snapshot',
      lastVerifiedAt: null,
      retryQueues: [],
      providerCoverage: null,
      recommendationReadiness: null
    };
  }
  return {
    audited: true,
    auditStatus: activation.auditStatus || null,
    liveRecommendationEligible: activation.liveRecommendationEligible === true,
    recommendationMode: activation.recommendationMode || null,
    classification: activation.classification || null,
    activationMode: activation.activation?.mode || null,
    activationReason: activation.activation?.reason || null,
    lastVerifiedAt: activation.activation?.lastVerifiedAt || null,
    retryQueues: Array.isArray(activation.retryQueues) ? activation.retryQueues.slice() : [],
    providerCoverage: clone(activation.providerCoverage || null),
    recommendationReadiness: clone(activation.recommendationReadiness || null)
  };
}

function gapCodes(record, route, mapping, activation) {
  const gaps = [];
  if (record.destination?.eligible !== true) gaps.push('destination-ineligible');
  if (!route.hasUsableLocationCode) gaps.push('missing-route-identity');
  if (!mapping.travelpayoutsMapped) gaps.push('missing-flight-provider-mapping');
  if (!mapping.agodaMapped) gaps.push('missing-stay-provider-mapping');
  if (!activation.audited) gaps.push('not-in-668t-audit');
  if (activation.audited && !activation.liveRecommendationEligible) gaps.push('reviewed-not-production-active');
  for (const queue of activation.retryQueues) {
    const normalizedQueue = lower(queue).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (normalizedQueue) gaps.push(`retry-queue:${normalizedQueue}`);
  }
  return Array.from(new Set(gaps));
}

function primaryGap(gaps, activation) {
  if (activation.liveRecommendationEligible) return null;
  const precedence = [
    'destination-ineligible',
    'missing-route-identity',
    'missing-flight-provider-mapping',
    'missing-stay-provider-mapping',
    'not-in-668t-audit'
  ];
  for (const code of precedence) {
    if (gaps.includes(code)) return code;
  }
  const retryGap = gaps.find(code => code.startsWith('retry-queue:'));
  if (retryGap) return retryGap;
  return 'reviewed-not-production-active';
}

function readinessTier(record, route, mapping, activation) {
  if (activation.liveRecommendationEligible) return 'production-active';
  const foundationReady = record.destination?.eligible === true
    && route.hasUsableLocationCode
    && mapping.travelpayoutsMapped
    && mapping.agodaMapped;
  if (foundationReady && activation.audited) return 'mapped-reviewed-inactive';
  if (foundationReady) return 'mapped-needs-audit';
  if (record.destination?.eligible === true) return 'foundation-gap';
  return 'not-destination-ready';
}

function auditRecord(record) {
  if (!record) return null;
  const mappingRaw = mappingById.get(record.cityId) || null;
  const activationRaw = activationById.get(record.cityId) || null;
  const route = routeIdentity(record, activationRaw, mappingRaw);
  const mapping = staticMappingState(mappingRaw);
  const activation = activationState(activationRaw);
  const gaps = gapCodes(record, route, mapping, activation);
  const tier = readinessTier(record, route, mapping, activation);

  return {
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    worldRegion: record.worldRegion || null,
    selectionTier: record.selectionTier || null,
    group: record.group || null,
    destination: {
      eligible: record.destination?.eligible === true,
      readinessScore: record.destination?.readinessScore ?? null,
      recommendedMinNights: record.destination?.recommendedMinNights ?? null,
      recommendedMaxNights: record.destination?.recommendedMaxNights ?? null
    },
    route,
    staticProviderMappings: mapping,
    activation,
    readiness: {
      tier,
      productionActive: activation.liveRecommendationEligible,
      primaryGap: primaryGap(gaps, activation),
      gapCodes: gaps,
      activationReason: activation.activationReason,
      classification: activation.classification,
      requiresExactItineraryVerification: true
    }
  };
}

let auditedCache = null;
function auditedRecords() {
  if (!auditedCache) auditedCache = registryRecords.map(auditRecord).filter(Boolean);
  return auditedCache;
}

function increment(map, key) {
  const safeKey = clean(key) || 'unknown';
  map[safeKey] = Number(map[safeKey] || 0) + 1;
}

function summary() {
  const records = auditedRecords();
  const counts = {
    curatedDestinationCities: records.length,
    destinationEligible: 0,
    routeIdentityReady: 0,
    travelpayoutsMapped: 0,
    agodaMapped: 0,
    bothProvidersMapped: 0,
    auditedIn668T: 0,
    productionActive: 0,
    reviewedInactive: 0,
    unaudited: 0,
    gatewayDependent: 0,
    mappedReviewedInactive: 0,
    foundationGap: 0
  };
  const readinessTiers = {};
  const primaryGaps = {};
  const allGapCodes = {};
  const retryQueues = {};
  const regions = {};
  const selectionTiers = {};

  for (const record of records) {
    if (record.destination.eligible) counts.destinationEligible += 1;
    if (record.route.hasUsableLocationCode) counts.routeIdentityReady += 1;
    if (record.staticProviderMappings.travelpayoutsMapped) counts.travelpayoutsMapped += 1;
    if (record.staticProviderMappings.agodaMapped) counts.agodaMapped += 1;
    if (record.staticProviderMappings.bothProvidersMapped) counts.bothProvidersMapped += 1;
    if (record.activation.audited) counts.auditedIn668T += 1;
    else counts.unaudited += 1;
    if (record.readiness.productionActive) counts.productionActive += 1;
    else if (record.activation.audited) counts.reviewedInactive += 1;
    if (record.route.requiresGatewayTransfer) counts.gatewayDependent += 1;
    if (record.readiness.tier === 'mapped-reviewed-inactive') counts.mappedReviewedInactive += 1;
    if (record.readiness.tier === 'foundation-gap') counts.foundationGap += 1;

    increment(readinessTiers, record.readiness.tier);
    if (record.readiness.primaryGap) increment(primaryGaps, record.readiness.primaryGap);
    for (const code of record.readiness.gapCodes) increment(allGapCodes, code);
    for (const queue of record.activation.retryQueues) increment(retryQueues, queue);

    const region = clean(record.worldRegion) || 'unknown';
    if (!regions[region]) regions[region] = { total: 0, productionActive: 0 };
    regions[region].total += 1;
    if (record.readiness.productionActive) regions[region].productionActive += 1;

    const selectionTier = clean(record.selectionTier) || 'unknown';
    if (!selectionTiers[selectionTier]) selectionTiers[selectionTier] = { total: 0, productionActive: 0 };
    selectionTiers[selectionTier].total += 1;
    if (record.readiness.productionActive) selectionTiers[selectionTier].productionActive += 1;
  }

  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    status: enabled() ? 'coverage-audit-ready' : 'feature-disabled',
    sources: {
      curatedRegistryVersion: registry.version || null,
      providerMappingVersion: providerMappings.version || null,
      activationSnapshotVersion: activationSnapshot.version || null,
      activationGeneratedAt: activationSnapshot.generatedAt || null
    },
    counts,
    readinessTiers,
    primaryGaps,
    allGapCodes,
    retryQueues,
    regions,
    selectionTiers,
    expansionMath: {
      currentlyProductionActive: counts.productionActive,
      curatedButNotProductionActive: counts.curatedDestinationCities - counts.productionActive,
      mappedReviewedInactive: counts.mappedReviewedInactive,
      note: 'Mapped/reviewed inactive cities are candidates for targeted re-audit, not automatic activation.'
    },
    disclaimer: '702A is a deterministic coverage audit over reviewed registry, static mapping, and sampled activation evidence. It does not prove a current fare, hotel room, schedule, visa outcome, or bookable itinerary.'
  };
}

function matchesText(record, query) {
  if (!query) return true;
  const exactCodes = [
    record.cityId,
    record.countryCode,
    record.route.providerLocationCode,
    record.route.preferredAirportCode,
    record.route.gatewayAirportCode
  ].map(normalize).filter(Boolean);
  if (exactCodes.includes(query)) return true;
  const text = [record.displayName, record.country, record.worldRegion, record.selectionTier, record.group]
    .map(normalize).filter(Boolean);
  return text.some(value => value.includes(query) || query.includes(value));
}

function search(query = {}) {
  const q = normalize(query.q || query.query || '');
  const countryCode = upper(query.countryCode || query.country || '');
  const region = lower(query.region || query.worldRegion || '');
  const selectionTier = lower(query.tier || query.selectionTier || '');
  const readiness = lower(query.readiness || query.readinessTier || '');
  const gap = lower(query.gap || query.primaryGap || '');
  const active = lower(query.active || query.productionActive || '');
  const mapped = lower(query.mapped || query.bothProvidersMapped || '');
  const gateway = lower(query.gateway || query.requiresGatewayTransfer || '');
  const offset = safeInt(query.offset, 0, 0, registryRecords.length);
  const limit = safeInt(query.limit, 50, 1, 200);

  const matches = auditedRecords().filter(record => {
    if (countryCode && upper(record.countryCode) !== countryCode) return false;
    if (region && lower(record.worldRegion) !== region) return false;
    if (selectionTier && lower(record.selectionTier) !== selectionTier) return false;
    if (readiness && lower(record.readiness.tier) !== readiness) return false;
    if (gap && lower(record.readiness.primaryGap) !== gap && !record.readiness.gapCodes.map(lower).includes(gap)) return false;
    if (active === 'true' && !record.readiness.productionActive) return false;
    if (active === 'false' && record.readiness.productionActive) return false;
    if (mapped === 'true' && !record.staticProviderMappings.bothProvidersMapped) return false;
    if (mapped === 'false' && record.staticProviderMappings.bothProvidersMapped) return false;
    if (gateway === 'true' && !record.route.requiresGatewayTransfer) return false;
    if (gateway === 'false' && record.route.requiresGatewayTransfer) return false;
    if (!matchesText(record, q)) return false;
    return true;
  });

  matches.sort((a, b) => Number(b.readiness.productionActive) - Number(a.readiness.productionActive)
    || Number(b.staticProviderMappings.bothProvidersMapped) - Number(a.staticProviderMappings.bothProvidersMapped)
    || clean(a.displayName).localeCompare(clean(b.displayName))
    || upper(a.countryCode).localeCompare(upper(b.countryCode)));

  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    offset,
    count: Math.min(limit, Math.max(0, matches.length - offset)),
    totalMatches: matches.length,
    records: clone(matches.slice(offset, offset + limit)),
    disclaimer: 'Search exposes audit evidence only. An inactive record must not be promoted without the later activation and exact-itinerary verification gates.'
  };
}

function resolve(input, options = {}) {
  const raw = clean(input);
  if (!raw) return null;
  const countryCode = upper(options.countryCode);
  const normalized = normalize(raw);
  const exactCode = upper(raw);

  const matches = auditedRecords().filter(record => {
    if (countryCode && upper(record.countryCode) !== countryCode) return false;
    if (record.cityId === raw) return true;
    if (validLocationCode(exactCode) && [
      record.route.providerLocationCode,
      record.route.preferredAirportCode,
      record.route.gatewayAirportCode
    ].includes(exactCode)) return true;
    return normalize(record.displayName) === normalized;
  });

  if (matches.length === 1) return clone(matches[0]);
  if (matches.length > 1 && countryCode) return clone(matches[0]);
  return null;
}

module.exports = {
  VERSION,
  FLAG_NAME,
  enabled,
  summary,
  search,
  resolve,
  _internal: {
    registry,
    providerMappings,
    activationSnapshot,
    registryRecords,
    mappingRecords,
    activationRecords,
    mappingById,
    activationById,
    routeIdentity,
    staticMappingState,
    activationState,
    gapCodes,
    primaryGap,
    readinessTier,
    auditRecord,
    auditedRecords
  }
};
