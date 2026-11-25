'use strict';
// GV-ANALYTICS-9A: recommendation feedback (POST /api/trip-feedback).
//
// The results page sends one small event when a traveller acts on a shown trip:
//   view        opened a trip's details         book_click  clicked a booking link
//   save        saved the trip                  show_other  asked for other trips (an
//                                                           implicit "not these" for the trips shown)
// with the trip's role and position, its city IDs and the page's random search reference
// (the same token as the search event's searchRef), so each click links to what was shown.
//
// Same table, retention and approval as search activity (activity-build.json with
// schemaVersion 2 and detail + detailApproved). Off without it. No user, session, IP,
// cookie, headers, budget amount or dates are stored. The endpoint always answers 204,
// so feedback can never break or slow the page.

const crypto = require('node:crypto');
const activity = require('./search-activity');

const ACTIONS = new Set(['view', 'book_click', 'save', 'show_other']);
const ROLES = new Set(['best-balance', 'lowest-cost', 'most-memorable', 'none']);
const MAX_BODY = 2048;

function parse(body) {
  if (typeof body !== 'string' || !body || Buffer.byteLength(body) > MAX_BODY) return null;
  let v; try { v = JSON.parse(body); } catch (_) { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const action = String(v.action || ''), role = String(v.role || 'none');
  const searchRef = activity._internal.ref(v.sid);
  const rank = Number(v.rank);
  const cities = Array.isArray(v.cities) ? v.cities.map(c => String(c || '').toLowerCase()).filter(c => /^[a-z0-9-]{2,60}$/.test(c)).slice(0, 4) : [];
  if (!ACTIONS.has(action) || !ROLES.has(role) || !searchRef) return null;
  return { action, role, rank: Number.isInteger(rank) && rank >= 1 && rank <= 9 ? rank : 0, cities: cities.join(',') || 'none', page: Math.min(20, Math.max(1, Number(v.page) || 1)), searchRef };
}

function event(fb, now = Date.now()) {
  const utcDate = new Date(now).toISOString().slice(0, 10);
  return {
    schemaVersion: 2, kind: 'feedback', eventId: crypto.randomUUID().replace(/-/g, ''),
    utcDate, utcHour: new Date(now).getUTCHours(), ...fb,
    expiresAt: 0 // set from config below
  };
}

let client;
async function persist(ev, cfg, { send } = {}) {
  if (!send) { const sdk = require('@aws-sdk/client-dynamodb'); client ||= new sdk.DynamoDBClient({ region: 'us-east-2', maxAttempts: 1 }); send = (input, opts) => client.send(new sdk.TransactWriteItemsCommand(input), opts); }
  const PK = { S: 'DAY#' + ev.utcDate };
  const item = Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, typeof v === 'number' ? { N: String(v) } : { S: String(v) }]));
  const counter = SK => ({ Update: { TableName: cfg.table, Key: { PK, SK: { S: SK } }, UpdateExpression: 'SET expiresAt = :ttl ADD #count :one', ExpressionAttributeNames: { '#count': 'count' }, ExpressionAttributeValues: { ':one': { N: '1' }, ':ttl': { N: String(ev.expiresAt) } } } });
  const input = { TransactItems: [
    { Put: { TableName: cfg.table, Item: { ...item, PK, SK: { S: 'FEEDBACK#' + ev.eventId } }, ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' } },
    counter('COUNT#feedback#' + ev.action),
    counter('FEEDBACK#' + ev.action + '#' + ev.role)
  ] };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 300);
  try { await send(input, { abortSignal: controller.signal }); return 'recorded'; } finally { clearTimeout(timer); }
}

/** Lambda route handler. Always 204; records only when approved and the body is valid. */
async function handle(event = {}, options = {}) {
  const headers = { ...(options.corsHeaders || {}), 'Cache-Control': 'no-store' };
  const done = status => ({ statusCode: 204, headers: { ...headers, 'X-GV-Feedback': status }, body: '' });
  try {
    const method = String(event.requestContext?.http?.method || event.httpMethod || 'GET').toUpperCase();
    if (method !== 'POST') return done('ignored');
    const cfg = activity.configuration(options.config === undefined ? activity.loadConfig() : options.config);
    if (!cfg || cfg.detail !== true) return done('off');
    const raw = event.isBase64Encoded ? Buffer.from(String(event.body || ''), 'base64').toString('utf8') : event.body;
    const fb = parse(raw);
    if (!fb) return done('invalid');
    const now = (options.clock || Date.now)();
    const ev = event_(fb, now, cfg);
    await (options.persist || persist)(ev, cfg);
    return done('recorded');
  } catch (_) {
    try { (options.log || console.log)(JSON.stringify({ component: 'trip_feedback', status: 'write_failed' })); } catch (__) {}
    return done('failed');
  }
}
function event_(fb, now, cfg) {
  const ev = event(fb, now);
  ev.expiresAt = Math.floor(Date.parse(ev.utcDate + 'T00:00:00Z') / 1000) + cfg.retentionDays * 86400;
  return ev;
}

module.exports = { handle, parse, persist, ACTIONS, _internal: { event: event_ } };
