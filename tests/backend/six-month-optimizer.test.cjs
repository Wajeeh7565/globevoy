'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const optimizer=require('../../backend/services/domain/fare-map/fare-map-optimizer');
const accommodation=require('../../backend/services/domain/fare-map/accommodation-cost-map');
const {fixture,NOW}=require('./fare-map-fixtures.cjs');
function run(f,query={},options={}){return optimizer.search(query,{...f.options,rows:f.rows,...options});}
function move(f,first,second,last){const rows=[...f.map.values()].flat();f.map.clear();for(const r of rows){r.departureDate={'2027-03-01':first,'2027-03-05':second,'2027-03-09':last}[r.departureDate];r.month=r.departureDate.slice(0,7);const k=r.origin+'#'+r.month;f.map.set(k,[...(f.map.get(k)||[]),r]);}}
const minimum={origin:'LHR',budget:5000,travelers:2};
test('minimal request scans six months, considers durations and returns distinct complete routes',async()=>{
 const f=fixture(12),seen=[];const r=await run(f,minimum,{readRoutes:async(o,m)=>{seen.push([o,m]);return f.map.get(o+'#'+m)||[]}});
 assert.equal(r.tours.length,3);assert.deepEqual(r.requested.durationChoices,[6,8,10,12,14,18,21,28]);
 assert.deepEqual(seen.filter(([o])=>o===f.originCode).map(([,m])=>m),['2027-02','2027-03','2027-04','2027-05','2027-06','2027-07']);
 assert.equal(new Set(r.tours.map(t=>t.stops.map(s=>s.cityId).join('>'))).size,3);
 assert.ok(r.tours.every(t=>t.passengerPricing.travellers===2&&t.legs.length===3));
 assert.ok(r.diagnostics.reads<=64);assert.ok(r.diagnostics.examinedEdges<=100000);
});
test('rolling window includes the last partial month and rejects its exact exclusive boundary',async()=>{
 const f=fixture(8),now=Date.parse('2027-02-19T00:00:00Z');
 for(const rows of f.map.values())rows.forEach(r=>r.observedAt=new Date(now).toISOString());
 move(f,'2027-08-18','2027-08-22','2027-08-26');let r=await run(f,minimum,{now});assert.ok(r.tours.length,JSON.stringify(r));
 assert.equal(r.requested.departureWindow.endExclusive,'2027-08-19');
 assert.equal((await run(f,{...minimum,departureDate:'2027-08-19'},{now})).tours.length,0);
 assert.equal(optimizer._internal.sixMonthsAfter('2026-08-31'),'2027-02-28');
});
test('durations follow actual observations, including a return beyond the departure horizon',async()=>{
 for(const [second,last,nights]of [['2027-03-05','2027-03-09',8],['2027-03-07','2027-03-15',14]]){
  const f=fixture(8);move(f,'2027-03-01',second,last);const r=await run(f,minimum);assert.ok(r.tours.length);assert.equal(r.tours[0].tripDurationNights,nights);
 }
 const f=fixture(8);move(f,'2027-07-31','2027-08-04','2027-08-08');assert.ok((await run(f,minimum)).tours.length);
 await assert.rejects(run(f,{...minimum,nights:3}));await assert.rejects(run(f,{...minimum,month:'2027-99'}));
});
test('missing, stale, foreign-currency or throwing hotel evidence never makes a free stay',async()=>{
 for(const provider of [{quote:()=>null},{quote:()=>{throw Error('private')}},{quote:()=>({nightlyUsd:20,currency:'EUR',source:'fixture'})},{quote:()=>({nightlyUsd:20,source:'fixture',observedAt:'2020-01-01'})}]){
  const f=fixture(8),r=await run(f,minimum,{accommodationProvider:provider});assert.equal(r.tours.length,0);assert.ok(r.diagnostics.missingHotelEvidence>0);
 }
 const f=fixture(8),r=await run(f,minimum);assert.ok(r.tours[0].stops.every(s=>s.hotel.costEvidence.source==='regional-planning-model'&&!s.hotel.costEvidence.bookable&&s.hotel.costEvidence.taxesAndFeesKnown===false));
});
test('hotel interface records rooms, quality, known whole-stay fees and explicit uncertainty',()=>{
 const request={cityId:'demo',checkIn:'2027-03-01',checkOut:'2027-03-05',rooms:2,quality:{minStars:4}};
 const provider=accommodation.fixtureProvider([{...request,nightlyUsd:100,taxesAndFeesUsd:35,stars:4,source:'synthetic-offline',observedAt:new Date(NOW).toISOString()}]);
 const q=accommodation.quote(request,{provider,now:NOW});assert.equal(q.estimatedTotalUsd,835);assert.equal(q.rooms,2);assert.equal(q.quality.verified,true);assert.equal(q.finalVerificationProvider,'Nuitee');
 assert.equal(accommodation.quote({...request,quality:{minStars:5}},{provider,now:NOW}),null);
 assert.equal(accommodation.quote({...request,checkOut:'2027-02-30'},{provider,now:NOW}),null);
});
test('known hotel quality and flight comfort affect scoring without inventing unknown quality',async()=>{
 const f=fixture(8);const provider={quote:r=>({nightlyUsd:40,stars:4,reviewScore:r.cityId===f.dest[0].unifiedRegistry.cityId?9:7,taxesAndFeesUsd:30,source:'synthetic-offline',observedAt:new Date(NOW).toISOString()})};
 const r=await run(f,{...minimum,flightComfort:'comfortable',hotelMinStars:4},{accommodationProvider:provider});assert.ok(r.tours.length);
 for(const t of r.tours){assert.ok(t.fareMap.scoreEvidence.comfortPenalty>0);assert.ok(t.fareMap.scoreEvidence.hotelQualityPenalty<0);assert.ok(t.stops.every(s=>s.hotel.costEvidence.quality.verified));assert.equal(t.totalHotelEstimateUsd,t.stops.reduce((sum,s)=>sum+s.hotel.estimatedStayUsd,0));}
 assert.equal((await run(f,{...minimum,hotelMinStars:5},{accommodationProvider:provider})).tours.length,0);
});
test('impossible known flight duration, missing return and tiny protected budget reject routes',async()=>{
 const f=fixture(8);for(const rows of f.map.values())rows.forEach(r=>r.durationMinutes=10000);
 assert.equal((await run(f,minimum)).tours.length,0);
 const missing=fixture(8);for(const [k,rows]of missing.map)missing.map.set(k,rows.filter(r=>r.destination!==missing.originCode));assert.equal((await run(missing,minimum)).tours.length,0);
 assert.equal((await run(f,{...minimum,budget:1,currency:'CAD'})).tours.length,0);
});
test('deadline cancels even a misbehaving reader and reports bounded incomplete coverage',async()=>{
 const f=fixture(8),start=performance.now();const r=await run(f,minimum,{readRoutes:()=>new Promise(()=>{}),timeBudgetMs:20});
 assert.ok(performance.now()-start<500);assert.equal(r.tours.length,0);assert.equal(r.diagnostics.bounded,true);assert.equal(r.reason,'fare-map-read-unavailable');
});

