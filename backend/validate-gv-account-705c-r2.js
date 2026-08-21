'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

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
  pass('route-details save bridge uses the existing owner-private 705C API');

  assert.match(bridge, /event\.preventDefault\(\)/);
  assert.match(bridge, /event\.stopImmediatePropagation\(\)/);
  assert.match(bridge, /Saved to account ✓/);
  assert.match(bridge, /Saved privately to your Globevoy account/);
  assert.match(bridge, /browser-only handler/);
  pass('signed-in save cannot falsely report browser-only Saved as account persistence');

  assert.match(bridge, /function session\(\).*GlobevoyAuth705B/s);
  assert.doesNotMatch(bridge, /localStorage\.setItem\([^\n]*(accessToken|refreshToken|idToken)/i);
  assert.doesNotMatch(bridge, /sessionStorage\.setItem\([^\n]*(accessToken|refreshToken|idToken)/i);
  assert.doesNotMatch(bridge, /password|clientSecret|DUFFEL_ACCESS_TOKEN/);
  pass('bridge reuses verified auth session without new token or credential persistence');

  assert.match(shell, /saved-trips-705c-r2-route-details\.js/);
  assert.match(shell, /script\.onload = loadRouteDetailsSavedTrips705CR2/);
  assert.match(shell, /gv-multi-trip-page/);
  assert.match(shell, /gvSavedTripsRouteDetails = '705c-r2'/);
  pass('shell loads R2 only for the multi-city route-details surface');

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
