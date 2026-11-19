'use strict';
// Offline: Travelpayouts and DynamoDB are mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const ingest = require('../../backend/services/domain/fare-map/fare-map-ingest');
const store = require('../../backend/services/domain/fare-map/fare-map-store');
const job = require('../../backend/services/domain/fare-map/fare-map-job');

function tpFetch(pages, seen = []) {
  return async (url, init) => {
    const q = JSON.parse(init.body).query; seen.push(q);
    const offset = Number((q.match(/offset: (\d+)/) || [])[1] || 0);
    const rows = pages[offset / 30] || [];
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { prices_one_way: rows } }) };
  };
}
function fakeDynamo() {
  const items = new Map(); const calls = [];
  return { items, calls, send: async (c) => {
    const name = c.constructor.name; calls.push(name); const i = c.input;
    if (name === 'BatchWriteItemCommand') { for (const [, reqs] of Object.entries(i.RequestItems)) reqs.forEach(r => items.set(r.PutRequest.Item.pk.S + '|' + r.PutRequest.Item.sk.S, r.PutRequest.Item)); return {}; }
    if (name === 'PutItemCommand') {
      const key=i.Item.pk.S+'|'+i.Item.sk.S,old=items.get(key),values=i.ExpressionAttributeValues||{};
      if(i.ConditionExpression&&old){
        const valid=values[':owner'] ? old.owner?.S===values[':owner'].S&&Number(old.leaseUntil?.N)>Number(values[':now'].N) :
          (!old.leaseUntil||Number(old.leaseUntil.N)<Number(values[':now'].N))&&(!values[':revision']||!old.revision||old.revision.N===values[':revision'].N);
        if(!valid)throw Object.assign(new Error('lease conflict'),{name:'ConditionalCheckFailedException'});
      }
      items.set(key,i.Item);return {};
    }
    if (name === 'GetItemCommand') { return { Item: items.get(i.Key.pk.S + '|' + i.Key.sk.S) }; }
    if (name === 'QueryCommand') { const pk = i.ExpressionAttributeValues[':pk'].S; return { Items: [...items.entries()].filter(([k]) => k.startsWith(pk + '|')).map(([, v]) => v) }; }
    return {};
  } };
}
const ENV = { ENABLE_FARE_MAP_JOB: 'true', FARE_MAP_TABLE: 'globevoy-fare-map', TRAVELPAYOUTS_TOKEN: 'tp_test' };

test('ingest: one origin+month → cheapest fare per destination, validated', async () => {
  const seen = [];
  const r = await ingest.ingestOriginMonth({ origin: 'yto', month: '2026-12', token: 't', toUsd: v => Number(v), now: Date.parse('2026-11-19T00:00:00Z'), fetch: tpFetch([[
    { destination_city_iata: 'MDE', departure_at: '2026-12-03T10:00:00Z', value: 320, number_of_changes: 1, duration: 410 },
    { destination_city_iata: 'MDE', departure_at: '2026-12-09T10:00:00Z', value: 300 },
    { destination_city_iata: 'LIS', departure_at: '2027-01-02T10:00:00Z', value: 450 },
    { destination_city_iata: 'YTO', value: 10 },
    { destination_city_iata: 'bad1', value: 10 },
    { destination_city_iata: 'CUN', value: -5 }
  ]], seen) });
  assert.equal(r.ok, true);
  assert.equal(r.requests, 1);
  assert.match(seen[0], /origin: "YTO", depart_months: "2026-12-01"/);
  const by = Object.fromEntries(r.records.map(x => [x.destination, x]));
  assert.deepEqual(Object.keys(by).sort(), ['LIS', 'MDE']);
  assert.equal(by.MDE.priceUsd, 300);
  assert.equal(by.LIS.departureDate, null, 'date outside the month is dropped');
  assert.equal(by.MDE.source, 'travelpayouts-cached');
});

test('ingest refuses bad input and missing token', async () => {
  assert.equal((await ingest.ingestOriginMonth({ origin: 'YTO"}', month: '2026-12', token: 't' })).reason, 'invalid-origin-or-month');
  assert.equal((await ingest.ingestOriginMonth({ origin: 'YTO', month: '2026-12' })).reason, 'travelpayouts-token-missing');
});

test('ingest pages until a short page', async () => {
  const full = Array.from({ length: 30 }, (_, i) => ({ destination_city_iata: 'A' + String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + Math.floor(i / 26)), value: 100 + i }));
  const r = await ingest.ingestOriginMonth({ origin: 'YTO', month: '2026-12', token: 't', fetch: tpFetch([full, [{ destination_city_iata: 'ZZZ', value: 99 }]]) });
  assert.equal(r.requests, 2);
  assert.ok(r.records.some(x => x.destination === 'ZZZ'));
});

