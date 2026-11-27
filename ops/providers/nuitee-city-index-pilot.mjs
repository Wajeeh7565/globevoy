#!/usr/bin/env node
// GV-DATA-HOTEL-001: Nuitee Price Index pilot for up to 200 cities (approved: max US$10; --run only
// after Nuitee confirms account access and storage rights).
//
// What it answers, per city: does Nuitee have priced hotels there at all (for discovered
// cities that is the hotel-availability check), and how does its daily city average for
// the next six months compare with the nightly estimate the planner uses today?
//
// Cost cap: --max-requests (default 200, at most 200). One billed request per city, no retries.
// Priced at US$0.05 per request (the higher of the two prices Nuitee publishes), so the
// most a run can cost is US$10. The shared monthly counter in DynamoDB
// (pk PI#budget in globevoy-fare-map) is capped at the same number, so a second run in
// the same month cannot spend more. That counter is the only AWS write.
// Prices are written to a local file outside the repository, not to DynamoDB: Nuitee's
// docs say nothing about storing Price Index results, so storage stays off until they
// confirm it in writing.
//
// Cities come from a benchmark run (tests/performance/recommendation-investigation.cjs
// --json): the cities travellers would be shown most, registry and discovered alike.
//
//   node ops/providers/nuitee-city-index-pilot.mjs --bench bench.json            # dry run, sends nothing
//   NUITEE_PROD_KEY=... AWS_REGION=us-east-2 FARE_MAP_TABLE=globevoy-fare-map \
//     node ops/providers/nuitee-city-index-pilot.mjs --bench bench.json --run     # after approval
import { createRequire } from 'node:module';
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
const require = createRequire(import.meta.url);
const client = require('../../backend/services/providers/stays/nuitee/nuitee-price-index.js');
const budgetLib = require('../../backend/services/domain/pricing/hotel-price-index/budget.js');
const { sampleHotels } = require('../../backend/services/domain/pricing/hotel-price-index/hotel-sample.js');
const opt = require('../../backend/services/domain/fare-map/fare-map-optimizer.js');
const graph = require('../../backend/services/domain/routing/global-route-graph.js');

const argv = process.argv.slice(2), arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const run = argv.includes('--run');
// --mode hotels (default): one prices/hotels request per city for up to 50 hotels sampled
// across star bands from the FREE static hotel list (sandbox key); per-hotel prices let us
// price "well-reviewed 3-star" stays. --mode city: one prices/city request per city.
const mode = arg('--mode', 'hotels') === 'city' ? 'city' : 'hotels';
const MAX = Math.max(1, Math.min(200, Number(arg('--max-requests', 200)) || 200)), PRICE = 0.05;
const discoveredShare = Math.max(0, Math.min(0.5, Number(arg('--discovered-share', 0.2))));
const out = path.resolve(arg('--out', path.join(os.homedir(), 'Downloads', 'globevoy-city-price-index-pilot.json')));
if (out.startsWith(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'))) { console.error('Refusing to write inside the repository.'); process.exit(2); }

const bench = JSON.parse(fs.readFileSync(arg('--bench'), 'utf8'));
const freq = new Map();
for (const c of bench.cases || []) for (const t of [...(c.guest || []), ...(c.member || [])]) for (const id of t.cities || []) freq.set(id, (freq.get(id) || 0) + 1);
const base = opt._internal.rows(), rowsById = new Map([...base, ...opt._internal.dynamicRows(base)].map(r => [r.unifiedRegistry.cityId, r]));
const ranked = [...freq].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, n, row: rowsById.get(id) })).filter(x => x.row);
const nDisc = Math.round(MAX * discoveredShare);
const disc = ranked.filter(x => opt._internal.isDynamic(x.row)).slice(0, nDisc);
const reg = ranked.filter(x => !opt._internal.isDynamic(x.row)).slice(0, MAX - disc.length);
const cities = [...reg, ...disc].map(x => {
  const u = x.row.unifiedRegistry;
  return { cityId: u.cityId, cityName: u.displayName, countryCode: String(u.countryCode).toUpperCase(), discovered: opt._internal.isDynamic(x.row), shownTimes: x.n, modelNightlyUsd: graph._internal.nightlyUsd(x.row) };
});
const w = client.horizon(null, null, Date.now());
console.log(`City Price Index pilot: ${cities.length} cities (${disc.length} discovered), ${w.fromDate} to ${w.toDate}`);
console.log(`At most ${MAX} requests = US$${(MAX * PRICE).toFixed(2)} at US$${PRICE}/request. Storage in AWS: OFF. Output: ${out}`);
if (!run) { for (const c of cities) console.log(`  ${c.discovered ? 'discovered' : 'registry  '} ${c.cityName}, ${c.countryCode} (shown ${c.shownTimes}x, model US$${c.modelNightlyUsd}/night)`); console.log('\nDRY RUN: nothing sent. Add --run after approval.'); process.exit(0); }

