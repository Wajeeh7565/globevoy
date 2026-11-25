#!/usr/bin/env node
'use strict';
// GV-V2-03 offline recommendation benchmark.
//
// Runs a fixed set of searches against fixed, seeded fares (no network, no paid
// calls), then simulates the live check (hotels usually cost more than planned)
// the way the Lambda's pool mode does, and scores what a traveller would see.
//
//   node tests/performance/recommendation-benchmark.cjs                    run + print summary
//   node tests/performance/recommendation-benchmark.cjs --save baseline    write tests/performance/fixtures/recommendation-baseline.json
//   node tests/performance/recommendation-benchmark.cjs --compare baseline compare to a saved run (exit 1 if worse)
//   node tests/performance/recommendation-benchmark.cjs --quick            small set (CI smoke)
//   --save/--compare <name>: 'baseline' is tests/performance/fixtures/recommendation-baseline.json,
//   any other name goes to .cache/benchmark/<name>.json
//   ... --spare 0                                              live-check without spare trips
//   ... --no-memory / --price-index                            without simulated hotel memory / with simulated Price Index
//   ... --env FARE_MAP_BIG_BUDGET=off                          try a setting
//
// Everything is deterministic: same code + same settings => same numbers.

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const opt = require(path.join(root, 'backend/services/domain/fare-map/fare-map-optimizer'));
const legacy = require(path.join(root, 'backend/services/domain/routing/multicity-routes'));

const NOW = Date.parse('2026-11-25T15:00:00Z');
const CAD_PER_USD = 1.36;
const ORIGINS = ['Toronto (YYZ)', 'Vancouver (YVR)', 'Boston (BOS)', 'New York (JFK)', 'London (LHR)', 'Lahore (LHE)', 'Addis Ababa (ADD)', 'Dubai (DXB)'];
const BUDGETS_CAD = [800, 1500, 2500, 4000, 10000];
const QUICK = [['Toronto (YYZ)', 1500, 1], ['Toronto (YYZ)', 4000, 1], ['Toronto (YYZ)', 10000, 1], ['London (LHR)', 2500, 1]];

// Route-quality limits used for the "odd route" flags.
const LIMITS = { detour: 1.25, longLegHours: 14, spreadKm: 4500, minNightsPerCity: 2 };

function args() {
  const a = process.argv.slice(2), o = { env: {} };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--save') o.save = a[++i];
    else if (a[i] === '--compare') o.compare = a[++i];
    else if (a[i] === '--quick') o.quick = true;
    else if (a[i] === '--json') o.json = true;
    else if (a[i] === '--spare') o.spare = Number(a[++i]);
    else if (a[i] === '--no-memory') o.noMemory = true;
    else if (a[i] === '--price-index') o.priceIndex = true;
    else if (a[i] === '--env') { const [k, ...v] = a[++i].split('='); o.env[k] = v.join('='); }
  }
  return o;
}

