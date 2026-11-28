'use strict';
// GV-RECS-V2 overnight switches (Nov 28, 2026), all off by default:
//   FARE_MAP_LEG_DATES (on | fallback), FARE_MAP_BEST_USE_TOPUP, FARE_MAP_LUXURY_TIERS,
//   FARE_MAP_DOMESTIC_LAST, FARE_MAP_VISITOR_VARIETY, FARE_MAP_MULTI_CITY_HINT.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { fixture } = require('./fare-map-fixtures.cjs');
const { plus, buildPool } = optimizer._internal;

const SRC = fs.readFileSync(require.resolve('../../backend/services/domain/fare-map/fare-map-optimizer'), 'utf8');
const TOUR_SRC = fs.readFileSync(require.resolve('../../backend/services/domain/tours/generated-tour'), 'utf8');
const flexible = f => { const q = { ...f.query }; delete q.destinationCount; delete q.nights; return q; };
const search = (f, query, options = {}) => optimizer.search(query, { ...f.options, rows: f.rows, ...options });
const key = t => t.stops.map(s => s.cityId).join('>');
const withEnv = (f, env) => ({ ...f.options.env, ...env });

test('every overnight switch is off unless set to "on"', () => {
  for (const name of ['FARE_MAP_LEG_DATES', 'FARE_MAP_LUXURY_TIERS', 'FARE_MAP_DOMESTIC_LAST', 'FARE_MAP_VISITOR_VARIETY', 'FARE_MAP_MULTI_CITY_HINT'])
    assert.match(SRC, new RegExp(name + "\\|\\|''\\)\\.trim\\(\\)\\.toLowerCase\\(\\)==='on'"), name);
  assert.match(TOUR_SRC, /FARE_MAP_BEST_USE_TOPUP\|\|''\)\.trim\(\)\.toLowerCase\(\)==='on'/);
  assert.match(TOUR_SRC, /FARE_MAP_LUXURY_TIERS\|\|''\)\.trim\(\)\.toLowerCase\(\)==='on'/);
});

test('switches off reproduce the search exactly; "off" equals unset', async () => {
  const f = fixture(), q = flexible(f);
  const base = await search(f, q);
  const off = await search(f, q, { env: withEnv(f, { FARE_MAP_LEG_DATES: 'off', FARE_MAP_VISITOR_VARIETY: 'off', FARE_MAP_DOMESTIC_LAST: 'off' }) });
  assert.deepEqual(off.pool.map(key), base.pool.map(key));
  assert.deepEqual(off.tours.map(key), base.tours.map(key));
  assert.ok(base.pool.every(t => t.poolPropensity === undefined));
});

test('leg dates: daily dates are read for onward legs only when switched on, within the cap', async () => {
  const f = fixture(), q = flexible(f), calls = [];
  const legDates = async (a, b) => { calls.push(a + '>' + b); return [{ departureDate: '2027-03-03', priceUsd: 20, stops: 0 }, { departureDate: '2027-03-04', priceUsd: 25, stops: 0 }]; };
  await search(f, q, { legDates });
  assert.equal(calls.length, 0, 'off: no reads');
  const on = await search(f, q, { legDates, env: withEnv(f, { FARE_MAP_LEG_DATES: 'on', FARE_MAP_LEG_DATE_READS: '10' }) });
  assert.ok(calls.length > 0 && calls.length <= 10, String(calls.length));
  assert.equal(on.diagnostics.legDateReads, calls.length);
  assert.ok(on.diagnostics.legDateOptions > 0);
  // The new options obey the same stay limits: every stop still has at least 2 nights.
  for (const t of on.pool) for (const s of t.stops) assert.ok(s.nights >= 2, key(t));
});

test('visitor variety: seeded, reproducible, logs propensity, keeps the best trips', async () => {
  const f = fixture(), q = flexible(f), env = withEnv(f, { FARE_MAP_EXPERIENCE: 'on', FARE_MAP_VISITOR_VARIETY: 'on' });
  const a = await search(f, { ...q, varietySeed: 'visitor-1' }, { env }), b = await search(f, { ...q, varietySeed: 'visitor-1' }, { env });
  assert.deepEqual(a.pool.map(key), b.pool.map(key), 'same seed, same pool');
  assert.ok(a.pool.every(t => t.poolPropensity > 0 && t.poolPropensity <= 1));
  const base = await search(f, q, { env: withEnv(f, { FARE_MAP_EXPERIENCE: 'on' }) });
  const top = Math.max(...base.pool.map(t => t.poolScore));
  const firsts = new Set();
  for (let i = 0; i < 12; i++) {
    const r = await search(f, { ...q, varietySeed: 'v' + i }, { env });
    firsts.add(key(r.pool[0]));
    assert.ok(r.pool[0].poolScore >= top - 0.03 - 1e-9, 'first pick is near the best: ' + r.pool[0].poolScore + ' vs ' + top);
  }
  assert.ok(firsts.size >= 1);
});

