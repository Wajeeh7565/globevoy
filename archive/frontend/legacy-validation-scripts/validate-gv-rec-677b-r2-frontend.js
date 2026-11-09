'use strict';
const fs=require('fs'), path=require('path');
const root=__dirname;
const config=fs.readFileSync(path.join(root,'runtime/config.js'),'utf8');
const visualizer=fs.readFileSync(path.join(root,'scripts/multicity-visualizer-674a.js'),'utf8');
const html=fs.readFileSync(path.join(root,'multicity-visualizer.html'),'utf8');
const checks=[]; function check(name,passed,details=null){console.log(`${passed?'[PASS]':'[FAIL]'} ${name}${details?` - ${JSON.stringify(details)}`:''}`);checks.push({name,passed:Boolean(passed),details});if(!passed)process.exitCode=1;}
check('frontend identifies GV-REC-677B-R2',config.includes('frontendVersion: "GV-REC-677B-R2"')&&visualizer.includes("const FRONTEND_VERSION='GV-REC-677B-R2'")&&html.includes('GV-REC-677B-R2 flight quality guardrails'));
check('frontend recognizes R2 quality evidence',visualizer.includes('flightQualityGuardrailVersion')&&visualizer.includes('flightQualityStatus'));
check('frontend does not call limited provider evidence a smart choice',visualizer.includes('Limited flight options found')&&visualizer.includes('compare alternatives before booking'));
check('frontend still shows 677B smart tradeoff explanation for acceptable flights',visualizer.includes('Smart flight choice ·'));
check('frontend still preserves R1 transport integrity helper',visualizer.includes('impossibleGroundDisplay677AR1'));
const result={release:'GV-REC-677B-R2',generatedAt:new Date().toISOString(),passed:!process.exitCode,checkCount:checks.length,passedCount:checks.filter(x=>x.passed).length,failedCount:checks.filter(x=>!x.passed).length,checks};
fs.writeFileSync(path.join(root,'VALIDATION_GV_REC_677B_R2_FRONTEND.json'),JSON.stringify(result,null,2)+'\n');
if(process.exitCode)throw new Error('GV-REC-677B-R2 frontend validation failed.');
console.log(`GV-REC-677B-R2 frontend validation passed (${result.passedCount}/${result.checkCount}).`);
