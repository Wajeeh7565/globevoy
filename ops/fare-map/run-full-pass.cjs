#!/usr/bin/env node
'use strict';
// Run one complete fare-map pass (all origins x months) — for the EC2 collector.
// See docs/operations/fare-map-ec2-collector.md.
//
//   node ops/fare-map/run-full-pass.cjs              full pass (resumes an unfinished one)
//   node ops/fare-map/run-full-pass.cjs --dry-run --max-tasks 5   fetch 5 tasks, write nothing
//   node ops/fare-map/run-full-pass.cjs --fresh      ignore saved progress, start over
//
// Needs FARE_MAP_TABLE and either TRAVELPAYOUTS_TOKEN or TRAVELPAYOUTS_SECRET_ID
// (a Secrets Manager secret holding the token as plain text or {"token":"..."}).
// AWS access comes from the machine's IAM role; no keys on disk.

const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..', '..');
const { runFullPass } = require(path.join(root, 'backend/services/domain/fare-map/fare-map-full-pass.js'));

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
  let token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token && process.env.TRAVELPAYOUTS_SECRET_ID) token = await tokenFromSecret(process.env.TRAVELPAYOUTS_SECRET_ID);
  const result = await runFullPass({
    token,
    dryRun: has('--dry-run'),
    fresh: has('--fresh'),
    maxTasks: Number(arg('--max-tasks')) || undefined,
    intervalMs: Number(arg('--interval-ms')) || undefined,
    host: os.hostname()
  });
  // Exit codes: 0 finished or paused cleanly, 2 stopped (see reason), 1 crashed.
  process.exitCode = result.ok ? 0 : 2;
})().catch(error => { console.error(JSON.stringify({ component: 'fare-map-full-pass', event: 'crashed', message: error.message })); process.exitCode = 1; });
