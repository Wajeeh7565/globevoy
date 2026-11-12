'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { preferSelectedExactFlights, usableTour } = require('../../backend/services/domain/live-fares/selected-flight-policy-005');
const pilot = require('../../backend/services/domain/live-fares/public-live-fare-pilot-684a');
const { usableDuffelEvidence } = require('../../backend/services/providers/flights/duffel/live-evidence-integrity-005');
const { classifyAgodaLandingUrl679AR1: classify } = require('../../backend/services/providers/stays/agoda/agoda');
const { enrichStay, enrichFlightLeg } = require('../../backend/services/providers/links/partner-links');
global.fetch = async () => { throw Error('Network forbidden in trip-accuracy tests'); };
const env = { ENABLE_DUFFEL_LIVE_683D:'true', ENABLE_DUFFEL_SHADOW_683D:'true',
  DUFFEL_ACCESS_TOKEN:'duffel_live_offline', ENABLE_BOC_FX_683G:'true',
  ENABLE_FX_NORMALIZATION_683G:'true', ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A:'true' };
const query = () => ({ adults:1, children:0, infants:0, currency:'USD' });
function tour(origin='YYZ') {
  const airports=[origin,'LHR','JFK',origin];
  return { origin:{airportCode:origin}, totalBudgetUsd:2000, estimatedTotalUsd:300, stops:[],
    legs:airports.slice(0,-1).map((airport,i)=>({mode:'flight',from:{airportCode:airport},
      to:{airportCode:airports[i+1]},departureDate:`2027-03-${20+i*3}`,distanceKm:1000,
      estimatedTransportUsd:100,estimatedFlightUsd:100,amountUsd:100})) };
}
const fx = async input => ({supported:input.providerCurrency==='USD' && input.displayCurrency==='USD',provider:'identity-no-conversion',providerAmount:input.providerAmount,
  providerCurrency:input.providerCurrency,displayAmount:input.providerAmount,displayCurrency:input.displayCurrency,
  crossRate:1,rateDate:null,conversionApplied:false,originalProviderEvidencePreserved:true});
function raw(args, extra={}) { return {supported:true, observations:[{...args,currency:'USD',totalPrice:120,price:120,
  fareAmountBasis:'party-total',providerPartyTotalAmount:Object.hasOwn(extra,'totalPrice')?extra.totalPrice:120,
  providerPassengerCount:extra.passengers||args.passengers||1,
  passengers:1,airline:'Offline fixture',stops:0,transfers:0,durationMinutes:120,liveMode:true,
  source:'duffel-live-683d',providerReference:'offline-offer',observedAt:new Date().toISOString(),
  expiresAt:new Date(Date.now()+3600000).toISOString(),...extra}]}; }
