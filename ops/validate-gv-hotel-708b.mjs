#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const ROOT = path.resolve(process.cwd());
const scriptPath = path.join(ROOT, 'ops/Run-GV-HOTEL-708B-Nuitee-Sandbox.mjs');
const docPath = path.join(ROOT, 'docs/GV-HOTEL-708B-NUITEE-EVALUATION.md');
const script = fs.readFileSync(scriptPath, 'utf8');
const doc = fs.readFileSync(docPath, 'utf8');
const checks = [];

function check(name, fn) {
  try { fn(); checks.push({ name, pass: true }); }
  catch (error) { checks.push({ name, pass: false, error: error?.message || String(error) }); }
}

check('exact 708B version marker and official v3 search/prebook endpoints', () => {
  assert.match(script, /GV-HOTEL-708B/);
  assert.match(script, /https:\/\/api\.liteapi\.travel\/v3\.0\/hotels\/rates/);
  assert.match(script, /https:\/\/book\.liteapi\.travel\/v3\.0\/rates\/prebook/);
});

check('no hotel booking endpoint or payment action exists', () => {
  assert.doesNotMatch(script, /https:\/\/(?:api|book)\.liteapi\.travel\/v[23]\.0\/rates\/book/);
  assert.doesNotMatch(script, /ACC_CREDIT_CARD|TRANSACTION_ID|payment-wrapper|4242424242424242/);
});

check('sandbox credential stays environment-only and is never hardcoded', () => {
  assert.match(script, /NUITEE_SANDBOX_API_KEY/);
  assert.doesNotMatch(script, /sand_[A-Za-z0-9_-]{8,}/);
  assert.doesNotMatch(script, /prod_[A-Za-z0-9_-]{8,}/);
});

check('three-market direct city-country search cohort is exact', () => {
  for (const marker of ["cityName: 'Toronto'", "countryCode: 'CA'", "cityName: 'Dublin'", "countryCode: 'IE'", "cityName: 'Antalya'", "countryCode: 'TR'"]) {
    assert.ok(script.includes(marker), `missing ${marker}`);
  }
  assert.match(script, /cityName: city\.cityName/);
  assert.match(script, /countryCode: city\.countryCode/);
});

check('rate request asks for bounded content and evidence', () => {
  assert.match(script, /limit: 8/);
  assert.match(script, /maxRatesPerHotel: 1/);
  assert.match(script, /roomMapping: true/);
  assert.match(script, /includeHotelData: true/);
  assert.match(script, /timeout: 10/);
});

check('R1 joins rate hotels to returned hotel content and keeps visual identity evidence', () => {
  assert.match(script, /result\.payload\?\.hotels/);
  assert.match(script, /const contentById = new Map/);
  assert.match(script, /contentById\.get\(providerHotelId\(rateHotel\)\)/);
  assert.match(script, /main_photo/);
  assert.match(script, /address: selected\.address/);
  assert.match(script, /rating: selected\.rating/);
  assert.match(script, /photoPresent: selected\.photoPresent/);
});

check('prebook is explicit opt-in and payment SDK is disabled', () => {
  assert.match(script, /hasFlag\('prebook'\)/);
  assert.match(script, /usePaymentSdk: false/);
});

check('sanitized result strips opaque provider handoff IDs', () => {
  assert.match(script, /_selectedOfferId/);
  assert.match(script, /const clean = summaries\.map\(\(\{ _selectedOfferId, \.\.\.summary \}\) => summary\)/);
  assert.match(script, /contains no API key, offerId, prebookId, payment secret/);
});

check('documentation defines trust and pass gates instead of assuming provider fit', () => {
  assert.match(doc, /Rates search succeeded: `Provider-backed hotel rate — recheck before booking`/);
  assert.match(doc, /Prebook succeeded: `Price and availability rechecked by provider`/);
  assert.match(doc, /Decision gates/);
  assert.match(doc, /at least two of the three markets/);
  assert.match(doc, /no booking\/payment action occurs/i);
});

check('dry run succeeds without any credential or network call', () => {
  const result = spawnSync(process.execPath, [scriptPath, '--dry-run', '--prebook'], {
    cwd: ROOT,
    env: { ...process.env, NUITEE_SANDBOX_API_KEY: '' },
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Toronto/);
  assert.match(result.stdout, /Dublin/);
  assert.match(result.stdout, /Antalya/);
  assert.match(result.stdout, /DRY RUN PASS/);
  assert.doesNotMatch(result.stdout, /sand_[A-Za-z0-9_-]{8,}/);
});

checks.forEach((item, index) => {
  console.log(`${item.pass ? 'PASS' : 'FAIL'} ${String(index + 1).padStart(2, '0')} — ${item.name}${item.error ? `: ${item.error}` : ''}`);
});
const passed = checks.filter((item) => item.pass).length;
console.log(`GV-HOTEL-708B-R1: ${passed}/${checks.length} PASS`);
if (passed !== checks.length) process.exitCode = 1;
