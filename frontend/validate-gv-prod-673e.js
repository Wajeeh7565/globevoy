'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = __dirname;
const checks = [];

function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ` - ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

const bookingHtml = fs.readFileSync(path.join(root, 'booking.html'), 'utf8');
const bookingJs = fs.readFileSync(path.join(root, 'scripts', 'booking-live-673d.js'), 'utf8');
const visualizerHtml = fs.readFileSync(path.join(root, 'multicity-visualizer.html'), 'utf8');
const visualizerJs = fs.readFileSync(path.join(root, 'scripts', 'multicity-visualizer-673c.js'), 'utf8');
const imageJs = fs.readFileSync(path.join(root, 'scripts', 'city-images-673c.js'), 'utf8');

check('booking release/cache version', bookingHtml.includes('GV-PROD-673E') && bookingHtml.includes('booking-live-673d.js?v=673e'));
check('booking loads API restoration dependencies', bookingHtml.includes('runtime/config.js') && bookingHtml.includes('runtime/api-client.js'));
check('shared multi-city route restores from backend', bookingJs.includes('async function restoreTour()') && bookingJs.includes("params.action='restore'"));
check('multi-city failure does not become single-city', bookingJs.includes("if(!multi){renderSingle();return;}") && !bookingJs.includes('&&tour)renderMulti(tour);else renderSingle()'));
check('rejected provider evidence is excluded', bookingJs.includes('function providerEvidenceEligible') && bookingJs.includes('exactProviderEvidence(leg)'));
check('visualizer release/cache version', visualizerHtml.includes('GV-PROD-673E') && visualizerHtml.includes('city-images-673c.js?v=673e'));
check('card artwork installs before remote lookup', /installPhoto\(card,generated,city,country,'eager'\);if\(verifiedLocal\)/.test(visualizerJs));
check('local photo errors retain artwork fallback', visualizerJs.includes('img.onload=apply;') && visualizerJs.includes('img.onerror=()=>'));
check('photo resolver invalidates old cache', imageJs.includes("CACHE_PREFIX='gv-city-images-v9-673e:'"));
check('ambiguous photo cities use coordinate/country validation', imageJs.includes('if(ambiguous){') && imageJs.includes('wikipediaDirectTitles(city,country,true)') && imageJs.includes('wikidataExact(city,country,true)'));

const originSource = fs.readFileSync(path.join(root, 'runtime', 'supported-origins.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(originSource, sandbox, { filename: 'supported-origins.js' });
const Origins = sandbox.window.GlobevoySupportedOrigins;
check('plain ambiguous city is rejected', Origins.find('Georgetown', { allowPrefix: false }) === null);
const georgetownLabels = Origins.matching('Georgetown').map(Origins.label);
check('ambiguous suggestions include country', georgetownLabels.length > 1 && georgetownLabels.every(label => label.includes(',')), georgetownLabels.slice(0, 4).join(' | '));
check('explicit ambiguous choice resolves', Origins.find(georgetownLabels[0], { allowPrefix: false })?.city === 'Georgetown');
check('unambiguous city still resolves', Origins.find('Toronto', { allowPrefix: false })?.code === 'YYZ');

if (process.exitCode) throw new Error('GV-PROD-673E frontend validation failed.');
console.log(`GV-PROD-673E frontend validation passed (${checks.length}/${checks.length}).`);
