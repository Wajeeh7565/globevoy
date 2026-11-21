'use strict';
// GV-FAREMAP-FULLPASS-001 — one complete fare-map pass in a single run.
//
// Agreed Nov 20, 2026: instead of the 5-minute rolling Lambda job, a separate
// machine (EC2) collects every origin x month in one go every 1-3 days, so all
// cities' fares come from the same day. Travelpayouts refreshes its cached
// prices about weekly, so this is fresh enough.
//
// - Same data as the Lambda job: fare-map-ingest (Travelpayouts GraphQL
//   prices_one_way) and fare-map-store (same table, keys and fields).
// - No time limit per run, so each origin x month is read to its last page
//   (up to 34 pages, about 1,000 destinations).
// - Same polite pacing as the Lambda job (one request per 1.1 s by default).
// - Progress is saved after every task in META#job / full-pass, separate from
//   the Lambda job's cursor, so both can run side by side during the switch-over
//   and a stopped pass resumes where it left off.
// - Every city is treated the same: tasks run month by month, origin by origin.

const ingest = require('./fare-map-ingest');
const store = require('./fare-map-store');
const { collectionMonthCount } = require('./search-window');

const VERSION = 'GV-FAREMAP-FULLPASS-001';
const META_KEY = 'full-pass';
const MAX_TASK_ATTEMPTS = 3;      // transient provider errors, then the task is skipped
const MAX_COOLDOWNS = 10;         // rate limits in one pass before giving up
const STOP_REASONS = new Set(['provider-auth-error', 'travelpayouts-token-missing', 'invalid-fx-configuration']);

// Month by month, origin by origin: the same order as the Lambda job's rolling pass.
function buildTasks(origins, months) {
  const tasks = [];
  for (const m of months) for (const o of origins) tasks.push({ origin: o, month: m });
  return tasks;
}
const taskKey = t => (t ? `${t.origin}#${t.month}` : null);

async function runFullPass(options = {}) {
  const env = options.env || process.env;
  const clock = options.clock || Date.now;
  const sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const log = options.log || (event => console.log(JSON.stringify(event)));
  const dryRun = !!options.dryRun;
  const token = String(options.token || env.TRAVELPAYOUTS_TOKEN || '').trim();
  if (!store.tableName(env)) return { ok: false, reason: 'fare-map-table-missing' };
  if (!token) return { ok: false, reason: 'travelpayouts-token-missing' };

  const origins = options.origins || ingest.originCodesFromRegistry(options.registry || require('../../../data/unified-city-registry-1000.json'));
  const months = ingest.upcomingMonths(collectionMonthCount(clock()), clock());
  const tasks = buildTasks(origins, months);
  const opts = { env, dynamo: options.dynamo };

  // Resume an unfinished pass with the same task list; otherwise start a new one.
  let state = null;
  if (!dryRun && !options.fresh) { try { state = await store.readMeta(META_KEY, opts); } catch (_) { state = null; } }
  let index = 0, offset = 0;
  const resumable = state && !state.completedAt && state.tasksTotal === tasks.length && state.taskKey;
  if (resumable) {
    const at = tasks.findIndex(t => taskKey(t) === state.taskKey);
    if (at >= 0) { index = at; offset = Number(state.offset) || 0; }
  }
  const pass = resumable && index > 0 ? { ...state } : {
    version: VERSION, passId: new Date(clock()).toISOString(), startedAt: new Date(clock()).toISOString(),
    tasksTotal: tasks.length, done: 0, written: 0, requests: 0, empty: 0, skipped: 0, skippedTasks: [], cooldowns: 0
  };
  pass.completedAt = null; pass.lastError = null; pass.host = options.host || null;

  const save = async () => {
    if (dryRun) return;
    await store.writeMeta(META_KEY, { ...pass, index, taskKey: taskKey(tasks[index]), offset, updatedAt: new Date(clock()).toISOString() }, { ...opts, nowMs: clock() });
  };
  const pace = options.pace || ingest.createPacer({ clock, sleep, intervalMs: Math.max(500, Number(options.intervalMs || env.FARE_MAP_INTERVAL_MS) || 1100) });
  const limit = Math.min(tasks.length, index + (options.maxTasks || Infinity));
  log({ component: 'fare-map-full-pass', event: resumable && index > 0 ? 'resume' : 'start', passId: pass.passId, index, tasksTotal: tasks.length, dryRun });

  let attempts = 0;
  while (index < limit) {
    const task = tasks[index];
    const result = await ingest.ingestOriginMonth({ ...task, token, fetch: options.fetch, clock, sleep, pace, deadline: clock() + 10 * 60 * 1000, offset });
    pass.requests += result.requests || 0;
    if (result.records.length && !dryRun) {
      let wrote = false;
      for (let tries = 0; tries < 3 && !wrote; tries++) {
        try { pass.written += await store.writeRecords(result.records, { ...opts, nowMs: clock(), sleepFn: sleep }); wrote = true; }
        catch (e) { if (tries === 2) { pass.lastError = e.code || 'dynamodb-error'; await save().catch(() => {}); log({ component: 'fare-map-full-pass', event: 'stopped', reason: pass.lastError, index }); return { ok: false, reason: pass.lastError, ...pass, index }; } await sleep(5000 * (tries + 1)); }
      }
    }
    if (dryRun) pass.written += result.records.length;
    const reason = result.reason;
    if (!reason || reason === 'pagination-budget') {
      // Done (or every page read): next task.
      pass.done++; if (!result.records.length) pass.empty++;
      index++; offset = 0; attempts = 0;
    } else if (reason === 'rate-limited') {
      pass.cooldowns++;
      offset = result.nextOffset || offset;
      if (pass.cooldowns > MAX_COOLDOWNS) { pass.lastError = 'rate-limited-too-often'; await save(); log({ component: 'fare-map-full-pass', event: 'stopped', reason: pass.lastError, index }); return { ok: false, reason: pass.lastError, ...pass, index }; }
      await save();
      log({ component: 'fare-map-full-pass', event: 'cooldown', seconds: result.retryAfterSeconds || 60, index });
      await sleep((result.retryAfterSeconds || 60) * 1000);
      continue;
    } else if (STOP_REASONS.has(reason)) {
      pass.lastError = reason; await save();
      log({ component: 'fare-map-full-pass', event: 'stopped', reason, index });
      return { ok: false, reason, ...pass, index };
    } else if (reason === 'provider-http-error' || ++attempts >= MAX_TASK_ATTEMPTS) {
      // Permanent for this task (e.g. a code Travelpayouts rejects), or still failing after retries.
      pass.skipped++; pass.skippedTasks = [...pass.skippedTasks, `${taskKey(task)}:${reason}`].slice(-50);
      index++; offset = 0; attempts = 0;
    } else {
      offset = result.nextOffset || offset;
      await sleep(30000 * attempts);
      continue;
    }
    await save();
    if (pass.done % 250 === 0) log({ component: 'fare-map-full-pass', event: 'progress', index, tasksTotal: tasks.length, written: pass.written, requests: pass.requests, skipped: pass.skipped });
  }
  const finished = index >= tasks.length;
  if (finished) pass.completedAt = new Date(clock()).toISOString();
  pass.ms = clock() - Date.parse(pass.startedAt);
  await save();
  log({ component: 'fare-map-full-pass', event: finished ? 'finished' : 'paused', ...pass, index });
  return { ok: true, finished, ...pass, index };
}

module.exports = { VERSION, META_KEY, runFullPass, _internal: { buildTasks } };
