#!/usr/bin/env node
'use strict';
// Cross-platform backend packager (Windows PowerShell 5.1, pwsh, macOS, Linux).
//
// Replaces the inline `node -e '…'` checks that Windows PowerShell 5.1 mangles
// (it strips the inner quotes) and Compress-Archive, which writes `\` into ZIP
// entry names on Windows PowerShell — Lambda then cannot find src/lambda.js.
// Every check runs here, in Node, with no shell quoting; the ZIP is written by
// this script with `/` separators.
//
// Usage:
//   node ops/release/package-backend.cjs --output <name> --enable-production-accounts [--activity-config <file>]
//   node ops/release/package-backend.cjs --output <name> --accounts-disabled-for-testing
// Production packages MUST use --enable-production-accounts (production runs
// with accounts on). Building with accounts off needs the explicit testing flag.
// Local only: no AWS calls, nothing deployed.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

function fail(message) { console.error(`ERROR: ${message}`); process.exit(1); }
// No shell anywhere: paths like "C:\\Users\\…\\New project\\…" contain spaces,
// and a shell is exactly what mangled the old checks. npm is run as
// `node npm-cli.js …` (npm.cmd cannot be spawned without a shell on Windows).
function npmCommand() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')
  ].filter(Boolean);
  const cli = candidates.find(c => /npm-cli\.js$/.test(c) && fs.existsSync(c));
  if (!cli) fail('Cannot find npm-cli.js next to this Node.js install.');
  return [process.execPath, [cli]];
}
function resolve(cmd, args) {
  if (cmd === 'npm') { const [node, pre] = npmCommand(); return [node, [...pre, ...args]]; }
  return [cmd, args];
}
function run(cmd, args, opts = {}) {
  const [c, a] = resolve(cmd, args);
  const r = spawnSync(c, a, { stdio: 'inherit', shell: false, ...opts });
  if (r.status !== 0) fail(opts.failMessage || `${cmd} ${args.join(' ')} failed${r.error ? `: ${r.error.message}` : ''}`);
  return r;
}
function capture(cmd, args, opts = {}) {
  const [c, a] = resolve(cmd, args);
  const r = spawnSync(c, a, { encoding: 'utf8', shell: false, ...opts });
  if (r.status !== 0) fail(opts.failMessage || `${cmd} ${args.join(' ')} failed: ${r.stderr || (r.error && r.error.message) || ''}`);
  return String(r.stdout || '').trim();
}

function parseArgs(argv) {
  const out = { output: 'globevoy-launch-first-backend', enable: false, disabledForTesting: false, activity: null, allowDirty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--output') out.output = argv[++i];
    else if (a === '--enable-production-accounts') out.enable = true;
    else if (a === '--accounts-disabled-for-testing') out.disabledForTesting = true;
    else if (a === '--activity-config') out.activity = argv[++i];
    else fail(`Unknown argument: ${a}`);
  }
  return out;
}

