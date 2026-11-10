'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { browserEnvironment } from '@/lib/public-config';

function currentReturnTo(): string {
  if (typeof window === 'undefined') return '/react/';
  const value = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return value.startsWith('/react/') ? value : '/react/';
}

export function AccountNav() {
  const { session, loading, signIn, signOut } = useAuth();
  const [accountsEnabled, setAccountsEnabled] = useState(false);

  useEffect(() => {
    setAccountsEnabled(browserEnvironment().accountsEnabled);
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
          <details className="gv-account-nav__menu">
            <summary aria-label={`Open account menu for ${accountLabel.identity}`}>
              <span className="gv-account-nav__avatar" aria-hidden="true">{accountLabel.initial}</span>
              <span>Account</span>
              <span className="gv-account-nav__chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="gv-account-nav__panel">
              <div className="gv-account-nav__identity">
                <span className="gv-account-nav__identity-avatar" aria-hidden="true">{accountLabel.initial}</span>
                <span className="gv-account-nav__identity-copy">
                  <strong>Signed in as</strong>
                  <span>{accountLabel.identity}</span>
                </span>
              </div>

              <Link className="gv-account-nav__item" href="/travel-profile/">
                <span className="gv-account-nav__item-icon" aria-hidden="true">✈</span>
                <span className="gv-account-nav__item-copy">
                  <strong>Travel profile</strong>
                  <small>Home airport, countries & preferences</small>
                </span>
                <span className="gv-account-nav__item-arrow" aria-hidden="true">›</span>
              </Link>

              <Link className="gv-account-nav__item" href="/my-trips/">
                <span className="gv-account-nav__item-icon" aria-hidden="true">▣</span>
                <span className="gv-account-nav__item-copy">
                  <strong>My trips</strong>
                  <small>Pick up your saved journeys</small>
                </span>
                <span className="gv-account-nav__item-arrow" aria-hidden="true">›</span>
              </Link>

              <Link className="gv-account-nav__item" href="/account/">
                <span className="gv-account-nav__item-icon" aria-hidden="true">◎</span>
                <span className="gv-account-nav__item-copy">
                  <strong>Account details</strong>
                  <small>Session and account information</small>
                </span>
                <span className="gv-account-nav__item-arrow" aria-hidden="true">›</span>
              </Link>

              <button className="gv-account-nav__signout" type="button" onClick={signOut}>
                <span className="gv-account-nav__signout-icon" aria-hidden="true">↪</span>
                <span>Sign out</span>
              </button>
            </div>
          </details>
        </>
      ) : (
        <button
          type="button"
          className="gv-account-nav__signin"
          disabled={loading || !accountsEnabled}
          title={!accountsEnabled ? 'Accounts are not available on this website yet.' : undefined}
          onClick={() => { if (accountsEnabled) void signIn(currentReturnTo()); }}
        >
          {loading ? 'Checking…' : 'Sign in'}
        </button>
      )}
    </nav>
  );
}
