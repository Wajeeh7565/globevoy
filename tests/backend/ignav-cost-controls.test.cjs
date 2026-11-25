'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ignav = require('../../backend/services/providers/flights/ignav/ignav');
const quota = require('../../backend/services/providers/flights/ignav/ignav-quota');
const cachePath = require.resolve('../../backend/services/domain/live-fares/ignav-fare-cache');
const cache = require(cachePath);

const ENV = Object.freeze({ ENABLE_IGNAV_FLIGHTS: 'true', IGNAV_API_KEY: 'offline-private-key',
  IGNAV_TENANT_SCOPE: 'offline-tenant', FARE_MAP_TABLE: 'fare-cache-test' });
const QUOTA = Object.freeze({ ...ENV, IGNAV_QUOTA_ENABLED: 'on', IGNAV_QUOTA_APPROVED: 'true',
  IGNAV_CONTROL_TABLE: 'quota-test', IGNAV_QUOTA_ACCOUNT: 'offline-account', IGNAV_QUOTA_PERIOD: 'monthly',
  IGNAV_QUOTA_PERIOD_START: '2027-01-31T09:00:00Z', IGNAV_QUOTA_DAILY: '3', IGNAV_QUOTA_BILLING: '5',
  IGNAV_QUOTA_FARE_UNITS: '1', IGNAV_QUOTA_LINK_UNITS: '2', IGNAV_QUOTA_WARN_PERCENT: '60,80' });
const input = { origin: 'YYZ', destination: 'LIS', departureDate: '2027-03-12', adults: 1, children: 0, currency: 'CAD' };
const response = payload => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) });
const gate = () => {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
};
const jsonFare = body => ({ observed_at: new Date().toISOString(), itineraries: [{
  ignav_id: 'offline-ignav-id', price: { amount: 300, currency: 'CAD', status: 'verified' }, outbound: { segments: [{
    departure: { airport: body.origin, local_time: body.departure_date + 'T10:00:00' },
    arrival: { airport: body.destination, local_time: body.departure_date + 'T21:00:00' }
  }] }
}] });
const freshCache = () => {
  delete require.cache[cachePath];
  return require(cachePath);
};