test('months and origins from the registry', () => {
  assert.deepEqual(ingest.upcomingMonths(3, Date.parse('2026-11-19T00:00:00Z')), ['2026-11', '2026-12', '2027-01']);
  const codes = ingest.originCodesFromRegistry(require('../../backend/data/unified-city-registry-1000.json'));
  assert.ok(codes.length > 500, String(codes.length));
  assert.ok(codes.includes('YTO'));
});

test('store round-trips records and reads one origin+month with a single query', async () => {
  const dynamo = fakeDynamo();
  const rec = { origin: 'YTO', month: '2026-12', destination: 'MDE', priceUsd: 300, departureDate: '2026-12-09', stops: 1, durationMinutes: 410, source: 'travelpayouts-cached', observedAt: '2026-11-19T00:00:00.000Z' };
  assert.equal(await store.writeRecords([rec], { env: ENV, dynamo, sleep: false }), 1);
  const back = await store.readRoutesFrom('YTO', '2026-12', { env: ENV, dynamo, nowMs:Date.parse(rec.observedAt) });
  assert.deepEqual(back, [{ ...rec }].map(({ ...x }) => x));
  assert.ok(Number(dynamo.items.get('F#YTO#2026-12|MDE').ttl.N) > Date.now() / 1000);
});

test('job: off by default; resumes from its cursor and wraps at the end of a cycle', async () => {
  assert.equal((await job.runFareMapJob({ env: {} })).reason, 'disabled');
  const dynamo = fakeDynamo();
  const fetch = tpFetch([[{ destination_city_iata: 'MDE', value: 300 }]]);
  const opts = { env: ENV, dynamo, fetch, origins: ['YTO', 'YMQ'], pauseMs: 0, pace:async()=>{}, now: Date.parse('2026-11-19T00:00:00Z') };
  const first = await job.runFareMapJob({ ...opts, maxTasks: 1 }); // stops after the first task
  assert.equal(first.done, 1);
  assert.equal(first.finishedCycle, false);
  const rest = await job.runFareMapJob({ ...opts, timeBudgetMs: 60000 });
  assert.equal(rest.startIndex, 1);
  assert.equal(rest.finishedCycle, true);
  assert.equal(first.done + rest.done, 16, '2 origins across eight departure and return months');
  assert.equal((await store.readCursor({ env: ENV, dynamo })).index, 0);
  assert.equal((await store.readRoutesFrom('YMQ', '2027-04', { env: ENV, dynamo, nowMs:opts.now })).length, 1);
});

test('lambda: scheduled fare-map event runs the job (disabled → no-op), HTTP events are untouched', async () => {
  assert.equal(job.isFareMapEvent({ globevoyJob: 'fare-map' }), true);
  assert.equal(job.isFareMapEvent({ rawPath: '/api/city-registry' }), false);
  const { handler } = require('../../backend/lambda');
  const r = await handler({ globevoyJob: 'fare-map' });
  assert.equal(r.reason, 'disabled');
});

test('standard scheduled event from the globevoy-fare-map rule is recognised; other rules are not', () => {
  const ev = (rule) => ({ source: 'aws.events', 'detail-type': 'Scheduled Event', resources: [`arn:aws:events:us-east-2:216241083409:rule/${rule}`], detail: {} });
  assert.equal(job.isFareMapEvent(ev('globevoy-fare-map-every-5-min')), true);
  assert.equal(job.isFareMapEvent(ev('some-other-rule')), false);
});

test('prices are converted from the Travelpayouts currency (RUB by default) like the existing code', async () => {
  const r = await ingest.ingestOriginMonth({ origin: 'YTO', month: '2026-12', token: 't', fetch: tpFetch([[{ destination_city_iata: 'MDE', value: 30000 }]]) });
  assert.equal(r.records[0].priceUsd, Math.round(30000 * 0.011));
});

test('GraphQL errors are reported with detail and recorded on the cursor', async () => {
  const dynamo = fakeDynamo();
  const fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ errors: [{ message: 'bad depart_months' }] }) });
  const r = await job.runFareMapJob({ env: ENV, dynamo, fetch, origins: ['YTO'], pauseMs: 0, pace:async()=>{}, maxTasks: 1 });
  assert.equal(r.failures, 1);
  assert.equal(r.lastReason, 'provider-graphql-error');
  const cur = dynamo.items.get('META#job|cursor');
  assert.match(cur.lastRun.S, /provider-graphql-error/);
  assert.doesNotMatch(cur.lastRun.S, /bad depart_months/);
  assert.equal((await store.readCursor({env:ENV,dynamo})).index,0);
});


