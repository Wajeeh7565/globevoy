'use strict';
// GV-PRICE-INDEX-001: turn Price Index answers into a small city-level summary.
//
// Design (see docs/GV-HOTEL-PRICE-INDEX.md): GlobeVoy keeps only a city
// summary per calendar day, never individual hotel calendars. Per-hotel answers are
// summarised in memory and dropped.
//
// Summary shape (arrays aligned by day offset from `from`; null = no data that day):
//   { v: 1, cityId, source: 'hotels'|'city', from: 'YYYY-MM-DD', days,
//     p25: [usd|null], p50: [usd|null], n: [hotels|null],   // from per-hotel answers
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

/** From a prices/hotels answer: { data: [{hotelId, prices:[{day, usd}]}] }. minHotels per day (default 5). */
function fromHotels(cityId, answer, { minHotels = 5 } = {}) {
  const byDay = new Map();
  for (const h of answer?.data || []) for (const p of h.prices || []) { if (!byDay.has(p.day)) byDay.set(p.day, []); byDay.get(p.day).push(p.usd); }
  const s = span(byDay.keys()); if (!s) return null;
  const p25 = [], p50 = [], n = [];
  let covered = 0;
  for (let i = 0; i < s.count; i++) {
    const vals = (byDay.get(iso(dayMs(s.from) + i * DAY_MS)) || []).slice().sort((a, b) => a - b);
    if (vals.length >= minHotels) { p25.push(r0(quantile(vals, .25))); p50.push(r0(quantile(vals, .5))); n.push(vals.length); covered++; }
    else { p25.push(null); p50.push(null); n.push(vals.length || null); }
  }
  return { v: 1, cityId, source: 'hotels', from: s.from, days: s.count, p25, p50, n, median: r0(med(p50)), coverage: Number((covered / s.count).toFixed(4)) };
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

/** Date shape for a stay: mean of nightly levels / period median. null when unknown. */
function seasonality(summary, checkIn, nights = 1) {
  if (!summary?.median) return null;
  const vals = [];
  for (let i = 0; i < Math.max(1, nights); i++) { const v = level(summary, iso(dayMs(checkIn) + i * DAY_MS)); if (v != null) vals.push(v); }
  if (vals.length < Math.ceil(Math.max(1, nights) / 2)) return null;
  return Number((vals.reduce((a, b) => a + b, 0) / vals.length / summary.median).toFixed(3));
}

module.exports = { fromHotels, fromCity, level, seasonality, _internal: { quantile, span, iso, dayMs } };
