'use strict';

// GV-ACCOUNT-705C — staging-only owner-private saved trips.
// Ownership is derived exclusively from a cryptographically verified Cognito
// access-token `sub`; no client-supplied owner identity is accepted.

const crypto = require('node:crypto');
const auth705B = require('./staging-cognito-auth-705b-r3');

const VERSION = 'GV-ACCOUNT-705C';
const ROUTE_PATH = '/api/saved-trips';
const TABLE_ENV = 'GLOBEVOY_SAVED_TRIPS_TABLE';
const STAGING_ORIGIN = auth705B.STAGING_ORIGIN;
const REGION = auth705B.REGION;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LIST_ITEMS = 50;
const MAX_NAME_LENGTH = 120;
const MAX_TRIP_JSON_BYTES = 48 * 1024;
const ALLOWED_STATUSES = new Set(['planned', 'archived']);
const SENSITIVE_KEY = /(password|passcode|access.?token|refresh.?token|id.?token|authorization|client.?secret|secret|credential|passport|payment|card.?number|cvv|cvc|raw.?provider|provider.?response)/i;
const SENSITIVE_URL_PARAM = /(token|key|secret|authorization|credential|password|signature)/i;
const CLIENT_OWNERSHIP_KEYS = new Set(['ownerSub', 'pk', 'sk', 'createdAt']);

let ddbClient = null;
let ddbSdk = null;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeOrigin(value) {
  return auth705B._internal.normalizeHttpsOrigin(value);
}

function headerValue(headers = {}, name = '') {
  return auth705B._internal.headerValue(headers, name);
}

function methodOf(event = {}) {
  return auth705B._internal.methodOf(event);
}

function pathOf(event = {}) {
  return auth705B._internal.pathOf(event);
}

function enabled(env = process.env) {
  return auth705B.enabled(env) && /^[A-Za-z0-9_.-]{3,255}$/.test(clean(env?.[TABLE_ENV]));
}

function response(statusCode, payload, requestOrigin = '') {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'X-Globevoy-Saved-Trips': VERSION
  };
  if (requestOrigin === STAGING_ORIGIN) headers['Access-Control-Allow-Origin'] = STAGING_ORIGIN;
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function parseBody(event = {}) {
  let raw = event.body == null ? '' : String(event.body);
  if (event.isBase64Encoded === true) {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (_) { throw apiError(400, 'invalid-request-body'); }
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw apiError(413, 'request-body-too-large');
  if (!raw) return {};
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { throw apiError(400, 'invalid-json'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw apiError(400, 'json-object-required');
  return parsed;
}

function apiError(statusCode, code, details = null) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

function queryParam(event = {}, name = '') {
  const direct = event?.queryStringParameters?.[name];
  if (direct != null) return clean(direct);
  const raw = clean(event.rawQueryString);
  if (!raw) return '';
  try { return clean(new URLSearchParams(raw).get(name)); } catch (_) { return ''; }
}

function validTripId(value) {
  return /^[A-Za-z0-9_-]{8,80}$/.test(clean(value));
}

function ownerPk(sub) {
  return `USER#${sub}`;
}

function tripSk(tripId) {
  return `TRIP#${tripId}`;
}

function containsSensitiveData(value, path = '') {
  if (Array.isArray(value)) return value.some((item, index) => containsSensitiveData(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, child]) => {
      if (SENSITIVE_KEY.test(key)) return true;
      return containsSensitiveData(child, path ? `${path}.${key}` : key);
    });
  }
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      for (const key of url.searchParams.keys()) if (SENSITIVE_URL_PARAM.test(key)) return true;
    } catch (_) {}
  }
  return false;
}

function assertClientDoesNotSetOwnership(body = {}) {
  for (const key of Object.keys(body)) {
    if (CLIENT_OWNERSHIP_KEYS.has(key)) throw apiError(400, 'client-ownership-fields-not-allowed');
  }
}

function cloneJson(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { throw apiError(400, 'snapshot-not-json-safe'); }
}

function boundedJson(value, fallback, label) {
  const cloned = cloneJson(value, fallback);
  const raw = JSON.stringify(cloned);
  if (Buffer.byteLength(raw, 'utf8') > MAX_TRIP_JSON_BYTES) throw apiError(413, `${label}-too-large`);
  if (containsSensitiveData(cloned)) throw apiError(400, `${label}-contains-sensitive-data`);
  return { value: cloned, raw };
}

