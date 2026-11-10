'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const gateway = require('../production-account-lambda');
const auth = require('../services/accounts/auth/production-cognito-auth');
const staging = require('../services/accounts/auth/staging-cognito-auth-705b-r3');

const nowMs = Date.UTC(2026, 10, 9, 18, 0, 0);
const now = Math.floor(nowMs / 1000);
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: attackerKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'production-test-kid', alg: 'RS256', use: 'sig' };
const env = {
  CORS_ORIGIN: 'https://globevoy.com',
  GLOBEVOY_PRODUCTION_ACCOUNTS_ENABLED: 'true',
  GLOBEVOY_PRODUCTION_USER_POOL_ID: 'us-east-2_PRODtest123',
  GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID: 'productionclient1234567890',
  GLOBEVOY_PRODUCTION_SAVED_TRIPS_TABLE: 'globevoy-production-saved-trips'
};
const issuer = 'https://cognito-idp.us-east-2.amazonaws.com/' + env.GLOBEVOY_PRODUCTION_USER_POOL_ID;
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
function token(overrides = {}, key = privateKey) {
  const claims = {
    iss: issuer, client_id: env.GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID,
    token_use: 'access', sub: 'owner-one', username: 'owner',
    scope: 'openid email globevoy/trips.write', exp: now + 3600, iat: now - 20, ...overrides
  };
  const input = b64({ alg: 'RS256', typ: 'JWT', kid: jwk.kid }) + '.' + b64(claims);
  return input + '.' + crypto.sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
}
function fakeFetch(url) {
  assert.equal(url, issuer + '/.well-known/jwks.json');
  return Promise.resolve({ ok: true, json: async () => ({ keys: [jwk] }) });
}
function event(path, method, bearer = token(), origin = 'https://globevoy.com', body = null, query = null) {
  return {
    rawPath: path, requestContext: { http: { method } },
    headers: { Origin: origin, Authorization: 'Bearer ' + bearer },
    ...(body == null ? {} : { body: JSON.stringify(body) }),
    ...(query == null ? {} : { queryStringParameters: query })
  };
}
function result(x) { return JSON.parse(x.body || '{}'); }
const writes = [];
const rows = new Map();
const db = {
  async send(command) {
    writes.push(command);
    const { name, input } = command;
    assert.equal(input.TableName, env.GLOBEVOY_PRODUCTION_SAVED_TRIPS_TABLE);
    const key = row => row.PK.S + '/' + row.SK.S;
    if (name === 'PutItem') { rows.set(key(input.Item), input.Item); return {}; }
    if (name === 'Query') return {
      Items: [...rows.values()].filter(row => row.PK.S === input.ExpressionAttributeValues[':pk'].S)
    };
    if (name === 'GetItem') return { Item: rows.get(key(input.Key)) };
    if (name === 'DeleteItem') {
      const previous = rows.get(key(input.Key));
      rows.delete(key(input.Key));
      return { Attributes: previous };
    }
    throw Error('unexpected DynamoDB command ' + name);
  }
};
const opts = { env, fetch: fakeFetch, nowMs, ddb: db, commandFactory: (name, input) => ({ name, input }), randomUUID: () => '12345678-1234-4123-8123-123456789abc' };
const check = (name, value) => { assert.ok(value, name); console.log('PASS ' + name); };

