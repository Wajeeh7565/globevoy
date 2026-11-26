'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthSession } from '@/lib/contracts';
import { clearAuthSession, getAuthSession, reverifyAuthSession, safeReturnTo, signOut } from '@/lib/auth';

interface AuthContextValue {
  session: AuthSession | null;
  loading: boolean;
  status: string;
  signIn: (returnTo?: string) => Promise<void>;
  signOut: () => void;
  clear: () => void;
  refresh: () => Promise<AuthSession | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');

  const refresh = useCallback(async () => {
    const current = getAuthSession();
    if (!current) {
      setSession(null);
      setLoading(false);
      return null;
    }
    setLoading(true);
    const verified = await reverifyAuthSession(current);
    setSession(verified);
    setLoading(false);
    return verified;
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // GV-WEB-4: every sign-in starts on the GlobeVoy sign-in page, which runs the same
  // Cognito PKCE request (auth-session-705b-r3.js) and shares this session storage.
  const signIn = useCallback(async (returnTo?: string) => {
    setStatus('Opening sign-in…');
    try {
      const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/sign-in.html?returnTo=${encodeURIComponent(safeReturnTo(returnTo || here))}`);
    } catch (error) {
      // Sign-in can be intentionally unavailable on localhost or fail before
      // navigation begins (for example if required browser crypto is missing).
      // Surface that as normal product status instead of rethrowing an
      // unhandled promise that triggers the Next.js development error overlay.
      setStatus(error instanceof Error ? error.message : 'Sign-in could not be started.');
    }
  }, []);

  const clear = useCallback(() => {
    clearAuthSession();
    setSession(null);
    setStatus('');
  }, []);

  const doSignOut = useCallback(() => {
    setSession(null);
    signOut();
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ session, loading, status, signIn, signOut: doSignOut, clear, refresh }), [session, loading, status, signIn, doSignOut, clear, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
