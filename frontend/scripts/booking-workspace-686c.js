(function(root,factory){
  const api=factory(root||{});
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.GlobevoyBookingWorkspace686C=api;
  if(root&&root.document)api.start();
})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';

  const VERSION='GV-BOOK-686C';
  const STEP_LABELS=['Review trip','Verify flights','Verify stays','Price confidence','Complete bookings'];
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const safeUrl=value=>/^https?:\/\//i.test(String(value||'').trim())?String(value).trim():'';
  const sourceType=item=>String(item?.evidence?.sourceType||'').toUpperCase();
  const itemId=(item,index)=>`${item.kind}-${index}-${String(item.title||'item').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}`;

  function evidenceBucket(item){
    const type=sourceType(item),state=String(item?.evidence?.state||'').toLowerCase();
    if(type==='UNAVAILABLE'||state==='unavailable')return'unavailable';
    if(type==='CACHED'||/^cached\b/i.test(String(item?.evidence?.label||'')))return'cached';
    if(item?.evidence?.observed||state==='provider')return'provider';
    return'estimate';
  }

  function dateRange(items,hub){
    const dates=[];
    items.forEach(item=>{if(item.kind==='stay'){if(item.checkIn)dates.push(item.checkIn);if(item.checkOut)dates.push(item.checkOut);}else if(item.date)dates.push(item.date);});
    dates.sort();
    return dates.length?`${hub.formatDate(dates[0])}${dates.length>1?` – ${hub.formatDate(dates[dates.length-1])}`:''}`:'Dates to confirm';
  }

  function buildWorkspaceModel(tour,query,hub,confidenceEngine){
    const journey=hub.buildJourney(tour,query),confidence=hub.confidenceFor(tour,query,confidenceEngine),route=hub.pathFor(tour),items=journey.items.map((item,index)=>({...item,id:itemId(item,index),bucket:evidenceBucket(item)}));
    const counts={provider:0,cached:0,estimate:0,unavailable:0};items.forEach(item=>counts[item.bucket]++);
    const actionable=items.filter(item=>safeUrl(item.url));
    return{version:VERSION,items,route,routeText:route.join(' → '),dates:dateRange(items,hub),confidence,counts,actionable,party:journey.party,currency:journey.currency,remaining:confidence.budget-confidence.total};
  }

  function compactRow(item,hub){
    const stay=item.kind==='stay',icon=stay?'▣':item.kind==='ground'?'↔':'✈',meta=stay?[item.checkIn?hub.formatDate(item.checkIn):'',item.nights?`${item.nights} ${item.nights===1?'night':'nights'}`:'']:[item.date?hub.formatDate(item.date):'',item.routeCodes,item.kind==='ground'?'Ground transport':'Flight'];
    return`<article class="gv-workspace-route-row ${stay?'is-stay':''}"><span class="gv-workspace-route-icon" aria-hidden="true">${icon}</span><div><h3>${esc(item.title)}</h3><p>${esc(meta.filter(Boolean).join(' · '))}</p></div><span class="gv-workspace-route-price">${esc(hub.money(item.amount,item.currency))}</span></article>`;
  }

  function assumptionText(item){
    if(item.kind==='stay')return'Taxes, resort fees, room type, cancellation rules and occupancy must be confirmed on the stay partner page. The displayed amount is not a reserved room rate.';
    if(item.kind==='ground')return'The transport partner must confirm the timetable, operator, luggage policy, station and final fare. This transfer is not repriced by a connected provider unless explicitly labelled observed.';
    return'Baggage, seats, fare rules, seller, connections and optional extras are not guaranteed by this screen. Confirm them with the flight partner before purchase.';
  }

  function detailMeta(item,hub){
    if(item.kind==='stay')return[item.checkIn?`${hub.formatDate(item.checkIn)}${item.checkOut?` – ${hub.formatDate(item.checkOut)}`:''}`:'Dates to confirm',item.nights?`${item.nights} ${item.nights===1?'night':'nights'}`:'',`${item.rooms} ${item.rooms===1?'room':'rooms'}`];
    return[item.date?hub.formatDate(item.date):'Date to confirm',item.routeCodes,item.airline,item.stops,item.duration];
  }

  function itemCard(item,hub,reviewed,completeMode=false,index=0){
    const url=safeUrl(item.url),status=reviewed.has(item.id),partner=item.partner||'partner',meta=detailMeta(item,hub).filter(Boolean),metro=item.metro?`<div class="gv-workspace-metro"><strong>${esc(item.metro.label)}</strong>${esc(item.metro.caveat)}</div>`:'';
    if(completeMode)return`<article class="gv-workspace-complete-row" data-workspace-item="${esc(item.id)}"><span class="gv-workspace-complete-index">${index+1}</span><div><h3>${esc(item.title)}</h3><p>${esc(item.kind==='stay'?'Stay':item.kind==='ground'?'Ground transport':'Flight')} · ${esc(partner)} · <span data-review-status class="gv-workspace-review-status ${status?'is-reviewed':''}">${status?'Provider result reviewed':'Not reviewed'}</span></p></div>${url?`<a class="gv-workspace-partner" data-partner-review="${esc(item.id)}" href="${esc(url)}" target="_blank" rel="noopener sponsored">Open ${esc(partner)} ↗</a>`:'<span class="gv-workspace-partner" aria-disabled="true">Partner link pending</span>'}</article>`;
    return`<article class="gv-workspace-item" data-workspace-item="${esc(item.id)}"><div><h3>${esc(item.title)}</h3><p class="gv-workspace-item-meta">${meta.map(value=>`<span>${esc(value)}</span>`).join('')}</p>${metro}<span class="gv-workspace-evidence is-${esc(item.bucket)}">${esc(item.evidence.label)}</span><p class="gv-workspace-item-note">${esc(item.evidence.note)}</p><details class="gv-workspace-assumptions"><summary>${item.kind==='stay'?'Room, tax and fee assumptions':'Baggage and optional extras'}</summary><div>${esc(assumptionText(item))}</div></details></div><div class="gv-workspace-item-side"><span class="gv-workspace-item-price">${esc(hub.money(item.amount,item.currency))}<small>${item.evidence.observed?'Observed component price':'Planning component price'}</small></span>${url?`<a class="gv-workspace-partner" data-partner-review="${esc(item.id)}" href="${esc(url)}" target="_blank" rel="noopener sponsored">${esc(item.action)} ↗</a>`:'<span class="gv-workspace-partner" aria-disabled="true">Partner link pending</span>'}<span data-review-status class="gv-workspace-review-status ${status?'is-reviewed':''}">${status?'Provider result reviewed':'Not reviewed'}</span></div></article>`;
  }

  function controls(index){return`<div class="gv-workspace-controls">${index?`<button class="gv-workspace-back-step" type="button" data-workspace-back>← ${esc(STEP_LABELS[index-1])}</button>`:'<span></span>'}${index<4?`<button class="gv-workspace-next" type="button" data-workspace-next>${esc(STEP_LABELS[index+1])} →</button>`:'<button class="gv-workspace-next" type="button" data-workspace-finish>Review partner checklist</button>'}</div>`;}

  function liveCheckMarkup(){return `<section class="gv-live-flight-check" aria-labelledby="gv-live-flight-title"><h3 id="gv-live-flight-title">Live Duffel flight verification</h3><p>Saved and cached amounts remain estimates. No fare is reserved. Hotels and the whole-trip total remain estimates.</p><button type="button" class="gv-workspace-next" id="gv-live-duffel-check">Check live Duffel prices</button><p><a href="sign-in.html?returnTo=booking.html" data-live-signin>Sign in</a> · <a href="my-trips.html">My Trips</a></p><div id="gv-live-duffel-result" role="status" aria-live="polite">Sign in and save this trip to your account before checking live prices.</div></section>`;}
  function liveEvidenceHtml(payload,tripId,now=Date.now()){
    const r=payload?.revalidation||{},rows=Array.isArray(payload?.flights)?payload.flights:[],required=Number(r.requiredFlightLegCount)||0;
    const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
    const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
    const live=payload?.ok===true&&payload.trip?.tripId===tripId&&r.provider==='Duffel'&&r.applied===true&&r.allFlightLegsLive===true&&required>0&&r.liveFlightLegCount===required&&rows.length===required&&rows.every(x=>x&&Number.isInteger(x.index)&&x.index>=0)&&new Set(rows.map(x=>x.index)).size===required
      &&rows.every(x=>x.provider==='Duffel'&&x.sourceType==='LIVE'&&x.productionEligible===true&&x.exactMatch===true&&positive(x.providerAmount)&&/^[A-Z]{3}$/.test(x.providerCurrency||'')&&positive(x.freshAmount)&&x.currency===payload.snapshot?.currency
      &&/^[A-Z]{3}$/.test(x.origin||'')&&/^[A-Z]{3}$/.test(x.destination||'')&&x.resolvedOrigin===x.origin&&x.resolvedDestination===x.destination&&validDate(x.departureDate)
      &&Number.isInteger(x.providerPassengerCount)&&x.providerPassengerCount>0&&x.providerPassengerCount===r.passengers&&Date.parse(x.observedAt)<=now&&now-Date.parse(x.observedAt)<=300000&&Date.parse(x.expiresAt)>now);
    const money=(v,c)=>{try{return typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('en',{style:'currency',currency:c}).format(v)+' '+c:'Unavailable';}catch(_){return'Unavailable';}};
    const requests=typeof r.providerRequests==='number'&&Number.isFinite(r.providerRequests)?` · Provider requests: ${r.providerRequests}`:'';
    if(!live){const reason=String(r.reason||'Incomplete, expired or mismatched evidence');return `<p><strong>0 / ${required} flight legs verified</strong>${esc(requests)}</p><p>${/quota|429|rate.limit|request.budget/i.test(reason)?'Provider quota or rate limit reached.':esc(reason)} Live verification unavailable. Your saved estimates are unchanged. Click again only when you want a new search.</p>`;}
    return `<p><strong>${required} / ${required} flight legs verified LIVE via Duffel</strong>${esc(requests)}</p>`+rows.map(x=>`<article class="gv-live-flight-row"><h4>Duffel · LIVE — not reserved</h4><p>${esc(x.origin)} → ${esc(x.destination)} · ${esc(x.departureDate)} · ${x.providerPassengerCount} passenger(s) · ${esc(x.airlineName||'Airline not supplied')}</p><dl><div><dt>Saved/cached estimate</dt><dd>${esc(money(x.savedAmount,x.currency))}</dd></div><div><dt>Live provider fare</dt><dd>${esc(money(x.providerAmount,x.providerCurrency))}</dd></div><div><dt>Display-currency live fare</dt><dd>${esc(money(x.freshAmount,x.currency))}</dd></div><div><dt>Verified at</dt><dd>${esc(x.observedAt)}</dd></div><div><dt>Offer expires</dt><dd>${esc(x.expiresAt)}</dd></div></dl><p>Compare flights on Aviasales independently. Final fare and availability confirmed by the booking provider.</p></article>`).join('')+'<p>Flight evidence only. Hotel costs and the whole-trip total remain estimates.</p>';
  }
  function installLiveCheck(workspace,tour,query){
    const button=workspace.querySelector('#gv-live-duffel-check'),result=workspace.querySelector('#gv-live-duffel-result');if(!button||!result)return;
    let busy=false,payload=null,owner='',tripId='';
    const session=()=>root.GlobevoyAuth705B?.getSession?.();
    const sameOwner=()=>session()?.user?.sub===owner;
    async function request(path,method='GET',body){const current=session();if(!current?.accessToken)throw Error('Sign in again before checking.');const response=await root.fetch(root.GLOBEVOY_AUTH_CONFIG.apiBaseUrl+path,{method,headers:{Authorization:'Bearer '+current.accessToken,...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',credentials:'omit',...(body?{body:JSON.stringify(body)}:{})});if(response.status===401){root.GlobevoyAuth705B.clearSession();throw Error('Session expired. Sign in again.');}if(!response.ok)throw Error(response.status===404?'Saved trip unavailable for this account.':response.status===429?'Provider quota or rate limit reached.':'Live verification unavailable; saved estimates are unchanged.');return response.json();}
    button.addEventListener('click',async()=>{
      if(busy)return;
      if(!session()){payload=null;result.textContent='Sign in and save this trip before checking live Duffel prices.';return;}
      const cfg=root.GLOBEVOY_AUTH_CONFIG,policy=root.GLOBEVOY_ENVIRONMENT_POLICY?.resolve(root.location.origin);
      if(!cfg?.enabled||!policy?.accountsEnabled||cfg.apiBaseUrl!==policy.apiBaseUrl){result.textContent='Account verification is unavailable on this website.';return;}
      busy=true;button.disabled=true;button.setAttribute('aria-busy','true');payload=null;owner=session().user.sub;result.textContent='Verifying your saved trip and checking live prices…';
      try{
        const verified=await request('/api/account/session');if(!sameOwner()||verified.user?.sub!==owner)throw Error('Account changed. Sign in again.');
        if(verified.capabilities?.bookingRevalidation!==true)throw Error('Live Duffel verification is not available on this backend yet. Saved estimates are unchanged.');
        const saved=root.GlobevoySavedTrips705C;if(!saved?.api)throw Error('Saved trips are still loading. Try again in a moment.');
        tripId=query.get('accountTrip')||tour?.savedAccountContext706A?.tripId||'';
        if(!tripId){const snapshot=saved?._internal?.multiSnapshot?.(),trips=await saved.api.list();
          // Legacy save keys omit a date that the booking URL later adds. Match
          // canonical saved itinerary metadata for UI selection only; the API
          // still independently verifies ownership and reconstructs the route.
          const signature=t=>{const p=t?.itineraryDatePlan,g=t?.passengerPricing||{},dates=[p?.canonicalDepartureDate,p?.canonicalReturnDate];return dates.every(Boolean)?JSON.stringify([t.origin?.airportCode||t.origin?.code,(t.cities||[]).map(c=>[c.id||c.cityId||c.airportCode||c.code,c.nights]),...dates,t.budget?.total?.currency,Number(g.adults)||Math.max(1,Number(g.travellers||g.passengers||query.get('passengers'))||1)-Number(g.children||0)-Number(g.infants||0),Number(g.children||0),Number(g.infants||0),Number(g.travellers||g.passengers||query.get('passengers'))||1]):null;};
          const key=signature(tour),matches=trips.filter(t=>t.tripSnapshot?.clientSaveKey===snapshot?.clientSaveKey||(key&&signature(t.tripSnapshot?.tour)===key));if(matches.length===1)tripId=matches[0].tripId;}
        if(!/^[A-Za-z0-9_-]{8,80}$/.test(tripId))throw Error('Save this trip to your account first, then open it from My Trips.');
        const owned=await saved.api.get(tripId);if(!sameOwner()||owned?.tripId!==tripId)throw Error('Saved trip unavailable for this account.');
        const next=await request('/api/account/booking-revalidate','POST',{tripId});if(!sameOwner())throw Error('Account changed. Sign in again.');
        payload=next;result.innerHTML=liveEvidenceHtml(payload,tripId);
      }catch(error){payload=null;result.textContent=error.message||'Live verification unavailable. Saved estimates unchanged.';}
      finally{busy=false;button.disabled=false;button.setAttribute('aria-busy','false');}
    });
    root.setInterval?.(()=>{if(payload){if(!sameOwner()){payload=null;result.textContent='Sign in to view private flight evidence.';}else result.innerHTML=liveEvidenceHtml(payload,tripId);}},1000);
  }

  function render(model,hub,reviewed){
    const transport=model.items.filter(item=>item.kind!=='stay'),stays=model.items.filter(item=>item.kind==='stay'),party=model.party,c=model.confidence;
    const stepper=STEP_LABELS.map((label,index)=>`<button class="gv-workspace-step-button ${index===0?'is-active':''}" type="button" role="tab" aria-selected="${index===0}" aria-controls="gv-workspace-panel-${index+1}" data-workspace-step="${index}"><span>${index+1}</span><b>${esc(label)}</b></button>`).join('');
    const panels=[
      `<section id="gv-workspace-panel-1" class="gv-workspace-panel" role="tabpanel" data-workspace-panel="0"><div class="gv-workspace-panel-head"><div><p class="gv-workspace-kicker">STEP 1 OF 5</p><h2 id="gv-workspace-title">Review your complete trip</h2><p>Confirm the route, dates and traveler setup before opening any partner result.</p></div><span class="gv-workspace-task-badge">${model.items.length} components in order</span></div><div class="gv-workspace-route-list">${model.items.map(item=>compactRow(item,hub)).join('')}</div><div class="gv-workspace-party"><div><small>Adults</small><strong>${party.adults}</strong></div><div><small>Children</small><strong>${party.children}</strong></div><div><small>Travellers</small><strong>${party.travellers}</strong></div><div><small>Rooms</small><strong>${party.rooms}</strong></div></div><div class="gv-workspace-support" data-workspace-support></div>${controls(0)}</section>`,
      `<section id="gv-workspace-panel-2" class="gv-workspace-panel" role="tabpanel" data-workspace-panel="1" hidden><div class="gv-workspace-panel-head"><div><p class="gv-workspace-kicker">STEP 2 OF 5</p><h2>Verify flights and transport</h2><p>Open each current comparison separately. Check airports, schedule, baggage, seller and final price on the partner page.</p></div><span class="gv-workspace-task-badge">${transport.length} transport tasks</span></div>${liveCheckMarkup()}<div class="gv-workspace-item-list">${transport.map(item=>itemCard(item,hub,reviewed)).join('')||'<p>No transport legs are available.</p>'}</div><div class="gv-workspace-boundary"><strong>Reviewed does not mean booked</strong>Globevoy marks a result reviewed only after its partner link is opened. No reservation, order or ticket is created.</div>${controls(1)}</section>`,
      `<section id="gv-workspace-panel-3" class="gv-workspace-panel" role="tabpanel" data-workspace-panel="2" hidden><div class="gv-workspace-panel-head"><div><p class="gv-workspace-kicker">STEP 3 OF 5</p><h2>Verify every stay</h2><p>Confirm property, dates, occupancy, room type, taxes, fees and cancellation terms with the stay partner.</p></div><span class="gv-workspace-task-badge">${stays.length} stay tasks</span></div><div class="gv-workspace-item-list">${stays.map(item=>itemCard(item,hub,reviewed)).join('')||'<p>No destination stays are available.</p>'}</div><div class="gv-workspace-boundary"><strong>Separate stay purchases</strong>Each stay is completed with its external partner. A selected property or search result is not a Globevoy reservation.</div>${controls(2)}</section>`,
      `<section id="gv-workspace-panel-4" class="gv-workspace-panel" role="tabpanel" data-workspace-panel="3" hidden><div class="gv-workspace-panel-head"><div><p class="gv-workspace-kicker">STEP 4 OF 5</p><h2>Understand price confidence</h2><p>See exactly which components are provider-observed, cached, estimated or unavailable before continuing.</p></div><span class="gv-workspace-task-badge">${esc(c.label)}</span></div><div class="gv-workspace-evidence-grid"><article class="gv-workspace-evidence-card"><b>${model.counts.provider}</b><span>Provider-observed components</span></article><article class="gv-workspace-evidence-card"><b>${model.counts.cached}</b><span>Cached observations—not current quotes</span></article><article class="gv-workspace-evidence-card"><b>${model.counts.estimate}</b><span>Planning estimates to verify</span></article><article class="gv-workspace-evidence-card"><b>${model.counts.unavailable}</b><span>Currently unpriced components</span></article></div><div class="gv-workspace-price-explain"><div><strong>${esc(c.totalLabel)}: ${esc(hub.money(c.total,c.currency))}</strong><br>${esc(c.message)}</div><div><strong>Possible remaining costs</strong><br>Baggage, seats, local transfers, taxes, resort fees and partner changes may not be included. Partner selections do not update the Globevoy estimate automatically.</div></div>${controls(3)}</section>`,
      `<section id="gv-workspace-panel-5" class="gv-workspace-panel" role="tabpanel" data-workspace-panel="4" hidden><div class="gv-workspace-panel-head"><div><p class="gv-workspace-kicker">STEP 5 OF 5</p><h2>Continue with booking partners</h2><p>Open partner results in journey order. Complete and pay for each component separately on the partner's website.</p></div><span class="gv-workspace-task-badge" data-workspace-reviewed-label>0 of ${model.actionable.length} reviewed</span></div><div class="gv-workspace-complete-list">${model.items.map((item,index)=>itemCard(item,hub,reviewed,true,index)).join('')}</div><div class="gv-workspace-boundary"><strong>Globevoy stops before checkout</strong>No combined booking, price lock, payment, order, confirmation number or ticket is created here. Recheck every final partner total before purchase.</div>${controls(4)}</section>`
    ].join('');
    return`<nav class="gv-workspace-stepper" role="tablist" aria-label="Guided booking workspace">${stepper}</nav><div class="gv-workspace-layout"><div class="gv-workspace-main">${panels}</div><aside class="gv-workspace-sidebar" aria-label="Persistent trip summary"><details class="gv-workspace-summary" open><summary>Trip summary · ${esc(hub.money(c.total,c.currency))}</summary><div class="gv-workspace-summary-body"><p class="gv-workspace-summary-kicker">YOUR COMPLETE TRIP</p><h2>${esc(model.route[0])} journey</h2><p class="gv-workspace-summary-route">${esc(model.routeText)}</p><p class="gv-workspace-summary-dates">${esc(model.dates)}</p><div class="gv-workspace-summary-money"><div><span>Whole-group budget</span><b>${esc(hub.money(c.budget,c.currency))}</b></div><div class="is-total"><span>${esc(c.totalLabel)}</span><b>${esc(hub.money(c.total,c.currency))}</b></div><div><span>Remaining before extras</span><b>${model.remaining>=0?esc(hub.money(model.remaining,c.currency)):`−${esc(hub.money(Math.abs(model.remaining),c.currency))}`}</b></div></div><div class="gv-workspace-summary-confidence" data-level="${esc(c.level)}"><strong>${esc(c.label)}</strong><span>${esc(c.message)}</span></div><div class="gv-workspace-summary-progress"><p><span>Partner results reviewed</span><b data-workspace-progress-label>0 of ${model.actionable.length}</b></p><div class="gv-workspace-progress-track"><span class="gv-workspace-progress-bar" data-workspace-progress-bar></span></div></div><p class="gv-workspace-summary-note">“Reviewed” means a partner result was opened. It does not mean booked, paid or confirmed.</p></div></details></aside></div>`;
  }

  function storageKey(model,query){const snapshot=String(query.get('snapshot')||'').replace(/[^a-z0-9_-]/gi,'').slice(0,80);return`gv.booking.workspace.686c.reviewed.${snapshot||model.routeText.toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,90)}`;}
  function readReviewed(storage,key){try{const values=JSON.parse(storage?.getItem?.(key)||'[]');return new Set(Array.isArray(values)?values.map(String):[]);}catch(_){return new Set();}}
  function saveReviewed(storage,key,reviewed){try{storage?.setItem?.(key,JSON.stringify([...reviewed]));}catch(_){}}

  function enhance(tour,document,query,hub,confidenceEngine,storage){
    const workspace=document.querySelector('#gv-booking-workspace');if(!tour||!workspace||!hub)return null;
    const model=buildWorkspaceModel(tour,query,hub,confidenceEngine),key=storageKey(model,query),reviewed=readReviewed(storage,key),visited=new Set([0]);
    workspace.innerHTML=render(model,hub,reviewed);workspace.hidden=false;document.body.classList.add('is-workspace-ready');
    const profile=document.querySelector('.gv-booking-profile'),entry=document.querySelector('#gv-entry-section'),support=workspace.querySelector('[data-workspace-support]');if(support){if(profile)support.append(profile);if(entry)support.append(entry);}
    const staysList=document.querySelector('#gv-booking-stays'),legacyStays=staysList?.closest?.('.gv-booking-section');if(legacyStays)legacyStays.dataset.workspaceLegacyStays='true';
    const heroTitle=document.querySelector('#gv-booking-title'),heroCopy=document.querySelector('.gv-booking-hero p'),openButton=document.querySelector('#gv-booking-multicity');if(heroTitle)heroTitle.textContent='Your booking workspace';if(heroCopy)heroCopy.textContent='Review the complete trip, verify current partner results and keep price confidence visible at every step.';
    installLiveCheck(workspace,tour,query);
    let active=0;
    function updateProgress(){const reviewedCount=model.actionable.filter(item=>reviewed.has(item.id)).length,total=model.actionable.length,percent=total?Math.round(reviewedCount/total*100):0;workspace.querySelectorAll('[data-workspace-progress-label]').forEach(node=>node.textContent=`${reviewedCount} of ${total}`);workspace.querySelectorAll('[data-workspace-reviewed-label]').forEach(node=>node.textContent=`${reviewedCount} of ${total} reviewed`);workspace.querySelectorAll('[data-workspace-progress-bar]').forEach(node=>node.style.width=`${percent}%`);workspace.querySelectorAll('[data-workspace-item]').forEach(node=>{const status=node.querySelector('[data-review-status]'),done=reviewed.has(node.dataset.workspaceItem);if(status){status.textContent=done?'Provider result reviewed':'Not reviewed';status.classList.toggle('is-reviewed',done);}});const transport=model.items.filter(item=>item.kind!=='stay'&&safeUrl(item.url)),stays=model.items.filter(item=>item.kind==='stay'&&safeUrl(item.url));if(transport.length&&transport.every(item=>reviewed.has(item.id)))visited.add(1);if(stays.length&&stays.every(item=>reviewed.has(item.id)))visited.add(2);workspace.querySelectorAll('[data-workspace-step]').forEach(button=>button.classList.toggle('is-complete',visited.has(Number(button.dataset.workspaceStep))&&Number(button.dataset.workspaceStep)!==active));}
    function showStep(index,scroll=true){active=Math.max(0,Math.min(4,Number(index)||0));visited.add(active);workspace.querySelectorAll('[data-workspace-panel]').forEach(panel=>panel.hidden=Number(panel.dataset.workspacePanel)!==active);workspace.querySelectorAll('[data-workspace-step]').forEach(button=>{const selected=Number(button.dataset.workspaceStep)===active;button.classList.toggle('is-active',selected);button.setAttribute('aria-selected',String(selected));});updateProgress();if(scroll)workspace.querySelector('.gv-workspace-layout')?.scrollIntoView?.({behavior:root.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});}
    workspace.addEventListener('click',event=>{const partner=event.target.closest?.('[data-partner-review]');if(partner){reviewed.add(String(partner.dataset.partnerReview));saveReviewed(storage,key,reviewed);updateProgress();return;}const step=event.target.closest?.('[data-workspace-step]');if(step){showStep(step.dataset.workspaceStep);return;}if(event.target.closest?.('[data-workspace-next]'))showStep(active+1);else if(event.target.closest?.('[data-workspace-back]'))showStep(active-1);else if(event.target.closest?.('[data-workspace-finish]'))showStep(4);});
    if(openButton){openButton.textContent='Start booking review';openButton.onclick=()=>showStep(0);}
    const copyButton=document.querySelector('#gv-booking-copy-route');if(copyButton)copyButton.textContent='Copy trip summary';
    root.addEventListener?.('keydown',event=>{if(event.key==='Escape'&&active!==0)showStep(0,false);});
    updateProgress();return{model,reviewed,key,showStep,updateProgress};
  }

  function start(){const document=root.document,query=new URLSearchParams(root.location?.search||'');if(!document)return;let ready=false;const run=tour=>{if(ready||!tour)return;ready=true;enhance(tour,document,query,root.GlobevoyBookingHub685D,root.GV_TRUST_685B_BUDGET_CONFIDENCE,root.sessionStorage);};root.addEventListener?.('globevoy:booking-tour-ready',event=>run(event?.detail?.tour));const existing=root.GlobevoyBooking673FR1?.tour;if(existing)run(existing);else{let attempts=0;const timer=root.setInterval?.(()=>{const tour=root.GlobevoyBooking673FR1?.tour;if(tour){root.clearInterval?.(timer);run(tour);}else if(++attempts>80)root.clearInterval?.(timer);},250);}}

  return Object.freeze({VERSION,STEP_LABELS,liveEvidenceHtml,liveCheckMarkup,evidenceBucket,dateRange,buildWorkspaceModel,compactRow,assumptionText,detailMeta,itemCard,render,storageKey,readReviewed,enhance,start});
});
