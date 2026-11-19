const test=require('node:test'),assert=require('node:assert/strict');
const optimizer=require('../../backend/services/domain/fare-map/fare-map-optimizer');
const {fixture,NOW}=require('./fare-map-fixtures.cjs');
const search=(f,query=f.query,options={})=>optimizer.search(query,{...f.options,rows:f.rows,...options});
test('disabled by default and performs no reads',async()=>{const r=await optimizer.search({}, {env:{},readRoutes:()=>assert.fail('No read')});assert.equal(r.reason,'feature-disabled')});
test('beam returns complete dated cached routes, all three flights and every hotel night inside protected budget',async()=>{
 const f=fixture(),r=await search(f);assert.equal(r.tours.length,3,JSON.stringify(r));assert.ok(r.diagnostics.examinedEdges>32);assert.ok(r.diagnostics.eligibleCities>8);
 for(const t of r.tours){assert.equal(t.stops.length,2);assert.equal(t.legs.length,3);assert.equal(t.legs[0].from.airportCode,'LHR');assert.equal(t.legs[2].to.airportCode,'LHR');assert.equal(t.totalNights,8);assert.equal(t.estimatedTotalUsd,t.totalFlightEstimateUsd+t.totalHotelEstimateUsd);assert.ok(t.estimatedTotalUsd<=t.usableTripBudgetUsd);assert.equal(t.fareMap.arrivalDatesVerified,false);assert.equal(t.stops[0].departureDate,t.legs[1].departureDate);assert.equal(t.stops[1].departureDate,t.legs[2].departureDate);assert.ok(t.legs.every(l=>!l.liveFareVerified&&l.providerDateEvidence.sourceType==='CACHED'));}
 assert.ok(r.diagnostics.destinationDiversity>=4);
});
test('missing return fares produce no fabricated complete tour',async()=>{const f=fixture();for(const [key,value]of f.map)if(!key.startsWith(f.originCode+'#'))f.map.set(key,value.filter(r=>r.destination!==f.originCode));assert.equal((await search(f)).tours.length,0)});
test('stale/future/malformed/missing date/wrong source fares cannot form routes',async()=>{for(const change of [r=>r.observedAt='2026-01-01',r=>r.observedAt='2028-01-01',r=>r.departureDate=null,r=>r.priceUsd=-1,r=>r.source='sandbox',r=>r.departureDate='2027-02-30']){const f=fixture();for(const rows of f.map.values())rows.forEach(change);assert.equal((await search(f)).tours.length,0)}});
test('incompatible departure window or return date fail closed; cross-month flights use their actual dates',async()=>{
 const f=fixture();assert.equal((await search(f,{...f.query,departureDate:'2027-03-02'})).tours.length,0);assert.equal((await search(f,{...f.query,returnDate:'2027-03-10'})).tours.length,0);
 for(const values of f.map.values())for(const r of values){r.departureDate={'2027-03-01':'2027-03-29','2027-03-05':'2027-04-02','2027-03-09':'2027-04-06'}[r.departureDate];r.month=r.departureDate.slice(0,7)}
 const rows=[...f.map.values()].flat();f.map.clear();for(const r of rows){const key=r.origin+'#'+r.month;f.map.set(key,[...(f.map.get(key)||[]),r])}
 const r=await search(f,{...f.query,departureDate:'2027-03-29'});assert.ok(r.tours.length);assert.equal(r.tours[0].legs[2].departureDate,'2027-04-06');
});
test('currency/passenger/room budget calculations reuse shared pricing and low budgets reject routes',async()=>{
 const f=fixture();const one=await search(f),party=await search(f,{...f.query,adults:2,rooms:2});assert.ok(party.tours.length);const a=one.tours[0],b=party.tours.find(t=>t.tourId===a.tourId)||party.tours[0];assert.equal(b.totalFlightEstimateUsd,a.totalFlightEstimateUsd*2);assert.equal(b.totalHotelEstimateUsd,a.totalHotelEstimateUsd*2);
 assert.equal((await search(f,{...f.query,budget:10})).tours.length,0);assert.equal((await search(f,{...f.query,currency:'CAD',budget:10})).tours.length,0);
});
test('unknown origins/dates/currencies rejected, database errors fail closed, hard read/edge bounds are observable',async()=>{
 const f=fixture();await assert.rejects(search(f,{...f.query,origin:'nonsense-origin'}));await assert.rejects(search(f,{...f.query,departureDate:'2027-02-30'}));await assert.rejects(search(f,{...f.query,currency:'XYZ'}));
 const unavailable=await search(f,f.query,{readRoutes:async()=>{throw Error('database details')}});assert.equal(unavailable.tours.length,0);assert.equal(unavailable.reason,'fare-map-read-unavailable');
 const bounded=await search(f,f.query,{maxReads:2,maxEdges:10});assert.ok(bounded.diagnostics.reads<=2);assert.ok(bounded.diagnostics.examinedEdges<=10);assert.equal(bounded.diagnostics.bounded,true);
});
test('destination eligibility is enforced, no duplicate cities or same metro revisits',async()=>{
 const f=fixture();const invalid=f.dest[0];invalid.unifiedRegistry.destination.eligible=false;const r=await search(f);for(const t of r.tours){assert.ok(!t.stops.some(s=>s.cityId===invalid.unifiedRegistry.cityId));assert.equal(new Set(t.stops.map(s=>s.cityId)).size,2)}
 invalid.unifiedRegistry.destination.eligible=true;
});
test('generated-tour feature integration preserves classic response/labels and does not call providers when gated off',async()=>{
 const f=fixture(),old={flag:process.env.ENABLE_GENERATED_TOUR_651A,fetch:global.fetch};process.env.ENABLE_GENERATED_TOUR_651A='true';global.fetch=()=>assert.fail('No provider requests allowed');
 try{const r=await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour(f.query,{env:f.options.env,fareMap:{...f.options,rows:f.rows}});assert.equal(r.ok,true);assert.ok(r.tour,JSON.stringify(r));assert.equal(r.tour.itineraryDatePlan.consistent,true);assert.equal(r.tour.backendLegs.length,3);assert.ok(r.tour.cities.length===2);assert.ok(r.tour.budget.total);assert.equal(r.diagnostics.arrivalDatesVerified,false)}finally{global.fetch=old.fetch;if(old.flag===undefined)delete process.env.ENABLE_GENERATED_TOUR_651A;else process.env.ENABLE_GENERATED_TOUR_651A=old.flag}
});


