'use strict';

const { createHash, randomUUID } = require('node:crypto');
const { record } = require('./ignav-usage');

const DAY = 86400000;
const iso = ms => new Date(ms).toISOString();
const positive = value => /^\d+$/.test(String(value || '')) && Number.isSafeInteger(Number(value)) && Number(value) > 0;

function billingWindow(now, start, period) {
  if (now < start) return null;
  if (period !== 'monthly') {
    const length = Number(period) * DAY;
    const begin = start + Math.floor((now - start) / length) * length;
    return { start: begin, end: begin + length };
  }
  const anchor = new Date(start), current = new Date(now);
  const boundary = offset => {
    const date = new Date(start);
    date.setUTCDate(1);
    date.setUTCMonth(anchor.getUTCMonth() + offset);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(last, anchor.getUTCDate()));
    return Number(date);
  };
  let offset = (current.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + current.getUTCMonth() - anchor.getUTCMonth();
  if (boundary(offset) > now) offset--;
  return { start: boundary(offset), end: boundary(offset + 1) };
}

function config(env) {
  const { IGNAV_CONTROL_TABLE: table, IGNAV_QUOTA_ACCOUNT: account, IGNAV_QUOTA_PERIOD: period,
    IGNAV_QUOTA_PERIOD_START: rawStart, IGNAV_QUOTA_DAILY: daily, IGNAV_QUOTA_BILLING: billing,
    IGNAV_QUOTA_FARE_UNITS: fare, IGNAV_QUOTA_LINK_UNITS: link, IGNAV_QUOTA_WARN_PERCENT: warning } = env;
  const start = Date.parse(rawStart);
  const thresholds = String(warning || '').split(',').map(s => s.trim());
  if (env.IGNAV_QUOTA_APPROVED !== 'true' || !/^[a-zA-Z0-9_.-]{3,255}$/.test(table || '') ||
      !/^[a-zA-Z0-9_.-]{1,64}$/.test(account || '') || !/^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(rawStart || '') ||
      !Number.isFinite(start) || iso(start).slice(0, 19) !== rawStart.slice(0, 19) ||
      !(period === 'monthly' || positive(period) && Number(period) <= 366) ||
      ![daily, billing, fare, link].every(positive) || !thresholds.every(v => positive(v) && Number(v) < 100)) return null;
  const limits = { account, period, start, daily: Number(daily), billing: Number(billing),
    fare: Number(fare), link: Number(link) };
  const fingerprint = createHash('sha256').update(JSON.stringify(limits)).digest('hex');
  return { ...limits, table, fingerprint, thresholds: [...new Set(thresholds.map(Number))].sort((a,b) => a-b) };
}

const CONTROL_TIMEOUT_MS = 1250;

async function boundedSend(client, command) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => client.send(command, { abortSignal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort();
        reject(Object.assign(new Error('Ignav quota store deadline'), { name: 'TimeoutError' }));
      }, CONTROL_TIMEOUT_MS); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const key = (account, sk) => ({ pk: { S: 'IGNAV#' + account }, sk: { S: sk } });

function counter(table, ident, limit, units, end) {
  return { Update: {
    TableName: table, Key: ident,
    UpdateExpression: 'SET #ttl = :ttl ADD #used :units',
    ConditionExpression: 'attribute_not_exists(#used) OR #used <= :room',
    ExpressionAttributeNames: { '#used': 'used', '#ttl': 'ttl' },
    ExpressionAttributeValues: { ':units': { N: String(units) }, ':room': { N: String(limit - units) },
      ':ttl': { N: String(Math.floor(end / 1000) + 86400) } }
  } };
}

let client;
function getStore(options) {
  if (options.quotaDynamo || options.dynamo) return options.quotaDynamo || options.dynamo;
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  client ||= new DynamoDBClient({ maxAttempts: 1 });
  return client;
}

