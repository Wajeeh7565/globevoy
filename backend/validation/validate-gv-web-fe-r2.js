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

  const account = read('frontend/pages/account.html');
  const myTrips = read('frontend/pages/my-trips.html');
  const savedTrips = read('frontend/pages/saved-trips.html');
  const shell = read('frontend/scripts/shell-670f.js');
  const production = read('backend/lambda.js');

  assert.match(account, /gv-canonical-account-route" content="GV-WEB-FE-R2"/);
  assert.match(account, /rel="canonical" href="\/react\/account\/"/);
  assert.match(account, /'\/react\/account\/' \+ window\.location\.search \+ window\.location\.hash/);
  assert.match(account, /window\.location\.replace\(target\)/);
  pass('legacy Account preserves query/hash and redirects to canonical React Account');

  // GV-WEB-4: saved trips were removed from the website; the old My Trips addresses open Account.
  for (const html of [myTrips, savedTrips]) {
    assert.match(html, /gv-canonical-my-trips-route" content="GV-WEB-4"/);
    assert.match(html, /rel="canonical" href="\/react\/account\/"/);
    assert.match(html, /'\/react\/account\/' \+ window\.location\.search \+ window\.location\.hash/);
    assert.match(html, /window\.location\.replace\(target\)/);
  }
  pass('legacy My Trips entry points preserve query/hash and redirect to canonical React Account');

  assert.match(shell, /root\('react\/account\/'\)/);
  assert.doesNotMatch(shell, /root\('react\/my-trips\/'\)/);
  assert.match(shell, /window\.GLOBEVOY_ENVIRONMENT_POLICY\?\.stagingOrigin/);
  assert.match(shell, /\$\{stagingOrigin\}\/react\/account\//);
  assert.equal(require(path.join(ROOT, 'frontend/runtime/environment-policy.js')).stagingOrigin, 'https://staging.dy4fw8gx1ccie.amplifyapp.com');
  assert.doesNotMatch(shell, /root\('account\.html'\)/);
  assert.doesNotMatch(shell, /root\('my-trips\.html'\)/);
  pass('classic shell links directly to canonical React Account and has no My Trips link');

  assert.doesNotMatch(production, /GV-WEB-FE-R2|GV-WEB-4|gv-canonical-account-route|gv-canonical-my-trips-route/);
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
