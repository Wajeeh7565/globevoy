import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
let failures = 0;

function pass(message) {
  console.log(`[PASS] ${message}`);
}

function fail(message) {
  failures += 1;
  console.error(`[FAIL] ${message}`);
}

function requirePath(relativePath, type = 'file') {
  const full = path.join(root, relativePath);
  if (!fs.existsSync(full)) {
    fail(`Required ${type} missing: ${relativePath}`);
    return;
  }
  const stat = fs.statSync(full);
  const ok = type === 'directory' ? stat.isDirectory() : stat.isFile();
  ok ? pass(`Required ${type} exists: ${relativePath}`) : fail(`Expected ${type}: ${relativePath}`);
}

for (const [relativePath, type] of [
  ['README.md', 'file'],
  ['CURRENT_BASELINE.md', 'file'],
  ['frontend', 'directory'],
  ['backend', 'directory'],
  ['frontend/runtime/config.js', 'file'],
  ['frontend/validation/validate-gv-rec-687b-frontend.js', 'file'],
  ['backend/validation/validate-gv-rec-687b-p3.js', 'file'],
  ['backend/services/domain/routing/route-diversity-687b.js', 'file']
]) requirePath(relativePath, type);

const baselinePath = path.join(root, 'CURRENT_BASELINE.md');
if (fs.existsSync(baselinePath)) {
  const baseline = fs.readFileSync(baselinePath, 'utf8');
  const markers = ['GV-REC-687B-R1', 'GV-REC-687B-P3', 'Canonical branch: `main`'];
  for (const marker of markers) {
    baseline.includes(marker) ? pass(`Baseline marker present: ${marker}`) : fail(`Baseline marker missing: ${marker}`);
  }
}

const configPath = path.join(root, 'frontend/runtime/config.js');
if (fs.existsSync(configPath)) {
  const config = fs.readFileSync(configPath, 'utf8');
  config.includes('YOUR_RESTRICTED_GOOGLE_MAPS_BROWSER_KEY')
    ? pass('Google Maps browser key remains sanitized in source control')
    : fail('Google Maps browser key placeholder is missing');
}

const forbiddenFileNames = new Set(['.env', '.env.local', '.env.production', '.env.staging']);
const forbiddenExtensions = new Set(['.pem', '.p12', '.pfx', '.key']);
const skipDirs = new Set(['node_modules', '.git']);

function inspectSensitiveNames(relativePath = '.') {
  const full = path.join(root, relativePath);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    if (skipDirs.has(path.basename(full))) return;
    for (const entry of fs.readdirSync(full)) inspectSensitiveNames(path.join(relativePath, entry));
    return;
  }
  if (!stat.isFile()) return;
  const base = path.basename(full);
  if (forbiddenFileNames.has(base) || forbiddenExtensions.has(path.extname(base).toLowerCase())) {
    fail(`Sensitive file type must not be committed: ${relativePath}`);
  }
}
inspectSensitiveNames();

const credentialPatterns = [
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ['Duffel token', /\bduffel_(?:test|live)_[A-Za-z0-9_-]{20,}\b/gi],
  ['Stripe secret key', /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]{20,}\b/g],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g]
];

// Scan the active runtime/config/validator surfaces rather than multi-megabyte
// historical data exports and reports. File-name safety above still covers the
// whole repository.
const scanRoots = [
  'backend/lambda.js',
  'backend/services/domain/tours/generated-tour.js',
  'backend/server.js',
  'backend/services',
  'backend/validation/validate-gv-rec-687b-p3.js',
  'backend/validation/validate-gv-rec-687b.js',
  'frontend/runtime',
  'frontend/scripts',
  'frontend/validation',
  '.github'
];
const allowedTextExtensions = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.md', '.yml', '.yaml', '.txt']);
const files = [];

function collectTextFiles(relativePath) {
  const full = path.join(root, relativePath);
  if (!fs.existsSync(full)) return;
  const stat = fs.statSync(full);
  if (stat.isDirectory()) {
    if (skipDirs.has(path.basename(full))) return;
    for (const entry of fs.readdirSync(full)) collectTextFiles(path.join(relativePath, entry));
    return;
  }
  if (stat.isFile() && allowedTextExtensions.has(path.extname(full).toLowerCase())) files.push(relativePath);
}

for (const scanRoot of scanRoots) collectTextFiles(scanRoot);

for (const relativePath of files) {
  const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const [label, regex] of credentialPatterns) {
    regex.lastIndex = 0;
    if (regex.test(text)) fail(`${label} pattern found in ${relativePath}`);
  }
}

if (failures === 0) {
  pass(`Repository safety guard passed across ${files.length} active source/config files`);
  console.log('\nGV-PLATFORM-700A repository guard: PASS');
} else {
  console.error(`\nGV-PLATFORM-700A repository guard: FAIL (${failures} problem${failures === 1 ? '' : 's'})`);
  process.exit(1);
}
