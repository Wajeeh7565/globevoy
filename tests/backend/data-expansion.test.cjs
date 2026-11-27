'use strict';
// Offline: data expansion settings (GV-DATA-DYN-001, GV-DATA-READS-001, GV-DATA-DATES-001).
const test = require('node:test');
const assert = require('node:assert/strict');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const B = require('../performance/recommendation-benchmark.cjs');
const I = optimizer._internal;

const search = (env, extra = {}) => {
  B.setOriginCodes(['YTO']);
  return optimizer.search({ origin: 'Toronto (YYZ)', budget: 5000, currency: 'CAD', adults: 1 },
    { env: { ENABLE_FARE_MAP_OPTIMIZER: 'true', FARE_MAP_TABLE: 'benchmark', ...env }, now: B.NOW, readRoutes: B.fareReader(), hotelRatios: B.simulatedMemory(), ...extra });
};

test('discovered cities come from the catalogue, never duplicate a registry city, and carry no list of places', () => {
  const base = I.rows(), dyn = I.dynamicRows(base);
  assert.ok(dyn.length > 1000, String(dyn.length));
  const taken = new Set();
  for (const r of base) for (const c of [I.code(r), r.cityCode, ...(r.unifiedRegistry?.origin?.airportCodes || [])]) if (c) taken.add(String(c).toUpperCase());
  const seen = new Set();
  for (const r of dyn) {
    const c = I.code(r);
    assert.ok(/^[A-Z]{3}$/.test(c));
    assert.ok(!taken.has(c), `${c} is a registry city`);
    assert.ok(!seen.has(c), `${c} twice`); seen.add(c);
    assert.ok(I.isDynamic(r));
    assert.ok(Number.isFinite(r.unifiedRegistry.latitude) && r.unifiedRegistry.timeZone);
    assert.equal(r.unifiedRegistry.destination.maximumRecommendedNights, 5, 'short stays until the city is known');
    assert.ok(r.unifiedRegistry.cityId.startsWith('discovered-'));
  }
});

test('dynamic destinations are off by default and change nothing', async () => {
  const a = await search({}), b = await search({ FARE_MAP_DYNAMIC_DESTINATIONS: 'off' });
  assert.equal(a.diagnostics.dynamicCandidates, undefined);
  assert.deepEqual(a.pool.map(t => t.stops.map(s => s.cityId).join('>')), b.pool.map(t => t.stops.map(s => s.cityId).join('>')));
});

test('with the flag: more candidates, at most the allowed discovered cities per trip, and each one connected', async () => {
  const r = await search({ FARE_MAP_DYNAMIC_DESTINATIONS: 'on', FARE_MAP_DYNAMIC_MIN_ROUTES: '1' });
  assert.ok(r.diagnostics.dynamicCandidates > 1000, String(r.diagnostics.dynamicCandidates));
  for (const t of r.pool || []) assert.ok(t.stops.filter(s => String(s.cityId).startsWith('discovered-')).length <= 1);
  const none = await search({ FARE_MAP_DYNAMIC_DESTINATIONS: 'on', FARE_MAP_DYNAMIC_MAX_PER_TRIP: '0' });
  for (const t of none.pool || []) assert.ok(!t.stops.some(s => String(s.cityId).startsWith('discovered-')));
});

test('study settings are bounded', async () => {
  const r = await search({ FARE_MAP_MAX_READS: '100000', FARE_MAP_MAX_AGE_DAYS: '999' });
  assert.ok(r.diagnostics.reads <= 256);
});

test('real route dates replace estimated return dates when they fit the stay', async () => {
  const est = await search({});
  const dates = (a, h) => Array.from({ length: 150 }, (_, i) => ({ departureDate: new Date(B.NOW + (i + 3) * 86400000).toISOString().slice(0, 10), priceUsd: 400, stops: 1 }));
  const real = await search({}, { routeDates: dates });
  if (est.diagnostics.estimatedReturnDates) assert.ok(real.diagnostics.realReturnDates > 0, JSON.stringify(real.diagnostics));
  assert.ok((real.diagnostics.estimatedReturnDates || 0) <= (est.diagnostics.estimatedReturnDates || 0));
});

const dates = require('../../backend/services/domain/fare-map/fare-map-dates');
const ingest = require('../../backend/services/domain/fare-map/fare-map-ingest');

test('month-matrix rows become one record per day, in USD, skipping stale and foreign-month rows', async () => {
  const now = Date.parse('2026-11-27T00:00:00Z'), seen = [];
  const fetch = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: [
    { depart_date: '2027-01-05', value: 300, number_of_changes: 1, found_at: '2026-11-26T10:00:00Z' },
    { depart_date: '2027-01-05', value: 280, number_of_changes: 0, found_at: '2026-11-26T11:00:00Z' },
    { depart_date: '2027-01-09', value: 410, number_of_changes: 2, found_at: '2026-11-01T00:00:00Z' },
    { depart_date: '2027-02-01', value: 100, found_at: '2026-11-26T00:00:00Z' },
    { depart_date: '2027-01-12', value: 0 }] }) }; };
  const r = await dates.fetchRouteDates({ origin: 'lis', destination: 'YTO', month: '2027-01', token: 't', fetch, clock: () => now });
  assert.equal(r.ok, true);
  assert.deepEqual(r.records.map(x => [x.departureDate, x.priceUsd, x.stops]), [['2027-01-05', 280, 0]]);
  assert.match(seen[0].url, /currency=usd/); assert.match(seen[0].url, /origin=LIS/);
  assert.equal(seen[0].init.headers['X-Access-Token'], 't'); assert.doesNotMatch(seen[0].url, /token=/);
  const item = dates.toItem(r.records[0], now);
  assert.equal(item.pk.S, 'D#LIS#2027-01'); assert.equal(item.sk.S, 'YTO#2027-01-05');
  assert.deepEqual(dates.fromItem(item).departureDate, '2027-01-05');
  assert.equal((await dates.fetchRouteDates({ origin: 'LIS', destination: 'LIS', month: '2027-01', token: 't', fetch })).reason, 'invalid-route');
  assert.equal((await dates.fetchRouteDates({ origin: 'LIS', destination: 'YTO', month: '2027-01', token: 't', fetch: async () => ({ ok: false, status: 429 }) })).reason, 'rate-limited');
});

test('route dates are read per route, never the whole partition', async () => {
  const sent = [];
  const dynamo = { send: async c => { sent.push(c.input); return { Items: [dates.toItem({ origin: 'LIS', destination: 'YTO', month: '2027-01', departureDate: '2027-01-05', priceUsd: 280, stops: 0, source: 's', observedAt: 'x' })] }; } };
  const r = await dates.readRouteDates('LIS', 'YTO', ['2027-01', 'bad'], { env: { FARE_MAP_TABLE: 'tbl' }, dynamo });
  assert.equal(sent.length, 1);
  assert.match(sent[0].KeyConditionExpression, /begins_with/);
  assert.equal(sent[0].ExpressionAttributeValues[':d'].S, 'YTO#');
  assert.equal(r[0].priceUsd, 280);
});

test('collector asks for stops and duration only with FARE_MAP_COLLECT_COMFORT=on', () => {
  assert.doesNotMatch(ingest._internal.buildQuery('YTO', '2027-01', 0), /number_of_changes/);
  const q = ingest._internal.buildQuery('YTO', '2027-01', 0, true);
  assert.match(q, /number_of_changes/); assert.match(q, /duration/);
});
