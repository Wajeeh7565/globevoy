'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRouteDateWindowCache } = require('../../backend/services/domain/fare-map/fare-map-optimizer')._internal;

test('coalesces concurrent date requests for the same route and month window', async () => {
  const calls = [], diagnostics = {};
  const cache = createRouteDateWindowCache({
    cap: 2, diagnostics,
    read: async (a, b, months) => { calls.push([a,b,months]); return months; }
  });
  const [a,b] = await Promise.all([
    cache('LIS','YTO',['2027-01','2027-02']),
    cache('LIS','YTO',['2027-02','2027-01'])
  ]);
  assert.deepEqual(a,b);
  assert.equal(calls.length,1);
  assert.equal(diagnostics.routeDateReads,1);
  assert.equal(diagnostics.routeDateCacheHits,1);
});

test('a different month window for the same route is not mistaken for a cache hit', async () => {
  const calls = [], diagnostics = {};
  const cache = createRouteDateWindowCache({
    cap: 2, diagnostics,
    read: async (a,b,months) => { calls.push(months); return months; }
  });
  assert.deepEqual(await cache('LIS','YTO',['2027-01','2027-02']),['2027-01','2027-02']);
  assert.deepEqual(await cache('LIS','YTO',['2027-03','2027-04']),['2027-03','2027-04']);
  assert.deepEqual(await cache('MAD','YTO',['2027-03']),[]);
  assert.deepEqual(await cache('LIS','YTO',['2027-01','2027-02']),['2027-01','2027-02']);
  assert.equal(calls.length,2);
  assert.equal(diagnostics.routeDateReads,2);
});

test('read errors return no cached evidence and increment the error counter', async () => {
  const diagnostics = {};
  const cache = createRouteDateWindowCache({
    cap: 1, diagnostics, read: () => { throw new Error('mock read failure'); }
  });
  assert.deepEqual(await cache('LIS','YTO',['2027-01']),[]);
  assert.equal(diagnostics.routeDateErrors,1);
});
