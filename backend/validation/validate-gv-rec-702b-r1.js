'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert = require('assert');

const STAGING_ORIGIN = 'https://staging.example.amplifyapp.com';
const AS_OF = '2026-08-20T12:00:00.000Z';
process.env.CORS_ORIGIN = `${STAGING_ORIGIN}/`;
process.env.ENABLE_GLOBAL_RECOVERY_PRIORITY_702B = 'true';

const staging = require('../staging-lambda');

function event(query = {}) {
  return {
    rawPath: '/api/global-recovery-priority',
    headers: { Origin: STAGING_ORIGIN },
    queryStringParameters: query,
    requestContext: { http: { method: 'GET' } }
  };
}

(async () => {
  const response = await staging.handler(event({ asOf: AS_OF }));
  const body = JSON.parse(response.body || '{}');

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(body.apiVersion, 'GV-REC-702B');
  assert.strictEqual(body.priorityVersion, 'GV-REC-702B');
  assert.strictEqual(body.status, 'recovery-priority-ready');
  assert.strictEqual(body.asOf, AS_OF);
  assert.strictEqual(body.counts.mappedReviewedInactive, 431);
  assert.strictEqual(body.counts.previousRecoverySurvivors, 132);
  assert.strictEqual(body.counts.notPreviouslyRecoveryAudited, 299);
  assert.strictEqual(body.counts.reviewDue, 143);
  assert.strictEqual(body.lanes['due-now-first-recovery'], 143);
  assert.strictEqual(body.lanes['approaching-review'], 156);
  assert.strictEqual(body.lanes['defer-recent-recovery'], 132);
  assert.ok(!Array.isArray(body.records));

  console.log('GV-REC-702B-R1: asOf-only summary routing PASS');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
