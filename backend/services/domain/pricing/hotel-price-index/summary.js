'use strict';
// GV-PRICE-INDEX-001: turn Price Index answers into a small city-level summary.
//
// Design (see docs/GV-HOTEL-PRICE-INDEX.md): GlobeVoy keeps only a city
// summary per calendar day, never individual hotel calendars. Per-hotel answers are
// summarised in memory and dropped.
//
// Summary shape (arrays aligned by day offset from `from`; null = no data that day):
//   { v: 2, cityId, source: 'hotels'|'city', from: 'YYYY-MM-DD', days,
//     p25: [usd|null], p50: [usd|null], n: [hotels|null],   // from per-hotel answers
//     stay: { '3'|'5'|'7': [usd|null] }, stayMedian, stayCoverage,  // complete stays at one hotel
//     avg: [usd|null],                                        // from the city endpoint
//     median: usd, coverage: 0..1 }
// The planner uses `seasonality(summary, day)` = that day's level / the period's
// median, so the existing learned per-city ratio keeps the absolute level and the
// index only adds the date shape (weekends, holidays, seasons).

const DAY_MS = 86400e3;
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const dayMs = d => Date.parse(d + 'T00:00:00Z');
const quantile = (sorted, q) => { if (!sorted.length) return null; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };
const med = a => { const s = a.filter(x => x != null).sort((x, y) => x - y); return s.length ? quantile(s, 0.5) : null; };
const r0 = x => (x == null ? null : Math.round(x));

function span(days) {
  const sorted = [...days].sort();
  if (!sorted.length) return null;
  const from = sorted[0], to = sorted[sorted.length - 1];
  return { from, count: Math.round((dayMs(to) - dayMs(from)) / DAY_MS) + 1 };
}

// Complete-stay lengths kept in the summary (see stayLevels below).
const STAY_NIGHTS = [3, 5, 7];

/** From a prices/hotels answer: { data: [{hotelId, prices:[{day, usd}]}] }. minHotels per day (default 5). */
function fromHotels(cityId, answer, { minHotels = 5, stayNights = STAY_NIGHTS } = {}) {
  const byDay = new Map();
  for (const h of answer?.data || []) for (const p of h.prices || []) { if (!byDay.has(p.day)) byDay.set(p.day, []); byDay.get(p.day).push(p.usd); }
  const s = span(byDay.keys()); if (!s) return null;
  const stay = stayLevels(answer, s, { minHotels, stayNights });
  const p25 = [], p50 = [], n = [];
  let covered = 0;
  for (let i = 0; i < s.count; i++) {
    const vals = (byDay.get(iso(dayMs(s.from) + i * DAY_MS)) || []).slice().sort((a, b) => a - b);
    if (vals.length >= minHotels) { p25.push(r0(quantile(vals, .25))); p50.push(r0(quantile(vals, .5))); n.push(vals.length); covered++; }
    else { p25.push(null); p50.push(null); n.push(vals.length || null); }
  }
  return { v: 2, cityId, source: 'hotels', from: s.from, days: s.count, p25, p50, n, median: r0(med(p50)), coverage: Number((covered / s.count).toFixed(4)), ...stay };
}

// Complete stays at ONE hotel. A per-night p25 can mix hotels (cheapest hotel on
// Friday, a different one on Saturday), which nobody can book as one stay. For each
// check-in day and stay length, take each hotel's average nightly price over the whole
// stay (hotels missing a night are left out), then the p25 across hotels.
//   stay: { '3': [usd|null per check-in day], ... }, stayMedian: { '3': usd, ... }
function stayLevels(answer, s, { minHotels = 5, stayNights = STAY_NIGHTS } = {}) {
  if (!stayNights?.length) return {};
  const cal = (answer?.data || []).map(h => { const m = new Map((h.prices || []).map(p => [p.day, p.usd])); return Array.from({ length: s.count }, (_, i) => m.get(iso(dayMs(s.from) + i * DAY_MS)) ?? null); });
  const stay = {}, stayMedian = {}, stayCoverage = {};
  for (const nights of stayNights) {
    const out = [], shares = [];
    for (let i = 0; i < s.count; i++) {
      if (i + nights > s.count) { out.push(null); continue; }
      const avgs = [];
      for (const c of cal) { let sum = 0, ok = true; for (let k = 0; k < nights; k++) { const v = c[i + k]; if (v == null) { ok = false; break; } sum += v; } if (ok) avgs.push(sum / nights); }
      avgs.sort((a, b) => a - b);
      shares.push(avgs.length / Math.max(1, cal.length));
      out.push(avgs.length >= minHotels ? r0(quantile(avgs, .25)) : null);
    }
    stay[nights] = out; stayMedian[nights] = r0(med(out));
    // share of sampled hotels with every night of the stay priced (median over check-ins)
    stayCoverage[nights] = Number((med(shares) ?? 0).toFixed(2));
  }
  return { stay, stayMedian, stayCoverage };
}

/** From a prices/city answer: { prices:[{day, usd}] }. */
function fromCity(cityId, answer) {
  const byDay = new Map((answer?.prices || []).map(p => [p.day, p.usd]));
  const s = span(byDay.keys()); if (!s) return null;
  const avg = [];
  for (let i = 0; i < s.count; i++) avg.push(r0(byDay.get(iso(dayMs(s.from) + i * DAY_MS)) ?? null));
  const covered = avg.filter(x => x != null).length;
  return { v: 1, cityId, source: 'city', from: s.from, days: s.count, avg, median: r0(med(avg)), coverage: Number((covered / s.count).toFixed(4)) };
}

function level(summary, day) {
  if (!summary) return null;
  const i = Math.round((dayMs(day) - dayMs(summary.from)) / DAY_MS);
  if (!(i >= 0 && i < summary.days)) return null;
  return (summary.source === 'city' ? summary.avg : summary.p50)[i] ?? null;
}

/** Date shape for a stay: its level / the period median. Uses the complete-stay level
 *  for the nearest kept stay length when there is one, else the mean of nightly levels. */
function seasonality(summary, checkIn, nights = 1) {
  if (!summary?.median) return null;
  if (summary.stay) {
    const keys = Object.keys(summary.stay).map(Number).sort((a, b) => Math.abs(a - nights) - Math.abs(b - nights) || a - b);
    const k = keys[0], i = Math.round((dayMs(checkIn) - dayMs(summary.from)) / DAY_MS);
    const v = summary.stay[k]?.[i];
    if (k && Math.abs(k - nights) <= 2 && v != null && summary.stayMedian?.[k]) return Number((v / summary.stayMedian[k]).toFixed(3));
  }
  const vals = [];
  for (let i = 0; i < Math.max(1, nights); i++) { const v = level(summary, iso(dayMs(checkIn) + i * DAY_MS)); if (v != null) vals.push(v); }
  if (vals.length < Math.ceil(Math.max(1, nights) / 2)) return null;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length / summary.median).toFixed(3));
}

module.exports = { fromHotels, fromCity, level, seasonality, STAY_NIGHTS, _internal: { quantile, span, iso, dayMs, stayLevels } };
