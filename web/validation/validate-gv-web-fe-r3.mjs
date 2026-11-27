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
const profile = read('components/account/travel-profile-client.tsx');
const accountNav = read('components/account/account-nav.tsx');

// GV-WEB-4: the React shell uses the same header and footer as the classic pages (Cinematic Explorer design).
check('React shell declares GV-WEB-4', shell.includes('data-gv-shell-version="GV-WEB-4"'));
check('React brand returns to canonical planner root', shell.includes('<a className="cx-brand" href="/" aria-label="GlobeVoy home">'));
check('React footer matches the classic footer (About, Privacy, Terms)',
  ['About','Privacy','Terms'].every((label) => shell.includes(`>${label}</a>`)) &&
  shell.includes('You book directly with the airline and hotel partners.'));
check('Shared shell tokens match classic dimensions',
  globals.includes('--gv-header-h:60px') &&
  globals.includes('--gv-shell:1280px') &&
  globals.includes('.gv-footer__top') &&
  globals.includes('.gv-footer__bottom'));
check('React account guest action returns to canonical planner',
  account.includes('<a className="cx-button" href="/">Keep searching as a guest</a>'));
check('React Travel Profile guest action returns to canonical planner',
  profile.includes('<a className="cx-button" href="/">Keep searching as a guest</a>'));
check('React account menu has Account, Travel Profile and Sign out, and no My Trips (saved trips removed)',
  accountNav.includes('href="/react/account/">Account</a>') && accountNav.includes('href="/react/travel-profile/">Travel Profile</a>') &&
  accountNav.includes('onClick={signOut}') && !/my-trips|My trips/i.test(accountNav));
check('React guests open the GlobeVoy sign-in page', accountNav.includes('/sign-in.html?returnTo='));

check('FE-R3 does not add booking/payment language to shell',
  !shell.includes('Book now') && !shell.includes('Pay now') && !shell.includes('Complete purchase'));

const passed = checks.filter((item) => item.pass).length;
console.log(`\nGV-WEB-FE-R3: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;