test('collector covers the exact rolling horizon plus 35-night returns at month-end and year rollover',()=>{
 const {collectionMonthCount}=require('../../backend/services/domain/fare-map/search-window');
 assert.equal(collectionMonthCount(Date.parse('2026-11-19T00:00:00Z')),8);
 assert.equal(collectionMonthCount(Date.parse('2027-01-31T00:00:00Z')),9);
 assert.equal(collectionMonthCount(Date.parse('2027-08-31T00:00:00Z')),9);
});
test('minimum hotel quality can select dearer evidence and never promotes low-rated cheap stays',async()=>{
 const f=fixture(8),cheap=f.dest[0].unifiedRegistry.cityId;
 const provider={quote:r=>({nightlyUsd:r.cityId===cheap?1:45,stars:r.cityId===cheap?2:4,reviewScore:8,source:'synthetic-offline',observedAt:new Date(NOW).toISOString()})};
 const r=await run(f,{...minimum,hotelMinStars:4},{accommodationProvider:provider});assert.ok(r.tours.length);assert.ok(r.tours.every(t=>t.stops.every(s=>s.cityId!==cheap)));
});
test('minimum input generated-tour preserves frontend contract and accommodation evidence',async()=>{
 const f=fixture(8),before=process.env.ENABLE_GENERATED_TOUR_651A;process.env.ENABLE_GENERATED_TOUR_651A='true';
 try{
  const r=await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour(minimum,{env:f.options.env,fareMap:{...f.options,rows:f.rows}});
  assert.ok(r.tour);assert.equal(r.tour.backendLegs.length,3);assert.equal(r.tour.cities.length,2);assert.equal(r.tour.itineraryDatePlan.consistent,true);
  assert.equal(r.tour.itineraryDatePlan.scanStartMonth,'2027-03');assert.ok(r.tour.stays.every(s=>s.hotel.costEvidence.rooms===1));
  assert.equal(r.tour.passengerPricing.travellers,2);
 }finally{if(before===undefined)delete process.env.ENABLE_GENERATED_TOUR_651A;else process.env.ENABLE_GENERATED_TOUR_651A=before;}
});

