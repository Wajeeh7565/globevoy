'use strict';

const { createHash, randomUUID } = require('node:crypto');
const store = require('../fare-map/fare-map-store');
const ignav = require('../../providers/flights/ignav/ignav');
const { record } = require('../../providers/flights/ignav/ignav-usage');

const TTL_MS = 15 * 60 * 1000;
const MAX_OBSERVATION_AGE_MS = 3 * 60 * 60 * 1000;
const MAX_ITINERARIES = 12;
const LEASE_MS = 45000;
const FOLLOW_MS = 1250;
const IO_MS = 800;
const memory = new Map(), pending = new Map();
let sharedClient;

function keyFor(input = {}, env = process.env) {
  const { body } = ignav._internal.oneWayRequest(input);
  if (!body) return null;
  const currency = String(input.currency || 'CAD').trim().toUpperCase();
  return JSON.stringify([ignav._internal.credentialScope(env), body, currency]);
}

function usable(entry, now) {
  if (!entry?.result?.ok || !Number.isFinite(entry.savedAt) || now - entry.savedAt > TTL_MS || entry.savedAt - now > 60000) return false;
  const observed = Date.parse(entry.result.observedAt);
  return Number.isFinite(observed) && observed <= now + 60000 && now - observed <= MAX_OBSERVATION_AGE_MS;
}

function resign(result, env) {
  const sign = fare => fare?.ignavId && fare.usableFare ? { ...fare, bookingProof: ignav._internal.bookingProof(fare.ignavId, env) } : fare;
  return { ...result, cheapest: sign(result.cheapest), itineraries: (result.itineraries || []).map(sign), fromCache: true };
}

function trim(result) {
  const strip = fare => { if (!fare) return fare; const { bookingProof, ...rest } = fare; return rest; };
  return { ...result, cheapest: strip(result.cheapest), itineraries: (result.itineraries || []).slice(0, MAX_ITINERARIES).map(strip) };
}

function remember(key, entry) {
  memory.set(key, entry);
  if (memory.size > 500) memory.delete(memory.keys().next().value);
}

async function send(options, command, time = IO_MS) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => (options.cacheDynamo || options.dynamo || (sharedClient ||= store._internal.client())).send(command, { abortSignal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('ignav-cache-deadline')); }, time); })
    ]);
  } finally { clearTimeout(timer); }
}

function cacheKey(key) { return { pk: { S: 'LIVE#ignav' }, sk: { S: key } }; }

async function readShared(key, table, options, consistent = false, maxWait = IO_MS) {
  if (!table) return null;
  try {
    const { Item } = await send(options, store._internal.cmd('GetItemCommand', { TableName: table, Key: cacheKey(key), ConsistentRead: consistent }), maxWait);
    if (!Item?.result || !Item.savedAt) return null;
    return { savedAt: Number(Item.savedAt.N), result: JSON.parse(Item.result.S) };
  } catch (_) { return null; }
}

async function writeShared(key, table, entry, options) {
  if (!table) return;
  const serialized = JSON.stringify(entry.result);
  if (Buffer.byteLength(serialized) > 300000) return;
  try {
    await send(options, store._internal.cmd('PutItemCommand', { TableName: table, Item: { ...cacheKey(key),
      savedAt: { N: String(entry.savedAt) }, result: { S: serialized },
      ttl: { N: String(Math.floor((entry.savedAt + 2 * TTL_MS) / 1000)) } } }));
  } catch (_) { /* cache write is best effort */ }
}

function leaseKey(key) {
  return { pk: { S: 'IGNAVLEASE#' + createHash('sha256').update(key).digest('hex') }, sk: { S: 'lease' } };
}

async function tryLease(key, table, owner, now, options, wait) {
  await send(options, store._internal.cmd('PutItemCommand', { TableName: table,
    Item: { ...leaseKey(key), owner: { S: owner }, until: { N: String(now + LEASE_MS) },
      ttl: { N: String(Math.ceil((now + LEASE_MS) / 1000)) } },
    ConditionExpression: 'attribute_not_exists(pk) OR #until <= :now',
    ExpressionAttributeNames: { '#until': 'until' }, ExpressionAttributeValues: { ':now': { N: String(now) } }
  }), wait);
}

