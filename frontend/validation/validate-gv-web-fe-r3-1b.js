'use strict';
const { frontendSourcePath } = require('../../ops/frontend/source-layout.cjs');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(frontendSourcePath(ROOT, relative), 'utf8');

function main() {
  const shell = read('scripts/shell-670f.js');
  const css = read('styles/shell.css');
  const auth = read('scripts/auth-session-705b-r3.js');
  const pages = [
    // GV-WEB-2/3: index.html, results.html, multi-city-trip.html and booking.html use the
    // new design's own header; explore, mixed-results, multi-city and multicity-visualizer are redirects.
    'about.html','create-account.html','how-it-works.html',
    'saved-trips.html','sign-in.html','trip.html','trust.html'
  ];
  const pass = (name) => console.log(`[PASS] ${name}`);

  assert.match(shell, /GV-WEB-FE-R3\.1B unified account header/);
  assert.match(shell, /dataset\.gvUnifiedAccountHeader = 'GV-WEB-FE-R3\.1B'/);
  pass('classic shell declares the unified account-header successor');

  for (const token of [
    'class="gv-account-nav"',
    'gv-account-nav__menu',
    'gv-account-nav__avatar',
    'gv-account-nav__identity',
    'gv-account-nav__item',
    'gv-account-nav__signout',
    'data-gv-auth-signin',
    'data-gv-auth-signout'
  ]) assert.ok(shell.includes(token), `missing classic account-nav token: ${token}`);
  assert.doesNotMatch(shell, /class="gv-account-nav__trips"/);
  pass('classic signed-in and signed-out controls use one Account menu without a duplicate My Trips shortcut');

  assert.ok(shell.includes("root('react/account/')"));
  assert.ok(shell.includes("root('react/my-trips/')"));
  assert.ok(shell.includes("root('react/travel-profile/')"));
  pass('classic account links use canonical React Account, My Trips and Travel Profile routes');

  assert.match(shell, /function escapeHtml\(value\)/);
  assert.match(shell, /safeAccountIdentity = escapeHtml\(accountIdentity\)/);
  assert.match(shell, /safeCurrentReturnTo = escapeHtml\(currentReturnTo\)/);
  pass('session identity and sign-in return path are escaped before header HTML insertion');

  assert.match(auth, /data-gv-auth-signin/);
  assert.match(auth, /data-gv-auth-signout/);
  assert.match(auth, /beginSignIn\(\{ returnTo:/);
  assert.match(auth, /function signOut\(\)/);
  pass('unified classic controls reuse the established Cognito auth runtime');

  for (const selector of [
    '.gv-account-nav{',
    '.gv-account-nav__menu>summary',
    '.gv-account-nav__panel{',
    '.gv-account-nav__identity-avatar',
    '.gv-account-nav__item-icon',
    '.gv-account-nav__signout'
  ]) assert.ok(css.includes(selector), `missing classic account-nav style: ${selector}`);
  pass('classic shell carries matching account menu styling and responsive rules');

  for (const page of pages) {
    const html = read(page);
    assert.ok(html.includes('shell.css?v=fe-r3-1b'), `${page} missing FE-R3.1B CSS cache key`);
    assert.ok(html.includes('shell-670f.js?v=fe-r3-1b'), `${page} missing FE-R3.1B JS cache key`);
  }
  pass('all canonical classic pages cache-bust the unified shell');

  assert.doesNotMatch(shell, /Book now|Pay now|Complete purchase/);
  pass('header consolidation adds no booking or payment capability');

  console.log('\nGV-WEB-FE-R3.1B validation PASS (8/8)');
}

try {
  main();
} catch (error) {
  console.error('[FAIL] GV-WEB-FE-R3.1B validation');
  console.error(error);
  process.exitCode = 1;
}