test('documented page size, malformed JSON and HTML throttling are classified safely',async()=>{
 assert.match(ingest._internal.buildQuery('YTO','2027-01',0),/limit: 30/);
 const r=await ingest.ingestOriginMonth({origin:'YTO',month:'2027-01',token:'secret',pace:async()=>{},fetch:async()=>({status:429,ok:false,text:async()=>{throw Error('must not parse HTML')}})});
 assert.equal(r.reason,'rate-limited');assert.equal(r.requests,1);
 const bad=await ingest.ingestOriginMonth({origin:'YTO',month:'2027-01',token:'secret',pace:async()=>{},fetch:async()=>({status:200,ok:true,text:async()=>'{broken'})});assert.equal(bad.reason,'provider-invalid-json');
});
test('transient errors retry exactly twice with bounded exponential backoff; permanent errors do not',async()=>{
 let calls=0;const waits=[];const options={origin:'YTO',month:'2027-01',token:'secret',pace:async()=>{},sleep:async ms=>waits.push(ms)};
 const r=await ingest.ingestOriginMonth({...options,fetch:async()=>{calls++;if(calls<3)throw Error('network');return {ok:true,status:200,text:async()=>JSON.stringify({data:{prices_one_way:[]}})}}});
 assert.equal(r.ok,true);assert.equal(r.requests,3);assert.equal(r.retries,2);assert.deepEqual(waits,[500,1000]);
 const p=await ingest.ingestOriginMonth({...options,fetch:async()=>({ok:false,status:401,text:async()=>'{}'})});assert.equal(p.requests,1);assert.equal(p.reason,'provider-auth-error');
});
test('unprocessed DynamoDB writes are never counted as a successful completed batch',async()=>{
 const rec={origin:'YTO',month:'2027-01',destination:'LON',priceUsd:100,observedAt:new Date().toISOString()};let calls=0;
 await assert.rejects(store.writeRecords([rec],{env:ENV,sleep:false,dynamo:{send:async c=>{calls++;return {UnprocessedItems:c.input.RequestItems}}}}),e=>e.code==='dynamodb-unprocessed'&&e.written===0);assert.equal(calls,5);
});
test('failed task is retained and recovered; empty successful result advances',async()=>{
 const dynamo=fakeDynamo();const opts={env:ENV,dynamo,origins:['YTO'],maxTasks:1,pace:async()=>{},log:()=>{}};
 const bad=await job.runFareMapJob({...opts,fetch:async()=>({ok:false,status:429,text:async()=>''})});assert.equal(bad.rateLimited,true);assert.equal((await store.readCursor({env:ENV,dynamo})).index,0);
 const waiting=await job.runFareMapJob({...opts,fetch:()=>assert.fail('must respect cooldown')});assert.equal(waiting.reason,'provider-cooldown');
 const good=await job.runFareMapJob({...opts,clock:()=>Date.now()+61000,fetch:tpFetch([[]])});assert.equal(good.done,1);assert.equal(good.empty,1);assert.equal((await store.readCursor({env:ENV,dynamo})).index,1);
});
test('active lease prevents overlapping provider calls and stale-owner writes',async()=>{
 const dynamo=fakeDynamo(),now=Date.now();await store.writeCursor({index:0,owner:'first',leaseUntil:now+120000},{env:ENV,dynamo,nowMs:now,acquire:true});
 const r=await job.runFareMapJob({env:ENV,dynamo,fetch:()=>assert.fail('overlap must not fetch')});assert.equal(r.reason,'overlapping-run');
 await assert.rejects(store.writeCursor({index:99},{env:ENV,dynamo,owner:'second',nowMs:now}),{name:'ConditionalCheckFailedException'});
});
test('pacer applies to every provider request, including pages and retries',async()=>{
 let now=1000;const waits=[];const pace=ingest.createPacer({clock:()=>now,sleep:async ms=>{waits.push(ms);now+=ms}});
 await pace(10000);await pace(10000);await pace(10000);assert.deepEqual(waits,[1100,1100]);
});


