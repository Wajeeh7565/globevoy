'use strict';
// Offline: one complete fare-map pass for the EC2 collector (GV-FAREMAP-FULLPASS-001).
// Travelpayouts and DynamoDB are mocked; sleeps are recorded, not waited.
const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('../../backend/services/domain/fare-map/fare-map-store');
const { runFullPass, META_KEY, _internal } = require('../../backend/services/domain/fare-map/fare-map-full-pass');

const ENV = { FARE_MAP_TABLE: 'globevoy-fare-map' };
const NOW = Date.parse('2026-11-20T12:00:00Z');
function fakeDynamo() {
  const items = new Map();
  return { items, send: async c => {
    const name = c.constructor.name, i = c.input;
    if (name === 'BatchWriteItemCommand') { for (const reqs of Object.values(i.RequestItems)) reqs.forEach(r => items.set(r.PutRequest.Item.pk.S + '|' + r.PutRequest.Item.sk.S, r.PutRequest.Item)); return {}; }
    if (name === 'PutItemCommand') { items.set(i.Item.pk.S + '|' + i.Item.sk.S, i.Item); return {}; }
    if (name === 'GetItemCommand') return { Item: items.get(i.Key.pk.S + '|' + i.Key.sk.S) };
    if (name === 'QueryCommand') { const pk = i.ExpressionAttributeValues[':pk'].S; return { Items: [...items.entries()].filter(([k]) => k.startsWith(pk + '|')).map(([, v]) => v) }; }
    return {};
  } };
}
// A full page (30 rows) for page 0 of every task, a short page after: two requests per task.
function tpFetch({ rateLimitOnce = false, failOrigin = null } = {}) {
  let limited = false;
  const f = async (url, init) => {
    f.calls++;
    const q = JSON.parse(init.body).query, origin = q.match(/origin: "([A-Z]{3})"/)[1], offset = Number(q.match(/offset: (\d+)/)[1]);
    if (rateLimitOnce && !limited && f.calls === 3) { limited = true; return { ok: false, status: 429, headers: { get: () => '90' }, text: async () => '<html>' }; }
    if (origin === failOrigin) return { ok: false, status: 400, text: async () => '{}' };
    const rows = offset === 0 ? Array.from({ length: 30 }, (_, k) => ({ destination_city_iata: 'D' + String.fromCharCode(65 + (k % 26)) + String.fromCharCode(65 + Math.floor(k / 26)), value: 10000 + k })) : [{ destination_city_iata: 'LAS', value: 9000 }];
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { prices_one_way: rows } }) };
  };
  f.calls = 0; return f;
}
const base = (over = {}) => ({ env: ENV, token: 'tp_test', clock: () => NOW, sleep: async ms => { (over.slept || []).push(ms); }, pace: async () => {}, log: () => {}, origins: ['YTO', 'NYC', 'LON'], priorityOrigins: ['YTO'], ...over });

test('task order: priority origins first for every month, then month by month', () => {
  const t = _internal.buildTasks(['NYC', 'YTO', 'LON'], ['2026-11', '2026-12'], ['YTO', 'YUL']).map(x => x.origin + '#' + x.month);
  assert.deepEqual(t, ['YTO#2026-11', 'YTO#2026-12', 'NYC#2026-11', 'LON#2026-11', 'NYC#2026-12', 'LON#2026-12']);
});

test('one run collects every origin x month to the last page and records completion', async () => {
  const dynamo = fakeDynamo(), fetch = tpFetch();
  const r = await runFullPass(base({ dynamo, fetch }));
  assert.equal(r.ok, true); assert.equal(r.finished, true);
  assert.equal(r.done, r.tasksTotal); assert.equal(r.tasksTotal, 3 * 8);
  assert.equal(fetch.calls, r.tasksTotal * 2, 'two pages per task: reads past the first page');
  const rows = await store.readRoutesFrom('LON', '2027-06', { env: ENV, dynamo, nowMs: NOW });
  assert.equal(rows.length, 31, 'all destinations from both pages');
  const meta = await store.readMeta(META_KEY, { env: ENV, dynamo });
  assert.ok(meta.completedAt); assert.equal(meta.done, 24);
  assert.equal(dynamo.items.has('META#job|cursor'), false, 'the Lambda job cursor is untouched');
});

test('a stopped pass resumes where it left off; --fresh starts over', async () => {
  const dynamo = fakeDynamo(), fetch = tpFetch();
  const first = await runFullPass(base({ dynamo, fetch, maxTasks: 5 }));
  assert.equal(first.finished, false); assert.equal(first.index, 5);
  const rest = await runFullPass(base({ dynamo, fetch }));
  assert.equal(rest.finished, true); assert.equal(rest.done, 24, 'counts carried over');
  assert.equal(fetch.calls, 24 * 2, 'no task collected twice');
  const again = await runFullPass(base({ dynamo, fetch, fresh: true, maxTasks: 1 }));
  assert.equal(again.done, 1);
});

test('rate limit: waits as told and carries on; a rejected code is skipped, not retried forever', async () => {
  const slept = [], dynamo = fakeDynamo();
  const r = await runFullPass(base({ dynamo, fetch: tpFetch({ rateLimitOnce: true, failOrigin: 'NYC' }), slept }));
  assert.equal(r.finished, true); assert.equal(r.cooldowns, 1);
  assert.ok(slept.includes(90000), 'honours Retry-After');
  assert.equal(r.skipped, 8, 'NYC rejected for each of 8 months');
  assert.ok(r.skippedTasks[0].startsWith('NYC#'));
});

test('stops on a bad token; dry run writes nothing; missing settings refuse to start', async () => {
  const dynamo = fakeDynamo();
  const authFail = async () => ({ ok: false, status: 401, text: async () => '{}' });
  const s = await runFullPass(base({ dynamo, fetch: authFail }));
  assert.equal(s.ok, false); assert.equal(s.reason, 'provider-auth-error'); assert.equal(s.index, 0);
  const dry = fakeDynamo();
  const d = await runFullPass(base({ dynamo: dry, fetch: tpFetch(), dryRun: true, maxTasks: 2 }));
  assert.equal(d.done, 2); assert.equal(dry.items.size, 0);
  assert.equal((await runFullPass(base({ env: {}, dynamo }))).reason, 'fare-map-table-missing');
  assert.equal((await runFullPass(base({ token: '', dynamo }))).reason, 'travelpayouts-token-missing');
});