// ---- minimal ZIP writer (deflate, `/` separators, deterministic order) ----
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}
function writeZip(sourceDir, zipPath) {
  const files = listFiles(sourceDir);
  const chunks = []; const central = []; let offset = 0;
  const dosTime = 0, dosDate = (2026 - 1980) << 9 | 1 << 5 | 1; // fixed timestamp → reproducible
  for (const file of files) {
    const name = Buffer.from(path.relative(sourceDir, file).split(path.sep).join('/'), 'utf8');
    const data = fs.readFileSync(file);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useStore = deflated.length >= data.length;
    const body = useStore ? data : deflated;
    const crc = crc32(data);
    const mode = (fs.statSync(file).mode & 0o111) ? 0o100755 : 0o100644;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(useStore ? 0 : 8, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(0x0314, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(useStore ? 0 : 8, 10); cd.writeUInt16LE(dosTime, 12); cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE((mode << 16) >>> 0, 38); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + body.length;
  }
  if (files.length > 0xffff || offset > 0xffffffff) fail('Package too large for a ZIP without ZIP64.');
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(zipPath, Buffer.concat([...chunks, cdBuf, end]));
  return files.map(f => path.relative(sourceDir, f).split(path.sep).join('/'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!/^[a-zA-Z0-9_-]+$/.test(String(args.output || ''))) fail('--output must be letters, numbers, hyphens or underscores.');
  if (args.enable === args.disabledForTesting) fail('Choose exactly one: --enable-production-accounts (production) or --accounts-disabled-for-testing (CI/local only). Production runs with accounts ON; a package without them would disable sign-in and saved trips.');
  const repo = path.resolve(__dirname, '../..');
  const source = path.join(repo, 'backend');
  const cache = path.join(repo, '.cache');
  const stage = path.join(cache, args.output);
  const zipPath = path.join(cache, `${args.output}.zip`);
  if (fs.existsSync(stage) || fs.existsSync(zipPath)) fail(`Refusing to overwrite existing output. Move/remove it first: ${stage} or ${zipPath}`);
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22) fail(`Node.js 22 or newer required (production uses 24); found ${process.versions.node}`);

  const commit = capture('git', ['-C', repo, 'rev-parse', 'HEAD'], { failMessage: 'Cannot determine source commit.' });
  const dirty = capture('git', ['-C', repo, 'status', '--porcelain'], { failMessage: 'git status failed.' });
  if (dirty) fail('Release source has uncommitted changes. Use a clean checkout first.');

  console.log('Running offline production account API checks (no AWS calls)...');
  run(process.execPath, [path.join(source, 'validation/validate-gv-production-account.js')], { failMessage: 'Offline production account API tests failed.' });

  if (fs.existsSync(path.join(source, 'services/accounts/auth/production-account-build.json'))) fail('Generated account config must not exist in backend source.');
  if (fs.existsSync(path.join(source, 'services/analytics/activity-build.json'))) fail('Generated activity config must not exist in source.');

  fs.mkdirSync(stage, { recursive: true });
  for (const name of ['lambda.js', 'production-account-lambda.js']) fs.copyFileSync(path.join(source, name), path.join(stage, name));
  for (const folder of ['services', 'data', 'config']) if (fs.existsSync(path.join(source, folder))) fs.cpSync(path.join(source, folder), path.join(stage, folder), { recursive: true });

  if (args.enable) {
    const configFile = path.join(__dirname, 'production-account-config.json');
    const auth = require(path.join(source, 'services/accounts/auth/production-cognito-auth.js'));
    if (!auth.config(JSON.parse(fs.readFileSync(configFile, 'utf8')))) fail('Invalid nonsecret production account configuration.');
    fs.copyFileSync(configFile, path.join(stage, 'services/accounts/auth/production-account-build.json'));
  }
  if (args.activity) {
    const activity = require(path.join(source, 'services/analytics/search-activity.js'));
    if (!activity.configuration(JSON.parse(fs.readFileSync(path.resolve(args.activity), 'utf8')))) fail('Activity configuration requires explicit privacy approval.');
    fs.copyFileSync(path.resolve(args.activity), path.join(stage, 'services/analytics/activity-build.json'));
  }

  // The Lambda reads 79+ switches from this file (Lambda's 4 KB settings limit); a package
  // without it would silently run with those features off.
  const settingsFile = path.join(stage, 'config/lambda-settings.json');
  if (!fs.existsSync(settingsFile)) fail('config/lambda-settings.json missing from the package.');
  const settingsCount = Object.keys(require(path.join(source, 'services/shared/settings-file.js')).load(settingsFile)).length;
  console.log(`Lambda settings file: ${settingsCount} settings`);
  fs.copyFileSync(path.join(__dirname, 'backend-dependencies/package.json'), path.join(stage, 'package.json'));
  fs.copyFileSync(path.join(__dirname, 'backend-dependencies/package-lock.json'), path.join(stage, 'package-lock.json'));
  fs.mkdirSync(path.join(stage, 'src'));
  fs.writeFileSync(path.join(stage, 'src/lambda.js'), "'use strict';\nmodule.exports = require('../production-account-lambda');\n");

  console.log('Installing locked DynamoDB dependencies locally (no AWS calls)...');
  run('npm', ['ci', '--prefix', stage, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { failMessage: 'npm install failed. No ZIP created.' });

  console.log('Verifying packaged entrypoints...');
  for (const f of ['lambda.js', 'production-account-lambda.js', 'src/lambda.js']) run(process.execPath, ['--check', path.join(stage, f)], { failMessage: `${f} syntax invalid.` });
  const accountHandler = require(path.join(stage, 'production-account-lambda.js'));
  if (typeof accountHandler.handler !== 'function') fail('Bundled handler import failed.');
  if (require(path.join(stage, 'src/lambda.js')).handler !== accountHandler.handler) fail('Compatibility handler export mismatch.');
  console.log('Handler export OK');

  const packageCheck = [path.join(repo, 'tests/release/validate-account-package.cjs'), stage];
  if (args.enable) packageCheck.push('--enabled');
  run(process.execPath, packageCheck, { failMessage: 'Packaged configuration/JWT/CRUD regression failed.' });

  const sdkVersion = JSON.parse(fs.readFileSync(path.join(stage, 'node_modules/@aws-sdk/client-dynamodb/package.json'), 'utf8')).version;
  const manifest = {
    sourceCommit: commit,
    expectedLambdaHandler: 'src/lambda.handler',
    legacyLambdaHandler: 'lambda.handler',
    nodeVersion: process.versions.node,
    dynamodbSdkVersion: sdkVersion,
    createdAtUtc: new Date().toISOString(),
    productionAccountsIncluded: args.enable,
    activityConfigIncluded: Boolean(args.activity),
    additionalEnvironmentBytes: 0,
    awsResourcesModified: false,
    outputMode: 'local-zip-only'
  };
  fs.writeFileSync(path.join(stage, 'launch-manifest.json'), JSON.stringify(manifest, null, 2));

  const entries = writeZip(stage, zipPath);
  for (const required of ['lambda.js', 'production-account-lambda.js', 'src/lambda.js', 'launch-manifest.json', 'package.json']) if (!entries.includes(required)) fail(`Backend ZIP missing root entry: ${required}`);
  if (entries.some(e => e.includes('\\'))) fail('Backend ZIP contains backslash paths.');
  if (entries.some(e => /(^|\/)(archive|validation)\//.test(e))) fail('Backend ZIP unexpectedly includes archive or validation files.');
  if (args.enable && !entries.includes('services/accounts/auth/production-account-build.json')) fail('Production accounts config missing from ZIP.');

  const hash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest();
  console.log('');
  console.log(`Local build ready: ${zipPath}`);
  console.log(`Files: ${entries.length}  Size: ${fs.statSync(zipPath).size} bytes`);
  console.log(`SHA256 (hex): ${hash.toString('hex')}`);
  console.log(`SHA256 (base64, as the Lambda console shows it): ${hash.toString('base64')}`);
  console.log(`Production accounts included: ${args.enable ? 'YES' : 'NO (testing build — do not deploy)'}`);
  console.log('Expected handler for this ZIP: src/lambda.handler');
  console.log('AWS resources/deployments modified: NONE');
}

if (require.main === module) main();
module.exports = { writeZip, crc32, parseArgs };
