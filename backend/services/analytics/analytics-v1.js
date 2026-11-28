'use strict';
// GV-ANALYTICS-V1 (Schema v1 / v1.1): two DynamoDB tables, Users and Searches.
//
// Off unless the Lambda setting GV_ANALYTICS=on. Every write is best-effort with a short
// timeout: analytics can never fail, slow or change a search response.
//
// Searches row (globevoy-analytics-searches, key searchId):
//   searchId  s_ + sha256(page sid)[0..24]; the results page sends its random per-page sid
//             with the search, the identify call and every feedback event, so they all
//             land on one row whatever order they arrive in.
//   userId    g_<guest id> until a verified signed-in identify call sets u_<HMAC(sub)>.
//   recommendations[], events[], bookingClicks[] appended; budget stored as a range only.
// Users row (globevoy-analytics-users, key userId): totals only, signed-in users only.
// Never stored: names, emails, raw Cognito sub, exact budget, IP, headers.

const crypto = require('node:crypto');

const DAY = 86400;
const BANDS = [[1500, 'under_1500'], [2000, '1500_2000'], [3000, '2000_3000'], [4000, '3000_4000'], [5000, '4000_5000'], [7500, '5000_7500'], [10000, '7500_10000'], [15000, '10000_15000'], [Infinity, 'over_15000']];
const CAD_PER = { CAD: 1, USD: 1.36, EUR: 1.47, GBP: 1.72, AUD: 0.9 };
const ACTIONS = new Set(['impression', 'view', 'select', 'save', 'unsave', 'like', 'dislike', 'shuffle', 'show_other', 'book_click', 'partner_click']);
const ROLES = /^[a-z-]{2,30}$/;

// The commit this package was built from (launch-manifest.json, written by the packager),
// so every row says exactly which code ranked it. Costs no Lambda setting space.
let manifestVersion;
function algorithmVersion(env) {
  if (env.GV_ALGORITHM_VERSION) return String(env.GV_ALGORITHM_VERSION).slice(0, 60);
  if (manifestVersion === undefined) {
    try { const m = require('../../launch-manifest.json'); manifestVersion = m.sourceCommit ? 'main-' + String(m.sourceCommit).slice(0, 7) : null; } catch (_) { manifestVersion = null; }
  }
  return manifestVersion || String(env.AWS_LAMBDA_FUNCTION_VERSION || 'unknown').slice(0, 60);
}

function config(env = process.env) {
  if (String(env.GV_ANALYTICS || '').toLowerCase() !== 'on') return null;
  return Object.freeze({
    searches: env.GV_ANALYTICS_SEARCHES_TABLE || 'globevoy-analytics-searches',
    users: env.GV_ANALYTICS_USERS_TABLE || 'globevoy-analytics-users',
    secretId: env.GV_ANALYTICS_SECRET_ID || 'globevoy/analytics-hash-key',
    retentionDays: Math.min(400, Math.max(1, Number(env.GV_ANALYTICS_RETENTION_DAYS) || 396)),
    algorithmVersion: algorithmVersion(env),
    region: env.AWS_REGION || 'us-east-2'
  });
}

const sha = (s, n = 24) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, n);
const validSid = s => /^[A-Za-z0-9-]{16,64}$/.test(String(s || ''));
const searchIdFor = sid => validSid(sid) ? 's_' + sha('gv-search:' + sid) : null;
const guestIdFor = gid => validSid(gid) ? 'g_' + sha('gv-guest:' + gid, 20) : 'g_unknown';
function budgetBand(budget, currency) {
  const b = Number(budget), r = CAD_PER[String(currency || 'CAD').toUpperCase()];
  if (!(b > 0) || !r) return 'unknown';
  const cad = b * r;
  return BANDS.find(([max]) => cad < max)[1];
}
const bandIndex = b => BANDS.findIndex(x => x[1] === b);
function originCode(q = {}) {
  const m = String(q.origin || '').toUpperCase().match(/\(([A-Z]{3})\)\s*$/) || String(q.originCode || q.origin || '').toUpperCase().match(/^([A-Z]{3})$/);
  return m ? m[1] : 'unknown';
}
function travellers(q = {}) {
  const n = k => Math.min(9, Math.max(0, Math.floor(Number(q[k]) || 0)));
  return { adults: Math.max(1, n('adults') || n('passengers') || 1), children: n('children'), rooms: Math.max(1, n('rooms') || 1) };
}
const num = v => Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null;
const str = (v, n = 80) => v == null ? null : String(v).replace(/[\u0000-\u001f]/g, '').slice(0, n);

