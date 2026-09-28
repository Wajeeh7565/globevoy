'use strict';

// GV-REC-702F-D — staging-only preferred-airport QA overlay.
// Mutates only the in-memory GV-CITY-668B registry loaded by the dedicated
// staging Lambda. The committed 1,000-city registry remains immutable.

const registry668B = require('../../../../data/unified-city-registry-1000-668b.json');
const manifest = require('../../../../data/gateway-foundation-corrections-702f-d.json');

const VERSION = 'GV-REC-702F-D';
const FLAG_NAME = 'ENABLE_STAGING_GATEWAY_FOUNDATION_702F_D';
const REGISTRY_FLAG = 'ENABLE_UNIFIED_CITY_REGISTRY_668A';
const MAPPING_FLAG = 'ENABLE_PROVIDER_MAPPING_COMPLETION_668B';
const REQUIRED_STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
const INSTALL_MARK = Symbol.for('globevoy.gv-rec-702f-d.installed');

function clean(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function lower(value) { return clean(value).toLowerCase(); }
function validIata(value) { return /^[A-Z]{3}$/.test(upper(value)); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function normalizeHttpsOrigin(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:') return '';
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    if (parsed.pathname && parsed.pathname !== '/') return '';
    return parsed.origin;
  } catch (_) {
    return '';
  }
}

function enabled(env = process.env) {
  return lower(env[FLAG_NAME]) === 'true'
    && lower(env[REGISTRY_FLAG]) === 'true'
    && lower(env[MAPPING_FLAG]) === 'true'
    && normalizeHttpsOrigin(env.CORS_ORIGIN) === REQUIRED_STAGING_ORIGIN;
}

function corrections() {
  return Array.isArray(manifest.corrections) ? manifest.corrections : [];
}

function byId(registry = registry668B) {
  const records = Array.isArray(registry?.records) ? registry.records : [];
  return new Map(records.filter(Boolean).map(record => [clean(record.cityId), record]));
}

function preflight(registry = registry668B) {
  const records = Array.isArray(registry?.records) ? registry.records : [];
  const index = byId(registry);
  const issues = [];
  const seen = new Set();

  if (records.length !== 1000) issues.push(`expected-1000-registry-records:${records.length}`);
  if (corrections().length !== 9) issues.push(`expected-9-corrections:${corrections().length}`);

  for (const change of corrections()) {
    const cityId = clean(change.cityId);
    if (!cityId || seen.has(cityId)) {
      issues.push(`duplicate-or-missing-city-id:${cityId || 'blank'}`);
      continue;
    }
    seen.add(cityId);
    const record = index.get(cityId);
    if (!record) {
      issues.push(`missing-city:${cityId}`);
      continue;
    }
    if (upper(record.countryCode) !== upper(change.countryCode)) {
      issues.push(`country-mismatch:${cityId}:${record.countryCode}:${change.countryCode}`);
    }
    const currentPreferred = upper(record.origin?.preferredAirportCode);
    const expectedPreferred = upper(change.fromPreferredAirportCode);
    if (currentPreferred !== expectedPreferred) {
      issues.push(`preferred-airport-base-mismatch:${cityId}:${currentPreferred}:${expectedPreferred}`);
    }
    if (!validIata(change.toPreferredAirportCode)) issues.push(`invalid-target-iata:${cityId}`);
    if (upper(change.toPreferredAirportCode) === expectedPreferred) issues.push(`target-equals-source:${cityId}`);
    if (clean(change.triageBucket) !== 'strong-replacement-candidate') issues.push(`wrong-triage-bucket:${cityId}`);
  }

  return { ok: issues.length === 0, version: VERSION, registryRecordCount: records.length, correctionCount: corrections().length, issues };
}

function projectedRecord(record, change) {
  const output = clone(record || {});
  const oldPreferred = upper(change.fromPreferredAirportCode);
  const newPreferred = upper(change.toPreferredAirportCode);
  const existingCodes = Array.isArray(output.origin?.airportCodes) ? output.origin.airportCodes : [];
  const airportCodes = Array.from(new Set([newPreferred, ...existingCodes.map(upper).filter(validIata)]));

  output.origin = {
    ...(output.origin || {}),
    preferredAirportCode: newPreferred,
    airportCodes,
    stagingGatewayFoundation: {
      version: VERSION,
      sourceTriageVersion: manifest.sourceTriageVersion,
      sourceGatewayAuditVersion: manifest.sourceGatewayAuditVersion,
      sourceOurAirportsCommit: manifest.sourceOurAirports?.commit || null,
      sourceOurAirportsBlob: manifest.sourceOurAirports?.gitBlobSha || null,
      previousPreferredAirportCode: oldPreferred,
      preferredAirportCode: newPreferred,
      stagingQaOnly: true,
      providerMappingsChanged: false,
      coordinatesChanged: false,
      existingAirportCodesPreserved: true,
      requiresExactItineraryVerification: true
    }
  };
  return output;
}

function applyToRegistry(registry = registry668B, options = {}) {
  const env = options.env || process.env;
  const force = options.force === true;
  if (!force && !enabled(env)) {
    return { ok: true, version: VERSION, enabled: false, applied: false, appliedCount: 0, changes: [] };
  }

  const check = preflight(registry);
  if (!check.ok) {
    return { ok: false, version: VERSION, enabled: force || enabled(env), applied: false, appliedCount: 0, changes: [], issues: check.issues };
  }

  const index = byId(registry);
  const changes = [];
  for (const change of corrections()) {
    const record = index.get(change.cityId);
    const before = clone(record);
    const after = projectedRecord(record, change);
    Object.keys(record).forEach(key => { delete record[key]; });
    Object.assign(record, after);
    changes.push({
      cityId: change.cityId,
      displayName: change.displayName,
      countryCode: change.countryCode,
      fromPreferredAirportCode: change.fromPreferredAirportCode,
      toPreferredAirportCode: change.toPreferredAirportCode,
      beforeAirportCodes: before.origin?.airportCodes || [],
      afterAirportCodes: after.origin?.airportCodes || []
    });
  }

  return {
    ok: true,
    version: VERSION,
    enabled: true,
    applied: true,
    appliedCount: changes.length,
    changes,
    policy: {
      stagingQaOnly: true,
      committedRegistryChanged: false,
      providerMappingsChanged: false,
      coordinatesChanged: false,
      activationChanged: false,
      automaticProductionPromotionAllowed: false,
      requiresExactItineraryVerification: true
    }
  };
}

function install(options = {}) {
  const registry = options.registry || registry668B;
  const env = options.env || process.env;
  if (registry[INSTALL_MARK]) {
    return { ok: true, version: VERSION, installed: true, alreadyInstalled: true, enabled: enabled(env), appliedCount: registry[INSTALL_MARK].appliedCount || 0 };
  }
  if (!enabled(env)) {
    return { ok: true, version: VERSION, installed: false, alreadyInstalled: false, enabled: false, appliedCount: 0 };
  }

  const result = applyToRegistry(registry, { env });
  if (!result.ok) return { ...result, installed: false, alreadyInstalled: false };

  Object.defineProperty(registry, INSTALL_MARK, {
    value: { version: VERSION, appliedCount: result.appliedCount },
    enumerable: false,
    configurable: false,
    writable: false
  });
  return { ...result, installed: true, alreadyInstalled: false };
}

function status(env = process.env) {
  return {
    ok: true,
    version: VERSION,
    enabled: enabled(env),
    flagName: FLAG_NAME,
    requiredStagingOrigin: REQUIRED_STAGING_ORIGIN,
    correctionCount: corrections().length,
    correctedCityIds: corrections().map(row => row.cityId),
    sourceTriageVersion: manifest.sourceTriageVersion,
    sourceOurAirportsCommit: manifest.sourceOurAirports?.commit || null,
    sourceOurAirportsBlob: manifest.sourceOurAirports?.gitBlobSha || null,
    committedRegistryChanged: false,
    providerMappingsChanged: false,
    coordinatesChanged: false,
    activationChanged: false,
    stagingQaOnly: true,
    requiresExactItineraryVerification: true
  };
}

module.exports = {
  VERSION,
  FLAG_NAME,
  REGISTRY_FLAG,
  MAPPING_FLAG,
  REQUIRED_STAGING_ORIGIN,
  enabled,
  preflight,
  projectedRecord,
  applyToRegistry,
  install,
  status,
  _internal: { registry668B, manifest, corrections, byId, normalizeHttpsOrigin, INSTALL_MARK }
};
