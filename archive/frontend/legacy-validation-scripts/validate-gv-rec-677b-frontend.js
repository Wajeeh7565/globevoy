'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;
const checks = [];
function check(name, passed, details = null) {
  const item = { name, passed: Boolean(passed), details };
  checks.push(item);
  console.log(`${item.passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  if (!item.passed) process.exitCode = 1;
}
function read(rel){ return fs.readFileSync(path.join(root, rel), 'utf8'); }
const config = read('runtime/config.js');
const html = read('multicity-visualizer.html');
const visualizer = read('scripts/multicity-visualizer-674a.js');
const css = read('styles/multi-city-visualizer-674a.css');
check('frontend identifies GV-REC-677B', config.includes('frontendVersion: "GV-REC-677B"') && visualizer.includes("const FRONTEND_VERSION='GV-REC-677B'") && html.includes('GV-REC-677B smart flight + date selection'));
check('677B visualizer surfaces smart-flight explanation helper', visualizer.includes('smartFlightChoiceCopy677B'));
check('677B smart-flight note is rendered only from provider evidence', visualizer.includes('smartFlightDateSelectionVersion') && visualizer.includes('mcv-smart-flight-note'));
check('677B smart-flight note has lightweight styling', css.includes('.mcv-smart-flight-note'));
check('R1 transport display safeguards remain present', visualizer.includes('hasFlightComponent677AR1') && visualizer.includes('impossibleGroundDisplay677AR1'));
check('677A smart duration label remains present', visualizer.includes('smartDurationLabel677A'));
const result = { release: 'GV-REC-677B', generatedAt: new Date().toISOString(), passed: !process.exitCode, checkCount: checks.length, passedCount: checks.filter(x=>x.passed).length, failedCount: checks.filter(x=>!x.passed).length, checks };
fs.writeFileSync(path.join(root, 'VALIDATION_GV_REC_677B_FRONTEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-REC-677B frontend validation failed.');
console.log(`GV-REC-677B frontend validation passed (${result.passedCount}/${result.checkCount}).`);
