'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const service = require('../services/accounts/saved-trips/staging-saved-trips-705c');
const auth705B = require('../services/accounts/auth/staging-cognito-auth-705b-r3');

const ROOT = path.resolve(BACKEND_ROOT, '..');
const ORIGIN = service.STAGING_ORIGIN;
const ENV = { CORS_ORIGIN: `${ORIGIN}/`, GLOBEVOY_SAVED_TRIPS_TABLE: 'globevoy-staging-saved-trips' };
const FIXED_NOW = Date.parse('2026-08-21T12:00:00.000Z');
const FIXED_ID = '11111111-2222-4333-8444-555555555555';

function event(method, body, queryStringParameters) {
  return {
    rawPath: '/api/saved-trips',
    requestContext: { http: { method } },
    headers: { Origin: ORIGIN, Authorization: 'Bearer test-token' },
    queryStringParameters: queryStringParameters || null,
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

function options(db, sub = 'user-a') {
  return {
    env: ENV,
    ddb: db,
    commandFactory: (name, input) => ({ name, input }),
    bearerToken: () => 'test-token',
    verifyToken: async () => ({ sub, scopes: ['globevoy/trips.write'], expiresAt: Math.floor(FIXED_NOW / 1000) + 3600 }),
    nowMs: FIXED_NOW,
    randomUUID: () => FIXED_ID
  };
}

function validBody(overrides = {}) {
  return {
    name: 'Toronto to Lisbon',
    status: 'planned',
    tripSnapshot: {
      schemaVersion: 1,
      kind: 'single',
      clientSaveKey: 'single|yyz|lis|5|cad',
      sourceUrl: 'trip.html?city=Lisbon&currency=CAD',
      origin: 'Toronto (YYZ)',
      city: 'Lisbon',
      country: 'Portugal'
    },
    providerRefs: {},
    priceSnapshot: { currency: 'CAD', tripEstimate: 1240 },
    travelerProfileRef: null,
    ...overrides
  };
}

function parse(response) { return JSON.parse(response.body); }

async function main() {
  const checks = [];
  const pass = (name) => { checks.push(name); console.log(`[PASS] ${name}`); };

  assert.equal(service.VERSION, 'GV-ACCOUNT-705C');
  assert.equal(service.ROUTE_PATH, '/api/saved-trips');
  pass('705C version and route are fixed');

  {
    const response = await service.handleSavedTrips705C(event('GET'), { env: { CORS_ORIGIN: `${ORIGIN}/` } });
    assert.equal(response.statusCode, 503);
    assert.equal(parse(response).error, 'saved-trips-storage-not-configured');
    pass('missing DynamoDB configuration fails closed');
  }

  {
    const bad = event('GET');
    bad.headers.Origin = 'https://evil.example';
    const response = await service.handleSavedTrips705C(bad, options({ send: async () => ({}) }));
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers['Access-Control-Allow-Origin'], undefined);
    pass('non-staging browser origin is rejected without CORS reflection');
  }

  {
    const response = await service.handleSavedTrips705C(event('GET'), {
      ...options({ send: async () => ({}) }),
      verifyToken: async () => { throw new auth705B.CognitoAuthError705B('token-expired'); }
    });
    assert.equal(response.statusCode, 401);
    assert.equal(parse(response).reason, 'token-expired');
    pass('invalid Cognito access token is rejected');
  }

  let createdItem;
  {
    const db = { send: async (command) => {
      assert.equal(command.name, 'PutItem');
      createdItem = command.input.Item;
      assert.equal(command.input.ConditionExpression, 'attribute_not_exists(PK) AND attribute_not_exists(SK)');
      return {};
    } };
    const response = await service.handleSavedTrips705C(event('POST', validBody()), options(db));
    const body = parse(response);
    assert.equal(response.statusCode, 201);
    assert.equal(body.trip.tripId, FIXED_ID);
    assert.equal(createdItem.PK.S, 'USER#user-a');
    assert.equal(createdItem.SK.S, `TRIP#${FIXED_ID}`);
    assert.equal(createdItem.ownerSub.S, 'user-a');
    assert.equal(body.trip.priceSnapshot.snapshotOnly, true);
    assert.equal(body.trip.priceSnapshot.requiresRevalidation, true);
    assert.equal(Object.hasOwn(body.trip, 'ownerSub'), false);
    pass('create derives owner from verified sub and server-generates trip id');
  }

  {
    const response = await service.handleSavedTrips705C(event('POST', validBody({ ownerSub: 'user-b' })), options({ send: async () => { throw new Error('must not reach DynamoDB'); } }));
    assert.equal(response.statusCode, 400);
    assert.equal(parse(response).error, 'client-ownership-fields-not-allowed');
    pass('client cannot supply owner identity');
  }

  {
    const response = await service.handleSavedTrips705C(event('POST', validBody({ tripSnapshot: { city: 'Lisbon', accessToken: 'secret' } })), options({ send: async () => { throw new Error('must not reach DynamoDB'); } }));
    assert.equal(response.statusCode, 400);
    assert.match(parse(response).error, /sensitive-data/);
    pass('token/credential-like saved payload fields are rejected');
  }

  {
    const response = await service.handleSavedTrips705C(event('POST', validBody({ providerRefs: { bookingUrl: 'https://partner.example/book?access_token=secret' } })), options({ send: async () => { throw new Error('must not reach DynamoDB'); } }));
    assert.equal(response.statusCode, 400);
    pass('sensitive provider URL parameters are rejected');
  }

  {
    const db = { send: async (command) => {
      assert.equal(command.name, 'Query');
      assert.equal(command.input.KeyConditionExpression, 'PK = :pk');
      assert.equal(command.input.ExpressionAttributeValues[':pk'].S, 'USER#user-a');
      assert.equal(command.input.Limit, 50);
      return { Items: [createdItem] };
    } };
    const response = await service.handleSavedTrips705C(event('GET'), options(db));
    const body = parse(response);
    assert.equal(response.statusCode, 200);
    assert.equal(body.count, 1);
    assert.equal(body.trips[0].tripId, FIXED_ID);
    assert.equal(body.pricing.requiresRevalidationBeforeProviderHandoff, true);
    pass('list uses owner-partition Query only and keeps pricing verification explicit');
  }

  {
    const db = { send: async (command) => {
      assert.equal(command.name, 'GetItem');
      assert.equal(command.input.Key.PK.S, 'USER#user-a');
      assert.equal(command.input.Key.SK.S, `TRIP#${FIXED_ID}`);
      return { Item: createdItem };
    } };
    const response = await service.handleSavedTrips705C(event('GET', undefined, { tripId: FIXED_ID }), options(db));
    assert.equal(response.statusCode, 200);
    assert.equal(parse(response).trip.tripId, FIXED_ID);
    pass('get uses exact owner + trip composite key');
  }

  {
    const db = { send: async (command) => {
      assert.equal(command.name, 'UpdateItem');
      assert.equal(command.input.Key.PK.S, 'USER#user-a');
      assert.match(command.input.ConditionExpression, /#v = :expectedVersion/);
      const attrs = { ...createdItem, version: { N: '2' }, name: { S: 'Lisbon updated' }, updatedAt: { S: '2026-08-21T12:00:00.000Z' } };
      return { Attributes: attrs };
    } };
    const response = await service.handleSavedTrips705C(event('PUT', validBody({ name: 'Lisbon updated', version: 1 }), { tripId: FIXED_ID }), options(db));
    assert.equal(response.statusCode, 200);
    assert.equal(parse(response).trip.version, 2);
    pass('update uses optimistic version condition and owner-private key');
  }

  {
    const db = { send: async () => { const error = new Error('conflict'); error.name = 'ConditionalCheckFailedException'; throw error; } };
    const response = await service.handleSavedTrips705C(event('PUT', validBody({ version: 1 }), { tripId: FIXED_ID }), options(db));
    assert.equal(response.statusCode, 409);
    pass('stale or missing update fails closed with conflict');
  }

  {
    const db = { send: async (command) => {
      assert.equal(command.name, 'DeleteItem');
      assert.equal(command.input.Key.PK.S, 'USER#user-a');
      assert.equal(command.input.Key.SK.S, `TRIP#${FIXED_ID}`);
      return { Attributes: createdItem };
    } };
    const response = await service.handleSavedTrips705C(event('DELETE', undefined, { tripId: FIXED_ID }), options(db));
    assert.equal(response.statusCode, 200);
    assert.equal(parse(response).deleted.tripId, FIXED_ID);
    pass('delete is exact-key and owner-private');
  }

  const serviceSource = fs.readFileSync(path.join(BACKEND_ROOT, 'services/accounts/saved-trips/staging-saved-trips-705c.js'), 'utf8');
  assert.equal(/\bScan(Command)?\b/.test(serviceSource), false);
  assert.match(serviceSource, /verified.*sub|verified\.sub/i);
  assert.match(serviceSource, /requiresRevalidation/);
  pass('service contains no table Scan path and preserves trust markers');

  const wrapper = fs.readFileSync(path.join(BACKEND_ROOT, 'staging-lambda-702d.js'), 'utf8');
  const production = fs.readFileSync(path.join(BACKEND_ROOT, 'lambda.js'), 'utf8');
  assert.match(wrapper, /staging-saved-trips-705c/);
  assert.match(wrapper, /X-Globevoy-Staging-Saved-Trips/);
  assert.doesNotMatch(production, /GV-ACCOUNT-705C|staging-saved-trips-705c|GLOBEVOY_SAVED_TRIPS_TABLE/);
  pass('705C is wired only into the staging wrapper, not production handler');

  const shell = fs.readFileSync(path.join(ROOT, 'frontend/scripts/shell-670f.js'), 'utf8');
  const account = fs.readFileSync(path.join(ROOT, 'frontend/account.html'), 'utf8');
  const myTrips = fs.readFileSync(path.join(ROOT, 'frontend/my-trips.html'), 'utf8');
  const browser = fs.readFileSync(path.join(ROOT, 'frontend/scripts/saved-trips-705c.js'), 'utf8');
  assert.match(shell, /saved-trips-705c\.js/);
  assert.match(account, /my-trips\.html/);
  assert.match(myTrips, /PRIVATE TO YOUR ACCOUNT/);
  assert.match(browser, /session\(\).*accessToken|current\.accessToken/s);
  assert.doesNotMatch(browser, /localStorage\.setItem\([^\n]*(accessToken|refreshToken|idToken)/i);
  assert.match(browser, /not silently upload|silently uploading|silently migrated/i);
  pass('frontend exposes My Trips without persisting Cognito tokens to localStorage');

  const operator = fs.readFileSync(path.join(ROOT, 'ops/GV-ACCOUNT-705C-Bootstrap-Staging-Saved-Trips.sh'), 'utf8');
  assert.match(operator, /globevoy-staging-saved-trips/);
  assert.match(operator, /PAY_PER_REQUEST/);
  assert.match(operator, /--sse-specification Enabled=true,SSEType=KMS/);
  assert.doesNotMatch(operator, /SSEType=AES256/);
  assert.match(operator, /PointInTimeRecoveryEnabled=true/);
  assert.match(operator, /dynamodb:Query/);
  assert.doesNotMatch(operator, /dynamodb:\*/);
  assert.match(operator, /GLOBEVOY_SAVED_TRIPS_TABLE/);
  assert.match(operator, /preserving every existing Lambda environment variable/);
  pass('operator creates bounded KMS-encrypted staging storage with PITR and least privilege');

  console.log(`\nGV-ACCOUNT-705C validation PASS (${checks.length}/${checks.length})`);
}

main().catch((error) => {
  console.error('[FAIL] GV-ACCOUNT-705C validation');
  console.error(error);
  process.exitCode = 1;
});
