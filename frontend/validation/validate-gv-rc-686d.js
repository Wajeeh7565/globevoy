'use strict';
const { frontendSourcePath } = require('../../ops/frontend/source-layout.cjs');
const { promotedPageContentPreserved } = require('./page-layout-support.cjs');

const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(frontendSourcePath(root,name),'utf8');
const hash=name=>crypto.createHash('sha256').update(fs.readFileSync(frontendSourcePath(root,name))).digest('hex');
const exists=name=>fs.existsSync(frontendSourcePath(root,name));
const checks=[];
const check=(name,pass,detail='')=>checks.push({name,pass:Boolean(pass),detail});

const release=JSON.parse(read('validation/releases/GV-RC-686D-RELEASE.json'));
const shell=read('scripts/shell-670f.js');
const shellCss=read('styles/shell.css');
const home=read('index.html');
const signIn=read('sign-in.html');
const profile=read('create-account.html');
const legacy=read('multi-city.html');
const visualizer=read('multicity-visualizer.html');
const visualizerEngine=read('scripts/multicity-visualizer-687a.js');
const tripEngine=read('scripts/multi-city-trip-673a.js');
const journeySource=read('scripts/journey-experience-687a.js');
const journeyCss=read('styles/journey-experience-687a.css');
const bookingHtml=read('booking.html');
const bookingHubSource=read('scripts/booking-hub-685d.js');
const workspaceSource=read('scripts/booking-workspace-686c.js');
const workspaceCss=read('styles/booking-workspace-686c.css');
const legalNote=read('validation/releases/GV-RC-686D-LEGAL-COMMERCIAL-GATE.md');
const journey=require(frontendSourcePath(root,'scripts/journey-experience-687a.js'));
const hub=require(frontendSourcePath(root,'scripts/booking-hub-685d.js'));
const workspace=require(frontendSourcePath(root,'scripts/booking-workspace-686c.js'));
const confidence=require(frontendSourcePath(root,'scripts/budget-confidence-685b.js'));

function filesUnder(dir){const out=[];for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())out.push(...filesUnder(full));else out.push(full);}return out;}
function runValidator(relative){const result=spawnSync(process.execPath,[frontendSourcePath(root,relative)],{cwd:root,encoding:'utf8'});return{pass:result.status===0,status:result.status,stdout:String(result.stdout||''),stderr:String(result.stderr||'')};}

