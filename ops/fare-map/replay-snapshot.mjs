#!/usr/bin/env node
// GV-RECS-INV-001: read-only fare-map snapshot for offline replay of real searches.
//
// Runs the real optimizer on YOUR computer for the chosen origins x budgets x study
// settings, planning hotels with YOUR exported hotel memory, and saves every fare-map
// partition those searches need to a gzip file outside the repository.
//
// Safety (approved 2026-11-25):
//   * Read-only: the DynamoDB client refuses every command except QueryCommand.
//   * Hard limits for the WHOLE run: --max-queries (default 800 Query calls, pagination
//     included), --max-pages per partition (default 2, same as production) and
//     --max-rcu (default 15000 consumed read capacity units, under US$0.01 on demand).
//     When a limit is reached, no further Query is sent; the run still saves and reports.
//   * Paced at --rcu-per-sec (default 50) so production searches are not throttled.
//   * No AWS writes, no live checks, no paid travel providers.
//   * The output must be outside the repository (default ~/Downloads); the repository
//     .gitignore also blocks *fare-snapshot* and hotel-memory exports.
//
// How it collects: each search runs against the local cache only; partitions it asked
// for but the cache lacks are fetched, and the searches run again, until no search asks
// for anything new (or a limit is reached). So every setting in the list sees complete
// data, and the report says which partitions are missing or truncated, per setting.
//
//   $env:AWS_REGION="us-east-2"; $env:FARE_MAP_TABLE="globevoy-fare-map"   (credentials exported)
//   node ops/fare-map/replay-snapshot.mjs                     # Toronto, 8 budgets, ~/Downloads/globevoy-hotel-memory.json
//   node ops/fare-map/replay-snapshot.mjs --dry-run           # no AWS: counts what would be read (empty partitions)
import { createRequire } from 'node:module';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import os from 'node:os'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const opt = require('../../backend/services/domain/fare-map/fare-map-optimizer.js');
const store = require('../../backend/services/domain/fare-map/fare-map-store.js');
const memReport = require('../../tests/performance/hotel-memory-report.cjs');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const origins = arg('--origins', 'Toronto (YYZ)').split(',').map(s => s.trim());
const budgets = arg('--budgets', '1500,2000,3000,4000,5000,7500,10000,15000').split(',').map(Number);
const out = path.resolve(arg('--out', path.join(os.homedir(), 'Downloads', 'globevoy-fare-snapshot.json.gz')));
const memoryFile = arg('--memory-file', path.join(os.homedir(), 'Downloads', 'globevoy-hotel-memory.json'));
const LIMIT = { queries: Number(arg('--max-queries', 800)), pages: Number(arg('--max-pages', 2)), rcu: Number(arg('--max-rcu', 15000)), rcuPerSec: Number(arg('--rcu-per-sec', 50)), rounds: 8 };
const dryRun = argv.includes('--dry-run');
// --simulate: no AWS; serves the benchmark's synthetic fares, to test convergence and estimate Query counts.
const simulate = argv.includes('--simulate');

// Baseline + each study setting that changes which partitions a search reads. Settings
// that only change scoring of already-read routes replay from the same data.
const CLEAN = '2026-11-25T09:23:00Z';
export const VARIANTS = [
  { name: 'baseline' },
  { name: 'memory-shrink', env: { HOTEL_MEMORY_LEGACY: 'shrink', HOTEL_MEMORY_CLEAN_SINCE: CLEAN } },
  { name: 'memory-shrink-p60', env: { HOTEL_MEMORY_LEGACY: 'shrink', HOTEL_MEMORY_CLEAN_SINCE: CLEAN, FARE_MAP_REGION_QUANTILE: '0.6' } },
  { name: 'memory-regional', env: { HOTEL_MEMORY_LEGACY: 'regional', HOTEL_MEMORY_CLEAN_SINCE: CLEAN } },
  { name: 'big-stay-extra-8', env: { FARE_MAP_BIG_STAY_EXTRA: '8' } },
  { name: 'beam-target', env: { FARE_MAP_BEAM_TARGET: 'on' } },
  { name: 'four-cities', env: { FARE_MAP_HUGE_MAX_CITIES: '4' } },
  { name: 'memory-bayes', env: { HOTEL_MEMORY_LEGACY: 'bayes', HOTEL_MEMORY_CLEAN_SINCE: CLEAN } },
  { name: 'read-plan-4', env: { FARE_MAP_HUGE_MAX_CITIES: '4', FARE_MAP_READ_PLAN: 'on' } },
  { name: 'pool-diversity', env: { FARE_MAP_POOL_DIVERSITY: 'on' } },
  { name: 'combined', env: { HOTEL_MEMORY_LEGACY: 'bayes', HOTEL_MEMORY_CLEAN_SINCE: CLEAN, FARE_MAP_BIG_STAY_EXTRA: '8', FARE_MAP_HUGE_MAX_CITIES: '4', FARE_MAP_READ_PLAN: 'on', FARE_MAP_POOL_DIVERSITY: 'on' } }
];

