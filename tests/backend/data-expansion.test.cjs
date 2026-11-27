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
  assert.ok(r.diagnostics.dynamicCandidates > 300, String(r.diagnostics.dynamicCandidates));
  const open = await search({ FARE_MAP_DYNAMIC_DESTINATIONS: 'on', FARE_MAP_DYNAMIC_MIN_GOOD_HOTELS: '0' });
  assert.ok(open.diagnostics.dynamicCandidates > r.diagnostics.dynamicCandidates, 'the good-hotel check removes thin cities');
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

test('experience mode: off by default; on, it never shows same-country multi-city first when a cross-border trip exists', async () => {
  const off = await search({});
  assert.equal(off.diagnostics.experience, false);
  const on = await search({ FARE_MAP_EXPERIENCE: 'on' });
  assert.equal(on.diagnostics.experience, true);
  const pool = on.pool || [];
  const multi = pool.filter(t => t.stops.length > 1);
  const cross = multi.filter(t => new Set(t.stops.map(s => s.countryCode)).size > 1);
  if (cross.length && multi.length) assert.ok(new Set(multi[0].stops.map(s => s.countryCode)).size > 1, multi[0].stops.map(s => s.city).join('>'));
});

test('comfort hotel copies: only under 89% of spendable, at most +50% per stay, never past spendable', () => {
  const row = c => ({ unifiedRegistry: { countryCode: 'PT', origin: { providerLocationCode: c } }, cityCode: c });
  const base = { key: 'k', cost: 1000, cities: [row('LIS')], tour: { totalFlightEstimateUsd: 400, totalHotelEstimateUsd: 600, estimatedTotalUsd: 1000,
    stops: [{ city: 'Lisbon', nights: 6, hotel: { estimatedNightlyUsd: 100, estimatedStayUsd: 600 } }], legs: [] } };
  const [v] = I.comfortVariants([base], 2000);
  assert.ok(v && v.comfortHotels && v.tour.hotelTier === 'comfort');
  assert.ok(v.tour.stops[0].hotel.planUpgradePct <= 0.5);
  assert.ok(v.cost <= 2000, String(v.cost));
  assert.equal(I.comfortVariants([{ ...base, cost: 1800 }], 2000).length, 0, 'already at 90% of spendable');
  assert.equal(I.comfortVariants([{ ...base, cities: [row('ZZZ')] }], 2000).length, 0, 'no good 3-4 star supply');
});

test('hotel quality is a soft signal: unknown cities get a neutral value, not zero', () => {
  assert.ok(I.hotelQuality({ cityCode: 'LIS', unifiedRegistry: { origin: { providerLocationCode: 'LIS' } } }) > I.hotelQuality({ cityCode: 'GZP', unifiedRegistry: { origin: { providerLocationCode: 'GZP' } } }));
  assert.equal(I.hotelQuality({ cityCode: 'ZZZ', unifiedRegistry: { origin: { providerLocationCode: 'ZZZ' } } }), 0.35);
});

test('date pass: both directions, no duplicate requests, bounded, writes D# rows only', async () => {
  const { runDatePass } = require('../../backend/services/domain/fare-map/fare-map-date-pass');
  const calls = [], writes = [];
  const fetch = async url => { calls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, data: [{ depart_date: '2027-01-05', value: 300, number_of_changes: 0 }, { depart_date: '2027-01-09', value: 280, number_of_changes: 1 }] }) }; };
  const dynamo = { send: async c => { writes.push(...Object.values(c.input.RequestItems)[0]); return {}; } };
  const readRoutes = async (o, m) => o === 'YTO' ? [{ destination: 'LIS', priceUsd: 300 }, { destination: 'MEX', priceUsd: 200 }, { destination: 'LIS', priceUsd: 350 }] : [];
  let t = Date.parse('2026-11-27T00:00:00Z');
  const stats = await runDatePass({ token: 't', fetch, dynamo, readRoutes, origins: ['YTO'], months: ['2027-01'], routes: 5, env: { FARE_MAP_TABLE: 'tbl' }, clock: () => t, sleep: async ms => { t += ms; } });
  assert.equal(stats.requests, 4, 'YTO>LIS, LIS>YTO, YTO>MEX, MEX>YTO');
  assert.equal(new Set(calls).size, 4);
  assert.ok(writes.every(w => w.PutRequest.Item.pk.S.startsWith('D#')));
  assert.equal(stats.rows, 8);
  const capped = await runDatePass({ token: 't', fetch, dynamo, readRoutes, origins: ['YTO'], months: ['2027-01'], maxRequests: 1, env: { FARE_MAP_TABLE: 'tbl' }, clock: () => t, sleep: async ms => { t += ms; }, dryRun: true });
  assert.equal(capped.requests, 1); assert.equal(capped.stoppedBy, 'max-requests');
});

test('legs carry stops; flight convenience prefers known direct legs', () => {
  const mk = st => ({ cost: 900, cities: [{ unifiedRegistry: { countryCode: 'PT' } }], tour: { stops: [{ nights: 5 }], legs: [{ stops: st }, { stops: st }] } });
  assert.ok(I.experienceParts(mk(0), 1000, 'CA').flight > I.experienceParts(mk(2), 1000, 'CA').flight);
  assert.equal(I.experienceParts(mk(null), 1000, 'CA').flight, 0.55);
});
