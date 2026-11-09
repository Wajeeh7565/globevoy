'use strict';
const fs=require('fs'),path=require('path');const root=__dirname;
const config=fs.readFileSync(path.join(root,'runtime/config.js'),'utf8');
const visualizer=fs.readFileSync(path.join(root,'scripts/multicity-visualizer-674a.js'),'utf8');
const html=fs.readFileSync(path.join(root,'multicity-visualizer.html'),'utf8');
const checks=[];function check(name,passed){console.log(`${passed?'[PASS]':'[FAIL]'} ${name}`);checks.push(!!passed);if(!passed)process.exitCode=1;}
check('frontend identifies GV-REC-677B-R3 or superseding release',(config.includes('frontendVersion: "GV-REC-677B-R3"')||config.includes('bookingTrustVersion: "GV-QUALITY-680A"'))&&(visualizer.includes("const FRONTEND_VERSION='GV-REC-677B-R3'")||visualizer.includes("const FRONTEND_VERSION='GV-QUALITY-680A'"))&&html.includes('GV-REC-677B-R3'));
check('frontend recognizes flight-quality status',visualizer.includes('flightQualityStatus')&&visualizer.includes('flightQualityGuardrailVersion'));
check('limited provider evidence stays honest',visualizer.includes('Limited flight options found')&&visualizer.includes('compare alternatives before booking'));
check('R3 route-relative baseline is preferred in warning copy',visualizer.includes('routeRelativeExpectedFlightMinutes'));
check('acceptable flights retain smart-choice explanation',visualizer.includes('Smart flight choice ·'));
if(process.exitCode)throw new Error('GV-REC-677B-R3 frontend validation failed.');console.log(`GV-REC-677B-R3 frontend validation passed (${checks.filter(Boolean).length}/${checks.length}).`);
