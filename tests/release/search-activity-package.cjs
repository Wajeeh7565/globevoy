// Offline package integration: no credentials, AWS or providers.
const assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const root=path.resolve(process.argv[2]);let stored=new Set(),counter=0,fail=false,items=[];
const original=Module._load;
Module._load=function(name,...rest){if(name==='@aws-sdk/client-dynamodb')return {DynamoDBClient:class{async send(command){if(fail)throw Error('offline unavailable');const item=command.input.TransactItems[0].Put.Item;if(stored.has(item.SK.S))throw Object.assign(Error('duplicate'),{name:'TransactionCanceledException',CancellationReasons:[{Code:'ConditionalCheckFailed'},{Code:'None'}]});stored.add(item.SK.S);items.push(item);counter++;return {};}},TransactWriteItemsCommand:class{constructor(input){this.input=input}}};return original.call(this,name,...rest);};
global.fetch=async()=>{throw Error('External network forbidden')};
const handler=require(path.join(root,'src/lambda')).handler;
(async()=>{const event={rawPath:'/api/recommendations',requestContext:{http:{method:'GET'}},queryStringParameters:{origin:'NOT-A-REAL-AIRPORT',budget:'0',email:'never-store-this'}};
 const ctx={awsRequestId:'offline-package-id',getRemainingTimeInMillis:()=>10000};
 const first=await handler(event,ctx);assert.equal(first.statusCode,400);assert.match(first.headers['X-GV-Activity-Id'],/^[a-f0-9]{64}$/);assert.equal(counter,1);assert.equal(items[0].outcome.S,'rejected');assert.doesNotMatch(JSON.stringify(items),/NOT-A-REAL|never-store|email/);
 const replay=await handler(event,ctx);assert.equal(replay.body,first.body);assert.equal(replay.headers['X-GV-Activity-Id'],first.headers['X-GV-Activity-Id']);assert.equal(counter,1);
 fail=true;const failure=await handler(event,{...ctx,awsRequestId:'offline-different-id'});assert.equal(failure.statusCode,first.statusCode);assert.equal(failure.body,first.body);assert.equal(counter,1);
 console.log('PASS packaged guest boundary, real handler validation, correlation, sanitized transaction, dedupe and writer outage; zero AWS/provider requests');
})().catch(e=>{console.error(e);process.exitCode=1});
