import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'web');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const journey = read('components/journey/journey-client-710e.tsx');
const trips = read('components/account/my-trips-client.tsx');
const css = read('app/journey-710e.css');

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: error?.message || String(error) }); }
}

check('My Trips opens saved multi-city journeys on the React Journey route', () => {
  assert.match(trips, /trip\.tripSnapshot\.kind === 'multi'/);
  assert.match(trips, /\/react\/journey\/\?tripId=/);
  assert.match(trips, /openSavedTripPreservingOrigin\(trip\)/);
});

check('saved Journey requires an exact owner-private trip fetch', () => {
  assert.match(journey, /getSavedTrip\(session\.accessToken, tripId\)/);
  assert.match(journey, /clean\(trip\.tripId\) !== tripId/);
  assert.match(journey, /Sign in to open this private saved journey/);
  assert.match(journey, /clear\(\)/);
});

check('saved Journey is rendered from the saved snapshot rather than a fresh recommendation replacement', () => {
  const start = journey.indexOf('const loadSaved = useCallback');
  const end = journey.indexOf('const loadPublic = useCallback');
  assert.ok(start >= 0 && end > start);
  const savedLoader = journey.slice(start, end);
  assert.match(savedLoader, /savedSearchForTrip\(trip\)/);
  assert.match(savedLoader, /savedRouteForTrip\(trip, savedSearch\)/);
  assert.doesNotMatch(savedLoader, /getPublicMultiCityTours/);
  assert.match(journey, /Saved snapshot · price check needed/);
});

check('saved Journey stays inside the React account flow', () => {
  assert.match(journey, /return '\/react\/my-trips\/'/);
  assert.match(journey, /← Back to My Trips/);
  assert.match(journey, /\/react\/booking\/\?tripId=/);
  assert.match(journey, /YOUR SAVED JOURNEY/);
});

check('saved Journey current-price CTA is styled and keyboard-visible', () => {
  assert.match(css, /\.gv-journey-check-prices\{/);
  assert.match(css, /\.gv-journey-check-prices:focus-visible/);
});

check('R3.2 does not add booking, payment, or provider mutation capability', () => {
  assert.doesNotMatch(journey, /createOrder|BOOK\b|Pay now|Complete purchase|paymentIntent/i);
});

checks.forEach((item, index) => console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}${item.error ? `: ${item.error}` : ''}`));
const passed = checks.filter((item) => item.pass).length;
console.log(`GV-WEB-FE-R3.2: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;
