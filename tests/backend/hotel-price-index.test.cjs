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

const NOLIMIT = () => require('../../backend/services/providers/stays/nuitee/nuitee-price-index').createLimiter({ sleep: async () => {} });
const D = n => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);

test('client: sandbox key works, <=50 hotels, one request per call, no retry inside the client', async () => {
  const seen = [];
  const r = await client.hotels({ hotelIds: ['lpa1', 'lpa2'], from: D(10), to: D(40) }, { apiKey: 'sand_x', limiter: NOLIMIT(), fetchFn: http(200, { data: [{ hotelId: 'lpa1', prices: [{ day: D(11), avgPriceUsd: 107 }] }] }, seen) });
  assert.ok(seen[0].url.startsWith(`https://api.liteapi.travel/v3.0/prices/hotels?hotelIds=lpa1%2Clpa2&fromDate=${D(10)}&toDate=${D(40)}`));
  assert.equal(seen[0].init.headers['X-API-Key'], 'sand_x');
  assert.equal(r.data[0].prices[0].usd, 107);
  assert.equal((await client.hotels({ hotelIds: Array.from({ length: 51 }, (_, i) => 'h' + i) }, { apiKey: 'sand_x' })).reason, 'invalid-hotel-ids');
  const busy = await client.city({ countryCode: 'es', cityName: 'Barcelona' }, { apiKey: 'sand_x', limiter: NOLIMIT(), fetchFn: http(429, {}, seen) });
  assert.equal(busy.reason, 'nuitee-http-429'); assert.equal(busy.retryable, true); assert.equal(seen.length, 2, 'no retry inside the client');
});

test('client: EVERY production request needs the budget first (manual tests included)', async () => {
  const seen = [];
  const opts = { apiKey: 'prod_x', limiter: NOLIMIT(), fetchFn: http(200, { prices: [] }, seen) };
  assert.equal((await client.city({ countryCode: 'ES', cityName: 'Barcelona' }, opts)).reason, 'production-not-allowed');
  assert.equal((await client.city({ countryCode: 'ES', cityName: 'Barcelona' }, { ...opts, allowProduction: true })).reason, 'budget-required');
  assert.equal(seen.length, 0, 'nothing sent without a budget');
  const b = budget.memoryBudget(2);
  for (let i = 0; i < 3; i++) await client.city({ countryCode: 'ES', cityName: 'Barcelona' }, { ...opts, allowProduction: true, budget: b });
  assert.equal(seen.length, 2, 'third request refused by the budget');
  assert.equal(await b.used(), 2);
  assert.equal((await client.hotelList({ countryCode: 'ES', cityName: 'Barcelona' }, { ...opts, allowProduction: true })).reason, 'production-not-allowed', 'hotel lists use the free sandbox key only');
});

test('client: rate limit is 10 requests per 60 s; the 11th waits instead of being dropped', async () => {
  let now = 0; const waits = [];
  const lim = client.createLimiter({ clock: () => now, sleep: async ms => { waits.push(ms); now += ms; } });
  for (let i = 0; i < 10; i++) { await lim.wait(); now += 100; }
  assert.equal(waits.length, 0);
  await lim.wait();
  assert.equal(waits.length, 1);
  assert.ok(now >= 60000, 'the 11th request waits until the first one is 60 s old');
  assert.deepEqual(client.RATE, { max: 10, windowMs: 60000 });
});

