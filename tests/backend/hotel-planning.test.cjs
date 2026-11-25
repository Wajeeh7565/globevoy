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

test('summaries are only loaded with PRICE_INDEX_PLANNING=on, and expired ones are skipped', async () => {
  const store = require('../../backend/services/domain/pricing/hotel-price-index/store');
  store._internal.reset();
  const now = Date.parse('2027-01-01T00:00:00Z');
  let queries = 0;
  const db = { send: async cmd => { queries++; return { Items: [
    { pk: { S: 'PI#city' }, sk: { S: 'barcelona-es' }, summary: { S: JSON.stringify({ cityId: 'barcelona-es', median: 100 }) }, ttl: { N: String(now / 1000 + 86400) } },
    { pk: { S: 'PI#city' }, sk: { S: 'rome-it' }, summary: { S: JSON.stringify({ cityId: 'rome-it', median: 90 }) }, ttl: { N: String(now / 1000 - 1) } }] }; } };
  assert.equal((await store.loadAll({ env: { FARE_MAP_TABLE: 'globevoy-test' }, dynamo: db, clock: () => now })).size, 0);
  assert.equal(queries, 0, 'off by default: no read');
  const m = await store.loadAll({ env: { FARE_MAP_TABLE: 'globevoy-test', PRICE_INDEX_PLANNING: 'on' }, dynamo: db, clock: () => now });
  assert.deepEqual([...m.keys()], ['barcelona-es']);
  await store.loadAll({ env: { FARE_MAP_TABLE: 'globevoy-test', PRICE_INDEX_PLANNING: 'on' }, dynamo: db, clock: () => now + 60e3 });
  assert.equal(queries, 1, 'cached');
  store._internal.reset();
});
