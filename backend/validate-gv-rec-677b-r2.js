'use strict';
process.env.ENABLE_SMART_FLIGHT_DATE_SELECTION_677B = 'true';
process.env.ENABLE_FLIGHT_QUALITY_GUARDRAILS_677B_R2 = 'true';
const flights = require('./services/cheap-one-way-flights');
const generated = require('./generated-tour');
const checks=[];
function check(name, passed, details=null){ console.log(`${passed?'[PASS]':'[FAIL]'} ${name}${details?` - ${JSON.stringify(details)}`:''}`); checks.push({name,passed:Boolean(passed),details}); if(!passed) process.exitCode=1; }

check('R2 generated-tour version packaged', ['2.10.2-gv-rec-677b-r2-flight-quality-guardrails','2.10.3-gv-rec-677b-r3-route-relative-flight-quality','2.11.0-gv-rec-677c-whole-trip-route-optimization','2.12.0-gv-rec-677d-destination-value-proximity'].includes(generated.GENERATED_TOUR_VERSION), generated.GENERATED_TOUR_VERSION);
check('R2 quality guardrail flag active', flights.smartFlightQualityGuardrails677BR2Enabled() === true);
check('R2 quality guardrail version exported', flights.SMART_FLIGHT_QUALITY_GUARDRAIL_VERSION_677B_R2 === 'GV-REC-677B-R2');

const yyzCun = [
  {departureDate:'2026-08-06',price:289,currency:'CAD',durationMinutes:1400,transfers:2,departureTime:'08:00',arrivalTime:'07:20',timingQuality:5},
  {departureDate:'2026-08-05',price:350,currency:'CAD',durationMinutes:275,transfers:0,departureTime:'09:10',arrivalTime:'13:45',timingQuality:0}
];
const smart = flights.selectBestUsableObservation(yyzCun,{targetDate:'2026-08-05',maxDateShiftDays:3,budgetPressure:0.72,distanceKm:2600});
check('R2 rejects 23h20m cheap itinerary when a normal nonstop-like option is within premium ceiling', smart.price===350 && smart.durationMinutes===275, smart);
check('R2 chosen normal option passes quality guardrail', smart.flightQualityStatus==='guardrail-pass' && smart.flightQualityGuardrailVersion==='GV-REC-677B-R2', {status:smart.flightQualityStatus,warnings:smart.flightQualityWarnings});

const onlyPoor = [
  {departureDate:'2026-08-05',price:310,currency:'CAD',durationMinutes:1320,transfers:2,departureTime:'07:00',arrivalTime:'05:00',timingQuality:5},
  {departureDate:'2026-08-06',price:260,currency:'CAD',durationMinutes:1410,transfers:2,departureTime:'08:00',arrivalTime:'07:30',timingQuality:5}
];
const limited = flights.selectBestUsableObservation(onlyPoor,{targetDate:'2026-08-05',maxDateShiftDays:3,budgetPressure:0.60,distanceKm:2600});
check('R2 does not shift date merely for cheaper poor flight when all provider observations are severe', limited.departureDate==='2026-08-05', limited);
check('R2 labels all-poor provider evidence honestly', limited.flightQualityStatus==='limited-provider-options' && limited.selectionReason==='limited-flight-options-provider-evidence-677b-r2', {status:limited.flightQualityStatus,reason:limited.selectionReason,warnings:limited.flightQualityWarnings});

const longHaulAssessment = flights.flightQualityAssessment677BR2({durationMinutes:1020,transfers:1},{distanceKm:10000},1020);
check('R2 does not over-penalize realistic long-haul travel', longHaulAssessment.status!=='severe', longHaulAssessment);

const costly = flights.selectBestUsableObservation([
  {departureDate:'2026-09-01',price:300,durationMinutes:700,transfers:1,timingQuality:1},
  {departureDate:'2026-09-01',price:500,durationMinutes:280,transfers:0,timingQuality:0}
],{targetDate:'2026-09-01',maxDateShiftDays:0,budgetPressure:0.95,distanceKm:2600});
check('R2 preserves price ceiling under high budget pressure', costly.price===300, costly);

const result={release:'GV-REC-677B-R2',generatedAt:new Date().toISOString(),passed:!process.exitCode,checkCount:checks.length,passedCount:checks.filter(x=>x.passed).length,failedCount:checks.filter(x=>!x.passed).length,checks};
require('fs').writeFileSync(require('path').join(__dirname,'VALIDATION_GV_REC_677B_R2_BACKEND.json'),JSON.stringify(result,null,2)+'\n');
if(process.exitCode) throw new Error('GV-REC-677B-R2 backend validation failed.');
console.log(`GV-REC-677B-R2 backend validation passed (${result.passedCount}/${result.checkCount}).`);
