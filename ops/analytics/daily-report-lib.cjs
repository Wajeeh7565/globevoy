'use strict';
// Pure summary for ops/analytics/daily-report.mjs (tested offline).
const S = v => (v && (v.S ?? v.N)) ?? null;
const top = (m, n = 10) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n));

function summarize(items = [], nowSec = Date.now() / 1000) {
  const live = items.filter(i => Number(S(i.expiresAt) || 0) > nowSec);
  const count = sk => live.filter(i => String(S(i.SK)).startsWith(sk)).reduce((m, i) => { m[String(S(i.SK)).slice(sk.length)] = Number(S(i.count) || 0); return m; }, {});
  const searches = live.filter(i => String(S(i.SK)).startsWith('EVENT#') && S(i.category) === 'generated_tour');
  const byOutcome = {}; for (const e of searches) byOutcome[S(e.outcome)] = (byOutcome[S(e.outcome)] || 0) + 1;
  const cities = {}; let trips = 0, checks = 0, failed = 0;
  for (const e of searches) {
    trips += Number(S(e.tripsShown) || 0); checks += Number(S(e.liveChecks) || 0); failed += Number(S(e.failedChecks) || 0);
    for (const c of String(S(e.citiesShown) || '').split(',')) if (c && c !== 'none') cities[c] = (cities[c] || 0) + 1;
  }
  const fb = live.filter(i => String(S(i.SK)).startsWith('FEEDBACK#') && S(i.kind) === 'feedback');
  const byAction = {}, byRole = {};
  for (const f of fb) { const a = S(f.action), r = S(f.role); byAction[a] = (byAction[a] || 0) + 1; (byRole[r] = byRole[r] || {})[a] = (byRole[r][a] || 0) + 1; }
  const refs = new Set(searches.map(e => S(e.searchRef)).filter(Boolean));
  const clicked = new Set(fb.filter(f => ['view', 'book_click', 'save'].includes(S(f.action))).map(f => S(f.searchRef)));
  const other = new Set(fb.filter(f => S(f.action) === 'show_other').map(f => S(f.searchRef)));
  return {
    searches: { total: searches.length, byOutcome, counters: count('COUNT#generated_tour#') },
    budgets: count('BUDGET#'), topOrigins: top(count('ORIGIN#')),
    shown: { tripsPerSearch: searches.length ? +(trips / searches.length).toFixed(2) : 0, liveChecks: checks, failedChecks: failed, failRatePct: checks ? Math.round(100 * failed / checks) : 0, topCities: top(cities) },
    feedback: { total: fb.length, byAction, byRole, linkedSearches: refs.size, searchesWithClick: [...refs].filter(r => clicked.has(r)).length, searchesWithShowOther: [...refs].filter(r => other.has(r)).length }
  };
}
module.exports = { summarize };
