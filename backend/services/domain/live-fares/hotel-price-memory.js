'use strict';
// GV-HOTEL-MEMORY-001 — learn how real hotel prices compare with the planning model.
//
// The trip search picks trips with modelled hotel prices; real Nuitee prices are often
// 30-60% higher, so trips that fit on paper fail the live check. Every live hotel check
// now records, per city, how the real stay price compared with the model
// (ratio = live / modelled). The search then plans each city with its own learned ratio
// instead of the general margin.
//
// Storage: one item in the fare-map table (pk "MEM#hotel", sk "ratios"), one attribute
// per city: r_<cityId> = ratio (rolling average of the last ~5 checks), n_<cityId> =
// checks seen, t_<cityId> = last update (ms). Read once per search, cached 60 s.
// Any storage error is ignored: without learned ratios the search uses the margin.

const store = require('../fare-map/fare-map-store');

const PK = 'MEM#hotel', SK = 'ratios', CACHE_MS = 60 * 1000, READ_TIMEOUT_MS = 400;
const MIN_RATIO = 0.6, MAX_RATIO = 3, WINDOW = 5, MAX_AGE_MS = 60 * 24 * 3600 * 1000;
let cached = null;

const attr = cityId => String(cityId || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 120);
const clamp = r => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r));

function client(options) { return options.dynamo || store._internal.client(options); }

// Map of attr(cityId) -> { ratio, n, at }.
async function load(options = {}) {
  const env = options.env || process.env, now = (options.clock || Date.now)();
  if (!store.tableName(env) || options.hotelMemory === false) return new Map();
  if (cached && now - cached.at < CACHE_MS && !options.fresh) return cached.map;
  try {
    const read = client(options).send(store._internal.cmd('GetItemCommand', { TableName: store.tableName(env), Key: { pk: { S: PK }, sk: { S: SK } } }));
    const res = await Promise.race([read, new Promise(resolve => setTimeout(() => resolve(null), READ_TIMEOUT_MS))]);
    const map = new Map();
    for (const [k, v] of Object.entries(res?.Item || {})) {
      if (!k.startsWith('r_')) continue;
      const id = k.slice(2), ratio = Number(v.N), n = Number(res.Item['n_' + id]?.N) || 1, at = Number(res.Item['t_' + id]?.N) || 0;
      if (Number.isFinite(ratio) && now - at <= MAX_AGE_MS) map.set(id, { ratio: clamp(ratio), n, at });
    }
    cached = { at: now, map };
    return map;
  } catch (_) { return cached?.map || new Map(); }
}

// Learned ratio for a city, or null.
function ratioFor(map, cityId) {
  const hit = map && map.get(attr(cityId));
  return hit ? hit.ratio : null;
}

// observations: [{ cityId, estimateUsd, liveUsd }] from one live hotel check.
// Saved with PutItem (the whole item), the same call the Lambda already makes for
// live flight prices, so no new permission is needed. Two searches saving at the same
// moment can lose one observation; that is fine for a rolling average.
async function record(observations = [], options = {}) {
  const env = options.env || process.env, now = (options.clock || Date.now)();
  if (!store.tableName(env) || options.hotelMemory === false) return 0;
  const map = new Map(await load({ ...options, fresh: true }));
  let count = 0;
  for (const o of observations) {
    const est = Number(o?.estimateUsd), live = Number(o?.liveUsd), id = attr(o?.cityId);
    if (!id || !(est > 0) || !(live > 0)) continue;
    const obs = clamp(live / est), old = map.get(id), n = Math.min(WINDOW, old?.n || 0);
    map.set(id, { ratio: Number((old ? (old.ratio * n + obs) / (n + 1) : obs).toFixed(3)), n: (old?.n || 0) + 1, at: now });
    count++;
  }
  if (!count) return 0;
  const item = { pk: { S: PK }, sk: { S: SK }, savedAt: { N: String(now) } };
  for (const [id, v] of map) { item['r_' + id] = { N: String(v.ratio) }; item['n_' + id] = { N: String(v.n) }; item['t_' + id] = { N: String(v.at) }; }
  try {
    await client(options).send(store._internal.cmd('PutItemCommand', { TableName: store.tableName(env), Item: item }));
    cached = { at: now, map };
  } catch (_) { /* best effort */ }
  return count;
}

module.exports = { load, record, ratioFor, _internal: { attr, clamp, reset: () => { cached = null; } } };
