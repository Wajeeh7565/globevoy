'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sourcePath = path.join(__dirname, '..', 'runtime', 'api-client.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const calls = [];

const windowObject = {
  GLOBEVOY_CONFIG: {
    enableLiveApi: true,
    apiBaseUrl: 'https://staging.example.test',
    apiTimeoutMs: 9000
  },
  setTimeout,
  clearTimeout
};

const context = {
  window: windowObject,
  URL,
  AbortController,
  fetch: async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      async text() {
        return JSON.stringify({ ok: true, apiVersion: 'GV-DATA-701B', records: [] });
      }
    };
  },
  console
};

vm.createContext(context);
vm.runInContext(source, context, { filename: 'api-client.js' });

const api = windowObject.GlobevoyApi;
let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

check('701C marker is exposed', () => assert.strictEqual(api.worldwideRegistryContractVersion, 'GV-DATA-701C'));
check('existing API client remains configured', () => assert.strictEqual(api.isConfigured(), true));
check('worldwide search method exists', () => assert.strictEqual(typeof api.searchWorldwideCities, 'function'));
check('worldwide resolve method exists', () => assert.strictEqual(typeof api.resolveWorldwideCity, 'function'));
check('existing generated-tour method remains available', () => assert.strictEqual(typeof api.getGeneratedTour, 'function'));
check('701C uses the exact 701B endpoint', () => assert.ok(source.includes("'/api/worldwide-city-registry'")));
check('701C remains read-only', () => assert.ok(!/worldwide-city-registry[^\n]*POST|POST[^\n]*worldwide-city-registry/.test(source)));
check('API client contains no DOM mutation', () => assert.ok(!/document\.|innerHTML|replaceChildren|appendChild/.test(source)));
check('API client contains no obvious provider credential literal', () => assert.ok(!/(AKIA|ASIA)[A-Z0-9]{16}|duffel_(?:test|live)_|AIza[0-9A-Za-z_-]{20,}|BEGIN .*PRIVATE KEY/i.test(source)));

(async () => {
  await api.searchWorldwideCities({ q: 'Toronto', scope: 'origin', limit: 5 });
  await api.resolveWorldwideCity('Mala Mala', 'za');

  check('search forwards bounded query parameters', () => {
    const url = new URL(calls[0].url);
    assert.strictEqual(url.pathname, '/api/worldwide-city-registry');
    assert.strictEqual(url.searchParams.get('q'), 'Toronto');
    assert.strictEqual(url.searchParams.get('scope'), 'origin');
    assert.strictEqual(url.searchParams.get('limit'), '5');
  });

  check('resolve forwards canonical resolve and country code', () => {
    const url = new URL(calls[1].url);
    assert.strictEqual(url.pathname, '/api/worldwide-city-registry');
    assert.strictEqual(url.searchParams.get('resolve'), 'Mala Mala');
    assert.strictEqual(url.searchParams.get('countryCode'), 'ZA');
  });

  check('worldwide contract performs GET requests only', () => {
    assert.ok(calls.every(call => (call.options.method || 'GET') === 'GET'));
  });

  let rejected = false;
  try { await api.resolveWorldwideCity('   '); } catch (error) { rejected = /requires a city or airport/.test(error.message); }
  check('blank resolve fails before a network request', () => assert.strictEqual(rejected, true));
  check('blank resolve did not add a network call', () => assert.strictEqual(calls.length, 2));

  console.log(`GV-DATA-701C frontend contract validation passed (${passed}/${passed}).`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
