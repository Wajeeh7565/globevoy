'use strict';
// GV-PRICE-INDEX-001: Price Index client, US$2 monthly cap, summaries, optional storage,
// collector. Offline: mocked HTTP and DynamoDB, Barcelona-shaped test inputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const client = require('../../backend/services/providers/stays/nuitee/nuitee-price-index');
const budget = require('../../backend/services/domain/pricing/hotel-price-index/budget');
const summary = require('../../backend/services/domain/pricing/hotel-price-index/summary');
const store = require('../../backend/services/domain/pricing/hotel-price-index/store');
const collector = require('../../backend/services/domain/pricing/hotel-price-index/collector');
const F = require('./fixtures/price-index-fixture.cjs');

const fx = F.build();
const asAnswer = body => ({ ok: true, kind: 'hotels', data: body.data.map(h => ({ hotelId: h.hotelId, prices: h.prices.map(p => ({ day: p.day, usd: p.avgPriceUsd })) })) });
const http = (status, body, seen) => async (url, init) => { if (seen) seen.push({ url, init }); return { status, text: async () => JSON.stringify(body) }; };
const ENV = { FARE_MAP_TABLE: 'globevoy-fare-map-test' };

// A fake DynamoDB that honours the conditional ADD the way DynamoDB does.
function fakeDynamo() {
  const items = new Map(), calls = [];
  return { items, calls, async send(cmd) {
    const name = cmd.constructor.name, i = cmd.input; calls.push(name);
    const k = i.Key ? i.Key.pk.S + '|' + i.Key.sk.S : i.Item.pk.S + '|' + i.Item.sk.S;
    if (name === 'UpdateItemCommand') {
      const cur = Number(items.get(k)?.calls?.N || 0), cap = Number(i.ExpressionAttributeValues[':cap'].N);
      if (items.has(k) && !(cur < cap)) { const e = new Error('cond'); e.name = 'ConditionalCheckFailedException'; throw e; }
      items.set(k, { calls: { N: String(cur + 1) } }); return { Attributes: { calls: { N: String(cur + 1) } } };
    }
    if (name === 'PutItemCommand') { items.set(k, i.Item); return {}; }
    if (name === 'GetItemCommand') return { Item: items.get(k) };
    throw new Error('unexpected ' + name);
  } };
}

test('client: sandbox key works, production key refused unless allowed, <=50 hotels, one request, no retry', async () => {
  const seen = [];
  const r = await client.hotels({ hotelIds: ['lpa1', 'lpa2'], from: '2027-01-01', to: '2027-01-31' }, { apiKey: 'sand_x', fetchFn: http(200, { data: [{ hotelId: 'lpa1', prices: [{ day: '2027-01-02', avgPriceUsd: 107 }] }] }, seen) });
  assert.ok(seen[0].url.startsWith('https://api.liteapi.travel/v3.0/prices/hotels?hotelIds=lpa1%2Clpa2&fromDate=2027-01-01&toDate=2027-01-31'));
  assert.equal(seen[0].init.headers['X-API-Key'], 'sand_x');
  assert.equal(r.data[0].prices[0].usd, 107);
  assert.equal((await client.hotels({ hotelIds: ['lpa1'] }, { apiKey: 'prod_x', fetchFn: http(200, {}, seen) })).reason, 'production-not-allowed');
  assert.equal(seen.length, 1, 'refused before any request');
  assert.equal((await client.hotels({ hotelIds: Array.from({ length: 51 }, (_, i) => 'h' + i) }, { apiKey: 'sand_x' })).reason, 'invalid-hotel-ids');
  const busy = await client.city({ countryCode: 'es', cityName: 'Barcelona' }, { apiKey: 'sand_x', fetchFn: http(429, {}, seen) });
  assert.equal(busy.reason, 'nuitee-http-429'); assert.equal(busy.retryable, true); assert.equal(seen.length, 2, 'no retry inside the client');
});

