'use strict';
const BACKEND_ROOT = require('node:path').resolve(__dirname, '..');

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = BACKEND_ROOT;
const source = fs.readFileSync(path.join(root, 'staging-lambda.js'), 'utf8');
const staging = require('../staging-lambda');
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });

check('Staging wrapper version is exact', staging.VERSION === 'GV-PLATFORM-700A-STAGING-API-R1');
check('Production origin constant is exact', staging.PRODUCTION_ORIGIN === 'https://globevoy.com');
check('Wrapper imports verified production handler', source.includes("require('./lambda')"));
check('Handler name remains staging-lambda.handler', typeof staging.handler === 'function');

const { normalizeHttpsOrigin, configuredStagingOrigin, replaceHeader } = staging._internal;
check('HTTPS staging origin normalizes', normalizeHttpsOrigin('https://staging.example.amplifyapp.com/') === 'https://staging.example.amplifyapp.com');
check('HTTP origin is rejected', normalizeHttpsOrigin('http://staging.example.com') === '');
check('Origin with path is rejected', normalizeHttpsOrigin('https://staging.example.com/path') === '');
check('Production origin is rejected as staging config', configuredStagingOrigin({ CORS_ORIGIN: 'https://globevoy.com' }) === '');
check('Missing staging origin fails closed', configuredStagingOrigin({}) === '');
check('Configured Amplify origin is accepted', configuredStagingOrigin({ CORS_ORIGIN: 'https://staging.example.amplifyapp.com' }) === 'https://staging.example.amplifyapp.com');

const replaced = replaceHeader({ origin: 'https://old.example', Other: 'ok' }, 'Origin', 'https://globevoy.com');
check('Forwarded origin is replaced, not duplicated', replaced.Origin === 'https://globevoy.com' && !Object.prototype.hasOwnProperty.call(replaced, 'origin') && replaced.Other === 'ok');

const invokeIndex = source.indexOf('productionHandler(forwardedEvent)');
check('Missing browser origin fails before production handler', source.indexOf("if (!requestOrigin)") >= 0 && source.indexOf("if (!requestOrigin)") < invokeIndex && source.includes("staging-origin-required"));
check('Unknown browser origin fails before production handler', source.indexOf("requestOrigin !== configuredOrigin") >= 0 && source.indexOf("requestOrigin !== configuredOrigin") < invokeIndex);
check('Validated staging origin maps only inside isolated wrapper', source.includes("replaceHeader(event.headers || {}, 'Origin', PRODUCTION_ORIGIN)"));
check('Browser CORS is rewritten back to configured staging origin', source.includes("'Access-Control-Allow-Origin', configuredOrigin"));
check('Response is visibly marked as staging', source.includes("responseHeaders['X-Globevoy-Staging'] = VERSION"));
check('Wrapper uses only existing CORS_ORIGIN configuration', (source.match(/process\.env\.[A-Z0-9_]+/g) || []).every(value => value === 'process.env.CORS_ORIGIN'));
check('Wrapper contains no credential literals', !/(AKIA|ASIA)[A-Z0-9]{16}|duffel_(?:test|live)_|AIza[0-9A-Za-z_-]{20,}|-----BEGIN .*PRIVATE KEY-----/i.test(source));
check('Wrapper makes no direct provider/network request', !/\bfetch\s*\(|XMLHttpRequest|https\.request\s*\(|http\.request\s*\(/.test(source));

const p3 = spawnSync(process.execPath, [path.join(__dirname, 'validate-gv-rec-687b-p3.js')], { cwd: root, encoding: 'utf8' });
check('Verified 687B-P3 production validator remains green', p3.status === 0 && p3.stdout.includes('GV-REC-687B-P3: 12/12 PASS'), p3.stderr || p3.stdout);

for (const [index, item] of checks.entries()) {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}${item.pass || !item.detail ? '' : ` :: ${String(item.detail).trim().split(/\r?\n/).slice(-1)[0]}`}`);
}

const passed = checks.filter(item => item.pass).length;
console.log(`GV-PLATFORM-700A STAGING API: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;
