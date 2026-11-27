'use strict';

// GV-WEB-4: sign-in, sign-out, session persistence and guest-to-member transitions on the
// new pages, fully offline. Cognito and the API are faked at the network layer; the page code
// (auth-session-705b-r3.js, sign-in.html, account-menu.js, the React account pages) is real.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { frontendSourcePath } = require('../../ops/frontend/source-layout.cjs');
const { chromium } = require('../../web/node_modules/playwright');

const origin = 'https://globevoy.com';
const artifactRoot = process.env.GLOBEVOY_TEST_FRONTEND_ROOT ? path.resolve(process.env.GLOBEVOY_TEST_FRONTEND_ROOT) : null;
const mockRelease = { environment: 'production', target: 'globevoy.com', apiBaseUrl: 'https://offline-test.lambda-url.us-east-2.on.aws', reactEnabled: true, accountsEnabled: true,
  auth: { region: 'us-east-2', userPoolId: 'us-east-2_OfflineTest1', clientId: 'offlineclient1234567890', issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_OfflineTest1', domainBaseUrl: 'https://globevoy-offline-test.auth.us-east-2.amazoncognito.com' } };
const release = artifactRoot ? JSON.parse(fs.readFileSync(path.join(artifactRoot, 'runtime/environment-policy.js'), 'utf8').match(/Object\.freeze\((\{[^\n]+\})\);/)[1]) : mockRelease;
const api = release.apiBaseUrl, cognito = release.auth.domainBaseUrl, clientId = release.auth.clientId;
const SESSION_KEY = 'globevoy.auth.session.705b-r3', PENDING_KEY = 'globevoy.auth.pending.705b-r3';
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain', '.mp4': 'video/mp4' };
let browser;

test.before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.GLOBEVOY_TEST_BROWSER_PATH, args: ['--disable-background-networking'] }); });
test.after(async () => { await browser?.close(); });

