'use strict';
const fs = require('fs');
const path = require('path');
const checks = [];
function read(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
function check(name, passed, details = null) { checks.push({ name, passed: Boolean(passed), details }); console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`); if (!passed) process.exitCode = 1; }
const visualizer = read('scripts/multicity-visualizer-674a.js');
const booking = read('scripts/booking-live-673d.js');
const trip = read('scripts/multi-city-trip-673a.js');
const config = read('runtime/config.js');
const visualizerHtml = read('multicity-visualizer.html');
const bookingHtml = read('booking.html');
const tripHtml = read('multi-city-trip.html');
check('frontend preserves GV-REC-677A-R1 transport integrity under current release', (config.includes('frontendVersion: "GV-REC-677A-R1"') || config.includes('frontendVersion: "GV-REC-677B"') || config.includes('bookingTrustVersion: "GV-QUALITY-680A"')) && (visualizer.includes("const FRONTEND_VERSION='GV-REC-677A-R1'") || visualizer.includes("const FRONTEND_VERSION='GV-REC-677B'") || visualizer.includes("const FRONTEND_VERSION='GV-QUALITY-680A'")) && visualizerHtml.includes('GV-REC-677A-R1 transport mode integrity'));
check('visualizer detects composite flight-bearing transport before ground labels', visualizer.includes('hasFlightComponent677AR1') && visualizer.includes('impossibleGroundDisplay677AR1') && visualizer.includes('if(hasFlightComponent677AR1(leg)||impossibleGroundDisplay677AR1(leg))return false'));
check('booking hub uses the same transport-mode integrity defense', booking.includes('hasFlightComponent677AR1') && booking.includes('impossibleGround677AR1') && booking.includes('if(hasFlightComponent677AR1(leg)||impossibleGround677AR1(leg))return false'));
check('trip details use the same transport-mode integrity defense', trip.includes('hasFlightComponent677AR1') && trip.includes('impossibleGround677AR1') && trip.includes("if(hasFlightComponent677AR1(leg)||impossibleGround677AR1(leg))return'flight'"));
check('visualizer cache-bust points at R1 or superseding release', visualizerHtml.includes('./scripts/multicity-visualizer-674a.js?v=677a-r1') || visualizerHtml.includes('./scripts/multicity-visualizer-674a.js?v=677b') || visualizerHtml.includes('./scripts/multicity-visualizer-674a.js?v=680a'));
check('booking cache-bust points at R1 or superseding release', bookingHtml.includes('./scripts/booking-live-673d.js?v=677a-r1') || bookingHtml.includes('./scripts/booking-live-673d.js?v=677b') || bookingHtml.includes('./scripts/booking-live-673d.js?v=680a'));
check('trip-details cache-bust points at R1 or superseding release', tripHtml.includes('./scripts/multi-city-trip-673a.js?v=677a-r1') || tripHtml.includes('./scripts/multi-city-trip-673a.js?v=677b') || tripHtml.includes('./scripts/multi-city-trip-673a.js?v=680a'));
const result = { release: 'GV-REC-677A-R1', generatedAt: new Date().toISOString(), passed: !process.exitCode, checkCount: checks.length, passedCount: checks.filter(x => x.passed).length, failedCount: checks.filter(x => !x.passed).length, checks };
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_REC_677A_R1_FRONTEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-REC-677A-R1 frontend validation failed.');
console.log(`GV-REC-677A-R1 frontend validation passed (${result.passedCount}/${result.checkCount}).`);
