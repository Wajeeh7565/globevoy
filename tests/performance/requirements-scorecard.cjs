#!/usr/bin/env node
'use strict';
// GV-RECS-V2 scorecard: Wajeeh's recommendation requirements (Nov 27, 2026) measured on
// recommendation-investigation.cjs --json runs.
//   node tests/performance/requirements-scorecard.cjs base.json candidate.json [--cases]
// Per budget (guest first trip + member trips; Best Use = the member "best use" role):
//   bestUse   median Best Use cost / ENTERED budget (target 85-90%)
//   in85-90   share of Best Use trips at 85-90% of the entered budget
//   intl      trips with a city outside the origin country
//   europeNA  North American origins: trips with a European city (requirement: C$1,500 Europe)
//   multi     trips with 2+ cities (requirement above C$1,500)
//   mCountry  trips spanning 2+ countries (requirement from C$2,000)
//   sameCtry  2+ city trips inside one country (to avoid, e.g. Nashville + Dallas)
//   hopKm     median longest hop between the trip's own cities (geographic coherence)
//   stayOk    trips whose every stop has 2-10 nights
//   miss      searches with no trip of the required shape, by recorded reason
//   distinct  distinct routes over all trips shown (variety)
//   found     searches with at least one trip shown (no-result searches are counted, not hidden)
//   liveBest  median Best Use / entered budget on the simulated live page (signed in), after
//             the live step (hotel choice, upgrades); guestUse the same for the guest's one trip
//   lowUse    median Lowest Cost / entered budget (target about 50%); lowAbr Lowest Cost abroad
const fs = require('fs'), path = require('path');
const cat = require(path.join(__dirname, '../../backend/data/global-destination-catalogue.json')).destinations;
const continentVotes = {}, geo = new Map();
for (const c of cat) {
  let z = String(c.timeZone || '/').split('/')[0];
  z = { Pacific: 'Oceania', Australia: 'Oceania', Atlantic: 'Island', Indian: 'Island' }[z] || z;
  (continentVotes[c.countryCode] ||= {})[z] = (continentVotes[c.countryCode][z] || 0) + 1;
  const slug = String(c.canonicalCityName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + String(c.countryCode).toLowerCase();
  if (!geo.has(slug)) geo.set(slug, [c.latitude, c.longitude]);
}
const continent = cc => { const v = continentVotes[cc]; return v ? Object.entries(v).sort((a, b) => b[1] - a[1])[0][0] : null; };
const rad = x => x * Math.PI / 180;
const km = (a, b) => 6371 * 2 * Math.asin(Math.sqrt(Math.sin(rad(b[0] - a[0]) / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2));
const hop = t => { const p = t.cities.map(c => geo.get(c)); if (p.length < 2 || p.some(x => !x)) return null; let m = 0; for (let i = 1; i < p.length; i++) m = Math.max(m, km(p[i - 1], p[i])); return m; };
const pct = xs => { const v = xs.filter(x => x != null); return v.length ? Math.round(100 * v.filter(Boolean).length / v.length) : null; };
const median = xs => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };

function score(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8')), rows = [];
  for (const b of [...new Set(j.cases.map(c => c.budgetCad))].sort((a, b) => a - b)) {
    const cs = j.cases.filter(c => c.budgetCad === b);
    const best = cs.map(c => c.roles?.bestUse).filter(Boolean);
    const trips = [...cs.map(c => c.guest[0]).filter(Boolean), ...cs.flatMap(c => c.member)];
    const na = trips.filter(t => ['CA', 'US', 'MX'].includes(t.originCountry));
    const miss = {};
    for (const c of cs) { const r = c.d?.requirementCheck?.missReason; if (r) miss[r] = (miss[r] || 0) + 1; }
    const vb = cs.flatMap(c => (c.verified?.signedIn?.shown || []).filter(t => t.role === 'best-balance').map(t => t.enteredBudgetUse));
    const vg = cs.flatMap(c => (c.verified?.signedOut?.shown || []).slice(0, 1).map(t => t.enteredBudgetUse));
    const low = cs.map(c => c.roles?.lowestCost).filter(Boolean);
    rows.push({ budget: b, found: pct(cs.map(c => c.guest.length > 0 || c.member.length > 0)), bestUse: best.length ? Math.round(100 * median(best.map(t => t.use))) : null,
      'in85-90': pct(best.map(t => t.use >= 0.85 && t.use <= 0.90)),
      intl: pct(trips.map(t => t.stopCountries.some(s => s !== t.originCountry))),
      europeNA: pct(na.map(t => t.stopCountries.some(s => continent(s) === 'Europe'))),
      multi: pct(trips.map(t => t.cityCount >= 2)), mCountry: pct(trips.map(t => t.countries >= 2)),
      sameCtry: pct(trips.map(t => t.cityCount >= 2 && t.countries === 1)),
      hopKm: (h => h == null ? null : Math.round(h))(median(trips.map(hop))),
      stayOk: pct(trips.map(t => t.stopNights.every(n => n >= 2 && n <= 10))),
      liveBest: vb.length ? Math.round(100 * median(vb)) : null, guestUse: vg.length ? Math.round(100 * median(vg)) : null,
      lowUse: low.length ? Math.round(100 * median(low.map(t => t.use))) : null, lowAbr: pct(low.map(t => t.stopCountries.every(s => s !== t.originCountry))),
      miss: Object.entries(miss).map(([k, v]) => `${k}:${v}`).join(',') || '-' });
  }
  const shown = j.cases.flatMap(c => [...c.guest, ...c.member]).map(t => t.cities.join('>'));
  return { file, rows, distinct: new Set(shown).size, shown: shown.length, env: j.env || null };
}
if (require.main === module) {
  for (const f of process.argv.slice(2).filter(a => !a.startsWith('--'))) {
    const r = score(f), keys = Object.keys(r.rows[0] || {});
    console.log(`\n== ${path.basename(f)}  distinct routes ${r.distinct}/${r.shown}`);
    console.log(keys.map(k => k.padStart(9)).join(' '));
    for (const row of r.rows) console.log(keys.map(k => String(row[k] ?? '-').padStart(9)).join(' '));
  }
}
module.exports = { score };
