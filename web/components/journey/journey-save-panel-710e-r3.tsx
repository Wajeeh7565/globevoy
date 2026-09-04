'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { createSavedTrip, getPublicMultiCityTours, GlobevoyApiError, listSavedTrips } from '@/lib/api';
import type { JsonObject, SavedTrip } from '@/lib/contracts';
import {
  adaptMultiCityTours,
  multiCityApiParams,
  parseResultsSearch,
  type RecommendationCardModel,
  type ResultsSearch
} from '@/lib/recommendations-708a';

export const GV_WEB_710E_R3_VERSION = 'GV-WEB-710E-R3';

function clean(value: unknown): string { return String(value == null ? '' : value).trim(); }
function record(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function rows(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as JsonObject[] : []; }
function finite(value: unknown): number | undefined { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
function positiveInteger(value: unknown): number | null {
  const n = finite(value);
  return n && n > 0 ? Math.round(n) : null;
}
function cloneJson<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function validIsoDate(value: unknown): string {
  const text = clean(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  return Number.isNaN(Date.parse(`${text}T12:00:00Z`)) ? '' : text;
}
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.round(days)));
  return date.toISOString().slice(0, 10);
}
function tomorrowIso(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}
function dateLabel(value: string): string {
  if (!validIsoDate(value)) return value;
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T12:00:00Z`));
}
function stopSource(route: RecommendationCardModel): JsonObject[] {
  const stops = rows(route.raw.stops);
  return stops.length ? stops : rows(route.raw.cities);
}
function stopNights(row: JsonObject): number | null {
  return positiveInteger(row.nights ?? row.stayNights ?? row.allocatedNights);
}
function datedLegs(sourceLegs: JsonObject[], nights: number[], departureDate: string): JsonObject[] {
  let cursor = departureDate;
  return sourceLegs.map((sourceLeg, index) => {
    const leg = cloneJson(sourceLeg);
    leg.departureDate = cursor;
    leg.dateLabel = cursor;
    leg.dateBasis710E = 'user-selected-exact-date';

    // The existing 707B/708C booking contract treats leg N+1 as the flight
    // leaving stop N. Keep that exact ordering instead of trying to infer dates
    // from city names, which could silently shift a hotel window.
    if (index < nights.length) cursor = addDays(cursor, nights[index]);
    return leg;
  });
}

interface ExactDatePlan {
  tour: JsonObject;
  cities: Array<{ id?: string; city: string; country?: string; code?: string; nights: number }>;
  departureDate: string;
  returnDate: string;
  legDates: string[];
}

type PlanResult = { ok: true; plan: ExactDatePlan } | { ok: false; reason: string };

function buildExactDatePlan(route: RecommendationCardModel, departureDateInput: string): PlanResult {
  const departureDate = validIsoDate(departureDateInput);
  if (!departureDate) return { ok: false, reason: 'Choose an exact departure date first.' };

  const stops = stopSource(route);
  if (!stops.length) return { ok: false, reason: 'This route is missing its saved stop structure, so Globevoy will not invent booking dates.' };
  const nights = stops.map(stopNights);
  if (nights.some((value) => !value)) {
    return { ok: false, reason: 'One or more stops has no exact night allocation. Globevoy will not guess hotel dates.' };
  }
  if ((route.cities || []).length !== stops.length) {
    return { ok: false, reason: 'The route stop structure does not match the current journey cards, so Globevoy will not create a mismatched Saved Trip.' };
  }

  const raw = cloneJson(route.raw);
  const backendLegs = rows(raw.backendLegs);
  const ordinaryLegs = rows(raw.legs);
  const preferredLegs = backendLegs.length ? backendLegs : ordinaryLegs;
  if (!preferredLegs.length) {
    return { ok: false, reason: 'This route has no saved transport legs, so it cannot enter exact-date provider verification safely.' };
  }
  if (preferredLegs.length < stops.length + 1) {
    return { ok: false, reason: 'This route is missing a complete outbound/return leg sequence, so Globevoy will not present it as ready for exact-date verification.' };
  }

  const exactNights = nights as number[];
  const returnDate = addDays(departureDate, exactNights.reduce((sum, value) => sum + value, 0));
  let legDates: string[] = [];

  if (backendLegs.length) {
    const dated = datedLegs(backendLegs, exactNights, departureDate);
    raw.backendLegs = dated;
    legDates = dated.map((leg) => validIsoDate(leg.departureDate)).filter(Boolean);
  }
  if (ordinaryLegs.length) {
    const dated = datedLegs(ordinaryLegs, exactNights, departureDate);
    raw.legs = dated;
    if (!backendLegs.length) legDates = dated.map((leg) => validIsoDate(leg.departureDate)).filter(Boolean);
  }

  raw.departureDate = departureDate;
  raw.returnDate = returnDate;
  raw.exactDateMode = true;
  raw.exactDateSource = GV_WEB_710E_R3_VERSION;

  const cities = (route.cities || []).map((city, index) => ({
    ...(city.id ? { id: city.id } : {}),
    city: city.city,
    ...(city.country ? { country: city.country } : {}),
    ...(city.code ? { code: city.code } : {}),
    nights: exactNights[index]
  }));

  return { ok: true, plan: { tour: raw, cities, departureDate, returnDate, legDates } };
}

function routeTitle(route: RecommendationCardModel): string {
  return (route.cities || []).map((city) => city.city).filter(Boolean).join(' + ') || route.title || 'Multi-city trip';
}

function sourceUrl(search: ResultsSearch, route: RecommendationCardModel, plan: ExactDatePlan): string {
  const params = new URLSearchParams();
  params.set('origin', search.originCity || search.rawOrigin || search.originCode);
  if (route.routeId) params.set('routeId', route.routeId);
  params.set('departureDate', plan.departureDate);
  params.set('currency', search.currency);
  params.set('budget', String(search.budget));
  return `multi-city-trip.html?${params.toString()}`;
}

function savePayload(search: ResultsSearch, route: RecommendationCardModel, plan: ExactDatePlan): { clientSaveKey: string; body: Record<string, unknown> } {
  const clientSaveKey = [
    'multi-react-710e-r3',
    route.routeId || route.id,
    search.originCode || search.rawOrigin,
    plan.departureDate,
    search.passengers,
    search.currency
  ].map((value) => clean(value).toLowerCase()).join('|');

  const canonicalPricing = record(route.raw.canonicalPricing);
  const displayBudget = record(route.raw.displayBudget);
  const flightEstimate = finite(canonicalPricing.transportDisplayTotal ?? displayBudget.flightEstimate);
  const stayEstimate = finite(canonicalPricing.accommodationDisplayTotal ?? displayBudget.accommodationEstimate);

  return {
    clientSaveKey,
    body: {
      name: routeTitle(route),
      status: 'planned',
      tripSnapshot: {
        schemaVersion: 1,
        kind: 'multi',
        clientSaveKey,
        sourceUrl: sourceUrl(search, route, plan),
        snapshotId: null,
        routeId: route.routeId || null,
        origin: search.originCity || search.rawOrigin || search.originCode,
        travellers: search.passengers,
        currency: search.currency,
        cities: plan.cities,
        tour: plan.tour,
        snapshotMode: 'exact-date-user-selected',
        savedByVersion: GV_WEB_710E_R3_VERSION
      },
      providerRefs: {},
      priceSnapshot: {
        currency: search.currency,
        totalBudget: search.budget,
        reserve: route.reserveAmount,
        ...(flightEstimate && flightEstimate > 0 ? { flightEstimate } : {}),
        ...(stayEstimate && stayEstimate > 0 ? { stayEstimate } : {}),
        tripEstimate: route.total,
        remaining: route.remaining,
        capturedAt: new Date().toISOString()
      },
      travelerProfileRef: null
    }
  };
}

export function JourneySavePanel710ER3() {
  const { session, loading: authLoading, signIn, clear } = useAuth();
  const [search, setSearch] = useState<ResultsSearch | null>(null);
  const [routeId, setRouteId] = useState('');
  const [route, setRoute] = useState<RecommendationCardModel | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedTripId, setSavedTripId] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setSearch(parseResultsSearch(params));
    setRouteId(clean(params.get('routeId')));
    const restoredDate = validIsoDate(params.get('departureDate'));
    if (restoredDate) setDepartureDate(restoredDate);
  }, []);

  useEffect(() => {
    let active = true;
    if (!search || !routeId) {
      setLoadingRoute(false);
      return () => { active = false; };
    }
    setLoadingRoute(true);
    setError('');
    void getPublicMultiCityTours(multiCityApiParams(search))
      .then((payload) => {
        if (!active) return;
        const exact = adaptMultiCityTours(payload, search).find((item) => item.kind === 'multi' && item.routeId === routeId) || null;
        setRoute(exact);
        if (!exact) setError('This exact route is not available in the current recommendation set, so it cannot be saved as a new exact-date trip.');
      })
      .catch((err) => {
        if (!active) return;
        setRoute(null);
        setError(err instanceof GlobevoyApiError ? err.message : 'The selected route could not be prepared for saving.');
      })
      .finally(() => { if (active) setLoadingRoute(false); });
    return () => { active = false; };
  }, [search, routeId]);

  const planResult = useMemo<PlanResult | null>(() => route && departureDate ? buildExactDatePlan(route, departureDate) : null, [route, departureDate]);

  async function beginSignInForSave() {
    if (typeof window === 'undefined') return;
    const next = new URL(window.location.href);
    if (departureDate) next.searchParams.set('departureDate', departureDate);
    await signIn(`${next.pathname}${next.search}`);
  }

  async function saveTrip() {
    if (!search || !route || busy) return;
    if (!session) {
      await beginSignInForSave();
      return;
    }
    const result = buildExactDatePlan(route, departureDate);
    if (!result.ok) {
      setNotice('');
      setError(result.reason);
      return;
    }

    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = savePayload(search, route, result.plan);
      const existing = await listSavedTrips(session.accessToken);
      let saved: SavedTrip | undefined = existing.find((trip) => trip.tripSnapshot?.clientSaveKey === payload.clientSaveKey);
      const alreadySaved = Boolean(saved);
      if (!saved) saved = await createSavedTrip(session.accessToken, payload.body);
      if (!saved?.tripId) throw new Error('saved-trip-id-missing');
      setSavedTripId(saved.tripId);
      setNotice(alreadySaved
        ? 'This exact-date trip was already saved privately to your account.'
        : 'Trip saved privately to your account. No flight or hotel provider check ran during saving.');
    } catch (err) {
      if (err instanceof GlobevoyApiError && err.status === 401) {
        clear();
        setError('Your session expired. Sign in again before saving this trip.');
      } else {
        setError('Globevoy could not save this trip right now. No provider search, booking, payment or reservation was created.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (loadingRoute) {
    return <section className="gv-journey-state" aria-live="polite"><p>Preparing exact-date saving…</p></section>;
  }
  if (!search || !routeId || !route) {
    return error ? <section className="gv-journey-state gv-journey-state--error"><h2>Exact-date saving unavailable</h2><p>{error}</p></section> : null;
  }

  const canSave = Boolean(validIsoDate(departureDate) && planResult?.ok && !busy && !authLoading);
  const dateStatus = planResult && !planResult.ok ? planResult.reason : '';

  return (
    <section className="gv-journey-state" aria-labelledby="gv-journey-save-title" style={{ textAlign: 'left', maxWidth: 1120, marginTop: 0 }}>
      <p style={{ margin: 0, color: '#087f78', fontSize: '.72rem', fontWeight: 900, letterSpacing: '.12em' }}>EXACT DATES · PRIVATE SAVED TRIP</p>
      <h2 id="gv-journey-save-title" style={{ margin: '8px 0 6px', fontSize: '1.55rem' }}>Ready to turn this plan into a trip you can verify?</h2>
      <p style={{ margin: '0 0 20px', color: '#5e7480', lineHeight: 1.55 }}>
        Choose the exact departure date, save the route privately to your account, then continue to the existing booking workspace. Saving itself does not call Duffel or Nuitee.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: 18, alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 7, fontWeight: 850 }}>
          Exact departure date
          <input
            type="date"
            min={tomorrowIso()}
            value={departureDate}
            onChange={(event) => { setDepartureDate(event.target.value); setSavedTripId(''); setNotice(''); setError(''); }}
            style={{ width: '100%', padding: '12px 13px', border: '1px solid #b9cbd3', borderRadius: 10, font: 'inherit', color: '#08253b', background: '#fff' }}
          />
        </label>

        <div style={{ minHeight: 44, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, color: '#5e7480', fontSize: '.86rem' }}>
          {planResult?.ok ? (
            <>
              <strong style={{ color: '#08253b' }}>{dateLabel(planResult.plan.departureDate)} → {dateLabel(planResult.plan.returnDate)}</strong>
              <span>{planResult.plan.legDates.length} exact transport date{planResult.plan.legDates.length === 1 ? '' : 's'} will be stored with the owner-private snapshot.</span>
            </>
          ) : <span>{dateStatus || 'Choose a date to prepare exact flight and hotel verification windows.'}</span>}
        </div>
      </div>

      {error ? <p role="status" style={{ margin: '16px 0 0', color: '#9b2c2c', fontWeight: 750 }}>{error}</p> : null}
      {notice ? <p role="status" style={{ margin: '16px 0 0', color: '#087f78', fontWeight: 750 }}>{notice}</p> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 20 }}>
        {!savedTripId ? (
          <button
            type="button"
            className="gv-button gv-button--primary"
            disabled={!canSave && Boolean(session)}
            aria-busy={busy}
            onClick={() => { void saveTrip(); }}
          >
            {busy ? 'Saving privately…' : session ? 'Save trip' : 'Sign in to save'}
          </button>
        ) : (
          <a className="gv-button gv-button--primary" href={`/react/booking/?tripId=${encodeURIComponent(savedTripId)}`}>Continue to current-price check</a>
        )}
        <a className="gv-button gv-button--secondary" href="/react/my-trips/">My Trips</a>
        <span style={{ color: '#667b86', fontSize: '.78rem' }}>The next workspace still requires you to press “Check current prices” before any provider request runs.</span>
      </div>
    </section>
  );
}
