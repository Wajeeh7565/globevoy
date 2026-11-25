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
const VERSION='GV-FAREMAP-BEAM-004',FLAG='ENABLE_FARE_MAP_OPTIMIZER';
const hotelMemory=require('../live-fares/hotel-price-memory');
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
function regionFamily(row){const c=String(row?.unifiedRegistry?.destination?.regionCluster||row?.unifiedRegistry?.worldRegion||'').toLowerCase();
 if(c.includes('europe'))return 'europe';if(c.includes('south-america')||c.includes('mexico')||c.includes('caribbean'))return 'latin-america';
 if(c.includes('asia')||c.includes('middle-east'))return 'asia';if(c.includes('africa'))return 'africa';if(c.includes('oceania'))return 'oceania';if(c.includes('north-america'))return 'north-america';return c||'other';}
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
// extra: big budgets may stay a few nights longer than a city's usual maximum (GV-BIG-BUDGET-001).
function stayValid(row,nights,extra=0){const d=row?.unifiedRegistry?.destination||{};return nights>=Math.max(2,Number(d.minimumRecommendedNights)||2)&&nights<=Math.min(35,(Number(d.maximumRecommendedNights)||35)+extra);}
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
  stop.vibes=cityVibes(row.unifiedRegistry.cityId);stop.regionFamily=regionFamily(row);
  stops.push(stop);
 }
 const nodes=[origin,...stops,origin];
 const legs=state.edges.map((f,i)=>priceTransportLeg({legNumber:i+1,from:nodes[i],to:nodes[i+1],mode:'flight',transportType:'flight',departureDate:f.departureDate,dateLabel:f.departureDate,distanceKm:Math.round(legacy._internal.haversineKm(nodes[i],nodes[i+1])),durationMinutes:f.durationMinutes,estimateSource:'fare-map-cached-per-passenger',estimatedFlightUsd:f.priceUsd,estimatedTransportUsd:f.priceUsd,providerVerificationRequired:true,liveFareVerified:false,providerDateEvidence:{...(f.dateEstimated?{dateEstimated:true,basis:'month-cheapest-plus-buffer',monthCheapestUsd:f.monthCheapestUsd}:{}),source:'travelpayouts-cached',sourceType:'CACHED',provider:'travelpayouts',origin:f.origin,destination:f.destination,departureDate:f.departureDate,observedAt:f.observedAt,amountUsd:f.priceUsd,currency:'USD',appliedToEstimate:true,productionEligible:false,exactAirportMatch:false,providerBacked:false}},query,{unitAmountUsd:f.priceUsd}));
 const flights=legs.reduce((s,l)=>s+l.estimatedTransportUsd,0),hotels=stops.reduce((s,t)=>s+t.hotel.estimatedStayUsd,0),reserve=Math.round(budget*.10),total=flights+hotels;
 return attachTourPresentation({tourId:'gv-fare-map-'+state.key.replace(/[^A-Za-z0-9-]/g,'-'),origin,stops,legs,passengerPricing:normalizeParty(query),totalNights:stops.reduce((s,t)=>s+t.nights,0),tripDurationNights:days(state.edges[0].departureDate,state.edges.at(-1).departureDate),estimatedTotalUsd:total,totalFlightEstimateUsd:flights,totalTransportEstimateUsd:flights,totalHotelEstimateUsd:hotels,totalBudgetUsd:budget,reservePercent:.1,reserveAmountUsd:reserve,usableTripBudgetUsd:budget-reserve,amountLeftUsd:budget-reserve-total,affordabilityStatus:total<=budget-reserve?'within-protected-budget':'over-protected-budget',selectionSource:'fare-map-beam',pricingStatus:'cached-flight-and-estimated-hotel-planning',providerVerificationRequired:true,cityCount:stops.length,tripStory:tripStory(stops),regionFamilies:[...new Set(stops.map(s=>s.regionFamily))],routeExplanation:['Every flight on this route was seen in recent fare data; prices are checked live before the trip is shown.','Hotel nights conservatively cover the entire departure-to-departure interval. Actual arrival dates and hotel check-in must be verified before booking.','A 10% personal expense reserve remains protected.'],fareMap:{version:VERSION,completeCachedLegs:legs.length,mirroredReturn:!!state.edges.at(-1)?.mirrored,arrivalDatesVerified:false,hotelDatesRequireVerification:true,durationChoices:options.durationChoices||[days(state.edges[0].departureDate,state.edges.at(-1).departureDate)]},editableActions:{removeStop:false,replaceStop:true,addStop:false,reorderStops:false,undo:true}},query);
}
// Best use of the budget (GV-FAREMAP-BEST-USE-001). The site asks for three trips in
// parallel by role; each role gets its own route so the page can show three different trips.
// best-balance: the route that spends 80-95% of the spendable budget (headroom for live
// price drift), most nights first; when none reach 80%, the route closest to it.
// lowest-cost: the cheapest route. most-memorable: a route sharing the fewest cities.
// Real return dates always outrank estimated ones. Each role keeps two backup routes.
const USE_BAND=[.8,.95];
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
 const key=s=>s.cities.map(code).join('>'),taken=new Set(),takenFams=new Set(),out={};
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
 const take=(order,role,label,backup)=>{let fresh=order.filter(s=>!inUse.has(key(s)));if(backup&&fresh.length<3)fresh=[...fresh,...backup.filter(s=>!inUse.has(key(s))&&!fresh.includes(s))];const list=(fresh.length?fresh:order).slice(0,3);if(fresh.length){firsts.add(key(fresh[0]));taken.add(key(fresh[0]));fams(fresh[0]).forEach(f=>takenFams.add(f));list.forEach(s=>inUse.add(key(s)));}out[role]=list.map(s=>tag(s,role,label));};
 // Above about C$1,500 the main and "something different" picks go abroad when a trip
 // abroad fits (Lahore > Peshawar > Karachi is not what US$1,500 is for); a domestic
 // trip can still be the lowest-cost option.
 const abroad=s=>extra.originCountry&&s.cities.some(c=>String(c.countryCode||c.unifiedRegistry?.countryCode||'').toUpperCase()!==extra.originCountry);
 const wide=extra.preferAbroad&&ranked.some(abroad)?ranked.filter(abroad):ranked;
 take(bestUseOrder(wide,spendable),'best-balance','Best use of budget',bestUseOrder(ranked,spendable));
 take(ranked,'lowest-cost','Lowest cost');
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
 if(extra.fallbackPool){const fb=extra.fallbackPool.filter(s=>!inUse.has(key(s))&&!oddRoute(s)).sort((a,b)=>a.estimatedDate-b.estimatedDate||a.cost-b.cost).slice(0,3);if(fb.length)out.fallback=fb.map(s=>tag(s,'best-balance','Best use of budget'));}
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
  families:new Set(s.cities.map(regionFamily)),cities:new Set(s.cities.map(code)),month:String(s.edges?.[0]?.departureDate||s.tour?.legs?.[0]?.departureDate||'').slice(0,7)};
}
function poolSimilarity(a,b){
 if([...a.cities].some(c=>b.cities.has(c)))return 1;
 let sim=0;if([...a.families].some(f=>b.families.has(f)))sim+=.5;if(a.month===b.month)sim+=.2;if(a.size===b.size)sim+=.1;
 return Math.min(1,sim);
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
  const shape=extra.bigBudget?Math.min(1,x.size/3+.1):extra.multiCity?(x.size>=2?1:.5):(x.size===1?1:.7);
  const score=W.fit*fit+W.value*nValue(x.nightsPerK)+W.reach*nReach(x.km)+W.character*nChar(x.vibes)+W.shape*shape-(s.estimatedDate?.3:0);
  return {s,x,score:Number(score.toFixed(4)),parts:{fit:Number(fit.toFixed(3)),value:Number(nValue(x.nightsPerK).toFixed(3)),reach:Number(nReach(x.km).toFixed(3)),shape}};});
 const picked=[],left=scored.slice().sort((a,b)=>b.score-a.score||a.s.key.localeCompare(b.s.key));
 while(picked.length<(extra.size||POOL_SIZE)&&left.length){
  let best=0,bestValue=-Infinity;
  for(let i=0;i<left.length;i++){const sim=picked.length?Math.max(...picked.map(p=>poolSimilarity(left[i].x,p.x))):0;const v=left[i].score-W.similarity*sim;if(v>bestValue+1e-9){bestValue=v;best=i;}}
  picked.push(left.splice(best,1)[0]);
 }
 return picked.map((p,i)=>({...p.s.tour,poolRank:i+1,poolScore:p.score,budgetUse:Number(p.x.use.toFixed(3)),cityCount:p.x.size,
  // A big budget's trip that leaves much unspent may upgrade its hotels in the live step.
  poolUpgrade:!!extra.bigBudget&&p.x.use<.75}));
}

