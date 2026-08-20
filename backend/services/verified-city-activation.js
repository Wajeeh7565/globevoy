'use strict';

// GV-CITY-668T — complete 1,000-city activation snapshot after importing the
// strict GV-CITY-668S Inactive City Recovery Wave 1 audit. The recovery audit
// activated 18 additional cities without relaxing provider, stay-quality, or
// flight-comfort thresholds. Exact route/date/price verification still runs
// through the existing GV-LIVE-667A/667B layers.

const USE_668T = String(process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T || '').trim().toLowerCase() === 'true';
const USE_668R = String(process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668R || '').trim().toLowerCase() === 'true';
const USE_668P = String(process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668P || '').trim().toLowerCase() === 'true';
const USE_668N = String(process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668N || '').trim().toLowerCase() === 'true';
const activationSnapshot = USE_668T
  ? require('../data/verified-city-activation-1000-668t.json')
  : USE_668R
    ? require('../data/verified-city-activation-1000-668r.json')
    : USE_668P
      ? require('../data/verified-city-activation-845-668p.json')
      : USE_668N
        ? require('../data/verified-city-activation-695-668n.json')
        : require('../data/verified-city-activation-545-668l.json');
const retrySnapshot = USE_668T
  ? require('../data/verified-city-retry-queues-668t.json')
  : USE_668R
    ? require('../data/verified-city-retry-queues-668r.json')
    : USE_668P
      ? require('../data/verified-city-retry-queues-668p.json')
      : USE_668N
        ? require('../data/verified-city-retry-queues-668n.json')
        : require('../data/verified-city-retry-queues-668l.json');
const registry = require('../data/unified-city-registry-1000-668b.json');

const VERSION = USE_668T ? 'GV-CITY-668T' : USE_668R ? 'GV-CITY-668R' : USE_668P ? 'GV-CITY-668P' : USE_668N ? 'GV-CITY-668N' : 'GV-CITY-668L';
const FLAG_NAME = USE_668T ? 'ENABLE_VERIFIED_CITY_ACTIVATION_668T' : USE_668R ? 'ENABLE_VERIFIED_CITY_ACTIVATION_668R' : USE_668P ? 'ENABLE_VERIFIED_CITY_ACTIVATION_668P' : USE_668N ? 'ENABLE_VERIFIED_CITY_ACTIVATION_668N' : 'ENABLE_VERIFIED_CITY_ACTIVATION_668L';
const STATUS_SUFFIX = USE_668T ? '668t' : USE_668R ? '668r' : USE_668P ? '668p' : USE_668N ? '668n' : '668l';

