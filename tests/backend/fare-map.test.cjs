'use strict';
// Offline: Travelpayouts and DynamoDB are mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const ingest = require('../../backend/services/domain/fare-map/fare-map-ingest');
const store = require('../../backend/services/domain/fare-map/fare-map-store');
const job = require('../../backend/services/domain/fare-map/fare-map-job');

function tpFetch(pages, seen = []) {
  return async (url, init) => {
    const q = JSON.parse(init.body).query; seen.push(q);
    const offset = Number((q.match(/offset: (\d+)/) || [])[1] || 0);
    const rows = pages[offset / 250] || [];
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { prices_one_way: rows } }) };
  };
}
function fakeDynamo() {
  const items = new Map(); const calls = [];
  return { items, calls, send: async (c) => {
    const name = c.constructor.name; calls.push(name); const i = c.input;
    if (name === 'BatchWriteItemCommand') { for (const [, reqs] of Object.entries(i.RequestItems)) reqs.forEach(r => items.set(r.PutRequest.Item.pk.S + '|' + r.PutRequest.Item.sk.S, r.PutRequest.Item)); return {}; }
    if (name === 'PutItemCommand') { items.set(i.Item.pk.S + '|' + i.Item.sk.S, i.Item); return {}; }
    if (name === 'GetItemCommand') { return { Item: items.get(i.Key.pk.S + '|' + i.Key.sk.S) }; }
    if (name === 'QueryCommand') { const pk = i.ExpressionAttributeValues[':pk'].S; return { Items: [...items.entries()].filter(([k]) => k.startsWith(pk + '|')).map(([, v]) => v) }; }
    return {};
  } };
}
const ENV = { ENABLE_FARE_MAP_JOB: 'true', FARE_MAP_TABLE: 'globevoy-fare-map', TRAVELPAYOUTS_TOKEN: 'tp_test' };

test('ingest: one origin+month → cheapest fare per destination, validated', async () => {
  const seen = [];
  const r = await ingest.ingestOriginMonth({ origin: 'yto', month: '2026-12', token: 't', now: Date.parse('2026-11-19T00:00:00Z'), fetch: tpFetch([[
    { destination_city_iata: 'MDE', departure_at: '2026-12-03T10:00:00Z', value: 320, number_of_changes: 1, duration: 410 },
    { destination_city_iata: 'MDE', departure_at: '2026-12-09T10:00:00Z', value: 300 },
    { destination_city_iata: 'LIS', departure_at: '2027-01-02T10:00:00Z', value: 450 },
    { destination_city_iata: 'YTO', value: 10 },
    { destination_city_iata: 'bad1', value: 10 },
    { destination_city_iata: 'CUN', value: -5 }
  ]], seen) });
  assert.equal(r.ok, true);
  assert.equal(r.requests, 1);
  assert.match(seen[0], /origin: "YTO", depart_months: "2026-12"/);
  const by = Object.fromEntries(r.records.map(x => [x.destination, x]));
  assert.deepEqual(Object.keys(by).sort(), ['LIS', 'MDE']);
  assert.equal(by.MDE.priceUsd, 300);
  assert.equal(by.LIS.departureDate, null, 'date outside the month is dropped');
  assert.equal(by.MDE.source, 'travelpayouts-cached');
});

test('ingest refuses bad input and missing token', async () => {
  assert.equal((await ingest.ingestOriginMonth({ origin: 'YTO"}', month: '2026-12', token: 't' })).reason, 'invalid-origin-or-month');
  assert.equal((await ingest.ingestOriginMonth({ origin: 'YTO', month: '2026-12' })).reason, 'travelpayouts-token-missing');
});

test('ingest pages until a short page', async () => {
  const full = Array.from({ length: 250 }, (_, i) => ({ destination_city_iata: 'A' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)), value: 100 + i }));
  const r = await ingest.ingestOriginMonth({ origin: 'YTO', month: '2026-12', token: 't', fetch: tpFetch([full, [{ destination_city_iata: 'ZZZ', value: 99 }]]) });
  assert.equal(r.requests, 2);
  assert.ok(r.records.some(x => x.destination === 'ZZZ'));
});

test('months and origins from the registry', () => {
  assert.deepEqual(ingest.upcomingMonths(3, Date.parse('2026-11-19T00:00:00Z')), ['2026-11', '2026-12', '2027-01']);
  const codes = ingest.originCodesFromRegistry(require('../../backend/data/unified-city-registry-1000.json'));
  assert.ok(codes.length > 500, String(codes.length));
  assert.ok(codes.includes('YTO'));
});

test('store round-trips records and reads one origin+month with a single query', async () => {
  const dynamo = fakeDynamo();
  const rec = { origin: 'YTO', month: '2026-12', destination: 'MDE', priceUsd: 300, departureDate: '2026-12-09', stops: 1, durationMinutes: 410, source: 'travelpayouts-cached', observedAt: '2026-11-19T00:00:00.000Z' };
  assert.equal(await store.writeRecords([rec], { env: ENV, dynamo, sleep: false }), 1);
  const back = await store.readRoutesFrom('YTO', '2026-12', { env: ENV, dynamo });
  assert.deepEqual(back, [{ ...rec }].map(({ ...x }) => x));
  assert.ok(Number(dynamo.items.get('F#YTO#2026-12|MDE').ttl.N) > Date.now() / 1000);
});

test('job: off by default; resumes from its cursor and wraps at the end of a cycle', async () => {
  assert.equal((await job.runFareMapJob({ env: {} })).reason, 'disabled');
  const dynamo = fakeDynamo();
  const fetch = tpFetch([[{ destination_city_iata: 'MDE', value: 300 }]]);
  const opts = { env: ENV, dynamo, fetch, origins: ['YTO', 'YMQ'], pauseMs: 0, now: Date.parse('2026-11-19T00:00:00Z') };
  const first = await job.runFareMapJob({ ...opts, maxTasks: 1 }); // stops after the first task
  assert.equal(first.done, 1);
  assert.equal(first.finishedCycle, false);
  const rest = await job.runFareMapJob({ ...opts, timeBudgetMs: 60000 });
  assert.equal(rest.startIndex, 1);
  assert.equal(rest.finishedCycle, true);
  assert.equal(first.done + rest.done, 12, '2 origins × 6 months');
  assert.equal((await store.readCursor({ env: ENV, dynamo })).index, 0);
  assert.equal((await store.readRoutesFrom('YMQ', '2027-04', { env: ENV, dynamo })).length, 1);
});

test('lambda: scheduled fare-map event runs the job (disabled → no-op), HTTP events are untouched', async () => {
  assert.equal(job.isFareMapEvent({ globevoyJob: 'fare-map' }), true);
  assert.equal(job.isFareMapEvent({ rawPath: '/api/city-registry' }), false);
  const { handler } = require('../../backend/lambda');
  const r = await handler({ globevoyJob: 'fare-map' });
  assert.equal(r.reason, 'disabled');
});

test('standard scheduled event from the globevoy-fare-map rule is recognised; other rules are not', () => {
  const ev = (rule) => ({ source: 'aws.events', 'detail-type': 'Scheduled Event', resources: [`arn:aws:events:us-east-2:216241083409:rule/${rule}`], detail: {} });
  assert.equal(job.isFareMapEvent(ev('globevoy-fare-map-every-5-min')), true);
  assert.equal(job.isFareMapEvent(ev('some-other-rule')), false);
});
