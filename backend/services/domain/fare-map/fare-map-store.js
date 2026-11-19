'use strict';
// GV-FAREMAP-001 — fare map storage in DynamoDB.
//
// One table (FARE_MAP_TABLE), single-table layout:
//   pk = "F#<ORIGIN>#<YYYY-MM>"  sk = "<DEST>"   → one cheapest fare per route+month
//   pk = "META#job"              sk = "cursor"   → where the rolling job is up to
// Reading all destinations from an origin in a month is ONE Query, which is
// what the route search needs to expand a stop. Rows expire via `ttl`.

const TTL_DAYS = 14;

function client(options = {}) {
  if (options.dynamo) return options.dynamo;
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  return new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2', maxAttempts: 1, requestHandler: { connectionTimeout: 1000, requestTimeout: 2000 } });
}
function cmd(name, input) {
  let sdk = null;
  try { sdk = require('@aws-sdk/client-dynamodb'); } catch (_) { sdk = null; }
  if (sdk && sdk[name]) return new sdk[name](input);
  // No SDK installed (local tests with an injected client): same shape.
  const Shim = { [name]: class { constructor(i) { this.input = i; } } }[name];
  return new Shim(input);
}
function tableName(env = process.env) {
  const t = String(env.FARE_MAP_TABLE || '').trim();
  return /^[A-Za-z0-9_.-]{3,255}$/.test(t) ? t : '';
}

function toItem(rec, nowMs = Date.now()) {
  const item = {
    pk: { S: `F#${rec.origin}#${rec.month}` },
    sk: { S: rec.datedObservation ? rec.destination+'#'+rec.departureDate : rec.destination },
    priceUsd: { N: String(rec.priceUsd) },
    source: { S: rec.source || 'travelpayouts-cached' },
    observedAt: { S: rec.observedAt },
    ttl: { N: String(Math.floor(nowMs / 1000) + TTL_DAYS * 86400) }
  };
  if (rec.departureDate) item.departureDate = { S: rec.departureDate };
  if (rec.stops != null) item.stops = { N: String(rec.stops) };
  if (rec.durationMinutes != null) item.durationMinutes = { N: String(rec.durationMinutes) };
  return item;
}
function fromItem(item) {
  const [, origin, month] = String(item?.pk?.S || '').split('#');
  return {
    origin, month,
    destination: item?.sk?.S?.split('#')[0],
    priceUsd: Number(item?.priceUsd?.N),
    departureDate: item?.departureDate?.S || null,
    stops: item?.stops ? Number(item.stops.N) : null,
    durationMinutes: item?.durationMinutes ? Number(item.durationMinutes.N) : null,
    source: item?.source?.S || null,
    observedAt: item?.observedAt?.S || null
  };
}

async function writeRecords(records, options = {}) {
  const table = tableName(options.env);
  if (!table) throw new Error('FARE_MAP_TABLE not configured');
  const db = client(options);
  // Additive, opt-in sampling of dates already observed by the existing collector.
  if(String(options.env?.FARE_MAP_RETAIN_DATED_OBSERVATIONS||'').toLowerCase()==='true')records=records.flatMap(r=>r.departureDate?[r,{...r,datedObservation:true}]:[r]);
  let written = 0;
  for (let i = 0; i < records.length; i += 25) {
    let request = { [table]: records.slice(i, i + 25).map(r => ({ PutRequest: { Item: toItem(r, options.nowMs) } })) };
    for (let attempt = 0; attempt < 5 && request && Object.keys(request).length; attempt += 1) {
      let out;
      try { out = await db.send(cmd('BatchWriteItemCommand', { RequestItems: request })); }
      catch(error) {
        const transient=['ThrottlingException','ProvisionedThroughputExceededException','InternalServerError','RequestLimitExceeded'].includes(error.name);
        if(!transient||attempt===4)throw Object.assign(new Error('DynamoDB batch failed'),{code:'dynamodb-error',written});
        if(options.stats)options.stats.dynamoRetries++;
        await (options.sleepFn|| (ms=>new Promise(r=>setTimeout(r,ms))))(100*2**attempt);continue;
      }
      const pending = out?.UnprocessedItems?.[table];
      const left = Array.isArray(pending) && pending.length ? { [table]: pending } : null;
      written += (request[table].length - (left ? left[table].length : 0));
      request = left;
      if(request){if(options.stats)options.stats.dynamoRetries++;if(options.sleep!==false)await (options.sleepFn|| (ms=>new Promise(r=>setTimeout(r,ms))))(100*2**attempt);}
    }
    if(request)throw Object.assign(new Error('Unprocessed fare records remain'),{code:'dynamodb-unprocessed',written});
  }
  return written;
}

