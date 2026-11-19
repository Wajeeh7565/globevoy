'use strict';
// GV-FAREMAP-001 — rolling fare-map refresh job.
//
// Runs on a schedule (EventBridge, every 5 minutes, input {"globevoyJob":"fare-map"}). Each run works
// through the next slice of (origin × month) tasks inside a time budget,
// saves where it got to, and the next run carries on. One full cycle covers
// every origin-eligible city × the next 6 months; then it starts again.
// Off unless ENABLE_FARE_MAP_JOB=true and FARE_MAP_TABLE + TRAVELPAYOUTS_TOKEN are set.

const ingest = require('./fare-map-ingest');
const store = require('./fare-map-store');

const FLAG = 'ENABLE_FARE_MAP_JOB';
const MONTHS = 6;
const DEFAULT_TIME_BUDGET_MS = 45 * 1000;        // inside the shared Lambda's 60 s timeout
const DEFAULT_PAUSE_MS = 250;                    // polite pacing between Travelpayouts requests

function enabled(env = process.env) {
  return String(env[FLAG] || '').trim().toLowerCase() === 'true' && Boolean(store.tableName(env)) && Boolean(String(env.TRAVELPAYOUTS_TOKEN || '').trim());
}

function buildTasks(origins, months) {
  const tasks = [];
  for (const m of months) for (const o of origins) tasks.push({ origin: o, month: m });
  return tasks;
}

async function runFareMapJob(options = {}) {
  const env = options.env || process.env;
  if (!enabled(env)) return { ok: true, ran: false, reason: 'disabled' };
  const started = Date.now();
  const timeBudget = Number(options.timeBudgetMs) || Number(env.FARE_MAP_TIME_BUDGET_MS) || DEFAULT_TIME_BUDGET_MS;
  const pause = options.pauseMs ?? DEFAULT_PAUSE_MS;
  const maxTasks = Number(options.maxTasks) || Infinity;
  const registry = options.registry || require('../../../data/unified-city-registry-1000.json');
  const origins = options.origins || ingest.originCodesFromRegistry(registry);
  const tasks = buildTasks(origins, ingest.upcomingMonths(MONTHS, options.now || Date.now()));
  const storeOpts = { env, dynamo: options.dynamo, nowMs: options.now };
  const cursor = await store.readCursor(storeOpts);
  let index = cursor.index >= tasks.length ? 0 : cursor.index;
  let cycleStartedAt = index === 0 || !cursor.cycleStartedAt ? new Date(options.now || Date.now()).toISOString() : cursor.cycleStartedAt;
  const summary = { ok: true, ran: true, tasksTotal: tasks.length, startIndex: index, done: 0, written: 0, requests: 0, failures: 0, rateLimited: false };

  while (index < tasks.length && summary.done < maxTasks && (summary.done === 0 || Date.now() - started < timeBudget)) {
    const task = tasks[index];
    const result = await ingest.ingestOriginMonth({ ...task, token: env.TRAVELPAYOUTS_TOKEN, fetch: options.fetch, now: options.now });
    summary.requests += result.requests;
    if (result.reason === 'rate-limited') { summary.rateLimited = true; break; }
    if (!result.ok) summary.failures += 1;
    if (result.records.length) summary.written += await store.writeRecords(result.records, storeOpts);
    index += 1;
    summary.done += 1;
    if (pause) await new Promise(r => setTimeout(r, pause));
  }
  const finishedCycle = index >= tasks.length;
  await store.writeCursor({ index: finishedCycle ? 0 : index, cycleStartedAt: finishedCycle ? null : cycleStartedAt }, storeOpts);
  return { ...summary, endIndex: index, finishedCycle, ms: Date.now() - started };
}

// Scheduled events reach the normal Lambda handler; this recognises them.
// Either a custom input {"globevoyJob":"fare-map"} (EventBridge Scheduler), or a
// standard EventBridge "Scheduled Event" from a rule named globevoy-fare-map….
function isFareMapEvent(event) {
  if (!event) return false;
  if (event.globevoyJob === 'fare-map' || event?.detail?.globevoyJob === 'fare-map') return true;
  return event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event'
    && Array.isArray(event.resources) && event.resources.some(r => /:rule\/globevoy-fare-map[A-Za-z0-9_.-]*$/.test(String(r)));
}

module.exports = { FLAG, enabled, runFareMapJob, isFareMapEvent, _internal: { buildTasks } };
