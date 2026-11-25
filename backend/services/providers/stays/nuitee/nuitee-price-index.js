'use strict';
// GV-PRICE-INDEX-001: Nuitee Hotel Price Index client (beta endpoints).
//
//   GET https://api.liteapi.travel/v3.0/prices/hotels?hotelIds=<=50 ids>&fromDate&toDate
//       -> { data: [{ hotelId, prices: [{ day, avgPriceUsd }] }] }
//   GET https://api.liteapi.travel/v3.0/prices/city?countryCode&cityName&fromDate&toDate
//       -> { countryCode, cityName, prices: [{ day, avgPriceUsd }] }   (up to 1,000 hotels averaged)
// US$0.02 per request, 10 requests/minute (sandbox and production).
//
// Rules enforced HERE, so no caller (collector, probe script, manual test) can skip them:
//  1. Budget: every production request reserves a slot from `options.budget` first
//     (the shared DynamoDB counter in domain/pricing/hotel-price-index/budget.js).
//     No budget -> no production request. Sandbox requests reserve too when a
//     budget is given (fixture runs), but don't need one.
//  2. Rate limit: at most 10 requests in any 60 s per process (waits, never drops).
//  3. Horizon: only future check-ins within a rolling six months (183 days).
//  4. One request per call, no retries here: the caller decides retries, and a
//     retry is a new call, so it reserves its own budget slot.
// Production keys (prod_) also need allowProduction:true.

const nuitee = require('./nuitee-hotel-708c');
const BASE = 'https://api.liteapi.travel/v3.0';
const MAX_HOTEL_IDS = 50;
const HORIZON_DAYS = 183;
const RATE = { max: 10, windowMs: 60000 };
const DAY_MS = 86400e3;
const clean = v => String(v ?? '').trim();
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const keyMode = k => (/^(sand_|sandbox_)/.test(clean(k)) ? 'sandbox' : clean(k).startsWith('prod_') ? 'production' : 'unknown');

/** Sliding-window limiter: wait() resolves when a request may be sent. */
function createLimiter({ max = RATE.max, windowMs = RATE.windowMs, clock = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const sent = [];
  return {
    async wait() {
      for (;;) {
        const now = clock();
        while (sent.length && now - sent[0] >= windowMs) sent.shift();
        if (sent.length < max) { sent.push(now); return 0; }
        await sleep(windowMs - (now - sent[0]) + 50);
      }
    },
    recent: () => sent.length
  };
}
const sharedLimiter = createLimiter();

/** Clamp a requested window to [today, today + 183 days]. null when nothing is left. */
function horizon(from, to, nowMs = Date.now()) {
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return null;
  const today = iso(nowMs), last = iso(Date.parse(today + 'T00:00:00Z') + (HORIZON_DAYS - 1) * DAY_MS);
  const f = !from || from < today ? today : from, t = !to || to > last ? last : to;
  return f <= t ? { fromDate: f, toDate: t } : null;
}

function entries(list) {
  return (Array.isArray(list) ? list : [])
    .map(p => ({ day: clean(p?.day).slice(0, 10), usd: Number(p?.avgPriceUsd) }))
    .filter(p => DAY.test(p.day) && Number.isFinite(p.usd) && p.usd > 0);
}

async function request(path, params, options = {}, { billed = true } = {}) {
  const env = options.env || process.env;
  let key;
  try { key = options.apiKey ? clean(options.apiKey) : await (options.getApiKey || nuitee.getApiKey)(env, options); }
  catch (e) { return { ok: false, reason: e.code || 'nuitee-key-unavailable' }; }
  const mode = keyMode(key);
  if (mode !== 'sandbox' && options.allowProduction !== true) return { ok: false, reason: 'production-not-allowed', keyMode: mode };
  if (billed) {
    if (mode !== 'sandbox' && !options.budget) return { ok: false, reason: 'budget-required', keyMode: mode };
    if (options.budget) {
      const slot = await options.budget.reserve(options.purpose || path);
      if (!slot.ok) return { ok: false, reason: slot.reason, budget: slot, keyMode: mode };
    }
  }
  await (options.limiter || sharedLimiter).wait();
  const fetchFn = options.fetchFn || globalThis.fetch;
  const controller = new AbortController(), started = Date.now();
  const timer = setTimeout(() => controller.abort(), Math.min(20000, Math.max(1000, Number(options.timeoutMs) || 10000)));
  try {
    const res = await fetchFn(`${BASE}/${path}?${new URLSearchParams(params)}`, { method: 'GET', signal: controller.signal, headers: { accept: 'application/json', 'X-API-Key': key } });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch (_) {}
    const ms = Date.now() - started;
    const retryAfter = Number(res.headers?.get?.('retry-after')) || null;
    if (res.status !== 200) return { ok: false, reason: `nuitee-http-${res.status}`, status: res.status, retryable: res.status === 429 || res.status >= 500, retryAfterS: retryAfter, ms, keyMode: mode, sent: true };
    return { ok: true, body, ms, keyMode: mode, sent: true };
  } catch (e) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'nuitee-timeout' : 'nuitee-network-error', retryable: true, ms: Date.now() - started, keyMode: mode, sent: true };
  } finally { clearTimeout(timer); }
}

