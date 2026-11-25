'use strict';
// GV-PRICE-INDEX-001: Price Index collector. Collection is OFF by default.
//
// PRICE_INDEX_COLLECTION=on is required for any real (billed) request. Without it the
// collector only runs in fixture mode (options.fixture), with an in-memory budget and
// no AWS calls, so it can be tested with the sandbox experiment data.
//
// For each city: reserve a budget slot -> one request -> summarise in memory ->
// store the summary only if PRICE_INDEX_STORAGE=on. A 429/5xx/timeout is retried at
// most once, and the retry reserves its own slot. The run stops as soon as the
// monthly cap is reached (or the budget store cannot be reached).
// Not wired into the Lambda or EC2 yet: starting it is a separate, approved step.

const client = require('../../../providers/stays/nuitee/nuitee-price-index');
const budgetLib = require('./budget');
const summary = require('./summary');
const store = require('./store');

const collectionOn = env => String(env.PRICE_INDEX_COLLECTION || '').trim().toLowerCase() === 'on';
const MAX_CITIES_PER_RUN = 25;

function isPriceIndexEvent(event) {
  return Boolean(event && !event.rawPath && !event.requestContext && event.globevoyJob === 'price-index');
}

/**
 * cities: [{ cityId, countryCode, cityName, hotelIds? }]  hotelIds (<=50) -> prices/hotels, else prices/city
 * options: { env, fixture: (kind, params) => answer, budget, dynamo, clock, allowProduction }
 */
async function run({ cities = [], from, to } = {}, options = {}) {
  const env = options.env || process.env;
  const fixtureMode = typeof options.fixture === 'function';
  if (!fixtureMode && !collectionOn(env)) return { ok: false, reason: 'collection-off', requests: 0, cities: [] };
  const budget = options.budget || (fixtureMode ? budgetLib.memoryBudget(budgetLib.capFrom(env)) : budgetLib.dynamoBudget(options));
  const list = cities.slice(0, MAX_CITIES_PER_RUN);
  const out = []; let requests = 0, stopped = null;

  const callFor = c => (c.hotelIds?.length
    ? (fixtureMode ? async () => options.fixture('hotels', c) : () => client.hotels({ hotelIds: c.hotelIds, from, to }, options))
    : (fixtureMode ? async () => options.fixture('city', c) : () => client.city({ countryCode: c.countryCode, cityName: c.cityName, from, to }, options)));

  for (const c of list) {
    if (stopped) { out.push({ cityId: c.cityId, status: 'skipped', reason: stopped }); continue; }
    const call = callFor(c);
    let answer = null, attempts = 0;
    while (attempts < 2) {
      const slot = await budget.reserve(`price-index:${c.cityId}${attempts ? ':retry' : ''}`);
      if (!slot.ok) { stopped = slot.reason; break; }
      attempts++; requests++;
      answer = await call();
      if (answer?.ok || !answer?.retryable) break;
    }
    if (!answer) { out.push({ cityId: c.cityId, status: 'skipped', reason: stopped }); continue; }
    if (!answer.ok) { out.push({ cityId: c.cityId, status: 'failed', reason: answer.reason, attempts }); continue; }
    const s = answer.kind === 'hotels' ? summary.fromHotels(c.cityId, answer) : summary.fromCity(c.cityId, answer);
    if (!s) { out.push({ cityId: c.cityId, status: 'empty', attempts }); continue; }
    const saved = fixtureMode && !options.dynamo ? { stored: false, reason: store.storageOn(env) ? 'fixture-mode' : 'storage-off' } : await store.write(s, options);
    out.push({ cityId: c.cityId, status: 'ok', source: s.source, attempts, days: s.days, coverage: s.coverage, median: s.median, stored: saved.stored, storeReason: saved.reason || null, ...(options.keepSummaries ? { summary: s } : {}) });
  }
  return { ok: true, mode: fixtureMode ? 'fixture' : 'live', requests, estimatedCostUsd: Number((requests * budgetLib.PRICE_PER_REQUEST_USD).toFixed(2)), budget: { kind: budget.kind, cap: budget.cap, used: await budget.used() }, stopped, cities: out };
}

module.exports = { run, isPriceIndexEvent, collectionOn, MAX_CITIES_PER_RUN };
