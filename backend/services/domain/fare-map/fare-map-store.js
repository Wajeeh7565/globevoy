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
  return new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' });
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
    sk: { S: rec.destination },
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
    destination: item?.sk?.S,
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
  let written = 0;
  for (let i = 0; i < records.length; i += 25) {
    let request = { [table]: records.slice(i, i + 25).map(r => ({ PutRequest: { Item: toItem(r, options.nowMs) } })) };
    for (let attempt = 0; attempt < 5 && request && Object.keys(request).length; attempt += 1) {
      const out = await db.send(cmd('BatchWriteItemCommand', { RequestItems: request }));
      const left = out?.UnprocessedItems && out.UnprocessedItems[table] ? out.UnprocessedItems : null;
      written += (request[table].length - (left ? left[table].length : 0));
      request = left;
      if (request && options.sleep !== false) await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
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
      if(Number(i.ttl?.N)>now/1000&&Number.isFinite(observed)&&observed<=now+60000&&observed>=now-TTL_DAYS*86400000)out.push(fromItem(i));
    });
    key = res?.LastEvaluatedKey;
    if(options.maxRecords&&out.length>=options.maxRecords)return out.slice(0,options.maxRecords);
  } while (key && pages < (options.maxPages || Infinity));
  return out;
}

async function readCursor(options = {}) {
  const table = tableName(options.env);
  const db = client(options);
  const res = await db.send(cmd('GetItemCommand', { TableName: table, Key: { pk: { S: 'META#job' }, sk: { S: 'cursor' } } }));
  return res?.Item ? { index: Number(res.Item.index?.N || 0), cycleStartedAt: res.Item.cycleStartedAt?.S || null } : { index: 0, cycleStartedAt: null };
}
async function writeCursor(cursor, options = {}) {
  const table = tableName(options.env);
  const db = client(options);
  const item = { pk: { S: 'META#job' }, sk: { S: 'cursor' }, index: { N: String(cursor.index) }, updatedAt: { S: new Date(options.nowMs || Date.now()).toISOString() } };
  if (cursor.cycleStartedAt) item.cycleStartedAt = { S: cursor.cycleStartedAt };
  if (cursor.lastRun) item.lastRun = { S: JSON.stringify(cursor.lastRun).slice(0, 2000) };
  await db.send(cmd('PutItemCommand', { TableName: table, Item: item }));
}

module.exports = { TTL_DAYS, tableName, writeRecords, readRoutesFrom, readCursor, writeCursor, _internal: { toItem, fromItem } };
