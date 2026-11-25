'use strict';
// GV-PRICE-INDEX-001 test inputs shaped like the Barcelona sandbox run (Nov 2026):
// 50 hotels, 182 days (Dec 1 2026 - May 31 2027), 8,789 daily prices (96.58% coverage),
// in Nuitee's documented answer format ({ data: [{ hotelId, prices: [{ day, avgPriceUsd }] }] }).
//
// The raw sandbox file was not kept, so this generator rebuilds a dataset with the
// same shape and sizes. Prices are SYNTHETIC (tiers, seasons, weekends, holidays).
// To use the real file instead, set PRICE_INDEX_FIXTURE=<path to the sandbox JSON>.
// A hidden population of 200 hotels stands behind the 50 sampled ones, so the city
// endpoint (average of all hotels) and "what GlobeVoy would book" (cheapest good
// rooms in the whole city) are not just functions of the 50 sampled calendars.

const fs = require('fs');
const FROM = '2026-12-01', DAYS = 182, HOTELS = 50, POPULATION = 200, TARGET_PRICES = 8789;
const DAY_MS = 86400e3;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function season(day) {
  const d = new Date(day + 'T00:00:00Z'), m = d.getUTCMonth(), dd = d.getUTCDate(), wd = d.getUTCDay();
  let f = { 11: 0.95, 0: 0.78, 1: 0.8, 2: 0.95, 3: 1.12, 4: 1.25 }[m] ?? 1;
  if ((m === 11 && dd >= 22) || (m === 0 && dd <= 3)) f *= 1.45;              // Christmas / New Year
  if (day >= '2027-03-20' && day <= '2027-03-29') f *= 1.35;                  // Easter week 2027
  if (day >= '2027-02-25' && day <= '2027-03-04') f *= 1.25;                  // big trade fair
  if (wd === 5 || wd === 6) f *= 1.12;                                        // Fri/Sat nights
  return f;
}

function build(seed = 708) {
  const R = rng(seed), days = Array.from({ length: DAYS }, (_, i) => iso(Date.parse(FROM + 'T00:00:00Z') + i * DAY_MS));
  // population: budget 40%, mid 40%, upscale 20%; rating 6-9.5
  const pop = Array.from({ length: POPULATION }, (_, i) => {
    const t = R(), base = t < .4 ? 55 + R() * 50 : t < .8 ? 105 + R() * 90 : 200 + R() * 260;
    return { hotelId: 'lpbcn' + String(i + 1).padStart(3, '0'), base, rating: 6 + R() * 3.5, swing: 0.8 + R() * 0.4 };
  });
  const truth = {}; // per hotel per day "true" nightly price
  for (const h of pop) truth[h.hotelId] = days.map(d => Math.round(h.base * (1 + (season(d) - 1) * h.swing) * (0.93 + R() * 0.14)));
  // the 50 hotels the hotels endpoint is asked about: GlobeVoy-like picks (rated >= 7), mixed tiers
  const sampled = pop.filter(h => h.rating >= 7).slice(0, HOTELS);
  // drop cells to hit exactly 8,789 prices
  const cells = []; sampled.forEach((h, hi) => days.forEach((d, di) => cells.push([hi, di])));
  const drop = new Set(); while (cells.length - drop.size > TARGET_PRICES) drop.add(Math.floor(R() * cells.length));
  const hotels = { data: sampled.map((h, hi) => ({ hotelId: h.hotelId, prices: days.map((d, di) => drop.has(hi * DAYS + di) ? null : { day: d, avgPriceUsd: truth[h.hotelId][di] }).filter(Boolean) })) };
  const city = { countryCode: 'ES', cityName: 'Barcelona', prices: days.map((d, di) => ({ day: d, avgPriceUsd: Math.round(pop.reduce((s, h) => s + truth[h.hotelId][di], 0) / pop.length) })) };
  // what a live check would find: cheapest room among good hotels (rated >= 7) in the whole city, per night
  const good = pop.filter(h => h.rating >= 7);
  const bookable = days.map((d, di) => { const v = good.map(h => truth[h.hotelId][di]).sort((a, b) => a - b); return v[Math.floor(v.length * 0.1)]; });
  return { days, hotels, city, bookable, synthetic: true };
}

function load() {
  const p = process.env.PRICE_INDEX_FIXTURE;
  if (p) { const body = JSON.parse(fs.readFileSync(p, 'utf8')); return { days: null, hotels: body, city: null, bookable: null, synthetic: false }; }
  return build();
}

module.exports = { build, load, FROM, DAYS, HOTELS, TARGET_PRICES, season };