/** Per-hotel calendars for up to 50 hotels (one billed request). */
async function hotels({ hotelIds, from, to } = {}, options = {}) {
  const ids = [...new Set((hotelIds || []).map(clean).filter(id => /^[A-Za-z0-9_-]{2,64}$/.test(id)))];
  if (!ids.length || ids.length > MAX_HOTEL_IDS) return { ok: false, reason: 'invalid-hotel-ids' };
  const w = horizon(from, to, (options.clock || Date.now)()); if (!w) return { ok: false, reason: 'outside-six-month-horizon' };
  const r = await request('prices/hotels', { hotelIds: ids.join(','), ...w }, options);
  if (!r.ok) return r;
  const data = (Array.isArray(r.body?.data) ? r.body.data : []).map(h => ({ hotelId: clean(h?.hotelId), prices: entries(h?.prices) })).filter(h => h.hotelId);
  return { ok: true, kind: 'hotels', requested: ids.length, window: w, data, ms: r.ms, keyMode: r.keyMode, sent: true };
}

/** One averaged calendar for a city, up to 1,000 hotels (one billed request). */
async function city({ countryCode, cityName, from, to } = {}, options = {}) {
  const cc = clean(countryCode).toUpperCase(), name = clean(cityName);
  if (!/^[A-Z]{2}$/.test(cc) || !name) return { ok: false, reason: 'invalid-city' };
  const w = horizon(from, to, (options.clock || Date.now)()); if (!w) return { ok: false, reason: 'outside-six-month-horizon' };
  const r = await request('prices/city', { countryCode: cc, cityName: name, ...w }, options);
  if (!r.ok) return r;
  return { ok: true, kind: 'city', countryCode: cc, cityName: name, window: w, prices: entries(r.body?.prices), ms: r.ms, keyMode: r.keyMode, sent: true };
}

/** Static hotel list for a city (data/hotels). Not a Price Index request; sandbox keys only here. */
async function hotelList({ countryCode, cityName, limit = 1000 } = {}, options = {}) {
  const cc = clean(countryCode).toUpperCase(), name = clean(cityName);
  if (!/^[A-Z]{2}$/.test(cc) || !name) return { ok: false, reason: 'invalid-city' };
  const r = await request('data/hotels', { countryCode: cc, cityName: name, limit: String(Math.min(1000, Math.max(1, limit))) }, { ...options, allowProduction: false, budget: null }, { billed: false });
  if (!r.ok) return r;
  const list = (Array.isArray(r.body?.data) ? r.body.data : []).map(h => ({
    id: clean(h.id || h.hotelId), name: clean(h.name), stars: Number(h.stars ?? h.starRating) || null,
    rating: Number(h.rating) || null, reviews: Number(h.reviewCount) || 0
  })).filter(h => h.id);
  return { ok: true, hotels: list, ms: r.ms };
}

module.exports = { hotels, city, hotelList, createLimiter, horizon, MAX_HOTEL_IDS, HORIZON_DAYS, RATE, _internal: { entries, keyMode, BASE, sharedLimiter } };
