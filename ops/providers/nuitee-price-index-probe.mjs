#!/usr/bin/env node
// GV-PRICE-INDEX-001 / V2 task 5: the first Nuitee Price Index PRODUCTION test.
// Run on your own computer. Nothing is deployed and nothing is stored.
//
// Maximum cost: 3 requests x US$0.02 = US$0.06, retries INCLUDED. Two independent caps:
//   - this script stops after 3 requests;
//   - the shared monthly counter in DynamoDB (pk PI#budget, sk <YYYY-MM>, table
//     globevoy-fare-map) is capped at 3 for this run, so a second run in the same
//     month cannot spend more than what is left of those 3.
// The counter item is the only thing this writes to AWS. Storage of prices stays OFF.
//
// Plan (Barcelona, the city of the sandbox experiment, rolling six months):
//   0. FREE: hotel list from Nuitee's static data with the SANDBOX key, then a
//      representative sample of 50 hotels (affordable to 5-star).
//   1. prices/hotels for those 50 hotels           (US$0.02)
//   2. prices/city for Barcelona                     (US$0.02)
//   3. kept for ONE retry if 1 or 2 is rate-limited or times out (US$0.02), else unused.
//
// Setup (PowerShell, from the repo on main):
//   npm i --no-save @aws-sdk/client-dynamodb@3.922.0
//   $env:AWS_REGION="us-east-2"; $env:FARE_MAP_TABLE="globevoy-fare-map"     # your normal AWS login
//   $env:NUITEE_SANDBOX_KEY = [System.Net.NetworkCredential]::new("", (Read-Host "Nuitee sandbox key" -AsSecureString)).Password
//   $env:NUITEE_PROD_KEY    = [System.Net.NetworkCredential]::new("", (Read-Host "Nuitee production key" -AsSecureString)).Password
//   node ops/providers/nuitee-price-index-probe.mjs            # dry run: shows the plan, sends nothing
//   node ops/providers/nuitee-price-index-probe.mjs --run      # the real test (after approval)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const client = require('../../backend/services/providers/stays/nuitee/nuitee-price-index.js');
const budgetLib = require('../../backend/services/domain/pricing/hotel-price-index/budget.js');
const summary = require('../../backend/services/domain/pricing/hotel-price-index/summary.js');
const analysis = require('../../backend/services/domain/pricing/hotel-price-index/analysis.js');
const { sampleHotels, bandOf } = require('../../backend/services/domain/pricing/hotel-price-index/hotel-sample.js');

const MAX_REQUESTS = 3, PRICE = budgetLib.PRICE_PER_REQUEST_USD;
const CITY = { countryCode: 'ES', cityName: 'Barcelona', cityId: 'barcelona-es' };
const run = process.argv.includes('--run');
const window = client.horizon(null, null, Date.now());

console.log(`Nuitee Price Index production test: ${CITY.cityName}, ${window.fromDate} to ${window.toDate} (rolling six months)`);
console.log(`Maximum: ${MAX_REQUESTS} requests = US$${(MAX_REQUESTS * PRICE).toFixed(2)}, retries included. Storage: OFF.`);
if (!run) {
  console.log('\nDRY RUN (nothing sent). With --run it will:');
  console.log('  0. FREE  sandbox key: hotel list for Barcelona -> representative sample of 50 hotels');
  console.log('  1. $0.02 prices/hotels for the 50 hotels');
  console.log('  2. $0.02 prices/city for Barcelona');
  console.log('  3. $0.02 only if 1 or 2 needs ONE retry (rate limit or timeout), else unused');
  console.log('  Shared counter: globevoy-fare-map PI#budget/<month>, capped at 3 for this run.');
  process.exit(0);
}

const env = process.env;
for (const k of ['NUITEE_SANDBOX_KEY', 'NUITEE_PROD_KEY', 'FARE_MAP_TABLE']) if (!env[k]) { console.error(`Missing ${k}. See the setup lines at the top of this file.`); process.exit(2); }
if (!env.NUITEE_SANDBOX_KEY.startsWith('sand')) { console.error('NUITEE_SANDBOX_KEY is not a sandbox key.'); process.exit(2); }
if (!env.NUITEE_PROD_KEY.startsWith('prod_')) { console.error('NUITEE_PROD_KEY is not a production key (prod_...).'); process.exit(2); }