async function readRoutesFrom(origin, month, options = {}) {
  const table = tableName(options.env);
  if (!table) return [];
  const db = client(options);
  const out = [];
  let key, pages = 0;
  do {
    const res = await db.send(cmd('QueryCommand', {
      TableName: table,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': { S: `F#${origin}#${month}` }, ':now': { N: String(Math.floor((options.nowMs ?? Date.now()) / 1000)) } },
      FilterExpression: '#ttl > :now',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExclusiveStartKey: key,
      Limit: options.limit || 1000
    }), { abortSignal: options.abortSignal });
    pages++;
    (res?.Items || []).forEach(i => {
      const now=options.nowMs??Date.now(),observed=Date.parse(i.observedAt?.S);
      if((options.includeDated||!i.sk?.S?.includes('#'))&&Number(i.ttl?.N)>now/1000&&Number.isFinite(observed)&&observed<=now+60000&&observed>=now-TTL_DAYS*86400000)out.push(fromItem(i));
    });
    key = res?.LastEvaluatedKey;
    if(options.maxRecords&&out.length>=options.maxRecords)return out.slice(0,options.maxRecords);
  } while (key && pages < (options.maxPages || Infinity));
  if(key&&options.diagnostics){options.diagnostics.bounded=true;options.diagnostics.truncatedPartitions=(options.diagnostics.truncatedPartitions||0)+1;}
  if(options.includeDated){const dates=new Map();for(const fare of out){const k=fare.destination+'#'+fare.departureDate;const prev=dates.get(k);if(!prev||fare.observedAt>prev.observedAt)dates.set(k,fare);}return [...dates.values()];}
  return out;
}

async function readCursor(options = {}) {
  const res=await client(options).send(cmd('GetItemCommand',{TableName:tableName(options.env),Key:{pk:{S:'META#job'},sk:{S:'cursor'}},ConsistentRead:true}));
  const i=res?.Item||{};
  return {index:Number(i.index?.N||0),cycleStartedAt:i.cycleStartedAt?.S||null,revision:Number(i.revision?.N||0),leaseUntil:Number(i.leaseUntil?.N||0),owner:i.owner?.S||null,taskKey:i.taskKey?.S||null,offset:Number(i.offset?.N||0),retryAt:Number(i.retryAt?.N||0)};
}
async function writeCursor(cursor,options={}) {
  const now=options.nowMs??Date.now();
  const item={pk:{S:'META#job'},sk:{S:'cursor'},index:{N:String(cursor.index)},updatedAt:{S:new Date(now).toISOString()},revision:{N:String((cursor.revision||0)+1)},leaseUntil:{N:String(cursor.leaseUntil||0)},offset:{N:String(cursor.offset||0)},retryAt:{N:String(cursor.retryAt||0)}};
  for(const k of ['cycleStartedAt','taskKey','owner'])if(cursor[k])item[k]={S:cursor[k]};
  if(cursor.lastRun)item.lastRun={S:JSON.stringify(cursor.lastRun).slice(0,8000)};
  const condition=options.acquire
    ? '(attribute_not_exists(pk) OR ((attribute_not_exists(leaseUntil) OR leaseUntil < :now) AND (attribute_not_exists(revision) OR revision = :revision)))'
    : options.owner ? '#owner = :owner AND leaseUntil > :now' : 'attribute_not_exists(leaseUntil) OR leaseUntil < :now';
  const values={':now':{N:String(now)}};
  if(options.acquire)values[':revision']={N:String(cursor.revision||0)};
  else if(options.owner)values[':owner']={S:options.owner};
  // OWNER is a DynamoDB reserved word: it must go through ExpressionAttributeNames,
  // otherwise every lease-holding checkpoint/release fails with ValidationException.
  const input={TableName:tableName(options.env),Item:item,ConditionExpression:condition,ExpressionAttributeValues:values};
  if(condition.includes('#owner'))input.ExpressionAttributeNames={'#owner':'owner'};
  await client(options).send(cmd('PutItemCommand',input));
}
// Small side record for the priority-origin pass (written only while the main
// lease is held, so no condition is needed).
async function readMeta(sk,options={}){
  const res=await client(options).send(cmd('GetItemCommand',{TableName:tableName(options.env),Key:{pk:{S:'META#job'},sk:{S:sk}}}));
  try{return res?.Item?.state?.S?JSON.parse(res.Item.state.S):null}catch{return null}
}
async function writeMeta(sk,state,options={}){
  await client(options).send(cmd('PutItemCommand',{TableName:tableName(options.env),Item:{pk:{S:'META#job'},sk:{S:sk},state:{S:JSON.stringify(state).slice(0,8000)},updatedAt:{S:new Date(options.nowMs??Date.now()).toISOString()}}}));
}
module.exports = { TTL_DAYS, tableName, writeRecords, readRoutesFrom, readCursor, writeCursor, readMeta, writeMeta, _internal: { toItem, fromItem } };