function harness(overrides={}) {
  let searches=0,fallbacks=0,active=0,peak=0;
  return { options:{env,exactDates:true,normalizeFx:fx,
    searchExact:async args=>{searches++;active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return raw(args);},
    fallback:async t=>{fallbacks++;return {tour:t,summary:{source:'existing-planning'}};},...overrides},
    counts:()=>({searches,fallbacks,peak}) };
}
test('selected exact schedule uses the existing bounded Duffel pilot once per request',async()=>{
  const h=harness(),t=tour(),q=query();
  const [a,b]=await Promise.all([preferSelectedExactFlights(t,q,h.options),preferSelectedExactFlights(t,q,h.options)]);
  assert.equal(a.selectedScheduleLiveFare.summary.applied,true);
  assert.equal(b.tour,a.tour); assert.equal(usableTour(a.tour,q),true);
  assert.deepEqual(h.counts(),{searches:3,fallbacks:0,peak:2});
  assert.equal(a.tour.estimatedTotalUsd,360,'party totals are not multiplied again');
  assert.equal(a.summary.providerSelection.referralPriceGuaranteed,false);
  const lowBudget={...tour(),totalBudgetUsd:320};
  const expensive=await preferSelectedExactFlights(lowBudget,query(),h.options);
  assert.equal(expensive.tour.estimatedTotalUsd,360,'real cost cannot be replaced with the cheaper estimate');
  assert.equal(expensive.selectedScheduleLiveFare.summary.overBudget,true);
  const beforeReuse=h.counts().searches;
  const reused=await pilot.applyPublicLiveFarePilot684A(a.tour,q,h.options);
  assert.equal(reused.summary.applied,true);assert.equal(h.counts().searches,beforeReuse);
  await preferSelectedExactFlights(t,query(),h.options);assert.equal(h.counts().searches,beforeReuse+3,'new request owns independent offers');
});
for(const [name,options,q,t] of [
  ['flexible discovery',{exactDates:false},query(),tour()],
  ['disabled gate',{env:{...env,ENABLE_DUFFEL_PUBLIC_LIVE_FARE_PILOT_684A:'false'}},query(),tour()],
  ['children',{}, {...query(),children:1},tour()],
  ['infants',{}, {...query(),infants:1},tour()],
  ['two production adults',{}, {...query(),adults:2},tour()],
  ['unapproved origin',{},query(),tour('LHR')]
]) test(name+' preserves existing fallback without provider calls',async()=>{
  const h=harness(options),r=await preferSelectedExactFlights(t,q,h.options);
  assert.equal(r.tour,t);assert.deepEqual(h.counts(),{searches:0,fallbacks:1,peak:0});
});
test('additional approved origin retains airport gate',async()=>{
  const h=harness();
  assert.equal(pilot.eligibility684A(tour('JFK'),query(),env).eligible,true);
  assert.equal((await preferSelectedExactFlights(tour('JFK'),query(),h.options)).selectedScheduleLiveFare.summary.applied,true);
});
test('failed provider remains an estimate and does not retry at final verification',async()=>{
  let calls=0;
  const h=harness({searchExact:async()=>{calls++;return {supported:false,reason:'offline-unavailable',observations:[]};}});
  const t=tour(),q=query(),r=await preferSelectedExactFlights(t,q,h.options);
  assert.equal(r.selectedScheduleLiveFare.summary.applied,false);
  assert.equal(r.summary.providerSelection.priceSource,'cached-or-estimated');
  assert.equal(h.counts().fallbacks,1);assert.ok(calls<=12);
  const firstCalls=calls;
  await preferSelectedExactFlights(t,q,h.options);assert.equal(h.counts().fallbacks,2);
  assert.equal(calls,firstCalls,'memoized failed search must not repeat');
});
test('offer reuse fails closed for expiry, missing fields and conflicting party/route/date',async()=>{
  const h=harness(),q=query(),r=await preferSelectedExactFlights(tour(),q,h.options);
  const e=r.tour.legs[0].providerDateEvidence;
  assert.equal(usableDuffelEvidence(e,{origin:'YYZ',destination:'LHR',departureDate:'2027-03-20',passengers:1}),true);
  for(const patch of [{expiresAt:null},{expiresAt:'2020-01-01T00:00:00Z'},{liveMode:false},
    {departureDate:'2027-03-21'},{departureDate:'2027-02-30'},{providerPassengerCount:2},
    {resolvedOrigin:'LAX'},{fareAmountBasis:'per-person'},{providerCurrency:'invalid'},{providerPartyTotalAmount:0}]) {
    assert.equal(usableDuffelEvidence({...e,...patch},{origin:'YYZ',destination:'LHR',departureDate:'2027-03-20',passengers:1}),false,JSON.stringify(patch));
    const copy=structuredClone(r.tour);copy.legs[0].providerDateEvidence={...e,...patch};
    assert.equal(pilot._internal.completeAppliedEvidence684A(copy,q).complete,false);
  }
  const leg=enrichFlightLeg(r.tour.legs[0],q);
  assert.equal(leg.priceProvenance.provider,'Duffel');assert.equal(leg.booking.provider,'Aviasales');
  assert.equal(leg.booking.exactItineraryHint,false);assert.equal(leg.booking.exactTicketClaimed,false);
  const expired=enrichFlightLeg({...r.tour.legs[0],cheapestOneWay:{...e,expiresAt:null},providerDateEvidence:{...e,expiresAt:null}},q);
  assert.equal(expired.booking.trust.sourceType,'UNAVAILABLE');
  const verifier=require('../../backend/services/domain/live-fares/live-provider-verification')._internal;
  const checked=await verifier.verifyFlightLeg({...r.tour.legs[0],providerDateEvidence:{...e,expiresAt:null}},q,{});
  assert.equal(checked.leg.liveFareVerified,false);
  assert.equal(checked.leg.providerVerification.verified,false);
  assert.equal(checked.leg.providerDateEvidence.sourceType,'UNAVAILABLE');
});
for (const [name,patch] of [['expired',{expiresAt:'2020-01-01T00:00:00Z'}],['wrong airport',{origin:'LAX'}],
  ['wrong date',{departureDate:'2027-04-01'}],['sandbox',{liveMode:false}],['unsupported currency',{currency:'ZZZ'}]])
