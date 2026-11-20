'use strict';
// GV-IGNAV-CACHE-001 — remember Ignav one-way results for 15 minutes.
//
// The site asks for three trips in parallel (separate Lambda instances), retries
// similar trips, and re-runs the search when a traveller goes back. Without a shared
// memory every one of those paid for the same flight again. Results are kept in this
// instance's memory and, when FARE_MAP_TABLE is set, in the fare-map table
// (pk "LIVE#ignav", sk = route|date|party|currency) so other instances reuse them.
//
// - Only successful results are stored; failures are always asked again.
// - 15 minutes: Ignav itself reuses a search for up to 30 minutes (Gus, Nov 19 2026).
// - Each reuse still passes the 3-hour observed_at rule, and booking proofs are signed
//   again so the booking page works for the full 15 minutes.
// - Any storage error falls back to calling Ignav: the cache can never block a search.

const store = require('../fare-map/fare-map-store');
const ignav = require('../../providers/flights/ignav/ignav');

const TTL_MS = 15 * 60 * 1000;
const MAX_ITINERARIES = 12;
const MAX_OBSERVATION_AGE_MS = 3 * 60 * 60 * 1000;
const memory = new Map();

function keyFor(input = {}) {
  const up = v => String(v || '').trim().toUpperCase();
  return [up(input.origin), up(input.destination), String(input.departureDate || '').slice(0, 10),
    Number(input.adults ?? 1), Number(input.children ?? 0), up(input.currency || 'CAD')].join('|');
}

function usable(entry, now) {
  if (!entry || !entry.result || !Number.isFinite(entry.savedAt) || now - entry.savedAt > TTL_MS || entry.savedAt - now > 60000) return false;
  const observed = Date.parse(entry.result.observedAt);
  return Number.isFinite(observed) && now - observed <= MAX_OBSERVATION_AGE_MS;
}

function resign(result, env) {
  const sign = fare => (fare && fare.ignavId ? { ...fare, bookingProof: ignav._internal.bookingProof(fare.ignavId, env) } : fare);
  return { ...result, cheapest: sign(result.cheapest), itineraries: (result.itineraries || []).map(sign), fromCache: true };
}

function trim(result) {
  const strip = fare => { if (!fare) return fare; const { bookingProof, ...rest } = fare; return rest; };
  return { ...result, cheapest: strip(result.cheapest), itineraries: (result.itineraries || []).slice(0, MAX_ITINERARIES).map(strip) };
}

async function readShared(key, options) {
  const env = options.env || process.env;
  if (!store.tableName(env) || options.sharedCache === false) return null;
  try {
    const res = await (options.dynamo || store._internal.client(options)).send(store._internal.cmd('GetItemCommand', {
      TableName: store.tableName(env), Key: { pk: { S: 'LIVE#ignav' }, sk: { S: key } } }));
    const item = res && res.Item;
    if (!item || !item.result || !item.savedAt) return null;
    return { savedAt: Number(item.savedAt.N), result: JSON.parse(item.result.S) };
  } catch (_) { return null; }
}

async function writeShared(key, entry, options) {
  const env = options.env || process.env;
  if (!store.tableName(env) || options.sharedCache === false) return;
  try {
    await (options.dynamo || store._internal.client(options)).send(store._internal.cmd('PutItemCommand', {
      TableName: store.tableName(env),
      Item: { pk: { S: 'LIVE#ignav' }, sk: { S: key }, savedAt: { N: String(entry.savedAt) },
        result: { S: JSON.stringify(entry.result).slice(0, 300000) }, ttl: { N: String(Math.floor((entry.savedAt + 2 * TTL_MS) / 1000)) } } }));
  } catch (_) { /* best effort */ }
}

/**
 * Same contract as ignav.searchOneWay, plus `fromCache` on reused results.
 * options.counter (optional) gets { calls, cacheHits } incremented.
 */
async function searchOneWayCached(input = {}, options = {}) {
  const env = options.env || process.env;
  const now = (options.clock || Date.now)();
  const counter = options.counter || {};
  const key = keyFor(input);
  let entry = memory.get(key);
  if (!usable(entry, now)) {
    memory.delete(key);
    entry = await readShared(key, options);
    if (usable(entry, now)) memory.set(key, entry); else entry = null;
  }
  if (entry) { counter.cacheHits = (counter.cacheHits || 0) + 1; return resign(entry.result, env); }
  counter.calls = (counter.calls || 0) + 1;
  const result = await ignav.searchOneWay(input, options);
  if (result && result.ok) {
    const saved = { savedAt: now, result: trim(result) };
    memory.set(key, saved);
    if (memory.size > 500) memory.delete(memory.keys().next().value);
    await writeShared(key, saved, options);
  }
  return result;
}

module.exports = { VERSION: 'GV-IGNAV-CACHE-001', TTL_MS, searchOneWayCached, _internal: { keyFor, usable, memory } };