async function site() {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const seen = { authorize: [], signup: [], logout: [], token: [], api: [], missing: [], errors: [] };
  await context.addInitScript(r => { window.GLOBEVOY_PRODUCTION_RELEASE = r; }, release);
  await context.route('**/*', async route => {
    const request = route.request(), u = new URL(request.url());
    if (u.origin === cognito) {
      const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Content-Type': 'application/json' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (u.pathname === '/oauth2/authorize') { seen.authorize.push(u); return route.fulfill({ contentType: 'text/html', body: '<h1>Cognito sign-in (offline)</h1>' }); }
      if (u.pathname === '/signup') { seen.signup.push(u); return route.fulfill({ contentType: 'text/html', body: '<h1>Cognito sign-up (offline)</h1>' }); }
      if (u.pathname === '/logout') { seen.logout.push(u); return route.fulfill({ contentType: 'text/html', body: '<h1>Signed out (offline)</h1>' }); }
      if (u.pathname === '/oauth2/token') {
        seen.token.push(new URLSearchParams(request.postData() || ''));
        return route.fulfill({ headers: cors, body: JSON.stringify({ access_token: 'offline-access-token', id_token: 'offline-id-token', refresh_token: 'offline-refresh-token', token_type: 'Bearer', expires_in: 3600 }) });
      }
      if (u.pathname === '/oauth2/userInfo') return route.fulfill({ headers: cors, body: JSON.stringify({ sub: 'offline-owner', email: 'maya.chen@example.test', email_verified: 'true' }) });
      return route.abort();
    }
    if (u.origin === api) {
      const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Authorization,Content-Type', 'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      seen.api.push({ path: u.pathname, auth: request.headers().authorization || '' });
      if (u.pathname === '/api/account/session') return route.fulfill({ headers, body: JSON.stringify({ ok: true, authenticated: request.headers().authorization === 'Bearer offline-access-token', user: { sub: 'offline-owner' }, token: { scopes: ['openid'] } }) });
      if (u.pathname === '/api/account/travel-profile') return route.fulfill({ headers, body: JSON.stringify({ ok: true, exists: true, profile: { schemaVersion: 'GV-TRAVEL-PROFILE-V1', homeAirport: 'YYZ', homeCity: 'Toronto', residenceCountry: 'Canada', citizenshipCountries: ['Canada'], interests: ['Food'], hotelStyle: 'Boutique', pace: 'Balanced', defaultCurrency: 'CAD', visitedPlaces: ['Lisbon'], wishListPlaces: ['Kyoto'], updatedAt: null } }) });
      return route.fulfill({ status: 404, headers, body: '{}' });
    }
    if (u.origin === origin) {
      const isReact = u.pathname.startsWith('/react/');
      const root = artifactRoot ? (isReact ? path.join(artifactRoot, 'react') : artifactRoot) : path.resolve(isReact ? 'web/out' : 'frontend');
      let file = path.resolve(root, '.' + (isReact ? u.pathname.slice(6) : u.pathname));
      if (u.pathname.endsWith('/')) file = path.join(file, 'index.html');
      if (!artifactRoot && !isReact) file = frontendSourcePath(root, path.relative(root, file));
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        if (!/\.(jpg|png|webp|mp4|svg)$/.test(u.pathname)) seen.missing.push(u.pathname);
        return route.fulfill({ status: 404, body: 'Missing offline asset' });
      }
      return route.fulfill({ status: 200, contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => seen.errors.push(error.message));
  // Session storage belongs to globevoy.com: read it from a plain GlobeVoy file when the tab is on Cognito.
  const onSite = async () => { if (new URL(page.url()).origin !== origin) await page.goto(origin + '/runtime/environment-policy.js'); };
  const storage = async () => { await onSite(); return page.evaluate(([s, p]) => ({ session: JSON.parse(sessionStorage.getItem(s) || 'null'), pending: JSON.parse(sessionStorage.getItem(p) || 'null'), local: JSON.stringify(localStorage) }), [SESSION_KEY, PENDING_KEY]); };
  return { context, page, seen, storage };
}

async function signInAsMember(s, from = '/index.html') {
  await s.page.goto(origin + from);
  await s.page.locator('#signin').click();
  await s.page.waitForURL(url => url.pathname === '/sign-in.html');
  await s.page.locator('#gv-signin-start').click();
  await s.page.waitForURL(url => url.origin === cognito);
  const authorize = s.seen.authorize.at(-1);
  await s.page.goto(origin + '/auth-callback.html?code=offline-code&state=' + encodeURIComponent(authorize.searchParams.get('state')));
  await s.page.waitForURL(url => url.origin === origin && url.pathname === from);
  return authorize;
}

test('guest → sign-in page → Cognito with PKCE; the callback makes a member; sign-out ends the session', { timeout: 60000 }, async () => {
  const s = await site();
  try {
    await s.page.goto(origin + '/index.html');
    assert.equal(await s.page.locator('#signin').innerText(), 'Sign In');
    assert.equal((await s.storage()).session, null, 'starts as a guest');

    await s.page.locator('#signin').click();
    await s.page.waitForURL(url => url.pathname === '/sign-in.html');
    assert.equal(new URL(s.page.url()).searchParams.get('returnTo'), '/index.html');
    assert.equal(await s.page.locator('#gv-signin-start').getAttribute('data-return-to'), '/index.html');
    assert.equal(await s.page.locator('input[type=password]').count(), 0, 'GlobeVoy never asks for a password');

    await s.page.locator('#gv-signin-start').click();
    await s.page.waitForURL(url => url.origin === cognito);
    const authorize = s.seen.authorize.at(-1);
    assert.equal(authorize.searchParams.get('response_type'), 'code');
    assert.equal(authorize.searchParams.get('client_id'), clientId);
    assert.equal(authorize.searchParams.get('redirect_uri'), origin + '/auth-callback.html');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.match(authorize.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
    assert.match(authorize.searchParams.get('scope'), /\bopenid\b/);
    const pending = (await s.storage()).pending;
    assert.equal(pending.state, authorize.searchParams.get('state'));
    assert.equal(pending.returnTo, '/index.html');

    await s.page.goto(origin + '/auth-callback.html?code=offline-code&state=' + encodeURIComponent(pending.state));
    await s.page.waitForURL(url => url.origin === origin && url.pathname === '/index.html');
    const exchange = s.seen.token.at(-1);
    assert.equal(exchange.get('grant_type'), 'authorization_code');
    assert.equal(exchange.get('code_verifier'), pending.verifier);
    assert.equal(exchange.get('client_secret'), null);
    let stored = await s.storage();
    assert.equal(stored.session.accessToken, 'offline-access-token');
    assert.equal(stored.session.user.email, 'maya.chen@example.test');
    assert.equal(stored.pending, null, 'the one-time sign-in request is cleared');
    assert.doesNotMatch(JSON.stringify(stored.session), /offline-id-token|offline-refresh-token/, 'ID and refresh tokens are never stored');
    assert.doesNotMatch(stored.local, /offline-access-token|offline-id-token|offline-refresh-token/, 'no tokens in localStorage');

    // Member header on the classic pages, and it persists across reloads and pages.
    await s.page.locator('#account-trigger').waitFor();
    assert.equal(await s.page.locator('.account-avatar').first().innerText(), 'MC');
    await s.page.reload();
    await s.page.locator('#account-trigger').waitFor();
    await s.page.goto(origin + '/booking.html');
    await s.page.locator('#account-trigger').waitFor();
    await s.page.goto(origin + '/react/account/');
    await s.page.getByRole('heading', { name: 'Welcome, Maya.' }).waitFor();
    assert.match(await s.page.locator('.cx-facts').innerText(), /maya\.chen@example\.test[\s\S]*Verified/);
    await s.page.goto(origin + '/react/travel-profile/');
    await s.page.locator('#profile-form').waitFor();
    assert.equal(await s.page.locator('input[placeholder="Toronto"]').inputValue(), 'Toronto');
    assert.ok(s.seen.api.some(r => r.path === '/api/account/travel-profile' && r.auth === 'Bearer offline-access-token'));

    // Sign out from the classic Account menu.
    await s.page.goto(origin + '/index.html');
    await s.page.locator('#account-trigger').click();
    const menu = s.page.locator('#account-list');
    assert.deepEqual(await menu.locator('nav a, nav button').allInnerTexts(), ['Account', 'Travel Profile', 'Sign out']);
    await menu.getByRole('button', { name: 'Sign out' }).click();
    await s.page.waitForURL(url => url.origin === cognito && url.pathname === '/logout');
    const logout = s.seen.logout.at(-1);
    assert.equal(logout.searchParams.get('client_id'), clientId);
    assert.equal(logout.searchParams.get('logout_uri'), origin + '/index.html');
    await s.page.goto(origin + '/index.html');
    assert.equal((await s.storage()).session, null, 'sign-out clears the session');
    assert.equal(await s.page.locator('#signin').innerText(), 'Sign In');
    assert.deepEqual(s.seen.errors, []);
    assert.deepEqual(s.seen.missing, []);
  } finally { await s.context.close(); }
});

test('Create an account opens Cognito sign-up with the same PKCE request; a wrong state never signs in', { timeout: 30000 }, async () => {
  const s = await site();
  try {
    await s.page.goto(origin + '/sign-in.html?returnTo=%2Freact%2Ftravel-profile%2F');
    await s.page.locator('#gv-signup-start').click();
    await s.page.waitForURL(url => url.origin === cognito && url.pathname === '/signup');
    const signup = s.seen.signup.at(-1);
    assert.equal(signup.searchParams.get('client_id'), clientId);
    assert.equal(signup.searchParams.get('redirect_uri'), origin + '/auth-callback.html');
    assert.equal(signup.searchParams.get('code_challenge_method'), 'S256');
    const pending = (await s.storage()).pending;
    assert.equal(pending.state, signup.searchParams.get('state'));
    assert.equal(pending.returnTo, '/react/travel-profile/');

    await s.page.goto(origin + '/auth-callback.html?code=offline-code&state=not-the-state');
    await s.page.locator('#gv-auth-status, [role=status]').first().waitFor();
    await s.page.waitForTimeout(300);
    assert.equal(s.seen.token.length, 0, 'no token exchange after a state mismatch');
    assert.equal((await s.storage()).session, null);
  } finally { await s.context.close(); }
});

test('signed-in travellers keep their session on the React pages, and its header matches the classic menu', { timeout: 40000 }, async () => {
  const s = await site();
  try {
    await signInAsMember(s, '/index.html');
    await s.page.goto(origin + '/react/account/');
    await s.page.locator('.cx-menu > button').click();
    assert.deepEqual(await s.page.locator('#cx-account-panel nav a, #cx-account-panel nav button').allInnerTexts(), ['Account', 'Travel Profile', 'Sign out']);
    await s.page.reload();
    await s.page.getByRole('heading', { name: 'Welcome, Maya.' }).waitFor();
    // A guest on the React pages is sent to the GlobeVoy sign-in page, not straight to Cognito.
    const guest = await site();
    try {
      await guest.page.goto(origin + '/react/account/');
      await guest.page.getByRole('heading', { name: 'Your GlobeVoy account' }).waitFor();
      await guest.page.locator('.cx-top .cx-signin').click();
      await guest.page.waitForURL(url => url.pathname === '/sign-in.html');
      assert.equal(new URL(guest.page.url()).searchParams.get('returnTo'), '/react/account/');
    } finally { await guest.context.close(); }
  } finally { await s.context.close(); }
});

test('saved trips are gone: no Save buttons, and old My Trips addresses open Account', { timeout: 30000 }, async () => {
  const s = await site();
  try {
    for (const [from, query] of [['/my-trips.html', '?tab=a#top'], ['/saved-trips.html', ''], ['/react/my-trips/', '']]) {
      await s.page.goto(origin + from + query);
      await s.page.waitForURL(url => url.pathname === '/react/account/');
      if (query) assert.equal(new URL(s.page.url()).search + new URL(s.page.url()).hash, query);
    }
    for (const page of ['results.html', 'multi-city-trip.html']) {
      const html = fs.readFileSync(artifactRoot ? path.join(artifactRoot, page) : frontendSourcePath(path.resolve('frontend'), page), 'utf8');
      assert.doesNotMatch(html, /mcv-save-trip|gv-mtd-save|saved-trips-705c/);
    }
  } finally { await s.context.close(); }
});