test('client: rolling six-month horizon; past and far-future dates are clamped or refused', async () => {
  const now = Date.parse('2026-11-25T12:00:00Z');
  assert.deepEqual(client.horizon(null, null, now), { fromDate: '2026-11-25', toDate: '2027-05-26' });
  assert.deepEqual(client.horizon('2026-01-01', '2028-01-01', now), { fromDate: '2026-11-25', toDate: '2027-05-26' });
  assert.equal(client.horizon('2027-06-01', '2027-07-01', now), null);
  assert.equal(client.HORIZON_DAYS, 183);
  const seen = [];
  const r = await client.city({ countryCode: 'ES', cityName: 'Barcelona', from: '2027-08-01', to: '2027-09-01' }, { apiKey: 'sand_x', clock: () => now, fetchFn: http(200, {}, seen) });
  assert.equal(r.reason, 'outside-six-month-horizon'); assert.equal(seen.length, 0);
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
  assert.ok(Buffer.byteLength(JSON.stringify(s)) < 6 * 1024, 'small: at most two 4 KB reads');
  assert.ok(s.stay[3] && s.stayCoverage[7] < s.stayCoverage[3], 'complete stays recorded; longer stays have fewer hotels with every night');
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
    env: {}, fixture: async kind => (kind === 'hotels' ? fx.hotels : fx.city)
  });
  assert.equal(r.mode, 'fixture'); assert.equal(r.requests, 2); assert.equal(r.estimatedCostUsd, 0.04);
  assert.deepEqual(r.cities.map(c => [c.status, c.source, c.stored]), [['ok', 'hotels', false], ['ok', 'city', false]]);
});

test('collector: one retry after a backoff (Retry-After or 6 s); the retry pays for its own slot; stops at the cap', async () => {
  let n = 0; const waits = [];
  const flaky = async () => (++n === 1 ? { status: 429, retryAfter: '9' } : fx.hotels);
  const cities = Array.from({ length: 6 }, (_, i) => ({ cityId: 'c' + i, hotelIds: ['h1'] }));
  const r = await collector.run({ cities }, { env: { PRICE_INDEX_MONTHLY_REQUEST_CAP: '4' }, fixture: flaky, sleep: async ms => waits.push(ms) });
  assert.deepEqual(waits, [9000], 'waited as Nuitee asked');
  assert.equal(r.requests, 4, 'never more requests than the cap');
  assert.equal(r.cities[0].attempts, 2);
  assert.equal(r.stopped, 'monthly-cap-reached');
  assert.deepEqual(r.cities.map(c => c.status), ['ok', 'ok', 'ok', 'skipped', 'skipped', 'skipped']);
  const w2 = [];
  await collector.run({ cities: cities.slice(0, 1) }, { env: {}, fixture: async () => ({ status: 503 }), sleep: async ms => w2.push(ms) });
  assert.deepEqual(w2, [6000], 'default backoff without Retry-After');
  const hard = await collector.run({ cities }, { env: {}, fixture: async () => ({ status: 400 }), sleep: async () => { throw new Error('no backoff for 400'); } });
  assert.equal(hard.requests, 6, 'a 400 is not retried');
});

test('collector: live mode with collection on uses the shared counter (fails closed without it)', async () => {
  let sent = 0;
  const r = await collector.run({ cities: [{ cityId: 'barcelona-es', countryCode: 'ES', cityName: 'Barcelona' }] }, { env: { PRICE_INDEX_COLLECTION: 'on' }, apiKey: 'sand_x', fetchFn: async () => { sent++; return { status: 200, text: async () => '{}' }; } });
  assert.equal(sent, 0, 'fails closed: no counter, no request'); assert.equal(r.stopped, 'budget-table-not-configured');
});

test('nothing in the Lambda or the trip search uses the collector yet', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('git', ['grep', '-l', '-e', 'hotel-price-index', '-e', 'nuitee-price-index', '--', 'backend'], { encoding: 'utf8' });
  const users = r.stdout.trim().split('\n').filter(Boolean).filter(f => !f.includes('/hotel-price-index/') && !f.endsWith('nuitee-price-index.js'));
  assert.deepEqual(users, []);
});

