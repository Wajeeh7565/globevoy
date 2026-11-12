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
const accountConfig = { schemaVersion: 1, enabled: true, origin: env.CORS_ORIGIN, pool: env.GLOBEVOY_PRODUCTION_USER_POOL_ID, client: env.GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID, table: env.GLOBEVOY_PRODUCTION_SAVED_TRIPS_TABLE };
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
    if (name === 'UpdateItem') {
      const row = rows.get(key(input.Key));
      const values = input.ExpressionAttributeValues;
      if (!row || row.version.N !== values[':expectedVersion'].N) {
        throw Object.assign(new Error('conflict'), {name:'ConditionalCheckFailedException'});
      }
      for (const field of ['name','status','updatedAt','tripSnapshotJson','providerRefsJson','priceSnapshotJson','travelerProfileRefJson']) row[field] = values[':'+field];
      row.version = values[':nextVersion'];
      return {Attributes:row};
    }
    if (name === 'GetItem') return { Item: rows.get(key(input.Key)) };
    if (name === 'DeleteItem') {
      const previous = rows.get(key(input.Key));
      rows.delete(key(input.Key));
      return { Attributes: previous };
    }
    throw Error('unexpected DynamoDB command ' + name);
  }
};
const opts = { accountConfig, env, fetch: fakeFetch, nowMs, ddb: db, commandFactory: (name, input) => ({ name, input }), randomUUID: () => '12345678-1234-4123-8123-123456789abc' };
const check = (name, value) => { assert.ok(value, name); console.log('PASS ' + name); };

