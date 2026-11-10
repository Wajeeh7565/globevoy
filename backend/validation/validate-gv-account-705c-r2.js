'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(BACKEND_ROOT, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function main() {
  const checks = [];
  const pass = (name) => { checks.push(name); console.log(`[PASS] ${name}`); };

  const html = read('frontend/multi-city-trip.html');
  const routeDetails = read('frontend/scripts/multi-city-trip-673a.js');
  const savedTrips = read('frontend/scripts/saved-trips-705c.js');
  const bridge = read('frontend/scripts/saved-trips-705c-r2-route-details.js');
  const shell = read('frontend/scripts/shell-670f.js');

  assert.match(html, /id="gv-mtd-save"/);
  assert.match(html, /gv-multi-trip-page/);
  assert.match(routeDetails, /#gv-mtd-save/);
  assert.match(routeDetails, /Saved ✓/);
  pass('route-details browser-only save baseline is identified');

  assert.match(bridge, /GV-ACCOUNT-705C-R2/);
  assert.match(bridge, /BUTTON_ID = 'gv-mtd-save'/);
  assert.match(bridge, /_internal\?\.multiSnapshot/);
  assert.match(bridge, /runtime\(\)\.api\.list\(\)/);
  assert.match(bridge, /runtime\(\)\.api\.create\(currentSnapshot\.body\)/);
  assert.match(bridge, /runtime\(\)\.api\.remove\(match\.tripId\)/);
  pass('route-details R2 bridge remains intact as the historical owner-private API baseline');

  assert.match(bridge, /event\.preventDefault\(\)/);
  assert.match(bridge, /event\.stopImmediatePropagation\(\)/);
  assert.match(bridge, /Saved to account ✓/);
  assert.match(bridge, /Saved privately to your Globevoy account/);
  assert.match(bridge, /browser-only handler/);
  pass('R2 signed-in save baseline cannot falsely report browser-only Saved as account persistence');

  assert.match(bridge, /function session\(\).*GlobevoyAuth705B/s);
  assert.doesNotMatch(bridge, /localStorage\.setItem\([^\n]*(accessToken|refreshToken|idToken)/i);
  assert.doesNotMatch(bridge, /sessionStorage\.setItem\([^\n]*(accessToken|refreshToken|idToken)/i);
  assert.doesNotMatch(bridge, /password|clientSecret|DUFFEL_ACCESS_TOKEN/);
  pass('R2 bridge reuses verified auth session without new token or credential persistence');

  // R3 is an intentional successor to R2. Keep validating that the historical
  // R2 bridge exists, while allowing the shell to select the current R2/R3
  // route-details implementation instead of freezing the loader forever at R2.
  assert.match(shell, /saved-trips-705c-r(?:2|3)-route-details\.js/);
  assert.match(shell, /script\.onload = loadRouteDetailsSavedTrips705CR[23]/);
  assert.match(shell, /gv-multi-trip-page/);
  assert.match(shell, /gvSavedTripsRouteDetails = '705c-r[23]'/);
  pass('shell loads an approved 705C route-details successor only on the multi-city route-details surface');

  assert.match(savedTrips, /multi-city-trip\.html/);
  assert.match(savedTrips, /_internal: Object\.freeze\(\{ singleSnapshot, multiSnapshot, sameOriginTripPath \}\)/);
  pass('existing 705C reopen path and multi snapshot API remain available');

  console.log(`\nGV-ACCOUNT-705C-R2 validation PASS (${checks.length}/${checks.length})`);
}

try {
  main();
} catch (error) {
  console.error('[FAIL] GV-ACCOUNT-705C-R2 validation');
  console.error(error);
  process.exitCode = 1;
}
