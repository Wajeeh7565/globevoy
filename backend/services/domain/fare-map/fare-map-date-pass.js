'use strict';
// GV-DATA-DATES-003 — collector date pass (EC2, after the main fare-map pass; not scheduled).
//
// The main pass keeps one cheapest fare per origin, destination and month. For each origin
// and month this pass takes the N cheapest routes already in the fare map and asks
// Travelpayouts' free /v2/prices/month-matrix for every day of the month, in BOTH
// directions (out and home), with the number of stops. Rows go to their own keys
// (pk "D#<ORIGIN>#<YYYY-MM>", sk "<DEST>#<YYYY-MM-DD>", 7-day TTL), so the existing
// fare-map rows, reads and Lambda are unchanged; the search reads them per route when it
// plans a flight home (FARE_MAP_ROUTE_DATES=on).
//
// Bounded: --routes per origin-month (default 30), --max-requests per run (default 60,000),
// paced at --per-minute (default 250; the endpoint allows 300). Free API; DynamoDB writes
// only (about 9 rows per route-month measured on 2,051 routes).

const dates = require('./fare-map-dates');
const store = require('./fare-map-store');
const ingest = require('./fare-map-ingest');

async function writeItems(items, { env, dynamo, sleep }) {
  const table = store.tableName(env);
  if (!table) throw new Error('FARE_MAP_TABLE not configured');
  const db = dynamo || store._internal.client({});
  let written = 0;
  for (let i = 0; i < items.length; i += 25) {
    let req = { [table]: items.slice(i, i + 25).map(Item => ({ PutRequest: { Item } })) };
    for (let attempt = 0; attempt < 5 && req; attempt++) {
      const out = await db.send(store._internal.cmd('BatchWriteItemCommand', { RequestItems: req }));
      const left = out?.UnprocessedItems?.[table];
      written += req[table].length - (left?.length || 0);
      req = left?.length ? { [table]: left } : null;
      if (req) await sleep(100 * 2 ** attempt);
    }
  }
  return written;
}

async function runDatePass(options = {}) {
  const env = options.env || process.env, clock = options.clock || Date.now, sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const origins = options.origins || ingest.originCodesFromRegistry(require('../../../data/unified-city-registry-1000.json'));
  const months = options.months || ingest.upcomingMonths(Number(options.monthCount) || 6, clock());
  const perOD = Math.max(1, Math.min(200, Number(options.routes) || 30));
  const maxRequests = Math.max(1, Number(options.maxRequests) || 60000);
  const interval = 60000 / Math.max(1, Math.min(300, Number(options.perMinute) || 250));
  const read = options.readRoutes || ((o, m) => store.readRoutesFrom(o, m, { env, dynamo: options.dynamo, maxPages: 2, limit: 1000, nowMs: clock() }));
  const stats = { origins: origins.length, months: months.length, requests: 0, routesWithDates: 0, routesEmpty: 0, errors: {}, rows: 0, written: 0, stoppedBy: null };
  const done = new Set(); let next = 0, buffer = [];
  const flush = async () => { if (!buffer.length) return; if (!options.dryRun) stats.written += await writeItems(buffer, { env, dynamo: options.dynamo, sleep }); buffer = []; };
  for (const o of origins) for (const m of months) {
    let fares = [];
    try { fares = await read(o, m); } catch { stats.errors['read-error'] = (stats.errors['read-error'] || 0) + 1; continue; }
    const top = [...new Map(fares.filter(f => f.destination && f.destination !== o).sort((a, b) => a.priceUsd - b.priceUsd).map(f => [f.destination, f])).values()].slice(0, perOD);
    for (const f of top) for (const [a, b] of [[o, f.destination], [f.destination, o]]) {
      const key = `${a}>${b}@${m}`; if (done.has(key)) continue; done.add(key);
      if (stats.requests >= maxRequests) { stats.stoppedBy = 'max-requests'; await flush(); return stats; }
      const wait = next - clock(); if (wait > 0) await sleep(wait); next = clock() + interval;
      stats.requests++;
      const r = await dates.fetchRouteDates({ origin: a, destination: b, month: m, token: options.token, fetch: options.fetch, clock });
      if (!r.ok) { stats.errors[r.reason] = (stats.errors[r.reason] || 0) + 1; if (r.reason === 'rate-limited') { await sleep(60000); next = clock(); } continue; }
      if (r.records.length) stats.routesWithDates++; else stats.routesEmpty++;
      stats.rows += r.records.length; buffer.push(...r.records.map(x => dates.toItem(x, clock())));
      if (buffer.length >= 500) await flush();
    }
  }
  await flush();
  return stats;
}

module.exports = { runDatePass, _internal: { writeItems } };
