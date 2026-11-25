'use strict';
// Offline: hotel memory calibration, bayes mode (GV-HOTEL-MEM-003). Clean observations
// are kept apart from the old average; an entry touched after the fix is not assumed
// clean; cities with few checks stay near their region; the fallback room never teaches.
const test = require('node:test');
const assert = require('node:assert/strict');
const memory = require('../../backend/services/domain/live-fares/hotel-price-memory');
const optimizer = require('../../backend/services/domain/fare-map/fare-map-optimizer');
const { posterior, legacyRule, memoryLevel, regionRatios } = optimizer._internal;

function fakeDynamo(seed = {}) {
  const item = { ...seed };
  return { item, async send(c) {
    const name = c.constructor.name, input = c.input;
    if (name === 'GetItemCommand') return { Item: Object.keys(item).length ? { pk: { S: 'MEM#hotel' }, sk: { S: 'ratios' }, ...item } : undefined };
    if (name === 'PutItemCommand') { for (const k of Object.keys(item)) delete item[k]; const { pk, sk, ...rest } = input.Item; Object.assign(item, rest); return {}; }
    throw new Error('unexpected ' + name);
  } };
}
const CLEAN = Date.parse('2026-11-25T09:23:00Z');
const BAYES = { FARE_MAP_TABLE: 'globevoy-fare-map', HOTEL_MEMORY_LEGACY: 'bayes', HOTEL_MEMORY_CLEAN_SINCE: '2026-11-25T09:23:00Z' };

test('bayes record: the old average is frozen, clean checks get their own average and count', async () => {
  memory._internal.reset();
  // Montego Bay: 11 checks, ratio 2.79, last touched AFTER the fix (still mostly old checks).
  const dynamo = fakeDynamo({ r_montego_bay_jm: { N: '2.788' }, n_montego_bay_jm: { N: '11' }, t_montego_bay_jm: { N: String(CLEAN + 60000) } });
  const opts = { env: BAYES, dynamo, fresh: true, clock: () => CLEAN + 3600000 };
  await memory.record([{ cityId: 'montego-bay-jm', estimateUsd: 500, liveUsd: 700 }], opts);
  await memory.record([{ cityId: 'montego-bay-jm', estimateUsd: 500, liveUsd: 800 }], opts);
  assert.equal(dynamo.item.r_montego_bay_jm.N, '2.788', 'legacy average untouched');
  assert.equal(dynamo.item.n_montego_bay_jm.N, '11');
  assert.equal(dynamo.item.c_montego_bay_jm.N, '2');
  assert.equal(Number(dynamo.item.q_montego_bay_jm.N), 1.5, 'clean average of 1.4 and 1.6');
  const hit = (await memory.load(opts)).get('montego_bay_jm');
  assert.deepEqual([hit.c, hit.q, hit.ratio], [2, 1.5, 2.788]);
});

test('trust mode keeps writing the clean fields it already has (no data loss on rollback to trust)', async () => {
  memory._internal.reset();
  const dynamo = fakeDynamo({ r_a_b: { N: '1.2' }, n_a_b: { N: '3' }, t_a_b: { N: String(CLEAN) }, q_a_b: { N: '1.1' }, c_a_b: { N: '2' } });
  await memory.record([{ cityId: 'a-b', estimateUsd: 100, liveUsd: 120 }], { env: { FARE_MAP_TABLE: 'globevoy-fare-map' }, dynamo, fresh: true, clock: () => CLEAN + 1000 });
  assert.equal(dynamo.item.c_a_b.N, '2'); assert.equal(dynamo.item.q_a_b.N, '1.1');
});

test('posterior: recent timestamp alone is not clean; few checks stay near the region', () => {
  const rule = legacyRule(BAYES), prior = 1.3;
  const touched = posterior({ ratio: 2.788, n: 11, at: CLEAN + 60000 }, prior, rule);
  assert.ok(touched < 2.0 && touched > prior, `legacy-only entry pulled to its region: ${touched.toFixed(2)}`);
  const one = posterior({ ratio: 2.788, n: 11, q: 1.5, c: 1 }, prior, rule);
  const five = posterior({ ratio: 2.788, n: 11, q: 1.5, c: 5 }, prior, rule);
  assert.ok(Math.abs(five - 1.5) < Math.abs(one - 1.5), 'more clean checks: closer to the clean average');
  assert.ok(five < 1.7, `five clean checks dominate: ${five.toFixed(2)}`);
  // Downward bias is shrunk too: Austin at the 0.6 floor from one old check.
  const low = posterior({ ratio: 0.6, n: 1 }, 1.2, rule);
  assert.ok(low > 1.0, `one legacy low check does not make a city cheap: ${low.toFixed(2)}`);
});

test('bayes planning levels: learned cities blend, never-checked cities use the region or the margin (never NaN)', () => {
  const row = (id, cl) => ({ unifiedRegistry: { cityId: id, destination: { regionCluster: cl } } });
  const rows = [row('a-us', 'north-america'), row('b-us', 'north-america'), row('c-us', 'north-america'), row('d-pt', 'southern-europe')];
  const ratios = new Map([['a_us', { ratio: 0.9, n: 10 }], ['b_us', { ratio: 1.1, n: 10, q: 1.2, c: 3 }], ['c_us', { ratio: 1.0, n: 4 }], ['d_pt', { ratio: 2.5, n: 3 }]]);
  const levels = regionRatios(ratios, rows, BAYES);
  assert.ok(Number.isFinite(levels.get('north-america').ratio), 'region with 3 cities has a level');
  assert.equal(levels.get('europe').ratio, undefined, 'one European city: no regional level, only a prior');
  const rule = legacyRule(BAYES);
  const europe = memoryLevel(ratios, { cityId: 'd-pt', regionFamily: 'europe' }, levels, BAYES, rule);
  assert.ok(europe.level < 2.5 * 1.05 && europe.kind === 'bayes-legacy', JSON.stringify(europe));
  assert.equal(memoryLevel(ratios, { cityId: 'zz', regionFamily: 'asia' }, levels, BAYES, rule), null, 'never checked: falls to regional level or margin');
});

test('the default (trust) is unchanged', () => {
  assert.equal(legacyRule({}).mode, 'trust');
  assert.equal(legacyRule({ HOTEL_MEMORY_LEGACY: 'bayes' }).mode, 'trust', 'bayes needs CLEAN_SINCE');
});

test('shadow tracking: clean checks counted while the old average and planning keep today\'s rule', async () => {
  memory._internal.reset();
  const dynamo = fakeDynamo({ r_a_b: { N: '2' }, n_a_b: { N: '4' }, t_a_b: { N: String(CLEAN - 1000) } });
  const env = { FARE_MAP_TABLE: 'globevoy-fare-map', HOTEL_MEMORY_CLEAN_TRACK: 'on', HOTEL_MEMORY_CLEAN_SINCE: '2026-11-25T09:23:00Z' };
  await memory.record([{ cityId: 'a-b', estimateUsd: 100, liveUsd: 100 }], { env, dynamo, fresh: true, clock: () => CLEAN + 1000 });
  assert.equal(Number(dynamo.item.r_a_b.N), 1.8, 'trust rule: (2*4+1)/5');
  assert.equal(dynamo.item.c_a_b.N, '1'); assert.equal(Number(dynamo.item.q_a_b.N), 1);
  assert.equal(legacyRule(env).mode, 'trust', 'planning unchanged');
});