function fakeStore() {
  const records = new Map(), tokens = new Set();
  const db = { records, tokens, enabled: true, fail: false, timeoutAfterCommit: false, fingerprint: null,
    send: async command => {
      if (db.fail) throw new Error('offline DynamoDB unavailable');
      const { TableName, Key, Item, TransactItems, ClientRequestToken, ExpressionAttributeValues } = command.input;
      const key = (table, row) => [table, row.pk.S, row.sk.S].join('|');
      const type = command.constructor.name;
      if (type === 'GetItemCommand') return { Item: records.get(key(TableName, Key)) };
      if (type === 'PutItemCommand') {
        const id = key(TableName, Item);
        const old = records.get(id);
        if (Item.until && old && Number(old.until.N) > Number(ExpressionAttributeValues[':now'].N)) {
          throw Object.assign(new Error('lease taken'), { name: 'ConditionalCheckFailedException' });
        }
        records.set(id, Item); return {};
      }
      if (type === 'DeleteItemCommand') {
        const id = key(TableName, Key);
        if (records.get(id)?.owner?.S === ExpressionAttributeValues[':owner'].S) records.delete(id);
        return {};
      }
      assert.equal(type, 'TransactWriteItemsCommand');
      if (tokens.has(ClientRequestToken)) return {};
      const control = TransactItems[0].ConditionCheck;
      assert.match(control.Key.pk.S, /^IGNAVSTOP#/);
      const matches = !db.fingerprint || db.fingerprint === control.ExpressionAttributeValues[':config'].S;
      const updates = TransactItems.slice(1).map(({ Update: u }) => {
        const id = key(u.TableName, u.Key);
        const used = Number(records.get(id)?.used.N || 0), v = u.ExpressionAttributeValues;
        return { id, used, max: Number(v[':room'].N), units: Number(v[':units'].N) };
      });
      const failed = [!db.enabled || !matches, ...updates.map(u => u.used > u.max)];
      if (failed.some(Boolean)) throw Object.assign(new Error('condition failed'),
        { name: 'TransactionCanceledException', CancellationReasons: failed.map(b => ({ Code: b ? 'ConditionalCheckFailed' : 'None' })) });
      for (const u of updates) records.set(u.id, { used: { N: String(u.used + u.units) } });
      tokens.add(ClientRequestToken);
      if (db.timeoutAfterCommit) {
        db.timeoutAfterCommit = false;
        throw Object.assign(new Error('reservation acknowledgement timed out'), { name: 'TimeoutError' });
      }
      return {};
    }
  };
  return db;
}

test('fare identities canonicalize inputs and isolate every provider input, credentials and tenants', async () => {
  const { keyFor } = cache._internal;
  const key = keyFor(input, ENV);
  assert.equal(key, keyFor({ ...input, origin: ' yyz ', adults: '1', currency: 'cad', market: 'ca' }, ENV));
  for (const values of [{ destination: 'OPO' }, { departureDate: '2027-03-13' }, { adults: 2 }, { children: 1 },
    { currency: 'USD' }, { market: 'US' }, { maxStops: 0 }, { cabinClass: 'business' }]) {
    assert.notEqual(key, keyFor({ ...input, ...values }, ENV));
  }
  for (const scope of [{ IGNAV_TENANT_SCOPE: 'foreign' }, { IGNAV_API_KEY: 'rotated' }]) assert.notEqual(key, keyFor(input, { ...ENV, ...scope }));
  assert.ok(!key.includes(ENV.IGNAV_API_KEY));
});

test('a process joins identical cold fares, records ownership once, and distinguishes cached empty from failure', async () => {
  cache._internal.memory.clear();
  let calls = 0;
  const pending = gate(), events = [];
  const fetchFn = async (_, req) => {
    calls++;
    await pending.promise;
    return response(jsonFare(JSON.parse(req.body)));
  };
  const opts = { env: ENV, sharedCache: false, fetchFn, logIgnavUsage: e => events.push(e) };
  const lead = { ...opts, usage: {} }, other = { ...opts, usage: {} };
  const both = [cache.searchOneWayCached(input, lead), cache.searchOneWayCached(input, other)];
  pending.release();
  assert.deepEqual((await Promise.all(both)).map(r => r.ok), [true, true]);
  assert.equal(calls, 1);
  assert.deepEqual(lead.usage, { fareRequests: 1 });
  assert.deepEqual(other.usage, { concurrentJoins: 1 });
  await cache.searchOneWayCached(input, other);
  assert.equal(other.usage.localCacheHits, 1);
  assert.ok(!JSON.stringify(events).match(/YYZ|LIS|offline-private-key|offline-ignav-id|bookingProof/));

  const emptyOpts = { ...opts, fetchFn: async () => response({ observed_at: new Date().toISOString(), itineraries: [] }) };
  const empty = await cache.searchOneWayCached({ ...input, cabinClass: 'economy' }, emptyOpts);
  assert.equal(empty.ok, true);
  assert.equal(empty.cheapest, null);
  assert.equal((await cache.searchOneWayCached({ ...input, cabinClass: 'economy' }, emptyOpts)).fromCache, true);
  const invalid = { ...opts, fetchFn: async () => response({ observed_at: new Date().toISOString() }) };
  assert.equal((await cache.searchOneWayCached({ ...input, cabinClass: 'first' }, invalid)).reason, 'ignav-invalid-itineraries');
  assert.equal((await cache.searchOneWayCached({ ...input, cabinClass: 'first' }, invalid)).fromCache, undefined);
});

test('a shared lease avoids duplicate sends across instances and expired or failed leaders recover', async () => {
  const db = fakeStore(), env = { ...ENV, IGNAV_SHARED_LEASE: 'on' }, opts = { env, dynamo: db };
  const a = freshCache(), b = freshCache();
  const blocked = gate(), entered = gate();
  let calls = 0;
  const fetchFn = async (_, req) => { calls++; entered.release(); await blocked.promise; return response(jsonFare(JSON.parse(req.body))); };
  const leader = a.searchOneWayCached(input, { ...opts, fetchFn });
  await entered.promise;
  const usage = {};
  const follower = b.searchOneWayCached(input, { ...opts, fetchFn, usage });
  blocked.release();
  assert.equal((await leader).ok, true);
  assert.equal((await follower).fromCache, true);
  assert.equal(calls, 1);
  assert.equal(usage.sharedCacheHits, 1);
  const expiredInput = { ...input, maxStops: 0 };
  const expiredKey = a._internal.leaseKey(a._internal.keyFor(expiredInput, env));
  db.records.set([env.FARE_MAP_TABLE, expiredKey.pk.S, expiredKey.sk.S].join('|'), { until: { N: '1' }, owner: { S: 'dead' } });
  const failed = await a.searchOneWayCached(expiredInput, { ...opts, fetchFn: async () => { throw Error('leader failed'); } });
  assert.equal(failed.reason, 'ignav-network-error');
  assert.equal((await b.searchOneWayCached(expiredInput, { ...opts, fetchFn })).ok, true);

  const busy = { ...input, maxStops: 1 };
  const busyKey = a._internal.leaseKey(a._internal.keyFor(busy, env));
  db.records.set([env.FARE_MAP_TABLE, busyKey.pk.S, busyKey.sk.S].join('|'), { until: { N: String(Date.now() + 30000) }, owner: { S: 'busy' } });
  assert.equal((await b.searchOneWayCached(busy, { ...opts, fetchFn })).reason, 'ignav-cache-lease-wait-expired');
  db.fail = true;
  assert.equal((await b.searchOneWayCached({ ...input, maxStops: 2 }, { ...opts, fetchFn })).reason, 'ignav-cache-lease-unavailable');
  assert.equal(calls, 2);
});

test('quota counts concurrent daily and period reservations atomically and resets from the approved anchor', async () => {
  const db = fakeStore(), logs = [];
  let now = Date.parse(QUOTA.IGNAV_QUOTA_PERIOD_START);
  const opts = { env: QUOTA, quotaDynamo: db, quotaClock: () => now, logIgnavUsage: e => logs.push(e) };
  const answers = await Promise.all(Array.from({ length: 7 }, () => quota.reserve('fare', opts)));
  assert.equal(answers.filter(a => a.ok).length, 3);
  assert.equal(db.tokens.size, 3);
  assert.ok(answers.filter(a => !a.ok).every(a => a.reason === 'ignav-quota-exhausted'));
  assert.ok(logs.some(e => e.action === 'quota-warning' && e.window === 'daily' && e.threshold === 80));
  now += 86400000;
  assert.equal((await quota.reserve('booking-link', opts)).ok, true);
  assert.equal((await quota.reserve('fare', opts)).reason, 'ignav-quota-exhausted');
  now = Date.parse('2027-02-28T09:00:00Z');
  assert.equal((await quota.reserve('fare', opts)).ok, true);
  assert.equal(new Date(quota._internal.billingWindow(now, Date.parse(QUOTA.IGNAV_QUOTA_PERIOD_START), 'monthly').end).toISOString(), '2027-03-31T09:00:00.000Z');
  assert.equal(quota._internal.billingWindow(Date.parse('2027-02-02T09:00:00Z'), Date.parse(QUOTA.IGNAV_QUOTA_PERIOD_START), '2').start, Date.parse('2027-02-02T09:00:00Z'));
});

test('timeout accounting is conservative, reservation retries are idempotent and quota state fails closed', async () => {
  const db = fakeStore(), events = [], usage = {};
  const risky = gate();
  const opts = { env: QUOTA, quotaDynamo: db, quotaClock: () => Date.parse('2027-02-02T09:00:00Z'),
    logIgnavUsage: entry => events.push(entry), usage, fetchFn: () => risky.promise, timeoutMs: 1000 };
  db.timeoutAfterCommit = true;
  try {
    const timed = await ignav.searchOneWay(input, opts);
    assert.equal(timed.reason, 'ignav-timeout');
    assert.equal(db.tokens.size, 1, 'ambiguous reservation was retried with one token');
    assert.equal(usage.timeouts, 1);
    assert.equal(usage.failedRequests, 1);
  } finally { risky.release(response({})); }
  db.fail = true;
  assert.equal((await ignav.searchOneWay(input, opts)).reason, 'ignav-quota-unavailable');
  db.fail = false;
  db.enabled = false;
  assert.equal((await ignav.searchOneWay(input, opts)).reason, 'ignav-quota-stopped');
  db.enabled = true;
  db.fingerprint = 'another-policy';
  assert.equal((await ignav.searchOneWay(input, opts)).reason, 'ignav-quota-stopped');
  assert.equal((await ignav.searchOneWay(input, { ...opts, env: { ...QUOTA, IGNAV_QUOTA_APPROVED: '' } })).reason, 'ignav-quota-unconfigured');
  assert.equal(usage.fareRequests, 1);
  assert.equal(usage.quotaBlocked, 4);
  assert.ok(events.every(e => !JSON.stringify(e).includes(QUOTA.IGNAV_API_KEY)));
});

test('valid cached fare bypasses quota, while concurrent booking clicks validate proofs and share only active work', async () => {
  cache._internal.memory.clear();
  const db = fakeStore(), env = QUOTA, now = Date.parse('2027-02-02T09:00:00Z'), usage = {};
  let calls = 0;
  const fetchFn = async(url, req) => {
    calls++;
    return response(url.endsWith('/booking-links') ? { booking_options: [{ links: [
      { url: 'https://booking.example.test/a', specificity: 'search_results' },
      { url: 'https://booking.example.test/b', specificity: 'exact_flight' }
    ] }] } : jsonFare(JSON.parse(req.body)));
  };
  const opts = { env, quotaDynamo: db, quotaClock: () => now, sharedCache: false, usage, fetchFn };
  const fare = await cache.searchOneWayCached(input, opts);
  assert.equal(fare.ok, true);
  db.enabled = false;
  assert.equal((await cache.searchOneWayCached(input, opts)).fromCache, true);
  assert.equal(calls, 1);
  db.enabled = true;
  const id = fare.cheapest.ignavId;
  const proof = fare.cheapest.bookingProof;
  const clicks = await Promise.all([ignav.getBookingLinks(id, { ...opts, proof }), ignav.getBookingLinks(id, { ...opts, proof })]);
  assert.deepEqual(clicks.map(r => r.exactFlightLinkCount), [1, 1]);
  assert.equal(usage.bookingLinkRequests, 1);
  assert.equal((await ignav.getBookingLinks(id, { ...opts, env: { ...env, IGNAV_TENANT_SCOPE: 'different' }, proof })).reason,
    'invalid-or-expired-booking-proof');
  assert.equal(await ignav.getBookingLinks(id, { ...opts, proof: ignav._internal.bookingProof(id, env, Math.floor(Date.now()/1000) - 901) }).then(r => r.reason), 'invalid-or-expired-booking-proof');
  assert.equal((await ignav.getBookingLinks(id, { ...opts, proof })).reason, 'ignav-quota-exhausted');
  assert.equal(calls, 2);
});