function normalizeInput(body = {}, options = {}) {
  assertClientDoesNotSetOwnership(body);
  if (containsSensitiveData(body)) throw apiError(400, 'sensitive-data-not-allowed');

  const name = clean(body.name || 'Saved trip');
  if (!name || name.length > MAX_NAME_LENGTH) throw apiError(400, 'invalid-trip-name');
  const status = clean(body.status || 'planned').toLowerCase();
  if (!ALLOWED_STATUSES.has(status)) throw apiError(400, 'invalid-trip-status');

  const tripSnapshot = boundedJson(body.tripSnapshot, {}, 'trip-snapshot');
  if (!tripSnapshot.value || typeof tripSnapshot.value !== 'object' || Array.isArray(tripSnapshot.value) || !Object.keys(tripSnapshot.value).length) {
    throw apiError(400, 'trip-snapshot-required');
  }
  const providerRefs = boundedJson(body.providerRefs, {}, 'provider-refs');
  const priceSnapshot = boundedJson({
    ...(body.priceSnapshot && typeof body.priceSnapshot === 'object' && !Array.isArray(body.priceSnapshot) ? body.priceSnapshot : {}),
    snapshotOnly: true,
    requiresRevalidation: true
  }, {}, 'price-snapshot');
  const travelerProfileRef = boundedJson(body.travelerProfileRef, null, 'traveler-profile-ref');

  let expectedVersion = null;
  if (options.requireVersion) {
    expectedVersion = Number(body.version);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw apiError(400, 'valid-version-required');
  }

  return {
    name,
    status,
    tripSnapshot,
    providerRefs,
    priceSnapshot,
    travelerProfileRef,
    expectedVersion
  };
}

function loadSdk() {
  if (!ddbSdk) ddbSdk = require('@aws-sdk/client-dynamodb');
  return ddbSdk;
}

function defaultDb() {
  if (!ddbClient) {
    const { DynamoDBClient } = loadSdk();
    ddbClient = new DynamoDBClient({ region: REGION });
  }
  return ddbClient;
}

function defaultCommandFactory(name, input) {
  const sdk = loadSdk();
  const Command = sdk[`${name}Command`];
  if (typeof Command !== 'function') throw new Error(`DynamoDB command unavailable: ${name}`);
  return new Command(input);
}

function attrS(item, name) {
  return clean(item?.[name]?.S);
}

function attrN(item, name) {
  const number = Number(item?.[name]?.N);
  return Number.isFinite(number) ? number : 0;
}

