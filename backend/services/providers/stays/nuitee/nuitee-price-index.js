'use strict';
// GV-PRICE-INDEX-001: Nuitee Hotel Price Index client (beta endpoints).
//
//   GET https://api.liteapi.travel/v3.0/prices/hotels?hotelIds=<=50 ids>&fromDate&toDate
//       -> { data: [{ hotelId, prices: [{ day, avgPriceUsd }] }] }
//   GET https://api.liteapi.travel/v3.0/prices/city?countryCode&cityName&fromDate&toDate
//       -> { countryCode, cityName, prices: [{ day, avgPriceUsd }] }   (up to 1,000 hotels averaged)
//
// US$0.02 per request, 10 requests/minute (sandbox and production). Prices are
// per-night averages by calendar day for future check-ins; tax and occupancy basis
// are not documented.
//
// This client makes ONE request per call and never retries. The collector decides
// retries, and every request (retries included) must be paid for out of the
// monthly budget first (see domain/pricing/hotel-price-index/budget.js).
// Production keys (prod_) are refused unless allowProduction is true.

const nuitee = require('./nuitee-hotel-708c');
const BASE = 'https://api.liteapi.travel/v3.0/prices';
const MAX_HOTEL_IDS = 50;
const clean = v => String(v ?? '').trim();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const keyMode = k => (/^(sand_|sandbox_)/.test(clean(k)) ? 'sandbox' : clean(k).startsWith('prod_') ? 'production' : 'unknown');

function entries(list) {
  return (Array.isArray(list) ? list : [])
    .map(p => ({ day: clean(p?.day).slice(0, 10), usd: Number(p?.avgPriceUsd) }))
    .filter(p => DAY.test(p.day) && Number.isFinite(p.usd) && p.usd > 0);
}

async function request(path, params, options = {}) {
  const env = options.env || process.env;
  let key;
  try { key = options.apiKey ? clean(options.apiKey) : await (options.getApiKey || nuitee.getApiKey)(env, options); }
  catch (e) { return { ok: false, reason: e.code || 'nuitee-key-unavailable' }; }
  const mode = keyMode(key);
  if (mode !== 'sandbox' && options.allowProduction !== true) return { ok: false, reason: 'production-not-allowed', keyMode: mode };
  const fetchFn = options.fetchFn || globalThis.fetch;
  const controller = new AbortController(), started = Date.now();
  const timer = setTimeout(() => controller.abort(), Math.min(20000, Math.max(1000, Number(options.timeoutMs) || 10000)));
  try {
    const res = await fetchFn(`${BASE}/${path}?${new URLSearchParams(params)}`, { method: 'GET', signal: controller.signal, headers: { accept: 'application/json', 'X-API-Key': key } });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch (_) {}
    const ms = Date.now() - started;
    if (res.status !== 200) return { ok: false, reason: `nuitee-http-${res.status}`, status: res.status, retryable: res.status === 429 || res.status >= 500, ms, keyMode: mode };
    return { ok: true, body, ms, keyMode: mode };
  } catch (e) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'nuitee-timeout' : 'nuitee-network-error', retryable: true, ms: Date.now() - started, keyMode: mode };
  } finally { clearTimeout(timer); }
}

function window(from, to) {
  if (from && !DAY.test(from)) return null;
  if (to && !DAY.test(to)) return null;
  if (from && to && from > to) return null;
  return { ...(from ? { fromDate: from } : {}), ...(to ? { toDate: to } : {}) };
}

/** Per-hotel calendars for up to 50 hotels. */
async function hotels({ hotelIds, from, to } = {}, options = {}) {
  const ids = [...new Set((hotelIds || []).map(clean).filter(id => /^[A-Za-z0-9_-]{2,64}$/.test(id)))];
  if (!ids.length || ids.length > MAX_HOTEL_IDS) return { ok: false, reason: 'invalid-hotel-ids' };
  const w = window(from, to); if (!w) return { ok: false, reason: 'invalid-dates' };
  const r = await request('hotels', { hotelIds: ids.join(','), ...w }, options);
  if (!r.ok) return r;
  const data = (Array.isArray(r.body?.data) ? r.body.data : []).map(h => ({ hotelId: clean(h?.hotelId), prices: entries(h?.prices) })).filter(h => h.hotelId);
  return { ok: true, kind: 'hotels', requested: ids.length, data, ms: r.ms, keyMode: r.keyMode };
}

/** One averaged calendar for a city (up to 1,000 hotels). */
async function city({ countryCode, cityName, from, to } = {}, options = {}) {
  const cc = clean(countryCode).toUpperCase(), name = clean(cityName);
  if (!/^[A-Z]{2}$/.test(cc) || !name) return { ok: false, reason: 'invalid-city' };
  const w = window(from, to); if (!w) return { ok: false, reason: 'invalid-dates' };
  const r = await request('city', { countryCode: cc, cityName: name, ...w }, options);
  if (!r.ok) return r;
  return { ok: true, kind: 'city', countryCode: cc, cityName: name, prices: entries(r.body?.prices), ms: r.ms, keyMode: r.keyMode };
}

module.exports = { hotels, city, MAX_HOTEL_IDS, _internal: { entries, keyMode, BASE } };
