'use strict';
const assert = require('assert');
const {
  normalizeParty,
  providerFarePartyTotalUsd,
  priceTransportLeg,
  priceStopStay,
  applyTravellerPricingToTour
} = require('./services/domain/pricing/traveller-pricing');

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({name, passed:true}); }
  catch (error) { checks.push({name, passed:false, error:error.message}); }
}

check('one adult produces one fare unit and one room', () => {
  const p = normalizeParty({passengers:1});
  assert.equal(p.adults, 1); assert.equal(p.travellers, 1); assert.equal(p.flightFareUnits, 1); assert.equal(p.rooms, 1);
});
check('two adults multiply flight fare but share one room', () => {
  const p = normalizeParty({adults:2});
  assert.equal(p.flightFareUnits, 2); assert.equal(p.rooms, 1);
  assert.equal(providerFarePartyTotalUsd(100, {adults:2}), 200);
});
check('three adults require two rooms by default', () => {
  const p = normalizeParty({adults:3}); assert.equal(p.rooms, 2);
});
check('two adults and two children require two rooms', () => {
  const p = normalizeParty({adults:2, children:2}); assert.equal(p.travellers, 4); assert.equal(p.rooms, 2);
});
check('infant uses conservative ten-percent flight allowance', () => {
  const p = normalizeParty({adults:2, infants:1}); assert.equal(p.flightFareUnits, 2.1);
});
check('flight estimate scales by fare units', () => {
  const leg = priceTransportLeg({mode:'flight', estimatedTransportUsd:125}, {adults:2, children:1});
  assert.equal(leg.estimatedTransportUsd, 375); assert.equal(leg.pricingIntegrity.multiplier, 3);
});
check('public transfer scales by all travellers', () => {
  const leg = priceTransportLeg({mode:'rail or bus options', estimatedTransportUsd:30}, {adults:2, children:1, infants:1});
  assert.equal(leg.estimatedTransportUsd, 120); assert.equal(leg.pricingIntegrity.unitBasis, 'per-traveller-transfer');
});
check('private taxi stays per party', () => {
  const leg = priceTransportLeg({mode:'private taxi', estimatedTransportUsd:80}, {adults:4});
  assert.equal(leg.estimatedTransportUsd, 80); assert.equal(leg.pricingIntegrity.unitBasis, 'per-party-transfer');
});
check('stay total scales by rooms not travellers', () => {
  const stop = priceStopStay({nights:3, hotel:{estimatedNightlyUsd:100}}, {adults:3});
  assert.equal(stop.hotel.rooms, 2); assert.equal(stop.hotel.estimatedStayUsd, 600);
});
check('full tour recomputes transport hotel total and affordability', () => {
  const tour = applyTravellerPricingToTour({
    totalBudgetUsd: 1500, usableTripBudgetUsd:1350,
    legs:[{mode:'flight',estimatedTransportUsd:200},{mode:'rail',estimatedTransportUsd:20}],
    stops:[{nights:3,hotel:{estimatedNightlyUsd:100}},{nights:2,hotel:{estimatedNightlyUsd:80}}]
  }, {adults:2});
  assert.equal(tour.totalTransportEstimateUsd, 440);
  assert.equal(tour.totalHotelEstimateUsd, 460);
  assert.equal(tour.estimatedTotalUsd, 900);
  assert.equal(tour.affordabilityStatus, 'within-budget');
});
check('corrected party total can trigger over-budget status', () => {
  const tour = applyTravellerPricingToTour({
    totalBudgetUsd: 700,
    legs:[{mode:'flight',estimatedTransportUsd:250},{mode:'flight',estimatedTransportUsd:200}],
    stops:[{nights:2,hotel:{estimatedNightlyUsd:90}}]
  }, {adults:2});
  assert.equal(tour.estimatedTotalUsd, 1080);
  assert.equal(tour.affordabilityStatus, 'over-user-budget');
});

const output = {task:'GV-MVP-666A', version:'1.0', passed:checks.filter(x=>x.passed).length, failed:checks.filter(x=>!x.passed).length, checks};
console.log(JSON.stringify(output,null,2));
if (output.failed) process.exit(1);
