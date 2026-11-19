'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { writeZip, crc32 } = require('../../ops/release/package-backend.cjs');

// Independent reader: walk the central directory and inflate every entry.
function readZip(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    const lnlen = buf.readUInt16LE(off + 26), lelen = buf.readUInt16LE(off + 28);
    const raw = buf.slice(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    assert.equal(crc32(data), crc, `crc ${name}`);
    out[name] = data.toString('utf8');
    p += 46 + nlen + elen + clen;
  }
  return out;
}

test('ZIP writer: nested files, forward slashes, valid CRC, readable by an independent reader', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-zip-'));
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lambda.js'), "exports.handler = () => 'ok';\n".repeat(50));
  fs.writeFileSync(path.join(dir, 'src', 'lambda.js'), "module.exports = require('../lambda');\n");
  fs.writeFileSync(path.join(dir, 'src', 'deep', 'name with space.json'), '{}');
  const zip = path.join(os.tmpdir(), `gv-${Date.now()}.zip`);
  const entries = writeZip(dir, zip);
  assert.deepEqual(entries, ['lambda.js', 'src/deep/name with space.json', 'src/lambda.js']);
  const back = readZip(zip);
  assert.deepEqual(Object.keys(back).sort(), entries);
  assert.ok(Object.keys(back).every(n => !n.includes('\\')));
  assert.equal(back['src/lambda.js'], "module.exports = require('../lambda');\n");
  // System unzip (if present) must agree.
  const u = spawnSync('unzip', ['-tq', zip], { encoding: 'utf8' });
  if (!u.error) assert.equal(u.status, 0, u.stdout + u.stderr);
});

test('packager refuses to run without an explicit accounts choice', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '../../ops/release/package-backend.cjs'), '--output', 'never-built'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /--enable-production-accounts/);
  const both = spawnSync(process.execPath, [path.join(__dirname, '../../ops/release/package-backend.cjs'), '--output', 'x', '--enable-production-accounts', '--accounts-disabled-for-testing'], { encoding: 'utf8' });
  assert.notEqual(both.status, 0);
});

test('PowerShell wrapper passes no JavaScript through node -e', () => {
  const ps1 = fs.readFileSync(path.join(__dirname, '../../ops/release/package-launch-first-backend.ps1'), 'utf8').split('\n').filter(l => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(ps1, /node\s+-e/);
  assert.doesNotMatch(ps1, /Compress-Archive/);
  assert.match(ps1, /package-backend\.cjs/);
});
