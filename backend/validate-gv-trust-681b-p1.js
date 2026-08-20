'use strict';
Object.assign(process.env, {
  ENABLE_SMART_FLIGHT_DATE_SELECTION_677B: 'true',
  ENABLE_ITINERARY_DATE_INTEGRITY_677B_R1: 'true'
});
const fs = require('node:fs');
const assert = require('node:assert/strict');
const generated = require('./generated-tour');
const { selectBestUsableObservation } = require('./services/cheap-one-way-flights');
const {
  automaticFirstLegWindowDays681BP1,
  automaticLegWindowDays,
  maxAllowedDepartureDate,
  filterObservationsWithinDateWindow,
  selectObservationWithinDateWindow
} = generated._internal;

const checks=[];
function test(name, fn){ fn(); checks.push({name,status:'PASS'}); }

test('681B-P1 release version is exported',()=>{
  assert.equal(generated.FLEXIBLE_DATE_ENGINE_VERSION_681B_P1,'GV-TRUST-681B-P1');
});

test('first automatic flexible leg scans 14 days by default',()=>{
  assert.equal(automaticFirstLegWindowDays681BP1({}),14);
  assert.equal(automaticLegWindowDays({},0),14);
  assert.equal(maxAllowedDepartureDate('2026-08-26',{},0),'2026-09-09');
});

test('first-leg window is configurable but bounded',()=>{
  assert.equal(automaticFirstLegWindowDays681BP1({firstLegFlexibleWindowDays:21}),21);
  assert.equal(automaticFirstLegWindowDays681BP1({firstLegFlexibleWindowDays:99}),30);
  assert.equal(automaticFirstLegWindowDays681BP1({firstLegFlexibleWindowDays:1}),3);
});

test('downstream legs remain fixed to canonical stay cadence',()=>{
  assert.equal(automaticLegWindowDays({},1),0);
  assert.equal(automaticLegWindowDays({},2),0);
});

test('provider observations five days later are now eligible',()=>{
  const result={observations:[
    {departureDate:'2026-08-26',price:181,currency:'EUR',timingQuality:0,transfers:1,durationMinutes:600},
    {departureDate:'2026-08-31',price:116,currency:'EUR',timingQuality:0,transfers:1,durationMinutes:600},
    {departureDate:'2026-09-10',price:80,currency:'EUR',timingQuality:0,transfers:1,durationMinutes:600}
  ]};
  const rows=filterObservationsWithinDateWindow(result,'2026-08-26',{},0);
  assert.deepEqual(rows.map(r=>r.departureDate),['2026-08-26','2026-08-31']);
  const selected=selectObservationWithinDateWindow(result,'2026-08-26',{}, {targetDate:'2026-08-26',budgetPressure:0.5},0);
  assert.equal(selected.departureDate,'2026-08-31');
  assert.equal(selected.price,116);
});


test('lowest-cost role chooses the lowest provider-backed usable fare',()=>{
  const selected=selectBestUsableObservation([
    {departureDate:'2026-08-26',price:106,currency:'EUR',timingQuality:0,transfers:1,durationMinutes:615},
    {departureDate:'2026-08-27',price:101,currency:'EUR',timingQuality:0,transfers:1,durationMinutes:585},
    {departureDate:'2026-08-31',price:116,currency:'EUR',timingQuality:0,transfers:1,durationMinutes:540}
  ],{targetDate:'2026-08-26',maxDateShiftDays:14,pickRole:'lowest-cost'});
  assert.equal(selected.departureDate,'2026-08-27');
  assert.equal(selected.price,101);
  assert.equal(selected.selectionReason,'lowest-cost-provider-backed-681b-p1');
});

test('exact-date behavior remains protected',()=>{
  assert.equal(generated.initialAutomaticStartDate({dateMode:'exact',flexible:'false',departureDate:'2026-08-12'}),'2026-08-12');
});

const report={version:'GV-TRUST-681B-P1',generatedAt:new Date().toISOString(),passed:checks.length,failed:0,checks};
fs.writeFileSync('VALIDATION_GV_TRUST_681B_P1.json',JSON.stringify(report,null,2));
console.log(`PASS ${checks.length}/${checks.length} - GV-TRUST-681B-P1 backend`);