/** One compact entry per trip shown (the route we proposed). */
function recommendation(tour, searchId, position) {
  const role = ROLES.test(String(tour.tourRole || '')) ? tour.tourRole : 'none';
  const stops = (tour.stops || tour.cities || []).slice(0, 9);
  const legs = (tour.legs || []).slice(0, 10);
  const budget = Number(tour.totalBudgetUsd);
  return {
    recId: searchId + '-' + role, role, position,
    cities: stops.map(s => str(s.cityId || s.id, 60)).filter(Boolean),
    nights: num(tour.totalNights),
    totalUsd: num(tour.estimatedTotalUsd), flightsUsd: num(tour.totalFlightEstimateUsd), hotelsUsd: num(tour.totalHotelEstimateUsd),
    budgetUsedPct: budget > 0 && Number(tour.estimatedTotalUsd) > 0 ? Math.round(Number(tour.estimatedTotalUsd) / budget * 1000) / 10 : null,
    score: num(tour.fareMap?.score ?? tour.score),
    live: tour.pricingStatus ? str(tour.pricingStatus, 60) : null,
    stops: stops.map((s, i) => ({
      stop: i + 1, city: str(s.cityId || s.id, 60), nights: num(s.nights),
      hotel: str(s.hotel?.name || s.hotel?.hotelName, 100), hotelUsd: num(s.hotel?.estimatedStayUsd),
      hotelRating: num(s.hotel?.reviewScore ?? s.hotel?.costEvidence?.quality?.reviewScore),
      flightUsd: num(legs[i]?.estimatedTransportUsd), flightStops: legs[i]?.stops == null ? null : num(legs[i].stops),
      airline: str(legs[i]?.airline || legs[i]?.carrier, 40)
    })),
    returnFlightUsd: num(legs[stops.length]?.estimatedTransportUsd),
    shown: true, propensity: 1
  };
}

// ---- DynamoDB marshalling (small, dependency-free) --------------------------------
function toAttr(v) {
  if (v === null || v === undefined) return { NULL: true };
  if (typeof v === 'boolean') return { BOOL: v };
  if (typeof v === 'number') return { N: String(v) };
  if (typeof v === 'string') return { S: v };
  if (Array.isArray(v)) return { L: v.map(toAttr) };
  if (v instanceof Set) return { SS: [...v].map(String) };
  return { M: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toAttr(x)])) };
}
function fromAttr(a) {
  if (!a) return undefined;
  if ('S' in a) return a.S; if ('N' in a) return Number(a.N); if ('BOOL' in a) return a.BOOL; if ('NULL' in a) return null;
  if ('SS' in a) return new Set(a.SS); if ('L' in a) return a.L.map(fromAttr);
  if ('M' in a) return Object.fromEntries(Object.entries(a.M).map(([k, x]) => [k, fromAttr(x)]));
}

