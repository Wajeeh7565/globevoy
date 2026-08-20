(function(root,factory){
  if(typeof module==='object'&&module.exports){module.exports=factory(require('./automatic-recommender'),require('../multicity-preview/demo-data'));}
  else root.GlobevoyMulticityExplorerApp=factory(root.GlobevoyAutomaticCityRecommender,root.GLOBEVOY_MEHDI_DEMO_DATA);
})(typeof globalThis!=='undefined'?globalThis:this,function(recommender,data){
  'use strict';
  const FLEX_ROUTE_IDS=['lisbon-porto','rome-florence','paris-strasbourg'];
  function rollingMonths(count,now){var d=new Date(now||Date.now());d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+1);var out=[];for(var i=0;i<(count||8);i++){out.push(d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0'));d.setUTCMonth(d.getUTCMonth()+1);}return out;}
  function addDays(dateStr,n){var d=new Date(dateStr+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
  function applyProviderWindow(t,w,pfw){
    var dep=w.departure_at||t.departureDate,ret=w.return_at||t.returnDate;
    var nights=w.nights||(function(){var a=new Date(dep+'T00:00:00Z'),b=new Date(ret+'T00:00:00Z');return Math.round((b-a)/86400000);}());
    t.departureDate=dep;t.returnDate=ret;t.totalNights=nights;t.providerFlexWindows=pfw;
    if(t.stays&&t.stays.length>0){
      var origTotal=t.stays.reduce(function(s,x){return s+(x.nights||0);},0);
      var cursor=0;
      t.stays.forEach(function(stay,i){
        var sn=i===t.stays.length-1?nights-cursor:origTotal>0?Math.max(1,Math.round(stay.nights/origTotal*nights)):Math.floor(nights/t.stays.length);
        stay.checkIn=addDays(dep,cursor);cursor+=sn;stay.checkOut=addDays(dep,cursor);stay.nights=sn;
      });
      if(t.transport&&t.transport.length>0)t.transport.forEach(function(tr,i){if(t.stays[i])tr.date=t.stays[i].checkOut;});
    }
    var raw=w.bookingLink||'',provUrl='';
    if(raw){try{var u=new URL('https://tp.media/r');var aff=((data.affiliateConfig||{}).aviasales)||{};u.searchParams.set('campaign_id',String(aff.campaignId||'100'));u.searchParams.set('marker',String(aff.marker||'725649'));u.searchParams.set('p',String(aff.partnerId||'4114'));u.searchParams.set('trs',String(aff.source||'526085'));u.searchParams.set('u',raw);provUrl=u.toString();}catch(_){provUrl=raw;}}
    var segs;
    if(t.routeId==='lisbon-porto'&&t.cities&&t.cities.length>=2){
      t.anchorRoundTrip=true;
      var c1=t.cities[0].airportCode||'LIS',c2=t.cities[1].airportCode||'OPO';
      var xferDate=t.stays&&t.stays[0]?t.stays[0].checkOut:addDays(dep,Math.floor(nights/2));
      var retXfer=addDays(ret,-1);
      segs=[{origin:t.origin.code,destination:c1,departureDate:dep},{origin:c1,destination:c2,departureDate:xferDate},{origin:c2,destination:c1,departureDate:retXfer},{origin:c1,destination:t.origin.code,departureDate:ret}];
    } else {
      var rc=t.anchorRoundTrip?(t.cities&&t.cities[0]):(t.cities&&t.cities[t.cities.length-1]);
      segs=[{origin:t.origin.code,destination:(t.cities&&t.cities[0]?t.cities[0].airportCode:''),departureDate:dep},{origin:rc?rc.airportCode:t.origin.code,destination:t.origin.code,departureDate:ret}];
    }
    t.flightHandoff=Object.assign({},t.flightHandoff,{segments:segs});
    if(provUrl)t.flightHandoff=Object.assign({},t.flightHandoff,{url:provUrl,status:'provider-backed'});
  }
  function fmtProviderDate(d){if(!d)return '—';const p=String(d).split('-');const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return (M[(+p[1]||1)-1]||'')+' '+(+(p[2]||1));}
  function wrapAffiliate(raw){if(!raw)return '';try{const u=new URL('https://tp.media/r');const aff=((data.affiliateConfig||{}).aviasales)||{};u.searchParams.set('campaign_id',String(aff.campaignId||'100'));u.searchParams.set('marker',String(aff.marker||'725649'));u.searchParams.set('p',String(aff.partnerId||'4114'));u.searchParams.set('trs',String(aff.source||'526085'));u.searchParams.set('u',raw);return u.toString();}catch(_){return raw;}}
  function genericAviasalesUrl(){try{const u=new URL('https://tp.media/r');const aff=((data.affiliateConfig||{}).aviasales)||{};u.searchParams.set('campaign_id',String(aff.campaignId||'100'));u.searchParams.set('marker',String(aff.marker||'725649'));u.searchParams.set('p',String(aff.partnerId||'4114'));u.searchParams.set('trs',String(aff.source||'526085'));u.searchParams.set('u','https://www.aviasales.com/');return u.toString();}catch(_){return '';}}
  function buildAviasalesDeepLink(t){try{const orig=String((t.origin&&t.origin.code)||'').trim();const dest=String((t.cities&&t.cities[0]&&t.cities[0].airportCode)||'').trim();const dep=String(t.departureDate||'').trim();const ret=String(t.returnDate||'').trim();if(!/^[A-Z]{3}$/.test(orig)||!/^[A-Z]{3}$/.test(dest))return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(dep)||!/^\d{4}-\d{2}-\d{2}$/.test(ret))return null;const depD=new Date(dep+'T00:00:00Z'),retD=new Date(ret+'T00:00:00Z');if(isNaN(depD.getTime())||isNaN(retD.getTime())||retD<=depD)return null;const fmt=d=>String(d.getUTCDate()).padStart(2,'0')+String(d.getUTCMonth()+1).padStart(2,'0');const direct='https://www.aviasales.com/search/'+orig+fmt(depD)+dest+fmt(retD)+'1adult';return wrapAffiliate(direct);}catch(_){return null;}}
  function providerFlexHtml(pfw){if(!pfw||!(pfw.windows||[]).length)return '';const curr=String(pfw.currency||'USD').toUpperCase();const rows=(pfw.windows||[]).slice(0,3).map(w=>{const dep=fmtProviderDate(w.departure_at),ret=fmtProviderDate(w.return_at),ps=w.price?curr+' '+Number(w.price).toLocaleString():'';const link=wrapAffiliate(w.bookingLink||'');const cta=link?'<a class="gv-fw-link" href="'+esc(link)+'" target="_blank" rel="noopener sponsored">Confirm on Aviasales →</a>':'<span class="gv-fw-link gv-fw-noop">Check Aviasales manually</span>';return '<div class="gv-fw-row"><span class="gv-fw-dates">'+esc(dep)+'–'+esc(ret)+' ('+(w.nights||'?')+' nights)</span>'+(ps?'<span class="gv-fw-price">'+esc(ps)+'</span>':'')+' '+cta+'</div>';}).join('');return '<div class="gv-flex-windows" aria-label="Cached flight-price observations"><p class="gv-fw-label">Cached flight-price observation · Aviasales via Travelpayouts</p>'+rows+'<p class="gv-fw-note">Provider cache · not a live quote · confirm before booking</p></div>';}
  // GV-DATA-409: Validate a booking URL before putting it into the DOM or passing it to
  // applyProviderWindow. Accepts Aviasales HTTPS URLs and tp.media affiliate links only.
  // Rejects javascript:, data:, http:, unknown hosts, and anything malformed.
  function safeBookingUrl(url){
    if(!url||typeof url!=='string')return '';
    var s=url.trim();
    if(!/^https:\/\//i.test(s))return '';
    try{
      var u=new URL(s);
      if(u.protocol!=='https:')return '';
      var ok=['www.aviasales.com','aviasales.com','tp.media'];
      if(ok.indexOf(u.hostname)<0)return '';
      return s;
    }catch(_){return '';}
  }
  // GV-DATA-409: Build monthly price-calendar grid from fare observations.
  // Returns HTML string. Pure function — no DOM dependencies.
  function buildCalendarGrid(observations,month,currency,selectedDep){
    if(!month||!/^\d{4}-\d{2}$/.test(month))return '<p class="gv-fc-error">Invalid month.</p>';
    const obs=Array.isArray(observations)?observations:[];
    const parts=month.split('-').map(Number);const y=parts[0],m=parts[1];
    if(!y||!m||m<1||m>12)return '<p class="gv-fc-error">Invalid month.</p>';
    const daysInMonth=new Date(Date.UTC(y,m,0)).getUTCDate();
    const firstDOW=new Date(Date.UTC(y,m-1,1)).getUTCDay();
    // Build price map: departure day → cheapest observation
    const priceMap=new Map();const obsMap=new Map();
    for(const o of obs){
      if(!o.departureDate||!o.departureDate.startsWith(month+'-'))continue;
      const d=parseInt(o.departureDate.slice(8,10),10);
      if(o.price>0&&(!priceMap.has(d)||o.price<priceMap.get(d))){priceMap.set(d,o.price);obsMap.set(d,o);}
    }
    // Find cheapest day
    let cheapDay=null,cheapPrice=Infinity;
    for(const [d,p] of priceMap){if(p<cheapPrice){cheapPrice=p;cheapDay=d;}}
    function fmtP(p){try{return new Intl.NumberFormat('en-CA',{style:'currency',currency:currency||'CAD',maximumFractionDigits:0}).format(p);}catch(_){return (currency||'CAD')+' '+Math.round(p);}}
    const DOW=['Su','Mo','Tu','We','Th','Fr','Sa'];
    const thead='<tr>'+DOW.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr>';
    const cells=[];
    for(let i=0;i<firstDOW;i++)cells.push('<td></td>');
    for(let d=1;d<=daysInMonth;d++){
      const dateStr=month+'-'+String(d).padStart(2,'0');
      const hasPrice=priceMap.has(d);
      const p=hasPrice?priceMap.get(d):null;
      const o=obsMap.get(d);
      const isCheap=d===cheapDay;
      const isSel=selectedDep===dateStr;
      const cls=['gv-fc-day',hasPrice?'has-price':'no-price',isCheap?'is-cheapest':'',isSel?'is-selected':''].filter(Boolean).join(' ');
      const label=dateStr+(hasPrice?': '+fmtP(p)+(isCheap?' (cheapest)':''):': no fare');
      const inner='<span class="gv-fc-day-num">'+d+'</span><span class="gv-fc-day-price">'+(hasPrice?esc(fmtP(p)):'—')+'</span>';
      const cell=hasPrice
        ?'<button class="'+cls+'" data-date="'+esc(dateStr)+'" data-return="'+esc((o&&o.returnDate)||'')+'" data-price="'+esc(String(p||0))+'" data-booking="'+esc(safeBookingUrl((o&&o.bookingLink)||''))+'" aria-label="'+esc(label)+'">'+inner+'</button>'
        :'<span class="'+cls+'" aria-label="'+esc(label)+'">'+inner+'</span>';
      cells.push('<td>'+cell+'</td>');
    }
    // Fill trailing blanks to complete the last row
    while(cells.length%7!==0)cells.push('<td></td>');
    const rows=[];
    for(let i=0;i<cells.length;i+=7)rows.push('<tr>'+cells.slice(i,i+7).join('')+'</tr>');
    const cheapNote=cheapDay?'<p class="gv-fc-cheapest-note">Cheapest observation: '+esc(fmtP(cheapPrice))+' departing '+esc(month+'-'+String(cheapDay).padStart(2,'0'))+'</p>':'';
    return cheapNote+'<table class="gv-fc-grid" role="grid" aria-label="Cached fare calendar '+esc(month)+'"><thead>'+thead+'</thead><tbody>'+rows.join('')+'</tbody></table><p class="gv-fc-cal-note">Cached fare observations — not live quotes. Confirm current price and availability on Aviasales before booking.</p>';
  }
  const runtimeRoot=typeof globalThis!=='undefined'?globalThis:(typeof window!=='undefined'?window:{});
  const PREFS=[
    ['history-and-culture','History & culture'],['food','Food'],['beaches','Beaches'],['nightlife','Nightlife'],['nature','Nature'],
    ['relaxation','Relaxation'],['shopping','Shopping'],['family','Family'],['romantic','Romantic'],['adventure','Adventure']
  ];
  function esc(v){return String(v==null?'':v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
  function fmtDate(v){return new Intl.DateTimeFormat('en-CA',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${v}T00:00:00Z`));}
  function money(v,c){return new Intl.NumberFormat(c==='CAD'?'en-CA':c==='AUD'?'en-AU':'en-US',{style:'currency',currency:c,maximumFractionDigits:2}).format(Number(v)||0);}
  function monthLabel(v){if(!/^\d{4}-\d{2}$/.test(v))return v;return new Intl.DateTimeFormat('en-CA',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${v}-01T00:00:00Z`));}
  function transportLabel(v){const x=String(v||'').toLowerCase();return x==='short flight'||x==='regional flight'?'Regional flight':x?x[0].toUpperCase()+x.slice(1):'Unavailable';}
  function sourceLabel(mode){return {'live-exact':'Recently verified','recently-cached':'Recent observation','cached':'Price observation','replay':'Price history estimate','estimated':'Estimated price range','unavailable':'Pricing unavailable'}[mode]||'Planning estimate';}
  function sourceClass(mode){return `source-${String(mode||'estimated').replace(/[^a-z-]/g,'')}`;}
  function itineraryText(t){
    const lines=[];const first=t.cities[0],last=t.cities[t.cities.length-1];
    lines.push(`${t.origin.code} → ${first.airportCode} — ${fmtDate(t.departureDate)}`);
    t.stays.forEach((s,i)=>{lines.push(`${s.city}: ${fmtDate(s.checkIn)} to ${fmtDate(s.checkOut)} (${s.nights} nights)`);if(i<t.transport.length){const x=t.transport[i];lines.push(`${x.from} → ${x.to} — ${fmtDate(x.date)} — ${transportLabel(x.type)} (estimated)`);}});
    const returnCity=t.anchorRoundTrip?first:last;lines.push(`${returnCity.airportCode} → ${t.origin.code} — ${fmtDate(t.returnDate)}`);
    lines.push(`1 adult · economy · ${t.budget.total.currency}`);return lines.join('\n');
  }
  function timeline(t){
    const parts=[];const first=t.cities[0],last=t.cities[t.cities.length-1];
    parts.push(`<li class="gv-mc-segment is-flight"><span>Outbound flight</span><strong>${esc(t.origin.city)} (${esc(t.origin.code)}) → ${esc(first.city)} (${esc(first.airportCode)})</strong><time>${fmtDate(t.departureDate)}</time></li>`);
    t.stays.forEach((s,i)=>{
      parts.push(`<li class="gv-mc-segment is-stay"><span>Stay</span><strong>${esc(s.city)} · ${s.nights} nights</strong><time>${fmtDate(s.checkIn)} – ${fmtDate(s.checkOut)}</time></li>`);
      if(i<t.transport.length){const x=t.transport[i];parts.push(`<li class="gv-mc-segment is-transfer"><span>Intercity · ${esc(transportLabel(x.type))}</span><strong>${esc(x.from)} → ${esc(x.to)}</strong><time>${fmtDate(x.date)}</time><small>Estimated intercity transport — schedule and price require confirmation.</small></li>`);}
    });
    const returnCity=t.anchorRoundTrip?first:last;parts.push(`<li class="gv-mc-segment is-flight"><span>Return flight</span><strong>${esc(returnCity.city)} (${esc(returnCity.airportCode)}) → ${esc(t.origin.city)} (${esc(t.origin.code)})</strong><time>${fmtDate(t.returnDate)}</time></li>`);
    return `<ol class="gv-mc-timeline">${parts.join('')}</ol>`;
  }
  function budgetSummary(t){const b=t.budget;return `<div class="gv-mc-budget-grid">
    <div><span>Estimated core total</span><strong>${money(b.estimatedCoreTotal.amount,b.estimatedCoreTotal.currency)}</strong></div>
    <div><span>10% reserve</span><strong>${money(b.personalReserve.amount,b.personalReserve.currency)}</strong></div>
    <div><span>Usable core budget</span><strong>${money(b.usableCoreBudget.amount,b.usableCoreBudget.currency)}</strong></div>
    <div class="${Number(b.remainingCoreRoom.amount)<0?'is-over':'is-room'}"><span>${Number(b.remainingCoreRoom.amount)<0?'Over usable budget':'Amount remaining'}</span><strong>${money(Math.abs(b.remainingCoreRoom.amount),b.remainingCoreRoom.currency)}</strong></div>
  </div>`;}
  function priceDetails(t){const b=t.budget;return `<dl class="gv-mc-price-details"><div><dt>Flight planning range</dt><dd>${money(b.flightRange.low,b.flightRange.currency)}–${money(b.flightRange.high,b.flightRange.currency)}</dd></div><div><dt>Accommodation estimate</dt><dd>${money(b.accommodation.amount,b.accommodation.currency)}</dd></div><div><dt>Intercity estimate</dt><dd>${money(b.intercity.amount,b.intercity.currency)}</dd></div><div><dt>Price data type</dt><dd>${esc(sourceLabel(t.sourceMode))}</dd></div><div><dt>Planning buffer</dt><dd>${esc(t.planningBuffer&&t.planningBuffer.percentage!=null?t.planningBuffer.percentage+'%':'Not available')}</dd></div></dl>`;}
  function handoffs(t,hasPfw){
    const air=t.flightHandoff.segments.map(s=>`<li><strong>${esc(s.origin)} → ${esc(s.destination)}</strong><span>${fmtDate(s.departureDate)}</span></li>`).join('');
    const stays=t.stayHandoffs.map(s=>`<a class="gv-mc-button is-secondary" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer sponsored">Compare stays · ${esc(s.city)}</a>`).join('');
    let railNote='';
    if(t.anchorRoundTrip&&t.cities&&t.cities.length>=2){
      const anchor=t.cities[0],sec=t.cities[1];
      const railVerb=hasPfw?'confirms':'searches';
      railNote=`<p class="gv-mc-note gv-mc-rail-note">Aviasales ${esc(railVerb)} the round-trip flight between ${esc(t.origin.city)} and ${esc(anchor.city)}. Travel between ${esc(anchor.city)} and ${esc(sec.city)} is arranged separately.</p>`;
    }
    let flightNote,flightAction;
    if(hasPfw){
      flightNote='Cached flight-price observation via Travelpayouts/Aviasales. Confirm exact price and availability before booking.';
      flightAction=`<a class="gv-mc-button is-primary" href="${esc(t.flightHandoff.url)}" target="_blank" rel="noopener noreferrer sponsored">Confirm on Aviasales</a>`;
    }else{
      flightNote='No cached flight fare was found for this route and month. The dates and price below are planning estimates.';
      const deepUrl=buildAviasalesDeepLink(t);
      flightAction=deepUrl?`<a class="gv-mc-button is-secondary" href="${esc(deepUrl)}" target="_blank" rel="noopener noreferrer sponsored">Check flights on Aviasales</a>`:`<p class="gv-mc-note">Flight search could not be prepared automatically for this trip.</p>`;
    }
    return `<div class="gv-mc-handoffs"><section><h5>Flight comparison</h5><ul>${air}</ul><p>1 adult · economy · ${esc(t.flightHandoff.currency)}</p><p class="gv-mc-note">${esc(flightNote)}</p>${railNote}<button type="button" class="gv-mc-copy" data-copy="${esc(itineraryText(t))}">Copy itinerary</button>${flightAction}</section><section><h5>Stay comparison</h5><p>Separate exact-dated searches for one adult and one room.</p><div class="gv-mc-stay-actions">${stays}</div></section></div>`;
  }
  // GV-DATA-409: Per-card fare-calendar section. Only rendered when fareCalendarEnabled=true.
  // The anchor destination (cities[0]) is used; secondary city is never the target.
  function fareCalSection(t,index){
    const dest=esc((t.cities&&t.cities[0]&&t.cities[0].airportCode)||'');
    const origin=esc(t.origin&&t.origin.code||'');
    const month=esc(t.departureDate?t.departureDate.slice(0,7):'');
    const nights=esc(String(t.totalNights||9));
    const currency=esc((t.budget&&t.budget.total&&t.budget.total.currency)||'CAD');
    return `<details class="gv-mc-fare-cal" id="gv-fc-${index}" data-origin="${origin}" data-dest="${dest}" data-month="${month}" data-nights="${nights}" data-currency="${currency}"><summary class="gv-mc-fare-summary">See cheaper nearby dates</summary><div class="gv-fc-inner" aria-live="polite"><p class="gv-fc-loading">Loading fare calendar…</p></div></details>`;
  }
  function renderTour(t,index,opts){
    const nights=t.stays.map(s=>`${s.city} ${s.nights}n`).join(' · ');
    const hasPfw=!!(t.providerFlexWindows&&t.providerFlexWindows.windowCount>0&&(t.providerFlexWindows.windows||[]).length);
    const chipClass=hasPfw?'source-cached':sourceClass(t.sourceMode);
    const chipLabel=hasPfw?'Cached flight-price observation':sourceLabel(t.sourceMode);
    const evidenceHtml=hasPfw?providerFlexHtml(t.providerFlexWindows):priceDetails(t);
    const evidenceNote=hasPfw?'<p class="gv-mc-note">Exact price and availability must be confirmed on Aviasales before booking.</p>':`<p class="gv-mc-note"><strong>${esc(t.budget.flightRange.sourceLabel)}</strong> ${esc(t.exactValidationNotice)}</p>${(t.sourceLimitations||[]).length?`<ul class="gv-mc-limitations">${t.sourceLimitations.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}`;
    const calSect=(opts&&opts.fareCalendarEnabled)?fareCalSection(t,index):'';
    return `<article class="gv-mc-card" data-route-id="${esc(t.routeId)}" data-source-mode="${esc(t.sourceMode)}">
      <header class="gv-mc-card-header"><div><p class="gv-mc-recommendation-label">${esc(t.recommendationLabel||`Recommendation ${index+1}`)}</p><h3>${esc(t.title)}</h3><p class="gv-mc-date-line">${fmtDate(t.departureDate)} – ${fmtDate(t.returnDate)} · ${t.totalNights} nights</p><p class="gv-mc-night-line">${esc(nights)}</p></div><span class="gv-mc-source-chip ${chipClass}">${esc(chipLabel)}</span></header>
      <p class="gv-mc-explanation">${esc(t.recommendationExplanation)}</p><p class="gv-mc-fit">${esc(t.travellerFit)}</p>
      ${budgetSummary(t)}
      <div class="gv-mc-card-actions"><details><summary>See itinerary, pricing and booking steps</summary><div class="gv-mc-detail-grid"><section><h4>Complete itinerary</h4>${timeline(t)}</section><section><h4>Planning evidence</h4>${evidenceHtml}${evidenceNote}</section></div>${handoffs(t,hasPfw)}</details>${calSect}</div>
    </article>`;
  }
  // GV-DATA-410R: Attach lazy-loading, month navigation, and date-selection handlers for
  // fare calendars. Only called in browser context when fareCalendarEnabled is true.
  // Nav controls are rendered BEFORE the API fetch so they are always visible, even when
  // the current month has no observations or the fetch fails.
  // Per-card isolated cache; stale-fetch prevention via renderSerial; body-only updates
  // after the nav is painted.
  function attachCalendarHandlers(host,tours,apiBase){
    var rolling=rollingMonths(12);
    tours.forEach(function(t,i){
      var calEl=host.querySelector('#gv-fc-'+i);
      if(!calEl)return;
      // Build navigable month list. Prepend the tour's departure month if it falls before
      // the rolling window (e.g. June exact-date departure when rolling starts in July).
      // GV-DATA-411R: prefer the live tour departure date over the rendered data-month attribute.
      // If a provider window mutated t.departureDate after fareCalSection rendered the HTML,
      // the attribute may be stale; the tour object is always authoritative.
      var initMonth=(t.departureDate?t.departureDate.slice(0,7):'')||calEl.dataset.month||'';
      var effective=(rolling.indexOf(initMonth)<0&&initMonth&&initMonth<(rolling[0]||''))?[initMonth].concat(rolling):rolling.slice(0);
      var curMonth=initMonth||effective[0]||'';
      var cardCache=new Map(); // cacheKey → observations[]|null
      var renderSerial=0; // incremented each loadMonth call; prevents stale-fetch overwrites
      function monthIdx(m){return effective.indexOf(m);}
      function buildNavHtml(month){
        var idx=monthIdx(month);
        var atMin=idx<=0,atMax=idx>=effective.length-1;
        var prevLabel=idx>0?': '+monthLabel(effective[idx-1]):'';
        var nextLabel=idx<effective.length-1?': '+monthLabel(effective[idx+1]):'';
        return '<div class="gv-fc-nav" role="navigation" aria-label="Fare calendar month navigation">'+
          '<button type="button" class="gv-fc-prev"'+(atMin?' disabled':'')+' aria-label="'+esc('Previous month'+prevLabel)+'">&#8249; Prev</button>'+
          '<span class="gv-fc-month-label">'+esc(monthLabel(month))+'</span>'+
          '<button type="button" class="gv-fc-next"'+(atMax?' disabled':'')+' aria-label="'+esc('Next month'+nextLabel)+'">Next &#8250;</button>'+
          '</div>';
      }
      function attachNavHandlers(inner,month){
        var idx=monthIdx(month);
        var prevBtn=inner.querySelector('.gv-fc-prev');
        var nextBtn=inner.querySelector('.gv-fc-next');
        if(prevBtn&&idx>0)prevBtn.addEventListener('click',function(){curMonth=effective[idx-1];loadMonth(curMonth);});
        if(nextBtn&&idx<effective.length-1)nextBtn.addEventListener('click',function(){curMonth=effective[idx+1];loadMonth(curMonth);});
      }
      function attachDayHandlers(inner,nights,currency){
        var confirmEl=null;
        inner.querySelectorAll('button.gv-fc-day[data-date]').forEach(function(btn){
          btn.addEventListener('click',function(){
            inner.querySelectorAll('button.gv-fc-day').forEach(function(b){b.classList.remove('is-selected');b.removeAttribute('aria-selected');});
            btn.classList.add('is-selected');btn.setAttribute('aria-selected','true');
            var selDep=btn.dataset.date;
            var selRet=btn.dataset.return||addDays(selDep,Number(nights)||9);
            var selPrice=Number(btn.dataset.price||0);
            var selBooking=safeBookingUrl(btn.dataset.booking||'');
            var priceStr=selPrice>0?money(selPrice,currency):'';
            if(!confirmEl){confirmEl=document.createElement('div');confirmEl.className='gv-fc-confirm';inner.appendChild(confirmEl);}
            confirmEl.innerHTML='<p class="gv-fc-selected-dates">Selected: '+esc(fmtDate(selDep))+' – '+esc(fmtDate(selRet))+(priceStr?' · '+esc(priceStr):'')+' <small>(Not applied until you confirm below)</small></p><button class="gv-mc-button is-primary gv-fc-use-dates" data-dep="'+esc(selDep)+'" data-ret="'+esc(selRet)+'" data-booking="'+esc(selBooking)+'">Use these dates</button>';
            confirmEl.querySelector('.gv-fc-use-dates').addEventListener('click',function(){
              var obsWin={departure_at:selDep,return_at:selRet,nights:Math.round((new Date(selRet+'T00:00:00Z')-new Date(selDep+'T00:00:00Z'))/86400000),bookingLink:selBooking||null};
              var pfw=selBooking?{supported:true,windowCount:1,windows:[obsWin]}:null;
              if(pfw){applyProviderWindow(t,obsWin,pfw);}else{t.departureDate=selDep;t.returnDate=selRet;}
              var card=host.querySelector('[data-route-id="'+t.routeId+'"]');
              if(card){
                var dl=card.querySelector('.gv-mc-date-line');if(dl)dl.textContent=fmtDate(t.departureDate)+' – '+fmtDate(t.returnDate)+' · '+t.totalNights+' nights';
                // Update nights count inside explanation text when duration changes (e.g. provider window applies different duration)
                var expl=card.querySelector('.gv-mc-explanation');
                if(expl&&t.totalNights){expl.textContent=expl.textContent.replace(/\b\d+ nights (give|support)/,t.totalNights+' nights $1');}
              }
              if(confirmEl)confirmEl.innerHTML='<p class="gv-fc-confirmed">Dates updated to '+esc(fmtDate(selDep))+' – '+esc(fmtDate(selRet))+'.</p>';
              calEl.open=false;
            });
          });
        });
      }
      async function loadMonth(month){
        var inner=calEl.querySelector('.gv-fc-inner');
        if(!inner)return;
        var mySerial=++renderSerial;
        var orig=calEl.dataset.origin,dest=calEl.dataset.dest,nights=calEl.dataset.nights,currency=calEl.dataset.currency;
        var ck=orig+'|'+dest+'|'+currency+'|'+month+'|'+nights;
        // Step 1: paint nav immediately so controls are visible before the fetch starts
        inner.innerHTML=buildNavHtml(month)+'<div class="gv-fc-body"><p class="gv-fc-loading">Loading fare calendar…</p></div>';
        attachNavHandlers(inner,month);
        // Step 2: fetch (or hit cache)
        var obs;
        if(cardCache.has(ck)){obs=cardCache.get(ck);}
        else{
          try{
            var url=apiBase+'/api/fare-calendar?origin='+encodeURIComponent(orig)+'&destination='+encodeURIComponent(dest)+'&currency='+encodeURIComponent(currency)+'&month='+encodeURIComponent(month)+'&nights='+encodeURIComponent(nights);
            var resp=await fetch(url,{headers:{'Accept':'application/json'}});
            if(!resp.ok)throw new Error('HTTP '+resp.status);
            var d=await resp.json();
            obs=(d&&d.supported&&Array.isArray(d.observations))?d.observations:[];
            cardCache.set(ck,obs);
          }catch(_){obs=null;cardCache.set(ck,null);}
        }
        // Step 3: discard if a newer loadMonth call has already superseded this one
        if(mySerial!==renderSerial)return;
        var body=inner.querySelector('.gv-fc-body');
        if(!body)return;
        // Step 4: update body only — nav stays painted from step 1
        var contentHtml;
        if(obs===null){
          contentHtml='<p class="gv-fc-error">Fare calendar could not be loaded. Try another month.</p>';
        }else if(!obs.length){
          contentHtml='<p class="gv-fc-empty">No cached fare observations were found for this route and month. Try another month.</p>';
        }else{
          var anchorCity=(t.cities&&t.cities[0]&&t.cities[0].city)||calEl.dataset.dest;
          contentHtml='<h5 class="gv-fc-header">Cached fares for '+esc((t.origin&&t.origin.city)||calEl.dataset.origin)+' ↔ '+esc(anchorCity)+'</h5>'+buildCalendarGrid(obs,month,currency,null);
        }
        body.innerHTML=contentHtml;
        attachDayHandlers(inner,nights,currency);
      }
      calEl.addEventListener('toggle',async function(){
        if(!calEl.open)return;
        var inner=calEl.querySelector('.gv-fc-inner');
        if(!inner||inner.dataset.loaded==='true')return;
        inner.dataset.loaded='true';
        await loadMonth(curMonth);
      });
    });
  }
  function renderEmpty(output){
    const HEADINGS={'budget-or-coverage':'Your budget may not cover any of the currently planned routes.','unsupported-date-window':'No planning evidence is available for that date window.','preferences-too-restrictive':'No reviewed trip matched all your preferences for this budget.','duration-too-narrow':'The selected duration range was too narrow to find a match.','no-eligible-route':'No eligible route was found for these settings.'};
    const heading=HEADINGS[output.noResultReason]||'No trip was found for these settings.';
    const note=output.noResultReason==='unsupported-date-window'?'<p>Try selecting "Anytime" to use the best available planning window.</p>':'<p>Nothing was fabricated or silently substituted. Adjust your search to see results.</p>';
    const list=output.suggestions&&output.suggestions.length?`<ul>${output.suggestions.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:'';
    return `<section class="gv-mc-empty"><h3>${esc(heading)}</h3>${note}${list}</section>`;
  }
  function formHtml(months){
    const monthOptions=months.map(m=>`<option value="${m}">${esc(monthLabel(m))}</option>`).join('');
    const durationOptions=['<option value="auto">Let Globevoy choose</option>',...Array.from({length:8},(_,i)=>`<option value="${i+7}">${i+7} nights</option>`)].join('');
    const prefButtons=PREFS.map(([v,l])=>`<button type="button" class="gv-mc-pref" data-preference="${v}" aria-pressed="false">${esc(l)}</button>`).join('');
    return `<div class="gv-mc-shell"><header class="gv-mc-hero"><p>Combination trips</p><h1>Let Globevoy choose your cities</h1><span>We evaluate eligible combinations privately and show only three practical, differentiated trips.</span></header>
      <form id="gv-mc-form" class="gv-mc-form">
        <div class="gv-mc-core-fields"><label>Departure city<select id="gv-mc-origin"><option value="YYZ">Toronto / YYZ</option><option value="NYC">New York / NYC area</option></select></label><label>Total budget<input id="gv-mc-budget" type="number" min="500" step="50" value="5000"></label><label>Currency<select id="gv-mc-currency"><option>CAD</option><option>USD</option><option>AUD</option><option>EUR</option><option>GBP</option></select></label></div>
        <fieldset class="gv-mc-date-modes"><legend>When would you like to travel?</legend><label><input type="radio" name="gv-mc-date-mode" value="anytime" checked><span>Anytime<small>Choose the strongest supported window</small></span></label><label><input type="radio" name="gv-mc-date-mode" value="month"><span>Choose a month<small>Use available planning evidence</small></span></label><label><input type="radio" name="gv-mc-date-mode" value="exact"><span>I know my exact dates<small>Your dates will not be moved</small></span></label></fieldset>
        <div id="gv-mc-month-row" class="gv-mc-conditional" hidden><label>Preferred month<select id="gv-mc-month">${monthOptions}</select></label></div>
        <div class="gv-mc-preferences"><div><strong>What kind of trip would you enjoy?</strong><span>Optional · choose up to three</span></div><button type="button" class="gv-mc-pref is-active" data-preference="none" aria-pressed="true">No preference — choose the best overall trip</button><div class="gv-mc-pref-grid">${prefButtons}</div><p id="gv-mc-pref-message" aria-live="polite"></p></div>
        <details class="gv-mc-advanced"><summary>Advanced options</summary><div><label>Duration<select id="gv-mc-duration">${durationOptions}</select></label><label>Preferred minimum<select id="gv-mc-min">${Array.from({length:8},(_,i)=>`<option value="${i+7}">${i+7} nights</option>`).join('')}</select></label><label>Preferred maximum<select id="gv-mc-max">${Array.from({length:8},(_,i)=>`<option value="${i+7}" ${i===7?'selected':''}>${i+7} nights</option>`).join('')}</select></label><label class="gv-mc-exact-field" hidden>Exact departure<input id="gv-mc-departure" type="date"></label><label class="gv-mc-exact-field" hidden>Exact return<input id="gv-mc-return" type="date"></label></div></details>
        <button class="gv-mc-submit" type="submit">Build my trip</button>
      </form><div id="gv-mc-status" class="gv-mc-status" role="status" aria-live="polite"></div><div id="gv-mc-results" class="gv-mc-results"></div></div>`;
  }
  function applyInitial(host,initial){if(!initial)return;const set=(id,v)=>{const e=host.querySelector(id);if(e&&v!=null&&v!=='')e.value=v;};set('#gv-mc-origin',initial.originCode);set('#gv-mc-budget',initial.totalBudget);set('#gv-mc-currency',initial.currency);set('#gv-mc-duration',initial.totalNights);set('#gv-mc-min',initial.minimumNights);set('#gv-mc-max',initial.maximumNights);if(initial.dateMode){const r=host.querySelector(`input[name="gv-mc-date-mode"][value="${initial.dateMode}"]`);if(r)r.checked=true;}set('#gv-mc-month',initial.preferredMonth);set('#gv-mc-departure',initial.exactDepartureDate);set('#gv-mc-return',initial.exactReturnDate);if(Array.isArray(initial.preferences)&&initial.preferences.length){const none=host.querySelector('[data-preference="none"]');if(none){none.classList.remove('is-active');none.setAttribute('aria-pressed','false');}for(const pref of initial.preferences.slice(0,3)){const b=host.querySelector(`[data-preference="${pref}"]`);if(b){b.classList.add('is-active');b.setAttribute('aria-pressed','true');}}}}
  // GV-DATA-410R: Origin/destination code normalisation for provider-response validation.
  // Matches the canonical ANCHOR_CODE_MAP in the backend flexible-dates service.
  var ORIGIN_EQUIV={'YYZ':'YTO','YTO':'YTO','NYC':'NYC','JFK':'NYC','EWR':'NYC'};
  var DEST_EQUIV={'CDG':'PAR','PAR':'PAR','FCO':'ROM','ROM':'ROM','LIS':'LIS','OPO':'OPO'};
  function normOriginCode(c){var u=String(c||'').toUpperCase();return ORIGIN_EQUIV[u]||u;}
  function normDestCode(c){var u=String(c||'').toUpperCase();return DEST_EQUIV[u]||u;}
  // GV-DATA-410R: Validate a flex-windows provider response against the actual tour before
  // calling applyProviderWindow. Rejects mismatched origin, destination, or currency so that
  // a NYC/USD Paris provider window is never applied to a Toronto/CAD tour.
  // GV-DATA-411R: Optional 4th param selectedMonth. When provided (month-mode searches),
  // also rejects any response that has no windows departing within that month, preventing
  // November/December provider windows from being applied to January searches.
  function providerWindowMatchesTour(t,pfw,selectedCurrency,selectedMonth){
    if(!pfw||!t)return false;
    // Currency must match the traveller's selected currency
    if(pfw.currency&&String(pfw.currency).toUpperCase()!==String(selectedCurrency||'').toUpperCase())return false;
    // Origin must match (YYZ ≡ YTO for Toronto routes)
    if(pfw.origin){
      var tourOrigin=normOriginCode(t.origin&&t.origin.code||'');
      var pfwOrigin=normOriginCode(pfw.origin);
      if(pfwOrigin!==tourOrigin)return false;
    }
    // Destination must match the tour anchor city (CDG ≡ PAR, FCO ≡ ROM)
    if(pfw.destination&&t.cities&&t.cities[0]&&t.cities[0].airportCode){
      var tourDest=normDestCode(t.cities[0].airportCode);
      var pfwDest=normDestCode(pfw.destination);
      if(pfwDest!==tourDest)return false;
    }
    // GV-DATA-411R: reject the entire provider response when no window departs in selectedMonth
    if(selectedMonth){
      var monthWindows=(pfw.windows||[]).filter(function(w){
        return w&&w.departure_at&&String(w.departure_at).slice(0,7)===selectedMonth;
      });
      if(!monthWindows.length)return false;
    }
    return true;
  }
  function mount(host,options={}){
    if(host.dataset.mounted==='true')return;host.dataset.mounted='true';const months=rollingMonths(8);host.innerHTML=formHtml(months);applyInitial(host,options.initialInput);
    const form=host.querySelector('#gv-mc-form'),status=host.querySelector('#gv-mc-status'),results=host.querySelector('#gv-mc-results'),origin=host.querySelector('#gv-mc-origin'),currency=host.querySelector('#gv-mc-currency');
    const flags=options.flags||runtimeRoot.GLOBEVOY_EXPERIMENT_FLAGS||{};
    function selectedPrefs(){return [...host.querySelectorAll('.gv-mc-pref.is-active[data-preference]:not([data-preference="none"])')].map(x=>x.dataset.preference);}
    function updateConditional(){const mode=host.querySelector('input[name="gv-mc-date-mode"]:checked').value;host.querySelector('#gv-mc-month-row').hidden=mode!=='month';host.querySelectorAll('.gv-mc-exact-field').forEach(x=>x.hidden=mode!=='exact');}
    host.querySelectorAll('input[name="gv-mc-date-mode"]').forEach(x=>x.addEventListener('change',updateConditional));updateConditional();
    origin.addEventListener('change',()=>{currency.value=origin.value==='YYZ'?'CAD':'USD';});
    host.querySelectorAll('.gv-mc-pref').forEach(btn=>btn.addEventListener('click',()=>{const none=btn.dataset.preference==='none';const active=selectedPrefs();if(none){host.querySelectorAll('.gv-mc-pref').forEach(x=>{x.classList.toggle('is-active',x===btn);x.setAttribute('aria-pressed',x===btn?'true':'false');});}else{const no=host.querySelector('[data-preference="none"]');no.classList.remove('is-active');no.setAttribute('aria-pressed','false');if(btn.classList.contains('is-active')){btn.classList.remove('is-active');btn.setAttribute('aria-pressed','false');}else if(active.length<3){btn.classList.add('is-active');btn.setAttribute('aria-pressed','true');}else{host.querySelector('#gv-mc-pref-message').textContent='You have selected three interests. Deselect one to change your selection.';}if(selectedPrefs().length===0){no.classList.add('is-active');no.setAttribute('aria-pressed','true');}}}));
    host.addEventListener('click',async e=>{const b=e.target.closest('.gv-mc-copy');if(!b)return;const text=b.dataset.copy||'';try{await navigator.clipboard.writeText(text);b.textContent='Copied';}catch(_){const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();b.textContent='Copied';}setTimeout(()=>b.textContent='Copy itinerary',1300);});
    async function run(ev){if(ev)ev.preventDefault();status.className='gv-mc-status is-loading';status.textContent='Evaluating eligible routes, travel windows and city combinations…';results.innerHTML='';await new Promise(r=>setTimeout(r,60));
      try{const dateMode=host.querySelector('input[name="gv-mc-date-mode"]:checked').value;const selectedMonth=host.querySelector('#gv-mc-month').value;
      // GV-DATA-410R2: never silently downgrade the traveller's date-mode. The selected month
      // is authoritative even when it has no replay observation; the optimizer derives
      // deterministic planning dates from the nearest available window.
      const resolvedDateMode=dateMode;
      const output=recommender.recommend({originCode:origin.value,totalBudget:Number(host.querySelector('#gv-mc-budget').value),currency:currency.value,dateMode:resolvedDateMode,preferredMonth:selectedMonth,totalNights:host.querySelector('#gv-mc-duration').value,minimumNights:host.querySelector('#gv-mc-min').value,maximumNights:host.querySelector('#gv-mc-max').value,exactDepartureDate:host.querySelector('#gv-mc-departure').value,exactReturnDate:host.querySelector('#gv-mc-return').value,preferences:selectedPrefs()},data,flags);runtimeRoot.__GLOBEVOY_MULTICITY_EXPLORER_RESULT__=output;runtimeRoot.__GLOBEVOY_MULTICITY_EXPLORER_ERROR__=null;
      const cfg=runtimeRoot.GLOBEVOY_CONFIG||{};const apiBase=cfg.enableLiveApi&&cfg.apiBaseUrl?String(cfg.apiBaseUrl):'';
      // GV-DATA-410R: exact-date mode — never auto-apply provider windows; traveller's dates
      // are authoritative and must not be changed by a flex-windows response.
      // Non-exact modes: apply only when origin, destination and currency all match the tour.
      if(apiBase&&output.tours&&output.tours.length&&resolvedDateMode!=='exact'){await Promise.allSettled(output.tours.map(async t=>{if(!FLEX_ROUTE_IDS.includes(t.routeId))return;const fetchMonth=dateMode==='month'?selectedMonth:(t.departureDate?t.departureDate.slice(0,7):'');if(!fetchMonth)return;try{const r=await fetch(apiBase+'/api/flex-windows?routeId='+encodeURIComponent(t.routeId)+'&month='+encodeURIComponent(fetchMonth),{headers:{'Accept':'application/json'}});if(!r.ok)return;const pfw=await r.json();
        // GV-DATA-411R: pass fetchMonth so providerWindowMatchesTour rejects windows whose
        // departure_at falls outside the selected month (prevents Nov window on Jan search).
        if(pfw&&pfw.supported&&pfw.windowCount>0&&(pfw.windows||[]).length&&providerWindowMatchesTour(t,pfw,currency.value,fetchMonth)){
          // Apply the first window that departs within fetchMonth, not unconditionally windows[0].
          var winToApply=fetchMonth?(pfw.windows||[]).find(function(w){return w&&w.departure_at&&String(w.departure_at).slice(0,7)===fetchMonth;})||pfw.windows[0]:pfw.windows[0];
          applyProviderWindow(t,winToApply,pfw);
        }}catch(_){};}));}
      const calOpts={fareCalendarEnabled:!!flags.fareCalendarEnabled};
      status.className='gv-mc-status';status.innerHTML=`<strong>${esc(output.summary)}</strong><span>${esc(output.limitation)}</span>`;results.innerHTML=output.tours.length?output.tours.map((t,i)=>renderTour(t,i,calOpts)).join(''):renderEmpty(output);
      const selectedOrigin=origin.options[origin.selectedIndex]?origin.options[origin.selectedIndex].text.split('/')[0].trim():origin.value;
      const contextSymbols={CAD:'C$',USD:'$',AUD:'A$',EUR:'€',GBP:'£'};const contextAmount=Number(host.querySelector('#gv-mc-budget').value).toLocaleString('en-CA',{maximumFractionDigits:0});
      const context=selectedOrigin+' · '+(contextSymbols[currency.value]||'')+contextAmount+' '+currency.value;
      runtimeRoot.dispatchEvent(new CustomEvent('globevoy:multicity-results',{detail:{count:output.tours.length,context}}));
      if(flags.fareCalendarEnabled&&apiBase&&output.tours&&output.tours.length){attachCalendarHandlers(host,output.tours,apiBase);}
      }catch(error){runtimeRoot.__GLOBEVOY_MULTICITY_EXPLORER_ERROR__=error.message;status.className='gv-mc-status is-error';status.textContent=error.message;results.innerHTML='';}}
    form.addEventListener('submit',run);run();runtimeRoot.__GLOBEVOY_MULTICITY_EXPLORER_RUN__=run;
  }
  return {mount,itineraryText,rollingMonths,applyProviderWindow,genericAviasalesUrl,buildAviasalesDeepLink,buildCalendarGrid,safeBookingUrl,providerWindowMatchesTour};
});
