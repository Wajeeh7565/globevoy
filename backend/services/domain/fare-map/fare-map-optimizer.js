"use strict";
// Date-aware, cached-evidence-only beam search; no provider searches in this module.
const graph=require('../routing/global-route-graph');
const registry=require('../../cities/registry/city-registry');
const activation=require('../../cities/registry/verified-city-activation');
const store=require('./fare-map-store');
const legacy=require('../routing/multicity-routes');
const {evaluateTour}=require('../routing/route-feasibility');
const {recommendationEligibility}=require('../eligibility/travel-entry-eligibility');
const cityExpansion=require('./city-expansion');
const {normalizeParty,priceTransportLeg,priceStopStay}=require('../pricing/traveller-pricing');
const {attachTourPresentation,presentationPolicy,buildDisplayBudget}=require('../pricing/budget-presentation');
const accommodation=require('./accommodation-cost-map');
const VERSION='GV-FAREMAP-BEAM-004',FLAG='ENABLE_FARE_MAP_OPTIMIZER';
const hotelMemory=require('../live-fares/hotel-price-memory');
const priceIndexSummary=require('../pricing/hotel-price-index/summary');
// Trips have 1 to MAX_CITIES cities (GV-TRIP-SHAPE-001): a small budget gets one city done
// well, a larger one two. FARE_MAP_MAX_CITIES may raise this to 3 once read budgets allow.
// Above about C$1,500 (US$1,100) a single city wastes the budget: the options are
// two-city trips, and one city is shown only when no two-city trip fits.
const MULTI_CITY_FROM_USD=1100;
const BIG_BUDGET_FROM_USD=2900;
function bigBudgetOn(env=process.env){return String(env.FARE_MAP_BIG_BUDGET||'').trim().toLowerCase()!=='off';}
// Trips abroad are preferred from about US$1,500 (C$2,050). At C$1,500 that pushed
// Toronto to Caribbean trips whose real hotels did not fit (GV-MAIN-PICK-002).
const ABROAD_FROM_USD=1500;
// Real hotel prices (Nuitee) came in well above the planning model in a 120-search live
// check, so trips that fit on paper failed live. Trips are chosen with hotels counted at
// this margin (GV-HOTEL-MARGIN-001); the shown price stays the honest estimate until live.
function hotelMargin(env=process.env){const m=Number(env.FARE_MAP_HOTEL_MARGIN);return Number.isFinite(m)&&m>=1&&m<=2?m:1.3;}
// GV-HOTEL-PLAN-002 (V2 task 6): how a stay is priced while planning.
//   level: the city's learned live/model ratio (hotel price memory) x1.05; for a city
//          never checked live, its REGION's learned ratios (75th percentile, needs >=3
//          learned cities in the region) instead of the flat margin; else the margin.
//   shape: when Price Index summaries are loaded (PRICE_INDEX_PLANNING=on, which needs
//          stored summaries, i.e. PRICE_INDEX_STORAGE=on), the stay's date pattern
//          (weekends, holidays, seasons) relative to the city's median, clamped 0.7-1.8.
// FARE_MAP_REGION_COLD_START=off turns the regional level off.
const REGION_MIN_CITIES=3,REGION_QUANTILE=.75;
// GV-HOTEL-MEM-002 study settings (defaults = current production behaviour):
//   FARE_MAP_REGION_QUANTILE   0.5-0.9 (default 0.75): which percentile of a region's learned
//                              ratios plans never-checked cities.
//   HOTEL_MEMORY_CLEAN_SINCE   ISO time or ms; memory entries last updated before it are
//                              "legacy" (learned before the budget-upgrade and property-fee fixes).
//   HOTEL_MEMORY_LEGACY        trust (default) | shrink | regional | ignore
//     trust:    use legacy entries as they are
//     shrink:   legacy ratio keeps half its excess over 1 (1 + (r - 1) / 2)
//     regional: legacy entries leave the regional calibration; a legacy city uses its region's
//               clean level when one exists, else its own ratio shrunk
//     ignore:   legacy entries are treated as never checked
function regionQuantile(env=process.env){const q=Number(env.FARE_MAP_REGION_QUANTILE);return Number.isFinite(q)&&q>=.5&&q<=.9?q:REGION_QUANTILE;}
//     bayes:    GV-HOTEL-MEM-003. Only observations counted after CLEAN_SINCE (q_/c_) are
//               clean; the old average is weak evidence (HOTEL_MEMORY_LEGACY_WEIGHT, default
//               0.25 per check, at most 5 checks) even if touched after the fix; both are
//               blended with the region's typical ratio (HOTEL_MEMORY_PRIOR_WEIGHT, default
//               2 checks), so a city with one or two checks stays close to its region.
const num=(v,d,lo,hi)=>{const n=Number(v);return Number.isFinite(n)&&n>=lo&&n<=hi?n:d};
function legacyRule(env=process.env){
 const mode=String(env.HOTEL_MEMORY_LEGACY||'trust').trim().toLowerCase(),raw=String(env.HOTEL_MEMORY_CLEAN_SINCE||'').trim();
 const since=/^\d+$/.test(raw)?Number(raw):Date.parse(raw);
 return {mode:['shrink','regional','ignore','bayes'].includes(mode)&&Number.isFinite(since)?mode:'trust',since:Number.isFinite(since)?since:0,
  legacyWeight:num(env.HOTEL_MEMORY_LEGACY_WEIGHT,.25,0,1),priorWeight:num(env.HOTEL_MEMORY_PRIOR_WEIGHT,2,0,20)};
}
const median=v=>{const a=v.slice().sort((x,y)=>x-y),m=(a.length-1)/2;return a.length?(a[Math.floor(m)]+a[Math.ceil(m)])/2:null};
// What a memory entry says on its own, for the regional prior: clean average if any, else
// the legacy average.
const evidence=hit=>hit.c>0&&Number.isFinite(hit.q)?hit.q:hit.ratio;
function posterior(hit,prior,rule){
 const wl=rule.legacyWeight*Math.min(5,Number(hit.n)||1),wc=hit.c>0?Math.min(5,hit.c):0,k=rule.priorWeight;
 return (k*prior+wl*hit.ratio+wc*(wc?hit.q:0))/Math.max(1e-9,k+wl+wc);
}
const isLegacy=(hit,rule)=>rule.mode!=='trust'&&hit&&Number(hit.at||0)<rule.since;
function regionRatios(ratios,rowList,env=process.env){
 const out=new Map();if(!ratios||!ratios.size||String(env.FARE_MAP_REGION_COLD_START||'').trim().toLowerCase()==='off')return out;
 const rule=legacyRule(env),q=regionQuantile(env),by=new Map();
 if(rule.mode==='bayes'){
  // Priors: each region's median evidence (>=3 cities), else all cities' median, else the margin.
  const ev=new Map(),hits=[];
  for(const row of rowList){const hit=ratios.get(hotelMemory._internal.attr(row.unifiedRegistry?.cityId));if(!hit)continue;const f=regionFamily(row);hits.push([f,hit]);if(!ev.has(f))ev.set(f,[]);ev.get(f).push(evidence(hit));}
  const global=hits.length>=REGION_MIN_CITIES?median(hits.map(([,h])=>evidence(h))):hotelMargin(env)/1.05;
  out.set('__global',{prior:global});
  const prior=f=>(ev.get(f)||[]).length>=REGION_MIN_CITIES?median(ev.get(f)):global;
  for(const [f,hit] of hits){if(!by.has(f))by.set(f,[]);by.get(f).push(posterior(hit,prior(f),rule));}
  for(const f of new Set([...ev.keys()])){const v=(by.get(f)||[]).sort((a,b)=>a-b);const entry={prior:Number(prior(f).toFixed(3))};
   if(v.length>=REGION_MIN_CITIES){const i=(v.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);entry.ratio=Number((v[lo]+(v[hi]-v[lo])*(i-lo)).toFixed(3));entry.cities=v.length;}
   out.set(f,entry);}
  return out;
 }
 for(const row of rowList){const hit=ratios.get(hotelMemory._internal.attr(row.unifiedRegistry?.cityId));if(!hit)continue;
  if(isLegacy(hit,rule)&&rule.mode!=='shrink')continue;
  const r=isLegacy(hit,rule)?1+(hit.ratio-1)/2:hit.ratio;const f=regionFamily(row);if(!by.has(f))by.set(f,[]);by.get(f).push(r);}
 for(const [f,v] of by){if(v.length<REGION_MIN_CITIES)continue;v.sort((a,b)=>a-b);const i=(v.length-1)*q,lo=Math.floor(i),hi=Math.ceil(i);out.set(f,{ratio:Number((v[lo]+(v[hi]-v[lo])*(i-lo)).toFixed(3)),cities:v.length});}
 return out;
}
// Level for one stay from memory: { level, kind } or null (=> regional level or margin).
function memoryLevel(ratios,stop,regionLevels,env,rule=legacyRule(env)){
 const hit=ratios&&ratios.get(hotelMemory._internal.attr(stop?.cityId));if(!hit)return null;
 if(rule.mode==='bayes'){const prior=regionLevels?.get(stop?.regionFamily)?.prior??regionLevels?.get('__global')?.prior??hotelMargin(env)/1.05;return {level:Math.max(1,posterior(hit,prior,rule)*1.05),kind:hit.c>0?'bayes-clean':'bayes-legacy'};}
 if(!isLegacy(hit,rule))return {level:Math.max(1,hit.ratio*1.05),kind:'learned'};
 if(rule.mode==='ignore')return null;
 const shrunk=Math.max(1,(1+(hit.ratio-1)/2)*1.05);
 if(rule.mode==='regional'){const reg=regionLevels.get(stop?.regionFamily);return reg?{level:Math.max(1,reg.ratio),kind:'legacy-regional'}:{level:shrunk,kind:'legacy-shrunk'};}
 return {level:shrunk,kind:'legacy-shrunk'};
}
function stayShape(index,stop){
 if(!index||!index.size)return null;const sum=index.get(stop?.cityId);if(!sum)return null;
 const day=String(stop.arrivalDate||stop.checkIn||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
 const f=priceIndexSummary.seasonality(sum,day,Number(stop.nights)||1);return f==null?null:Math.min(1.8,Math.max(0.7,f));
}
// Nobody books a holiday for tomorrow: trips leave at least this many days out.
function minLeadDays(env=process.env){const n=Number(env.FARE_MAP_MIN_LEAD_DAYS);return Number.isInteger(n)&&n>=0&&n<=60?n:10;}
function maxCities(env=process.env){const n=Number(env.FARE_MAP_MAX_CITIES);return Number.isInteger(n)&&n>=1&&n<=3?n:2;}
// City character (GV-CITY-VIBES-001): theme scores 0-5 for 443 of the 444 live cities.
const intel=new Map((require('../../../data/city-intelligence-510c.json').records||[]).map(r=>[r.cityId,r]));
const VIBE_WORDS={food:'food',culture:'culture',nature:'nature',beach:'beaches',nightlife:'nightlife',relaxation:'slow, relaxed days'};
// What stands out about a city: its themes furthest above the average city, not the
// themes every city scores well on (most score 4 for food and culture).
const THEME_MEAN=(()=>{const sum={},n={};for(const r of intel.values())for(const [k,v] of Object.entries(r.themeScores||{})){sum[k]=(sum[k]||0)+Number(v||0);n[k]=(n[k]||0)+1;}return Object.fromEntries(Object.keys(sum).map(k=>[k,sum[k]/n[k]]));})();
function cityVibes(cityId){const r=intel.get(cityId);if(!r)return[];const e=Object.entries(r.themeScores||{}).filter(([,v])=>v>=3).map(([k,v])=>[k,v-(THEME_MEAN[k]||0),v]).sort((a,b)=>b[1]-a[1]||b[2]-a[2]||a[0].localeCompare(b[0]));return e.filter(([,lift],i)=>i===0||lift>0.4).slice(0,2).map(([k])=>k);}
function themeScore(row,theme){return Number(intel.get(row?.unifiedRegistry?.cityId)?.themeScores?.[theme]||0);}
// Broad parts of the world, so the options can differ (Europe, Latin America, Asia...).
function clusterFamily(c){c=String(c||'').toLowerCase();
 if(c.includes('europe'))return 'europe';if(c.includes('south-america')||c.includes('mexico')||c.includes('caribbean'))return 'latin-america';
 if(c.includes('asia')||c.includes('middle-east'))return 'asia';if(c.includes('africa'))return 'africa';if(c.includes('oceania'))return 'oceania';if(c.includes('north-america'))return 'north-america';return null;}
// GV-CITY-AUDIT-001: some not-yet-active cities carry a coarse cluster ("americas", "other":
// Caribbean, Indian Ocean and Atlantic islands). Their part of the world is then taken from
// the nearest cities whose cluster is known (registry coordinates; no country or city lists).
// Every active city has a known cluster, so live results do not change.
let familyIndex=null;
function nearestFamily(u){
 if(!familyIndex){familyIndex=[];for(const r of rows())if(clusterFamily(r?.unifiedRegistry?.destination?.regionCluster)&&Number.isFinite(Number(r.unifiedRegistry.latitude)))familyIndex.push({lat:Number(r.unifiedRegistry.latitude),lon:Number(r.unifiedRegistry.longitude),f:clusterFamily(r.unifiedRegistry.destination.regionCluster)});}
 const lat=Number(u?.latitude),lon=Number(u?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon)||!familyIndex.length)return null;
 const rad=Math.PI/180,d=p=>{const h=Math.sin((p.lat-lat)*rad/2)**2+Math.cos(lat*rad)*Math.cos(p.lat*rad)*Math.sin((p.lon-lon)*rad/2)**2;return Math.asin(Math.sqrt(h));};
 const near=familyIndex.map(p=>[d(p),p.f]).sort((a,b)=>a[0]-b[0]).slice(0,5),votes=new Map();for(const [,f] of near)votes.set(f,(votes.get(f)||0)+1);
 return [...votes].sort((a,b)=>b[1]-a[1])[0][0];
}
const familyMemo=new Map();
function regionFamily(row){const u=row?.unifiedRegistry,c=String(u?.destination?.regionCluster||u?.worldRegion||'').toLowerCase();
 const known=clusterFamily(c);if(known)return known;
 const id=u?.cityId;if(id&&familyMemo.has(id))return familyMemo.get(id);
 const f=nearestFamily(u)||c||'other';if(id)familyMemo.set(id,f);return f;}