test('explicit preferred stops, region and two-destination request limits remain enforced',async()=>{
 const f=fixture();const id=f.dest[0].unifiedRegistry.cityId;const selected=await search(f,{...f.query,preferredStops:id});for(const t of selected.tours)assert.ok(t.stops.some(s=>s.cityId===id));
 assert.equal((await search(f,{...f.query,region:'Oceania'})).tours.length,0);assert.equal((await search(f,{...f.query,maxStops:1})).tours.length,0);assert.equal((await search(f,{...f.query,destinationCount:3})).reason,'two-destination-mvp-only');
});
test('single selected-tour verification reuses Ignav and Nuitee gates; overnight arrivals set exact hotel dates',async()=>{
 const f=fixture(),old=process.env.ENABLE_GENERATED_TOUR_651A;process.env.ENABLE_GENERATED_TOUR_651A='true';let flightCalls=0,hotelCalls=0;
 const env={...f.options.env,ENABLE_IGNAV_FLIGHTS:'true',IGNAV_API_KEY:'offline-only',ENABLE_NUITEE_LIVE_STAYS:'true',NUITEE_SECRET_ID:'offline-reference'};
 const applyIgnavLiveFares=async t=>{flightCalls++;const tour=structuredClone(t);tour.legs.forEach((l,i)=>{l.liveFareVerified=true;l.providerDateEvidence={...l.providerDateEvidence,provider:'ignav',source:'ignav-live-one-way',sourceType:'LIVE',productionEligible:true,segments:[{arriveLocal:require('../../backend/services/domain/fare-map/fare-map-optimizer')._internal.plus(l.departureDate,1)+'T09:00:00'}]}});return {tour,summary:{applied:true,providerRequests:3}}};
 try{
  const r=await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour(f.query,{env,fareMap:{...f.options,rows:f.rows},applyIgnavLiveFares,applyNuiteeLiveStays:async t=>{hotelCalls++;assert.equal(t.stops[0].arrivalDate,'2027-03-02');assert.equal(t.stops[0].departureDate,'2027-03-05');assert.equal(t.stops[0].nights,3);return {tour:t,summary:{applied:false,reason:'offline-unavailable'}}}});
  assert.equal(flightCalls,1);assert.equal(hotelCalls,1);assert.ok(r.tour,JSON.stringify(r));assert.equal(r.tour.itineraryDatePlan.consistent,true);assert.equal(r.tour.fareMap.arrivalDatesVerified,true);
 }finally{if(old===undefined)delete process.env.ENABLE_GENERATED_TOUR_651A;else process.env.ENABLE_GENERATED_TOUR_651A=old}
});
test('partial/unavailable flight evidence stays cached and cannot start live hotel verification',async()=>{
 const f=fixture(),old=process.env.ENABLE_GENERATED_TOUR_651A;process.env.ENABLE_GENERATED_TOUR_651A='true';
 try{for(const reason of ['quota-exhausted','provider-429','partial-coverage']){
 const r=await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour(f.query,{env:{...f.options.env,ENABLE_IGNAV_FLIGHTS:'true',IGNAV_API_KEY:'offline',ENABLE_NUITEE_LIVE_STAYS:'true',NUITEE_SECRET_ID:'offline-reference'},fareMap:{...f.options,rows:f.rows},applyIgnavLiveFares:async t=>({tour:t,summary:{applied:false,reason}}),applyNuiteeLiveStays:()=>assert.fail('Unknown arrival dates must not request hotel rates')});assert.ok(r.tour);assert.equal(r.tour.fareMap.arrivalDatesVerified,false);assert.ok(r.tour.backendLegs.every(l=>!l.liveFareVerified));
 }}finally{if(old===undefined)delete process.env.ENABLE_GENERATED_TOUR_651A;else process.env.ENABLE_GENERATED_TOUR_651A=old}
});
test('live price increase beyond protected budget and invalid arrival data cannot masquerade as budget-safe',async()=>{
 const f=fixture(),old=process.env.ENABLE_GENERATED_TOUR_651A;process.env.ENABLE_GENERATED_TOUR_651A='true';
 try{const r=await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour(f.query,{env:{...f.options.env,ENABLE_IGNAV_FLIGHTS:'true',IGNAV_API_KEY:'offline'},fareMap:{...f.options,rows:f.rows},applyIgnavLiveFares:async t=>({tour:{...t,legs:t.legs.slice(0,1)},summary:{applied:true}})});assert.equal(r.tour,null);assert.equal(r.reason,'fare-map-incomplete-live-itinerary')}
 finally{if(old===undefined)delete process.env.ENABLE_GENERATED_TOUR_651A;else process.env.ENABLE_GENERATED_TOUR_651A=old}
});


