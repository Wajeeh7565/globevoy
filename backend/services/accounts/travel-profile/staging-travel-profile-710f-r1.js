'use strict';

// GV-WEB-710F-R1 — staging-only owner-private Travel Profile storage.
// Ownership comes only from the verified Cognito access-token sub. The profile
// intentionally stores preference/context fields only: never passport/document
// numbers, payment data, provider credentials, auth tokens or raw provider data.

const auth705B = require('../auth/staging-cognito-auth-705b-r3');

const VERSION = 'GV-WEB-710F-R1';
const ROUTE_PATH = '/api/account/travel-profile';
const TABLE_ENV = 'GLOBEVOY_SAVED_TRIPS_TABLE';
const STAGING_ORIGIN = auth705B.STAGING_ORIGIN;
const REGION = auth705B.REGION;
const PROFILE_SK = 'PROFILE#TRAVEL';
const SCHEMA_VERSION = 'GV-TRAVEL-PROFILE-V1';
const MAX_BODY_BYTES = 32 * 1024;
const MAX_TEXT = 120;
const MAX_LIST = 24;
const MAX_PLACES = 80;
const ALLOWED_HOTEL_STYLES = new Set(['Best balance', 'Budget', 'Comfort', 'Boutique', 'Luxury']);
const ALLOWED_PACES = new Set(['Relaxed', 'Balanced', 'Fast']);
const ALLOWED_CURRENCIES = new Set(['CAD', 'USD', 'EUR', 'GBP', 'AUD']);
const FORBIDDEN_KEY = /(passport.?number|document.?number|visa.?number|payment|card|cvv|cvc|password|passcode|access.?token|refresh.?token|id.?token|authorization|client.?secret|credential|secret)/i;

let ddbClient = null;
let ddbSdk = null;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function cleanText(value, max = MAX_TEXT) {
  return clean(value).replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, max);
}

function cleanList(value, max = MAX_LIST) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const entry of source) {
    const item = cleanText(entry, MAX_TEXT);
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

function safeIata(value) {
  const code = clean(value).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function safeCurrency(value) {
  const code = clean(value).toUpperCase();
  return ALLOWED_CURRENCIES.has(code) ? code : 'CAD';
}

function containsForbiddenKeys(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenKeys);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || containsForbiddenKeys(child));
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
    'X-Globevoy-Travel-Profile': VERSION
  };
  if (requestOrigin === STAGING_ORIGIN) headers['Access-Control-Allow-Origin'] = STAGING_ORIGIN;
  return { statusCode, headers, body: JSON.stringify(payload) };
}

function preflight(event = {}) {
  const requestOrigin = normalizeOrigin(headerValue(event.headers || {}, 'origin'));
  if (requestOrigin !== STAGING_ORIGIN) return response(403, { ok: false, error: 'staging-origin-not-allowed' }, '');
  return {
    statusCode: 204,
    headers: {
      'Cache-Control': 'no-store',
      Vary: 'Origin',
      'Access-Control-Allow-Origin': STAGING_ORIGIN,
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Max-Age': '600',
      'X-Globevoy-Travel-Profile': VERSION
    },
    body: ''
  };
}

