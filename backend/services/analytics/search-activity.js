'use strict';
const crypto=require('node:crypto');
const routes=Object.freeze({'/api/recommendations':'recommendations','/api/mixed-results':'mixed_results','/api/multicity-tours':'multi_city','/api/generated-tour':'generated_tour','/api/generated-tour-date':'date_adjustment','/api/generated-tour-control':'route_adjustment','/api/fare-calendar':'fare_calendar','/api/flex-windows':'flex_windows','/api/cheap-one-way-flights':'one_way_lookup'});
// schemaVersion 2 (GV-ANALYTICS-9A) adds optional `detail` (budget band, origin airport,
// trips/cities shown, live-check counts and a random per-page search reference) and the
// trip-feedback events. detail needs its own approval flag, `detailApproved`.
function configuration(value){
 if(!value||value.enabled!==true)return null;
 const keys=['schemaVersion','enabled','privacyApproved','table','retentionDays','detail','detailApproved'];
 if(Object.keys(value).some(k=>!keys.includes(k))||![1,2].includes(value.schemaVersion)||!/^globevoy-production-activity-events$/.test(value.table)||!Number.isInteger(value.retentionDays)||value.retentionDays<1||value.retentionDays>90||value.privacyApproved!==true)throw Error('Invalid approved activity configuration');
 if(value.detail===true&&(value.schemaVersion!==2||value.detailApproved!==true))throw Error('Detailed activity needs schemaVersion 2 and detailApproved');
 return value;
}
function loadConfig(){try{return configuration(require('./activity-build.json'));}catch(e){if(e.code==='MODULE_NOT_FOUND')return null;throw e;}}
function band(n){return n===0?'0':n<=5?'1-5':n<=20?'6-20':'21+';}
function evidence(data,now){
 const found=new Set();let visited=0;
 const fresh=e=>e?.sourceType==='LIVE'&&e.productionEligible===true&&Date.parse(e.expiresAt)>now;
 function classify(value,hotel=false){
  const e=value?.providerDateEvidence||value?.priceEvidence||value?.priceProvenance;
  if(fresh(e)&&(!hotel||(value.providerVerification?.verified===true&&value.providerVerification?.productionEligible===true&&value.providerVerification?.exactStayDates===true)))return 'live';
  const t=String(e?.sourceType||'').toLowerCase();
  if(['cached','estimated','unavailable'].includes(t))return t;
  if(hotel||Object.keys(value||{}).some(k=>/^estimated/.test(k)&&Number(value[k])>0))return 'estimated';
  return 'not_assessed';
 }
 function product(value,depth=0){
  if(!value||typeof value!=='object'||depth>8||++visited>10000)return;
  if(Array.isArray(value)){for(const v of value)product(v,depth+1);return;}
  if(value.hotel)found.add(classify(value.hotel,true));
  const coverage=value.publicLiveFarePilot684A||value.revalidation;
  if(coverage&&(coverage.allFlightLegsLive===false||coverage.applied===false||Number(coverage.requiredFlightLegCount)>Number(coverage.liveFlightLegCount)))found.add('not_assessed');
  const legs=Array.isArray(value.backendLegs)&&value.backendLegs.length?value.backendLegs:value.legs;
  const stops=Array.isArray(value.stops)&&value.stops.length?value.stops:value.stays;
  if(Array.isArray(legs)&&legs.length)for(const leg of legs)found.add(classify(leg));
  if(Array.isArray(stops)&&stops.length)for(const stop of stops)found.add(classify(stop?.hotel||stop,true));
  if(!legs?.length&&!stops?.length)found.add(classify(value));
 }
 // Only returned products, never discovery candidates or response diagnostics.
 for(const key of ['tour','tours','recommendations','singleRecommendations','multiCityTours','observations','windows'])product(data?.[key]);
 return found.size>1?'mixed':[...found][0]||'not_assessed';
}
// ---- GV-ANALYTICS-9A detail (generated_tour only) ------------------------------------
// Coarse, non-identifying: no exact budget, dates, IP, headers, user or session ID.
// searchRef is a hash of a random token the results page creates for one page view (not
// stored in the browser), so feedback clicks can be linked to the trips that were shown.
const CAD_PER={CAD:1,USD:1.36,EUR:1.47,GBP:1.72,AUD:0.9};
function budgetBand(q={}){const b=Number(q.budget),r=CAD_PER[String(q.currency||'CAD').toUpperCase()];if(!(b>0)||!r)return 'unknown';const c=b*r;return c<1000?'under_1000':c<2000?'1000_1999':c<4000?'2000_3999':c<7000?'4000_6999':'7000_plus';}
function originCode(q={}){const m=String(q.origin||q.originCode||'').toUpperCase().match(/\(([A-Z]{3})\)\s*$/)||String(q.originCode||'').toUpperCase().match(/^([A-Z]{3})$/);return m?m[1]:'unknown';}
function travellersBand(q={}){const n=Number(q.adults||q.passengers||1);return n<=1?'1':n===2?'2':'3_plus';}
const ref=token=>/^[A-Za-z0-9-]{16,64}$/.test(String(token||''))?crypto.createHash('sha256').update('gv-search-ref:'+token).digest('hex').slice(0,24):null;
function useBand(t){const u=Number(t?.estimatedTotalUsd)/Number(t?.totalBudgetUsd);return !(u>0)?'unknown':u<.5?'under_50':u<.7?'50_69':u<.85?'70_84':u<=1?'85_100':'over_100';}
function detail(query,data){
 const tours=Array.isArray(data.tours)&&data.tours.length?data.tours:data.tour?[data.tour]:[];
 const d=data.diagnostics||{},att=Array.isArray(d.fareMapLiveAttempts)?d.fareMapLiveAttempts:[];
 const cities=[...new Set(tours.flatMap(t=>(t.cities||t.stops||[]).map(c=>String(c.cityId||c.id||'').toLowerCase()).filter(x=>/^[a-z0-9-]{2,60}$/.test(x))))].slice(0,9);
 const out={budgetBand:budgetBand(query),originCode:originCode(query),travellersBand:travellersBand(query),tripsShown:tours.length,cityCountShown:cities.length,
  citiesShown:cities.join(',')||'none',roles:tours.map(t=>String(t.tourRole||'').replace(/[^a-z-]/g,'')).filter(Boolean).join(',')||'none',bestUseBand:useBand(tours[0]),
  poolSize:Math.min(99,Number(data.poolSize)||0),liveChecks:Math.min(99,Number(d.poolChecks)||att.length||0),failedChecks:Math.min(99,att.filter(a=>a!=='ok'&&!/stopped/.test(String(a))).length)};
 const r=ref(query.sid);if(r)out.searchRef=r;
 return out;
}