const query=new URLSearchParams('multi=true&currency=CAD&budget=1500&total=1319&adults=2&passengers=2&rooms=1');
const Toronto={city:'Toronto',code:'YYZ',airportCode:'YYZ'};
const Cleveland={city:'Cleveland',code:'CLE',airportCode:'CLE'};
const Pittsburgh={city:'Pittsburgh',code:'PIT',airportCode:'PIT'};
const groundLegs=[
  {from:Toronto,to:Cleveland,mode:'flight',departureDate:'2026-09-02',estimatedDisplayTotal:122,liveFareVerified:true,providerDateEvidence:{provider:'Duffel',sourceType:'LIVE',liveMode:true,fareAmountBasis:'party-total',providerPartyTotalAmount:122,providerCurrency:'CAD',currency:'CAD',providerPassengerCount:2,origin:'YYZ',destination:'CLE',expiresAt:new Date(Date.now()+3600000).toISOString(),providerBacked:true,productionEligible:true,appliedToEstimate:true,departureDate:'2026-09-02'},booking:{directSearchUrl:'https://www.aviasales.com/search/YYZ0209CLE2?marker=rc-686d'}},
  {from:Cleveland,to:Pittsburgh,mode:'ground',transportType:'rail-or-bus',departureDate:'2026-09-05',estimatedDisplayTotal:35,booking:{directSearchUrl:'https://www.aviasales.com/search/CLE0509PIT2?marker=must-not-render'}},
  {from:Pittsburgh,to:Toronto,mode:'flight',departureDate:'2026-09-08',estimatedDisplayTotal:129,providerDateEvidence:{provider:'Duffel',sourceType:'CACHED',departureDate:'2026-09-08'},booking:{directSearchUrl:'https://www.aviasales.com/search/PIT0809YYZ2?marker=rc-686d'}}
];
const groundTour={origin:Toronto,cities:[Cleveland,Pittsburgh],backendLegs:groundLegs,stays:[
  {...Cleveland,nights:3,arrivalDate:'2026-09-02',departureDate:'2026-09-05',hotel:{estimatedDisplayTotal:551,providerHotel:{provider:'Agoda',hotelId:'cle',hotelName:'Cleveland Central',bookingUrl:'https://www.agoda.com/search?city=Cleveland&checkIn=2026-09-02&checkOut=2026-09-05&rooms=1&adults=2&cid=1891461'},providerVerification:{verified:true,provider:'Agoda',sourceType:'LIVE'},priceEvidence:{sourceType:'LIVE'}}},
  {...Pittsburgh,nights:3,arrivalDate:'2026-09-05',departureDate:'2026-09-08',hotel:{estimatedDisplayTotal:482,providerHotel:{provider:'Agoda',hotelId:'pit',hotelName:'Pittsburgh Central',bookingUrl:'https://www.agoda.com/search?city=Pittsburgh&checkIn=2026-09-05&checkOut=2026-09-08&rooms=1&adults=2&cid=1891461'},providerVerification:{verified:true,provider:'Agoda',sourceType:'CACHED'},priceEvidence:{sourceType:'CACHED'}}}
],budget:{total:{amount:1500,currency:'CAD'}},canonicalPricing:{canonicalDisplayTotal:1319,exchangeRateFromUsd:1.36},passengerPricing:{adults:2,children:0,travellers:2,rooms:1},liveProviderVerification:{criticalCount:5,verifiedCount:2}};
const bookingModel=workspace.buildWorkspaceModel(groundTour,query,hub,confidence);
const renderedWorkspace=workspace.render(bookingModel,hub,new Set([bookingModel.actionable[0].id]));

const metroLeg={from:{city:'New York',code:'LGA',airportCode:'LGA'},to:{city:'Ottawa',code:'YOW',airportCode:'YOW'},mode:'flight',departureDate:'2026-09-05',metroAirportSubstitution683H:{sameCityRegistryVerified:true},providerDateEvidence:{provider:'Duffel',sourceType:'LIVE',providerBacked:true,productionEligible:true,appliedToEstimate:true,departureDate:'2026-09-05',requestedOrigin:'JFK',resolvedOrigin:'LGA',requestedDestination:'YOW',resolvedDestination:'YOW',airportMode683H:'METRO_ORIGIN_ALTERNATE',metroAirportFallback683H:{sameCityRegistryVerified:true,requestedOrigin:'JFK',resolvedOrigin:'LGA',requestedDestination:'YOW',resolvedDestination:'YOW'}}};
const metroTour={origin:{city:'New York',code:'JFK',airportCode:'JFK'},cities:[{city:'Ottawa',code:'YOW',airportCode:'YOW'}],backendLegs:[metroLeg],passengerPricing:{travellers:2}};

const journeyModel=journey.buildJourneyModel({origin:Toronto,cities:[{...Cleveland,nights:3},{...Pittsburgh,nights:3}],backendLegs:[{mode:'flight'},{mode:'ground-transfer'},{mode:'flight'}],stays:[{nights:3},{nights:3}],liveProviderVerification:{criticalCount:5,verifiedCount:2}});