test('currency conversion retains the same internal totals and reserve for equivalent budgets',async()=>{
 const f=fixture(8),usd=await run(f,minimum),cad=await run(f,{...minimum,budget:5000/Number(process.env.CAD_TO_USD||.735),currency:'CAD'});
 assert.ok(usd.tours.length&&cad.tours.length);assert.equal(cad.tours[0].estimatedTotalUsd,usd.tours[0].estimatedTotalUsd);assert.equal(cad.tours[0].reserveAmountUsd,usd.tours[0].reserveAmountUsd);assert.equal(cad.tours[0].displayBudget.currency,'CAD');
 assert.equal(usd.tours[0].estimatedTotalUsd,Math.min(...usd.tours.map(t=>t.estimatedTotalUsd)));
});

test('an applied summary with cached or mismatched leg evidence cannot start hotel verification',async()=>{
 const f=fixture(8),before=process.env.ENABLE_GENERATED_TOUR_651A;process.env.ENABLE_GENERATED_TOUR_651A='true';
 try{for(const mismatch of ['cached-return','wrong-date','wrong-airport']){
  const r=await require('../../backend/services/domain/tours/generated-tour').getGeneratedTour(minimum,{env:{...f.options.env,ENABLE_IGNAV_FLIGHTS:'true',IGNAV_API_KEY:'offline',ENABLE_NUITEE_LIVE_STAYS:'true',NUITEE_SECRET_ID:'offline'},fareMap:{...f.options,rows:f.rows},
   applyIgnavLiveFares:async tour=>{
    const t=structuredClone(tour);t.legs.forEach(l=>{l.liveFareVerified=true;l.providerDateEvidence={...l.providerDateEvidence,sourceType:'LIVE',segments:[{arriveLocal:l.departureDate+'T19:00:00'}]}});
    if(mismatch==='cached-return')t.legs[2].providerDateEvidence.sourceType='CACHED';
    if(mismatch==='wrong-date')t.legs[0].departureDate='2027-03-02';
    if(mismatch==='wrong-airport')t.legs[0].from.airportCode='JFK';
    return {tour:t,summary:{applied:true}};
   },applyNuiteeLiveStays:()=>assert.fail('Invalid flight evidence must not trigger hotels')});
  assert.equal(r.tour,null);assert.equal(r.reason,'fare-map-incomplete-or-mismatched-live-evidence');
 }}finally{if(before===undefined)delete process.env.ENABLE_GENERATED_TOUR_651A;else process.env.ENABLE_GENERATED_TOUR_651A=before;}
});