test('domestic last: trips touching the home country move behind 3+ trips abroad', () => {
  {
    const row = (c, cc, lat) => ({ countryCode: cc, unifiedRegistry: { origin: { providerLocationCode: c }, cityId: c.toLowerCase(), countryCode: cc, latitude: lat, longitude: lat, destination: { regionCluster: 'southern-europe' } } });
    const st = (cs, cost, d) => ({ cities: cs.map(([c, cc], i) => row(c, cc, 40 + i + cost / 1000)), cost, key: cs.map(x => x[0]).join('>'), estimatedDate: false, edges: [{ departureDate: d }], tour: { totalNights: 8, stops: cs.map(([c, cc]) => ({ cityId: c, countryCode: cc })), legs: [{ departureDate: d }] } });
    const ranked = [st([['YHZ', 'CA'], ['YOW', 'CA']], 500, '2027-03-01'), st([['LIS', 'PT'], ['MAD', 'ES']], 900, '2027-03-02'), st([['ROM', 'IT'], ['ATH', 'GR']], 920, '2027-04-03'), st([['PRG', 'CZ'], ['VIE', 'AT']], 880, '2027-05-04'), st([['BCN', 'ES'], ['SVQ', 'ES']], 870, '2027-06-05')];
    const pool = buildPool(ranked, 1000, { env: { FARE_MAP_ROLE_RULES: 'on', FARE_MAP_DOMESTIC_LAST: 'on' }, originCC: 'CA', abroadFirst: true, multiCountry: true });
    const plain = buildPool(ranked, 1000, { env: { FARE_MAP_ROLE_RULES: 'on' }, originCC: 'CA', abroadFirst: true, multiCountry: true });
    assert.ok(plain.findIndex(t => t.stops.some(s => s.countryCode === 'CA')) < plain.length - 1, 'without the switch the home trip keeps its place');
    const home = t => t.stops.some(s => s.countryCode === 'CA');
    const firstHome = pool.findIndex(home);
    assert.ok(firstHome === -1 || pool.slice(firstHome).every(home), 'home trips are last: ' + pool.map(key).join(' | '));
    const same = pool.findIndex(t => key(t) === 'BCN>SVQ');
    assert.ok(same > pool.findIndex(t => key(t) === 'LIS>MAD') && same > pool.findIndex(t => key(t) === 'PRG>VIE'), 'same-country pair after multi-country trips');
  }
});

test('luxury tiers: only with the switch, only for very large budgets, only in cities with deep supply', () => {
  assert.match(SRC, /comfort\.lux\?\[\.25,\.5,1,1\.5,2,2\.5\]/);
  assert.match(SRC, /x>=1\.5\?2\.5:x/);
  assert.match(SRC, /LUX_FROM_USD=9000/);
});

