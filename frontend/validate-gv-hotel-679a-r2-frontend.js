'use strict';
const fs = require('fs');
const path = require('path');

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: Boolean(pass), detail: detail ?? null });
  if (!pass) process.exitCode = 1;
}

const visual = fs.readFileSync(path.join(__dirname, 'scripts', 'multicity-visualizer-674a.js'), 'utf8');
const booking = fs.readFileSync(path.join(__dirname, 'scripts', 'booking-live-673d.js'), 'utf8');
const config = fs.readFileSync(path.join(__dirname, 'runtime', 'config.js'), 'utf8');
const bookingHtml = fs.readFileSync(path.join(__dirname, 'booking.html'), 'utf8');
const visualizerHtml = fs.readFileSync(path.join(__dirname, 'multicity-visualizer.html'), 'utf8');

check('R2 frontend release marker active', config.includes('frontendVersion: "GV-HOTEL-679A-R2"'));
check('R2 cache busts changed booking assets or superseding trust script', (bookingHtml.includes('booking-live-673d.js?v=679ar2') || bookingHtml.includes('booking-live-673d.js?v=680a')) && bookingHtml.includes('booking-672b.css?v=679ar2'));
check('R2 cache bust changed visualizer asset or superseding trust script', visualizerHtml.includes('multicity-visualizer-674a.js?v=679ar2') || /multicity-visualizer-674a\.js\?v=680(?:a|b)/.test(visualizerHtml));
check('visualizer recognizes R2 results handoff metadata', visual.includes("b.linkType==='provider-search-results'") && visual.includes("b.directPropertyLink===true"));
check('visualizer uses explicit results label', visual.includes("'View selected property in Agoda results'"));
check('visualizer reserves direct Agoda label for direct property', visual.includes("'Check this property on Agoda'"));
check('visualizer lets the superseding trust contract classify handoffs first', visual.indexOf('if(trust.ctaLabel)return trust.ctaLabel') < visual.indexOf("if(b.directPropertyLink===true)"));
check('booking page recognizes R2 handoff metadata', booking.includes("b.linkType==='provider-search-results'") && booking.includes("b.directPropertyLink===true"));
check('booking page keeps explicit results label', booking.includes("'View selected property in Agoda results'"));
check('frontend has no Agoda credential identifiers', !booking.includes('AGODA_API_KEY') && !booking.includes('AGODA_SITE_ID') && !visual.includes('AGODA_API_KEY') && !visual.includes('AGODA_SITE_ID'));

const result = {
  release: 'GV-HOTEL-679A-R2',
  generatedAt: new Date().toISOString(),
  checkCount: checks.length,
  passedCount: checks.filter(x=>x.pass).length,
  failedCount: checks.filter(x=>!x.pass).length,
  checks
};
fs.writeFileSync(path.join(__dirname, 'VALIDATION_GV_HOTEL_679A_R2_FRONTEND.json'), JSON.stringify(result, null, 2) + '\n');
if (process.exitCode) throw new Error('GV-HOTEL-679A-R2 frontend validation failed.');
console.log(`GV-HOTEL-679A-R2 frontend validation passed (${result.passedCount}/${result.checkCount}).`);
