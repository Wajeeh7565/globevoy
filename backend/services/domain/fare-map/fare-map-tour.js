'use strict';
// The fare-map search path: plan routes from the stored fares (fare-map-optimizer), then
// live-check the best ones (Ignav flights, Nuitee hotels) and build the page tour.
// Moved out of tours/generated-tour.js without behaviour changes; the tour builder,
// final hotel pass and feature switch are passed in by the caller.
const { evaluateTour } = require('../routing/route-feasibility');
const { recommendationEligibility } = require('../eligibility/travel-entry-eligibility');
const { normalizeParty } = require('../pricing/traveller-pricing');
const { applyIgnavLiveFares } = require('../live-fares/ignav-live-fares');
const { attachTourPresentation } = require('../pricing/budget-presentation');

async function getFareMapGeneratedTour(query,options,deps) {
  const {buildVisualizerTour,priceFinalTourWithNuitee,generatedTourEnabled}=deps;
  const optimizer=require('../fare-map/fare-map-optimizer');
  if(!generatedTourEnabled())return {ok:true,supported:false,reason:'feature-disabled',tour:null,tours:[]};
  const result=await optimizer.search(query,options.fareMap||options);
  const empty=reason=>({...result,tour:null,tours:[],reason});
  if(!result.tours.length)return {...result,tour:null};
  let selected=result.tours[0],arrivalVerified=false;
  const diagnostics={...result.diagnostics};
  // Live-check the cheapest trip; if live prices or dates rule it out, try the next
  // fare-map trip once before giving up (each check is a few provider calls).
  const attempt=async(candidateTour)=>{
  let selected=candidateTour,arrivalVerified=false;const fail=reason=>({reason});
  // Reuse the existing gated adapter ONCE, on the selected itinerary, never during expansion.
  const ignav=require('../../providers/flights/ignav/ignav');
  if(ignav.configured(options.env||process.env)){
    let checked;
    try{checked=await (options.applyIgnavLiveFares||applyIgnavLiveFares)(selected,query,options)}
    catch{checked={summary:{applied:false,reason:'provider-unavailable'}}}
    diagnostics.ignavLiveFares=checked?.summary||{applied:false,reason:'provider-invalid-response'};
    if(checked?.summary?.applied&&checked.summary.partial){
      // Some legs live, some estimated: keep the live legs, but without every arrival
      // time the hotel nights cannot be re-dated, so stays remain planning estimates.
      const repriced=checked.tour;
      if(repriced?.legs?.length===selected.legs.length&&repriced.legs.every((l,i)=>l.departureDate===selected.legs[i].departureDate)){
        selected=attachTourPresentation(repriced,query);
        if(selected.estimatedTotalUsd>selected.usableTripBudgetUsd)return fail('fare-map-live-total-exceeds-protected-budget');
      }
    } else if(checked?.summary?.applied){
      const candidate=checked.tour,stops=[],legs=candidate?.legs||[];
      if(legs.length!==3||candidate?.stops?.length!==2)return fail('fare-map-incomplete-live-itinerary');
      const airport=node=>node?.airportCode||node?.code;
      if(!legs.every((leg,i)=>leg.liveFareVerified===true&&leg.providerDateEvidence?.sourceType==='LIVE'
        &&leg.departureDate===selected.legs[i].departureDate&&airport(leg.from)===airport(selected.legs[i].from)&&airport(leg.to)===airport(selected.legs[i].to)))return fail('fare-map-incomplete-or-mismatched-live-evidence');
      for(let i=0;i<2;i++){
        const evidence=legs[i].providerDateEvidence||{},segments=evidence.segments||[];
        const arrival=optimizer._internal.date(segments.at(-1)?.arriveLocal),departure=optimizer._internal.date(legs[i+1].departureDate);
        const firstDate=optimizer._internal.date(legs[i].departureDate);
        if(!arrival||!departure||!firstDate||arrival<firstDate||optimizer._internal.days(arrival,departure)<2)return fail('fare-map-live-arrival-or-stay-conflict');
        legs[i]={...legs[i],arrivalDate:arrival,providerDateEvidence:{...evidence,arrivalDate:arrival}};
        if(legs[i].cheapestOneWay)legs[i].cheapestOneWay={...legs[i].cheapestOneWay,arrivalDate:arrival};
        const prior=candidate.stops[i],rooms=normalizeParty(query).rooms;
        const hotelCost=require('../fare-map/accommodation-cost-map').quote({cityId:prior.cityId,checkIn:arrival,checkOut:departure,rooms,quality:prior.hotel.costEvidence?.quality?.requested||{}},
          {provider:options.fareMap?.accommodationProvider,regionalNightlyUsd:prior.hotel.costEvidence?.nightlyPerRoomUsd||prior.hotel.estimatedNightlyUsd,now:options.fareMap?.now});
        if(!hotelCost)return fail('fare-map-hotel-cost-unavailable-for-verified-dates');
        const priced=require('../pricing/traveller-pricing').priceStopStay({...prior,arrivalDate:arrival,departureDate:departure,nights:optimizer._internal.days(arrival,departure),arrivalDateVerified:true},query,
          {nightlyPerRoomUsd:hotelCost.nightlyPerRoomUsd+(hotelCost.taxesAndFeesUsd||0)/(rooms*hotelCost.nights)});
        priced.hotel.costEvidence=hotelCost;stops.push(priced);
      }
      selected=require('../pricing/traveller-pricing').applyTravellerPricingToTour({...candidate,legs,stops,totalNights:stops.reduce((s,t)=>s+t.nights,0)},query);
      arrivalVerified=true;
      if(selected.estimatedTotalUsd>selected.usableTripBudgetUsd)return fail('fare-map-live-total-exceeds-protected-budget');
      selected=attachTourPresentation(selected,query);
    }
  }
  return {selected,arrivalVerified,source:candidateTour};
  };
  // Live-only (on for farePreview searches; FARE_MAP_REQUIRE_LIVE=true|false overrides): a trip is shown only
  // when every flight and every hotel came back live. Up to 3 trips are checked,
  // stopping after ~35 s so the page stays inside the site's 55 s wait.
  const env=options.env||process.env,liveSetting=String(env.FARE_MAP_REQUIRE_LIVE||'').trim().toLowerCase();
  const requireLive=liveSetting==='true'||(liveSetting!=='false'&&options.fareMapPreview===true);
  const party=normalizeParty(query),pricingQuery={...query,adults:party.adults,children:party.children,infants:party.infants,rooms:party.rooms,passengers:party.travellers};delete pricingQuery.travellers;
  const started=Date.now(),deadlineMs=Number(options.liveCheckDeadlineMs)||25000;
  const liveCount=t=>(t?.legs||[]).filter(l=>l?.providerDateEvidence?.sourceType==='LIVE').length+(t?.stops||[]).filter(st=>st?.hotel?.nuiteeLiveRate).length;
  // Turn one flight-checked candidate into a page tour; with strict=true hotels must also come back live.
  const build=async(candidateTour,flights,strict)=>{
    const chosen=flights.selected;
    const visual=buildVisualizerTour(chosen,{...query,month:chosen.legs[0].departureDate.slice(0,7)},{summary:{enabled:true,source:'fare-map-cached',liveProviderCallsMade:diagnostics.ignavLiveFares?.providerRequests||0}});
    visual.fareMap={...(chosen.fareMap||{}),arrivalDatesVerified:flights.arrivalVerified,hotelDatesRequireVerification:!flights.arrivalVerified};
    const guard=evaluateTour(visual,query);
    if(!guard.accepted||recommendationEligibility(guard.tour,query).hardBlocked||visual.itineraryDatePlan?.consistent===false)return {reason:'fare-map-final-business-or-date-guard'};
    let tour=guard.tour;
    if(strict){
      if(!flights.arrivalVerified)return {reason:'fare-map-flights-not-all-live',tour};
      const priced=await priceFinalTourWithNuitee({ok:true,tour,tours:[tour],diagnostics:{}},pricingQuery,options);
      diagnostics.nuiteeLiveStays=priced?.diagnostics?.nuiteeLiveStays||diagnostics.nuiteeLiveStays;
      const stops=priced?.tour?.stops||[];
      if(!stops.length||!stops.every(st=>st?.hotel?.nuiteeLiveRate))return {reason:'fare-map-hotels-not-all-live',tour:priced?.tour||tour};
      tour=priced.tour;
    }
    return {tour,arrivalVerified:flights.arrivalVerified,source:candidateTour};
  };
  let outcome=null;const liveAttempts=[],checked=[];
  for(const candidateTour of result.tours.slice(0,requireLive?2:2)){
    if(liveAttempts.length&&Date.now()-started>deadlineMs){liveAttempts.push('stopped-live-check-time-limit');break;}
    const flights=await attempt(candidateTour);
    if(flights.reason){liveAttempts.push(flights.reason);continue;}
    outcome=await build(candidateTour,flights,requireLive);liveAttempts.push(outcome.reason||'ok');
    if(!outcome.reason)break;
    if(outcome.tour)checked.push({candidateTour,flights,partial:outcome.tour});
    outcome=null;
  }
  if(!outcome&&requireLive&&checked.length){
    // None came back fully live: show the checked trip with the most live prices (its
    // estimates stay labelled) instead of a slow second search. No extra provider calls.
    const best=checked.slice().sort((x,y)=>liveCount(y.partial)-liveCount(x.partial))[0];
    outcome={tour:best.partial,arrivalVerified:best.flights.arrivalVerified,source:best.candidateTour};
    diagnostics.fareMapLiveOnlyUnmet=true;liveAttempts.push('shown-most-live-trip');
  }
  diagnostics.fareMapLiveAttempts=liveAttempts;diagnostics.fareMapRequireLive=requireLive;
  if(!outcome||outcome.reason)return {...empty(outcome?.reason||liveAttempts.at(-1)||'fare-map-no-route'),diagnostics:{...result.diagnostics,...diagnostics}};
  diagnostics.arrivalDatesVerified=outcome.arrivalVerified;
  const tours=[outcome.tour,...result.tours.filter(t=>t!==outcome.source).map(t=>buildVisualizerTour(t,{...query,month:t.legs[0].departureDate.slice(0,7)}))];
  return {...result,tour:outcome.tour,tours,diagnostics};
}

module.exports = { getFareMapGeneratedTour };