test('budget: 100 requests (US$2) a month is the hard cap; env can only lower it', () => {
  assert.equal(budget.HARD_CAP, 100);
  assert.equal(budget.HARD_CAP * budget.PRICE_PER_REQUEST_USD, 2);
  assert.equal(budget.capFrom({}), 100);
  assert.equal(budget.capFrom({ PRICE_INDEX_MONTHLY_REQUEST_CAP: '3' }), 3);
  assert.equal(budget.capFrom({ PRICE_INDEX_MONTHLY_REQUEST_CAP: '5000' }), 100, 'cannot raise above US$2');
  assert.equal(budget.capFrom({ PRICE_INDEX_MONTHLY_REQUEST_CAP: '0' }), 0);
});

test('budget: shared DynamoDB counter stops at the cap even with two collectors at once; fails closed', async () => {
  const db = fakeDynamo(), clock = () => Date.parse('2027-01-15T00:00:00Z');
  const a = budget.dynamoBudget({ env: { ...ENV, PRICE_INDEX_MONTHLY_REQUEST_CAP: '5' }, dynamo: db, clock });
  const b = budget.dynamoBudget({ env: { ...ENV, PRICE_INDEX_MONTHLY_REQUEST_CAP: '5' }, dynamo: db, clock });
  const res = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).reserve()));
  assert.equal(res.filter(r => r.ok).length, 5);
  assert.ok(res.filter(r => !r.ok).every(r => r.reason === 'monthly-cap-reached'));
  assert.ok(db.items.has('PI#budget|2027-01'));
  const next = budget.dynamoBudget({ env: { ...ENV, PRICE_INDEX_MONTHLY_REQUEST_CAP: '5' }, dynamo: db, clock: () => Date.parse('2027-02-01T00:00:00Z') });
  assert.equal((await next.reserve()).ok, true, 'a new month starts a new count');
  const broken = budget.dynamoBudget({ env: ENV, dynamo: { send: async () => { throw new Error('down'); } } });
  assert.equal((await broken.reserve()).reason, 'budget-store-unavailable');
  assert.equal((await budget.dynamoBudget({ env: {} }).reserve()).reason, 'budget-table-not-configured');
});

test('summary: the Barcelona-shaped data becomes a small city summary with the season shape', () => {
  const n = fx.hotels.data.reduce((s, h) => s + h.prices.length, 0);
  assert.equal(n, F.TARGET_PRICES);
  const s = summary.fromHotels('barcelona-es', asAnswer(fx.hotels));
  assert.equal(s.days, F.DAYS);
  assert.ok(s.coverage > 0.99, 'every day has at least 5 hotels');
  assert.ok(s.p25.every((v, i) => v == null || v <= s.p50[i]));
  assert.ok(Buffer.byteLength(JSON.stringify(s)) < 4096, 'fits in one 4 KB read');
  assert.ok(summary.seasonality(s, '2026-12-30', 3) > 1.25, 'New Year is expensive');
  assert.ok(summary.seasonality(s, '2027-01-19', 3) < 0.95, 'mid-January is cheap');
  assert.equal(summary.seasonality(s, '2028-01-01', 3), null, 'outside the data: no guess');
  assert.equal(JSON.stringify(s).includes('lpbcn'), false, 'no hotel IDs in the summary');
});

test('storage is off by default; when on, summaries expire after the configured retention', async () => {
  const db = fakeDynamo(), now = Date.parse('2027-01-01T00:00:00Z'), s = summary.fromHotels('barcelona-es', asAnswer(fx.hotels));
  assert.deepEqual(await store.write(s, { env: ENV, dynamo: db, clock: () => now }), { stored: false, reason: 'storage-off' });
  assert.equal(db.calls.length, 0);
  const r = await store.write(s, { env: { ...ENV, PRICE_INDEX_STORAGE: 'on', PRICE_INDEX_RETENTION_DAYS: '10' }, dynamo: db, clock: () => now });
  assert.equal(r.stored, true); assert.equal(r.retentionDays, 10);
  const item = db.items.get('PI#city#barcelona-es|summary');
  assert.equal(Number(item.ttl.N), now / 1000 + 10 * 86400);
  assert.equal(store.retentionDays({}), 35);
  assert.equal(store.retentionDays({ PRICE_INDEX_RETENTION_DAYS: '9999' }), 365);
  assert.ok(await store.read('barcelona-es', { env: ENV, dynamo: db, clock: () => now + 86400e3 }));
  assert.equal(await store.read('barcelona-es', { env: ENV, dynamo: db, clock: () => now + 11 * 86400e3 }), null, 'expired summaries are not used');
});

