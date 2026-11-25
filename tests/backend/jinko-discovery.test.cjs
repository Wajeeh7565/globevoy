'use strict';
// GV-JINKO-DISC-001: discovery client safety rules, with mocked Jinko answers (no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, HARD_MAX_CALLS, _internal } = require('../../backend/services/providers/flights/jinko/jinko-discovery');

const amount = (v, c = 'CAD') => ({ value: v, decimal_places: 2, currency: c, display: `${c} ${(v / 100).toFixed(2)}` });
const IT = (date, v) => ({ offer_token: 'tok-' + date, origin: { code: 'YUL' }, destination: { code: 'YYZ' }, total: amount(v), priced_at: '2026-11-24T10:00:00Z',
  outbound: { departure_datetime: date + 'T08:00:00-05:00', arrival_datetime: date + 'T09:20:00-05:00', duration_minutes: 80, stops: 0, airline_name: 'Air Canada' } });
const reply = (status, body, seen) => async (url, init) => { if (seen) seen.push({ url, init }); return { status, text: async () => JSON.stringify(body), headers: { get: () => null } }; };
const LEG = { origin: 'yul', destination: 'yyz', from: '2027-01-05', to: '2027-01-20' };

test('sandbox keys use the free sandbox; the request is one leg over a date window', async () => {
  const seen = [];
  const c = createClient({ apiKey: 'jnk_sandbox_t_test', fetchFn: reply(200, { priced_for: 'one_adult', itineraries: [IT('2027-01-06', 12900), IT('2027-01-09', 9900)] }, seen) });
  const r = await c.findDates(LEG);
  assert.equal(seen[0].url, _internal.SANDBOX + '/find_dates');
  assert.equal(seen[0].init.headers['X-API-Key'], 'jnk_sandbox_t_test');
  const body = JSON.parse(seen[0].init.body);
  assert.deepEqual([body.origins, body.destinations, body.trip_type, body.departure_date_ranges[0]], [['YUL'], ['YYZ'], 'oneway', { start: '2027-01-05', end: '2027-01-20' }]);
  assert.equal(r.status, 'found');
  assert.equal(r.itineraries[1].total, 99);
  assert.equal(r.itineraries[1].offerToken, 'tok-2027-01-09');
  assert.equal(r.pricedFor, 'one_adult');
  assert.equal(c.usage().environment, 'sandbox');
});

test('production keys are refused unless allowed, and use the billed endpoint when allowed', async () => {
  const seen = [];
  const blocked = createClient({ apiKey: 'jnk_t_live', fetchFn: reply(200, {}, seen) });
  assert.equal((await blocked.findDates(LEG)).reason, 'production-not-allowed');
  assert.equal(seen.length, 0, 'no request sent');
  const ok = createClient({ apiKey: 'jnk_t_live', allowProduction: true, fetchFn: reply(200, { itineraries: [IT('2027-01-06', 12900)] }, seen) });
  await ok.findDates(LEG);
  assert.equal(seen[0].url, _internal.PROD + '/find_dates');
});

test('no cached fare is reported as a cache miss, never as "no flight"', async () => {
  const c = createClient({ apiKey: 'jnk_sandbox_t_x', fetchFn: reply(200, { result: 'no_matches', empty_reason: 'no_cached_fare', instruction: 'Try flight_search' }) });
  const r = await c.findDates(LEG);
  assert.equal(r.ok, true);
  assert.equal(r.status, 'no-cached-fare');
  assert.equal(r.emptyReason, 'no_cached_fare');
  assert.ok(!('unavailable' in r));
});

test('hard call budget: default 3, never more than 10; extra calls are refused without a request', async () => {
  const seen = [];
  const c = createClient({ apiKey: 'jnk_sandbox_t_x', fetchFn: reply(200, { itineraries: [] }, seen) });
  for (let i = 0; i < 5; i++) await c.findDates(LEG);
  assert.equal(seen.length, 3);
  assert.equal(c.usage().refused, 2);
  assert.equal(createClient({ apiKey: 'jnk_sandbox_t_x', maxCalls: 500 }).usage().maxCalls, HARD_MAX_CALLS);
});

test('402 (out of credit) and 401 stop the client; timeouts and network errors never throw', async () => {
  const seen = [];
  const c = createClient({ apiKey: 'jnk_sandbox_t_x', maxCalls: 5, fetchFn: reply(402, { error: { code: 'PAYMENT_REQUIRED' } }, seen) });
  assert.equal((await c.findDates(LEG)).reason, 'jinko-http-402');
  assert.equal((await c.findDates(LEG)).reason, 'jinko-out-of-credit');
  assert.equal(seen.length, 1, 'no retry after 402');
  const slow = createClient({ apiKey: 'jnk_sandbox_t_x', timeoutMs: 500, fetchFn: (u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) });
  assert.equal((await slow.findDates(LEG)).reason, 'jinko-timeout');
  const down = createClient({ apiKey: 'jnk_sandbox_t_x', fetchFn: async () => { throw new Error('down'); } });
  assert.equal((await down.findDates(LEG)).reason, 'jinko-network-error');
  assert.equal((await createClient({}).findDates(LEG)).reason, 'jinko-key-missing');
});

test('bad input is refused before any request', async () => {
  const seen = [];
  const c = createClient({ apiKey: 'jnk_sandbox_t_x', fetchFn: reply(200, {}, seen) });
  assert.equal((await c.findDates({ ...LEG, origin: 'Toronto' })).reason, 'invalid-origins');
  assert.equal((await c.findDates({ ...LEG, from: '2027-02-01', to: '2027-01-01' })).reason, 'invalid-date-range');
  assert.equal((await c.call('flight_search', { origins: ['YYZ'], trip_type: 'oneway' })).reason, 'unknown-endpoint', 'live search is not part of this client');
  assert.equal(seen.length, 0);
});

test('find_destination answers become a destination list', async () => {
  const c = createClient({ apiKey: 'jnk_sandbox_t_x', fetchFn: reply(200, { priced_for: 'one_adult', destinations: [{ iata_code: 'DXB', city_name: 'Dubai', lowest_fare: IT('2027-01-06', 31000) }], total: 1 }) });
  const r = await c.call('find_destination', { origins: ['LHE'], trip_type: 'oneway' });
  assert.equal(r.destinations[0].code, 'DXB');
  assert.equal(r.destinations[0].lowest.total, 310);
});

test('the module is not wired into user searches', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync('git', ['grep', '-l', "jinko-discovery'", '--', 'backend'], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), '', 'no backend file requires jinko-discovery');
});
