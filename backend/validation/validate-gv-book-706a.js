'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(BACKEND_ROOT, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function main() {
  const checks = [];
  const pass = name => { checks.push(name); console.log(`[PASS] ${name}`); };

  const myTripsHtml = read('frontend/my-trips.html');
  const bookingHtml = read('frontend/booking.html');
  const myTrips = read('frontend/scripts/my-trips-booking-706a.js');
  const bridge = read('frontend/scripts/booking-account-bridge-706a.js');
  const guard = read('frontend/scripts/booking-account-snapshot-706a.js');
  const production = read('backend/lambda.js');

  assert.match(myTripsHtml, /my-trips-booking-706a\.js\?v=706a-fe-r1/);
  assert.match(myTrips, /GV-BOOK-706A/);
  assert.match(myTrips, /runtime\(\)\.api\.get\(id\)/);
  assert.match(myTrips, /data-gv-book-saved/);
  const continueStart = myTrips.indexOf('async function continueToBooking');
  const continueEnd = myTrips.indexOf('function enhanceCards', continueStart);
  const continueBlock = myTrips.slice(continueStart, continueEnd);
  assert.ok(continueStart >= 0 && continueEnd > continueStart, 'continueToBooking block must be present');
  assert.match(myTrips, /CANONICAL_REVIEW_VERSION = 'GV-WEB-FE-R1'/);
  assert.match(myTrips, /CANONICAL_REVIEW_PATH = '\/react\/booking\/'/);
  assert.match(myTrips, /Check current prices/);
  assert.match(continueBlock, /runtime\(\)\.api\.get\(id\)/);
  assert.match(continueBlock, /canonicalReviewUrl\(id\)/);
  assert.doesNotMatch(continueBlock, /buildHandoff|bookingUrlForTrip|sessionStorage\.setItem/);
  assert.match(myTrips, /HANDOFF_PREFIX = 'gv\.account\.booking\.handoff\.706a\.'/);
  pass('Classic My Trips verifies the owner-private tripId and routes to the canonical React Trip Review');

  assert.match(myTrips, /savedAccountContext706A/);
  assert.match(myTrips, /snapshotOnly: true/);
  assert.match(myTrips, /requiresRevalidation: true/);
  assert.match(myTrips, /providerBacked = false/);
  assert.match(myTrips, /productionEligible = false/);
  assert.match(myTrips, /verified = false/);
  assert.match(myTrips, /stripUrlFields/);
  pass('saved provider evidence is downgraded to historical snapshot state');

  const bridgeIndex = bookingHtml.indexOf('booking-account-bridge-706a.js');
  const liveIndex = bookingHtml.indexOf('booking-live-673d.js');
  const workspaceIndex = bookingHtml.indexOf('booking-workspace-686c.js');
  const guardIndex = bookingHtml.indexOf('booking-account-snapshot-706a.js');
  assert.ok(bridgeIndex >= 0 && liveIndex > bridgeIndex, 'account bridge must run before booking-live');
  assert.ok(guardIndex > workspaceIndex, 'snapshot guard must run after workspace render script');
  assert.match(bookingHtml, /meta name="gv-book-account" content="GV-BOOK-706A"/);
  pass('booking page consumes account handoff before legacy browser loaders and guards after render');

  assert.match(bridge, /handoff\.tripId === tripId/);
  assert.match(bridge, /Number\(handoff\.expiresAt\) > now/);
  assert.match(bridge, /savedAccountContext706A\?\.tripId === tripId/);
  assert.match(bridge, /_accountTrip706A === tripId/);
  assert.match(bridge, /location\.replace\(`my-trips\.html\?/);
  assert.doesNotMatch(bridge, /fetch\s*\(/);
  assert.doesNotMatch(bridge, /accessToken|refreshToken|idToken|password|clientSecret/i);
  pass('booking bridge accepts only exact short-lived handoff or exact same-tab refresh marker');

  assert.match(guard, /Saved account snapshot — verification required/);
  assert.match(guard, /Revalidation required/);
  assert.match(guard, /removeAttribute\('href'\)/);
  assert.match(guard, /gv-booking-open-all-flights/);
  assert.match(guard, /gv-booking-open-all-stays/);
  assert.match(guard, /gv-booking-continue-partner/);
  assert.match(guard, /\.gv-workspace-partner\[href\]\[data-partner-review\]/);
  pass('account snapshots cannot open flight/stay partner handoffs before revalidation');

  for (const text of [myTrips, bridge, guard]) {
    assert.doesNotMatch(text, /localStorage\.setItem\([^\n]*(accessToken|refreshToken|idToken)/i);
    assert.doesNotMatch(text, /sessionStorage\.setItem\([^\n]*(accessToken|refreshToken|idToken)/i);
    assert.doesNotMatch(text, /DUFFEL_ACCESS_TOKEN|clientSecret|passportNumber|cardNumber|cvv/i);
  }
  assert.doesNotMatch(production, /GV-BOOK-706A|accountTrip|booking-account-bridge-706a/);
  pass('706A adds no credential persistence and leaves production backend untouched');

  console.log(`\nGV-BOOK-706A validation PASS (${checks.length}/${checks.length})`);
}

try {
  main();
} catch (error) {
  console.error('[FAIL] GV-BOOK-706A validation');
  console.error(error);
  process.exitCode = 1;
}
