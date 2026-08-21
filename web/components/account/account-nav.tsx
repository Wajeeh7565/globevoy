'use client';

import Link from 'next/link';
import { useAuth } from '@/components/account/auth-provider';

export function AccountNav() {
  const { session, loading, signIn } = useAuth();
  return (
    <nav className="gv-account-nav" aria-label="Account navigation">
      <Link href="/my-trips/">My Trips</Link>
      {session ? (
        <Link href="/account/" aria-label={`Account for ${session.user.email || session.user.username || 'signed-in user'}`}>Account</Link>
      ) : (
        <button
          type="button"
          className="gv-account-nav__signin"
          disabled={loading}
          onClick={() => { void signIn('/react/my-trips/'); }}
        >
          {loading ? 'Checking…' : 'Sign in'}
        </button>
      )}
    </nav>
  );
}