test('representative sample: 50 hotels across affordable, mid, upper-mid and high bands', () => {
  const { sampleHotels } = require('../../backend/services/domain/pricing/hotel-price-index/hotel-sample');
  const cand = Array.from({ length: 300 }, (_, i) => ({ id: 'h' + i, stars: 1 + (i % 5), rating: 6 + (i % 4), reviews: i }));
  const s = sampleHotels(cand);
  assert.equal(s.hotelIds.length, 50);
  assert.deepEqual(s.mix, { affordable: 8, mid: 18, 'upper-mid': 17, high: 7 });
  const few = sampleHotels([...cand.filter(h => h.stars === 3).slice(0, 60), ...cand.filter(h => h.stars === 5).slice(0, 2)]);
  assert.equal(few.hotelIds.length, 50, 'a thin band lends its places to the others');
  assert.equal(fx.hotels.data.length, 50); assert.ok(Object.values(fx.mix).every(v => v > 0), 'the test inputs use the same sampler');
});

test('design study loads a real file when given one, and reports no accuracy from it', () => {
  const { execFileSync } = require('node:child_process');
  const fs = require('fs'), os = require('os'), path = require('path');
  const file = path.join(os.tmpdir(), 'pi-real-' + process.pid + '.json');
  fs.writeFileSync(file, JSON.stringify({ data: fx.hotels.data.slice(0, 12) }));
  const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '../performance/price-index-design-study.cjs'), '--json', '--fixture', file], { encoding: 'utf8' }));
  fs.unlinkSync(file);
  assert.equal(out.dataset.hotels, 12, 'used the file, not the generator');
  assert.equal(out.syntheticPlanningAccuracy, null);
  assert.match(out.livePricingAccuracy, /NOT MEASURED/);
  assert.ok(out.completeStays['3'].stays > 0);
});

test('production probe: 3 requests (US$0.06) max with retries, dry run by default, refuses without the shared counter', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('path'), fs = require('fs');
  const script = path.join(__dirname, '../../ops/providers/nuitee-price-index-probe.mjs');
  const src = fs.readFileSync(script, 'utf8');
  assert.match(src, /const MAX_REQUESTS = 3/);
  assert.match(src, /PRICE_INDEX_MONTHLY_REQUEST_CAP: String\(MAX_REQUESTS\)/, 'shared counter capped at 3 too');
  assert.doesNotMatch(src, /store\.write|PRICE_INDEX_STORAGE/, 'never stores prices');
  const dry = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(dry.status, 0); assert.match(dry.stdout, /DRY RUN \(nothing sent\)/); assert.match(dry.stdout, /US\$0\.06/);
  const noTable = spawnSync(process.execPath, [script, '--run'], { encoding: 'utf8', env: { PATH: process.env.PATH, NUITEE_SANDBOX_KEY: 'sand_x', NUITEE_PROD_KEY: 'prod_x' } });
  assert.equal(noTable.status, 2); assert.match(noTable.stderr, /FARE_MAP_TABLE/);
});

test('price-basis comparison: finds which live price (taxes, occupancy) the index matches', () => {
  const A = require('../../backend/services/domain/pricing/hotel-price-index/analysis');
  // index = live 1-adult price before taxes
  const rows = [100, 120, 90, 150, 200].map((p, i) => ({ hotelId: 'h' + i, checkin: '2027-01-0' + (i + 1), nights: 1, index: p, live: { 1: { total: p * 1.1, includedTaxes: p * 0.1 }, 2: { total: p * 1.35, includedTaxes: p * 0.12 } } }));
  const r = A.compareBasis(rows);
  assert.equal(r.closest, '1 adult, before taxes');
  assert.equal(r.bases['1 adult, before taxes'].medianRatio, 1);
  assert.equal(A.compareBasis([]).closest, null);
});

test('price-basis check script: dry run by default, one Price Index request, refuses when the counter is full', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('path'), fs = require('fs');
  const script = path.join(__dirname, '../../ops/providers/nuitee-price-basis-check.mjs');
  const src = fs.readFileSync(script, 'utf8');
  assert.match(src, /memoryBudget\(1\)/, 'one Price Index request');
  assert.match(src, /used >= SHARED_CAP/, 'refuses when the 3 approved slots are used');
  assert.doesNotMatch(src, /store\.write|PRICE_INDEX_STORAGE/);
  const dry = spawnSync(process.execPath, [script], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(dry.status, 0); assert.match(dry.stdout, /DRY RUN/);
});