function clean(value) { return String(value || '').trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function lower(value) { return clean(value).toLowerCase(); }
function normalize(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
function safeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
function enabled() {
  return lower(process.env[FLAG_NAME]) === 'true';
}

const auditedRecords = Array.isArray(activationSnapshot.records) ? activationSnapshot.records.filter(Boolean) : [];
const registryRecords = Array.isArray(registry.records) ? registry.records.filter(Boolean) : [];
const byId = new Map(auditedRecords.map(record => [record.cityId, record]));
const registryById = new Map(registryRecords.map(record => [record.cityId, record]));
const byNameCountry = new Map();
const byCode = new Map();
for (const record of auditedRecords) {
  byNameCountry.set(`${normalize(record.displayName)}|${upper(record.countryCode)}`, record);
  const codes = [record.providerLocationCode, record.evidence?.travelpayouts?.destinationCode];
  for (const value of codes) {
    const code = upper(value);
    if (/^[A-Z]{3}$/.test(code) && !byCode.has(code)) byCode.set(code, record);
  }
}

function resolveAuditedRecord(input, options = {}) {
  if (!input) return null;
  if (typeof input === 'object') {
    const id = input.unifiedRegistry?.cityId || input.verifiedActivation?.cityId || input.cityId || input.id;
    if (id && byId.has(id)) return byId.get(id);
    const countryCode = upper(input.countryCode || input.unifiedRegistry?.countryCode || options.countryCode);
    const name = input.displayName || input.canonicalCityName || input.city || input.displayCity || input.unifiedRegistry?.displayName;
    const key = `${normalize(name)}|${countryCode}`;
    if (byNameCountry.has(key)) return byNameCountry.get(key);
    for (const value of [input.cityCode, input.providerMetroCode, input.primaryAirportCode, input.airportCode, input.code]) {
      const code = upper(value);
      const match = byCode.get(code);
      if (match && (!countryCode || upper(match.countryCode) === countryCode)) return match;
    }
    return null;
  }
  const raw = clean(input);
  if (byId.has(raw)) return byId.get(raw);
  const code = upper(raw);
  if (/^[A-Z]{3}$/.test(code) && byCode.has(code)) return byCode.get(code);
  const countryCode = upper(options.countryCode);
  const key = `${normalize(raw)}|${countryCode}`;
  if (countryCode && byNameCountry.has(key)) return byNameCountry.get(key);
  const matches = auditedRecords.filter(record => normalize(record.displayName) === normalize(raw));
  return matches.length === 1 ? matches[0] : null;
}

function evidenceAgeDays(lastVerifiedAt) {
  const time = Date.parse(clean(lastVerifiedAt));
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function publicAuditedRecord(record, includeEvidence = true) {
  if (!record) return null;
  const ageDays = evidenceAgeDays(record.activation?.lastVerifiedAt);
  const reviewAfterDays = Number(activationSnapshot.policy?.reviewAfterDays || 30);
  return {
    cityId: record.cityId,
    displayName: record.displayName,
    country: record.country,
    countryCode: record.countryCode,
    selectionTier: record.selectionTier,
    worldRegion: record.worldRegion,
    providerLocationCode: record.providerLocationCode,
    auditStatus: record.auditStatus,
    discoveryEligible: true,
    liveRecommendationEligible: record.liveRecommendationEligible === true,
    recommendationMode: record.recommendationMode,
    classification: record.classification,
    activation: clone(record.activation),
    evidenceAgeDays: ageDays,
    reviewRecommended: Number.isFinite(ageDays) ? ageDays > reviewAfterDays : true,
    retryQueues: clone(record.retryQueues || []),
    providerCoverage: clone(record.providerCoverage || null),
    recommendationReadiness: clone(record.recommendationReadiness || null),
    evidence: includeEvidence ? clone(record.evidence || null) : undefined,
    disclaimer: 'Activation proves sampled provider capability, not a current exact price or guaranteed bookability.'
  };
}

function unauditedStatus(registryRecord = null) {
  return {
    cityId: registryRecord?.cityId || null,
    displayName: registryRecord?.displayName || null,
    country: registryRecord?.country || null,
    countryCode: registryRecord?.countryCode || null,
    selectionTier: registryRecord?.selectionTier || null,
    worldRegion: registryRecord?.worldRegion || null,
    providerLocationCode: registryRecord?.origin?.providerLocationCode || null,
    auditStatus: 'unaudited',
    discoveryEligible: true,
    liveRecommendationEligible: false,
    recommendationMode: 'estimate-only',
    classification: 'unaudited',
    activation: {
      eligible: false,
      mode: 'inactive',
      reason: `not-in-imported-${STATUS_SUFFIX}-audit-snapshot`,
      policyVersion: VERSION,
      sourcePolicyVersion: null,
      lastVerifiedAt: null
    },
    evidenceAgeDays: null,
    reviewRecommended: true,
    retryQueues: [],
    providerCoverage: null,
    recommendationReadiness: null,
    evidence: null,
    disclaimer: 'This city remains discoverable as an estimate-only candidate until a production-provider audit is imported.'
  };
}

function activationForCity(input, options = {}) {
  const audited = resolveAuditedRecord(input, options);
  if (audited) return publicAuditedRecord(audited, options.includeEvidence !== false);
  let registryRecord = null;
  if (typeof input === 'object') {
    const id = input.unifiedRegistry?.cityId || input.cityId || input.id;
    if (id) registryRecord = registryById.get(id) || null;
  } else if (registryById.has(clean(input))) {
    registryRecord = registryById.get(clean(input));
  }
  return unauditedStatus(registryRecord);
}

function liveRecommendationEligible(input, options = {}) {
  // Flag-off is a full rollback: earlier behavior is preserved rather than
  // silently blocking all destinations.
  if (!enabled()) return true;
  return activationForCity(input, { ...options, includeEvidence: false }).liveRecommendationEligible === true;
}

function annotateRegistryRecord(record) {
  if (!record) return record;
  const activation = activationForCity(record, { includeEvidence: false });
  return {
    ...record,
    verifiedActivation: activation,
    destination: {
      ...(record.destination || {}),
      discoveryEligible: record.destination?.eligible === true,
      liveRecommendationEligible: enabled() ? activation.liveRecommendationEligible === true : null,
      recommendationMode: enabled() ? activation.recommendationMode : 'feature-disabled'
    }
  };
}

function annotateCatalogueRow(row, registryRecord = null) {
  if (!row) return row;
  const activation = activationForCity(registryRecord || row, { includeEvidence: false });
  if (!enabled()) {
    return {
      ...row,
      verifiedActivationStatus: 'feature-disabled',
      liveRecommendationEligible: null,
      recommendationMode: 'feature-disabled'
    };
  }
  return {
    ...row,
    verifiedActivation: activation,
    verifiedActivationStatus: activation.auditStatus,
    liveRecommendationEligible: activation.liveRecommendationEligible === true,
    recommendationMode: activation.recommendationMode,
    providerSupportStatus: activation.liveRecommendationEligible
      ? `verified-live-provider-capability-${STATUS_SUFFIX}`
      : activation.auditStatus === 'reviewed-inactive'
        ? `audited-estimate-only-${STATUS_SUFFIX}`
        : `unaudited-estimate-only-${STATUS_SUFFIX}`
  };
}

function summary() {
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    snapshotVersion: activationSnapshot.version,
    status: activationSnapshot.status,
    generatedAt: activationSnapshot.generatedAt,
    sourceAudits: clone(activationSnapshot.sourceAudits),
    summary: clone(activationSnapshot.summary),
    policy: clone(activationSnapshot.policy),
    disclaimer: `The ${activationSnapshot.summary?.productionActiveCount || 0}-city allowlist records sampled provider capability from the imported ${Array.isArray(activationSnapshot.sourceAudits) ? activationSnapshot.sourceAudits.map(item => item.taskId).join(', ') : 'reviewed'} audits. Every user itinerary still requires exact route/date/price verification before live claims.`
  };
}

function matchesStatus(status, activation) {
  if (!status || status === 'all') return true;
  if (['active', 'production-active', 'verified-active', 'live'].includes(status)) return activation.liveRecommendationEligible === true;
  if (['review', 'reviewed-inactive', 'inactive'].includes(status)) return activation.auditStatus === 'reviewed-inactive';
  if (status === 'unaudited') return activation.auditStatus === 'unaudited';
  if (status === 'audited') return activation.auditStatus !== 'unaudited';
  if (status === 'estimate-only') return activation.recommendationMode === 'estimate-only';
  if (status === 'gateway-supported') return activation.activation?.mode === 'gateway-supported';
  if (status === 'direct-or-metro') return activation.activation?.mode === 'direct-or-metro';
  return activation.auditStatus === status || activation.classification === status;
}

function search(query = {}) {
  const q = normalize(query.q || query.query || '');
  const countryCode = upper(query.countryCode || query.country || '');
  const tier = lower(query.tier || '');
  const status = lower(query.status || query.activation || '');
  const queue = lower(query.queue || query.retryQueue || '');
  const includeEvidence = lower(query.includeEvidence || '') === 'true';
  const requested = safeInt(query.limit, 25, 1, 100);

  const matches = [];
  for (const registryRecord of registryRecords) {
    const activation = activationForCity(registryRecord, { includeEvidence });
    if (countryCode && upper(registryRecord.countryCode) !== countryCode) continue;
    if (tier && lower(registryRecord.selectionTier) !== tier) continue;
    if (!matchesStatus(status, activation)) continue;
    if (queue && !(activation.retryQueues || []).includes(queue)) continue;
    if (q) {
      const values = [registryRecord.cityId, registryRecord.displayName, registryRecord.country, registryRecord.countryCode,
        registryRecord.origin?.providerLocationCode, ...(registryRecord.aliases || [])].map(normalize).filter(Boolean);
      if (!values.some(value => value.length <= 3 ? value === q : (value.includes(q) || q.includes(value)))) continue;
    }
    matches.push(activation);
  }

  matches.sort((a, b) => Number(b.liveRecommendationEligible) - Number(a.liveRecommendationEligible)
    || (a.auditStatus === 'reviewed-inactive' ? -1 : 0) - (b.auditStatus === 'reviewed-inactive' ? -1 : 0)
    || clean(a.displayName).localeCompare(clean(b.displayName)));

  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    count: Math.min(requested, matches.length),
    totalMatches: matches.length,
    records: matches.slice(0, requested),
    disclaimer: 'Search results distinguish verified-live capability from reviewed or unaudited estimate-only discovery candidates.'
  };
}

function retryQueues() {
  return {
    ok: true,
    enabled: enabled(),
    version: VERSION,
    generatedAt: retrySnapshot.generatedAt,
    reviewCityCount: retrySnapshot.reviewCityCount,
    queueMembershipCanOverlap: retrySnapshot.queueMembershipCanOverlap,
    queues: clone(retrySnapshot.queues),
    disclaimer: 'Retry queues are operational worklists. They do not imply that a mapping is wrong or that inventory never exists.'
  };
}

module.exports = {
  VERSION,
  enabled,
  summary,
  search,
  retryQueues,
  activationForCity,
  liveRecommendationEligible,
  annotateRegistryRecord,
  annotateCatalogueRow,
  _internal: {
    activationSnapshot,
    retrySnapshot,
    registry,
    auditedRecords,
    registryRecords,
    byId,
    byCode,
    byNameCountry,
    resolveAuditedRecord,
    publicAuditedRecord,
    unauditedStatus,
    evidenceAgeDays,
    matchesStatus
  }
};
