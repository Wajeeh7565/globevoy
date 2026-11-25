'use strict';
// GV-PRICE-INDEX-001: optional storage of city summaries. OFF by default.
//
// PRICE_INDEX_STORAGE=on     -> write summaries (anything else: nothing is written)
// PRICE_INDEX_RETENTION_DAYS -> how long a summary lives (default 35, 1-365). DynamoDB
//                               deletes it through the table's existing `ttl` attribute.
// Items: pk "PI#city", sk "<cityId>" (one partition, so a search loads every city's
// summary with ONE Query; 90 cities x ~4 KB fits in one page). Only aggregated city
// numbers are stored (no hotel IDs, no per-hotel prices). Nuitee has not confirmed
// storage terms, which is why this stays off until approved.
//
// PRICE_INDEX_PLANNING=on lets the trip search load the summaries (loadAll); off by
// default, and useless until summaries are stored.

const fareStore = require('../../fare-map/fare-map-store');
const DEFAULT_RETENTION_DAYS = 35;

const storageOn = env => String(env.PRICE_INDEX_STORAGE || '').trim().toLowerCase() === 'on';
function retentionDays(env = process.env) {
  const v = Number(String(env.PRICE_INDEX_RETENTION_DAYS ?? '').trim());
  return Number.isFinite(v) && v >= 1 ? Math.min(365, Math.floor(v)) : DEFAULT_RETENTION_DAYS;
}
const PK = 'PI#city';
const cityKey = cityId => String(cityId).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 120);
const key = cityId => ({ pk: { S: PK }, sk: { S: cityKey(cityId) } });
const planningOn = env => String(env.PRICE_INDEX_PLANNING || '').trim().toLowerCase() === 'on';
const LOAD_CACHE_MS = 10 * 60 * 1000, LOAD_TIMEOUT_MS = 1000;
let loaded = null, loading = null;

async function write(summary, options = {}) {
  const env = options.env || process.env, now = (options.clock || Date.now)();
  if (!storageOn(env)) return { stored: false, reason: 'storage-off' };
  const table = fareStore.tableName(env);
  if (!table) return { stored: false, reason: 'table-not-configured' };
  const days = retentionDays(env);
  const item = { ...key(summary.cityId), summary: { S: JSON.stringify(summary) }, collectedAt: { S: new Date(now).toISOString() }, ttl: { N: String(Math.floor(now / 1000) + days * 86400) } };
  const bytes = Buffer.byteLength(JSON.stringify(item));
  if (bytes > 350 * 1024) return { stored: false, reason: 'item-too-large', bytes };
  try {
    await (options.dynamo || fareStore._internal.client(options)).send(fareStore._internal.cmd('PutItemCommand', { TableName: table, Item: item }));
    return { stored: true, bytes, retentionDays: days };
  } catch (_) { return { stored: false, reason: 'store-unavailable' }; }
}

async function read(cityId, options = {}) {
  const env = options.env || process.env, now = (options.clock || Date.now)();
  const table = fareStore.tableName(env);
  if (!table) return null;
  try {
    const r = await (options.dynamo || fareStore._internal.client(options)).send(fareStore._internal.cmd('GetItemCommand', { TableName: table, Key: key(cityId) }));
    if (!r?.Item?.summary?.S) return null;
    if (Number(r.Item.ttl?.N || 0) * 1000 < now) return null; // expired but not yet deleted by TTL
    return JSON.parse(r.Item.summary.S);
  } catch (_) { return null; }
}

/** All unexpired city summaries as Map(cityId -> summary). Cached 10 min; waits at most 1 s. */
async function loadAll(options = {}) {
  const env = options.env || process.env, now = (options.clock || Date.now)();
  const table = fareStore.tableName(env);
  if (!planningOn(env) || !table) return new Map();
  if (loaded && now - loaded.at < LOAD_CACHE_MS && !options.fresh) return loaded.map;
  const db = options.dynamo || fareStore._internal.client(options);
  if (!loading) loading = (async () => {
    const map = new Map(); let startKey;
    do {
      const r = await db.send(fareStore._internal.cmd('QueryCommand', { TableName: table, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': { S: PK } }, ...(startKey ? { ExclusiveStartKey: startKey } : {}) }));
      for (const it of r?.Items || []) {
        if (Number(it.ttl?.N || 0) * 1000 < now) continue;
        try { const s = JSON.parse(it.summary.S); if (s?.cityId) map.set(s.cityId, s); } catch (_) {}
      }
      startKey = r?.LastEvaluatedKey;
    } while (startKey && map.size < 2000);
    loaded = { at: now, map }; return map;
  })().catch(() => null).finally(() => { loading = null; });
  const map = await Promise.race([loading, new Promise(res => setTimeout(() => res(null), LOAD_TIMEOUT_MS))]);
  return map || loaded?.map || new Map();
}

module.exports = { write, read, loadAll, storageOn, planningOn, retentionDays, DEFAULT_RETENTION_DAYS, _internal: { key, reset: () => { loaded = null; loading = null; } } };