// Both caps: this script's own 3, and the shared monthly counter capped at 3.
const local = budgetLib.memoryBudget(MAX_REQUESTS);
const shared = budgetLib.dynamoBudget({ env: { ...env, PRICE_INDEX_MONTHLY_REQUEST_CAP: String(MAX_REQUESTS) } });
const before = await shared.used();
if (before == null) { console.error('Cannot read the shared counter (AWS login / FARE_MAP_TABLE / SDK). Nothing sent.'); process.exit(2); }
console.log(`Shared counter this month before the test: ${before} of ${MAX_REQUESTS}`);
const budget = { kind: 'probe', cap: MAX_REQUESTS, async reserve(p) { const a = await local.reserve(p); if (!a.ok) return a; const b = await shared.reserve(p); return b; }, used: () => shared.used() };

// 0. free hotel list (sandbox key; hotel IDs are the same in sandbox and production)
const list = await client.hotelList(CITY, { apiKey: env.NUITEE_SANDBOX_KEY });
if (!list.ok || !list.hotels.length) { console.error(`Hotel list failed (${list.reason || 'empty'}). No paid request sent.`); process.exit(1); }
const pick = sampleHotels(list.hotels);
console.log(`\n0. Hotel list: ${list.hotels.length} Barcelona hotels -> sample of ${pick.hotelIds.length}: ${JSON.stringify(pick.mix)}`);

const opts = { apiKey: env.NUITEE_PROD_KEY, allowProduction: true, budget };
let sent = 0;
async function withOneRetry(name, call) {
  let r = await call(); if (r.sent) sent++;
  if (!r.ok && r.retryable && sent < MAX_REQUESTS) {
    const wait = Math.min(60000, r.retryAfterS ? r.retryAfterS * 1000 : 6000);
    console.log(`   ${name}: ${r.reason}, retrying once in ${wait / 1000} s`);
    await new Promise(res => setTimeout(res, wait));
    r = await call(); if (r.sent) sent++;
  }
  return r;
}

const hotelsAnswer = await withOneRetry('prices/hotels', () => client.hotels({ hotelIds: pick.hotelIds, ...{ from: window.fromDate, to: window.toDate } }, { ...opts, purpose: 'probe:hotels' }));
const cityAnswer = await withOneRetry('prices/city', () => client.city({ ...CITY, from: window.fromDate, to: window.toDate }, { ...opts, purpose: 'probe:city' }));

console.log('\nResults (printed only, nothing stored):');
if (hotelsAnswer.ok) {
  const s = summary.fromHotels(CITY.cityId, hotelsAnswer);
  const prices = hotelsAnswer.data.reduce((n, h) => n + h.prices.length, 0);
  const bands = analysis.bandMedians(hotelsAnswer, Object.fromEntries(list.hotels.filter(h => pick.hotelIds.includes(h.id)).map(h => [h.id, bandOf(h)])));
  console.log(`1. prices/hotels: ${hotelsAnswer.data.length}/${pick.hotelIds.length} hotels answered, ${prices} daily prices, ${s?.days ?? 0} days, coverage ${s ? (s.coverage * 100).toFixed(1) : 0}%, ${hotelsAnswer.ms} ms`);
  console.log(`   median USD/night ${s?.median}; by band ${JSON.stringify(bands)}; complete-stay coverage ${JSON.stringify(s?.stayCoverage)}`);
  const eff = analysis.stayEffect(hotelsAnswer, { nights: [3, 5, 7] });
  for (const [n, v] of Object.entries(eff)) console.log(`   ${n}-night stays at one hotel: per-night p25 vs stay p25 ${v.nightP25VsStayP25MedianPct}% (under by 5%+ in ${v.nightP25UnderBy5PctShare}%), hotels with every night ${v.hotelsWithEveryNightMedianPct}%`);
} else console.log(`1. prices/hotels FAILED: ${hotelsAnswer.reason}`);
if (cityAnswer.ok) {
  const c = summary.fromCity(CITY.cityId, cityAnswer);
  console.log(`2. prices/city: ${cityAnswer.prices.length} days, median USD/night ${c?.median}, ${cityAnswer.ms} ms`);
  if (hotelsAnswer.ok) { const h = summary.fromHotels(CITY.cityId, hotelsAnswer); console.log(`   city average / sample median = ${(c.median / h.median).toFixed(2)}`); }
} else console.log(`2. prices/city FAILED: ${cityAnswer.reason}`);

const after = await shared.used();
console.log(`\nRequests sent: ${sent} (US$${(sent * PRICE).toFixed(2)}). Shared counter: ${before} -> ${after} of ${MAX_REQUESTS}.`);
console.log('Next: check the Nuitee dashboard shows the same number of Price Index requests and cost, then paste this output.');
