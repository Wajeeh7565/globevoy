const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../../backend/services/accounts/auth/production-cognito-auth');
const gateway = require('../../backend/production-account-lambda');
const approved = require('../../ops/release/production-account-config.json');
const event = {rawPath:'/api/account/session',requestContext:{http:{method:'GET'}},headers:{origin:approved.origin}};
test('source build remains disabled, including with legacy environment opt-in', async () => {
 const before = {...process.env};
 try {
  Object.assign(process.env,{GLOBEVOY_PRODUCTION_ACCOUNTS_ENABLED:'true',GLOBEVOY_PRODUCTION_USER_POOL_ID:approved.pool,GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID:approved.client,GLOBEVOY_PRODUCTION_SAVED_TRIPS_TABLE:approved.table,CORS_ORIGIN:approved.origin});
  assert.equal(auth.config(),null);
  assert.equal((await gateway.handler(event)).statusCode,503);
 } finally {for(const k of Object.keys(process.env))if(!(k in before))delete process.env[k];Object.assign(process.env,before);}
});
test('closed nonsecret schema rejects malformed/staging configuration', () => {
 assert.equal(auth.config(approved).table,approved.table);
 for(const value of [null,{}, {...approved,enabled:false},{...approved,enabled:'true'},{...approved,schemaVersion:2},{...approved,pool:'eu-west-1_invalid'},{...approved,client:'bad'},{...approved,pool:'us-east-2_MSd9RRHD8'},{...approved,client:'o2ohbv50253hjli5s34rbvv79'},{...approved,table:'globevoy-staging-saved-trips'},{...approved,table:'arbitrary-table'},{...approved,origin:'https://staging.dy4fw8gx1ccie.amplifyapp.com'},{...approved,origin:approved.origin+'/'},{...approved,providerToken:'forbidden-field'}]) assert.equal(auth.config(value),null);
});
test('artifact config drives exact-origin CORS without changing process environment',async()=>{
 const before={...process.env};
 const options={accountConfig:approved};
 assert.equal((await gateway.handler({...event,requestContext:{http:{method:'OPTIONS'}}},options)).statusCode,204);
 assert.equal((await gateway.handler({...event,headers:{origin:'https://evil.example'}},options)).statusCode,403);
 assert.equal((await gateway.handler(event,options)).statusCode,401);
 assert.deepEqual({...process.env},before);
 const sentinel={unchanged:true};
 assert.equal(await gateway.handler({...event,rawPath:'/api/recommendations'},{...options,publicHandler:()=>sentinel}),sentinel);
});