// Live page with hotels that can be upgraded when the caller gives a hotel budget.
const liveFlights = async t => { const tour = structuredClone(t); tour.legs.forEach(l => { l.liveFareVerified = true; l.providerDateEvidence = { ...l.providerDateEvidence, provider: 'ignav', sourceType: 'LIVE', productionEligible: true, segments: [{ arriveLocal: plus(l.departureDate, 0) + 'T15:00:00' }] }; }); return { tour, summary: { applied: true, providerRequests: tour.legs.length } }; };
function upgradableHotels(seen) {
  return async (t, q, o) => {
    const tour = structuredClone(t), cap = Number(o.hotelBudgetUsd);
    seen.push({ cap: Number.isFinite(cap) ? cap : null, policy: o.upgradePolicy || null });
    let left = Number.isFinite(cap) ? cap - tour.stops.reduce((n, st) => n + (Number(st.hotel?.estimatedStayUsd) || 100), 0) : 0;
    for (const st of tour.stops) {
      const base = Number(st.hotel?.estimatedStayUsd) || 100, pct = o.upgradePolicy ? Number(o.upgradePolicy.perStayPct) : 0;
      const extra = left > 0 ? Math.min(left, Math.round(base * pct)) : 0; left -= extra;
      st.hotel = { ...st.hotel, estimatedStayUsd: base + extra, pricingIntegrity: { ...(st.hotel?.pricingIntegrity || {}), nightlyPerRoomUsd: (base + extra) / st.nights }, nuiteeLiveRate: { amount: base + extra, currency: 'USD', totalUsd: base + extra }, ...(extra ? { budgetUpgrade: { extraUsd: extra } } : {}) };
    }
    return { tour: require('../../backend/services/domain/pricing/traveller-pricing').applyTravellerPricingToTour(tour, q), summary: { applied: true, appliedCount: tour.stops.length, stopCount: tour.stops.length } };
  };
}
async function poolPage(f, env, want, hotels) {
  const old = process.env.ENABLE_GENERATED_TOUR_651A; process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  try {
    return await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour({ ...flexible(f), pool: '1', poolShow: want },
      { env: { ...f.options.env, FARE_MAP_REQUIRE_LIVE: 'true', ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline', ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'offline-reference', ...env }, fareMap: { ...f.options, rows: f.rows }, applyIgnavLiveFares: liveFlights, applyNuiteeLiveStays: hotels });
  } finally { if (old === undefined) delete process.env.ENABLE_GENERATED_TOUR_651A; else process.env.ENABLE_GENERATED_TOUR_651A = old; }
}

test('Best Use top-up: only with the switch; raises Best Use within the spendable budget; Lowest Cost untouched', async () => {
  const f = fixture();
  const seenOff = [], off = await poolPage(f, {}, 3, upgradableHotels(seenOff));
  assert.ok(!off.diagnostics?.bestUseTopUp);
  assert.ok(!seenOff.some(c => c.policy?.role === 'best-balance' && c.policy.minGain === 0.5 && c.cap != null), 'off: no top-up pricing pass');
  const seen = [], on = await poolPage(f, { FARE_MAP_BEST_USE_TOPUP: 'on' }, 3, upgradableHotels(seen));
  const best = t => t.tours.find(x => x.tourRole === 'best-balance');
  const useOf = t => t.estimatedTotalUsd / t.usableTripBudgetUsd;
  assert.ok(on.diagnostics.bestUseTopUp, 'top-up ran');
  assert.ok(useOf(best(on)) > useOf(best(off)), useOf(best(on)) + ' vs ' + useOf(best(off)));
  assert.ok(best(on).estimatedTotalUsd <= best(on).usableTripBudgetUsd, 'never past spendable');
  const policy = seen.find(c => c.policy?.role === 'best-balance');
  assert.ok(policy && policy.policy.minGain === 0.5 && policy.policy.perStayPct === 1.5, JSON.stringify(policy));
  const low = t => t.tours.find(x => x.tourRole === 'lowest-cost');
  if (low(on) && low(off)) assert.equal(low(on).estimatedTotalUsd, low(off).estimatedTotalUsd, 'Lowest Cost not upgraded');
  // Guests (one trip) get the same Best Use top-up.
  const guest = await poolPage(f, { FARE_MAP_BEST_USE_TOPUP: 'on' }, 1, upgradableHotels([]));
  assert.equal(guest.tours.length, 1);
  assert.equal(guest.tours[0].tourRole, 'best-balance');
  assert.ok(guest.diagnostics.bestUseTopUp);
});

test('multi-city hint: strict search with no 2-city trip says what a 2-city trip needs', async () => {
  const f = fixture(), q = { ...flexible(f), budget: 2000, currency: 'USD' };
  const env = withEnv(f, { FARE_MAP_STRICT_MULTI_CITY: 'on', FARE_MAP_MULTI_CITY_HINT: 'on', FARE_MAP_MAX_CITIES: '2' });
  // Make every onward flight expensive so only single-city trips fit.
  const readRoutes = async (o, m) => (f.map.get(o + '#' + m) || []).map(r => (r.origin !== f.originCode && r.destination !== f.originCode) ? { ...r, priceUsd: 1000 } : r);
  const r = await search(f, q, { env, readRoutes });
  assert.equal(r.pool.length, 0);
  assert.ok(r.requested.suggestedMultiCityBudgetUsd > 2000, String(r.requested.suggestedMultiCityBudgetUsd));
  const quiet = await search(f, q, { env: withEnv(f, { FARE_MAP_STRICT_MULTI_CITY: 'on', FARE_MAP_MAX_CITIES: '2' }), readRoutes });
  assert.equal(quiet.requested.suggestedMultiCityBudgetUsd, undefined, 'off: no hint');
});

test('leg dates fallback: runs again with daily dates only when no multi-city trip was built', async () => {
  const f = fixture(), q = flexible(f), calls = [];
  const legDates = async (a, b) => { calls.push(a + '>' + b); return [{ departureDate: '2027-03-03', priceUsd: 20, stops: 0 }]; };
  const env = withEnv(f, { FARE_MAP_LEG_DATES: 'fallback' });
  const fine = await search(f, q, { legDates, env });
  assert.ok(fine.pool.some(t => t.stops.length >= 2));
  assert.equal(fine.diagnostics.legDateFallback, undefined, 'multi-city trips found: no second pass');
  assert.equal(calls.length, 0);
  // Monthly onward dates that never fit a stay: the first pass builds no 2-city trip.
  const readRoutes = async (o, m) => (f.map.get(o + '#' + m) || []).map(r => (r.origin !== f.originCode && r.destination !== f.originCode) ? { ...r, departureDate: '2027-03-30' } : r);
  const retry = await search(f, { ...q, budget: 3000 }, { legDates, env, readRoutes });
  assert.equal(retry.diagnostics.legDateFallback, true);
  assert.ok(calls.length > 0);
});