check('Release metadata identifies the authoritative 686C baseline',release.release==='GV-RC-686D'&&release.authoritativeSource==='GV-BOOK-686C'&&release.authoritativeSourceSha256==='87409a8ce8cbea78c27bec65c217c150cf501fb0fc29e2507300943c322c5612');
check('Production comparison is pinned to authenticated 685D-R1',release.productionComparisonBaseline==='GV-BOOK-685D-R1'&&release.productionComparisonBaselineSha256==='a01337ec4494a4a1bf907811b3f24da1fc2854f7b35cb3ca94a423b52b10736e');
check('Known-good rollback artifact is recorded exactly',release.knownGoodRollbackSha256==='22107006178F42914881E9A31E11CC2B372D784AD30C87ECAB4D483AD01E36FC');
check('Release explicitly records no deployment/backend/Lambda/provider validation calls',release.deploymentPerformed===false&&release.backendChanged===false&&release.lambdaChanged===false&&release.liveProviderCallsDuringValidation===false);

for(const [name,file] of [['686A shell','validation/validate-gv-shell-686a.js'],['686B journey','validation/validate-gv-journey-686b.js'],['686C booking','validation/validate-gv-book-686c.js']]){const result=runValidator(file);check(`${name} cumulative validator is green`,result.pass,result.stderr||result.stdout);}
check('Stale 686A byte-identity assertion is superseded, not deleted',read('validation/validate-gv-shell-686a.js').includes('matches approved 686B final state')&&!read('validation/validate-gv-shell-686a.js').includes('Generated-tour engine remains byte-identical to trusted R2'));
check('Stale 686B booking-page assertion is superseded, not deleted',read('validation/validate-gv-journey-686b.js').includes('matches approved 686D-R1 minimal-header state')&&!read('validation/validate-gv-journey-686b.js').includes('Booking page remains byte-identical to 686A'));

check('Ground transport never inherits Aviasales fulfilment',bookingModel.items[2].kind==='ground'&&!bookingModel.items[2].url&&!renderedWorkspace.includes('must-not-render'));
check('Ground card uses honest transport wording',renderedWorkspace.includes('Ground transport')&&renderedWorkspace.includes('The transport partner must confirm'));
check('Hotel property amounts remain estimates without rate evidence',bookingModel.items.filter(item=>item.kind==='stay').every(item=>item.evidence.observed===false)&&renderedWorkspace.includes('Planning component price'));
check('Cached hotel evidence stays visibly cached',bookingModel.items.some(item=>item.kind==='stay'&&item.bucket==='cached'&&/^Cached stay estimate/.test(item.evidence.label)));
check('Partially verified total is visibly estimated',bookingModel.confidence.estimated===true&&bookingModel.confidence.totalLabel==='Estimated trip total'&&renderedWorkspace.includes('Estimated trip total'));
check('Partner checkout wording is not restored',!bookingHtml.includes('Partner checkout')&&!workspaceSource.includes('Partner checkout'));
check('Booking workflow uses honest partner language',renderedWorkspace.includes('Continue with booking partners')&&renderedWorkspace.includes('Complete and pay for each component separately'));

