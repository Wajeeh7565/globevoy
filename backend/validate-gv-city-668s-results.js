'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sourcePath = path.join(__dirname, 'data', 'provider-live-inactive-recovery150-668s-source.json');
const smokePath = path.join(__dirname, 'data', 'provider-live-inactive-recovery-smoke5-668s-source.json');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8').replace(/^\uFEFF/, ''));
const smoke = fs.existsSync(smokePath) ? JSON.parse(fs.readFileSync(smokePath, 'utf8').replace(/^\uFEFF/, '')) : null;
const checks = [];
function check(name, pass, details = {}) { checks.push({ name, pass: Boolean(pass), details }); if (!pass) console.error('FAIL', name, details); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

const records = Array.isArray(source.records) ? source.records : [];
const active = records.filter(record => record.productionActivation?.eligible === true);
const review = records.filter(record => record.productionActivation?.eligible !== true);
const covered = records.filter(record => record.providerCoverage?.eligible === true);
const lanes = Object.fromEntries((source.laneResults || []).map(item => [item.recoveryLane, item]));

check('source identity is GV-CITY-668S Recovery150', source.taskId === 'GV-CITY-668S' && source.mode === 'Recovery150');
check('source engine is GV-CITY-668E', source.engineVersion === 'GV-CITY-668E');
check('150 records completed', source.requestedCount === 150 && source.completedCount === 150 && records.length === 150);
check('150 city IDs are unique', new Set(records.map(record => record.cityId)).size === 150);
check('all records completed successfully', records.every(record => record.ok === true));
check('all records use 668E policy', records.every(record => record.version === 'GV-CITY-668E'));
check('71 records are provider-covered', source.providerCoverageEligibleCount === 71 && covered.length === 71);
check('18 records are production-ready', source.productionActiveCount === 18 && active.length === 18);
check('132 records remain review', source.reviewCount === 132 && review.length === 132);
check('projected active total is 439', source.projectedMergedProductionActiveCount === 439);
check('projected reviewed inactive total is 561', source.projectedReviewedInactiveCount === 561);
check('full registry remains audited', source.auditedCount === 1000 && source.unauditedCount === 0);
check('thresholds were not relaxed', source.thresholdsRelaxed === false && source.recoveryPolicy?.thresholdsRelaxed === false);
check('activation import is explicitly required', source.activationImportRequired === true);
check('flight policy uses four months', source.recoveryPolicy?.flightMonths === 4);
check('regional anchor policy uses six anchors', source.recoveryPolicy?.regionalAnchorCount === 6);
check('flight attempt cap is 20', source.recoveryPolicy?.maximumFlightAttempts === 20);
check('stay policy uses four windows', source.recoveryPolicy?.stayWindows === 4);
check('Agoda policy uses three strategies', source.recoveryPolicy?.agodaQualityStrategies === 3);
check('flight-recovery lane is 80/14/9', lanes['flight-recovery']?.checked === 80 && lanes['flight-recovery']?.providerCovered === 14 && lanes['flight-recovery']?.productionReady === 9);
check('readiness-recovery lane is 64/57/9', lanes['readiness-recovery']?.checked === 64 && lanes['readiness-recovery']?.providerCovered === 57 && lanes['readiness-recovery']?.productionReady === 9);
check('stay-recovery lane is 6/0/0', lanes['stay-recovery']?.checked === 6 && lanes['stay-recovery']?.providerCovered === 0 && lanes['stay-recovery']?.productionReady === 0);
check('classification totals sum to 150', (source.classificationCounts || []).reduce((sum, item) => sum + item.count, 0) === 150);
check('all active records have both production evidence streams', active.every(record => record.live?.travelpayouts?.evidenceMode === 'production-provider-response' && record.live?.agoda?.evidenceMode === 'production-provider-response'));
check('all active records passed readiness', active.every(record => record.recommendationReadiness?.eligible === true));
check('all active records are direct/metro', active.every(record => record.productionActivation?.mode === 'direct-or-metro'));
check('active records split 9 Current-500 and 9 Expansion-500', active.filter(record => record.selectionTier === 'current-500').length === 9 && active.filter(record => record.selectionTier === 'expansion-500').length === 9);
check('source SHA-256 is reproducible', /^[a-f0-9]{64}$/.test(sha256(sourcePath)));

if (smoke) {
  const smokeById = new Map(smoke.records.map(record => [record.cityId, record]));
  const fullById = new Map(records.map(record => [record.cityId, record]));
  const shared = [...smokeById.keys()].filter(id => fullById.has(id));
  check('Smoke5 contains five unique records', smoke.completedCount === 5 && smoke.records.length === 5 && new Set(smoke.records.map(record => record.cityId)).size === 5);
  check('Smoke5 and Recovery150 agree on shared eligibility', shared.every(id => smokeById.get(id).productionActivation?.eligible === fullById.get(id).productionActivation?.eligible));
  check('Smoke5 and Recovery150 agree on shared classifications', shared.every(id => smokeById.get(id).classification === fullById.get(id).classification));
}

const passed = checks.filter(item => item.pass).length;
const result = { taskId: 'GV-CITY-668S-RESULTS', generatedAt: new Date().toISOString(), sourceFile: path.basename(sourcePath), sourceFileSha256: sha256(sourcePath), passed, failed: checks.length - passed, total: checks.length, checks };
fs.writeFileSync(path.join(__dirname, 'data', 'provider-live-inactive-recovery150-668s-source-VALIDATION.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed, failed: checks.length - passed, total: checks.length }, null, 2));
if (passed !== checks.length) process.exitCode = 1;
