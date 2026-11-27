'use strict';
// GV-DATA-DATES-001 — more departure dates per route (offline-tested, not scheduled).
//
// The fare map keeps ONE cheapest date per origin, destination and month, so return
// flights rarely fit a stay and the search estimates them. Travelpayouts' free
// /v2/prices/month-matrix returns the cheapest cached fare for each day of a month on
// one route (measured 2026-11-27 on 150 real routes: mean 15.3 dates, median 15.5).
//
// Rows are stored apart from the main fare map (pk "D#<ORIGIN>#<YYYY-MM>",
// sk "<DEST>", dates packed in one item), so the per-origin reads the search already makes stay the
// same size; the search asks for one route's dates when it needs a flight home.
// Rows expire after 7 days, the provider's own cache period.

const ENDPOINT = 'https://api.travelpayouts.com/v2/prices/month-matrix';
const TTL_DAYS = 7;

const code = v => { const s = String(v || '').trim().toUpperCase(); return /^[A-Z]{3}$/.test(s) ? s : ''; };
const month = v => { const s = String(v || '').trim(); return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : ''; };
const day = v => { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };

function toDateRecords(origin, destination, m, rows, observedAt, nowMs = Date.now()) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const d = day(r?.depart_date), price = Number(r?.value);
    if (!d || !d.startsWith(m) || !Number.isFinite(price) || price <= 0) continue;
    const found = Date.parse(r?.found_at);
    // Skip fares the provider found more than a week ago.
    if (Number.isFinite(found) && found < nowMs - TTL_DAYS * 86400000) continue;
    const rec = { origin, destination, month: m, departureDate: d, priceUsd: Math.round(price * 100) / 100,
      stops: Number.isFinite(Number(r?.number_of_changes)) ? Number(r.number_of_changes) : null,
      durationMinutes: Number(r?.duration) > 0 ? Number(r.duration) : (Number(r?.duration_to) > 0 ? Number(r.duration_to) : null),
      source: 'travelpayouts-month-matrix', observedAt, foundAt: Number.isFinite(found) ? new Date(found).toISOString() : null };
    if (!out.has(d) || out.get(d).priceUsd > rec.priceUsd) out.set(d, rec);
  }
  return [...out.values()].sort((a, b) => a.departureDate.localeCompare(b.departureDate));
}

// One route and month. Prices are requested in USD. Rate limit (provider): 300/min.
async function fetchRouteDates(options = {}) {
  const o = code(options.origin), d = code(options.destination), m = month(options.month);
  if (!o || !d || o === d || !m) return { ok: false, reason: 'invalid-route', records: [], requests: 0 };
  if (!options.token) return { ok: false, reason: 'travelpayouts-token-missing', records: [], requests: 0 };
  const fetchFn = options.fetch || globalThis.fetch, clock = options.clock || Date.now;
  if (options.pace) await options.pace(options.deadline || clock() + 30000);
  const url = `${options.endpoint || ENDPOINT}?${new URLSearchParams({ origin: o, destination: d, month: `${m}-01`, currency: 'usd', limit: '31', show_to_affiliates: 'true' })}`;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(10000, options.timeoutMs || 8000)));
  try {
    const res = await fetchFn(url, { headers: { 'X-Access-Token': options.token, 'Accept-Encoding': 'gzip' }, redirect: 'error', signal: controller.signal });
    if (res.status === 429) return { ok: false, reason: 'rate-limited', records: [], requests: 1 };
    if (!res.ok) return { ok: false, reason: res.status >= 500 ? 'provider-server-error' : 'provider-http-error', records: [], requests: 1 };
    let body; try { body = JSON.parse(await res.text()); } catch { return { ok: false, reason: 'provider-invalid-json', records: [], requests: 1 }; }
    if (body?.success === false || !Array.isArray(body?.data)) return { ok: false, reason: 'provider-invalid-schema', records: [], requests: 1 };
    return { ok: true, reason: null, records: toDateRecords(o, d, m, body.data, new Date(clock()).toISOString(), clock()), requests: 1 };
  } catch (e) {
    return { ok: false, reason: e.name === 'AbortError' ? 'provider-timeout' : 'provider-network-error', records: [], requests: 1 };
  } finally { clearTimeout(timer); }
}

// Storage: ONE item per route and month (pk "D#<ORIGIN>#<YYYY-MM>", sk "<DEST>"), the
// dates packed as "YYYY-MM-DD,price,stops,duration;..." (stops/duration empty when
// unknown). About 1 KB for a full month, so a route-month costs one write and one read
// instead of ~15 of each. 7-day TTL.
const num = v => (v == null || !Number.isFinite(Number(v)) ? '' : String(Number(v)));
function pack(records) { return records.map(r => [r.departureDate, r.priceUsd, num(r.stops), num(r.durationMinutes)].join(',')).join(';'); }
function unpack(origin, destination, m, text, extra = {}) {
  return String(text || '').split(';').filter(Boolean).map(x => { const [d, p, st, du] = x.split(',');
    return { origin, destination, month: m, departureDate: d, priceUsd: Number(p), stops: st === '' || st == null ? null : Number(st),
      durationMinutes: du === '' || du == null ? null : Number(du), source: 'travelpayouts-month-matrix', ...extra }; })
    .filter(r => day(r.departureDate) && Number.isFinite(r.priceUsd));
}
// records: all dates of one route and month.
function toRouteItem(records, nowMs = Date.now()) {
  const r = records[0];
  return { pk: { S: `D#${r.origin}#${r.month}` }, sk: { S: r.destination }, d: { S: pack(records) }, n: { N: String(records.length) },
    observedAt: { S: r.observedAt }, ttl: { N: String(Math.floor(nowMs / 1000) + TTL_DAYS * 86400) } };
}
function fromRouteItem(item) {
  const [, origin, m] = String(item?.pk?.S || '').split('#');
  return unpack(origin, String(item?.sk?.S || ''), m, item?.d?.S, { observedAt: item?.observedAt?.S || null });
}
// Single-date helpers kept for callers and tests that handle one record.
function toItem(rec, nowMs = Date.now()) { return toRouteItem([rec], nowMs); }
function fromItem(item) { return fromRouteItem(item)[0]; }

// Dates for one route over the given months: one GetItem per month.
async function readRouteDates(origin, destination, months, options = {}) {
  const store = require('./fare-map-store');
  const table = store.tableName(options.env);
  const ms = [...new Set((months || []).map(month).filter(Boolean))];
  if (!table || !ms.length || !code(origin) || !code(destination)) return [];
  const db = options.dynamo || store._internal.client(options), cmd = store._internal.cmd;
  const nowS = Math.floor((options.nowMs ?? Date.now()) / 1000);
  // GetItem (one or two months), so readers need no permission beyond the ones they have.
  const got = await Promise.all(ms.map(m => db.send(cmd('GetItemCommand', { TableName: table, Key: { pk: { S: `D#${code(origin)}#${m}` }, sk: { S: code(destination) } } }), { abortSignal: options.abortSignal })));
  return got.map(g => g?.Item).filter(Boolean).filter(i => Number(i?.ttl?.N || 0) > nowS).flatMap(fromRouteItem).sort((a, b) => a.departureDate.localeCompare(b.departureDate));
}

module.exports = { ENDPOINT, TTL_DAYS, fetchRouteDates, readRouteDates, toDateRecords, toItem, fromItem, toRouteItem, fromRouteItem, pack, unpack };
