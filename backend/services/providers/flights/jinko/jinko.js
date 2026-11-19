'use strict';
// Jinko flight search (https://docs.gojinko.com/api/flight-search). Test-only for now:
// used by the provider comparison job, never by user searches.
// Key: Secrets Manager secret JINKO_SECRET_ID (default globevoy/production/jinko), {"apiKey":"jnk_..."}.
const BASE = 'https://api.gojinko.com/v1';
const DEFAULT_SECRET = 'globevoy/production/jinko';
let sdk = null, client = null, cached = { id: '', key: '' };

const clean = v => String(v ?? '').trim();
function parseKey(value) {
  const text = clean(value);
  if (!text) return '';
  try { const o = JSON.parse(text); return clean(o.apiKey || o.api_key || o.key); } catch (_) { return text.startsWith('jnk_') ? text : ''; }
}
async function getApiKey(env = process.env, options = {}) {
  if (options.apiKey) return clean(options.apiKey);
  const id = clean(env.JINKO_SECRET_ID) || DEFAULT_SECRET;
  if (cached.id === id && cached.key) return cached.key;
  let raw;
  if (typeof options.getSecretValue === 'function') raw = await options.getSecretValue(id);
  else {
    if (!sdk) sdk = require('@aws-sdk/client-secrets-manager');
    if (!client) client = new sdk.SecretsManagerClient({ region: clean(env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-2') });
    const r = await client.send(new sdk.GetSecretValueCommand({ SecretId: id }));
    raw = r?.SecretString || '';
  }
  const key = parseKey(raw);
  if (!key) throw Object.assign(new Error('jinko-key-invalid'), { code: 'jinko-key-invalid' });
  cached = { id, key };
  return key;
}
const money = m => (m && Number.isFinite(Number(m.value)) ? Number(m.value) / 10 ** (Number(m.decimal_places) || 0) : null);

/** Cheapest live one-way fare for one route/date. Never throws; returns { ok, reason?, ... }. */
async function searchOneWay(input = {}, options = {}) {
  const env = options.env || process.env, fetchFn = options.fetchFn || globalThis.fetch;
  const origin = clean(input.origin).toUpperCase(), destination = clean(input.destination).toUpperCase(), date = clean(input.departureDate);
  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'invalid-route-or-date' };
  let key;
  try { key = await getApiKey(env, options); } catch (e) { return { ok: false, reason: e.code || 'jinko-key-unavailable' }; }
  const controller = new AbortController(), started = Date.now();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 20000);
  try {
    const res = await fetchFn(`${BASE}/flight_search`, {
      method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', 'X-API-Key': key },
      body: JSON.stringify({ origin, destination, departure_date: date, trip_type: 'oneway', adults: Number(input.adults) || 1, currency: clean(input.currency) || 'CAD', limit: Math.min(300, Math.max(1, Number(input.limit) || 10)) })
    });
    const ms = Date.now() - started, text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch (_) {}
    if (res.status !== 200) return { ok: false, reason: `jinko-http-${res.status}`, ms, code: body?.error?.code || body?.code || null };
    const fares = [];
    for (const offer of body?.offers || []) for (const fare of offer.fares || []) {
      const total = money(fare.total_price);
      if (total) fares.push({ total, currency: fare.total_price.currency, searchedAt: fare.searched_at || null, expiresAt: fare.expires_at || null,
        stops: offer.outbound?.stops ?? null, airline: offer.outbound?.airline_name || offer.outbound?.airline || null, arrival: offer.outbound?.arrival_datetime || null });
    }
    fares.sort((a, b) => a.total - b.total);
    return { ok: true, ms, offers: (body?.offers || []).length, cheapest: fares[0] || null, result: body?.result || null };
  } catch (e) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'jinko-timeout' : 'jinko-network-error', ms: Date.now() - started };
  } finally { clearTimeout(timer); }
}

module.exports = { searchOneWay, _internal: { parseKey, money } };