// ---- fixed inputs -------------------------------------------------------------
function seeded(str) { let s = [...str].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

const rows = opt._internal.rows();
const pos = new Map();
for (const r of rows) { const c = opt._internal.code(r); if (c && !pos.has(c)) pos.set(c, { latitude: r.unifiedRegistry.latitude, longitude: r.unifiedRegistry.longitude }); }
const codes = [...new Set(rows.filter(opt._internal.eligible).map(opt._internal.code).filter(Boolean))];
const km = (a, b) => legacy._internal.haversineKm(a, b) || 0;

// Fares: about a third of destinations per origin-month, priced by distance with
// noise. Every non-home origin also gets a fare home, so return legs exist.
function fareReader() {
  const cache = new Map();
  return async (o, m) => {
    const k = o + '|' + m;
    if (!cache.has(k)) {
      const R = seeded(k), a = pos.get(o) || pos.get('YTO');
      const day = () => `${m}-${String(1 + Math.floor(R() * 27)).padStart(2, '0')}`;
      const fare = (d, p) => ({ origin: o, month: m, destination: d, priceUsd: p, departureDate: day(), observedAt: new Date(NOW - 3600e3).toISOString(), source: 'travelpayouts-cached', durationMinutes: Math.round(60 + km(a, pos.get(d) || a) / 12), stops: 0 });
      const v = codes.filter(d => d !== o && R() < 0.35).map(d => fare(d, Math.round(45 + km(a, pos.get(d) || a) * 0.075 * (0.7 + R() * 0.6))));
      for (const home of ORIGIN_CODES) if (home !== o && !v.some(f => f.destination === home)) v.push(fare(home, Math.round(45 + km(a, pos.get(home) || a) * 0.075)));
      cache.set(k, v);
    }
    return cache.get(k);
  };
}
let ORIGIN_CODES = [];
const SIM = { memory: null, priceIndex: null };

// Simulated live check (truth model v2, GV-HOTEL-PLAN-002). Live tests (Nov 23-25)
// found hotel guesses 30-60% too low, varying by region and city, with a date pattern
// (Barcelona Price Index: holidays, weekends, seasons). Flights stay close to the
// cached fare. Truth per stay = plan x region level x city factor x date factor.
const REGION_LEVEL = { europe: 1.45, 'north-america': 1.35, 'latin-america': 1.15, asia: 1.2, africa: 1.1, oceania: 1.4 };
const cityFactor = city => 0.85 + seeded('cityf|' + city)() * 0.35;      // x0.85 - x1.2
function dateFactor(day) {
  const d = new Date(day + 'T00:00:00Z'); if (isNaN(d)) return 1;
  const m = d.getUTCMonth(), dd = d.getUTCDate(), wd = d.getUTCDay();
  let f = { 0: 0.85, 1: 0.88, 2: 0.98, 3: 1.08, 4: 1.12, 5: 1.2, 6: 1.25, 7: 1.22, 8: 1.08, 9: 1.0, 10: 0.9, 11: 0.98 }[m];
  if ((m === 11 && dd >= 22) || (m === 0 && dd <= 3)) f *= 1.35;
  if (wd === 5 || wd === 6) f *= 1.1;
  return f;
}
function stayDateFactor(stop) {
  const n = Math.max(1, Number(stop.nights) || 1), start = Date.parse(String(stop.arrivalDate || stop.checkIn || '').slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(start)) return 1;
  let s = 0; for (let k = 0; k < n; k++) s += dateFactor(new Date(start + k * 86400e3).toISOString().slice(0, 10));
  return s / n;
}
const hotelTruth = stop => (REGION_LEVEL[stop.regionFamily] || 1.3) * cityFactor(stop.cityId || stop.city) * stayDateFactor(stop);
const flightTruth = route => 0.9 + seeded('flight|' + route)() * 0.3; // x0.9 - x1.2
function liveTotalUsd(t) {
  const flights = (t.legs || []).reduce((s, l) => s + (Number(l.estimatedTransportUsd ?? l.estimatedFlightUsd) || 0), 0);
  const hotels = (t.stops || []).reduce((s, c) => s + (Number(c.hotel?.estimatedStayUsd) || 0) * hotelTruth(c), 0);
  return flights * flightTruth(routeKey(t)) + hotels;
}

// Simulated hotel price memory: about 40% of cities have a learned live/model ratio, as
// after a few weeks of live checks (level only; dates average out).
const memoryCities = row => seeded('mem|' + row.unifiedRegistry.cityId)() < 0.4;
function simulatedMemory() {
  const attr = require(path.join(root, 'backend/services/domain/live-fares/hotel-price-memory'))._internal.attr;
  const map = new Map();
  for (const row of rows) if (memoryCities(row)) {
    const fam = opt._internal.regionFamily(row);
    map.set(attr(row.unifiedRegistry.cityId), { ratio: (REGION_LEVEL[fam] || 1.3) * cityFactor(row.unifiedRegistry.cityId), n: 5, at: NOW });
  }
  return map;
}
// Simulated Price Index summaries for about 90 cities (date pattern only; the level is
// relative, like the real index whose level is ~16-26% above bookable rooms).
function simulatedPriceIndex() {
  const S = require(path.join(root, 'backend/services/domain/pricing/hotel-price-index/summary'));
  const map = new Map(), days = Array.from({ length: 183 }, (_, i) => new Date(NOW + i * 86400e3).toISOString().slice(0, 10));
  for (const row of rows.filter(opt._internal.eligible)) {
    const id = row.unifiedRegistry.cityId;
    if (seeded('pi|' + id)() >= 0.2) continue;
    map.set(id, S.fromCity(id, { prices: days.map(d => ({ day: d, usd: Math.round(150 * 1.2 * dateFactor(d)) })) }));
  }
  return map;
}
const routeKey = t => (t.stops || []).map(s => s.cityId || s.id || s.city).join('>');

// ---- scoring a trip ------------------------------------------------------------
function quality(t, origin) {
  const o = pos.get(origin.code) || null;
  const pts = (t.stops || []).map(s => ({ latitude: s.latitude ?? s.lat, longitude: s.longitude ?? s.lng }));
  const nodes = o ? [o, ...pts, o] : pts;
  let flown = 0; for (let i = 1; i < nodes.length; i++) flown += km(nodes[i - 1], nodes[i]);
  const far = o ? Math.max(0, ...pts.map(p => km(o, p))) : 0;
  const detour = pts.length > 1 && far > 0 ? flown / (2 * far) : 1;
  // spread: the longest hop between two trip cities (not to/from home). A 3-city
  // trip that jumps 6,000+ km between its own cities is three trips glued together.
  let spread = 0; for (let i = 1; i < pts.length; i++) spread = Math.max(spread, km(pts[i - 1], pts[i]));
  const families = new Set((t.stops || []).map(s => s.regionFamily).filter(Boolean));
  const longLeg = Math.max(0, ...(t.legs || []).map(l => (Number(l.durationMinutes) || 0) / 60));
  const shortStay = (t.stops || []).some(s => (Number(s.nights) || 0) < LIMITS.minNightsPerCity);
  const flags = [];
  if (detour > LIMITS.detour) flags.push('detour');
  if (pts.length > 1 && spread > LIMITS.spreadKm) flags.push('spread');
  if (pts.length > 2 && families.size === pts.length) flags.push('mixed-regions');
  if (longLeg > LIMITS.longLegHours) flags.push('long-leg');
  if (shortStay) flags.push('short-stay');
  return { detour: +detour.toFixed(2), spreadKm: Math.round(spread), regions: families.size, longLegHours: +longLeg.toFixed(1), flags };
}

// Mirrors generated-tour pool mode: check the pool in order, a round at a time
// (the trips still needed plus `spare` extra when more than one is wanted), at most
// 8 checks; keep up to `want` that fit; label the highest-use one "best".
// A round is one wait for live prices (~10-15 s live), so fewer rounds = faster page.
function simulatePage(pool, spendableUsd, want = 3, maxChecks = 8, spare = SPARE) {
  const shown = []; let checks = 0, failed = 0, rounds = 0, i = 0;
  while (shown.length < want && i < pool.length && checks < maxChecks) {
    const n = Math.min(want - shown.length + (want > 1 ? spare : 0), maxChecks - checks, pool.length - i);
    rounds++;
    for (const t of pool.slice(i, i + n)) {
      checks++;
      const live = liveTotalUsd(t);
      if (live > spendableUsd) { failed++; continue; }
      if (shown.length < want) shown.push({ t, live, use: live / (spendableUsd / 0.9) });
    }
    i += n;
  }
  shown.sort((a, b) => b.use - a.use);
  return { shown, checks, failed, rounds };
}
let SPARE = 2;

function originInfo(name) {
  const c = name.match(/\(([A-Z]{3})\)/)[1];
  const map = { YYZ: 'YTO', JFK: 'NYC', LHR: 'LON' };
  return { name, code: map[c] || c };
}

async function runOne(originName, budgetCad, adults, env) {
  const origin = originInfo(originName);
  const t0 = process.hrtime.bigint();
  const r = await opt.search({ origin: originName, budget: budgetCad, currency: 'CAD', adults }, { env: { ENABLE_FARE_MAP_OPTIMIZER: 'true', FARE_MAP_TABLE: 'benchmark', ...env }, now: NOW, readRoutes: fareReader(), hotelRatios: SIM.memory, priceIndex: SIM.priceIndex });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const pool = r.pool || [];
  const budgetUsd = budgetCad / CAD_PER_USD, spendable = budgetUsd * 0.9;
  const page = simulatePage(pool, spendable);
  const best = page.shown[0];
  const q = t => quality(t, origin);
  const shownQ = page.shown.map(s => q(s.t));
  const cities = page.shown.flatMap(s => s.t.stops.map(c => c.city));
  return {
    id: `${origin.code}-${budgetCad}-${adults}A`, origin: originName, budgetCad, adults,
    poolSize: pool.length, poolRoutes: pool.map(routeKey),
    shown: page.shown.length, checks: page.checks, rounds: page.rounds, liveFailures: page.failed,
    noTrip: page.shown.length === 0,
    best: best ? { route: best.t.stops.map(s => s.city).join(' > '), nights: best.t.totalNights, cities: best.t.stops.length, use: +best.use.toFixed(3), quality: q(best.t) } : null,
    shownUse: page.shown.map(s => +s.use.toFixed(3)),
    distinctCitiesShown: new Set(cities).size, citiesShown: cities.length,
    oddShown: shownQ.filter(x => x.flags.length).length,
    oddFlags: shownQ.flatMap(x => x.flags),
    poolOdd: pool.filter(t => q(t).flags.length).length,
    maxCities: Math.max(0, ...pool.map(t => t.stops.length)),
    maxNights: Math.max(0, ...pool.map(t => t.totalNights || 0)),
    reads: r.diagnostics?.reads, completeRoutes: r.diagnostics?.completeRoutes, ms: Math.round(ms)
  };
}

// ---- summary -------------------------------------------------------------------
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const pct = x => Math.round(x * 100);
function summarise(cases) {
  const found = cases.filter(c => !c.noTrip);
  const shownTrips = cases.reduce((s, c) => s + c.shown, 0);
  const byBudget = {};
  for (const b of BUDGETS_CAD) {
    const g = cases.filter(c => c.budgetCad === b && c.adults === 1), f = g.filter(c => !c.noTrip);
    if (!g.length) continue;
    byBudget[b] = { searches: g.length, withTrip: f.length, bestUse: pct(mean(f.map(c => c.best.use))), bestCities: +mean(f.map(c => c.best.cities)).toFixed(1), bestNights: +mean(f.map(c => c.best.nights)).toFixed(1), oddBest: f.filter(c => c.best.quality.flags.length).length };
  }
  const flagCounts = {}; for (const c of cases) for (const f of c.oddFlags) flagCounts[f] = (flagCounts[f] || 0) + 1;
  return {
    searches: cases.length,
    // higher is better
    tripFoundRate: pct(found.length / cases.length),
    fullPageRate: pct(cases.filter(c => c.shown >= 3).length / cases.length),
    bestUse: pct(mean(found.map(c => c.best.use))),
    bestUseInBand: pct(found.filter(c => c.best.use >= 0.7 && c.best.use <= 1).length / Math.max(1, found.length)),
    variety: pct(mean(found.filter(c => c.citiesShown).map(c => c.distinctCitiesShown / c.citiesShown))),
    // lower is better
    oddBestRate: pct(found.filter(c => c.best.quality.flags.length).length / Math.max(1, found.length)),
    oddShownRate: pct(cases.reduce((s, c) => s + c.oddShown, 0) / Math.max(1, shownTrips)),
    liveFailureRate: pct(cases.reduce((s, c) => s + c.liveFailures, 0) / Math.max(1, cases.reduce((s, c) => s + c.checks, 0))),
    avgChecks: +mean(cases.map(c => c.checks)).toFixed(1),
    avgRounds: +mean(cases.map(c => c.rounds)).toFixed(2),
    slowPageRate: pct(cases.filter(c => c.rounds > 2).length / cases.length),
    avgMs: Math.round(mean(cases.map(c => c.ms))),
    flagCounts, byBudget
  };
}
const HIGHER = ['tripFoundRate', 'fullPageRate', 'bestUseInBand', 'variety'];
const LOWER = ['oddBestRate', 'oddShownRate', 'liveFailureRate', 'avgChecks', 'avgRounds', 'slowPageRate'];
const TOLERANCE = 2; // percentage points / checks treated as noise-free but rounding-safe

function compare(now, base) {
  const rows = [], worse = [];
  for (const k of [...HIGHER, ...LOWER, 'bestUse', 'avgMs']) {
    const a = base.summary[k], b = now.summary[k];
    if (a === undefined) { rows.push([k, '-', b, 'new']); continue; }
    let verdict = 'same';
    if (b !== a) verdict = (HIGHER.includes(k) ? b > a : LOWER.includes(k) ? b < a : null) === true ? 'better' : (HIGHER.includes(k) || LOWER.includes(k)) ? 'worse' : 'changed';
    if (verdict === 'worse' && Math.abs(b - a) > (k === 'avgChecks' ? 1 : k === 'avgRounds' ? 0.2 : TOLERANCE)) worse.push(k);
    rows.push([k, a, b, verdict]);
  }
  const changed = now.cases.filter(c => { const o = base.cases.find(x => x.id === c.id); return o && (o.best?.route || '-') !== (c.best?.route || '-'); }).map(c => { const o = base.cases.find(x => x.id === c.id); return `${c.id}: ${o.best?.route || 'no trip'} -> ${c.best?.route || 'no trip'}`; });
  return { rows, worse, changed };
}

function print(result, cmp) {
  const s = result.summary;
  const L = [];
  L.push(`GlobeVoy recommendation benchmark (${result.engine}, truth v${result.truthModel}) — ${s.searches} searches, settings ${JSON.stringify(result.env)}, memory ${result.memory ? 'on' : 'off'}, price index ${result.priceIndex ? 'on' : 'off'}`);
  L.push(`  trip found        ${s.tripFoundRate}%      full page (3 trips) ${s.fullPageRate}%`);
  L.push(`  best uses budget  ${s.bestUse}% avg   in 70-100% band ${s.bestUseInBand}%`);
  L.push(`  variety           ${s.variety}% different cities across shown trips`);
  L.push(`  odd routes        best pick ${s.oddBestRate}%   all shown ${s.oddShownRate}%   ${JSON.stringify(s.flagCounts)}`);
  L.push(`  live failures     ${s.liveFailureRate}% of checks   avg ${s.avgChecks} checks and ${s.avgRounds} rounds/search, ${s.slowPageRate}% need 3+ rounds   avg ${s.avgMs} ms`);
  L.push('  by budget (1 adult): ' + Object.entries(s.byBudget).map(([b, v]) => `C$${b}: ${v.withTrip}/${v.searches} found, use ${v.bestUse}%, ${v.bestCities} cities, ${v.bestNights} nights, odd best ${v.oddBest}`).join('\n                       '));
  const odd = result.cases.filter(c => c.best && c.best.quality.flags.length);
  if (odd.length) { L.push('  odd best picks:'); for (const c of odd) L.push(`    ${c.id.padEnd(16)} ${c.best.route}  [${c.best.quality.flags.join(', ')}; spread ${c.best.quality.spreadKm} km, longest leg ${c.best.quality.longLegHours} h]`); }
  const none = result.cases.filter(c => c.noTrip);
  if (none.length) L.push('  no trip: ' + none.map(c => c.id).join(', '));
  if (cmp) {
    L.push('  vs baseline:'); for (const [k, a, b, v] of cmp.rows) L.push(`    ${k.padEnd(16)} ${String(a).padStart(6)} -> ${String(b).padEnd(6)} ${v}`);
    if (cmp.changed.length) { L.push(`  best pick changed in ${cmp.changed.length} searches:`); for (const c of cmp.changed.slice(0, 20)) L.push('    ' + c); }
    L.push(cmp.worse.length ? `  WORSE: ${cmp.worse.join(', ')}` : '  no metric got worse');
  }
  console.log(L.join('\n'));
}

async function main() {
  const o = args();
  if (Number.isFinite(o.spare)) SPARE = o.spare;
  SIM.memory = o.noMemory ? null : simulatedMemory();
  SIM.priceIndex = o.priceIndex ? simulatedPriceIndex() : null;
  const list = o.quick ? QUICK : [...ORIGINS.flatMap(x => BUDGETS_CAD.map(b => [x, b, 1])), ...ORIGINS.slice(0, 4).map(x => [x, 4000, 2])];
  ORIGIN_CODES = [...new Set(list.map(([x]) => originInfo(x).code))];
  const cases = [];
  for (const [x, b, a] of list) cases.push(await runOne(x, b, a, o.env));
  const result = { engine: opt.VERSION, truthModel: 2, env: o.env, spare: SPARE, memory: !o.noMemory, priceIndex: !!o.priceIndex, quick: !!o.quick, limits: LIMITS, summary: summarise(cases), cases };
  // A saved baseline is a checked-in fixture; any other saved run is local output.
  const file = name => name === 'baseline' ? path.join(__dirname, 'fixtures', 'recommendation-baseline.json') : path.join(root, '.cache', 'benchmark', name + '.json');
  let cmp = null;
  if (o.compare) {
    const base = JSON.parse(fs.readFileSync(file(o.compare), 'utf8'));
    if (base.quick !== result.quick) throw new Error('baseline and this run use different search sets (--quick)');
    if ((base.truthModel || 1) !== result.truthModel) throw new Error('baseline uses an older truth model; re-save it first');
    cmp = compare(result, base);
  }
  if (o.json) console.log(JSON.stringify(result, null, 1)); else print(result, cmp);
  if (o.save) { const f = file(o.save); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(result, null, 1) + '\n'); console.log('saved ' + path.relative(root, f)); }
  if (cmp && cmp.worse.length) process.exitCode = 1;
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(2); });
module.exports = { quality, simulatePage, summarise, compare, LIMITS };
