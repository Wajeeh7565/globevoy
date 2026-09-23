import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), 'web');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const checks = [];
const check = (name, pass) => {
  checks.push({ name, pass: Boolean(pass) });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
};

const shell = read('components/app-shell.tsx');
const globals = read('app/globals.css');
const account = read('components/account/account-page-client.tsx');
const trips = read('components/account/my-trips-client.tsx');
const profile = read('components/account/travel-profile-client.tsx');
const accountNav = read('components/account/account-nav.tsx');

check('React shell declares GV-WEB-FE-R3', shell.includes('data-gv-shell-version="GV-WEB-FE-R3"'));
check('React brand returns to canonical planner root', shell.includes('<a className="gv-brand" href="/" aria-label="Globevoy home">'));
check('React footer carries the same Plan, Learn and Legal information architecture',
  ['Start a trip','Explore destinations','Travel profile','My Trips','Account','How it works','Trust and pricing','About Globevoy','Privacy','Terms','Affiliate disclosure']
    .every((label) => shell.includes(label)));
check('React footer preserves pricing and affiliate boundary copy',
  shell.includes('Prices, availability and booking details can change') &&
  shell.includes('referral commission'));
check('Shared shell tokens match classic dimensions',
  globals.includes('--gv-header-h:60px') &&
  globals.includes('--gv-shell:1280px') &&
  globals.includes('.gv-footer__top') &&
  globals.includes('.gv-footer__bottom'));
check('React account guest action returns to canonical planner',
  account.includes('<a className="gv-button gv-button--secondary" href="/">Continue as guest</a>'));
check('React My Trips planning actions return to canonical planner',
  trips.includes('href="/">Keep exploring</a>') &&
  trips.includes('href="/">+ Plan another trip</a>') &&
  trips.includes('href="/">Explore trips</a>'));
check('React Travel Profile guest action returns to canonical planner',
  profile.includes('<a className="gv-button gv-button--secondary" href="/">Continue as guest</a>'));
check('React account header keeps My Trips inside the Account menu only',
  accountNav.includes('<strong>My trips</strong>') &&
  !accountNav.includes('className="gv-account-nav__trips"'));

check('FE-R3 does not add booking/payment language to shell',
  !shell.includes('Book now') && !shell.includes('Pay now') && !shell.includes('Complete purchase'));

const passed = checks.filter((item) => item.pass).length;
console.log(`\nGV-WEB-FE-R3: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;
