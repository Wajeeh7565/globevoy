'use strict';
// GV-PRICE-INDEX-001: optional storage of city summaries. OFF by default.
//
// PRICE_INDEX_STORAGE=on     -> write summaries (anything else: nothing is written)
// PRICE_INDEX_RETENTION_DAYS -> how long a summary lives (default 35, 1-365). DynamoDB
//                               deletes it through the table's existing `ttl` attribute.
// Item: pk "PI#city#<cityId>", sk "summary". Only aggregated city numbers are stored
// (no hotel IDs, no per-hotel prices). Nuitee has not confirmed storage terms, which is
// why this stays off until approved.

const fareStore = require('../../fare-map/fare-map-store');
const DEFAULT_RETENTION_DAYS = 35;

const storageOn = env => String(env.PRICE_INDEX_STORAGE || '').trim().toLowerCase() === 'on';
function retentionDays(env = process.env) {
  const v = Number(String(env.PRICE_INDEX_RETENTION_DAYS ?? '').trim());
  return Number.isFinite(v) && v >= 1 ? Math.min(365, Math.floor(v)) : DEFAULT_RETENTION_DAYS;
}
const key = cityId => ({ pk: { S: 'PI#city#' + String(cityId).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 120) }, sk: { S: 'summary' } });

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

module.exports = { write, read, storageOn, retentionDays, DEFAULT_RETENTION_DAYS, _internal: { key } };
