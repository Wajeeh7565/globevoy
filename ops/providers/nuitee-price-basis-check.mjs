#!/usr/bin/env node
// GV-PRICE-INDEX-001 / task 5b: what do Price Index prices include?
// (taxes or not, per room for 1 adult or 2 adults). Run on your own computer.
//
// Cost: ONE Price Index request (US$0.02) for 10 sampled Barcelona hotels. It is
// the third and last slot of the approved US$0.06 test: the shared monthly counter
// is capped at 3 for this, so if it already shows 3 the script sends nothing.
// The live-rate lookups (POST /hotels/rates) are the same search the website makes
// for every trip; they are not Price Index requests and don't use the budget.
// Hotel list: free, sandbox key. Nothing is stored; results are printed.
//
// Setup: same as nuitee-price-index-probe.mjs (AWS credentials exported into the
// shell, FARE_MAP_TABLE, AWS_REGION, NUITEE_SANDBOX_KEY, NUITEE_PROD_KEY).
//   node ops/providers/nuitee-price-basis-check.mjs          # dry run
//   node ops/providers/nuitee-price-basis-check.mjs --run
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const client = require('../../backend/services/providers/stays/nuitee/nuitee-price-index.js');
const nuitee = require('../../backend/services/providers/stays/nuitee/nuitee-hotel-708c.js');
const budgetLib = require('../../backend/services/domain/pricing/hotel-price-index/budget.js');
const analysis = require('../../backend/services/domain/pricing/hotel-price-index/analysis.js');
const { sampleHotels, bandOf } = require('../../backend/services/domain/pricing/hotel-price-index/hotel-sample.js');

const CITY = { countryCode: 'ES', cityName: 'Barcelona' };
const SHARED_CAP = 3, HOTELS_PER_BAND = { affordable: 3, mid: 3, 'upper-mid': 2, high: 2 };
const DAY = 86400e3, iso = ms => new Date(ms).toISOString().slice(0, 10);
const today = Date.parse(iso(Date.now()) + 'T00:00:00Z');
// three check-in dates (a weekday soon, a Friday next month, a spring weekday), 1 night each, plus one 3-night stay
const nextDow = (fromDays, dow) => { let d = today + fromDays * DAY; while (new Date(d).getUTCDay() !== dow) d += DAY; return d; };
const STAYS = [[nextDow(14, 2), 1], [nextDow(40, 5), 1], [nextDow(100, 3), 1], [nextDow(60, 1), 3]].map(([d, n]) => ({ checkin: iso(d), checkout: iso(d + n * DAY), nights: n }));
const OCC = ['1', '2'];
const run = process.argv.includes('--run');

console.log('Nuitee Price Index price-basis check (Barcelona, 10 hotels)');
console.log(`Stays: ${STAYS.map(s => `${s.checkin} x${s.nights}`).join(', ')}; occupancy 1 and 2 adults`);
console.log(`Cost: 1 Price Index request = US$0.02 (shared counter capped at ${SHARED_CAP}); ${STAYS.length * OCC.length} live-rate searches (not Price Index). Nothing stored.`);
if (!run) { console.log('\nDRY RUN: nothing sent. Add --run to send.'); process.exit(0); }

const env = process.env;
for (const k of ['NUITEE_SANDBOX_KEY', 'NUITEE_PROD_KEY', 'FARE_MAP_TABLE']) if (!env[k]) { console.error(`Missing ${k}.`); process.exit(2); }
const shared = budgetLib.dynamoBudget({ env: { ...env, PRICE_INDEX_MONTHLY_REQUEST_CAP: String(SHARED_CAP) } });
const used = await shared.used();
if (used == null) { console.error('Cannot read the shared counter. Nothing sent.'); process.exit(2); }
if (used >= SHARED_CAP) { console.error(`Shared counter already at ${used} of ${SHARED_CAP}. Nothing sent.`); process.exit(2); }
const local = budgetLib.memoryBudget(1);
const budget = { cap: 1, async reserve(p) { const a = await local.reserve(p); return a.ok ? shared.reserve(p) : a; }, used: () => shared.used() };

