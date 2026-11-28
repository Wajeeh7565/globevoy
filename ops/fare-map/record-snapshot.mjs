#!/usr/bin/env node
// GV-RECS-SNAPSHOT-003: read-only recording of everything the recommendation search reads, for
// offline replay with REAL data: monthly fares (F#), daily dates (D#, flights home and between
// cities), the hotel Price Index (PI#city) and hotel price memory (MEM#hotel).
//
// The real optimizer runs on this computer for origins x budgets x the settings in
// ops/fare-map/replay-settings.json (production plus variants). Each round runs every search
// against what is already recorded, collects what the searches asked for and lacked, and reads
// only that; it repeats until nothing new is asked for (or a limit is reached). The replay
// (tests/performance/recommendation-investigation.cjs --fare-snapshot <file>) then sees exactly
// the data each search reads.
//
// Safety: the DynamoDB client refuses every command except Query, GetItem and BatchGetItem.
// Hard limits for the whole run: --max-calls (default 6000 DynamoDB calls) and --max-rcu
// (default 40000 consumed read units, about US$0.01 on demand), paced at --rcu-per-sec
// (default 120) so production searches are not throttled. No writes, no paid providers.
// The output must be outside the repository (default ~/Downloads).
//
//   $env:AWS_REGION="us-east-2"; $env:FARE_MAP_TABLE="globevoy-fare-map"
//   node ops/fare-map/record-snapshot.mjs --origins "Toronto (YYZ),London (LHR)" --variants production,candidate
import { createRequire } from 'node:module';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path'; import os from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const opt = require('../../backend/services/domain/fare-map/fare-map-optimizer.js');
const store = require('../../backend/services/domain/fare-map/fare-map-store.js');
const dates = require('../../backend/services/domain/fare-map/fare-map-dates.js');
const hotelMemory = require('../../backend/services/domain/live-fares/hotel-price-memory.js');
const priceIndexStore = require('../../backend/services/domain/pricing/hotel-price-index/store.js');
const settings = JSON.parse(fs.readFileSync(new URL('./replay-settings.json', import.meta.url), 'utf8'));

const argv = process.argv.slice(2), arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const ORIGINS = 'Toronto (YYZ),Vancouver (YVR),New York (JFK),Los Angeles (LAX),Mexico City (MEX),London (LHR),Paris (PAR),Dubai (DXB),Singapore (SIN),Sydney (SYD)';
const origins = arg('--origins', ORIGINS).split(',').map(s => s.trim());
const budgets = arg('--budgets', '1500,2000,3000,4000,5000,7500,10000,15000').split(',').map(Number);
const variantNames = arg('--variants', Object.keys(settings.variants).join(',')).split(',').map(s => s.trim());
const travellers = arg('--adults', '1').split(',').map(Number);
const out = path.resolve(arg('--out', path.join(os.homedir(), 'Downloads', 'globevoy-fare-snapshot-v3.json.gz')));
const LIMIT = { calls: Number(arg('--max-calls', 6000)), rcu: Number(arg('--max-rcu', 40000)), rcuPerSec: Number(arg('--rcu-per-sec', 120)), rounds: 10 };
const dryRun = argv.includes('--dry-run');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
if (!path.relative(repo, out).startsWith('..')) { console.error('Refusing to write inside the repository: ' + out); process.exit(2); }
const table = process.env.FARE_MAP_TABLE;
if (!dryRun && !table) { console.error('Set FARE_MAP_TABLE=globevoy-fare-map and AWS_REGION=us-east-2.'); process.exit(2); }

