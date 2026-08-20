'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const hub=require('./scripts/booking-hub-685d.js');
const confidence=require('./scripts/budget-confidence-685b.js');

let passed=0;
const checks=[];
function check(name,fn){try{fn();passed+=1;checks.push({name,passed:true});console.log(`PASS ${name}`);}catch(error){checks.push({name,passed:false,error:error.message});throw error;}}
function city(city,code,country=''){return{city,code,airportCode:code,country};}
function evidence(overrides={}){return{providerBacked:true,productionEligible:true,appliedToEstimate:true,provider:'Duffel',sourceType:'LIVE',priceEvidence:{sourceType:'LIVE'},...overrides};}
function leg(from,to,providerDateEvidence,overrides={}){return{from,to,mode:'flight',departureDate:'2026-09-05',estimatedDisplayTotal:240,liveFareVerified:true,providerDateEvidence,...overrides};}
function tourFor(flight){return{origin:flight.from,cities:[flight.to],legs:[flight],backendLegs:[flight],stays:[],budget:{total:{amount:1000,currency:'CAD'}},canonicalPricing:{canonicalDisplayTotal:240},passengerPricing:{travellers:1,rooms:1},liveProviderVerification:{criticalCount:1,verifiedCount:1,allCriticalVerified:true,budgetClaim:'provider-backed-fit'}};}

const yyz=city('Toronto','YYZ','Canada'),mex=city('Mexico City','MEX','Mexico');
const exact=leg(yyz,mex,evidence({requestedOrigin:'YYZ',resolvedOrigin:'YYZ',requestedDestination:'MEX',resolvedDestination:'MEX',airportMode683H:'EXACT'}));
const jfk=city('New York','JFK','United States'),lga=city('New York','LGA','United States'),yow=city('Ottawa','YOW','Canada');
const metroEvidence=evidence({requestedOrigin:'JFK',resolvedOrigin:'LGA',requestedDestination:'YOW',resolvedDestination:'YOW',airportMode683H:'METRO_ORIGIN_ALTERNATE',metroAirportFallback683H:{version:'GV-PROVIDER-683H',requestedOrigin:'JFK',resolvedOrigin:'LGA',requestedDestination:'YOW',resolvedDestination:'YOW',sameCityRegistryVerified:true,groundAccessEstimateAdjusted:false,caveat:'same-city airport substitution; ground-access estimate is not repriced in the Duffel P2 evaluation'}});
const metro=leg(lga,yow,metroEvidence,{metroAirportSubstitution683H:metroEvidence.metroAirportFallback683H});

