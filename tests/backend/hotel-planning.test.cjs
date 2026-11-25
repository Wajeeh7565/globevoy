'use strict';
// GV-HOTEL-PLAN-002 (V2 task 6): hotel level for never-checked cities and the Price Index date shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const opt = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const S = require('../../backend/services/domain/pricing/hotel-price-index/summary');
const attr = require('../../backend/services/domain/live-fares/hotel-price-memory')._internal.attr;
const { regionRatios, stayShape } = opt._internal;

const row = (cityId, region) => ({ unifiedRegistry: { cityId, worldRegion: region } });

test('regional level: 75th percentile of learned ratios, only with 3+ learned cities in the region', () => {
  const rows = [row('a', 'europe'), row('b', 'europe'), row('c', 'europe'), row('d', 'europe'), row('x', 'africa'), row('y', 'africa'), row('z', 'europe')];
  const ratios = new Map([['a', 1.2], ['b', 1.4], ['c', 1.6], ['d', 1.8], ['x', 1.1], ['y', 1.3]].map(([id, r]) => [attr(id), { ratio: r }]));
  const out = regionRatios(ratios, rows, {});
  assert.equal(out.get('europe').ratio, 1.65);
  assert.equal(out.get('europe').cities, 4);
  assert.equal(out.has('africa'), false, 'two learned cities are not enough');
  assert.equal(regionRatios(ratios, rows, { FARE_MAP_REGION_COLD_START: 'off' }).size, 0, 'off switch');
  assert.equal(regionRatios(new Map(), rows, {}).size, 0);
});

test('date shape: the stay is priced by its own dates relative to the city median, clamped 0.7-1.8', () => {
  const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 11, 1) + i * 86400e3).toISOString().slice(0, 10));
  const sum = S.fromCity('barcelona-es', { prices: days.map(d => ({ day: d, usd: d >= '2026-12-24' && d <= '2027-01-02' ? 300 : 100 })) });
  const idx = new Map([['barcelona-es', sum]]);
  assert.ok(stayShape(idx, { cityId: 'barcelona-es', arrivalDate: '2026-12-30', nights: 3 }) >= 1.8 - 1e-9, 'New Year: clamped at 1.8');
  assert.equal(stayShape(idx, { cityId: 'barcelona-es', arrivalDate: '2027-01-10', nights: 3 }), 1);
  assert.equal(stayShape(idx, { cityId: 'lisbon-pt', arrivalDate: '2027-01-10', nights: 3 }), null, 'no summary: no shape');
  assert.equal(stayShape(idx, { cityId: 'barcelona-es', arrivalDate: '2028-01-10', nights: 3 }), null, 'outside the data: no guess');
  assert.equal(stayShape(null, { cityId: 'barcelona-es', arrivalDate: '2027-01-10' }), null);
});

test('summaries are only loaded with BOTH PRICE_INDEX_STORAGE=on and PRICE_INDEX_PLANNING=on; expired ones are skipped', async () => {
  const store = require('../../backend/services/domain/pricing/hotel-price-index/store');
  store._internal.reset();
  const now = Date.parse('2027-01-01T00:00:00Z');
  let queries = 0;
  const db = { send: async cmd => { queries++; return { Items: [
    { pk: { S: 'PI#city' }, sk: { S: 'barcelona-es' }, summary: { S: JSON.stringify({ cityId: 'barcelona-es', median: 100 }) }, ttl: { N: String(now / 1000 + 86400) } },
    { pk: { S: 'PI#city' }, sk: { S: 'rome-it' }, summary: { S: JSON.stringify({ cityId: 'rome-it', median: 90 }) }, ttl: { N: String(now / 1000 - 1) } }] }; } };
  assert.equal((await store.loadAll({ env: { FARE_MAP_TABLE: 'globevoy-test' }, dynamo: db, clock: () => now })).size, 0);
  assert.equal((await store.loadAll({ env: { FARE_MAP_TABLE: 'globevoy-test', PRICE_INDEX_PLANNING: 'on' }, dynamo: db, clock: () => now })).size, 0, 'planning without storage: no read');
  assert.equal((await store.loadAll({ env: { FARE_MAP_TABLE: 'globevoy-test', PRICE_INDEX_STORAGE: 'on' }, dynamo: db, clock: () => now })).size, 0, 'storage without planning: no read');
  assert.equal(queries, 0, 'off by default: no read');
  const m = await store.loadAll({ env: { FARE_MAP_TABLE: 'globevoy-test', PRICE_INDEX_PLANNING: 'on', PRICE_INDEX_STORAGE: 'on' }, dynamo: db, clock: () => now });
  assert.deepEqual([...m.keys()], ['barcelona-es']);
  await store.loadAll({ env: { FARE_MAP_TABLE: 'globevoy-test', PRICE_INDEX_PLANNING: 'on', PRICE_INDEX_STORAGE: 'on' }, dynamo: db, clock: () => now + 60e3 });
  assert.equal(queries, 1, 'cached');
  store._internal.reset();
});

test('hotel memory learns the cheap-but-good all-in price, not a budget upgrade', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../backend/services/domain/tours/generated-tour.js'), 'utf8');
  const line = src.split('\n').find(l => l.includes('diagnostics.nuiteeHotelObservations = '));
  assert.match(line, /nuiteeLiveRate\.totalUsd/, 'all-in total (taxes and fees paid at the hotel included)');
  assert.match(line, /budgetUpgrade\?\.extraUsd/, 'upgrade extra taken off');
});