test('collector: off by default, so no request is ever sent', async () => {
  let sent = 0;
  const r = await collector.run({ cities: [{ cityId: 'barcelona-es', countryCode: 'ES', cityName: 'Barcelona' }] }, { env: ENV, fetchFn: async () => { sent++; return { status: 200, text: async () => '{}' }; }, apiKey: 'sand_x' });
  assert.equal(r.reason, 'collection-off'); assert.equal(sent, 0);
});

test('collector: fixture mode runs with the sandbox-shaped data, no AWS, nothing stored', async () => {
  const r = await collector.run({ cities: [{ cityId: 'barcelona-es', hotelIds: fx.hotels.data.map(h => h.hotelId) }, { cityId: 'barcelona-city', countryCode: 'ES', cityName: 'Barcelona' }] }, {
    env: {}, fixture: async kind => (kind === 'hotels' ? asAnswer(fx.hotels) : { ok: true, kind: 'city', prices: fx.city.prices.map(p => ({ day: p.day, usd: p.avgPriceUsd })) })
  });
  assert.equal(r.mode, 'fixture'); assert.equal(r.requests, 2); assert.equal(r.estimatedCostUsd, 0.04);
  assert.deepEqual(r.cities.map(c => [c.status, c.source, c.stored]), [['ok', 'hotels', false], ['ok', 'city', false]]);
});

test('collector: one retry on 429, and the retry is paid for out of the budget; stops at the cap', async () => {
  let n = 0;
  const flaky = async () => (++n === 1 ? { ok: false, reason: 'nuitee-http-429', retryable: true } : asAnswer(fx.hotels));
  const cities = Array.from({ length: 6 }, (_, i) => ({ cityId: 'c' + i, hotelIds: ['h1'] }));
  const r = await collector.run({ cities }, { env: { PRICE_INDEX_MONTHLY_REQUEST_CAP: '4' }, fixture: flaky });
  assert.equal(r.requests, 4, 'never more requests than the cap');
  assert.equal(r.cities[0].attempts, 2, 'first city needed a retry');
  assert.equal(r.stopped, 'monthly-cap-reached');
  assert.deepEqual(r.cities.map(c => c.status), ['ok', 'ok', 'ok', 'skipped', 'skipped', 'skipped']);
  const hard = await collector.run({ cities }, { env: {}, fixture: async () => ({ ok: false, reason: 'nuitee-http-400', retryable: false }) });
  assert.equal(hard.requests, 6, 'a 400 is not retried');
});

test('collector: live mode with collection on uses the shared counter (fails closed without it)', async () => {
  let sent = 0;
  const r = await collector.run({ cities: [{ cityId: 'barcelona-es', countryCode: 'ES', cityName: 'Barcelona' }] }, { env: { PRICE_INDEX_COLLECTION: 'on' }, apiKey: 'sand_x', fetchFn: async () => { sent++; return { status: 200, text: async () => '{}' }; } });
  assert.equal(sent, 0); assert.equal(r.stopped, 'budget-table-not-configured');
});

test('nothing in the Lambda or the trip search uses the collector yet', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('git', ['grep', '-l', '-e', 'hotel-price-index', '-e', 'nuitee-price-index', '--', 'backend'], { encoding: 'utf8' });
  const users = r.stdout.trim().split('\n').filter(Boolean).filter(f => !f.includes('/hotel-price-index/') && !f.endsWith('nuitee-price-index.js'));
  assert.deepEqual(users, []);
});
