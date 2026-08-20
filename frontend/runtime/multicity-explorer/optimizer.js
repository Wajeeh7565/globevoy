(function(root,factory){
  if(typeof module==='object'&&module.exports){
    module.exports=factory(
      require('../multicity-preview/engine'),
      require('../multicity-preview/demo-data'),
      require('./source-status-browser'),
      require('./flexible-date-windows')
    );
  }else{
    root.GlobevoyFlexibleDurationOptimizer=factory(
      root.GlobevoyMehdiEngine,
      root.GLOBEVOY_MEHDI_DEMO_DATA,
      root.GlobevoyMulticitySourceStatus,
      root.GlobevoyFlexibleDateWindows
    );
  }
})(typeof globalThis!=='undefined'?globalThis:this,function(engine,defaultData,statusApi,discoveryWindows){
  'use strict';
  const MIN_PUBLIC_NIGHTS=7;
  const MAX_PUBLIC_NIGHTS=14;
  const SUPPORTED_ORIGINS=['YYZ','NYC'];
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

  function round2(v){ return Math.round((Number(v)+Number.EPSILON)*100)/100; }
  function dateDiff(a,b){ return Math.round((Date.parse(`${b}T00:00:00Z`)-Date.parse(`${a}T00:00:00Z`))/86400000); }
  function addDays(iso,n){ const d=new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+Number(n)); return d.toISOString().slice(0,10); }
  function validDate(v){ if(!DATE_RE.test(String(v||''))) return false; const d=new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v; }
  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function sourcePolicy(mode){ return statusApi.policy(mode); }

  function normalizeRequest(raw,data){
    const originCode=String(raw.originCode||'YYZ').toUpperCase();
    if(!SUPPORTED_ORIGINS.includes(originCode)) throw new Error('Origin must be Toronto/YYZ or New York/NYC.');
    const origin=(data.origins||[]).find(o=>o.code===originCode);
    if(!origin) throw new Error('Selected origin is unavailable.');
    const totalBudget=Number(raw.totalBudget);
    if(!Number.isFinite(totalBudget)||totalBudget<=0) throw new Error('A positive total budget is required.');
    const currency=String(raw.currency||'CAD').toUpperCase();
    if(!(data.supportedCurrencies||[]).includes(currency)) throw new Error('Unsupported currency.');
    const preferredMonth=String(raw.preferredMonth||'');
    if(!/^\d{4}-\d{2}$/.test(preferredMonth)) throw new Error('A valid travel month is required (YYYY-MM).');
    // GV-DATA-410R2: removed the "month must be in replay data" guard.
    // nearestBaseWindow now falls back to any origin-matching window for cost estimation,
    // so any valid YYYY-MM is accepted — including months without replay observations.
    const minNights=raw.minimumNights===''||raw.minimumNights==null?MIN_PUBLIC_NIGHTS:Number(raw.minimumNights);
    const maxNights=raw.maximumNights===''||raw.maximumNights==null?MAX_PUBLIC_NIGHTS:Number(raw.maximumNights);
    if(!Number.isInteger(minNights)||!Number.isInteger(maxNights)||minNights<MIN_PUBLIC_NIGHTS||maxNights>MAX_PUBLIC_NIGHTS||minNights>maxNights){
      throw new Error('Preferred duration range must stay between 7 and 14 nights.');
    }
    const requested=raw.totalNights==null||raw.totalNights===''||raw.totalNights==='auto'?'auto':Number(raw.totalNights);
    if(requested!=='auto'&&(!Number.isInteger(requested)||requested<MIN_PUBLIC_NIGHTS||requested>MAX_PUBLIC_NIGHTS)) throw new Error('Trip duration must be 7–14 nights or Let Globevoy choose.');
    const departure=String(raw.exactDepartureDate||'').trim();
    const returning=String(raw.exactReturnDate||'').trim();
    if(Boolean(departure)!==Boolean(returning)) throw new Error('Enter both exact departure and return dates, or leave both blank.');
    let exactNights=null;
    if(departure){
      if(!validDate(departure)||!validDate(returning)) throw new Error('Exact dates must be valid ISO dates.');
      exactNights=dateDiff(departure,returning);
      if(exactNights<=0) throw new Error('Return date must be after departure date.');
      if(exactNights<MIN_PUBLIC_NIGHTS) throw new Error('Exact date range must be at least 7 nights.');
      if(exactNights>MAX_PUBLIC_NIGHTS) throw new Error('Exact date range must be no more than 14 nights.');
      if(requested!=='auto'&&requested!==exactNights) throw new Error('Exact dates conflict with the selected duration.');
      if(exactNights<minNights||exactNights>maxNights) throw new Error('Exact dates fall outside the preferred duration range.');
    }
    return {
      originCode,originCity:origin.city,totalBudget:round2(totalBudget),currency,preferredMonth,
      totalNights:requested,minimumNights:minNights,maximumNights:maxNights,
      exactDepartureDate:departure||null,exactReturnDate:returning||null,exactNights,
      dateSelectionMode:departure?'exact-user-dates':'month-first',adults:1,cabin:'economy'
    };
  }

  function discoveryWindowFor(routeId,input,duration){
    if(input.exactDepartureDate) return (discoveryWindows||[]).find(w=>w.routeId===routeId&&w.origin===input.originCode&&w.totalNights===duration&&w.candidateOutboundDate===input.exactDepartureDate&&w.candidateReturnDate===input.exactReturnDate)||null;
    return (discoveryWindows||[]).find(w=>w.routeId===routeId&&w.origin===input.originCode&&w.month===input.preferredMonth&&w.totalNights===duration)||null;
  }

  function nearestBaseWindow(route,input,duration){
    // GV-DATA-410R2: prefer an exact-month match; fall back to any origin-matching window
    // so months outside the replay dataset (e.g. August) still receive cost estimates.
    const all=(route.windows||[]).filter(w=>w.origin===input.originCity);
    if(!all.length) return null;
    const monthMatch=all.filter(w=>w.preferredMonth===input.preferredMonth);
    const pool=monthMatch.length?monthMatch:all;
    return [...pool].sort((a,b)=>Math.abs(a.totalNights-duration)-Math.abs(b.totalNights-duration)||a.totalNights-b.totalNights)[0];
  }

  function makeWindow(route,input,duration,data){
    const base=nearestBaseWindow(route,input,duration);
    if(!base) return null;
    const discovery=discoveryWindowFor(route.routeId,input,duration);
    let departureDate=input.exactDepartureDate;
    let returnDate=input.exactReturnDate;
    let mode='estimated';
    let evidenceType='reviewed-estimate-fallback';
    let outboundUsd;
    let returnUsd;
    let evidence=null;
    if(!departureDate&&discovery){
      departureDate=discovery.candidateOutboundDate;
      returnDate=discovery.candidateReturnDate;
      mode=discovery.sourceMode;
      evidenceType='flexible-date-discovery';
      evidence=discovery;
      const displayRate=Number(data.displayCurrencyPerUsd[discovery.currency]||1);
      const combinedUsd=Number(discovery.bufferedPlanningEstimate.amount)/displayRate;
      const baseTotal=Number(base.outboundFlightEstimateUsd)+Number(base.returnFlightEstimateUsd);
      const outboundRatio=baseTotal>0?Number(base.outboundFlightEstimateUsd)/baseTotal:0.5;
      outboundUsd=round2(combinedUsd*outboundRatio);
      returnUsd=round2(combinedUsd-outboundUsd);
    }else{
      if(!departureDate){
        // Non-exact mode: derive departure from base window, but if the base window belongs
        // to a different month (e.g. Oct replay used for an August search), synthesise a
        // deterministic planning date inside the selected month so the tour's visible dates
        // match the traveller's intent. Day 10 is used as the anchor to keep trips within
        // the month for all allowed durations.
        if(input.preferredMonth&&base.departureDate.slice(0,7)!==input.preferredMonth){
          departureDate=input.preferredMonth+'-10';
          evidenceType='reviewed-estimate-fallback';
        }else{
          departureDate=base.departureDate;
        }
        returnDate=addDays(departureDate,duration);
      }else{
        // Exact-date mode: user dates take full authority.
        returnDate=returnDate||addDays(departureDate,duration);
        if(input.exactDepartureDate&&discovery){
          mode=discovery.sourceMode;
          evidenceType='exact-date-replay-observation';
          evidence=discovery;
        }
      }
      const scale=1+Math.abs(Number(base.totalNights)-duration)*0.015;
      outboundUsd=round2(Number(base.outboundFlightEstimateUsd)*scale);
      returnUsd=round2(Number(base.returnFlightEstimateUsd)*scale);
    }
    if(dateDiff(departureDate,returnDate)!==duration) return null;
    const policy=sourcePolicy(mode);
    return {
      fixtureId:`flex-${route.routeId}-${input.originCode.toLowerCase()}-${duration}n`,
      origin:input.originCity,preferredMonth:departureDate.slice(0,7),departureDate,returnDate,totalNights:duration,
      outboundFlightEstimateUsd:outboundUsd,returnFlightEstimateUsd:returnUsd,
      intercityTransportEstimateUsd:Number(base.intercityTransportEstimateUsd),
      fixtureLabel:evidenceType,
      __sourceMeta:{
        sourceMode:mode,evidenceType,observedTimestamp:evidence&&evidence.observedTimestamp||null,
        ageHours:evidence&&evidence.ageHours!=null?evidence.ageHours:null,
        confidence:evidence&&evidence.confidence||policy.confidence,
        planningBuffer:evidence&&evidence.planningBuffer||{rate:policy.planningBufferRate,percentage:policy.planningBufferRate==null?null:policy.planningBufferRate*100,explanation:'Globevoy planning contingency; not a provider fee or fare component.'},
        limitations:[...policy.limitations,...(evidence&&evidence.limitations||[]),evidenceType==='reviewed-estimate-fallback'?'No matching cached/replay discovery window was available; reviewed planning fixtures were used without claiming availability.':''],
        isLive:policy.isLive,isBookable:policy.isBookable,exactValidationRequired:policy.exactValidationRequired,
        isCurrentAvailabilityProven:policy.isCurrentAvailabilityProven,openJawCoverage:evidence&&evidence.openJawCoverage||'planning-estimate-only'
      }
    };
  }

  function prepareData(input,duration,data){
    const prepared=clone(data);
    prepared.replayIndex={};
    prepared.routes=prepared.routes.filter(route=>!(duration<=8&&route.citySequence.length>2)).map(route=>{
      const w=makeWindow(route,input,duration,data);
      return {...route,windows:w?[w]:[]};
    }).filter(route=>route.windows.length);
    return prepared;
  }

  function sourceMap(prepared){
    return new Map(prepared.routes.map(r=>[r.routeId,r.windows[0].__sourceMeta]));
  }

  function enrichTour(tour,meta,input){
    const policy=sourcePolicy(meta.sourceMode);
    tour.sourceStatus=meta.sourceMode;
    tour.sourceMode=meta.sourceMode;
    tour.sourceLabel=policy.label;
    tour.isLive=meta.isLive;
    tour.isBookable=meta.isBookable;
    tour.exactValidationRequired=meta.exactValidationRequired;
    tour.isCurrentAvailabilityProven=meta.isCurrentAvailabilityProven;
    tour.observedTimestamp=meta.observedTimestamp;
    tour.ageHours=meta.ageHours;
    tour.planningBuffer=meta.planningBuffer;
    tour.sourceLimitations=meta.limitations.filter(Boolean);
    tour.dateSelectionSource=meta.evidenceType;
    tour.dateSelectionMode=input.dateSelectionMode;
    tour.exactValidationNotice='Current prices and availability must be checked on the partner site before booking.';
    tour.budget.flightRange.sourceStatus=meta.sourceMode;
    tour.budget.flightRange.sourceLabel=policy.label;
    tour.budget.flightRange.confidence=meta.confidence;
    tour.budget.flightRange.limitations=meta.limitations.filter(Boolean);
    tour.budget.flightRange.isLive=meta.isLive;
    tour.budget.flightRange.isBookable=meta.isBookable;
    tour.budget.flightRange.exactValidationRequired=meta.exactValidationRequired;
    tour.budget.flightRange.isCurrentAvailabilityProven=meta.isCurrentAvailabilityProven;
    tour.budget.flightRange.observedTimestamp=meta.observedTimestamp;
    tour.budget.flightRange.ageHours=meta.ageHours;
    tour.budget.flightRange.planningBuffer=meta.planningBuffer;
    tour.priceWarning=policy.label;
    tour.comparisonNote='Current prices and availability must be checked on the flight comparison site.';
    return tour;
  }

  function runDuration(input,duration,data){
    const prepared=prepareData(input,duration,data);
    const sources=sourceMap(prepared);
    const output=engine.generateTours({
      originCode:input.originCode,totalBudget:input.totalBudget,currency:input.currency,
      preferredMonth:input.exactDepartureDate?input.exactDepartureDate.slice(0,7):input.preferredMonth,totalNights:duration,flexibleDates:false
    },prepared);
    output.tours=output.tours.map(t=>enrichTour(t,sources.get(t.routeId),input));
    output.input={...output.input,requestedDuration:input.totalNights,dateSelectionMode:input.dateSelectionMode,
      exactDepartureDate:input.exactDepartureDate,exactReturnDate:input.exactReturnDate};
    output.durationEvaluated=duration;
    return output;
  }

  function chooseDiverse(candidates,maxResults){
    const sorted=[...candidates].sort((a,b)=>b.score-a.score);
    const selected=[]; const anchors=new Set(); const countries=new Map();
    function add(c){
      if(!c||anchors.has(c.group1Anchor)) return false;
      const country=c.cities[0].country;
      if((countries.get(country)||0)>=2) return false;
      selected.push(c); anchors.add(c.group1Anchor); countries.set(country,(countries.get(country)||0)+1); return true;
    }
    add(sorted.find(c=>c.category==='familiar'));
    add(sorted.find(c=>c.category==='discovery'&&!anchors.has(c.group1Anchor)));
    add(sorted.find(c=>c.category==='balanced'&&!anchors.has(c.group1Anchor)));
    for(const c of sorted.filter(x=>x.category==='discovery')){ if(selected.length>=maxResults) break; add(c); }
    for(const c of sorted){ if(selected.length>=maxResults) break; add(c); }
    return selected.slice(0,maxResults).sort((a,b)=>b.score-a.score);
  }

  function ensureAllowedDurations(){
    for(let n=MIN_PUBLIC_NIGHTS;n<=MAX_PUBLIC_NIGHTS;n+=1){ if(!engine.ALLOWED_NIGHTS.includes(n)) engine.ALLOWED_NIGHTS.push(n); }
  }

  function optimize(raw,dataOverride){
    const data=dataOverride||defaultData;
    ensureAllowedDurations();
    const input=normalizeRequest(raw,data);
    const durations=input.exactNights?[input.exactNights]:input.totalNights==='auto'
      ?Array.from({length:input.maximumNights-input.minimumNights+1},(_,i)=>input.minimumNights+i)
      :[input.totalNights];
    const results=durations.map(n=>runDuration(input,n,data));
    if(durations.length===1){
      const single=results[0];
      single.optimizer={mode:input.totalNights==='auto'?'auto-exact-dates':'fixed',durationsEvaluated:durations,selectedTourDurations:single.tours.map(t=>t.totalNights)};
      return single;
    }
    const bestByRoute=new Map();
    for(const result of results){
      for(const tour of result.tours){
        const current=bestByRoute.get(tour.routeId);
        if(!current||tour.score>current.score) bestByRoute.set(tour.routeId,tour);
      }
    }
    const pool=[...bestByRoute.values()];
    const count=pool.length>=4?4:pool.length;
    const tours=chooseDiverse(pool,count);
    const totalEvaluated=results.reduce((s,r)=>s+r.diagnostics.dateWindowsEvaluated,0);
    return {
      status:tours.length>=3?'ready':tours.length?'limited-results':'no-tours-found',
      warning:'These are planning estimates based on price history. Current prices must be checked on partner sites before booking.',
      input:{...input,selectedDurationMode:'auto'},
      budgetPolicy:{personalExpenseReservePercent:0.10,usableCoreBudgetPercent:0.90},
      diagnostics:{durationOptionsEvaluated:durations.length,durationsEvaluated:durations,dateWindowsEvaluated:totalEvaluated,candidateRoutesAcrossDurations:pool.length,returnedTourCount:tours.length},
      candidatePoolSize:pool.length,tours,
      explanation:tours.length?`Evaluated ${durations.length} supported durations and returned ${tours.length} strong, diverse tours.`:'No reviewed route met the selected month, duration range and usable budget.',
      optimizer:{mode:'auto',durationsEvaluated:durations,selectedTourDurations:tours.map(t=>t.totalNights)}
    };
  }

  return {MIN_PUBLIC_NIGHTS,MAX_PUBLIC_NIGHTS,normalizeRequest,optimize,runDuration,addDays,dateDiff};
});