// GV-HOTEL-MEM-002: settings for memory learned before the upgrade/fee fixes (defaults unchanged).
test('legacy memory rules: trust by default; shrink, regional and ignore when a clean-since time is set', () => {
  const { memoryLevel, legacyRule, regionQuantile } = opt._internal;
  const ratios = new Map([[attr('old-city'), { ratio: 2.6, at: 1000 }], [attr('new-city'), { ratio: 1.6, at: 5000 }]]);
  const reg = new Map([['europe', { ratio: 1.7 }]]);
  const stop = id => ({ cityId: id, regionFamily: 'europe' });
  assert.equal(legacyRule({}).mode, 'trust');
  assert.equal(memoryLevel(ratios, stop('old-city'), reg, {}).level.toFixed(2), (2.6 * 1.05).toFixed(2), 'default: as today');
  const env = m => ({ HOTEL_MEMORY_CLEAN_SINCE: '3000', HOTEL_MEMORY_LEGACY: m });
  assert.equal(memoryLevel(ratios, stop('old-city'), reg, env('shrink')).level.toFixed(3), ((1 + 1.6 / 2) * 1.05).toFixed(3));
  assert.equal(memoryLevel(ratios, stop('old-city'), reg, env('regional')).level, 1.7);
  assert.equal(memoryLevel(ratios, stop('old-city'), reg, env('ignore')), null);
  assert.equal(memoryLevel(ratios, stop('new-city'), reg, env('ignore')).kind, 'learned', 'clean entries are always trusted');
  assert.equal(legacyRule({ HOTEL_MEMORY_LEGACY: 'shrink' }).mode, 'trust', 'no clean-since time: nothing is legacy');
  assert.equal(regionQuantile({}), 0.75); assert.equal(regionQuantile({ FARE_MAP_REGION_QUANTILE: '0.6' }), 0.6); assert.equal(regionQuantile({ FARE_MAP_REGION_QUANTILE: '0.2' }), 0.75);
});

test('legacy memory: regional calibration leaves legacy entries out (or halves their excess with shrink)', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => row(id, 'europe'));
  const ratios = new Map([['a', 2.8, 1], ['b', 2.6, 1], ['c', 2.4, 1], ['d', 1.5, 9], ['e', 1.6, 9], ['f', 1.7, 9]].map(([id, r, at]) => [attr(id), { ratio: r, at }]));
  const base = { HOTEL_MEMORY_CLEAN_SINCE: '5', FARE_MAP_REGION_QUANTILE: '0.5' };
  assert.equal(regionRatios(ratios, rows, { FARE_MAP_REGION_QUANTILE: '0.5' }).get('europe').ratio, 2.05, 'trust: legacy pulls the level up');
  assert.equal(regionRatios(ratios, rows, { ...base, HOTEL_MEMORY_LEGACY: 'regional' }).get('europe').ratio, 1.6, 'clean only');
  assert.equal(regionRatios(ratios, rows, { ...base, HOTEL_MEMORY_LEGACY: 'shrink' }).get('europe').ratio, 1.7, 'legacy 2.8/2.6/2.4 count as 1.9/1.8/1.7');
});

test('legacy memory: one clean observation replaces 80% of a legacy entry (only with the setting)', async () => {
  const mem = require('../../backend/services/domain/live-fares/hotel-price-memory');
  const item = { Item: { pk: { S: 'MEM#hotel' }, sk: { S: 'ratios' }, r_rome_it: { N: '2.5' }, n_rome_it: { N: '5' }, t_rome_it: { N: String(Date.parse('2026-11-24T00:00:00Z')) } } };
  const run = async env => {
    let saved = null; mem._internal.reset();
    const dynamo = { send: async cmd => { if (cmd.input.Item) { saved = cmd.input.Item; return {}; } return item; } };
    await mem.record([{ cityId: 'rome-it', estimateUsd: 100, liveUsd: 150 }], { env: { FARE_MAP_TABLE: 'globevoy-test', ...env }, dynamo, clock: () => Date.parse('2026-11-26T00:00:00Z') });
    mem._internal.reset(); return Number(saved.r_rome_it.N);
  };
  assert.equal(await run({}), Number(((2.5 * 5 + 1.5) / 6).toFixed(3)), 'default: rolling average as today');
  assert.equal(await run({ HOTEL_MEMORY_LEGACY: 'shrink', HOTEL_MEMORY_CLEAN_SINCE: '2026-11-25T09:23:00Z' }), 1.7, '0.25 x 2.5 + 1 x 1.5 over 1.25');
});

test('memory report reads a get-item export and splits legacy from clean entries', () => {
  const R = require('../performance/hotel-memory-report.cjs');
  const fs = require('fs'), os = require('os'), p = require('path');
  const f = p.join(os.tmpdir(), 'mem-' + process.pid + '.json');
  fs.writeFileSync(f, '﻿' + JSON.stringify({ Item: { savedAt: { N: '200000000' }, r_barcelona_es: { N: '2.4' }, n_barcelona_es: { N: '5' }, t_barcelona_es: { N: '1000' }, r_lisbon_pt: { N: '1.6' }, n_lisbon_pt: { N: '2' }, t_lisbon_pt: { N: '199000000' } } }));
  const r = R.report(f, 100000000); fs.unlinkSync(f);
  assert.equal(r.cities, 2);
  assert.equal(r.legacyVsClean['legacy (before fix)'].median, 2.4);
  assert.equal(r.legacyVsClean['clean (after fix)'].median, 1.6);
});
