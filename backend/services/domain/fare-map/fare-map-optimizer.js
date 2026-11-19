"use strict";
// Date-aware, cached-evidence-only beam search; no provider searches in this module.
const graph=require('../routing/global-route-graph');
const registry=require('../../cities/registry/city-registry');
const activation=require('../../cities/registry/verified-city-activation');
const store=require('./fare-map-store');
const legacy=require('../routing/multicity-routes');
const {evaluateTour}=require('../routing/route-feasibility');
const {recommendationEligibility}=require('../eligibility/travel-entry-eligibility');
const {normalizeParty,priceTransportLeg,priceStopStay}=require('../pricing/traveller-pricing');
const {attachTourPresentation,presentationPolicy,buildDisplayBudget}=require('../pricing/budget-presentation');
const accommodation=require('./accommodation-cost-map');
const VERSION='GV-FAREMAP-BEAM-002',FLAG='ENABLE_FARE_MAP_OPTIMIZER',DESTINATION_COUNT=2;
const day=86400000;
// Live reads of month partitions take ~250-400 ms each on this Lambda; 1.8 s ran out
// after the first stop. 5 s reaches the return leg (verified in simulation at 300-400 ms).
const DEFAULT_TIME_BUDGET_MS=5000;
function enabled(env=process.env){return String(env[FLAG]||'').toLowerCase()==='true';}
function date(s){s=String(s||'').slice(0,10);const t=Date.parse(s+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:null;}
function plus(s,n){return new Date(Date.parse(s+'T00:00:00Z')+n*day).toISOString().slice(0,10);}
function days(a,b){return Math.round((Date.parse(b)-Date.parse(a))/day);}
function months(a,b){const out=[];for(let m=a.slice(0,7);m<=b.slice(0,7)&&out.length<9;){out.push(m);const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);m=d.toISOString().slice(0,7)}return out;}
const {sixMonthsAfter}=require('./search-window');
function durationChoices(query){
 const explicit=query.totalNights??query.nights;
 if(explicit!=null){const n=Number(explicit);if(!Number.isInteger(n)||n<4||n>35)throw new legacy.MultiCityValidationError('INVALID_DURATION','Choose 4 to 35 nights.');return [n];}
 return [6,8,10,12,14,18,21,28];
}
function temporalBeam(states,width){
 const groups=new Map();for(const s of states){const m=s.edges[0].departureDate.slice(0,7);if(!groups.has(m))groups.set(m,[]);groups.get(m).push(s);}
 const anchors=[...groups.values()].map(g=>pickDiverse(g,1)[0]);
 const keys=new Set(anchors.map(s=>s.key));
 return [...anchors,...pickDiverse(states.filter(s=>!keys.has(s.key)),Math.max(0,width-anchors.length))].slice(0,width);
}
function code(row){return row?.unifiedRegistry?.origin?.providerLocationCode||row?.providerMetroCode||row?.cityCode;}
// Several registry rows can share an airport (Niagara Falls also lists YYZ). Use the
// origin city's own row so reads hit the partition the collector writes (YTO, LON).
function originRegistryRow(all,origin){
 const matches=all.filter(r=>(r.unifiedRegistry?.origin?.airportCodes||[]).includes(origin.airportCode));
 const own=String(origin.cityId||'').replace(/^global-city-/,'').toUpperCase();
 return matches.find(r=>code(r)===own)||matches.find(r=>code(r)===origin.airportCode)||matches[0];
}
function rows(){return registry.routeGraphSelection(require('../../../data/global-destination-catalogue.json').destinations);}
function eligible(row){const r=row?.unifiedRegistry;return r?.destination?.eligible===true&&r.validation?.bothProvidersMapped===true&&!r.origin?.requiresGatewayTransfer&&graph._internal.productionDestinationEligible(row)&&activation.liveRecommendationEligible(row);}
function pickDiverse(states,width){
 const chosen=[],uses=new Map(),remaining=states.slice();
 while(chosen.length<width&&remaining.length){
  let best=0,bestScore=Infinity;
  for(let i=0;i<remaining.length;i++){
   const state=remaining[i],score=state.cost+(state.preferencePenalty||0)+state.cities.reduce((s,c)=>s+(uses.get(c.unifiedRegistry.cityId)||0)*75,0);
   if(score<bestScore||score===bestScore&&state.key.localeCompare(remaining[best].key)<0){best=i;bestScore=score;}
  }
  const [next]=remaining.splice(best,1);chosen.push(next);for(const c of next.cities)uses.set(c.unifiedRegistry.cityId,(uses.get(c.unifiedRegistry.cityId)||0)+1);
 }
 return chosen;
}
function stayValid(row,nights){const d=row?.unifiedRegistry?.destination||{};return nights>=Math.max(2,Number(d.minimumRecommendedNights)||2)&&nights<=Math.min(35,Number(d.maximumRecommendedNights)||35);}
function fareValid(f,origin,month,now,maxAge){const t=Date.parse(f?.observedAt);return f?.origin===origin&&f.month===month&&/^[A-Z]{3}$/.test(f.destination||'')&&f.destination!==origin&&Number.isFinite(f.priceUsd)&&f.priceUsd>0&&f.source==='travelpayouts-cached'&&date(f.departureDate)&&f.departureDate.startsWith(month)&&f.departureDate>=new Date(now).toISOString().slice(0,10)&&Number.isFinite(t)&&t<=now+60000&&t>=now-maxAge;}
function makeTour(state,origin,budget,query,options={}){
 const stops=[];
 for(let i=0;i<state.cities.length;i++){
  const row=state.cities[i],start=state.edges[i].departureDate,end=state.edges[i+1].departureDate;
  const cost=accommodation.quote({cityId:row.unifiedRegistry.cityId,checkIn:start,checkOut:end,rooms:normalizeParty(query).rooms,
   quality:{minStars:Number(query.hotelMinStars)||null,minReviewScore:Number(query.hotelMinReviewScore)||null}},
   {provider:options.accommodationProvider,regionalNightlyUsd:graph._internal.nightlyUsd(row),now:options.now});
  if(!cost)return null;
  const stop=priceStopStay({...graph._internal.destinationRecord(row,days(start,end)),arrivalDate:start,departureDate:end,dateSource:'cached-departure-calendar-assumption',arrivalDateVerified:false},query,{nightlyPerRoomUsd:cost.nightlyPerRoomUsd+(cost.taxesAndFeesUsd||0)/(cost.rooms*cost.nights)});
  // Amortize known whole-stay fees into the planning rate so shared repricing retains them.
  stop.hotel.costEvidence=cost;stop.hotel.pricingIntegrity.partyStayTotalUsd=stop.hotel.estimatedStayUsd;
  stops.push(stop);
 }
 const nodes=[origin,...stops,origin];
 const legs=state.edges.map((f,i)=>priceTransportLeg({legNumber:i+1,from:nodes[i],to:nodes[i+1],mode:'flight',transportType:'flight',departureDate:f.departureDate,dateLabel:f.departureDate,distanceKm:Math.round(legacy._internal.haversineKm(nodes[i],nodes[i+1])),durationMinutes:f.durationMinutes,estimateSource:'fare-map-cached-per-passenger',estimatedFlightUsd:f.priceUsd,estimatedTransportUsd:f.priceUsd,providerVerificationRequired:true,liveFareVerified:false,providerDateEvidence:{...(f.dateEstimated?{dateEstimated:true,basis:'month-cheapest-plus-buffer',monthCheapestUsd:f.monthCheapestUsd}:{}),source:'travelpayouts-cached',sourceType:'CACHED',provider:'travelpayouts',origin:f.origin,destination:f.destination,departureDate:f.departureDate,observedAt:f.observedAt,amountUsd:f.priceUsd,currency:'USD',appliedToEstimate:true,productionEligible:false,exactAirportMatch:false,providerBacked:false}},query,{unitAmountUsd:f.priceUsd}));
 const flights=legs.reduce((s,l)=>s+l.estimatedTransportUsd,0),hotels=stops.reduce((s,t)=>s+t.hotel.estimatedStayUsd,0),reserve=Math.round(budget*.10),total=flights+hotels;
 return attachTourPresentation({tourId:'gv-fare-map-'+state.key.replace(/[^A-Za-z0-9-]/g,'-'),origin,stops,legs,passengerPricing:normalizeParty(query),totalNights:stops.reduce((s,t)=>s+t.nights,0),tripDurationNights:days(state.edges[0].departureDate,state.edges.at(-1).departureDate),estimatedTotalUsd:total,totalFlightEstimateUsd:flights,totalTransportEstimateUsd:flights,totalHotelEstimateUsd:hotels,totalBudgetUsd:budget,reservePercent:.1,reserveAmountUsd:reserve,usableTripBudgetUsd:budget-reserve,amountLeftUsd:budget-reserve-total,affordabilityStatus:total<=budget-reserve?'within-protected-budget':'over-protected-budget',selectionSource:'fare-map-beam',pricingStatus:'cached-flight-and-estimated-hotel-planning',providerVerificationRequired:true,routeExplanation:['All three route/date observations exist in the fare map; cached fares do not establish available flights.','Hotel nights conservatively cover the entire departure-to-departure interval. Actual arrival dates and hotel check-in must be verified before booking.','A 10% personal expense reserve remains protected.'],fareMap:{version:VERSION,completeCachedLegs:3,arrivalDatesVerified:false,hotelDatesRequireVerification:true,durationChoices:options.durationChoices||[days(state.edges[0].departureDate,state.edges.at(-1).departureDate)]},editableActions:{removeStop:false,replaceStop:true,addStop:false,reorderStops:false,undo:true}},query);
}
async function search(query={},options={}){
 const env=options.env||process.env;
 if(!enabled(env))return {ok:true,supported:false,reason:'feature-disabled',requiredFlag:FLAG+'=true',tours:[]};
 const diagnostics={engine:VERSION,reads:0,examinedEdges:0,completeRoutes:0,expandedPairs:0,eligibleCities:0,cacheHits:0,rejectedFares:0,rejectedRules:0,bounded:false,liveProviderCallsMade:0};
 let requested=null;
 const response=(tours,reason)=>({ok:true,supported:true,version:VERSION,mode:'guarded-planning-estimate',requested,tours,reason:reason||null,presentationPolicy:presentationPolicy(),pricingPolicy:{flights:'fare-map-cached-estimates',hotels:'accommodation-cost-map-planning-evidence',providerVerificationRequiredBeforeBooking:true,liveProviderCallsMade:0},diagnostics});
 if(!store.tableName(env)&&!options.readRoutes)return response([],'fare-map-not-configured');
 const origin=graph.resolveAnyOrigin(query.origin||query.originCode);
 if(!origin)throw new legacy.MultiCityValidationError('INVALID_ORIGIN','Please enter a supported origin city or airport.');
 if(origin.gatewayAirport)return response([],'origin-gateway-not-supported-in-two-stop-mvp');
 const currency=String(query.currency||'USD').toUpperCase();
 if(!['USD','CAD','AUD','EUR','GBP'].includes(currency)||!Number.isFinite(Number(query.budgetUsd??query.budget))||Number(query.budgetUsd??query.budget)<=0)throw new legacy.MultiCityValidationError('INVALID_BUDGET','Provide a positive budget in a supported currency.');
 if(Number(query.maxStops??query.stops??2)<2)return response([],'two-destination-mvp-only');
 const preferred=(Array.isArray(query.preferredStops)?query.preferredStops:String(query.preferredStops||'').split(',')).map(x=>String(x).trim().toLowerCase()).filter(Boolean);
 if(preferred.length>2)return response([],'two-destination-mvp-only');
 if(query.destinationCount&&Number(query.destinationCount)!==2)return response([],'two-destination-mvp-only');
 const durations=durationChoices(query),nights=Math.max(...durations),
  // One cached date per city pair per month: an exact-length match is rare, so flexible
  // searches accept any length in the range; an explicit night count stays exact.
  durationOk=n=>durations.length===1?n===durations[0]:n>=Math.min(...durations)&&n<=nights,budget=legacy._internal.normalizeBudgetUsd(query),party=normalizeParty(query);
 if(!Number.isFinite(budget)||budget<=0)return response([],'invalid-fx-configuration');
 requested={origin,budgetUsd:budget,reservePercent:.1,reserveAmountUsd:Math.round(budget*.1),usableTripBudgetUsd:budget-Math.round(budget*.1),totalNights:durations.length===1?nights:null,durationChoices:durations,maxStops:2,theme:query.theme||query.preference||null,displayBudget:buildDisplayBudget({query,totalBudgetUsd:budget,reservePercent:.1,tripUsd:0})};
 const now=options.now??Date.now(),clock=options.clock||Date.now,started=clock(),timeBudget=Math.min(5000,options.timeBudgetMs||DEFAULT_TIME_BUDGET_MS),deadline=started+timeBudget;
 const today=new Date(now).toISOString().slice(0,10),horizon=sixMonthsAfter(today);
 const explicitMonth=query.month||query.departureMonth;
 if(explicitMonth&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(explicitMonth))throw new legacy.MultiCityValidationError('INVALID_DATE','Use YYYY-MM.');
 if(query.departureDate&&!date(query.departureDate)||query.returnDate&&!date(query.returnDate))throw new legacy.MultiCityValidationError('INVALID_DATE','Explicit travel dates must be valid.');
 const start=query.departureDate||explicitMonth&&explicitMonth+'-01'||today;
 const end=query.departureDate?plus(start,1):horizon;
 // A requested month narrows the window; default searches the entire rolling six months.
 const monthEnd=explicitMonth?new Date(Date.UTC(Number(explicitMonth.slice(0,4)),Number(explicitMonth.slice(5,7)),1)).toISOString().slice(0,10):null;
 const windowStart=start>today?start:today,windowEnd=[horizon,query.departureDate?end:monthEnd||horizon].sort()[0];
 requested.departureWindow={start:windowStart,endExclusive:windowEnd};
 if(windowStart>=windowEnd)return response([],'departure-window-outside-six-month-horizon');
 const firstMonths=months(windowStart,plus(windowEnd,-1));
 const all=options.rows||rows();
 const candidates=all.filter(r=>eligible(r)&&code(r)&&r.unifiedRegistry.cityId!==origin.cityId&&!(r.unifiedRegistry.origin?.airportCodes||[]).includes(origin.airportCode));
 const map=new Map();for(const r of candidates)if(!map.has(code(r)))map.set(code(r),r);
 diagnostics.eligibleCities=map.size;
 const originRow=originRegistryRow(all,origin);
 const originCode=code(originRow)||origin.airportCode,cache=new Map();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeBudget);
 const read=options.readRoutes||((o,m)=>store.readRoutesFrom(o,m,{env,dynamo:options.dynamo,abortSignal:controller.signal,maxPages:2,limit:1000,nowMs:now,includeDated:true,diagnostics}));
 let readCeiling=Math.min(64,options.maxReads||64);
 const stopped=()=>{if(clock()>=deadline||controller.signal.aborted||diagnostics.examinedEdges>=Math.min(100000,options.maxEdges||100000)){diagnostics.bounded=true;return true}return false};
 async function cancellableRead(o,m){
  if(controller.signal.aborted)throw Error('deadline');
  let abort;
  const cancelled=new Promise((_,reject)=>{abort=()=>reject(Error('deadline'));controller.signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([Promise.resolve().then(()=>read(o,m,{signal:controller.signal})),cancelled]);}
  finally{controller.signal.removeEventListener('abort',abort);}
 }
 const pending=new Map();
 async function partition(o,m){
  const key=o+'#'+m;
  if(cache.has(key)){diagnostics.cacheHits++;return cache.get(key)}
  if(pending.has(key)){diagnostics.cacheHits++;return pending.get(key)}
  if(stopped())return [];
  if(diagnostics.reads>=readCeiling){diagnostics.bounded=true;return []}
  diagnostics.reads++;
  const work=(async()=>{
   let value;
   try{value=await cancellableRead(o,m)}catch{diagnostics.readErrors=(diagnostics.readErrors||0)+1;value=[]}
   if(Array.isArray(value)&&value.length>1000){diagnostics.bounded=true;diagnostics.truncatedPartitions=(diagnostics.truncatedPartitions||0)+1;}
   const valid=(Array.isArray(value)?value:[]).slice(0,1000).filter(f=>{const valid=fareValid(f,o,m,now,Math.min(14*day,options.maxAgeMs||3*day));if(!valid)diagnostics.rejectedFares++;return valid});
   cache.set(key,valid);return valid;
  })();
  pending.set(key,work);try{return await work}finally{pending.delete(key)}
 }
 async function fares(o,ms){return (await Promise.all(ms.map(m=>partition(o,m)))).flat();}
  function completeRoute(state,fare,first){
      if(fare.destination!==originCode||!durationOk(days(first,fare.departureDate))||query.returnDate&&fare.departureDate!==query.returnDate)return false;
      if(preferred.some(id=>!state.cities.some(c=>c.unifiedRegistry.cityId.toLowerCase()===id)))return false;
      diagnostics.completeRoutes++;
      const candidate={...state,edges:[...state.edges,fare]};const tour=makeTour(candidate,origin,budget,query,{...options,now,durationChoices:durations});
      if(!tour){diagnostics.missingHotelEvidence=(diagnostics.missingHotelEvidence||0)+1;return false;}
      if(tour.estimatedTotalUsd>tour.usableTripBudgetUsd)return false;
      const evaluated=evaluateTour(tour,query);if(!evaluated.accepted||recommendationEligibility(evaluated.tour,query).hardBlocked){diagnostics.rejectedRules++;return false}
      const comfortPenalty=String(query.flightComfort||'').toLowerCase()==='comfortable'?candidate.edges.reduce((sum,f)=>sum+(Number.isFinite(f.stops)?f.stops*25:25)+(Number.isFinite(f.durationMinutes)?f.durationMinutes/60:12),0):0;
      const qualityPenalty=tour.stops.reduce((sum,s)=>sum+(s.hotel.costEvidence.quality.verified?-(s.hotel.costEvidence.quality.reviewScore||0)*2:0),0);
      tour.fareMap.scoreEvidence={costUsd:tour.estimatedTotalUsd,comfortPenalty,hotelQualityPenalty:qualityPenalty,unknownFlightComfort:candidate.edges.some(f=>f.stops==null||f.durationMinutes==null)};
      complete.push({estimatedDate:!!fare.dateEstimated,cities:state.cities,cost:tour.estimatedTotalUsd,preferencePenalty:comfortPenalty+qualityPenalty+(state.preferencePenalty||0),key:state.key,tour:{...evaluated.tour,fareMap:tour.fareMap}});
      if(complete.length>128)complete=pickDiverse(complete,64);
      return true;
  }
 let beam=[{cities:[],edges:[],lastCode:originCode,cost:0,key:originCode}],complete=[];
 try {
  for(let depth=0;depth<=DESTINATION_COUNT&&beam.length;depth++){
   const readLimit=Math.min(64,options.maxReads||64);
   readCeiling=depth===1?Math.max(diagnostics.reads,readLimit-Math.min(16,Math.floor(readLimit/3))):readLimit;
   // Independent partitions at one depth may be prefetched with a small fixed pool.
   // Never fan out to the full registry, and never make provider calls here.
   const concurrency=Math.max(1,Math.min(4,options.readConcurrency||4));
   for(let i=0;i<beam.length&&!stopped();i+=concurrency)await Promise.all(beam.slice(i,i+concurrency).map(state=>fares(state.lastCode,depth?months(state.edges.at(-1).departureDate,plus(state.edges[0].departureDate,nights)):firstMonths)));
   const next=[];
   for(const state of beam){
    if(stopped())break;
    const ms=depth?months(state.edges.at(-1).departureDate,plus(state.edges[0].departureDate,nights)):firstMonths;
    for(const fare of await fares(state.lastCode,ms)){
     if(stopped())break;diagnostics.examinedEdges++;
     if(depth===0&&query.departureDate&&fare.departureDate!==query.departureDate)continue;
     if(depth===0&&(fare.departureDate<windowStart||fare.departureDate>=windowEnd))continue;
     const first=depth?state.edges[0].departureDate:fare.departureDate;
     if(days(first,fare.departureDate)>nights)continue;
     if(depth===DESTINATION_COUNT&&fare.destination===originCode){diagnostics.returnFares=(diagnostics.returnFares||0)+1;if(!state.returnSeed||fare.priceUsd<state.returnSeed.priceUsd)state.returnSeed=fare;}
     if(depth){const previous=state.edges.at(-1),transitDays=Math.max(1,Math.ceil((previous.durationMinutes||0)/1440));if(!stayValid(state.cities.at(-1),days(previous.departureDate,fare.departureDate)-transitDays)){if(depth===DESTINATION_COUNT&&fare.destination===originCode)diagnostics.returnStayRejected=(diagnostics.returnStayRejected||0)+1;continue;}}
     if(depth===DESTINATION_COUNT){if(completeRoute(state,fare,first))state.completed=true;continue;}
     const row=map.get(fare.destination);if(!row||state.cities.some(c=>code(c)===fare.destination))continue;
     if(depth===1)diagnostics.expandedPairs++;
     const record=row.unifiedRegistry;
     if(preferred.length===2&&!preferred.includes(record.cityId.toLowerCase()))continue;
     if(query.region&&!['any','anywhere','all'].includes(String(query.region).toLowerCase())&&String(record.worldRegion).toLowerCase()!==String(query.region).toLowerCase())continue;
     const hotel=depth?(options.accommodationProvider?0:graph._internal.nightlyUsd(state.cities.at(-1)))*party.rooms*days(state.edges.at(-1).departureDate,fare.departureDate):0;
     const cost=state.cost+Math.round(fare.priceUsd*party.flightFareUnits)+hotel;
     if(cost>budget*.9)continue;
     const theme=String(query.theme||query.preference||'').toLowerCase(),themeScore=Number(row.unifiedRegistry?.cityIntelligence?.themeScores?.[theme]||row.cityIntelligence?.themeScores?.[theme]||0);
     next.push({preferencePenalty:([ ...state.cities,row ].some(c=>preferred.includes(c.unifiedRegistry.cityId.toLowerCase()))?-budget:0)-themeScore*2,cities:[...state.cities,row],edges:[...state.edges,fare],lastCode:fare.destination,cost,key:state.key+'>'+record.cityId+'@'+fare.departureDate});
    }
    if(depth===DESTINATION_COUNT&&!state.completed&&state.returnSeed&&!stopped()){
     // The fare map keeps one cheapest date per pair and month, so the cached return date
     // rarely fits the stay. Plan the return inside the city's recommended stay instead,
     // priced from that month's cheapest fare plus a buffer, and label it an estimate;
     // the selected trip is live-checked on these exact dates before it is verified.
     const previous=state.edges.at(-1),seed=state.returnSeed,first=state.edges[0].departureDate,d=state.cities.at(-1)?.unifiedRegistry?.destination||{};
     const transit=Math.max(1,Math.ceil((previous.durationMinutes||0)/1440)),lo=Math.max(2,Number(d.minimumRecommendedNights)||2),hi=Math.min(35,Number(d.maximumRecommendedNights)||35);
     for(const n of [Math.round((lo+hi)/2),lo,hi]){
      const ret=plus(previous.departureDate,transit+n);
      if(ret.slice(0,7)!==seed.departureDate.slice(0,7)||ret>=horizon||!durationOk(days(first,ret))||query.returnDate&&ret!==query.returnDate)continue;
      diagnostics.estimatedReturnDates=(diagnostics.estimatedReturnDates||0)+1;
      if(completeRoute(state,{...seed,departureDate:ret,priceUsd:Math.round(seed.priceUsd*1.3),monthCheapestUsd:seed.priceUsd,dateEstimated:true},first))break;
     }
    }
   }
   const width=Math.min(64,Math.max(7,options.beamWidth||32));
   if(depth===DESTINATION_COUNT-1){
    // The return leg needs the second city's partitions. Under a fixed read budget, keep
    // routes whose second city was already read as a first stop (cache hits) alongside new ones.
    const cachedReturn=s=>months(s.edges.at(-1).departureDate,plus(s.edges[0].departureDate,nights)).every(m=>cache.has(s.lastCode+'#'+m));
    const warm=next.filter(cachedReturn),cold=next.filter(s=>!cachedReturn(s));
    const warmPick=temporalBeam(warm,Math.min(warm.length,Math.ceil(width*.75)));
    beam=[...warmPick,...temporalBeam(cold,Math.max(0,width-warmPick.length))];
   } else beam=temporalBeam(next,width);
   diagnostics.peakRetainedComplete=Math.max(diagnostics.peakRetainedComplete||0,complete.length);
  }
 }finally{clearTimeout(timer)}
 if(controller.signal.aborted)diagnostics.bounded=true;
 const distinct=new Map();for(const s of complete){const key=s.cities.map(code).join('>');const old=distinct.get(key);if(!old||old.estimatedDate&&!s.estimatedDate||old.estimatedDate===s.estimatedDate&&s.cost+s.preferencePenalty<old.cost+old.preferencePenalty)distinct.set(key,s);}
 const ranked=[...distinct.values()].sort((a,b)=>a.estimatedDate-b.estimatedDate||a.cost-b.cost||a.key.localeCompare(b.key)),cheapest=ranked[0];
 const alternatives=cheapest?ranked.slice(1).map(s=>({...s,preferencePenalty:(s.preferencePenalty||0)+s.cities.reduce((sum,c)=>sum+(cheapest.cities.some(x=>code(x)===code(c))?75:0),0)})):[];
 const picked=(cheapest?[cheapest,...pickDiverse(alternatives,2)]:[]).map((s,i)=>({...s.tour,tourRole:['lowest-cost','best-balance','most-memorable'][i],tourRoleLabel:['Lowest cost','Diverse alternative','Another route idea'][i]}));
 diagnostics.returnedTours=picked.length;diagnostics.destinationDiversity=new Set(picked.flatMap(t=>t.stops.map(s=>s.cityId))).size;diagnostics.ms=clock()-started;
 return response(picked,picked.length?null:diagnostics.readErrors?'fare-map-read-unavailable':'no-complete-date-compatible-fare-map-route');
}
module.exports={_originRegistryRow:originRegistryRow,VERSION,FLAG,enabled,search,_internal:{date,plus,days,months,sixMonthsAfter,durationChoices,rows,eligible,code,fareValid,pickDiverse,makeTour}};