test(name+' provider response cannot become live selected evidence',async()=>{
  const h=harness({searchExact:async args=>raw(args,patch)});
  const r=await preferSelectedExactFlights(tour(),query(),h.options);
  assert.equal(r.selectedScheduleLiveFare.summary.applied,false);
  assert.equal(r.summary.providerSelection.priceSource,'cached-or-estimated');
});
function stay(url,extra={}) { return {city:'Toronto',agodaCityId:16433,arrivalDate:'2027-03-20',departureDate:'2027-03-23',nights:3,
  hotel:{provider:'agoda',agodaHotelId:42,hotelUrl:url,estimatedStayUsd:300,...extra}}; }
test('only provider-supplied trusted matching Agoda URLs can be property referrals',()=>{
  for(const url of ['https://notagoda.com/x/hotel/y.html','https://agoda.com.evil.test/x/hotel/y.html',
    'https://user:pass@agoda.com/x/hotel/y.html','https://agoda.com:8443/x/hotel/y.html',
    'https://agoda.com/partners/partnersearch.aspx?hid=43','https://agoda.com/partners/partnersearch.aspx?hid=42&hotelid=43'])
    assert.equal(classify(url,42).url,null,url);
  const url='https://www.agoda.com/example/hotel/toronto-ca.html?hid=42&cid=123&tag=hello%20world&children=2';
  const result=enrichStay(stay(url),{...query(),adults:2,rooms:2,currency:'CAD'}).hotel;
  const link=new URL(result.booking.url);
  assert.equal(link.pathname,'/example/hotel/toronto-ca.html');assert.equal(link.searchParams.get('hid'),'42');
  assert.equal(link.searchParams.get('cid'),'123');assert.equal(link.searchParams.get('tag'),'hello world');
  assert.equal(link.searchParams.get('children'),'0');assert.equal(link.searchParams.get('currency'),'CAD');
  assert.equal(result.booking.specificHotel,true);assert.equal(result.booking.checkIn,'2027-03-20');
  assert.equal(result.booking.passengers.rooms,2);assert.equal(result.booking.trust.currentPriceConfirmed,false);
});
test('partner search is honestly labelled and stale hotel prices lose LIVE status',()=>{
  const url='https://www.agoda.com/partners/partnersearch.aspx?hid=42&NumberofChildren=2';
  const hotel=enrichStay(stay(url,{source:'agoda',checkIn:'2027-02-20',checkOut:'2027-02-23',
    priceEvidence:{sourceType:'LIVE'},providerVerification:{verified:true,exactStayDates:true,productionEligible:true}}),query()).hotel;
  const link=new URL(hotel.booking.url);
  assert.equal(hotel.booking.specificHotel,false);assert.equal(hotel.booking.status,'provider-search-results');
  assert.equal(link.searchParams.get('checkin'),'2027-03-20');assert.equal(link.searchParams.get('checkout'),'2027-03-23');
  assert.equal(link.searchParams.get('NumberofChildren'),'0');assert.equal(link.searchParams.get('Rooms'),'1');
  assert.equal(hotel.booking.trust.sourceType,'ESTIMATED');assert.equal(hotel.booking.finalPriceRequiresPartnerConfirmation,true);
  assert.equal(enrichStay({...stay(url),departureDate:'2027-03-19'},query()).hotel.booking.url,null);
  const rejected=enrichStay({...stay(url,{providerHotel:{provider:'Agoda',hotelId:42,bookingUrl:url}}),departureDate:'2027-03-19'},query()).hotel;
  assert.equal(rejected.providerHotel.bookingUrl,null);assert.equal(rejected.hotelUrl,null);
});
test('Nuitee identity is retained without inventing an Agoda mapping or property URL',()=>{
  const input=stay(null,{provider:'nuitee',hotelId:'nuitee-42',agodaHotelId:null});
  const hotel=enrichStay(input,query()).hotel;
  assert.equal(hotel.hotelId,'nuitee-42');assert.equal(hotel.booking.selectedProviderHotelId,null);
  assert.equal(hotel.booking.specificHotel,false);assert.equal(hotel.booking.status,'prefilled-city-search');
  assert.equal(new URL(hotel.booking.url).searchParams.has('hid'),false);
});
test('hotel LIVE evidence requires the same observed stay and room occupancy',()=>{
  const url='https://www.agoda.com/partners/partnersearch.aspx?hid=42';
  const observation={source:'agoda',checkIn:'2027-03-20',checkOut:'2027-03-23',
    providerVerification:{hotelId:42,verified:true,exactStayDates:true,productionEligible:true,party:{adults:1,children:0,rooms:1}}};
  const input=stay(url,observation);
  assert.equal(enrichStay(input,query()).hotel.booking.trust.sourceType,'LIVE');
  assert.equal(enrichStay(input,{...query(),adults:2,rooms:2}).hotel.booking.trust.sourceType,'ESTIMATED');
  const alternative='https://www.agoda.com/exact/hotel/toronto-ca.html?hid=42';
  const selected=enrichStay(stay(url,{providerHotel:{provider:'Agoda',hotelId:42,bookingUrl:alternative}}),query());
  assert.equal(selected.hotel.booking.specificHotel,true);
  assert.equal(new URL(selected.hotel.booking.url).pathname,'/exact/hotel/toronto-ca.html');
  assert.equal(selected.hotel.providerHotel.bookingUrl,selected.hotel.booking.url,'legacy consumers receive the validated date/guest context');
});
test('overnight arrival sets hotel check-in without shifting the onward priced flight',()=>{
  const { _internal: dates }=require('../../backend/services/domain/tours/generated-tour');
  const legs=[{mode:'flight',departureDate:'2027-03-20',liveFareVerified:true,
    cheapestOneWay:{providerBacked:true,appliedToEstimate:true,departureDate:'2027-03-20',arrivalDate:'2027-03-21'}},
    {mode:'flight',departureDate:'2027-03-23',liveFareVerified:true,
      cheapestOneWay:{providerBacked:true,appliedToEstimate:true,departureDate:'2027-03-23'}}];
  const stops=dates.synchronizeStopsWithLegDates([{city:'London',nights:3}],legs);
  assert.equal(stops[0].arrivalDate,'2027-03-21');assert.equal(stops[0].departureDate,'2027-03-24');
  assert.equal(legs[1].departureDate,'2027-03-23');
  assert.equal(dates.itineraryDateConsistency(stops,legs).consistent,false);
  const valid=dates.synchronizeStopsWithLegDates([{city:'London',nights:2}],legs);
  assert.equal(valid[0].departureDate,'2027-03-23');
  assert.equal(dates.itineraryDateConsistency(valid,legs).consistent,true);
  const handoff=enrichStay({...stay('https://www.agoda.com/partners/partnersearch.aspx?hid=42'),...valid[0]},query());
  assert.equal(new URL(handoff.hotel.booking.url).searchParams.get('checkin'),'2027-03-21');
});

