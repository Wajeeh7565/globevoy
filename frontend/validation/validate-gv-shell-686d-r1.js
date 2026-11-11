'use strict';
const { promotedPageContentPreserved } = require('./page-layout-support.cjs');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const hash = (name) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const exists = (name) => fs.existsSync(path.join(root, name));
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
const release = JSON.parse(read('validation/releases/GV-SHELL-686D-R1-RELEASE.json'));
const shell = read('scripts/shell-670f.js');
const css = read('styles/shell.css');
const header = shell.slice(shell.indexOf('const accountNavigation'), shell.indexOf('const footer'));

const shellPages = [
  'about.html', 'booking.html', 'create-account.html', 'explore.html',
  'how-it-works.html', 'index.html', 'mixed-results.html', 'multi-city-trip.html',
  'multi-city.html', 'multicity-visualizer.html', 'saved-trips.html',
  'sign-in.html', 'trip.html', 'trust.html'
];

check('Release is pinned to authenticated GV-RC-686D', release.release === 'GV-SHELL-686D-R1' && release.authoritativeBaselineSha256 === 'cac8de2a870c4edca3393e358c6559d16a59607d473da43efd7e0b57ad10b3c4');
check('Historical 686D release records no deployment or backend/provider/auth change', release.deploymentPerformed === false && release.frontendOnly === true && release.backendChanged === false && release.lambdaChanged === false && release.providerChanged === false && release.authenticationChanged === false);
check('Shared shell preserves the 686D-R1 visual runtime and identifies the 705B-R3 account successor', shell.includes('GV-SHELL-686D-R1') && shell.includes("dataset.gvShellVersion = '686d-r1'") && shell.includes("dataset.gvAccountVersion = '705b-r3'") && shell.includes("dataset.gvUnifiedAccountHeader = 'GV-WEB-FE-R3.1B'"));
check('Header contains brand and the unified account navigation only', header.includes('class="gv-brand"') && header.includes('class="gv-account-nav"') && !header.includes('gv-account-nav__trips') && header.includes('gv-account-nav__menu') && header.includes('data-gv-auth-signin') && header.includes('data-gv-auth-signout'));
check('Header center navigation is absent', !header.includes('gv-nav') && !header.includes('Plan a trip') && !header.includes('Explore') && !header.includes('How it works') && !header.includes('Trust'));
check('No active-page underline remains in shell CSS', !css.includes('.gv-nav') && !css.includes('.is-active:after'));
check('No hamburger or mobile menu is introduced', !shell.includes('gv-burger') && !shell.includes('gv-mobile-menu') && !css.includes('.gv-burger'));
check('Logo returns to the canonical homepage', header.includes('class="gv-brand"') && header.includes("root('index.html')") && header.includes('aria-label="Globevoy home"'));
check('Account-aware header keeps canonical React Account, My Trips and Travel Profile destinations', shell.includes('const accountBaseHref =') && shell.includes("root('react/account/')") && shell.includes("root('react/my-trips/')") && shell.includes("root('react/travel-profile/')") && header.includes('Account details') && header.includes('Travel profile'));
check('Mobile keeps compact account-aware controls with accessible account menu and sign-in action', header.includes('gv-account-nav__signin') && header.includes('aria-label="Open account menu for ${safeAccountIdentity}"') && css.includes('.gv-account-nav__menu>summary>span:nth-child(2){display:none}'));
check('Header is lower weight and compact', css.includes('--gv-header-h:60px') && css.includes('box-shadow:0 6px 18px') && css.includes('justify-content:space-between'));
check('Logo and account controls remain mobile tap targets', css.includes('min-height:44px') && css.includes('min-height:40px'));
check('Keyboard focus states are explicit', css.includes('.gv-brand:focus-visible') && css.includes('.gv-account-nav a:focus-visible') && css.includes('.gv-account-nav summary:focus-visible'));
check('Shell still prevents page-level horizontal overflow', css.includes('body.gv-canonical{overflow-x:hidden!important'));
check('All canonical shell pages load the FE-R3.1B cache-busted shared shell', shellPages.every((name) => { const value = read(name); return value.includes('shell.css?v=fe-r3-1b') && value.includes('shell-670f.js?v=fe-r3-1b'); }));
check('Footer preserves secondary Plan, Learn and Legal links', ['Start a trip', 'Explore destinations', 'How it works', 'Trust and pricing', 'Privacy', 'Terms', 'Affiliate disclosure'].every((label) => shell.includes(label)));
check('Legal content is preserved after consolidation into public root pages', ['privacy.html','terms.html','affiliate.html'].every(name => promotedPageContentPreserved(name)));
check('Travel profile remains browser-local with no password field', read('create-account.html').includes('stored only in this browser') && !/type=["']password/i.test(read('create-account.html')));
check('Sign-in boundary delegates to Cognito and has no password form', read('sign-in.html').includes('Amazon Cognito') && read('sign-in.html').includes('data-gv-auth-signin') && read('sign-in.html').includes('Continue as guest') && !/<form\b/i.test(read('sign-in.html')) && !/type=["']password/i.test(read('sign-in.html')));
check('Legacy redirect remains unchanged', read('multi-city.html').includes("'multicity-visualizer.html'+location.search+location.hash"));
check('Journey engines remain byte-identical to 686D', hash('scripts/multicity-visualizer-674a.js') === '7013b0777f21acddf9c01749fe035691f21d89101d81e84a6b7ed1627ca55dd4' && hash('scripts/journey-experience-686b.js') === 'd7b80b586b69e8fc1718dc8f6a785cb30fa11c77e49b79f6c2660f4bdbac0ef7');
check('Booking engines remain byte-identical to 686D', hash('scripts/booking-hub-685d.js') === '6344ffad400d52dbce0d5d104ea41b86e6bd39394377e028936ba5be7809236a' && hash('scripts/booking-workspace-686c.js') === 'ce9ac87a8cd091becf202bf25edc3e0364025b88690a478e365ad9982fafce01');
check('Budget and evidence runtime remains byte-identical to 686D', hash('scripts/budget-confidence-685b.js') === '3ed77e95f240096f6d241499c1e0b517a1f97c77ae855bb9c85d0098f54eb832');
check('API client and legacy runtime configuration remain byte-identical to 686D', hash('runtime/api-client.js') === 'd10d716b60d13f36b456a7797c22590ba5ca1c12bec31586d8e0c36242df8af6' && hash('runtime/config.js') === '191e377fdf5dba312e60f0b2c21c74b6283b729c982bcbff8c7c08fd637ea958');
check('Shared shell itself makes no network request', !/\bfetch\s*\(|XMLHttpRequest|WebSocket/.test(shell));
check('Required desktop and mobile screenshots are packaged', exists('screenshots/gv-shell-686d-r1-desktop-home.jpg') && exists('screenshots/gv-shell-686d-r1-mobile-home-375.jpg'));
check('Package contains no backend or Lambda runtime', !fs.readdirSync(root, { withFileTypes: true }).some((entry) => entry.isDirectory() && /^(backend|lambda|server|serverless)$/i.test(entry.name)));

const master = spawnSync(process.execPath, [path.join(root, 'validation/validate-gv-rc-686d.js')], { cwd: root, encoding: 'utf8' });
check('Inherited 686D master remains fully green under the 705B-R3 successor', master.status === 0 && master.stdout.includes('total=51 pass=51 fail=0'), master.stderr || master.stdout);

checks.forEach((item, index) => console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}${item.pass || !item.detail ? '' : ` :: ${String(item.detail).trim().split(/\r?\n/).slice(-1)[0]}`}`));
const passed = checks.filter((item) => item.pass).length;
console.log(`GV-SHELL-686D-R1: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;
