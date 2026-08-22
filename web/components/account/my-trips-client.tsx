'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { TripCard } from '@/components/trip-card';
import { Button } from '@/components/ui/button';
import { deleteSavedTrip, GlobevoyApiError, listSavedTrips } from '@/lib/api';
import type { SavedTrip } from '@/lib/contracts';
import { openSavedTripPreservingOrigin } from '@/lib/saved-trip-open-707a-r2';

function tripRoute(trip: SavedTrip): string {
  const snapshot = trip.tripSnapshot;
  if (snapshot.kind === 'single') return [snapshot.origin, snapshot.city].filter(Boolean).join(' → ') || trip.name;
  return [snapshot.origin, ...(snapshot.cities || []).map((city) => city.city).filter(Boolean), snapshot.origin].filter(Boolean).join(' → ') || trip.name;
}

function updatedLabel(value?: string): string {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Saved trip';
  return `Updated ${new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }).format(date)}`;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof GlobevoyApiError && error.status === 401) return 'Your session expired. Sign in again to view your private trips.';
  return fallback;
}

export function MyTripsClient() {
  const { session, loading: authLoading, status: authStatus, signIn, clear } = useAuth();
  const [trips, setTrips] = useState<SavedTrip[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeKind, setNoticeKind] = useState<'success' | 'error' | ''>('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bookingError = new URLSearchParams(window.location.search).get('bookingError');
    if (bookingError) {
      setNotice('That private saved-trip booking link could not be restored. Open the trip from My Trips and try again.');
      setNoticeKind('error');
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!session) {
      setTrips([]);
      setLoading(false);
      return () => { active = false; };
    }
    setLoading(true);
    void listSavedTrips(session.accessToken)
      .then((items) => { if (active) setTrips(items); })
      .catch((error) => {
        if (!active) return;
        setTrips([]);
        setNotice(errorMessage(error, 'Saved trips could not be loaded. Your account is unchanged.'));
        setNoticeKind('error');
        if (error instanceof GlobevoyApiError && error.status === 401) clear();
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session, clear]);

  const signedInLabel = useMemo(() => session?.user.email || session?.user.username || 'your account', [session]);

  async function removeTrip(tripId: string) {
    if (!session || busyId) return;
    setBusyId(tripId);
    try {
      await deleteSavedTrip(session.accessToken, tripId);
      setTrips((current) => current.filter((trip) => trip.tripId !== tripId));
      setNotice('Saved trip deleted from your account.');
      setNoticeKind('success');
    } catch (error) {
      setNotice(errorMessage(error, 'We could not delete that saved trip right now.'));
      setNoticeKind('error');
      if (error instanceof GlobevoyApiError && error.status === 401) clear();
    } finally {
      setBusyId('');
    }
  }

  function continueBooking(tripId: string) {
    if (!session || busyId) return;
    const id = String(tripId || '').trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
      setNotice('This saved trip cannot be opened in the booking workspace.');
      setNoticeKind('error');
      return;
    }
    window.location.assign(`/react/booking/?tripId=${encodeURIComponent(id)}`);
  }

  if (authLoading) {
    return <div className="gv-my-trips-state" aria-live="polite"><p>Checking your secure account session…</p></div>;
  }

  if (!session) {
    return (
      <div className="gv-my-trips-state" aria-labelledby="my-trips-signin-title">
        <p className="gv-kicker">PRIVATE TO YOUR ACCOUNT</p>
        <h2 id="my-trips-signin-title">Sign in to see your trips</h2>
        <p>Your Saved Trips stay private to the Cognito account that created them. Guest planning still works without signing in.</p>
        <div className="gv-account-actions">
          <Button onClick={() => { void signIn('/react/my-trips/'); }}>Sign in or create account</Button>
          <a className="gv-button gv-button--secondary" href="/index.html">Plan as guest</a>
        </div>
        {authStatus ? <p className="gv-account-status" role="status">{authStatus}</p> : null}
      </div>
    );
  }

  return (
    <div className="gv-my-trips-content">
      <div className="gv-my-trips-heading">
        <div>
          <p className="gv-kicker">PRIVATE TO YOUR ACCOUNT</p>
          <h1>My Trips</h1>
          <p>Signed in as {signedInLabel}. Saved prices are historical snapshots and must be checked again before booking.</p>
        </div>
        <div className="gv-account-actions">
          <a className="gv-button gv-button--primary" href="/index.html">Plan another trip</a>
          <Link className="gv-button gv-button--secondary" href="/account/">Account</Link>
        </div>
      </div>

      {notice ? <p className={`gv-account-status${noticeKind ? ` gv-account-status--${noticeKind}` : ''}`} role="status">{notice}</p> : null}

      {loading ? <div className="gv-my-trips-state" aria-live="polite"><p>Loading your private Saved Trips…</p></div> : null}

      {!loading && trips.length === 0 ? (
        <div className="gv-my-trips-state">
          <h2>No saved trips yet</h2>
          <p>Open a trip and choose Save trip. It will appear here under your signed-in account.</p>
          <a className="gv-button gv-button--primary" href="/index.html">Plan a trip</a>
        </div>
      ) : null}

      {!loading && trips.length > 0 ? (
        <div className="gv-my-trips-grid">
          {trips.map((trip) => (
            <TripCard
              key={trip.tripId}
              title={trip.name || 'Saved trip'}
              route={tripRoute(trip)}
              amount={trip.priceSnapshot?.tripEstimate}
              currency={trip.priceSnapshot?.currency || 'CAD'}
              typeLabel={trip.tripSnapshot.kind === 'multi' ? 'Multi-city trip' : 'Single destination'}
              updatedLabel={updatedLabel(trip.updatedAt)}
              evidence={{
                state: 'estimate',
                label: 'Saved snapshot — verification required',
                note: 'Globevoy requires fresh provider verification before a saved price can be treated as current.'
              }}
              actions={(
                <>
                  <Button
                    variant="secondary"
                    disabled={Boolean(busyId)}
                    onClick={() => {
                      if (!openSavedTripPreservingOrigin(trip)) {
                        setNotice('This saved trip cannot be reopened safely from this page.');
                        setNoticeKind('error');
                      }
                    }}
                  >Open trip</Button>
                  <Button disabled={Boolean(busyId)} onClick={() => { continueBooking(trip.tripId); }}>
                    Continue booking
                  </Button>
                  <Button variant="ghost" disabled={Boolean(busyId)} onClick={() => { void removeTrip(trip.tripId); }}>Delete</Button>
                </>
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