const used = { calls: 0, rcu: 0, throttled: 0, errors: 0, limitHit: null };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALLOWED = new Set(['QueryCommand', 'GetItemCommand', 'BatchGetItemCommand']);
let sdkClient = null;
const readOnly = { async send(command, o) {
  const name = command?.constructor?.name;
  if (!ALLOWED.has(name)) throw Error('record-snapshot is read-only: ' + name + ' refused');
  if (used.calls >= LIMIT.calls) { used.limitHit ??= 'max-calls'; throw Error('limit'); }
  if (used.rcu >= LIMIT.rcu) { used.limitHit ??= 'max-rcu'; throw Error('limit'); }
  if (dryRun) { used.calls++; return {}; }
  if (!sdkClient) { const { DynamoDBClient } = require('@aws-sdk/client-dynamodb'); sdkClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2', maxAttempts: 4, requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 } }); }
  command.input.ReturnConsumedCapacity = 'TOTAL'; used.calls++;
  let res; try { res = await sdkClient.send(command, o); } catch (e) { if (/Throttl|ProvisionedThroughput/.test(e.name || '')) used.throttled++; used.errors++; throw e; }
  const cc = res.ConsumedCapacity, rcu = Array.isArray(cc) ? cc.reduce((n, c) => n + (Number(c.CapacityUnits) || 0), 0) : Number(cc?.CapacityUnits) || 0;
  used.rcu += rcu; if (rcu) await sleep(Math.ceil(1000 * rcu / LIMIT.rcuPerSec));
  return res;
} };

// --resume <earlier snapshot>: keep its time, data, price index and memory; read only what is still missing.
const resumeFile = arg('--resume', null), prior = resumeFile ? JSON.parse(zlib.gunzipSync(fs.readFileSync(path.resolve(resumeFile))).toString('utf8')) : null;
const now = prior ? Date.parse(prior.takenAt) : Date.now(), env0 = { ENABLE_FARE_MAP_OPTIMIZER: 'true', FARE_MAP_TABLE: table || 'snapshot', ...settings.production };
const parts = new Map(), dateRows = new Map(); // "o|m" -> fares ; "a>b|m" -> records
const monthsFor = after => { const a = String(after || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(a)) return []; return [...new Set([a.slice(0, 7), opt._internal.plus(a, 31).slice(0, 7)])]; };

async function main() {
  if (prior) { for (const [k, v] of Object.entries(prior.partitions || {})) parts.set(k, v); for (const [k, v] of Object.entries(prior.dates || {})) dateRows.set(k, v); for (const k of prior.dateKeysEmpty || []) dateRows.set(k, []); console.log(`resumed ${parts.size} partitions, ${dateRows.size} date rows from ${resumeFile}`); }
  const memory = prior ? new Map(prior.memory) : dryRun ? new Map() : await hotelMemory.load({ env: env0, dynamo: readOnly, fresh: true });
  const priceIndex = prior ? new Map(prior.priceIndex.map(x => [x.cityId, x])) : dryRun ? new Map() : await priceIndexStore.loadAll({ env: env0, dynamo: readOnly, fresh: true });
  console.log(`hotel memory ${memory.size} cities, price index ${priceIndex.size} cities`);
  const cases = [];
  for (const origin of origins) for (const budget of budgets) for (const adults of travellers) for (const v of variantNames) cases.push({ origin, budget, adults, v, env: { ...env0, ...(settings.variants[v] || {}) } });
  let round = 0;
  for (; round < LIMIT.rounds; round++) {
    const wantParts = new Set(), wantDates = new Set();
    const readRoutes = async (o, m) => { const k = o + '|' + m; if (parts.has(k)) return parts.get(k); wantParts.add(k); return []; };
    const dateFn = async (a, b, after) => { const got = []; for (const m of monthsFor(after)) { const k = a + '>' + b + '|' + m; if (dateRows.has(k)) got.push(...dateRows.get(k)); else wantDates.add(k); } return got; };
    for (const c of cases) {
      try { await opt.search({ origin: c.origin, budget: c.budget, currency: 'CAD', adults: c.adults }, { env: c.env, now, readRoutes, routeDates: dateFn, legDates: dateFn, hotelRatios: memory, priceIndex, allowCityExpansion: true, timeBudgetMs: 15000 }); }
      catch (e) { if (!/limit/.test(e.message)) console.error(`${c.origin} C$${c.budget} ${c.v}: ${e.message}`); }
    }
    const tp = [...wantParts], td = [...wantDates];
    console.log(`round ${round + 1}: ${tp.length} fare partitions, ${td.length} date rows to read (calls ${used.calls}/${LIMIT.calls}, RCU ${used.rcu.toFixed(0)}/${LIMIT.rcu})`);
    if (!tp.length && !td.length) break;
    // Fare partitions: the production read path (2 pages of 1000, same filtering).
    for (let i = 0; i < tp.length && !used.limitHit; i += 8) await Promise.all(tp.slice(i, i + 8).map(async k => {
      const [o, m] = k.split('|');
      // A failed read is not recorded, so the next round asks again (it is never stored as empty).
      try { parts.set(k, await store.readRoutesFrom(o, m, { env: env0, dynamo: readOnly, maxPages: 2, limit: 1000, nowMs: now, includeDated: true })); } catch (_) { used.failedReads = (used.failedReads || 0) + 1; }
    }));
    // Date rows: BatchGetItem, 100 keys per call.
    for (let i = 0; i < td.length && !used.limitHit; i += 100) {
      const keys = td.slice(i, i + 100).map(k => { const [pair, m] = k.split('|'), [a, b] = pair.split('>'); return { k, a, b, m }; });
      let req = { [table]: { Keys: keys.map(x => ({ pk: { S: `D#${x.a}#${x.m}` }, sk: { S: x.b } })) } }; const got = []; let ok = true;
      try {
        for (let t = 0; t < 5 && req; t++) {
          const r = await readOnly.send(store._internal.cmd('BatchGetItemCommand', { RequestItems: req }));
          got.push(...(r.Responses?.[table] || []));
          req = r.UnprocessedKeys && Object.keys(r.UnprocessedKeys).length ? r.UnprocessedKeys : null; if (req) await sleep(200 * 2 ** t);
        }
      } catch (_) { ok = false; used.failedReads = (used.failedReads || 0) + 1; if (used.limitHit) break; }
      if (!ok || req) continue; // unfinished batch: asked again next round
      const byKey = new Map(got.filter(it => Number(it?.ttl?.N || 0) * 1000 > now).map(it => { const [, o, m] = it.pk.S.split('#'); return [o + '>' + it.sk.S + '|' + m, dates.fromRouteItem(it)]; }));
      for (const x of keys) dateRows.set(x.k, byKey.get(x.k) || []);
    }
    if (used.limitHit) { console.log('Read limit reached (' + used.limitHit + '); stopping.'); round++; break; }
  }
  const body = { kind: 'globevoy-fare-snapshot', version: 3, takenAt: new Date(now).toISOString(), origins, budgets, adults: travellers, variants: Object.fromEntries(variantNames.map(v => [v, settings.variants[v] || {}])), production: settings.production,
    limits: LIMIT, usage: used, partitions: Object.fromEntries(parts), dates: Object.fromEntries([...dateRows].filter(([, v]) => v.length)), dateKeysEmpty: [...dateRows].filter(([, v]) => !v.length).map(([k]) => k),
    priceIndex: [...priceIndex.values()], memory: [...memory] };
  if (!dryRun) fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(body)));
  const fares = [...parts.values()].reduce((n, a) => n + a.length, 0), dated = [...dateRows.values()].filter(v => v.length).length;
  console.log(`${dryRun ? 'DRY RUN' : 'Saved ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)'}: ${parts.size} partitions (${fares} fares), ${dateRows.size} date rows asked (${dated} with dates), ${priceIndex.size} price-index cities, ${memory.size} memory cities`);
  console.log(`Usage: ${used.calls} DynamoDB calls, ${used.rcu.toFixed(0)} RCU, ${used.throttled} throttled, ${used.errors} errors (${used.failedReads || 0} reads retried)${used.limitHit ? ', LIMIT HIT ' + used.limitHit : ''}`);
}
main().catch(e => { console.error(e); process.exit(2); });