let ddb, sm, secretCache;
function client(cfg) {
  if (!ddb) { const sdk = require('@aws-sdk/client-dynamodb'); ddb = { sdk, c: new sdk.DynamoDBClient({ region: cfg.region, maxAttempts: 2 }) }; }
  return ddb;
}
async function send(cfg, name, input, ms = 400) {
  const { sdk, c } = client(cfg);
  const controller = new AbortController(), t = setTimeout(() => controller.abort(), ms);
  try { return await c.send(new sdk[name](input), { abortSignal: controller.signal }); } finally { clearTimeout(t); }
}
async function hashKey(cfg) {
  if (secretCache) return secretCache;
  const sdk = require('@aws-sdk/client-secrets-manager');
  sm ||= new sdk.SecretsManagerClient({ region: cfg.region, maxAttempts: 2 });
  const r = await sm.send(new sdk.GetSecretValueCommand({ SecretId: cfg.secretId }));
  const key = String(r.SecretString || '').trim();
  if (key.length < 32) throw Error('analytics hash key too short');
  return (secretCache = key);
}
const userIdFor = (sub, key) => 'u_' + crypto.createHmac('sha256', key).update(String(sub)).digest('hex').slice(0, 32);

function expires(cfg, now) { return Math.floor(now / 1000) + cfg.retentionDays * DAY; }

/** The optimizer's feasible pool (up to 20), compact. Only feasible, in-budget trips exist here. */
function candidates(body, searchId) {
  const pool = Array.isArray(body.pool) ? body.pool.slice(0, 20) : [];
  const key = t => (t.stops || t.cities || []).map(s => s.cityId || s.id).join('>');
  const shown = new Set((body.tours || []).map(key));
  return pool.map((t, i) => {
    const budget = Number(t.totalBudgetUsd);
    return {
      candId: searchId + '-c' + (Number(t.poolRank) || i + 1), poolRank: Number(t.poolRank) || i + 1,
      cities: (t.stops || t.cities || []).map(s => str(s.cityId || s.id, 60)).filter(Boolean).slice(0, 9),
      nights: num(t.totalNights), totalUsd: num(t.estimatedTotalUsd),
      budgetUsedPct: budget > 0 && Number(t.estimatedTotalUsd) > 0 ? Math.round(Number(t.estimatedTotalUsd) / budget * 1000) / 10 : null,
      score: num(t.poolScore ?? t.fareMap?.score ?? t.score), inTours: shown.has(key(t)), propensity: null
    };
  });
}

/** Build the Searches UpdateItem for one /api/generated-tour response. Order-independent. */
function searchUpdate(cfg, { query = {}, body = {}, latencyMs, now = Date.now(), settings = {} }) {
  const searchId = searchIdFor(query.sid);
  if (!searchId) return null;
  const tours = (Array.isArray(body.tours) && body.tours.length ? body.tours : body.tour ? [body.tour] : []).slice(0, 6);
  const slot = Math.max(0, Math.min(5, Number(query.slot) || 0));
  const recs = tours.map((t, i) => recommendation(t, searchId, slot + i + 1));
  const cands = candidates(body, searchId);
  const d = body.diagnostics || {};
  const att = Array.isArray(d.fareMapLiveAttempts) ? d.fareMapLiveAttempts : [];
  const failed = att.filter(a => a !== 'ok' && !/stopped/.test(String(a))).length;
  const liveParts = recs.reduce((s, r) => s + (/live/i.test(r.live || '') ? 1 : 0), 0);
  const v = {
    ':now': new Date(now).toISOString(), ':guest': guestIdFor(query.gid), ':false': false,
    ':origin': originCode(query), ':originText': str(query.origin, 80) || 'unknown',
    ':band': budgetBand(query.budget, query.currency), ':cur': str(String(query.currency || 'CAD').toUpperCase(), 3),
    ':trav': travellers(query), ':ver': cfg.algorithmVersion, ':settings': settings,
    ':lat': Math.round(Number(latencyMs) || 0), ':recs': recs, ':empty': [], ':n': recs.length, ':fail': failed,
    ':pe': { live: liveParts, estimated: recs.length - liveParts }, ':ttl': expires(cfg, now), ':zero': 0,
    ':exp': str(query.experimentId, 40) || 'none', ':cands': cands
  };
  return {
    searchId,
    input: {
      TableName: cfg.searches, Key: { searchId: { S: searchId } },
      UpdateExpression: 'SET createdAt = if_not_exists(createdAt, :now), userId = if_not_exists(userId, :guest), registered = if_not_exists(registered, :false), ' +
        'originCode = :origin, originCity = :originText, budgetBand = :band, currency = :cur, travellers = :trav, algorithmVersion = :ver, settings = :settings, ' +
        'experimentId = :exp, latencyMs = :lat, priceEvidence = :pe, recommendations = list_append(if_not_exists(recommendations, :empty), :recs), ' +
        'candidates = if_not_exists(candidates, :cands), events = if_not_exists(events, :empty), bookingClicks = if_not_exists(bookingClicks, :empty), refreshes = if_not_exists(refreshes, :zero), expiresAt = :ttl ' +
        'ADD tripsShown :n, liveCheckFailures :fail',
      ExpressionAttributeValues: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toAttr(x)]))
    }
  };
}

