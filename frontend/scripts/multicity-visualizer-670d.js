(function(){
'use strict';
// GV-CONTROL-667D: preserve route dates on shuffle and display practical gateway transfers.
const $=(s)=>document.querySelector(s);
const $$=(s)=>Array.from(document.querySelectorAll(s));
const q=new URLSearchParams(location.search);
const storageKey='globevoy.multi.selected.v1';
const snapshotStoragePrefix='globevoy.generated.snapshot.v1.';
const FRONTEND_VERSION='GV-UX-670D';
const HANDOFF_WINDOW_PREFIX='globevoy.trip.handoff.v1:';
const FX={USD:{rate:1,prefix:'US$',locale:'en-US'},CAD:{rate:1.36,prefix:'C$',locale:'en-CA'},AUD:{rate:1.52,prefix:'A$',locale:'en-AU'},EUR:{rate:.92,prefix:'€',locale:'en-IE'},GBP:{rate:.79,prefix:'£',locale:'en-GB'}};
let map=null,toastTimer=null,activeTour=null,pickTours=[],activePickIndex=0;
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function hashHue(city,country){const text=`${city}|${country}`;let h=0;for(let i=0;i<text.length;i++)h=(h*31+text.charCodeAt(i))%360;return h;}
function svgText(v){return String(v||'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));}
const STATIC_CITY_PHOTOS={
  'montreal|canada':'./assets/images/montreal.jpg',
  'montréal|canada':'./assets/images/montreal.jpg',
  'toronto|canada':'https://commons.wikimedia.org/wiki/Special:Redirect/file/Toronto%20Skyline%20from%20CN%20Tower%2C%20Toronto%2C%20Ontario%20%2821219067113%29.jpg',
  'toronto':'https://commons.wikimedia.org/wiki/Special:Redirect/file/Toronto%20Skyline%20from%20CN%20Tower%2C%20Toronto%2C%20Ontario%20%2821219067113%29.jpg',
  'quebec city|canada':'https://commons.wikimedia.org/wiki/Special:Redirect/file/Qu%C3%A9bec%20City%20skyline%20%28Quintin%20Soloviev%29.jpg',
  'québec city|canada':'https://commons.wikimedia.org/wiki/Special:Redirect/file/Qu%C3%A9bec%20City%20skyline%20%28Quintin%20Soloviev%29.jpg',
  'quebec city':'https://commons.wikimedia.org/wiki/Special:Redirect/file/Qu%C3%A9bec%20City%20skyline%20%28Quintin%20Soloviev%29.jpg',
  'québec city':'https://commons.wikimedia.org/wiki/Special:Redirect/file/Qu%C3%A9bec%20City%20skyline%20%28Quintin%20Soloviev%29.jpg',
  'new york|united states':'./assets/images/new-york-city.jpg',
  'new york city|united states':'./assets/images/new-york-city.jpg',
  'washington, d.c.|united states':'https://source.unsplash.com/featured/1200x720/?washington%20dc%20capitol%20skyline',
  'washington dc|united states':'https://source.unsplash.com/featured/1200x720/?washington%20dc%20capitol%20skyline',
  'washington|united states':'https://source.unsplash.com/featured/1200x720/?washington%20dc%20capitol%20skyline',
  'detroit|united states':'https://source.unsplash.com/featured/1200x720/?detroit%20skyline',
  'ottawa|canada':'https://source.unsplash.com/featured/1200x720/?ottawa%20parliament%20skyline',
  'belfast|united kingdom':'https://source.unsplash.com/featured/1200x720/?belfast%20city%20skyline',
  'bodrum|turkey':'https://source.unsplash.com/featured/1200x720/?bodrum%20turkey%20castle%20coast',
  'philadelphia|united states':'https://source.unsplash.com/featured/1200x720/?philadelphia%20skyline',
  'chicago|united states':'https://source.unsplash.com/featured/1200x720/?chicago%20skyline',
  'nashville|united states':'https://source.unsplash.com/featured/1200x720/?nashville%20skyline',
  'oklahoma city|united states':'https://source.unsplash.com/featured/1200x720/?oklahoma%20city%20skyline',
  'orlando|united states':'https://source.unsplash.com/featured/1200x720/?orlando%20skyline',
  'edmonton|canada':'https://source.unsplash.com/featured/1200x720/?edmonton%20canada%20skyline',
  'cologne|germany':'https://source.unsplash.com/featured/1200x720/?cologne%20germany%20cathedral%20skyline',
  'mexico city|mexico':'./assets/images/mexico-city.jpg',
  // GV-AI-662B/GV-PHOTO-662B: curated public photo hints for common generated-tour cities.
  // These are best-effort browser image URLs; generated artwork remains the safe fallback.
  'cancun|mexico':'https://source.unsplash.com/featured/1200x720/?cancun,mexico,beach',
  'san jose|costa rica':'https://source.unsplash.com/featured/1200x720/?san%20jose,costa%20rica,city',
  'panama city|panama':'https://source.unsplash.com/featured/1200x720/?panama%20city,panama,skyline',
  'cartagena|colombia':'https://source.unsplash.com/featured/1200x720/?cartagena,colombia,old%20town',
  'guatemala city|guatemala':'https://source.unsplash.com/featured/1200x720/?guatemala%20city,guatemala',
  'caye caulker|belize':'https://source.unsplash.com/featured/1200x720/?caye%20caulker,belize,island',
  'campeche|mexico':'https://source.unsplash.com/featured/1200x720/?campeche,mexico,colonial',
  'london|united kingdom':'https://source.unsplash.com/featured/1200x720/?london,skyline',
  'cairo|egypt':'https://source.unsplash.com/featured/1200x720/?cairo,egypt,pyramids',
  'batumi|georgia':'https://source.unsplash.com/featured/1200x720/?batumi,georgia,black%20sea',
  'tehran|iran':'https://source.unsplash.com/featured/1200x720/?tehran,iran,city',
  'muscat|oman':'https://source.unsplash.com/featured/1200x720/?muscat,oman,waterfront',
  'doha|qatar':'https://source.unsplash.com/featured/1200x720/?doha,qatar,skyline',
  'san diego|united states':'https://source.unsplash.com/featured/1200x720/?san%20diego,california,coast',
  'las vegas|united states':'https://source.unsplash.com/featured/1200x720/?las%20vegas,strip',
  'victoria|canada':'https://source.unsplash.com/featured/1200x720/?victoria,bc,harbour',
  'vancouver|canada':'https://source.unsplash.com/featured/1200x720/?vancouver,canada,skyline',
  'seattle|united states':'https://source.unsplash.com/featured/1200x720/?seattle,skyline',
  'tofino|canada':'https://source.unsplash.com/featured/1200x720/?tofino,canada,coast',
  'portland (maine)|united states':'https://source.unsplash.com/featured/1200x720/?portland,maine,waterfront',
  'portland|united states':'https://source.unsplash.com/featured/1200x720/?portland,oregon,skyline',
  'boston|united states':'https://source.unsplash.com/featured/1200x720/?boston,skyline'
};
function knownCityPhoto(city,country){const c=String(city||'').trim().toLowerCase(),ct=String(country||'').trim().toLowerCase();return STATIC_CITY_PHOTOS[`${c}|${ct}`]||STATIC_CITY_PHOTOS[c]||'';}
const AIRPORT_GATEWAY_LABELS={ICN:'Seoul Incheon',GMP:'Seoul Gimpo'};
function requestedOriginRaw(){return String(q.get('origin')||'').trim();}
function requestedOriginCity(){const raw=requestedOriginRaw();if(!raw||/^[A-Za-z]{3}$/.test(raw))return'';return raw.replace(/\s*\([A-Za-z]{3}\)\s*$/,'').split(',')[0].trim();}
function displayOriginCity(t){return requestedOriginCity()||String(t?.origin?.city||'Origin').trim()||'Origin';}
function originGatewayName(t){const code=originDisplayCode(t?.origin||{});return AIRPORT_GATEWAY_LABELS[code]||'';}
function originSummaryLabel(t){const city=displayOriginCity(t),code=originDisplayCode(t?.origin||{}),gateway=originGatewayName(t);return gateway?`${city} — via ${gateway}${code?` (${code})`:''}`:`${city}${code?` (${code})`:''}`;}
function isExactDateRequest(){const mode=String(q.get('dateMode')||'').toLowerCase();return mode==='exact'||(String(q.get('flexible')||'').toLowerCase()==='false'&&!!(q.get('departureDate')||q.get('startDate')));}
function requestedExactDateRange(){const start=String(q.get('departureDate')||q.get('startDate')||'').slice(0,10);const end=String(q.get('returnDate')||q.get('endDate')||'').slice(0,10);return {start:/^\d{4}-\d{2}-\d{2}$/.test(start)?start:'',end:/^\d{4}-\d{2}-\d{2}$/.test(end)?end:''};}
function formatExactDateRange(){const {start,end}=requestedExactDateRange();if(!start)return'';const a=new Date(`${start}T12:00:00Z`),b=end?new Date(`${end}T12:00:00Z`):null;const fmt=(d,year=true)=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',...(year?{year:'numeric'}:{})}).format(d);if(!b||Number.isNaN(b.getTime()))return fmt(a,true);if(a.getUTCFullYear()===b.getUTCFullYear()&&a.getUTCMonth()===b.getUTCMonth())return `${new Intl.DateTimeFormat('en-US',{month:'short'}).format(a)} ${a.getUTCDate()}–${b.getUTCDate()}, ${a.getUTCFullYear()}`;if(a.getUTCFullYear()===b.getUTCFullYear())return `${fmt(a,false)}–${fmt(b,true)}`;return `${fmt(a,true)}–${fmt(b,true)}`;}
function discoveryCityRecord(city,country){try{const list=Array.isArray(window.GLOBEVOY_PUBLIC_DISCOVERY_500)?window.GLOBEVOY_PUBLIC_DISCOVERY_500:[];const c=normalizedLabel(city),ct=normalizedLabel(country);return list.find(item=>normalizedLabel(item?.city)===c&&(!ct||normalizedLabel(item?.country)===ct))||null;}catch(_){return null;}}
function stableDataPhoto(city,country){const item=discoveryCityRecord(city,country)||{};return String(item.img||item.image||item.heroImage||'').trim();}
function isUnstableSearchPhoto(url){return /source\.unsplash\.com/i.test(String(url||''));}
function stableHash(value){let h=2166136261;for(const ch of String(value||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36);}
function snapshotIdFromTour(t){const legs=Array.isArray(t?.backendLegs)?t.backendLegs:(Array.isArray(t?.legs)?t.legs:[]);const departure=officialLegDate(legs[0])||safeIso(t?.itineraryDatePlan?.canonicalDepartureDate)||q.get('departureDate')||'';return `gv670a-${stableHash([displayOriginCity(t),currentStopIds(t),departure,totalBudget(t),partyInfo(t).travellers].join('|'))}`;}
function snapshotStorageKey(id){return snapshotStoragePrefix+String(id||'');}
function readSavedSnapshot(){const id=String(q.get('snapshot')||'').trim();if(!id)return null;try{const raw=localStorage.getItem(snapshotStorageKey(id));const parsed=raw?JSON.parse(raw):null;return parsed?.tour&&Array.isArray(parsed.tour.cities)&&parsed.tour.cities.length?parsed.tour:null;}catch(_){return null;}}

function searchableCityPhoto(city,country){const name=String(city||'').trim();if(!name)return'';const area=String(country||'').trim();const query=[name,area,'city skyline travel'].filter(Boolean).join(' ');return `https://source.unsplash.com/featured/1200x720/?${encodeURIComponent(query)}`;}
function generatedCityImage(city,country){const hue=hashHue(city||'Destination',country||''),h2=(hue+42)%360,h3=(hue+184)%360;const safeCity=svgText(city||'Destination'),safeCountry=svgText(country||'');const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 720" role="img" aria-label="${safeCity} travel image"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="hsl(${hue},66%,44%)"/><stop offset=".55" stop-color="hsl(${h2},58%,35%)"/><stop offset="1" stop-color="hsl(${h3},48%,26%)"/></linearGradient></defs><rect width="1200" height="720" fill="url(#g)"/><circle cx="965" cy="120" r="155" fill="rgba(255,255,255,.18)"/><path d="M0 510 C160 392 310 424 450 344 C620 246 790 318 930 220 C1040 142 1135 174 1200 128 L1200 720 L0 720 Z" fill="rgba(255,255,255,.24)"/><path d="M0 570 C190 492 340 526 520 456 C690 388 850 438 1038 358 C1132 318 1180 312 1200 302 L1200 720 L0 720 Z" fill="rgba(4,18,34,.28)"/><g fill="rgba(255,255,255,.78)"><rect x="118" y="355" width="48" height="185" rx="8"/><rect x="188" y="302" width="72" height="238" rx="10"/><rect x="282" y="388" width="55" height="152" rx="8"/><rect x="362" y="335" width="88" height="205" rx="10"/><rect x="470" y="408" width="58" height="132" rx="8"/></g><text x="70" y="104" fill="white" font-family="Inter,Arial,sans-serif" font-weight="900" font-size="64" letter-spacing="-2">${safeCity}</text><text x="74" y="154" fill="rgba(255,255,255,.80)" font-family="Inter,Arial,sans-serif" font-weight="800" font-size="28" letter-spacing="4">${safeCountry}</text></svg>`;return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;}
function installPhoto(card,url,city,country,loading){if(!card||!url)return;const photo=card.querySelector('.mcv-card-photo');if(!photo)return;const img=new Image();img.alt=`${city||'Destination'}, ${country||''}`;img.loading=loading||'lazy';img.decoding='async';const isGenerated=String(url).startsWith('data:image/svg+xml');if(isGenerated)img.dataset.generatedArtwork='1';img.src=url;const apply=()=>{card.querySelector('.mcv-photo-placeholder')?.remove();const existing=photo.querySelector('img');if(existing&&existing.dataset.generatedArtwork==='1'&&!isGenerated)existing.replaceWith(img);else if(!existing)photo.prepend(img);else if(!isGenerated)existing.replaceWith(img);photo.classList.add('has-photo');photo.classList.toggle('has-generated-artwork',isGenerated);};if(isGenerated||String(url).startsWith('./assets/')||String(url).startsWith('/assets/')){apply();return;}img.onload=apply;img.onerror=()=>{if(!photo.querySelector('img')){const generated=generatedCityImage(city,country);if(generated&&generated!==url)installPhoto(card,generated,city,country,'eager');}};}
function currencyOf(t){return String(t?.budget?.total?.currency||t?.displayBudget?.currency||q.get('currency')||'CAD').toUpperCase();}
function fxFor(t){const cur=currencyOf(t);return FX[cur]||FX.CAD;}
function exchangeRate(t){return Number(t?.canonicalPricing?.exchangeRateFromUsd||t?.displayBudget?.exchangeRateFromUsd||fxFor(t).rate||1);}
function money(value,t){const currency=currencyOf(t),fx=fxFor(t);try{return new Intl.NumberFormat(fx.locale,{style:'currency',currency,maximumFractionDigits:0}).format(Number(value)||0)}catch(_){return `${fx.prefix}${Math.round(Number(value)||0)}`}}
function usdMoney(value,t){return money((Number(value)||0)*exchangeRate(t),t)}
function safeNumber(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function validPoint(p){const lat=Number(p?.lat??p?.latitude),lng=Number(p?.lng??p?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return null;return {lat,lng};}
function cityRecord(city){const list=Array.isArray(window.GLOBEVOY_DESTINATIONS)?window.GLOBEVOY_DESTINATIONS:[];const keys=[city?.id,city?.cityId,city?.code,city?.airportCode,city?.city].filter(Boolean).map(String);return list.find((d)=>keys.some((k)=>String(d.id||'').toLowerCase()===k.toLowerCase()||String(d.code||'').toUpperCase()===k.toUpperCase()||String(d.city||'').toLowerCase()===k.toLowerCase()))||{};}
function pointForCity(city){return validPoint(city)||validPoint(cityRecord(city));}
function getStoredTour(){try{const raw=sessionStorage.getItem(storageKey);if(!raw)return null;const t=JSON.parse(raw);if(!t||!Array.isArray(t.cities)||!t.cities.length)return null;const wanted=q.get('routeId');if(wanted&&t.routeId&&wanted!==t.routeId)return null;return t;}catch(_){return null;}}
function routePoints(t){const originPoint=validPoint(t.origin)||pointForCity(t.origin);const originLabel=displayOriginCity(t);const points=[];if(originPoint)points.push({...originPoint,label:originLabel,origin:true});(t.cities||[]).forEach((city,index)=>{const p=pointForCity(city);if(p)points.push({...p,label:city.city||`Stop ${index+1}`,stop:index+1});});if(originPoint)points.push({...originPoint,label:originLabel,returnPoint:true});return points;}
function routePath(t){const origin=displayOriginCity(t);return [origin,...(t.cities||[]).map(c=>c.city).filter(Boolean),origin];}
function routeTitle(t){const names=(t.cities||[]).map((c)=>c.city).filter(Boolean);return names.length?names.join(' + '):(t.title||'Generated multi-city tour');}
function activeRole(t){const explicit=Number(t?.displayOptionNumber);if(Number.isFinite(explicit)&&explicit>0)return `Option ${Math.round(explicit)}`;const raw=String(t?.pickRole||t?.recommendationLabel||t?.tourRoleLabel||t?.tourRole||t?.pickRoleLabel||'').toLowerCase();if(raw.includes('low'))return 'Option 1';if(raw.includes('balance')||raw.includes('recommended'))return 'Option 2';if(raw.includes('memorable')||raw.includes('discover'))return 'Option 3';return 'Selected option';}
function totalEstimate(t){return safeNumber(t?.canonicalPricing?.canonicalDisplayTotal)||safeNumber(t?.budget?.estimatedCoreTotal?.amount)||safeNumber(t?.displayBudget?.tripEstimate)||safeNumber(q.get('estimatedTotal'))||0;}
function totalBudget(t){return safeNumber(t?.budget?.total?.amount)||safeNumber(t?.displayBudget?.totalBudget)||safeNumber(q.get('budget'))||0;}
function budgetTolerance(amount){return Math.max(5, safeNumber(amount)*0.005);}
function isTourOverBudget(t){const budget=totalBudget(t), estimate=totalEstimate(t);return budget>0&&estimate>budget+budgetTolerance(budget);}
function budgetOverage(t){return Math.max(0, Math.round(totalEstimate(t)-totalBudget(t)));}
function budgetGuardrailCopy(t){const over=budgetOverage(t);return over?`This route is over budget by about ${money(over,t)}. Try a higher budget, fewer stops, or shorter dates.`:'This route stays within your entered budget.';}
function markBudgetStatus(t,status,message){if(!t)return t;t.clientBudgetGuardrail={status,message:message||''};t.affordabilityStatus=status;return t;}
function backendBudgetFit(t){const budget=totalBudget(t),estimate=totalEstimate(t);return budget>0&&estimate>0&&estimate<=budget+budgetTolerance(budget);}
function stopCount(t){return Array.isArray(t?.cities)?t.cities.length:0;}
function simpleRouteMessage(t){return `Only ${stopCount(t)} destination stop fits this budget. Increase the budget to unlock a stronger 2-city tour.`;}
function applyBudgetGuardrail(t){const next=cloneTour(t);if(!next||!Array.isArray(next.cities)||!next.cities.length)return null;const initialStops=stopCount(next);if(backendBudgetFit(next)){if(initialStops<2){next.routeControl={...(next.routeControl||{}),simpleRouteFallback:true,message:simpleRouteMessage(next)};return markBudgetStatus(next,'simple-budget-route',simpleRouteMessage(next));}return markBudgetStatus(next,'within-budget','Route estimate fits the entered budget.');}rebuildLocalLegs(next);recalcLocalBudget(next);if(!isTourOverBudget(next)){if(stopCount(next)<2){next.routeControl={...(next.routeControl||{}),simpleRouteFallback:true,message:simpleRouteMessage(next)};return markBudgetStatus(next,'simple-budget-route',simpleRouteMessage(next));}return markBudgetStatus(next,'within-budget','Route estimate fits the entered budget.');}while(next.cities.length>2&&isTourOverBudget(next)){next.cities.pop();if(Array.isArray(next.stays))next.stays.pop();rebuildLocalLegs(next);recalcLocalBudget(next);}if(!isTourOverBudget(next))return markBudgetStatus(next,'within-budget-after-pruning','Route kept to the strongest 2-city budget-fit tour.');return null;}
function partyInfo(t){const p=t?.passengerPricing||{};const adults=Number(p.adults??q.get('adults')??q.get('passengers')??1)||1;const children=Number(p.children??q.get('children')??0)||0;const infants=Number(p.infants??q.get('infants')??0)||0;const rooms=Number(p.rooms||1)||1;return {adults,children,infants,rooms,travellers:Number(p.travellers)||adults+children+infants};}
function passengerText(t){const p=partyInfo(t);const parts=[`${p.adults} adult${p.adults===1?'':'s'}`];if(p.children)parts.push(`${p.children} child${p.children===1?'':'ren'}`);if(p.infants)parts.push(`${p.infants} infant${p.infants===1?'':'s'}`);return parts.join(' + ');}
function roomText(stay,city,t){const h=stay?.hotel||city?.hotel||{};const rooms=Number(h?.pricingIntegrity?.roomCount||h.rooms||partyInfo(t).rooms||1)||1;return `${rooms} room${rooms===1?'':'s'}`;}
function partyPriceNote(leg,t){const p=leg?.pricingIntegrity||{};const travellers=Number(p.travellers||partyInfo(t).travellers||1)||1;return travellers>1?`${travellers} travellers total`:'1 traveller total';}
function returnUrl(){return q.get('returnTo')||'index.html';}
function transportName(leg){return String(leg?.transportType||leg?.type||leg?.mode||'connection').replace(/-/g,' ').replace(/\b\w/g,(m)=>m.toUpperCase());}
function formatDate(value){const s=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date(`${s}T12:00:00Z`));}catch(_){return s;}}
function legDepartureDate(leg,index){return formatDate(leg?.cheapestOneWay?.departureDate)||formatDate(leg?.departureDate)||leg?.dateLabel||leg?.departureWindow||`Flexible date ${index+1}`;}
function legTiming(leg){const ow=leg?.cheapestOneWay||{};if(isProviderBackedLeg(leg)){const dep=ow.departureTime||leg?.departureTime;const arr=ow.arrivalTime||leg?.arrivalTime;if(dep&&arr)return `${dep} → ${arr}`;if(dep)return `Departs ${dep}`;if(ow.durationLabel)return ow.durationLabel;}return 'Timing confirmed with partner';}
function airlineName(code){const c=String(code||'').toUpperCase();const map={AC:'Air Canada',WS:'WestJet',PD:'Porter Airlines',TS:'Air Transat',AA:'American Airlines',DL:'Delta',UA:'United',BA:'British Airways',FR:'Ryanair',U2:'easyJet',EI:'Aer Lingus',AM:'Aeroméxico'};return map[c]||c||null;}
function legOperator(leg){const ow=leg?.cheapestOneWay||leg?.providerDateEvidence||{};const airline=isProviderBackedLeg(leg)?airlineName(ow.airline||leg?.airline):null;if(airline)return airline;const mode=String(leg?.mode||leg?.transportType||'').toLowerCase();if(mode.includes('rail'))return 'Rail partner options';if(mode.includes('bus')||mode.includes('ground'))return 'Rail or bus options';if(mode.includes('flight'))return isProviderBackedLeg(leg)?'Flight partner option':'Estimated flight option';return 'Partner options';}
function legBookingUrl(leg){const url=String(leg?.booking?.url||leg?.cheapestOneWay?.bookingLink||leg?.bookingUrl||leg?.providerUrl||'').trim();if(!/^https:\/\//i.test(url))return '';return url;}
function hotelName(stay,city,index){const h=stay?.hotel||city?.hotel||{};return h.name||h.hotelName||`${city?.city||'Central'} value stay`;}
function hotelMeta(stay,city){const h=stay?.hotel||city?.hotel||{};const rating=Number(h.rating||h.reviewScore||h.guestRating);const reviews=Number(h.reviews||h.reviewCount);if(rating&&reviews)return `${rating.toFixed(1)} guest score · ${reviews.toLocaleString()} reviews`;if(rating)return `${rating.toFixed(1)} guest score`;return 'Review score pending provider confirmation';}
function hotelProvider(stay,city){const h=stay?.hotel||city?.hotel||{};return h.provider||h.source||'Agoda stay estimate';}
function hotelBookingUrl(stay,city){const h=stay?.hotel||city?.hotel||{};const url=String(h.booking?.url||h.bookingUrl||h.providerUrl||h.url||'').trim();return /^https:\/\//i.test(url)?url:'';}
function flightPriceSourceLabel(leg){const p=leg?.priceProvenance||{};const v=leg?.providerVerification||{};if(v.verified&&v.exactDateMatch&&v.productionEligible!==false)return isExactDateRequest()?'Verified exact-date fare':'Exact-date provider evidence';if(p.category==='provider-observation'&&v.productionEligible!==false)return 'Provider fare evidence';if(p.category==='ground-transfer-estimate')return 'Transfer estimate';return isExactDateRequest()?'Partner confirmation required':'Planning estimate';}
function stayPriceSourceLabel(stay,city){const h=stay?.hotel||city?.hotel||{};const p=h.priceProvenance||{};const v=h.providerVerification||{};if(v.verified&&v.exactStayDates&&v.productionEligible===true)return 'Exact-date Agoda evidence';return p.category==='provider-rate-evidence'?'Agoda rate evidence':'Stay estimate';}
function flightActionLabel(leg){return leg?.booking?.label||((leg?.priceProvenance||{}).category==='provider-observation'?'View provider fare':'Compare flight');}
function stayActionLabel(stay,city){const h=stay?.hotel||city?.hotel||{};return h.booking?.label||'View stays';}
function openOrToast(url,message){if(url){window.open(url,'_blank','noopener');return;}showToast(message||'Partner options are coming next.');}
function nightsText(n){const v=safeNumber(n);return v===1?'1 night':`${v||0} nights`;}

function canonicalComponent(t,key){return (Array.isArray(t?.canonicalPricing?.components)?t.canonicalPricing.components:[]).find(item=>item?.key===key)||null;}
function legAmount(leg,t,index){if(!leg)return 0;const canonical=leg?.canonicalPricing||canonicalComponent(t,`transport:${index}`);if(canonical&&safeNumber(canonical.amountDisplay)>=0)return safeNumber(canonical.amountDisplay);const usd=safeNumber(leg.estimatedFlightUsd)||safeNumber(leg.estimatedTransportUsd)||safeNumber(leg.amountUsd);if(usd)return Math.round(usd*exchangeRate(t));return safeNumber(leg.amount);}
function stayForDestination(t,city,index){const stays=Array.isArray(t.stays)?t.stays:[];return stays.find(s=>String(s.city||'').toLowerCase()===String(city?.city||'').toLowerCase())||stays[index]||{city:city?.city,country:city?.country,nights:city?.nights||0,hotel:city?.hotel||null};}
function stayAmount(stay,t,index){const h=stay?.hotel||{};const canonical=h?.canonicalPricing||canonicalComponent(t,`stay:${index}`);if(canonical&&safeNumber(canonical.amountDisplay)>=0)return safeNumber(canonical.amountDisplay);const usd=safeNumber(h.estimatedStayUsd)||(safeNumber(h.estimatedNightlyUsd)*safeNumber(stay?.nights));if(usd)return Math.round(usd*exchangeRate(t));const totalStay=safeNumber(t?.budget?.accommodation?.amount)||safeNumber(t?.displayBudget?.accommodationEstimate);const nightsTotal=(Array.isArray(t.stays)?t.stays:[]).reduce((sum,s)=>sum+safeNumber(s.nights),0);return nightsTotal&&safeNumber(stay?.nights)?Math.round(totalStay*(safeNumber(stay.nights)/nightsTotal)):0;}
function legDestinationCity(t,leg,index){const toCity=String(leg?.to?.city||'').toLowerCase();return (t.cities||[]).find(c=>String(c.city||'').toLowerCase()===toCity)||t.cities?.[index]||null;}
function genericReason(leg,city,isReturn){if(isReturn)return 'Keeps the route as a complete circuit back to your starting city.';const source=String(leg?.estimateSource||'');if(isProviderBackedLeg(leg))return 'Selected using provider-backed cheap one-way date evidence while respecting your budget.';if(source.includes('cheapest-one-way'))return 'Selected because the backend found a cheap one-way flight date for this leg.';if(String(leg?.mode||'').includes('ground'))return 'Selected because it keeps the route regional and avoids forcing unnecessary flights.';return `Selected for route fit, budget fit, and provider coverage in ${city?.city||'this stop'}.`;}
function showToast(msg){let el=$('.mcv-toast');if(!el){el=document.createElement('div');el.className='mcv-toast';document.body.appendChild(el);}el.textContent=msg;el.classList.add('is-visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('is-visible'),2400);}
function renderHeader(t){
  const path=routePath(t);
  const provenance=t.priceProvenance||{};
  const providerFlightCount=safeNumber(provenance.flightProviderCount);
  const estimatedFlightCount=safeNumber(provenance.flightEstimateCount);
  const providerHotelCount=safeNumber(provenance.hotelProviderCount);
  const estimatedHotelCount=safeNumber(provenance.hotelEstimateCount);
  const providerCount=providerFlightCount+providerHotelCount;
  const pricedItemCount=providerCount+estimatedFlightCount+estimatedHotelCount;
  const providerCoverage=pricedItemCount>0?providerCount/pricedItemCount:0;
  const confidence=t.routeConfidence||{};
  const live=t.liveProviderVerification||provenance.liveProviderVerification||{};
  const providerBackedFit=live.budgetClaim==='provider-backed-fit'&&live.allCriticalVerified===true;
  const estimatedFit=!providerBackedFit&&(confidence.level==='planning-estimate'||t.affordabilityClaim==='estimated-to-fit-budget'||live.budgetClaim==='estimated-to-fit-budget'||providerCoverage<0.5);
  const sourceNote=live.criticalCount
    ?`${safeNumber(live.verifiedCount)} of ${safeNumber(live.criticalCount)} critical prices have production-eligible exact-date provider evidence. Final inventory and price are confirmed on partner websites.`
    :providerCount
      ?'Provider evidence is used where available; remaining amounts are planning estimates.'
      :'Current amounts are planning estimates; partner pages confirm live prices and availability.';
  const guard=t.clientBudgetGuardrail||{};
  const budget=totalBudget(t),estimate=totalEstimate(t),over=budget>0&&estimate>budget+budgetTolerance(budget);
  const destinationStops=Math.max(0,path.length-2);
  const simple=destinationStops<2||guard.status==='simple-budget-route';
  $('#mcv-title').textContent=routeTitle(t);
  $('#mcv-subtitle').textContent=`${activeRole(t)} · ${path[0]} loop · ${safeNumber(t.totalNights)||destinationStops} nights · ${destinationStops} stop${destinationStops===1?'':'s'}`;
  $('#mcv-route-role').textContent=simple?'Comfort-first route':guard.status==='within-budget-after-pruning'?'Budget-fit route':activeRole(t);
  $('#mcv-total').textContent=money(estimate,t);
  if(t?.canonicalPricing&&t.canonicalPricing.totalsMatchVisibleCards!==true)showToast('Pricing integrity check failed. Please regenerate this route.');
  $('#mcv-summary-origin').textContent=originSummaryLabel(t);
  $('#mcv-summary-budget').textContent=money(budget,t);
  $('#mcv-summary-nights').textContent=String(safeNumber(t.totalNights)||destinationStops||'—');
  $('#mcv-summary-passengers').textContent=passengerText(t);
  const fit=$('#mcv-budget-fit');
  if(fit){
    fit.textContent=over?'Over budget':providerBackedFit?'Provider-backed fit':simple?(estimatedFit?'Estimated to fit budget':'Fits budget'):estimatedFit?'Estimated to fit budget':'Fits budget';
    fit.classList.toggle('is-over-budget',over);
    fit.classList.toggle('is-pruned',guard.status==='within-budget-after-pruning'||simple);
    fit.classList.toggle('is-estimated-fit',!over&&estimatedFit);
  }
  $('#mcv-circuit-title').textContent=`${path[0]} circuit`;
  const party=partyInfo(t);const partyNote=`Totals reflect ${passengerText(t)} and ${party.rooms} room${party.rooms===1?'':'s'}.`;
  $('#mcv-circuit-copy').textContent=(guard.message?`${guard.message} ${routeTitle(t)} — generated from your origin, budget and route evidence.`:`${routeTitle(t)} — generated from your origin, budget and route evidence.`)+` ${sourceNote} ${partyNote}`;
  $('#mcv-error-back').href=returnUrl();
  $('#mcv-route-strip').innerHTML=path.map((name,index)=>`<span class="mcv-route-token${index===0||index===path.length-1?' is-origin':''}">${escapeHtml(name)}${index===0?' <span style="opacity:.62">(origin)</span>':''}</span>${index<path.length-1?'<span class="mcv-route-arrow">›</span>':''}`).join('');
}

function firstTravelLeg(t){const legs=Array.isArray(t.backendLegs)?t.backendLegs:Array.isArray(t.legs)?t.legs:[];return legs.find((leg)=>String(leg?.to?.city||'').toLowerCase()!==String(t.origin?.city||'').toLowerCase())||legs[0]||null;}

function providerEvidence(leg){return leg?.cheapestOneWay||leg?.providerDateEvidence||{};}
function hasRejectedProviderEvidence(leg){const ow=providerEvidence(leg);return !!(ow.providerBacked&&ow.appliedToEstimate===false);}
function isProviderBackedLeg(leg){const ow=providerEvidence(leg);if(hasRejectedProviderEvidence(leg)||ow.productionEligible===false||leg?.providerVerification?.productionEligible===false)return false;return !!((ow.providerBacked&&ow.appliedToEstimate!==false)||leg?.liveFareVerified||String(leg?.estimateSource||'').includes('travelpayouts-provider'))}
function officialLegDate(leg){const ow=providerEvidence(leg),auto=leg?.automaticTourDate||{};const raw=isProviderBackedLeg(leg)?(ow.departureDate||leg?.departureDate||leg?.dateLabel):(auto.departureDate||leg?.departureDate||leg?.dateLabel);return safeIso(raw);}
function isGroundLeg(leg){const mode=String(leg?.mode||leg?.transportType||'').toLowerCase();const operator=String(leg?.operator||'').toLowerCase();const source=String(leg?.dateSource||leg?.estimateSource||'').toLowerCase();return !!(mode.includes('ground')||mode.includes('rail')||mode.includes('bus')||operator.includes('rail')||operator.includes('bus')||source.includes('ground-leg'));}
function providerDateText(leg){const ow=providerEvidence(leg);const auto=leg?.automaticTourDate||{};const raw=isProviderBackedLeg(leg)?ow.departureDate:(auto.departureDate||leg?.departureDate||leg?.dateLabel);if(!safeIso(raw))return null;const formatted=formatDate(raw)||raw;if(isExactDateRequest())return `Exact date: ${formatted}`;return isProviderBackedLeg(leg)?`Provider-backed date: ${formatted}`:`Auto-selected date: ${formatted}`;}
function providerEvidenceCopy(leg){const ow=providerEvidence(leg);const verification=leg?.providerVerification||{};if(isExactDateRequest())return 'Globevoy preserved the dates you entered. Partner sites confirm live fares and availability.';if(isGroundLeg(leg))return 'Globevoy selected this regional transfer timing automatically; final rail or bus availability is confirmed with partners.';if(verification.verified&&verification.exactDateMatch)return verification.cacheHit?'An exact route/date fare was found in provider cache. Final inventory and price are confirmed on the partner website.':'An exact route/date fare was found during provider verification. Final inventory and price are confirmed on the partner website.';if(hasRejectedProviderEvidence(leg)){const seen=formatDate(ow.departureDate)||ow.departureDate;return seen?`Provider fare was observed for ${seen}, but Globevoy kept the automatic route date because the observed option did not fit this trip or budget guardrail.`:'Provider fare evidence was observed, but Globevoy kept the automatic route date because the observed option did not fit this trip or budget guardrail.';}if(isProviderBackedLeg(leg))return 'Travelpayouts/Aviasales fare observation was used for this leg estimate. Final timing is confirmed with partners.';return 'Globevoy selected this date automatically from the route plan. Provider-backed observations appear when available.';}
function providerFareLabel(leg,t,transportPrice){const ow=providerEvidence(leg);const integrity=leg?.pricingIntegrity||{};const totalUsd=safeNumber(integrity.partyTotalUsd)||safeNumber(ow.partyTotalAmountUsd);const unitUsd=safeNumber(integrity.unitAmountUsd)||safeNumber(ow.perPassengerAmountUsd);const multiplier=safeNumber(integrity.multiplier)||1;if(isProviderBackedLeg(leg)&&totalUsd){const total=money(totalUsd*exchangeRate(t),t);if(unitUsd&&multiplier>1)return `${total} total · ${money(unitUsd*exchangeRate(t),t)} per traveller`;return `${total} provider total`;}return `${transportPrice} · ${partyPriceNote(leg,t)}`;}
function providerStatusLabel(leg){if(isExactDateRequest())return 'Exact date';if(isGroundLeg(leg))return 'Planned date';if(isProviderBackedLeg(leg))return 'Verified date';return 'Planned date';}
function dateOptionsFromLeg(leg){const ow=leg?.cheapestOneWay||leg?.providerDateEvidence||{};const options=Array.isArray(ow.dateOptions)?ow.dateOptions:[];return options.filter(o=>/^\d{4}-\d{2}-\d{2}$/.test(String(o.departureDate||''))).slice(0,5);}
function safeIso(value){const s=String(value||'').slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null;}
function legAutoDateLabel(leg,index,isReturn){const ow=providerEvidence(leg);const auto=leg?.automaticTourDate||{};const raw=isProviderBackedLeg(leg)?safeIso(ow.departureDate):(safeIso(auto.departureDate)||safeIso(leg?.departureDate)||safeIso(leg?.dateLabel));const formatted=raw?formatDate(raw):null;if(formatted)return `${isReturn?'Return':'Depart'} ${formatted}`;if(isExactDateRequest())return 'Exact date';return index===0?'Date selected by Globevoy':'Auto-selected date';}

function normalizedLabel(v){return String(v||'').trim().toLowerCase();}
function originDisplayCode(city){
  const cityName=normalizedLabel(city?.city);
  const code=String(city?.code||'').trim().toUpperCase();
  const airport=String(city?.airportCode||'').trim().toUpperCase();
  if(cityName==='montreal'||cityName==='montréal'){
    if(airport==='YUL'||code==='YUL'||(Array.isArray(city?.airportCodes)&&city.airportCodes.map(c=>String(c).toUpperCase()).includes('YUL')))return 'YUL';
    if(code==='YMQ')return 'YUL';
  }
  return airport||code;
}
function citySubtitle(city,kind,t){
  const cityName=normalizedLabel(city?.city);
  const code=originDisplayCode(city);
  if(kind==='origin'){const gateway=originGatewayName(t);return gateway&&code?`Flying via ${gateway} · ${code}`:(code?`Starting airport · ${code}`:'Starting city');}
  const candidates=[city?.country,city?.countryName,city?.countryCode,city?.region,code]
    .map((v)=>String(v||'').trim())
    .filter(Boolean)
    .filter((v)=>normalizedLabel(v)!==cityName);
  return candidates[0] || (kind==='return'?'Return to origin':'Generated stop');
}
function durationText(leg){const ow=leg?.cheapestOneWay||{};if(ow.departureTime&&ow.arrivalTime)return `${ow.departureTime} → ${ow.arrivalTime}${ow.durationLabel?` · ${ow.durationLabel}`:''}`;if(ow.durationLabel)return ow.durationLabel;if(ow.durationMinutes){const h=Math.floor(Number(ow.durationMinutes)/60),m=Number(ow.durationMinutes)%60;return h?`${h}h${m?` ${m}m`:''}`:`${m}m`;}return ow.duration||leg?.duration||leg?.durationLabel||leg?.travelTime||(leg?.liveFareVerified?'Provider fare observation':'Timing confirmed with partner');}
function starsText(stay,city){const h=stay?.hotel||city?.hotel||{};const rating=safeNumber(h.stars||h.starRating);if(rating)return '★'.repeat(Math.max(1,Math.min(5,Math.round(rating))));return '★★★★';}
function stopLabel(kind,stopNumber){if(kind==='origin')return 'Origin';if(kind==='return')return 'Return';return `Stop ${stopNumber}`;}
function cardControls(kind,index){if(kind==='origin')return '';if(kind==='return')return `<div class="mcv-card-controls mcv-card-controls--icons" aria-label="Card actions"><button class="mcv-control-btn" type="button" data-action="refresh" data-stop-index="${index}" aria-label="Refresh return leg">↻</button></div>`;return `<div class="mcv-card-controls mcv-card-controls--icons" aria-label="Card actions"><button class="mcv-control-btn" type="button" data-action="shuffle" data-stop-index="${index}" aria-label="Shuffle this destination">⇄</button><button class="mcv-control-btn" type="button" data-action="refresh" data-stop-index="${index}" aria-label="Refresh this destination">↻</button><button class="mcv-control-btn" type="button" data-action="remove" data-stop-index="${index}" aria-label="Remove this destination">×</button></div>`;}
function sameCityIdentity(a,b){if(!a||!b)return false;const aid=String(a.cityId||a.id||'').toLowerCase(),bid=String(b.cityId||b.id||'').toLowerCase();if(aid&&bid)return aid===bid;const ac=String(a.code||a.airportCode||'').toUpperCase(),bc=String(b.code||b.airportCode||'').toUpperCase();if(ac&&bc&&ac===bc)return true;return normalizedLabel(a.city||a.displayCity)===normalizedLabel(b.city||b.displayCity)&&(!a.countryCode||!b.countryCode||String(a.countryCode).toUpperCase()===String(b.countryCode).toUpperCase());}
function routeStopIndex(t,city,fallback){const cities=Array.isArray(t?.cities)?t.cities:[];const found=cities.findIndex(item=>sameCityIdentity(item,city));return found>=0?found:fallback;}
function itineraryCards(t){const legs=Array.isArray(t.backendLegs)?t.backendLegs:Array.isArray(t.legs)?t.legs:[];const items=[];items.push({kind:'origin',city:t.origin||{},leg:firstTravelLeg(t),index:-1,stopIndex:-1,stopNumber:0});let stopNumber=0;legs.forEach((leg,index)=>{const isReturn=String(leg?.to?.city||'').toLowerCase()===String(t.origin?.city||'').toLowerCase();const city=isReturn?t.origin:legDestinationCity(t,leg,index);if(!city)return;if(isReturn){items.push({kind:'return',city,leg,index,stopIndex:Math.max(0,(t.cities||[]).length-1),isReturn:true,stopNumber:null});}else{const stopIndex=routeStopIndex(t,city,stopNumber);stopNumber+=1;items.push({kind:'stop',city,leg,index,stopIndex,isReturn:false,stopNumber});}});if(items.length===1){(t.cities||[]).forEach((city,index)=>items.push({kind:'stop',city,leg:null,index,stopIndex:index,stopNumber:index+1}));}return items;}
function originCardHtml(t,item){const rawCity=item.city||{};const displayCity=displayOriginCity(t);const city={...rawCity,city:displayCity};const leg=item.leg||{};const label=stopLabel('origin');const gateway=originGatewayName(t);const exact=isExactDateRequest();const exactRange=formatExactDateRange();const dateTitle=exact?'Exact trip dates':'Automatic cheap-date plan';const dateStrong=exact?(exactRange?`Requested dates: ${exactRange}`:'Exact dates preserved'):(providerDateText(leg)||'Date selected by Globevoy');const dateCopy=exact?'Globevoy preserved the dates you entered. Partner sites confirm live fares and availability.':providerEvidenceCopy(leg);return `<article class="mcv-card mcv-card--city mcv-card--origin" data-city-photo data-city="${escapeHtml(displayCity)}" data-country="${escapeHtml(city.country||'')}" data-fallback="${escapeHtml(city.img||city.image||'')}">
  <div class="mcv-card-photo"><div class="mcv-photo-placeholder" aria-hidden="true"></div><span class="mcv-stop-badge mcv-stop-badge--origin">${escapeHtml(label)}</span><div class="mcv-city-caption"><h3>${escapeHtml(displayCity)}</h3><p>${escapeHtml(citySubtitle(city,'origin',t))}</p></div></div>
  <div class="mcv-city-body">
    <div class="mcv-city-row mcv-city-row--muted"><span class="mcv-row-icon">⌁</span><div><span>Departure city</span><strong>${escapeHtml(originSummaryLabel(t))}</strong><small>${escapeHtml(gateway?'Nearest practical airport gateway selected for this city.':'Starting city and airport confirmed from your search.')}</small></div></div>
    <div class="mcv-date-intel-figma${exact?' is-exact':''}"><span>${escapeHtml(dateTitle)}</span><strong>${escapeHtml(dateStrong)}</strong><small>${escapeHtml(dateCopy)}</small></div>
    ${(()=>{const access=canonicalComponent(t,'origin-access');return access&&safeNumber(access.amountDisplay)>0?`<div class="mcv-city-row"><span class="mcv-row-icon">↔</span><div><span>Airport access · estimate</span><strong>${escapeHtml(access?.access?.gatewayCity||'Airport ground transfer')}</strong><small>${escapeHtml(money(access.amountDisplay,t))} round-trip party estimate <em class="mcv-source-chip">Airport access estimate</em></small></div></div>`:'';})()}
    <button class="mcv-set-date mcv-city-primary" type="button">${exact?'Review trip dates':'Adjust date options'}</button>
  </div>
</article>`;}
function cityCardHtml(t,item){const {leg,index,kind,stopNumber}=item;const controlIndex=Number.isFinite(Number(item.stopIndex))?Number(item.stopIndex):index;const isReturn=kind==='return';const rawCity=item.city||{};const city=isReturn?{...rawCity,city:displayOriginCity(t)}:rawCity;const stay=isReturn?null:stayForDestination(t,city,index);const transportAmount=legAmount(leg,t,index);const hotelAmount=isReturn?0:stayAmount(stay,t,index);const destinationAccess=isReturn?null:(canonicalComponent(t,`destination-access:${controlIndex}`)||null);const destinationAccessAmount=safeNumber(destinationAccess?.amountDisplay);const total=transportAmount+hotelAmount+destinationAccessAmount;const nights=isReturn?0:(safeNumber(stay?.nights)||safeNumber(city?.nights)||0);const ground=isGroundLeg(leg);const operator=legOperator(leg);const timing=durationText(leg);const flightUrl=legBookingUrl(leg);const stayUrl=isReturn?'':hotelBookingUrl(stay,city);const hotel=hotelName(stay,city,index);const reviews=hotelMeta(stay,city);const reason=genericReason(leg,city,isReturn);const label=stopLabel(kind,stopNumber);const transportLabel=isReturn?(ground?'Return transfer':'Return flight'):(ground?'Ground transfer':'Flight');const hotelLabel=isReturn?'Stay':`Hotel · ${nightsText(nights)}`;const transportPrice=transportAmount?money(transportAmount,t):'Estimate pending';const stayPrice=hotelAmount?money(hotelAmount,t):'Estimate pending';const dateChip=legAutoDateLabel(leg,index,isReturn);const primaryUrl=flightUrl||stayUrl;const primaryLabel=flightUrl?flightActionLabel(leg):stayActionLabel(stay,city);return `<article class="mcv-card mcv-card--city${isReturn?' mcv-card--return':''}" data-city-photo data-city="${escapeHtml(city.city||'Destination')}" data-country="${escapeHtml(city.country||'')}" data-fallback="${escapeHtml(city.img||city.image||'')}">
  <div class="mcv-card-photo"><div class="mcv-photo-placeholder" aria-hidden="true"></div><span class="mcv-stop-badge">${escapeHtml(label)}</span>${cardControls(kind,controlIndex)}<div class="mcv-city-caption"><h3>${escapeHtml(isReturn?`${city.city||'Origin'}`:city.city||'Destination')}</h3><p>${escapeHtml(citySubtitle(city,kind,t))}</p></div></div>
  <div class="mcv-city-body">
    <div class="mcv-city-row"><span class="mcv-row-icon">${ground?'↔':'✈'}</span><div><span>${escapeHtml(transportLabel)} · ${escapeHtml(providerStatusLabel(leg))}</span><strong>${escapeHtml(operator)}</strong><small><span class="mcv-leg-date-chip">${escapeHtml(dateChip)}</span>${escapeHtml(timing)} · ${escapeHtml(providerFareLabel(leg,t,transportPrice))} <em class="mcv-source-chip">${escapeHtml(flightPriceSourceLabel(leg))}</em></small>${flightUrl&&!ground?`<button class="mcv-mini-action" type="button" data-url="${escapeHtml(flightUrl)}">${escapeHtml(flightActionLabel(leg))}</button>`:''}</div></div>
    <div class="mcv-city-row"><span class="mcv-row-icon">▣</span><div><span>${escapeHtml(hotelLabel)}</span><strong>${isReturn?'No stay needed':escapeHtml(hotel)}</strong><small>${isReturn?'Circuit closes at origin':`${escapeHtml(nightsText(nights))} stay total · ${escapeHtml(stayPrice)} · ${escapeHtml(roomText(stay,city,t))} · ${escapeHtml(reviews)} <em class="mcv-source-chip">${escapeHtml(stayPriceSourceLabel(stay,city))}</em>`}</small>${stayUrl&&!isReturn?`<button class="mcv-mini-action" type="button" data-url="${escapeHtml(stayUrl)}">${escapeHtml(stayActionLabel(stay,city))}</button>`:''}</div></div>
    ${destinationAccess&&destinationAccessAmount>0?`<div class="mcv-city-row"><span class="mcv-row-icon">↔</span><div><span>Gateway transfer · estimate</span><strong>${escapeHtml(destinationAccess?.access?.gatewayCity||destinationAccess?.access?.airportCode||'Practical airport gateway')}</strong><small>${escapeHtml(money(destinationAccessAmount,t))} round-trip party estimate${destinationAccess?.access?.transferMinutes?` · about ${escapeHtml(destinationAccess.access.transferMinutes)} min each way`:''} <em class="mcv-source-chip">Gateway transfer estimate</em></small></div></div>`:''}
    <p class="mcv-card-reason mcv-card-reason--city">${escapeHtml(reason)}</p>
    <div class="mcv-card-footer mcv-card-footer--city"><div><span>Est. cost</span><strong>${total?money(total,t):'—'}</strong></div><button class="mcv-card-cta mcv-city-primary" type="button" data-url="${escapeHtml(primaryUrl)}">${escapeHtml(primaryLabel||'Open partner options')}</button></div>
  </div>
</article>`;}
function cardHtml(t,item){return item.kind==='origin'?originCardHtml(t,item):cityCardHtml(t,item);}
function canAddDestination(t){const editable=t?.editableActions||t?.routeControl?.editableActions||{};return stopCount(t)<2&&editable.addStop!==false;}
function addDestinationCardHtml(){return `<article class="mcv-card mcv-add-card mcv-add-card--city" aria-label="Add another destination"><button class="mcv-add-btn" type="button"><span class="mcv-add-plus">+</span><strong>Add another destination</strong><span>Globevoy will add a city only when the route remains comfortable, coherent and within budget.</span></button></article>`;}

function stopIdentity(c){const gateway=c?.gatewayAirportCode||c?.gatewayCode||c?.gatewayAirport?.airportCode||c?.flightGateway?.airportCode||c?.airportAccess?.gatewayAirportCode||'';return {cityId:c?.cityId||c?.id||'',code:c?.code||c?.locationCode||'',airportCode:c?.airportCode||'',gatewayAirportCode:gateway,city:c?.city||c?.displayCity||'',country:c?.country||'',countryCode:c?.countryCode||''};}
function currentStopRefs(t){return JSON.stringify((Array.isArray(t?.cities)?t.cities:[]).map(stopIdentity));}
function currentStopIds(t){return (Array.isArray(t?.cities)?t.cities:[]).map(c=>c.cityId||c.id||c.code||c.airportCode||`${c.city||c.displayCity||''}|${c.countryCode||c.country||''}`).filter(Boolean).join(',');}
function persistTourSnapshot(t){if(!t||!Array.isArray(t.cities)||!t.cities.length)return null;const id=snapshotIdFromTour(t);const cloned=cloneTour(t);const legs=Array.isArray(t.backendLegs)?t.backendLegs:(Array.isArray(t.legs)?t.legs:[]);const departure=officialLegDate(legs[0])||safeIso(t?.itineraryDatePlan?.canonicalDepartureDate)||'';const envelope={version:FRONTEND_VERSION,savedAt:new Date().toISOString(),tour:cloned};let stored=false;try{localStorage.setItem(snapshotStorageKey(id),JSON.stringify(envelope));stored=true;}catch(_){}try{sessionStorage.setItem(storageKey,JSON.stringify(cloned));stored=true;}catch(_){}try{window.name=HANDOFF_WINDOW_PREFIX+JSON.stringify({id,tour:cloned});stored=true;}catch(_){}const params=new URLSearchParams(q);params.set('generated','true');params.set('saved','true');params.set('snapshot',id);params.set('savedStops',currentStopIds(t));params.set('savedStopRefs',currentStopRefs(t));if(departure)params.set('savedDepartureDate',departure);params.set('variant',id);params.set('pickRole',pickRole(t,activePickIndex));params.set('handoff','same-tab');return {id,departure,params,stored};}
function saveTourSnapshot(t){const saved=persistTourSnapshot(t);if(!saved){showToast('This browser could not store the trip.');return;}const url=new URL(location.href);url.search=saved.params.toString();history.replaceState(null,'',url.toString());const button=$('#mcv-save-trip');if(button){button.textContent='Saved ✓';button.classList.add('is-saved');}if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url.toString()).then(()=>showToast('Trip saved and share link copied.')).catch(()=>showToast('Trip saved in this browser.'));else showToast('Trip saved in this browser.');}
function tripDetailsUrl(t){const saved=persistTourSnapshot(t);if(!saved)return'';const url=new URL('multi-city-trip.html',location.href);url.search=saved.params.toString();return url.toString();}
function openTripDetails(t){const url=tripDetailsUrl(t);if(!url){showToast('This browser could not prepare the trip details.');return;}location.assign(url);}
async function restoreSavedRoute(){const local=readSavedSnapshot();if(local)return local;if(!window.GlobevoyApi||!window.GlobevoyApi.getGeneratedTourControl||!window.GlobevoyApi.isConfigured||!window.GlobevoyApi.isConfigured())throw new Error('This saved trip is not stored in this browser and live route restoration is unavailable.');const params=apiParams();params.action='restore';params.currentStops=String(q.get('savedStops')||'');params.currentStopRefs=String(q.get('savedStopRefs')||'');params.variant=String(q.get('snapshot')||q.get('variant')||'saved-route');const departure=String(q.get('savedDepartureDate')||q.get('departureDate')||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(departure)){params.departureDate=departure;params.currentDepartureDate=departure;params.preserveDates='true';}if(!params.currentStops&&!params.currentStopRefs)throw new Error('This saved link does not contain route destinations.');const payload=await window.GlobevoyApi.getGeneratedTourControl(params);if(!payload||payload.supported===false)throw new Error(payload?.message||payload?.reason||'The saved route could not be restored.');const tour=payload.tour||(Array.isArray(payload.tours)&&payload.tours[0]);if(!tour||!Array.isArray(tour.cities)||!tour.cities.length)throw new Error('The saved route did not return any destinations.');return tour;}

function cloneTour(t){try{return JSON.parse(JSON.stringify(t||{}));}catch(_){return Object.assign({},t||{});}}
function cityKey(c){return String(c&&(c.cityId||c.id||c.code||c.city)||'').toLowerCase().replace(/[^a-z0-9]+/g,'-');}
function discoveryCandidates(t){const list=Array.isArray(window.GLOBEVOY_PUBLIC_DISCOVERY_500)?window.GLOBEVOY_PUBLIC_DISCOVERY_500:[];const used=new Set((Array.isArray(t?.cities)?t.cities:[]).map(cityKey));const originCity=String(t?.origin?.city||'').toLowerCase();const originCode=String(t?.origin?.code||t?.origin?.airportCode||q.get('origin')||'').toUpperCase();return list.filter((item)=>item&&item.recommendationEligible!==false).filter((item)=>String(item.city||'').toLowerCase()!==originCity&&String(item.code||'').toUpperCase()!==originCode&&!used.has(cityKey(item))).map((item)=>({cityId:item.cityId||item.id, id:item.cityId||item.id, city:item.city, country:item.country, countryCode:item.countryCode, code:item.code, airportCode:item.code, lat:item.lat, lng:item.lng, nights:Number(item.nights||3), img:item.img||item.image||'', hotel:{name:`${item.city} central value stay`, rating:8.2, reviews:Math.max(120,Math.round((safeNumber(item.score)||70)*18)), estimatedStayUsd:Math.round((safeNumber(item.costs?.nightlyStayUsd)||95)*3)}}));}
function legForCity(from,to,t){const cost=to?.costs||{};const amount=Math.max(45,Math.round(safeNumber(cost.flightDemandUsd)||safeNumber(cost.transportValueUsd)||safeNumber(to?.flight)||120));return {from:{city:from?.city,country:from?.country,code:from?.code||from?.airportCode,lat:from?.lat,lng:from?.lng},to:{city:to?.city,country:to?.country,code:to?.code||to?.airportCode,lat:to?.lat,lng:to?.lng},operator:amount<80?'Rail or bus options':'Partner flight options',estimatedTransportUsd:amount,amountUsd:amount,providerStatus:'estimate',durationHours:amount<80?3:5};}
function rebuildLocalLegs(t){const out=[];let prev=t.origin||{};(Array.isArray(t.cities)?t.cities:[]).forEach((city)=>{out.push(legForCity(prev,city,t));prev=city;});if(t.origin&&prev&&String(prev.city||'').toLowerCase()!==String(t.origin.city||'').toLowerCase())out.push(legForCity(prev,t.origin,t));t.backendLegs=out;t.legs=out;return t;}
function recalcLocalBudget(t){const rate=exchangeRate(t);let totalUsd=0;(Array.isArray(t.backendLegs)?t.backendLegs:[]).forEach(l=>{totalUsd+=safeNumber(l.estimatedTransportUsd)||safeNumber(l.amountUsd)||0});(Array.isArray(t.stays)?t.stays:[]).forEach(s=>{totalUsd+=safeNumber(s?.hotel?.estimatedStayUsd)||safeNumber(s?.estimatedStayUsd)||0});if(!t.displayBudget)t.displayBudget={};t.displayBudget.tripEstimate=Math.round(totalUsd*rate);if(!t.budget)t.budget={};t.budget.estimatedCoreTotal={amount:Math.round(totalUsd*rate),currency:currencyOf(t)};return t;}
function localRouteAction(action,stopIndex){const t=cloneTour(activeTour||getStoredTour());if(!t||!Array.isArray(t.cities))return null;const candidates=discoveryCandidates(t);const safeIndex=Math.max(0,Math.min(Number(stopIndex)||0,t.cities.length-1));if(action==='remove'){if(t.cities.length<=2){showToast('Keep at least two destination stops in a multi-city tour.');return null;}t.cities.splice(safeIndex,1);if(Array.isArray(t.stays))t.stays.splice(safeIndex,1);}else if(action==='add'){const next=candidates[Math.abs(Date.now())%Math.max(1,candidates.length)];if(!next){showToast('No extra destination candidate found yet.');return null;}t.cities.push(next);if(!Array.isArray(t.stays))t.stays=[];t.stays.push({city:next.city,country:next.country,nights:next.nights||3,hotel:next.hotel});}else if(action==='shuffle'||action==='refresh'){const next=candidates[(safeIndex+Math.abs(Date.now()))%Math.max(1,candidates.length)];if(!next){showToast('No replacement city found yet.');return null;}t.cities[safeIndex]=next;if(!Array.isArray(t.stays))t.stays=[];t.stays[safeIndex]={city:next.city,country:next.country,nights:next.nights||3,hotel:next.hotel};}else{return null;}rebuildLocalLegs(t);recalcLocalBudget(t);if(isTourOverBudget(t)){showToast(action==='add'?'Adding another destination would exceed your trip budget. Keeping the current route.':action==='shuffle'||action==='refresh'?'That route change would exceed your trip budget. Keeping the current route.':budgetGuardrailCopy(t));return null;}t.routeControl={action,local:true,message:action==='add'?'Added a destination locally for preview.':action==='remove'?'Removed destination locally for preview.':'Shuffled destination locally for preview.'};return markBudgetStatus(t,'within-budget','Route estimate fits the entered budget.');}
function setBusy(message){showToast(message||'Updating route…');document.body.classList.add('mcv-updating');$$('.mcv-control-btn,.mcv-add-btn,.mcv-set-date').forEach(b=>b.disabled=true);}
function clearBusy(){document.body.classList.remove('mcv-updating');$$('.mcv-control-btn,.mcv-add-btn,.mcv-set-date').forEach(b=>b.disabled=false);}
async function handleRouteAction(action, stopIndex){
  const t=activeTour||getStoredTour();
  if(!t){showToast('Start again from the homepage before editing this route.');return;}
  const canUseControl=window.GlobevoyApi&&window.GlobevoyApi.getGeneratedTourControl&&window.GlobevoyApi.isConfigured&&window.GlobevoyApi.isConfigured();
  if(!canUseControl){showToast('Route changes require Globevoy backend validation. Please try again when the connection is available.');return;}
  const params=apiParams();
  params.action=action;
  params.stopIndex=String(Number.isFinite(Number(stopIndex))?Number(stopIndex):0);
  params.currentStops=currentStopIds(t);
  params.currentStopRefs=currentStopRefs(t);
  params.routeId=t.routeId||t.tourId||'';
  const currentLegs=Array.isArray(t.backendLegs)?t.backendLegs:(Array.isArray(t.legs)?t.legs:[]);
  const currentDeparture=officialLegDate(currentLegs[0])||safeIso(t?.itineraryDatePlan?.canonicalDepartureDate)||'';
  if(currentDeparture){params.departureDate=currentDeparture;params.currentDepartureDate=currentDeparture;params.preserveDates='true';}
  params.totalNights=String(safeNumber(t.totalNights)||safeNumber(params.totalNights)||'');
  const comfortNights=Math.max(1,safeNumber(t.totalNights)||safeNumber(params.totalNights)||6);const comfortMaxStops=comfortNights<=6?2:comfortNights<=10?3:4;params.maxStops=String(comfortMaxStops);
  params.variant=String(Date.now());
  setBusy(action==='add'?'Adding one destination…':action==='remove'?'Removing destination and rebalancing…':action==='shuffle'?'Shuffling this destination…':'Refreshing route estimate…');
  try{
    const payload=await window.GlobevoyApi.getGeneratedTourControl(params);
    if(!payload||payload.supported===false){showToast(payload?.message||payload?.routeControl?.message||payload?.reason||'That route change did not pass the comfort, geography or budget checks. Keeping the current route.');return;}
    const next=payload.tour||(Array.isArray(payload.tours)&&payload.tours[0]);
    if(!next||!Array.isArray(next.cities)||!next.cities.length){showToast('No updated route was returned.');return;}
    next.routeControl=payload.routeControl||{action};
    render(next);
    showToast(payload.routeControl?.message||'Route updated.');
  }catch(error){showToast(error.message||'Route update failed.');}
  finally{clearBusy();}
}
function dateToYmd(date){return date.toISOString().slice(0,10);}
function addDays(date,days){const d=new Date(date);d.setUTCDate(d.getUTCDate()+days);return d;}
function dateLabelShort(ymd){const d=new Date(`${ymd}T12:00:00Z`);if(Number.isNaN(d.getTime()))return ymd;return d.toLocaleDateString('en-CA',{month:'short',day:'numeric'});}
function monthKey(date){return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;}
function monthStartFromKey(key){const [year,month]=String(key||'').split('-').map(Number);return new Date(Date.UTC(year,Math.max(0,(month||1)-1),1,12));}
function addMonthsUtc(date,months){const d=new Date(date);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);return d;}
function buildCalendarOptions(t,leg){
  const providerOptions=dateOptionsFromLeg(leg).map((option)=>({...option,provider:true,source:'provider'}));
  const base=String(officialLegDate(leg)||providerOptions[0]?.departureDate||'').slice(0,10);
  const selectedDate=/^\d{4}-\d{2}-\d{2}$/.test(base)?new Date(`${base}T12:00:00Z`):addDays(new Date(),14);
  const today=new Date();
  const todayMonth=new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),1,12));
  const plannedStart=String(t?.itineraryDatePlan?.scanStartMonth||t?.cheapFlightScanner?.month||q.get('preferredMonth')||q.get('month')||'');
  const plannedMonth=/^\d{4}-\d{2}$/.test(plannedStart)?monthStartFromKey(plannedStart):todayMonth;
  const windowStart=plannedMonth<todayMonth?todayMonth:plannedMonth;
  const windowEnd=addMonthsUtc(windowStart,Math.max(1,Math.min(6,safeNumber(t?.itineraryDatePlan?.scanMonths)||6)));
  const all=new Map();
  providerOptions.forEach((option)=>{all.set(option.departureDate,{...option,provider:true,source:'provider'});});
  const anchor=selectedDate;
  const seed=safeNumber(leg?.cheapestOneWay?.price)||safeNumber(leg?.providerDateEvidence?.price)||safeNumber(leg?.amount)||safeNumber(leg?.estimatedTransportUsd)*exchangeRate(t)||95;
  for(let d=new Date(windowStart),i=0;d<windowEnd;d=addDays(d,1),i+=1){
    const ymd=dateToYmd(d);
    if(all.has(ymd))continue;
    const dayDistance=Math.round((d-anchor)/86400000);
    const wave=Math.abs(((dayDistance%11)+11)%11-5);
    const seasonal=((d.getUTCMonth()-anchor.getUTCMonth()+12)%12)*.015;
    const price=Math.max(25,Math.round(seed*(1.02+wave*.045+seasonal+(i%13===0?.08:0))));
    all.set(ymd,{departureDate:ymd,price,provider:false,source:'estimate'});
  }
  const sorted=Array.from(all.values())
    .filter(o=>/^\d{4}-\d{2}-\d{2}$/.test(o.departureDate))
    .filter(o=>{const d=new Date(`${o.departureDate}T12:00:00Z`);return d>=windowStart&&d<windowEnd;})
    .sort((a,b)=>a.departureDate.localeCompare(b.departureDate));
  const min=Math.min(...sorted.map(o=>safeNumber(o.price)||Infinity));
  return sorted.map((o)=>({...o,isBest:(safeNumber(o.price)||Infinity)<=min,goodValue:(safeNumber(o.price)||Infinity)<=min*1.16}));
}
async function applyDepartureDate(t,valid,selectedOption){
  const canRecalculate=window.GlobevoyApi&&window.GlobevoyApi.recalculateGeneratedTourDate&&window.GlobevoyApi.isConfigured&&window.GlobevoyApi.isConfigured();
  if(!canRecalculate){showToast('Date changes require Globevoy backend validation. Please try again when the connection is available.');return;}
  const query=apiParams();
  query.departureDate=valid;
  query.totalNights=String(safeNumber(t.totalNights)||safeNumber(query.totalNights)||'');
  query.adults=String(safeNumber(t?.passengerPricing?.adults)||safeNumber(query.adults)||1);
  query.children=String(safeNumber(t?.passengerPricing?.children)||safeNumber(query.children)||0);
  query.infants=String(safeNumber(t?.passengerPricing?.infants)||safeNumber(query.infants)||0);
  query.rooms=String(safeNumber(t?.passengerPricing?.rooms)||safeNumber(query.rooms)||1);
  query.passengers=String(safeNumber(t?.passengerPricing?.travellers)||safeNumber(query.passengers)||1);
  setBusy(`Recalculating the complete itinerary from ${dateLabelShort(valid)}…`);
  try{
    const payload=await window.GlobevoyApi.recalculateGeneratedTourDate({tour:t,departureDate:valid,query});
    if(!payload||payload.supported===false){showToast(payload?.message||payload?.routeControl?.message||payload?.reason||'That date could not produce a consistent route within the budget. Keeping the current itinerary.');return;}
    const next=payload.tour||(Array.isArray(payload.tours)&&payload.tours[0]);
    if(!next||!Array.isArray(next.cities)||!next.cities.length){showToast('No synchronized itinerary was returned. Keeping the current route.');return;}
    render(next);
    showToast(payload.routeControl?.message||`Departure date set to ${dateLabelShort(valid)} and all later legs were recalculated.`);
  }catch(error){showToast(error.message||'The date adjustment could not be recalculated.');}
  finally{clearBusy();}
}

function closeDateModal(){document.querySelector('.mcv-date-modal-backdrop')?.remove();document.body.classList.remove('mcv-date-modal-open');}
function calendarMonthLabel(ymd){const d=new Date(`${ymd}T12:00:00Z`);return d.toLocaleDateString('en-CA',{month:'long',year:'numeric'});}
function openDateCalendar(t,leg){
  const options=buildCalendarOptions(t,leg);
  if(!options.length){showToast('No date options available yet.');return;}
  const selected=String(officialLegDate(leg)||options.find(o=>o.isBest)?.departureDate||options[0].departureDate).slice(0,10);
  const providerCount=options.filter(o=>o.provider||o.source==='provider').length;
  const byDate=new Map(options.map(o=>[o.departureDate,o]));
  const months=Array.from(new Set(options.map(o=>String(o.departureDate).slice(0,7)))).sort();
  let current=byDate.has(selected)?selected:options[0].departureDate;
  let currentMonth=months.includes(current.slice(0,7))?current.slice(0,7):months[0];
  const evidence=providerCount?`${providerCount} provider-backed fare observation${providerCount===1?'':'s'} available across the next ${months.length} months. Final availability is confirmed on partner websites.`:`Estimated flexible-date preview across the next ${months.length} months. Provider-backed observations will appear when available.`;
  closeDateModal();
  const modal=document.createElement('div');
  modal.className='mcv-date-modal-backdrop';
  modal.innerHTML=`<div class="mcv-date-modal" role="dialog" aria-modal="true" aria-labelledby="mcv-date-title"><div class="mcv-date-modal-top"><div><span>Flexible-date intelligence</span><h2 id="mcv-date-title">Adjust departure date</h2><p>${escapeHtml((t.origin?.city||'Origin')+' to '+(leg?.to?.city||'first stop'))} · ${escapeHtml(evidence)}</p></div><button type="button" class="mcv-date-close" aria-label="Close date picker">×</button></div><div class="mcv-date-saving"><strong class="mcv-date-saving-title">Use selected date</strong><span>Globevoy already selected a date; use this only to adjust the route.</span></div><div class="mcv-date-month"><div class="mcv-date-month-head"><button type="button" class="mcv-date-month-nav mcv-date-prev" aria-label="Previous month">‹</button><div><h3 class="mcv-date-month-label"></h3><span class="mcv-date-month-count"></span></div><button type="button" class="mcv-date-month-nav mcv-date-next" aria-label="Next month">›</button></div><div class="mcv-date-weekdays"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div><div class="mcv-date-grid"></div></div><div class="mcv-date-modal-footer"><small>Evidence label: provider cache or estimate — confirm before booking.</small><button type="button" class="mcv-date-use">Use this date</button></div></div>`;
  document.body.appendChild(modal);document.body.classList.add('mcv-date-modal-open');
  const monthIndex=()=>Math.max(0,months.indexOf(currentMonth));
  const monthOptions=()=>options.filter(o=>String(o.departureDate).startsWith(currentMonth));
  const bestInMonth=()=>monthOptions().slice().sort((a,b)=>(safeNumber(a.price)||Infinity)-(safeNumber(b.price)||Infinity))[0]||null;
  const syncSelection=()=>{
    modal.querySelectorAll('.mcv-date-cell').forEach(b=>b.classList.toggle('is-selected',b.dataset.date===current));
    const chosen=byDate.get(current);
    modal.querySelector('.mcv-date-use').textContent=chosen?`Use ${dateLabelShort(current)}${chosen.price?` · ${money(chosen.price,t)}`:''}`:'Use this date';
    const best=bestInMonth();
    const title=modal.querySelector('.mcv-date-saving-title');
    if(best&&current!==best.departureDate)title.textContent=`Best in ${calendarMonthLabel(`${best.departureDate}`)}: ${dateLabelShort(best.departureDate)} for ${money(best.price,t)}`;
    else if(chosen)title.textContent=`Selected ${dateLabelShort(current)}${chosen.price?` · ${money(chosen.price,t)}`:''}`;
    else title.textContent='Use selected date';
  };
  const renderMonth=()=>{
    const monthStart=monthStartFromKey(currentMonth);
    const startOffset=monthStart.getUTCDay();
    const gridStart=addDays(monthStart,-startOffset);
    const cells=[];
    for(let i=0;i<42;i+=1){
      const d=addDays(gridStart,i),ymd=dateToYmd(d),o=byDate.get(ymd),inMonth=monthKey(d)===currentMonth;
      const isSelected=ymd===current;
      const price=o&&safeNumber(o.price)?money(o.price,t):'';
      const cls=['mcv-date-cell'];if(!inMonth)cls.push('is-muted');if(o?.isBest)cls.push('is-best');else if(o?.goodValue)cls.push('is-good');if(isSelected)cls.push('is-selected');if(!o)cls.push('is-disabled');
      cells.push(`<button type="button" class="${cls.join(' ')}" data-date="${ymd}" ${o?'':'disabled'}><span>${d.getUTCDate()}</span>${price?`<strong>${escapeHtml(price)}</strong>`:''}${o?.provider?'<em>provider</em>':o?'<em>estimate</em>':''}</button>`);
    }
    modal.querySelector('.mcv-date-month-label').textContent=calendarMonthLabel(`${currentMonth}-01`);
    modal.querySelector('.mcv-date-month-count').textContent=`Month ${monthIndex()+1} of ${months.length}`;
    modal.querySelector('.mcv-date-grid').innerHTML=cells.join('');
    modal.querySelector('.mcv-date-prev').disabled=monthIndex()<=0;
    modal.querySelector('.mcv-date-next').disabled=monthIndex()>=months.length-1;
    syncSelection();
  };
  modal.addEventListener('click',async(event)=>{
    if(event.target===modal)closeDateModal();
    if(event.target.closest('.mcv-date-close'))closeDateModal();
    if(event.target.closest('.mcv-date-prev')&&!event.target.closest('.mcv-date-prev').disabled){currentMonth=months[monthIndex()-1];renderMonth();return;}
    if(event.target.closest('.mcv-date-next')&&!event.target.closest('.mcv-date-next').disabled){currentMonth=months[monthIndex()+1];renderMonth();return;}
    const cell=event.target.closest('.mcv-date-cell[data-date]');
    if(cell&&!cell.disabled){current=cell.dataset.date;syncSelection();}
    const use=event.target.closest('.mcv-date-use');
    if(use){const chosen=byDate.get(current)||{};closeDateModal();await applyDepartureDate(t,current,chosen);}
  });
  document.addEventListener('keydown',function onKey(event){
    if(event.key==='Escape'){closeDateModal();document.removeEventListener('keydown',onKey);}
    if(event.key==='ArrowLeft'&&monthIndex()>0){currentMonth=months[monthIndex()-1];renderMonth();}
    if(event.key==='ArrowRight'&&monthIndex()<months.length-1){currentMonth=months[monthIndex()+1];renderMonth();}
  });
  renderMonth();
}
function setDepartureDateLocal(){
  const t=activeTour||getStoredTour();
  if(!t){showToast('No generated tour loaded.');return;}
  const legs=Array.isArray(t.backendLegs)?t.backendLegs:(Array.isArray(t.legs)?t.legs:[]);
  if(!legs.length){showToast('No departure leg found yet.');return;}
  openDateCalendar(t,legs[0]);
}

const PICK_ROLES_670A=[
  {id:'lowest-cost',label:'Option 1',cta:'Choose option 1'},
  {id:'best-balance',label:'Option 2',cta:'Choose option 2'},
  {id:'most-memorable',label:'Option 3',cta:'Choose option 3'}
];
function normalizePickRole(v){const raw=String(v||'').trim().toLowerCase().replace(/[_\s]+/g,'-');if(raw.includes('lowest')||raw==='cost')return'lowest-cost';if(raw.includes('memorable')||raw.includes('discover'))return'most-memorable';if(raw.includes('balance')||raw.includes('recommended'))return'best-balance';return raw;}
function pickRole(t,index=0){const role=normalizePickRole(t?.pickRole||t?.mapFirstThreePicks?.requestedRole||t?.tourRole||t?.tourRoleLabel||t?.recommendationLabel);return PICK_ROLES_670A.some(item=>item.id===role)?role:(PICK_ROLES_670A[index]?.id||'best-balance');}
function pickRoleLabel(role,index=0){return `Option ${Math.max(1,Number(index)+1)}`;}
function pickCta(role,index=0){return `Choose option ${Math.max(1,Number(index)+1)}`;}
function pickReason(t,role){const cities=(t?.cities||[]).map(c=>c.city).filter(Boolean);const route=cities.length?cities.join(' + '):'this route';const explanation=String(t?.recommendationExplanation||t?.whyCitiesWork||'').trim();if(role==='lowest-cost')return `Keeps the estimated trip total lowest while preserving a practical ${cities.length||1}-stop route.`;if(role==='most-memorable')return `Prioritizes discovery and story value through ${route}, without crossing the entered budget.`;if(explanation&&explanation.length<170)return explanation;return `The strongest trade-off between price, route comfort and discovery for this search.`;}
function pickRouteKey(t){return (t?.cities||[]).map(c=>String(c.cityId||c.id||c.code||c.airportCode||c.city||'').toLowerCase()).filter(Boolean).join('>');}
function pickPhotoCity(t){return (t?.cities||[])[0]||{};}
function pickStats(t){const stops=stopCount(t),nights=safeNumber(t?.totalNights)||(t?.cities||[]).reduce((sum,c)=>sum+safeNumber(c?.nights),0);return {stops,nights};}
function renderTopPickTab(t,index){const role=pickRole(t,index),selected=index===activePickIndex,path=routePath(t).slice(1,-1).join(' → ')||routeTitle(t),label=`Option ${index+1}`;t.displayOptionNumber=index+1;t.pickRoleLabel=label;return `<button class="mcv-r2-pick-tab${selected?' is-selected':''}" type="button" role="tab" aria-selected="${selected?'true':'false'}" aria-controls="mcv-generated-hero" tabindex="${selected?'0':'-1'}" data-pick-index="${index}" data-role="${escapeHtml(role)}"><span class="mcv-r2-tab-role">${escapeHtml(label)}</span><strong class="mcv-r2-tab-route">${escapeHtml(path)}</strong><span class="mcv-r2-tab-price">${escapeHtml(money(totalEstimate(t),t))}</span></button>`;}
function renderPickList(){const root=$('#mcv-picks');if(!root)return;const count=pickTours.length;root.innerHTML=pickTours.map(renderTopPickTab).join('');root.classList.toggle('is-single-route',count===1);const countEl=$('#mcv-pick-count');if(countEl)countEl.textContent=count===1?'1 strong route':`${count} routes`;const note=$('#mcv-picks-note');if(note)note.textContent=count>=3?'Options 1, 2 and 3 are ready to compare. Final prices and availability are confirmed with booking partners.':`${count} distinct budget-safe route${count===1?'':'s'} passed the current checks. Globevoy will not invent extra options just to fill the page.`;const context=$('#mcv-results-context');if(context&&pickTours[activePickIndex]){const t=pickTours[activePickIndex];context.textContent=`${originSummaryLabel(t)} · ${money(totalBudget(t),t)} budget · ${safeNumber(t.totalNights)||'Flexible'} nights. Choose an option to update the map and full itinerary.`;}const buttons=$$('.mcv-r2-pick-tab');buttons.forEach((button,buttonIndex)=>{button.addEventListener('click',()=>selectPick(Number(button.dataset.pickIndex)));button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();let next=buttonIndex;if(event.key==='ArrowLeft')next=(buttonIndex-1+buttons.length)%buttons.length;if(event.key==='ArrowRight')next=(buttonIndex+1)%buttons.length;if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;buttons[next]?.focus();selectPick(Number(buttons[next]?.dataset.pickIndex));});});}
function selectPick(index){if(!Number.isFinite(index)||!pickTours[index])return;activePickIndex=index;render(pickTours[index],{fromPick:true});}
function threePicksEnabled(){return window.GLOBEVOY_CONFIG?.mapFirstThreePicksEnabled!==false;}
async function fetchGeneratedPicks(){if(!window.GlobevoyApi||!window.GlobevoyApi.getGeneratedTour||!window.GlobevoyApi.isConfigured()){throw new Error('Live generated-tour API is not configured.');}const base=apiParams();delete base.routeRole;delete base.tourRole;delete base.pickRole;const seed=String(base.variant||Date.now());const roles=threePicksEnabled()?PICK_ROLES_670A:[PICK_ROLES_670A[1]];const settled=await Promise.allSettled(roles.map((role,index)=>window.GlobevoyApi.getGeneratedTour({...base,routeRole:role.id,pickRole:role.id,threePickRequest:'true',routeRankingCandidateLimit:'3',variant:`${seed}-${role.id}-${index+1}`})));const tours=[];const routeKeys=new Set();settled.forEach((result,index)=>{if(result.status!=='fulfilled')return;const payload=result.value;if(!payload||payload.supported===false)return;const tour=payload.tour||(Array.isArray(payload.tours)&&payload.tours[0]);if(!tour||!Array.isArray(tour.cities)||!tour.cities.length)return;const role=roles[index]?.id||pickRole(tour,index);if(tour.pickRoleMatched===false)return;tour.pickRole=role;tour.pickRoleLabel=pickRoleLabel(role,index);const key=pickRouteKey(tour);if(key&&routeKeys.has(key))return;if(key)routeKeys.add(key);tours.push(tour);});if(!tours.length){const payload=await window.GlobevoyApi.getGeneratedTour(base);if(!payload||payload.supported===false)throw new Error(payload?.reason||'No generated route passed the current checks.');const tour=payload.tour||(Array.isArray(payload.tours)&&payload.tours[0]);if(tour&&Array.isArray(tour.cities)&&tour.cities.length){tour.pickRole='best-balance';tour.pickRoleLabel='Option 1';tour.displayOptionNumber=1;tours.push(tour);}}if(!tours.length)throw new Error('No generated route was returned.');tours.sort((a,b)=>PICK_ROLES_670A.findIndex(r=>r.id===pickRole(a))-PICK_ROLES_670A.findIndex(r=>r.id===pickRole(b)));tours.forEach((tour,index)=>{tour.displayOptionNumber=index+1;tour.pickRoleLabel=`Option ${index+1}`;});return tours;}

function renderCards(t){$('#mcv-cards').innerHTML=itineraryCards(t).map(item=>cardHtml(t,item)).join('')+(canAddDestination(t)?addDestinationCardHtml():'');$('#mcv-adjust-trip')?.addEventListener('click',()=>showToast('Use the card controls to replace, remove or refresh destinations.'));$('#mcv-save-trip')?.addEventListener('click',()=>saveTourSnapshot(t));$$('.mcv-card-cta').forEach((el)=>el.addEventListener('click',(ev)=>{ev.stopPropagation();openOrToast(el.dataset.url,'Partner booking link is not available for this leg yet.');}));$('.mcv-add-btn')?.addEventListener('click',(ev)=>{ev.preventDefault();handleRouteAction('add',-1);});$('.mcv-set-date')?.addEventListener('click',(ev)=>{ev.preventDefault();setDepartureDateLocal();});$$('.mcv-control-btn').forEach((el)=>el.addEventListener('click',(ev)=>{ev.stopPropagation();ev.preventDefault();handleRouteAction(el.dataset.action||'refresh',Number(el.dataset.stopIndex||0));}));$$('.mcv-mini-action').forEach((el)=>el.addEventListener('click',(ev)=>{ev.stopPropagation();openOrToast(el.dataset.url,'Partner booking options are coming next.');}));const detailButton=$('#mcv-flight-options');if(detailButton)detailButton.onclick=()=>openTripDetails(t);bindCardCarousel();hydratePhotos();}
function bindCardCarousel(){const row=$('#mcv-cards');const prev=$('#mcv-cards-prev');const next=$('#mcv-cards-next');if(!row||!prev||!next)return;const step=()=>{const first=row.querySelector('.mcv-card');return first?Math.round(first.getBoundingClientRect().width+24):360;};prev.onclick=()=>row.scrollBy({left:-step(),behavior:'smooth'});next.onclick=()=>row.scrollBy({left:step(),behavior:'smooth'});}
function hydratePhotos(){ $$('[data-city-photo]').forEach(async(card,index)=>{const city=card.dataset.city,country=card.dataset.country,fallback=card.dataset.fallback||'';const known=knownCityPhoto(city,country);const stableKnown=isUnstableSearchPhoto(known)?'':known;const dataPhoto=stableDataPhoto(city,country);const generated=generatedCityImage(city,country);installPhoto(card,generated,city,country,index===0?'eager':'lazy');if(stableKnown)installPhoto(card,stableKnown,city,country,index===0?'eager':'lazy');if(dataPhoto&&!isUnstableSearchPhoto(dataPhoto))installPhoto(card,dataPhoto,city,country,index<4?'eager':'lazy');if(fallback&&!isUnstableSearchPhoto(fallback))installPhoto(card,fallback,city,country,'lazy');try{if(window.GlobevoyCityImages){const res=await window.GlobevoyCityImages.get(city,country,stableKnown||dataPhoto||fallback||generated);const url=res.images?.[0]||stableKnown||dataPhoto||fallback||generated;if(url)installPhoto(card,url,city,country,'lazy');}}catch(_){}const lastResort=known||searchableCityPhoto(city,country);if(lastResort&&!card.querySelector('.mcv-card-photo img:not([data-generated-artwork])'))installPhoto(card,lastResort,city,country,'lazy');});}
function drawFallbackMap(t){const points=routePoints(t);const el=$('#mcv-map');function project(p){const x=((p.lng+180)/360)*100;const y=((90-p.lat)/180)*100;return {x:Math.max(4,Math.min(96,x)),y:Math.max(8,Math.min(92,y))};}
 const projected=points.map(project);const poly=projected.map((p)=>`${p.x},${p.y}`).join(' ');el.innerHTML=`<div class="mcv-fallback-map"><div class="mcv-fallback-land" style="left:5%;top:12%;width:28%;height:30%"></div><div class="mcv-fallback-land" style="left:37%;top:7%;width:31%;height:48%"></div><div class="mcv-fallback-land" style="left:70%;top:10%;width:25%;height:36%"></div><svg class="mcv-fallback-line" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${poly}" fill="none" stroke="#008f89" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${poly}" fill="none" stroke="rgba(32,211,200,.5)" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>${points.slice(0,-1).map((p,i)=>{const v=project(p);return `<div class="mcv-fallback-marker" style="left:${v.x}%;top:${v.y}%"><span class="mcv-fallback-dot">${i===0?'O':i}</span><span class="mcv-fallback-label">${escapeHtml(p.label)}</span></div>`}).join('')}</div>`;}
function renderMap(t){const points=routePoints(t);if(!points.length){drawFallbackMap(t);return;} if(!window.google||!google.maps){drawFallbackMap(t);return;}const el=$('#mcv-map');el.innerHTML='';map=new google.maps.Map(el,{mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'cooperative',styles:[{featureType:'poi',stylers:[{visibility:'off'}]},{featureType:'transit',stylers:[{visibility:'off'}]},{featureType:'water',stylers:[{color:'#bde8ee'}]},{featureType:'landscape',stylers:[{color:'#eef5f6'}]}]});const bounds=new google.maps.LatLngBounds();const path=points.map(p=>({lat:p.lat,lng:p.lng}));points.slice(0,-1).forEach((p,i)=>{bounds.extend(p);new google.maps.Marker({map,position:p,label:i===0?'O':String(i),title:p.label});});new google.maps.Polyline({map,path,geodesic:true,strokeColor:'#008f89',strokeOpacity:.95,strokeWeight:4});new google.maps.Polyline({map,path,geodesic:true,strokeColor:'#20d3c8',strokeOpacity:.35,strokeWeight:10});map.fitBounds(bounds,80);setTimeout(()=>{
// GV-GLOBAL-665A: all route mutations require backend feasibility validation; no local random-city fallback.
google.maps.event.trigger(map,'resize');map.fitBounds(bounds,80);},150);}
function loadMap(t){const key=window.GLOBEVOY_CONFIG&&window.GLOBEVOY_CONFIG.googleMapsApiKey;if(window.google&&google.maps){renderMap(t);return;}if(!key){drawFallbackMap(t);return;}window.__gvMcvMap=()=>renderMap(activeTour||t);if(document.querySelector('script[data-gv-mcv-map]'))return;const s=document.createElement('script');s.dataset.gvMcvMap='1';s.async=true;s.defer=true;s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__gvMcvMap`;s.onerror=()=>drawFallbackMap(t);document.head.appendChild(s);}
function render(t,options={}){const guarded=applyBudgetGuardrail(t);if(!guarded){showError('No strong route found within this budget. Try increasing the budget, reducing stops, or choosing a shorter trip.');return;}activeTour=guarded;window.__gvGeneratedTour=guarded;if(pickTours.length){pickTours[activePickIndex]=guarded;}else{pickTours=[guarded];activePickIndex=0;}try{sessionStorage.setItem(storageKey,JSON.stringify(guarded));}catch(_){}$('#mcv-loading').hidden=true;$('#mcv-error').hidden=true;$('#mcv-app').hidden=false;renderPickList();renderHeader(guarded);renderCards(guarded);loadMap(guarded);if(options.fromPick){const hero=document.querySelector('.mcv-generated-hero');hero?.classList.add('is-route-updated');setTimeout(()=>hero?.classList.remove('is-route-updated'),450);}}
function showError(message){$('#mcv-loading').hidden=true;$('#mcv-app').hidden=true;$('#mcv-error').hidden=false;$('#mcv-error-copy').textContent=message||'Try again from the homepage.';$('#mcv-error-back').href=returnUrl();}
function apiParams(){const params={};q.forEach((v,k)=>{if(k!=='generated')params[k]=v;});params.adaptiveDuration=params.adaptiveDuration||'true';return params;}
async function start(){try{if(String(q.get('saved')||'').toLowerCase()==='true'){const tour=await restoreSavedRoute();tour.pickRole=normalizePickRole(tour.pickRole||tour.tourRole)||'best-balance';tour.displayOptionNumber=1;tour.pickRoleLabel='Option 1';pickTours=[tour];activePickIndex=0;render(tour);const button=$('#mcv-save-trip');if(button){button.textContent='Saved ✓';button.classList.add('is-saved');}return;}if(String(q.get('generated')||'').toLowerCase()==='true'){pickTours=await fetchGeneratedPicks();activePickIndex=Math.max(0,pickTours.findIndex(t=>pickRole(t)==='best-balance'));render(pickTours[activePickIndex]);return;}const tour=getStoredTour();if(!tour){showError('No selected multi-city route was found in this browser. Start again from the homepage.');return;}tour.pickRole=normalizePickRole(tour.pickRole||tour.tourRole)||'best-balance';tour.displayOptionNumber=1;tour.pickRoleLabel='Option 1';pickTours=[tour];activePickIndex=0;render(tour);}catch(error){showError(error.message||'Generated tour failed to load.');}}
start();
})();
