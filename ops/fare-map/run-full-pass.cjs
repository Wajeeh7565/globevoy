#!/usr/bin/env node
'use strict';
// Run one complete fare-map pass (all origins x months) — for the EC2 collector.
// See docs/FARE_MAP_EC2_COLLECTOR.md.
//
//   node ops/fare-map/run-full-pass.cjs              full pass (resumes an unfinished one)
//   node ops/fare-map/run-full-pass.cjs --dry-run --max-tasks 5   fetch 5 tasks, write nothing
//   node ops/fare-map/run-full-pass.cjs --fresh      ignore saved progress, start over
//
// Needs FARE_MAP_TABLE and either TRAVELPAYOUTS_TOKEN or TRAVELPAYOUTS_SECRET_ID
// (a Secrets Manager secret holding the token as plain text or {"token":"..."}).
// AWS access comes from the machine's IAM role; no keys on disk.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..', '..');
const { runFullPass, _internal: { targetedPlan } } = require(path.join(root, 'backend/services/domain/fare-map/fare-map-full-pass.js'));

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }
const has = name => process.argv.includes(name);

async function tokenFromSecret(secretId) {
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-2' });
  const out = await client.send(new GetSecretValueCommand({ SecretId: secretId }));
  const raw = String(out.SecretString || '').trim();
  // Plain text, or a key/value secret: {"token": ...}, {"TRAVELPAYOUTS_TOKEN": ...} or any single key.
  let j; try { j = JSON.parse(raw); } catch (_) { return raw; }
  if (!j || typeof j !== 'object') return raw;
  const values = Object.values(j).filter(v => typeof v === 'string' && v.trim());
  return String(j.token || j.TRAVELPAYOUTS_TOKEN || j.apiKey || (values.length === 1 ? values[0] : '')).trim();
}

(async () => {
  const coverageFile = arg('--coverage-plan');
  const coverage = has('--coverage-plan');
  const batchNumber = Number(arg('--batch'));
  const requestBudget = has('--request-budget') ? Number(arg('--request-budget')) : undefined;
  if (has('--batch') && !coverage) throw new Error('--batch requires --coverage-plan');
  if (coverage && (!coverageFile || has('--origins') || has('--month') || !Number.isInteger(batchNumber) || batchNumber < 1)) {
    throw new Error('Select exactly one numbered coverage batch');
  }
  const planFile = coverage ? JSON.parse(fs.readFileSync(coverageFile, 'utf8')) : null;
  if (coverage && planFile?.version !== require('./plan-origin-coverage.cjs').VERSION) {
    throw new Error('Use a current worldwide origin coverage plan');
  }
  const batch = planFile?.batches?.[batchNumber - 1];
  if (coverage && !batch) throw new Error('Coverage batch does not exist');
  const targeted = coverage || has('--origins') || has('--month');
  if ((coverage && !has('--plan') || requestBudget !== undefined) &&
    (!targeted || !Number.isInteger(requestBudget) || requestBudget < 1 || requestBudget > 272)) {
    throw new Error('Provide a request budget from 1 to 272 for the targeted execution');
  }
  const origins = batch?.origins || arg('--origins')?.split(',').map(code => code.trim().toUpperCase());
  const targetMonth = batch?.month || arg('--month');
  const worldwide = has('--worldwide') || process.env.FARE_MAP_WORLDWIDE === 'true';
  if (worldwide && targeted) throw new Error('Choose worldwide or targeted collection');
  if (worldwide && has('--plan')) {
    const { buildWorldwidePlan } = require('../../backend/services/domain/fare-map/fare-map-worldwide-plan');
    const { originCodesFromRegistry } = require('../../backend/services/domain/fare-map/fare-map-ingest');
    const { tasks, ...details } = buildWorldwidePlan(require('../../backend/data/selectable-origins.json'),
      originCodesFromRegistry(require('../../backend/data/unified-city-registry-1000.json')));
    console.log(JSON.stringify({ ...details, partitions: tasks.length }, null, 2));
    return;
  }
  if (targeted) {
    const plan = targetedPlan(origins, targetMonth);
    const supported = new Set(require('../../backend/data/selectable-origins.json').flatMap(row => row.slice(4, 6)));
    if (origins.some(code => !supported.has(code))) throw new Error('Target codes must be present in the departure catalogue');
    if (has('--plan')) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
  } else if (has('--plan')) {
    throw new Error('--plan requires explicit --origins and --month');
  }
  let token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token && process.env.TRAVELPAYOUTS_SECRET_ID) token = await tokenFromSecret(process.env.TRAVELPAYOUTS_SECRET_ID);
  const result = await runFullPass({
    token,
    worldwide,
    ...(targeted ? { origins, targetMonth, requestBudget } : {}),
    dryRun: has('--dry-run'),
    fresh: has('--fresh'),
    maxTasks: Number(arg('--max-tasks')) || undefined,
    intervalMs: Number(arg('--interval-ms')) || undefined,
    host: os.hostname()
  });
  // Exit codes: 0 finished or paused cleanly, 2 stopped (see reason), 1 crashed.
  process.exitCode = result.ok ? 0 : 2;
})().catch(error => { console.error(JSON.stringify({ component: 'fare-map-full-pass', event: 'crashed', message: error.message })); process.exitCode = 1; });
