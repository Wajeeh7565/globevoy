'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const index = read('index.html');
const home = read('scripts/home-live-674a.js');
const trip = read('multi-city-trip.html');
const tripJs = read('scripts/multi-city-trip-673a.js');
const visualizer = read('scripts/multicity-visualizer-674a.js');
const visualizerHtml = read('multicity-visualizer.html');
const config = read('runtime/config.js');

assert.match(index, /GV-QUALITY-680B-R1/);
assert.match(index, /What matters most\?/);
assert.doesNotMatch(index, /id="gv-trip-style"/);
assert.match(index, /id="gv-travel-pace"/);
assert.match(index, /id="gv-flight-preference"/);
assert.match(index, /at least 14 days from today/);
assert.match(home, /minimumLeadDays', '14'/);
assert.match(home, /params\.set\('priorities'/);
assert.match(home, /startDate\.min = today/);

assert.doesNotMatch(trip, /WHY THIS ROUTE FITS/i);
assert.doesNotMatch(trip, /Route cost breakdown/i);
assert.match(trip, /gv-mtd-route-alert/);
assert.doesNotMatch(tripJs.match(/function render\(t\)\{[^\n]+/)[0], /renderBudget\(t\)/);
assert.match(tripJs, /restoredFromSharedLink:true/);
assert.match(tripJs, /above the saved budget/);

assert.match(visualizer, /GV-QUALITY-680B-R1/);
assert.match(visualizer, /saved-route-over-budget/);
assert.match(visualizer, /restoredFromSharedLink:true/);
assert.match(visualizerHtml, /v=680b-r1/);
assert.match(config, /routeQualityVersion: "GV-QUALITY-680B-R1"/);

console.log('PASS GV-QUALITY-680B-R1 frontend recovery, simplified details, and wired advanced options');
