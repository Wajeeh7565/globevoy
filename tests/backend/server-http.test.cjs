'use strict';

const { before, after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

let base, child, childExit;

async function getJson(route) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200, route);
  assert.match(response.headers.get('content-type'), /application\/json/);
  return response.json();
}

before(async () => {
  const configured = process.env.GLOBEVOY_SMOKE_BASE_URL;
  if (configured) {
    const url = new URL(configured);
    assert.equal(url.protocol, 'http:', 'Smoke tests target local HTTP only');
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Remote targets are forbidden');
    assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/');
    base = url.href;
  } else {
    const reservation = net.createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    base = `http://127.0.0.1:${port}/`;
    // Do not inherit provider credentials, AWS credentials or live feature flags.
    const env = { PORT: String(port), NODE_ENV: 'test', GLOBEVOY_USE_MOCKS: 'true' };
    for (const key of ['SystemRoot', 'WINDIR', 'PATH', 'Path', 'TEMP', 'TMP']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    child = spawn(process.execPath, [path.resolve(__dirname, '../../backend/server.js')], {
      cwd: path.resolve(__dirname, '../..'), env, stdio: ['ignore', 'ignore', 'pipe']
    });
    childExit = once(child, 'exit');
    // Attach rejection handling immediately if spawning the child fails.
    childExit.catch(() => {});
  }

  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw Error('Local backend exited before becoming ready');
    }
    try {
      await getJson('/health');
      return;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw lastError || Error('Local backend did not become ready');
}, { timeout: 15000 });

after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const force = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await childExit; } finally { clearTimeout(force); }
  }
});

test('GET /health identifies a healthy GlobeVoy local API', async () => {
  assert.deepEqual(await getJson('/health'), { ok: true, service: 'globevoy-api-prototype' });
});

test('GET /api/city-registry loads runtime data and supports a city search', async () => {
  const summary = await getJson('/api/city-registry');
  assert.equal(summary.ok, true);
  assert.match(summary.version, /^GV-CITY-/);
  assert.ok(summary.summary && typeof summary.summary === 'object');

  const search = await getJson('/api/city-registry?q=Toronto&countryCode=CA&limit=3');
  assert.equal(search.ok, true);
  assert.ok(Array.isArray(search.records));
  assert.ok(search.records.length > 0 && search.records.length <= 3);
  assert.equal(search.count, search.records.length);
  assert.ok(search.records.some(record => /Toronto/i.test(record.displayName)));
});
