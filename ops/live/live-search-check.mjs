#!/usr/bin/env node
// GV-LIVE-CHECK-001: real searches against the production API, exactly as the website sends
// them (pool mode, signed-in view of 3 trips), summarised against the Nov 27 requirements.
// Read-only for GlobeVoy; each search makes the same few paid live price checks a visitor's
// search makes (about US$0.002 each). Hard cap: --max-searches (default 24).
//   node ops/live/live-search-check.mjs [--origins "Toronto (YYZ),London (LHR)"] [--cases 1500x1,3000x1,7500x2] [--json out.json]
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
const API = (process.env.GLOBEVOY_API || 'https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws/').replace(/\/?$/, '/');
const origins = arg('--origins', 'Toronto (YYZ)').split(',').map(s => s.trim()).filter(Boolean);
const cases = arg('--cases', '1500x1,2000x1,3000x1,5000x2,7500x2,12000x2').split(',').map(c => c.split('x').map(Number));
const max = Math.min(60, Number(arg('--max-searches', 24)) || 24);
const EUROPE = new Set('AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO SM RS SK SI ES SE CH UA GB VA'.split(' '));
const pct = (a, b) => b ? Math.round(100 * a / b) : null;

async function one(origin, budget, adults) {
  const q = new URLSearchParams({ origin, budget: String(budget), currency: 'CAD', adults: String(adults), passengers: String(adults), children: '0', mode: 'generated-tour',
    recommendationScope: 'generated-multicity-tour', tripLength: 'auto', adaptiveDuration: 'true', dateMode: 'flexible', flexible: 'true', pool: '1', poolShow: '3', seenRoutes: '[]',
    sid: `livecheck-${Date.now()}-${budget}-${Math.random().toString(36).slice(2, 10)}` });
  const t0 = Date.now();
  const r = await fetch(API + 'api/generated-tour?' + q, { headers: { Origin: 'https://globevoy.com' }, signal: AbortSignal.timeout(90000) });
  const d = await r.json().catch(() => ({}));
  const g = d.diagnostics || {}, seen = new Set(), trips = [];
  for (const t of [d.tour, ...(d.tours || [])]) {
    if (!t || seen.has(t.tourId)) continue; seen.add(t.tourId);
    const cs = t.cities || t.stops || [], cc = cs.map(c => String(c.countryCode || '').toUpperCase()), home = String(t.origin?.countryCode || 'CA').toUpperCase();
    trips.push({ role: t.tourRole, route: cs.map(c => `${c.city} ${c.nights}n`).join(' > '), total: t.displayBudget?.tripEstimate, use: pct(t.displayBudget?.tripEstimate, budget),
      cities: cs.length, countries: new Set(cc).size, abroad: cc.some(c => c && c !== home), europe: cc.some(c => EUROPE.has(c)),
      hotels: cs.map(c => `${c.hotel?.name || '?'} ${c.hotel?.rating || ''}`.trim()).join('; ') });
  }
  return { origin, budget, adults, httpMs: Date.now() - t0, status: r.status, trips, noTrip: d.noTrip?.title || null,
    search: { ms: g.ms, reads: g.reads, readMsTotal: g.readMsTotal, readMsMax: g.readMsMax, readRows: g.readRows, routeDateReads: g.routeDateReads, bounded: g.bounded,
      truncatedPartitions: g.truncatedPartitions, completeRoutes: g.completeRoutes, poolSize: g.poolSize, liveChecks: g.fareMapLiveAttempts, requirement: g.requirementCheck } };
}

const results = [];
outer: for (const origin of origins) for (const [budget, adults] of cases) {
  if (results.length >= max) break outer;
  try { results.push(await one(origin, budget, adults || 1)); } catch (e) { results.push({ origin, budget, adults, error: String(e.message || e) }); }
}
for (const x of results) {
  if (x.error) { console.log(`${x.origin} C$${x.budget} x${x.adults}: ERROR ${x.error}`); continue; }
  const s = x.search, rq = s.requirement || {};
  console.log(`\n${x.origin} C$${x.budget} x${x.adults}: ${x.trips.length} trips, page ${x.httpMs} ms, search ${s.ms} ms, reads ${s.reads} (${s.readMsTotal} ms total, max ${s.readMsMax} ms, ${s.readRows} rows, truncated ${s.truncatedPartitions || 0}), dates ${s.routeDateReads}, bounded ${s.bounded}`);
  console.log(`  built ${rq.complete} trips (${rq.multiCity} multi-city, ${rq.multiCountry} multi-country), pool ${s.poolSize}, miss ${rq.missReason || '-'}, live ${JSON.stringify(s.liveChecks)}`);
  for (const t of x.trips) console.log(`  ${String(t.role).padEnd(14)} ${t.route.padEnd(50)} C$${t.total} (${t.use}%) ${t.cities}c/${t.countries}ctry${t.europe ? ' EU' : ''}${t.abroad ? '' : ' DOMESTIC'} | ${t.hotels}`);
  if (!x.trips.length) console.log('  no trip:', x.noTrip);
}
const ok = results.filter(x => !x.error), all = ok.flatMap(x => x.trips.map(t => ({ ...t, budget: x.budget })));
const by = f => pct(all.filter(f).length, all.length);
console.log(`\nSUMMARY ${ok.length} searches, ${all.length} trips: international ${by(t => t.abroad)}%, multi-city ${by(t => t.cities >= 2)}%, multi-country ${by(t => t.countries >= 2)}%, Europe at C$1,500 ${pct(all.filter(t => t.budget === 1500 && t.europe).length, all.filter(t => t.budget === 1500).length)}%, best use in 85-90% ${pct(all.filter(t => t.role === 'best-balance' && t.use >= 85 && t.use <= 90).length, all.filter(t => t.role === 'best-balance').length)}%`);
const out = arg('--json'); if (out) (await import('node:fs')).writeFileSync(out, JSON.stringify(results, null, 1));
