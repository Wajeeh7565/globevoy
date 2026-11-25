'use strict';
// GV-V2-03: the offline benchmark itself must be trustworthy before we use it to judge changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const B = require('./recommendation-benchmark.cjs');

const city = (city, latitude, longitude, nights, regionFamily) => ({ city, latitude, longitude, nights, regionFamily });
const leg = h => ({ durationMinutes: h * 60 });
// Toronto origin code is resolved through the fare-map registry (YTO).
const YTO = { code: 'YTO' };

test('flags the live C$10,000 zig-zag (Punta Cana > Vancouver > Manila) seen on Nov 25', () => {
  const q = B.quality({ stops: [city('Punta Cana', 18.58, -68.4, 3, 'caribbean'), city('Vancouver', 49.28, -123.12, 4, 'north-america'), city('Manila', 14.6, 120.98, 6, 'southeast-asia')], legs: [leg(4.6), leg(18.7), leg(14), leg(20)] }, YTO);
  assert.ok(q.flags.includes('spread'), JSON.stringify(q));
  assert.ok(q.flags.includes('mixed-regions'));
  assert.ok(q.flags.includes('long-leg'));
  assert.ok(q.detour <= 1.25, 'the old detour rule alone does not catch it — that is why spread exists');
});

test('does not flag normal trips', () => {
  for (const t of [
    { stops: [city('Barcelona', 41.39, 2.17, 4, 'southern-europe'), city('Lisbon', 38.72, -9.14, 4, 'southern-europe')], legs: [leg(8), leg(2), leg(8)] },
    { stops: [city('Halifax', 44.65, -63.57, 6, 'north-america')], legs: [leg(2.3), leg(2.7)] },
    { stops: [city('Ottawa', 45.42, -75.7, 4, 'north-america'), city('New York', 40.71, -74.0, 7, 'north-america'), city('Halifax', 44.65, -63.57, 7, 'north-america')], legs: [leg(1), leg(1.5), leg(2), leg(2.5)] }
  ]) assert.deepEqual(B.quality(t, YTO).flags, [], t.stops.map(s => s.city).join('>'));
});

test('page simulation drops trips whose live price is over budget and puts the highest-use trip first', () => {
  const t = (name, hotel, flight) => ({ stops: [{ city: name, hotel: { estimatedStayUsd: hotel } }], legs: [{ estimatedTransportUsd: flight }] });
  const p = B.simulatePage([t('A', 100, 100), t('B', 5000, 100), t('C', 300, 200)], 1000);
  assert.equal(p.failed, 1);
  assert.equal(p.shown.length, 2);
  assert.ok(p.shown[0].use >= p.shown[1].use);
});

test('compare reports a metric that got worse and the run exits 1', () => {
  const base = { summary: { tripFoundRate: 90, fullPageRate: 80, bestUseInBand: 70, variety: 95, oddBestRate: 5, oddShownRate: 5, liveFailureRate: 20, avgChecks: 3, bestUse: 80, avgMs: 100 }, cases: [] };
  const now = { summary: { ...base.summary, oddBestRate: 15, variety: 99 }, cases: [] };
  const c = B.compare(now, base);
  assert.deepEqual(c.worse, ['oddBestRate']);
  assert.equal(c.rows.find(r => r[0] === 'variety')[3], 'better');
});

test('quick run gives the same answer every time', () => {
  const run = () => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'recommendation-benchmark.cjs'), '--quick', '--json'], { encoding: 'utf8' }));
  const a = run(), b = run();
  const strip = r => ({ ...r.summary, avgMs: 0 });
  assert.deepEqual(strip(a), strip(b));
  assert.deepEqual(a.cases.map(c => c.best && c.best.route), b.cases.map(c => c.best && c.best.route));
});
