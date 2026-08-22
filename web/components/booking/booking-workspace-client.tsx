'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { Button } from '@/components/ui/button';
import { getSavedTrip, GlobevoyApiError, revalidateSavedTripForBooking } from '@/lib/api';
import type { BookingRevalidationResponse, SavedTrip } from '@/lib/contracts';

export const GV_WEB_707B_VERSION = 'GV-WEB-707B';

function clean(value: unknown): string { return String(value == null ? '' : value).trim(); }
function validTripId(value: string): boolean { return /^[A-Za-z0-9_-]{8,80}$/.test(value); }

function tripRoute(trip: SavedTrip | null): string {
  if (!trip) return '';
  const snapshot = trip.tripSnapshot;
  if (snapshot.kind === 'single') return [snapshot.origin, snapshot.city].filter(Boolean).join(' → ');
  return [snapshot.origin, ...(snapshot.cities || []).map((city) => city.city).filter(Boolean), snapshot.origin].filter(Boolean).join(' → ');
}

function money(value: number | undefined, currency = 'CAD'): string {
  if (!Number.isFinite(Number(value))) return '—';
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value));
  } catch {
    return `${currency} ${Math.round(Number(value)).toLocaleString()}`;
  }
}

function dateLabel(value?: string | null): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function reasonLabel(reason?: string | null): string {
  const value = clean(reason);
  const known: Record<string, string> = {
    '684a-pilot-flag-off': 'Live fare revalidation is not enabled for this staging request.',
    '684a-live-provider-dependencies-not-ready': 'The live fare provider is not ready right now.',
    '684a-one-or-two-adults-staging-pilot-only': 'This staging pilot currently supports one or two adults only.',
    '684a-single-adult-pilot-only': 'This staging pilot currently supports one adult only.',
    '684a-flight-leg-cap-exceeded': 'This route has more flight legs than the current live pilot supports.',
    '684a-missing-exact-route-or-date': 'One or more saved flight legs is missing an exact airport or travel date.',
    '684a-origin-outside-pilot-allowlist': 'This origin is outside the current Duffel staging pilot.',
    '684a-incomplete-live-flight-coverage-fail-closed': 'Not every flight leg returned acceptable live evidence, so Globevoy kept the saved snapshot.',
    '684a-provider-quota-fail-closed': 'The provider request budget was reached, so Globevoy stopped rather than showing partial live pricing.',
    '707b-multi-city-live-revalidation-pilot-only': 'Fresh flight revalidation is currently enabled for saved multi-city trips in this React pilot.'
  };
  return known[value] || (value ? `Fresh verification is unavailable (${value}).` : 'Fresh verification is unavailable right now.');
}

function stateCopy(result: BookingRevalidationResponse): { title: string; body: string; className: string } {
  if (result.revalidation.state === 'changed') {
    return {
      title: 'Flight price changed since you saved this trip',
      body: 'Globevoy found fresh Duffel fare evidence for every flight leg. The hotel amounts are still planning estimates.',
      className: 'gv-booking-status--changed'
    };
  }
  if (result.revalidation.state === 'verified') {
    return {
      title: 'Fresh flight evidence found',
      body: 'Every flight leg was checked again with Duffel. The fare is still an observation, not a reserved ticket or guaranteed checkout price.',
      className: 'gv-booking-status--verified'
    };
  }
  return {
    title: 'Fresh verification unavailable',
    body: reasonLabel(result.revalidation.reason),
    className: 'gv-booking-status--unavailable'
  };
}

