'use strict';
// GV-PRICE-INDEX-001: Price Index collector. Collection is OFF by default.
//
// PRICE_INDEX_COLLECTION=on is required for any real (billed) request. Without it the
// collector only runs in fixture mode (options.fixture), where answers come from test
// inputs and the budget lives in memory; no AWS, nothing billed.
//
// Every request goes through the client (providers/stays/nuitee/nuitee-price-index.js),
// which reserves a budget slot first, applies the 10-per-minute rate limit and the
// rolling six-month horizon. A 429/5xx/timeout is retried ONCE after a backoff
// (Retry-After if Nuitee sends it, else 6 s, max 60 s); the retry is a new request and
// pays for its own slot. The run stops as soon as the budget refuses (cap reached or
// counter unreachable). Summaries are stored only if PRICE_INDEX_STORAGE=on.
// Not wired into the Lambda or EC2: starting it is a separate, approved step.

const client = require('../../../providers/stays/nuitee/nuitee-price-index');
const budgetLib = require('./budget');
const summary = require('./summary');
const store = require('./store');

const collectionOn = env => String(env.PRICE_INDEX_COLLECTION || '').trim().toLowerCase() === 'on';
const MAX_CITIES_PER_RUN = 25;
const BACKOFF = { defaultMs: 6000, maxMs: 60000 };
const BUDGET_STOPS = new Set(['monthly-cap-reached', 'budget-store-unavailable', 'budget-table-not-configured', 'budget-required']);

function isPriceIndexEvent(event) {
  return Boolean(event && !event.rawPath && !event.requestContext && event.globevoyJob === 'price-index');
}

// Fixture mode: answers from test inputs, through the real client (budget, limiter, horizon).
function fixtureFetch(fixture) {
  return async url => {
    const u = new URL(url), kind = u.pathname.endsWith('/prices/hotels') ? 'hotels' : 'city';
    const a = await fixture(kind, Object.fromEntries(u.searchParams));
    if (a && a.status && a.status !== 200) return { status: a.status, text: async () => '{}', headers: { get: () => a.retryAfter ?? null } };
    return { status: 200, text: async () => JSON.stringify(a || {}), headers: { get: () => null } };
  };
}

/**
 * cities: [{ cityId, countryCode, cityName, hotelIds? }]   hotelIds (<=50) -> prices/hotels, else prices/city
 * from/to are clamped by the client to the rolling six months.
 * options: { env, fixture, budget, dynamo, clock, sleep, limiter, apiKey, allowProduction, keepSummaries }
 */
async function run({ cities = [], from, to } = {}, options = {}) {
  const env = options.env || process.env;
  const fixtureMode = typeof options.fixture === 'function';
  if (!fixtureMode && !collectionOn(env)) return { ok: false, reason: 'collection-off', requests: 0, cities: [] };
  const budget = options.budget || (fixtureMode ? budgetLib.memoryBudget(budgetLib.capFrom(env)) : budgetLib.dynamoBudget(options));
  const sleep = options.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const callOpts = fixtureMode
    ? { ...options, apiKey: 'sand_fixture', fetchFn: fixtureFetch(options.fixture), budget, limiter: options.limiter || client.createLimiter({ sleep: async () => {} }) }
    : { ...options, budget };
  const list = cities.slice(0, MAX_CITIES_PER_RUN);
  const out = []; let requests = 0, stopped = null;

  for (const c of list) {
    if (stopped) { out.push({ cityId: c.cityId, status: 'skipped', reason: stopped }); continue; }
    const call = () => (c.hotelIds?.length
      ? client.hotels({ hotelIds: c.hotelIds, from, to }, { ...callOpts, purpose: `price-index:${c.cityId}` })
      : client.city({ countryCode: c.countryCode, cityName: c.cityName, from, to }, { ...callOpts, purpose: `price-index:${c.cityId}` }));
    let answer = await call(); let attempts = answer.sent ? 1 : 0; requests += attempts;
    if (!answer.ok && answer.retryable) {
      const wait = Math.min(BACKOFF.maxMs, answer.retryAfterS ? answer.retryAfterS * 1000 : BACKOFF.defaultMs);
      await sleep(wait);
      const second = await call();
      if (second.sent) { attempts++; requests++; }
      answer = second;
    }
    if (!answer.ok && BUDGET_STOPS.has(answer.reason)) { stopped = answer.reason; out.push({ cityId: c.cityId, status: attempts ? 'failed' : 'skipped', reason: answer.reason, attempts }); continue; }
    if (!answer.ok) { out.push({ cityId: c.cityId, status: 'failed', reason: answer.reason, attempts }); continue; }
    const s = answer.kind === 'hotels' ? summary.fromHotels(c.cityId, answer) : summary.fromCity(c.cityId, answer);
    if (!s) { out.push({ cityId: c.cityId, status: 'empty', attempts }); continue; }
    const saved = fixtureMode && !options.dynamo ? { stored: false, reason: store.storageOn(env) ? 'fixture-mode' : 'storage-off' } : await store.write(s, options);
    out.push({ cityId: c.cityId, status: 'ok', source: s.source, attempts, window: answer.window, days: s.days, coverage: s.coverage, median: s.median, stored: saved.stored, storeReason: saved.reason || null, ...(options.keepSummaries ? { summary: s } : {}) });
  }
  return { ok: true, mode: fixtureMode ? 'fixture' : 'live', requests, estimatedCostUsd: Number((requests * budgetLib.PRICE_PER_REQUEST_USD).toFixed(2)), budget: { kind: budget.kind, cap: budget.cap, used: await budget.used() }, stopped, cities: out };
}

module.exports = { run, isPriceIndexEvent, collectionOn, MAX_CITIES_PER_RUN, BACKOFF };
