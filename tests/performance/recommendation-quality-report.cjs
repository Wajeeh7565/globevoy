#!/usr/bin/env node
'use strict';
// GV-DATA-BENCH-001: recommendation quality report from recommendation-investigation.cjs --json runs.
//   node tests/performance/recommendation-quality-report.cjs before.json after.json [more.json ...]
// Per budget, for the first trip a guest sees and the 3 trips a member sees:
//   use        live-checked cost / entered budget; band = share of trips at 80-90%
//   intl       share of trips with at least one city outside the origin country
//   allIntl    share with every city outside the origin country
//   ctry       countries per trip; multiCtry = share of 2+ city trips spanning 2+ countries
//   sameCtry   share of 2+ city trips inside ONE country (e.g. two US cities)
//   goodHotel  share of stops in cities with >= 20 well-reviewed 3-4 star properties (Agoda feed)
//   stayOk     share of stops with 2-10 nights (not a 1-night hop, not 3 weeks in one place)
//   realDates  share of flight legs on a cached (not estimated) date
//   good       share of trips that pass ALL of: international, multi-country when 2+ cities,
//              every stop goodHotel and stayOk, use 70-95%. This is the quality bar, not a score.
//   distinct   distinct cities shown across all searches; disc = trips with a discovered city
const fs = require('fs');
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0), pct = x => Math.round(100 * x);
function tripStats(t) {
  const intlStops = t.stopCountries.map(c => c && c !== t.originCountry), multi = t.cityCount > 1;
  const good = t.goodHotels.map(g => g != null && g >= 20), stay = t.stopNights.map(n => n >= 2 && n <= 10);
  const u = t.use;
  return { use: u, band: u >= 0.8 && u <= 0.9, intl: intlStops.some(Boolean), allIntl: intlStops.every(Boolean), ctry: t.countries,
    multiCtry: multi ? t.countries > 1 : null, sameCtry: multi ? t.countries === 1 : null, goodHotel: mean(good.map(Number)), stayOk: mean(stay.map(Number)),
    realDates: t.legCount ? 1 - t.estimatedLegs / t.legCount : 0, disc: t.discovered.some(Boolean),
    good: intlStops.some(Boolean) && (!multi || t.countries > 1) && good.every(Boolean) && stay.every(Boolean) && u >= 0.7 && u <= 0.95 };
}
function report(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8')), byB = {};
  for (const c of j.cases) (byB[c.budgetCad] = byB[c.budgetCad] || []).push(c);
  const rows = {};
  for (const [b, g] of Object.entries(byB)) {
    const trips = [...g.map(c => c.guest[0]).filter(Boolean), ...g.flatMap(c => c.member)].map(tripStats);
    const m = k => mean(trips.map(x => x[k]).filter(v => v != null).map(Number));
    const roleUse = k => { const v = g.map(c => c.roles?.[k]).filter(Boolean); return v.length ? pct(mean(v.map(t => t.use))) : null; };
    const roleBand = k => { const v = g.map(c => c.roles?.[k]).filter(Boolean); return v.length ? pct(mean(v.map(t => t.use >= 0.8 && t.use <= 0.9 ? 1 : 0))) : null; };
    rows[b] = { bestUseUse: roleUse('bestUse'), bestUseBand: roleBand('bestUse'), lowestUse: roleUse('lowestCost'), trips: trips.length, use: pct(m('use')), band: pct(m('band')), intl: pct(m('intl')), allIntl: pct(m('allIntl')), ctry: +m('ctry').toFixed(2), multiCtry: pct(m('multiCtry')), sameCtry: pct(m('sameCtry')),
      goodHotel: pct(m('goodHotel')), stayOk: pct(m('stayOk')), realDates: pct(m('realDates')), good: pct(m('good')), disc: pct(m('disc')) };
  }
  const shown = j.cases.flatMap(c => c.guest);
  return { file, rows, distinct: new Set(shown.flatMap(t => t.cities)).size, refreshRepeat: pct(mean(j.cases.filter(c => c.guest.length > 1).map(c => { const a = c.guest.flatMap(t => t.cities); return a.length > new Set(a).size ? 1 : 0; }))), settings: j.env };
}
const reps = process.argv.slice(2).filter(a => !a.startsWith('--')).map(report), keys = ['bestUseUse', 'bestUseBand', 'lowestUse', 'use', 'band', 'intl', 'allIntl', 'ctry', 'multiCtry', 'sameCtry', 'goodHotel', 'stayOk', 'realDates', 'good', 'disc'];
if (process.argv.includes('--json')) { console.log(JSON.stringify(reps, null, 1)); process.exit(0); }
for (const r of reps) {
  console.log(`\n== ${r.file}  settings ${JSON.stringify(r.settings)}  distinct cities shown ${r.distinct}, refresh repeats ${r.refreshRepeat}%`);
  console.log('budget  ' + keys.map(k => k.padStart(9)).join(''));
  for (const [b, v] of Object.entries(r.rows)) console.log(`C$${String(b).padEnd(6)}` + keys.map(k => String(v[k] + (k === 'ctry' || v[k] == null ? '' : '%')).padStart(9)).join(''));
}
