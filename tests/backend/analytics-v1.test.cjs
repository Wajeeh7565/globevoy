'use strict';
// GV-ANALYTICS-V1: Users + Searches tables (offline, mocked DynamoDB and Secrets Manager).
const test = require('node:test');
const assert = require('node:assert/strict');
const a = require('../../backend/services/analytics/analytics-v1');
const I = a._internal;

const ON = { GV_ANALYTICS: 'on', GV_ALGORITHM_VERSION: 'gv-test', FARE_MAP_EXPERIENCE: 'on' };
const SID = '7f3c2a10-4b5e-4c1d-9e8f-123456789abc';
const GID = 'aa11bb22-cc33-dd44-ee55-ff6677889900-g';
const QUERY = { origin: 'Toronto (YYZ)', budget: '4000', currency: 'CAD', adults: '2', sid: SID, gid: GID, departureDate: '2027-01-10' };
const TOUR = { tourRole: 'best-balance', estimatedTotalUsd: 2500, totalBudgetUsd: 2940, totalNights: 9, totalFlightEstimateUsd: 900, totalHotelEstimateUsd: 1600, pricingStatus: 'live-verified',
  stops: [{ cityId: 'barcelona-es', nights: 5, hotel: { name: 'Hotel Uno', estimatedStayUsd: 900, reviewScore: 8.6 } }, { cityId: 'lisbon-pt', nights: 4, hotel: { name: 'Casa Dos', estimatedStayUsd: 700 } }],
  legs: [{ estimatedTransportUsd: 400, stops: 0 }, { estimatedTransportUsd: 150, stops: 0 }, { estimatedTransportUsd: 350, stops: 1 }] };
const BODY = { ok: true, tours: [TOUR, { ...TOUR, tourRole: 'lowest-cost', estimatedTotalUsd: 1500 }], diagnostics: { fareMapLiveAttempts: ['ok', 'fare-map-flights-not-all-live', 'stopped-x'] } };

function fakeDb() {
  const calls = [], items = {};
  return { calls, items, x: { sdk: new Proxy({}, { get: (_, name) => function (input) { this.name = name; this.input = input; } }),
    c: { send: async cmd => { calls.push(cmd); if (cmd.name === 'GetItemCommand') return { Item: items[cmd.input.Key.userId.S] }; if (cmd.name === 'PutItemCommand') items[cmd.input.Item.userId.S] = cmd.input.Item; if (cmd.input.ReturnValues === 'ALL_NEW') return { Attributes: { userId: { S: 'u_abc' } } }; return {}; } } } };
}

test('off by default; on only with GV_ANALYTICS=on', () => {
  assert.equal(a.config({}), null);
  assert.equal(a.config({ GV_ANALYTICS: 'true' }), null);
  assert.equal(a.config(ON).searches, 'globevoy-analytics-searches');
  assert.equal(a.config(ON).retentionDays, 396);
});

test('budget is stored as a CAD range, never the amount', () => {
  assert.equal(I.budgetBand(1499, 'CAD'), 'under_1500');
  assert.equal(I.budgetBand(4000, 'CAD'), '4000_5000');
  assert.equal(I.budgetBand(8000, 'USD'), '10000_15000');
  assert.equal(I.budgetBand('x'), 'unknown');
});