function apiError(statusCode, code) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseBody(event = {}) {
  let raw = event.body == null ? '' : String(event.body);
  if (event.isBase64Encoded === true) {
    try { raw = Buffer.from(raw, 'base64').toString('utf8'); } catch (_) { throw apiError(400, 'invalid-request-body'); }
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) throw apiError(413, 'request-body-too-large');
  if (!raw) return {};
  let body;
  try { body = JSON.parse(raw); } catch (_) { throw apiError(400, 'invalid-json'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError(400, 'json-object-required');
  if (containsForbiddenKeys(body)) throw apiError(400, 'sensitive-document-or-credential-data-not-allowed');
  return body;
}

function normalizeProfile(body = {}) {
  const hotelStyle = cleanText(body.hotelStyle, 40) || 'Best balance';
  const pace = cleanText(body.pace, 24) || 'Balanced';
  return {
    schemaVersion: SCHEMA_VERSION,
    homeAirport: safeIata(body.homeAirport),
    homeCity: cleanText(body.homeCity),
    residenceCountry: cleanText(body.residenceCountry),
    citizenshipCountries: cleanList(body.citizenshipCountries, 6),
    interests: cleanList(body.interests, 12),
    hotelStyle: ALLOWED_HOTEL_STYLES.has(hotelStyle) ? hotelStyle : 'Best balance',
    pace: ALLOWED_PACES.has(pace) ? pace : 'Balanced',
    defaultCurrency: safeCurrency(body.defaultCurrency),
    visitedPlaces: cleanList(body.visitedPlaces, MAX_PLACES),
    wishListPlaces: cleanList(body.wishListPlaces, MAX_PLACES)
  };
}

function ownerPk(sub) {
  return `USER#${sub}`;
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

function dbDeps(options = {}) {
  return {
    db: options.ddb || defaultDb(),
    command: options.commandFactory || defaultCommandFactory,
    tableName: clean(options.env?.[TABLE_ENV] || process.env[TABLE_ENV])
  };
}

function profileFromItem(item = {}) {
  const raw = item?.profileJson?.S;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return {
      ...normalizeProfile(parsed),
      updatedAt: clean(item?.updatedAt?.S) || null
    };
  } catch (_) {
    return null;
  }
}

async function authenticate(event, options = {}) {
  const token = (options.bearerToken || auth705B._internal.bearerToken)(event);
  const verify = options.verifyToken || auth705B.verifyCognitoAccessToken705B;
  const verified = await verify(token, { fetch: options.fetch || globalThis.fetch, nowMs: options.nowMs });
  if (!clean(verified?.sub)) throw new auth705B.CognitoAuthError705B('subject-required');
  return verified;
}

async function getProfile(sub, options = {}) {
  const { db, command, tableName } = dbDeps(options);
  const result = await db.send(command('GetItem', {
    TableName: tableName,
    Key: { PK: { S: ownerPk(sub) }, SK: { S: PROFILE_SK } },
    ConsistentRead: true
  }));
  return result?.Item ? profileFromItem(result.Item) : null;
}

async function putProfile(sub, body, options = {}) {
  const profile = normalizeProfile(body);
  const now = new Date(Number(options.nowMs || Date.now())).toISOString();
  const { db, command, tableName } = dbDeps(options);
  await db.send(command('PutItem', {
    TableName: tableName,
    Item: {
      PK: { S: ownerPk(sub) },
      SK: { S: PROFILE_SK },
      entityType: { S: 'TRAVEL_PROFILE' },
      schemaVersion: { S: SCHEMA_VERSION },
      ownerSub: { S: sub },
      updatedAt: { S: now },
      profileJson: { S: JSON.stringify(profile) }
    }
  }));
  return { ...profile, updatedAt: now };
}

async function handle(event = {}, options = {}) {
  const requestOrigin = normalizeOrigin(headerValue(event.headers || {}, 'origin'));
  const env = options.env || process.env;
  if (!auth705B.enabled(env)) return response(404, { ok: false, error: 'account-not-enabled' }, requestOrigin);
  if (!clean(env?.[TABLE_ENV])) return response(503, { ok: false, error: 'travel-profile-storage-not-configured' }, requestOrigin);
  if (requestOrigin !== STAGING_ORIGIN) return response(403, { ok: false, error: 'staging-origin-not-allowed' }, '');
  if (pathOf(event) !== ROUTE_PATH) return response(404, { ok: false, error: 'not-found' }, requestOrigin);

  const method = methodOf(event);
  if (!['GET', 'PUT'].includes(method)) return response(405, { ok: false, error: 'method-not-allowed' }, requestOrigin);

  let verified;
  try { verified = await authenticate(event, options); }
  catch (error) {
    const reason = error instanceof auth705B.CognitoAuthError705B ? error.code : 'verification-failed';
    return response(401, { ok: false, authenticated: false, error: 'invalid-or-expired-access-token', reason }, requestOrigin);
  }

  try {
    if (method === 'GET') {
      const profile = await getProfile(clean(verified.sub), options);
      return response(200, {
        ok: true,
        version: VERSION,
        exists: Boolean(profile),
        profile: profile || { ...normalizeProfile({}), updatedAt: null },
        privacy: {
          ownerPrivate: true,
          passportNumbersStored: false,
          paymentDataStored: false
        }
      }, requestOrigin);
    }

    const profile = await putProfile(clean(verified.sub), parseBody(event), options);
    return response(200, {
      ok: true,
      version: VERSION,
      exists: true,
      profile,
      privacy: {
        ownerPrivate: true,
        passportNumbersStored: false,
        paymentDataStored: false
      }
    }, requestOrigin);
  } catch (error) {
    if (error?.statusCode) return response(error.statusCode, { ok: false, error: error.code }, requestOrigin);
    console.error('GV-WEB-710F travel profile error', { name: error?.name, message: error?.message });
    return response(500, { ok: false, error: 'travel-profile-temporarily-unavailable' }, requestOrigin);
  }
}

function status(env = process.env) {
  return {
    version: VERSION,
    enabled: enabled(env),
    routePath: ROUTE_PATH,
    tableConfigured: Boolean(clean(env?.[TABLE_ENV])),
    ownership: 'verified-cognito-sub-only',
    passportNumbersStored: false,
    paymentDataStored: false,
    productionChanged: false
  };
}

module.exports = {
  VERSION,
  ROUTE_PATH,
  TABLE_ENV,
  STAGING_ORIGIN,
  PROFILE_SK,
  SCHEMA_VERSION,
  enabled,
  preflight,
  handle,
  status,
  _internal: {
    clean,
    cleanText,
    cleanList,
    safeIata,
    safeCurrency,
    containsForbiddenKeys,
    normalizeProfile,
    ownerPk,
    profileFromItem,
    getProfile,
    putProfile,
    resetForTests() { ddbClient = null; ddbSdk = null; }
  }
};
