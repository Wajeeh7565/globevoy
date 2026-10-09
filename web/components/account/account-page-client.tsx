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
        <h1 id="account-sign-in-title">Your trips, one place.</h1>
        <p className="gv-muted">Save your trips and travel preferences. You can still explore as a guest.</p>
        <div className="gv-account-dashboard__cards" aria-label="Account benefits">
          <div className="gv-account-dashboard__card"><span>01</span><strong>Saved Trips</strong><small>Revisit your favourite journeys.</small></div>
          <div className="gv-account-dashboard__card"><span>02</span><strong>Travel Profile</strong><small>Save your airport and travel style.</small></div>
        </div>
        <div className="gv-account-actions">
          <Button onClick={() => { void signIn('/react/account/'); }}>Sign in or create account</Button>
          <a className="gv-button gv-button--secondary" href="/">Continue as guest</a>
        </div>
        <p className="gv-muted">Sign-in and password recovery are handled securely by Amazon Cognito.</p>
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
        <Link className="gv-account-dashboard__card" href="/my-trips/"><span>MY TRIPS</span><strong>Saved Trips</strong><small>Reopen trips and check current prices.</small></Link>
        <Link className="gv-account-dashboard__card" href="/travel-profile/"><span>PERSONALIZATION</span><strong>Travel Profile</strong><small>Your home airport, interests and travel style.</small></Link>
      </div>

      <dl className="gv-account-details">
        <div><dt>Email</dt><dd>{session.user.email || 'Email available after Cognito profile lookup'}</dd></div>
        <div><dt>Email verified</dt><dd>{session.user.emailVerified ? 'Yes' : 'Not confirmed in this session'}</dd></div>
      </dl>

      <div className="gv-account-dashboard__footer">
        <p>Your saved trips and preferences are private to your account.</p>
        <Button variant="secondary" onClick={signOut}>Sign out</Button>
      </div>
    </section>
  );
}