check('1: R1 version is explicit',()=>assert.equal(hub.VERSION,'GV-BOOK-685D-R1'));
check('2: production-A exact LIVE Duffel route keeps live label and no metro notice',()=>{const item=hub.buildJourney(tourFor(exact),new URLSearchParams()).items[0];assert.equal(item.title,'Toronto → Mexico City');assert.equal(item.routeCodes,'YYZ → MEX');assert.equal(item.evidence.label,'Fare observed via Duffel');assert.equal(item.metro,null);assert.doesNotMatch(hub.componentHtml(item,1),/airport change/i);});
check('3: exact route Aviasales fallback retains resolved YYZ to MEX',()=>{const url=hub.flightUrl(exact,0,tourFor(exact),1);assert.match(url,/\/YYZ0509MEX1$/);});
check('4: metro city title stays New York to Ottawa while codes show LGA to YOW',()=>{const item=hub.buildJourney(tourFor(metro),new URLSearchParams()).items[0];assert.equal(item.title,'New York → Ottawa');assert.equal(item.routeCodes,'LGA → YOW');assert.equal(item.metro.label,'Same-city airport change: JFK → LGA');});
check('5: metro disclosure renders the inherited ground-access caveat',()=>{const item=hub.buildJourney(tourFor(metro),new URLSearchParams()).items[0],html=hub.componentHtml(item,1);assert.match(html,/Same-city airport change: JFK → LGA/);assert.match(html,/Ground-access cost for this airport change is not repriced/);assert.match(html,/role="note"/);});
check('6: metro Aviasales fallback uses resolved LGA and never requested JFK',()=>{const url=hub.flightUrl(metro,0,tourFor(metro),1);assert.match(url,/\/LGA0509YOW1$/);assert.doesNotMatch(url,/JFK/);});
check('7: destination and dual-endpoint metro substitutions are supported',()=>{const destination=hub.metroAirportDisclosure(leg(yyz,city('New York','LGA'),evidence({requestedOrigin:'YYZ',resolvedOrigin:'YYZ',requestedDestination:'JFK',resolvedDestination:'LGA',airportMode683H:'METRO_DESTINATION_ALTERNATE',metroAirportFallback683H:{sameCityRegistryVerified:true}})));assert.equal(destination.label,'Same-city airport change: JFK → LGA');const both=hub.metroAirportDisclosure(leg(lga,city('Ottawa','YND'),evidence({requestedOrigin:'JFK',resolvedOrigin:'LGA',requestedDestination:'YOW',resolvedDestination:'YND',airportMode683H:'METRO_BOTH_ALTERNATE',metroAirportFallback683H:{sameCityRegistryVerified:true}})));assert.equal(both.label,'Same-city airport change: JFK → LGA · YOW → YND');});
check('8: CACHED Duffel is visibly cached and never gets the live label',()=>{const cached=leg(yyz,mex,evidence({sourceType:'CACHED',priceEvidence:{sourceType:'CACHED'},requestedOrigin:'YYZ',resolvedOrigin:'YYZ',requestedDestination:'MEX',resolvedDestination:'MEX',airportMode683H:'EXACT'}));const state=hub.flightEvidence(cached);assert.equal(state.label,'Cached Duffel fare observation');assert.equal(state.sourceType,'CACHED');assert.notEqual(state.label,'Fare observed via Duffel');assert.match(state.note,/not a current quote/i);});
check('9: UNAVAILABLE and no-provider component states remain conservative',()=>{assert.equal(hub.flightEvidence(leg(yyz,mex,{sourceType:'UNAVAILABLE',provider:'Duffel'})).label,'Current fare unavailable');assert.equal(hub.flightEvidence({from:yyz,to:mex,mode:'flight'}).label,'Planning estimate — verify price');});
check('10: exact route with no metro object never shows a substitution notice',()=>{const exactWithCodes=leg(jfk,yow,evidence({requestedOrigin:'JFK',resolvedOrigin:'JFK',requestedDestination:'YOW',resolvedDestination:'YOW',airportMode683H:'EXACT'}));assert.equal(hub.metroAirportDisclosure(exactWithCodes),null);assert.doesNotMatch(hub.componentHtml(hub.buildJourney(tourFor(exactWithCodes),new URLSearchParams()).items[0],1),/airport change/i);});
check('11: existing Aviasales URL and tracking remain byte-for-byte intact',()=>{const tracked='https://www.aviasales.com/search/LGA0509YOW1?marker=globevoy-r1&campaign=metro';const trackedLeg={...metro,booking:{directSearchUrl:tracked}};assert.equal(hub.flightUrl(trackedLeg,0,tourFor(trackedLeg),1),tracked);});
check('12: GV-TRUST-685B confidence behavior remains intact',()=>{const state=hub.confidenceFor(tourFor(exact),new URLSearchParams(),confidence);assert.equal(state.version,'GV-TRUST-685B');assert.equal(state.label,'Provider-backed fit');});
check('13: release marker and cache busting activate R1',()=>{const html=fs.readFileSync('booking.html','utf8');assert.match(html,/gv-release" content="GV-BOOK-685D-R1/);assert.match(html,/booking-hub-685d\.js\?v=685d-r1/);assert.match(html,/booking-hub-685d\.css\?v=685d-r1/);});
check('14: frontend-only scope has no provider, backend, payment or order expansion',()=>{const source=fs.readFileSync('scripts/booking-hub-685d.js','utf8');assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|WebSocket|\/air\/orders|createOrder\s*\(|createBooking\s*\(|payment_intent|DUFFEL_ACCESS_TOKEN|AGODA_[A-Z_]+/i);assert.doesNotMatch(source,/backend\/|lambda/i);});
check('15: metro disclosure style wraps safely without horizontal scrolling',()=>{const css=fs.readFileSync('styles/booking-hub-685d.css','utf8');assert.match(css,/\.gv-booking-metro-disclosure/);assert.match(css,/overflow-wrap:anywhere/);assert.doesNotMatch(css,/overflow-x:\s*(auto|scroll)/);});

const report={version:hub.VERSION,generatedAt:new Date().toISOString(),passed,failed:0,checks};
fs.writeFileSync('VALIDATION_GV_BOOK_685D_R1_FRONTEND.json',JSON.stringify(report,null,2)+'\n');
console.log(`PASS ${passed}/${passed} — GV-BOOK-685D-R1 frontend`);
