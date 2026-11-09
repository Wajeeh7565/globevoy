'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const hub=require('./scripts/booking-hub-685d.js');
const confidence=require('./scripts/budget-confidence-685b.js');

let passed=0;
const checks=[];
function check(name,fn){try{fn();passed+=1;checks.push({name,passed:true});console.log(`PASS ${name}`);}catch(error){checks.push({name,passed:false,error:error.message});throw error;}}
function city(city,code,country=''){return{city,code,airportCode:code,country};}
function params(){return new URLSearchParams('currency=CAD&budget=1500&total=1319&adults=1&passengers=1&rooms=1');}

const toronto=city('Toronto','YYZ','Canada');
const cleveland=city('Cleveland','CLE','United States');
const pittsburgh=city('Pittsburgh','PIT','United States');
const badGroundUrl='https://www.aviasales.com/search/CLE0509PIT1?marker=must-not-render';
const trackedOutbound='https://www.aviasales.com/search/YYZ0209CLE1?marker=globevoy-r2';
const agodaCleveland='https://www.agoda.com/search?city=Cleveland&checkIn=2026-09-02&checkOut=2026-09-05&rooms=1&adults=1&cid=1891461';
const legs=[
  {from:toronto,to:cleveland,mode:'flight',departureDate:'2026-09-02',estimatedDisplayTotal:122,booking:{directSearchUrl:trackedOutbound}},
  {from:cleveland,to:pittsburgh,mode:'ground',transportType:'rail-or-bus',departureDate:'2026-09-05',estimatedDisplayTotal:35,booking:{directSearchUrl:badGroundUrl}},
  {from:pittsburgh,to:toronto,mode:'flight',departureDate:'2026-09-08',estimatedDisplayTotal:129,providerDateEvidence:{provider:'Duffel',sourceType:'CACHED',departureDate:'2026-09-08'}}
];
const tour={
  origin:toronto,
  cities:[cleveland,pittsburgh],
  legs,
  backendLegs:legs,
  stays:[
    {...cleveland,nights:3,arrivalDate:'2026-09-02',departureDate:'2026-09-05',hotel:{estimatedDisplayTotal:551,providerHotel:{provider:'Agoda',hotelId:'cle-r2',hotelName:'Elevated Entertainment Sleep Suite',bookingUrl:agodaCleveland},providerVerification:{verified:true,productionEligible:true,provider:'Agoda',sourceType:'LIVE'},priceEvidence:{sourceType:'LIVE'}}},
    {...pittsburgh,nights:3,arrivalDate:'2026-09-05',departureDate:'2026-09-08',hotel:{estimatedDisplayTotal:482,providerHotel:{provider:'Agoda',hotelId:'pit-r2',hotelName:'Pittsburgh Central Hotel',bookingUrl:'https://www.agoda.com/search?city=Pittsburgh&checkIn=2026-09-05&checkOut=2026-09-08&rooms=1&adults=1&cid=1891461'},providerVerification:{verified:true,productionEligible:true,provider:'Agoda',sourceType:'CACHED'},priceEvidence:{sourceType:'CACHED'}}}
  ],
  budget:{total:{amount:1500,currency:'CAD'},estimatedCoreTotal:{amount:1319,currency:'CAD'}},
  canonicalPricing:{canonicalDisplayTotal:1319,exchangeRateFromUsd:1.36},
  passengerPricing:{adults:1,children:0,travellers:1,rooms:1},
  liveProviderVerification:{criticalCount:5,verifiedCount:1,allCriticalVerified:false,budgetClaim:'planning-estimate'}
};
const model=hub.buildJourney(tour,params());
const ground=model.items.find(item=>item.kind==='ground');
const stays=model.items.filter(item=>item.kind==='stay');

