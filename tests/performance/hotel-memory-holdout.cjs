#!/usr/bin/env node
'use strict';
// GV-HOTEL-MEM-003 holdout score. Takes two hotel-memory exports: BEFORE (when clean
// tracking starts) and AFTER (days later, with HOTEL_MEMORY_CLEAN_TRACK=on in between).
// Each calibration mode predicts every city from BEFORE only; the clean checks that arrived
// later (q_/c_ in AFTER) are the truth it never saw. Lower error = better calibration.
//   node tests/performance/hotel-memory-holdout.cjs --before a.json --after b.json [--json]
const fs = require('fs');
const opt = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { regionRatios, memoryLevel, legacyRule } = opt._internal;

function parseExport(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const item = raw.Item || raw, map = new Map();
  for (const [k, v] of Object.entries(item)) {
    if (!k.startsWith('r_')) continue;
    const id = k.slice(2), num = a => Number(item[a + id]?.N);
    const e = { ratio: Math.min(3, Math.max(0.6, Number(v.N))), n: num('n_') || 1, at: num('t_') || 0 };
    if (num('c_') > 0) Object.assign(e, { q: num('q_'), c: num('c_') });
    map.set(id, e);
  }
  return map;
}
const CLEAN = '2026-11-25T09:23:00Z';
const MODES = {
  trust: {},
  shrink: { HOTEL_MEMORY_LEGACY: 'shrink', HOTEL_MEMORY_CLEAN_SINCE: CLEAN },
  'shrink-p60': { HOTEL_MEMORY_LEGACY: 'shrink', HOTEL_MEMORY_CLEAN_SINCE: CLEAN, FARE_MAP_REGION_QUANTILE: '0.6' },
  regional: { HOTEL_MEMORY_LEGACY: 'regional', HOTEL_MEMORY_CLEAN_SINCE: CLEAN },
  bayes: { HOTEL_MEMORY_LEGACY: 'bayes', HOTEL_MEMORY_CLEAN_SINCE: CLEAN },
  'bayes-w0.5': { HOTEL_MEMORY_LEGACY: 'bayes', HOTEL_MEMORY_CLEAN_SINCE: CLEAN, HOTEL_MEMORY_LEGACY_WEIGHT: '0.5' },
  'bayes-prior4': { HOTEL_MEMORY_LEGACY: 'bayes', HOTEL_MEMORY_CLEAN_SINCE: CLEAN, HOTEL_MEMORY_PRIOR_WEIGHT: '4' }
};

function score(before, after, rows) {
  const byAttr = new Map(rows.map(r => [String(r.unifiedRegistry?.cityId || '').toLowerCase().replace(/[^a-z0-9]+/g, '_'), r]));
  const truth = [...after].filter(([id, e]) => e.c > 0 && byAttr.has(id)).map(([id, e]) => ({ id, q: e.q, c: e.c, row: byAttr.get(id) }));
  const out = {};
  for (const [name, env] of Object.entries(MODES)) {
    const rule = legacyRule(env), levels = regionRatios(before, rows, env), errs = [];
    for (const t of truth) {
      const stop = { cityId: t.row.unifiedRegistry.cityId, regionFamily: opt._internal.regionFamily(t.row) };
      const m = memoryLevel(before, stop, levels, env, rule);
      const reg = levels.get(stop.regionFamily);
      const level = m ? m.level : (reg && Number.isFinite(reg.ratio) ? Math.max(1, reg.ratio) : 1.3);
      // The plan is good when it is close to the real all-in price and rarely below it.
      const truthLevel = Math.max(1, t.q * 1.05);
      errs.push({ w: Math.min(5, t.c), err: Math.log(level / truthLevel) });
    }
    const W = errs.reduce((s, e) => s + e.w, 0) || 1;
    out[name] = { cities: errs.length, meanAbsLogErr: +(errs.reduce((s, e) => s + e.w * Math.abs(e.err), 0) / W).toFixed(3), underPlanned: +(errs.reduce((s, e) => s + e.w * (e.err < -0.1 ? 1 : 0), 0) / W).toFixed(2), overPlanned: +(errs.reduce((s, e) => s + e.w * (e.err > 0.1 ? 1 : 0), 0) / W).toFixed(2) };
  }
  return out;
}
module.exports = { parseExport, score, MODES };
if (require.main === module) {
  const a = process.argv.slice(2), get = n => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  if (!get('--before') || !get('--after')) { console.error('usage: --before <export.json> --after <export.json>'); process.exit(2); }
  const rows = opt._internal.rows();
  const res = score(parseExport(get('--before')), parseExport(get('--after')), rows);
  if (a.includes('--json')) console.log(JSON.stringify(res, null, 1));
  else { console.log('mode           cities  mean |log err|  under-planned  over-planned'); for (const [m, r] of Object.entries(res)) console.log(`${m.padEnd(14)} ${String(r.cities).padEnd(7)} ${String(r.meanAbsLogErr).padEnd(15)} ${String(Math.round(r.underPlanned * 100) + '%').padEnd(14)} ${Math.round(r.overPlanned * 100)}%`); }
}
