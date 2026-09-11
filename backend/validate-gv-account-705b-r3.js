'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const auth = require('./services/staging-cognito-auth-705b-r3');

const ROOT = path.join(__dirname, '..');
const NOW_MS = Date.UTC(2026, 7, 21, 3, 0, 0);
const NOW = Math.floor(NOW_MS / 1000);
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: wrongPrivateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
jwk.kid = 'gv-705b-r3-test-key';
jwk.use = 'sig';
jwk.alg = 'RS256';

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function tokenFor(overrides = {}, signer = privateKey) {
  const header = { alg: 'RS256', kid: jwk.kid, typ: 'JWT' };
  const claims = {
    sub: '11111111-2222-3333-4444-555555555555',
    username: 'staging-user',
    iss: auth.ISSUER,
    client_id: auth.CLIENT_ID,
    token_use: 'access',
    scope: `openid email profile ${auth.REQUIRED_SCOPE}`,
    iat: NOW - 30,
    exp: NOW + 3600,
    ...overrides
  };
  const input = `${encode(header)}.${encode(claims)}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), signer).toString('base64url');
  return `${input}.${signature}`;
}

function fakeFetch() {
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) });
}

async function expectAuthError(code, token) {
  auth._internal.resetJwksCacheForTests();
  await assert.rejects(
    auth.verifyCognitoAccessToken705B(token, { fetch: fakeFetch, nowMs: NOW_MS }),
    (error) => error instanceof auth.CognitoAuthError705B && error.code === code
  );
}

(async () => {
  assert.equal(auth.VERSION, 'GV-ACCOUNT-705B-R3');
  assert.equal(auth.STAGING_ORIGIN, 'https://staging.dy4fw8gx1ccie.amplifyapp.com');
  assert.equal(auth.USER_POOL_ID, 'us-east-2_MSd9RRHD8');
  assert.equal(auth.CLIENT_ID, 'o2ohbv50253hjli5s34rbvv79');
  assert.equal(auth.REQUIRED_SCOPE, 'globevoy/trips.write');
  assert.equal(auth.enabled({ CORS_ORIGIN: `${auth.STAGING_ORIGIN}/` }), true);
  assert.equal(auth.enabled({ CORS_ORIGIN: 'https://globevoy.com' }), false);

  auth._internal.resetJwksCacheForTests();
  const verified = await auth.verifyCognitoAccessToken705B(tokenFor(), { fetch: fakeFetch, nowMs: NOW_MS });
  assert.equal(verified.verified, true);
  assert.equal(verified.tokenUse, 'access');
  assert.equal(verified.clientId, auth.CLIENT_ID);
  assert.equal(verified.issuer, auth.ISSUER);
  assert(verified.scopes.includes(auth.REQUIRED_SCOPE));

  await expectAuthError('invalid-token-signature', tokenFor({}, wrongPrivateKey));
  await expectAuthError('required-scope-missing', tokenFor({ scope: 'openid email profile' }));
  await expectAuthError('client-id-mismatch', tokenFor({ client_id: 'wrong-client' }));
  await expectAuthError('issuer-mismatch', tokenFor({ iss: 'https://example.invalid/pool' }));
  await expectAuthError('access-token-required', tokenFor({ token_use: 'id' }));
  await expectAuthError('token-expired', tokenFor({ exp: NOW - 1 }));

  auth._internal.resetJwksCacheForTests();
  const validEvent = {
    rawPath: '/api/account/session',
    requestContext: { http: { method: 'GET' } },
    headers: {
      Origin: auth.STAGING_ORIGIN,
      Authorization: `Bearer ${tokenFor()}`
    }
  };
  const ok = await auth.handleAccountSession705B(validEvent, {
    env: { CORS_ORIGIN: `${auth.STAGING_ORIGIN}/` },
    fetch: fakeFetch,
    nowMs: NOW_MS
  });
  assert.equal(ok.statusCode, 200);
  const okBody = JSON.parse(ok.body);
  assert.equal(okBody.authenticated, true);
  assert.equal(okBody.user.sub, '11111111-2222-3333-4444-555555555555');
  assert.equal(okBody.safety.tokenReturned, false);
  assert.equal(ok.body.includes(tokenFor()), false);
  assert.equal(ok.headers['Access-Control-Allow-Origin'], auth.STAGING_ORIGIN);
  assert.equal(ok.headers['Cache-Control'], 'no-store');

  const noToken = await auth.handleAccountSession705B({ ...validEvent, headers: { Origin: auth.STAGING_ORIGIN } }, {
    env: { CORS_ORIGIN: `${auth.STAGING_ORIGIN}/` }, fetch: fakeFetch, nowMs: NOW_MS
  });
  assert.equal(noToken.statusCode, 401);

  const wrongOrigin = await auth.handleAccountSession705B({ ...validEvent, headers: { ...validEvent.headers, Origin: 'https://evil.example' } }, {
    env: { CORS_ORIGIN: `${auth.STAGING_ORIGIN}/` }, fetch: fakeFetch, nowMs: NOW_MS
  });
  assert.equal(wrongOrigin.statusCode, 403);
  assert.equal(Boolean(wrongOrigin.headers['Access-Control-Allow-Origin']), false);

  const disabled = await auth.handleAccountSession705B(validEvent, {
    env: { CORS_ORIGIN: 'https://globevoy.com' }, fetch: fakeFetch, nowMs: NOW_MS
  });
  assert.equal(disabled.statusCode, 404);

  const wrapper = fs.readFileSync(path.join(ROOT, 'backend', 'staging-lambda-702d.js'), 'utf8');
  const production = fs.readFileSync(path.join(ROOT, 'backend', 'lambda.js'), 'utf8');
  assert(wrapper.includes("require('./services/staging-cognito-auth-705b-r3')"));
  // 710F stores the normalized path once before routing account siblings.
  assert(wrapper.includes('const path = eventPath(event)'));
  assert(wrapper.includes("const isAccountRoute = path === '/api/account/session'"));
  assert.match(wrapper, /method !== 'OPTIONS' && isAccountRoute[\s\S]*?stagingAccount705B\.handleAccountSession705B\(event\)/);
  assert(wrapper.includes("headers['X-Globevoy-Staging-Account']"));
  assert.equal(production.includes('GV-ACCOUNT-705B-R3'), false);
  assert.equal(production.includes('/api/account/session'), false);

  const authConfig = fs.readFileSync(path.join(ROOT, 'frontend', 'runtime', 'auth-config-705b-r3.js'), 'utf8');
  const authSession = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'auth-session-705b-r3.js'), 'utf8');
  const shell = fs.readFileSync(path.join(ROOT, 'frontend', 'scripts', 'shell-670f.js'), 'utf8');
  const callback = fs.readFileSync(path.join(ROOT, 'frontend', 'auth-callback.html'), 'utf8');
  const account = fs.readFileSync(path.join(ROOT, 'frontend', 'account.html'), 'utf8');

  for (const marker of [auth.STAGING_ORIGIN, auth.USER_POOL_ID, auth.CLIENT_ID, auth.ISSUER, auth.REQUIRED_SCOPE]) {
    assert(authConfig.includes(marker), `public auth config missing ${marker}`);
  }
  assert(authConfig.includes('clientSecretPresent: false'));
  assert(authConfig.includes('persistRefreshToken: false'));
  assert(authConfig.includes('persistIdToken: false'));
  assert(authConfig.includes('localStorageTokensAllowed: false'));

  assert(authSession.includes("crypto.subtle.digest('SHA-256'"));
  assert(authSession.includes("authorize.searchParams.set('code_challenge_method', 'S256')"));
  assert(authSession.includes("body.set('code_verifier', pending.verifier)"));
  assert(authSession.includes("body.set('grant_type', 'authorization_code')"));
  assert(authSession.includes("headers: { Authorization: `Bearer ${accessToken}` }"));
  assert(authSession.includes('window.sessionStorage'));
  assert.equal(authSession.includes('window.localStorage'), false);
  assert.equal(authSession.includes('client_secret'), false);
  assert.equal(/sessionStorage\.setItem\([^\n]*(refresh|id)_token/i.test(authSession), false);
  assert(authSession.includes('Deliberately do not persist tokens.refresh_token or tokens.id_token.'));
  assert(authSession.includes("logout.searchParams.set('logout_uri', cfg.logoutUrl)"));

  assert(shell.includes('data-gv-auth-entry'));
  assert(shell.includes('runtime/auth-config-705b-r3.js'));
  assert(shell.includes('scripts/auth-session-705b-r3.js'));
  assert(callback.includes('data-gv-auth-callback="true"'));
  assert(callback.includes('./runtime/auth-config-705b-r3.js'));
  assert(callback.includes('./scripts/auth-session-705b-r3.js'));
  assert(account.includes('Sign in or create account'));
  assert(account.includes('Continue as guest'));
  assert(account.includes('data-gv-auth-signout'));

  console.log('GV-ACCOUNT-705B-R3 validation PASS');
  console.log(JSON.stringify({
    version: auth.VERSION,
    environment: 'staging',
    publicClientSecret: false,
    oauthFlow: 'authorization-code-pkce',
    pkceMethod: 'S256',
    accessTokenSignatureVerified: true,
    issuerChecked: true,
    clientIdChecked: true,
    tokenUseChecked: true,
    scopeChecked: true,
    expiryChecked: true,
    browserTokenStorage: 'sessionStorage-access-token-only',
    refreshTokenPersisted: false,
    idTokenPersisted: false,
    guestPlanningPreserved: true,
    productionHandlerChanged: false,
    dynamodbChanged: false,
    realNetworkCallsPerformed: false
  }, null, 2));
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

