'use strict';
// Manual test only: invoke the Lambda with {"globevoyJob":"provider-compare"} from the console.
// Prices the same one-way routes through Ignav and Jinko side by side. Never reachable from
// the website (plain Lambda events only), capped at 12 routes (<= 24 provider calls).
const ignav = require('../../providers/flights/ignav/ignav');
const jinko = require('../../providers/flights/jinko/jinko');

const DEFAULT_ROUTES = [
  ['YYZ', 'MDE', 14], ['YYZ', 'LAX', 21], ['YYZ', 'LHR', 21], ['YYZ', 'FLL', 18],
  ['FLL', 'LAS', 22], ['LAS', 'YYZ', 26], ['MDE', 'SFO', 20], ['CUN', 'YUL', 24],
  ['JFK', 'YUL', 25], ['YUL', 'LAX', 19], ['YVR', 'CUN', 15], ['PTY', 'YUL', 27]
];
const plusDays = (n, now) => new Date(now + n * 86400000).toISOString().slice(0, 10);

function isProviderCompareEvent(event) {
  return Boolean(event && !event.rawPath && !event.requestContext && event.globevoyJob === 'provider-compare');
}

function toRoute(r, now) {
  if (!Array.isArray(r)) return r;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r[2])) ? r[2] : plusDays(Number(r[2]) || 21, now);
  return { origin: r[0], destination: r[1], departureDate: date };
}

async function runProviderCompare(event = {}, options = {}) {
  const now = options.now || Date.now();
  const routes = (Array.isArray(event.routes) && event.routes.length ? event.routes : DEFAULT_ROUTES).slice(0, 12).map(r => toRoute(r, now));
  const currency = event.currency || 'CAD';
  const ig = options.ignav || ignav, jk = options.jinko || jinko;
  const rows = await Promise.all(routes.map(async route => {
    const [igRes, jkRes] = await Promise.all([
      (async () => {
        const t = Date.now();
        const r = await Promise.resolve(ig.searchOneWay({ ...route, currency }, options)).catch(() => ({ ok: false, reason: 'ignav-error' }));
        return { r, ms: Date.now() - t };
      })(),
      Promise.resolve(jk.searchOneWay({ ...route, currency }, options)).catch(() => ({ ok: false, reason: 'jinko-error' }))
    ]);
    const c = igRes.r?.ok ? igRes.r.cheapest : null;
    const igFare = c ? Number(c.partyTotalAmount ?? c.totalAmount ?? c.amount) : null;
    return {
      route: `${route.origin}-${route.destination} ${route.departureDate}`,
      ignav: igRes.r?.ok
        ? (igFare ? `${currency} ${Math.round(igFare)} (${igRes.ms} ms, observed ${igRes.r.observedAt || '?'})` : `no fare (${igRes.ms} ms)`)
        : `failed: ${igRes.r?.reason} (${igRes.ms} ms)`,
      jinko: jkRes.ok
        ? (jkRes.cheapest ? `${jkRes.cheapest.currency} ${Math.round(jkRes.cheapest.total)} (${jkRes.ms} ms, ${jkRes.cheapest.stops ?? '?'} stops)` : `no fare (${jkRes.ms} ms)`)
        : `failed: ${jkRes.reason} (${jkRes.ms ?? 0} ms)`,
      ignavLive: Boolean(igFare),
      jinkoLive: Boolean(jkRes.ok && jkRes.cheapest)
    };
  }));
  return {
    ok: true, job: 'provider-compare', currency, routes: rows.length,
    summary: { ignavPriced: rows.filter(r => r.ignavLive).length, jinkoPriced: rows.filter(r => r.jinkoLive).length },
    rows
  };
}

module.exports = { isProviderCompareEvent, runProviderCompare, DEFAULT_ROUTES };
