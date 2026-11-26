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

  const myTripsHtml = read('frontend/pages/my-trips.html');
  const bookingHtml = read('frontend/pages/booking.html');
  const bridge = read('frontend/scripts/booking-account-bridge-706a.js');
  // GV-WEB-3: the booking list (booking-trip-v2.js) enforces the snapshot guard itself.
  const guard = read('frontend/scripts/booking-trip-v2.js');
  const production = read('backend/lambda.js');

  // GV-WEB-4: saved trips were removed from the website, so the classic My Trips booking
  // handoff is gone and its page opens Account. The booking-side guards below are unchanged.
  assert.equal(fs.existsSync(path.join(ROOT, 'frontend/scripts/my-trips-booking-706a.js')), false);
  assert.doesNotMatch(myTripsHtml, /my-trips-booking-706a/);
  assert.match(myTripsHtml, /window\.location\.replace\(target\)/);
  pass('classic My Trips no longer hands trips to booking; its page opens Account');

  const bridgeIndex = bookingHtml.indexOf('booking-account-bridge-706a.js');
  const loaderIndex = bookingHtml.indexOf('trip-handoff.js');
  const listIndex = bookingHtml.indexOf('booking-trip-v2.js');
  assert.ok(bridgeIndex >= 0 && loaderIndex > bridgeIndex, 'account bridge must run before the trip loader');
  assert.ok(listIndex > loaderIndex, 'booking list must load after the trip loader');
  assert.match(bookingHtml, /meta name="gv-book-account" content="GV-BOOK-706A"/);
  assert.match(bookingHtml, /Saved account snapshot — verification required/);
  pass('booking page consumes account handoff before the trip loader and the guarded booking list');

  assert.match(bridge, /handoff\.tripId === tripId/);
  assert.match(bridge, /Number\(handoff\.expiresAt\) > now/);
  assert.match(bridge, /savedAccountContext706A\?\.tripId === tripId/);
  assert.match(bridge, /_accountTrip706A === tripId/);
  assert.match(bridge, /location\.replace\(`my-trips\.html\?/);
  assert.doesNotMatch(bridge, /fetch\s*\(/);
  assert.doesNotMatch(bridge, /accessToken|refreshToken|idToken|password|clientSecret/i);
  pass('booking bridge accepts only exact short-lived handoff or exact same-tab refresh marker');

  assert.match(guard, /GLOBEVOY_BOOKING_ACCOUNT_SNAPSHOT_706A\?\.snapshotOnly === true/);
  assert.match(guard, /Saved account snapshot — verification required/);
  assert.match(guard, /Revalidation required/);
  assert.match(guard, /mainUrl: '', compareUrl: '', altUrl: ''/);
  assert.match(guard, /ignav: null/);
  pass('account snapshots cannot open flight/stay partner handoffs before revalidation');

  for (const text of [bridge, guard]) {
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
