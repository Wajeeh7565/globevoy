(function(root,factory){
  const api=factory(root||{});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GlobevoyBookingHub685D=api;
  if(root&&root.document)api.start();
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const VERSION='GV-BOOK-685D-R2';
  const SYMBOLS={USD:'$',CAD:'C$',AUD:'A$',EUR:'€',GBP:'£'};
  const AIRLINES={AC:'Air Canada',WS:'WestJet',PD:'Porter Airlines',TS:'Air Transat',AA:'American Airlines',DL:'Delta',UA:'United',BA:'British Airways',FR:'Ryanair',U2:'easyJet',EI:'Aer Lingus',AM:'Aeroméxico'};

  function esc(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
  function number(value,fallback=0){const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;}
  function positive(value){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>0?parsed:null;}
  function safeDate(value){const text=String(value||'').slice(0,10),n=Date.parse(text+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(text)&&Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===text?text:'';}
  function formatDate(value){const text=safeDate(value);if(!text)return'Date to confirm';try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(`${text}T12:00:00Z`));}catch(_){return text;}}
  function money(value,currency){const amount=positive(value);if(amount===null)return'Price to confirm';const code=String(currency||'CAD').toUpperCase();try{return `${code} ${SYMBOLS[code]||''}${new Intl.NumberFormat(code==='USD'?'en-US':'en-CA',{maximumFractionDigits:0}).format(Math.round(amount))}`;}catch(_){return `${code} ${SYMBOLS[code]||''}${Math.round(amount)}`;}}
  function safeUrl(value){try{const u=new URL(String(value||''));return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')?u.href:'';}catch(_){return'';}}
  function nodeCode(node){const text=String(node?.airportCode||node?.code||node?.iata||node?.displayCode||'').trim().toUpperCase();return /^[A-Z0-9]{3,5}$/.test(text)?text:'';}
  function cityName(node,fallback){return String(node?.city||node?.name||fallback||'').trim()||'Location to confirm';}
  function sourceType(subject){return String(subject?.sourceType||subject?.priceEvidence?.sourceType||subject?.priceProvenance?.sourceType||subject?.booking?.trust?.sourceType||subject?.providerVerification?.sourceType||'').toUpperCase();}
  function legs(tour){return Array.isArray(tour?.backendLegs)?tour.backendLegs:(Array.isArray(tour?.legs)?tour.legs:[]);}
  function cities(tour){return Array.isArray(tour?.cities)?tour.cities:[];}
  function stays(tour){const direct=Array.isArray(tour?.stays)?tour.stays:[];return cities(tour).map((city,index)=>({...(direct[index]||{}),...city,hotel:direct[index]?.hotel||city?.hotel||{}}));}
  function currencyOf(tour,query){return String(tour?.budget?.total?.currency||tour?.displayBudget?.currency||query?.get?.('currency')||'CAD').toUpperCase();}
  function rateOf(tour,currency){return number(tour?.canonicalPricing?.exchangeRateFromUsd||tour?.displayBudget?.exchangeRateFromUsd,{USD:1,CAD:1.36,AUD:1.52,EUR:.92,GBP:.79}[currency]||1)||1;}
  function party(tour,query){
    const pricing=tour?.passengerPricing||{},children=Math.max(0,number(pricing.children??query?.get?.('children'),0)),infants=Math.max(0,number(pricing.infants??query?.get?.('infants'),0));
    const total=number(pricing.travellers??pricing.passengers??query?.get?.('passengers'),1);
    const adults=Math.max(1,number(pricing.adults??query?.get?.('adults'),Math.max(1,total-children-infants))||Math.max(1,total-children-infants));
    const travellers=Math.max(1,number(pricing.travellers??pricing.passengers,adults+children+infants)||adults+children+infants),rooms=Math.max(1,number(pricing.rooms??query?.get?.('rooms'),travellers>=3?2:1)||1);
    return{adults,children,infants,travellers,rooms};
  }
  function isFlight(leg){const text=`${String(leg?.mode||'')} ${String(leg?.transportType||'')}`.toLowerCase();if(text.includes('flight'))return true;return(Array.isArray(leg?.segments)?leg.segments:[]).some(segment=>`${String(segment?.mode||'')} ${String(segment?.transportType||'')}`.toLowerCase().includes('flight'));}
  function isGround(leg){if(isFlight(leg))return false;return/(ground|rail|bus|train|transfer)/i.test(`${String(leg?.mode||'')} ${String(leg?.transportType||'')} ${String(leg?.operator||'')}`);}
  function evidenceOf(leg){return leg?.providerDateEvidence||leg?.cheapestOneWay||{};}
  function providerEvidenceEligible(leg){const evidence=evidenceOf(leg);return evidence?.appliedToEstimate!==false&&evidence?.productionEligible!==false&&leg?.providerVerification?.productionEligible!==false&&!!(leg?.liveFareVerified||evidence?.providerBacked);}
  function legDate(leg){const selected=leg?.automaticTourDate?.departureDate||leg?.departureDate||leg?.dateLabel;return selected?safeDate(selected):safeDate(providerEvidenceEligible(leg)&&evidenceOf(leg).departureDate);}
  function durationText(value){const minutes=number(value,0);if(minutes<=0)return'';const hours=Math.floor(minutes/60),remainder=Math.round(minutes%60);return hours&&remainder?`${hours}h ${remainder}m`:hours?`${hours}h`:`${remainder}m`;}
  function airlineText(leg){const evidence=evidenceOf(leg),raw=String(evidence.airlineName||evidence.airline||leg?.airlineName||leg?.airline||'').trim();return AIRLINES[raw.toUpperCase()]||raw;}
  function flightEvidence(leg,context={}){
    const evidence=evidenceOf(leg),type=sourceType(evidence)||sourceType(leg);
    const duffel=/duffel/i.test([evidence.provider,evidence.providerLabel,evidence.source,leg?.estimateSource].filter(Boolean).join(' '))||!!evidence.publicLiveFareEvidence684A;
    let observed=providerEvidenceEligible(leg)||type==='LIVE'||type==='CACHED',label='Planning estimate — verify price',state='estimate',effectiveType=type;
    if(duffel){
      const amount=positive(evidence.providerPartyTotalAmount??evidence.totalPrice??evidence.price),count=Number(evidence.providerPassengerCount??evidence.passengers);
      const matches=(evidence.resolvedOrigin||evidence.origin)===nodeCode(leg?.from)&&(evidence.resolvedDestination||evidence.destination)===nodeCode(leg?.to)&&evidence.departureDate===legDate(leg)
        &&Number.isInteger(count)&&count>0&&(!context.travellers||count===context.travellers)&&!context.children&&!context.infants
        &&(!context.currency||(evidence.displayCurrency||evidence.currency||evidence.providerCurrency)===context.currency);
      observed=type==='LIVE'&&evidence.liveMode===true&&evidence.productionEligible===true&&evidence.appliedToEstimate!==false&&evidence.fareAmountBasis==='party-total'
        &&!!amount&&/^[A-Z]{3}$/.test(evidence.providerCurrency||evidence.currency||'')&&matches&&Date.parse(evidence.expiresAt)>Date.now();
      if(observed){label='Fare observed via Duffel — not reserved';state='provider';}
      else if(type==='CACHED'){effectiveType='CACHED';label='Cached Duffel fare observation';state='estimate';}
      else{effectiveType='UNAVAILABLE';label=Number.isFinite(Date.parse(evidence.expiresAt))&&Date.parse(evidence.expiresAt)<=Date.now()?'Expired Duffel fare — recheck required':'Duffel fare unavailable — verification required';state='unavailable';}
    }else if(type==='UNAVAILABLE'){label='Current fare unavailable';state='unavailable';observed=false;}
    else if(observed){label=type==='CACHED'?'Cached fare observation':'Provider fare observed';state='provider';}
    const note=duffel?'Aviasales is an independent comparison search and does not reserve or guarantee the observed Duffel fare. Final fare and availability confirmed by the booking provider.':type==='CACHED'?'This cached observation is not a current quote; confirm the current fare with the booking provider.':'Final fare and availability confirmed by the booking provider.';
    return{duffel,observed,label,state,note,sourceType:effectiveType};
  }
  function hotelEvidence(stay){
    const hotel=stay?.hotel||{},type=sourceType(hotel),link=stayReferral(stay),agoda=!!link.url||/agoda/i.test(String(hotel.providerHotel?.provider||hotel.provider||'')),propertyMatched=link.exact;
    const unavailable=type==='UNAVAILABLE';
    return{agoda,propertyMatched,observed:false,label:unavailable?'Current rate unavailable':type==='CACHED'?'Cached stay estimate — verify price':'Estimated stay cost — verify with partner',state:unavailable?'unavailable':'estimate',sourceType:type,
      note:propertyMatched?'Opens the selected property. Agoda confirms room selection, availability, taxes, fees and final price.':'Hotel comparison only; the destination and price are not guaranteed to match the selected property.'};
  }
  function flightAmount(leg,tour,currency){const evidence=evidenceOf(leg);return positive(leg?.estimatedDisplayTotal||leg?.partyTotalAmountDisplay||evidence?.partyTotalAmountDisplay)||positive(leg?.partyTotalAmountUsd||evidence?.partyTotalAmountUsd||leg?.estimatedTransportUsd||leg?.estimatedFlightUsd||leg?.amountUsd)*rateOf(tour,currency)||null;}
  function stayAmount(stay,tour,currency){const hotel=stay?.hotel||{};return positive(hotel?.estimatedDisplayTotal||hotel?.partyStayDisplayTotal||hotel?.totalStayDisplay)||positive(hotel?.estimatedStayUsd||hotel?.totalStayUsd||stay?.estimatedStayUsd)*rateOf(tour,currency)||null;}
  function airportCode(value){const code=String(typeof value==='object'?nodeCode(value):value||'').trim().toUpperCase();return /^[A-Z]{3}$/.test(code)?code:'';}
  function metroAirportDisclosure(leg){const evidence=evidenceOf(leg),legMetro=leg?.metroAirportSubstitution683H,providerMetro=evidence?.metroAirportFallback683H,metro=providerMetro||legMetro||{},mode=String(evidence?.airportMode683H||metro?.airportMode683H||leg?.airportMode683H||'').toUpperCase();const sameCityVerified=mode.startsWith('METRO_')&&Boolean(providerMetro||legMetro||evidence?.sameCityRegistryVerified===true||metro?.sameCityRegistryVerified===true);if(!sameCityVerified)return null;const requestedOrigin=airportCode(evidence?.requestedOrigin||metro?.requestedOrigin||leg?.requestedOrigin),resolvedOrigin=airportCode(evidence?.resolvedOrigin||metro?.resolvedOrigin||leg?.resolvedOrigin||leg?.from),requestedDestination=airportCode(evidence?.requestedDestination||metro?.requestedDestination||leg?.requestedDestination),resolvedDestination=airportCode(evidence?.resolvedDestination||metro?.resolvedDestination||leg?.resolvedDestination||leg?.to),changes=[];if(requestedOrigin&&resolvedOrigin&&requestedOrigin!==resolvedOrigin)changes.push({endpoint:'origin',requested:requestedOrigin,resolved:resolvedOrigin});if(requestedDestination&&resolvedDestination&&requestedDestination!==resolvedDestination)changes.push({endpoint:'destination',requested:requestedDestination,resolved:resolvedDestination});if(!changes.length)return null;return{mode,requestedOrigin,resolvedOrigin,requestedDestination,resolvedDestination,changes,label:`Same-city airport change: ${changes.map(change=>`${change.requested} → ${change.resolved}`).join(' · ')}`,caveat:'Ground-access cost for this airport change is not repriced.'};}
  function directAviasalesUrl(leg,index,tour,travellers){const allLegs=legs(tour),from=leg?.from||((index===0)?tour?.origin:cities(tour)[index-1])||{},to=leg?.to||cities(tour)[index]||((index===allLegs.length-1)?tour?.origin:{})||{},origin=nodeCode(from),destination=nodeCode(to),date=legDate(leg),group=party(tour);if(!/^[A-Z]{3}$/.test(origin)||!/^[A-Z]{3}$/.test(destination)||!date)return'';const adults=tour?.passengerPricing?.adults!=null?group.adults:Math.max(1,travellers-group.children-group.infants),counts=[adults,group.children,group.infants];if(counts.some(n=>!Number.isInteger(n)||n<0||n>9)||adults<1||group.infants>adults||counts.reduce((a,b)=>a+b,0)>9)return'';const encoded=group.infants?counts.join(''):group.children?counts.slice(0,2).join(''):String(adults);return`https://www.aviasales.com/search/${origin}${date.slice(8,10)}${date.slice(5,7)}${destination}${encoded}`;}
  function flightUrl(leg,index,tour,travellers){
    const expected=directAviasalesUrl(leg,index,tour,travellers);if(!expected)return'';
    // Saved provider URLs cannot override selected route/date/party context.
    const candidates=[leg?.booking?.directSearchUrl,leg?.directSearchUrl,leg?.booking?.url,leg?.bookingUrl,leg?.providerUrl].map(safeUrl).filter(Boolean);
    return candidates.find(value=>{const u=new URL(value),e=new URL(expected);return u.hostname===e.hostname&&u.pathname===e.pathname;})||expected;
  }
  function groundUrl(leg){const candidates=[leg?.groundBookingUrl,leg?.transportBookingUrl,leg?.railBookingUrl,leg?.busBookingUrl,leg?.booking?.groundUrl,leg?.booking?.transportUrl,leg?.booking?.directSearchUrl,leg?.directSearchUrl,leg?.booking?.url,leg?.bookingUrl,leg?.providerUrl].map(safeUrl).filter(Boolean);return candidates.find(url=>{try{const u=new URL(url),target=u.hostname==='tp.media'?new URL(u.searchParams.get('u')||url):u;return!/(^|\.)(aviasales|agoda|duffel)\./i.test(target.hostname);}catch(_){return false;}})||'';}
  function groundEvidence(leg){const type=sourceType(leg),url=groundUrl(leg),observed=Boolean(url)&&(type==='LIVE'||type==='CACHED');let label='Ground transfer estimate',state='estimate';if(type==='UNAVAILABLE'){label='Current ground-transfer price unavailable';state='unavailable';}else if(observed){label=type==='CACHED'?'Cached ground-transfer observation':'Ground-transfer price observed';state='provider';}const note=observed?'The transport partner confirms the current schedule, fare and availability.':'Rail or bus options are not currently repriced by a connected transport partner.';return{observed,label,state,note,sourceType:type};}
  function stayReferral(stay,context){
    const hotel=stay?.hotel||{},provider=hotel.providerHotel||{},nuitee=Boolean(hotel.nuiteeHotelId)||/nuitee/i.test(String(hotel.provider||provider.provider||''));
    const expected=hotel.agodaHotelId||(!nuitee&&String(provider.provider||hotel.provider).toLowerCase()==='agoda'?(provider.hotelId||hotel.hotelId):null);
    const candidates=hotel.booking&&Object.hasOwn(hotel.booking,'url')?[hotel.booking.url]:[hotel.bookingUrl,provider.bookingUrl,hotel.providerUrl,hotel.hotelUrl,hotel.url,stay?.bookingUrl,stay?.hotelUrl];
    const checkIn=safeDate(stay?.arrivalDate||stay?.checkIn||hotel.checkIn||hotel.booking?.checkIn),checkOut=safeDate(stay?.departureDate||stay?.checkOut||hotel.checkOut||hotel.booking?.checkOut);
    if(!checkIn||!checkOut||checkOut<=checkIn)return{url:'',exact:false};
    for(const raw of candidates){try{
      const value=safeUrl(raw);if(!value)continue;const u=new URL(value);if(u.hostname!=='agoda.com'&&!u.hostname.endsWith('.agoda.com'))continue;
      const ids=[...u.searchParams].filter(([k])=>['hid','hotelid','hotel_id'].includes(k.toLowerCase())).map(([,v])=>v);
      if(ids.some(id=>!/^\d+$/.test(id)||Number(id)<=0||!Number.isSafeInteger(Number(id))||(expected&&Number(id)!==Number(expected)))||new Set(ids.map(Number)).size>1)continue;
      const exact=!nuitee&&Number.isSafeInteger(Number(expected))&&Number(expected)>0&&/\/hotel\/.*\.html$/i.test(u.pathname)&&!u.pathname.toLowerCase().includes('partnersearch');
      const values={checkin:checkIn,checkout:checkOut,...(context?{rooms:context.rooms,adults:context.adults,children:context.children,currency:context.currency}:{})};
      for(const [key,value]of Object.entries(values)){const aliases=key==='adults'?['adults','numberofadults']:key==='children'?['children','numberofchildren']:[key];const keys=[...u.searchParams.keys()].filter(k=>aliases.includes(k.toLowerCase())),selected=keys[0]||key;for(const k of keys)u.searchParams.delete(k);u.searchParams.set(selected,String(value));}
      return{url:u.href,exact};
    }catch(_){}}
    return{url:'',exact:false};
  }
  function stayUrl(stay,context){return stayReferral(stay,context).url;}
  function partnerName(url){if(!url)return'';try{const host=new URL(url).hostname.toLowerCase();if(host.includes('aviasales'))return'Aviasales';if(host.includes('agoda'))return'Agoda';if(host.includes('duffel'))return'Duffel';return host.replace(/^www\./,'');}catch(_){return'External partner';}}
  function reliableHotelName(stay){const hotel=stay?.hotel||{},provider=hotel.providerHotel||{},verified=Boolean(provider.hotelId||hotel?.providerVerification?.verified);return verified?String(provider.hotelName||hotel.name||hotel.hotelName||'').trim():'';}
  function findStayForCity(allStays,city,index){const cityKey=cityName(city).toLowerCase(),codeKey=nodeCode(city);return allStays.find(stay=>cityName(stay).toLowerCase()===cityKey||(codeKey&&nodeCode(stay)===codeKey))||allStays[index]||null;}
  function stayDates(stay,inboundLeg,outboundLeg){const hotel=stay?.hotel||{};return{checkIn:safeDate(stay?.arrivalDate||stay?.checkIn||hotel.checkIn||hotel?.booking?.checkIn)||legDate(inboundLeg),checkOut:safeDate(stay?.departureDate||stay?.checkOut||hotel.checkOut||hotel?.booking?.checkOut)||legDate(outboundLeg)};}

  function buildJourney(tour,query){
    const allLegs=legs(tour),allCities=cities(tour),allStays=stays(tour),group=party(tour,query),currency=currencyOf(tour,query),origin=tour?.origin||{};
    const items=[],usedStays=new Set();
    allLegs.forEach((leg,index)=>{
      const from=leg?.from||((index===0)?origin:allCities[index-1])||{},to=leg?.to||allCities[index]||{},ground=isGround(leg),flight=!ground;
      const url=ground?groundUrl(leg):flightUrl(leg,index,tour,group.travellers),evidence=ground?groundEvidence(leg):flightEvidence(leg,{...group,currency}),stopsValue=Number(evidenceOf(leg)?.stops??evidenceOf(leg)?.transfers??leg?.stops),stops=Number.isFinite(stopsValue)&&stopsValue>=0?(stopsValue===0?'Nonstop':`${Math.round(stopsValue)} stop${Math.round(stopsValue)===1?'':'s'}`):'';
      items.push({kind:ground?'ground':'flight',index,from,to,title:`${cityName(from,nodeCode(from))} → ${cityName(to,nodeCode(to))}`,routeCodes:[nodeCode(from),nodeCode(to)].filter(Boolean).join(' → '),date:legDate(leg),airline:flight?airlineText(leg):String(leg?.operator||'').trim(),stops:flight?stops:'',duration:durationText(evidenceOf(leg)?.durationMinutes||leg?.durationMinutes),amount:flightAmount(leg,tour,currency),currency,evidence,metro:flight?metroAirportDisclosure(leg):null,url,partner:partnerName(url),action:ground?'Check transport options':'Compare flights on Aviasales',source:leg});
      const originKey=cityName(origin).toLowerCase(),toKey=cityName(to).toLowerCase();
      if(toKey&&toKey!==originKey){
        const cityIndex=allCities.findIndex(city=>cityName(city).toLowerCase()===toKey||(nodeCode(to)&&nodeCode(city)===nodeCode(to)));
        const safeIndex=cityIndex>=0?cityIndex:index;
        const stay=findStayForCity(allStays,to,safeIndex);
        if(stay&&!usedStays.has(stay)){
          usedStays.add(stay);
          const hotel=stay.hotel||{},nextLeg=allLegs.slice(index+1).find(next=>cityName(next?.from).toLowerCase()===toKey)||allLegs[index+1],dates=stayDates(stay,leg,nextLeg),hotelTrust=hotelEvidence(stay),stayLink=stayUrl(stay,{...group,currency}),propertyName=reliableHotelName(stay),nights=Math.max(0,number(stay.nights||hotel.nights,0));
          items.push({kind:'stay',index:safeIndex,city:cityName(stay,cityName(to)),title:propertyName||`${cityName(stay,cityName(to))} stay`,propertyName,nights,checkIn:dates.checkIn,checkOut:dates.checkOut,rooms:group.rooms,travellers:group.travellers,amount:stayAmount(stay,tour,currency),currency,evidence:hotelTrust,url:stayLink,partner:partnerName(stayLink),action:hotelTrust.agoda?(hotelTrust.propertyMatched?'Check this property on Agoda':'Compare stays on Agoda'):'Check current stay options',source:stay});
        }
      }
    });
    allStays.forEach((stay,index)=>{
      if(usedStays.has(stay))return;
      const hotel=stay.hotel||{},dates=stayDates(stay,null,null),trust=hotelEvidence(stay),url=stayUrl(stay,{...group,currency}),propertyName=reliableHotelName(stay),city=cityName(stay,`Destination ${index+1}`),nights=Math.max(0,number(stay.nights||hotel.nights,0));
      items.push({kind:'stay',index,city,title:propertyName||`${city} stay`,propertyName,nights,checkIn:dates.checkIn,checkOut:dates.checkOut,rooms:group.rooms,travellers:group.travellers,amount:stayAmount(stay,tour,currency),currency,evidence:trust,url,partner:partnerName(url),action:trust.agoda?(trust.propertyMatched?'Check this property on Agoda':'Compare stays on Agoda'):'Check current stay options',source:stay});
    });
    return{version:VERSION,items,currency,party:group,flightCount:items.filter(item=>item.kind==='flight').length,groundCount:items.filter(item=>item.kind==='ground').length,stayCount:items.filter(item=>item.kind==='stay').length};
  }

  function confidenceFor(tour,query,engine){const currency=currencyOf(tour,query),budget=positive(tour?.budget?.total?.amount||tour?.displayBudget?.totalBudget||query?.get?.('budget'))||0,total=positive(tour?.canonicalPricing?.canonicalDisplayTotal||tour?.budget?.estimatedCoreTotal?.amount||tour?.displayBudget?.tripEstimate||query?.get?.('total'))||0,reported=tour?.liveProviderVerification||tour?.priceProvenance?.liveProviderVerification||{},items=buildJourney(tour,query).items,live={...reported,criticalCount:items.length,verifiedCount:Math.min(number(reported.verifiedCount),items.filter(i=>i.evidence.observed&&i.evidence.sourceType==='LIVE').length),allCriticalVerified:items.length>0&&items.every(i=>i.evidence.observed&&i.evidence.sourceType==='LIVE')},over=budget>0&&total>budget;const evaluator=engine&&typeof engine.evaluate==='function'?engine:null;const result=evaluator?evaluator.evaluate({over,live}):{version:'GV-TRUST-685B',level:over?'over-budget':'verification-required',label:over?'Over budget':'Price verification required',criticalCount:number(live.criticalCount),verifiedCount:number(live.verifiedCount)};const estimated=result.level!=='provider-backed-fit';let message='Partner pages confirm final prices and availability; the current trip total remains an estimate.';if(result.level==='provider-backed-fit')message='All critical prices have provider evidence; recheck before purchase.';else if(result.level==='partial-evidence')message=`${result.verifiedCount} of ${result.criticalCount} critical prices have provider evidence; the current trip total remains an estimate.`;else if(result.level==='over-budget')message='The estimated whole-group trip total is above the entered budget.';return{...result,message,budget,total,currency,estimated,totalLabel:estimated?'Estimated trip total':'Provider-backed trip total'};}

  function componentHtml(item,step){
    const isStay=item.kind==='stay',isGround=item.kind==='ground',marker=isStay?'▣':isGround?'↔':'✈',type=isStay?'Hotel stay':isGround?'Ground transport':'Flight',details=[];
    if(isStay){if(item.checkIn||item.checkOut)details.push(`${formatDate(item.checkIn)}${item.checkOut?` – ${formatDate(item.checkOut)}`:''}`);if(item.nights)details.push(`${item.nights} ${item.nights===1?'night':'nights'}`);details.push(`${item.rooms} ${item.rooms===1?'room':'rooms'}`);}else{details.push(formatDate(item.date));if(item.routeCodes)details.push(item.routeCodes);if(item.airline)details.push(item.airline);if(item.stops)details.push(item.stops);if(item.duration)details.push(item.duration);}
    const providerLine=item.partner?`Opens ${item.partner} in a separate tab`:isGround?'Rail or bus partner search is not yet connected':'Partner handoff unavailable',metroHtml=!isStay&&item.metro?`<div class="gv-booking-metro-disclosure" role="note"><strong>${esc(item.metro.label)}</strong><span>${esc(item.metro.caveat)}</span></div>`:'';
    const priceKind=item.evidence.observed?'Observed component price — not reserved':'Estimated component price';
    return`<li class="gv-booking-timeline-item ${isStay?'is-stay':isGround?'is-ground':'is-flight'}" data-kind="${esc(item.kind)}"><div class="gv-booking-timeline-marker" aria-hidden="true">${marker}</div><article class="gv-booking-journey-card"><div class="gv-booking-journey-main"><p class="gv-booking-journey-type"><span class="gv-booking-journey-step">Step ${step}</span><span>${esc(type)}</span></p><h3>${esc(item.title)}</h3><p class="gv-booking-journey-detail">${details.filter(Boolean).map(detail=>`<span>${esc(detail)}</span>`).join('')}</p>${metroHtml}<div class="gv-booking-journey-evidence"><span class="gv-booking-evidence-pill is-${esc(item.evidence.state)}">${esc(item.evidence.label)}</span>${item.partner?`<span class="gv-booking-evidence-pill">External fulfilment · ${esc(item.partner)}</span>`:''}</div><p class="gv-booking-evidence-note">${esc(item.evidence.note)}</p></div><div class="gv-booking-journey-side"><div class="gv-booking-journey-price">${esc(money(item.amount,item.currency))}<small>${esc(priceKind)}</small></div><div class="gv-booking-journey-provider">${esc(providerLine)}</div>${item.url?`<a class="gv-booking-journey-action gv-booking-link" href="${esc(item.url)}" target="_blank" rel="noopener sponsored" aria-label="${esc(item.action)} for ${esc(item.title)}">${esc(item.action)} ↗</a>`:`<span class="gv-booking-journey-action" aria-disabled="true">${isGround?'Transport partner pending':'Partner link pending'}</span>`}</div></article></li>`;
  }

  function pathFor(tour){const origin=cityName(tour?.origin,'Origin'),destinations=cities(tour).map(city=>cityName(city)).filter(Boolean);return[origin,...destinations,origin];}
  function buildSingleTour(query,storage){let selected=null;try{selected=JSON.parse(storage?.getItem?.('gv-selected-offer')||'null');}catch(_){selected=null;}const originText=String(query.get('origin')||'Origin'),originCode=(originText.match(/\(([A-Z]{3})\)/i)||[])[1]||'',originCity=originText.replace(/\s*\([A-Z]{3}\)\s*$/i,'').trim()||'Origin',city=String(query.get('city')||selected?.city||'Destination'),destinationCode=String(query.get('destinationCode')||selected?.destinationCode||''),departureDate=safeDate(query.get('departureDate')),returnDate=safeDate(query.get('returnDate')),origin={city:originCity,code:originCode,airportCode:originCode},destination={city,country:String(query.get('country')||selected?.country||''),code:destinationCode,airportCode:destinationCode},flightUrl=safeUrl(selected?.flightUrl||query.get('flightUrl')),hotelUrlValue=safeUrl(selected?.hotelUrl||query.get('hotelUrl')),hotelAmount=positive(selected?.hotel||selected?.hotelPrice),flightAmountValue=positive(selected?.flight||selected?.flightPrice),nights=departureDate&&returnDate?Math.max(1,Math.round((new Date(`${returnDate}T12:00:00Z`)-new Date(`${departureDate}T12:00:00Z`))/86400000)):0,legs=[{from:origin,to:destination,mode:'flight',departureDate,estimatedDisplayTotal:flightAmountValue,bookingUrl:flightUrl}];if(returnDate)legs.push({from:destination,to:origin,mode:'flight',departureDate:returnDate,estimatedDisplayTotal:null});return{origin,cities:[{...destination,nights,hotel:{estimatedDisplayTotal:hotelAmount,bookingUrl:hotelUrlValue}}],stays:[{...destination,nights,arrivalDate:departureDate,departureDate:returnDate,hotel:{estimatedDisplayTotal:hotelAmount,bookingUrl:hotelUrlValue}}],legs,backendLegs:legs,budget:{total:{amount:number(query.get('budget')),currency:String(query.get('currency')||'CAD')}},displayBudget:{tripEstimate:number(query.get('total')||selected?.total),currency:String(query.get('currency')||'CAD')},passengerPricing:{adults:number(query.get('adults')||query.get('passengers'),1),children:number(query.get('children')),travellers:number(query.get('passengers'),1),rooms:number(query.get('rooms'),1)}};}

  function enhance(tour,document,query,engine){
    if(!tour||!document)return null;
    const model=buildJourney(tour,query),timeline=document.querySelector('#gv-booking-timeline'),section=document.querySelector('#gv-booking-journey-section');if(!timeline||!section)return model;
    timeline.innerHTML=model.items.map((item,index)=>componentHtml(item,index+1)).join('')||'<li class="gv-booking-notice">No dated trip components were available. Return to trip details and regenerate the route.</li>';
    section.hidden=false;
    const count=document.querySelector('#gv-booking-journey-count');if(count)count.textContent=[model.flightCount?`${model.flightCount} flight${model.flightCount===1?'':'s'}`:'',model.groundCount?`${model.groundCount} transfer${model.groundCount===1?'':'s'}`:'',model.stayCount?`${model.stayCount} stay${model.stayCount===1?'':'s'}`:''].filter(Boolean).join(' · ')||'Trip components pending';
    const confidence=confidenceFor(tour,query,engine),confidenceEl=document.querySelector('#gv-booking-confidence');if(confidenceEl){confidenceEl.dataset.level=confidence.level;confidenceEl.innerHTML=`<strong>${esc(confidence.label)}</strong><span>${esc(confidence.message)}</span>`;}const totalLabel=document.querySelector('#gv-booking-total-label');if(totalLabel)totalLabel.textContent=confidence.totalLabel;
    const route=pathFor(tour),title=document.querySelector('#gv-booking-title');if(title)title.textContent='Your complete trip';const routeEl=document.querySelector('#gv-booking-route');if(routeEl)routeEl.textContent=route.join(' → ');
    const multiButton=document.querySelector('#gv-booking-multicity');if(multiButton){multiButton.textContent='Open booking checklist';multiButton.onclick=()=>section.scrollIntoView({behavior:'smooth',block:'start'});}
    const transport=document.querySelector('#gv-booking-transport-section'),hotelList=document.querySelector('#gv-booking-stays'),hotelSection=hotelList?.closest?.('.gv-booking-section');if(transport)transport.dataset.legacyBookingList='true';if(hotelSection)hotelSection.dataset.legacyBookingList='true';
    const handoffTitle=document.querySelector('#gv-booking-handoff-title');if(handoffTitle)handoffTitle.textContent='Book each component with its partner';const continueButton=document.querySelector('#gv-booking-continue-partner');if(continueButton){continueButton.textContent='Open booking checklist';continueButton.onclick=()=>section.scrollIntoView({behavior:'smooth',block:'start'});}
    const checklist=document.querySelector('#gv-booking-checklist');if(checklist)checklist.innerHTML=[['Complete sequence',`${model.items.length} journey item${model.items.length===1?'':'s'} shown in order`],['Whole-group estimate','Budget and estimated trip total are not per-person'],['Book with partners','Flights and stays are booked separately with their respective partners'],['Final verification','Confirm every date, traveller, room, rule and final price']].map(row=>`<div class="gv-booking-check"><strong>✓ ${esc(row[0])}</strong><span>${esc(row[1])}</span></div>`).join('');
    return{model,confidence};
  }

  function start(){const document=root.document,query=new URLSearchParams(root.location?.search||'');if(!document)return;let enhanced=false;const run=tour=>{if(enhanced||!tour)return;enhanced=true;enhance(tour,document,query,root.GV_TRUST_685B_BUDGET_CONFIDENCE);};root.addEventListener?.('globevoy:booking-tour-ready',event=>run(event?.detail?.tour));const existing=root.GlobevoyBooking673FR1?.tour;if(existing)run(existing);else if(String(query.get('multi')||'').toLowerCase()!=='true')run(buildSingleTour(query,root.sessionStorage));else{let attempts=0;const timer=root.setInterval?.(()=>{const tour=root.GlobevoyBooking673FR1?.tour;if(tour){root.clearInterval?.(timer);run(tour);}else if(++attempts>80)root.clearInterval?.(timer);},250);}}

  return Object.freeze({VERSION,safeDate,formatDate,money,sourceType,isFlight,isGround,flightEvidence,hotelEvidence,groundEvidence,metroAirportDisclosure,directAviasalesUrl,flightUrl,groundUrl,stayUrl,stayReferral,partnerName,reliableHotelName,stayDates,buildJourney,confidenceFor,componentHtml,pathFor,buildSingleTour,enhance,start});
});
