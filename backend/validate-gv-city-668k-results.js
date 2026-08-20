'use strict';

// Validate a completed GV-CITY-668K Final145 LIVE-RESULTS.json before it is
// used to build the activation merge. This validator never calls providers.

const fs = require('fs');
const path = require('path');

const resultPath = process.argv[2];
if (!resultPath) {
  console.error('Usage: node validate-gv-city-668k-results.js <GV-CITY-668K-Final145-...-LIVE-RESULTS.json>');
  process.exit(2);
}

const absolute = path.resolve(resultPath);
const result = JSON.parse(fs.readFileSync(absolute, 'utf8'));
const plan = require('./data/current-500-completion-audit-145-668k.json');

const checks = [];
function check(name, pass, details = undefined) {
  checks.push({ name, pass: Boolean(pass), ...(details === undefined ? {} : { details }) });
  if (!pass) console.error('FAIL', name, details);
}

const records = Array.isArray(result.records) ? result.records : [];
const ids = records.map(record => record.cityId);
const plannedIds = Array.isArray(plan.cityIds) ? plan.cityIds : [];
const active = records.filter(record => record.productionActivation?.eligible === true);
const review = records.filter(record => record.productionActivation?.eligible !== true);
const providerCovered = records.filter(record => record.providerCoverage?.eligible === true);
const classificationCounts = records.reduce((acc, record) => {
  const key = record.classification || 'unknown';
  acc[key] = (acc[key] || 0) + 1;
  return acc;
}, {});

check('result identifies GV-CITY-668K Final145', result.taskId === 'GV-CITY-668K' && result.mode === 'Final145');
check('result uses the GV-CITY-668E audit engine', result.engineVersion === 'GV-CITY-668E');
check('result contains 145 completed records', result.requestedCount === 145 && result.completedCount === 145 && records.length === 145);
check('result city IDs are unique', new Set(ids).size === 145);
check('result city set exactly matches the 668K plan', plannedIds.length === 145 && plannedIds.every(id => ids.includes(id)) && ids.every(id => plannedIds.includes(id)));
check('every record completed successfully', records.every(record => record.ok === true));
check('every record reports the 668E engine version', records.every(record => record.version === 'GV-CITY-668E'));
check('every record is Current-500', records.every(record => record.selectionTier === 'current-500'));
check('provider-covered count matches records', result.providerCoverageEligibleCount === providerCovered.length);
check('production-active count matches records', result.productionActiveCount === active.length);
check('review count matches records', result.reviewCount === review.length && active.length + review.length === 145);
check('projected active total uses the 259-city baseline', result.activationBaselineProductionActiveCount === 259 && result.projectedMergedProductionActiveCount === 259 + active.length);
check('Current-500 baseline is 355 audited', result.activationBaselineCurrent500AuditedCount === 355);
check('result projects 500/500 Current-500 audited', result.projectedCurrent500AuditedCount === 500 && result.current500CompletionExpected === true);
check('result projects 545 total audited', result.projectedTotalAuditedCount === 545);
check('activation import remains required', result.activationImportRequired === true);
check('all active records have provider coverage', active.every(record => record.providerCoverage?.eligible === true));
check('all active records have recommendation readiness', active.every(record => record.recommendationReadiness?.eligible === true));
check('all active records have quality-qualified Agoda evidence', active.every(record => record.live?.agoda?.evidenceMode === 'production-provider-response' && record.live?.agoda?.qualityQualifiedRate === true));
check('all active records have comfort-qualified flight evidence', active.every(record => record.live?.travelpayouts?.evidenceMode === 'production-provider-response' && record.live?.travelpayouts?.comfortQualified === true));
check('all active records have a verification timestamp', active.every(record => Boolean(record.lastVerifiedAt)));
check('all inactive records remain in review rather than activation', review.every(record => record.productionActivation?.eligible !== true));

const reportedClassifications = Array.isArray(result.classificationCounts)
  ? Object.fromEntries(result.classificationCounts.map(item => [item.classification, item.count]))
  : {};
check('classification counts match records', Object.keys(classificationCounts).every(key => reportedClassifications[key] === classificationCounts[key]) && Object.keys(reportedClassifications).every(key => classificationCounts[key] === reportedClassifications[key]), { reportedClassifications, classificationCounts });
check('all batch summaries report zero failures', Array.isArray(result.batches) && result.batches.length > 0 && result.batches.every(batch => batch.failedCount === 0));
check('batch completed totals sum to 145', result.batches.reduce((sum, batch) => sum + Number(batch.completedCount || 0), 0) === 145);

const passed = checks.filter(item => item.pass).length;
const validation = {
  taskId: 'GV-CITY-668K-RESULTS',
  sourceFile: absolute,
  generatedAt: new Date().toISOString(),
  summary: {
    completedCount: records.length,
    providerCoverageEligibleCount: providerCovered.length,
    productionActiveCount: active.length,
    reviewCount: review.length,
    projectedMergedProductionActiveCount: 259 + active.length,
    projectedCurrent500AuditedCount: 500,
    projectedTotalAuditedCount: 545,
    classificationCounts
  },
  passed,
  failed: checks.length - passed,
  total: checks.length,
  checks
};
const outputPath = path.join(path.dirname(absolute), `${path.basename(absolute, '.json')}-VALIDATION.json`);
fs.writeFileSync(outputPath, JSON.stringify(validation, null, 2));
console.log(JSON.stringify({ outputPath, passed, failed: checks.length - passed, total: checks.length, summary: validation.summary }, null, 2));
if (passed !== checks.length) process.exitCode = 1;