const FAMILY_NAMES={europe:'Europe','latin-america':'Latin America',asia:'Asia',africa:'Africa',oceania:'Oceania','north-america':'North America'};
function list(words){return words.length<2?words.join(''):words.slice(0,-1).join(', ')+' and '+words.at(-1);}
// One plain sentence on why this trip: each city's character, and the shape of the trip.
function tripStory(stops){
 const parts=stops.map(s=>{const v=cityVibes(s.cityId).map(k=>VIBE_WORDS[k]);return v.length?`${s.city} for ${list(v)}`:s.city;});
 if(stops.length===1)return `${parts[0]}. One base for ${stops[0].nights} nights, so you see the city properly instead of rushing.`;
 const fams=new Set(stops.map(s=>s.regionFamily));
 return `${parts.join(', then ')}.${fams.size>1?' Two different parts of the world in one trip.':' Two different sides of '+(FAMILY_NAMES[[...fams][0]]||'the region')+'.'}`;
}
const day=86400000;
// Live reads of month partitions take ~250-400 ms each on this Lambda; 1.8 s ran out
// after the first stop. 5 s reaches the return leg (verified in simulation at 300-400 ms).
const DEFAULT_TIME_BUDGET_MS=5000;
// 64 reads left ~13 for the return leg; live reads finish well inside the time budget.
const MAX_READS=96;
function enabled(env=process.env){return String(env[FLAG]||'').toLowerCase()==='true';}
function date(s){s=String(s||'').slice(0,10);const t=Date.parse(s+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===s?s:null;}
function plus(s,n){return new Date(Date.parse(s+'T00:00:00Z')+n*day).toISOString().slice(0,10);}
function days(a,b){return Math.round((Date.parse(b)-Date.parse(a))/day);}
function months(a,b){const out=[];for(let m=a.slice(0,7);m<=b.slice(0,7)&&out.length<9;){out.push(m);const d=new Date(m+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);m=d.toISOString().slice(0,7)}return out;}
const {sixMonthsAfter}=require('./search-window');
function anyRegion(value){const v=String(value??'').trim().toLowerCase();return !v||['any','anywhere','all','all continents','all regions','everywhere','worldwide','no preference'].includes(v);}
function durationChoices(query){
 const explicit=query.totalNights??query.nights;
 if(explicit!=null){const n=Number(explicit);if(!Number.isInteger(n)||n<4||n>35)throw new legacy.MultiCityValidationError('INVALID_DURATION','Choose 4 to 35 nights.');return [n];}
 // 4-5 night trips let small budgets see one city well.
 return [4,6,8,10,12,14,18,21,28];
}
// Keep every part of the world in the search (GV-WORLD-BEAM-001): the cheapest first
// stops are always nearby, so a cost-only beam never reaches Europe, Latin America or
// Asia. Each region family gets a share of the beam before the cheapest fill the rest.
function familyBeam(states,width){
 const groups=new Map();for(const s of states){const f=regionFamily(s.cities.at(-1));if(!groups.has(f))groups.set(f,[]);groups.get(f).push(s);}
 if(groups.size<2)return temporalBeam(states,width);
 const share=Math.max(2,Math.floor(width*.6/groups.size)),picked=[];
 for(const g of groups.values())picked.push(...pickDiverse(g,Math.min(share,g.length)));
 const keys=new Set(picked.map(s=>s.key));
 return [...picked.slice(0,width),...temporalBeam(states.filter(s=>!keys.has(s.key)),Math.max(0,width-picked.length))].slice(0,width);
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
function directRegistryDestination(row){const r=row?.unifiedRegistry;return r?.destination?.eligible===true&&!r.origin?.requiresGatewayTransfer;}
function destinationAllowed(row){return directRegistryDestination(row)&&graph._internal.productionDestinationEligible(row)&&activation.liveRecommendationEligible(row);}
function eligible(row){return row?.unifiedRegistry?.validation?.bothProvidersMapped===true&&destinationAllowed(row);}
// GV-DATA-DYN-001 (FARE_MAP_DYNAMIC_DESTINATIONS=on, off by default): the collector stores
// fares to every city Travelpayouts returns, but only registry cities could be picked, so
// about half the fresh fares were never scored. With the flag, every catalogue city with a
// flightable airport, coordinates and a time zone is a candidate too (no list of places).
// What is unknown about such a city is handled conservatively instead:
//   * short stays (2-5 nights) until the city has its own recommended stay;
//   * hotels at the regional estimate plus FARE_MAP_DYNAMIC_HOTEL_MARGIN (default 1.15);
//   * it must be connected: its own fare partition serves at least
//     FARE_MAP_DYNAMIC_MIN_ROUTES destinations (default 15), and the trip needs a real
//     cached fare onward or home from it (no mirrored return);
//   * at most FARE_MAP_DYNAMIC_MAX_PER_TRIP such cities per trip (default 1).
// Hotels, flights and entry rules are still live-checked before a trip is shown.
function dynamicEnabled(env=process.env){return String(env.FARE_MAP_DYNAMIC_DESTINATIONS||'').trim().toLowerCase()==='on';}
function dynamicSetting(env,name,def,lo,hi){const v=Number(env[name]);return Number.isFinite(v)&&v>=lo&&v<=hi?v:def;}
let dynamicCache=null;
function dynamicRows(base=rows(),catalogue=require('../../../data/global-destination-catalogue.json').destinations){
 if(dynamicCache&&dynamicCache.base===base&&dynamicCache.catalogue===catalogue)return dynamicCache.rows;
 const taken=new Set();for(const r of base)for(const c of [code(r),r.cityCode,...(r.unifiedRegistry?.origin?.airportCodes||[])])if(c)taken.add(String(c).toUpperCase());
 const out=[];
 for(const c of catalogue){
  if(!['eligible','trusted'].includes(c.eligibilityStatus))continue;
  const cc=String(c.cityCode||'').toUpperCase(),air=(c.flightableAirportCodes||[]).map(a=>String(a).toUpperCase()).filter(a=>/^[A-Z]{3}$/.test(a));
  if(!/^[A-Z]{3}$/.test(cc)||taken.has(cc)||!air.length||air.some(a=>taken.has(a)))continue;
  if(!Number.isFinite(Number(c.latitude))||!Number.isFinite(Number(c.longitude))||!c.timeZone||!/^[A-Z]{2}$/.test(String(c.countryCode||'')))continue;
  taken.add(cc);
  const rec={cityId:`discovered-${cc.toLowerCase()}`,displayName:c.canonicalCityName,countryCode:c.countryCode,country:c.countryName,latitude:Number(c.latitude),longitude:Number(c.longitude),timeZone:c.timeZone,
   selectionTier:'discovered',dynamicDestination:true,
   origin:{providerLocationCode:cc,preferredAirportCode:String(c.primaryAirportCode||air[0]).toUpperCase(),airportCodes:air},
   destination:{eligible:true,minimumRecommendedNights:2,maximumRecommendedNights:5},
   validation:{bothProvidersMapped:false,sourceConfidence:c.sourceConfidence||'unknown'}};
  out.push({...c,cityCode:cc,providerMetroCode:cc,registryDestinationEligible:true,dynamicDestination:true,unifiedRegistry:rec});
 }
 dynamicCache={base,catalogue,rows:out};return out;
}
function isDynamic(row){return row?.dynamicDestination===true||row?.unifiedRegistry?.dynamicDestination===true;}
// GV-RECS-BEAM-002 (FARE_MAP_BEAM_TARGET=on, off by default): a cost-only beam keeps the
// cheapest partial trips, so a C$10,000 search explores the same nearby, short trips as a
// C$4,000 one. With a target, half of each pick goes to the cheapest and half to the
// partial trips whose cost is closest to the share of the budget they should be using.
let beamTarget=null;
function pickDiverse(states,width){
 const chosen=[],uses=new Map(),remaining=states.slice();
 const targeted=beamTarget&&width>=4?Math.floor(width/2):0;
 const goal=st=>beamTarget.spendable*Math.min(1,st.cities.length/beamTarget.K)*beamTarget.share;
 while(chosen.length<width&&remaining.length){
  let best=0,bestScore=Infinity;const byTarget=chosen.length>=width-targeted;
  for(let i=0;i<remaining.length;i++){
   const state=remaining[i],repeat=state.cities.reduce((s,c)=>s+(uses.get(c.unifiedRegistry.cityId)||0)*75,0),score=(byTarget?Math.abs(state.cost-goal(state)):state.cost)+(state.preferencePenalty||0)+repeat;
   if(score<bestScore||score===bestScore&&state.key.localeCompare(remaining[best].key)<0){best=i;bestScore=score;}
  }
  const [next]=remaining.splice(best,1);chosen.push(next);for(const c of next.cities)uses.set(c.unifiedRegistry.cityId,(uses.get(c.unifiedRegistry.cityId)||0)+1);
 }
 return chosen;
}
// extra: big budgets may stay a few nights longer than a city's usual maximum (GV-BIG-BUDGET-001).
function stayLimits(row,extra=0){
 const d=row?.unifiedRegistry?.destination||{};
 return {min:Math.max(2,Number(d.minimumRecommendedNights)||2),max:Math.min(35,(Number(d.maximumRecommendedNights)||35)+extra)};
}
function stayValid(row,nights,extra=0){const {min,max}=stayLimits(row,extra);return nights>=min&&nights<=max;}
function fareValid(f,origin,month,now,maxAge){const t=Date.parse(f?.observedAt);return f?.origin===origin&&f.month===month&&/^[A-Z]{3}$/.test(f.destination||'')&&f.destination!==origin&&Number.isFinite(f.priceUsd)&&f.priceUsd>0&&f.source==='travelpayouts-cached'&&date(f.departureDate)&&f.departureDate.startsWith(month)&&f.departureDate>=new Date(now).toISOString().slice(0,10)&&Number.isFinite(t)&&t<=now+60000&&t>=now-maxAge;}
function makeTour(state,origin,budget,query,options={}){
 const stops=[];
 for(let i=0;i<state.cities.length;i++){
  const row=state.cities[i],start=state.edges[i].departureDate,end=state.edges[i+1].departureDate;
  const cost=accommodation.quote({cityId:row.unifiedRegistry.cityId,checkIn:start,checkOut:end,rooms:normalizeParty(query).rooms,
   quality:{minStars:Number(query.hotelMinStars)||null,minReviewScore:Number(query.hotelMinReviewScore)||null}},
   {provider:options.accommodationProvider,regionalNightlyUsd:graph._internal.nightlyUsd(row),now:options.now});
  if(!cost)return null;
  const stop=priceStopStay({...graph._internal.destinationRecord(row,days(start,end)),arrivalDate:start,departureDate:end,dateSource:'cached-departure-calendar-assumption',arrivalDateVerified:false,...(row.nuiteeMarket?{nuiteeSearchCity:row.nuiteeMarket.cityName}:{})},query,{nightlyPerRoomUsd:cost.nightlyPerRoomUsd+(cost.taxesAndFeesUsd||0)/(cost.rooms*cost.nights)});
  // Amortize known whole-stay fees into the planning rate so shared repricing retains them.
  stop.hotel.costEvidence=cost;stop.hotel.pricingIntegrity.partyStayTotalUsd=stop.hotel.estimatedStayUsd;
  stop.vibes=cityVibes(row.unifiedRegistry.cityId);stop.regionFamily=regionFamily(row);
  stops.push(stop);
 }
 const nodes=[origin,...stops,origin];
 const legs=state.edges.map((f,i)=>priceTransportLeg({legNumber:i+1,from:nodes[i],to:nodes[i+1],mode:'flight',transportType:'flight',departureDate:f.departureDate,dateLabel:f.departureDate,distanceKm:Math.round(legacy._internal.haversineKm(nodes[i],nodes[i+1])),durationMinutes:f.durationMinutes,estimateSource:'fare-map-cached-per-passenger',estimatedFlightUsd:f.priceUsd,estimatedTransportUsd:f.priceUsd,providerVerificationRequired:true,liveFareVerified:false,providerDateEvidence:{...(f.dateEstimated?{dateEstimated:true,basis:'month-cheapest-plus-buffer',monthCheapestUsd:f.monthCheapestUsd}:{}),source:'travelpayouts-cached',sourceType:'CACHED',provider:'travelpayouts',origin:f.origin,destination:f.destination,departureDate:f.departureDate,observedAt:f.observedAt,amountUsd:f.priceUsd,currency:'USD',appliedToEstimate:true,productionEligible:false,exactAirportMatch:false,providerBacked:false}},query,{unitAmountUsd:f.priceUsd}));
 const flights=legs.reduce((s,l)=>s+l.estimatedTransportUsd,0),hotels=stops.reduce((s,t)=>s+t.hotel.estimatedStayUsd,0),reserve=Math.round(budget*.10),total=flights+hotels;
 return attachTourPresentation({tourId:'gv-fare-map-'+state.key.replace(/[^A-Za-z0-9-]/g,'-'),origin,stops,legs,passengerPricing:normalizeParty(query),totalNights:stops.reduce((s,t)=>s+t.nights,0),tripDurationNights:days(state.edges[0].departureDate,state.edges.at(-1).departureDate),estimatedTotalUsd:total,totalFlightEstimateUsd:flights,totalTransportEstimateUsd:flights,totalHotelEstimateUsd:hotels,totalBudgetUsd:budget,reservePercent:.1,reserveAmountUsd:reserve,usableTripBudgetUsd:budget-reserve,amountLeftUsd:budget-reserve-total,affordabilityStatus:total<=budget-reserve?'within-protected-budget':'over-protected-budget',selectionSource:'fare-map-beam',pricingStatus:'cached-flight-and-estimated-hotel-planning',providerVerificationRequired:true,cityCount:stops.length,tripStory:tripStory(stops),regionFamilies:[...new Set(stops.map(s=>s.regionFamily))],routeExplanation:['Every flight on this route was seen in recent fare data; prices are checked live before the trip is shown.','Hotel nights conservatively cover the entire departure-to-departure interval. Actual arrival dates and hotel check-in must be verified before booking.','A 10% personal expense reserve remains protected.'],fareMap:{version:VERSION,...(state.cities.some(c=>c.expansionCandidate)?{expansionCandidate:true}:{}),completeCachedLegs:legs.length,mirroredReturn:!!state.edges.at(-1)?.mirrored,arrivalDatesVerified:false,hotelDatesRequireVerification:true,durationChoices:options.durationChoices||[days(state.edges[0].departureDate,state.edges.at(-1).departureDate)]},editableActions:{removeStop:false,replaceStop:true,addStop:false,reorderStops:false,undo:true}},query);
}
// Best use of the budget (GV-FAREMAP-BEST-USE-001). The site asks for three trips in
// parallel by role; each role gets its own route so the page can show three different trips.
// best-balance: the route that spends 80-95% of the spendable budget (headroom for live
// price drift), most nights first; when none reach 80%, the route closest to it.
// lowest-cost: the cheapest route. most-memorable: a route sharing the fewest cities.
// Real return dates always outrank estimated ones. Each role keeps two backup routes.
const USE_BAND=[.8,.95];
const routeKey=s=>s.cities.map(code).join('>');
const variantDates=s=>s.tour.legs.map(l=>l.departureDate).join('|');
function retainRouteVariants(complete,primary,spendable){
 const groups=new Map();
 for(const s of complete){
  const key=routeKey(s);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(s);
 }
 return [...groups].flatMap(([key,group])=>{
  const base=primary.get(key);
  if(group.length===1)return [base];
  const byCost=group.slice().sort((a,b)=>a.cost-b.cost||a.estimatedDate-b.estimatedDate||variantDates(a).localeCompare(variantDates(b)));
  const cheap=byCost[0];
  const useful=group.filter(s=>variantDates(s)!==variantDates(base)&&(
   s.tour.totalNights>=base.tour.totalNights+2||
   s.tour.legs[0].departureDate.slice(0,7)!==base.tour.legs[0].departureDate.slice(0,7)&&s.cost<=base.cost*1.1
  ));
  const experience=bestUseOrder(useful,spendable)[0];
  return [...new Map([base,cheap,experience].filter(Boolean).map(s=>[variantDates(s),s])).values()];
 });
}
function bestUseOrder(states,spendable){
 const use=s=>s.cost/spendable,inBand=s=>use(s)>=USE_BAND[0]&&use(s)<=USE_BAND[1];
 const nights=s=>Number(s.tour?.totalNights)||0;
 return states.slice().sort((a,b)=>a.estimatedDate-b.estimatedDate||inBand(b)-inBand(a)
  ||(inBand(a)&&inBand(b)?nights(b)-nights(a)||b.cost-a.cost:Math.abs(use(a)-USE_BAND[0])-Math.abs(use(b)-USE_BAND[0]))
  ||a.key.localeCompare(b.key));
}
// Three different trips (GV-THREE-OPTIONS-002): best use of the budget, the cheapest, and
// one from a different part of the world (Europe vs Latin America vs Asia) where possible.
// The optional "stretch" idea costs a little more than the spendable budget and buys a
// longer or bigger trip; the page offers it, never as a main pick.
const MAX_DETOUR=1.25;
// GV-ROUTE-001: the detour ratio alone missed trips that glue far-apart regions
// together (live, Nov 25: Toronto > Punta Cana > Vancouver > Manila scored 1.24).
// A trip is odd when one hop between its own cities is longer than MAX_SPREAD_KM,
// or when 3+ cities are all in different regions. FARE_MAP_MAX_SPREAD_KM changes
// the limit; 0 turns the check off.
const MAX_SPREAD_KM=4500;
let spreadLimitKm=MAX_SPREAD_KM;
// GV-RECS-READS-001 (FARE_MAP_READ_PLAN=on, big budgets only; off by default).
//   Shortlist: a first city is worth exploring when many other cities, in OTHER countries,
//   lie within a short hop (<= 1,800 km): onward potential, computed once from the
//   registry (no reads, no hardcoded places), so multi-country trips start where they can.
//   Read plan: the reads still unspent are shared across the depths still to come, and a
//   deeper state is kept only if its partitions fit that share (cached ones are free), so
//   the read limit is not used up by the second city and 3- and 4-city trips get read.
const ONWARD_KM=1800,ONWARD_CAP=12;let onwardCache=null;
function onwardPotential(rowList, alreadyEligible=false){
 if(onwardCache&&onwardCache.rows===rowList&&onwardCache.alreadyEligible===alreadyEligible)return onwardCache.map;
 const pts=(alreadyEligible?rowList:rowList.filter(eligible)).map(r=>({id:r.unifiedRegistry?.cityId,c:String(r.unifiedRegistry?.countryCode||r.unifiedRegistry?.country||'').toUpperCase(),lat:Number(r.unifiedRegistry?.latitude),lon:Number(r.unifiedRegistry?.longitude)})).filter(p=>p.id&&Number.isFinite(p.lat)&&Number.isFinite(p.lon));
 const map=new Map(),R=6371,rad=Math.PI/180;
 // Grid of 20-degree cells (about 2,200 km of latitude): each city only looks at its own and
 // neighbouring cells, so 10,000 cities stay fast (no all-pairs pass).
 const cell=(lat,lon)=>Math.floor((lat+90)/20)+':'+Math.floor((lon+180)/20),grid=new Map();
 for(const p of pts){const k=cell(p.lat,p.lon);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(p);}
 const near=a=>{const la=Math.floor((a.lat+90)/20),lo=Math.floor((a.lon+180)/20),out=[];for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const w=((lo+j)%18+18)%18;out.push(...(grid.get((la+i)+':'+w)||[]));}return out;};
 for(const a of pts){let n=0;const seen=new Set();for(const b of near(a)){if(b===a||b.c===a.c&&a.c)continue;const dl=(b.lat-a.lat)*rad,dn=(b.lon-a.lon)*rad,h=Math.sin(dl/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dn/2)**2;if(2*R*Math.asin(Math.sqrt(h))<=ONWARD_KM){n++;seen.add(b.c);}}
  map.set(a.id,{cities:Math.min(ONWARD_CAP,n),countries:seen.size});}
 onwardCache={rows:rowList,alreadyEligible,map};return map;
}
function routeShape(s){
 const pts=s.cities.map(c=>({latitude:c.unifiedRegistry.latitude,longitude:c.unifiedRegistry.longitude}));
 let spread=0;for(let i=1;i<pts.length;i++)spread=Math.max(spread,legacy._internal.haversineKm(pts[i-1],pts[i])||0);
 return {spreadKm:Math.round(spread),regions:new Set(s.cities.map(regionFamily)).size,size:s.cities.length};
}
function oddRoute(s){
 if(s.detour>MAX_DETOUR)return true;
 if(!(spreadLimitKm>0)||!s.cities||s.cities.length<2)return false;
 const r=routeShape(s);
 return r.spreadKm>spreadLimitKm||(r.size>=3&&r.regions===r.size);
}
function roleCandidates(ranked,spendable,extra={}){
 if(!ranked.length||!(spendable>0))return null;
 const key=routeKey,taken=new Set(),takenFams=new Set(),out={};
 const fams=s=>s.cities.map(regionFamily);
 const tag=(s,role,label)=>({...s.tour,tourRole:role,tourRoleLabel:label,fareMapRole:role,budgetUse:Number((s.cost/spendable).toFixed(3))});
 // Each role's main pick and backups are its own: when a live check fails, the backup
 // must not be another option's trip, or the page shows the same trip twice.
 const firsts=new Set(),inUse=new Set();
 // Sensible routes only (GV-ROUTE-SHAPE-001): a two-city trip that flies far past the
 // second city's direction and back (Fort Lauderdale > Vancouver from Toronto) is left
 // out while sensible routes exist.
 const sane=ranked.filter(s=>!oddRoute(s));if(sane.length)ranked=sane;
 // backup: when the preferred order has fewer than three unused trips, fill from it.
 const unique=order=>{const seen=new Set();return order.filter(s=>{const k=key(s);if(seen.has(k))return false;seen.add(k);return true;});};
 const take=(order,role,label,backup)=>{
  const fresh=unique([...order,...(backup||[])].filter(s=>!inUse.has(key(s))));
  const list=(fresh.length?fresh:unique(order)).slice(0,3);
  if(fresh.length){
   firsts.add(key(fresh[0]));taken.add(key(fresh[0]));fams(fresh[0]).forEach(f=>takenFams.add(f));list.forEach(s=>inUse.add(key(s)));
  }
  out[role]=list.map(s=>tag(s,role,label));
 };
 // Above about C$1,500 the main and "something different" picks go abroad when a trip
 // abroad fits (Lahore > Peshawar > Karachi is not what US$1,500 is for); a domestic
 // trip can still be the lowest-cost option.
 const abroad=s=>extra.originCountry&&s.cities.some(c=>String(c.countryCode||c.unifiedRegistry?.countryCode||'').toUpperCase()!==extra.originCountry);
 const wide=extra.preferAbroad&&ranked.some(abroad)?ranked.filter(abroad):ranked;
 take(bestUseOrder(wide,spendable),'best-balance','Best use of budget',bestUseOrder(ranked,spendable));
 take(extra.variants?ranked.slice().sort((a,b)=>a.cost-b.cost||a.estimatedDate-b.estimatedDate):ranked,'lowest-cost','Lowest cost');
 const used=new Map();for(const k of firsts)for(const c of k.split('>'))used.set(c,(used.get(c)||0)+1);
 const shared=s=>s.cities.reduce((n,c)=>n+(used.get(code(c))||0),0),newFam=s=>fams(s).some(f=>!takenFams.has(f))?0:1;
 const far=s=>extra.origin?-Math.max(...s.cities.map(c=>legacy._internal.haversineKm(extra.origin,{latitude:c.unifiedRegistry.latitude,longitude:c.unifiedRegistry.longitude})||0)):0;
 // Real dates first, then a new part of the world, no shared cities, a fuller trip, further away.
 const memorableOrder=list=>list.slice().sort((a,b)=>a.estimatedDate-b.estimatedDate||newFam(a)-newFam(b)||shared(a)-shared(b)||Math.abs(a.cost/spendable-.85)-Math.abs(b.cost/spendable-.85)||far(a)-far(b)||a.key.localeCompare(b.key));
 take(memorableOrder(wide),'most-memorable','Something different',memorableOrder(ranked));
 const stretch=(extra.stretch||[]).filter(s=>!inUse.has(key(s)));
 if(stretch.length){
  const best=bestUseOrder(ranked,spendable)[0],bestNights=Number(best?.tour?.totalNights)||0,bestCities=best?.cities.length||0;
  // Worth it only if it buys more: more nights or more cities than the best pick.
  const worth=stretch.filter(s=>s.cost-spendable>=20&&((Number(s.tour?.totalNights)||0)>bestNights||s.cities.length>bestCities));
  const order=worth.sort((a,b)=>b.cities.length-a.cities.length||(b.tour.totalNights-a.tour.totalNights)||a.cost-b.cost);
  if(order.length)out.stretch=order.slice(0,3).map(s=>({...tag(s,'stretch','A little more for a bigger trip'),stretchExtraUsd:Math.ceil(s.cost-spendable)}));
 }
  // Backups for the main pick when its own trips fail at real prices: the cheapest
  // trips not used by any option, including domestic and one-city trips.
 if(extra.fallbackPool){const fb=unique(extra.fallbackPool.filter(s=>!inUse.has(key(s))&&!oddRoute(s)).sort((a,b)=>a.estimatedDate-b.estimatedDate||a.cost-b.cost)).slice(0,3);if(fb.length)out.fallback=fb.map(s=>tag(s,'best-balance','Best use of budget'));}
 return out;
}
// Unified recommendation pool (GV-POOL-001): one search ranks every complete trip by a
// score, then picks a varied set of up to POOL_SIZE, each next trip the one that scores
// well and differs most from those already picked. The page shows three at a time and
// rotates through the rest on refresh. Weights are in POOL_WEIGHTS; all inputs are data
// the search already has (no extra reads or provider calls).
const POOL_SIZE=12;
const POOL_WEIGHTS={fit:.35,value:.25,reach:.15,character:.1,shape:.15,similarity:.6};
function tripFeatures(s,spendable,origin){
 const nights=Number(s.tour?.totalNights)||0,use=s.cost/spendable;
 const pts=s.cities.map(c=>({latitude:c.unifiedRegistry.latitude,longitude:c.unifiedRegistry.longitude}));
 const km=origin?Math.max(0,...pts.map(p=>legacy._internal.haversineKm(origin,p)||0)):0;
 const vibes=s.cities.reduce((n,c)=>n+cityVibes(c.unifiedRegistry.cityId).length,0);
 return {use,nights,nightsPerK:nights/Math.max(1,s.cost/1000),km,vibes,size:s.cities.length,
  families:new Set(s.cities.map(regionFamily)),cities:new Set(s.cities.map(code)),countries:new Set(s.cities.map(c=>String(c.unifiedRegistry?.countryCode||c.unifiedRegistry?.country||''))),month:String(s.edges?.[0]?.departureDate||s.tour?.legs?.[0]?.departureDate||'').slice(0,7)};
}
// GV-RECS-DIV-001 (FARE_MAP_POOL_DIVERSITY=on, off by default): also count shared countries
// and give the departure month more weight, so shown trips and refreshes vary more.
let poolDiversity=false;
// GV-RECS-ROTATE-001 (FARE_MAP_REFRESH_ROTATION=on; off by default): order the unseen pool
// trips for "Show other trips" so the next ones repeat as few cities, countries and
// departure months as possible from the trips already shown. seenKeys are the page's
// seenRoutes (city ids joined by ">"); their months and countries are read from the same
// search's pool (the page was shown from it). Only reorders: an unsuitable trip is never
// added, and when every trip overlaps the pool order still decides.
const ROTATE={city:6,country:2,month:1.5};
function rotateQueue(pool,seenKeys){
 const key=t=>(t?.stops||[]).map(s=>String(s.cityId||s.city||'').toLowerCase()).join('>');
 const seen=new Set([...(seenKeys||[])].map(k=>String(k).toLowerCase()));
 if(!seen.size)return pool.slice();
 const country=s=>String(s.countryCode||s.country||String(s.cityId||'').split('-').pop()||'').toUpperCase();
 const month=t=>String(t?.legs?.[0]?.departureDate||t?.backendLegs?.[0]?.departureDate||'').slice(0,7);
 const cities=new Set(),countries=new Map(),months=new Map();
 for(const k of seen)for(const id of k.split('>'))if(id){cities.add(id);const c=id.split('-').pop().toUpperCase();countries.set(c,(countries.get(c)||0)+1);}
 for(const t of pool)if(seen.has(key(t))){for(const s of t.stops||[]){const c=country(s);if(!countries.has(c))countries.set(c,1);}const m=month(t);if(m)months.set(m,(months.get(m)||0)+1);}
 return pool.map((t,i)=>({t,i,seen:seen.has(key(t))})).filter(x=>!x.seen).map(x=>{const st=x.t.stops||[];
  const score=x.i+ROTATE.city*st.filter(s=>cities.has(String(s.cityId||'').toLowerCase())).length+ROTATE.country*[...new Set(st.map(country))].reduce((n,c)=>n+Math.min(2,countries.get(c)||0),0)+ROTATE.month*Math.min(2,months.get(month(x.t))||0);
  return {...x,score};}).sort((a,b)=>a.score-b.score||a.i-b.i).map(x=>x.t);
}
function poolSimilarity(a,b){
 if([...a.cities].some(c=>b.cities.has(c)))return 1;
 let sim=0;if([...a.families].some(f=>b.families.has(f)))sim+=poolDiversity?.35:.5;if(a.month===b.month)sim+=poolDiversity?.35:.2;if(a.size===b.size)sim+=.1;
 if(poolDiversity&&a.countries&&[...a.countries].some(c=>b.countries.has(c)))sim+=.3;
 return Math.min(1,sim);
}
// A bounded alternative for flexible, high-budget searches. Reward a useful
// duration with diminishing returns and keep a separate penalty for uncertain returns.
function balancedPoolScore(s,x,quality){
 const fit=1-Math.min(1,Math.max(0,.78-x.use,x.use-.92)/.65);
 const duration=Math.min(1,x.nights/14)-Math.max(0,x.nights-21)/35;
 const shape=Math.min(1,x.size/3);
 const detour=Math.max(0,(s.detour||1)-1);
 const uncertainty=s.tour.fareMap?.mirroredReturn ? .23 : s.estimatedDate ? .09 : 0;
 return .42*fit+.16*duration+.09*quality.value+.10*quality.reach+.08*quality.character+.15*shape-.3*detour-uncertainty;
}
function buildPool(ranked,spendable,extra={}){
 const list=ranked.filter(s=>!oddRoute(s));
 const usable=list.length?list:ranked;
 if(!usable.length||!(spendable>0))return [];
 const f=usable.map(s=>tripFeatures(s,spendable,extra.origin));
 const span=(k,fn=x=>x)=>{const v=f.map(x=>fn(x[k]));const lo=Math.min(...v),hi=Math.max(...v);return x=>hi>lo?(fn(x)-lo)/(hi-lo):.5;};
 const nValue=span('nightsPerK'),nReach=span('km',x=>Math.log1p(x)),nChar=span('vibes');
 const W={...POOL_WEIGHTS,...(extra.weights||{})};
 const scored=usable.map((s,i)=>{const x=f[i];
  const fit=1-Math.min(1,Math.abs(x.use-.85)/.6);
  let shape=extra.bigBudget?Math.min(1,x.size/3+.1):extra.multiCity?(x.size>=2?1:.5):(x.size===1?1:.7);
  if(poolDiversity&&x.size>1)shape*=x.countries.size>1?1:.8; // prefer multi-country when it fits (spread rules keep it sensible)
  const value=nValue(x.nightsPerK),reach=nReach(x.km),character=nChar(x.vibes);
  const score=extra.balanced?balancedPoolScore(s,x,{value,reach,character}):
   W.fit*fit+W.value*value+W.reach*reach+W.character*character+W.shape*shape-(s.estimatedDate?.3:0);
  return {s,x,score:Number(score.toFixed(4)),parts:{fit:Number(fit.toFixed(3)),value:Number(nValue(x.nightsPerK).toFixed(3)),reach:Number(nReach(x.km).toFixed(3)),shape}};});
 const picked=[];let left=scored.slice().sort((a,b)=>b.score-a.score||a.s.key.localeCompare(b.s.key));
 while(picked.length<(extra.size||POOL_SIZE)&&left.length){
  let best=0,bestValue=-Infinity;
  for(let i=0;i<left.length;i++){const sim=picked.length?Math.max(...picked.map(p=>poolSimilarity(left[i].x,p.x))):0;const v=left[i].score-W.similarity*sim;if(v>bestValue+1e-9){bestValue=v;best=i;}}
  const [selected]=left.splice(best,1);
  picked.push(selected);
  if(extra.variants){const key=routeKey(selected.s);left=left.filter(p=>routeKey(p.s)!==key);}
 }
 return picked.map((p,i)=>({...p.s.tour,poolRank:i+1,poolScore:p.score,budgetUse:Number(p.x.use.toFixed(3)),cityCount:p.x.size,
  // A big budget's trip that leaves much unspent may upgrade its hotels in the live step.
  poolUpgrade:!!extra.bigBudget&&p.x.use<.75}));
}

function candidateEvidence(s,stayExtra){
 const tour=s.tour;
 return {route:s.cities.map(code).join('>'),dates:tour.legs.map(l=>l.departureDate),returnDate:s.estimatedDate?'estimated':'cached',
  mirroredReturn:!!tour.fareMap.mirroredReturn,nights:tour.totalNights,planningUsd:tour.estimatedTotalUsd,safeUsd:s.cost,
  flightUsd:tour.totalFlightEstimateUsd,hotelUsd:tour.totalHotelEstimateUsd,detour:s.detour,odd:oddRoute(s),
  stops:tour.stops.map((stop,i)=>({city:stop.city,country:stop.countryCode,nights:stop.nights,stayLimits:stayLimits(s.cities[i],stayExtra)}))};
}

async function search(query={},options={}){
 spreadLimitKm=(()=>{const v=String((options.env||process.env).FARE_MAP_MAX_SPREAD_KM??'').trim();return v===''?MAX_SPREAD_KM:Math.max(0,Number(v)||0);})();
 const env=options.env||process.env;
 if(!enabled(env))return {ok:true,supported:false,reason:'feature-disabled',requiredFlag:FLAG+'=true',tours:[]};
 const diagnostics={engine:VERSION,reads:0,examinedEdges:0,completeRoutes:0,expandedPairs:0,eligibleCities:0,cacheHits:0,rejectedFares:0,rejectedRules:0,bounded:false,liveProviderCallsMade:0};
 const trace=options.traceSearch?(diagnostics.searchTrace={depths:[],completed:[],completedOmitted:0}):null;
 let step=null,blockedReads=null;
 const reject=reason=>{if(step)step.rejected[reason]=(step.rejected[reason]||0)+1;};
 let requested=null,result_roleCandidates=null,result_pool=null;
 const response=(tours,reason)=>({ok:true,supported:true,version:VERSION,mode:'guarded-planning-estimate',requested,tours,...(result_roleCandidates?{roleCandidates:result_roleCandidates}:{}),...(result_pool?{pool:result_pool}:{}),reason:reason||null,presentationPolicy:presentationPolicy(),pricingPolicy:{flights:'fare-map-cached-estimates',hotels:'accommodation-cost-map-planning-evidence',providerVerificationRequiredBeforeBooking:true,liveProviderCallsMade:0},diagnostics});
 if(!store.tableName(env)&&!options.readRoutes)return response([],'fare-map-not-configured');
 const origin=graph.resolveAnyOrigin(query.origin||query.originCode);
 if(!origin)throw new legacy.MultiCityValidationError('INVALID_ORIGIN','Please enter a supported origin city or airport.');
 if(origin.gatewayAirport)return response([],'origin-gateway-not-supported-in-two-stop-mvp');
 const currency=String(query.currency||'USD').toUpperCase();
 if(!['USD','CAD','AUD','EUR','GBP'].includes(currency)||!Number.isFinite(Number(query.budgetUsd??query.budget))||Number(query.budgetUsd??query.budget)<=0)throw new legacy.MultiCityValidationError('INVALID_BUDGET','Provide a positive budget in a supported currency.');
 // Up to K cities; maxStops lowers it, destinationCount asks for exactly that many.
 // Big budgets (about C$4,000+, GV-BIG-BUDGET-001): up to 3 cities and stays up to 3
 // nights past each city's usual maximum, so the money buys a bigger trip.
 // FARE_MAP_BIG_BUDGET=off turns this off; an explicit FARE_MAP_MAX_CITIES still caps it.
 const budgetUsdForShape=legacy._internal.normalizeBudgetUsd(query),bigBudget=bigBudgetOn(env)&&budgetUsdForShape>=BIG_BUDGET_FROM_USD&&!query.destinationCount&&!query.nights;
 const capK=bigBudget&&!env.FARE_MAP_MAX_CITIES?(Number(env.FARE_MAP_HUGE_MAX_CITIES)===4&&budgetUsdForShape>=(Number(env.FARE_MAP_HUGE_FROM_USD)||5000)?4:3):maxCities(env),askedMax=Number(query.maxStops??query.stops),exact=Number(query.destinationCount)||null;
 // GV-RECS-SHAPE-001 study settings (off by default): longer stays for big budgets
 // (FARE_MAP_BIG_STAY_EXTRA, default 3) and a 4th city from FARE_MAP_HUGE_FROM_USD (default
 // 5,000) with FARE_MAP_HUGE_MAX_CITIES=4.
 const huge=bigBudget&&budgetUsdForShape>=(Number(env.FARE_MAP_HUGE_FROM_USD)||5000);
 const stayExtra=bigBudget?Math.min(14,Math.max(0,Number(env.FARE_MAP_BIG_STAY_EXTRA??3)||0)):0;
 const K=exact?exact:Number.isInteger(askedMax)&&askedMax>=1?Math.min(capK,askedMax):capK,minCities=exact||1;
 if(K<1||K>capK)return response([],'destination-count-not-supported');
 const preferred=(Array.isArray(query.preferredStops)?query.preferredStops:String(query.preferredStops||'').split(',')).map(x=>String(x).trim().toLowerCase()).filter(Boolean);
 if(preferred.length>K)return response([],'destination-count-not-supported');
 const durations=durationChoices(query),nights=Math.max(...durations),
  // One cached date per city pair per month: an exact-length match is rare, so flexible
  // searches accept any length in the range; an explicit night count stays exact.
  durationOk=n=>durations.length===1?n===durations[0]:n>=Math.min(...durations)&&n<=nights,budget=legacy._internal.normalizeBudgetUsd(query),party=normalizeParty(query);
 if(!Number.isFinite(budget)||budget<=0)return response([],'invalid-fx-configuration');
 requested={origin,budgetUsd:budget,reservePercent:.1,reserveAmountUsd:Math.round(budget*.1),usableTripBudgetUsd:budget-Math.round(budget*.1),totalNights:durations.length===1?nights:null,durationChoices:durations,maxStops:K,theme:query.theme||query.preference||null,displayBudget:buildDisplayBudget({query,totalBudgetUsd:budget,reservePercent:.1,tripUsd:0})};
 const now=options.now??Date.now(),clock=options.clock||Date.now,started=clock(),timeBudget=Math.min(5000,options.timeBudgetMs||DEFAULT_TIME_BUDGET_MS),deadline=started+timeBudget;
 const today=new Date(now).toISOString().slice(0,10),horizon=sixMonthsAfter(today);
 const explicitMonth=query.month||query.departureMonth;
 if(explicitMonth&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(explicitMonth))throw new legacy.MultiCityValidationError('INVALID_DATE','Use YYYY-MM.');
 if(query.departureDate&&!date(query.departureDate)||query.returnDate&&!date(query.returnDate))throw new legacy.MultiCityValidationError('INVALID_DATE','Explicit travel dates must be valid.');
 const start=query.departureDate||explicitMonth&&explicitMonth+'-01'||today;
 const end=query.departureDate?plus(start,1):horizon;
 // A requested month narrows the window; default searches the entire rolling six months.
 const monthEnd=explicitMonth?new Date(Date.UTC(Number(explicitMonth.slice(0,4)),Number(explicitMonth.slice(5,7)),1)).toISOString().slice(0,10):null;
 const earliest=query.departureDate?today:plus(today,minLeadDays(env)),windowStart=start>earliest?start:earliest,windowEnd=[horizon,query.departureDate?end:monthEnd||horizon].sort()[0];
 requested.departureWindow={start:windowStart,endExclusive:windowEnd};
 if(windowStart>=windowEnd)return response([],'departure-window-outside-six-month-horizon');
 const firstMonths=months(windowStart,plus(windowEnd,-1));
 const all=options.rows||rows();
 const isDestination=r=>code(r)&&r.unifiedRegistry.cityId!==origin.cityId&&!(r.unifiedRegistry.origin?.airportCodes||[]).includes(origin.airportCode);
 const candidates=all.filter(r=>eligible(r)&&isDestination(r));
 const map=new Map();for(const r of candidates)if(!map.has(code(r)))map.set(code(r),r);
 // The generated-tour path verifies live prices; estimate-only callers keep their current scope.
 const expand=options.allowCityExpansion===true&&cityExpansion.enabled(env);
 if(expand){
  const review=cityExpansion.reviewExpansion(undefined,{includeLegacyRecovery:true});
  diagnostics.expansionEligibleCities=0;
  for(const r of all){
   // Legacy activation reflects the old provider audit. Expansion candidates use the
   // reviewed direct-market evidence and must pass the generated tour's live checks.
   if(!directRegistryDestination(r)||r.registryDestinationEligible!==true||!isDestination(r)||map.has(code(r)))continue;
   const admitted=cityExpansion.admit(r,review);
   if(admitted){map.set(code(r),admitted);diagnostics.expansionEligibleCities++;}
  }
 }
 diagnostics.eligibleCities=map.size;
 const dynamic=dynamicEnabled(env),dynMinRoutes=dynamicSetting(env,'FARE_MAP_DYNAMIC_MIN_ROUTES',15,1,500),dynMax=dynamicSetting(env,'FARE_MAP_DYNAMIC_MAX_PER_TRIP',1,0,4),dynMargin=dynamicSetting(env,'FARE_MAP_DYNAMIC_HOTEL_MARGIN',1.15,1,2);
 const routeCounts=new Map();
 if(dynamic&&dynMax>0){let n=0;for(const r of (options.dynamicRows||dynamicRows(all))){const c=code(r);if(!c||map.has(c)||r.unifiedRegistry.cityId===origin.cityId||(r.unifiedRegistry.origin.airportCodes||[]).includes(origin.airportCode))continue;map.set(c,r);n++;}diagnostics.dynamicCandidates=n;}
 const originRow=originRegistryRow(all,origin);
 // The site sends "All continents"; that and similar wording mean no region filter.
 const regionFilter=anyRegion(query.region)?null:String(query.region).trim().toLowerCase();
 const originCode=code(originRow)||origin.airportCode,cache=new Map();
 // Flights home can be filed under the city code (YMQ) while searches start from the
 // airport row (YUL), or the reverse; any of the origin's codes counts as home.
 const homeCodes=new Set([originCode,origin.airportCode,String(origin.cityId||'').replace(/^global-city-/,'').toUpperCase(),...(originRow?.unifiedRegistry?.origin?.airportCodes||[])].filter(Boolean));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeBudget);
 const read=options.readRoutes||((o,m)=>store.readRoutesFrom(o,m,{env,dynamo:options.dynamo,abortSignal:controller.signal,maxPages:2,limit:1000,nowMs:now,includeDated:true,diagnostics}));
 // GV-DATA-READS-001: FARE_MAP_MAX_READS (default 96, 32-256) and FARE_MAP_MAX_AGE_DAYS
 // (default 3, 1-14) are study settings: fares the latest pass did not refresh stay in
 // the table for 14 days (TTL); a 3-day limit drops them even when still useful.
 const maxReads=dynamicSetting(env,'FARE_MAP_MAX_READS',MAX_READS,32,256),maxAgeMs=dynamicSetting(env,'FARE_MAP_MAX_AGE_DAYS',3,1,14)*day;
 let readCeiling=Math.min(maxReads,options.maxReads||maxReads);
 const maxEdges=Math.min(100000,options.maxEdges||100000);
 const stopped=()=>{
  const reason=controller.signal.aborted||clock()>=deadline?'time-limit':diagnostics.examinedEdges>=maxEdges?'edge-limit':null;
  if(!reason)return false;
  diagnostics.bounded=true;
  if(step)step.stoppedBy=reason;
  return true;
 };
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
  if(diagnostics.reads>=readCeiling){diagnostics.bounded=true;if(blockedReads)blockedReads.add(key);return []}
  diagnostics.reads++;
  const work=(async()=>{
   let value;
   try{value=await cancellableRead(o,m)}catch{diagnostics.readErrors=(diagnostics.readErrors||0)+1;reject('read-error');value=[]}
   if(Array.isArray(value)&&value.length>1000){diagnostics.bounded=true;diagnostics.truncatedPartitions=(diagnostics.truncatedPartitions||0)+1;reject('partition-row-limit');}
   const valid=(Array.isArray(value)?value:[]).slice(0,1000).filter(f=>{const valid=fareValid(f,o,m,now,Math.min(14*day,options.maxAgeMs||maxAgeMs));if(!valid){diagnostics.rejectedFares++;reject('invalid-or-stale-fare');}return valid});
   if(valid.length)routeCounts.set(o,Math.max(routeCounts.get(o)||0,new Set(valid.map(f=>f.destination)).size));
   cache.set(key,valid);return valid;
  })();
  pending.set(key,work);try{return await work}finally{pending.delete(key)}
 }
 async function fares(o,ms){return (await Promise.all(ms.map(m=>partition(o,m)))).flat();}
  function completeRoute(state,fare,first){
      if(!homeCodes.has(fare.destination)||!durationOk(days(first,fare.departureDate))||query.returnDate&&fare.departureDate!==query.returnDate){reject('return-date-or-trip-duration');return false;}
      if(preferred.some(id=>!state.cities.some(c=>c.unifiedRegistry.cityId.toLowerCase()===id))){reject('missing-preferred-stop');return false;}
      const dyn=state.cities.filter(isDynamic);
      if(dyn.length){
       if(dyn.length>dynMax||fare.mirrored||dyn.some(c=>(routeCounts.get(code(c))||0)<dynMinRoutes)){diagnostics.dynamicRejected=(diagnostics.dynamicRejected||0)+1;reject('discovered-city-rule');return false;}
      }
      diagnostics.completeRoutes++;
      const candidate={...state,edges:[...state.edges,fare]};const tour=makeTour(candidate,origin,budget,query,{...options,now,durationChoices:durations});
      if(!tour){diagnostics.missingHotelEvidence=(diagnostics.missingHotelEvidence||0)+1;reject('missing-hotel-evidence');return false;}
      if(state.cities.length<minCities){reject('requested-city-count');return false;}
      // Safe cost: flights plus hotels at the live-price margin; used to choose and rank.
      // A city with learned real-vs-model hotel prices (GV-HOTEL-MEMORY-001) uses its own
      // ratio, plus 5%, instead of the general margin.
      const hotelFor=stop=>{const est=Number(stop?.hotel?.estimatedStayUsd)||0,mem=memoryLevel(options.hotelRatios,stop,regionLevels,env,memRule);
       let level;if(mem){const k=mem.kind==='learned'?'learnedHotelCities':'legacyHotelCities';diagnostics[k]=(diagnostics[k]||0)+1;level=mem.level;}
       else{const reg=regionLevels.get(stop?.regionFamily);if(reg&&Number.isFinite(reg.ratio)){diagnostics.regionHotelCities=(diagnostics.regionHotelCities||0)+1;level=Math.max(1,reg.ratio);}else level=margin;}
       const shape=stayShape(options.priceIndex,stop);if(shape!=null)diagnostics.priceIndexStays=(diagnostics.priceIndexStays||0)+1;
       const dynLevel=String(stop?.cityId||'').startsWith('discovered-')?dynMargin:1;
       return est*level*(shape??1)*dynLevel;};
      const stopHotels=(tour.stops||[]).reduce((n,stop)=>n+hotelFor(stop),0);
      const safeCost=Math.round(tour.totalFlightEstimateUsd+(stopHotels>0?stopHotels:tour.totalHotelEstimateUsd*margin));
      if(safeCost>tour.usableTripBudgetUsd){
       // Over budget: remember the cheapest (to say what budget would work) and keep
       // trips a little over as the optional "+ a bit more" idea; never a main pick.
       diagnostics.overBudgetRoutes=(diagnostics.overBudgetRoutes||0)+1;reject('protected-budget');
       if(!(cheapestOverUsd<=safeCost))cheapestOverUsd=safeCost;
       if(safeCost<=tour.usableTripBudgetUsd+stretchUsd&&!fare.dateEstimated){const ev=evaluateTour(tour,query);if(ev.accepted&&!recommendationEligibility(ev.tour,query).hardBlocked){stretchPool.push({estimatedDate:false,cities:state.cities,cost:safeCost,key:state.key,tour:{...ev.tour,fareMap:tour.fareMap}});if(stretchPool.length>64)stretchPool=stretchPool.sort((a,b)=>(b.tour.totalNights-a.tour.totalNights)||a.cost-b.cost).slice(0,32);}}
       return false;
      }
      const evaluated=evaluateTour(tour,query),eligibility=evaluated.accepted?recommendationEligibility(evaluated.tour,query):null;
       if(!evaluated.accepted||eligibility?.hardBlocked){
        diagnostics.rejectedRules++;
        if(step)for(const reason of evaluated.reasons?.length?evaluated.reasons:['recommendation-eligibility'])reject(reason);
        return false;
       }
      const comfortPenalty=String(query.flightComfort||'').toLowerCase()==='comfortable'?candidate.edges.reduce((sum,f)=>sum+(Number.isFinite(f.stops)?f.stops*25:25)+(Number.isFinite(f.durationMinutes)?f.durationMinutes/60:12),0):0;
      const qualityPenalty=tour.stops.reduce((sum,s)=>sum+(s.hotel.costEvidence.quality.verified?-(s.hotel.costEvidence.quality.reviewScore||0)*2:0),0);
      tour.fareMap.scoreEvidence={costUsd:tour.estimatedTotalUsd,comfortPenalty,hotelQualityPenalty:qualityPenalty,unknownFlightComfort:candidate.edges.some(f=>f.stops==null||f.durationMinutes==null)};
      // Flown distance compared with going out and back to the furthest city: 1.0 is a
      // clean loop, Lisbon > Munich from Toronto about 1.1, a zigzag 1.4 or more.
      const pts=[origin,...state.cities.map(c=>({latitude:c.unifiedRegistry.latitude,longitude:c.unifiedRegistry.longitude})),origin],hk=(a,b)=>legacy._internal.haversineKm(a,b)||0;
      const flown=pts.slice(1).reduce((n,p,i)=>n+hk(pts[i],p),0),far=Math.max(...pts.slice(1,-1).map(p=>hk(origin,p)));
      const detour=state.cities.length>1&&far>0?Number((flown/(2*far)).toFixed(2)):1;
      if(dyn.length)diagnostics.dynamicTrips=(diagnostics.dynamicTrips||0)+1;
      const finished={detour,estimatedDate:!!fare.dateEstimated,cities:state.cities,cost:safeCost,preferencePenalty:comfortPenalty+qualityPenalty+(state.preferencePenalty||0),key:state.key,tour:{...evaluated.tour,fareMap:tour.fareMap}};
       complete.push(finished);
       if(trace){
        step.accepted++;
        if(trace.completed.length<2048)trace.completed.push(candidateEvidence(finished,stayExtra));
        else trace.completedOmitted++;
       }
      // Keep cheap, diverse routes and the routes that use the budget best, per trip
      // size, so many cheap one-city trips never crowd out the two-city ones.
      const size=state.cities.length;
      if(complete.filter(x=>x.cities.length===size).length>128){reject('complete-route-compaction');const same=complete.filter(x=>x.cities.length===size),keep=pickDiverse(same,48),ids=new Set(keep.map(x=>x.key+'|'+x.cost));complete=[...complete.filter(x=>x.cities.length!==size),...keep,...bestUseOrder(same.filter(x=>!ids.has(x.key+'|'+x.cost)),budget-Math.round(budget*.1)).slice(0,16)];}
      return true;
  }
 let beam=[{cities:[],edges:[],lastCode:originCode,cost:0,key:originCode}],complete=[],stretchPool=[],cheapestOverUsd=null;
 // How far over the spendable budget the optional bigger-trip idea may go (about C$100-200).
 const margin=hotelMargin(env);diagnostics.hotelMargin=margin;
 const memRule=legacyRule(env);
 const regionLevels=regionRatios(options.hotelRatios,all,env);
 poolDiversity=String(env.FARE_MAP_POOL_DIVERSITY||'').trim().toLowerCase()==='on';
 const readPlan=bigBudget&&K>=3&&String(env.FARE_MAP_READ_PLAN||'').trim().toLowerCase()==='on',onward=readPlan?(expand?onwardPotential([...map.values()],true):onwardPotential(all)):null;diagnostics.readPlan=readPlan;
 beamTarget=String(env.FARE_MAP_BEAM_TARGET||'').trim().toLowerCase()==='on'&&!query.nights?{spendable:budget-Math.round(budget*.1),K,share:.85}:null;diagnostics.regionHotelLevels=Object.fromEntries([...regionLevels].map(([k,v])=>[k,v.ratio]));
 const stretchUsd=Math.round(Math.min(150,Math.max(70,budget*.12)));
 const homeLinked=new Set(),outboundFrom=new Map();
 try {
  for(let depth=0;depth<=K&&beam.length;depth++){
    if(trace){
     step={depth,input:beam.length,readsBefore:diagnostics.reads,edgesBefore:diagnostics.examinedEdges,accepted:0,rejected:{}};
     trace.depths.push(step);
     blockedReads=new Set();
    }
    const readLimit=Math.min(maxReads,options.maxReads||maxReads);
   readCeiling=depth===K-1&&K>1?Math.max(diagnostics.reads,readLimit-Math.min(32,Math.floor(readLimit/3))):readLimit;
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
     if(depth===0){homeLinked.add(fare.destination);const o=outboundFrom.get(fare.destination);if(!o||fare.priceUsd<o.priceUsd)outboundFrom.set(fare.destination,fare);}
     if(depth===0&&query.departureDate&&fare.departureDate!==query.departureDate){reject('requested-departure-date');continue;}
     if(depth===0&&(fare.departureDate<windowStart||fare.departureDate>=windowEnd)){reject('departure-window');continue;}
     const first=depth?state.edges[0].departureDate:fare.departureDate;
     if(days(first,fare.departureDate)>nights){reject('maximum-trip-duration');continue;}
     const goingHome=depth>=1&&homeCodes.has(fare.destination);
     if(goingHome){diagnostics.returnFares=(diagnostics.returnFares||0)+1;if(!state.returnSeed||fare.priceUsd<state.returnSeed.priceUsd)state.returnSeed=fare;}
     if(depth){const previous=state.edges.at(-1),transitDays=Math.max(1,Math.ceil((previous.durationMinutes||0)/1440));if(!stayValid(state.cities.at(-1),days(previous.departureDate,fare.departureDate)-transitDays,stayExtra)){if(goingHome)diagnostics.returnStayRejected=(diagnostics.returnStayRejected||0)+1;reject(goingHome?'return-stay-limit':'onward-stay-limit');continue;}}
     // A flight home after any city completes a trip of that many cities.
     if(goingHome){if(completeRoute(state,fare,first))state.completed=true;continue;}
     if(depth===K){reject('maximum-city-count');continue;}
     const row=map.get(fare.destination);if(!row||homeCodes.has(fare.destination)||state.cities.some(c=>code(c)===fare.destination)){reject('ineligible-or-repeated-city');continue;}
     if(isDynamic(row)&&state.cities.filter(isDynamic).length>=dynMax){reject('discovered-city-limit');continue;}
     if(depth===1)diagnostics.expandedPairs++;
     const record=row.unifiedRegistry;
     if(preferred.length===2&&!preferred.includes(record.cityId.toLowerCase()))continue;
     if(regionFilter&&String(record.worldRegion).toLowerCase()!==regionFilter)continue;
     const hotel=depth?(options.accommodationProvider?0:graph._internal.nightlyUsd(state.cities.at(-1)))*party.rooms*days(state.edges.at(-1).departureDate,fare.departureDate):0;
     const cost=state.cost+Math.round(fare.priceUsd*party.flightFareUnits)+hotel;
     if(cost>budget*.9){reject('partial-protected-budget');continue;}
     const theme=String(query.theme||query.preference||'').toLowerCase(),fit=themeScore(row,theme);
     const onwardBonus=readPlan&&depth===0?(()=>{const o=onward.get(record.cityId);return o?Math.round(budget*.012*Math.min(ONWARD_CAP,o.cities)*Math.min(1,o.countries/3)):0})():0;
     next.push({preferencePenalty:([ ...state.cities,row ].some(c=>preferred.includes(c.unifiedRegistry.cityId.toLowerCase()))?-budget:0)-fit*20-onwardBonus,cities:[...state.cities,row],edges:[...state.edges,fare],lastCode:fare.destination,cost,key:state.key+'>'+record.cityId+'@'+fare.departureDate});
    }
    // No cached fare home from this city (Montreal's data often has none): use the
    // fare out to it as a stand-in for the way back. The trip is live-checked on the
    // exact return date before it is shown, so a missing return flight rules it out.
    if(depth>=1&&!state.completed&&!state.returnSeed){const out=outboundFrom.get(state.lastCode);if(out){state.returnSeed={...out,origin:state.lastCode,destination:originCode,mirrored:true};diagnostics.mirroredReturnSeeds=(diagnostics.mirroredReturnSeeds||0)+1;}}
    if(depth>=1&&!state.completed&&!state.returnSeed&&typeof options.routeDates==='function'){const r=(options.routeDates(state.lastCode,originCode)||[]).filter(x=>Number(x.priceUsd)>0).sort((a,b)=>a.priceUsd-b.priceUsd)[0];if(r)state.returnSeed={origin:state.lastCode,destination:originCode,month:r.departureDate.slice(0,7),departureDate:r.departureDate,priceUsd:r.priceUsd,stops:r.stops??null,durationMinutes:null,source:'route-dates'};}
    if(depth>=1&&!state.completed&&state.returnSeed&&!stopped()){
     // The fare map keeps one cheapest date per pair and month, so the cached return date
     // rarely fits the stay. Plan the return inside the city's recommended stay instead,
     // priced from that month's cheapest fare plus a buffer, and label it an estimate;
     // the selected trip is live-checked on these exact dates before it is verified.
     const previous=state.edges.at(-1),seed=state.returnSeed,first=state.edges[0].departureDate,d=state.cities.at(-1)?.unifiedRegistry?.destination||{};
     const transit=Math.max(1,Math.ceil((previous.durationMinutes||0)/1440)),lo=Math.max(2,Number(d.minimumRecommendedNights)||2),hi=Math.min(35,(Number(d.maximumRecommendedNights)||35)+stayExtra);
     // GV-DATA-DATES-001: with real departure dates for the way home (options.routeDates,
     // e.g. Travelpayouts month-matrix), use the cached date that best fits the stay at its
     // own price, before falling back to an estimated date.
     const real=typeof options.routeDates==='function'?(options.routeDates(state.lastCode,originCode)||[]):[];
     if(real.length){const mid=(lo+hi)/2;let done=false;
      const fits=real.map(r=>({...r,n:days(previous.departureDate,r.departureDate)-transit})).filter(r=>r.n>=lo&&r.n<=hi&&r.departureDate<horizon&&durationOk(days(first,r.departureDate))&&(!query.returnDate||r.departureDate===query.returnDate)&&Number(r.priceUsd)>0)
       .sort((a,b)=>Math.abs(a.n-mid)-Math.abs(b.n-mid)||a.priceUsd-b.priceUsd).slice(0,3);
      for(const r of fits){diagnostics.realReturnDates=(diagnostics.realReturnDates||0)+1;
       if(completeRoute(state,{...seed,mirrored:false,month:r.departureDate.slice(0,7),departureDate:r.departureDate,priceUsd:Math.round(r.priceUsd),stops:r.stops??seed.stops,dateEstimated:false,datedSource:'route-dates'},first)){done=true;break;}}
      if(done)continue;}
     for(const n of [Math.round((lo+hi)/2),lo,hi]){
      const ret=plus(previous.departureDate,transit+n);
      if(!seed.mirrored&&ret.slice(0,7)!==seed.departureDate.slice(0,7)||ret>=horizon||!durationOk(days(first,ret))||query.returnDate&&ret!==query.returnDate)continue;
      diagnostics.estimatedReturnDates=(diagnostics.estimatedReturnDates||0)+1;
      if(options.returnPairs)options.returnPairs.add(state.lastCode+'>'+originCode+'@'+ret.slice(0,7));
      if(completeRoute(state,{...seed,month:ret.slice(0,7),departureDate:ret,priceUsd:Math.round(seed.priceUsd*(seed.mirrored?1.5:1.3)),monthCheapestUsd:seed.priceUsd,dateEstimated:true},first))break;
     }
    }
   }
   const width=Math.min(64,Math.max(7,options.beamWidth||32));
   if(depth===K-1&&K>1){
    // The return leg needs the second city's partitions. Under a fixed read budget, keep
    // routes whose second city was already read as a first stop (cache hits) alongside new ones.
    const cachedReturn=s=>months(s.edges.at(-1).departureDate,plus(s.edges[0].departureDate,nights)).every(m=>cache.has(s.lastCode+'#'+m));
    // Then prefer second cities the origin itself flies to: a route out almost always
    // has one back, while far-flung cities often have no fare home (Montreal: 0 of 13).
    const connected=st=>homeLinked.has(st.lastCode);
    // A second city already read as a first stop shows whether it has a fare home:
    // keep those that do, drop those that cannot complete a trip (LAX has no YMQ fare).
    const returnMonths=st=>months(st.edges.at(-1).departureDate,plus(st.edges[0].departureDate,nights));
    const homeKnown=st=>returnMonths(st).some(m=>(cache.get(st.lastCode+'#'+m)||[]).some(f=>homeCodes.has(f.destination)));
    const warm=next.filter(st=>cachedReturn(st)&&homeKnown(st)),cold=next.filter(st=>!cachedReturn(st));
    diagnostics.secondCitiesWithoutHome=next.length-warm.length-cold.length;
    const warmPick=temporalBeam(warm,Math.min(warm.length,Math.ceil(width*.75)));
    const coldLinked=cold.filter(connected),coldOther=cold.filter(st=>!connected(st));
    const linkedPick=temporalBeam(coldLinked,Math.min(coldLinked.length,Math.max(0,width-warmPick.length)));
    beam=[...warmPick,...linkedPick,...temporalBeam(coldOther,Math.max(0,width-warmPick.length-linkedPick.length))];
   } else beam=depth===0?familyBeam(next,width):temporalBeam(next,width);
   if(step)step.afterBeam=beam.length;
   if(readPlan&&depth<K&&beam.length){
    const nd=depth+1,left=Math.max(0,Math.min(MAX_READS,options.maxReads||MAX_READS)-diagnostics.reads),share=nd>=K?left:Math.floor(left/(K-nd+1));
    const need=st=>months(st.edges.at(-1).departureDate,plus(st.edges[0].departureDate,nights)).map(m=>st.lastCode+'#'+m).filter(k=>!cache.has(k));
    const planned=new Set(),kept=[];
    for(const st of beam){const n=need(st).filter(k=>!planned.has(k));if(planned.size+n.length<=share){n.forEach(k=>planned.add(k));kept.push(st);}}
    if(step)step.readPlan={share,planned:planned.size,dropped:beam.length-kept.length};
    diagnostics.readPlanDropped=(diagnostics.readPlanDropped||0)+beam.length-kept.length;beam=kept;
   }
   if(step){
    Object.assign(step,{readCeiling,readsAfter:diagnostics.reads,edgesAfter:diagnostics.examinedEdges,blockedPartitions:blockedReads.size,
     generated:next.length,retained:beam.length,discarded:next.length-beam.length,
     stopReason:step.stoppedBy||(depth===K?'maximum-city-depth':beam.length?'advance':'beam-exhausted')});
   }
   diagnostics.peakRetainedComplete=Math.max(diagnostics.peakRetainedComplete||0,complete.length);
  }
 }finally{clearTimeout(timer)}
 if(controller.signal.aborted)diagnostics.bounded=true;
 const distinct=new Map();for(const s of complete){const key=routeKey(s);const old=distinct.get(key);if(!old||old.estimatedDate&&!s.estimatedDate||old.estimatedDate===s.estimatedDate&&s.cost+s.preferencePenalty<old.cost+old.preferencePenalty)distinct.set(key,s);}
 const spendable=requested.usableTripBudgetUsd;
 const variants=String(env.FARE_MAP_ROUTE_VARIANTS||'').trim().toLowerCase()==='on';
 const retained=variants?retainRouteVariants(complete,distinct,spendable):[...distinct.values()];
 if(trace){
  trace.termination=step?.stoppedBy||step?.stopReason||'no-search';
  trace.beforeDedup=complete.map(s=>candidateEvidence(s,stayExtra));
  trace.afterDedup=retained.map(s=>candidateEvidence(s,stayExtra));
 }
 const allRanked=[...distinct.values()].sort((a,b)=>a.estimatedDate-b.estimatedDate||a.cost-b.cost||a.key.localeCompare(b.key));
 const multiFirst=!exact&&K>=2&&budget>=MULTI_CITY_FROM_USD&&allRanked.some(s=>s.cities.length>=2);
 diagnostics.multiCityFirst=multiFirst;
 const ranked=multiFirst?allRanked.filter(s=>s.cities.length>=2):allRanked,cheapest=ranked[0];
 const alternatives=cheapest?ranked.slice(1).map(s=>({...s,preferencePenalty:(s.preferencePenalty||0)+s.cities.reduce((sum,c)=>sum+(cheapest.cities.some(x=>code(x)===code(c))?75:0),0)})):[];
 const picked=(cheapest?[cheapest,...pickDiverse(alternatives,2)]:[]).map((s,i)=>({...s.tour,tourRole:['lowest-cost','best-balance','most-memorable'][i],tourRoleLabel:['Lowest cost','Diverse alternative','Another route idea'][i]}));
 const expanded=variants?retained.slice().sort((a,b)=>a.estimatedDate-b.estimatedDate||a.cost-b.cost||a.key.localeCompare(b.key)):allRanked;
 const expandedRanked=multiFirst?expanded.filter(s=>s.cities.length>=2):expanded;
 result_roleCandidates=roleCandidates(expandedRanked,spendable,{variants,origin,originCountry:String(origin.countryCode||'').toUpperCase(),preferAbroad:budget>=ABROAD_FROM_USD,stretch:multiFirst?stretchPool.filter(s=>s.cities.length>=2):stretchPool,fallbackPool:expanded});
 // The pool: two-city trips first when they fit (same rule as the options), topped up
 // with other trips so a small search still offers choice.
 const poolBase=ranked.length>=8||!multiFirst?expandedRanked:[...expandedRanked,...expanded.filter(s=>s.cities.length===1)];
 const balanced=huge&&query.totalNights==null&&!query.departureDate&&!query.returnDate&&String(env.FARE_MAP_BALANCED_POOL||'').trim().toLowerCase()==='on';
 result_pool=buildPool(poolBase,spendable,{variants,balanced,origin,bigBudget,multiCity:multiFirst,size:Number(options.poolSize)||POOL_SIZE});
 if(variants)diagnostics.alternativeRouteVariants=retained.length-distinct.size;
 diagnostics.poolSize=result_pool.length;diagnostics.bigBudget=bigBudget;
 diagnostics.cityCounts=[...new Set(allRanked.map(s=>s.cities.length))].sort();diagnostics.stretchCandidates=stretchPool.length;
 // No trip fits: say what budget would (cheapest complete trip seen, plus the 10% reserve).
 if(!allRanked.length&&cheapestOverUsd)requested.suggestedMinimumBudgetUsd=Math.ceil(cheapestOverUsd/.9/10)*10;
 // Nothing came close: look once more with a much larger budget, only to say what would work.
 if(!allRanked.length&&!cheapestOverUsd&&!diagnostics.readErrors&&!options.suggestOnly){
  try{const wide=Math.max(budget*3,1500),again=await search({...query,budget:wide,budgetUsd:wide,currency:'USD'},{...options,suggestOnly:true});const low=Math.min(...(again.tours||[]).map(t=>t.estimatedTotalUsd));if(Number.isFinite(low))requested.suggestedMinimumBudgetUsd=Math.ceil(low/.9/10)*10;}catch{}
 }
 if(options.listRanked)diagnostics.ranked=ranked.slice(0,Math.min(100,Number(options.listLimit)||50)).map(x=>({route:(x.tour?.stops||[]).map(s=>s.city||s.name||s.cityId).join(' > '),totalUsd:Math.round(x.cost),nights:x.tour?.totalNights??null,dates:(x.tour?.legs||[]).map(l=>l.departureDate),estimatedReturnDate:Boolean(x.estimatedDate)}));
 diagnostics.returnedTours=picked.length;diagnostics.destinationDiversity=new Set(picked.flatMap(t=>t.stops.map(s=>s.cityId))).size;diagnostics.ms=clock()-started;
 return response(picked,picked.length?null:diagnostics.readErrors?'fare-map-read-unavailable':'no-complete-date-compatible-fare-map-route');
}
module.exports={rotateQueue,MAX_SPREAD_KM,MULTI_CITY_FROM_USD,ABROAD_FROM_USD,BIG_BUDGET_FROM_USD,POOL_SIZE,POOL_WEIGHTS,_anyRegion:anyRegion,_originRegistryRow:originRegistryRow,VERSION,FLAG,enabled,search,maxCities,_internal:{regionRatios,memoryLevel,legacyRule,posterior,onwardPotential,regionQuantile,stayShape,oddRoute,routeShape,buildPool,balancedPoolScore,poolSimilarity,tripFeatures,stayValid,cityVibes,tripStory,regionFamily,dynamicRows,isDynamic,bestUseOrder,retainRouteVariants,roleCandidates,USE_BAND,date,plus,days,months,sixMonthsAfter,durationChoices,rows,eligible,code,fareValid,pickDiverse,makeTour}};
