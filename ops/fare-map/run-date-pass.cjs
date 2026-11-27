#!/usr/bin/env node
'use strict';
// Collector date pass (GV-DATA-DATES-003) for the EC2 collector, after the main pass.
// Runs after the main pass at every collector boot (globevoy-fare-map.service).
// A pass stopped by --max-minutes or --max-requests resumes at the next run (META#job / date-pass).
//
//   node ops/fare-map/run-date-pass.cjs --dry-run --max-requests 20     fetch 20, write nothing
//   node ops/fare-map/run-date-pass.cjs --routes 30 --max-minutes 900   full run (paced, free API)
//   --fresh ignores saved progress; --sample prints three records.
//
// Needs FARE_MAP_TABLE and TRAVELPAYOUTS_TOKEN or TRAVELPAYOUTS_SECRET_ID, like run-full-pass.
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const { runDatePass } = require(path.join(root, 'backend/services/domain/fare-map/fare-map-date-pass.js'));
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
  if (!has('--force') && !has('--dry-run') && String(process.env.FARE_MAP_DATE_PASS || '').trim().toLowerCase() !== 'on') { console.log(JSON.stringify({ component: 'fare-map-date-pass', event: 'skipped', reason: 'FARE_MAP_DATE_PASS is not on' })); return; }
  let token = process.env.TRAVELPAYOUTS_TOKEN;
  if (!token && process.env.TRAVELPAYOUTS_SECRET_ID) token = await tokenFromSecret(process.env.TRAVELPAYOUTS_SECRET_ID);
  if (!token) { console.error('No Travelpayouts token.'); process.exit(2); }
  const origins = arg('--origins') ? arg('--origins').split(',').map(s => s.trim().toUpperCase()) : undefined;
  const t0 = Date.now();
  const stats = await runDatePass({ token, origins, dryRun: has('--dry-run'), fresh: has('--fresh'), sample: has('--sample'), routes: arg('--routes'), maxRequests: arg('--max-requests'),
    maxMinutes: arg('--max-minutes'), perMinute: arg('--per-minute'), log: x => console.log(JSON.stringify({ component: 'fare-map-date-pass', ...x })) });
  console.log(JSON.stringify({ component: 'fare-map-date-pass', event: stats.stoppedBy ? 'paused' : 'finished', minutes: +((Date.now() - t0) / 60000).toFixed(1), ...stats }));
})().catch(e => { console.error(e.message); process.exit(1); });
