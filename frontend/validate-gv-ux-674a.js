'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const checks = [];
function check(name, passed, details = null) {
  checks.push({ name, passed: Boolean(passed), details });
  console.log(`${passed ? '[PASS]' : '[FAIL]'} ${name}${details ? ` - ${JSON.stringify(details)}` : ''}`);
  if (!passed) process.exitCode = 1;
}

const index = read('index.html');
const visualizer = read('multicity-visualizer.html');
const mixed = read('mixed-results.html');
const home = read('scripts/home-live-674a.js');
const app = read('scripts/multicity-visualizer-674a.js');
const mixedJs = read('scripts/mixed-results-674a.js');
const css = read('styles/multi-city-visualizer-674a.css');

check('homepage release marker is 674A or superseding 675A', index.includes('GV-UX-674A') || index.includes('GV-ENTRY-675A'));
check('homepage uses adaptive-duration script', /home-live-674a\.js\?v=(674a|675a|675a-r1|676a-r1)/.test(index));
check('auto trip length no longer returns five nights', home.includes("if (tripLength.value === 'auto') return null") && !home.includes("if (tripLength.value === 'auto') return 5"));
check('homepage omits nights in adaptive mode', home.includes("params.delete('nights')") && home.includes("params.set('adaptiveDuration', 'true')"));
check('explicit and exact durations are sent to backend', home.includes("params.set('totalNights', String(state.nights))") && home.includes("params.set('adaptiveDuration', 'false')"));
check('mixed-results auto edit no longer forces five nights', mixed.includes('mixed-results-674a.js?v=674a') && mixedJs.includes("params.delete('nights')") && !mixedJs.includes("selectedLength === 'auto' ? '5'"));
check('visualizer release marker is 674A or superseding 675A', visualizer.includes('GV-UX-674A') || visualizer.includes('GV-ENTRY-675A'));
check('visualizer uses 674A JavaScript and CSS', /multicity-visualizer-674a\.js\?v=(674a|675a|677a|677b)/.test(visualizer) && /multi-city-visualizer-674a\.css\?v=(674a|677b)/.test(visualizer));
check('add-destination card is always rendered with enabled or disabled state', app.includes('addDestinationState674A') && app.includes("+addDestinationCardHtml(t)"));
check('short trips show a longer-trip-needed card', app.includes('Longer trip needed') && app.includes('This ${nights}-night trip supports up to'));
check('shuffle requests four replacement choices', app.includes("action='replacement-options'") || app.includes("'replacement-options'"));
check('replacement choice modal is present', visualizer.includes('mcv-replacement-modal') && visualizer.includes('mcv-replacement-grid'));
check('replacement selection sends the selected city ID', app.includes('replacementCityId:button.dataset.replacementCityId'));
check('show-two-more-routes control is present', visualizer.includes('mcv-more-picks') && app.includes('loadMorePicks674A'));
check('initial automatic queries remove stale nights=5', app.includes("delete params.nights;delete params.totalNights;params.adaptiveDuration='true'"));
check('674A modal is responsive', css.includes('@media(max-width:560px)') && css.includes('.mcv-replacement-grid'));

const result = { release: 'GV-UX-674A', generatedAt: new Date().toISOString(), passed: !process.exitCode, checkCount: checks.length, passedCount: checks.filter(x => x.passed).length, failedCount: checks.filter(x => !x.passed).length, checks };
fs.writeFileSync(path.join(root, 'VALIDATION_GV_UX_674A_FRONTEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-UX-674A frontend validation failed.');
console.log(`GV-UX-674A frontend validation passed (${result.passedCount}/${result.checkCount}).`);