async function releaseLease(key, table, owner, options) {
  try {
    await send(options, store._internal.cmd('DeleteItemCommand', { TableName: table, Key: leaseKey(key),
      ConditionExpression: '#owner = :owner', ExpressionAttributeNames: { '#owner': 'owner' },
      ExpressionAttributeValues: { ':owner': { S: owner } }
    }));
  } catch (_) { /* expired or handed off */ }
}

function cacheHit(key, entry, options, event) {
  remember(key, entry);
  if (options.counter) options.counter.cacheHits = (options.counter.cacheHits || 0) + 1;
  record(options, event, { endpoint: 'fare' });
  return resign(entry.result, options.env || process.env);
}

async function loadFare(key, input, options, table, now) {
  const env = options.env || process.env;
  const leased = env.IGNAV_SHARED_LEASE === 'on';
  if (leased && !table) return { ok: false, reason: 'ignav-cache-lease-unconfigured' };
  const shared = await readShared(key, table, options, leased);
  if (usable(shared, now())) return cacheHit(key, shared, options, 'shared-hit');
  const upstream = async (leaseUntil = Infinity) => {
    const result = await ignav.searchOneWay(input, { ...options, skipFareJoin: true });
    if (result?.ok) {
      const entry = { savedAt: now(), result: trim(result) };
      remember(key, entry);
      if (now() < leaseUntil) await writeShared(key, table, entry, options);
    }
    return result;
  };
  if (!leased) return upstream();

  const owner = randomUUID(), end = Date.now() + FOLLOW_MS;
  while (Date.now() < end) {
    const acquiredAt = now();
    try {
      await tryLease(key, table, owner, acquiredAt, options, Math.min(IO_MS, end - Date.now()));
    } catch (error) {
      if (error?.name !== 'ConditionalCheckFailedException') return { ok: false, reason: 'ignav-cache-lease-unavailable' };
      const wait = end - Date.now();
      if (wait <= 0) break;
      const current = await readShared(key, table, options, true, Math.min(IO_MS, wait));
      if (usable(current, now())) return cacheHit(key, current, options, 'shared-hit');
      if (Date.now() < end) await new Promise(resolve => setTimeout(resolve, Math.min(75, end - Date.now())));
      continue;
    }
    try {
      const current = await readShared(key, table, options, true);
      if (usable(current, now())) return cacheHit(key, current, options, 'shared-hit');
      return await upstream(acquiredAt + LEASE_MS);
    } finally { await releaseLease(key, table, owner, options); }
  }
  return { ok: false, reason: 'ignav-cache-lease-wait-expired' };
}

async function searchOneWayCached(input = {}, options = {}) {
  const env = options.env || process.env;
  const key = keyFor(input, env);
  if (!key || !ignav.configured(env)) return ignav.searchOneWay(input, options);
  const now = options.clock || Date.now;
  const entry = memory.get(key);
  if (usable(entry, now())) return cacheHit(key, entry, options, 'local-hit');
  memory.delete(key);
  const table = options.sharedCache === false ? '' : store.tableName(env);
  if (env.IGNAV_FARE_COALESCE === 'off') return loadFare(key, input, options, table, now);
  if (pending.has(key)) {
    record(options, 'joined', { endpoint: 'fare' });
    const matching = await pending.get(key);
    return matching?.ok ? { ...matching, fromCoalesced: true } : matching;
  }
  const promise = loadFare(key, input, options, table, now);
  pending.set(key, promise);
  try { return await promise; }
  finally { pending.delete(key); }
}

module.exports = { VERSION: 'GV-IGNAV-CACHE-001', TTL_MS, searchOneWayCached, _internal: { keyFor, usable, memory, leaseKey } };
