'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
function read(relativePath) { return fs.readFileSync(path.join(ROOT, relativePath), 'utf8'); }

function main() {
  const wrapper = read('backend/staging-lambda-702d.js');
  const production = read('backend/lambda.js');
  const checks = [];
  const pass = (name) => { checks.push(name); console.log(`[PASS] ${name}`); };

  assert.match(wrapper, /SAVED_TRIPS_CORS_VERSION = 'GV-ACCOUNT-705C-R4'/);
  assert.match(wrapper, /function savedTripsPreflight705CR4/);
  assert.match(wrapper, /'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'/);
  assert.match(wrapper, /'Access-Control-Allow-Headers': 'Content-Type,Authorization'/);
  assert.match(wrapper, /method === 'OPTIONS' && isSavedTripsRoute/);
  pass('saved-trips route has staging-only CRUD preflight');

  assert.match(wrapper, /stagingSavedTrips705C\.STAGING_ORIGIN/);
  assert.match(wrapper, /origin !== fixedOrigin/);
  assert.match(wrapper, /'Access-Control-Allow-Origin': fixedOrigin/);
  assert.match(wrapper, /Vary: 'Origin'/);
  pass('saved-trips preflight allows only the fixed staging origin');

  assert.match(production, /'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'/);
  assert.doesNotMatch(production, /'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'/);
  pass('production CORS baseline remains unchanged');

  console.log(`\nGV-ACCOUNT-705C-R4 validation PASS (${checks.length}/${checks.length})`);
}

try { main(); } catch (error) {
  console.error('[FAIL] GV-ACCOUNT-705C-R4 validation');
  console.error(error);
  process.exitCode = 1;
}
