'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(BACKEND_ROOT, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function main() {
  const checks = [];
  const pass = (name) => { checks.push(name); console.log(`[PASS] ${name}`); };

  const account = read('frontend/account.html');
  const myTrips = read('frontend/my-trips.html');
  const savedTrips = read('frontend/saved-trips.html');
  const shell = read('frontend/scripts/shell-670f.js');
  const production = read('backend/lambda.js');

  assert.match(account, /gv-canonical-account-route" content="GV-WEB-FE-R2"/);
  assert.match(account, /rel="canonical" href="\/react\/account\/"/);
  assert.match(account, /'\/react\/account\/' \+ window\.location\.search \+ window\.location\.hash/);
  assert.match(account, /window\.location\.replace\(target\)/);
  pass('legacy Account preserves query/hash and redirects to canonical React Account');

  for (const html of [myTrips, savedTrips]) {
    assert.match(html, /gv-canonical-my-trips-route" content="GV-WEB-FE-R2"/);
    assert.match(html, /rel="canonical" href="\/react\/my-trips\/"/);
    assert.match(html, /'\/react\/my-trips\/' \+ window\.location\.search \+ window\.location\.hash/);
    assert.match(html, /window\.location\.replace\(target\)/);
  }
  pass('legacy My Trips entry points redirect to canonical React My Trips');

  assert.match(shell, /root\('react\/account\/'\)/);
  assert.match(shell, /root\('react\/my-trips\/'\)/);
  assert.match(shell, /staging\.dy4fw8gx1ccie\.amplifyapp\.com\/react\/account\//);
  assert.doesNotMatch(shell, /root\('account\.html'\)/);
  assert.doesNotMatch(shell, /root\('my-trips\.html'\)/);
  pass('classic shell links directly to canonical React Account and My Trips');

  assert.doesNotMatch(production, /GV-WEB-FE-R2|gv-canonical-account-route|gv-canonical-my-trips-route/);
  pass('FE-R2 is frontend-only and leaves the production Lambda untouched');

  console.log(`\nGV-WEB-FE-R2 validation PASS (${checks.length}/${checks.length})`);
}

try {
  main();
} catch (error) {
  console.error('[FAIL] GV-WEB-FE-R2 validation');
  console.error(error);
  process.exitCode = 1;
}
