'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: Boolean(passed), details });
  console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  if (!passed) process.exitCode = 1;
}
const html = read('multicity-visualizer.html');
const visualizer = read('scripts/multicity-visualizer-674a.js');
check('677A frontend release marker is present', html.includes('GV-REC-677A smart duration + flight selection'));
check('677A visualizer version is active or superseded by R1', visualizer.includes("const FRONTEND_VERSION='GV-REC-677A'") || visualizer.includes("const FRONTEND_VERSION='GV-REC-677A-R1'") || visualizer.includes("const FRONTEND_VERSION='GV-REC-677B'"));
check('smart duration label helper is present', visualizer.includes('function smartDurationLabel677A'));
check('smart duration reason helper is present', visualizer.includes('function smartDurationReason677A'));
check('result subtitle identifies smart duration', visualizer.includes("' · Smart duration'"));
check('results context explains smart duration reason', visualizer.includes('smartDurationReason677A(t)'));
check('677A cache-busting visualizer reference is active', html.includes('multicity-visualizer-674a.js?v=677a') || html.includes('multicity-visualizer-674a.js?v=677b'));
const result = {
  release: 'GV-REC-677A',
  generatedAt: new Date().toISOString(),
  passed: !process.exitCode,
  checkCount: checks.length,
  passedCount: checks.filter(item => item.passed).length,
  failedCount: checks.filter(item => !item.passed).length,
  checks
};
fs.writeFileSync(path.join(root, 'VALIDATION_GV_REC_677A_FRONTEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-REC-677A frontend validation failed.');
console.log(`GV-REC-677A frontend validation passed (${result.passedCount}/${result.checkCount}).`);