if (!process.env.NUITEE_PROD_KEY || mode === 'hotels' && !process.env.NUITEE_SANDBOX_KEY) { console.error('Set NUITEE_PROD_KEY (and NUITEE_SANDBOX_KEY for the free hotel list).'); process.exit(2); }
const local = budgetLib.memoryBudget(MAX);
const shared = budgetLib.dynamoBudget({ env: { ...process.env, PRICE_INDEX_MONTHLY_REQUEST_CAP: String(MAX) } });
const budget = { kind: 'pilot', cap: MAX, async reserve(p) { const a = await local.reserve(p); return a.ok ? shared.reserve(p) : a; }, used: () => shared.used() };
const results = []; let sent = 0;
for (const c of cities) {
  if (sent >= MAX) break;
  let r, prices = [], good3 = [];
  if (mode === 'city') {
    r = await client.city({ countryCode: c.countryCode, cityName: c.cityName, from: w.fromDate, to: w.toDate }, { apiKey: process.env.NUITEE_PROD_KEY, allowProduction: true, budget, purpose: 'pilot:city' });
    prices = (r.prices || []).map(p => p.avgPriceUsd ?? p.price ?? p[1]).filter(Number.isFinite);
  } else {
    const list = await client.hotelList({ countryCode: c.countryCode, cityName: c.cityName }, { apiKey: process.env.NUITEE_SANDBOX_KEY });
    const sample = list.ok ? sampleHotels(list.hotels, { size: 50 }) : [];
    if (!sample.length) { results.push({ ...c, ok: false, reason: list.ok ? 'no-hotels-listed' : list.reason, days: 0 }); console.log(`${c.cityName}, ${c.countryCode}: no hotels listed (free check, nothing billed)`); continue; }
    r = await client.hotels({ hotelIds: sample.map(h => h.id), from: w.fromDate, to: w.toDate }, { apiKey: process.env.NUITEE_PROD_KEY, allowProduction: true, budget, purpose: 'pilot:hotels' });
    const byId = new Map(sample.map(h => [h.id, h]));
    for (const h of r.data || []) {
      const v = (h.prices || []).map(p => p.avgPriceUsd ?? p.price ?? p[1]).filter(Number.isFinite); if (!v.length) continue;
      const med = v.slice().sort((a, b) => a - b)[Math.floor(v.length / 2)], meta = byId.get(h.hotelId) || {};
      prices.push(med); if ((meta.stars === 3 || meta.stars === 4) && (meta.rating || 0) >= 8) good3.push(med);
    }
  }
  if (r.sent !== false) sent++;
  const med = prices.length ? [...prices].sort((a, b) => a - b)[Math.floor(prices.length / 2)] : null;
  const med3 = good3.length ? good3.slice().sort((a, b) => a - b)[Math.floor(good3.length / 2)] : null;
  results.push({ ...c, ok: !!r.ok, reason: r.reason || null, days: prices.length, pricedGood3to4Hotels: good3.length, goodHotelMedianUsd: med3, medianUsd: med, minUsd: prices.length ? Math.min(...prices) : null, maxUsd: prices.length ? Math.max(...prices) : null, ratioToModel: med && c.modelNightlyUsd ? +(med / c.modelNightlyUsd).toFixed(2) : null });
  console.log(`${c.cityName}, ${c.countryCode}: ${r.ok ? `${prices.length} days, median US$${med}` : `failed (${r.reason})`}`);
}
fs.writeFileSync(out, JSON.stringify({ takenAt: new Date().toISOString(), window: w, requestsSent: sent, maxCostUsd: +(sent * PRICE).toFixed(2), results }, null, 1));
const okR = results.filter(r => r.ratioToModel);
console.log(`\nSent ${sent} requests (at most US$${(sent * PRICE).toFixed(2)}). Priced: ${results.filter(r => r.days).length}/${results.length}; discovered priced: ${results.filter(r => r.discovered && r.days).length}/${results.filter(r => r.discovered).length}.`);
if (okR.length) { const s = okR.map(r => r.ratioToModel).sort((a, b) => a - b); console.log(`Nuitee median / model estimate: median ${s[Math.floor(s.length / 2)]}, range ${s[0]}-${s.at(-1)}`); }