check('Unified shell uses the approved FE-R3.1B account-aware header',shell.includes('GV-SHELL-686D-R1')&&shell.includes('class="gv-brand"')&&shell.includes('class="gv-account-nav"')&&shell.includes('data-gv-auth-signin')&&shell.includes('data-gv-auth-signout')&&!shell.includes('class="gv-nav"')&&!shell.includes('class="gv-burger"')&&!shell.includes('id="gv-mobile-menu"'));
check('Globevoy shell tokens and shared header/footer survive',shellCss.includes('--gv-navy:')&&shellCss.includes('--gv-teal:')&&['index.html','booking.html','multicity-visualizer.html','how-it-works.html','trust.html','about.html'].every(file=>{const value=read(file);return value.includes('id="gv-header"')&&value.includes('id="gv-footer"')&&value.includes('shell-670f.js?v=fe-r3-1b');}));
check('Guest-first UI has no fake email/password authentication form',!/<form\b/i.test(signIn)&&!/type=["']password/i.test(signIn)&&!home.includes('type="password"'));
check('Secure accounts now delegate to Cognito while guest planning remains explicit',signIn.includes('Amazon Cognito')&&signIn.includes('data-gv-auth-signin')&&signIn.includes('Continue as guest')&&!/type=["']password/i.test(signIn));
check('Travel profile is described as browser-local',profile.includes('stored only in this browser')&&!/type=["']password/i.test(profile));
check('Legacy multi-city route redirects with query and hash',legacy.includes("'multicity-visualizer.html'+location.search+location.hash"));
check('Normal shell navigation does not expose obsolete multi-city route',!shell.includes('href="multi-city.html')&&!home.includes('href="multi-city.html'));
check('Progressive generation language contains four user-facing stages',['Finding suitable cities','Connecting the route','Checking price evidence','Preparing your trip'].every(stage=>visualizer.includes(stage)));

check('Journey player is optional and never autoplays',visualizer.includes('Play your journey')&&journeySource.includes('playButton.onclick = play')&&!journeySource.includes('playButton.click()'));
check('Reduced-motion and static/manual paths survive',journeySource.includes('Next journey step')&&journeyCss.includes('@media(prefers-reduced-motion:reduce)')&&visualizer.includes('Show complete route'));
check('Map, rail and cards retain synchronized step evidence',journeySource.includes('dataset.journeyStep')&&visualizerEngine.includes('data-journey-marker')&&visualizerEngine.includes('window.__gvJourneyMapFocus'));
check('Origin-to-return story preserves ground mode',journeyModel.route==='Toronto → Cleveland → Pittsburgh → Toronto'&&journeyModel.steps[2].transport.type==='ground');
check('Destination storytelling and traveler-facing route roles survive',journeySource.includes('gv-journey-days')&&journeySource.includes('gv-journey-arrival')&&['Best overall','Lowest verified cost','Most inspiring'].every(label=>visualizerEngine.includes(label)));
check('Journey budget/evidence context remains honest',visualizer.includes('Whole-group budget')&&visualizer.includes('Current estimate')&&journeyModel.evidence==='Pricing evidence · 2 of 5 components');
check('Complete-trip handoff remains the existing saved-tour handoff',visualizer.includes('Review complete trip')&&visualizerEngine.includes("new URL('multi-city-trip.html',location.href)"));
check('Offline complete-trip QA uses the static map without external map loading',tripEngine.includes("get('offline')==='1'")&&tripEngine.includes('drawFallbackMap(t);return;'));

check('Booking workspace retains all five steps',workspace.STEP_LABELS.join('|')==='Review trip|Verify flights|Verify stays|Price confidence|Complete bookings');
check('Desktop workflow remains approximately 70/30 with sticky summary',workspaceCss.includes('grid-template-columns:minmax(0,2.15fr) minmax(285px,.9fr)')&&workspaceCss.includes('.gv-workspace-sidebar{position:sticky'));
check('Mobile summary remains collapsible/sticky without page-overflow design',renderedWorkspace.includes('<details class="gv-workspace-summary" open>')&&workspaceCss.includes('.gv-workspace-summary>summary{display:flex')&&workspaceCss.includes('.gv-workspace-stepper{top:58px'));
check('Route, budget, total, remaining and evidence stay visible',renderedWorkspace.includes(bookingModel.routeText)&&renderedWorkspace.includes('Whole-group budget')&&renderedWorkspace.includes('Estimated trip total')&&renderedWorkspace.includes('Remaining before extras')&&renderedWorkspace.includes('Partner results reviewed'));
check('Baggage, extras and hotel fee assumptions remain explicit',renderedWorkspace.includes('Baggage and optional extras')&&renderedWorkspace.includes('Room, tax and fee assumptions')&&renderedWorkspace.includes('Taxes, resort fees'));
check('Aviasales route/date stays exact',bookingModel.items[0].url==='https://www.aviasales.com/search/YYZ0209CLE2?marker=rc-686d'&&bookingModel.items[4].url==='https://www.aviasales.com/search/PIT0809YYZ2?marker=rc-686d');
check('Agoda city/date/occupancy/tracking stays exact',[[1,'Cleveland','2026-09-02','2026-09-05'],[3,'Pittsburgh','2026-09-05','2026-09-08']].every(([i,city,checkIn,checkOut])=>{const u=new URL(bookingModel.items[i].url);return u.hostname==='www.agoda.com'&&u.pathname==='/search'&&Object.entries({city,checkIn,checkOut,rooms:'1',adults:'2',children:'0',currency:'CAD',cid:'1891461'}).every(([k,v])=>u.searchParams.get(k)===v);}));
check('Metro-resolved airport remains resolved in handoff',hub.directAviasalesUrl(metroLeg,0,metroTour,2)==='https://www.aviasales.com/search/LGA0509YOW2'&&hub.metroAirportDisclosure(metroLeg).label==='Same-city airport change: JFK → LGA');
check('Provider result reviewed never means booked',renderedWorkspace.includes('Provider result reviewed')&&renderedWorkspace.includes('Reviewed does not mean booked')&&renderedWorkspace.includes('does not mean booked, paid or confirmed'));
check('No fake payment, Pay, confirmation, ticket or combined checkout UI',!/<input[^>]+(?:card|payment|cvv|cvc)/i.test(renderedWorkspace)&&!/>\s*(?:Pay|Confirm booking)\b/i.test(renderedWorkspace)&&renderedWorkspace.includes('No combined booking, price lock, payment, order, confirmation number or ticket'));

check('Visible wording distinguishes provider-backed, cached and planning evidence',renderedWorkspace.includes('Fare observed via Duffel')&&renderedWorkspace.includes('Cached Duffel fare observation')&&renderedWorkspace.includes('Planning estimate — verify price'));
check('Visible wording distinguishes estimated total and reviewed status',renderedWorkspace.includes('Estimated trip total')&&renderedWorkspace.includes('Provider result reviewed'));
check('Visible boundary keeps booking status unknown to Globevoy',renderedWorkspace.includes('Globevoy stops before checkout')&&renderedWorkspace.includes('does not mean booked, paid or confirmed'));
check('Primary workspace content avoids release-engineering terminology and hides sandbox proof',!/(GV-BOOK|GV-RC|683H|685B|686C|Lambda|API client)/.test(renderedWorkspace)&&workspaceCss.includes('>#gv-duffel-section,'));

check('Legal content is preserved after consolidation into public root pages', ['privacy.html','terms.html','affiliate.html'].every(name => promotedPageContentPreserved(name)));
check('Unresolved legal/commercial gate is explicit',release.legalGate==='LEGAL-CONTENT-APPROVAL-REQUIRED'&&legalNote.includes('**LEGAL-CONTENT-APPROVAL-REQUIRED**')&&legalNote.includes('No approval is asserted'));

const allPaths=filesUnder(root).map(file=>file.substring(root.length+1).replace(/\\/g,'/'));
const prohibited=allPaths.filter(file=>/(^|\/)(backend|lambda|server|serverless)(\/|$)|(^|\/)template\.ya?ml$|\.env($|\.)/i.test(file));
check('Package contains no backend, Lambda or runtime-server files',prohibited.length===0,prohibited.join(', '));
check('Journey and workspace additions make no provider/network request',!/\bfetch\s*\(|XMLHttpRequest|GlobevoyApi\./.test(journeySource+workspaceSource));
check('All required isolated browser fixtures are present',['validation/fixtures/gv-journey-686b-browser-fixture.html','validation/fixtures/gv-book-686c-browser-fixture.html','validation/fixtures/gv-book-685d-browser-fixture.html','validation/fixtures/gv-rc-686d-all-flight-browser-fixture.html'].every(exists));

checks.forEach((item,index)=>console.log(`${item.pass?'PASS':'FAIL'} ${String(index+1).padStart(2,'0')} — ${item.name}${item.pass||!item.detail?'':` :: ${item.detail.trim().split(/\r?\n/).slice(-2).join(' | ')}`}`));
const passed=checks.filter(item=>item.pass).length,failed=checks.length-passed;
console.log(`GV-RC-686D MASTER: total=${checks.length} pass=${passed} fail=${failed}`);
if(failed)process.exitCode=1;
