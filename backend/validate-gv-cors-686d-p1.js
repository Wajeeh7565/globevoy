'use strict';

const assert = require('assert');
const { handler } = require('./lambda');

const PROD = 'https://globevoy.com';
const PREVIEW = 'https://686d-preview.dttux5e6ddtzb.amplifyapp.com';
const UNKNOWN = 'https://unapproved.example';

function event({ method = 'GET', origin, path = '/api/flex-windows' } = {}) {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: origin ? { Origin: origin } : {},
    queryStringParameters: {}
  };
}

function allowedOrigin(response) {
  return response && response.headers && response.headers['Access-Control-Allow-Origin'];
}

async function main() {
  const previousFlex = process.env.GLOBEVOY_FLEX_DATES;
  const previousCors = process.env.CORS_ORIGIN;
  process.env.GLOBEVOY_FLEX_DATES = 'false';
  process.env.CORS_ORIGIN = PROD;

  try {
    const prodOptions = await handler(event({ method: 'OPTIONS', origin: PROD }));
    const previewOptions = await handler(event({ method: 'OPTIONS', origin: PREVIEW }));
    const unknownOptions = await handler(event({ method: 'OPTIONS', origin: UNKNOWN }));
    const prodGet = await handler(event({ method: 'GET', origin: PROD }));
    const previewPost = await handler(event({ method: 'POST', origin: PREVIEW }));
    const unknownGet = await handler(event({ method: 'GET', origin: UNKNOWN }));
    const noOriginGet = await handler(event({ method: 'GET' }));

    assert.strictEqual(prodOptions.statusCode, 204);
    assert.strictEqual(previewOptions.statusCode, 204);
    assert.strictEqual(allowedOrigin(prodOptions), PROD);
    assert.strictEqual(allowedOrigin(previewOptions), PREVIEW);
    assert.strictEqual(allowedOrigin(unknownOptions), undefined);

    for (const response of [prodOptions, previewOptions, unknownOptions]) {
      assert.strictEqual(response.headers['Access-Control-Allow-Methods'], 'GET,POST,OPTIONS');
      assert.strictEqual(response.headers['Access-Control-Allow-Headers'], 'Content-Type,X-GV-Admin-Token,X-GV-Provider-Canary,Authorization');
      assert.strictEqual(response.headers.Vary, 'Origin');
    }

    assert.strictEqual(prodGet.statusCode, 200);
    assert.strictEqual(previewPost.statusCode, 200);
    assert.strictEqual(allowedOrigin(prodGet), PROD);
    assert.strictEqual(allowedOrigin(previewPost), PREVIEW);
    assert.strictEqual(allowedOrigin(unknownGet), undefined);
    assert.strictEqual(allowedOrigin(noOriginGet), PROD);

    for (const response of [prodOptions, previewOptions, unknownOptions, prodGet, previewPost, unknownGet, noOriginGet]) {
      const value = allowedOrigin(response);
      assert.notStrictEqual(value, '*');
      if (value) assert.ok(!value.includes(','), 'Access-Control-Allow-Origin must be a single origin');
      assert.strictEqual(response.headers['Content-Type'], 'application/json; charset=utf-8');
    }

    console.log('GV-CORS-686D-P1: 18/18 PASS');
  } finally {
    if (previousFlex === undefined) delete process.env.GLOBEVOY_FLEX_DATES;
    else process.env.GLOBEVOY_FLEX_DATES = previousFlex;
    if (previousCors === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previousCors;
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