/** Feedback event -> append to the search row (and Users totals for partner clicks). */
function parseFeedback(raw) {
  if (typeof raw !== 'string' || !raw || Buffer.byteLength(raw) > 2048) return null;
  let v; try { v = JSON.parse(raw); } catch (_) { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const searchId = searchIdFor(v.sid), action = String(v.action || '');
  if (!searchId || !ACTIONS.has(action)) return null;
  const role = ROLES.test(String(v.role || '')) ? v.role : 'none';
  const ev = { type: action, recId: searchId + '-' + role, role, position: Number.isInteger(Number(v.rank)) && v.rank >= 1 && v.rank <= 9 ? Number(v.rank) : null };
  if (action === 'impression') {
    ev.live = ['live', 'estimate'].includes(v.live) ? v.live : null;
    ev.value = num(v.value) != null && v.value > 0 && v.value < 1e6 ? num(v.value) : null;
    ev.currency = /^[A-Z]{3}$/.test(String(v.currency || '')) ? v.currency : null;
  }
  if (action === 'partner_click') {
    ev.kind = ['flight', 'hotel'].includes(v.kind) ? v.kind : 'other';
    ev.provider = str(v.provider, 40) || 'unknown';
    ev.value = num(v.value) != null && v.value > 0 && v.value < 1e6 ? num(v.value) : null;
    ev.currency = /^[A-Z]{3}$/.test(String(v.currency || '')) ? v.currency : null;
    ev.stop = Number.isInteger(Number(v.stop)) && v.stop >= 1 && v.stop <= 9 ? Number(v.stop) : null;
    ev.clickId = /^[a-z0-9]{8,40}$/.test(String(v.clickId || '')) ? v.clickId : null;
  }
  return { searchId, ev };
}
function feedbackUpdate(cfg, { searchId, ev }, now = Date.now()) {
  ev = { ...ev, at: new Date(now).toISOString() };
  const isClick = ev.type === 'partner_click', isShuffle = ev.type === 'show_other' || ev.type === 'shuffle';
  return {
    TableName: cfg.searches, Key: { searchId: { S: searchId } }, ReturnValues: isClick ? 'ALL_NEW' : 'NONE',
    UpdateExpression: 'SET createdAt = if_not_exists(createdAt, :now), expiresAt = if_not_exists(expiresAt, :ttl), events = list_append(if_not_exists(events, :empty), :ev)' +
      (isClick ? ', bookingClicks = list_append(if_not_exists(bookingClicks, :empty), :ev)' : '') + (isShuffle ? ' ADD refreshes :one' : ''),
    ExpressionAttributeValues: Object.fromEntries(Object.entries({ ':now': new Date(now).toISOString(), ':ttl': expires(cfg, now), ':empty': [], ':ev': [ev], ...(isShuffle ? { ':one': 1 } : {}) }).map(([k, x]) => [k, toAttr(x)]))
  };
}

/** Users row: read, merge, write (low traffic; one row per signed-in user). */
function mergeUser(old = {}, { userId, guestId, tokenIat, origin, band, currency, adults, hasSearch }, now = Date.now()) {
  const iso = new Date(now).toISOString(), month = iso.slice(0, 7);
  const set = (s, x) => { const out = new Set(s instanceof Set ? s : []); if (x && x !== 'unknown') out.add(x); return out; };
  const newLogin = !old.userId || Number(tokenIat) > Number(old.lastTokenIat || 0);
  const minB = [old.minBudgetBand, band].filter(b => bandIndex(b) >= 0).sort((a, b) => bandIndex(a) - bandIndex(b));
  const u = {
    userId, firstSeenAt: old.firstSeenAt || iso, lastSeenAt: iso,
    lastLoginAt: newLogin ? iso : old.lastLoginAt, loginCount: (old.loginCount || 0) + (newLogin ? 1 : 0),
    lastTokenIat: Math.max(Number(old.lastTokenIat) || 0, Number(tokenIat) || 0),
    searchCount: (old.searchCount || 0) + (hasSearch ? 1 : 0), bookingClicks: old.bookingClicks || 0,
    maxTravellers: Math.max(old.maxTravellers || 0, adults || 0),
    minBudgetBand: minB[0] || old.minBudgetBand || 'unknown', maxBudgetBand: minB.at(-1) || old.maxBudgetBand || 'unknown'
  };
  // DynamoDB string sets cannot be empty: include only non-empty ones.
  for (const [k, s] of Object.entries({ uniqueOrigins: set(old.uniqueOrigins, origin), currencies: set(old.currencies, currency), activeMonths: set(old.activeMonths, month), linkedGuestIds: set(old.linkedGuestIds, guestId !== 'g_unknown' ? guestId : null) })) if (s.size) u[k] = s;
  return u;
}

async function recordSearch(cfg, args) {
  const u = searchUpdate(cfg, args);
  if (!u) return 'skipped';
  await send(cfg, 'UpdateItemCommand', u.input);
  return 'recorded';
}

async function recordFeedback(cfg, raw, now = Date.now()) {
  const fb = parseFeedback(raw);
  if (!fb) return 'invalid';
  const r = await send(cfg, 'UpdateItemCommand', feedbackUpdate(cfg, fb, now));
  const userId = r?.Attributes?.userId?.S;
  if (fb.ev.type === 'partner_click' && userId && userId.startsWith('u_')) {
    await send(cfg, 'UpdateItemCommand', { TableName: cfg.users, Key: { userId: { S: userId } }, ConditionExpression: 'attribute_exists(userId)', UpdateExpression: 'ADD bookingClicks :one', ExpressionAttributeValues: { ':one': { N: '1' } } }).catch(() => {});
  }
  return 'recorded';
}

async function identify(cfg, event, raw, { verify, now = Date.now() } = {}) {
  let body = {}; try { body = JSON.parse(raw || '{}') || {}; } catch (_) { return 'invalid'; }
  const token = await verify(event); // throws when not a valid production access token
  const key = await hashKey(cfg);
  const userId = userIdFor(token.sub, key), guestId = guestIdFor(body.gid), searchId = searchIdFor(body.sid);
  const got = await send(cfg, 'GetItemCommand', { TableName: cfg.users, Key: { userId: { S: userId } }, ConsistentRead: true });
  const old = got?.Item ? fromAttr({ M: got.Item }) : {};
  // A new access token (sign-in or hourly refresh) has a later expiry: counted as a sign-in session.
  const iat = Number(token.expiresAt || token.iat) || Math.floor(now / 1000);
  const merged = mergeUser(old, { userId, guestId, tokenIat: iat, origin: originCode(body), band: budgetBand(body.budget, body.currency), currency: str(String(body.currency || '').toUpperCase(), 3), adults: travellers(body).adults, hasSearch: !!searchId }, now);
  await send(cfg, 'PutItemCommand', { TableName: cfg.users, Item: toAttr(merged).M });
  if (searchId) {
    await send(cfg, 'UpdateItemCommand', {
      TableName: cfg.searches, Key: { searchId: { S: searchId } },
      UpdateExpression: 'SET userId = :u, registered = :t, guestId = :g, createdAt = if_not_exists(createdAt, :now), expiresAt = if_not_exists(expiresAt, :ttl)',
      ExpressionAttributeValues: { ':u': { S: userId }, ':t': { BOOL: true }, ':g': { S: guestId }, ':now': { S: new Date(now).toISOString() }, ':ttl': { N: String(expires(cfg, now)) } }
    });
  }
  return 'recorded';
}

const RANK_SETTINGS = ['FARE_MAP_EXPERIENCE', 'FARE_MAP_ROUTE_DATES', 'FARE_MAP_DESTINATION_DISCOVERY', 'FARE_MAP_DYNAMIC_DESTINATIONS', 'FARE_MAP_COMFORT_MODE', 'FARE_MAP_REFRESH_ROTATION'];
const settingsSnapshot = (env = process.env) => Object.fromEntries(RANK_SETTINGS.filter(k => env[k] != null).map(k => [k.replace(/^FARE_MAP_/, '').toLowerCase(), String(env[k]).slice(0, 20)]));

const bodyOf = event => event.isBase64Encoded ? Buffer.from(String(event.body || ''), 'base64').toString('utf8') : String(event.body || '');
const log = (o) => { try { console.log(JSON.stringify({ component: 'analytics_v1', ...o })); } catch (_) {} };

/** Routes for the Lambda: POST /api/trip-feedback and POST /api/analytics/identify. Always 204. */
async function handleRoute(path, event, { corsHeaders = {}, verify, env } = {}) {
  const headers = { ...corsHeaders, 'Cache-Control': 'no-store' };
  const done = s => ({ statusCode: 204, headers: { ...headers, 'X-GV-Analytics': s }, body: '' });
  const method = String(event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
  if (method === 'OPTIONS') return done('preflight');
  if (method !== 'POST') return done('ignored');
  const cfg = config(env);
  if (!cfg) return done('off');
  try {
    const s = path === '/api/analytics/identify' ? await identify(cfg, event, bodyOf(event), { verify }) : await recordFeedback(cfg, bodyOf(event));
    return done(s);
  } catch (e) {
    log({ route: path, status: 'failed', error: String(e?.name || e?.code || 'error').slice(0, 60) });
    return done('failed');
  }
}

/** Wraps the public handler: records one Searches update per /api/generated-tour 200. */
function wrap(handler, { env } = {}) {
  return async function analyticsHandler(event = {}, context = {}) {
    const started = Date.now();
    const result = await handler(event, context);
    try {
      const cfg = config(env);
      const path = event.rawPath || event.path || '';
      if (!cfg || path !== '/api/generated-tour' || result?.statusCode !== 200) return result;
      if (context.getRemainingTimeInMillis && context.getRemainingTimeInMillis() < 600) return result;
      let body = {}; try { body = JSON.parse(result.body); } catch (_) { return result; }
      const status = await recordSearch(cfg, { query: event.queryStringParameters || {}, body, latencyMs: Date.now() - started, settings: settingsSnapshot(env || process.env) });
      log({ route: path, status });
    } catch (e) { log({ route: 'search', status: 'failed', error: String(e?.name || 'error').slice(0, 60) }); }
    return result;
  };
}

module.exports = { config, wrap, handleRoute, _internal: { candidates, algorithmVersion, budgetBand, originCode, travellers, searchIdFor, guestIdFor, userIdFor, recommendation, searchUpdate, parseFeedback, feedbackUpdate, mergeUser, toAttr, fromAttr, settingsSnapshot, resetForTests() { ddb = sm = secretCache = undefined; }, setClientForTests(x) { ddb = x; }, setKeyForTests(k) { secretCache = k; } } };