async function search(query={},options={}){
 spreadLimitKm=(()=>{const v=String((options.env||process.env).FARE_MAP_MAX_SPREAD_KM??'').trim();return v===''?MAX_SPREAD_KM:Math.max(0,Number(v)||0);})();
 const env=options.env||process.env;
 if(!enabled(env))return {ok:true,supported:false,reason:'feature-disabled',requiredFlag:FLAG+'=true',tours:[]};
 const diagnostics={engine:VERSION,reads:0,examinedEdges:0,completeRoutes:0,expandedPairs:0,eligibleCities:0,cacheHits:0,rejectedFares:0,rejectedRules:0,bounded:false,liveProviderCallsMade:0};
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
 const capK=bigBudget&&!env.FARE_MAP_MAX_CITIES?3:maxCities(env),askedMax=Number(query.maxStops??query.stops),exact=Number(query.destinationCount)||null;
 const stayExtra=bigBudget?3:0;
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
 const candidates=all.filter(r=>eligible(r)&&code(r)&&r.unifiedRegistry.cityId!==origin.cityId&&!(r.unifiedRegistry.origin?.airportCodes||[]).includes(origin.airportCode));
 const map=new Map();for(const r of candidates)if(!map.has(code(r)))map.set(code(r),r);
 diagnostics.eligibleCities=map.size;
 const originRow=originRegistryRow(all,origin);
 // The site sends "All continents"; that and similar wording mean no region filter.
 const regionFilter=anyRegion(query.region)?null:String(query.region).trim().toLowerCase();
 const originCode=code(originRow)||origin.airportCode,cache=new Map();
 // Flights home can be filed under the city code (YMQ) while searches start from the
 // airport row (YUL), or the reverse; any of the origin's codes counts as home.
 const homeCodes=new Set([originCode,origin.airportCode,String(origin.cityId||'').replace(/^global-city-/,'').toUpperCase(),...(originRow?.unifiedRegistry?.origin?.airportCodes||[])].filter(Boolean));
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeBudget);
 const read=options.readRoutes||((o,m)=>store.readRoutesFrom(o,m,{env,dynamo:options.dynamo,abortSignal:controller.signal,maxPages:2,limit:1000,nowMs:now,includeDated:true,diagnostics}));
 let readCeiling=Math.min(MAX_READS,options.maxReads||MAX_READS);
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
      if(!homeCodes.has(fare.destination)||!durationOk(days(first,fare.departureDate))||query.returnDate&&fare.departureDate!==query.returnDate)return false;
      if(preferred.some(id=>!state.cities.some(c=>c.unifiedRegistry.cityId.toLowerCase()===id)))return false;
      diagnostics.completeRoutes++;
      const candidate={...state,edges:[...state.edges,fare]};const tour=makeTour(candidate,origin,budget,query,{...options,now,durationChoices:durations});
      if(!tour){diagnostics.missingHotelEvidence=(diagnostics.missingHotelEvidence||0)+1;return false;}
      if(state.cities.length<minCities)return false;
      // Safe cost: flights plus hotels at the live-price margin; used to choose and rank.
      // A city with learned real-vs-model hotel prices (GV-HOTEL-MEMORY-001) uses its own
      // ratio, plus 5%, instead of the general margin.
      const hotelFor=stop=>{const est=Number(stop?.hotel?.estimatedStayUsd)||0,learned=hotelMemory.ratioFor(options.hotelRatios,stop?.cityId);if(learned)diagnostics.learnedHotelCities=(diagnostics.learnedHotelCities||0)+1;return est*(learned?Math.max(1,learned*1.05):margin);};
      const stopHotels=(tour.stops||[]).reduce((n,stop)=>n+hotelFor(stop),0);
      const safeCost=Math.round(tour.totalFlightEstimateUsd+(stopHotels>0?stopHotels:tour.totalHotelEstimateUsd*margin));
      if(safeCost>tour.usableTripBudgetUsd){
       // Over budget: remember the cheapest (to say what budget would work) and keep
       // trips a little over as the optional "+ a bit more" idea; never a main pick.
       diagnostics.overBudgetRoutes=(diagnostics.overBudgetRoutes||0)+1;
       if(!(cheapestOverUsd<=safeCost))cheapestOverUsd=safeCost;
       if(safeCost<=tour.usableTripBudgetUsd+stretchUsd&&!fare.dateEstimated){const ev=evaluateTour(tour,query);if(ev.accepted&&!recommendationEligibility(ev.tour,query).hardBlocked){stretchPool.push({estimatedDate:false,cities:state.cities,cost:safeCost,key:state.key,tour:{...ev.tour,fareMap:tour.fareMap}});if(stretchPool.length>64)stretchPool=stretchPool.sort((a,b)=>(b.tour.totalNights-a.tour.totalNights)||a.cost-b.cost).slice(0,32);}}
       return false;
      }
      const evaluated=evaluateTour(tour,query);if(!evaluated.accepted||recommendationEligibility(evaluated.tour,query).hardBlocked){diagnostics.rejectedRules++;return false}
      const comfortPenalty=String(query.flightComfort||'').toLowerCase()==='comfortable'?candidate.edges.reduce((sum,f)=>sum+(Number.isFinite(f.stops)?f.stops*25:25)+(Number.isFinite(f.durationMinutes)?f.durationMinutes/60:12),0):0;
      const qualityPenalty=tour.stops.reduce((sum,s)=>sum+(s.hotel.costEvidence.quality.verified?-(s.hotel.costEvidence.quality.reviewScore||0)*2:0),0);
      tour.fareMap.scoreEvidence={costUsd:tour.estimatedTotalUsd,comfortPenalty,hotelQualityPenalty:qualityPenalty,unknownFlightComfort:candidate.edges.some(f=>f.stops==null||f.durationMinutes==null)};
      // Flown distance compared with going out and back to the furthest city: 1.0 is a
      // clean loop, Lisbon > Munich from Toronto about 1.1, a zigzag 1.4 or more.
      const pts=[origin,...state.cities.map(c=>({latitude:c.unifiedRegistry.latitude,longitude:c.unifiedRegistry.longitude})),origin],hk=(a,b)=>legacy._internal.haversineKm(a,b)||0;
      const flown=pts.slice(1).reduce((n,p,i)=>n+hk(pts[i],p),0),far=Math.max(...pts.slice(1,-1).map(p=>hk(origin,p)));
      const detour=state.cities.length>1&&far>0?Number((flown/(2*far)).toFixed(2)):1;
      complete.push({detour,estimatedDate:!!fare.dateEstimated,cities:state.cities,cost:safeCost,preferencePenalty:comfortPenalty+qualityPenalty+(state.preferencePenalty||0),key:state.key,tour:{...evaluated.tour,fareMap:tour.fareMap}});
      // Keep cheap, diverse routes and the routes that use the budget best, per trip
      // size, so many cheap one-city trips never crowd out the two-city ones.
      const size=state.cities.length;
      if(complete.filter(x=>x.cities.length===size).length>128){const same=complete.filter(x=>x.cities.length===size),keep=pickDiverse(same,48),ids=new Set(keep.map(x=>x.key+'|'+x.cost));complete=[...complete.filter(x=>x.cities.length!==size),...keep,...bestUseOrder(same.filter(x=>!ids.has(x.key+'|'+x.cost)),budget-Math.round(budget*.1)).slice(0,16)];}
      return true;
  }
 let beam=[{cities:[],edges:[],lastCode:originCode,cost:0,key:originCode}],complete=[],stretchPool=[],cheapestOverUsd=null;
 // How far over the spendable budget the optional bigger-trip idea may go (about C$100-200).
 const margin=hotelMargin(env);diagnostics.hotelMargin=margin;
 const stretchUsd=Math.round(Math.min(150,Math.max(70,budget*.12)));
 const homeLinked=new Set(),outboundFrom=new Map();
 try {
  for(let depth=0;depth<=K&&beam.length;depth++){
   const readLimit=Math.min(MAX_READS,options.maxReads||MAX_READS);
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
     if(depth===0&&query.departureDate&&fare.departureDate!==query.departureDate)continue;
     if(depth===0&&(fare.departureDate<windowStart||fare.departureDate>=windowEnd))continue;
     const first=depth?state.edges[0].departureDate:fare.departureDate;
     if(days(first,fare.departureDate)>nights)continue;
     const goingHome=depth>=1&&homeCodes.has(fare.destination);
     if(goingHome){diagnostics.returnFares=(diagnostics.returnFares||0)+1;if(!state.returnSeed||fare.priceUsd<state.returnSeed.priceUsd)state.returnSeed=fare;}
     if(depth){const previous=state.edges.at(-1),transitDays=Math.max(1,Math.ceil((previous.durationMinutes||0)/1440));if(!stayValid(state.cities.at(-1),days(previous.departureDate,fare.departureDate)-transitDays,stayExtra)){if(goingHome)diagnostics.returnStayRejected=(diagnostics.returnStayRejected||0)+1;continue;}}
     // A flight home after any city completes a trip of that many cities.
     if(goingHome){if(completeRoute(state,fare,first))state.completed=true;continue;}
     if(depth===K)continue;
     const row=map.get(fare.destination);if(!row||homeCodes.has(fare.destination)||state.cities.some(c=>code(c)===fare.destination))continue;
     if(depth===1)diagnostics.expandedPairs++;
     const record=row.unifiedRegistry;
     if(preferred.length===2&&!preferred.includes(record.cityId.toLowerCase()))continue;
     if(regionFilter&&String(record.worldRegion).toLowerCase()!==regionFilter)continue;
     const hotel=depth?(options.accommodationProvider?0:graph._internal.nightlyUsd(state.cities.at(-1)))*party.rooms*days(state.edges.at(-1).departureDate,fare.departureDate):0;
     const cost=state.cost+Math.round(fare.priceUsd*party.flightFareUnits)+hotel;
     if(cost>budget*.9)continue;
     const theme=String(query.theme||query.preference||'').toLowerCase(),fit=themeScore(row,theme);
     next.push({preferencePenalty:([ ...state.cities,row ].some(c=>preferred.includes(c.unifiedRegistry.cityId.toLowerCase()))?-budget:0)-fit*20,cities:[...state.cities,row],edges:[...state.edges,fare],lastCode:fare.destination,cost,key:state.key+'>'+record.cityId+'@'+fare.departureDate});
    }
    // No cached fare home from this city (Montreal's data often has none): use the
    // fare out to it as a stand-in for the way back. The trip is live-checked on the
    // exact return date before it is shown, so a missing return flight rules it out.
    if(depth>=1&&!state.completed&&!state.returnSeed){const out=outboundFrom.get(state.lastCode);if(out){state.returnSeed={...out,origin:state.lastCode,destination:originCode,mirrored:true};diagnostics.mirroredReturnSeeds=(diagnostics.mirroredReturnSeeds||0)+1;}}
    if(depth>=1&&!state.completed&&state.returnSeed&&!stopped()){
     // The fare map keeps one cheapest date per pair and month, so the cached return date
     // rarely fits the stay. Plan the return inside the city's recommended stay instead,
     // priced from that month's cheapest fare plus a buffer, and label it an estimate;
     // the selected trip is live-checked on these exact dates before it is verified.
     const previous=state.edges.at(-1),seed=state.returnSeed,first=state.edges[0].departureDate,d=state.cities.at(-1)?.unifiedRegistry?.destination||{};
     const transit=Math.max(1,Math.ceil((previous.durationMinutes||0)/1440)),lo=Math.max(2,Number(d.minimumRecommendedNights)||2),hi=Math.min(35,(Number(d.maximumRecommendedNights)||35)+stayExtra);
     for(const n of [Math.round((lo+hi)/2),lo,hi]){
      const ret=plus(previous.departureDate,transit+n);
      if(!seed.mirrored&&ret.slice(0,7)!==seed.departureDate.slice(0,7)||ret>=horizon||!durationOk(days(first,ret))||query.returnDate&&ret!==query.returnDate)continue;
      diagnostics.estimatedReturnDates=(diagnostics.estimatedReturnDates||0)+1;
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
   diagnostics.peakRetainedComplete=Math.max(diagnostics.peakRetainedComplete||0,complete.length);
  }
 }finally{clearTimeout(timer)}
 if(controller.signal.aborted)diagnostics.bounded=true;
 const distinct=new Map();for(const s of complete){const key=s.cities.map(code).join('>');const old=distinct.get(key);if(!old||old.estimatedDate&&!s.estimatedDate||old.estimatedDate===s.estimatedDate&&s.cost+s.preferencePenalty<old.cost+old.preferencePenalty)distinct.set(key,s);}
 const allRanked=[...distinct.values()].sort((a,b)=>a.estimatedDate-b.estimatedDate||a.cost-b.cost||a.key.localeCompare(b.key));
 const multiFirst=!exact&&K>=2&&budget>=MULTI_CITY_FROM_USD&&allRanked.some(s=>s.cities.length>=2);
 diagnostics.multiCityFirst=multiFirst;
 const ranked=multiFirst?allRanked.filter(s=>s.cities.length>=2):allRanked,cheapest=ranked[0];
 const alternatives=cheapest?ranked.slice(1).map(s=>({...s,preferencePenalty:(s.preferencePenalty||0)+s.cities.reduce((sum,c)=>sum+(cheapest.cities.some(x=>code(x)===code(c))?75:0),0)})):[];
 const picked=(cheapest?[cheapest,...pickDiverse(alternatives,2)]:[]).map((s,i)=>({...s.tour,tourRole:['lowest-cost','best-balance','most-memorable'][i],tourRoleLabel:['Lowest cost','Diverse alternative','Another route idea'][i]}));
 result_roleCandidates=roleCandidates(ranked,budget-Math.round(budget*.1),{origin,originCountry:String(origin.countryCode||'').toUpperCase(),preferAbroad:budget>=ABROAD_FROM_USD,stretch:multiFirst?stretchPool.filter(s=>s.cities.length>=2):stretchPool,fallbackPool:allRanked});
 // The pool: two-city trips first when they fit (same rule as the options), topped up
 // with other trips so a small search still offers choice.
 const poolBase=ranked.length>=8||!multiFirst?ranked:[...ranked,...allRanked.filter(s=>!ranked.includes(s))];
 result_pool=buildPool(poolBase,budget-Math.round(budget*.1),{origin,bigBudget,multiCity:multiFirst,size:Number(options.poolSize)||POOL_SIZE});
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
module.exports={MAX_SPREAD_KM,MULTI_CITY_FROM_USD,ABROAD_FROM_USD,BIG_BUDGET_FROM_USD,POOL_SIZE,POOL_WEIGHTS,_anyRegion:anyRegion,_originRegistryRow:originRegistryRow,VERSION,FLAG,enabled,search,maxCities,_internal:{oddRoute,routeShape,buildPool,poolSimilarity,tripFeatures,stayValid,cityVibes,tripStory,regionFamily,bestUseOrder,roleCandidates,USE_BAND,date,plus,days,months,sixMonthsAfter,durationChoices,rows,eligible,code,fareValid,pickDiverse,makeTour}};
