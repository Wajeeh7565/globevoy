'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const sf = require('../../backend/services/shared/settings-file');
const tmp = obj => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gvs-')), 's.json'); fs.writeFileSync(f, JSON.stringify(obj)); return f; };

test('file settings fill only what the Lambda configuration leaves unset', () => {
  const env = { FARE_MAP_EXPERIENCE: 'off' };
  const applied = sf.apply(env, tmp({ settings: { FARE_MAP_EXPERIENCE: 'on', FARE_MAP_LONG_STAYS: 'on' } }));
  assert.deepEqual(applied, ['FARE_MAP_LONG_STAYS']);
  assert.equal(env.FARE_MAP_EXPERIENCE, 'off');
  assert.equal(env.FARE_MAP_LONG_STAYS, 'on');
});
test('secrets, bad names and non-strings are refused', () => {
  assert.throws(() => sf.apply({}, tmp({ settings: { NUITEE_API_KEY: 'x' } })), /secrets/);
  assert.throws(() => sf.apply({}, tmp({ settings: { 'bad-name': 'x' } })), /bad name/);
  assert.throws(() => sf.apply({}, tmp({ settings: { FARE_MAP_X: 1 } })), /string/);
  assert.deepEqual(sf.apply({}, '/nonexistent/file.json'), []);
});
test('the shipped file is valid and holds no secrets', () => {
  const s = sf.load();
  for (const k of Object.keys(s)) assert.ok(!sf.SECRET.test(k), k);
});
test('the backend packager ships config/lambda-settings.json and refuses a package without it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../ops/release/package-backend.cjs'), 'utf8');
  assert.match(src, /\['services', 'data', 'config'\]/);
  assert.match(src, /lambda-settings\.json missing from the package/);
});
