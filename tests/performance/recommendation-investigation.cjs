#!/usr/bin/env node
'use strict';
// GV-RECS-INV-001: whole-pipeline investigation (offline, simulated fares and hotel truth).
//   node tests/performance/recommendation-investigation.cjs [--memory-file export.json] [--env K=V ...] [--json]
// Use --matrix for the study configurations and --cost-study for spare/cache comparisons.
// For each origin and budget it runs the real optimizer and reports what travellers would
// see signed out (1 trip, refreshed 3 times) and signed in (3 trips): budget use, nights,
// cities, countries, same-country trips, departure months, city repetition, what limits
// bigger trips, and search effort. --memory-file plans with the REAL hotel memory export
// (truth stays simulated, so failure rates are indicative; repetition/diversity are the point).
const path = require('path'), fs = require('fs');
const root = path.resolve(__dirname, '../..');
const opt = require(path.join(root, 'backend/services/domain/fare-map/fare-map-optimizer'));
const B = require('./recommendation-benchmark.cjs');
const { getGeneratedTour } = require('../../backend/services/domain/tours/generated-tour');
const { applyIgnavLiveFares } = require('../../backend/services/domain/live-fares/ignav-live-fares');
const ignav = require('../../backend/services/providers/flights/ignav/ignav');
const ignavCache = require('../../backend/services/domain/live-fares/ignav-fare-cache');
const { currencyToUsdRate } = require('../../backend/services/domain/pricing/budget-presentation');
const { applyTravellerPricingToTour } = require('../../backend/services/domain/pricing/traveller-pricing');

const ORIGINS = ['Toronto (YYZ)', 'Vancouver (YVR)', 'New York (JFK)', 'Los Angeles (LAX)', 'Mexico City (MEX)', 'London (LHR)', 'Paris (PAR)', 'Dubai (DXB)', 'Singapore (SIN)', 'Sydney (SYD)'];
const BUDGETS = [1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000];

function args() { const a = process.argv.slice(2), o = { env: {} }; for (let i = 0; i < a.length; i++) { if (a[i] === '--memory-file') o.memoryFile = a[++i]; else if (a[i] === '--fare-snapshot') o.fareSnapshot = a[++i]; else if (a[i] === '--env') { const [k, ...v] = a[++i].split('='); o.env[k] = v.join('='); } else if (a[i] === '--matrix') o.matrix = true; else if (a[i] === '--cost-study') o.costStudy = true; else if (a[i] === '--cost-release') o.costRelease = true; else if (a[i] === '--json') o.json = true; else if (a[i] === '--route-dates') o.routeDates = a[++i]; else if (a[i] === '--origins') o.origins = a[++i].split(','); else if (a[i] === '--budgets') o.budgets = a[++i].split(',').map(Number); } return o; }
function loadMemory(file) {
  const R = require('./hotel-memory-report.cjs');
  const { entries } = R.parse(fs.readFileSync(file, 'utf8'));
  return new Map(entries.map(e => [e.id, { ratio: Math.min(3, Math.max(0.6, e.ratio)), n: e.n, at: e.at }]));
}
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pct = x => Math.round(100 * x);

function describe(t, prices, totalBudgetUsd, source, origin) {
  const sourceLegs = source.legs || [];
  const returnEvidence = sourceLegs.at(-1)?.providerDateEvidence;
  return { role: t.tourRole, route: t.stops.map(s => s.city).join(' > '),
    cities: t.stops.map(s => s.cityId), countries: [...new Set(t.stops.map(s => s.countryCode))],
    legs: sourceLegs.map(l => ({ from: l.from.airportCode || l.from.code, to: l.to.airportCode || l.to.code, date: l.departureDate })),
    returnDate: returnEvidence?.dateEstimated ? 'estimated' : 'cached',
    mirroredReturn: !!source.fareMap?.mirroredReturn, nights: t.totalNights,
    stays: t.stops.map(s => ({ city: s.city, country: s.countryCode, nights: s.nights, arrival: s.arrivalDate, departure: s.departureDate })),
    planning: { flights: source.totalFlightEstimateUsd, hotels: source.totalHotelEstimateUsd },
    simulated: prices, enteredBudgetUse: (prices.flights + prices.hotels) / totalBudgetUsd,
    quality: B.quality(t, B.originInfo(origin)) };
}

