#!/usr/bin/env node
'use strict';
// GV-HOTEL-MEM-002: offline report on the production hotel price memory.
//   node tests/performance/hotel-memory-report.cjs <export.json> [--clean-since 2026-11-25T09:23:00Z]
// Input: the output of `aws dynamodb get-item ... MEM#hotel/ratios` (read-only export).
// Prints the ratio distribution by region, observation count and age, before/after the
// fix time, and what each legacy rule would do to the regional levels. Nothing is written.
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '../..');
const opt = require(path.join(root, 'backend/services/domain/fare-map/fare-map-optimizer'));
const attr = require(path.join(root, 'backend/services/domain/live-fares/hotel-price-memory'))._internal.attr;

function parse(text) {
  const body = JSON.parse(text.replace(/^﻿/, ''));
  const item = body.Item || body;
  const out = [];
  for (const [k, v] of Object.entries(item)) {
    if (!k.startsWith('r_')) continue;
    const id = k.slice(2);
    out.push({ id, ratio: Number(v.N), n: Number(item['n_' + id]?.N) || 1, at: Number(item['t_' + id]?.N) || 0 });
  }
  return { entries: out, savedAt: Number(item.savedAt?.N) || null };
}
const q = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return +(s[lo] + (s[hi] - s[lo]) * (i - lo)).toFixed(2); };
const stats = a => ({ n: a.length, p25: q(a, .25), median: q(a, .5), p60: q(a, .6), p75: q(a, .75), max: a.length ? +Math.max(...a).toFixed(2) : null });

function report(file, cleanSince) {
  const { entries, savedAt } = parse(fs.readFileSync(file, 'utf8'));
  const regionOf = new Map(opt._internal.rows().map(r => [attr(r.unifiedRegistry.cityId), opt._internal.regionFamily(r)]));
  const now = savedAt || Date.now();
  const rows = entries.map(e => ({ ...e, region: regionOf.get(e.id) || 'unknown', ageH: Math.round((now - e.at) / 3600e3), legacy: cleanSince ? e.at < cleanSince : null }));
  const by = (key) => { const m = {}; for (const r of rows) (m[key(r)] = m[key(r)] || []).push(r.ratio); return Object.fromEntries(Object.entries(m).sort().map(([k, v]) => [k, stats(v)])); };
  return {
    cities: rows.length, savedAt: savedAt ? new Date(savedAt).toISOString() : null,
    all: stats(rows.map(r => r.ratio)),
    byRegion: by(r => r.region),
    byObservations: by(r => r.n >= 5 ? '5+' : String(r.n)),
    byAge: by(r => r.ageH < 6 ? '<6h' : r.ageH < 24 ? '6-24h' : r.ageH < 72 ? '1-3d' : '3d+'),
    ...(cleanSince ? { legacyVsClean: by(r => r.legacy ? 'legacy (before fix)' : 'clean (after fix)'), byRegionClean: Object.fromEntries(Object.entries((() => { const m = {}; for (const r of rows.filter(x => !x.legacy)) (m[r.region] = m[r.region] || []).push(r.ratio); return m; })()).map(([k, v]) => [k, stats(v)])) } : {}),
    clampedAt3: rows.filter(r => r.ratio >= 2.99).length
  };
}

if (require.main === module) {
  const file = process.argv[2]; if (!file) { console.error('usage: hotel-memory-report.cjs <export.json> [--clean-since ISO]'); process.exit(2); }
  const i = process.argv.indexOf('--clean-since'), since = i > 0 ? Date.parse(process.argv[i + 1]) : null;
  console.log(JSON.stringify(report(file, since), null, 1));
}
module.exports = { parse, report };
