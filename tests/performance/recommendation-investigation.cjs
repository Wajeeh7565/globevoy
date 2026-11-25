#!/usr/bin/env node
'use strict';
// GV-RECS-INV-001: whole-pipeline investigation (offline, simulated fares and hotel truth).
//   node tests/performance/recommendation-investigation.cjs [--memory-file export.json] [--env K=V ...] [--json]
// For 10 origins x 8 budgets it runs the real optimizer and reports what travellers would
// see signed out (1 trip, refreshed 3 times) and signed in (3 trips): budget use, nights,
// cities, countries, same-country trips, departure months, city repetition, what limits
// bigger trips, and search effort. --memory-file plans with the REAL hotel memory export
// (truth stays simulated, so failure rates are indicative; repetition/diversity are the point).
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '../..');
const opt = require(path.join(root, 'backend/services/domain/fare-map/fare-map-optimizer'));
const B = require('./recommendation-benchmark.cjs');

const ORIGINS = ['Toronto (YYZ)', 'Vancouver (YVR)', 'New York (JFK)', 'Los Angeles (LAX)', 'Mexico City (MEX)', 'London (LHR)', 'Paris (PAR)', 'Dubai (DXB)', 'Singapore (SIN)', 'Sydney (SYD)'];
const BUDGETS = [1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000];

function args() { const a = process.argv.slice(2), o = { env: {} }; for (let i = 0; i < a.length; i++) { if (a[i] === '--memory-file') o.memoryFile = a[++i]; else if (a[i] === '--fare-snapshot') o.fareSnapshot = a[++i]; else if (a[i] === '--env') { const [k, ...v] = a[++i].split('='); o.env[k] = v.join('='); } else if (a[i] === '--json') o.json = true; else if (a[i] === '--origins') o.origins = a[++i].split(','); else if (a[i] === '--budgets') o.budgets = a[++i].split(',').map(Number); } return o; }
function loadMemory(file) {
  const R = require('./hotel-memory-report.cjs');
  const { entries } = R.parse(fs.readFileSync(file, 'utf8'));
  return new Map(entries.map(e => [e.id, { ratio: Math.min(3, Math.max(0.6, e.ratio)), n: e.n, at: e.at }]));
}
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = x => Math.round(100 * x);

async function runOne(origin, budgetCad, env) {
  const r = await opt.search({ origin, budget: budgetCad, currency: 'CAD', adults: 1 }, { env: { ENABLE_FARE_MAP_OPTIMIZER: 'true', FARE_MAP_TABLE: 'benchmark', ...env }, now: B.NOW, readRoutes: B.fareReader(), hotelRatios: SIMMEM, ...(READER ? { readRoutes: READER, now: SNAP.takenAt } : {}) });
  const pool = r.pool || [], spendable = budgetCad / B.CAD_PER_USD * 0.9;
  // live check in pool order; a page shows the first passing trips (signed out 1, signed in 3)
  const checked = pool.map(t => ({ t, live: B.liveTotalUsd(t) })).filter(x => x.live <= spendable);
  const trip = x => {
    const st = x.t.stops || [];
    const countries = new Set(st.map(s => s.countryCode || s.country)).size;
    return { route: st.map(s => s.city).join(' > '), cities: st.map(s => s.cityId), countries, cityCount: st.length, sameCountry: st.length > 1 && countries === 1,
      nights: x.t.totalNights, month: String(x.t.legs?.[0]?.departureDate || '').slice(0, 7), use: x.live / (spendable / 0.9),
      maxNightsHit: st.some(s => { const row = opt._internal.rows().find(rw => rw.unifiedRegistry.cityId === s.cityId); const mx = Number(row?.unifiedRegistry?.destination?.maximumRecommendedNights) || 35; return s.nights >= mx; }) };
  };
  // first page + 3 refreshes (1 trip each); with FARE_MAP_REFRESH_ROTATION=on each refresh
  // reorders the unseen pool the way the trip builder does (seenRoutes).
  let guest = checked.slice(0, 4).map(trip);
  if (String((env || {}).FARE_MAP_REFRESH_ROTATION || '') === 'on') {
    const ok = new Set(checked.map(x => x.t)), seen = [], shown = [], k = t => t.stops.map(s => String(s.cityId).toLowerCase()).join('>');
    for (let p = 0; p < 4; p++) { const next = (seen.length ? opt.rotateQueue(pool, seen) : pool).find(t => ok.has(t) && !seen.includes(k(t))); if (!next) break; seen.push(k(next)); shown.push(checked.find(x => x.t === next)); }
    guest = shown.map(trip);
  }
  const member = checked.slice(0, 3).map(trip);          // signed in: 3 trips
  return { origin, budgetCad, poolSize: pool.length, passed: checked.length, guest, member, d: r.diagnostics || {} };
}
let SIMMEM = null, SNAP = null;
// --fare-snapshot: replay REAL cached fares (ops/fare-map/replay-snapshot.mjs); a partition
// missing from the snapshot reads as empty. Live truth for hotels stays simulated.
function snapshotReader(file) {
  const body = JSON.parse(require('zlib').gunzipSync(fs.readFileSync(file)).toString('utf8'));
  SNAP = { takenAt: Date.parse(body.takenAt), missing: 0, keys: new Set(), coverage: body.coverage || null, memorySha: body.memory?.sha256 || null };
  return async (o, m) => { const v = body.partitions[o + '|' + m]; if (!v) { SNAP.missing++; SNAP.keys.add(o + '|' + m); } return v || []; };
}
let READER = null;

