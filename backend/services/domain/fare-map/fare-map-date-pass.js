'use strict';
// GV-DATA-DATES-003 — collector date pass (EC2, after the main fare-map pass; not scheduled).
//
// The main pass keeps one cheapest fare per origin, destination and month. For each origin
// and month this pass takes the N cheapest routes already in the fare map and asks
// Travelpayouts' free /v2/prices/month-matrix for every day of the month, in BOTH
// directions (out and home), with the number of stops. Rows go to their own keys
// (pk "D#<ORIGIN>#<YYYY-MM>", sk "<DEST>", one item per route-month, 7-day TTL), so the existing
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

// Months to cover: the current month only while at least 10 days are left, then the next
// ones, `count` in all.
function passMonths(count, nowMs) {
  const d = new Date(nowMs), left = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate() - d.getUTCDate();
  const all = ingest.upcomingMonths(count + 1, nowMs);
  return (left >= 10 ? all.slice(0, count) : all.slice(1, count + 1));
}
const PROGRESS_SK = 'date-pass';
async function loadProgress({ env, dynamo }) {
  const table = store.tableName(env); if (!table) return null;
  const db = dynamo || store._internal.client({});
  const out = await db.send(store._internal.cmd('GetItemCommand', { TableName: table, Key: { pk: { S: 'META#job' }, sk: { S: PROGRESS_SK } } }));
  try { return out?.Item?.state?.S ? JSON.parse(out.Item.state.S) : null; } catch { return null; }
}
async function saveProgress(state, { env, dynamo }) {
  const table = store.tableName(env); if (!table) return;
  const db = dynamo || store._internal.client({});
  await db.send(store._internal.cmd('PutItemCommand', { TableName: table, Item: { pk: { S: 'META#job' }, sk: { S: PROGRESS_SK }, state: { S: JSON.stringify(state) }, updatedAt: { S: new Date().toISOString() } } }));
}

async function runDatePass(options = {}) {
  const env = options.env || process.env, clock = options.clock || Date.now, sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const origins = options.origins || ingest.originCodesFromRegistry(require('../../../data/unified-city-registry-1000.json'));
  const months = options.months || passMonths(Number(options.monthCount) || 6, clock());
  const perOD = Math.max(1, Math.min(200, Number(options.routes) || 30));
  const maxRequests = Math.max(1, Number(options.maxRequests) || 200000);
  const deadline = Number(options.maxMinutes) > 0 ? clock() + Number(options.maxMinutes) * 60000 : Infinity;
  const interval = 60000 / Math.max(1, Math.min(300, Number(options.perMinute) || 250));
  const read = options.readRoutes || ((o, m) => store.readRoutesFrom(o, m, { env, dynamo: options.dynamo, maxPages: 2, limit: 1000, nowMs: clock() }));
  const log = options.log || (() => {});
  // Resume an unfinished pass (same months) unless fresh; a finished one starts over.
  const saved = options.dryRun || options.fresh || options.resume === false ? null : await loadProgress({ env, dynamo: options.dynamo }).catch(() => null);
  const resume = saved && !saved.completedAt && saved.months?.join() === months.join() ? saved : null;
  const startAt = resume ? resume.originIndex : 0, startedAt = resume?.startedAt || new Date(clock()).toISOString();
  const stats = { origins: origins.length, months: months.length, monthList: months, startOrigin: startAt, requests: 0, routesWithDates: 0, routesEmpty: 0, items: 0, rows: 0,
    withStops: 0, withDuration: 0, written: 0, errors: {}, stoppedBy: null, originsWithDates: 0, destinations: 0, startedAt };
  const dests = new Set(), originsHit = new Set(); let next = 0, buffer = [];
  const flush = async () => { if (!buffer.length) return; if (!options.dryRun) stats.written += await writeItems(buffer, { env, dynamo: options.dynamo, sleep }); buffer = []; };
  const progress = async (originIndex, completed) => { await flush(); if (options.dryRun) return;
    await saveProgress({ months, originIndex, startedAt, completedAt: completed ? new Date(clock()).toISOString() : null, last: { requests: stats.requests, items: stats.items, rows: stats.rows } }, { env, dynamo: options.dynamo }).catch(() => {}); };
  const done = new Set();
  for (let oi = startAt; oi < origins.length; oi++) {
    const o = origins[oi];
    for (const m of months) {
      let fares = [];
      try { fares = await read(o, m); } catch { stats.errors['read-error'] = (stats.errors['read-error'] || 0) + 1; continue; }
      const top = [...new Map(fares.filter(f => f.destination && f.destination !== o).sort((a, b) => a.priceUsd - b.priceUsd).map(f => [f.destination, f])).values()].slice(0, perOD);
      for (const f of top) for (const [a, b] of [[o, f.destination], [f.destination, o]]) {
        const key = `${a}>${b}@${m}`; if (done.has(key)) continue; done.add(key);
        if (stats.requests >= maxRequests || clock() >= deadline) { stats.stoppedBy = stats.requests >= maxRequests ? 'max-requests' : 'time-budget'; await progress(oi, false); return finish(); }
        const wait = next - clock(); if (wait > 0) await sleep(wait); next = clock() + interval;
        stats.requests++;
        const r = await dates.fetchRouteDates({ origin: a, destination: b, month: m, token: options.token, fetch: options.fetch, clock });
        if (!r.ok) { stats.errors[r.reason] = (stats.errors[r.reason] || 0) + 1;
          if (r.reason === 'rate-limited') { await sleep(60000); next = clock(); }
          if (r.reason === 'provider-http-error' && (stats.errors[r.reason] || 0) > 200 && stats.routesWithDates === 0) { stats.stoppedBy = 'provider-errors'; await progress(oi, false); return finish(); }
          continue; }
        if (!r.records.length) { stats.routesEmpty++; continue; }
        stats.routesWithDates++; stats.items++; stats.rows += r.records.length;
        stats.withStops += r.records.filter(x => x.stops != null).length; stats.withDuration += r.records.filter(x => x.durationMinutes != null).length;
        originsHit.add(a); dests.add(b);
        if (options.sample && !stats.sample) stats.sample = r.records.slice(0, 3);
        buffer.push(dates.toRouteItem(r.records, clock()));
        if (buffer.length >= 100) await flush();
      }
    }
    if ((oi + 1) % 25 === 0) { await progress(oi + 1, false); log({ event: 'progress', origin: oi + 1, of: origins.length, requests: stats.requests, items: stats.items, written: stats.written, errors: stats.errors }); }
  }
  await progress(origins.length, true);
  return finish();
  function finish() { stats.originsWithDates = originsHit.size; stats.destinations = dests.size; stats.finishedAt = new Date(clock()).toISOString(); return stats; }
}

module.exports = { runDatePass, passMonths, _internal: { writeItems, loadProgress, saveProgress } };
