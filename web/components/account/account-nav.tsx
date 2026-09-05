'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { browserIsStagingOrigin } from '@/lib/public-config';

function currentReturnTo(): string {
  if (typeof window === 'undefined') return '/react/';
  const value = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return value.startsWith('/react/') ? value : '/react/';
}

export function AccountNav() {
  const { session, loading, signIn, signOut } = useAuth();
  const [stagingOrigin, setStagingOrigin] = useState(false);

  useEffect(() => {
    setStagingOrigin(browserIsStagingOrigin());
  }, []);

  const accountLabel = useMemo(() => {
    const identity = session?.user.email || session?.user.username || 'Account';
    const initial = identity.trim().charAt(0).toUpperCase() || 'G';
    return { identity, initial };
  }, [session?.user.email, session?.user.username]);

  return (
    <nav className="gv-account-nav" aria-label="Account navigation">
      {session ? (
        <>
          <Link className="gv-account-nav__trips" href="/my-trips/">My Trips</Link>
          <details className="gv-account-nav__menu">
            <summary aria-label={`Open account menu for ${accountLabel.identity}`}>
              <span className="gv-account-nav__avatar" aria-hidden="true">{accountLabel.initial}</span>
              <span>Account</span>
              <span className="gv-account-nav__chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="gv-account-nav__panel">
              <div className="gv-account-nav__identity">
                <strong>Signed in</strong>
                <span>{accountLabel.identity}</span>
              </div>
              <Link href="/travel-profile/">
                <strong>Travel Profile</strong>
                <small>Home airport, passport countries and travel preferences</small>
              </Link>
              <Link href="/my-trips/">
                <strong>Saved Trips</strong>
                <small>Continue trips you saved to this account</small>
              </Link>
              <Link href="/account/">
                <strong>Account</strong>
                <small>Session and account details</small>
              </Link>
              <button type="button" onClick={signOut}>Sign out</button>
            </div>
          </details>
        </>
      ) : (
        <button
          type="button"
          className="gv-account-nav__signin"
          disabled={loading || !stagingOrigin}
          title={!stagingOrigin ? 'Secure sign-in is available on the Globevoy staging site; localhost keeps authentication disabled.' : undefined}
          onClick={() => { if (stagingOrigin) void signIn(currentReturnTo()); }}
        >
          {loading ? 'Checking…' : 'Sign in'}
        </button>
      )}
    </nav>
  );
}
