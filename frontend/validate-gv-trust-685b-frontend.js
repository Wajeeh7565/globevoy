'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const confidence = require('./scripts/budget-confidence-685b.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const visualizer = fs.readFileSync('scripts/multicity-visualizer-674a.js', 'utf8');
const html = fs.readFileSync('multicity-visualizer.html', 'utf8');

check('685B version locked', () => assert.equal(confidence.VERSION, 'GV-TRUST-685B'));
check('over-budget always wins', () => assert.equal(confidence.evaluate({ over: true, live: { criticalCount: 5, verifiedCount: 5, allCriticalVerified: true, budgetClaim: 'provider-backed-fit' } }).label, 'Over budget'));
check('complete provider-backed evidence earns provider-backed fit', () => assert.equal(confidence.evaluate({ over: false, live: { criticalCount: 3, verifiedCount: 3, allCriticalVerified: true, budgetClaim: 'provider-backed-fit' } }).label, 'Provider-backed fit'));
check('2 of 3 critical prices becomes planning estimate verify price', () => assert.equal(confidence.evaluate({ over: false, live: { criticalCount: 3, verifiedCount: 2, budgetClaim: 'estimated-to-fit-budget' } }).label, 'Planning estimate — verify price'));
check('1 of 5 critical prices becomes planning estimate verify price', () => assert.equal(confidence.evaluate({ over: false, live: { criticalCount: 5, verifiedCount: 1 } }).label, 'Planning estimate — verify price'));
check('zero verified critical prices requires price verification', () => assert.equal(confidence.evaluate({ over: false, live: { criticalCount: 5, verifiedCount: 0 } }).label, 'Price verification required'));
check('no critical evidence requires price verification', () => assert.equal(confidence.evaluate({ over: false, live: {} }).label, 'Price verification required'));
check('all critical evidence without backend provider-backed budget claim stays conservative', () => assert.equal(confidence.evaluate({ over: false, live: { criticalCount: 2, verifiedCount: 2, allCriticalVerified: true, budgetClaim: 'estimated-to-fit-budget' } }).label, 'Planning estimate — verify price'));
check('active visualizer consumes 685B confidence engine', () => assert.match(visualizer, /GV_TRUST_685B_BUDGET_CONFIDENCE/));
check('active visualizer no longer renders Estimated to fit budget', () => assert.doesNotMatch(visualizer, /Estimated to fit budget/));
check('HTML loads confidence engine before active visualizer', () => {
  const confidenceIndex = html.indexOf('budget-confidence-685b.js?v=685b');
  const visualizerIndex = html.indexOf('multicity-visualizer-674a.js?v=685b');
  assert.ok(confidenceIndex >= 0 && visualizerIndex > confidenceIndex);
});
check('685B does not alter backend or booking surfaces', () => {
  assert.doesNotMatch(fs.readFileSync('scripts/budget-confidence-685b.js', 'utf8'), /booking|payment|order|ticketing|fetch\s*\(/i);
});

const report = {
  version: 'GV-TRUST-685B',
  generatedAt: new Date().toISOString(),
  passed,
  failed: 0,
  changedFiles: [
    'multicity-visualizer.html',
    'scripts/multicity-visualizer-674a.js',
    'scripts/budget-confidence-685b.js'
  ],
  policy: {
    overBudget: 'Over budget',
    providerBackedAllCritical: 'Provider-backed fit',
    partialCriticalEvidence: 'Planning estimate — verify price',
    noVerifiedCriticalEvidence: 'Price verification required'
  }
};
fs.writeFileSync('VALIDATION_GV_TRUST_685B_FRONTEND.json', JSON.stringify(report, null, 2));
console.log(`PASS ${passed}/${passed} — GV-TRUST-685B frontend`);
