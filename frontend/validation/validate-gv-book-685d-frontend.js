'use strict';
const outputPath = require('./output-path');
const FRONTEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert=require('node:assert/strict');
const fs=require('node:fs');
const hub=require('../scripts/booking-hub-685d.js');
const confidence=require('../scripts/budget-confidence-685b.js');

let passed=0;
const checks=[];
function check(name,fn){try{fn();passed+=1;checks.push({name,passed:true});console.log(`PASS ${name}`);}catch(error){checks.push({name,passed:false,error:error.message});throw error;}}
function params(values={}){return new URLSearchParams(values);}

function flight(from,to,date,amount,overrides={}){
  return{from,to,mode:'flight',departureDate:date,distanceKm:700,estimatedDisplayTotal:amount,...overrides};
}
function city(city,code,country){return{city,code,airportCode:code,country};}

const toronto=city('Toronto','YYZ','Canada');
const mexicoCity=city('Mexico City','MEX','Mexico');
const merida=city('Merida','MID','Mexico');
const aviasalesOne='https://www.aviasales.com/search/YYZ0111MEX2?marker=globevoy-test';
const agodaMexico='https://www.agoda.com/search?city=Mexico%20City&checkIn=2026-11-01&checkOut=2026-11-05&rooms=1&adults=2&cid=1891461';
const agodaMerida='https://www.agoda.com/search?city=Merida&checkIn=2026-11-05&checkOut=2026-11-08&rooms=1&adults=2&cid=1891461';

function twoCityTour(){
  const first=flight(toronto,mexicoCity,'2026-11-01',420,{
    liveFareVerified:true,
    estimateSource:'duffel-public-live-fare-evidence-pilot-684a',
    providerDateEvidence:{providerBacked:true,productionEligible:true,appliedToEstimate:true,departureDate:'2026-11-01',airline:'AC',stops:0,durationMinutes:300,providerReference:'duffel_offer_1',source:'duffel-live-683d',sourceType:'LIVE',liveMode:true,fareAmountBasis:'party-total',providerPartyTotalAmount:420,providerCurrency:'CAD',currency:'CAD',providerPassengerCount:2,origin:'YYZ',destination:'MEX',expiresAt:new Date(Date.now()+3600000).toISOString(),priceEvidence:{sourceType:'LIVE'},publicLiveFareEvidence684A:{version:'GV-FLIGHT-684A'}},
    booking:{directSearchUrl:aviasalesOne}
  });
  const second=flight(mexicoCity,merida,'2026-11-05',180,{booking:{directSearchUrl:'https://www.aviasales.com/search/MEX0511MID2?marker=globevoy-test'}});
  const third=flight(merida,toronto,'2026-11-08',390,{booking:{directSearchUrl:'https://www.aviasales.com/search/MID0811YYZ2?marker=globevoy-test'}});
  return{
    origin:toronto,
    cities:[mexicoCity,merida],
    legs:[first,second,third],backendLegs:[first,second,third],
    stays:[
      {...mexicoCity,nights:4,arrivalDate:'2026-11-01',departureDate:'2026-11-05',hotel:{estimatedDisplayTotal:640,providerHotel:{provider:'Agoda',hotelId:'ag_1',hotelName:'Centro Reforma Hotel',bookingUrl:agodaMexico},providerVerification:{verified:true,productionEligible:true,provider:'Agoda',sourceType:'LIVE'},priceEvidence:{sourceType:'LIVE'}}},
      {...merida,nights:3,arrivalDate:'2026-11-05',departureDate:'2026-11-08',hotel:{estimatedDisplayTotal:390,bookingUrl:agodaMerida,priceEvidence:{sourceType:'PLANNING'}}}
    ],
    budget:{total:{amount:2500,currency:'CAD'},estimatedCoreTotal:{amount:2020,currency:'CAD'}},
    canonicalPricing:{canonicalDisplayTotal:2020,exchangeRateFromUsd:1.36},
    passengerPricing:{adults:2,children:0,travellers:2,rooms:1},
    liveProviderVerification:{criticalCount:5,verifiedCount:2,allCriticalVerified:false,budgetClaim:'estimated-to-fit-budget'}
  };
}

