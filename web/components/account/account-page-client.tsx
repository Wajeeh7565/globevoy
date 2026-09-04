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
        <p className="gv-kicker">YOUR GLOBEVOY ACCOUNT</p>
        <h1 id="account-sign-in-title">Plan freely. Sign in when you want Globevoy to remember.</h1>
        <p className="gv-muted">Guest discovery stays available. A private account unlocks Saved Trips, Travel Profile and cross-session continuation without turning sign-in into a gate before you can explore.</p>
        <div className="gv-account-dashboard__cards" aria-label="Account benefits">
          <div className="gv-account-dashboard__card"><span>01</span><strong>Saved Trips</strong><small>Keep private trip snapshots and return to them later.</small></div>
          <div className="gv-account-dashboard__card"><span>02</span><strong>Travel Profile</strong><small>Remember your home airport, interests, travel style and destination history.</small></div>
        </div>
        <div className="gv-account-actions">
          <Button onClick={() => { void signIn('/react/account/'); }}>Sign in or create account</Button>
          <Link className="gv-button gv-button--secondary" href="/">Continue as guest</Link>
        </div>
        <p className="gv-muted">Account creation and password recovery are handled by Globevoy&apos;s secure Amazon Cognito managed sign-in rather than by a custom password form on this page.</p>
        {status ? <p className="gv-account-status" role="status">{status}</p> : null}
      </section>
    );
  }

  return (
    <section className="gv-account-panel gv-account-dashboard" aria-labelledby="account-title">
      <div>
        <p className="gv-kicker">SIGNED-IN ACCOUNT</p>
        <h1 id="account-title">Welcome back.</h1>
        <p className="gv-account-success">Your Globevoy account session is active.</p>
      </div>

      <div className="gv-account-dashboard__cards">
        <Link className="gv-account-dashboard__card" href="/my-trips/"><span>MY TRIPS</span><strong>Saved Trips</strong><small>Open private saved journeys, recheck current prices and continue planning.</small></Link>
        <Link className="gv-account-dashboard__card" href="/travel-profile/"><span>PERSONALIZATION</span><strong>Travel Profile</strong><small>Set your home base, country context, interests, hotel style and travel history.</small></Link>
      </div>

      <dl className="gv-account-details">
        <div><dt>Email</dt><dd>{session.user.email || 'Email available after Cognito profile lookup'}</dd></div>
        <div><dt>Email verified</dt><dd>{session.user.emailVerified ? 'Yes' : 'Not confirmed in this session'}</dd></div>
      </dl>

      <div className="gv-account-dashboard__footer">
        <p>Globevoy keeps the access token only in sessionStorage for this browser session. No refresh token or ID token is persisted by this React account flow.</p>
        <Button variant="secondary" onClick={signOut}>Sign out</Button>
      </div>
    </section>
  );
}