// The production builder runs against mocked flight responses, hotel rates and storage.
// The real Ignav adapter still applies its task cap, cache key, pricing and evidence rules.
async function mockPage(query, options, want, { cold = true, seen = [], shared = new Map(), spare, stress = false } = {}) {
  const env = { ...options.env, ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline',
    ENABLE_NUITEE_LIVE_STAYS: 'true', NUITEE_SECRET_ID: 'offline', FARE_MAP_REQUIRE_LIVE: 'true',
    FARE_MAP_SHOW_ESTIMATES: 'false', FARE_MAP_OLD_ENGINE_FALLBACK: 'false', HOTEL_UPGRADE_POLICY: '' };
  if (spare != null) delete env.FARE_MAP_POOL_SPARE_STRATEGY;
  if (cold) ignavCache._internal.memory.clear();
  const memory = Object.fromEntries([...SIMMEM].flatMap(([id, e]) =>
    Object.entries({ r: e.ratio, n: e.n, t: e.at, q: e.q, c: e.c }).filter(([, value]) => Number.isFinite(value))
      .map(([prefix, value]) => [prefix + '_' + id, { N: String(value) }])));
  const dynamo = { async send(command) {
    const { Key, Item } = command.input;
    if (Key?.pk?.S === 'MEM#hotel') return { Item: memory };
    if (Key?.pk?.S === 'LIVE#ignav') return { Item: shared.get(Key.sk.S) };
    if (Item?.pk?.S === 'LIVE#ignav') { shared.set(Item.sk.S, Item); return {}; }
    if (Item?.pk?.S === 'MEM#hotel') return {};
    throw Error('Unexpected offline storage operation');
  } };
  const sources = new Map(), keys = [], attempts = [], guardRejections = [];
  const started = performance.now();
  let candidates = 0;
  const requestGuard = ignav._internal.createGuard(Date.now, { perMinute: 500, perHour: 500 });
  let hotelRequests = 0;
  const hotelKeys = new Set();
  const result = await getGeneratedTour({ ...query, pool: '1', poolShow: want, poolSpare: spare, seenRoutes: seen }, {
    env, dynamo, fareMap: { ...options, env, dynamo, fresh: true, traceSearch: false, clock: () => options.now },
    onFareMapRejection: r => guardRejections.push({ reason: r.reason, guards: r.guardReasons, dateConsistent: r.dateConsistent }),
    async applyIgnavLiveFares(t, q) {
      sources.set(B.routeKey(t), t);
      const index = candidates++;
      if (stress) await new Promise(resolve => setTimeout(resolve, index === 0 ? 24 : 8 + index % 3 * 5));
      const simulatedFlights = B.simulatedPrices(t).flights;
      const factor = simulatedFlights / t.totalFlightEstimateUsd;
      const priced = await applyIgnavLiveFares(t, q, { env, dynamo, fareCache: true, requestGuard,
        async fetchFn(_url, request) {
          const body = JSON.parse(request.body);
          const key = ignavCache._internal.keyFor({ ...body, departureDate: body.departure_date, currency: q.currency });
          keys.push(key);
          if (stress && index === 0 && body.departure_date === t.legs[0].departureDate) {
            return { ok: true, status: 200, text: async () => JSON.stringify({ observed_at: new Date().toISOString(), itineraries: [] }) };
          }
          const leg = t.legs.find(l => l.departureDate === body.departure_date);
          if (!leg) throw Error('Unexpected offline flight date');
          const arrival = opt._internal.plus(body.departure_date, leg.distanceKm >= 5500 ? 1 : 0);
          const amount = leg.estimatedTransportUsd * factor / currencyToUsdRate(q.currency);
          const fare = { ignav_id: 'offline-' + keys.length, price: { amount, currency: q.currency, status: 'verified' },
            outbound: { segments: [{ departure: { airport: body.origin, local_time: body.departure_date + 'T09:00:00' },
              arrival: { airport: body.destination, local_time: arrival + 'T15:00:00' } }] } };
          return { ok: true, status: 200, text: async () => JSON.stringify({ observed_at: new Date().toISOString(), itineraries: [fare] }) };
        } });
      attempts.push({ route: B.routeKey(t), reason: priced.summary.reason || null, flights: priced.summary.requiredFlightLegCount || 0 });
      return priced;
    },
    async applyNuiteeLiveStays(t, q, hotelOptions) {
      if (stress) await new Promise(resolve => setTimeout(resolve, 9));
      const stops = t.stops.map(s => {
        const key = [s.cityId, s.arrivalDate, s.departureDate, q.adults, q.rooms, q.currency].join('|');
        if (!hotelKeys.has(key)) { hotelKeys.add(key); hotelRequests++; }
        const usd = Math.round(s.hotel.estimatedStayUsd * B.hotelTruth(s) * (hotelOptions.hotelChoice === 'cheapest' ? 0.8 : 1));
        return { ...s, hotel: { ...s.hotel, pricingIntegrity: { ...s.hotel.pricingIntegrity, nightlyPerRoomUsd: usd / s.nights },
          nuiteeLiveRate: { amount: usd, totalUsd: usd, currency: 'USD' } } };
      });
      return { tour: applyTravellerPricingToTour({ ...t, stops }, q),
        summary: { applied: true, appliedCount: stops.length, stopCount: stops.length } };
    }
  });
  const shown = result.tours.map(t => describe(t, { flights: t.totalFlightEstimateUsd, hotels: t.totalHotelEstimateUsd },
    t.totalBudgetUsd, sources.get(B.routeKey(t)) || t, query.origin));
  return { shown, checks: result.diagnostics?.poolChecks ?? 0, rounds: result.diagnostics?.poolRounds ?? 0,
    ignavRequests: keys.length, ignavCacheHits: result.diagnostics?.ignavCacheHits ?? 0, hotelRequests,
    duplicateIgnavRequests: keys.length - new Set(keys).size, attempts, outcomes: result.diagnostics?.fareMapLiveAttempts || [],
    shownKeys: result.poolShownRoutes || [], spareUnused: result.diagnostics?.poolSpareUnused ?? 0,
    arrivalRiskReordered: result.diagnostics?.guestArrivalRiskReordered === true,
    sparesStarted: result.diagnostics?.poolSparesStarted ?? 0, usage: result.diagnostics?.ignavUsage || {}, guardRejections,
    verificationLatencyMs: result.diagnostics?.verificationLatencyMs ?? 0, pageLatencyMs: Math.round(performance.now() - started) };
}

