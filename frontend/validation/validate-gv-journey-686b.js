'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const hash = (name) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const journey = require(path.join(root, 'scripts/journey-experience-686b.js'));
const html = read('multicity-visualizer.html');
const css = read('styles/journey-experience-686b.css');
const source = read('scripts/journey-experience-686b.js');
const engine = read('scripts/multicity-visualizer-674a.js');
const fixture = read('gv-journey-686b-browser-fixture.html');
const shell = read('scripts/shell-670f.js');

const origin = { city: 'Toronto' };
const cities = [{ city: 'Mexico City', nights: 4 }, { city: 'Cancun', nights: 4 }];
const legs = [{ mode: 'flight' }, { mode: 'ground-transfer' }, { mode: 'flight' }];
const tour = {
  origin,
  cities,
  backendLegs: legs,
  stays: [{ nights: 4 }, { nights: 4 }],
  liveProviderVerification: { criticalCount: 5, verifiedCount: 2 }
};
const model = journey.buildJourneyModel(tour);
const rail = journey.railHtml(model);

check('Journey module version is 686B', journey.VERSION === 'GV-JOURNEY-686B');
check('Model preserves origin-to-return chronology', model.route === 'Toronto → Mexico City → Cancun → Toronto' && model.steps.length === 4);
check('Destination day ranges are cumulative', model.steps[1].days === 'Days 1–4' && model.steps[2].days === 'Days 5–8');
check('Ground transfer remains a ground transfer', model.steps[2].transport.type === 'ground' && model.steps[2].shortMeta.includes('Ground transfer'));
check('Price-confidence count is conservative', model.evidence === '2 of 5 prices checked');
check('Journey rail includes origin, stops and return', (rail.match(/data-journey-step=/g) || []).length === 4 && rail.includes('Return · Flight'));
check('Player is optional and explicitly does not autoplay', html.includes('the animation never starts automatically') && source.includes('playButton.onclick = play') && !source.includes('playButton.click()'));
check('Player supports pause, overview and Escape', source.includes('Pause journey') && html.includes('Show complete route') && source.includes("event.key === 'Escape'"));
check('Map, rail and cards share a step index', source.includes('is-journey-active') && source.includes('dataset.journeyStep') && engine.includes('data-journey-marker'));
check('Engine exposes a narrow map-focus adapter', engine.includes('window.__gvJourneyMapFocus') && engine.includes("new CustomEvent('gv:journey-rendered'"));
check('Offline fixture cannot load the external map', engine.includes("q.get('offline')") && engine.includes('drawFallbackMap(t)'));
check('Persistent context uses whole-group budget, estimate and evidence', html.includes('Whole-group budget') && html.includes('Current estimate') && (html.includes('Price confidence') || html.includes('Pricing evidence')));
check('Destination cards gain day and arrival storytelling', source.includes('gv-journey-days') && source.includes('gv-journey-arrival'));
check('Reduced-motion mode becomes manual step-through', source.includes("matchMedia?.('(prefers-reduced-motion: reduce)')") && source.includes('Next journey step'));
check('Reduced-motion CSS disables travel animation', css.includes('@media(prefers-reduced-motion:reduce)') && css.includes('animation:none'));
check('Mobile layout provides compact sticky context', css.includes('@media(max-width:760px)') && css.includes('top:76px') && css.includes('grid-template-columns:1fr auto'));
check('Journey code makes no network/provider request', !/\bfetch\s*\(|XMLHttpRequest|GlobevoyApi\./.test(source));
check('Fixture is isolated and offline', fixture.includes('offline=1') && fixture.includes("sessionStorage.setItem('globevoy.multi.selected.v1'"));
check('Recommendation choices use traveler-facing roles', engine.includes('Best overall') && engine.includes('Lowest verified cost') && engine.includes('Most inspiring'));
check('Booking engine is byte-identical to 686A', hash('scripts/booking-hub-685d.js') === '6344ffad400d52dbce0d5d104ea41b86e6bd39394377e028936ba5be7809236a');
check('Budget-confidence engine is byte-identical to 686A', hash('scripts/budget-confidence-685b.js') === '3ed77e95f240096f6d241499c1e0b517a1f97c77ae855bb9c85d0098f54eb832');
// 705B-R3 is an approved successor layered onto the 686D visual shell. Protect
// the journey isolation instead of pinning the shared shell to an old byte hash.
check('Product shell preserves 686D-R1 visual baseline while layering only 705B-R3 account entry', shell.includes('GV-SHELL-686D-R1') && shell.includes("dataset.gvShellVersion = '686d-r1'") && shell.includes("dataset.gvAccountVersion = '705b-r3'") && shell.includes('data-gv-auth-entry') && !shell.includes('gv-burger') && !shell.includes('gv-mobile-menu'));
check('API client and runtime config are byte-identical to 686A', hash('runtime/api-client.js') === 'd10d716b60d13f36b456a7797c22590ba5ca1c12bec31586d8e0c36242df8af6' && hash('runtime/config.js') === '191e377fdf5dba312e60f0b2c21c74b6283b729c982bcbff8c7c08fd637ea958');
// 706A intentionally layers an account-trip handoff around the protected 686C
// booking engines. Accept the old exact page or this reviewed successor only
// when the bridge runs before booking-live and the snapshot guard runs after
// the unchanged workspace engine. This keeps the historical compatibility
// marker: matches approved 686D-R1 minimal-header state.
const bookingHtml = read('booking.html');
const bookingPageExact686DR1 = hash('booking.html') === 'fdf15b58e66a871adb18525e0943caf3ef0084103b1b932280c31abc9e95be2b';
const bookingPage706A = bookingHtml.includes('meta name="gv-book-account" content="GV-BOOK-706A"')
  && bookingHtml.includes('booking-account-bridge-706a.js?v=706a')
  && bookingHtml.includes('booking-account-snapshot-706a.js?v=706a')
  && bookingHtml.indexOf('booking-account-bridge-706a.js?v=706a') < bookingHtml.indexOf('booking-live-673d.js?v=681a-r1')
  && bookingHtml.indexOf('booking-account-snapshot-706a.js?v=706a') > bookingHtml.indexOf('booking-workspace-686c.js?v=686c')
  && hash('scripts/booking-live-673d.js') === '8b39d74dca43f9e00ebc58b20b3ae29a9e53aeaeaeee737aced7d6e4e841e5be'
  && hash('scripts/booking-hub-685d.js') === '6344ffad400d52dbce0d5d104ea41b86e6bd39394377e028936ba5be7809236a';
check('Booking page matches approved 686D-R1 state or reviewed 706A account successor', bookingPageExact686DR1 || bookingPage706A);

checks.forEach((item, index) => console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}`));
const passed = checks.filter((item) => item.pass).length;
console.log(`GV-JOURNEY-686B: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;