const warningsLogged = new Set();
async function reportWarnings(db, GetItemCommand, cfg, entries, options, endpoint) {
  const logging = { ...options, env: { ...(options.env || process.env), IGNAV_USAGE_LOG: 'on' } };
  await Promise.all(entries.map(async ([window, ident, allowance]) => {
    const token = threshold => JSON.stringify([cfg.table, cfg.fingerprint, ident.sk.S, threshold]);
    if (cfg.thresholds.every(threshold => warningsLogged.has(token(threshold)))) return;
    try {
      const row = await boundedSend(db, new GetItemCommand({ TableName: cfg.table, Key: ident, ConsistentRead: true }));
      const used = Number(row?.Item?.used?.N);
      for (const threshold of cfg.thresholds) {
        const key = token(threshold);
        if (!(used / allowance >= threshold / 100) || warningsLogged.has(key)) continue;
        warningsLogged.add(key);
        if (warningsLogged.size > 256) warningsLogged.delete(warningsLogged.values().next().value);
        record(logging, 'quota-warning', { endpoint, window, used, allowance, threshold });
      }
    } catch (_) { record(logging, 'quota-warning-read-failed', { endpoint, window }); }
  }));
}

async function reserve(endpoint, options = {}) {
  const env = options.env || process.env;
  if (env.IGNAV_QUOTA_ENABLED !== 'on') return { ok: true };
  const cfg = config(env);
  if (!cfg || !['fare', 'booking-link'].includes(endpoint)) return { ok: false, reason: 'ignav-quota-unconfigured' };
  const now = (options.quotaClock || Date.now)();
  const period = billingWindow(now, cfg.start, cfg.period);
  const units = endpoint === 'fare' ? cfg.fare : cfg.link;
  if (!period || units > cfg.daily || units > cfg.billing) return { ok: false, reason: 'ignav-quota-exhausted' };
  const day = Math.floor(now / DAY) * DAY;
  const dailyKey = key(cfg.account, 'daily#' + iso(day));
  const billingKey = key(cfg.account, 'billing#' + iso(period.start));
  try {
    const { TransactWriteItemsCommand, GetItemCommand } = require('@aws-sdk/client-dynamodb');
    const db = getStore(options);
    const command = new TransactWriteItemsCommand({
      ClientRequestToken: randomUUID(),
      TransactItems: [
        { ConditionCheck: { TableName: cfg.table, Key: { pk: { S: 'IGNAVSTOP#' + cfg.account }, sk: { S: 'control' } },
          ConditionExpression: '#open = :yes AND #config = :config',
          ExpressionAttributeNames: { '#open': 'enabled', '#config': 'configuration' },
          ExpressionAttributeValues: { ':yes': { BOOL: true }, ':config': { S: cfg.fingerprint } } } },
        counter(cfg.table, dailyKey, cfg.daily, units, day + DAY),
        counter(cfg.table, billingKey, cfg.billing, units, period.end)
      ]
    });
    try {
      await boundedSend(db, command);
    } catch (error) {
      // An ambiguous commit is retried using the exact same transaction and token.
      if (!['TimeoutError', 'InternalServerError', 'TransactionInProgressException'].includes(error?.name)) throw error;
      // A late acknowledgement at a window boundary must not authorize a send in the next window.
      await boundedSend(db, command);
    }
    await reportWarnings(db, GetItemCommand, cfg, [['daily', dailyKey, cfg.daily], ['billing', billingKey, cfg.billing]], options, endpoint);
    // A late acknowledgement at a window boundary must not authorize a send in the next window.
    const finished = (options.quotaClock || Date.now)();
    if (finished >= Math.min(day + DAY, period.end)) return { ok: false, reason: 'ignav-quota-window-changed' };
    return { ok: true };
  } catch (error) {
    if (error?.name === 'TransactionCanceledException') {
      const reasons = error.CancellationReasons || [];
      if (reasons[0]?.Code === 'ConditionalCheckFailed') return { ok: false, reason: 'ignav-quota-stopped' };
      if (reasons.some(r => r.Code === 'ConditionalCheckFailed')) return { ok: false, reason: 'ignav-quota-exhausted' };
    }
    return { ok: false, reason: 'ignav-quota-unavailable' };
  }
}

module.exports = { reserve, _internal: { config, billingWindow } };
