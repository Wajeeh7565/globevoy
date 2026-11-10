'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = file => fs.readFileSync(file, 'utf8');
const booking = read('booking.html');
const bookingLive = read('scripts/booking-live-673d.js');
const bookingEntry = read('scripts/booking-entry-675a.js');
const bookingDuffel = read('scripts/booking-duffel-676a.js');
const visualizer = read('scripts/multicity-visualizer-674a.js');
const visualizerHtml = read('multicity-visualizer.html');
const trip = read('scripts/multi-city-trip-673a.js');
const tripHtml = read('multi-city-trip.html');
const config = read('runtime/config.js');

assert.match(booking, /GV-QUALITY-680A/);
assert.match(booking, /Protected reserve/);
assert.match(booking, /Remaining after reserve/);
assert.match(booking, /id="gv-duffel-section"[^>]*hidden/);
assert.match(booking, /booking-live-673d\.js\?v=680a/);
assert.match(bookingLive, /Fare observed · not a live quote/);
assert.match(bookingLive, /Planning estimate · not a quote/);
assert.match(bookingLive, /Check this itinerary on Aviasales/);
assert.match(bookingLive, /Search this route on Aviasales/);
assert.match(bookingLive, /View selected property in Agoda results/);
assert.match(bookingLive, /must be rechecked/);
assert.match(bookingLive, /showSandbox/);
assert.match(bookingEntry, /i<80/);
assert.match(bookingEntry, /GlobevoyBooking673FR1\?\.tour/);
assert.match(bookingDuffel, /i<80/);
assert.match(visualizer, /Rate observed · availability not confirmed/);
assert.match(visualizer, /not live quotes/);
assert.doesNotMatch(visualizer, /return '★★★★'/);
assert.doesNotMatch(visualizer, /Timing confirmed with partner/);
assert.match(visualizerHtml, /multicity-visualizer-674a\.js\?v=680(?:a|b)/);
assert.match(trip, /Fare observed · not a live quote/);
assert.match(trip, /Check this property on Agoda/);
assert.doesNotMatch(trip, /central value stay/);
assert.match(tripHtml, /Remaining after reserve/);
assert.match(tripHtml, /multi-city-trip-673a\.js\?v=680(?:a|b)/);
assert.match(config, /bookingTrustVersion: "GV-QUALITY-680A"/);

console.log('PASS GV-QUALITY-680A frontend trust, totals, restoration, and sandbox checks');
