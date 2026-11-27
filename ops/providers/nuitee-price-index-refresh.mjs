#!/usr/bin/env node
// GV-HOTEL-PLAN-003: monthly Nuitee Price Index refresh (prepared; NOT scheduled).
//
// For each city in --cities (a JSON list [{cityId, countryCode, cityName, modelUsd}]), one
// billed prices/hotels request for up to 50 hotels sampled across star bands from the free
// static hotel list, then a city summary { cityId, levelRatio, goodHotelMedianUsd, ... }.
// levelRatio = median nightly of well-reviewed (>= 8) 3-4 star hotels / the planner's model
// nightly; the trip search plans with it (PRICE_INDEX_PLANNING=on).
//
// Two independent switches keep this harmless until approved:
//   * --run is required to send anything (default: dry run, prints the plan and the cost);
//   * summaries are only written with PRICE_INDEX_STORAGE=on (store.write refuses otherwise),
//     so a run without it only writes a local JSON file.
// Cost cap: --max-requests (default 500). Price US$0.02/request (Nuitee dashboard, Nov 2026).
//
//   node ops/providers/nuitee-price-index-refresh.mjs --cities cities.json            # dry run
//   NUITEE_PROD_KEY=... node ops/providers/nuitee-price-index-refresh.mjs --cities cities.json --run
// --from-pilot a.json.gz,b.json.gz loads earlier pilot results instead of calling Nuitee
// (no cost), e.g. to fill the store once storage is approved.
import { createRequire } from 'node:module';
import fs from 'node:fs'; import zlib from 'node:zlib';
const require = createRequire(import.meta.url);
const client = require('../../backend/services/providers/stays/nuitee/nuitee-price-index.js');
const store = require('../../backend/services/domain/pricing/hotel-price-index/store.js');
const { sampleHotels } = require('../../backend/services/domain/pricing/hotel-price-index/hotel-sample.js');
const opt = require('../../backend/services/domain/fare-map/fare-map-optimizer.js');

const argv = process.argv.slice(2), arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const PRICE = 0.02, MAX = Math.max(1, Math.min(2000, Number(arg('--max-requests', 500)) || 500));
const med = a => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const rows = (() => { const base = opt._internal.rows(); return new Map([...base, ...opt._internal.dynamicRows(base)].map(r => [r.unifiedRegistry.cityId, r])); })();
const family = id => { const r = rows.get(id); return r ? opt._internal.regionFamily(r) : 'other'; };
function summary(c, good, all, byStars) {
  const price = med(good) ?? med(all);
  return { cityId: c.cityId, countryCode: c.countryCode, cityName: c.cityName, regionFamily: family(c.cityId), modelUsd: c.modelUsd,
    goodHotelMedianUsd: med(good), medianUsd: med(all), byStars, levelRatio: price && c.modelUsd ? Number((price / c.modelUsd).toFixed(3)) : null,
    source: 'nuitee-prices-hotels', collectedAt: c.collectedAt || new Date().toISOString() };
}
async function save(list) {
  let stored = 0, reason = null;
  for (const s of list) { if (!Number.isFinite(s.levelRatio)) continue; const r = await store.write(s); if (r.stored) stored++; else reason = r.reason; }
  fs.writeFileSync(arg('--out', 'price-index-summaries.json'), JSON.stringify(list));
  console.log(`Summaries: ${list.length}; written to DynamoDB: ${stored}${reason ? ` (not stored: ${reason})` : ''}.`);
}

if (arg('--from-pilot')) {
  // One or more pilot files, comma-separated (later files win for the same city).
  const all = new Map();
  for (const f of arg('--from-pilot').split(',')) { const b = JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8')); for (const c of b.cities) all.set(c.cityId, { ...c, collectedAt: b.takenAt }); }
  await save([...all.values()].filter(c => c.priced).map(c => summary(c, c.good34MedianUsd != null ? [c.good34MedianUsd] : [], c.medianUsd != null ? [c.medianUsd] : [], c.byStars || {})));
  process.exit(0);
}
const cities = JSON.parse(fs.readFileSync(arg('--cities'), 'utf8')).slice(0, MAX);
console.log(`Price Index refresh: ${cities.length} cities, at most US$${(cities.length * PRICE).toFixed(2)}. Storage: ${store.storageOn(process.env) ? 'ON' : 'off (local file only)'}.`);
if (!argv.includes('--run')) { console.log('Dry run: nothing sent. Add --run.'); process.exit(0); }
if (!process.env.NUITEE_PROD_KEY) { console.error('Set NUITEE_PROD_KEY.'); process.exit(2); }
const w = client.horizon(null, null, Date.now()), out = [];
let sent = 0;
for (const c of cities) {
  const list = await client.hotelList({ countryCode: c.countryCode, cityName: c.cityName }, { apiKey: process.env.NUITEE_PROD_KEY });
  const sample = list.ok ? sampleHotels(list.hotels, { size: 50 }) : [];
  if (!sample.length) continue;
  if (sent >= MAX) break; sent++;
  const r = await client.hotels({ hotelIds: sample.map(h => h.id), from: w.fromDate, to: w.toDate }, { apiKey: process.env.NUITEE_PROD_KEY, allowProduction: true, budget: { reserve: async () => ({ ok: true }) }, purpose: 'refresh:hotels' });
  const meta = new Map(sample.map(h => [h.id, h])), good = [], all = [], stars = {};
  for (const h of r.data || []) {
    const v = med((h.prices || []).map(p => p.avgPriceUsd ?? p.price)); if (v == null) continue; const m = meta.get(h.hotelId) || {};
    all.push(v); if ((m.stars === 3 || m.stars === 4) && (m.rating || 0) >= 8) good.push(v); if (m.stars) (stars[m.stars] = stars[m.stars] || []).push(v);
  }
  out.push(summary(c, good, all, Object.fromEntries(Object.entries(stars).map(([k, v]) => [k, med(v)]))));
}
console.log(`Sent ${sent} billed requests (at most US$${(sent * PRICE).toFixed(2)}).`);
await save(out);
