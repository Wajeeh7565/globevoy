const {test}=require('node:test'),assert=require('node:assert/strict');
const a=require('../../backend/services/analytics/search-activity');
const cfg={schemaVersion:1,enabled:true,privacyApproved:true,table:'globevoy-production-activity-events',retentionDays:30};
const response={statusCode:200,headers:{x:'unchanged'},body:JSON.stringify({tours:[{priceEvidence:{sourceType:'ESTIMATED'}}],email:'private',token:'secret',query:'exact dates'})};
for(const path of Object.keys(a.routes))test('one guest event for '+path,async()=>{const events=[];const wrapped=a.wrap(async()=>response,{config:cfg,persist:async e=>events.push(e),log:()=>{}});const result=await wrapped({rawPath:path,headers:{Authorization:'secret'},requestContext:{requestId:'request-1',http:{method:'GET'},httpIp:'private'}},{});assert.equal(result.body,response.body);assert.equal(result.statusCode,response.statusCode);assert.equal(result.headers.x,'unchanged');assert.equal(result.headers['X-GV-Activity-Id'],events[0].eventId);assert.equal(events.length,1);assert.equal(events[0].priceEvidence,'estimated');assert.doesNotMatch(JSON.stringify(events),/private|secret|exact dates|Authorization/);});
test('schema and deterministic request ID allowlist',()=>{const e=a.sanitize({category:'recommendations',response,durationMs:12,requestId:'same',now:Date.UTC(2026,10,16)},cfg);assert.deepEqual(Object.keys(e).sort(),['category','durationBand','eventId','expiresAt','outcome','priceEvidence','resultCountBand','schemaVersion','utcDate','utcHour'].sort());assert.equal(e.utcDate,'2026-11-16');assert.equal(e.eventId,a.sanitize({category:'recommendations',response,durationMs:1,requestId:'same'},cfg).eventId);assert.equal(e.expiresAt,Math.floor(Date.UTC(2026,10,16)/1000)+30*86400);});
for(const [status,body,outcome]of [[200,{tours:[]},'empty'],[200,{supported:false},'unavailable'],[400,{},'rejected'],[500,{},'error']])test('outcome '+outcome,()=>assert.equal(a.sanitize({category:'generated_tour',response:{statusCode:status,body:JSON.stringify(body)},durationMs:4000},cfg).outcome,outcome));
test('off, non-search, OPTIONS and low deadline cause no writes',async()=>{for(const [config,event,context]of [[null,{rawPath:'/api/recommendations'},{}],[cfg,{rawPath:'/api/city-registry'},{}],[cfg,{rawPath:'/api/generated-tour',httpMethod:'OPTIONS'},{}],[cfg,{rawPath:'/api/generated-tour'},{getRemainingTimeInMillis:()=>100}]]){let n=0;assert.equal(await a.wrap(async()=>response,{config,persist:async()=>n++,log:()=>{}})(event,context),response);assert.equal(n,0);}});
test('database, configuration and logger failures preserve response and original exception',async()=>{for(const options of [{config:cfg,persist:async()=>{throw Error('secret')}},{config:{...cfg,privacyApproved:false}}]){const wrapped=a.wrap(async()=>response,{...options,log:()=>{throw Error('logger')}});assert.equal(await wrapped({rawPath:'/api/recommendations'}),response);}const original=Error('original');await assert.rejects(a.wrap(async()=>{throw original},{config:cfg,persist:async()=>{throw Error('db')},log:()=>{}})({rawPath:'/api/recommendations'}),e=>e===original);});
test('transaction idempotency keeps event and daily counter atomic',async()=>{let stored=false,counter=0;const send=async input=>{assert.equal(input.TransactItems.length,3);const put=input.TransactItems[0].Put;assert.match(put.ConditionExpression,/attribute_not_exists/);assert.equal(put.TableName,cfg.table);if(stored)throw Object.assign(Error('duplicate'),{name:'TransactionCanceledException',CancellationReasons:[{Code:'ConditionalCheckFailed'},{Code:'None'}]});stored=true;counter++;};const e=a.sanitize({category:'recommendations',response,durationMs:1,requestId:'id'},cfg);await a.persist(e,cfg,{send});assert.equal(await a.persist(e,cfg,{send}),'duplicate');assert.equal(counter,1);});
test('abort bounds an AWS write and no retries occur',async()=>{let calls=0;const send=async(_,{abortSignal})=>{calls++;return new Promise((_,reject)=>abortSignal.addEventListener('abort',()=>reject(Error('aborted'))));};await assert.rejects(a.persist(a.sanitize({category:'recommendations',response,durationMs:1},cfg),cfg,{send}));assert.equal(calls,1);});
test('expired and sandbox evidence cannot classify as live',()=>{for(const patch of [{productionEligible:false,expiresAt:'2099-01-01'},{productionEligible:true,expiresAt:'2000-01-01'}]){const r={statusCode:200,body:JSON.stringify({tours:[{priceEvidence:{sourceType:'LIVE',...patch}}]})};assert.equal(a.sanitize({category:'generated_tour',response:r,durationMs:1},cfg).priceEvidence,'not_assessed');}});
test('production route boundary remains public and wraps only once',()=>{const fs=require('node:fs');const s=fs.readFileSync('backend/lambda.js','utf8');assert.equal(s.split(".wrap(exports.handler)").length-1,1);assert.ok(!a.routes['/api/account/session']);assert.ok(!a.routes['/api/generated-tour/admin']);const infra=JSON.parse(fs.readFileSync('ops/analytics/activity-stack.json'));assert.equal(infra.Resources.ActivityTable.Properties.BillingMode,'PAY_PER_REQUEST');assert.equal(infra.Resources.ActivityTable.DeletionPolicy,'Retain');assert.deepEqual(infra.Resources.WriterPolicy.Properties.PolicyDocument.Statement[0].Action,['dynamodb:PutItem','dynamodb:UpdateItem']);});

