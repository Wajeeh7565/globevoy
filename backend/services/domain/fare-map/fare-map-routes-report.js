'use strict';
// Console-only report: invoke the Lambda with
//   {"globevoyJob":"fare-map-routes","origin":"Toronto (YYZ)","budget":3500,"month":"2026-12"}
// Lists every complete trip the fare map finds (ranked, up to 100) without any live
// provider calls. Plain Lambda events only; never reachable from the website.
const optimizer = require('./fare-map-optimizer');

function isFareMapRoutesEvent(event) {
  return Boolean(event && !event.rawPath && !event.requestContext && event.globevoyJob === 'fare-map-routes');
}

async function runFareMapRoutesReport(event = {}, options = {}) {
  const query = {
    origin: event.origin || 'Toronto (YYZ)', budget: Number(event.budget) || 3500, currency: event.currency || 'CAD',
    adults: Number(event.adults) || 1, children: 0, flexible: true, dateMode: 'flexible', adaptiveDuration: true, minimumLeadDays: 14,
    ...(event.month ? { month: event.month, preferredMonth: event.month } : {})
  };
  const env = { ...(options.env || process.env), ENABLE_FARE_MAP_OPTIMIZER: 'true' };
  const r = await (options.optimizer || optimizer).search(query, { ...options, env, listRanked: true, listLimit: event.limit || 50 });
  const rate = Number(event.usdToCad) || 1.36;
  const d = r.diagnostics || {};
  return {
    ok: true, job: 'fare-map-routes', query: { origin: query.origin, budget: query.budget, month: query.month || 'flexible' },
    found: d.completeRoutes ?? null, listed: (d.ranked || []).length, searchMs: d.ms ?? null,
    note: 'Planning prices from stored fares and hotel estimates; the site live-checks the trip it shows.',
    routes: (d.ranked || []).map((x, i) => `${String(i + 1).padStart(2)}. ${x.route} | C$${Math.round(x.totalUsd * rate)} | ${x.nights ?? '?'} nights | ${(x.dates || []).join(' / ')}${x.estimatedReturnDate ? ' | return date estimated' : ''}`)
  };
}

module.exports = { isFareMapRoutesEvent, runFareMapRoutesReport };
