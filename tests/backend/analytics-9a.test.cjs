'use strict';
// GV-ANALYTICS-9A: detailed search activity + recommendation feedback (offline, mocked DynamoDB).
const test = require('node:test');
const assert = require('node:assert/strict');
const activity = require('../../backend/services/analytics/search-activity');
const feedback = require('../../backend/services/analytics/trip-feedback');
const { summarize } = require('../../ops/analytics/daily-report-lib.cjs');

const V1 = { schemaVersion: 1, enabled: true, privacyApproved: true, table: 'globevoy-production-activity-events', retentionDays: 30 };
const V2 = { ...V1, schemaVersion: 2, detail: true, detailApproved: true };
const SID = '7f3c2a10-4b5e-4c1d-9e8f-123456789abc';
const RESPONSE = { statusCode: 200, body: JSON.stringify({ ok: true, poolMode: true, poolSize: 12, diagnostics: { poolChecks: 5, fareMapLiveAttempts: ['ok', 'fare-map-flights-not-all-live', 'ok', 'ok', 'stopped-live-check-time-limit'] },
  tours: [{ tourRole: 'best-balance', estimatedTotalUsd: 2500, totalBudgetUsd: 2940, cities: [{ cityId: 'barcelona-es' }, { cityId: 'lisbon-pt' }] }, { tourRole: 'lowest-cost', estimatedTotalUsd: 1800, totalBudgetUsd: 2940, cities: [{ cityId: 'halifax-ca' }] }] }) };
const QUERY = { origin: 'Toronto (YYZ)', budget: '4000', currency: 'CAD', adults: '1', sid: SID, departureDate: '2027-01-10' };

test('config: detail needs schemaVersion 2 and its own approval; v1 configs keep working', () => {
  assert.equal(activity.configuration(V1).schemaVersion, 1);
  assert.equal(activity.configuration(V2).detail, true);
  assert.throws(() => activity.configuration({ ...V1, detail: true }), /schemaVersion 2/);
  assert.throws(() => activity.configuration({ ...V2, detailApproved: false }), /detailApproved/);
  assert.equal(activity.configuration({ ...V2, enabled: false }), null);
});

test('search event detail: coarse fields only, no exact budget, dates or raw token', () => {
  const e = activity.sanitize({ category: 'generated_tour', response: RESPONSE, durationMs: 15000, requestId: 'r1', query: QUERY, now: Date.parse('2026-11-29T15:00:00Z') }, V2);
  assert.equal(e.schemaVersion, 2);
  assert.deepEqual([e.budgetBand, e.originCode, e.travellersBand], ['4000_6999', 'YYZ', '1']);
  assert.deepEqual([e.tripsShown, e.cityCountShown, e.citiesShown, e.roles, e.bestUseBand], [2, 3, 'barcelona-es,lisbon-pt,halifax-ca', 'best-balance,lowest-cost', '85_100']);
  assert.deepEqual([e.poolSize, e.liveChecks, e.failedChecks], [12, 5, 1]);
  assert.match(e.searchRef, /^[a-f0-9]{24}$/);
  const text = JSON.stringify(e);
  for (const leak of ['"4000"', ':4000', '2027-01-10', SID, 'Toronto']) assert.ok(!text.includes(leak), 'must not store ' + leak);
  assert.ok(!('budget' in e) && !('origin' in e) && !('sid' in e));
  const v1 = activity.sanitize({ category: 'generated_tour', response: RESPONSE, durationMs: 15000, requestId: 'r1', query: QUERY }, V1);
  assert.equal(v1.budgetBand, undefined, 'v1: no detail');
  const other = activity.sanitize({ category: 'recommendations', response: RESPONSE, durationMs: 100, requestId: 'r2', query: QUERY }, V2);
  assert.equal(other.budgetBand, undefined, 'detail only for trip searches');
});

test('search event detail: one transaction adds daily budget and origin counters', async () => {
  const e = activity.sanitize({ category: 'generated_tour', response: RESPONSE, durationMs: 15000, requestId: 'r1', query: QUERY }, V2);
  let input; await activity.persist(e, V2, { send: async i => { input = i; } });
  const keys = input.TransactItems.map(t => (t.Put || t.Update).Key?.SK?.S || t.Put.Item.SK.S);
  assert.ok(keys.includes('BUDGET#4000_6999') && keys.includes('ORIGIN#YYZ'));
  assert.equal(input.TransactItems.length, 5);
});