function parseStoredJson(item, name, fallback) {
  const raw = item?.[name]?.S;
  if (typeof raw !== 'string') return fallback;
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

function toPublicItem(item = {}) {
  const tripId = attrS(item, 'tripId');
  if (!tripId) return null;
  return {
    tripId,
    name: attrS(item, 'name') || 'Saved trip',
    status: attrS(item, 'status') || 'planned',
    createdAt: attrS(item, 'createdAt') || null,
    updatedAt: attrS(item, 'updatedAt') || null,
    version: attrN(item, 'version') || 1,
    tripSnapshot: parseStoredJson(item, 'tripSnapshotJson', {}),
    providerRefs: parseStoredJson(item, 'providerRefsJson', {}),
    priceSnapshot: parseStoredJson(item, 'priceSnapshotJson', { snapshotOnly: true, requiresRevalidation: true }),
    travelerProfileRef: parseStoredJson(item, 'travelerProfileRefJson', null)
  };
}

function toDynamoItem({ sub, tripId, now, normalized, version = 1 }) {
  return {
    PK: { S: ownerPk(sub) },
    SK: { S: tripSk(tripId) },
    tripId: { S: tripId },
    ownerSub: { S: sub },
    name: { S: normalized.name },
    status: { S: normalized.status },
    createdAt: { S: now },
    updatedAt: { S: now },
    version: { N: String(version) },
    tripSnapshotJson: { S: normalized.tripSnapshot.raw },
    providerRefsJson: { S: normalized.providerRefs.raw },
    priceSnapshotJson: { S: normalized.priceSnapshot.raw },
    travelerProfileRefJson: { S: normalized.travelerProfileRef.raw }
  };
}

function authFailure(error, requestOrigin) {
  const reason = error instanceof auth705B.CognitoAuthError705B ? error.code : 'verification-failed';
  return response(401, { ok: false, authenticated: false, error: 'invalid-or-expired-access-token', reason }, requestOrigin);
}

async function authenticate(event, options) {
  const getToken = options.bearerToken || auth705B._internal.bearerToken;
  const verify = options.verifyToken || auth705B.verifyCognitoAccessToken705B;
  const token = getToken(event);
  const verified = await verify(token, { fetch: options.fetch || globalThis.fetch, nowMs: options.nowMs });
  if (!clean(verified?.sub)) throw new auth705B.CognitoAuthError705B('subject-required');
  return verified;
}

function dbDeps(options = {}) {
  return {
    db: options.ddb || defaultDb(),
    command: options.commandFactory || defaultCommandFactory,
    tableName: clean(options.env?.[TABLE_ENV] || process.env[TABLE_ENV])
  };
}

async function listTrips(sub, options = {}) {
  const { db, command, tableName } = dbDeps(options);
  const result = await db.send(command('Query', {
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': { S: ownerPk(sub) } },
    Limit: MAX_LIST_ITEMS,
    ScanIndexForward: false,
    ConsistentRead: true
  }));
  return (Array.isArray(result?.Items) ? result.Items : []).map(toPublicItem).filter(Boolean)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function getTrip(sub, tripId, options = {}) {
  const { db, command, tableName } = dbDeps(options);
  const result = await db.send(command('GetItem', {
    TableName: tableName,
    Key: { PK: { S: ownerPk(sub) }, SK: { S: tripSk(tripId) } },
    ConsistentRead: true
  }));
  return result?.Item ? toPublicItem(result.Item) : null;
}

async function createTrip(sub, body, options = {}) {
  const normalized = normalizeInput(body);
  const tripId = (options.randomUUID || crypto.randomUUID)();
  const now = new Date(Number(options.nowMs || Date.now())).toISOString();
  const item = toDynamoItem({ sub, tripId, now, normalized, version: 1 });
  const { db, command, tableName } = dbDeps(options);
  await db.send(command('PutItem', {
    TableName: tableName,
    Item: item,
    ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)'
  }));
  return toPublicItem(item);
}

async function updateTrip(sub, tripId, body, options = {}) {
  const normalized = normalizeInput(body, { requireVersion: true });
  const now = new Date(Number(options.nowMs || Date.now())).toISOString();
  const nextVersion = normalized.expectedVersion + 1;
  const { db, command, tableName } = dbDeps(options);
  try {
    const result = await db.send(command('UpdateItem', {
      TableName: tableName,
      Key: { PK: { S: ownerPk(sub) }, SK: { S: tripSk(tripId) } },
      UpdateExpression: 'SET #n = :name, #s = :status, updatedAt = :updatedAt, #v = :nextVersion, tripSnapshotJson = :tripSnapshotJson, providerRefsJson = :providerRefsJson, priceSnapshotJson = :priceSnapshotJson, travelerProfileRefJson = :travelerProfileRefJson',
      ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK) AND #v = :expectedVersion',
      ExpressionAttributeNames: { '#n': 'name', '#s': 'status', '#v': 'version' },
      ExpressionAttributeValues: {
        ':name': { S: normalized.name },
        ':status': { S: normalized.status },
        ':updatedAt': { S: now },
        ':nextVersion': { N: String(nextVersion) },
        ':expectedVersion': { N: String(normalized.expectedVersion) },
        ':tripSnapshotJson': { S: normalized.tripSnapshot.raw },
        ':providerRefsJson': { S: normalized.providerRefs.raw },
        ':priceSnapshotJson': { S: normalized.priceSnapshot.raw },
        ':travelerProfileRefJson': { S: normalized.travelerProfileRef.raw }
      },
      ReturnValues: 'ALL_NEW'
    }));
    return toPublicItem(result?.Attributes || {});
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') throw apiError(409, 'saved-trip-version-conflict-or-missing');
    throw error;
  }
}

async function deleteTrip(sub, tripId, options = {}) {
  const { db, command, tableName } = dbDeps(options);
  const result = await db.send(command('DeleteItem', {
    TableName: tableName,
    Key: { PK: { S: ownerPk(sub) }, SK: { S: tripSk(tripId) } },
    ConditionExpression: 'attribute_exists(PK) AND attribute_exists(SK)',
    ReturnValues: 'ALL_OLD'
  }));
  if (!result?.Attributes) throw apiError(404, 'saved-trip-not-found');
  return toPublicItem(result.Attributes);
}

