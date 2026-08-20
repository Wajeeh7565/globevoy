'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const candidate = require('./services/permanent-gateway-foundation-candidate-702f-e');
const stagingOverlay = require('./services/staging-gateway-foundation-702f-d');
const manifest = require('./data/gateway-foundation-permanent-candidate-702f-e.json');
const cityRegistry = require('./services/city-registry');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function byId(registry) { return new Map((registry.records || []).map(row => [row.cityId, row])); }
function gitBlobSha(content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return crypto.createHash('sha1').update(Buffer.from(`blob ${body.length}\0`)).update(body).digest('hex');
}

function main() {
  assert.strictEqual(candidate.VERSION, 'GV-REC-702F-E');
  assert.strictEqual(manifest.version, 'GV-REC-702F-E-PERMANENT-FOUNDATION-CANDIDATE-R1');
  assert.strictEqual(manifest.status, 'reviewed-permanent-foundation-candidate');
  assert.strictEqual(manifest.sourceStagingQa.version, 'GV-REC-702F-D');
  assert.strictEqual(manifest.sourceStagingQa.manifestVersion, 'GV-REC-702F-D-CORRECTIONS');
  assert.strictEqual(manifest.sourceStagingQa.stagingMergeCommit, 'e22db6a05e6c5985613741699950b35e52b0068c');
  assert.strictEqual(manifest.sourceOurAirports.commit, '55fd4071c99668a29f9d3625d72405c44074ef2f');
  assert.strictEqual(manifest.sourceOurAirports.gitBlobSha, 'b95a254e2d970ecb37320d645abced90c6d1a95f');
  assert.strictEqual(manifest.stagingValidation.registryChecksPassed, 9);
  assert.strictEqual(manifest.stagingValidation.registryChecksTotal, 9);
  assert.strictEqual(manifest.stagingValidation.generatedTourOriginsPassed, 3);
  assert.strictEqual(manifest.stagingValidation.generatedTourOriginsTotal, 3);
  assert.strictEqual(manifest.stagingValidation.effectiveStagingActiveBefore, 441);
  assert.strictEqual(manifest.stagingValidation.effectiveStagingActiveAfter, 441);
  assert.strictEqual(manifest.stagingValidation.activationChanged, false);
  assert.strictEqual(manifest.policy.reviewOnly, true);
  assert.strictEqual(manifest.policy.runtimeWired, false);
  assert.strictEqual(manifest.policy.productionDeploymentPerformed, false);
  assert.strictEqual(manifest.policy.automaticProductionPromotionAllowed, false);
  assert.strictEqual(manifest.policy.requiresExplicitPromotionDecision, true);
  assert.strictEqual(manifest.policy.requiresExactItineraryVerification, true);

  const sourceManifestPath = path.join(__dirname, 'data', 'gateway-foundation-corrections-702f-d.json');
  const sourceManifestBytes = fs.readFileSync(sourceManifestPath);
  assert.strictEqual(gitBlobSha(sourceManifestBytes), manifest.sourceStagingQa.manifestGitBlobSha, '702F-D source manifest blob drifted');

  const base = clone(candidate._internal.baseRegistry);
  const baseline = clone(base);
  const baselineById = byId(baseline);
  const check = candidate.preflight(base);
  assert.strictEqual(check.ok, true, check.issues.join(','));
  assert.strictEqual(check.recordCount, 1000);
  assert.strictEqual(check.correctionCount, 9);

  const projected = candidate.projectRegistry(base);
  assert.strictEqual(projected.ok, true, (projected.issues || []).join(','));
  assert.strictEqual(projected.correctionCount, 9);
  assert.strictEqual(projected.unchangedRecordCount, 991);
  assert.strictEqual(projected.registry.records.length, 1000);

  const projectedById = byId(projected.registry);
  const corrections = candidate._internal.corrections();
  const expectedIds = corrections.map(row => row.cityId).sort();
  assert.deepStrictEqual(projected.changes.map(row => row.cityId).sort(), expectedIds);

  let changedCount = 0;
  for (const original of baseline.records) {
    const after = projectedById.get(original.cityId);
    assert(after, `missing projected record ${original.cityId}`);
    const change = corrections.find(row => row.cityId === original.cityId);
    if (!change) {
      assert.deepStrictEqual(after, original, `unrelated city changed: ${original.cityId}`);
      continue;
    }

    changedCount += 1;
    const expected = clone(original);
    expected.origin.preferredAirportCode = change.toPreferredAirportCode;
    expected.origin.airportCodes = Array.from(new Set([
      change.toPreferredAirportCode,
      ...(original.origin.airportCodes || [])
    ]));
    assert.deepStrictEqual(after, expected, `${original.cityId}: permanent candidate changed fields beyond preferred airport/code order`);
    assert.strictEqual(after.origin.preferredAirportCode, change.toPreferredAirportCode);
    assert.strictEqual(after.origin.airportCodes[0], change.toPreferredAirportCode);
    assert.strictEqual(after.origin.providerLocationCode, original.origin.providerLocationCode, `${original.cityId}: provider location changed`);
    assert.deepStrictEqual(after.providers, original.providers, `${original.cityId}: provider mapping changed`);
    assert.strictEqual(after.latitude, original.latitude, `${original.cityId}: latitude changed`);
    assert.strictEqual(after.longitude, original.longitude, `${original.cityId}: longitude changed`);

    const qaProjected = stagingOverlay.projectedRecord(original, change);
    const qaComparable = clone(qaProjected);
    delete qaComparable.origin.stagingGatewayFoundation;
    assert.deepStrictEqual(after, qaComparable, `${original.cityId}: permanent candidate does not match proven staging QA behavior`);

    const routeRow = cityRegistry._internal.catalogueRowFromRecord(after, null);
    assert.strictEqual(routeRow.primaryAirportCode, change.toPreferredAirportCode, `${original.cityId}: route primary airport mismatch`);
    assert(routeRow.flightableAirportCodes.includes(change.toPreferredAirportCode), `${original.cityId}: route airport list missing target`);
  }
  assert.strictEqual(changedCount, 9);

  for (const heldId of ['saint-martin-mf', 'umueri-ng', 'sun-city-za', 'khost-af']) {
    assert.deepStrictEqual(projectedById.get(heldId), baselineById.get(heldId), `${heldId}: integrity hold must remain untouched`);
  }

  for (const runtimePath of [
    'lambda.js',
    'staging-lambda.js',
    'staging-lambda-702d.js',
    'generated-tour.js',
    'services/city-registry.js',
    'services/global-route-graph.js'
  ]) {
    const source = fs.readFileSync(path.join(__dirname, runtimePath), 'utf8');
    assert(!source.includes('permanent-gateway-foundation-candidate-702f-e'), `${runtimePath}: 702F-E must not be runtime imported`);
    assert(!source.includes('GV-REC-702F-E'), `${runtimePath}: 702F-E runtime wiring detected`);
  }

  process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
  const activation = require('./services/verified-city-activation').summary();
  assert.strictEqual(activation.summary.productionActiveCount, 439, 'historical 668T production baseline changed');

  const summary = candidate.summary();
  assert.strictEqual(summary.correctionCount, 9);
  assert.strictEqual(summary.unchangedRecordCount, 991);
  assert.strictEqual(summary.runtimeWired, false);
  assert.strictEqual(summary.productionDeploymentPerformed, false);
  assert.strictEqual(summary.providerMappingsChanged, false);
  assert.strictEqual(summary.coordinatesChanged, false);
  assert.strictEqual(summary.activationChanged, false);
  assert.strictEqual(summary.requiresExactItineraryVerification, true);

  console.log('GV-REC-702F-E validation PASS');
  console.log(JSON.stringify({
    version: candidate.VERSION,
    candidateVersion: manifest.version,
    recordCount: projected.registry.records.length,
    correctionCount: projected.correctionCount,
    unchangedRecordCount: projected.unchangedRecordCount,
    stagingRegistryValidation: '9/9',
    stagingGeneratedTourValidation: '3/3',
    historicalProductionActive: activation.summary.productionActiveCount,
    runtimeWired: false,
    productionDeploymentPerformed: false,
    providerMappingsChanged: false,
    coordinatesChanged: false,
    activationChanged: false
  }, null, 2));
}

main();