async function runOne(origin, budgetCad, env, costStudy, stress = false) {
  const missing = new Set(), truncated = new Set();
  const query = { origin, budget: budgetCad, currency: 'CAD', adults: 1 };
  const options = { env: { ENABLE_FARE_MAP_OPTIMIZER: 'true', FARE_MAP_TABLE: 'benchmark', ...env },
    now: SNAP?.takenAt ?? B.NOW, readRoutes: READER ? READER(missing, truncated) : B.fareReader(), hotelRatios: SIMMEM, allowCityExpansion: true, ...(ROUTE_DATES ? { routeDates: (a, h) => ROUTE_DATES.get(a + '>' + h) || [] } : {}) };
  const r = await opt.search(query, { ...options, traceSearch: true });
  const pool = r.pool || [], spendable = budgetCad / B.CAD_PER_USD * 0.9;
  // live check in pool order; a page shows the first passing trips (signed out 1, signed in 3)
  const checked = pool.map(t => ({ t, live: B.liveTotalUsd(t) })).filter(x => x.live <= spendable);
  const trip = x => {
    const st = x.t.stops || [];
    const countries = new Set(st.map(s => s.countryCode || s.country)).size;
    const home = String(x.t.origin?.countryCode || '').toUpperCase(), legs = x.t.legs || [];
    const extra = { originCountry: home, stopCountries: st.map(s => String(s.countryCode || '').toUpperCase()), stopNights: st.map(s => s.nights),
      discovered: st.map(s => String(s.cityId).startsWith('discovered-')),
      goodHotels: st.map(s => { const a = opt._internal.cityAccommodation({ cityCode: s.code, unifiedRegistry: { origin: { providerLocationCode: s.code } } }); return a ? a.good3to4Stars : null; }),
      hotelRating: st.map(s => { const a = opt._internal.cityAccommodation({ cityCode: s.code, unifiedRegistry: { origin: { providerLocationCode: s.code } } }); return a ? a.medianRating : null; }),
      comfort: x.t.hotelTier === 'comfort', estimatedLegs: legs.filter(l => l.providerDateEvidence?.dateEstimated).length, legCount: legs.length };
    return { ...extra, route: st.map(s => s.city).join(' > '), cities: st.map(s => s.cityId), countries, cityCount: st.length, sameCountry: st.length > 1 && countries === 1,
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
  const signedOut = await mockPage(query, options, 1, { stress });
  const signedIn = await mockPage(query, options, 3, { stress });
  let cost;
  if (costStudy) {
    const shared = new Map();
    cost = { noSpares: await mockPage(query, options, 3, { spare: 0 }),
      oneSpare: await mockPage(query, options, 3, { spare: 1 }),
      sharedCold: await mockPage(query, options, 3, { shared }),
      sharedRepeat: await mockPage(query, options, 3, { shared }),
      sharedRefresh: await mockPage(query, options, 3, { shared, seen: signedIn.shownKeys }) };
  }
  return { origin, budgetCad, poolSize: pool.length, passed: checked.length, guest, member, cost,
    coverage: { complete: !missing.size && !truncated.size, missing: [...missing], truncated: [...truncated] },
    verified: { signedOut, signedIn }, d: r.diagnostics || {} };
}
let SIMMEM = null, SNAP = null;
// --fare-snapshot: replay REAL cached fares (ops/fare-map/replay-snapshot.mjs); a partition
// missing from the snapshot reads as empty. Live truth for hotels stays simulated.
function snapshotReader(file) {
  const body = JSON.parse(require('zlib').gunzipSync(fs.readFileSync(file)).toString('utf8'));
  SNAP = { origins: body.origins, takenAt: Date.parse(body.takenAt), missing: 0, keys: new Set(), coverage: body.coverage || null, memorySha: body.memory?.sha256 || null };
  const capped = new Set(body.coverage?.truncated || []);
  return (missing, truncated) => async (o, m) => {
    const key = o + '|' + m, value = body.partitions[key];
    if (!value) { SNAP.missing++; SNAP.keys.add(key); missing.add(key); }
    if (capped.has(key)) truncated.add(key);
    return value || [];
  };
}
let READER = null;
// --route-dates: real departure dates per route (Travelpayouts month-matrix, collected
// read-only for the return legs this benchmark needs); { "A>H@YYYY-MM": [[date, usd, stops, foundAt]] }.
let ROUTE_DATES = null;
function loadRouteDates(file) {
  const body = JSON.parse(require('zlib').gunzipSync(fs.readFileSync(file)).toString('utf8')), m = new Map();
  for (const [k, v] of Object.entries(body)) { const key = k.split('@')[0]; const list = m.get(key) || []; for (const [d, p, st] of v) list.push({ departureDate: d, priceUsd: Number(p), stops: st == null ? null : Number(st) }); m.set(key, list); }
  return m;
}

function summarise(cases) {
  const by = b => cases.filter(c => c.budgetCad === b);
  const rows = {};
  for (const b of BUDGETS_USED) {
    const g = by(b), firsts = g.map(c => c.guest[0]).filter(Boolean), members = g.flatMap(c => c.member);
    const months = {}; for (const c of g) for (const t of c.guest) months[t.month] = (months[t.month] || 0) + 1;
    rows[b] = {
      searches: g.length, withTrip: firsts.length,
      incomplete: g.filter(c => !c.coverage.complete).length,
      verifiedGuestUse: pct(mean(g.flatMap(c => c.verified.signedOut.shown.map(t => t.enteredBudgetUse)))),
      verifiedMemberBestUse: pct(mean(g.flatMap(c => c.verified.signedIn.shown.filter(t => t.role === 'best-balance').map(t => t.enteredBudgetUse)))),
      guestIgnav: mean(g.map(c => c.verified.signedOut.ignavRequests)),
      memberIgnav: mean(g.map(c => c.verified.signedIn.ignavRequests)),
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

async function main() {
  process.env.ENABLE_GENERATED_TOUR_651A = 'true';
  global.fetch = async () => { throw Error('Offline recommendation investigation requires injected responses'); };
  const o = args();
  if (o.fareSnapshot) READER = snapshotReader(o.fareSnapshot);
  if (o.routeDates) ROUTE_DATES = loadRouteDates(o.routeDates);
  const origins = o.origins || SNAP?.origins || ORIGINS; BUDGETS_USED = o.budgets || BUDGETS;
  B.setOriginCodes(origins.map(x => B.originInfo(x).code));
  SIMMEM = o.memoryFile ? loadMemory(o.memoryFile) : B.simulatedMemory();
  if (o.costRelease) {
    const recommended = { FARE_MAP_READ_PLAN: 'on', FARE_MAP_BALANCED_POOL: 'on' };
    const scenarios = [
      ['baseline', { IGNAV_FARE_COALESCE: 'off' }, false],
      ['recommended', { ...recommended, IGNAV_FARE_COALESCE: 'off' }, false],
      ['guest-risk-only', { ...recommended, FARE_MAP_GUEST_ARRIVAL_RISK: 'on' }, false],
      ['cost-optimized', { ...recommended, FARE_MAP_GUEST_ARRIVAL_RISK: 'on', FARE_MAP_POOL_SPARE_STRATEGY: 'adaptive' }, false],
      ...['0','1','2','adaptive'].map(mode => ['stress-' + mode, { ...recommended, FARE_MAP_POOL_SPARE_STRATEGY: mode }, true])
    ];
    const experiments = {};
    for (const [name, env, stress] of scenarios) {
      const cases = [];
      for (const origin of origins) for (const budget of BUDGETS_USED) {
        cases.push(await runOne(origin, budget, { ...env, ...o.env }, o.costStudy, stress));
      }
      experiments[name] = { env, stress, cases, summary: summarise(cases) };
    }
    console.log(JSON.stringify({ input: SNAP ? 'cached-fare-snapshot' : 'synthetic-fares', experiments }));
    return;
  }
  if (o.matrix) {
    const { VARIANTS } = await import('../../ops/fare-map/replay-snapshot.mjs');
    const experiments = {};
    for (const { name, env } of [...VARIANTS, ...extraVariants()]) {
      const cases = [];
      for (const x of origins) for (const b of BUDGETS_USED) cases.push(await runOne(x, b, { ...env, ...o.env }, o.costStudy));
      experiments[name] = { env: { ...env, ...o.env }, summary: summarise(cases), cases };
    }
    console.log(JSON.stringify({ input: SNAP ? 'cached-fare-snapshot' : 'synthetic-fares', experiments }));
    return;
  }
  const cases = [];
  for (const x of origins) for (const b of BUDGETS_USED) cases.push(await runOne(x, b, o.env, o.costStudy));
  const s = summarise(cases);
  if (o.json) { console.log(JSON.stringify({ input: SNAP ? 'cached-fare-snapshot' : 'synthetic-fares', env: o.env, memory: o.memoryFile ? 'real export' : 'simulated', summary: s, cases }, null, 1)); return; }
  console.log(`Investigation: ${origins.length} origins x ${BUDGETS_USED.length} budgets, memory ${o.memoryFile ? 'REAL export' : 'simulated clean'}, settings ${JSON.stringify(o.env)}`);
  console.log('budget  found  legacy-first  nights  cities  3-city  maxNightsHit  multiCountry(2+ city trips)  sameCountry(shown)  refresh: months/repeatCity  topMonth');
  for (const [b, r] of Object.entries(s.byBudget)) console.log(`C$${String(b).padEnd(6)} ${String(r.withTrip + '/' + r.searches).padEnd(6)} ${String(r.bestUse + '%').padEnd(8)} ${String(r.bestNights).padEnd(7)} ${String(r.bestCities).padEnd(7)} ${String(r.threeCityBest + '%').padEnd(7)} ${String(r.maxNightsHitBest + '%').padEnd(13)} ${String(r.multiCountry + '%').padEnd(28)} ${String(r.sameCountryShown + '%').padEnd(19)} ${r.refreshDistinctMonths}/${r.refreshRepeatCity}%   ${r.topMonth}`);
  console.log('budget  mock guest/member best-use  mock Ignav guest/member  incomplete');
  for (const [b, r] of Object.entries(s.byBudget)) console.log(`C$${b}  ${r.verifiedGuestUse}%/${r.verifiedMemberBestUse}%  ${r.guestIgnav}/${r.memberIgnav}  ${r.incomplete}`);
  console.log('Most repeated cities (share of guest trips):', s.topCitiesInGuestTrips.join(', '));
  console.log('Effort:', JSON.stringify(s.effort));
  if (SNAP) { console.log(`Fare snapshot from ${new Date(SNAP.takenAt).toISOString()}; partitions missing during replay: ${SNAP.keys.size} distinct (${SNAP.missing} reads)`); if (SNAP.keys.size) console.log('WARNING: this setting asked for partitions the snapshot lacks (read as empty); compare it with the baseline only after re-collecting:', [...SNAP.keys].slice(0, 10).join(', ')); if (SNAP.memorySha && o.memoryFile) { const h = require('crypto').createHash('sha256').update(fs.readFileSync(o.memoryFile, 'utf8')).digest('hex'); if (h !== SNAP.memorySha) console.log('WARNING: --memory-file differs from the memory used to collect the snapshot.'); } }
}
function extraVariants() {
  const reads = { FARE_MAP_READ_PLAN: 'on' };
  const four = { ...reads, FARE_MAP_HUGE_MAX_CITIES: '4' };
  const variants = { FARE_MAP_ROUTE_VARIANTS: 'on' };
  const balanced = { FARE_MAP_BALANCED_POOL: 'on' };
  const live = { FARE_MAP_FOUR_CITY_LIVE: 'on' };
  return Object.entries({
    'read-plan-only': reads,
    'refresh-rotation': { FARE_MAP_REFRESH_ROTATION: 'on' },
    'route-variants': variants,
    'balanced-pool': balanced,
    'four-city-live': live,
    'read-plan-variants': { ...reads, ...variants },
    'read-plan-balanced': { ...reads, ...balanced },
    'read-plan-3-combined': { ...reads, ...variants, ...balanced },
    'read-plan-4-stay': { ...four, FARE_MAP_BIG_STAY_EXTRA: '8' },
    'read-plan-4-target': { ...four, FARE_MAP_BEAM_TARGET: 'on' },
    'read-plan-4-live': { ...four, ...live },
    'read-plan-4-balanced-live': { ...four, ...balanced, ...live },
    'read-plan-4-combined': { ...four, ...variants, ...balanced, ...live }
  }).map(([name, env]) => ({ name, env }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
