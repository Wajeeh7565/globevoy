'use strict';
// GV-PRICE-INDEX-001: pick up to 50 hotels per city that represent what travellers
// can book, from affordable to higher quality, instead of whatever the list returns
// first (often the biggest chains).
//
// Bands by star rating (unknown stars fall back to guest rating):
//   affordable  1-2 stars   15%    mid  3 stars   35%
//   upper-mid   4 stars     35%    high 5 stars   15%
// Inside a band: rated >= 7 first (GlobeVoy's "cheap but good" rule), then more
// reviews, then id (deterministic). A band with too few hotels lends its places to
// its neighbours, so the sample is always as full as the city allows.

const BANDS = [
  { band: 'affordable', share: .15, test: h => h.stars != null ? h.stars <= 2 : h.rating != null && h.rating < 7 },
  { band: 'mid', share: .35, test: h => h.stars === 3 || (h.stars == null && h.rating >= 7 && h.rating < 8) },
  { band: 'upper-mid', share: .35, test: h => h.stars === 4 || (h.stars == null && h.rating >= 8 && h.rating < 9) },
  { band: 'high', share: .15, test: h => h.stars >= 5 || (h.stars == null && h.rating >= 9) }
];

function bandOf(h) { const b = BANDS.find(x => x.test(h)); return b ? b.band : 'mid'; }

function sampleHotels(candidates = [], { size = 50 } = {}) {
  const seen = new Set();
  const list = candidates.filter(h => h && h.id && !seen.has(h.id) && seen.add(h.id));
  const order = (a, b) => ((b.rating >= 7) - (a.rating >= 7)) || ((b.reviews || 0) - (a.reviews || 0)) || String(a.id).localeCompare(String(b.id));
  const pools = Object.fromEntries(BANDS.map(b => [b.band, []]));
  for (const h of list) pools[bandOf(h)].push(h);
  for (const k of Object.keys(pools)) pools[k].sort(order);
  const n = Math.min(size, list.length);
  // shares -> whole hotels that add up to exactly n (largest remainder)
  const raw = BANDS.map(b => ({ band: b.band, x: b.share * n })), want = Object.fromEntries(raw.map(r => [r.band, Math.floor(r.x)]));
  let left = n - Object.values(want).reduce((a, b) => a + b, 0);
  for (const r of raw.slice().sort((a, b) => (b.x % 1) - (a.x % 1) || BANDS.findIndex(x => x.band === a.band) - BANDS.findIndex(x => x.band === b.band))) { if (left-- <= 0) break; want[r.band]++; }
  const picked = [];
  // first pass: each band up to its share
  for (const b of BANDS) picked.push(...pools[b.band].splice(0, want[b.band]));
  // second pass: fill from neighbouring bands, nearest first (mid and upper-mid are central)
  const fillOrder = ['mid', 'upper-mid', 'affordable', 'high'];
  while (picked.length < n) { const b = fillOrder.find(k => pools[k].length); if (!b) break; picked.push(pools[b].shift()); }
  const mix = Object.fromEntries(BANDS.map(b => [b.band, picked.filter(h => bandOf(h) === b.band).length]));
  return { hotelIds: picked.map(h => h.id), mix, from: list.length };
}

module.exports = { sampleHotels, bandOf, BANDS };