check('1: R2 release version is explicit',()=>assert.equal(hub.VERSION,'GV-BOOK-685D-R2'));
check('2: chronological journey remains flight stay ground stay flight',()=>assert.deepEqual(model.items.map(item=>item.kind),['flight','stay','ground','stay','flight']));
check('3: ground leg never reuses an Aviasales URL',()=>{assert.equal(hub.groundUrl(legs[1]),'');assert.equal(ground.url,'');assert.equal(ground.partner,'');});
check('4: ground card never labels Aviasales as fulfilment',()=>{const html=hub.componentHtml(ground,3);assert.doesNotMatch(html,/Aviasales/i);assert.match(html,/Ground transfer estimate/);assert.match(html,/Rail or bus partner search is not yet connected/);assert.match(html,/Transport partner pending/);});
check('5: explicit non-flight ground partner link may be preserved without generation',()=>{const url='https://www.rome2rio.com/map/Cleveland/Pittsburgh';assert.equal(hub.groundUrl({...legs[1],groundBookingUrl:url}),url);});
check('6: flight Aviasales handoff and tracking remain exact',()=>assert.equal(model.items[0].url,trackedOutbound));
check('7: generated return flight handoff remains PIT to YYZ on the dated route',()=>assert.match(model.items.at(-1).url,/\/PIT0809YYZ1$/));
check('8: live-looking Agoda property evidence is labelled as an estimate',()=>{assert.equal(stays[0].evidence.label,'Estimated stay cost — selected property on Agoda');assert.equal(stays[0].evidence.observed,false);assert.equal(stays[0].evidence.state,'estimate');});
check('9: cached Agoda property evidence stays visibly cached and estimated',()=>{assert.equal(stays[1].evidence.label,'Cached stay estimate — selected property on Agoda');assert.equal(stays[1].evidence.observed,false);assert.match(stays[1].evidence.note,/Agoda confirms current room availability/i);});
check('10: stay card never claims price observed via Agoda',()=>{const html=stays.map((stay,index)=>hub.componentHtml(stay,index+1)).join('');assert.doesNotMatch(html,/Stay price observed via Agoda|Observed component price/i);assert.match(html,/Planning component price/);});
check('11: partial evidence makes the whole-group total explicitly estimated',()=>{const state=hub.confidenceFor(tour,params(),confidence);assert.equal(state.estimated,true);assert.equal(state.totalLabel,'Estimated trip total');assert.match(state.message,/total remains an estimate/i);});
check('12: over-budget state also describes the total as estimated',()=>{const over={...tour,canonicalPricing:{...tour.canonicalPricing,canonicalDisplayTotal:1600}};const state=hub.confidenceFor(over,params(),confidence);assert.equal(state.label,'Over budget');assert.equal(state.totalLabel,'Estimated trip total');assert.match(state.message,/estimated whole-group trip total/i);});
check('13: provider-backed state retains its stronger but qualified total label',()=>{const backed={...tour,liveProviderVerification:{criticalCount:5,verifiedCount:5,allCriticalVerified:true,budgetClaim:'provider-backed-fit'}};const state=hub.confidenceFor(backed,params(),confidence);assert.equal(state.label,'Provider-backed fit');assert.equal(state.totalLabel,'Provider-backed trip total');assert.match(state.message,/recheck before purchase/i);});
check('14: booking progress uses Book with partners and no Partner checkout wording',()=>{const html=fs.readFileSync('booking.html','utf8');assert.match(html,/<b>Book with partners<\/b>/);assert.match(html,/id="gv-booking-total-label">Estimated trip total/);assert.doesNotMatch(html,/Partner checkout|Separate partner checkouts/i);});
check('15: R2 release marker and cache busting are active',()=>{const html=fs.readFileSync('booking.html','utf8');assert.match(html,/gv-release" content="GV-BOOK-685D-R2/);assert.match(html,/booking-hub-685d\.js\?v=685d-r2/);assert.match(html,/booking-hub-685d\.css\?v=685d-r2/);});
check('16: R1 metro disclosure and resolved-airport Aviasales handoff survive',()=>{const lga=city('New York','LGA'),yow=city('Ottawa','YOW');const metroLeg={from:lga,to:yow,mode:'flight',departureDate:'2026-09-05',estimatedDisplayTotal:240,liveFareVerified:true,providerDateEvidence:{providerBacked:true,productionEligible:true,appliedToEstimate:true,provider:'Duffel',sourceType:'LIVE',requestedOrigin:'JFK',resolvedOrigin:'LGA',requestedDestination:'YOW',resolvedDestination:'YOW',airportMode683H:'METRO_ORIGIN_ALTERNATE',metroAirportFallback683H:{sameCityRegistryVerified:true}}};const metroTour={origin:city('New York','JFK'),cities:[yow],legs:[metroLeg],backendLegs:[metroLeg],stays:[],passengerPricing:{travellers:1}};assert.equal(hub.metroAirportDisclosure(metroLeg).label,'Same-city airport change: JFK → LGA');assert.match(hub.flightUrl(metroLeg,0,metroTour,1),/\/LGA0509YOW1$/);});
check('17: no payment, order, provider call or backend expansion',()=>{const source=fs.readFileSync('scripts/booking-hub-685d.js','utf8');assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|WebSocket|\/air\/orders|createOrder\s*\(|createBooking\s*\(|payment_intent|DUFFEL_ACCESS_TOKEN|AGODA_[A-Z_]+|backend\/|lambda/i);});
check('18: no fake completion or combined-booking claim is introduced',()=>{const source=fs.readFileSync('booking.html','utf8')+fs.readFileSync('scripts/booking-hub-685d.js','utf8');assert.doesNotMatch(source,/booking confirmed|ticket confirmed|pay C\$|book everything|one.click/i);assert.match(source,/each flight and stay is booked separately with its partner/i);});

const report={version:hub.VERSION,generatedAt:new Date().toISOString(),passed,failed:0,checks};
fs.writeFileSync('VALIDATION_GV_BOOK_685D_R2_TRUST_REPAIR.json',JSON.stringify(report,null,2)+'\n');
console.log(`PASS ${passed}/${passed} — GV-BOOK-685D-R2 immediate trust repair`);
