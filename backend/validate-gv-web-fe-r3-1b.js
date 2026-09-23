'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');

function main() {
  const checks = [];
  const pass = (name) => { checks.push(name); console.log(`[PASS] ${name}`); };

  const classicShell = read('frontend/scripts/shell-670f.js');
  const classicAuth = read('frontend/scripts/auth-session-705b-r3.js');
  const classicCss = read('frontend/styles/shell.css');
  const reactNav = read('web/components/account/account-nav.tsx');
  const reactBaseCss = read('web/app/account-707a.css');
  const reactMenuCss = read('web/app/account-menu-710f-r2w.css');
  const production = read('backend/lambda.js');

  assert.match(classicShell, /GlobevoyShellAccountNavR31B/);
  assert.match(classicShell, /version: 'GV-WEB-FE-R3\.1B'/);
  assert.match(classicShell, /data-gv-shell-account-nav/);
  assert.match(classicShell, /dataset\.gvUnifiedAccountNav = 'r3-1b'/);
  pass('classic shell declares the FE-R3.1B unified account navigation successor');

  for (const token of [
    'gv-account-nav',
    'gv-account-nav__trips',
    'gv-account-nav__signin',
    'gv-account-nav__menu',
    'gv-account-nav__avatar',
    'gv-account-nav__panel',
    'gv-account-nav__identity',
    'gv-account-nav__item',
    'gv-account-nav__signout'
  ]) {
    assert(classicShell.includes(token), `classic shell missing ${token}`);
    assert(reactNav.includes(token), `React nav missing ${token}`);
  }
  pass('classic and React headers use the same account navigation component vocabulary');

  for (const label of ['My Trips', 'Signed in as', 'Travel profile', 'My trips', 'Account details', 'Sign out']) {
    assert(classicShell.includes(label), `classic shell missing ${label}`);
    assert(reactNav.includes(label), `React nav missing ${label}`);
  }
  pass('classic and React signed-in account menus expose the same user-facing destinations');

  assert.match(classicShell, /root\('react\/account\/'\)/);
  assert.match(classicShell, /root\('react\/my-trips\/'\)/);
  assert.match(classicShell, /root\('react\/travel-profile\/'\)/);
  pass('classic header routes account actions to the same canonical React surfaces');

  assert.match(classicShell, /data-gv-auth-signin/);
  assert.match(classicShell, /data-gv-auth-signout/);
  assert.match(classicAuth, /GlobevoyShellAccountNavR31B\?\.render/);
  assert.match(classicAuth, /GlobevoyShellAccountNavR31B\.render\(session\)/);
  pass('verified Cognito session changes re-render the classic header instead of leaving stale auth UI');

  for (const selector of [
    '.gv-account-nav{',
    '.gv-account-nav__menu>summary',
    '.gv-account-nav__avatar',
    '.gv-account-nav__panel',
    '.gv-account-nav__identity-avatar',
    '.gv-account-nav__panel>a.gv-account-nav__item',
    '.gv-account-nav__panel>button.gv-account-nav__signout'
  ]) {
    assert(classicCss.includes(selector), `classic CSS missing ${selector}`);
    assert(reactBaseCss.includes(selector) || reactMenuCss.includes(selector), `React CSS missing ${selector}`);
  }
  pass('classic shell carries the same account-nav styling primitives as React');

  assert.doesNotMatch(production, /GV-WEB-FE-R3\.1B|GlobevoyShellAccountNavR31B|gvUnifiedAccountNav/);
  pass('FE-R3.1B remains frontend-only and leaves production Lambda untouched');

  const master = spawnSync(process.execPath, [path.join(ROOT, 'frontend/validation/validate-gv-rc-686d.js')], {
    cwd: path.join(ROOT, 'frontend'),
    encoding: 'utf8'
  });
  if (master.status !== 0) {
    console.error(master.stdout || '');
    console.error(master.stderr || '');
  }
  assert.equal(master.status, 0);
  assert.match(master.stdout, /GV-RC-686D MASTER: total=51 pass=51 fail=0/);
  pass('cumulative 686D product shell regression remains green under FE-R3.1B');

  console.log(`\nGV-WEB-FE-R3.1B validation PASS (${checks.length}/${checks.length})`);
}

try {
  main();
} catch (error) {
  console.error('[FAIL] GV-WEB-FE-R3.1B validation');
  console.error(error);
  process.exitCode = 1;
}
