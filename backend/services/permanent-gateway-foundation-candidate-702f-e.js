'use strict';

const fs = require('fs');
const path = require('path');
const baseRegistry = require('../data/unified-city-registry-1000-668b.json');
const sourceCorrections = require('../data/gateway-foundation-corrections-702f-d.json');
const manifest = require('../data/gateway-foundation-permanent-candidate-702f-e.json');

const VERSION = 'GV-REC-702F-E';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function upper(value) { return clean(value).toUpperCase(); }
function validIata(value) { return /^[A-Z]{3}$/.test(upper(value)); }

function corrections() {
  return Array.isArray(sourceCorrections.corrections) ? sourceCorrections.corrections : [];
}

function preflight(registry = baseRegistry) {
  const records = Array.isArray(registry?.records) ? registry.records : [];
  const byId = new Map(records.filter(Boolean).map(row => [clean(row.cityId), row]));
  const issues = [];
  const seen = new Set();

  if (records.length !== 1000) issues.push(`expected-1000-records:${records.length}`);
  if (corrections().length !== 9) issues.push(`expected-9-corrections:${corrections().length}`);
  if (manifest?.candidate?.correctionCount !== 9) issues.push('manifest-correction-count-mismatch');
  if (manifest?.candidate?.unchangedRecordCount !== 991) issues.push('manifest-unchanged-count-mismatch');
  if (manifest?.policy?.runtimeWired !== false) issues.push('candidate-must-not-be-runtime-wired');
  if (manifest?.policy?.productionDeploymentPerformed !== false) issues.push('candidate-must-not-be-production-deployed');

  for (const change of corrections()) {
    const cityId = clean(change.cityId);
    if (!cityId || seen.has(cityId)) {
      issues.push(`duplicate-or-missing-city-id:${cityId || 'blank'}`);
      continue;
    }
    seen.add(cityId);
    const record = byId.get(cityId);
    if (!record) {
      issues.push(`missing-city:${cityId}`);
      continue;
    }
    if (upper(record.origin?.preferredAirportCode) !== upper(change.fromPreferredAirportCode)) {
      issues.push(`preferred-airport-base-mismatch:${cityId}`);
    }
    if (!validIata(change.toPreferredAirportCode)) issues.push(`invalid-target-iata:${cityId}`);
  }

  return { ok: issues.length === 0, issues, recordCount: records.length, correctionCount: corrections().length };
}

function projectedRecord(record, change) {
  const output = clone(record);
  const target = upper(change.toPreferredAirportCode);
  const existing = Array.isArray(output.origin?.airportCodes) ? output.origin.airportCodes : [];
  output.origin = {
    ...(output.origin || {}),
    preferredAirportCode: target,
    airportCodes: Array.from(new Set([target, ...existing.map(upper).filter(validIata)]))
  };
  return output;
}

function projectRegistry(registry = baseRegistry) {
  const check = preflight(registry);
  if (!check.ok) return { ok: false, version: VERSION, issues: check.issues };

  const output = clone(registry);
  const byId = new Map(output.records.map(row => [clean(row.cityId), row]));
  const changes = [];

  for (const change of corrections()) {
    const current = byId.get(change.cityId);
    const projected = projectedRecord(current, change);
    const index = output.records.findIndex(row => row.cityId === change.cityId);
    output.records[index] = projected;
    byId.set(change.cityId, projected);
    changes.push({
      cityId: change.cityId,
      fromPreferredAirportCode: upper(change.fromPreferredAirportCode),
      toPreferredAirportCode: upper(change.toPreferredAirportCode)
    });
  }

  return {
    ok: true,
    version: VERSION,
    candidateVersion: manifest.version,
    baseRegistryVersion: registry.version || null,
    correctionCount: changes.length,
    unchangedRecordCount: output.records.length - changes.length,
    registry: output,
    changes,
    policy: clone(manifest.policy)
  };
}

function summary() {
  const projected = projectRegistry(baseRegistry);
  return {
    ok: projected.ok,
    version: VERSION,
    candidateVersion: manifest.version,
    baseRegistryVersion: baseRegistry.version || null,
    correctionCount: projected.correctionCount || 0,
    unchangedRecordCount: projected.unchangedRecordCount || 0,
    runtimeWired: false,
    productionDeploymentPerformed: false,
    providerMappingsChanged: false,
    coordinatesChanged: false,
    activationChanged: false,
    requiresExactItineraryVerification: true,
    changes: projected.changes || [],
    issues: projected.issues || []
  };
}

function writeCandidate(outPath) {
  const projected = projectRegistry(baseRegistry);
  if (!projected.ok) throw new Error(`GV-REC-702F-E preflight failed: ${projected.issues.join(', ')}`);
  const payload = {
    version: manifest.version,
    generatedFrom: {
      serviceVersion: VERSION,
      baseRegistryVersion: baseRegistry.version || null,
      sourceCorrectionVersion: sourceCorrections.version,
      sourceOurAirportsCommit: manifest.sourceOurAirports?.commit || null
    },
    policy: clone(manifest.policy),
    summary: {
      recordCount: projected.registry.records.length,
      correctionCount: projected.correctionCount,
      unchangedRecordCount: projected.unchangedRecordCount
    },
    registry: projected.registry
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  return payload;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf('--out');
  if (outIndex >= 0 && args[outIndex + 1]) {
    const payload = writeCandidate(args[outIndex + 1]);
    console.log(JSON.stringify(payload.summary, null, 2));
  } else {
    console.log(JSON.stringify(summary(), null, 2));
  }
}

module.exports = {
  VERSION,
  preflight,
  projectedRecord,
  projectRegistry,
  summary,
  writeCandidate,
  _internal: { baseRegistry, sourceCorrections, manifest, corrections }
};