function sanitize({category,response,durationMs,requestId,now=Date.now(),query={}},cfg){
 if(!Object.values(routes).includes(category))throw Error('Invalid search category');
 let data;try{data=JSON.parse(response.body);}catch{data={};}
 const arrays=[data.recommendations,data.tours,data.singleRecommendations,data.multiCityTours,data.observations,data.windows].filter(Array.isArray);
 const count=arrays.length?arrays.reduce((n,a)=>n+a.length,0):(data.tour?1:0);
 const status=Number(response.statusCode)||500;
 const outcome=status>=500?'error':status>=400?'rejected':data.ok===false?'error':data.supported===false?'unavailable':count?'results':'empty';
 // Do not infer LIVE from arbitrary response diagnostics or client data.
 const utcDate=new Date(now).toISOString().slice(0,10);
 const base={schemaVersion:cfg&&cfg.schemaVersion===2?2:1,eventId:crypto.createHash('sha256').update(String(requestId||crypto.randomUUID())).digest('hex'),utcDate,utcHour:new Date(now).getUTCHours(),category,outcome,resultCountBand:band(count),durationBand:durationMs<1000?'under_1s':durationMs<3000?'1_3s':durationMs<10000?'3_10s':'10s_plus',priceEvidence:evidence(data,now),expiresAt:Math.floor(Date.parse(utcDate+'T00:00:00Z')/1000)+cfg.retentionDays*86400};
 return cfg&&cfg.detail===true&&category==='generated_tour'?{...base,...detail(query,data)}:base;
}
let client;
async function persist(event,cfg,{send}={}){
 if(!send){const sdk=require('@aws-sdk/client-dynamodb');client ||= new sdk.DynamoDBClient({region:'us-east-2',maxAttempts:1});send=(input,opts)=>client.send(new sdk.TransactWriteItemsCommand(input),opts);}
 const item=Object.fromEntries(Object.entries(event).map(([k,v])=>[k,typeof v==='number'?{N:String(v)}:{S:v}]));
 const PK={S:'DAY#'+event.utcDate};
 const counter=SK=>({Update:{TableName:cfg.table,Key:{PK,SK:{S:SK}},UpdateExpression:'SET expiresAt = :ttl ADD #count :one',ExpressionAttributeNames:{'#count':'count'},ExpressionAttributeValues:{':one':{N:'1'},':ttl':{N:String(event.expiresAt)}}}});
 const input={TransactItems:[
  {Put:{TableName:cfg.table,Item:{...item,PK,SK:{S:'EVENT#'+event.eventId}},ConditionExpression:'attribute_not_exists(PK) AND attribute_not_exists(SK)'}},
  counter('COUNT#'+event.category+'#'+event.outcome),
  counter('HOUR#'+String(event.utcHour).padStart(2,'0')+'#'+event.category+'#'+event.outcome),
  // detail: daily counters for budgets and origins (for "top origins" / "budgets")
  ...(event.budgetBand?[counter('BUDGET#'+event.budgetBand),counter('ORIGIN#'+event.originCode)]:[])
 ]};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),200);
 try{await send(input,{abortSignal:controller.signal});return 'recorded';}catch(error){if(error.name==='TransactionCanceledException'&&error.CancellationReasons?.[0]?.Code==='ConditionalCheckFailed'&&error.CancellationReasons.slice(1).every(r=>r.Code==='None'))return 'duplicate';throw error;}finally{clearTimeout(timer);}
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
    const sanitized=sanitize({category:routes[path],response:result,durationMs:Date.now()-started,requestId:context.awsRequestId||event.requestContext?.requestId,query:event.queryStringParameters||{}},cfg);
    const writeStatus=await (options.persist||persist)(sanitized,cfg);
    try{(options.log||console.log)(JSON.stringify({component:'search_activity',status:writeStatus==='duplicate'?'duplicate':'recorded'}));}catch{}
    return sanitized.eventId;
   }catch(_){try{(options.log||console.log)(JSON.stringify({component:'search_activity',status:'write_failed'}));}catch{}}
  }
 };
}
module.exports={routes,configuration,sanitize,persist,wrap,loadConfig,_internal:{budgetBand,originCode,travellersBand,ref,useBand,detail}};
