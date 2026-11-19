// Offline-only benchmark. All provider HTTP and DynamoDB reads are replaced with fixtures.
process.env.ENABLE_UNIFIED_CITY_REGISTRY_668A='true';
process.env.TRAVELPAYOUTS_TOKEN='offline-benchmark-only';
process.env.TRAVELPAYOUTS_PRICE_CURRENCY='USD';
process.env.ENABLE_PROVIDER_DRIVEN_ROUTE_DISCOVERY_665B='true';
process.env.GLOBEVOY_USE_MOCKS='false';
const {performance}=require('node:perf_hooks');
const {fixture}=require('../../tests/backend/fare-map-fixtures.cjs');
const optimizer=require('../../backend/services/domain/fare-map/fare-map-optimizer');
const graph=require('../../backend/services/domain/routing/global-route-graph');
const f=fixture(48),codes=new Map();for(const r of f.rows)for(const c of [optimizer._internal.code(r),...(r.unifiedRegistry.origin.airportCodes||[])])codes.set(c,optimizer._internal.code(r));
let providerRequests=0;
global.fetch=async(url,init)=>{
 if(!String(url).startsWith('https://api.travelpayouts.com/'))throw Error('Unexpected offline benchmark destination');
 providerRequests++;const query=JSON.parse(init.body).query,origin=(query.match(/origin:\s*"([A-Z]{3})"/)||[])[1],month=((query.match(/depart_months:\s*"(\d{4}-\d{2})/)||[])[1]);
 const rows=f.map.get((codes.get(origin)||origin)+'#'+month)||[];
 return {ok:true,status:200,text:async()=>JSON.stringify({data:{prices_one_way:rows.map(r=>({destination_city_iata:r.destination,departure_at:r.departureDate,value:r.priceUsd,trip_duration:r.durationMinutes}))}})};
};
function summary(result,isNew){
 const tours=result.tours.filter(t=>t.stops.length===2).slice(0,3);
 const errors=tours.map(t=>{
  const nodes=[t.origin,...t.stops,t.origin];let expected=0;
  for(let i=0;i<3;i++){const from=codes.get(nodes[i].airportCode||nodes[i].code),to=codes.get(nodes[i+1].airportCode||nodes[i+1].code),fare=(f.map.get(from+'#2027-03')||[]).find(r=>r.destination===to);if(!fare)return null;expected+=fare.priceUsd}
  return Math.abs(t.totalFlightEstimateUsd-expected);
 });
 return {twoStopTours:tours.length,distinctCities:new Set(tours.flatMap(t=>t.stops.map(s=>s.cityId))).size,evaluatedPairs:isNew?result.diagnostics.expandedPairs:result.diagnostics.evaluatedProviderPairs,examinedEdges:isNew?result.diagnostics.examinedEdges:null,dbPartitions:isNew?result.diagnostics.reads:0,completeThreeLegEvidence:tours.filter(t=>t.legs.length===3&&t.legs.every(l=>l.providerDateEvidence||l.providerObservation)).length,dateCompleteTours:tours.filter(t=>t.legs.length===3&&t.legs.every(l=>l.departureDate)&&t.legs.every((l,i)=>!i||l.departureDate>t.legs[i-1].departureDate)).length,hotelNightsCompleteTours:tours.filter(t=>t.stops.reduce((s,x)=>s+x.nights,0)===Number(f.query.nights)).length,maxFlightBudgetErrorAgainstFixtureUsd:errors.length?Math.max(...errors.filter(x=>x!==null)):null,missingReturnAllowed:!isNew};
}
(async()=>{
 const oldTimes=[],newTimes=[];let oldResult,newResult;
 for(let i=0;i<7;i++){
  let start=performance.now();oldResult=await graph._internal.generateProviderDrivenCandidates(f.query);oldTimes.push(performance.now()-start);
  start=performance.now();newResult=await optimizer.search(f.query,{...f.options,rows:f.rows,timeBudgetMs:5000});newTimes.push(performance.now()-start);
 }
 const median=a=>a.slice().sort((x,y)=>x-y)[Math.floor(a.length/2)];
 const report={environment:'OFFLINE fixtures; mocked HTTP/DB, warm process, no Lambda/network latency or production SLO claim',fixtureCities:f.dest.length,rounds:7,old:{...summary(oldResult,false),medianMs:Math.round(median(oldTimes)*100)/100,mockedProviderCallsTotal:providerRequests},beam:{...summary(newResult,true),medianMs:Math.round(median(newTimes)*100)/100,providerCalls:0}};
 // Remove return evidence in a separate scenario: the new engine must return none.
 for(const [k,v]of f.map)f.map.set(k,v.filter(r=>r.destination!==f.originCode));
 const oldMissing=await graph._internal.generateProviderDrivenCandidates(f.query);report.missingReturnOldTwoStopCandidates=oldMissing.tours.filter(t=>t.stops.length===2).length;
 const missing=await optimizer.search(f.query,{...f.options,rows:f.rows});report.missingReturnNewTours=missing.tours.length;
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e.name+': benchmark failed');process.exitCode=1});
