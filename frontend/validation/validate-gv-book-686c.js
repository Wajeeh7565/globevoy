'use strict';

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const hash=name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex');
const checks=[];
const check=(name,pass)=>checks.push({name,pass:Boolean(pass)});

const workspace=require(path.join(root,'scripts/booking-workspace-686c.js'));
const hub=require(path.join(root,'scripts/booking-hub-685d.js'));
const confidence=require(path.join(root,'scripts/budget-confidence-685b.js'));
const html=read('booking.html');
const css=read('styles/booking-workspace-686c.css');
const source=read('scripts/booking-workspace-686c.js');
const fixture=read('gv-book-686c-browser-fixture.html');
const partnerFixture=read('gv-book-686c-partner-fixture.html');

const toronto={city:'Toronto',code:'YYZ',airportCode:'YYZ'};
const cleveland={city:'Cleveland',code:'CLE',airportCode:'CLE'};
const pittsburgh={city:'Pittsburgh',code:'PIT',airportCode:'PIT'};
const legs=[
  {from:toronto,to:cleveland,mode:'flight',departureDate:'2026-09-02',estimatedDisplayTotal:122,providerDateEvidence:{provider:'Duffel',sourceType:'LIVE',departureDate:'2026-09-02',providerBacked:true},liveFareVerified:true,booking:{directSearchUrl:'https://www.aviasales.com/search/YYZ0209CLE1'}},
  {from:cleveland,to:pittsburgh,mode:'ground',departureDate:'2026-09-05',estimatedDisplayTotal:35},
  {from:pittsburgh,to:toronto,mode:'flight',departureDate:'2026-09-08',estimatedDisplayTotal:129,providerDateEvidence:{provider:'Duffel',sourceType:'CACHED',departureDate:'2026-09-08'},booking:{directSearchUrl:'https://www.aviasales.com/search/PIT0809YYZ1'}}
];
const tour={origin:toronto,cities:[cleveland,pittsburgh],backendLegs:legs,stays:[
  {...cleveland,nights:3,arrivalDate:'2026-09-02',departureDate:'2026-09-05',hotel:{estimatedDisplayTotal:551,providerHotel:{provider:'Agoda',hotelId:'cle',hotelName:'Cleveland Central',bookingUrl:'https://www.agoda.com/search?city=Cleveland'},providerVerification:{verified:true,provider:'Agoda',sourceType:'LIVE'},priceEvidence:{sourceType:'LIVE'}}},
  {...pittsburgh,nights:3,arrivalDate:'2026-09-05',departureDate:'2026-09-08',hotel:{estimatedDisplayTotal:482,providerHotel:{provider:'Agoda',hotelId:'pit',hotelName:'Pittsburgh Central',bookingUrl:'https://www.agoda.com/search?city=Pittsburgh'},providerVerification:{verified:true,provider:'Agoda',sourceType:'CACHED'},priceEvidence:{sourceType:'CACHED'}}}
],budget:{total:{amount:1500,currency:'CAD'}},canonicalPricing:{canonicalDisplayTotal:1319,exchangeRateFromUsd:1.36},passengerPricing:{adults:1,children:0,travellers:1,rooms:1},liveProviderVerification:{criticalCount:5,verifiedCount:2}};
const query=new URLSearchParams('multi=true&snapshot=686c-test&currency=CAD&budget=1500&total=1319&passengers=1&rooms=1');
const model=workspace.buildWorkspaceModel(tour,query,hub,confidence);
const rendered=workspace.render(model,hub,new Set());
const reviewedCard=workspace.itemCard(model.actionable[0],hub,new Set([model.actionable[0].id]));