test('search row: one order-independent update with recommendations, no exact budget or raw ids', () => {
  const u = I.searchUpdate(a.config(ON), { query: QUERY, body: BODY, latencyMs: 17000, now: Date.parse('2026-11-27T20:00:00Z'), settings: I.settingsSnapshot(ON) });
  assert.match(u.searchId, /^s_[a-f0-9]{24}$/);
  const v = Object.fromEntries(Object.entries(u.input.ExpressionAttributeValues).map(([k, x]) => [k, I.fromAttr(x)]));
  assert.equal(v[':band'], '4000_5000');
  assert.equal(v[':origin'], 'YYZ');
  assert.match(v[':guest'], /^g_[a-f0-9]{20}$/);
  assert.deepEqual(v[':trav'], { adults: 2, children: 0, rooms: 1 });
  assert.equal(v[':recs'].length, 2);
  const r = v[':recs'][0];
  assert.equal(r.recId, u.searchId + '-best-balance');
  assert.deepEqual([r.position, r.nights, r.budgetUsedPct, r.cities.join()], [1, 9, 85, 'barcelona-es,lisbon-pt']);
  assert.deepEqual([r.stops[0].hotel, r.stops[0].flightUsd, r.returnFlightUsd], ['Hotel Uno', 400, 350]);
  assert.equal(v[':fail'], 1);
  assert.deepEqual(v[':settings'], { experience: 'on' });
  const text = JSON.stringify(u.input);
  assert.ok(!text.includes(SID) && !text.includes(GID) && !text.includes('"4000"'), 'no raw sid, gid or budget');
  assert.match(u.input.UpdateExpression, /userId = if_not_exists\(userId, :guest\)/);
  assert.equal(I.searchUpdate(a.config(ON), { query: { ...QUERY, sid: 'bad' }, body: BODY }), null);
});

test('feedback: validated, appended to the search row; partner clicks also go to bookingClicks', () => {
  assert.equal(I.parseFeedback('{"sid":"short","action":"view"}'), null);
  assert.equal(I.parseFeedback(JSON.stringify({ sid: SID, action: 'hack' })), null);
  const fb = I.parseFeedback(JSON.stringify({ sid: SID, action: 'partner_click', role: 'best-balance', rank: 1, provider: 'aviasales.com', kind: 'flight', value: 412.5, currency: 'CAD', clickId: '0123abcd4567ef89', email: 'x@y.z' }));
  assert.deepEqual([fb.ev.provider, fb.ev.kind, fb.ev.value, fb.ev.clickId], ['aviasales.com', 'flight', 412.5, '0123abcd4567ef89']);
  assert.ok(!JSON.stringify(fb).includes('x@y.z'));
  const up = I.feedbackUpdate(a.config(ON), fb);
  assert.match(up.UpdateExpression, /bookingClicks = list_append/);
  const sh = I.feedbackUpdate(a.config(ON), I.parseFeedback(JSON.stringify({ sid: SID, action: 'show_other', role: 'lowest-cost' })));
  assert.match(sh.UpdateExpression, /ADD refreshes :one/);
});

test('users: login counted once per new token; ranges and sets merge', () => {
  const now = Date.parse('2026-11-27T20:00:00Z');
  let u = I.mergeUser({}, { userId: 'u_1', guestId: 'g_1', tokenIat: 100, origin: 'YYZ', band: '4000_5000', currency: 'CAD', adults: 2, hasSearch: true }, now);
  assert.deepEqual([u.loginCount, u.searchCount, u.minBudgetBand, u.maxBudgetBand], [1, 1, '4000_5000', '4000_5000']);
  u = I.mergeUser(u, { userId: 'u_1', guestId: 'g_unknown', tokenIat: 100, origin: 'YUL', band: '1500_2000', currency: 'CAD', adults: 1, hasSearch: true }, now + 1000);
  assert.deepEqual([u.loginCount, u.searchCount, u.minBudgetBand, u.maxBudgetBand, u.maxTravellers], [1, 2, '1500_2000', '4000_5000', 2]);
  assert.deepEqual([...u.uniqueOrigins].sort(), ['YUL', 'YYZ']);
  assert.deepEqual([...u.activeMonths], ['2026-11']);
  u = I.mergeUser(u, { userId: 'u_1', tokenIat: 200, hasSearch: false }, now + 2000);
  assert.equal(u.loginCount, 2);
  assert.equal(I.userIdFor('sub-123', 'k'.repeat(40)), I.userIdFor('sub-123', 'k'.repeat(40)));
  assert.notEqual(I.userIdFor('sub-123', 'k'.repeat(40)), I.userIdFor('sub-123', 'j'.repeat(40)));
});