test('a genuinely higher complete live fare rejects the formerly affordable itinerary',async()=>{
 const f=fixture(),old=process.env.ENABLE_GENERATED_TOUR_651A;process.env.ENABLE_GENERATED_TOUR_651A='true';
 try{const r=await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour(f.query,{env:{...f.options.env,ENABLE_IGNAV_FLIGHTS:'true',IGNAV_API_KEY:'offline'},fareMap:{...f.options,rows:f.rows},applyIgnavLiveFares:async t=>({tour:{...t,legs:t.legs.map(l=>require('../../backend/services/domain/pricing/traveller-pricing').priceTransportLeg({...l,liveFareVerified:true,providerDateEvidence:{...l.providerDateEvidence,source:'ignav-live-one-way',segments:[{arriveLocal:l.departureDate+'T20:00:00'}]}},f.query,{amountBasis:'party-total',partyTotalAmountUsd:10000}))},summary:{applied:true}})});assert.equal(r.tour,null);assert.equal(r.reason,'fare-map-live-total-exceeds-protected-budget')}
 finally{if(old===undefined)delete process.env.ENABLE_GENERATED_TOUR_651A;else process.env.ENABLE_GENERATED_TOUR_651A=old}
});


test('partition prefetch is bounded, identical partitions coalesce, and the complete registry is the candidate surface',async()=>{
 const f=fixture(48),calls=new Map();let active=0,peak=0;
 const result=await search(f,f.query,{readRoutes:async(o,m)=>{const key=o+'#'+m;calls.set(key,(calls.get(key)||0)+1);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;return f.map.get(key)||[]}});
 assert.ok(result.tours.length);assert.ok(peak<=4);assert.ok(peak>1);assert.ok([...calls.values()].every(n=>n===1));
 assert.equal(optimizer._internal.rows().length,1000);
});
