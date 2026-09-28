'use strict';

const assert = require('assert');

const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
process.env.CORS_ORIGIN = `${STAGING_ORIGIN}/`;
process.env.ENABLE_VERIFIED_CITY_ACTIVATION_668T = 'true';
process.env.ENABLE_MVP_VALIDATION_REPAIRS_669B = 'true';
process.env.ENABLE_STAGING_REVIEWED_RECOVERY_702D = 'true';
process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A = 'true';
process.env.ENABLE_PROVIDER_MAPPING_COMPLETION_668B = 'true';
process.env.ENABLE_GENERATED_TOUR_651A = 'true';
process.env.ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B = 'true';
process.env.ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B = 'true';
delete process.env.TRAVELPAYOUTS_TOKEN;
delete process.env.GLOBEVOY_USE_MOCKS;

const baseline = require('./services/cities/registry/verified-city-activation');
const overlay = require('./services/cities/recovery/staging/staging-reviewed-recovery-702d');
const installation = overlay.install({ baseline });
const cityRegistry = require('./services/cities/registry/city-registry');
const graph = require('./services/domain/routing/global-route-graph');

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

function registryRow(cityId) {
  return graph._internal.indexes().registrySelected.find(row => row?.unifiedRegistry?.cityId === cityId) || null;
}

(async () => {
  await check('702D-R1 staging QA prerequisites are enabled', () => {
    assert.strictEqual(installation.enabled, true);
    assert.strictEqual(cityRegistry.cityRegistryEnabled(), true);
    assert.strictEqual(cityRegistry.providerMappingEnabled(), true);
  });

  await check('curated route surface is exactly the reviewed 1000-city registry', () => {
    const idx = graph._internal.indexes();
    assert.strictEqual(idx.registrySelected.length, 1000);
  });

  await check('668T historical activation baseline remains exactly 439', () => {
    const summary = baseline.summary();
    assert.strictEqual(summary.version, 'GV-CITY-668T');
    assert.strictEqual(summary.summary.productionActiveCount, 439);
  });

  await check('Acapulco and Aalesund are present on the curated route surface', () => {
    assert.ok(registryRow('acapulco-mx'));
    assert.ok(registryRow('aalesund-no'));
  });

  await check('Acapulco and Aalesund pass production-destination eligibility under 702D QA', () => {
    assert.strictEqual(graph._internal.productionDestinationEligible(registryRow('acapulco-mx')), true);
    assert.strictEqual(graph._internal.productionDestinationEligible(registryRow('aalesund-no')), true);
  });

  await check('Aalborg remains blocked on the same curated route surface', () => {
    const row = registryRow('aalborg-dk');
    assert.ok(row);
    assert.strictEqual(graph._internal.productionDestinationEligible(row), false);
  });

  await check('effective verified-active route surface is 441 with 702D enabled', () => {
    const idx = graph._internal.indexes();
    const count = idx.registrySelected.filter(row => baseline.liveRecommendationEligible(row)).length;
    assert.strictEqual(count, 441);
  });

  const generated = await graph.generateProviderDrivenGlobalRouteCandidates({
    origin: 'YYZ',
    budget: 2500,
    currency: 'CAD',
    adults: 1,
    nights: 8,
    variant: 'gv-rec-702d-r1-ci'
  });

  await check('real global route-graph diagnostics report 441 verified-active destinations', () => {
    const deterministic = generated?.diagnostics?.deterministicFallback;
    assert.ok(deterministic, 'combined graph must retain deterministic fallback diagnostics');
    assert.strictEqual(deterministic.verifiedActivationEnabled, true);
    assert.strictEqual(deterministic.verifiedActiveDestinationCount, 441);
  });

  process.env.ENABLE_STAGING_REVIEWED_RECOVERY_702D = 'false';
  await check('flag-off rollback returns curated route surface to 439', () => {
    const idx = graph._internal.indexes();
    const count = idx.registrySelected.filter(row => baseline.liveRecommendationEligible(row)).length;
    assert.strictEqual(count, 439);
    assert.strictEqual(graph._internal.productionDestinationEligible(registryRow('acapulco-mx')), false);
    assert.strictEqual(graph._internal.productionDestinationEligible(registryRow('aalesund-no')), false);
  });
  process.env.ENABLE_STAGING_REVIEWED_RECOVERY_702D = 'true';

  await check('no provider credential or production activation write is required', () => {
    assert.strictEqual(Boolean(process.env.TRAVELPAYOUTS_TOKEN), false);
    assert.strictEqual(overlay.status().actualProductionActivationWritten, false);
    assert.strictEqual(overlay.status().thresholdsRelaxed, false);
  });

  console.log(`GV-REC-702D-R1 validation passed (${passed}/${passed}).`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
