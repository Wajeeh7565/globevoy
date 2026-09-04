'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { browserIsStagingOrigin } from '@/lib/public-config';

export function AccountNav() {
  const { session, loading, signIn } = useAuth();
  const [stagingOrigin, setStagingOrigin] = useState(false);

  useEffect(() => {
    setStagingOrigin(browserIsStagingOrigin());
  }, []);

  return (
    <nav className="gv-account-nav" aria-label="Account navigation">
      {session ? (
        <>
          <Link href="/my-trips/">My Trips</Link>
          <Link href="/travel-profile/" aria-label={`Travel Profile for ${session.user.email || session.user.username || 'signed-in user'}`}>Travel Profile</Link>
        </>
      ) : (
        <button
          type="button"
          className="gv-account-nav__signin"
          disabled={loading || !stagingOrigin}
          title={!stagingOrigin ? 'Secure sign-in is tested on the Globevoy staging site, not localhost.' : undefined}
          onClick={() => { if (stagingOrigin) void signIn('/react/account/'); }}
        >
          {loading ? 'Checking…' : 'Sign in'}
        </button>
      )}
    </nav>
  );
}
