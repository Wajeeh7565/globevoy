'use strict';

// GV-CITY-668B — static provider mapping completion and coverage audit.
// Static mappings are not live fare, room, or bookability verification.

const audit = require('../data/provider-mappings-1000-668b.json');
const VERSION = 'GV-CITY-668B';

function enabled() {
  return String(process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B || '').trim().toLowerCase() === 'true';
}
function clean(value) { return String(value || '').trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function normalize(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

let cache = null;
function indexes() {
  if (cache) return cache;
  const records = Array.isArray(audit.records) ? audit.records.filter(Boolean) : [];
  const byId = new Map(records.map(record => [record.cityId, record]));
  cache = { records, byId };
  return cache;
}
function publicRecord(record) {
  if (!record) return null;
  return {
    cityId: record.cityId, displayName: record.displayName, country: record.country, countryCode: record.countryCode,
    selectionTier: record.selectionTier, latitude: record.latitude, longitude: record.longitude,
    travelpayouts: record.travelpayouts, agoda: record.agoda, coverage: record.coverage
  };
}
function coverageSummary() {
  return {
    ok: true, enabled: enabled(), version: VERSION, status: audit.status, summary: clone(audit.summary || {}),
    sourceAudit: clone(audit.sourceAudit || {}), policy: clone(audit.policy || {}),
    disclaimer: 'Static provider mappings do not guarantee a fare, room, schedule, rate, or bookable result. Live provider verification remains required.'
  };
}
function searchCoverage(query = {}) {
  const q = normalize(query.q || query.query || '');
  const countryCode = upper(query.countryCode || query.country || '');
  const provider = clean(query.provider || 'all').toLowerCase();
  const mappingType = clean(query.mappingType || '').toLowerCase();
  const status = clean(query.status || '').toLowerCase();
  const tier = clean(query.tier || '').toLowerCase();
  const unresolved = clean(query.unresolved || '').toLowerCase() === 'true';
  const requested = Number(query.limit || 25);
  const limit = Math.max(1, Math.min(100, Number.isFinite(requested) ? requested : 25));
  const matches = indexes().records.filter(record => {
    if (countryCode && upper(record.countryCode) !== countryCode) return false;
    if (tier && clean(record.selectionTier).toLowerCase() !== tier) return false;
    if (q && ![record.cityId, record.displayName, record.country, record.countryCode, record.travelpayouts?.locationCode, record.agoda?.feedNames?.join(' ')]
      .map(normalize).some(value => value.includes(q) || q.includes(value))) return false;
    if (provider === 'agoda' && !record.coverage?.agodaMapped) return false;
    if (provider === 'travelpayouts' && !record.coverage?.travelpayoutsMapped) return false;
    if (provider === 'both' && !record.coverage?.bothProvidersMapped) return false;
    if (unresolved && record.coverage?.agodaMapped) return false;
    const providerStatus = provider === 'travelpayouts' ? record.travelpayouts?.status : record.agoda?.status;
    const providerType = provider === 'travelpayouts' ? record.travelpayouts?.mappingType : record.agoda?.mappingType;
    if (status && clean(providerStatus).toLowerCase() !== status) return false;
    if (mappingType && clean(providerType).toLowerCase() !== mappingType) return false;
    return true;
  });
  matches.sort((a,b) => Number(b.coverage?.bothProvidersMapped)-Number(a.coverage?.bothProvidersMapped) || clean(a.displayName).localeCompare(clean(b.displayName)));
  return {
    ok: true, enabled: enabled(), version: VERSION, count: Math.min(limit,matches.length), totalMatches: matches.length,
    records: matches.slice(0,limit).map(publicRecord),
    disclaimer: 'Coverage means a documented static mapping strategy. Final availability and prices are confirmed by live partner calls and partner pages.'
  };
}
function resolveCoverage(cityId) { return clone(indexes().byId.get(clean(cityId)) || null); }

module.exports = { VERSION, providerMappingEnabled: enabled, coverageSummary, searchCoverage, resolveCoverage, _internal: { indexes, audit } };
