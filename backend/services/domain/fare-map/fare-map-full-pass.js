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

const { createHash } = require('node:crypto');
const ingest = require('./fare-map-ingest');
const store = require('./fare-map-store');
const world = require('./fare-map-worldwide-plan');
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

function targetedPlan(origins, month, now = Date.now()) {
  const codes = Array.isArray(origins) ? [...new Set(origins)].sort() : [];
  if (!codes.length || codes.length > 8 || codes.some(code => !/^[A-Z]{3}$/.test(code))) {
    throw new Error('Specify between one and eight provider discovery codes');
  }
  if (!ingest.upcomingMonths(collectionMonthCount(now), now).includes(month)) {
    throw new Error('The targeted month must be inside the collection window');
  }
  const tasks = buildTasks(codes, [month]);
  const scope = createHash('sha256').update(tasks.map(taskKey).join(',')).digest('hex').slice(0, 20);
  return { tasks, metaKey: `${META_KEY}-target-${scope}` };
}

async function runFullPass(options = {}) {
  const env = options.env || process.env;
  const clock = options.clock || Date.now;
  const sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const log = options.log || (event => console.log(JSON.stringify(event)));
  const dryRun = !!options.dryRun;
  const backfill = options.requestBudget !== undefined;
  const worldwide = options.worldwide === true;
  const budgeted = backfill || worldwide;
  const runStarted = clock();
  let runDeadline = worldwide ? runStarted + world.MAX_RUN_MS : Infinity;
  if (worldwide && (backfill || options.targetMonth || options.origins)) throw new Error('Worldwide mode cannot be combined with targeted collection');
  if (backfill && (!options.targetMonth || !Number.isInteger(options.requestBudget) ||
    options.requestBudget < 1 || options.requestBudget > 272)) throw new Error('Backfill requires one targeted batch and a request budget from 1 to 272');
  const token = String(options.token || env.TRAVELPAYOUTS_TOKEN || '').trim();
  if (!store.tableName(env)) return { ok: false, reason: 'fare-map-table-missing' };
  if (!token) return { ok: false, reason: 'travelpayouts-token-missing' };

  const origins = options.origins || ingest.originCodesFromRegistry(options.registry || require('../../../data/unified-city-registry-1000.json'));
  const months = ingest.upcomingMonths(collectionMonthCount(clock()), clock());
  const plan = worldwide ? world.buildWorldwidePlan(
    options.selectable || require('../../../data/selectable-origins.json'), origins, runStarted) : null;
  const { tasks, metaKey } = worldwide ? { tasks: plan.tasks, metaKey: 'full-pass-worldwide' }
    : options.targetMonth ? targetedPlan(options.origins, options.targetMonth, clock())
    : { tasks: buildTasks(origins, months), metaKey: META_KEY };
  const opts = { env, dynamo: options.dynamo };
  const fareValid = backfill ? require('./fare-map-optimizer')._internal.fareValid : null;

  // Resume an unfinished pass with the same task list; otherwise start a new one.
  let state = null;
  if (!dryRun && !options.fresh) { try { state = await store.readMeta(metaKey, opts); } catch (error) { if (budgeted) throw error; } }
  const completedAge = runStarted - Date.parse(state?.completedAt);
  if (worldwide && state?.completedAt && state.planFingerprint === plan.fingerprint &&
      completedAge >= 0 && completedAge <= world.MAX_SKIP_AGE_MS) {
    return { ok: true, finished: true, reason: 'worldwide-pass-already-fresh', invocationRequests: 0 };
  }
  if (backfill && state?.completedAt && clock() - Date.parse(state.completedAt) < 24 * 3600000) {
    return { ok: true, finished: true, reason: 'target-completed-recently', invocationRequests: 0 };
  }
  let index = 0, offset = 0;
  const resumable = state && !state.completedAt && state.tasksTotal === tasks.length && state.taskKey &&
    (!worldwide || (state.planFingerprint === plan.fingerprint && runStarted - Date.parse(state.startedAt) < world.MAX_RUN_MS));
  if (resumable) {
    const at = tasks.findIndex(t => taskKey(t) === state.taskKey);
    if (at >= 0) { index = at; offset = Number(state.offset) || 0; }
  }
  const pass = resumable && state.taskKey === taskKey(tasks[index]) ? { ...state } : {
    version: VERSION, passId: new Date(clock()).toISOString(), startedAt: new Date(clock()).toISOString(),
    tasksTotal: tasks.length, done: 0, written: 0, requests: 0, empty: 0, skipped: 0, skippedTasks: [], cooldowns: 0
  };
  if (budgeted && Number(state?.rateLimitedUntil) > clock()) {
    return { ok: false, finished: false, reason: 'rate-limit-cooldown', invocationRequests: 0 };
  }
  if (worldwide) {
    pass.planFingerprint = plan.fingerprint;
    runDeadline = Date.parse(pass.startedAt) + world.MAX_RUN_MS;
  }
  pass.completedAt = null; pass.lastError = null; pass.host = options.host || null;
  let taskStarted = offset ? Number(pass.taskStarted) || runStarted : null;

  const save = async () => {
    if (dryRun) return;
    await store.writeMeta(metaKey, { ...pass, index, taskKey: taskKey(tasks[index]), offset, taskStarted, updatedAt: new Date(clock()).toISOString() }, { ...opts, nowMs: clock() });
  };
  const intervalMs = Math.max(budgeted ? world.MIN_INTERVAL_MS : 500, Number(options.intervalMs || env.FARE_MAP_INTERVAL_MS) || 1100);
  const waitForRequest = options.pace || ingest.createPacer({ clock, sleep, intervalMs });
  let invocationRequests = 0;
  const requestsBeforeInvocation = worldwide ? Number(pass.requests) || 0 : 0;
  const outOfRequests = () => budgeted && requestsBeforeInvocation + invocationRequests >= (worldwide ? world.MAX_REQUESTS : options.requestBudget);
  const outOfTime = () => clock() >= runDeadline;
  const pace = async deadline => {
    if (outOfRequests() || outOfTime()) throw Object.assign(new Error('request budget'), { code: 'time-budget' });
    await waitForRequest(deadline);
  };
  const upstream = options.fetch || globalThis.fetch;
  const fetch = (url, init) => {
    invocationRequests++;
    return upstream(url, init);
  };
  const limit = Math.min(tasks.length, index + (options.maxTasks || Infinity));
  log({ component: 'fare-map-full-pass', event: resumable && index > 0 ? 'resume' : 'start', passId: pass.passId, index, tasksTotal: tasks.length, dryRun });

  let attempts = 0;
  while (index < limit && !outOfRequests() && !outOfTime()) {
    const task = tasks[index];
    const refreshKey = worldwide ? 'fare-refresh#'+taskKey(task) : null;
    if (refreshKey && !dryRun && offset === 0) {
      const stamp = await store.readMeta(refreshKey, opts);
      const age = runStarted - Number(stamp?.startedAt);
      if (age >= 0 && age <= world.MAX_SKIP_AGE_MS) {
        pass.alreadyFresh = (pass.alreadyFresh || 0) + 1;
        index++;
        attempts = 0;
        await save();
        continue;
      }
    }
    taskStarted ??= clock();
    if (backfill && offset === 0) {
      const recent = await store.readRoutesFrom(task.origin, task.month, { ...opts, maxPages: 2, nowMs: clock() });
      if (recent.some(fare => fareValid(fare, task.origin, task.month, clock(), 48 * 3600000))) {
        pass.alreadyFresh = (pass.alreadyFresh || 0) + 1;
        index++;
        attempts = 0;
        await save();
        continue;
      }
    }
    const result = await ingest.ingestOriginMonth({ ...task, token, fetch, clock, sleep, pace, deadline: Math.min(runDeadline, clock() + 10 * 60 * 1000), offset });
    pass.requests += result.requests || 0;
    const records = backfill
      ? result.records.filter(fare => fareValid(fare, task.origin, task.month, clock(), 48 * 3600000))
      : result.records;
    if (records.length && !dryRun) {
      let wrote = false;
      for (let tries = 0; tries < 3 && !wrote; tries++) {
        try { pass.written += await store.writeRecords(records, { ...opts, nowMs: clock(), sleepFn: sleep }); wrote = true; }
        catch (e) { if (tries === 2) { pass.lastError = e.code || 'dynamodb-error'; await save().catch(() => {}); log({ component: 'fare-map-full-pass', event: 'stopped', reason: pass.lastError, index }); return { ok: false, reason: pass.lastError, ...pass, index }; } await sleep(5000 * (tries + 1)); }
      }
    }
    if (dryRun) pass.written += records.length;
    const reason = result.reason;
    if (budgeted && (reason === 'rate-limited' || (reason === 'time-budget' && (worldwide || outOfRequests())))) {
      offset = result.nextOffset || offset;
      pass.lastError = reason === 'rate-limited' ? reason : null;
      pass.rateLimitedUntil = reason === 'rate-limited' ? clock() + (result.retryAfterSeconds || 60) * 1000 : null;
      break;
    }
    if (!reason || reason === 'pagination-budget') {
      // Done (or every page read): next task.
      if (refreshKey && !dryRun) await store.writeMeta(refreshKey, { startedAt: taskStarted },
        { ...opts, nowMs: clock(), ttlDays: 4 });
      pass.done++; if (!records.length && (!budgeted || offset === 0)) pass.empty++;
      index++; offset = 0; attempts = 0; taskStarted = null;
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
      index++; offset = 0; attempts = 0; taskStarted = null;
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
  return { ok: true, finished, ...pass, index, invocationRequests };
}

module.exports = { VERSION, META_KEY, runFullPass, _internal: { targetedPlan, buildTasks } };
