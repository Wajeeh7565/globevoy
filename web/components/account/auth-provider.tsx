'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthSession } from '@/lib/contracts';
import { beginSignIn, clearAuthSession, getAuthSession, reverifyAuthSession, signOut } from '@/lib/auth';

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

  const signIn = useCallback(async (returnTo?: string) => {
    setStatus('Opening secure sign-in…');
    try {
      await beginSignIn(returnTo);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sign-in could not be started.');
      throw error;
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
