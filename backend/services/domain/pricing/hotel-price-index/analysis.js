'use strict';
// GV-PRICE-INDEX-001: what does a city summary lose about COMPLETE stays at one hotel?
//
// Works on any prices/hotels answer (synthetic test inputs or a real file), because it
// compares the hotel calendars with themselves; it needs no "true" live price.
// For every check-in day and stay length it compares:
//   stayP25      p25 across hotels of each hotel's average over the whole stay
//                (what a traveller can actually book as one stay; kept by summary v2)
//   nightP25     mean of the per-night p25s (summary v1; can mix hotels night by night)
//   stayMin      the cheapest complete stay at one hotel
//   nightMin     mean of each night's cheapest hotel (switching hotels every night)
// and how many hotels have every night of the stay priced.

const DAY_MS = 86400e3;
const q = (s, p) => { if (!s.length) return null; const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const pct = x => (x == null ? null : Number((x * 100).toFixed(1)));

function calendars(answer) {
  const data = answer?.data || [];
  const days = [...new Set(data.flatMap(h => (h.prices || []).map(p => p.day)))].sort();
  const idx = new Map(days.map((d, i) => [d, i]));
  const cal = data.map(h => { const row = new Array(days.length).fill(null); for (const p of h.prices || []) row[idx.get(p.day)] = p.usd ?? p.avgPriceUsd; return { id: h.hotelId, row }; });
  return { days, cal };
}

function stayEffect(answer, { nights = [2, 3, 4, 5, 6, 7], minHotels = 5 } = {}) {
  const { days, cal } = calendars(answer);
  const out = {};
  for (const n of nights) {
    const gapP25 = [], gapMin = [], complete = [];
    for (let i = 0; i + n <= days.length; i++) {
      const stays = [];
      for (const c of cal) { let s = 0, ok = true; for (let k = 0; k < n; k++) { const v = c.row[i + k]; if (v == null) { ok = false; break; } s += v; } if (ok) stays.push(s / n); }
      complete.push(stays.length / Math.max(1, cal.length));
      if (stays.length < minHotels) continue;
      stays.sort((a, b) => a - b);
      let np25 = 0, nmin = 0;
      for (let k = 0; k < n; k++) { const v = cal.map(c => c.row[i + k]).filter(x => x != null).sort((a, b) => a - b); np25 += q(v, .25) / n; nmin += v[0] / n; }
      gapP25.push(np25 / q(stays, .25) - 1); gapMin.push(nmin / stays[0] - 1);
    }
    const s1 = gapP25.slice().sort((a, b) => a - b), s2 = gapMin.slice().sort((a, b) => a - b), s3 = complete.slice().sort((a, b) => a - b);
    out[n] = {
      stays: gapP25.length,
      nightP25VsStayP25MedianPct: pct(q(s1, .5)), nightP25UnderBy5PctShare: pct(gapP25.filter(g => g < -0.05).length / Math.max(1, gapP25.length)),
      nightMinVsStayMinMedianPct: pct(q(s2, .5)),
      hotelsWithEveryNightMedianPct: pct(q(s3, .5))
    };
  }
  return out;
}

/** Median nightly price per quality band (needs a { hotelId: band } map). */
function bandMedians(answer, bandOf) {
  const by = {};
  for (const h of answer?.data || []) { const b = bandOf[h.hotelId]; if (!b) continue; (by[b] = by[b] || []).push(...(h.prices || []).map(p => p.usd ?? p.avgPriceUsd)); }
  return Object.fromEntries(Object.entries(by).map(([b, v]) => [b, Math.round(q(v.sort((x, y) => x - y), .5))]));
}

module.exports = { stayEffect, bandMedians, _internal: { calendars, q } };