test('identify: verified token -> hashed Users row + search row marked registered; bad token -> no write', async () => {
  const db = fakeDb(); I.resetForTests(); I.setClientForTests(db.x); I.setKeyForTests('s'.repeat(40));
  const ev = { requestContext: { http: { method: 'POST' } }, body: JSON.stringify({ sid: SID, gid: GID, origin: 'Toronto (YYZ)', budget: 3000, currency: 'CAD', adults: 1 }) };
  const r = await a.handleRoute('/api/analytics/identify', ev, { env: ON, verify: async () => ({ sub: 'cognito-sub-1', expiresAt: 1800000000 }) });
  assert.equal(r.statusCode, 204);
  assert.equal(r.headers['X-GV-Analytics'], 'recorded');
  const put = db.calls.find(c => c.name === 'PutItemCommand');
  assert.ok(!JSON.stringify(put.input).includes('cognito-sub-1'), 'raw sub never stored');
  assert.match(put.input.Item.userId.S, /^u_[a-f0-9]{32}$/);
  const mark = db.calls.find(c => c.name === 'UpdateItemCommand');
  assert.equal(mark.input.ExpressionAttributeValues[':t'].BOOL, true);
  const n = db.calls.length;
  const bad = await a.handleRoute('/api/analytics/identify', ev, { env: ON, verify: async () => { throw Error('invalid'); } });
  assert.equal(bad.headers['X-GV-Analytics'], 'failed');
  assert.equal(db.calls.length, n);
  I.resetForTests();
});

test('wrap: never changes the response; records only generated-tour 200s when on', async () => {
  const db = fakeDb(); I.resetForTests(); I.setClientForTests(db.x);
  const res = { statusCode: 200, headers: {}, body: JSON.stringify(BODY) };
  const h = a.wrap(async () => res, { env: ON });
  const out = await h({ rawPath: '/api/generated-tour', queryStringParameters: QUERY }, {});
  assert.equal(out, res);
  assert.equal(db.calls.length, 1);
  await h({ rawPath: '/api/recommendations', queryStringParameters: QUERY }, {});
  assert.equal(db.calls.length, 1);
  const off = a.wrap(async () => res, { env: {} });
  await off({ rawPath: '/api/generated-tour', queryStringParameters: QUERY }, {});
  assert.equal(db.calls.length, 1);
  db.x.c.send = async () => { throw Error('ddb down'); };
  assert.equal(await h({ rawPath: '/api/generated-tour', queryStringParameters: QUERY }, {}), res);
  I.resetForTests();
});

test('routes answer 204 and are off without the setting', async () => {
  const r = await a.handleRoute('/api/trip-feedback', { requestContext: { http: { method: 'POST' } }, body: '{}' }, { env: {} });
  assert.deepEqual([r.statusCode, r.headers['X-GV-Analytics']], [204, 'off']);
});

test('v1.1: candidate pool logged compactly; impressions carry the live check; version from the package', () => {
  const body = { ...BODY, pool: [{ ...TOUR, poolRank: 1, poolScore: 0.8 }, { ...TOUR, poolRank: 2, stops: [{ cityId: 'rome-it', nights: 9 }], estimatedTotalUsd: 2700 }] };
  const u = I.searchUpdate(a.config(ON), { query: QUERY, body });
  const c = I.fromAttr(u.input.ExpressionAttributeValues[':cands']);
  assert.equal(c.length, 2);
  assert.deepEqual([c[0].inTours, c[1].inTours, c[1].cities.join(), c[0].score], [true, false, 'rome-it', 0.8]);
  assert.match(u.input.UpdateExpression, /candidates = if_not_exists\(candidates, :cands\)/);
  const imp = I.parseFeedback(JSON.stringify({ sid: SID, action: 'impression', role: 'best-balance', rank: 1, live: 'live', value: 3120, currency: 'CAD' }));
  assert.deepEqual([imp.ev.live, imp.ev.value, imp.ev.currency], ['live', 3120, 'CAD']);
  assert.equal(I.algorithmVersion({ GV_ALGORITHM_VERSION: 'x1' }), 'x1');
  assert.match(I.algorithmVersion({}), /^(main-[0-9a-f]{7}|unknown|\$LATEST)$/);
});
