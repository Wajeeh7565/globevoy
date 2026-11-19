'use strict';
// GV-FAREMAP-001 — nightly fare map, ingest side.
//
// For one origin (Travelpayouts city/metro code) and one month, ask the
// Travelpayouts Data API (cached Aviasales searches, free) for the cheapest
// one-way fare to EVERY destination it knows, and normalise the rows into
// fare-map records. No booking, no live quote: these are planning prices that
// the search later narrows down and then live-checks with Ignav.

const VERSION = 'GV-FAREMAP-001';
const DEFAULT_ENDPOINT = 'https://api.travelpayouts.com/graphql/v1/query';
const PAGE_SIZE = 250;           // Travelpayouts GraphQL max per page
const MAX_PAGES = 4;             // up to 1,000 destinations per origin+month

function code(value) {
  const s = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : '';
}
function month(value) {
  const s = String(value || '').trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : '';
}
function isoDate(value) {
  const s = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

function buildQuery(origin, departMonth, offset) {
  // origin/month are validated to [A-Z]{3} / YYYY-MM before interpolation.
  return `{
  prices_one_way(
    params: { origin: "${origin}", depart_months: "${departMonth}-01", no_lowcost: false }
    grouping: DIRECTIONS
    paging: { limit: ${PAGE_SIZE} offset: ${Number(offset) || 0} }
    sorting: VALUE_ASC
  ) {
    destination_city_iata
    departure_at
    value
  }
}`;
}

// Travelpayouts returns `value` in the account's price currency (RUB by
// default), converted with the same rule as the existing production code.
// Only fields that query already uses are requested (an unknown field would
// fail the whole request); stops/duration stay null for now.
const { convertFlightValueToUsd } = require('../../providers/flights/travelpayouts/travelpayouts');
function toRecord(origin, departMonth, row, observedAt, toUsd = convertFlightValueToUsd) {
  const destination = code(row?.destination_city_iata);
  const priceUsd = Number(toUsd(row?.value));
  if (!destination || destination === origin || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const date = isoDate(row?.departure_at);
  return {
    origin,
    month: departMonth,
    destination,
    priceUsd: Math.round(priceUsd),
    departureDate: date && date.startsWith(departMonth) ? date : null,
    stops: Number.isFinite(Number(row?.number_of_changes)) ? Number(row.number_of_changes) : null,
    durationMinutes: Number.isFinite(Number(row?.duration)) ? Number(row.duration) : null,
    source: 'travelpayouts-cached',
    observedAt
  };
}

async function ingestOriginMonth({ origin, month: departMonth, token, fetch: fetchFn = globalThis.fetch, endpoint, now, toUsd } = {}) {
  const o = code(origin);
  const m = month(departMonth);
  if (!o || !m) return { ok: false, reason: 'invalid-origin-or-month', records: [], requests: 0 };
  if (!token) return { ok: false, reason: 'travelpayouts-token-missing', records: [], requests: 0 };
  const observedAt = (now ? new Date(now) : new Date()).toISOString();
  const seen = new Map();
  let requests = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    requests += 1;
    let payload;
    try {
      const response = await fetchFn(endpoint || DEFAULT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Token': token },
        body: JSON.stringify({ query: buildQuery(o, m, page * PAGE_SIZE) })
      });
      const text = await response.text();
      payload = JSON.parse(text);
      if (response.status === 429) return { ok: false, reason: 'rate-limited', records: [...seen.values()], requests };
      if (!response.ok || payload?.errors) return { ok: seen.size > 0, reason: `travelpayouts-${response.status}${payload?.errors ? '-graphql-error' : ''}`, detail: JSON.stringify(payload?.errors || '').slice(0, 300), records: [...seen.values()], requests };
    } catch (_) {
      return { ok: seen.size > 0, reason: 'travelpayouts-request-failed', records: [...seen.values()], requests };
    }
    const rows = Array.isArray(payload?.data?.prices_one_way) ? payload.data.prices_one_way : [];
    for (const row of rows) {
      const rec = toRecord(o, m, row, observedAt, toUsd);
      if (rec && (!seen.has(rec.destination) || seen.get(rec.destination).priceUsd > rec.priceUsd)) seen.set(rec.destination, rec);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return { ok: true, reason: null, records: [...seen.values()], requests };
}

// The next N months starting from `now` (current month included), YYYY-MM.
function upcomingMonths(count = 6, now = Date.now()) {
  const d = new Date(now);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1));
    out.push(`${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// Distinct Travelpayouts origin codes for every origin-eligible city.
function originCodesFromRegistry(registry) {
  const rows = Array.isArray(registry) ? registry : (registry?.records || registry?.cities || []);
  const codes = new Set();
  for (const city of rows) {
    if (city?.origin?.eligible === false) continue;
    const c = code(city?.origin?.providerLocationCode || city?.origin?.preferredAirportCode);
    if (c) codes.add(c);
  }
  return [...codes].sort();
}

module.exports = { VERSION, ingestOriginMonth, upcomingMonths, originCodesFromRegistry, _internal: { buildQuery, toRecord, code, month } };
