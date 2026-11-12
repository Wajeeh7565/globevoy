'use strict';
// Final selected schedules only: no provider/default/gate changes and no new API.
const pilot = require('./public-live-fare-pilot-684a');
const { normalizeParty } = require('../pricing/traveller-pricing');
const { usableDuffelEvidence } = require('../../providers/flights/duffel/live-evidence-integrity-005');
const requestResults = new WeakMap();
function usableTour(tour, query, now = Date.now()) {
  const tasks = pilot._internal.buildTasks684A(tour);
  const passengers = normalizeParty(query).travellers;
  return tasks.length > 0 && tasks.every(task => {
    const leg = tour.legs[task.index];
    return usableDuffelEvidence(leg.providerDateEvidence || leg.cheapestOneWay, { ...task, passengers }, now);
  });
}
async function preferSelectedExactFlights(tour, query, options = {}) {
  const fallback = options.fallback;
  if (typeof fallback !== 'function') throw Error('Selected-flight policy requires the existing cached/planning fallback');
  const eligible = options.exactDates === true && pilot.eligibility684A(tour, query, options.env || process.env).eligible;
  if (!eligible) return fallback(tour, query);
  let memo = requestResults.get(query);
  if (!memo) { memo = new Map(); requestResults.set(query, memo); }
  // Full schedule/pricing and query prevent reusing offers against changed totals,
  // occupancy, currency or dates. Only this HTTP request object owns the cache.
  const key = JSON.stringify([tour, query]);
  let result;
  if (!memo.has(key) && memo.size < 4) {
    const apply = options.applyLiveFare || pilot.applyPublicLiveFarePilot684A;
    memo.set(key, Promise.resolve().then(() => apply(tour, query, options)).catch(() =>
      ({ tour, summary: { applied: false, reason: 'selected-live-search-unavailable' } })));
  }
  result = memo.has(key) ? await memo.get(key) : { tour, summary: { applied: false, reason: 'selected-schedule-attempt-limit' } };
  const applied = result.summary?.applied === true && usableTour(result.tour, query, options.nowMs ?? Date.now());
  const selection = { version: 'GV-API-005', preferredProvider: 'Duffel',
    priceSource: applied ? 'LIVE' : 'cached-or-estimated',
    reason: applied ? 'eligible-selected-exact-schedule' : result.summary?.reason || 'live-evidence-unusable',
    referralPriceGuaranteed: false };
  if (applied) return { tour: result.tour, summary: { source: 'duffel-first-selected-exact-schedule', providerSelection: selection },
    selectedScheduleLiveFare: result };
  const cached = await fallback(tour, query);
  return { ...cached, summary: { ...cached.summary, providerSelection: selection },
    // The failed request is not retried at the later verification phase. Existing
    // caps/concurrency/retry/atomic-reconciliation machinery owned the attempt.
    selectedScheduleLiveFare: { tour: cached.tour, summary: { ...result.summary, applied: false, selection } } };
}
module.exports = { preferSelectedExactFlights, usableTour };