test('DynamoDB write failure keeps task retryable and cursor cannot advance',async()=>{
 const dynamo=fakeDynamo(),send=dynamo.send;let broken=true;
 dynamo.send=async c=>{if(c.constructor.name==='BatchWriteItemCommand'&&broken)throw Object.assign(Error('private details'),{name:'AccessDeniedException'});return send(c)};
 const opts={env:ENV,dynamo,origins:['YTO'],maxTasks:1,pace:async()=>{},log:()=>{},fetch:tpFetch([[{destination_city_iata:'LON',value:100}]])};
 const first=await job.runFareMapJob(opts);assert.equal(first.lastReason,'dynamodb-error');assert.equal((await store.readCursor({env:ENV,dynamo})).index,0);
 broken=false;const next=await job.runFareMapJob(opts);assert.equal(next.done,1);assert.equal(next.failures,0);
});
test('pagination checkpoint resumes next offset without skipping incomplete origin/month',async()=>{
 const dynamo=fakeDynamo(),pages=Array.from({length:4},(_,page)=>Array.from({length:30},(_,j)=>({destination_city_iata:'A'+String.fromCharCode(65+page)+String.fromCharCode(65+j%26),value:100})));
 let ticks=0;const first=await job.runFareMapJob({env:ENV,dynamo,origins:['YTO'],clock:()=>100000+ticks++,now:100000,maxTasks:1,timeBudgetMs:7000,pace:async()=>{},fetch:tpFetch(pages),log:()=>{}});
 assert.equal(first.done,0);const c=await store.readCursor({env:ENV,dynamo});assert.equal(c.offset,90);assert.equal(c.index,0);
 const seen=[];const second=await job.runFareMapJob({env:ENV,dynamo,origins:['YTO'],clock:()=>200000,now:100000,maxTasks:1,pace:async()=>{},fetch:tpFetch(pages,seen),log:()=>{}});assert.match(seen[0],/offset: 90/);assert.equal(second.done,1);
});

test('partial batch retries only pending items, accepts an empty unprocessed table and counts once',async()=>{
 const records=['LON','PAR'].map(destination=>({origin:'YTO',month:'2027-01',destination,priceUsd:100,observedAt:new Date().toISOString()}));
 const sizes=[];
 const written=await store.writeRecords(records,{env:ENV,sleep:false,dynamo:{send:async c=>{
  const pending=c.input.RequestItems[ENV.FARE_MAP_TABLE];sizes.push(pending.length);
  return {UnprocessedItems:{[ENV.FARE_MAP_TABLE]:sizes.length===1?[pending[1]]:[]}};
 }}});
 assert.equal(written,2);assert.deepEqual(sizes,[2,1]);
});

test('reader follows filtered empty pages and enforces logical TTL and freshness locally',async()=>{
 const now=Date.parse('2027-01-01T00:00:00Z'),rec={origin:'YTO',month:'2027-01',destination:'LON',priceUsd:100,observedAt:new Date(now).toISOString()};
 const fresh=store._internal.toItem(rec,now),expired=structuredClone(fresh),stale=structuredClone(fresh);
 expired.ttl.N=String(now/1000);stale.observedAt.S='2026-01-01';let calls=0;
 const dynamo={send:async c=>{calls++;assert.equal(c.input.ExclusiveStartKey?.sk?.S,calls===1?undefined:'page1');return calls===1?{Items:[],LastEvaluatedKey:{sk:{S:'page1'}}}:{Items:[fresh,expired,stale]}}};
 const result=await store.readRoutesFrom('YTO','2027-01',{env:ENV,dynamo,nowMs:now,maxPages:2});
 assert.equal(calls,2);assert.equal(result.length,1);
});

test('opt-in dated samples preserve legacy monthly reads and accumulate only observed dates',async()=>{
 const dynamo=fakeDynamo(),now=Date.parse('2027-01-01T00:00:00Z'),base={origin:'YTO',month:'2027-02',destination:'LON',priceUsd:100,observedAt:new Date(now).toISOString()};
 const opts={env:{...ENV,FARE_MAP_RETAIN_DATED_OBSERVATIONS:'true'},dynamo,nowMs:now};
 await store.writeRecords([{...base,departureDate:'2027-02-03'}],opts);
 await store.writeRecords([{...base,departureDate:'2027-02-09',priceUsd:110}],opts);
 const legacy=await store.readRoutesFrom('YTO','2027-02',opts);assert.equal(legacy.length,1);assert.equal(legacy[0].departureDate,'2027-02-09');
 const sampled=await store.readRoutesFrom('YTO','2027-02',{...opts,includeDated:true});
 assert.deepEqual(sampled.map(f=>f.departureDate).sort(),['2027-02-03','2027-02-09']);assert.ok(sampled.every(f=>f.destination==='LON'));
});