test('impossible flight dates are rejected before any provider request',async()=>{
  const adapter=require('../../backend/services/providers/flights/duffel/duffel-live-adapter-683d');
  for(const departureDate of ['2027-02-29','2027-02-30','2027-04-31','2027-13-01']) {
    let requests=0;
    const result=await adapter.searchExactDate683D({origin:'YYZ',destination:'LHR',departureDate,passengers:1,currency:'USD'},
      {env,fetch:async()=>{requests++;throw Error('Invalid date reached provider')}});
    assert.equal(requests,0,departureDate);assert.equal(result.supported,false);
  }
  assert.equal(adapter.validateExactSearch683D({origin:'YYZ',destination:'LHR',departureDate:'2028-02-29',passengers:1,currency:'USD'}).valid,true);
});

test('invalid explicit hotel checkout is not silently replaced with a calculated date',()=>{
  const input=stay('https://www.agoda.com/partners/partnersearch.aspx?hid=42');
  assert.equal(enrichStay({...input,departureDate:'2027-02-30'},query()).hotel.booking.url,null);
  const missing={...input,departureDate:null};
  assert.equal(enrichStay(missing,query()).hotel.booking.checkOut,'2027-03-23');
});

for(const statusCode of [401,429,500])test('mock HTTP '+statusCode+' cannot become successful live pricing',async()=>{
  let calls=0;
  const h=harness({searchExact:async()=>{calls++;return {supported:false,statusCode,observations:[],
    reason:'mock-provider-failure',errorCode:statusCode===401?'expired_access_token':statusCode===429?'rate_limit_exceeded':'api_error'};}});
  const result=await preferSelectedExactFlights(tour(),query(),h.options);
  assert.equal(result.selectedScheduleLiveFare.summary.applied,false);
  assert.equal(result.summary.providerSelection.priceSource,'cached-or-estimated');
  assert.ok(calls<=12,'failures remain inside the shared request ceiling');
  if(statusCode===401||statusCode===429)assert.ok(calls<=2,'no requests beyond the initially dispatched bounded batch');
});