(async () => {
  check('production user pool and dedicated storage are enabled', Boolean(auth.config(env)));
  check('missing production config fails closed', auth.config({ ...env, GLOBEVOY_PRODUCTION_ACCOUNTS_ENABLED: 'false' }) === null);
  check('staging pool cannot be selected', auth.config({ ...env, GLOBEVOY_PRODUCTION_USER_POOL_ID: staging.USER_POOL_ID }) === null);
  check('staging Cognito client cannot be selected', auth.config({ ...env, GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID: staging.CLIENT_ID }) === null);
  check('staging table name is forbidden', auth.config({ ...env, GLOBEVOY_PRODUCTION_SAVED_TRIPS_TABLE: 'globevoy-staging-saved-trips' }) === null);
  check('staging origin is rejected', auth.config({ ...env, CORS_ORIGIN: staging.STAGING_ORIGIN }) === null);

  const session = await gateway.handler(event('/api/account/session', 'GET'), opts);
  assert.equal(session.statusCode, 200);
  assert.equal(result(session).user.sub, 'owner-one');
  assert.equal(result(session).token.tokenUse, 'access');
  check('production Cognito access token verified via JWKS', true);

  const wrongPool = await gateway.handler(event('/api/account/session', 'GET', token({ iss: staging.ISSUER })), opts);
  assert.equal(wrongPool.statusCode, 401);
  const wrongClient = await gateway.handler(event('/api/account/session', 'GET', token({ client_id: staging.CLIENT_ID })), opts);
  assert.equal(wrongClient.statusCode, 401);
  const wrongScope = await gateway.handler(event('/api/account/session', 'GET', token({ scope: 'openid email' })), opts);
  assert.equal(wrongScope.statusCode, 401);
  const idToken = await gateway.handler(event('/api/account/session', 'GET', token({ token_use: 'id' })), opts);
  assert.equal(idToken.statusCode, 401);
  const expired = await gateway.handler(event('/api/account/session', 'GET', token({ exp: now - 1 })), opts);
  assert.equal(expired.statusCode, 401);
  const forged = await gateway.handler(event('/api/account/session', 'GET', token({}, attackerKey)), opts);
  assert.equal(forged.statusCode, 401);
  check('staging pool/client, missing scope, ID tokens, expired and forged signatures rejected', true);

  assert.equal((await gateway.handler(event('/api/account/session', 'GET', token(), staging.STAGING_ORIGIN), opts)).statusCode, 403);
  assert.equal((await gateway.handler(event('/api/account/session', 'OPTIONS'), opts)).statusCode, 204);
  assert.equal((await gateway.handler(event('/api/saved-trips', 'OPTIONS'), opts)).headers['Access-Control-Allow-Methods'], 'GET,POST,PUT,DELETE,OPTIONS');
  check('origin restriction and account CRUD preflight', true);

  const snapshot = { kind: 'single', origin: 'Toronto', destination: 'Vancouver' };
  const created = await gateway.handler(event('/api/saved-trips', 'POST', token(), env.CORS_ORIGIN, { name: 'Vacation', tripSnapshot: snapshot }), opts);
  assert.equal(created.statusCode, 201);
  const savedTrip = result(created).trip;
  assert.equal(savedTrip.tripId, '12345678-1234-4123-8123-123456789abc');
  const list = await gateway.handler(event('/api/saved-trips', 'GET'), opts);
  assert.equal(list.statusCode, 200);
  assert.equal(result(list).count, 1);
  const get = await gateway.handler(event('/api/saved-trips', 'GET', token(), env.CORS_ORIGIN, null, { tripId: savedTrip.tripId }), opts);
  assert.equal(result(get).trip.name, 'Vacation');
  check('saved-trip create/list/read use only verified owner sub and production table', true);

  const otherOwner = await gateway.handler(event('/api/saved-trips', 'GET', token({ sub: 'owner-two' }), env.CORS_ORIGIN, null, { tripId: savedTrip.tripId }), opts);
  assert.equal(otherOwner.statusCode, 404);
  check('saved trip is private to token owner', true);

  const forbidden = await gateway.handler(event('/api/saved-trips', 'POST', token(), env.CORS_ORIGIN, { name: 'Bad', tripSnapshot: { password: 'not-allowed' } }), opts);
  assert.equal(forbidden.statusCode, 400);
  const badProfile = await gateway.handler(event('/api/account/travel-profile', 'PUT', token(), env.CORS_ORIGIN, { passportNumber: 'not-allowed' }), opts);
  assert.equal(badProfile.statusCode, 400);
  check('sensitive credentials and passport numbers are rejected', true);

  const profileRow = await gateway.handler(event('/api/account/travel-profile', 'PUT', token(), env.CORS_ORIGIN, { homeAirport: 'YYZ', defaultCurrency: 'CAD', pace: 'Balanced' }), opts);
  assert.equal(profileRow.statusCode, 200);
  const readProfile = await gateway.handler(event('/api/account/travel-profile', 'GET'), opts);
  assert.equal(readProfile.statusCode, 200);
  assert.equal(result(readProfile).profile.homeAirport, 'YYZ');
  check('owner-private travel profile write/read uses dedicated storage', true);

  const deleted = await gateway.handler(event('/api/saved-trips', 'DELETE', token(), env.CORS_ORIGIN, null, { tripId: savedTrip.tripId }), opts);
  assert.equal(deleted.statusCode, 200);
  assert.equal(result(await gateway.handler(event('/api/saved-trips', 'GET'), opts)).count, 0);
  check('saved-trip deletion', true);

  const disabled = await gateway.handler(event('/api/account/session', 'GET'), { ...opts, env: { ...env, GLOBEVOY_PRODUCTION_ACCOUNTS_ENABLED: 'false' } });
  assert.equal(disabled.statusCode, 503);
  check('production account handler remains disabled by default', true);
  console.log('GV-PRODUCTION-ACCOUNT: PASS; no AWS network calls or resources created');
})().catch(error => { console.error(error); process.exitCode = 1; });