// Real DynamoDB rejects reserved words used bare in expressions (ValidationException).
// The plain fake above does not, which hid a production bug: `owner = :owner`.
const RESERVED = ['owner', 'ttl', 'index', 'name', 'status', 'date', 'source', 'month', 'origin', 'destination'];
function strictDynamo() {
  const inner = fakeDynamo();
  const send = inner.send;
  inner.send = async (c) => {
    const i = c.input || {};
    for (const expr of [i.ConditionExpression, i.FilterExpression, i.KeyConditionExpression, i.ProjectionExpression, i.UpdateExpression].filter(Boolean)) {
      const bare = expr.replace(/[#:][A-Za-z0-9_]+/g, ' ').toLowerCase().match(/[a-z_][a-z0-9_]*/g) || [];
      const hit = bare.find(w => RESERVED.includes(w));
      if (hit) throw Object.assign(new Error(`Attribute name is a reserved keyword; reserved keyword: ${hit}`), { name: 'ValidationException' });
      for (const ref of expr.match(/#[A-Za-z0-9_]+/g) || []) if (!i.ExpressionAttributeNames || !(ref in i.ExpressionAttributeNames)) throw Object.assign(new Error(`unresolved ${ref}`), { name: 'ValidationException' });
    }
    return send(c);
  };
  return inner;
}

test('job against a DynamoDB that enforces reserved words: checkpoints, records lastRun and releases its lease', async () => {
  const dynamo = strictDynamo();
  const fetch = tpFetch([[{ destination_city_iata: 'MDE', value: 30000, departure_at: '2026-12-10T10:00:00Z' }]]);
  const r = await job.runFareMapJob({ env: ENV, dynamo, fetch, origins: ['YTO', 'YMQ'], pauseMs: 0, sleep: async () => {}, maxTasks: 2, now: Date.parse('2026-11-19T00:00:00Z') });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.notEqual(r.lastReason, 'dynamodb-checkpoint-error');
  assert.equal(r.done, 2);
  const cur = dynamo.items.get('META#job|cursor');
  assert.equal(cur.leaseUntil.N, '0', 'lease released');
  assert.ok(cur.lastRun && JSON.parse(cur.lastRun.S).done === 2);
  // A second run can start immediately (no stale lease).
  const again = await job.runFareMapJob({ env: ENV, dynamo, fetch, origins: ['YTO', 'YMQ'], pauseMs: 0, sleep: async () => {}, maxTasks: 1, now: Date.parse('2026-11-19T00:00:00Z') });
  assert.equal(again.ran, true);
});

test('a permanent 4xx for one origin is skipped (recorded), not retried forever; 5xx/429 still stop the run', async () => {
  const dynamo = strictDynamo();
  const ok = tpFetch([[{ destination_city_iata: 'MDE', value: 30000, departure_at: '2026-12-10T10:00:00Z' }]]);
  const fetch = async (url, init) => /origin: "YVA"/.test(JSON.parse(init.body).query)
    ? { ok: false, status: 400, headers: { get: () => null }, text: async () => '{"error":"bad origin"}' }
    : ok(url, init);
  const r = await job.runFareMapJob({ env: ENV, dynamo, fetch, origins: ['YVA', 'YTO'], pauseMs: 0, sleep: async () => {}, maxTasks: 2, now: Date.parse('2026-11-19T00:00:00Z') });
  assert.equal(r.done, 2, JSON.stringify(r));
  assert.equal(r.skipped, 1);
  assert.ok(r.written > 0, 'next origin collected');
  assert.match(r.skippedTasks[0], /^YVA#2026-11:400$/);
  assert.equal(r.ok, true);
  const cur = dynamo.items.get('META#job|cursor');
  assert.equal(cur.leaseUntil.N, '0');
  assert.match(cur.taskKey.S, /^YVA#2026-12$/, 'cursor moved past the skipped task');

  const d2 = strictDynamo();
  const down = async () => ({ ok: false, status: 503, headers: { get: () => null }, text: async () => 'down' });
  const r2 = await job.runFareMapJob({ env: ENV, dynamo: d2, fetch: down, origins: ['YTO', 'YMQ'], pauseMs: 0, sleep: async () => {}, maxTasks: 2, now: Date.parse('2026-11-19T00:00:00Z') });
  assert.equal(r2.done, 0, 'server errors keep the task for the next run');
  assert.equal(r2.lastReason, 'provider-server-error');
});
