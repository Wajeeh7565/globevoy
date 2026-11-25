#!/usr/bin/env node
// GV-RECS-INV-001: read-only fare-map snapshot for offline replay of real searches.
// Runs the real optimizer on YOUR computer for the chosen origins and budgets (and a few
// study settings, so variants read the same partitions), and saves every fare-map
// partition it reads to a gzip file. Read-only DynamoDB Queries on globevoy-fare-map
// (~a few hundred small Queries, a fraction of a cent). No live checks, no paid
// providers, nothing written to AWS.
//   $env:AWS_REGION="us-east-2"; $env:FARE_MAP_TABLE="globevoy-fare-map"   (AWS credentials exported in the shell)
//   node ops/fare-map/replay-snapshot.mjs                       # Toronto, C$1,500-15,000
//   node ops/fare-map/replay-snapshot.mjs --origins "Toronto (YYZ),London (LHR)" --out <file>
import { createRequire } from 'node:module';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import os from 'node:os';
const require = createRequire(import.meta.url);
const opt = require('../../backend/services/domain/fare-map/fare-map-optimizer.js');
const store = require('../../backend/services/domain/fare-map/fare-map-store.js');

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const origins = arg('--origins', 'Toronto (YYZ)').split(',').map(s => s.trim());
const budgets = arg('--budgets', '1500,2000,3000,4000,5000,7500,10000,15000').split(',').map(Number);
const out = arg('--out', path.join(os.homedir(), 'Downloads', 'globevoy-fare-snapshot.json.gz'));
const VARIANTS = [{}, { FARE_MAP_BIG_STAY_EXTRA: '8' }, { FARE_MAP_POOL_DIVERSITY: 'on' }, { FARE_MAP_BEAM_TARGET: 'on' }, { FARE_MAP_HUGE_MAX_CITIES: '4' }, { FARE_MAP_REGION_QUANTILE: '0.6' }];
const env = { ...process.env, ENABLE_FARE_MAP_OPTIMIZER: 'true' };
if (!store.tableName(env)) { console.error('Set FARE_MAP_TABLE=globevoy-fare-map (and AWS credentials).'); process.exit(2); }

const now = Date.now(), parts = new Map(); let queries = 0;
const read = async (o, m) => {
  const k = o + '|' + m;
  if (!parts.has(k)) { queries++; parts.set(k, await store.readRoutesFrom(o, m, { env, maxPages: 2, limit: 1000, nowMs: now, includeDated: true })); }
  return parts.get(k);
};
for (const origin of origins) for (const budget of budgets) for (const v of VARIANTS) {
  try { await opt.search({ origin, budget, currency: 'CAD', adults: 1 }, { env: { ...env, ...v }, now, readRoutes: read }); }
  catch (e) { console.error(`${origin} C$${budget} ${JSON.stringify(v)}: ${e.message}`); }
}
const body = { kind: 'globevoy-fare-snapshot', version: 1, takenAt: new Date(now).toISOString(), origins, budgets, partitions: Object.fromEntries(parts) };
fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(body)));
const fares = [...parts.values()].reduce((s, a) => s + a.length, 0);
console.log(`Saved ${parts.size} partitions (${fares} fares, ${queries} read-only Queries) to ${out} (${Math.round(fs.statSync(out).size / 1024)} KB).`);
