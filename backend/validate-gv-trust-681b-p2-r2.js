'use strict';

Object.assign(process.env, {
  ENABLE_PROVIDER_CHEAP_DATE_SCANNER_650B: 'true',
  ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A: 'true',
  ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B: 'true',
  ENABLE_SMART_FLIGHT_DATE_SELECTION_677B: 'true',
  ENABLE_ITINERARY_DATE_INTEGRITY_677B_R1: 'true',
  ENABLE_WHOLE_TRIP_DATE_OPTIMIZER_681B_P2: 'true',
  ENABLE_PASSENGER_ROOM_PRICING_666A: 'true',
  TRAVELPAYOUTS_TOKEN: 'fixture-token'
});

const fs=require('node:fs');
const assert=require('node:assert/strict');
const generated=require('./generated-tour');
const checks=[];
function pass(name){checks.push({name,status:'PASS'});}

const legs=[
  {mode:'flight',transportType:'flight',from:{city:'Dublin',airportCode:'DUB'},to:{city:'Tangier',airportCode:'TNG'},estimatedTransportUsd:170},
  {mode:'flight',transportType:'flight',from:{city:'Tangier',airportCode:'TNG'},to:{city:'Porto',airportCode:'OPO'},estimatedTransportUsd:120},
  {mode:'flight',transportType:'flight',from:{city:'Porto',airportCode:'OPO'},to:{city:'Dublin',airportCode:'DUB'},estimatedTransportUsd:150}
];
const stops=[
  {city:'Tangier',nights:3,hotel:{estimatedNightlyUsd:50,estimatedStayUsd:150}},
  {city:'Porto',nights:2,hotel:{estimatedNightlyUsd:70,estimatedStayUsd:140}}
];
function fixtureRows(origin,destination,month){
  const fixtures={
    'DUB-TNG-2026-08':[['2026-08-27',101],['2026-08-28',127]],
    'TNG-OPO-2026-08':[['2026-08-30',140],['2026-08-31',70]],
    'OPO-DUB-2026-08':[],
    'DUB-TNG-2026-09':[],
    'TNG-OPO-2026-09':[],
    // Only the Aug-27 synchronized route is complete. Sep 2 is deliberately absent.
    'OPO-DUB-2026-09':[['2026-09-01',110]]
  };
  return (fixtures[`${origin}-${destination}-${month}`]||[]).map(([date,price])=>({departure_at:`${date}T10:00:00+00:00`,price,duration:240,transfers:0,airline:'ZZ'}));
}

(async()=>{
  const realFetch=global.fetch;
  global.fetch=async(url)=>{
    const u=new URL(url);
    const body={success:true,data:fixtureRows(u.searchParams.get('origin'),u.searchParams.get('destination'),u.searchParams.get('departure_at'))};
    return {ok:true,status:200,text:async()=>JSON.stringify(body)};
  };
  try{
    const tour={title:'Dublin fallback truthfulness fixture',origin:{city:'Dublin',airportCode:'DUB',code:'DUB'},legs:legs.map(x=>({...x})),stops:stops.map(x=>({...x,hotel:{...x.hotel}})),totalBudgetUsd:900,estimatedTotalUsd:730};
    const query={currency:'EUR',budget:900,pickRole:'lowest-cost',preferredMonth:'2026-08',passengers:1,rooms:1};
    const enriched=await generated.enrichTourWithCheapFlights(tour,query);
    const summary=enriched.summary.wholeTripDateOptimization;
    assert.equal(summary.applied,false); pass('insufficient coverage keeps whole-trip optimizer unapplied');
    assert.equal(summary.reason,'fewer-than-two-complete-provider-backed-flight-schedules'); pass('fallback reason identifies insufficient complete schedules');
    assert.equal(summary.truthfulnessRepairVersion,'GV-TRUST-681B-P2-R2'); pass('R2 truthfulness marker is emitted');
    assert.equal(summary.candidateCount,2); pass('candidate count is exposed');
    assert.equal(summary.completeCandidateCount,1); pass('complete candidate count is exposed');
    assert.equal(summary.fullyPricedCandidateCount,1); pass('fully priced candidate alias is exposed');
    assert.equal(summary.incompleteCandidateCount,1); pass('incomplete candidate count is exposed');
    assert.ok(summary.missingFlightObservationCount>=1); pass('missing observation count is exposed');
    const missing=summary.missingFlightObservationDiagnostics.find(row=>row.fromCode==='OPO'&&row.toCode==='DUB'&&row.targetDate==='2026-09-02');
    assert.ok(missing); pass('missing route/date diagnostic identifies OPO to DUB on Sep 2');
    assert.equal(summary.selectedStartDate,null); pass('fallback does not falsely expose an optimized selected start date');
  } finally { global.fetch=realFetch; }
  const report={version:'GV-TRUST-681B-P2-R2',generatedAt:new Date().toISOString(),passed:checks.length,failed:0,checks};
  fs.writeFileSync('VALIDATION_GV_TRUST_681B_P2_R2.json',JSON.stringify(report,null,2));
  console.log(`PASS ${checks.length}/${checks.length} - GV-TRUST-681B-P2-R2 backend`);
})().catch(error=>{console.error(error);process.exit(1);});
