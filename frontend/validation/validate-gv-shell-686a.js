'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const hash = (name) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
const checks = [];
const check = (name, pass) => checks.push({ name, pass: Boolean(pass) });

const shell = read('scripts/shell-670f.js');
const shellCss = read('styles/shell.css');
const home = read('index.html');
const signIn = read('sign-in.html');
const saved = read('saved-trips.html');
const legacy = read('multi-city.html');
const visualizer = read('multicity-visualizer.html');
const mixed = read('mixed-results.html');
const mixedRuntime = read('scripts/mixed-results-674a.js');
const headerTemplate = shell.slice(shell.indexOf('const header'), shell.indexOf('const footer'));

check('Shared shell preserves approved 686D-R1 visual baseline with 705B-R3 account successor', shell.includes('GV-SHELL-686D-R1') && shell.includes("dataset.gvShellVersion = '686d-r1'") && shell.includes("dataset.gvAccountVersion = '705b-r3'"));
check('Header preserves home brand with the approved unified account-nav mount', headerTemplate.includes('class="gv-brand"') && headerTemplate.includes('data-gv-shell-account-nav') && shell.includes('class="gv-account-nav"') && !headerTemplate.includes('class="gv-nav"'));
check('Travel profile, My Trips and Account use the canonical React account surfaces', shell.includes("root('react/travel-profile/')") && shell.includes("root('react/my-trips/')") && shell.includes("root('react/account/')") && shell.includes('data-gv-auth-signin') && shell.includes('data-gv-auth-signout'));
check('Removed navigation is not replaced by a mobile menu', !headerTemplate.includes('gv-burger') && !headerTemplate.includes('gv-mobile-menu') && !headerTemplate.includes('aria-expanded'));
check('Minimal header is compact and keeps mobile profile visible', shellCss.includes('--gv-header-h:60px') && shellCss.includes('.gv-auth__short{display:none}') && !shellCss.includes('.gv-burger'));
check('Shared shell defines consolidated colour and surface tokens', ['--gv-navy:', '--gv-teal:', '--gv-amber:', '--gv-canvas:', '--gv-border:'].every((token) => shellCss.includes(token)));
check('Homepage uses canonical shared shell', home.includes('shell.css?v=686d-r1') && /shell-670f\.js\?v=(?:686d-r1|705b-r3)/.test(home) && !home.includes('data-simple-nav="true"'));
check('Homepage has no page-level fake authentication form', !/type=["']password/i.test(home) && home.includes('Create travel profile'));
check('Account boundary has no login form or password input', !/<form\b/i.test(signIn) && !/type=["']password/i.test(signIn));
check('Account boundary now delegates secure authentication to Cognito', signIn.includes('Amazon Cognito') && signIn.includes('data-gv-auth-signin') && signIn.includes('Continue as guest'));
check('Account return is restricted to the current origin', signIn.includes('target.origin !== location.origin') && signIn.includes('target.pathname + target.search + target.hash'));
check('Saved trips does not expose a design-reference redirect', !saved.includes('http-equiv="refresh"') && !saved.includes('pages/saved-trips.html'));
check('Legacy multi-city URL preserves query and hash', legacy.includes("'multicity-visualizer.html'+location.search+location.hash"));
check('Generated-trip loading explains four stages', ['Finding suitable cities', 'Connecting the route', 'Checking price evidence', 'Preparing your trip'].every((stage) => visualizer.includes(stage)));
check('Generated-trip shell uses current map language', visualizer.includes('Preparing route map…') && !visualizer.includes('Loading route map…'));
check('Mixed results retains honest travel-profile action without password UI', mixed.includes('Create travel profile') && !/type=["']password/i.test(mixed));
check('Mixed-results runtime retains return path for local profile', mixedRuntime.includes('create-account.html?return='));
check('How, Trust and About are canonical root pages', ['how-it-works.html', 'trust.html', 'about.html'].every((name) => { const value = read(name); return /shell-670f\.js\?v=(?:686d-r1|705b-r3)/.test(value) && !value.includes('http-equiv="refresh"'); }));
check('Booking engine remains byte-identical to trusted R2', hash('scripts/booking-hub-685d.js') === '6344ffad400d52dbce0d5d104ea41b86e6bd39394377e028936ba5be7809236a');
check('Budget-confidence engine remains byte-identical to trusted R2', hash('scripts/budget-confidence-685b.js') === '3ed77e95f240096f6d241499c1e0b517a1f97c77ae855bb9c85d0098f54eb832');
// Superseded final-state assertion: 686B intentionally extended the generated-tour
// engine after the shell release. The cumulative RC must preserve that approved engine.
check('Generated-tour engine matches approved 686B final state', hash('scripts/multicity-visualizer-674a.js') === '7013b0777f21acddf9c01749fe035691f21d89101d81e84a6b7ed1627ca55dd4');

checks.forEach((item, index) => console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}`));
const passed = checks.filter((item) => item.pass).length;
console.log(`GV-SHELL-686A: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;