test('TTL cannot expose precise search time within a UTC day',()=>{const args={category:'recommendations',response,durationMs:1};assert.equal(a.sanitize({...args,now:Date.UTC(2026,10,16,1)},cfg).expiresAt,a.sanitize({...args,now:Date.UTC(2026,10,16,23)},cfg).expiresAt);assert.throws(()=>a.configuration({...cfg,token:'forbidden'}));});

test('live flights with estimated hotels remain mixed and diagnostics cannot certify live',()=>{const live={sourceType:'LIVE',productionEligible:true,expiresAt:'2099-01-01'};const r={statusCode:200,body:JSON.stringify({tour:{legs:[{providerDateEvidence:live}],stays:[{hotel:{estimatedStayUsd:100}}]}})};assert.equal(a.sanitize({category:'generated_tour',response:r,durationMs:1},cfg).priceEvidence,'mixed');assert.equal(a.sanitize({category:'generated_tour',response:{statusCode:200,body:JSON.stringify({diagnostics:{priceEvidence:live}})},durationMs:1},cfg).priceEvidence,'not_assessed');});

test('an application-level failure is not counted as an empty successful search',()=>assert.equal(a.sanitize({category:'generated_tour',response:{statusCode:200,body:JSON.stringify({ok:false,error:'private error'})},durationMs:1},cfg).outcome,'error'));

test('real generated-tour response shapes with stops cannot certify partial flight or hotel estimates',async()=>{
 const tours=await require('../frontend/generated-tour-fixtures.cjs').generatedTours();
 for(const raw of tours){
  const tour=structuredClone(raw);assert.ok(tour.stops.length);delete tour.stays;
  const legs=tour.backendLegs||tour.legs;assert.ok(legs.length>1);
  const quote={sourceType:'LIVE',productionEligible:true,expiresAt:'2099-01-01'};
  for(const leg of legs){delete leg.priceProvenance;leg.providerDateEvidence={...quote};}
  const response=()=>({statusCode:200,body:JSON.stringify({ok:true,tour,tours:[tour]})});
  assert.equal(a.sanitize({category:'generated_tour',response:response(),durationMs:1},cfg).priceEvidence,'mixed');
  delete legs[1].providerDateEvidence;delete legs[1].priceEvidence;
  assert.notEqual(a.sanitize({category:'generated_tour',response:response(),durationMs:1},cfg).priceEvidence,'live');
  delete tour.stops;assert.notEqual(a.sanitize({category:'generated_tour',response:response(),durationMs:1},cfg).priceEvidence,'live');
 }
});
test('TTL uses UTC day start plus 30 days, including month boundaries',()=>{
 for(const now of [Date.UTC(2026,10,16,0),Date.UTC(2026,10,16,23,59,59)])assert.equal(a.sanitize({category:'recommendations',response,durationMs:1,now},cfg).expiresAt,Date.UTC(2026,11,16)/1000);
});