async function handleSavedTrips705C(event = {}, options = {}) {
  const requestOrigin = normalizeOrigin(headerValue(event.headers || {}, 'origin'));
  const env = options.env || process.env;
  if (!auth705B.enabled(env)) return response(404, { ok: false, error: 'saved-trips-not-enabled' }, requestOrigin);
  if (!clean(env?.[TABLE_ENV])) return response(503, { ok: false, error: 'saved-trips-storage-not-configured' }, requestOrigin);
  if (requestOrigin !== STAGING_ORIGIN) return response(403, { ok: false, error: 'staging-origin-not-allowed' }, '');
  if (pathOf(event) !== ROUTE_PATH) return response(404, { ok: false, error: 'not-found' }, requestOrigin);

  const method = methodOf(event);
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
    return response(405, { ok: false, error: 'method-not-allowed' }, requestOrigin);
  }

  let verified;
  try { verified = await authenticate(event, options); } catch (error) { return authFailure(error, requestOrigin); }
  const sub = clean(verified.sub);
  const tripId = queryParam(event, 'tripId');

  try {
    if (method === 'GET') {
      if (tripId) {
        if (!validTripId(tripId)) throw apiError(400, 'invalid-trip-id');
        const trip = await getTrip(sub, tripId, options);
        if (!trip) throw apiError(404, 'saved-trip-not-found');
        return response(200, { ok: true, version: VERSION, trip, pricing: { requiresRevalidationBeforeProviderHandoff: true } }, requestOrigin);
      }
      const trips = await listTrips(sub, options);
      return response(200, { ok: true, version: VERSION, trips, count: trips.length, pricing: { requiresRevalidationBeforeProviderHandoff: true } }, requestOrigin);
    }

    if (method === 'POST') {
      if (tripId) throw apiError(400, 'trip-id-not-accepted-on-create');
      const trip = await createTrip(sub, parseBody(event), options);
      return response(201, { ok: true, version: VERSION, trip }, requestOrigin);
    }

    if (!validTripId(tripId)) throw apiError(400, 'valid-trip-id-required');
    if (method === 'PUT') {
      const trip = await updateTrip(sub, tripId, parseBody(event), options);
      return response(200, { ok: true, version: VERSION, trip }, requestOrigin);
    }

    const deleted = await deleteTrip(sub, tripId, options);
    return response(200, { ok: true, version: VERSION, deleted: { tripId: deleted?.tripId || tripId } }, requestOrigin);
  } catch (error) {
    if (error?.statusCode) return response(error.statusCode, { ok: false, error: error.code, details: error.details || undefined }, requestOrigin);
    if (error?.name === 'ConditionalCheckFailedException') return response(409, { ok: false, error: 'saved-trip-conflict' }, requestOrigin);
    console.error('GV-ACCOUNT-705C saved trips error', { name: error?.name, message: error?.message });
    return response(500, { ok: false, error: 'saved-trips-temporarily-unavailable' }, requestOrigin);
  }
}

function status705C(env = process.env) {
  return {
    version: VERSION,
    enabled: enabled(env),
    environment: 'staging',
    origin: STAGING_ORIGIN,
    region: REGION,
    route: ROUTE_PATH,
    tableConfigured: Boolean(clean(env?.[TABLE_ENV])),
    ownership: 'verified-cognito-sub-only',
    maxListItems: MAX_LIST_ITEMS,
    priceSnapshotsRequireRevalidation: true,
    productionChanged: false
  };
}

module.exports = {
  VERSION,
  ROUTE_PATH,
  TABLE_ENV,
  STAGING_ORIGIN,
  enabled,
  handleSavedTrips705C,
  status705C,
  _internal: {
    clean,
    response,
    parseBody,
    queryParam,
    validTripId,
    ownerPk,
    tripSk,
    containsSensitiveData,
    normalizeInput,
    toPublicItem,
    toDynamoItem,
    listTrips,
    getTrip,
    createTrip,
    updateTrip,
    deleteTrip,
    apiError,
    resetForTests() { ddbClient = null; ddbSdk = null; }
  }
};