function summarise(cases) {
  const by = b => cases.filter(c => c.budgetCad === b);
  const rows = {};
  for (const b of BUDGETS_USED) {
    const g = by(b), firsts = g.map(c => c.guest[0]).filter(Boolean), members = g.flatMap(c => c.member);
    const months = {}; for (const c of g) for (const t of c.guest) months[t.month] = (months[t.month] || 0) + 1;
    rows[b] = {
      searches: g.length, withTrip: firsts.length,
      bestUse: pct(mean(firsts.map(t => t.use))), bestNights: +mean(firsts.map(t => t.nights)).toFixed(1), bestCities: +mean(firsts.map(t => t.cityCount)).toFixed(1),
      multiCountry: pct(mean(members.filter(t => t.cityCount > 1).map(t => t.countries > 1 ? 1 : 0))), sameCountryShown: pct(mean(members.map(t => t.sameCountry ? 1 : 0))),
      refreshDistinctMonths: +mean(g.map(c => new Set(c.guest.map(t => t.month)).size)).toFixed(1),
      refreshRepeatCity: pct(mean(g.filter(c => c.guest.length > 1).map(c => { const all = c.guest.flatMap(t => t.cities); return all.length > new Set(all).size ? 1 : 0; }))),
      maxNightsHitBest: pct(mean(firsts.map(t => t.maxNightsHit ? 1 : 0))),
      threeCityBest: pct(mean(firsts.map(t => t.cityCount >= 3 ? 1 : 0))),
      topMonth: Object.entries(months).sort((a, b) => b[1] - a[1])[0]?.join(':') || '-'
    };
  }
  const cityFreq = {}; for (const c of cases) for (const t of c.guest) for (const id of t.cities) cityFreq[id] = (cityFreq[id] || 0) + 1;
  const shownTrips = cases.reduce((s, c) => s + c.guest.length, 0);
  const top = Object.entries(cityFreq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${pct(v / shownTrips)}%`);
  const effort = { avgMs: Math.round(mean(cases.map(c => c.d.ms || 0))), bounded: pct(mean(cases.map(c => c.d.bounded ? 1 : 0))), avgComplete: Math.round(mean(cases.map(c => c.d.completeRoutes || 0))), avgPool: +mean(cases.map(c => c.poolSize)).toFixed(1) };
  return { byBudget: rows, topCitiesInGuestTrips: top, effort };
}
let BUDGETS_USED = BUDGETS;

(async () => {
  const o = args();
  const origins = o.origins || ORIGINS; BUDGETS_USED = o.budgets || BUDGETS;
  B.setOriginCodes(origins.map(x => B.originInfo(x).code));
  SIMMEM = o.memoryFile ? loadMemory(o.memoryFile) : B.simulatedMemory();
  if (o.fareSnapshot) READER = snapshotReader(o.fareSnapshot);
  const cases = [];
  for (const x of origins) for (const b of BUDGETS_USED) cases.push(await runOne(x, b, o.env));
  const s = summarise(cases);
  if (o.json) { console.log(JSON.stringify({ env: o.env, memory: o.memoryFile ? 'real export' : 'simulated', summary: s, cases }, null, 1)); return; }
  console.log(`Investigation: ${origins.length} origins x ${BUDGETS_USED.length} budgets, memory ${o.memoryFile ? 'REAL export' : 'simulated clean'}, settings ${JSON.stringify(o.env)}`);
  console.log('budget  found  bestUse  nights  cities  3-city  maxNightsHit  multiCountry(2+ city trips)  sameCountry(shown)  refresh: months/repeatCity  topMonth');
  for (const [b, r] of Object.entries(s.byBudget)) console.log(`C$${String(b).padEnd(6)} ${String(r.withTrip + '/' + r.searches).padEnd(6)} ${String(r.bestUse + '%').padEnd(8)} ${String(r.bestNights).padEnd(7)} ${String(r.bestCities).padEnd(7)} ${String(r.threeCityBest + '%').padEnd(7)} ${String(r.maxNightsHitBest + '%').padEnd(13)} ${String(r.multiCountry + '%').padEnd(28)} ${String(r.sameCountryShown + '%').padEnd(19)} ${r.refreshDistinctMonths}/${r.refreshRepeatCity}%   ${r.topMonth}`);
  console.log('Most repeated cities (share of guest trips):', s.topCitiesInGuestTrips.join(', '));
  console.log('Effort:', JSON.stringify(s.effort));
  if (SNAP) { console.log(`Fare snapshot from ${new Date(SNAP.takenAt).toISOString()}; partitions missing during replay: ${SNAP.keys.size} distinct (${SNAP.missing} reads)`); if (SNAP.keys.size) console.log('WARNING: this setting asked for partitions the snapshot lacks (read as empty); compare it with the baseline only after re-collecting:', [...SNAP.keys].slice(0, 10).join(', ')); if (SNAP.memorySha && o.memoryFile) { const h = require('crypto').createHash('sha256').update(fs.readFileSync(o.memoryFile, 'utf8')).digest('hex'); if (h !== SNAP.memorySha) console.log('WARNING: --memory-file differs from the memory used to collect the snapshot.'); } }
})();