test('missing and zero provider prices remain planning estimates',async()=>{
  for(const patch of [{price:null,totalPrice:null},{price:0,totalPrice:0},{price:-1,totalPrice:-1}]) {
    const h=harness({searchExact:async args=>raw(args,patch)});
    const result=await preferSelectedExactFlights(tour(),query(),h.options);
    assert.equal(result.selectedScheduleLiveFare.summary.applied,false);
    assert.equal(result.summary.providerSelection.priceSource,'cached-or-estimated');
  }
});

test('explicit provider passenger mismatches cannot masquerade as the requested party',()=>{
  const adapter=require('../../backend/services/providers/flights/duffel/duffel-live-adapter-683d');
  const request={origin:'YYZ',destination:'LHR',departureDate:'2027-03-20',passengers:1,currency:'USD'};
  const context={requestLiveMode:true,nowMs:Date.now(),retrievedAt:new Date().toISOString()};
  const offer={live_mode:true,total_amount:'500.00',total_currency:'USD',expires_at:new Date(Date.now()+3600000).toISOString(),
    slices:[{origin:{iata_code:'YYZ'},destination:{iata_code:'LHR'},segments:[{departing_at:'2027-03-20T18:00:00',arriving_at:'2027-03-21T06:00:00'}]}]};
  assert.ok(adapter.normalizeLiveOffer683D({...offer,passengers:[{id:'one',type:'adult'}]},request,context));
  const twoAdults=adapter.normalizeLiveOffer683D({...offer,passengers:[{id:'one',type:'adult'},{id:'two',type:'adult'}]},
    {...request,passengers:2},context);
  assert.equal(twoAdults.providerPassengerCount,2);
  assert.equal(twoAdults.providerPartyTotalAmount,500);
  assert.equal(twoAdults.arrivalDate,'2027-03-21');
  for(const passengers of [[],null,[null],['adult'],[42],[[]],[{id:'one'},{id:'two'}],[{id:'one',type:'child'}]])
    assert.equal(adapter.normalizeLiveOffer683D({...offer,passengers},request,context),null);
});

test('additional approved origins and display currencies retain consistent itinerary totals',async()=>{
  for(const [origin,currency] of [['YYZ','USD'],['JFK','CAD'],['LAX','EUR'],['DUB','GBP'],['DXB','AUD']]) {
    const h=harness({normalizeFx:async input=>{
      const rate={USD:1,CAD:1.4,EUR:0.95,GBP:0.8,AUD:1.5}[input.displayCurrency];
      return {supported:true,provider:'offline-fx',providerAmount:input.providerAmount,
        providerCurrency:input.providerCurrency,displayAmount:input.providerAmount*rate,displayCurrency:input.displayCurrency,
        crossRate:rate,rateDate:'2026-11-12',conversionApplied:input.displayCurrency!=='USD',originalProviderEvidencePreserved:true};
    }});
    const q={...query(),currency},t=tour(origin);
    const result=await preferSelectedExactFlights(t,q,h.options);
    assert.equal(result.selectedScheduleLiveFare.summary.applied,true,origin+'/'+currency);
    assert.equal(usableTour(result.tour,q),true);assert.equal(result.tour.estimatedTotalUsd,360);
    for(const leg of result.tour.legs)assert.equal(leg.providerDateEvidence.providerCurrency,'USD');
  }
});

