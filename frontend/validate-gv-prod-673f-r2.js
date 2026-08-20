'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = __dirname;
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const bookingHtml = read('booking.html');
const bookingJs = read('scripts/booking-live-673d.js');
const visualizerHtml = read('multicity-visualizer.html');
const visualizerJs = read('scripts/multicity-visualizer-674a.js');
const detailsHtml = read('multi-city-trip.html');
const legacyMultiHtml = read('multi-city.html');
const imageJs = read('scripts/city-images-673c.js');
const indexHtml = read('index.html');

check('booking release/cache version', (bookingHtml.includes('GV-PROD-673F-R2') || bookingHtml.includes('GV-ENTRY-675A') || bookingHtml.includes('GV-BOOK-676A')) && (bookingHtml.includes('booking-live-673d.js?v=673f-r2') || bookingHtml.includes('booking-live-673d.js?v=677a-r1') || bookingHtml.includes('booking-live-673d.js?v=677b')) && bookingHtml.includes('booking-entry-675a.js?v=675a'));
check('honest primary action restored', bookingHtml.includes('>Book each flight separately</button>') && bookingJs.includes("allFlights?'Book each flight separately'"));
check('old broad primary action is absent', !bookingHtml.includes('View every flight and hotel') && !bookingJs.includes("allFlights?'View every flight and hotel'"));
check('booking loads API restoration dependencies', bookingHtml.includes('runtime/config.js') && bookingHtml.includes('runtime/api-client.js'));
check('shared multi-city route restores from backend', bookingJs.includes('async function restoreTour()') && bookingJs.includes("params.action='restore'"));
check('booking contains transport and stay collections', bookingHtml.includes('gv-booking-flights') && bookingHtml.includes('gv-booking-stays'));
check('booking remains honest about separate checkout', bookingJs.includes('no combined Globevoy checkout is available yet') && bookingHtml.includes('No combined checkout is currently available'));
check('673F-R2 photo baseline remains active in the superseding visualizer', (visualizerHtml.includes('GV-UX-674A') || visualizerHtml.includes('GV-ENTRY-675A')) && visualizerHtml.includes('city-images-673c.js?v=673f-r2') && /multicity-visualizer-674a\.js\?v=(674a|675a|677a|677b)/.test(visualizerHtml));
check('all itinerary card photos resolve immediately', visualizerJs.includes("cards.forEach((card,index)=>{") && visualizerJs.includes('resolveCard(card,index);'));
check('route photo hydration no longer waits for IntersectionObserver', !visualizerJs.includes("'IntersectionObserver' in window"));
check('all route card image requests are eager', visualizerJs.includes("installPhoto(card,generatedCityImage(city,country),city,country,'eager')"));
check('photo resolver identifies neutral artwork honestly', imageJs.includes('Photo unresolved — Globevoy is showing neutral artwork, not a verified city photograph'));
check('photo resolver uses R2 cache', imageJs.includes("CACHE_PREFIX='gv-city-images-v12-673f-r2:'"));
check('photo resolver reuses valid prior caches', imageJs.includes("LEGACY_CACHE_PREFIXES=['gv-city-images-v11-673f-r1:','gv-city-images-v10-673f:']") && imageJs.includes('migratedFrom:prefix'));
check('ambiguous photo cities use country validation', imageJs.includes('if(ambiguous){') && imageJs.includes('wikipediaDirectTitles(city,country,true)'));
check('duplicated destination cards removed from active details', !detailsHtml.includes('Your connected city stays') && detailsHtml.includes('id="gv-mtd-destinations" hidden'));
check('duplicated legacy destination section is hidden', !legacyMultiHtml.includes('Your connected city stays') && legacyMultiHtml.includes('id="mc-city-stays-legacy" hidden'));
check('favicon has ICO and PNG fallbacks', [bookingHtml, visualizerHtml, detailsHtml, legacyMultiHtml, indexHtml].every(html => html.includes('favicon.ico') && html.includes('favicon-64.png?v=673f-r2')));

const originSource = read('runtime/supported-origins.js');
const sandbox = { window: {} };
vm.runInNewContext(originSource, sandbox, { filename: 'supported-origins.js' });
const Origins = sandbox.window.GlobevoySupportedOrigins;
check('origin resolver version is current', Origins.source.includes('GV-ORIGIN-673F-R2'));
check('origin catalogue reports filtered totals', Origins.sourceCounts.rawOrigins === 9627 && Origins.sourceCounts.safeOrigins === 9232 && Origins.sourceCounts.rejectedOrigins === 395, JSON.stringify(Origins.sourceCounts));
const quarantine = JSON.parse(read('GV-PROD-673F-R2_ORIGIN_QUARANTINE.json'));
check('origin quarantine report matches catalogue', quarantine.summary.rawOrigins === 9627 && quarantine.summary.safeOrigins === 9232 && quarantine.summary.rejectedOrigins === 395 && quarantine.rejected.length === 395, JSON.stringify(quarantine.summary));
check('plain ambiguous city is rejected', Origins.find('Georgetown', { allowPrefix: false }) === null);
const georgetownLabels = Origins.matching('Georgetown').map(Origins.label);
check('ambiguous suggestions include country', georgetownLabels.length > 1 && georgetownLabels.every(label => label.includes(',')), georgetownLabels.slice(0, 6).join(' | '));
check('wrong-country Georgetown mapping is removed', !georgetownLabels.some(label => /Canada.*\(AUS\)/i.test(label)), georgetownLabels.join(' | '));
check('known wrong-country Zwara mapping is removed', Origins.find('Zwara', { allowPrefix: false }) === null);
check('known extreme Bingol mapping is removed', Origins.find('Bingol', { allowPrefix: false }) === null);
check('unambiguous city still resolves', Origins.find('Toronto', { allowPrefix: false })?.code === 'YYZ');
const unsafe = Origins.origins.filter(origin => {
  const type = String(origin.resolutionType || '');
  const limit = (type === 'exact_airport_city' || type === 'curated_origin') ? 160 : 500;
  return (origin.airportCountryCode && origin.countryCode && origin.airportCountryCode !== origin.countryCode)
    || Number(origin.distanceKm || 0) > limit
    || !String(origin.integrityStatus || '').startsWith('country');
});
check('all exposed origins satisfy country and distance checks', unsafe.length === 0, `unsafe=${unsafe.length}`);

if (process.exitCode) throw new Error('GV-PROD-673F-R2 frontend validation failed.');
const result = {
  release: 'GV-PROD-673F-R2',
  generatedAt: new Date().toISOString(),
  passed: true,
  checkCount: checks.length,
  checks
};
fs.writeFileSync(path.join(root, 'VALIDATION_GV_PROD_673F_R2.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`GV-PROD-673F-R2 frontend validation passed (${checks.length}/${checks.length}).`);
