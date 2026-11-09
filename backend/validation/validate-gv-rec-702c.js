'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const smoke = require('../services/admin/audits/global-provider-recovery-smoke-plan-702c');

const AS_OF = '2026-08-20T12:00:00.000Z';
const EXPECTED_IDS = [
  'adrar-dz',
  'ahe-pf',
  'alotau-pg',
  'aasiaat-gl',
  'abymes-gp',
  'acapulco-mx',
  'anjouan-km',
  'antsiranana-mg',
  'aalborg-dk',
  'aalesund-no'
];

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

const plan = smoke.buildSmokePlan({ asOf: AS_OF, limit: 10 });
console.log('GV-REC-702C PLAN', JSON.stringify({
  selectedCount: plan.selectedCount,
  sourceDueFirstRecoveryMatches: plan.sourceDueFirstRecoveryMatches,
  ids: plan.candidates.map(row => row.cityId),
  recoveryPolicy: plan.recoveryPolicy
}));

check('702C version is exact', () => assert.strictEqual(smoke.VERSION, 'GV-REC-702C'));
check('Smoke plan remains hard-capped at 10 cities', () => {
  assert.strictEqual(smoke.HARD_MAX_CITIES, 10);
  assert.strictEqual(plan.selectedCount, 10);
  assert.strictEqual(smoke.buildSmokePlan({ asOf: AS_OF, limit: 999 }).selectedCount, 10);
});
check('702C selects the expected top ten 702B due-first-recovery cities', () => {
  assert.deepStrictEqual(plan.candidates.map(row => row.cityId), EXPECTED_IDS);
});
check('all Smoke10 cities are genuinely due and were not in Recovery150', () => {
  assert.ok(plan.candidates.every(row => row.reviewDue === true));
  assert.ok(plan.candidates.every(row => row.previousRecovery668S === false));
});
check('all Smoke10 cities target missing flight observations only', () => {
  assert.strictEqual(plan.targetGap, 'retry-queue:missing-flight-observations');
  assert.ok(plan.candidates.every(row => row.primaryGap === plan.targetGap));
  assert.strictEqual(plan.providerScope, 'Travelpayouts-flight-only');
});
check('July Recovery150 flight-search limits are preserved', () => {
  assert.deepStrictEqual(plan.recoveryPolicy, {
    flightMonths: 4,
    regionalAnchorCount: 6,
    maximumFlightAttempts: 20,
    maxComfortDurationMinutes: 1080,
    maxComfortTransfers: 1,
    maximumGatewayTransferMinutes: 180,
    thresholdsRelaxed: false
  });
});
check('702C plan cannot activate cities and keeps exact itinerary verification', () => {
  assert.ok(plan.candidates.every(row => row.activationAllowedByThisPlan === false));
  assert.ok(plan.candidates.every(row => row.requiresExactItineraryVerification === true));
});
check('702C is planning-only and does not call Agoda or providers in CI', () => {
  assert.strictEqual(plan.safety.planOnly, true);
  assert.strictEqual(plan.safety.noProviderCalls, true);
  assert.strictEqual(plan.safety.noAgodaCalls, true);
  assert.strictEqual(plan.safety.noCredentials, true);
  const source = fs.readFileSync(path.join(BACKEND_ROOT, 'services', 'admin', 'audits', 'global-provider-recovery-smoke-plan-702c.js'), 'utf8');
  assert.ok(!source.includes('TRAVELPAYOUTS_TOKEN'));
  assert.ok(!source.includes('AGODA_API_KEY'));
  assert.ok(!source.includes('global.fetch'));
  assert.ok(!source.includes("require('./provider-live-coverage')"));
});
check('702C remains a bounded subset of the 143 due-first-recovery pool', () => {
  assert.strictEqual(plan.sourceDueFirstRecoveryMatches, 143);
  assert.ok(plan.selectedCount < plan.sourceDueFirstRecoveryMatches);
});

console.log(`GV-REC-702C validation passed (${passed}/${passed}).`);
