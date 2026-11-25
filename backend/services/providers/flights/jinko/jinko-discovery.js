'use strict';
// Jinko discovery endpoints (GV-JINKO-DISC-001): find_dates, lowest_fare,
// flight_calendar and find_destination. TEST-ONLY: not used by user searches.
//
// These read Jinko's fare cache. Prices are for ONE adult, can be days old, and
// must be live-checked before they are shown. Jinko's API terms (5.2.2) forbid
// building pricing databases and keeping outputs beyond the user's needs, so this
// module keeps nothing: callers get the answer and drop it after the search.
//
// "No cached fare" is NOT "no flight" (Jinko docs: the cache does not hold every
// flight). Results say `status: 'no-cached-fare'`, never "unavailable"; callers
// must not reject a trip for it.
//
// Safety: every client has a hard call budget (default 3) and a short timeout
// (default 2.5 s). No retries. 402 (out of credit) stops the client for good.
// The environment comes from the key itself: jnk_sandbox_t_ -> sandbox (free),
// anything else -> production (billed), which also needs allowProduction:true.

const PROD = 'https://api.gojinko.com/v1';
const SANDBOX = 'https://api.sandbox.gojinko.com/v1';
const ENDPOINTS = new Set(['find_dates', 'lowest_fare', 'flight_calendar', 'find_destination']);
const HARD_MAX_CALLS = 10;
const clean = v => String(v ?? '').trim();
const isSandboxKey = key => clean(key).startsWith('jnk_sandbox_');
const money = m => (m && Number.isFinite(Number(m.value)) ? Number(m.value) / 10 ** (Number(m.decimal_places) || 0) : null);
const IATA = /^[A-Z]{3}$/, DAY = /^\d{4}-\d{2}-\d{2}$/;

function itinerary(it) {
  if (!it) return null;
  const leg = it.outbound || {};
  return {
    origin: it.origin?.code || leg.origin?.code || leg.origin || null,
    destination: it.destination?.code || leg.destination?.code || leg.destination || null,
    total: money(it.total), currency: it.total?.currency || null,
    departure: leg.departure_datetime || null, arrival: leg.arrival_datetime || null,
    durationMinutes: Number(leg.duration_minutes) || null, stops: leg.stops ?? null,
    airline: leg.airline_name || leg.airline || null,
    pricedAt: it.priced_at || null,
    offerToken: it.offer_token || it.id || null
  };
}

function validate(endpoint, req) {
  if (!ENDPOINTS.has(endpoint)) return 'unknown-endpoint';
  if (!Array.isArray(req.origins) || !req.origins.length || !req.origins.every(c => IATA.test(c))) return 'invalid-origins';
  if (req.destinations && !req.destinations.every(c => IATA.test(c))) return 'invalid-destinations';
  if (!['oneway', 'roundtrip'].includes(req.trip_type)) return 'invalid-trip-type';
  for (const d of req.departure_dates || []) if (!DAY.test(d)) return 'invalid-date';
  for (const r of req.departure_date_ranges || []) if (!DAY.test(r.start) || !DAY.test(r.end) || r.start > r.end) return 'invalid-date-range';
  return null;
}

/**
 * createClient({ apiKey, allowProduction, maxCalls, timeoutMs, fetchFn, now })
 * Returns { call(endpoint, request), findDates(leg), usage() }. Never throws.
 */
function createClient(options = {}) {
  const key = clean(options.apiKey);
  const sandbox = isSandboxKey(key);
  const base = options.baseUrl || (sandbox ? SANDBOX : PROD);
  const maxCalls = Math.min(HARD_MAX_CALLS, Math.max(0, Number(options.maxCalls ?? 3)));
  const timeoutMs = Math.min(10000, Math.max(500, Number(options.timeoutMs) || 2500));
  const fetchFn = options.fetchFn || globalThis.fetch;
  const now = options.now || (() => Date.now());
  const usage = { environment: sandbox ? 'sandbox' : 'production', calls: 0, maxCalls, refused: 0, stopped: null, log: [] };

  async function call(endpoint, request = {}) {
    const started = now();
    const done = (r, status) => { usage.log.push({ endpoint, status: status ?? null, ms: now() - started, reason: r.reason || r.status || 'ok', results: r.itineraries?.length ?? r.destinations?.length ?? 0 }); return r; };
    if (!key) return done({ ok: false, reason: 'jinko-key-missing' });
    if (!sandbox && options.allowProduction !== true) return done({ ok: false, reason: 'production-not-allowed' });
    if (usage.stopped) { usage.refused++; return done({ ok: false, reason: usage.stopped }); }
    if (usage.calls >= maxCalls) { usage.refused++; return done({ ok: false, reason: 'call-budget-reached' }); }
    const bad = validate(endpoint, request);
    if (bad) return done({ ok: false, reason: bad });
    usage.calls++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(`${base}/${endpoint}`, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json', 'X-API-Key': key },
        body: JSON.stringify(request)
      });
      const text = await res.text();
      let body = null; try { body = JSON.parse(text); } catch (_) {}
      if (res.status === 402) usage.stopped = 'jinko-out-of-credit';
      if (res.status === 401) usage.stopped = 'jinko-key-rejected';
      if (res.status !== 200) return done({ ok: false, reason: `jinko-http-${res.status}`, code: body?.error?.code || null, retryAfter: res.headers?.get?.('retry-after') || null }, res.status);
      if (body?.result === 'no_matches' || (Array.isArray(body?.itineraries) && !body.itineraries.length && !body?.destinations)) {
        // Cache miss or no service: NOT proof that no flight exists.
        return done({ ok: true, status: 'no-cached-fare', emptyReason: body?.empty_reason || null, itineraries: [] }, 200);
      }
      const itineraries = (body?.itineraries || []).map(itinerary).filter(Boolean);
      const destinations = body?.destinations ? body.destinations.map(d => ({ code: d.iata_code, city: d.city_name, lowest: itinerary(d.lowest_fare) })) : undefined;
      return done({ ok: true, status: 'found', pricedFor: body?.priced_for || 'one_adult', itineraries, ...(destinations ? { destinations } : {}) }, 200);
    } catch (e) {
      return done({ ok: false, reason: e?.name === 'AbortError' ? 'jinko-timeout' : 'jinko-network-error' });
    } finally { clearTimeout(timer); }
  }

  // One leg across a date window -> cheapest cached fare per date.
  async function findDates(leg = {}) {
    const start = clean(leg.from), end = clean(leg.to || leg.from);
    return call('find_dates', {
      origins: [clean(leg.origin).toUpperCase()], destinations: [clean(leg.destination).toUpperCase()],
      trip_type: 'oneway', departure_date_ranges: [{ start, end }],
      currency: clean(leg.currency) || 'CAD', limit: Math.min(100, Math.max(1, Number(leg.limit) || 31))
    });
  }

  return { call, findDates, usage: () => ({ ...usage, log: usage.log.slice() }) };
}

module.exports = { createClient, HARD_MAX_CALLS, _internal: { itinerary, validate, isSandboxKey, money, PROD, SANDBOX } };