export function BookingWorkspaceClient() {
  const { session, loading: authLoading, signIn, clear } = useAuth();
  const [tripId, setTripId] = useState('');
  const [trip, setTrip] = useState<SavedTrip | null>(null);
  const [loadingTrip, setLoadingTrip] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<BookingRevalidationResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = clean(new URLSearchParams(window.location.search).get('tripId'));
    setTripId(validTripId(id) ? id : '');
  }, []);

  useEffect(() => {
    let active = true;
    if (!tripId || !session) {
      setTrip(null);
      return () => { active = false; };
    }
    setLoadingTrip(true);
    setError('');
    void getSavedTrip(session.accessToken, tripId)
      .then((saved) => { if (active) setTrip(saved); })
      .catch((err) => {
        if (!active) return;
        setTrip(null);
        if (err instanceof GlobevoyApiError && err.status === 401) {
          clear();
          setError('Your session expired. Sign in again to continue.');
        } else if (err instanceof GlobevoyApiError && err.status === 404) {
          setError('That saved trip is no longer available in this account.');
        } else {
          setError('The saved trip could not be loaded. Your account data is unchanged.');
        }
      })
      .finally(() => { if (active) setLoadingTrip(false); });
    return () => { active = false; };
  }, [tripId, session, clear]);

  const currency = result?.snapshot.currency || trip?.priceSnapshot?.currency || 'CAD';
  const route = useMemo(() => tripRoute(trip), [trip]);

  async function revalidate() {
    if (!session || !tripId || checking) return;
    setChecking(true);
    setResult(null);
    setError('');
    try {
      const next = await revalidateSavedTripForBooking(session.accessToken, tripId);
      setResult(next);
    } catch (err) {
      if (err instanceof GlobevoyApiError && err.status === 401) {
        clear();
        setError('Your session expired. Sign in again before checking current prices.');
      } else {
        setError('Globevoy could not complete a fresh provider check. Saved prices remain snapshots and partner flight links stay locked.');
      }
    } finally {
      setChecking(false);
    }
  }

  if (authLoading) {
    return <div className="gv-booking-page"><section className="gv-booking-panel"><p>Checking your secure account session…</p></section></div>;
  }

  if (!session) {
    return (
      <div className="gv-booking-page">
        <section className="gv-booking-panel gv-booking-panel--center">
          <p className="gv-kicker">PRIVATE BOOKING WORKSPACE</p>
          <h1>Sign in to continue</h1>
          <p>This workspace loads an owner-private Saved Trip and never accepts a client-supplied route as booking evidence.</p>
          <div className="gv-account-actions">
            <Button onClick={() => { void signIn(`/react/booking/${tripId ? `?tripId=${encodeURIComponent(tripId)}` : ''}`); }}>Sign in</Button>
            <Link className="gv-button gv-button--secondary" href="/my-trips/">Back to My Trips</Link>
          </div>
        </section>
      </div>
    );
  }

  if (!tripId) {
    return (
      <div className="gv-booking-page">
        <section className="gv-booking-panel gv-booking-panel--center">
          <p className="gv-kicker">GV-WEB-707B</p>
          <h1>Choose a saved trip first</h1>
          <p>Open My Trips and choose Continue booking. Globevoy will carry only the Saved Trip ID into this workspace.</p>
          <Link className="gv-button gv-button--primary" href="/my-trips/">Open My Trips</Link>
        </section>
      </div>
    );
  }

  const status = result ? stateCopy(result) : null;
  const savedTotal = result?.snapshot.savedTripTotal ?? trip?.priceSnapshot?.tripEstimate;
  const freshTotal = result?.revalidation.freshTripEstimate;

  return (
    <div className="gv-booking-page">
      <section className="gv-booking-hero">
        <div>
          <p className="gv-kicker">GV-WEB-707B · OWNER-PRIVATE BOOKING WORKSPACE</p>
          <h1>{trip?.name || (loadingTrip ? 'Loading saved trip…' : 'Saved trip')}</h1>
          <p className="gv-booking-route">{route || 'Your private saved route will appear here.'}</p>
          <p className="gv-booking-note">Saved prices are historical snapshots. Globevoy does not unlock flight partner handoffs until a fresh exact-date provider check succeeds for every flight leg.</p>
        </div>
        <div className="gv-booking-actions">
          <Link className="gv-button gv-button--secondary" href="/my-trips/">Back to My Trips</Link>
          <Button disabled={!trip || checking || loadingTrip} aria-busy={checking} onClick={() => { void revalidate(); }}>
            {checking ? 'Checking Duffel…' : result ? 'Check again' : 'Check current flight prices'}
          </Button>
        </div>
      </section>

      {error ? <p className="gv-account-status gv-account-status--error" role="status">{error}</p> : null}

      <section className="gv-booking-summary-grid" aria-label="Saved and current price summary">
        <article className="gv-booking-summary-card">
          <span>Saved trip snapshot</span>
          <strong>{money(savedTotal, currency)}</strong>
          <small>Captured {dateLabel(result?.snapshot.capturedAt || trip?.priceSnapshot?.capturedAt || trip?.updatedAt)}</small>
        </article>
        <article className="gv-booking-summary-card">
          <span>Fresh combined planning estimate</span>
          <strong>{result?.revalidation.applied ? money(freshTotal, currency) : 'Verification required'}</strong>
          <small>Fresh flights + saved hotel planning estimates</small>
        </article>
        <article className="gv-booking-summary-card">
          <span>Flight change</span>
          <strong>{result?.revalidation.applied ? money(result.revalidation.flightDelta, currency) : '—'}</strong>
          <small>{result?.revalidation.applied ? 'Compared with saved flight snapshot' : 'Run a fresh check to compare'}</small>
        </article>
      </section>

      {status && result ? (
        <section className={`gv-booking-status ${status.className}`} role="status">
          <div>
            <p className="gv-kicker">FRESH PROVIDER CHECK</p>
            <h2>{status.title}</h2>
            <p>{status.body}</p>
          </div>
          <dl>
            <div><dt>Provider</dt><dd>{result.revalidation.provider}</dd></div>
            <div><dt>Flight legs checked</dt><dd>{result.revalidation.liveFlightLegCount || 0}/{result.revalidation.requiredFlightLegCount || result.flights.length}</dd></div>
            <div><dt>Observed</dt><dd>{dateLabel(result.revalidation.observedAt)}</dd></div>
            <div><dt>Partner handoff</dt><dd>{result.revalidation.handoffEnabled ? 'Available after fresh check' : 'Locked'}</dd></div>
          </dl>
        </section>
      ) : (
        <section className="gv-booking-status gv-booking-status--pending">
          <div>
            <p className="gv-kicker">VERIFICATION REQUIRED</p>
            <h2>No fresh provider check has been run</h2>
            <p>The saved trip is unchanged. Checking current flight prices makes a bounded Duffel search; it does not create an order or charge anything.</p>
          </div>
        </section>
      )}

      <section className="gv-booking-panel">
        <div className="gv-booking-section-heading">
          <div><p className="gv-kicker">FLIGHTS</p><h2>Fresh exact-date evidence</h2></div>
          <p>Partner links remain disabled unless every saved flight leg returns acceptable LIVE evidence.</p>
        </div>
        {!result?.revalidation.applied ? (
          <div className="gv-booking-empty">Run the fresh check to see current flight evidence. No stale flight handoff is shown.</div>
        ) : (
          <div className="gv-booking-list">
            {result.flights.map((flight) => (
              <article className="gv-booking-row" key={`${flight.index}-${flight.origin}-${flight.destination}`}>
                <div>
                  <strong>{flight.origin} → {flight.destination}</strong>
                  <p>{flight.departureDate} · {flight.sourceType === 'LIVE' ? 'Fresh Duffel observation' : 'Verification required'}</p>
                  {flight.resolvedOrigin && (flight.resolvedOrigin !== flight.origin || flight.resolvedDestination !== flight.destination) ? (
                    <small>Same-city airport substitution: {flight.resolvedOrigin} → {flight.resolvedDestination}</small>
                  ) : null}
                </div>
                <div className="gv-booking-row__price">
                  <strong>{money(flight.freshAmount, flight.currency || currency)}</strong>
                  {flight.handoffEnabled && flight.handoffUrl && result.revalidation.handoffEnabled ? (
                    <a className="gv-button gv-button--secondary" href={flight.handoffUrl} target="_blank" rel="noopener noreferrer">{flight.handoffLabel || 'Compare this flight'}</a>
                  ) : <span className="gv-booking-locked">Handoff locked</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="gv-booking-panel">
        <div className="gv-booking-section-heading">
          <div><p className="gv-kicker">STAYS</p><h2>Hotel planning estimates</h2></div>
          <p>Modern Agoda live availability is not connected here. Hotel prices remain estimates even after the flight recheck.</p>
        </div>
        {result?.hotels?.length ? (
          <div className="gv-booking-list">
            {result.hotels.map((hotel) => (
              <article className="gv-booking-row" key={`${hotel.index}-${hotel.city}`}>
                <div>
                  <strong>{hotel.city}{hotel.country ? `, ${hotel.country}` : ''}</strong>
                  <p>{hotel.nights} night{hotel.nights === 1 ? '' : 's'} · Planning estimate · availability not verified</p>
                </div>
                <div className="gv-booking-row__price">
                  <strong>{money(hotel.savedEstimate, hotel.currency || currency)}</strong>
                  {hotel.handoffUrl ? <a className="gv-button gv-button--secondary" href={hotel.handoffUrl} target="_blank" rel="noopener noreferrer">{hotel.handoffLabel || 'Search stays'}</a> : null}
                </div>
              </article>
            ))}
          </div>
        ) : <div className="gv-booking-empty">Hotel estimates will appear after the booking-time check. They will still require partner verification.</div>}
      </section>

      <aside className="gv-boundary">
        <strong>Booking boundary</strong>
        <p>Globevoy does not process payment, create Duffel orders, reserve tickets, or confirm hotel inventory in this workspace. A LIVE fare is fresh evidence from the provider search; the external partner still confirms the final seller price, itinerary, baggage, taxes, fees and availability.</p>
      </aside>
    </div>
  );
}
