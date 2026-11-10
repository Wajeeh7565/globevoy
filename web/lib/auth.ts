'use client';

import type { AuthSession } from '@/lib/contracts';
import { COGNITO_SCOPES, GV_AUTH_VERSION, browserEnvironment } from '@/lib/public-config';

const PENDING_KEY = 'globevoy.auth.pending.705b-r3';
const SESSION_KEY = 'globevoy.auth.session.705b-r3';
const REVERIFY_AFTER_MS = 5 * 60 * 1000;
const EXPIRY_SKEW_MS = 30 * 1000;

// Authentication is selected by the same origin policy as the classic website.
// A production release must supply a verified, separate Cognito pool and backend.
function activeAuth() {
  const environment = browserEnvironment();
  if (!environment.accountsEnabled || !environment.auth || !environment.apiBaseUrl) {
    throw new Error('Accounts are not available on this website yet.');
  }
  return {
    domain: environment.auth.domainBaseUrl,
    clientId: environment.auth.clientId,
    callbackUrl: `${window.location.origin}/auth-callback.html`,
    logoutUrl: `${window.location.origin}/index.html`,
    apiBaseUrl: environment.apiBaseUrl
  };
}

interface PendingAuth {
  version: string;
  verifier: string;
  state: string;
  returnTo: string;
  createdAt: number;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

function remove(key: string): void {
  try { window.sessionStorage.removeItem(key); } catch {}
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomUrlSafe(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  window.crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function safeReturnTo(value?: string): string {
  const fallback = '/react/account/';
  try {
    const target = new URL(String(value || fallback), window.location.origin);
    if (target.origin !== window.location.origin) return fallback;
    if (target.pathname === '/auth-callback.html') return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}

export function getAuthSession(): AuthSession | null {
  if (typeof window === 'undefined' || !browserEnvironment().accountsEnabled) return null;
  const stored = readJson<AuthSession>(SESSION_KEY);
  if (!stored || stored.version !== GV_AUTH_VERSION || !stored.accessToken || !Number.isFinite(Number(stored.expiresAt)) || !stored.user?.sub) {
    remove(SESSION_KEY);
    return null;
  }
  if (Number(stored.expiresAt) <= Date.now() + EXPIRY_SKEW_MS) {
    remove(SESSION_KEY);
    return null;
  }
  return stored;
}

export function clearAuthSession(): void {
  if (typeof window === 'undefined') return;
  remove(SESSION_KEY);
  remove(PENDING_KEY);
}

export async function beginSignIn(returnTo?: string): Promise<void> {
  const account = activeAuth();
  if (!window.crypto?.subtle || !window.crypto?.getRandomValues) throw new Error('This browser does not support the security features required for sign-in.');

  const verifier = randomUrlSafe(32);
  const challenge = await pkceChallenge(verifier);
  const state = randomUrlSafe(24);
  const pending: PendingAuth = {
    version: GV_AUTH_VERSION,
    verifier,
    state,
    returnTo: safeReturnTo(returnTo || `${window.location.pathname}${window.location.search}${window.location.hash}`),
    createdAt: Date.now()
  };
  writeJson(PENDING_KEY, pending);

  const authorize = new URL(`${account.domain}/oauth2/authorize`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', account.clientId);
  authorize.searchParams.set('redirect_uri', account.callbackUrl);
  authorize.searchParams.set('scope', COGNITO_SCOPES.join(' '));
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  window.location.assign(authorize.toString());
}

interface VerifiedSessionResponse {
  authenticated?: boolean;
  user?: { sub?: string };
  token?: { scopes?: string[] };
}

export async function reverifyAuthSession(session = getAuthSession()): Promise<AuthSession | null> {
  if (!browserEnvironment().accountsEnabled || !session) return null;
  if (Date.now() - Number(session.verifiedAt || 0) < REVERIFY_AFTER_MS) return session;
  const account = activeAuth();
  try {
    const response = await fetch(`${account.apiBaseUrl}/api/account/session`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.accessToken}` },
      cache: 'no-store',
      credentials: 'omit'
    });
    const body = await response.json() as VerifiedSessionResponse;
    if (!response.ok || body.authenticated !== true || body.user?.sub !== session.user.sub) throw new Error('session mismatch');
    const next: AuthSession = {
      ...session,
      verifiedAt: Date.now(),
      scopes: Array.isArray(body.token?.scopes) ? body.token.scopes.slice() : session.scopes
    };
    writeJson(SESSION_KEY, next);
    return next;
  } catch {
    clearAuthSession();
    return null;
  }
}

export function signOut(): void {
  clearAuthSession();
  if (!browserEnvironment().accountsEnabled) {
    window.location.assign('/');
    return;
  }
  const account = activeAuth();
  const logout = new URL(`${account.domain}/logout`);
  logout.searchParams.set('client_id', account.clientId);
  logout.searchParams.set('logout_uri', account.logoutUrl);
  window.location.assign(logout.toString());
}

export const AUTH_STORAGE_CONTRACT = Object.freeze({
  sessionKey: SESSION_KEY,
  pendingKey: PENDING_KEY,
  localStorageTokensAllowed: false,
  refreshTokenPersisted: false,
  idTokenPersisted: false
});