function insideRepo(p) { const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); return !path.relative(repo, p).startsWith('..'); }
function loadMemory(file) {
  if (!fs.existsSync(file)) { console.error(`Hotel memory export not found: ${file}\nPass --memory-file <path> (the export you sent before).`); process.exit(2); }
  const text = fs.readFileSync(file, 'utf8'); const { entries } = memReport.parse(text);
  return { ratios: new Map(entries.map(e => [e.id, { ratio: Math.min(3, Math.max(0.6, e.ratio)), n: e.n, at: e.at }])), sha256: crypto.createHash('sha256').update(text).digest('hex'), entries: entries.length };
}

// Read-only DynamoDB with hard limits and pacing.
function readOnlyClient() {
  const sdk = require('@aws-sdk/client-dynamodb');
  const db = new sdk.DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2', maxAttempts: 2 });
  return { send: (c, o) => { if (!(c instanceof sdk.QueryCommand)) throw Error('replay-snapshot is read-only: only QueryCommand is allowed'); return db.send(c, o); }, sdk };
}
const used = { queries: 0, rcu: 0, throttled: 0, limitHit: null };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchPartition(dbc, o, m, nowMs) {
  const items = []; let key, pages = 0, truncated = false;
  do {
    if (used.queries >= LIMIT.queries) { used.limitHit ??= 'max-queries'; return { status: 'capped', items }; }
    if (used.rcu >= LIMIT.rcu) { used.limitHit ??= 'max-rcu'; return { status: 'capped', items }; }
    used.queries++;
    let res;
    try {
      res = await dbc.send(new dbc.sdk.QueryCommand({ TableName: process.env.FARE_MAP_TABLE, KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': { S: `F#${o}#${m}` } }, ExclusiveStartKey: key, Limit: 1000, ReturnConsumedCapacity: 'TOTAL' }));
    } catch (e) { if (/Throttl|ProvisionedThroughput/.test(e.name || '')) used.throttled++; return { status: 'error', error: e.name || e.message, items }; }
    const rcu = Number(res.ConsumedCapacity?.CapacityUnits) || 0; used.rcu += rcu;
    if (rcu) await sleep(Math.ceil(1000 * rcu / LIMIT.rcuPerSec));
    items.push(...(res.Items || []));
    key = res.LastEvaluatedKey; pages++;
  } while (key && pages < LIMIT.pages);
  truncated = Boolean(key);
  // Same filtering and de-duplication as store.readRoutesFrom (production read path).
  const fake = { send: async () => ({ Items: items }) };
  const fares = await store.readRoutesFrom(o, m, { env: { FARE_MAP_TABLE: 'snapshot' }, dynamo: fake, maxPages: 1, nowMs, includeDated: true });
  return { status: truncated ? 'truncated' : (fares.length ? 'ok' : 'empty'), items: fares };
}

async function main() {
  if (insideRepo(out)) { console.error(`Refusing to write inside the repository: ${out}. Keep the snapshot local (default ~/Downloads).`); process.exit(2); }
  if (!dryRun && !simulate && !store.tableName(process.env)) { console.error('Set FARE_MAP_TABLE=globevoy-fare-map and AWS_REGION=us-east-2 (and export AWS credentials).'); process.exit(2); }
  const mem = loadMemory(memoryFile);
  const dbc = dryRun || simulate ? null : readOnlyClient();
  let simReader; const simFetch = async (o, m) => { simReader ||= require('../../tests/performance/recommendation-benchmark.cjs').fareReader(); used.queries++; if (used.queries >= LIMIT.queries) used.limitHit ??= 'max-queries'; const items = await simReader(o, m); return { status: items.length ? 'ok' : 'empty', items }; };
  const now = simulate ? require('../../tests/performance/recommendation-benchmark.cjs').NOW : Date.now(), parts = new Map(), status = new Map();
  const cases = []; for (const origin of origins) for (const budget of budgets) for (const v of VARIANTS) cases.push({ origin, budget, v });
  const missing = new Map(); // case index -> Set of partitions it asked for that we do not have
  let round = 0;
  for (; round < LIMIT.rounds; round++) {
    const wanted = new Set();
    for (let i = 0; i < cases.length; i++) {
      const { origin, budget, v } = cases[i], miss = new Set();
      const read = async (o, m) => { const k = o + '|' + m; if (parts.has(k)) return parts.get(k); miss.add(k); wanted.add(k); return []; };
      try { await opt.search({ origin, budget, currency: 'CAD', adults: 1 }, { env: { ENABLE_FARE_MAP_OPTIMIZER: 'true', FARE_MAP_TABLE: 'snapshot', ...(v.env || {}) }, now, readRoutes: read, hotelRatios: mem.ratios }); }
      catch (e) { console.error(`${origin} C$${budget} ${v.name}: ${e.message}`); }
      missing.set(i, miss);
    }
    const todo = [...wanted].filter(k => !status.has(k));
    console.log(`round ${round + 1}: ${wanted.size} partitions missing, ${todo.length} new to read (queries ${used.queries}/${LIMIT.queries}, RCU ${used.rcu.toFixed(1)}/${LIMIT.rcu})`);
    if (!todo.length) break;
    for (const k of todo) {
      const [o, m] = k.split('|');
      const r = dryRun ? { status: 'empty', items: [] } : simulate ? await simFetch(o, m) : await fetchPartition(dbc, o, m, now);
      status.set(k, r.status === 'capped' ? 'capped' : r.status);
      if (r.status !== 'capped' && r.status !== 'error') parts.set(k, r.items);
      if (used.limitHit) break;
    }
    if (used.limitHit) { console.log(`Read limit reached (${used.limitHit}); stopping collection.`); round++; break; }
  }
  // Final pass: what each setting still lacks.
  const perVariant = {};
  for (let i = 0; i < cases.length; i++) {
    const { v } = cases[i], miss = new Set();
    const read = async (o, m) => { const k = o + '|' + m; if (!parts.has(k)) miss.add(k); return parts.get(k) || []; };
    try { await opt.search({ origin: cases[i].origin, budget: cases[i].budget, currency: 'CAD', adults: 1 }, { env: { ENABLE_FARE_MAP_OPTIMIZER: 'true', FARE_MAP_TABLE: 'snapshot', ...(v.env || {}) }, now, readRoutes: read, hotelRatios: mem.ratios }); } catch (_) {}
    const s = (perVariant[v.name] ||= { searches: 0, searchesMissingData: 0, missingPartitions: new Set() });
    s.searches++; if (miss.size) s.searchesMissingData++; miss.forEach(k => s.missingPartitions.add(k));
  }
  const counts = {}; for (const s of status.values()) counts[s] = (counts[s] || 0) + 1;
  const coverage = { rounds: round, partitionStatus: counts, truncated: [...status].filter(([, s]) => s === 'truncated').map(([k]) => k), errors: [...status].filter(([, s]) => s === 'error').map(([k]) => k), perVariant: Object.fromEntries(Object.entries(perVariant).map(([n, s]) => [n, { searches: s.searches, searchesMissingData: s.searchesMissingData, missingPartitions: [...s.missingPartitions] }])) };
  const body = { kind: 'globevoy-fare-snapshot', version: 2, takenAt: new Date(now).toISOString(), origins, budgets, variants: VARIANTS, memory: { file: path.basename(memoryFile), sha256: mem.sha256, entries: mem.entries }, limits: LIMIT, usage: used, coverage, partitions: Object.fromEntries(parts) };
  if (!dryRun && (!simulate || argv.includes('--out'))) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(body))); }
  const fares = [...parts.values()].reduce((s, a) => s + a.length, 0);
  console.log(`\n${dryRun || simulate ? 'DRY/SIMULATED RUN (nothing read from AWS or saved)' : 'Saved ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)'}`);
  console.log(`Partitions: ${parts.size} stored, ${fares} fares | status ${JSON.stringify(counts)}`);
  console.log(`Usage: ${used.queries} Query calls, ${used.rcu.toFixed(1)} RCU, ${used.throttled} throttled${used.limitHit ? ', LIMIT HIT: ' + used.limitHit : ''}`);
  console.log(`Hotel memory: ${mem.entries} entries (sha256 ${mem.sha256.slice(0, 12)})`);
  console.log('Coverage per setting (searches still missing data / missing partitions):');
  for (const [n, s] of Object.entries(coverage.perVariant)) console.log(`  ${n.padEnd(18)} ${s.searchesMissingData}/${s.searches} searches, ${s.missingPartitions.length} partitions`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(2); });