check('Release version is GV-BOOK-686C',workspace.VERSION==='GV-BOOK-686C'&&html.includes('content="GV-BOOK-686C"'));
check('Five traveler-facing workflow steps are explicit',workspace.STEP_LABELS.join('|')==='Review trip|Verify flights|Verify stays|Price confidence|Complete bookings');
check('Workspace preserves flight stay ground stay flight chronology',model.items.map(item=>item.kind).join('|')==='flight|stay|ground|stay|flight');
check('Complete route and dates remain visible',model.routeText==='Toronto → Cleveland → Pittsburgh → Toronto'&&model.dates.includes('Sep 2, 2026')&&model.dates.includes('Sep 8, 2026'));
check('Whole-group budget and estimate remain conservative',model.confidence.budget===1500&&model.confidence.total===1319&&model.remaining===181&&model.confidence.estimated===true);
check('Passenger and room context is grouped',model.party.travellers===1&&model.party.rooms===1&&rendered.includes('Travellers')&&rendered.includes('Rooms'));
check('Ground transfer is not converted into a flight handoff',model.items[2].kind==='ground'&&!model.items[2].url);
check('Cached Duffel remains visibly cached',model.items[4].bucket==='cached'&&model.items[4].evidence.label==='Cached Duffel fare observation');
check('Agoda property amount remains an estimate',model.items[1].bucket==='estimate'&&model.items[1].evidence.observed===false);
check('Evidence categories remain distinct',rendered.includes('Provider-observed components')&&rendered.includes('Cached observations—not current quotes')&&rendered.includes('Planning estimates to verify')&&rendered.includes('Currently unpriced components'));
check('Reviewed language never claims booking completion',reviewedCard.includes('Provider result reviewed')&&rendered.includes('Reviewed does not mean booked')&&rendered.includes('does not mean booked, paid or confirmed'));
check('Partner handoffs remain separate external actions',rendered.includes('target="_blank"')&&rendered.includes('rel="noopener sponsored"')&&rendered.includes('Complete and pay for each component separately'));
check('Baggage and optional extras are separate expandable details',rendered.includes('Baggage and optional extras')&&rendered.includes('fare rules, seller, connections and optional extras'));
check('Stay tax fee and room assumptions are explicit',rendered.includes('Room, tax and fee assumptions')&&rendered.includes('Taxes, resort fees, room type, cancellation rules and occupancy'));
check('No fake payment or combined transaction UI exists',!/<input[^>]+(?:card|payment|cvv|cvc)/i.test(rendered)&&!/>\s*(?:Pay|Confirm booking)\b/i.test(rendered)&&rendered.includes('No combined booking, price lock, payment, order, confirmation number or ticket'));
check('One panel is active initially and other tasks are gated',rendered.includes('data-workspace-panel="0"')&&(rendered.match(/data-workspace-panel="[1-4]" hidden/g)||[]).length===4);
check('Desktop information architecture is approximately 70/30',css.includes('grid-template-columns:minmax(0,2.15fr) minmax(285px,.9fr)'));
check('Trip summary and stepper remain sticky',css.includes('.gv-workspace-stepper{position:sticky')&&css.includes('.gv-workspace-sidebar{position:sticky'));
check('Mobile summary is collapsible and compact',rendered.includes('<details class="gv-workspace-summary" open>')&&css.includes('.gv-workspace-summary>summary{display:flex')&&css.includes('@media(max-width:660px)'));
check('Reduced motion is respected',css.includes('@media(prefers-reduced-motion:reduce)')&&source.includes("'(prefers-reduced-motion: reduce)'"));
check('Workspace makes no provider/network request',!/\bfetch\s*\(|XMLHttpRequest|GlobevoyApi\./.test(source));
check('Browser fixture is isolated from production state',fixture.includes('gv-book-686c-browser-fixture')&&fixture.includes("sessionStorage.setItem('globevoy.multi.selected.v1'")&&fixture.includes('window.name=')&&fixture.includes('must-not-render'));
check('Reviewed-state browser check uses a portable local non-provider fixture',fixture.includes("groundBookingUrl:location.origin+'/gv-book-686c-partner-fixture.html'")&&partnerFixture.includes('without contacting an external provider'));
check('HTML loads final RC workspace CSS and 686C script after protected booking engines',html.includes('booking-workspace-686c.css?v=686d-rc')&&html.indexOf('booking-workspace-686c.js?v=686c')>html.indexOf('booking-hub-685d.js?v=685d-r2'));
check('Booking Hub and booking live engine are byte-identical to 686B',hash('scripts/booking-hub-685d.js')==='6344ffad400d52dbce0d5d104ea41b86e6bd39394377e028936ba5be7809236a'&&hash('scripts/booking-live-673d.js')==='8b39d74dca43f9e00ebc58b20b3ae29a9e53aeaeaeee737aced7d6e4e841e5be');
check('Trust, API client and runtime config are unchanged; shell is the approved FE-R3.1B successor',hash('scripts/budget-confidence-685b.js')==='3ed77e95f240096f6d241499c1e0b517a1f97c77ae855bb9c85d0098f54eb832'&&read('scripts/shell-670f.js').includes('GV-WEB-FE-R3.1B unified account header')&&hash('runtime/api-client.js')==='d10d716b60d13f36b456a7797c22590ba5ca1c12bec31586d8e0c36242df8af6'&&hash('runtime/config.js')==='191e377fdf5dba312e60f0b2c21c74b6283b729c982bcbff8c7c08fd637ea958');
check('Journey runtime remains byte-identical to 686B with approved FE-R3.1B shell cache reference',read('multicity-visualizer.html').includes('shell-670f.js?v=fe-r3-1b')&&hash('scripts/multicity-visualizer-674a.js')==='7013b0777f21acddf9c01749fe035691f21d89101d81e84a6b7ed1627ca55dd4'&&hash('scripts/journey-experience-686b.js')==='d7b80b586b69e8fc1718dc8f6a785cb30fa11c77e49b79f6c2660f4bdbac0ef7'&&hash('styles/journey-experience-686b.css')==='e5b26ba9c0584be7f4119f229bb57a840d3ed3966f92e3aba328ebacd0ac2998');

checks.forEach((item,index)=>console.log(`${item.pass?'PASS':'FAIL'} ${String(index+1).padStart(2,'0')} — ${item.name}`));
const passed=checks.filter(item=>item.pass).length;
console.log(`GV-BOOK-686C: ${passed}/${checks.length} PASS`);
if(passed!==checks.length)process.exitCode=1;