test('feedback endpoint: always 204; off without approval; records valid events only', async () => {
  const ev = body => ({ requestContext: { http: { method: 'POST' } }, body: JSON.stringify(body) });
  const good = { sid: SID, action: 'book_click', role: 'best-balance', rank: 1, cities: ['barcelona-es', 'Lisbon-PT', 'bad city!'] };
  let writes = [];
  const persist = async e => writes.push(e);
  assert.equal((await feedback.handle(ev(good), { config: V1, persist })).headers['X-GV-Feedback'], 'off');
  assert.equal((await feedback.handle(ev(good), { config: null, persist })).headers['X-GV-Feedback'], 'off');
  assert.equal((await feedback.handle(ev({ ...good, action: 'buy_now' }), { config: V2, persist })).headers['X-GV-Feedback'], 'invalid');
  assert.equal((await feedback.handle(ev({ ...good, sid: 'short' }), { config: V2, persist })).headers['X-GV-Feedback'], 'invalid');
  assert.equal((await feedback.handle({ requestContext: { http: { method: 'GET' } } }, { config: V2, persist })).headers['X-GV-Feedback'], 'ignored');
  assert.equal(writes.length, 0);
  const r = await feedback.handle(ev(good), { config: V2, persist, clock: () => Date.parse('2026-11-29T15:00:00Z') });
  assert.equal(r.statusCode, 204); assert.equal(r.headers['X-GV-Feedback'], 'recorded');
  assert.deepEqual([writes[0].action, writes[0].role, writes[0].rank, writes[0].cities], ['book_click', 'best-balance', 1, 'barcelona-es,lisbon-pt']);
  assert.equal(writes[0].searchRef, activity._internal.ref(SID), 'same reference as the search event');
  assert.equal(writes[0].expiresAt, Date.parse('2026-11-29T00:00:00Z') / 1000 + 30 * 86400);
  assert.ok(!JSON.stringify(writes[0]).includes(SID));
  const broken = await feedback.handle(ev(good), { config: V2, persist: async () => { throw new Error('down'); }, log: () => {} });
  assert.equal(broken.statusCode, 204); assert.equal(broken.headers['X-GV-Feedback'], 'failed');
  assert.equal(feedback.parse('x'.repeat(3000)), null, 'size limit');
});

test('feedback persist: event row plus per-action and per-role counters in one transaction', async () => {
  const e = feedback._internal.event(feedback.parse(JSON.stringify({ sid: SID, action: 'show_other', role: 'lowest-cost', rank: 2 })), Date.parse('2026-11-29T15:00:00Z'), V2);
  let input; await feedback.persist(e, V2, { send: async i => { input = i; } });
  assert.match(input.TransactItems[0].Put.Item.SK.S, /^FEEDBACK#/);
  assert.deepEqual(input.TransactItems.slice(1).map(t => t.Update.Key.SK.S), ['COUNT#feedback#show_other', 'FEEDBACK#show_other#lowest-cost']);
});

test('lambda routes POST /api/trip-feedback to the feedback handler, outside search activity', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../../backend/lambda.js'), 'utf8');
  assert.match(src, /path === '\/api\/trip-feedback'[\s\S]{0,200}trip-feedback'\)\.handle\(event/);
  assert.equal(Object.keys(activity.routes).includes('/api/trip-feedback'), false);
});

test('daily report: searches, budgets, origins, failures, feedback and click-through by search', () => {
  const ttl = { N: String(Date.parse('2026-12-29T00:00:00Z') / 1000) };
  const ref = activity._internal.ref(SID), ref2 = activity._internal.ref(SID.replace('a', 'b'));
  const it = (SK, f) => ({ PK: { S: 'DAY#2026-11-29' }, SK: { S: SK }, expiresAt: ttl, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'number' ? { N: String(v) } : { S: v }])) });
  const items = [
    it('EVENT#a', { category: 'generated_tour', outcome: 'results', tripsShown: 3, liveChecks: 5, failedChecks: 1, citiesShown: 'barcelona-es,lisbon-pt', searchRef: ref }),
    it('EVENT#b', { category: 'generated_tour', outcome: 'results', tripsShown: 1, liveChecks: 4, failedChecks: 2, citiesShown: 'halifax-ca', searchRef: ref2 }),
    it('BUDGET#4000_6999', { count: 2 }), it('ORIGIN#YYZ', { count: 2 }),
    it('FEEDBACK#1', { kind: 'feedback', action: 'view', role: 'best-balance', searchRef: ref }),
    it('FEEDBACK#2', { kind: 'feedback', action: 'show_other', role: 'lowest-cost', searchRef: ref2 })
  ];
  const s = summarize(items, Date.parse('2026-11-29T20:00:00Z') / 1000);
  assert.equal(s.searches.total, 2); assert.deepEqual(s.budgets, { '4000_6999': 2 }); assert.deepEqual(s.topOrigins, { YYZ: 2 });
  assert.equal(s.shown.tripsPerSearch, 2); assert.equal(s.shown.failRatePct, 33);
  assert.deepEqual(s.feedback.byAction, { view: 1, show_other: 1 });
  assert.equal(s.feedback.searchesWithClick, 1); assert.equal(s.feedback.searchesWithShowOther, 1);
});

test('frontend: page reference sent with searches; feedback beacons are plain-text and fire-and-forget', () => {
  const fs = require('fs'), p = require('path');
  const api = fs.readFileSync(p.join(__dirname, '../../frontend/runtime/api-client.js'), 'utf8');
  const ts = fs.readFileSync(p.join(__dirname, '../../frontend/scripts/trip-search.js'), 'utf8');
  const res = fs.readFileSync(p.join(__dirname, '../../frontend/scripts/results.js'), 'utf8');
  assert.match(api, /sendBeacon\(url, new Blob\(\[body\], \{ type: 'text\/plain;charset=UTF-8' \}\)\)/);
  assert.match(ts, /sid: PAGE_SID/); assert.doesNotMatch(ts, /localStorage\.setItem\([^)]*PAGE_SID/);
  for (const a of ['view', 'book_click', 'save', 'show_other']) assert.match(res, new RegExp(`feedback\\('${a}'`));
});
