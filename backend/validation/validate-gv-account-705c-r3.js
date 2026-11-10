'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(BACKEND_ROOT, '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function main() {
  const checks = [];
  const pass = (name) => { checks.push(name); console.log(`[PASS] ${name}`); };

  const bridge = read('frontend/scripts/saved-trips-705c-r3-route-details.js');
  const shared = read('frontend/scripts/saved-trips-705c.js');
  const shell = read('frontend/scripts/shell-670f.js');
  const backend = read('backend/services/accounts/saved-trips/staging-saved-trips-705c.js');

  assert.match(bridge, /GV-ACCOUNT-705C-R3/);
  assert.match(shared, /MAX_COMPACT_BYTES = 40 \* 1024/);
  assert.match(shared, /savedSnapshotMode: 'compact-account-route'/);
  assert.match(bridge, /compactAccountSnapshot/);
  assert.match(bridge, /compactTour/);
  assert.match(bridge, /runtime\(\)\.api\.create\(compactSnapshot\.body\)/);
  assert.doesNotMatch(bridge, /api\.create\(fullSnapshot\.body\)/);
  assert.match(bridge, /runtime\(\)\._internal\.compactAccountSnapshot/);
  assert.match(shared, /api\.create\(compactSnapshot\.body\)/);
  pass('R3 creates account records from compact snapshots, not the full generated tour');

  assert.match(shared, /backendLegs: legs\.slice\(0, 16\)\.map\(compactLeg\)/);
  assert.match(shared, /cities: .*slice\(0, 12\)\.map\(compactCity\)/s);
  assert.match(shared, /stays: stays\.slice\(0, 12\)\.map\(compactStay\)/);
  assert.match(shared, /providerDateEvidence: compactProviderEvidence/);
  assert.doesNotMatch(shared, /bookingLink:/);
  assert.doesNotMatch(shared, /providerUrl:/);
  pass('compact account snapshot keeps reopen essentials while excluding provider handoff URLs');

  assert.match(shared, /jsonBytes\(body\.tripSnapshot\)/);
  assert.match(shared, /compact-snapshot-too-large/);
  assert.match(backend, /MAX_TRIP_JSON_BYTES = 48 \* 1024/);
  pass('client compact cap remains below the unchanged 48 KiB backend trust boundary');

  assert.match(bridge, /Saved to account ✓/);
  assert.match(bridge, /event\.stopImmediatePropagation\(\)/);
  assert.match(bridge, /function session\(\).*GlobevoyAuth705B/s);
  assert.doesNotMatch(bridge, /localStorage\.setItem\([^\n]*(accessToken|refreshToken|idToken)/i);
  assert.doesNotMatch(bridge, /sessionStorage\.setItem\([^\n]*(accessToken|refreshToken|idToken)/i);
  pass('R3 preserves signed-in interception and does not add token persistence');

  assert.match(shell, /saved-trips-705c-r3-route-details\.js/);
  assert.match(shell, /705c-r3/);
  pass('shell selects the R3 route-details bridge');

  console.log(`\nGV-ACCOUNT-705C-R3 validation PASS (${checks.length}/${checks.length})`);
}

try { main(); }
catch (error) {
  console.error('[FAIL] GV-ACCOUNT-705C-R3 validation');
  console.error(error);
  process.exitCode = 1;
}