(async () => {
  check('production user pool and dedicated storage are enabled', Boolean(auth.config(accountConfig)));
  check('missing production config fails closed', auth.config({ ...accountConfig, enabled: false }) === null);
  check('staging pool cannot be selected', auth.config({ ...accountConfig, pool: staging.USER_POOL_ID }) === null);
  check('staging Cognito client cannot be selected', auth.config({ ...accountConfig, client: staging.CLIENT_ID }) === null);
  check('staging table name is forbidden', auth.config({ ...accountConfig, table: 'globevoy-staging-saved-trips' }) === null);
  check('staging origin is rejected', auth.config({ ...accountConfig, origin: staging.STAGING_ORIGIN }) === null);

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
  const updateBody = {name:'Updated vacation', tripSnapshot:snapshot, version:1};
  const updated = await gateway.handler(event('/api/saved-trips','PUT',token(),env.CORS_ORIGIN,updateBody,{tripId:savedTrip.tripId}),opts);
  assert.equal(updated.statusCode,200);
  assert.equal(result(updated).trip.version,2);
  assert.equal(result(updated).trip.name,'Updated vacation');
  assert.equal((await gateway.handler(event('/api/saved-trips','PUT',token(),env.CORS_ORIGIN,updateBody,{tripId:savedTrip.tripId}),opts)).statusCode,409);
  assert.equal((await gateway.handler(event('/api/saved-trips','PUT',token({sub:'owner-two'}),env.CORS_ORIGIN,updateBody,{tripId:savedTrip.tripId}),opts)).statusCode,409);
  check('optimistic updates reject stale versions and cross-owner writes',true);
  const noBearer = event('/api/saved-trips','GET'); delete noBearer.headers.Authorization;
  assert.equal((await gateway.handler(noBearer,opts)).statusCode,401);
  const publicEvent=event('/api/recommendations','GET');
  assert.equal(await gateway.handler(publicEvent,{...opts,publicHandler:e=>e}),publicEvent);
  check('missing authorization denied and classic public routes delegated unchanged',true);


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

  // GV-DUFFEL-014: actual production JWT/DB boundary, with zero live providers.
  const route='/api/account/booking-revalidate';let searches=0,providerCalls=0,publicCalls=0;
  const stops=[{city:'London',airportCode:'LHR',nights:3,hotel:{estimatedStayUsd:100}}];
  const legs=[['YYZ','LHR','2027-03-20'],['LHR','YYZ','2027-03-23']].map(([from,to,date])=>({mode:'flight',transportType:'flight',from:{airportCode:from,code:from},to:{airportCode:to,code:to},departureDate:date,estimatedFlightUsd:100}));
  const createdBooking=await gateway.handler(event('/api/saved-trips','POST',token(),env.CORS_ORIGIN,{name:'Offline verification',tripSnapshot:{kind:'multi',tour:{origin:{airportCode:'YYZ'},legs,stops,cities:stops,passengerPricing:{adults:1,children:0,infants:0,travellers:1,rooms:1},displayBudget:{currency:'CAD',exchangeRateFromUsd:1.36,totalBudget:2000,tripEstimate:408}}},priceSnapshot:{currency:'CAD',totalBudget:2000,tripEstimate:408,flightEstimate:272}}),opts);
  assert.equal(createdBooking.statusCode,201);const bookingId=result(createdBooking).trip.tripId;
  const mockLive=async(tour,query)=>{searches++;return {tour:{...tour,legs:tour.legs.map(leg=>({...leg,liveFareVerified:true,providerDateEvidence:{source:'duffel-live-683d',sourceType:'LIVE',liveMode:true,productionEligible:true,appliedToEstimate:true,providerBacked:true,fareAmountBasis:'party-total',providerPartyTotalAmount:150,providerCurrency:'CAD',currency:'CAD',displayCurrency:'CAD',displayPrice:150,providerPassengerCount:1,origin:leg.from.airportCode,destination:leg.to.airportCode,departureDate:leg.departureDate,observedAt:new Date(nowMs).toISOString(),expiresAt:new Date(nowMs+300000).toISOString(),airline:'Offline Airline',providerReference:'offline-offer'}}))},summary:{applied:true,attempted:true,allFlightLegsLive:true,requiredFlightLegCount:2,liveFlightLegCount:2,providerRequests:2}};};
  const bookingOpts={...opts,applyLiveFarePilot:mockLive,providerFetch:async()=>{providerCalls++;throw Error('Unexpected provider transport')},publicHandler:async()=>{publicCalls++;throw Error('Private route fell through')}};
  for(const [bearer,origin,method,body,status] of [
    ['','https://globevoy.com','POST',{tripId:bookingId},401],['invalid','https://globevoy.com','POST',{tripId:bookingId},401],
    [token({exp:now-1}),env.CORS_ORIGIN,'POST',{tripId:bookingId},401],[token({iss:staging.ISSUER}),env.CORS_ORIGIN,'POST',{tripId:bookingId},401],[token({client_id:staging.CLIENT_ID}),env.CORS_ORIGIN,'POST',{tripId:bookingId},401],[token({scope:'openid'}),env.CORS_ORIGIN,'POST',{tripId:bookingId},401],[token({},attackerKey),env.CORS_ORIGIN,'POST',{tripId:bookingId},401],
    [token(),'https://www.globevoy.com','POST',{tripId:bookingId},403],[token(),'https://evil.example','POST',{tripId:bookingId},403],
    ...['GET','PUT','DELETE','PATCH','HEAD'].map(m=>[token(),env.CORS_ORIGIN,m,{tripId:bookingId},405]),
    [token(),env.CORS_ORIGIN,'POST',{tripId:bookingId,price:1},400],[token(),env.CORS_ORIGIN,'POST',{tripId:bookingId,routes:[]},400],[token(),env.CORS_ORIGIN,'POST',{tripId:bookingId,hotelGuestContext:{}},400],[token(),env.CORS_ORIGIN,'POST',{},400],
    [token(),env.CORS_ORIGIN,'POST',{tripId:'missing-trip-12345'},404],[token({sub:'owner-two'}),env.CORS_ORIGIN,'POST',{tripId:bookingId},404]
  ]){const r=await gateway.handler(event(route,method,bearer,origin,body),bookingOpts);assert.equal(r.statusCode,status);assert.equal(searches,0);assert.equal(providerCalls,0);}
  for(const raw of ['{', 'x'.repeat(4097)]){const e=event(route,'POST');e.body=raw;assert.equal((await gateway.handler(e,bookingOpts)).statusCode,raw.length>4096?413:400);assert.equal(searches,0);}
  const preflight=await gateway.handler(event(route,'OPTIONS','',env.CORS_ORIGIN),bookingOpts);assert.equal(preflight.statusCode,204);assert.equal(preflight.headers['Access-Control-Allow-Methods'],'POST,OPTIONS');assert.equal(publicCalls,0);assert.equal(providerCalls,0);
  check('booking private route rejects JWT/pool/client/scope/ownership/body/method/origin failures before any provider call',true);
  const disabledPilot=await gateway.handler(event(route,'POST',token(),env.CORS_ORIGIN,{tripId:bookingId}),{...bookingOpts,applyLiveFarePilot:undefined});assert.equal(result(disabledPilot).revalidation.applied,false);assert.equal(providerCalls,0);assert.equal(searches,0);
  const success=await gateway.handler(event(route,'POST',token(),env.CORS_ORIGIN,{tripId:bookingId}),bookingOpts);assert.equal(success.statusCode,200);const quote=result(success);assert.equal(quote.revalidation.allFlightLegsLive,true);assert.equal(quote.flights.length,2);assert.equal(quote.revalidation.providerRequests,2);assert.equal(quote.revalidation.passengers,1);assert.equal(quote.currentPricing.currentTotal,null);assert.ok(quote.flights.every(f=>f.provider==='Duffel'&&f.exactMatch&&f.providerAmount===150&&f.providerCurrency==='CAD'&&f.providerPassengerCount===1));assert.equal(quote.trust.hotelAvailabilityVerified,false);assert.equal(providerCalls,0);
  const reused=await gateway.handler(event(route,'POST',token(),env.CORS_ORIGIN,{tripId:bookingId}),{...bookingOpts,applyLiveFarePilot:async(t,q)=>{const v=await mockLive(t,q);v.summary.reused=true;v.summary.attempted=false;v.summary.providerRequests=0;return v;}});assert.equal(result(reused).revalidation.applied,false,'saved or cached evidence cannot be relabelled fresh');
  const storedBooking=[...rows.values()].find(row=>row.tripId?.S===bookingId);const beforeSnapshot=storedBooking.tripSnapshotJson.S;const forgedSnapshot=JSON.parse(beforeSnapshot);for(const leg of forgedSnapshot.tour.legs)leg.providerDateEvidence={source:'duffel-live-683d',productionEligible:true,sourceType:'LIVE',expiresAt:new Date(nowMs+300000).toISOString()};storedBooking.tripSnapshotJson.S=JSON.stringify(forgedSnapshot);
  const sanitized=await gateway.handler(event(route,'POST',token(),env.CORS_ORIGIN,{tripId:bookingId}),{...bookingOpts,applyLiveFarePilot:async(t,q)=>{assert.ok(t.legs.every(l=>!l.providerDateEvidence&&!l.liveFareVerified));return mockLive(t,q);}});assert.equal(result(sanitized).revalidation.applied,true);storedBooking.tripSnapshotJson.S=beforeSnapshot;
  for(const reason of ['provider-unavailable','429-rate-limited','quota-exhausted','partial-multi-leg']){const r=await gateway.handler(event(route,'POST',token(),env.CORS_ORIGIN,{tripId:bookingId}),{...bookingOpts,applyLiveFarePilot:async()=>({summary:{applied:false,allFlightLegsLive:false,reason,providerRequests:0}})});assert.equal(result(r).revalidation.applied,false);assert.deepEqual(result(r).flights,[]);assert.equal(result(r).revalidation.reason,reason);}
  for(const patch of [{expiresAt:new Date(nowMs-1).toISOString()},{origin:'JFK'},{departureDate:'2027-03-21'},{providerPassengerCount:2},{displayCurrency:'USD'},{sourceType:'CACHED'},{liveMode:false},{providerPartyTotalAmount:0}]){const r=await gateway.handler(event(route,'POST',token(),env.CORS_ORIGIN,{tripId:bookingId}),{...bookingOpts,applyLiveFarePilot:async(t,q)=>{const v=await mockLive(t,q);Object.assign(v.tour.legs[0].providerDateEvidence,patch);return v;}});assert.equal(result(r).revalidation.applied,false,JSON.stringify(patch));assert.deepEqual(result(r).flights,[]);}
  const partial=await gateway.handler(event(route,'POST',token(),env.CORS_ORIGIN,{tripId:bookingId}),{...bookingOpts,applyLiveFarePilot:async(t,q)=>{const r=await mockLive(t,q);r.tour.legs.pop();return r;}});assert.equal(result(partial).revalidation.applied,false);assert.equal(providerCalls,0);assert.equal(publicCalls,0);
  let exactRequests=0;
  const bounded={...bookingOpts,applyLiveFarePilot:undefined,env:{...env,ENABLE_DUFFEL_LIVE_683D:'true',ENABLE_DUFFEL_SHADOW_683D:'true',DUFFEL_ACCESS_TOKEN:'duffel_live_offline',ENABLE_BOC_FX_683G:'true',ENABLE_FX_NORMALIZATION_683G:'true',ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A:'true',GV_DUFFEL_PUBLIC_PILOT_ORIGINS_684A:'YYZ'},
    normalizeFx:async input=>({supported:true,provider:'identity-no-conversion',providerAmount:input.providerAmount,providerCurrency:input.providerCurrency,displayAmount:input.providerAmount,displayCurrency:input.displayCurrency,crossRate:1,conversionApplied:false,originalProviderEvidencePreserved:true}),
    searchExact:async args=>{exactRequests++;return {supported:true,observations:[{...args,currency:'CAD',totalPrice:150,price:150,fareAmountBasis:'party-total',providerPartyTotalAmount:150,providerPassengerCount:1,passengers:1,airline:'Offline Airline',stops:0,transfers:0,durationMinutes:480,liveMode:true,source:'duffel-live-683d',providerReference:'offline-offer',observedAt:new Date(nowMs).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}]};}};
  const throughPilot=await gateway.handler(event(route,'POST',token(),env.CORS_ORIGIN,{tripId:bookingId}),bounded);assert.equal(throughPilot.statusCode,200);assert.equal(result(throughPilot).revalidation.applied,true,JSON.stringify(result(throughPilot).revalidation));assert.equal(exactRequests,2);assert.equal(result(throughPilot).revalidation.providerRequests,2);assert.equal(providerCalls,0);
  assert.ok(result(throughPilot).flights.every(f=>f.providerAmount===150&&f.providerCurrency==='CAD'&&f.sourceType==='LIVE'&&f.exactMatch));
  for(const reason of ['provider-unavailable','duffel-http-429','timeout']){
    let failedSearches=0;const failed=await gateway.handler(event(route,'POST',token(),env.CORS_ORIGIN,{tripId:bookingId}),{...bounded,searchExact:async()=>{failedSearches++;return {supported:false,reason,observations:[]};}});
    assert.equal(failed.statusCode,200);assert.equal(result(failed).revalidation.applied,false);assert.deepEqual(result(failed).flights,[]);assert.ok(failedSearches<=12,'unchanged pilot request ceiling');assert.equal(providerCalls,0);
  }
  check('booking shared core preserves atomic matching/expiry, disabled pilot, quota/429 failure and estimate-only hotel totals',true);
  await gateway.handler(event('/api/saved-trips','DELETE',token(),env.CORS_ORIGIN,null,{tripId:bookingId}),opts);

  const disabled = await gateway.handler(event('/api/account/session', 'GET'), { ...opts, accountConfig: { ...accountConfig, enabled: false } });
  assert.equal(disabled.statusCode, 503);
  check('production account handler remains disabled by default', true);
  console.log('GV-PRODUCTION-ACCOUNT: PASS; no AWS network calls or resources created');
})().catch(error => { console.error(error); process.exitCode = 1; });
