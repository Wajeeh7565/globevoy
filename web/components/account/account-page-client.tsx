'use client';

import Link from 'next/link';
import { useAuth } from '@/components/account/auth-provider';
import { Button } from '@/components/ui/button';

export function AccountPageClient() {
  const { session, loading, status, signIn, signOut } = useAuth();

  if (loading) {
    return <section className="gv-account-panel" aria-live="polite"><p className="gv-muted">Checking your secure account session…</p></section>;
  }

  if (!session) {
    return (
      <section className="gv-account-panel" aria-labelledby="account-sign-in-title">
        <p className="gv-kicker">PRIVATE ACCOUNT</p>
        <h1 id="account-sign-in-title">Sign in to your Globevoy account</h1>
        <p className="gv-muted">Guest trip planning still works without an account. Signing in is only needed for private Saved Trips and account features.</p>
        <div className="gv-account-actions">
          <Button onClick={() => { void signIn('/react/account/'); }}>Sign in or create account</Button>
          <a className="gv-button gv-button--secondary" href="/index.html">Continue as guest</a>
        </div>
        {status ? <p className="gv-account-status" role="status">{status}</p> : null}
      </section>
    );
  }

  return (
    <section className="gv-account-panel" aria-labelledby="account-title">
      <p className="gv-kicker">GV-WEB-707A · COGNITO ACCOUNT</p>
      <h1 id="account-title">Your account</h1>
      <p className="gv-account-success">Signed in securely with Amazon Cognito.</p>
      <dl className="gv-account-details">
        <div><dt>Email</dt><dd>{session.user.email || 'Email available after Cognito profile lookup'}</dd></div>
        <div><dt>Account ID</dt><dd>{session.user.username || session.user.sub}</dd></div>
        <div><dt>Email verified</dt><dd>{session.user.emailVerified ? 'Yes' : 'Not confirmed in this session'}</dd></div>
      </dl>
      <p className="gv-muted">Globevoy keeps the access token only in sessionStorage for this browser tab/session. No refresh token or ID token is persisted by this React account flow.</p>
      <div className="gv-account-actions">
        <Link className="gv-button gv-button--primary" href="/my-trips/">View My Trips</Link>
        <Button variant="secondary" onClick={signOut}>Sign out</Button>
      </div>
    </section>
  );
}
