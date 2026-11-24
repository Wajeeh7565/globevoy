const optimizer=require('../../backend/services/domain/fare-map/fare-map-optimizer');
const NOW=Date.parse('2027-02-01T12:00:00Z');
function fixture(count=24){
 const all=optimizer._internal.rows(),origin=all.find(r=>r.unifiedRegistry.cityId==='london-gb');
 const candidates=all.filter(r=>optimizer._internal.eligible(r)&&r.countryCode!=='GB'&&r.unifiedRegistry.worldRegion==='Europe'&&!r.unifiedRegistry.origin.requiresGatewayTransfer&&r.latitude>35&&r.latitude<60&&r.longitude>-10&&r.longitude<25).slice(0,count);
 const seen=new Set(),dest=candidates.filter(r=>{const c=optimizer._internal.code(r);if(seen.has(c))return false;seen.add(c);return true});
 const map=new Map(),originCode=optimizer._internal.code(origin),date=['2027-03-01','2027-03-05','2027-03-09'];
 function add(from,to,amount,departureDate){const key=from+'#2027-03',rows=map.get(key)||[];rows.push({origin:from,destination:to,month:'2027-03',departureDate,priceUsd:amount,source:'travelpayouts-cached',observedAt:new Date(NOW).toISOString(),stops:0,durationMinutes:90});map.set(key,rows)}
 dest.forEach((r,i)=>{const c=optimizer._internal.code(r);add(originCode,c,60+i,date[0]);dest.forEach((s,j)=>{if(i!==j)add(c,optimizer._internal.code(s),30+(i+j)%15,date[1])});add(c,originCode,80+i,date[2])});
 // Two-city trips (destinationCount 2) keep these older checks exact; one-city trips have their own tests.
 const query={origin:'LHR',budget:5000,currency:'USD',nights:8,month:'2027-03',adults:1,destinationCount:2};
 return {all,rows:[origin,...dest],dest,origin,originCode,map,query,options:{env:{ENABLE_FARE_MAP_OPTIMIZER:'true',FARE_MAP_TABLE:'globevoy-fare-map',FARE_MAP_REQUIRE_LIVE:'false'},now:NOW,readRoutes:async(o,m)=>map.get(o+'#'+m)||[],timeBudgetMs:5000}};
}
module.exports={fixture,NOW};
