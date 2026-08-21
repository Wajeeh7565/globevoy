'use client';

import type { AuthSession } from '@/lib/contracts';
import {
  COGNITO_CALLBACK_URL,
  COGNITO_CLIENT_ID,
  COGNITO_DOMAIN,
  COGNITO_LOGOUT_URL,
  COGNITO_SCOPES,
  GV_AUTH_VERSION,
  STAGING_API_BASE_URL,
  browserIsStagingOrigin
} from '@/lib/public-config';

const PENDING_KEY = 'globevoy.auth.pending.705b-r3';
const SESSION_KEY = 'globevoy.auth.session.705b-r3';
const REVERIFY_AFTER_MS = 5 * 60 * 1000;
const EXPIRY_SKEW_MS = 30 * 1000;

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
  if (typeof window === 'undefined') return null;
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
  if (!browserIsStagingOrigin()) throw new Error('Secure account sign-in is available only on the Globevoy staging origin.');
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

  const authorize = new URL(`${COGNITO_DOMAIN}/oauth2/authorize`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', COGNITO_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', COGNITO_CALLBACK_URL);
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
  if (!session) return null;
  if (Date.now() - Number(session.verifiedAt || 0) < REVERIFY_AFTER_MS) return session;
  if (!browserIsStagingOrigin()) return null;
  try {
    const response = await fetch(`${STAGING_API_BASE_URL}/api/account/session`, {
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
  if (!browserIsStagingOrigin()) {
    window.location.assign('/');
    return;
  }
  const logout = new URL(`${COGNITO_DOMAIN}/logout`);
  logout.searchParams.set('client_id', COGNITO_CLIENT_ID);
  logout.searchParams.set('logout_uri', COGNITO_LOGOUT_URL);
  window.location.assign(logout.toString());
}

export const AUTH_STORAGE_CONTRACT = Object.freeze({
  sessionKey: SESSION_KEY,
  pendingKey: PENDING_KEY,
  localStorageTokensAllowed: false,
  refreshTokenPersisted: false,
  idTokenPersisted: false
});
