'use strict';
const crypto=require('node:crypto');
const routes=Object.freeze({'/api/recommendations':'recommendations','/api/mixed-results':'mixed_results','/api/multicity-tours':'multi_city','/api/generated-tour':'generated_tour','/api/generated-tour-date':'date_adjustment','/api/generated-tour-control':'route_adjustment','/api/fare-calendar':'fare_calendar','/api/flex-windows':'flex_windows','/api/cheap-one-way-flights':'one_way_lookup'});
function configuration(value){
 if(!value||value.enabled!==true)return null;
 if(Object.keys(value).some(k=>!['schemaVersion','enabled','privacyApproved','table','retentionDays'].includes(k))||value.schemaVersion!==1||!/^globevoy-production-activity-events$/.test(value.table)||!Number.isInteger(value.retentionDays)||value.retentionDays<1||value.retentionDays>90||value.privacyApproved!==true)throw Error('Invalid approved activity configuration');
 return value;
}
function loadConfig(){try{return configuration(require('./activity-build.json'));}catch(e){if(e.code==='MODULE_NOT_FOUND')return null;throw e;}}
function band(n){return n===0?'0':n<=5?'1-5':n<=20?'6-20':'21+';}
function evidence(data,now){
 const found=new Set();let visited=0;
 function walk(value,depth=0){if(!value||typeof value!=='object'||depth>12||++visited>10000)return;
  if(Array.isArray(value.stays)&&value.stays.some(stay=>{const e=stay?.hotel?.priceEvidence||stay?.priceEvidence;return !(e?.sourceType==='LIVE'&&e.productionEligible===true&&Date.parse(e.expiresAt)>now);}))found.add('estimated');
  for(const key of ['priceEvidence','priceProvenance','providerDateEvidence']){const e=value[key];if(!e)continue;const t=String(e.sourceType||'').toUpperCase();
   if(t==='ESTIMATED'||t==='CACHED'||t==='UNAVAILABLE')found.add(t.toLowerCase());
   else if(t==='LIVE'&&e.productionEligible===true&&Date.parse(e.expiresAt)>now)found.add('live');
  }
  for(const [key,v]of Object.entries(value))if(!['priceEvidence','priceProvenance','providerDateEvidence','diagnostics','cheapFlightScanner','candidateEvidence','monthlyObservations'].includes(key))walk(v,depth+1);
 }
 walk(data);return found.size>1?'mixed':[...found][0]||'not_assessed';
}
function sanitize({category,response,durationMs,requestId,now=Date.now()},cfg){
 if(!Object.values(routes).includes(category))throw Error('Invalid search category');
 let data;try{data=JSON.parse(response.body);}catch{data={};}
 const arrays=[data.recommendations,data.tours,data.singleRecommendations,data.multiCityTours,data.observations,data.windows].filter(Array.isArray);
 const count=arrays.length?arrays.reduce((n,a)=>n+a.length,0):(data.tour?1:0);
 const status=Number(response.statusCode)||500;
 const outcome=status>=500?'error':status>=400?'rejected':data.supported===false?'unavailable':count?'results':'empty';
 // Do not infer LIVE from arbitrary response diagnostics or client data.
 const utcDate=new Date(now).toISOString().slice(0,10);
 return {schemaVersion:1,eventId:crypto.createHash('sha256').update(String(requestId||crypto.randomUUID())).digest('hex'),utcDate,category,outcome,resultCountBand:band(count),durationBand:durationMs<1000?'under_1s':durationMs<3000?'1_3s':durationMs<10000?'3_10s':'10s_plus',priceEvidence:evidence(data,now),expiresAt:Math.floor(Date.parse(utcDate+'T00:00:00Z')/1000)+cfg.retentionDays*86400};
}
let client;
async function persist(event,cfg,{send}={}){
 if(!send){const sdk=require('@aws-sdk/client-dynamodb');client ||= new sdk.DynamoDBClient({region:'us-east-2',maxAttempts:1});send=(input,opts)=>client.send(new sdk.TransactWriteItemsCommand(input),opts);}
 const item=Object.fromEntries(Object.entries(event).map(([k,v])=>[k,typeof v==='number'?{N:String(v)}:{S:v}]));
 const PK={S:'DAY#'+event.utcDate};
 const input={TransactItems:[{Put:{TableName:cfg.table,Item:{...item,PK,SK:{S:'EVENT#'+event.eventId}},ConditionExpression:'attribute_not_exists(PK) AND attribute_not_exists(SK)'}},{Update:{TableName:cfg.table,Key:{PK,SK:{S:'COUNT#'+event.category+'#'+event.outcome}},UpdateExpression:'SET expiresAt = :ttl ADD #count :one',ExpressionAttributeNames:{'#count':'count'},ExpressionAttributeValues:{':one':{N:'1'},':ttl':{N:String(event.expiresAt)}}}}]};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),200);
 try{await send(input,{abortSignal:controller.signal});}finally{clearTimeout(timer);}
}
function wrap(handler,options={}){
 return async function(event={},context={}){
  const started=Date.now();let response;
  try{response=await handler(event,context);}catch(error){await record({statusCode:500,body:'{}'});throw error;}
  const id=await record(response);return id?{...response,headers:{...response.headers,'X-GV-Activity-Id':id}}:response;
  async function record(result){
   try{
    const path=String(event.rawPath||event.path||'/api/recommendations').split('?')[0],method=String(event.requestContext?.http?.method||event.httpMethod||'GET').toUpperCase();
    if(!routes[path]||!['GET','POST'].includes(method))return;
    const cfg=configuration(options.config===undefined?loadConfig():options.config);if(!cfg)return;
    if(context.getRemainingTimeInMillis&&context.getRemainingTimeInMillis()<400)return;
    const sanitized=sanitize({category:routes[path],response:result,durationMs:Date.now()-started,requestId:context.awsRequestId||event.requestContext?.requestId},cfg);
    await (options.persist||persist)(sanitized,cfg);
    try{(options.log||console.log)(JSON.stringify({component:'search_activity',status:'recorded'}));}catch{}
    return sanitized.eventId;
   }catch(_){try{(options.log||console.log)(JSON.stringify({component:'search_activity',status:'write_failed'}));}catch{}}
  }
 };
}
module.exports={routes,configuration,sanitize,persist,wrap};
