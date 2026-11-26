/* GV-ACCOUNT-705B-R3 — staging browser Authorization Code + PKCE session flow. */
(function () {
  'use strict';

  if (window.GlobevoyAuth705B) return;

  const VERSION = 'GV-ACCOUNT-705B-R3';
  const PENDING_KEY = 'globevoy.auth.pending.705b-r3';
  const SESSION_KEY = 'globevoy.auth.session.705b-r3';
  const MAX_PENDING_AGE_MS = 10 * 60 * 1000;
  const REVERIFY_AFTER_MS = 5 * 60 * 1000;
  const EXPIRY_SKEW_MS = 30 * 1000;

  function config() {
    return window.GLOBEVOY_AUTH_CONFIG || null;
  }

  function authEnabled() {
    const cfg = config();
    return Boolean(cfg && cfg.enabled === true && cfg.version === VERSION && cfg.clientSecretPresent === false);
  }

  function readJson(key) {
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeJson(key, value) {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  }

  function remove(key) {
    try { window.sessionStorage.removeItem(key); } catch (_) {}
  }

  function base64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function randomUrlSafe(byteLength) {
    const bytes = new Uint8Array(byteLength);
    window.crypto.getRandomValues(bytes);
    return base64Url(bytes);
  }

  async function pkceChallenge(verifier) {
    const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64Url(new Uint8Array(digest));
  }

  function safeReturnTo(value) {
    const fallback = '/account.html';
    try {
      const target = new URL(String(value || fallback), window.location.origin);
      if (target.origin !== window.location.origin) return fallback;
      if (target.pathname === '/auth-callback.html') return fallback;
      return `${target.pathname}${target.search}${target.hash}`;
    } catch (_) {
      return fallback;
    }
  }

  function currentReturnTo() {
    return safeReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  }

  function getSession() {
    if (!authEnabled()) return null;
    const stored = readJson(SESSION_KEY);
    if (!stored || stored.version !== VERSION || !stored.accessToken || !Number.isFinite(Number(stored.expiresAt))) {
      remove(SESSION_KEY);
      return null;
    }
    if (Number(stored.expiresAt) <= Date.now() + EXPIRY_SKEW_MS) {
      remove(SESSION_KEY);
      return null;
    }
    return stored;
  }

  function clearSession() {
    remove(SESSION_KEY);
    remove(PENDING_KEY);
    renderAuthUi(null);
  }

  function rootHref(path) {
    const depth = parseInt(document.body?.dataset?.depth || '0', 10);
    return depth === 0 ? path : `../${path}`;
  }

  function displayName(session) {
    return session?.user?.email || session?.user?.username || 'Account';
  }

  function renderAuthUi(session = getSession()) {
    if (document.body) document.body.dataset.signedIn = session ? 'true' : 'false';
    document.querySelectorAll('[data-gv-auth-entry]').forEach((entry) => {
      const full = entry.querySelector('.gv-auth__full');
      const short = entry.querySelector('.gv-auth__short');
      entry.setAttribute('href', rootHref('account.html'));
      entry.setAttribute('aria-label', session ? `Account for ${displayName(session)}` : 'Sign in or create an account');
      if (full) full.textContent = session ? 'Account' : 'Sign in';
      if (short) short.textContent = session ? 'Account' : 'Sign in';
    });

    const signedOut = document.getElementById('gv-account-signed-out');
    const signedIn = document.getElementById('gv-account-signed-in');
    const email = document.getElementById('gv-account-email');
    const username = document.getElementById('gv-account-username');
    if (signedOut) signedOut.hidden = Boolean(session);
    if (signedIn) signedIn.hidden = !session;
    if (email) email.textContent = session?.user?.email || 'Email available after Cognito profile lookup';
    if (username) username.textContent = session?.user?.username || session?.user?.sub || '';
  }

  function status(message, kind) {
    const node = document.getElementById('gv-auth-status') || document.getElementById('gv-account-status');
    if (!node) return;
    node.textContent = message || '';
    node.dataset.kind = kind || '';
  }

  async function beginSignIn(options = {}) {
    if (!authEnabled()) {
      status('Secure sign-in is not available on this website yet.', 'error');
      return false;
    }
    if (!window.crypto?.subtle || !window.crypto?.getRandomValues) {
      status('This browser does not support the security features required for sign-in.', 'error');
      return false;
    }

    const cfg = config();
    const verifier = randomUrlSafe(32); // RFC 7636: 32 random bytes -> 43 base64url chars.
    const challenge = await pkceChallenge(verifier);
    const state = randomUrlSafe(24);
    const returnTo = safeReturnTo(options.returnTo || currentReturnTo());
    const pending = { version: VERSION, verifier, state, returnTo, createdAt: Date.now() };
    writeJson(PENDING_KEY, pending);

    // GV-WEB-4: "Create an account" opens Cognito's hosted sign-up page with the same
    // PKCE request; everything else (and the default) uses the authorize endpoint.
    const authorize = new URL(options.screen === 'signup' && cfg.domainBaseUrl ? `${cfg.domainBaseUrl}/signup` : cfg.authorizeEndpoint);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', cfg.clientId);
    authorize.searchParams.set('redirect_uri', cfg.callbackUrl);
    authorize.searchParams.set('scope', cfg.oauth.scopes.join(' '));
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    window.location.assign(authorize.toString());
    return true;
  }

  async function parseJsonResponse(response, fallback) {
    let body = null;
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(body?.error_description || body?.error || fallback);
      error.status = response.status;
      throw error;
    }
    return body || {};
  }

  async function verifyAccessToken(accessToken) {
    const cfg = config();
    const response = await fetch(`${cfg.apiBaseUrl}${cfg.sessionEndpoint}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      credentials: 'omit'
    });
    return parseJsonResponse(response, 'Globevoy could not verify the signed-in session.');
  }

  async function fetchUserInfo(accessToken) {
    const cfg = config();
    const response = await fetch(cfg.userInfoEndpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      credentials: 'omit'
    });
    return parseJsonResponse(response, 'Cognito profile lookup failed.');
  }

  function oauthErrorMessage(code, description) {
    const known = {
      access_denied: 'Sign-in was cancelled or denied.',
      invalid_request: 'The sign-in request could not be completed.',
      unauthorized_client: 'This Globevoy sign-in client is not authorized.',
      server_error: 'The sign-in service had a temporary problem.'
    };
    return known[code] || description || 'Sign-in could not be completed.';
  }

  async function handleCallback() {
    if (!authEnabled()) {
      status('This sign-in callback is not available on this website.', 'error');
      return false;
    }

    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    if (oauthError) {
      remove(PENDING_KEY);
      status(oauthErrorMessage(oauthError, params.get('error_description')), 'error');
      return false;
    }

    const code = params.get('code') || '';
    const returnedState = params.get('state') || '';
    const pending = readJson(PENDING_KEY);
    if (!pending || pending.version !== VERSION || !pending.verifier || !pending.state) {
      status('The sign-in request is missing or has expired. Start sign-in again.', 'error');
      return false;
    }
    if (Date.now() - Number(pending.createdAt || 0) > MAX_PENDING_AGE_MS) {
      remove(PENDING_KEY);
      status('The sign-in request expired. Start sign-in again.', 'error');
      return false;
    }
    if (!code || !returnedState || returnedState !== pending.state) {
      remove(PENDING_KEY);
      status('The sign-in response did not pass the security state check.', 'error');
      return false;
    }

    const cfg = config();
    status('Securely completing sign-in…', 'working');

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', cfg.clientId);
    body.set('code', code);
    body.set('redirect_uri', cfg.callbackUrl);
    body.set('code_verifier', pending.verifier);

    try {
      const tokenResponse = await fetch(cfg.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        cache: 'no-store',
        credentials: 'omit'
      });
      const tokens = await parseJsonResponse(tokenResponse, 'Cognito token exchange failed.');
      const accessToken = String(tokens.access_token || '');
      const tokenType = String(tokens.token_type || '').toLowerCase();
      const expiresIn = Math.max(1, Math.min(86400, Number(tokens.expires_in || 3600)));
      if (!accessToken || tokenType !== 'bearer') throw new Error('Cognito did not return a usable access token.');

      // Deliberately do not persist tokens.refresh_token or tokens.id_token.
      // The first MVP session is tab/session scoped and requires reauthentication.
      const verified = await verifyAccessToken(accessToken);
      if (verified?.authenticated !== true || !verified?.user?.sub) throw new Error('Globevoy did not verify the Cognito access token.');

      let userInfo = {};
      try { userInfo = await fetchUserInfo(accessToken); } catch (_) {}
      const providerExpiryMs = Number(verified?.token?.expiresAt || 0) * 1000;
      const localExpiryMs = Date.now() + expiresIn * 1000;
      const expiresAt = providerExpiryMs > Date.now() ? Math.min(providerExpiryMs, localExpiryMs) : localExpiryMs;

      const session = {
        version: VERSION,
        accessToken,
        expiresAt,
        verifiedAt: Date.now(),
        user: {
          sub: String(verified.user.sub),
          username: verified.user.username || userInfo.username || null,
          email: userInfo.email || null,
          emailVerified: userInfo.email_verified === true || String(userInfo.email_verified).toLowerCase() === 'true'
        },
        scopes: Array.isArray(verified?.token?.scopes) ? verified.token.scopes.slice() : []
      };
      writeJson(SESSION_KEY, session);
      remove(PENDING_KEY);
      renderAuthUi(session);
      const returnTo = safeReturnTo(pending.returnTo || '/account.html');
      window.location.replace(returnTo);
      return true;
    } catch (error) {
      clearSession();
      status(error?.message || 'Sign-in could not be completed.', 'error');
      return false;
    }
  }

  async function reverifySession(session = getSession()) {
    if (!authEnabled()) return null;
    if (!session) return null;
    if (Date.now() - Number(session.verifiedAt || 0) < REVERIFY_AFTER_MS) return session;
    try {
      const verified = await verifyAccessToken(session.accessToken);
      if (verified?.authenticated !== true || verified?.user?.sub !== session.user?.sub) throw new Error('session mismatch');
      const next = { ...session, verifiedAt: Date.now(), scopes: verified?.token?.scopes || session.scopes || [] };
      writeJson(SESSION_KEY, next);
      return next;
    } catch (_) {
      clearSession();
      return null;
    }
  }

  function signOut() {
    const cfg = config();
    clearSession();
    if (!authEnabled()) {
      window.location.assign(rootHref('index.html'));
      return;
    }
    const logout = new URL(cfg.logoutEndpoint);
    logout.searchParams.set('client_id', cfg.clientId);
    logout.searchParams.set('logout_uri', cfg.logoutUrl);
    window.location.assign(logout.toString());
  }

  function bindActions() {
    document.addEventListener('click', (event) => {
      const signIn = event.target.closest('[data-gv-auth-signin]');
      if (signIn) {
        event.preventDefault();
        beginSignIn({ returnTo: signIn.dataset.returnTo || currentReturnTo() });
        return;
      }
      const signUp = event.target.closest('[data-gv-auth-signup]');
      if (signUp) {
        event.preventDefault();
        beginSignIn({ returnTo: signUp.dataset.returnTo || currentReturnTo(), screen: 'signup' });
        return;
      }
      const signOutButton = event.target.closest('[data-gv-auth-signout]');
      if (signOutButton) {
        event.preventDefault();
        signOut();
        return;
      }
      const entry = event.target.closest('[data-gv-auth-entry]');
      if (entry && !getSession()) {
        event.preventDefault();
        beginSignIn({ returnTo: currentReturnTo() });
      }
    });
  }

  async function initialize() {
    bindActions();
    const initial = getSession();
    renderAuthUi(initial);
    if (document.body?.dataset?.gvAuthCallback === 'true') {
      await handleCallback();
      return;
    }
    const verified = await reverifySession(initial);
    renderAuthUi(verified);
    if (document.getElementById('gv-account-status')) {
      if (!authEnabled()) status('Accounts are not available on this website yet.', 'error');
      else if (verified) status('Signed in securely with Amazon Cognito.', 'success');
      else status('You can sign in or create an account. Guest trip planning still works without signing in.', '');
    }
  }

  window.GlobevoyAuth705B = Object.freeze({
    version: VERSION,
    authEnabled,
    getSession,
    beginSignIn,
    handleCallback,
    reverifySession,
    clearSession,
    signOut,
    renderAuthUi,
    _internal: Object.freeze({ safeReturnTo, pkceChallenge, randomUrlSafe })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
