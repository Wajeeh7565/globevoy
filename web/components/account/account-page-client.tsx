'use client';

import { useAuth } from '@/components/account/auth-provider';
import { initialsFor } from '@/components/account/account-nav';

// GV-WEB-4 — Account page (Cinematic Explorer design). Session data comes from
// Cognito via auth-session; this page only shows it and offers Sign out.
function firstName(identity: string): string {
  const local = String(identity || '').split('@')[0].split(/[._\s-]+/)[0] || '';
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : '';
}

export function AccountPageClient() {
  const { session, loading, status, signIn, signOut } = useAuth();

  if (loading) {
    return <section className="cx-wrap cx-state" aria-live="polite"><span className="cx-spinner" aria-hidden="true" /><h1>Opening your account…</h1></section>;
  }

  if (!session) {
    return (
      <div className="cx-wrap">
        <section className="cx-hero account" aria-labelledby="account-title">
          <img src="/assets/images/cinematic/account-nyhavn.jpg" alt="Boats and colourful buildings along Copenhagen’s Nyhavn canal" />
          <div><h1 id="account-title">Your GlobeVoy account</h1><p>Make the next trip feel like yours.</p></div>
        </section>
        <section className="cx-guest">
          <p>Sign in to see all three trip options for every search and keep your Travel Profile. Planning as a guest still works.</p>
          <div className="cx-actions">
            <button className="cx-button primary" type="button" onClick={() => { void signIn('/react/account/'); }}>Sign in <span aria-hidden="true">→</span></button>
            <a className="cx-button" href="/">Keep searching as a guest</a>
          </div>
          {status ? <p className="cx-fine" role="status">{status}</p> : null}
        </section>
      </div>
    );
  }

  const identity = session.user.email || session.user.username || '';
  const name = firstName(identity);
  return (
    <div className="cx-wrap">
      <section className="cx-hero account" aria-labelledby="account-title">
        <img src="/assets/images/cinematic/account-nyhavn.jpg" alt="Boats and colourful buildings along Copenhagen’s Nyhavn canal" />
        <div><h1 id="account-title">{name ? `Welcome, ${name}.` : 'Welcome back.'}</h1><p>Make the next trip feel like yours.</p></div>
      </section>
      <section className="cx-overview">
        <div className="cx-identity">
          <span className="cx-avatar" aria-hidden="true">{initialsFor(identity)}</span>
          <div><h2>{name || 'Your account'}</h2><p>{identity || 'Signed in with Amazon Cognito'}</p></div>
        </div>
        <div>
          <h2 className="cx-title">Account Details</h2>
          <dl className="cx-facts">
            <div><dt>Email address</dt><dd>{session.user.email || 'Shown after your next sign-in'}</dd></div>
            <div><dt>Email status</dt><dd>{session.user.emailVerified ? 'Verified' : 'Not confirmed yet'}</dd></div>
          </dl>
          <div className="cx-actions">
            <a className="cx-button primary" href="/react/travel-profile/">Open Travel Profile <span aria-hidden="true">→</span></a>
            <button className="cx-button" type="button" onClick={signOut}>Sign out</button>
          </div>
          <p className="cx-fine" style={{ marginTop: 14 }}>Your password and sign-in are handled by Amazon Cognito. To change your password, sign out and choose “Forgot your password?” on the sign-in screen.</p>
        </div>
      </section>
    </div>
  );
}