test('actual public generated-tour handler response with stops is classified conservatively',async()=>{
 const keys=['GLOBEVOY_USE_MOCKS','ENABLE_MULTICITY_ROUTE_610B','ENABLE_GENERATED_TOUR_651A'];const prior=keys.map(k=>process.env[k]);
 try{for(const k of keys)process.env[k]='true';const result=await require('../../backend/lambda').handler({rawPath:'/api/generated-tour',requestContext:{http:{method:'GET'}},queryStringParameters:{origin:'YYZ',budget:'5000',currency:'CAD',month:'2027-03',passengers:'1',nights:'7'},headers:{origin:'https://globevoy.com'}});assert.equal(result.statusCode,200);const body=JSON.parse(result.body);const tour=body.tour||body.tours?.[0];assert.ok(tour?.stops?.length,'real handler must return a selected tour with stops');assert.notEqual(a.sanitize({category:'generated_tour',response:result,durationMs:1},cfg).priceEvidence,'live');}
 finally{keys.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);}
});

test('declared partial coverage and single recommendation hotel estimates cannot be all-live',()=>{
 const live={sourceType:'LIVE',productionEligible:true,expiresAt:'2099-01-01'};
 for(const tour of [{legs:[{providerDateEvidence:live}],publicLiveFarePilot684A:{allFlightLegsLive:false,requiredFlightLegCount:3,liveFlightLegCount:1}},{priceEvidence:live,hotel:{estimatedStayUsd:100}}])assert.notEqual(a.sanitize({category:'generated_tour',response:{statusCode:200,body:JSON.stringify({tour})},durationMs:1},cfg).priceEvidence,'live');
});


test('billing proposal is email-only and does not claim analytics-only attribution',()=>{const fs=require('node:fs'),t=JSON.parse(fs.readFileSync('ops/analytics/billing-alert-stack.json'));assert.equal(t.Parameters.MonthlyLimitUsd.Default,10);assert.equal(t.Parameters.AlertEmail.NoEcho,true);const budget=t.Resources.ServiceBudget.Properties;assert.deepEqual(budget.Budget.CostFilters.Service,['Amazon DynamoDB','AWS Lambda','AmazonCloudWatch']);assert.deepEqual(budget.NotificationsWithSubscribers.map(x=>[x.Notification.NotificationType,x.Notification.Threshold]),[['ACTUAL',80],['FORECASTED',100]]);assert.ok(budget.NotificationsWithSubscribers.every(x=>x.Subscribers[0].SubscriptionType==='EMAIL'));});

test('event, daily and hourly increments are atomic and replay-safe across UTC boundaries',async()=>{
 const rows=new Map();const send=async ({TransactItems:ops})=>{
  assert.equal(ops.length,3);const item=ops[0].Put.Item,key=item.PK.S+'|'+item.SK.S;
  if(rows.has(key))throw Object.assign(Error('duplicate'),{name:'TransactionCanceledException',CancellationReasons:[{Code:'ConditionalCheckFailed'},{Code:'None'},{Code:'None'}]});
  rows.set(key,item);
  for(const op of ops.slice(1)){const u=op.Update,k=u.Key.PK.S+'|'+u.Key.SK.S;rows.set(k,(rows.get(k)||0)+1);assert.equal(u.ExpressionAttributeValues[':ttl'].N,item.expiresAt.N);}
 };
 const args={category:'generated_tour',response,durationMs:10};
 const before=a.sanitize({...args,now:Date.UTC(2026,10,16,23,59,59),requestId:'before'},cfg);
 const after=a.sanitize({...args,now:Date.UTC(2026,10,17,0,0,0),requestId:'after'},cfg);
 assert.equal(before.utcHour,23);assert.equal(after.utcHour,0);assert.equal(after.expiresAt-before.expiresAt,86400);
 await a.persist(before,cfg,{send});assert.equal(await a.persist(before,cfg,{send}),'duplicate');await a.persist(after,cfg,{send});
 for(const [day,hour]of [['2026-11-16','23'],['2026-11-17','00']]){assert.equal(rows.get('DAY#'+day+'|COUNT#generated_tour#results'),1);assert.equal(rows.get('DAY#'+day+'|HOUR#'+hour+'#generated_tour#results'),1);}
 assert.equal([...rows.keys()].filter(k=>k.includes('|EVENT#')).length,2);
});
test('all UTC hours are coarse integers and results retain their categories',()=>{
 for(let hour=0;hour<24;hour++){const e=a.sanitize({category:'multi_city',response,durationMs:5,now:Date.UTC(2026,10,16,hour,34,56)},cfg);assert.equal(e.utcHour,hour);assert.equal(e.utcDate,'2026-11-16');assert.equal(e.category,'multi_city');assert.ok(!('timestamp'in e));}
 assert.equal(a.routes['/api/recommendations'],'recommendations');assert.equal(a.routes['/api/multicity-tours'],'multi_city');assert.equal(a.routes['/api/generated-tour-control'],'route_adjustment');assert.equal(a.routes['/api/fare-calendar'],'fare_calendar');
});
