'use strict';
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const prior={...process.env},priorFetch=global.fetch;
before(()=>{
  for(const key of Object.keys(process.env))if(/^(ENABLE_|DUFFEL|STAY22|NUITEE|AWS_|GLOBEVOY_)/.test(key))delete process.env[key];
  Object.assign(process.env,{ENABLE_MULTICITY_ROUTE_610B:'true',ENABLE_GENERATED_TOUR_651A:'true',GLOBEVOY_USE_MOCKS:'true'});
  global.fetch=async()=>{throw Error('Unexpected network request in date regression')};
});
after(()=>{global.fetch=priorFetch;for(const k of Object.keys(process.env))if(!(k in prior))delete process.env[k];Object.assign(process.env,prior);});
test('representative generated tours use selected stay lengths',async()=>{
  const {getGeneratedTour}=require('../../backend/services/domain/tours/generated-tour');
  for(const query of [
    {origin:'YYZ',currency:'CAD',budget:'2500',month:'2027-03',passengers:'1',nights:'7'},
    {origin:'LHR',currency:'GBP',budget:'5000',month:'2027-02',passengers:'3',nights:'28'}
  ]){
    const result=await getGeneratedTour(query);assert.equal(result.supported,true,result.reason);
    const plan=result.tour.itineraryDatePlan;assert.equal(plan.consistent,true);assert.deepEqual(plan.issues,[]);
    const legs=result.tour.backendLegs;
    const nights=result.tour.cities.reduce((sum,c)=>sum+Number(c.nights),0);
    assert.equal((Date.parse(plan.canonicalReturnDate)-Date.parse(plan.canonicalDepartureDate))/86400000,nights);
    assert.equal(legs.length,result.tour.cities.length+1);
    assert.ok(legs.every(l=>l.providerVerificationRequired===true));
  }
});
test('missing planning legs follow a fixed first date across the month boundary',async()=>{
  const {getMultiCityTours}=require('../../backend/services/domain/routing/multicity-routes');
  const {buildVisualizerTour}=require('../../backend/services/domain/tours/generated-tour');
  const query={origin:'YYZ',currency:'CAD',budget:'2500',month:'2027-03',nights:'7',passengers:'1'};
  const {tours}=await getMultiCityTours(query),tour=tours[0];
  tour.legs[0].departureDate='2027-03-29';
  const visual=buildVisualizerTour(tour,query);
  assert.equal(visual.itineraryDatePlan.consistent,true);
  assert.equal(visual.itineraryDatePlan.canonicalDepartureDate,'2027-03-29');
  assert.equal(visual.itineraryDatePlan.canonicalReturnDate,'2027-04-05');
});
test('existing observed/fixed leg dates are never shifted to hide a mismatch',async()=>{
  const {getMultiCityTours}=require('../../backend/services/domain/routing/multicity-routes');
  const {buildVisualizerTour}=require('../../backend/services/domain/tours/generated-tour');
  const query={origin:'YYZ',currency:'CAD',budget:'2500',month:'2027-03',nights:'7',passengers:'1'};
  const {tours}=await getMultiCityTours(query),tour=tours[0];
  tour.legs[1]={...tour.legs[1],departureDate:'2027-03-10',liveFareVerified:true,
    cheapestOneWay:{providerBacked:true,appliedToEstimate:true,departureDate:'2027-03-10'}};
  const visual=buildVisualizerTour(tour,query);
  assert.equal(visual.backendLegs[1].departureDate,'2027-03-10');
  assert.equal(visual.itineraryDatePlan.consistent,false);
  assert.ok(visual.itineraryDatePlan.issues.some(i=>i.code==='next-leg-mismatch'));
});