test('two adults require the existing staging scope and retain party-total arithmetic',async()=>{
  const q={...query(),adults:2};
  const h=harness({env:{...env,CORS_ORIGIN:'https://staging.dy4fw8gx1ccie.amplifyapp.com',GV_DUFFEL_MAX_ADULTS_703E:'2'},
    searchExact:async args=>raw(args,{passengers:2})});
  const result=await preferSelectedExactFlights(tour(),q,h.options);
  assert.equal(result.selectedScheduleLiveFare.summary.applied,true);
  assert.equal(result.tour.estimatedTotalUsd,360);
  for(const leg of result.tour.legs) {
    assert.equal(leg.providerDateEvidence.providerPassengerCount,2);
    assert.equal(leg.providerDateEvidence.providerPartyTotalAmount,120);
  }
});


test('Duffel referral uses selected dates and fresh matching evidence ahead of cached discovery',async()=>{
  const q=query(),r=await preferSelectedExactFlights(tour(),q,harness().options),leg=r.tour.legs[0],e=leg.providerDateEvidence;
  const enriched=enrichFlightLeg({...leg,cheapestOneWay:{source:'travelpayouts-cache',sourceType:'CACHED',departureDate:'2027-03-19'},providerDateEvidence:e},q);
  assert.equal(enriched.priceProvenance.provider,'Duffel');assert.equal(enriched.booking.label,'Compare flights on Aviasales');
  assert.equal(enriched.booking.referralPriceGuaranteed,false);assert.equal(enriched.booking.exactTicketClaimed,false);
  assert.match(enriched.booking.directSearchUrl,/YYZ2003LHR1/);
  for(const patch of [{departureDate:'2027-03-19'},{resolvedDestination:'JFK'},{providerPassengerCount:2},{displayCurrency:'EUR'},{expiresAt:'2020-01-01T00:00:00Z'}]){
    const bad=enrichFlightLeg({...leg,providerDateEvidence:{...e,...patch},cheapestOneWay:{...e,...patch}},q);
    assert.equal(bad.booking.trust.sourceType,'UNAVAILABLE');assert.equal(bad.priceProvenance.currentPriceConfirmed,false);
    assert.match(bad.booking.directSearchUrl,/YYZ2003LHR1/,'independent comparison retains SELECTED itinerary');
  }
});

test('comparison links preserve adult/child/infant counts and never silently clamp unsupported parties',()=>{
 const {buildAviasalesOneWaySearchUrl:build}=require('../../backend/services/providers/links/partner-links');
 const request={origin:'YYZ',destination:'LHR',departureDate:'2027-03-20',adults:2,children:1,infants:1};
 assert.match(build(request),/YYZ2003LHR211$/);assert.equal(build({...request,adults:10}),null);assert.equal(build({...request,adults:1,infants:2}),null);assert.equal(build({...request,departureDate:'2027-02-30'}),null);
});

test('hotel observation identity and expiry cannot certify another selected property',()=>{
 const input=stay('https://www.agoda.com/exact/hotel/toronto-ca.html?hid=42',{source:'agoda',checkIn:'2027-03-20',checkOut:'2027-03-23',priceEvidence:{sourceType:'LIVE'},providerVerification:{hotelId:43,verified:true,exactStayDates:true,productionEligible:true,party:{adults:1,children:0,rooms:1}}});
 assert.equal(enrichStay(input,query()).hotel.booking.trust.sourceType,'ESTIMATED');
 input.hotel.providerVerification.hotelId=42;input.hotel.providerVerification.expiresAt='2020-01-01T00:00:00Z';assert.equal(enrichStay(input,query()).hotel.booking.trust.sourceType,'ESTIMATED');
 const valid=structuredClone(input);delete valid.hotel.providerVerification.expiresAt;assert.equal(enrichStay(valid,query()).hotel.booking.trust.sourceType,'LIVE');assert.equal(enrichStay(valid,query()).hotel.booking.handoffPropertyVerified,true);
 for(const patch of [{propertyId:43},{checkIn:'2027-03-19'},{checkOut:'2027-03-24'},{currency:'EUR'}]){const conflicting=structuredClone(valid);conflicting.hotel.priceEvidence={sourceType:'LIVE',...patch};assert.equal(enrichStay(conflicting,query()).hotel.booking.trust.sourceType,'ESTIMATED');}
});
