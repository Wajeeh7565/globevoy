'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { VisualSavedTripCard } from '@/components/account/visual-saved-trip-card';
import { Button } from '@/components/ui/button';
import { deleteSavedTrip, GlobevoyApiError, listSavedTrips } from '@/lib/api';
import type { SavedTrip } from '@/lib/contracts';
import { openSavedTripPreservingOrigin } from '@/lib/saved-trip-open-707a-r2';

type TripFilter = 'all' | 'multi' | 'single';

function updatedLabel(value?: string): string {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return 'Saved trip';
  return `Updated ${new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric' }).format(date)}`;
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
  const [filter, setFilter] = useState<TripFilter>('all');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bookingError = new URLSearchParams(window.location.search).get('bookingError');
    if (bookingError) {
      setNotice('That saved trip could not be restored for a current-price check. Open it here and try again.');
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
  const multiCount = useMemo(() => trips.filter((trip) => trip.tripSnapshot.kind === 'multi').length, [trips]);
  const singleCount = trips.length - multiCount;
  const visibleTrips = useMemo(() => trips.filter((trip) => {
    if (filter === 'all') return true;
    return trip.tripSnapshot.kind === filter;
  }), [trips, filter]);

  async function removeTrip(tripId: string) {
    if (!session || busyId) return;
    setBusyId(tripId);
    try {
      await deleteSavedTrip(session.accessToken, tripId);
      setTrips((current) => current.filter((trip) => trip.tripId !== tripId));
      setNotice('Saved trip removed.');
      setNoticeKind('success');
    } catch (error) {
      setNotice(errorMessage(error, 'We could not delete that saved trip right now.'));
      setNoticeKind('error');
      if (error instanceof GlobevoyApiError && error.status === 401) clear();
    } finally {
      setBusyId('');
    }
  }

  function checkCurrentPrices(tripId: string) {
    if (!session || busyId) return;
    const id = String(tripId || '').trim();
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
      setNotice('This saved trip cannot be opened for a current-price check.');
      setNoticeKind('error');
      return;
    }
    window.location.assign(`/react/booking/?tripId=${encodeURIComponent(id)}`);
  }

  function openTrip(trip: SavedTrip) {
    if (!openSavedTripPreservingOrigin(trip)) {
      setNotice('This saved trip cannot be reopened safely from this page.');
      setNoticeKind('error');
    }
  }

  if (authLoading) {
    return <div className="gv-my-trips-state" aria-live="polite"><p>Opening your trips…</p></div>;
  }

  if (!session) {
    return (
      <div className="gv-my-trips-state gv-my-trips-state--visual" aria-labelledby="my-trips-signin-title">
        <div className="gv-my-trips-empty-visual" aria-hidden="true"><span>✈</span><i>●━━●━━●</i></div>
        <p className="gv-kicker">YOUR TRIPS, ACROSS DEVICES</p>
        <h2 id="my-trips-signin-title">Sign in to see saved journeys</h2>
        <p>Guest discovery stays open. Sign in when you want to save, continue, and re-check a trip later.</p>
        <div className="gv-account-actions">
          <Button onClick={() => { void signIn('/react/my-trips/'); }}>Sign in or create account</Button>
          <a className="gv-button gv-button--secondary" href="/react/">Keep exploring</a>
        </div>
        {authStatus ? <p className="gv-account-status" role="status">{authStatus}</p> : null}
      </div>
    );
  }

  return (
    <div className="gv-my-trips-content gv-my-trips-content--visual">
      <section className="gv-my-trips-visual-hero">
        <div>
          <p className="gv-kicker">YOUR SAVED JOURNEYS</p>
          <h1>My Trips</h1>
          <p>Pick up where you left off.</p>
        </div>
        <div className="gv-my-trips-visual-hero__aside">
          <span>{trips.length}<small>saved</small></span>
          <span>{multiCount}<small>multi-city</small></span>
          <a className="gv-button gv-button--primary" href="/react/">+ Plan another trip</a>
        </div>
      </section>

      <div className="gv-my-trips-toolbar" aria-label="Trip filters">
        <div className="gv-my-trips-filters">
          <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>All <span>{trips.length}</span></button>
          <button type="button" className={filter === 'multi' ? 'is-active' : ''} onClick={() => setFilter('multi')}>Multi-city <span>{multiCount}</span></button>
          <button type="button" className={filter === 'single' ? 'is-active' : ''} onClick={() => setFilter('single')}>Single <span>{singleCount}</span></button>
        </div>
        <div className="gv-my-trips-private-chip" title={signedInLabel}><span aria-hidden="true">✓</span> Private to your account</div>
      </div>

      {notice ? <p className={`gv-account-status${noticeKind ? ` gv-account-status--${noticeKind}` : ''}`} role="status">{notice}</p> : null}

      {loading ? <div className="gv-my-trips-state" aria-live="polite"><p>Loading saved journeys…</p></div> : null}

      {!loading && trips.length === 0 ? (
        <div className="gv-my-trips-state gv-my-trips-state--visual">
          <div className="gv-my-trips-empty-visual" aria-hidden="true"><span>⌖</span><i>●━━✈━━●</i></div>
          <h2>Your first trip will land here</h2>
          <p>Explore a journey, save it, and Globevoy will keep the snapshot ready for your next visit.</p>
          <a className="gv-button gv-button--primary" href="/react/">Explore trips</a>
        </div>
      ) : null}

      {!loading && trips.length > 0 && visibleTrips.length === 0 ? (
        <div className="gv-my-trips-state"><h2>No trips in this view</h2><button className="gv-button gv-button--secondary" type="button" onClick={() => setFilter('all')}>Show all trips</button></div>
      ) : null}

      {!loading && visibleTrips.length > 0 ? (
        <div className="gv-my-trips-visual-grid">
          {visibleTrips.map((trip) => (
            <VisualSavedTripCard
              key={trip.tripId}
              trip={trip}
              updatedLabel={updatedLabel(trip.updatedAt)}
              busy={Boolean(busyId)}
              onOpen={() => openTrip(trip)}
              onCheckPrices={() => checkCurrentPrices(trip.tripId)}
              onDelete={() => { void removeTrip(trip.tripId); }}
            />
          ))}
        </div>
      ) : null}

      <div className="gv-my-trips-footnote">
        <span>Saved prices are snapshots.</span>
        <strong>Globevoy checks current provider evidence before partner handoff.</strong>
        <Link href="/account/">Account</Link>
      </div>
    </div>
  );
}
