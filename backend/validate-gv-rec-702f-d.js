'use strict';

const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');
const overlay = require('./services/cities/gateways/staging/staging-gateway-foundation-702f-d');
const manifest = require('./data/gateway-foundation-corrections-702f-d.json');
const cityRegistry = require('./services/city-registry');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function byId(registry) { return new Map((registry.records || []).map(row => [row.cityId, row])); }

function main() {
  assert.strictEqual(overlay.VERSION, 'GV-REC-702F-D');
  assert.strictEqual(manifest.version, 'GV-REC-702F-D-CORRECTIONS');
  assert.strictEqual(manifest.sourceTriageVersion, 'GV-REC-702F-C');
  assert.strictEqual(manifest.sourceOurAirports.commit, '55fd4071c99668a29f9d3625d72405c44074ef2f');
  assert.strictEqual(manifest.sourceOurAirports.gitBlobSha, 'b95a254e2d970ecb37320d645abced90c6d1a95f');
  assert.strictEqual(manifest.corrections.length, 9);
  assert.strictEqual(new Set(manifest.corrections.map(row => row.cityId)).size, 9);

  const base = clone(overlay._internal.registry668B);
  const baseline = clone(base);
  const baselineById = byId(baseline);
  const expectedIds = manifest.corrections.map(row => row.cityId).sort();

  const disabled = overlay.applyToRegistry(clone(base), { env: {} });
  assert.strictEqual(disabled.ok, true);
  assert.strictEqual(disabled.applied, false);
  assert.strictEqual(disabled.appliedCount, 0);

  const goodEnv = {
    ENABLE_STAGING_GATEWAY_FOUNDATION_702F_D: 'true',
    ENABLE_UNIFIED_CITY_REGISTRY_668A: 'true',
    ENABLE_PROVIDER_MAPPING_COMPLETION_668B: 'true',
    CORS_ORIGIN: 'https://staging.dy4fw8gx1ccie.amplifyapp.com/'
  };
  assert.strictEqual(overlay.enabled(goodEnv), true);
  assert.strictEqual(overlay.enabled({ ...goodEnv, CORS_ORIGIN: 'https://globevoy.com' }), false);
  assert.strictEqual(overlay.enabled({ ...goodEnv, ENABLE_STAGING_GATEWAY_FOUNDATION_702F_D: 'false' }), false);
  assert.strictEqual(overlay.enabled({ ...goodEnv, ENABLE_UNIFIED_CITY_REGISTRY_668A: 'false' }), false);
  assert.strictEqual(overlay.enabled({ ...goodEnv, ENABLE_PROVIDER_MAPPING_COMPLETION_668B: 'false' }), false);

  const check = overlay.preflight(base);
  assert.strictEqual(check.ok, true, check.issues.join(','));
  assert.strictEqual(check.registryRecordCount, 1000);
  assert.strictEqual(check.correctionCount, 9);

  const projected = clone(base);
  const result = overlay.applyToRegistry(projected, { env: goodEnv });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.applied, true);
  assert.strictEqual(result.appliedCount, 9);
  assert.deepStrictEqual(result.changes.map(row => row.cityId).sort(), expectedIds);
  assert.strictEqual(result.policy.providerMappingsChanged, false);
  assert.strictEqual(result.policy.coordinatesChanged, false);
  assert.strictEqual(result.policy.activationChanged, false);
  assert.strictEqual(result.policy.requiresExactItineraryVerification, true);

  const projectedById = byId(projected);
  let changedCount = 0;
  for (const original of baseline.records) {
    const after = projectedById.get(original.cityId);
    assert(after, `missing projected record ${original.cityId}`);
    const correction = manifest.corrections.find(row => row.cityId === original.cityId);
    if (!correction) {
      assert.deepStrictEqual(after, original, `unrelated city changed: ${original.cityId}`);
      continue;
    }
    changedCount += 1;
    assert.strictEqual(original.origin.preferredAirportCode, correction.fromPreferredAirportCode);
    assert.strictEqual(after.origin.preferredAirportCode, correction.toPreferredAirportCode);
    assert.strictEqual(after.origin.airportCodes[0], correction.toPreferredAirportCode);
    for (const code of original.origin.airportCodes || []) {
      assert(after.origin.airportCodes.includes(code), `${original.cityId} lost existing airport code ${code}`);
    }
    assert.deepStrictEqual(after.providers, original.providers, `${original.cityId} provider mapping changed`);
    assert.strictEqual(after.latitude, original.latitude, `${original.cityId} latitude changed`);
    assert.strictEqual(after.longitude, original.longitude, `${original.cityId} longitude changed`);
    assert.strictEqual(after.origin.providerLocationCode, original.origin.providerLocationCode, `${original.cityId} provider location code changed`);
    assert.strictEqual(after.origin.stagingGatewayFoundation.version, overlay.VERSION);
    assert.strictEqual(after.origin.stagingGatewayFoundation.stagingQaOnly, true);
    assert.strictEqual(after.origin.stagingGatewayFoundation.providerMappingsChanged, false);
    assert.strictEqual(after.origin.stagingGatewayFoundation.coordinatesChanged, false);
    assert.strictEqual(after.origin.stagingGatewayFoundation.requiresExactItineraryVerification, true);

    const catalogueRow = cityRegistry._internal.catalogueRowFromRecord(after, null);
    assert.strictEqual(catalogueRow.primaryAirportCode, correction.toPreferredAirportCode, `${original.cityId} route primary airport mismatch`);
    assert(catalogueRow.flightableAirportCodes.includes(correction.toPreferredAirportCode), `${original.cityId} route airport list missing target`);
  }
  assert.strictEqual(changedCount, 9);

  for (const heldId of ['saint-martin-mf', 'umueri-ng', 'sun-city-za', 'khost-af']) {
    assert.deepStrictEqual(projectedById.get(heldId), baselineById.get(heldId), `${heldId} integrity hold must remain untouched`);
  }

  const stagingEntrypoint = fs.readFileSync(require.resolve('./staging-lambda-702d'), 'utf8');
  const gatewayInstallIndex = stagingEntrypoint.indexOf('stagingGateway.install()');
  const stagingLoadIndex = stagingEntrypoint.indexOf("require('./staging-lambda')");
  assert(gatewayInstallIndex >= 0, 'staging gateway install call missing');
  assert(stagingLoadIndex > gatewayInstallIndex, 'gateway overlay must install before ordinary staging Lambda loads');
  assert(stagingEntrypoint.includes("X-Globevoy-Staging-Gateway"), 'staging gateway diagnostic header missing');

  const childScript = `
    const manifest = require('./data/gateway-foundation-corrections-702f-d.json');
    const entry = require('./staging-lambda-702d');
    if (!entry.GATEWAY_INSTALLATION || entry.GATEWAY_INSTALLATION.ok !== true || entry.GATEWAY_INSTALLATION.appliedCount !== 9) {
      throw new Error('staging gateway installation failed');
    }
    const registry = require('./services/city-registry');
    const selected = registry.routeGraphSelection([]);
    for (const change of manifest.corrections) {
      const resolved = registry.resolveRegistryCity(change.cityId);
      if (!resolved || resolved.origin.preferredAirportCode !== change.toPreferredAirportCode) {
        throw new Error(change.cityId + ': registry preferred airport not overlaid');
      }
      const routeRow = selected.find(row => row.unifiedRegistry && row.unifiedRegistry.cityId === change.cityId);
      if (!routeRow || routeRow.primaryAirportCode !== change.toPreferredAirportCode) {
        throw new Error(change.cityId + ': route graph primary airport not overlaid');
      }
    }
    const activation = require('./services/cities/registry/verified-city-activation').summary();
    if (activation.summary.productionActiveCount !== 439) throw new Error('668T baseline count changed');
    console.log(JSON.stringify({ applied: entry.GATEWAY_INSTALLATION.appliedCount, routeRows: selected.length, baselineActive: activation.summary.productionActiveCount }));
  `;
  const childOut = execFileSync(process.execPath, ['-e', childScript], {
    cwd: __dirname,
    env: {
      ...process.env,
      ENABLE_STAGING_GATEWAY_FOUNDATION_702F_D: 'true',
      ENABLE_UNIFIED_CITY_REGISTRY_668A: 'true',
      ENABLE_PROVIDER_MAPPING_COMPLETION_668B: 'true',
      ENABLE_VERIFIED_CITY_ACTIVATION_668T: 'true',
      ENABLE_MVP_VALIDATION_REPAIRS_669B: 'true',
      ENABLE_STAGING_REVIEWED_RECOVERY_702D: 'true',
      CORS_ORIGIN: 'https://staging.dy4fw8gx1ccie.amplifyapp.com/'
    },
    encoding: 'utf8'
  }).trim();
  const integration = JSON.parse(childOut.split(/\r?\n/).filter(Boolean).pop());
  assert.strictEqual(integration.applied, 9);
  assert.strictEqual(integration.routeRows, 1000);
  assert.strictEqual(integration.baselineActive, 439);

  console.log('GV-REC-702F-D validation PASS');
  console.log(JSON.stringify({
    version: overlay.VERSION,
    correctionCount: manifest.corrections.length,
    unchangedCityCount: 991,
    integrityHoldsUntouched: 4,
    routeSurfaceRows: integration.routeRows,
    baselineProductionActive: integration.baselineActive,
    providerMappingsChanged: false,
    coordinatesChanged: false,
    activationChanged: false,
    routingChangedWhenFlagOff: false
  }, null, 2));
}

main();
