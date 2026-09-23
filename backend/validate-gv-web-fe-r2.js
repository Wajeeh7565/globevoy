'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function main() {
  const checks = [];
  const pass = (name) => { checks.push(name); console.log(`[PASS] ${name}`); };

  const account = read('frontend/account.html');
  const myTrips = read('frontend/my-trips.html');
  const savedTrips = read('frontend/saved-trips.html');
  const classicShell = read('frontend/scripts/shell-670f.js');
  const reactShell = read('web/components/app-shell.tsx');
  const reactAccount = read('web/components/account/account-page-client.tsx');
  const reactTrips = read('web/components/account/my-trips-client.tsx');
  const production = read('backend/lambda.js');

  assert.match(account, /gv-canonical-account-route" content="GV-WEB-FE-R2"/);
  assert.match(account, /rel="canonical" href="\/react\/account\/"/);
  assert.match(account, /window\.location\.replace\(target\)/);
  assert.match(account, /'\/react\/account\/' \+ window\.location\.search \+ window\.location\.hash/);
  pass('legacy account URL redirects to the canonical React Account while preserving query and hash');

  for (const html of [myTrips, savedTrips]) {
    assert.match(html, /gv-canonical-my-trips-route" content="GV-WEB-FE-R2"/);
    assert.match(html, /rel="canonical" href="\/react\/my-trips\/"/);
    assert.match(html, /window\.location\.replace\(target\)/);
    assert.match(html, /'\/react\/my-trips\/' \+ window\.location\.search \+ window\.location\.hash/);
  }
  pass('legacy My Trips entry points redirect to the canonical React My Trips route');

  assert.match(classicShell, /root\('react\/account\/'\)/);
  assert.match(classicShell, /root\('react\/my-trips\/'\)/);
  assert.match(classicShell, /staging\.dy4fw8gx1ccie\.amplifyapp\.com\/react\/account\//);
  assert.doesNotMatch(classicShell, /root\('account\.html'\)/);
  assert.doesNotMatch(classicShell, /root\('my-trips\.html'\)/);
  pass('classic shell links directly to canonical Account and My Trips routes');

  assert.match(reactShell, /<a className="gv-brand" href="\/" aria-label="Globevoy home">/);
  assert.doesNotMatch(reactShell, /<Link className="gv-brand" href="\/" aria-label="Globevoy home">/);
  assert.match(reactAccount, /<a className="gv-button gv-button--secondary" href="\/">Continue as guest<\/a>/);
  assert.match(reactTrips, /href="\/">Keep exploring<\/a>/);
  assert.match(reactTrips, /href="\/">\+ Plan another trip<\/a>/);
  assert.match(reactTrips, /href="\/">Explore trips<\/a>/);
  pass('React account surfaces return planning actions to the existing classic planner');

  assert.doesNotMatch(production, /GV-WEB-FE-R2|canonical-my-trips-route|canonical-account-route/);
  pass('FE-R2 changes frontend routing only and leave production Lambda untouched');

  console.log(`\nGV-WEB-FE-R2 validation PASS (${checks.length}/${checks.length})`);
}

try {
  main();
} catch (error) {
  console.error('[FAIL] GV-WEB-FE-R2 validation');
  console.error(error);
  process.exitCode = 1;
}
