(function(){
'use strict';
// GV-CONTROL-667D: preserve route dates on shuffle and display practical gateway transfers.
const $=(s)=>document.querySelector(s);
const $$=(s)=>Array.from(document.querySelectorAll(s));
const q=new URLSearchParams(location.search);
const storageKey='globevoy.multi.selected.v1';
const snapshotStoragePrefix='globevoy.generated.snapshot.v1.';
const FRONTEND_VERSION='GV-REC-687B';
const HANDOFF_WINDOW_PREFIX='globevoy.trip.handoff.v1:';
const FX={USD:{rate:1,prefix:'US$',locale:'en-US'},CAD:{rate:1.36,prefix:'C$',locale:'en-CA'},AUD:{rate:1.52,prefix:'A$',locale:'en-AU'},EUR:{rate:.92,prefix:'€',locale:'en-IE'},GBP:{rate:.79,prefix:'£',locale:'en-GB'}};
let map=null,toastTimer=null,activeTour=null,pickTours=[],activePickIndex=0,extraPicksLoaded=false,replacementStopIndex=-1;
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function hashHue(city,country){const text=`${city}|${country}`;let h=0;for(let i=0;i<text.length;i++)h=(h*31+text.charCodeAt(i))%360;return h;}
function svgText(v){return String(v||'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));}
const STATIC_CITY_PHOTOS={
  'dubai|united arab emirates':'./assets/images/dubai.jpg',
  'dubai|uae':'./assets/images/dubai.jpg',
  'dubai':'./assets/images/dubai.jpg',
  'cairo|egypt':'./assets/images/cairo.jpg',
  'cairo':'./assets/images/cairo.jpg',
  'montreal|canada':'./assets/images/montreal.jpg',
  'montréal|canada':'./assets/images/montreal.jpg',
  'toronto|canada':'./assets/images/toronto.jpg',
  'toronto':'./assets/images/toronto.jpg',
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
  'ottawa|canada':'./assets/images/ottawa.jpg','ottawa':'./assets/images/ottawa.jpg',
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
  'cancun|mexico':'./assets/images/cancun.jpg','cancún|mexico':'./assets/images/cancun.jpg','cancun':'./assets/images/cancun.jpg','cancún':'./assets/images/cancun.jpg','fort lauderdale|united states':'./assets/images/fort-lauderdale.jpg','fort lauderdale':'./assets/images/fort-lauderdale.jpg',
  'san jose|costa rica':'https://source.unsplash.com/featured/1200x720/?san%20jose,costa%20rica,city',
  'panama city|panama':'https://source.unsplash.com/featured/1200x720/?panama%20city,panama,skyline',
  'cartagena|colombia':'https://source.unsplash.com/featured/1200x720/?cartagena,colombia,old%20town',
  'guatemala city|guatemala':'https://source.unsplash.com/featured/1200x720/?guatemala%20city,guatemala',
  'caye caulker|belize':'https://source.unsplash.com/featured/1200x720/?caye%20caulker,belize,island',
  'campeche|mexico':'https://source.unsplash.com/featured/1200x720/?campeche,mexico,colonial',
  'london|united kingdom':'https://source.unsplash.com/featured/1200x720/?london,skyline',
  'cairo|egypt':'./assets/images/cairo.jpg',
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
function installPhoto(card,url,city,country,loading){
  if(!card||!url)return;
  const photo=card.querySelector('.mcv-card-photo');if(!photo)return;
  const img=new Image(),isGenerated=String(url).startsWith('data:image/svg+xml');
  img.alt=`${city||'Destination'}, ${country||''}`;
  img.loading=loading||'lazy';
  img.fetchPriority=(loading==='eager')?'high':'auto';
  img.decoding='async';
  if(isGenerated)img.dataset.generatedArtwork='1';
  const apply=()=>{
    card.querySelector('.mcv-photo-placeholder')?.remove();
    const existing=photo.querySelector('img');
    if(existing&&existing.dataset.generatedArtwork==='1'&&!isGenerated)existing.replaceWith(img);
    else if(!existing)photo.prepend(img);
    else if(!isGenerated)existing.replaceWith(img);
    photo.classList.add('has-photo');
    photo.classList.toggle('has-generated-artwork',isGenerated);
  };
  if(isGenerated){img.src=url;apply();return;}
  img.onload=apply;
  img.onerror=()=>{
    if(!photo.querySelector('img')){
      const generated=generatedCityImage(city,country);
      if(generated&&generated!==url)installPhoto(card,generated,city,country,loading||'lazy');
    }
  };
  img.src=url;
}
function currencyOf(t){return String(t?.budget?.total?.currency||t?.displayBudget?.currency||q.get('currency')||'CAD').toUpperCase();}
function fxFor(t){const cur=currencyOf(t);return FX[cur]||FX.CAD;}
function exchangeRate(t){return Number(t?.canonicalPricing?.exchangeRateFromUsd||t?.displayBudget?.exchangeRateFromUsd||fxFor(t).rate||1);}
function money(value,t){const currency=currencyOf(t),fx=fxFor(t),amount=Math.round(Number(value)||0);const symbols={USD:'$',CAD:'C$',AUD:'A$',EUR:'€',GBP:'£'};try{return `${currency} ${symbols[currency]||''}${new Intl.NumberFormat(fx.locale,{maximumFractionDigits:0}).format(amount)}`;}catch(_){return `${currency} ${symbols[currency]||fx.prefix||''}${amount.toLocaleString()}`;}}
function usdMoney(value,t){return money((Number(value)||0)*exchangeRate(t),t)}
function safeNumber(v){const n=Number(v);return Number.isFinite(n)?n:0;}
function validPoint(p){const lat=Number(p?.lat??p?.latitude),lng=Number(p?.lng??p?.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<-90||lat>90||lng<-180||lng>180)return null;return {lat,lng};}
function cityRecord(city){const list=Array.isArray(window.GLOBEVOY_DESTINATIONS)?window.GLOBEVOY_DESTINATIONS:[];const keys=[city?.id,city?.cityId,city?.code,city?.airportCode,city?.city].filter(Boolean).map(String);return list.find((d)=>keys.some((k)=>String(d.id||'').toLowerCase()===k.toLowerCase()||String(d.code||'').toUpperCase()===k.toUpperCase()||String(d.city||'').toLowerCase()===k.toLowerCase()))||{};}
function pointForCity(city){return validPoint(city)||validPoint(cityRecord(city));}
function getStoredTour(){try{const raw=sessionStorage.getItem(storageKey);if(!raw)return null;const t=JSON.parse(raw);if(!t||!Array.isArray(t.cities)||!t.cities.length)return null;const wanted=q.get('routeId');if(wanted&&t.routeId&&wanted!==t.routeId)return null;return t;}catch(_){return null;}}
function routePoints(t){const originPoint=validPoint(t.origin)||pointForCity(t.origin);const originLabel=displayOriginCity(t);const points=[];if(originPoint)points.push({...originPoint,label:originLabel,origin:true});(t.cities||[]).forEach((city,index)=>{const p=pointForCity(city);if(p)points.push({...p,label:city.city||`Stop ${index+1}`,stop:index+1});});if(originPoint)points.push({...originPoint,label:originLabel,returnPoint:true});return points;}
function routePath(t){const origin=displayOriginCity(t);return [origin,...(t.cities||[]).map(c=>c.city).filter(Boolean),origin];}
function routeTitle(t){const names=(t.cities||[]).map((c)=>c.city).filter(Boolean);return names.length?names.join(' + '):(t.title||'Generated multi-city tour');}
function activeRole(t){const raw=String(t?.pickRole||t?.recommendationLabel||t?.tourRoleLabel||t?.tourRole||t?.pickRoleLabel||'').toLowerCase();if(raw.includes('low'))return 'Lowest verified cost';if(raw.includes('balance')||raw.includes('recommended'))return 'Best overall';if(raw.includes('memorable')||raw.includes('discover'))return 'Most inspiring';const explicit=Number(t?.displayOptionNumber);if(Number.isFinite(explicit)&&explicit>0)return `Route ${Math.round(explicit)}`;return 'Selected route';}
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
function applyBudgetGuardrail(t){const next=cloneTour(t);if(!next||!Array.isArray(next.cities)||!next.cities.length)return null;const initialStops=stopCount(next);if(backendBudgetFit(next)){if(initialStops<2){next.routeControl={...(next.routeControl||{}),simpleRouteFallback:true,message:simpleRouteMessage(next)};return markBudgetStatus(next,'simple-budget-route',simpleRouteMessage(next));}return markBudgetStatus(next,'within-budget','Route estimate fits the entered budget.');}rebuildLocalLegs(next);recalcLocalBudget(next);if(!isTourOverBudget(next)){if(stopCount(next)<2){next.routeControl={...(next.routeControl||{}),simpleRouteFallback:true,message:simpleRouteMessage(next)};return markBudgetStatus(next,'simple-budget-route',simpleRouteMessage(next));}return markBudgetStatus(next,'within-budget','Route estimate fits the entered budget.');}while(next.cities.length>2&&isTourOverBudget(next)){next.cities.pop();if(Array.isArray(next.stays))next.stays.pop();rebuildLocalLegs(next);recalcLocalBudget(next);}if(!isTourOverBudget(next))return markBudgetStatus(next,'within-budget-after-pruning','Route kept to the strongest 2-city budget-fit tour.');if(next.routeControl?.action==='restore'||next.routeControl?.restoredOverBudget||String(q.get('saved')||'').toLowerCase()==='true'){next.routeControl={...(next.routeControl||{}),restoredOverBudget:true};return markBudgetStatus(next,'saved-route-over-budget',`Saved route reopened. ${budgetGuardrailCopy(next)} Recheck live prices before booking.`);}return null;}
function partyInfo(t){const p=t?.passengerPricing||{};const adults=Number(p.adults??q.get('adults')??q.get('passengers')??1)||1;const children=Number(p.children??q.get('children')??0)||0;const infants=Number(p.infants??q.get('infants')??0)||0;const rooms=Number(p.rooms||1)||1;return {adults,children,infants,rooms,travellers:Number(p.travellers)||adults+children+infants};}
function passengerText(t){const p=partyInfo(t);const parts=[`${p.adults} adult${p.adults===1?'':'s'}`];if(p.children)parts.push(`${p.children} child${p.children===1?'':'ren'}`);if(p.infants)parts.push(`${p.infants} infant${p.infants===1?'':'s'}`);return parts.join(' + ');}
function roomText(stay,city,t){const h=stay?.hotel||city?.hotel||{};const rooms=Number(h?.pricingIntegrity?.roomCount||h.rooms||partyInfo(t).rooms||1)||1;return `${rooms} room${rooms===1?'':'s'}`;}
function partyPriceNote(leg,t){const p=leg?.pricingIntegrity||{};const travellers=Number(p.travellers||partyInfo(t).travellers||1)||1;return travellers>1?`${travellers} travellers total`:'1 traveller total';}
function returnUrl(){return q.get('returnTo')||'index.html';}
function transportName(leg){return String(leg?.transportType||leg?.type||leg?.mode||'connection').replace(/-/g,' ').replace(/\b\w/g,(m)=>m.toUpperCase());}
function formatDate(value){const s=String(value||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date(`${s}T12:00:00Z`));}catch(_){return s;}}
function legDepartureDate(leg,index){return formatDate(leg?.cheapestOneWay?.departureDate)||formatDate(leg?.departureDate)||leg?.dateLabel||leg?.departureWindow||`Flexible date ${index+1}`;}
function legTiming(leg){const ow=leg?.cheapestOneWay||{};if(isProviderBackedLeg(leg)){const dep=ow.departureTime||leg?.departureTime;const arr=ow.arrivalTime||leg?.arrivalTime;if(dep&&arr)return `${dep} → ${arr}`;if(dep)return `Departs ${dep}`;if(ow.durationLabel)return ow.durationLabel;}return 'Schedule must be confirmed on partner';}
function airlineName(code){const c=String(code||'').toUpperCase();const map={AC:'Air Canada',WS:'WestJet',PD:'Porter Airlines',TS:'Air Transat',AA:'American Airlines',DL:'Delta',UA:'United',BA:'British Airways',FR:'Ryanair',U2:'easyJet',EI:'Aer Lingus',AM:'Aeroméxico'};return map[c]||c||null;}
function legOperator(leg){const ow=leg?.cheapestOneWay||leg?.providerDateEvidence||{};const airline=isProviderBackedLeg(leg)?airlineName(ow.airline||leg?.airline):null;if(airline)return airline;const mode=String(leg?.mode||leg?.transportType||'').toLowerCase();if(mode.includes('rail'))return 'Rail partner options';if(mode.includes('bus')||mode.includes('ground'))return 'Rail or bus options';if(mode.includes('flight'))return isProviderBackedLeg(leg)?'Flight partner option':'Estimated flight option';return 'Partner options';}
function legBookingUrl(leg){const url=String(leg?.booking?.url||leg?.cheapestOneWay?.bookingLink||leg?.bookingUrl||leg?.providerUrl||'').trim();if(!/^https:\/\//i.test(url))return '';return url;}
function hotelName(stay,city,index){const h=stay?.hotel||city?.hotel||{};const p=h.providerHotel||{};return p.hotelName||h.name||h.hotelName||`${city?.city||'Central'} value stay`;}
function hotelMeta(stay,city){const h=stay?.hotel||city?.hotel||{},p=h.providerHotel||{},qv=h.qualitySignals||{},verified=!!(p.hotelId||h?.providerVerification?.verified);if(!verified)return'Property details not provider-verified';const rating=Number(p.reviewScore||h.reviewScore||qv.rating);const reviews=Number(p.reviewCount||h.reviewCount||qv.reviewCount);const stars=Number(p.starRating||h.starRating||qv.stars);const parts=[];if(stars>0)parts.push(`${stars.toFixed(stars%1?1:0)}★`);if(rating>0)parts.push(`${rating.toFixed(1)} guest score`);if(reviews>0)parts.push(`${reviews.toLocaleString()} reviews`);return parts.length?parts.join(' · '):'Review score pending provider confirmation';}
function hotelProvider(stay,city){const h=stay?.hotel||city?.hotel||{};return h.providerHotel?.provider||h.provider||h.source||'Agoda stay estimate';}
function hotelBookingUrl(stay,city){const h=stay?.hotel||city?.hotel||{};const p=h.providerHotel||{};const url=String(h.booking&&Object.hasOwn(h.booking,'url')?h.booking.url||'':p.bookingUrl||h.bookingUrl||h.providerUrl||h.hotelUrl||h.url||stay?.hotelUrl||'').trim();return /^https:\/\//i.test(url)?url:'';}
function evidenceSourceType(subject){return String(subject?.priceEvidence?.sourceType||subject?.priceProvenance?.sourceType||subject?.booking?.trust?.sourceType||subject?.providerVerification?.sourceType||'').toUpperCase();}
function flightPriceSourceLabel(leg){const p=leg?.priceProvenance||{},type=evidenceSourceType(leg?.providerDateEvidence||leg?.cheapestOneWay)||evidenceSourceType(leg);if(type==='LIVE')return'Current provider result · recheck before purchase';if(type==='CACHED'||p.category==='provider-observation')return'Cached fare observation · not a live quote';if(type==='UNAVAILABLE')return'Current fare unavailable';if(p.category==='ground-transfer-estimate')return'Transfer estimate · not a quote';return'Planning estimate · not a quote';}
function stayPriceSourceLabel(stay,city){const h=stay?.hotel||city?.hotel||{},type=evidenceSourceType(h);if(type==='LIVE')return'Current provider result · availability not confirmed';if(type==='CACHED')return'Cached rate observation · recheck';if(type==='UNAVAILABLE')return'Current rate unavailable';return'Planning estimate · not a quote';}
function flightEvidenceUi687A(leg){
  const p=leg?.priceProvenance||{};
  const type=evidenceSourceType(leg?.providerDateEvidence||leg?.cheapestOneWay)||evidenceSourceType(leg);
  if(isGroundLeg(leg)||p.category==='ground-transfer-estimate')return{state:'estimate',label:'Ground transfer estimate',detail:'Current transport price not verified'};
  if(type==='LIVE')return{state:'live',label:'Provider fare observed',detail:'Recheck current fare before purchase'};
  if(type==='CACHED'||p.category==='provider-observation')return{state:'cached',label:'Cached fare — may have changed',detail:'Recheck current fare with the booking partner'};
  if(type==='UNAVAILABLE')return{state:'unavailable',label:'Current fare unavailable',detail:'No current fare is being claimed'};
  if(isProviderBackedLeg(leg))return{state:'live',label:'Provider fare observed',detail:'Recheck current fare before purchase'};
  return{state:'estimate',label:'Flight estimate',detail:'Current provider fare not verified'};
}
function stayEvidenceUi687A(stay,city){
  const h=stay?.hotel||city?.hotel||{};
  const type=evidenceSourceType(h);
  if(type==='LIVE')return{state:'live',label:'Provider rate observed',detail:'Recheck current rate and availability'};
  if(type==='CACHED')return{state:'cached',label:'Cached rate — may have changed',detail:'Recheck current rate and availability'};
  if(type==='UNAVAILABLE')return{state:'unavailable',label:'Current rate unavailable',detail:'No current hotel rate is being claimed'};
  return{state:'estimate',label:'Estimated stay cost',detail:'Current hotel rate not verified'};
}
function subtotalEvidenceUi687A(flightEvidence,stayEvidence,destinationAccessAmount,isReturn){
  const states=[flightEvidence?.state];
  if(!isReturn)states.push(stayEvidence?.state);
  if(destinationAccessAmount>0)states.push('estimate');
  const strong=states.length&&states.every(state=>state==='live');
  return{state:strong?'live':'estimate',label:strong?'Subtotal':'Estimated subtotal'};
}
function flightActionLabel(leg){const b=leg?.booking||{},trust=b.trust||{},v=leg?.providerVerification||{};if(trust.ctaLabel)return trust.ctaLabel;if(b.exactItineraryHint===true||b.status==='provider-itinerary-hint'||(v.verified&&v.exactDateMatch))return'Check this itinerary on Aviasales';return'Search this route on Aviasales';}
function stayActionLabel(stay,city){const h=stay?.hotel||city?.hotel||{},b=h.booking||{},trust=b.trust||{};if(trust.ctaLabel)return trust.ctaLabel;if(b.directPropertyLink===true)return'Check this property on Agoda';if(b.linkType==='provider-search-results'||b.linkType==='provider-link-unverified')return'View selected property in Agoda results';return'Search stays in this city';}
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
  const confidenceEngine=window.GV_TRUST_685B_BUDGET_CONFIDENCE;
  const providerBackedFit=live.budgetClaim==='provider-backed-fit'&&live.allCriticalVerified===true;
  const sourceNote=live.criticalCount
    ?`${safeNumber(live.verifiedCount)} of ${safeNumber(live.criticalCount)} critical prices use exact-date provider observations. These are not live quotes; partner pages confirm final inventory and price.`
    :providerCount
      ?'Provider evidence is used where available; remaining amounts are planning estimates.'
      :'Current amounts are planning estimates; partner pages confirm live prices and availability.';
  const guard=t.clientBudgetGuardrail||{};
  const budget=totalBudget(t),estimate=totalEstimate(t),over=budget>0&&estimate>budget+budgetTolerance(budget);
  const destinationStops=Math.max(0,path.length-2);
  const simple=destinationStops<2||guard.status==='simple-budget-route';
  $('#mcv-title').textContent=routeTitle(t);
  $('#mcv-subtitle').textContent=`${activeRole(t)} · ${path[0]} loop · ${safeNumber(t.totalNights)||destinationStops} nights · ${destinationStops} stop${destinationStops===1?'':'s'}${smartDurationLabel677A(t)?' · Smart duration':''}`;
  $('#mcv-route-role').textContent=simple?'Comfort-first route':guard.status==='within-budget-after-pruning'?'Budget-fit route':activeRole(t);
  $('#mcv-total').textContent=money(estimate,t);
  if(t?.canonicalPricing&&t.canonicalPricing.totalsMatchVisibleCards!==true)showToast('Pricing integrity check failed. Please regenerate this route.');
  $('#mcv-summary-origin').textContent=originSummaryLabel(t);
  $('#mcv-summary-budget').textContent=money(budget,t);
  $('#mcv-summary-nights').textContent=String(safeNumber(t.totalNights)||destinationStops||'—');
  $('#mcv-summary-passengers').textContent=passengerText(t);
  const fit=$('#mcv-budget-fit');
  if(fit){
    const budgetConfidence=confidenceEngine?.evaluate?confidenceEngine.evaluate({over,live,providerCoverage,confidenceLevel:confidence.level,affordabilityClaim:t.affordabilityClaim}):{level:over?'over-budget':providerBackedFit?'provider-backed-fit':'verification-required',label:over?'Over budget':providerBackedFit?'Provider-backed fit':'Price verification required'};
    fit.textContent=budgetConfidence.label;
    fit.dataset.confidenceLevel=budgetConfidence.level;
    fit.classList.toggle('is-over-budget',budgetConfidence.level==='over-budget');
    fit.classList.toggle('is-pruned',guard.status==='within-budget-after-pruning'||simple);
    fit.classList.toggle('is-estimated-fit',['partial-evidence','verification-required'].includes(budgetConfidence.level));
  }
  const entrySummary=$('#mcv-entry-summary');
  if(entrySummary){
    const entry=t?.entryEligibility;
    const primaryPassport=String(q.get('passportCountryCode')||entry?.profile?.passportCountryCode||'').toUpperCase();
    const secondPassport=String(q.get('secondPassportCountryCode')||entry?.profile?.secondPassportCountryCode||'').toUpperCase();
    const useSecond=String(q.get('useSecondPassportForTrip')||'')==='1'||entry?.profile?.useSecondPassportForTrip===true;
    const passportCode=String(entry?.profile?.travelPassportCountryCode||(useSecond&&secondPassport?secondPassport:primaryPassport)).toUpperCase();
    if(entry&&passportCode){
      entrySummary.hidden=false;
      entrySummary.className='mcv-entry-summary'+(entry.hardBlocked?' is-blocked':'');
      entrySummary.textContent=entry.hardBlocked?'This route conflicts with the saved passport entry profile.':`Passport-aware route check active (${passportCode}). Live visa, eVisa/ETA and transit verification is still required.`;
    }else if(passportCode){
      entrySummary.hidden=false;
      entrySummary.className='mcv-entry-summary';
      entrySummary.textContent=`Passport-aware route check active (${passportCode}).`;
    }else{
      entrySummary.hidden=true;
      entrySummary.textContent='';
    }
  }
  $('#mcv-circuit-title').textContent='Your complete journey';
  const party=partyInfo(t);const partyNote=`Totals reflect ${passengerText(t)} and ${party.rooms} room${party.rooms===1?'':'s'}.`;
  $('#mcv-circuit-copy').textContent=`${path.slice(0,-1).join(' → ')} → ${path[path.length-1]}. Follow each transport leg into the stay that comes next. ${partyNote}`;
  $('#mcv-error-back').href=returnUrl();
  $('#mcv-route-strip').innerHTML=path.map((name,index)=>`<span class="mcv-route-token${index===0||index===path.length-1?' is-origin':''}">${escapeHtml(name)}${index===0?' <span style="opacity:.62">(origin)</span>':''}</span>${index<path.length-1?'<span class="mcv-route-arrow">›</span>':''}`).join('');
}

function firstTravelLeg(t){const legs=Array.isArray(t.backendLegs)?t.backendLegs:Array.isArray(t.legs)?t.legs:[];return legs.find((leg)=>String(leg?.to?.city||'').toLowerCase()!==String(t.origin?.city||'').toLowerCase())||legs[0]||null;}

function providerEvidence(leg){return leg?.cheapestOneWay||leg?.providerDateEvidence||{};}
function hasRejectedProviderEvidence(leg){const ow=providerEvidence(leg);return !!(ow.providerBacked&&ow.appliedToEstimate===false);}
function isProviderBackedLeg(leg){const ow=providerEvidence(leg);if(hasRejectedProviderEvidence(leg)||ow.productionEligible===false||leg?.providerVerification?.productionEligible===false)return false;return !!((ow.providerBacked&&ow.appliedToEstimate!==false)||leg?.liveFareVerified||String(leg?.estimateSource||'').includes('travelpayouts-provider'))}
function officialLegDate(leg){const ow=providerEvidence(leg),auto=leg?.automaticTourDate||{};const raw=isProviderBackedLeg(leg)?(ow.departureDate||leg?.departureDate||leg?.dateLabel):(auto.departureDate||leg?.departureDate||leg?.dateLabel);return safeIso(raw);}
function hasFlightComponent677AR1(leg){const raw=`${String(leg?.mode||'')} ${String(leg?.transportType||'')}`.toLowerCase();if(raw.includes('flight'))return true;return (Array.isArray(leg?.segments)?leg.segments:[]).some(segment=>`${String(segment?.mode||'')} ${String(segment?.transportType||'')}`.toLowerCase().includes('flight'));}
function impossibleGroundDisplay677AR1(leg){const distance=safeNumber(leg?.distanceKm);const fromCountry=String(leg?.from?.countryCode||'').toUpperCase();const toCountry=String(leg?.to?.countryCode||'').toUpperCase();const airportCapable=/^[A-Z]{3}$/.test(String(leg?.from?.airportCode||leg?.from?.code||'').toUpperCase())&&/^[A-Z]{3}$/.test(String(leg?.to?.airportCode||leg?.to?.code||'').toUpperCase());return airportCapable&&distance>0&&(distance>900||(fromCountry&&toCountry&&fromCountry!==toCountry&&distance>700));}
function isGroundLeg(leg){if(hasFlightComponent677AR1(leg)||impossibleGroundDisplay677AR1(leg))return false;const mode=`${String(leg?.mode||'')} ${String(leg?.transportType||'')}`.toLowerCase();const operator=String(leg?.operator||'').toLowerCase();const source=String(leg?.dateSource||leg?.estimateSource||'').toLowerCase();return !!(mode.includes('ground')||mode.includes('rail')||mode.includes('bus')||mode.includes('train')||operator.includes('rail')||operator.includes('bus')||source.includes('ground-leg'));}
function providerDateText(leg){const ow=providerEvidence(leg);const auto=leg?.automaticTourDate||{};const raw=isProviderBackedLeg(leg)?ow.departureDate:(auto.departureDate||leg?.departureDate||leg?.dateLabel);if(!safeIso(raw))return null;const formatted=formatDate(raw)||raw;if(isExactDateRequest())return `Exact date: ${formatted}`;return isProviderBackedLeg(leg)?`Fare-observed date: ${formatted}`:`Auto-selected date: ${formatted}`;}
function providerEvidenceCopy(leg){const ow=providerEvidence(leg);const verification=leg?.providerVerification||{};if(isExactDateRequest())return 'Globevoy preserved the dates you entered. Partner sites confirm live fares and availability.';if(isGroundLeg(leg))return 'Globevoy selected this regional transfer timing automatically; final rail or bus availability is confirmed with partners.';if(verification.verified&&verification.exactDateMatch)return verification.cacheHit?'An exact route/date fare observation was found in provider cache. It is not a reservation or live quote; recheck the partner website.':'An exact route/date fare observation was found during provider verification. It is not a reservation or live quote; recheck the partner website.';if(hasRejectedProviderEvidence(leg)){const seen=formatDate(ow.departureDate)||ow.departureDate;return seen?`Provider fare was observed for ${seen}, but Globevoy kept the automatic route date because the observed option did not fit this trip or budget guardrail.`:'Provider fare evidence was observed, but Globevoy kept the automatic route date because the observed option did not fit this trip or budget guardrail.';}if(isProviderBackedLeg(leg))return 'A Travelpayouts/Aviasales fare observation was used for this estimate. Recheck schedule, baggage, price and availability on the partner website.';return 'Globevoy selected this date automatically from the route plan. Provider-backed observations appear when available.';}
function providerFareLabel(leg,t,transportPrice){const ow=providerEvidence(leg);const integrity=leg?.pricingIntegrity||{};const totalUsd=safeNumber(integrity.partyTotalUsd)||safeNumber(ow.partyTotalAmountUsd);const unitUsd=safeNumber(integrity.unitAmountUsd)||safeNumber(ow.perPassengerAmountUsd);const multiplier=safeNumber(integrity.multiplier)||1;if(isProviderBackedLeg(leg)&&totalUsd){const total=money(totalUsd*exchangeRate(t),t);if(unitUsd&&multiplier>1)return `${total} total · ${money(unitUsd*exchangeRate(t),t)} per traveller`;return `${total} provider total`;}return `${transportPrice} · ${partyPriceNote(leg,t)}`;}
function providerStatusLabel(leg){if(isExactDateRequest())return 'Exact date';if(isGroundLeg(leg))return 'Planned date';if(isProviderBackedLeg(leg))return 'Fare observed';return 'Planned date';}
function smartFlightChoiceCopy677B(leg,t){
  if(isGroundLeg(leg))return'';
  const ow=providerEvidence(leg),trade=ow?.smartFlightTradeoff||{};
  const smartVersion=String(ow?.smartFlightDateSelectionVersion||ow?.smartFlightSelectionVersion||'').toUpperCase();
  const qualityVersion=String(ow?.flightQualityGuardrailVersion||'').toUpperCase();
  if(!smartVersion.startsWith('GV-REC-677B')&&!qualityVersion.startsWith('GV-REC-677B-R3'))return'';
  if(String(ow?.flightQualityStatus||'').toLowerCase()==='limited-provider-options'){
    const duration=safeNumber(ow?.durationMinutes);
    const expected=safeNumber(ow?.routeRelativeExpectedFlightMinutes)||safeNumber(ow?.expectedJourneyMinutes);
    const detail=duration>0&&expected>0?` · observed option ${Math.round(duration/60*10)/10}h vs roughly ${Math.round(expected/60*10)/10}h route baseline`:'';
    return `Limited flight options found${detail} · compare alternatives before booking`;
  }
  const parts=[];
  const shift=safeNumber(trade.dateShiftDays??ow.dateShiftDays);
  const savedMinutes=safeNumber(trade.durationMinutesSavedVsCheapest??ow.durationMinutesSavedVsCheapest);
  const savedConnections=safeNumber(trade.connectionsSavedVsCheapest??ow.connectionsSavedVsCheapest);
  const premium=safeNumber(trade.pricePremiumVsCheapest??ow.pricePremiumVsCheapest);
  if(shift>0)parts.push(`shifted ${shift} day${shift===1?'':'s'} for better value`);
  if(savedMinutes>=60){const hours=Math.round(savedMinutes/60*10)/10;parts.push(`saves about ${hours}h vs cheapest`);}
  if(savedConnections>0)parts.push(`${savedConnections} fewer connection${savedConnections===1?'':'s'}`);
  if(premium>0)parts.push(`${money(premium,t)} above cheapest`);
  if(!parts.length)parts.push('best usable fare for the current route timing');
  return `Smart flight choice · ${parts.join(' · ')}`;
}
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
function smartDurationLabel677A(t){const d=t?.smartDurationDecision||t?.adaptiveDurationDecision||{};return String(d.version||d.smartVersion||'').toUpperCase()==='GV-REC-677A'&&d.smartEnabled!==false?'Smart duration':'';}
function smartDurationReason677A(t){const d=t?.smartDurationDecision||t?.adaptiveDurationDecision||{};return smartDurationLabel677A(t)?String(d.reason||'Duration uses city stay needs, route travel time and the protected trip budget.'):'';}
function durationText(leg){const ow=leg?.cheapestOneWay||{};if(ow.departureTime&&ow.arrivalTime)return `${ow.departureTime} → ${ow.arrivalTime}${ow.durationLabel?` · ${ow.durationLabel}`:''}`;if(ow.durationLabel)return ow.durationLabel;if(ow.durationMinutes){const h=Math.floor(Number(ow.durationMinutes)/60),m=Number(ow.durationMinutes)%60;return h?`${h}h${m?` ${m}m`:''}`:`${m}m`;}return ow.duration||leg?.duration||leg?.durationLabel||leg?.travelTime||(leg?.liveFareVerified?'Provider fare observation':'Schedule must be confirmed on partner');}
function starsText(stay,city){const h=stay?.hotel||city?.hotel||{};const verified=!!(h?.providerHotel?.hotelId||h?.providerVerification?.verified);const rating=verified?safeNumber(h.stars||h.starRating||h?.providerHotel?.starRating):0;if(rating)return '★'.repeat(Math.max(1,Math.min(5,Math.round(rating))));return '';}
function stopLabel(kind,stopNumber){if(kind==='origin')return 'Origin';if(kind==='return')return 'Return';return `Stop ${stopNumber}`;}
function cardControls(kind,index){if(kind==='origin')return '';if(kind==='return')return `<div class="mcv-card-controls mcv-card-controls--icons" aria-label="Card actions"><button class="mcv-control-btn" type="button" data-action="refresh" data-stop-index="${index}" aria-label="Refresh return leg">↻</button></div>`;return `<div class="mcv-card-controls mcv-card-controls--icons" aria-label="Card actions"><button class="mcv-control-btn" type="button" data-action="shuffle" data-stop-index="${index}" aria-label="Shuffle this destination">⇄</button><button class="mcv-control-btn" type="button" data-action="refresh" data-stop-index="${index}" aria-label="Refresh this destination">↻</button><button class="mcv-control-btn" type="button" data-action="remove" data-stop-index="${index}" aria-label="Remove this destination">×</button></div>`;}
function sameCityIdentity(a,b){if(!a||!b)return false;const aid=String(a.cityId||a.id||'').toLowerCase(),bid=String(b.cityId||b.id||'').toLowerCase();if(aid&&bid)return aid===bid;const ac=String(a.code||a.airportCode||'').toUpperCase(),bc=String(b.code||b.airportCode||'').toUpperCase();if(ac&&bc&&ac===bc)return true;return normalizedLabel(a.city||a.displayCity)===normalizedLabel(b.city||b.displayCity)&&(!a.countryCode||!b.countryCode||String(a.countryCode).toUpperCase()===String(b.countryCode).toUpperCase());}
function routeStopIndex(t,city,fallback){const cities=Array.isArray(t?.cities)?t.cities:[];const found=cities.findIndex(item=>sameCityIdentity(item,city));return found>=0?found:fallback;}
function itineraryCards(t){const legs=Array.isArray(t.backendLegs)?t.backendLegs:Array.isArray(t.legs)?t.legs:[];const items=[];items.push({kind:'origin',city:t.origin||{},leg:firstTravelLeg(t),index:-1,stopIndex:-1,stopNumber:0});let stopNumber=0;legs.forEach((leg,index)=>{const isReturn=String(leg?.to?.city||'').toLowerCase()===String(t.origin?.city||'').toLowerCase();const city=isReturn?t.origin:legDestinationCity(t,leg,index);if(!city)return;if(isReturn){items.push({kind:'return',city,leg,index,stopIndex:Math.max(0,(t.cities||[]).length-1),isReturn:true,stopNumber:null});}else{const stopIndex=routeStopIndex(t,city,stopNumber);stopNumber+=1;items.push({kind:'stop',city,leg,index,stopIndex,isReturn:false,stopNumber});}});if(items.length===1){(t.cities||[]).forEach((city,index)=>items.push({kind:'stop',city,leg:null,index,stopIndex:index,stopNumber:index+1}));}return items;}
function originCardHtml(t,item){const rawCity=item.city||{};const displayCity=displayOriginCity(t);const city={...rawCity,city:displayCity};const leg=item.leg||{};const label=stopLabel('origin');const exact=isExactDateRequest();const exactRange=formatExactDateRange();const dateStrong=exact?(exactRange?`Requested dates: ${exactRange}`:'Exact dates preserved'):(providerDateText(leg)||'Date selected by Globevoy');const access=canonicalComponent(t,'origin-access');return `<article class="mcv-card mcv-card--city mcv-card--origin" data-city-photo data-city="${escapeHtml(displayCity)}" data-country="${escapeHtml(city.country||'')}" data-fallback="${escapeHtml(city.img||city.image||'')}">
  <div class="mcv-card-photo"><div class="mcv-photo-placeholder" aria-hidden="true"></div><span class="mcv-stop-badge mcv-stop-badge--origin">${escapeHtml(label)}</span><div class="mcv-city-caption"><h3>${escapeHtml(displayCity)}</h3><p>${escapeHtml(citySubtitle(city,'origin',t))}</p></div></div>
  <div class="mcv-city-body mcv-city-body--origin">
    <div class="mcv-origin-summary"><span>Starting point</span><strong>${escapeHtml(originSummaryLabel(t))}</strong><small>${escapeHtml(dateStrong)}</small></div>
    ${access&&safeNumber(access.amountDisplay)>0?`<div class="mcv-price-row is-estimate"><div class="mcv-price-row__main"><span>Airport access</span><strong>${escapeHtml(access?.access?.gatewayCity||'Airport ground transfer')}</strong></div><div class="mcv-price-row__price"><strong>${escapeHtml(money(access.amountDisplay,t))}</strong><span class="mcv-evidence-badge is-estimate">Estimate</span></div></div>`:''}
    <div class="mcv-origin-route"><span>Journey begins</span><strong>${escapeHtml(displayCity)} → ${escapeHtml(leg?.to?.city||'first destination')}</strong><small>Your first transport leg follows the selected itinerary.</small></div>
    <button class="mcv-set-date mcv-city-primary" type="button">${exact?'Review trip dates':'Adjust date options'}</button>
  </div>
</article>`;}
function cityCardHtml(t,item){const {leg,index,kind,stopNumber}=item;const controlIndex=Number.isFinite(Number(item.stopIndex))?Number(item.stopIndex):index;const isReturn=kind==='return';const rawCity=item.city||{};const city=isReturn?{...rawCity,city:displayOriginCity(t)}:rawCity;const stay=isReturn?null:stayForDestination(t,city,index);const transportAmount=legAmount(leg,t,index);const hotelAmount=isReturn?0:stayAmount(stay,t,index);const destinationAccess=isReturn?null:(canonicalComponent(t,`destination-access:${controlIndex}`)||null);const destinationAccessAmount=safeNumber(destinationAccess?.amountDisplay);const total=transportAmount+hotelAmount+destinationAccessAmount;const nights=isReturn?0:(safeNumber(stay?.nights)||safeNumber(city?.nights)||0);const ground=isGroundLeg(leg);const operator=legOperator(leg);const timing=durationText(leg);const flightUrl=legBookingUrl(leg);const stayUrl=isReturn?'':hotelBookingUrl(stay,city);const hotel=hotelName(stay,city,index);const label=stopLabel(kind,stopNumber);const transportLabel=isReturn?(ground?'Return transfer':'Return flight'):(ground?'Ground transfer':'Flight');const transportPrice=transportAmount?money(transportAmount,t):'Price pending';const stayPrice=hotelAmount?money(hotelAmount,t):'Price pending';const dateChip=legAutoDateLabel(leg,index,isReturn);const flightEvidence=flightEvidenceUi687A(leg);const stayEvidence=stayEvidenceUi687A(stay,city);const subtotalEvidence=subtotalEvidenceUi687A(flightEvidence,stayEvidence,destinationAccessAmount,isReturn);const flightAction=ground?'':flightActionLabel(leg);const stayAction=isReturn?'':stayActionLabel(stay,city);const smartNote=smartFlightChoiceCopy677B(leg,t);return `<article class="mcv-card mcv-card--city${isReturn?' mcv-card--return':''}" data-city-photo data-city="${escapeHtml(city.city||'Destination')}" data-country="${escapeHtml(city.country||'')}" data-fallback="${escapeHtml(city.img||city.image||'')}">
  <div class="mcv-card-photo"><div class="mcv-photo-placeholder" aria-hidden="true"></div><span class="mcv-stop-badge">${escapeHtml(label)}</span>${cardControls(kind,controlIndex)}<div class="mcv-city-caption"><h3>${escapeHtml(isReturn?`${city.city||'Origin'}`:city.city||'Destination')}</h3><p>${escapeHtml(citySubtitle(city,kind,t))}</p></div></div>
  <div class="mcv-city-body mcv-city-body--compact">
    <div class="mcv-price-row is-${escapeHtml(flightEvidence.state)}"><div class="mcv-price-row__icon">${ground?'↔':'✈'}</div><div class="mcv-price-row__main"><span>${escapeHtml(transportLabel)}</span><strong>${escapeHtml(operator)}</strong><small>${escapeHtml(dateChip)}${timing?` · ${escapeHtml(timing)}`:''}</small></div><div class="mcv-price-row__price"><strong>${escapeHtml(transportPrice)}</strong><span class="mcv-evidence-badge is-${escapeHtml(flightEvidence.state)}">${escapeHtml(flightEvidence.label)}</span></div>${flightUrl&&!ground?`<button class="mcv-mini-action mcv-price-row__action" type="button" data-url="${escapeHtml(flightUrl)}">${escapeHtml(flightAction)}</button>`:''}</div>
    ${!isReturn?`<div class="mcv-price-row is-${escapeHtml(stayEvidence.state)}"><div class="mcv-price-row__icon">▣</div><div class="mcv-price-row__main"><span>Stay · ${escapeHtml(nightsText(nights))}</span><strong>${escapeHtml(hotel)}</strong><small>${escapeHtml(roomText(stay,city,t))}${hotelMeta(stay,city)&&hotelMeta(stay,city)!=='Property details not provider-verified'?` · ${escapeHtml(hotelMeta(stay,city))}`:''}</small></div><div class="mcv-price-row__price"><strong>${escapeHtml(stayPrice)}${stayEvidence.state==='estimate'&&hotelAmount?' est.':''}</strong><span class="mcv-evidence-badge is-${escapeHtml(stayEvidence.state)}">${escapeHtml(stayEvidence.label)}</span><small>${escapeHtml(stayEvidence.detail)}</small></div>${stayUrl?`<button class="mcv-mini-action mcv-price-row__action" type="button" data-url="${escapeHtml(stayUrl)}">${escapeHtml(stayAction)}</button>`:''}</div>`:''}
    ${destinationAccess&&destinationAccessAmount>0?`<div class="mcv-price-row is-estimate"><div class="mcv-price-row__icon">↔</div><div class="mcv-price-row__main"><span>Gateway transfer</span><strong>${escapeHtml(destinationAccess?.access?.gatewayCity||destinationAccess?.access?.airportCode||'Airport gateway')}</strong><small>${destinationAccess?.access?.transferMinutes?`About ${escapeHtml(destinationAccess.access.transferMinutes)} min each way`:''}</small></div><div class="mcv-price-row__price"><strong>${escapeHtml(money(destinationAccessAmount,t))}</strong><span class="mcv-evidence-badge is-estimate">Estimate</span></div></div>`:''}
    ${smartNote?`<details class="mcv-compact-details"><summary>Why this flight</summary><p>${escapeHtml(smartNote)}</p></details>`:''}
    ${isReturn?`<div class="mcv-return-summary"><span>Journey complete</span><strong>Back in ${escapeHtml(city.city||'your origin')}</strong><small>The return leg closes the selected itinerary.</small></div>`:''}
    <div class="mcv-card-footer mcv-card-footer--city mcv-card-footer--compact"><div><span>${escapeHtml(subtotalEvidence.label)}</span><strong>${total?money(total,t):'—'}</strong></div><small>${subtotalEvidence.state==='live'?'Provider-backed priced components':'Includes cached or estimated component(s)'}</small></div>
  </div>
</article>`;}
function cardHtml(t,item){return item.kind==='origin'?originCardHtml(t,item):cityCardHtml(t,item);}
function durationStopCap674A(t){const nights=Math.max(1,safeNumber(t?.totalNights)||safeNumber(q.get('totalNights'))||safeNumber(q.get('nights'))||6);if(nights<=9)return 2;if(nights<=14)return 3;return 4;}
function allowedMaxStops674A(t){const backend=safeNumber(t?.routeControl?.allowedMaxStops)||safeNumber(t?.allowedMaxStops)||safeNumber(t?.routeFeasibility?.maximumStops);const durationCap=durationStopCap674A(t);return backend>0?Math.max(1,Math.min(durationCap,backend)):durationCap;}
function addDestinationState674A(t){const editable=t?.editableActions||t?.routeControl?.editableActions||{};const current=stopCount(t),maximum=allowedMaxStops674A(t),nights=Math.max(1,safeNumber(t?.totalNights)||6);const enabled=current<maximum&&editable.addStop!==false;let copy='Globevoy will add a city only when the route remains comfortable, coherent and within budget.';if(!enabled&&current>=maximum)copy=`This ${nights}-night trip supports up to ${maximum} destination stop${maximum===1?'':'s'}. Choose a longer trip to add another city.`;else if(!enabled)copy='No additional city passed the current route and budget checks.';return {enabled,current,maximum,nights,copy};}
function addDestinationCardHtml(t){const state=addDestinationState674A(t);return `<article class="mcv-card mcv-add-card mcv-add-card--city${state.enabled?'':' is-disabled'}" aria-label="${state.enabled?'Add another destination':'Another destination is not currently available'}"><button class="mcv-add-btn" type="button"${state.enabled?'':' disabled aria-disabled="true"'}><span class="mcv-add-plus">${state.enabled?'+':'–'}</span><strong>${state.enabled?'Add another destination':'Longer trip needed'}</strong><span>${escapeHtml(state.copy)}</span></button></article>`;}

function stopIdentity(c){const gateway=c?.gatewayAirportCode||c?.gatewayCode||c?.gatewayAirport?.airportCode||c?.flightGateway?.airportCode||c?.airportAccess?.gatewayAirportCode||'';return {cityId:c?.cityId||c?.id||'',code:c?.code||c?.locationCode||'',airportCode:c?.airportCode||'',gatewayAirportCode:gateway,city:c?.city||c?.displayCity||'',country:c?.country||'',countryCode:c?.countryCode||''};}
function currentStopRefs(t){return JSON.stringify((Array.isArray(t?.cities)?t.cities:[]).map(stopIdentity));}
function currentStopIds(t){return (Array.isArray(t?.cities)?t.cities:[]).map(c=>c.cityId||c.id||c.code||c.airportCode||`${c.city||c.displayCity||''}|${c.countryCode||c.country||''}`).filter(Boolean).join(',');}

function routeControlParams674A(t,action,stopIndex,extra={}){const params=apiParams();params.action=action;params.stopIndex=String(Number.isFinite(Number(stopIndex))?Number(stopIndex):0);params.currentStops=currentStopIds(t);params.currentStopRefs=currentStopRefs(t);params.routeId=t.routeId||t.tourId||'';const currentLegs=Array.isArray(t.backendLegs)?t.backendLegs:(Array.isArray(t.legs)?t.legs:[]);const currentDeparture=officialLegDate(currentLegs[0])||safeIso(t?.itineraryDatePlan?.canonicalDepartureDate)||'';if(currentDeparture){params.departureDate=currentDeparture;params.currentDepartureDate=currentDeparture;params.preserveDates='true';}params.totalNights=String(safeNumber(t.totalNights)||safeNumber(params.totalNights)||safeNumber(params.nights)||'');params.nights=params.totalNights;const comfortNights=Math.max(1,safeNumber(t.totalNights)||safeNumber(params.totalNights)||6);params.maxStops=String(comfortNights<=9?2:comfortNights<=14?3:4);params.variant=String(extra.variant||Date.now());Object.entries(extra).forEach(([key,value])=>{if(value!==undefined&&value!==null&&key!=='variant')params[key]=String(value);});return params;}
function closeReplacementChoices674A(){const modal=$('#mcv-replacement-modal');if(modal)modal.hidden=true;document.body.classList.remove('mcv-choice-open');replacementStopIndex=-1;}
function replacementDeltaText674A(option,t){const delta=safeNumber(option?.estimatedDeltaUsd)*exchangeRate(t);if(Math.abs(delta)<1)return'About the same total';return `${delta>0?'+':'−'}${money(Math.abs(delta),t)} estimated`;}
function renderReplacementChoices674A(options,t){const grid=$('#mcv-replacement-grid');if(!grid)return;grid.innerHTML=(options||[]).map((option,index)=>`<article class="mcv-replacement-card" data-city-photo data-city="${escapeHtml(option.city)}" data-country="${escapeHtml(option.country||'')}"><div class="mcv-replacement-photo"><div class="mcv-photo-placeholder" aria-hidden="true"></div><span>${escapeHtml(`Choice ${index+1}`)}</span></div><div class="mcv-replacement-body"><h3>${escapeHtml(option.city)}</h3><p>${escapeHtml(option.country||'')}</p><dl><div><dt>New trip total</dt><dd>${escapeHtml(money(safeNumber(option.estimatedTotalUsd)*exchangeRate(t),t))}</dd></div><div><dt>Change</dt><dd>${escapeHtml(replacementDeltaText674A(option,t))}</dd></div><div><dt>Stay</dt><dd>${escapeHtml(`${safeNumber(option.nights)||2} nights`)}</dd></div></dl><p>${escapeHtml(option.reason||'Keeps the route inside the current budget and comfort checks.')}</p><button type="button" class="mcv-replacement-select" data-replacement-city-id="${escapeHtml(option.cityId)}">Choose ${escapeHtml(option.city)}</button></div></article>`).join('');$$('.mcv-replacement-select').forEach(button=>button.addEventListener('click',()=>handleRouteAction('replace',replacementStopIndex,{replacementCityId:button.dataset.replacementCityId})));hydratePhotos();}
async function openReplacementChoices674A(stopIndex){const t=activeTour||getStoredTour();if(!t){showToast('Start again from the homepage before changing this route.');return;}const modal=$('#mcv-replacement-modal'),grid=$('#mcv-replacement-grid'),title=$('#mcv-replacement-title'),copy=$('#mcv-replacement-copy');if(!modal||!grid)return;replacementStopIndex=Number(stopIndex)||0;const current=(t.cities||[])[replacementStopIndex];title.textContent=`Replace ${current?.city||'this destination'}`;copy.textContent='Globevoy is checking four alternatives against the full route, trip length and total budget.';grid.innerHTML='<div class="mcv-replacement-loading">Finding budget-safe replacement cities…</div>';modal.hidden=false;document.body.classList.add('mcv-choice-open');try{const params=routeControlParams674A(t,'replacement-options',replacementStopIndex,{optionLimit:4,variant:`choices-${Date.now()}`});const payload=await window.GlobevoyApi.getGeneratedTourControl(params);const options=Array.isArray(payload?.replacementOptions)?payload.replacementOptions:[];if(!payload||payload.supported===false||!options.length){grid.innerHTML=`<div class="mcv-replacement-loading">${escapeHtml(payload?.message||'No replacement city passed the current route and budget checks.')}</div>`;return;}copy.textContent=payload.message||'Choose one replacement. The full trip will be recalculated before it is applied.';renderReplacementChoices674A(options,t);}catch(error){grid.innerHTML=`<div class="mcv-replacement-loading">${escapeHtml(error.message||'Replacement choices could not be loaded.')}</div>`;}}
function persistTourSnapshot(t){if(!t||!Array.isArray(t.cities)||!t.cities.length)return null;const id=snapshotIdFromTour(t);const cloned=cloneTour(t);const legs=Array.isArray(t.backendLegs)?t.backendLegs:(Array.isArray(t.legs)?t.legs:[]);const departure=officialLegDate(legs[0])||safeIso(t?.itineraryDatePlan?.canonicalDepartureDate)||'';const envelope={version:FRONTEND_VERSION,savedAt:new Date().toISOString(),tour:cloned};let stored=false;try{localStorage.setItem(snapshotStorageKey(id),JSON.stringify(envelope));stored=true;}catch(_){}try{sessionStorage.setItem(storageKey,JSON.stringify(cloned));stored=true;}catch(_){}try{window.name=HANDOFF_WINDOW_PREFIX+JSON.stringify({id,tour:cloned});stored=true;}catch(_){}const params=new URLSearchParams(q);params.set('generated','true');params.set('saved','true');params.set('snapshot',id);params.set('savedStops',currentStopIds(t));params.set('savedStopRefs',currentStopRefs(t));if(departure)params.set('savedDepartureDate',departure);params.set('variant',id);params.set('pickRole',pickRole(t,activePickIndex));params.set('handoff','same-tab');return {id,departure,params,stored};}
function saveTourSnapshot(t){const saved=persistTourSnapshot(t);if(!saved){showToast('This browser could not store the trip.');return;}const url=new URL(location.href);url.search=saved.params.toString();history.replaceState(null,'',url.toString());const button=$('#mcv-save-trip');const accountSave=window.GlobevoySavedTrips705C?.enabled?.()&&window.GlobevoyAuth705B?.getSession?.();if(button){button.textContent=accountSave?'Saving…':'Saved ✓';button.classList.toggle('is-saved',!accountSave);}if(navigator.clipboard?.writeText)navigator.clipboard.writeText(url.toString()).then(()=>showToast('Trip saved in this browser and share link copied.')).catch(()=>showToast('Trip saved in this browser.'));else showToast('Trip saved in this browser.');}
function tripDetailsUrl(t){const saved=persistTourSnapshot(t);if(!saved)return'';const url=new URL('multi-city-trip.html',location.href);url.search=saved.params.toString();return url.toString();}
function openTripDetails(t){const url=tripDetailsUrl(t);if(!url){showToast('This browser could not prepare the trip details.');return;}location.assign(url);}
async function restoreSavedRoute(){const local=readSavedSnapshot();if(local)return local;if(!window.GlobevoyApi||!window.GlobevoyApi.getGeneratedTourControl||!window.GlobevoyApi.isConfigured||!window.GlobevoyApi.isConfigured())throw new Error('This saved trip is not stored in this browser and live route restoration is unavailable.');const params=apiParams();params.action='restore';params.currentStops=String(q.get('savedStops')||'');params.currentStopRefs=String(q.get('savedStopRefs')||'');params.variant=String(q.get('snapshot')||q.get('variant')||'saved-route');const departure=String(q.get('savedDepartureDate')||q.get('departureDate')||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(departure)){params.departureDate=departure;params.currentDepartureDate=departure;params.preserveDates='true';}if(!params.currentStops&&!params.currentStopRefs)throw new Error('This saved link does not contain route destinations.');const payload=await window.GlobevoyApi.getGeneratedTourControl(params);if(!payload||payload.supported===false)throw new Error(payload?.message||payload?.reason||'The saved route could not be restored.');const tour=payload.tour||(Array.isArray(payload.tours)&&payload.tours[0]);if(!tour||!Array.isArray(tour.cities)||!tour.cities.length)throw new Error('The saved route did not return any destinations.');tour.routeControl={...(tour.routeControl||{}),...(payload.routeControl||{}),action:'restore',restoredFromSharedLink:true};return tour;}

function cloneTour(t){try{return JSON.parse(JSON.stringify(t||{}));}catch(_){return Object.assign({},t||{});}}
function cityKey(c){return String(c&&(c.cityId||c.id||c.code||c.city)||'').toLowerCase().replace(/[^a-z0-9]+/g,'-');}
function discoveryCandidates(t){const list=Array.isArray(window.GLOBEVOY_PUBLIC_DISCOVERY_500)?window.GLOBEVOY_PUBLIC_DISCOVERY_500:[];const used=new Set((Array.isArray(t?.cities)?t.cities:[]).map(cityKey));const originCity=String(t?.origin?.city||'').toLowerCase();const originCode=String(t?.origin?.code||t?.origin?.airportCode||q.get('origin')||'').toUpperCase();return list.filter((item)=>item&&item.recommendationEligible!==false).filter((item)=>String(item.city||'').toLowerCase()!==originCity&&String(item.code||'').toUpperCase()!==originCode&&!used.has(cityKey(item))).map((item)=>({cityId:item.cityId||item.id,id:item.cityId||item.id,city:item.city,country:item.country,countryCode:item.countryCode,code:item.code,airportCode:item.code,lat:item.lat,lng:item.lng,nights:Number(item.nights||3),img:item.img||item.image||'',hotel:{name:`${item.city} stay estimate`,estimatedStayUsd:Math.round((safeNumber(item.costs?.nightlyStayUsd)||95)*3),priceProvenance:{category:'planning-estimate'},qualitySignals:{rating:null,stars:null,reviewCount:null}}}));}
function legForCity(from,to,t){const cost=to?.costs||{};const amount=Math.max(45,Math.round(safeNumber(cost.flightDemandUsd)||safeNumber(cost.transportValueUsd)||safeNumber(to?.flight)||120));return {from:{city:from?.city,country:from?.country,code:from?.code||from?.airportCode,lat:from?.lat,lng:from?.lng},to:{city:to?.city,country:to?.country,code:to?.code||to?.airportCode,lat:to?.lat,lng:to?.lng},operator:amount<80?'Rail or bus options':'Partner flight options',estimatedTransportUsd:amount,amountUsd:amount,providerStatus:'estimate',durationHours:amount<80?3:5};}
function rebuildLocalLegs(t){const out=[];let prev=t.origin||{};(Array.isArray(t.cities)?t.cities:[]).forEach((city)=>{out.push(legForCity(prev,city,t));prev=city;});if(t.origin&&prev&&String(prev.city||'').toLowerCase()!==String(t.origin.city||'').toLowerCase())out.push(legForCity(prev,t.origin,t));t.backendLegs=out;t.legs=out;return t;}
function recalcLocalBudget(t){const rate=exchangeRate(t);let totalUsd=0;(Array.isArray(t.backendLegs)?t.backendLegs:[]).forEach(l=>{totalUsd+=safeNumber(l.estimatedTransportUsd)||safeNumber(l.amountUsd)||0});(Array.isArray(t.stays)?t.stays:[]).forEach(s=>{totalUsd+=safeNumber(s?.hotel?.estimatedStayUsd)||safeNumber(s?.estimatedStayUsd)||0});if(!t.displayBudget)t.displayBudget={};t.displayBudget.tripEstimate=Math.round(totalUsd*rate);if(!t.budget)t.budget={};t.budget.estimatedCoreTotal={amount:Math.round(totalUsd*rate),currency:currencyOf(t)};return t;}
function localRouteAction(action,stopIndex){const t=cloneTour(activeTour||getStoredTour());if(!t||!Array.isArray(t.cities))return null;const candidates=discoveryCandidates(t);const safeIndex=Math.max(0,Math.min(Number(stopIndex)||0,t.cities.length-1));if(action==='remove'){if(t.cities.length<=2){showToast('Keep at least two destination stops in a multi-city tour.');return null;}t.cities.splice(safeIndex,1);if(Array.isArray(t.stays))t.stays.splice(safeIndex,1);}else if(action==='add'){const next=candidates[Math.abs(Date.now())%Math.max(1,candidates.length)];if(!next){showToast('No extra destination candidate found yet.');return null;}t.cities.push(next);if(!Array.isArray(t.stays))t.stays=[];t.stays.push({city:next.city,country:next.country,nights:next.nights||3,hotel:next.hotel});}else if(action==='shuffle'||action==='refresh'){const next=candidates[(safeIndex+Math.abs(Date.now()))%Math.max(1,candidates.length)];if(!next){showToast('No replacement city found yet.');return null;}t.cities[safeIndex]=next;if(!Array.isArray(t.stays))t.stays=[];t.stays[safeIndex]={city:next.city,country:next.country,nights:next.nights||3,hotel:next.hotel};}else{return null;}rebuildLocalLegs(t);recalcLocalBudget(t);if(isTourOverBudget(t)){showToast(action==='add'?'Adding another destination would exceed your trip budget. Keeping the current route.':action==='shuffle'||action==='refresh'?'That route change would exceed your trip budget. Keeping the current route.':budgetGuardrailCopy(t));return null;}t.routeControl={action,local:true,message:action==='add'?'Added a destination locally for preview.':action==='remove'?'Removed destination locally for preview.':'Shuffled destination locally for preview.'};return markBudgetStatus(t,'within-budget','Route estimate fits the entered budget.');}
function setBusy(message){showToast(message||'Updating route…');document.body.classList.add('mcv-updating');$$('.mcv-control-btn,.mcv-add-btn,.mcv-set-date').forEach(b=>b.disabled=true);}
function clearBusy(){document.body.classList.remove('mcv-updating');$$('.mcv-control-btn,.mcv-add-btn,.mcv-set-date').forEach(b=>b.disabled=false);}
async function handleRouteAction(action, stopIndex, extra={}){
  const t=activeTour||getStoredTour();
  if(!t){showToast('Start again from the homepage before editing this route.');return;}
  const canUseControl=window.GlobevoyApi&&window.GlobevoyApi.getGeneratedTourControl&&window.GlobevoyApi.isConfigured&&window.GlobevoyApi.isConfigured();
  if(!canUseControl){showToast('Route changes require Globevoy backend validation. Please try again when the connection is available.');return;}
  const params=routeControlParams674A(t,action,stopIndex,extra);
  const busy=action==='add'?'Adding one destination…':action==='remove'?'Removing destination and rebalancing…':action==='replace'?'Applying your replacement…':action==='shuffle'?'Checking replacement cities…':'Refreshing route estimate…';
  setBusy(busy);
  try{
    const payload=await window.GlobevoyApi.getGeneratedTourControl(params);
    if(!payload||payload.supported===false){showToast(payload?.message||payload?.routeControl?.message||payload?.reason||'That route change did not pass the comfort, geography or budget checks. Keeping the current route.');return;}
    const next=payload.tour||(Array.isArray(payload.tours)&&payload.tours[0]);
    if(!next||!Array.isArray(next.cities)||!next.cities.length){showToast('No updated route was returned.');return;}
    next.routeControl=payload.routeControl||{action};
    closeReplacementChoices674A();
    render(next);
    showToast(payload.routeControl?.message||payload.message||'Route updated.');
  }catch(error){showToast(error.message||'Route update failed.');}
  finally{clearBusy();}
}
function dateToYmd(date){return date.toISOString().slice(0,10);}
function addDays(date,days){const d=new Date(date);d.setUTCDate(d.getUTCDate()+days);return d;}
function dateLabelShort(ymd){const d=new Date(`${ymd}T12:00:00Z`);if(Number.isNaN(d.getTime()))return ymd;return d.toLocaleDateString('en-CA',{month:'short',day:'numeric'});}
function monthKey(date){return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;}
function monthStartFromKey(key){const [year,month]=String(key||'').split('-').map(Number);return new Date(Date.UTC(year,Math.max(0,(month||1)-1),1,12));}
function addMonthsUtc(date,months){const d=new Date(date);d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);return d;}
function automaticDateFloor(){const d=new Date();d.setUTCHours(12,0,0,0);d.setUTCDate(d.getUTCDate()+14);return dateToYmd(d);}
function automaticDateAllowed(ymd){return isExactDateRequest()||String(ymd||'')>=automaticDateFloor();}
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
  const selectable=sorted.filter(o=>automaticDateAllowed(o.departureDate));
  const min=Math.min(...selectable.map(o=>safeNumber(o.price)||Infinity));
  return sorted.map((o)=>({...o,automaticSelectable:automaticDateAllowed(o.departureDate),isBest:automaticDateAllowed(o.departureDate)&&(safeNumber(o.price)||Infinity)<=min,goodValue:automaticDateAllowed(o.departureDate)&&(safeNumber(o.price)||Infinity)<=min*1.16}));
}
async function applyDepartureDate(t,valid,selectedOption){
  if(!automaticDateAllowed(valid)){showToast(`Flexible trips require at least 14 days' lead time. Choose ${dateLabelShort(automaticDateFloor())} or later.`);return;}
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
  const selected=String((options.find(o=>o.departureDate===officialLegDate(leg)&&o.automaticSelectable)?.departureDate)||options.find(o=>o.isBest)?.departureDate||options.find(o=>o.automaticSelectable)?.departureDate||options[0].departureDate).slice(0,10);
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
  const bestInMonth=()=>monthOptions().filter(o=>o.automaticSelectable).slice().sort((a,b)=>(safeNumber(a.price)||Infinity)-(safeNumber(b.price)||Infinity))[0]||null;
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
      const enabled=!!(o&&o.automaticSelectable);const cls=['mcv-date-cell'];if(!inMonth)cls.push('is-muted');if(o?.isBest)cls.push('is-best');else if(o?.goodValue)cls.push('is-good');if(isSelected&&enabled)cls.push('is-selected');if(!enabled)cls.push('is-disabled');
      cells.push(`<button type="button" class="${cls.join(' ')}" data-date="${ymd}" ${enabled?'':'disabled'}><span>${d.getUTCDate()}</span>${price?`<strong>${escapeHtml(price)}</strong>`:''}${!enabled&&o?'<em>too soon</em>':o?.provider?'<em>cached</em>':o?'<em>estimate</em>':''}</button>`);
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

const PICK_ROLES_687B=[
  {id:'lowest-cost',label:'Lowest verified cost',cta:'Choose lowest cost'},
  {id:'best-balance',label:'Best overall',cta:'Choose best overall'},
  {id:'most-memorable',label:'Most inspiring',cta:'Choose most inspiring'},
  {id:'something-different',label:'Something different',cta:'Choose something different'},
  {id:'hidden-gem',label:'Hidden gem',cta:'Choose hidden gem'}
];
const PRIMARY_PICK_ROLES_687B=PICK_ROLES_687B.slice(0,3);
const EXTRA_PICK_ROLES_687B=PICK_ROLES_687B.slice(3);
function normalizePickRole(v){const raw=String(v||'').trim().toLowerCase().replace(/[_\s]+/g,'-');if(raw.includes('lowest')||raw==='cost')return'lowest-cost';if(raw.includes('memorable')||raw.includes('inspiring')||raw.includes('discover'))return'most-memorable';if(raw.includes('different')||raw.includes('surprise')||raw.includes('wildcard'))return'something-different';if(raw.includes('hidden')||raw.includes('gem'))return'hidden-gem';if(raw.includes('balance')||raw.includes('recommended')||raw.includes('overall'))return'best-balance';return raw;}
function pickRole(t,index=0){const role=normalizePickRole(t?.pickRole||t?.mapFirstThreePicks?.requestedRole||t?.tourRole||t?.tourRoleLabel||t?.recommendationLabel);return PICK_ROLES_687B.some(item=>item.id===role)?role:(PICK_ROLES_687B[index]?.id||'best-balance');}
function pickRoleLabel(role,index=0){const normalized=normalizePickRole(role);if(normalized==='lowest-cost')return'Lowest verified cost';if(normalized==='best-balance')return'Best overall';if(normalized==='most-memorable')return'Most inspiring';if(normalized==='something-different')return'Something different';if(normalized==='hidden-gem')return'Hidden gem';return`Route ${Math.max(1,Number(index)+1)}`;}
function pickCta(role,index=0){return `Choose option ${Math.max(1,Number(index)+1)}`;}
function pickReason(t,role){const cities=(t?.cities||[]).map(c=>c.city).filter(Boolean);const route=cities.length?cities.join(' + '):'this route';const explanation=String(t?.recommendationExplanation||t?.whyCitiesWork||'').trim();if(role==='lowest-cost')return `Keeps the estimated trip total lowest while preserving a practical ${cities.length||1}-stop route.`;if(role==='most-memorable')return `Prioritizes discovery and story value through ${route}, without crossing the entered budget.`;if(explanation&&explanation.length<170)return explanation;return `The strongest trade-off between price, route comfort and discovery for this search.`;}
function pickRouteKey(t){return (t?.cities||[]).map(c=>String(c.cityId||c.id||c.code||c.airportCode||c.city||'').toLowerCase()).filter(Boolean).join('>');}
function pickRouteStops687B(t){return new Set(pickRouteKey(t).split('>').filter(Boolean));}
function pickRouteOverlap687B(a,b){const left=pickRouteStops687B(a),right=pickRouteStops687B(b);if(!left.size||!right.size)return 0;let shared=0;left.forEach(key=>{if(right.has(key))shared+=1;});return shared/Math.max(1,Math.min(left.size,right.size));}
function routeTooSimilar687B(tour,accepted=[]){const key=pickRouteKey(tour);return accepted.some(other=>{const otherKey=pickRouteKey(other);return Boolean(key&&otherKey&&key===otherKey)||pickRouteOverlap687B(tour,other)>=0.66;});}
function pickPhotoCity(t){return (t?.cities||[])[0]||{};}
function pickStats(t){const stops=stopCount(t),nights=safeNumber(t?.totalNights)||(t?.cities||[]).reduce((sum,c)=>sum+safeNumber(c?.nights),0);return {stops,nights};}
function renderTopPickTab(t,index){const role=pickRole(t,index),selected=index===activePickIndex,path=routePath(t).slice(1,-1).join(' → ')||routeTitle(t),label=pickRoleLabel(role,index);t.displayOptionNumber=index+1;t.pickRoleLabel=label;return `<button class="mcv-r2-pick-tab${selected?' is-selected':''}" type="button" role="tab" aria-selected="${selected?'true':'false'}" aria-controls="mcv-generated-hero" tabindex="${selected?'0':'-1'}" data-pick-index="${index}" data-role="${escapeHtml(role)}"><span class="mcv-r2-tab-role">${escapeHtml(label)}</span><strong class="mcv-r2-tab-route">${escapeHtml(path)}</strong><span class="mcv-r2-tab-price">${escapeHtml(money(totalEstimate(t),t))}</span></button>`;}
function renderPickList(){const root=$('#mcv-picks');if(!root)return;const count=pickTours.length;const member=classicMember711();root.innerHTML=pickTours.map(renderTopPickTab).join('');root.classList.toggle('is-single-route',count===1);renderMemberGate711(member);const countEl=$('#mcv-pick-count');if(countEl)countEl.textContent=count===1?'1 strong route':`${count} routes`;const note=$('#mcv-picks-note');if(note)note.textContent=count>3?`${count} intentionally different budget-safe routes are ready to compare. Final prices and availability are confirmed with booking partners.`:count>=3?'Compare intentionally different lowest-cost, best-overall and inspiring routes. Final prices and availability are confirmed with booking partners.':`${count} distinct budget-safe route${count===1?'':'s'} passed the current checks. Globevoy will not invent extra options just to fill the page.`;const context=$('#mcv-results-context');if(context&&pickTours[activePickIndex]){const t=pickTours[activePickIndex];context.textContent=`${originSummaryLabel(t)} · ${money(totalBudget(t),t)} budget · ${safeNumber(t.totalNights)||'Flexible'} nights${smartDurationLabel677A(t)?' · Smart duration':''}. ${smartDurationReason677A(t)||'Choose an option to update the map and full itinerary.'}`;}const buttons=$$('.mcv-r2-pick-tab');buttons.forEach((button,buttonIndex)=>{button.addEventListener('click',()=>selectPick(Number(button.dataset.pickIndex)));button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();let next=buttonIndex;if(event.key==='ArrowLeft')next=(buttonIndex-1+buttons.length)%buttons.length;if(event.key==='ArrowRight')next=(buttonIndex+1)%buttons.length;if(event.key==='Home')next=0;if(event.key==='End')next=buttons.length-1;buttons[next]?.focus();selectPick(Number(buttons[next]?.dataset.pickIndex));});});const more=$('#mcv-more-picks');if(more){if(!member){more.hidden=true;more.onclick=null;}else{more.hidden=extraPicksLoaded||pickTours.length>=5;more.disabled=false;more.textContent='Show 2 more routes';more.onclick=loadMorePicks674A;}}}
function selectPick(index){if(!Number.isFinite(index)||!pickTours[index])return;activePickIndex=index;render(pickTours[index],{fromPick:true});}
function classicMember711(){
  try{
    const raw=sessionStorage.getItem('globevoy.auth.session.705b-r3');
    if(!raw)return false;
    const session=JSON.parse(raw);
    return !!(
      session
      && session.version==='GV-ACCOUNT-705B-R3'
      && session.accessToken
      && session.user
      && session.user.sub
      && Number(session.expiresAt)>Date.now()+30000
    );
  }catch(_){
    return false;
  }
}

function renderMemberGate711(member){
  const switchPanel=document.querySelector('.mcv-r2-switch-panel');
  if(!switchPanel)return;

  let gate=document.getElementById('mcv-member-gate-711');

  if(!gate){
    gate=document.createElement('section');
    gate.id='mcv-member-gate-711';
    gate.className='mcv-member-gate-711';
    switchPanel.parentNode.insertBefore(gate,switchPanel);
  }

  if(member){
    gate.classList.add('is-member');
    gate.innerHTML=`
      <div class="mcv-member-gate-count">&#10003;</div>
      <div class="mcv-member-gate-copy">
        <span>SIGNED-IN DISCOVERY</span>
        <strong>More possibilities and route editing unlocked</strong>
        <small>Your account can access more multi-city alternatives and saved-trip continuity.</small>
      </div>
      <div class="mcv-member-gate-badge">More routes unlocked</div>`;
  }else{
    gate.classList.remove('is-member');
    gate.innerHTML=`
      <div class="mcv-member-gate-count">1</div>
      <div class="mcv-member-gate-copy">
        <span>GUEST DISCOVERY</span>
        <strong>One strong multi-city possibility, no account required</strong>
        <small>Maps, trip details and current planning evidence stay available. Sign in for more alternatives, route editing and saved continuity.</small>
      </div>
      <button id="mcv-member-gate-signin-711" class="mcv-member-gate-signin" type="button">Sign in for more</button>`;

    document.getElementById('mcv-member-gate-signin-711')?.addEventListener('click',openMemberSignIn711);
  }
}

function openMemberSignIn711(){
  const returnTo=`${location.pathname}${location.search}${location.hash}`;
  const auth=window.GlobevoyAuth705B;

  if(auth?.authEnabled?.()&&auth?.beginSignIn){
    void auth.beginSignIn({returnTo});
    return;
  }

  const stagingOrigin=window.GLOBEVOY_ENVIRONMENT_POLICY?.stagingOrigin;
  if(stagingOrigin&&(location.hostname==='127.0.0.1'||location.hostname==='localhost')){
    location.href=`${stagingOrigin}/account.html`;
    return;
  }

  location.href='account.html';
}

function threePicksEnabled(){return window.GLOBEVOY_CONFIG?.mapFirstThreePicksEnabled!==false;}
async function fetchGeneratedPicks(){if(!window.GlobevoyApi||!window.GlobevoyApi.getGeneratedTour||!window.GlobevoyApi.isConfigured()){throw new Error('Live generated-tour API is not configured.');}const base=apiParams();delete base.routeRole;delete base.tourRole;delete base.pickRole;const seed=String(base.variant||Date.now());const roles=classicMember711()&&threePicksEnabled()?PRIMARY_PICK_ROLES_687B:[PRIMARY_PICK_ROLES_687B[1]];const firstPass=await Promise.allSettled(roles.map((role,index)=>window.GlobevoyApi.getGeneratedTour({...base,routeRole:role.id,pickRole:role.id,threePickRequest:'true',diversityRequest:'true',diversitySlot:String(index+1),diversityExcludedRoutes:'[]',routeRankingCandidateLimit:'3',diversityCandidateLimit:'12',variant:`${seed}-${role.id}-${index+1}`})));const tours=[];const routeKeys=new Set();for(let index=0;index<roles.length;index+=1){const role=roles[index];const result=firstPass[index];let tour=null;if(result?.status==='fulfilled'){const payload=result.value;if(payload&&payload.supported!==false){tour=payload.tour||(Array.isArray(payload.tours)&&payload.tours[0])||null;if(tour?.pickRoleMatched===false)tour=null;}}if(tour&&routeTooSimilar687B(tour,tours)){try{const retry=await window.GlobevoyApi.getGeneratedTour({...base,routeRole:role.id,pickRole:role.id,threePickRequest:'true',diversityRequest:'true',diversityRepair:'true',diversitySlot:String(index+1),diversityExcludedRoutes:JSON.stringify([...routeKeys]),routeRankingCandidateLimit:'3',diversityCandidateLimit:'12',variant:`${seed}-${role.id}-${index+1}-diverse-repair`});const repaired=retry?.tour||(Array.isArray(retry?.tours)&&retry.tours[0]);if(repaired&&Array.isArray(repaired.cities)&&repaired.cities.length&&repaired.pickRoleMatched!==false)tour=repaired;}catch(_){}}if(!tour||!Array.isArray(tour.cities)||!tour.cities.length||routeTooSimilar687B(tour,tours))continue;const key=pickRouteKey(tour);if(key&&routeKeys.has(key))continue;if(key)routeKeys.add(key);tour.pickRole=role.id;tour.pickRoleLabel=pickRoleLabel(role.id,index);tours.push(tour);}if(!tours.length){const payload=await window.GlobevoyApi.getGeneratedTour(base);if(!payload||payload.supported===false)throw new Error(payload?.reason||'No generated route passed the current checks.');const tour=payload.tour||(Array.isArray(payload.tours)&&payload.tours[0]);if(tour&&Array.isArray(tour.cities)&&tour.cities.length){tour.pickRole='best-balance';tour.pickRoleLabel='Best overall';tour.displayOptionNumber=1;tours.push(tour);}}if(!tours.length)throw new Error('No generated route was returned.');tours.sort((a,b)=>PICK_ROLES_687B.findIndex(r=>r.id===pickRole(a))-PICK_ROLES_687B.findIndex(r=>r.id===pickRole(b)));tours.forEach((tour,index)=>{tour.displayOptionNumber=index+1;tour.pickRoleLabel=pickRoleLabel(pickRole(tour,index),index);});return tours;}
async function loadMorePicks674A(){if(!classicMember711()){openMemberSignIn711();return;}const button=$('#mcv-more-picks');if(extraPicksLoaded||!button)return;button.disabled=true;button.textContent='Finding 2 more routes…';const base=apiParams();delete base.routeRole;delete base.tourRole;delete base.pickRole;const seen=new Set(pickTours.map(pickRouteKey).filter(Boolean));let added=0;for(let roleIndex=0;roleIndex<EXTRA_PICK_ROLES_687B.length&&added<2;roleIndex+=1){const role=EXTRA_PICK_ROLES_687B[roleIndex];try{const payload=await window.GlobevoyApi.getGeneratedTour({...base,routeRole:role.id,pickRole:role.id,threePickRequest:'true',diversityRequest:'true',diversitySlot:String(pickTours.length+1),diversityExcludedRoutes:JSON.stringify([...seen]),routeRankingCandidateLimit:'3',diversityCandidateLimit:'12',variant:`extra-${role.id}-${Date.now()}-${roleIndex+1}`});const tour=payload?.tour||(Array.isArray(payload?.tours)&&payload.tours[0]);if(!tour||!Array.isArray(tour.cities)||!tour.cities.length||tour.pickRoleMatched===false)continue;const key=pickRouteKey(tour);if(key&&seen.has(key))continue;if(key)seen.add(key);tour.pickRole=role.id;tour.displayOptionNumber=pickTours.length+1;tour.pickRoleLabel=pickRoleLabel(role.id,tour.displayOptionNumber-1);pickTours.push(tour);added+=1;}catch(_){}}extraPicksLoaded=true;button.hidden=true;renderPickList();showToast(added?`${added} more intentionally different budget-safe route${added===1?'':'s'} added.`:'No additional distinct route passed the current checks.');}
function renderCards(t){const row=$('#mcv-cards');if(!row)return;const items=itineraryCards(t);const addState=addDestinationState674A(t);row.innerHTML=items.map(item=>cardHtml(t,item)).join('')+(addState.enabled?addDestinationCardHtml(t):'');row.dataset.journeyCardCount=String(items.length);row.classList.remove('mcv-card-grid--fit-four');$('#mcv-adjust-trip')?.addEventListener('click',()=>showToast('Use the arrows on a destination card to choose a replacement, or add a city when the trip length allows it.'));$('#mcv-save-trip')?.addEventListener('click',()=>saveTourSnapshot(t));$$('.mcv-card-cta').forEach((el)=>el.addEventListener('click',(ev)=>{ev.stopPropagation();openOrToast(el.dataset.url,'Partner booking link is not available for this leg yet.');}));$('.mcv-add-btn:not([disabled])')?.addEventListener('click',(ev)=>{ev.preventDefault();handleRouteAction('add',-1);});$('.mcv-set-date')?.addEventListener('click',(ev)=>{ev.preventDefault();setDepartureDateLocal();});$$('.mcv-control-btn').forEach((el)=>el.addEventListener('click',(ev)=>{ev.stopPropagation();ev.preventDefault();const action=el.dataset.action||'refresh';if(action==='shuffle')openReplacementChoices674A(Number(el.dataset.stopIndex||0));else handleRouteAction(action,Number(el.dataset.stopIndex||0));}));$$('.mcv-mini-action').forEach((el)=>el.addEventListener('click',(ev)=>{ev.stopPropagation();openOrToast(el.dataset.url,'Partner booking options are coming next.');}));const detailButton=$('#mcv-flight-options');if(detailButton)detailButton.onclick=()=>openTripDetails(t);bindCardCarousel();hydratePhotos();}
function bindCardCarousel(){const row=$('#mcv-cards');const prev=$('#mcv-cards-prev');const next=$('#mcv-cards-next');if(!row||!prev||!next)return;prev.hidden=false;next.hidden=false;const step=()=>{const first=row.querySelector('.mcv-card');return first?Math.round(first.getBoundingClientRect().width+16):376;};prev.onclick=()=>row.scrollBy({left:-step(),behavior:'smooth'});next.onclick=()=>row.scrollBy({left:step(),behavior:'smooth'});}
function hydratePhotos(){
  const cards=$$('[data-city-photo]');
  const resolveCard=async(card,index)=>{
    if(!card||card.dataset.photoResolved==='1')return;
    card.dataset.photoResolved='1';
    const city=card.dataset.city,country=card.dataset.country;
    const generated=generatedCityImage(city,country);
    const known=knownCityPhoto(city,country);
    const verifiedLocal=/^\.?\/?assets\/images\//i.test(String(known||''))?known:'';
    installPhoto(card,generated,city,country,'eager');
    if(verifiedLocal)installPhoto(card,verifiedLocal,city,country,'eager');
    try{
      if(window.GlobevoyCityImages){
        const res=await window.GlobevoyCityImages.get(city,country,verifiedLocal);
        const url=res?.images?.[0]||generated;
        if(url)installPhoto(card,url,city,country,'eager');
        card.dataset.photoConfidence=res?.confidence||'unknown';
        card.dataset.photoKind=res?.confidence==='neutral-fallback'?'artwork':'photo';
        card.classList.toggle('has-unresolved-photo',res?.confidence==='neutral-fallback');
        return;
      }
    }catch(e){console.warn('Verified city photo unavailable',city,e);}
    card.dataset.photoKind='artwork';
    card.classList.add('has-unresolved-photo');
  };
  cards.forEach((card,index)=>{
    const city=card.dataset.city,country=card.dataset.country;
    installPhoto(card,generatedCityImage(city,country),city,country,'eager');
    resolveCard(card,index);
  });
}

function drawFallbackMap(t){const points=routePoints(t);const el=$('#mcv-map');function project(p){const x=((p.lng+180)/360)*100;const y=((90-p.lat)/180)*100;return {x:Math.max(4,Math.min(96,x)),y:Math.max(8,Math.min(92,y))};}
 const projected=points.map(project);const poly=projected.map((p)=>`${p.x},${p.y}`).join(' ');el.innerHTML=`<div class="mcv-fallback-map"><div class="mcv-fallback-land" style="left:5%;top:12%;width:28%;height:30%"></div><div class="mcv-fallback-land" style="left:37%;top:7%;width:31%;height:48%"></div><div class="mcv-fallback-land" style="left:70%;top:10%;width:25%;height:36%"></div><svg class="mcv-fallback-line" viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points="${poly}" fill="none" stroke="#008f89" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${poly}" fill="none" stroke="rgba(32,211,200,.5)" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/></svg>${points.slice(0,-1).map((p,i)=>{const v=project(p);return `<div class="mcv-fallback-marker" data-journey-marker="${i}" style="left:${v.x}%;top:${v.y}%"><span class="mcv-fallback-dot">${i===0?'O':i}</span><span class="mcv-fallback-label">${escapeHtml(p.label)}</span></div>`}).join('')}</div>`;window.__gvJourneyMapFocus=(index,options={})=>{el.querySelectorAll('.mcv-fallback-marker').forEach((marker,markerIndex)=>marker.classList.toggle('is-journey-active',!options.overview&&markerIndex===Number(index)));};}
function renderMap(t){const points=routePoints(t);if(!points.length){drawFallbackMap(t);return;} if(!window.google||!google.maps){drawFallbackMap(t);return;}const el=$('#mcv-map');el.innerHTML='';map=new google.maps.Map(el,{mapTypeControl:false,streetViewControl:false,fullscreenControl:true,gestureHandling:'cooperative',styles:[{featureType:'poi',stylers:[{visibility:'off'}]},{featureType:'transit',stylers:[{visibility:'off'}]},{featureType:'water',stylers:[{color:'#bde8ee'}]},{featureType:'landscape',stylers:[{color:'#eef5f6'}]}]});const bounds=new google.maps.LatLngBounds();const path=points.map(p=>({lat:p.lat,lng:p.lng}));points.slice(0,-1).forEach((p,i)=>{bounds.extend(p);new google.maps.Marker({map,position:p,label:i===0?'O':String(i),title:p.label});});new google.maps.Polyline({map,path,geodesic:true,strokeColor:'#008f89',strokeOpacity:.95,strokeWeight:4});new google.maps.Polyline({map,path,geodesic:true,strokeColor:'#20d3c8',strokeOpacity:.35,strokeWeight:10});map.fitBounds(bounds,80);window.__gvJourneyMapFocus=(index,options={})=>{if(options.overview){map.fitBounds(bounds,80);return;}const point=points[Math.max(0,Math.min(Number(index)||0,points.length-1))];if(point){map.panTo({lat:point.lat,lng:point.lng});map.setZoom(Math.max(4,Math.min(7,Number(map.getZoom())||5)));}};setTimeout(()=>{
// GV-GLOBAL-665A: all route mutations require backend feasibility validation; no local random-city fallback.
google.maps.event.trigger(map,'resize');map.fitBounds(bounds,80);},150);}
function loadMap(t){if(String(q.get('offline')||'')==='1'){drawFallbackMap(t);return;}const key=window.GLOBEVOY_CONFIG&&window.GLOBEVOY_CONFIG.googleMapsApiKey;if(window.google&&google.maps){renderMap(t);return;}if(!key||String(key).includes('YOUR_RESTRICTED_GOOGLE_MAPS_BROWSER_KEY')){drawFallbackMap(t);return;}window.__gvMcvMap=()=>renderMap(activeTour||t);if(document.querySelector('script[data-gv-mcv-map]'))return;const s=document.createElement('script');s.dataset.gvMcvMap='1';s.async=true;s.defer=true;s.src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__gvMcvMap`;s.onerror=()=>drawFallbackMap(t);document.head.appendChild(s);}
function render(t,options={}){const guarded=applyBudgetGuardrail(t);if(!guarded){showError('No strong route found within this budget. Try increasing the budget, reducing stops, or choosing a shorter trip.');return;}activeTour=guarded;window.__gvGeneratedTour=guarded;if(pickTours.length){pickTours[activePickIndex]=guarded;}else{pickTours=[guarded];activePickIndex=0;}try{sessionStorage.setItem(storageKey,JSON.stringify(guarded));}catch(_){}$('#mcv-loading').hidden=true;$('#mcv-error').hidden=true;$('#mcv-app').hidden=false;renderPickList();renderHeader(guarded);renderCards(guarded);loadMap(guarded);window.dispatchEvent(new CustomEvent('gv:journey-rendered',{detail:{tour:guarded}}));if(options.fromPick){const hero=document.querySelector('.mcv-generated-hero');hero?.classList.add('is-route-updated');setTimeout(()=>hero?.classList.remove('is-route-updated'),450);}}
function showError(message){$('#mcv-loading').hidden=true;$('#mcv-app').hidden=true;$('#mcv-error').hidden=false;$('#mcv-error-copy').textContent=message||'Try again from the homepage.';$('#mcv-error-back').href=returnUrl();}
function apiParams(){const params={};q.forEach((v,k)=>{if(k!=='generated')params[k]=v;});const exact=isExactDateRequest();const auto=!exact&&(String(params.tripLength||'').toLowerCase()==='auto'||String(params.adaptiveDuration||'').toLowerCase()==='true');if(auto){delete params.nights;delete params.totalNights;params.adaptiveDuration='true';}else{const nights=params.totalNights||params.nights;if(nights){params.nights=String(nights);params.totalNights=String(nights);}params.adaptiveDuration='false';}return params;}
// Going back to this page (for example from the booking page) reuses the trips already
// found for the same search for 30 minutes, instead of running the whole live search
// again. A new search (different URL) or signing in/out runs a fresh search.
const PICKS_CACHE_MS_GV=30*60*1000;
function picksCacheKeyGV(){return 'gv-picks:'+(classicMember711()?'member:':'guest:')+location.pathname+location.search;}
async function cachedGeneratedPicks(){const key=picksCacheKeyGV();try{const saved=JSON.parse(sessionStorage.getItem(key)||'null');if(saved&&Array.isArray(saved.tours)&&saved.tours.length&&Date.now()-Number(saved.at)<PICKS_CACHE_MS_GV)return saved.tours;}catch(_){}const tours=await fetchGeneratedPicks();try{sessionStorage.setItem(key,JSON.stringify({at:Date.now(),tours}));}catch(_){}return tours;}
async function start(){try{if(String(q.get('saved')||'').toLowerCase()==='true'){const tour=await restoreSavedRoute();tour.pickRole=normalizePickRole(tour.pickRole||tour.tourRole)||'best-balance';tour.displayOptionNumber=1;tour.pickRoleLabel='Option 1';pickTours=[tour];activePickIndex=0;render(tour);const button=$('#mcv-save-trip');if(button){button.textContent='Saved ✓';button.classList.add('is-saved');}return;}if(String(q.get('generated')||'').toLowerCase()==='true'){pickTours=await cachedGeneratedPicks();activePickIndex=Math.max(0,pickTours.findIndex(t=>pickRole(t)==='best-balance'));render(pickTours[activePickIndex]);return;}const tour=getStoredTour();if(!tour){showError('No selected multi-city route was found in this browser. Start again from the homepage.');return;}tour.pickRole=normalizePickRole(tour.pickRole||tour.tourRole)||'best-balance';tour.displayOptionNumber=1;tour.pickRoleLabel='Option 1';pickTours=[tour];activePickIndex=0;render(tour);}catch(error){showError(error.message||'Generated tour failed to load.');}}
// GV-WEB-711B-R1: remove the legacy Edit search results strip.
$('#mcv-edit-search')?.closest('.mcv-r2-results-head')?.remove();

$('#mcv-replacement-close')?.addEventListener('click',closeReplacementChoices674A);$('#mcv-replacement-modal')?.addEventListener('click',event=>{if(event.target?.dataset?.closeReplacement==='true')closeReplacementChoices674A();});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#mcv-replacement-modal')?.hidden)closeReplacementChoices674A();});
start();
})();
