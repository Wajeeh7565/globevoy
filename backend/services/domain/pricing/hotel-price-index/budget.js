'use strict';
// GV-PRICE-INDEX-001: hard monthly budget for Nuitee Price Index requests.
//
// US$2/month at US$0.02 = 100 billable requests per calendar month (UTC), counting
// tests and retries. Every request must reserve a slot BEFORE it is sent.
//
// Shared counter: one item in the fare-map table, pk "PI#budget", sk "<YYYY-MM>",
// attribute `calls`. A reservation is one conditional UpdateItem
// (ADD calls 1 IF calls < cap), so two Lambdas or the EC2 box running at once can
// never go over the cap together. When the cap is reached every caller is refused
// until next month (automatic stop). If the counter cannot be read or written the
// request is refused (fail closed): no counter, no paid call.
//
// PRICE_INDEX_MONTHLY_REQUEST_CAP can LOWER the cap (e.g. 3 for the first probe);
// it can never raise it above 100. Raising it needs a code change and approval.

const store = require('../../fare-map/fare-map-store');
const HARD_CAP = 100;           // = US$2.00 at US$0.02
const PRICE_PER_REQUEST_USD = 0.02;
const PK = 'PI#budget';

const month = ms => new Date(ms).toISOString().slice(0, 7);
function capFrom(env = process.env) {
  const v = Number(String(env.PRICE_INDEX_MONTHLY_REQUEST_CAP ?? '').trim());
  return Number.isFinite(v) && v >= 0 && String(env.PRICE_INDEX_MONTHLY_REQUEST_CAP ?? '').trim() !== '' ? Math.min(HARD_CAP, Math.floor(v)) : HARD_CAP;
}

/** Shared DynamoDB counter. reserve() -> { ok, used, cap, month } | { ok:false, reason } */
function dynamoBudget(options = {}) {
  const env = options.env || process.env, cap = capFrom(env), clock = options.clock || Date.now;
  const db = () => options.dynamo || store._internal.client(options);
  return {
    cap, kind: 'dynamodb',
    async reserve(purpose = 'request') {
      const table = store.tableName(env), m = month(clock());
      if (!table) return { ok: false, reason: 'budget-table-not-configured', cap };
      if (cap <= 0) return { ok: false, reason: 'monthly-cap-reached', used: 0, cap, month: m };
      try {
        const r = await db().send(store._internal.cmd('UpdateItemCommand', {
          TableName: table, Key: { pk: { S: PK }, sk: { S: m } },
          UpdateExpression: 'ADD calls :one SET updatedAt = :now, lastPurpose = :p',
          ConditionExpression: 'attribute_not_exists(calls) OR calls < :cap',
          ExpressionAttributeValues: { ':one': { N: '1' }, ':cap': { N: String(cap) }, ':now': { S: new Date(clock()).toISOString() }, ':p': { S: String(purpose).slice(0, 60) } },
          ReturnValues: 'UPDATED_NEW'
        }));
        return { ok: true, used: Number(r?.Attributes?.calls?.N || 0), cap, month: m };
      } catch (e) {
        if (e?.name === 'ConditionalCheckFailedException') return { ok: false, reason: 'monthly-cap-reached', used: cap, cap, month: m };
        return { ok: false, reason: 'budget-store-unavailable', cap, month: m };
      }
    },
    async used() {
      const table = store.tableName(env), m = month(clock());
      if (!table) return null;
      try {
        const r = await db().send(store._internal.cmd('GetItemCommand', { TableName: table, Key: { pk: { S: PK }, sk: { S: m } }, ConsistentRead: true }));
        return Number(r?.Item?.calls?.N || 0);
      } catch (_) { return null; }
    }
  };
}

/** In-memory budget for fixture runs and tests (never touches AWS). */
function memoryBudget(cap = HARD_CAP) {
  let used = 0; const c = Math.min(HARD_CAP, Math.max(0, Math.floor(cap)));
  return { cap: c, kind: 'memory', async reserve() { if (used >= c) return { ok: false, reason: 'monthly-cap-reached', used, cap: c }; used++; return { ok: true, used, cap: c }; }, async used() { return used; } };
}

module.exports = { HARD_CAP, PRICE_PER_REQUEST_USD, PK, capFrom, dynamoBudget, memoryBudget, _internal: { month } };