function oneCityTour(){
  const outbound=flight(toronto,mexicoCity,'2026-12-02',410,{booking:{directSearchUrl:'https://www.aviasales.com/search/YYZ0212MEX1?marker=globevoy-test'}});
  const inbound=flight(mexicoCity,toronto,'2026-12-06',405,{booking:{directSearchUrl:'https://www.aviasales.com/search/MEX0612YYZ1?marker=globevoy-test'}});
  return{origin:toronto,cities:[mexicoCity],legs:[outbound,inbound],stays:[{...mexicoCity,nights:4,hotel:{estimatedDisplayTotal:520,bookingUrl:'https://www.agoda.com/search?city=Mexico%20City&checkIn=2026-12-02&checkOut=2026-12-06&rooms=1&adults=1&cid=1891461'}}],budget:{total:{amount:1800,currency:'CAD'}},displayBudget:{tripEstimate:1335,currency:'CAD'},passengerPricing:{travellers:1,rooms:1}};
}

const two=twoCityTour();
const twoModel=hub.buildJourney(two,params({currency:'CAD'}));
const one=oneCityTour();
const oneModel=hub.buildJourney(one,params({currency:'CAD'}));

check('1: one-city trip renders outbound flight, stay and return flight',()=>{
  assert.deepEqual(oneModel.items.map(item=>item.kind),['flight','stay','flight']);
  assert.equal(oneModel.flightCount,2);assert.equal(oneModel.stayCount,1);
});
check('2: two-city multi-city trip is one coherent five-item journey',()=>{
  assert.deepEqual(twoModel.items.map(item=>item.kind),['flight','stay','flight','stay','flight']);
});
check('3: all flight legs are visible',()=>{
  assert.equal(twoModel.flightCount,3);assert.deepEqual(twoModel.items.filter(item=>item.kind==='flight').map(item=>item.title),['Toronto → Mexico City','Mexico City → Merida','Merida → Toronto']);
});
check('4: all hotel stays are visible without inventing an unverified property name',()=>{
  const stayItems=twoModel.items.filter(item=>item.kind==='stay');assert.equal(stayItems.length,2);assert.equal(stayItems[0].title,'Centro Reforma Hotel');assert.equal(stayItems[1].title,'Merida stay');
});
check('5: chronology interleaves each destination stay after its inbound flight',()=>{
  assert.deepEqual(twoModel.items.map(item=>item.title),['Toronto → Mexico City','Centro Reforma Hotel','Mexico City → Merida','Merida stay','Merida → Toronto']);
});
check('6: flight and stay dates remain correct',()=>{
  assert.deepEqual(twoModel.items.filter(item=>item.kind==='flight').map(item=>item.date),['2026-11-01','2026-11-05','2026-11-08']);
  assert.deepEqual(twoModel.items.filter(item=>item.kind==='stay').map(item=>[item.checkIn,item.checkOut]),[['2026-11-01','2026-11-05'],['2026-11-05','2026-11-08']]);
});
check('7: total budget and current total are evaluated and shown',()=>{
  const state=hub.confidenceFor(two,params({currency:'CAD'}),confidence);assert.equal(state.budget,2500);assert.equal(state.total,2020);assert.equal(state.currency,'CAD');
});
check('8: whole-group budget wording is explicit',()=>{
  const html=fs.readFileSync(require('node:path').join(FRONTEND_ROOT, 'pages/booking.html'),'utf8');const script=fs.readFileSync(require('node:path').join(FRONTEND_ROOT, 'scripts/booking-hub-685d.js'),'utf8');assert.match(html,/Whole-group budget/);assert.match(html,/whole travelling group/i);assert.match(script,/not per-person/);
});
check('9: Duffel evidence stays distinct from Aviasales fulfilment',()=>{
  const item=twoModel.items[0],html=hub.componentHtml(item,1);assert.equal(item.evidence.label,'Fare observed via Duffel — not reserved');assert.equal(item.partner,'Aviasales');assert.match(html,/Fare observed via Duffel/);assert.match(html,/External fulfilment · Aviasales/);assert.doesNotMatch(html,/fare observed via Aviasales/i);
});
check('10: Aviasales links retain exact routes, dates and tracking',()=>{
  const urls=twoModel.items.filter(item=>item.kind==='flight').map(item=>item.url);assert.equal(urls[0],aviasalesOne);assert.match(urls[1],/MEX0511MID2/);assert.match(urls[2],/MID0811YYZ2/);assert.ok(urls.every(url=>url.includes('marker=globevoy-test')));
});
check('11: Agoda links retain city, dates, rooms, guests and CID',()=>{
  const urls=twoModel.items.filter(item=>item.kind==='stay').map(item=>item.url);assert.equal(new URL(urls[0]).searchParams.get('city'),'Mexico City');assert.equal(new URL(urls[1]).searchParams.get('city'),'Merida');for(const url of urls){assert.match(url,/checkIn=2026-11-0[15]/);assert.match(url,/checkOut=2026-11-0[58]/);assert.match(url,/rooms=1/);assert.match(url,/adults=2/);assert.match(url,/cid=1891461/);}
});
check('12: provider-backed, partial and verification-required 685B labels survive',()=>{
  const partial=hub.confidenceFor(two,params(),confidence);assert.equal(partial.label,'Planning estimate — verify price');
  const providerTour={...two,liveProviderVerification:{criticalCount:5,verifiedCount:5,allCriticalVerified:true,budgetClaim:'provider-backed-fit'}};assert.equal(hub.confidenceFor(providerTour,params(),confidence).estimated,true,'summary flags cannot certify estimated hotels');
  const unverified={...two,liveProviderVerification:{criticalCount:5,verifiedCount:0}};assert.equal(hub.confidenceFor(unverified,params(),confidence).label,'Price verification required');
  const over={...providerTour,canonicalPricing:{...providerTour.canonicalPricing,canonicalDisplayTotal:2600}};assert.equal(hub.confidenceFor(over,params(),confidence).label,'Over budget');
});
check('13: active booking hub never says Estimated to fit budget',()=>{
  const source=fs.readFileSync(require('node:path').join(FRONTEND_ROOT, 'scripts/booking-hub-685d.js'),'utf8')+fs.readFileSync(require('node:path').join(FRONTEND_ROOT, 'pages/booking.html'),'utf8');assert.doesNotMatch(source,/Estimated to fit budget/);
});
check('14: mobile layout has bounded single-column cards and no horizontal table',()=>{
  const css=fs.readFileSync(require('node:path').join(FRONTEND_ROOT, 'styles/booking-hub-685d.css'),'utf8');assert.match(css,/@media\(max-width:760px\)/);assert.match(css,/\.gv-booking-journey-card\{grid-template-columns:1fr/);assert.match(css,/min-width:0/);assert.doesNotMatch(css,/table-layout|overflow-x:\s*(auto|scroll)/);
});
check('15: malformed optional provider details degrade safely',()=>{
  const malformed={origin:{city:'Toronto'},cities:[{city:'Unknown City'}],legs:[{from:{city:'Toronto'},to:{city:'Unknown City'},mode:'flight',departureDate:'bad-date'}],stays:[{city:'Unknown City',hotel:{}}],budget:{total:{amount:1000,currency:'CAD'}},passengerPricing:{travellers:1,rooms:1}};const model=hub.buildJourney(malformed,params()),rendered=model.items.map((item,index)=>hub.componentHtml(item,index+1)).join('');assert.equal(model.items.length,2);assert.match(rendered,/Date to confirm/);assert.match(rendered,/Price to confirm/);assert.match(rendered,/Partner link pending/);assert.doesNotMatch(rendered,/undefined|null|NaN/);
});

check('integration: booking HTML loads 685B confidence before 685D and keeps semantic timeline',()=>{
  const html=fs.readFileSync(require('node:path').join(FRONTEND_ROOT, 'pages/booking.html'),'utf8'),trustIndex=html.indexOf('budget-confidence-685b.js?v=685b'),hubIndex=html.indexOf('booking-hub-685d.js?v=685d');assert.ok(trustIndex>=0&&hubIndex>trustIndex);assert.match(html,/<ol id="gv-booking-timeline"/);assert.match(html,/Book with partners/);
});
check('scope: no payment, order, backend, credential or one-click checkout expansion',()=>{
  const source=fs.readFileSync(require('node:path').join(FRONTEND_ROOT, 'scripts/booking-hub-685d.js'),'utf8');assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|\/air\/orders|createOrder\s*\(|createBooking\s*\(|payment_intent|DUFFEL_ACCESS_TOKEN|AGODA_[A-Z_]+/i);assert.doesNotMatch(source,/book everything|one.click/i);
});

check('16: expiry/matching checks cannot promote malformed Duffel evidence',()=>{
 const original=twoCityTour().legs[0];for(const patch of [{expiresAt:'2020-01-01T00:00:00Z'},{departureDate:'2027-01-01'},{origin:'JFK'},{providerPassengerCount:3},{displayCurrency:'USD'},{liveMode:false}]){
  const leg={...original,providerDateEvidence:{...original.providerDateEvidence,...patch}};const e=hub.flightEvidence(leg,{travellers:2,children:0,infants:0,currency:'CAD'});assert.equal(e.observed,false);assert.equal(e.sourceType,'UNAVAILABLE');assert.doesNotMatch(e.label,/not reserved/);
 }
 assert.equal(hub.safeDate('2027-02-30'),'');
 const airport={...original,from:{city:'Toronto',displayCode:'YTO',airportCode:'YYZ'}};assert.equal(hub.flightEvidence(airport,{travellers:2,children:0,infants:0,currency:'CAD'}).observed,true,'display metro code must not replace the priced airport');
});
check('17: property handoffs differ from comparison searches and raw saved URLs cannot override context',()=>{
 const stay={arrivalDate:'2027-03-20',departureDate:'2027-03-23',hotel:{provider:'Agoda',agodaHotelId:42,providerHotel:{provider:'Agoda',hotelId:42,bookingUrl:'https://www.agoda.com/wrong/hotel/old.html?hid=43'},booking:{url:'https://www.agoda.com/exact/hotel/toronto.html?hid=42&checkIn=2020-01-01&NumberofAdults=1&adults=4'}}};
 const group={adults:2,children:1,rooms:2,currency:'USD'};const referral=hub.stayReferral(stay,group);assert.equal(referral.exact,true);const url=new URL(referral.url);assert.equal(url.searchParams.get('checkIn'),'2027-03-20');assert.equal(url.searchParams.get('NumberofAdults'),'2');assert.equal(url.searchParams.has('adults'),false);assert.equal(url.searchParams.get('rooms'),'2');
 assert.equal(hub.hotelEvidence(stay).propertyMatched,true);
 const search=structuredClone(stay);search.hotel.booking.url='https://www.agoda.com/partners/partnersearch.aspx?hid=42';assert.equal(hub.hotelEvidence(search).propertyMatched,false);
 const nuitee=structuredClone(stay);nuitee.hotel.nuiteeHotelId='nuitee-42';assert.equal(hub.hotelEvidence(nuitee).propertyMatched,false);
 for(const value of [null,'javascript:alert(1)','https://agoda.com.evil.test/x/hotel/test.html?hid=42','https://www.agoda.com/x/hotel/test.html?hid=43']){const bad=structuredClone(stay);bad.hotel.booking.url=value;assert.equal(hub.stayUrl(bad,group),'');}
 const invalid=structuredClone(stay);invalid.departureDate='2027-02-30';assert.equal(hub.stayUrl(invalid,group),'');
});
check('18: flight comparison ignores stale or arbitrary raw provider links',()=>{
 const t=twoCityTour(),leg=t.legs[0];leg.providerDateEvidence.bookingLink='https://evil.example/pay';leg.booking.directSearchUrl='https://www.aviasales.com/search/JFK0101MEX1';const url=hub.flightUrl(leg,0,t,2);assert.match(url,/YYZ0111MEX2$/);assert.doesNotMatch(url,/evil|JFK/);
 const comparison=twoModel.items.find(item=>item.kind==='stay');assert.equal(comparison.action,'Compare stays on Agoda');assert.match(hub.componentHtml(twoModel.items[0],1),/Compare flights on Aviasales|Final fare and availability confirmed by the booking provider/);
});

const workspace=require('../scripts/booking-workspace-686c');
check('19: production live panel accepts only complete fresh owner-matching Duffel evidence',()=>{
 const time=Date.now(),row={index:0,provider:'Duffel',sourceType:'LIVE',productionEligible:true,exactMatch:true,origin:'YYZ',destination:'LHR',resolvedOrigin:'YYZ',resolvedDestination:'LHR',departureDate:'2027-03-20',providerPassengerCount:1,providerAmount:123.45,providerCurrency:'USD',freshAmount:170.2,currency:'CAD',savedAmount:160,observedAt:new Date(time).toISOString(),expiresAt:new Date(time+300000).toISOString(),airlineName:'Offline Airline'};
 const payload={ok:true,trip:{tripId:'offline-trip-123'},snapshot:{currency:'CAD'},revalidation:{provider:'Duffel',applied:true,allFlightLegsLive:true,requiredFlightLegCount:1,liveFlightLegCount:1,passengers:1,providerRequests:2},flights:[row]};
 const html=workspace.liveEvidenceHtml(payload,'offline-trip-123',time);assert.match(html,/LIVE — not reserved/);assert.match(html,/123.45.*USD/);assert.match(html,/Saved\/cached estimate/);assert.match(html,/Provider requests: 2/);assert.match(html,/whole-trip total remain estimates/);
 for(const patch of [{sourceType:'CACHED'},{expiresAt:new Date(time-1).toISOString()},{productionEligible:false},{exactMatch:false},{provider:'Sandbox'},{providerPassengerCount:2},{departureDate:'2027-02-30'},{providerAmount:null},{currency:'USD'},{resolvedOrigin:'JFK'}]){const bad={...payload,flights:[{...row,...patch}]};assert.doesNotMatch(workspace.liveEvidenceHtml(bad,'offline-trip-123',time),/LIVE — not reserved/);}
 assert.doesNotMatch(workspace.liveEvidenceHtml(payload,'another-trip-123',time),/LIVE — not reserved/);
 assert.doesNotMatch(workspace.liveEvidenceHtml({...payload,revalidation:{...payload.revalidation,allFlightLegsLive:false}},'offline-trip-123',time),/LIVE — not reserved/);
 assert.match(workspace.liveEvidenceHtml({...payload,revalidation:{reason:'quota-exhausted'}},'offline-trip-123',time),/quota or rate limit/);
});
check('20: live button is explicit and only authenticated Saved Trip ID reaches the account route',()=>{
 const src=fs.readFileSync(require('node:path').join(FRONTEND_ROOT,'scripts/booking-workspace-686c.js'),'utf8');assert.match(workspace.liveCheckMarkup(),/Check live Duffel prices/);assert.match(src,/button.addEventListener\('click'/);assert.match(src,/if\(busy\)return/);assert.match(src,/capabilities\?\.bookingRevalidation/);assert.match(src,/saved.api.get\(tripId\)/);assert.match(src,/request\('\/api\/account\/booking-revalidate','POST',\{tripId\}\)/);assert.doesNotMatch(src,/api.duffel.com|DUFFEL_ACCESS_TOKEN|localStorage.setItem/);
});

const report={version:hub.VERSION,generatedAt:new Date().toISOString(),passed,failed:0,checks};
fs.writeFileSync(outputPath('VALIDATION_GV_BOOK_685D_FRONTEND.json'),JSON.stringify(report,null,2)+'\n');
console.log(`PASS ${passed}/${passed} — GV-BOOK-685D frontend`);