const list = await client.hotelList(CITY, { apiKey: env.NUITEE_SANDBOX_KEY });
if (!list.ok) { console.error(`Hotel list failed: ${list.reason}. Nothing paid sent.`); process.exit(1); }
const sample = new Set(sampleHotels(list.hotels).hotelIds);
const pool = list.hotels.filter(h => sample.has(h.id));
const chosen = Object.entries(HOTELS_PER_BAND).flatMap(([band, n]) => pool.filter(h => bandOf(h) === band).slice(0, n));
const ids = chosen.map(h => h.id);
console.log(`\nHotels: ${chosen.map(h => `${h.name || h.id} (${bandOf(h)})`).join('; ')}`);

const from = STAYS.map(s => s.checkin).sort()[0], to = STAYS.map(s => s.checkout).sort().at(-1);
const idx = await client.hotels({ hotelIds: ids, from, to }, { apiKey: env.NUITEE_PROD_KEY, allowProduction: true, budget, purpose: 'basis-check' });
if (!idx.ok) { console.error(`Price Index request failed: ${idx.reason}`); process.exit(1); }
const indexOf = new Map(idx.data.map(h => [h.hotelId, new Map(h.prices.map(p => [p.day, p.usd]))]));

const live = {};
for (const s of STAYS) for (const o of OCC) {
  const body = { hotelIds: ids, occupancies: [{ adults: Number(o) }], currency: 'USD', guestNationality: 'CA', checkin: s.checkin, checkout: s.checkout, timeout: 10, limit: 20, stream: false };
  const r = await nuitee.postJson(nuitee.RATE_URL, body, env.NUITEE_PROD_KEY, { timeoutMs: 15000 }).catch(e => ({ status: 0, payload: null, error: e.message }));
  for (const h of Array.isArray(r.payload?.data) ? r.payload.data : []) {
    let best = null;
    for (const rt of h.roomTypes || []) {
      const rate = (rt.rates || [])[0], total = Number(rt.offerRetailRate?.amount ?? rate?.retailRate?.total?.[0]?.amount);
      if (!(total > 0) || (rt.offerRetailRate?.currency || rate?.retailRate?.total?.[0]?.currency) !== 'USD') continue;
      const fees = Array.isArray(rate?.retailRate?.taxesAndFees) ? rate.retailRate.taxesAndFees : [];
      const sum = inc => fees.filter(f => f?.included === inc).reduce((a, f) => a + (Number(f.amount) || 0), 0);
      if (!best || total < best.total) best = { total, includedTaxes: sum(true), excludedTaxes: sum(false), feesListed: fees.length > 0 };
    }
    if (best) ((live[h.hotelId] ||= {})[s.checkin] ||= {})[o] = best;
  }
  console.log(`  live rates ${s.checkin} x${s.nights}, ${o} adult(s): HTTP ${r.status}, ${(r.payload?.data || []).length} hotels with rooms`);
}

const rows = [];
for (const id of ids) for (const s of STAYS) {
  const days = Array.from({ length: s.nights }, (_, k) => iso(Date.parse(s.checkin + 'T00:00:00Z') + k * DAY));
  const vals = days.map(d => indexOf.get(id)?.get(d)).filter(v => v != null);
  if (vals.length !== s.nights || !live[id]?.[s.checkin]) continue;
  rows.push({ hotelId: id, checkin: s.checkin, nights: s.nights, index: vals.reduce((a, b) => a + b, 0) / vals.length, live: live[id][s.checkin] });
}
const res = analysis.compareBasis(rows);
console.log(`\nPairs with both an index price and a live room: ${rows.length}`);
for (const [k, v] of Object.entries(res.bases)) console.log(`  index / live (${k.padEnd(34)}) ${v.pairs ? `median ${v.medianRatio}  middle half ${v.p25}-${v.p75}  within 15%: ${v.within15Pct}%` : 'no pairs'}`);
console.log(`Closest basis: ${res.closest || 'not enough data'}`);
const feeRows = rows.filter(r => r.live['1']?.feesListed);
console.log(`Live rooms listing taxes: ${feeRows.length}/${rows.length}; with fees paid at the hotel: ${rows.filter(r => r.live['1']?.excludedTaxes > 0).length}`);
console.log(`\nPrice Index requests sent: 1 (US$0.02). Shared counter: ${used} -> ${await shared.used()} of ${SHARED_CAP}.`);
