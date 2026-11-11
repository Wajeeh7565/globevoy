'use strict';
const { frontendSourcePath } = require('../../ops/frontend/source-layout.cjs');
const outputPath = require('./output-path');
const FRONTEND_ROOT = require('node:path').resolve(__dirname, '..');
const fs = require('fs');
const path = require('path');
const root = FRONTEND_ROOT;
const read = p => fs.readFileSync(frontendSourcePath(root, p), 'utf8');
const checks = [];
function check(name, passed) {
  checks.push({ name, passed: Boolean(passed) });
  console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}`);
  if (!passed) process.exitCode = 1;
}
const index = read('index.html');
const home = read('scripts/home-live-674a.js');
const css = read('styles/live.css');
check('R1 release marker is present', index.includes('GV-BOOK-676A-R1'));
check('native datalist trigger is removed', !/id="gv-origin"[^>]*\slist=/.test(index));
check('origin input is an accessible combobox', /id="gv-origin"[^>]*role="combobox"[^>]*aria-controls="gv-origin-menu"/.test(index));
check('custom listbox is present', index.includes('id="gv-origin-menu"') && index.includes('role="listbox"'));
check('menu is vertically scrollable', css.includes('.gv-origin-menu') && /max-height:\s*286px/.test(css) && /overflow-y:\s*auto/.test(css));
check('mobile menu has bounded height', /@media\(max-width:600px\)\{\.gv-origin-menu\{top:66px;max-height:240px\}\}/.test(css));
check('native datalist creation is absent', !home.includes("createElement('datalist')"));
check('suggestions remain searchable', home.includes('Origins.matching(value).slice(0, 80)'));
check('mouse selection is supported', home.includes("option.addEventListener('click', () => selectOriginOption(index))"));
check('keyboard arrow navigation is supported', home.includes("event.key === 'ArrowDown'") && home.includes("event.key === 'ArrowUp'"));
check('keyboard selection is supported', home.includes('selectOriginOption(activeOriginIndex >= 0 ? activeOriginIndex : 0)'));
check('active option scrolls into view', home.includes("scrollIntoView({ block: 'nearest' })"));
check('escape and outside click close the menu', home.includes('closeOriginMenu()') && home.includes("!event.target.closest('#gv-origin-menu')"));
check('R1 cache-busting references are active or superseded', (index.includes('live.css?v=676a-r1') && index.includes('home-live-674a.js?v=676a-r1')) || (index.includes('live.css?v=680b-r1') && index.includes('home-live-674a.js?v=680b-r1')));
const result = {
  release: 'GV-BOOK-676A-R1',
  generatedAt: new Date().toISOString(),
  passed: !process.exitCode,
  checkCount: checks.length,
  passedCount: checks.filter(x => x.passed).length,
  failedCount: checks.filter(x => !x.passed).length,
  checks
};
fs.writeFileSync(outputPath('VALIDATION_GV_BOOK_676A_R1_FRONTEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-BOOK-676A-R1 frontend validation failed.');
console.log(`GV-BOOK-676A-R1 frontend validation passed (${result.passedCount}/${result.checkCount}).`);
