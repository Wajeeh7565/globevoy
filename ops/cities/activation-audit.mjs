#!/usr/bin/env node
// GV-CITY-AUDIT-001: offline audit of registry cities that are inactive ONLY because of
// validation.bothProvidersMapped (Travelpayouts AND Agoda static mappings, from GV-CITY-668B).
// Agoda is no longer the hotel provider (hotels are priced live by Nuitee), so the audit asks
// what the CURRENT architecture needs instead, per city:
//   flights (planning)  Travelpayouts location code, so the fare map can hold the city
//   flights (live)      a physical IATA airport for the Ignav live check
//   hotels (planning)   a nightly model price and recommended stay lengths
//   hotels (live)       city name + country code for the Nuitee rates search
//   presentation        city character (themes) and a resolvable part of the world
//   evidence            seen as a destination in real fare data (--fare-snapshot), hotel memory
// Nothing here activates a city: activation still needs live flight AND hotel verification.
// No network, no AWS. Writes .cache/city-activation-audit.json.
//   node ops/cities/activation-audit.mjs [--fare-snapshot <file.json.gz>] [--memory-file <export.json>]
import { createRequire } from 'node:module';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const opt = require(path.join(root, 'backend/services/domain/fare-map/fare-map-optimizer.js'));
const graph = require(path.join(root, 'backend/services/domain/routing/global-route-graph.js'));
const mappings = require(path.join(root, 'backend/data/provider-mappings-1000-668b.json'));
const intel = new Set((require(path.join(root, 'backend/data/city-intelligence-510c.json')).records || []).map(r => r.cityId));
const argv = process.argv.slice(2), arg = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

const rows = opt._internal.rows(), eligible = opt._internal.eligible;
const mapBy = new Map((mappings.records || []).map(r => [r.cityId, r]));
const onlyFlag = rows.filter(r => !eligible(r)).filter(r => { const c = structuredClone(r); c.unifiedRegistry.validation = { ...(c.unifiedRegistry.validation || {}), bothProvidersMapped: true }; return eligible(c); });

// Evidence from real fare data: destinations seen in any snapshot partition.
const seenDest = new Map();
if (arg('--fare-snapshot')) {
  const body = JSON.parse(zlib.gunzipSync(fs.readFileSync(arg('--fare-snapshot'))).toString('utf8'));
  for (const fares of Object.values(body.partitions || {})) for (const f of fares) seenDest.set(f.destination, (seenDest.get(f.destination) || 0) + 1);
}
const memIds = new Set();
if (arg('--memory-file')) { const raw = JSON.parse(fs.readFileSync(arg('--memory-file'), 'utf8').replace(/^﻿/, '')); for (const k of Object.keys(raw.Item || raw)) if (k.startsWith('r_')) memIds.add(k.slice(2)); }

const KNOWN = new Set(['europe', 'latin-america', 'asia', 'africa', 'oceania', 'north-america']);
const audit = onlyFlag.map(r => {
  const u = r.unifiedRegistry, m = mapBy.get(u.cityId) || {}, code = opt._internal.code(r);
  const physical = (m.travelpayouts?.physicalAirports || []).filter(a => a.flightable !== false && /^[A-Z]{3}$/.test(a.code || ''));
  const checks = {
    travelpayoutsCode: Boolean(code && m.coverage?.travelpayoutsMapped),
    iataAirport: physical.length > 0,
    internationalAirport: u.origin?.internationalAirportSignal === true,
    nightlyModel: graph._internal.nightlyUsd(r) > 0,
    stayLengths: Number(u.destination?.minimumRecommendedNights) > 0 && Number(u.destination?.maximumRecommendedNights) > 0,
    nuiteeSearchable: Boolean(u.displayName && /^[A-Z]{2}$/.test(u.countryCode || '')),
    cityCharacter: intel.has(u.cityId),
    regionResolved: KNOWN.has(opt._internal.regionFamily(r)),
    regionFromCluster: KNOWN.has(String(opt._internal.regionFamily({ unifiedRegistry: { destination: { regionCluster: u.destination?.regionCluster } } }))),
    agodaMapped: m.coverage?.agodaMapped === true
  };
  const evidence = { fareMapDestination: seenDest.get(code) || 0, hotelMemory: memIds.has(String(u.cityId).toLowerCase().replace(/[^a-z0-9]+/g, '_')) };
  const staticReady = checks.travelpayoutsCode && checks.iataAirport && checks.nightlyModel && checks.stayLengths && checks.nuiteeSearchable && checks.regionResolved;
  const tier = !staticReady ? 'C-missing-static-data' : checks.cityCharacter ? 'A-ready-for-live-verification' : 'B-ready-for-live-verification-needs-city-character';
  return { cityId: u.cityId, name: u.displayName, countryCode: u.countryCode, family: opt._internal.regionFamily(r), airport: code, tier, checks, evidence };
});

const count = f => audit.filter(f).length, by = k => audit.reduce((o, a) => (o[a[k]] = (o[a[k]] || 0) + 1, o), {});
const summary = {
  generatedAt: new Date().toISOString(), inactiveOnlyBecauseOfBothProvidersMapped: audit.length,
  checks: Object.fromEntries(Object.keys(audit[0]?.checks || {}).map(k => [k, count(a => a.checks[k])])),
  tiers: by('tier'), families: by('family'), countries: new Set(audit.map(a => a.countryCode)).size,
  evidence: { seenInFareData: count(a => a.evidence.fareMapDestination > 0), inHotelMemory: count(a => a.evidence.hotelMemory), snapshot: Boolean(arg('--fare-snapshot')) }
};
const out = path.join(root, '.cache', 'city-activation-audit.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ summary, cities: audit }, null, 1));
console.log(JSON.stringify(summary, null, 1));
console.log('Per-city detail:', path.relative(process.cwd(), out));
