'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';

// GV-WEB-4: guests open the GlobeVoy sign-in page (which hands over to Cognito);
// members get the Account menu with Account, Travel Profile and Sign out.
export function signInHref(): string {
  if (typeof window === 'undefined') return '/sign-in.html';
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `/sign-in.html?returnTo=${encodeURIComponent(here)}`;
}

export function initialsFor(identity: string): string {
  const name = String(identity || '').split('@')[0];
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return ((parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)) || 'GV').toUpperCase();
}

export function AccountNav() {
  const { session, loading, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState('/sign-in.html');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { setHref(signInHref()); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', key); };
  }, [open]);

  const identity = session?.user.email || session?.user.username || 'Signed in';
  const initials = useMemo(() => initialsFor(identity), [identity]);

  if (!session) {
    return <a className="cx-signin" href={href} aria-disabled={loading || undefined}>{loading ? 'Checking…' : 'Sign In'}</a>;
  }
  return (
    <div className="cx-menu" ref={root}>
      <button type="button" aria-haspopup="true" aria-expanded={open} aria-controls="cx-account-panel" onClick={() => setOpen(value => !value)}>
        <span className="cx-avatar" aria-hidden="true">{initials}</span>
        <span>Account</span>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
      </button>
      {open ? (
        <div className="cx-panel" id="cx-account-panel">
          <div className="cx-panel-id"><span className="cx-avatar" aria-hidden="true">{initials}</span><div><strong>Signed in</strong><small>{identity}</small></div></div>
          <nav aria-label="Account">
            <a href="/react/account/">Account</a>
            <a href="/react/travel-profile/">Travel Profile</a>
            <button type="button" onClick={signOut}>Sign out</button>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
