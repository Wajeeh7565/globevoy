'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { JourneyMap710E } from '@/components/journey/journey-map-710e';
import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import { getPublicMultiCityTours, getSavedTrip, GlobevoyApiError } from '@/lib/api';
import type { JsonObject, SavedTrip } from '@/lib/contracts';
import {
  adaptMultiCityTours,
  multiCityApiParams,
  normalizeLegacyImage,
  parseResultsSearch,
  type RecommendationCardModel,
  type ResultsCity,
  type ResultsSearch
} from '@/lib/recommendations-708a';

const GV_WEB_710E_VERSION = 'GV-WEB-710E-R2';
const GV_WEB_FE_R3_2_VERSION = 'GV-WEB-FE-R3.2';
const LEGACY_ASSET_BASE = String(process.env.NEXT_PUBLIC_GLOBEVOY_LEGACY_ASSET_BASE_URL || '/assets').replace(/\/+$/, '');
const LEGACY_CITY_IMAGES: Record<string, string> = {
  cairo: 'cairo.jpg',
  cancun: 'cancun.jpg',
  'cancún': 'cancun.jpg',
  dubai: 'dubai.jpg',
  'fort lauderdale': 'fort-lauderdale.jpg',
  'mexico city': 'mexico-city.jpg',
  miami: 'miami.jpg',
  'montego bay': 'montego-bay.jpg',
  montreal: 'montreal.jpg',
  'montréal': 'montreal.jpg',
  'new york': 'new-york-city.jpg',
  'new york city': 'new-york-city.jpg',
  ottawa: 'ottawa.jpg',
  toronto: 'toronto.jpg'
};

function clean(value: unknown): string { return String(value == null ? '' : value).trim(); }
function record(value: unknown): JsonObject { return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}; }
function rows(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as JsonObject[] : []; }
function finite(value: unknown): number | undefined { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
function textField(obj: JsonObject, ...keys: string[]): string {
  for (const key of keys) { const value = clean(obj[key]); if (value) return value; }
  return '';
}

function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${currency} ${Math.round(value).toLocaleString()}`; }
}

function originName(search: ResultsSearch): string {
  if ((search.originCode || search.rawOrigin).toUpperCase() === 'YYZ') return 'Toronto';
  return search.originCity || search.rawOrigin || search.originCode || 'Origin';
}

function routeTitle(item: RecommendationCardModel): string {
  return (item.cities || []).map((city) => city.city).filter(Boolean).join(' + ') || item.title;
}

function stopRaw(item: RecommendationCardModel, index: number): JsonObject {
  const raw = item.raw;
  const source = rows(raw.stops).length ? rows(raw.stops) : rows(raw.cities);
  return source[index] || {};
}

function curatedCityImage(city: ResultsCity): string {
  const file = LEGACY_CITY_IMAGES[clean(city.city).toLowerCase()];
  return file ? `${LEGACY_ASSET_BASE}/images/${file}` : '';
}

function stopImage(item: RecommendationCardModel, index: number, city: ResultsCity): string {
  const raw = stopRaw(item, index);
  const providerOrRouteImage = normalizeLegacyImage(textField(raw, 'img', 'image', 'imageUrl', 'photoUrl', 'heroImage'));
  return providerOrRouteImage || curatedCityImage(city);
}

function stopNights(item: RecommendationCardModel, index: number): number | null {
  const raw = stopRaw(item, index);
  const value = finite(raw.nights ?? raw.stayNights ?? raw.allocatedNights);
  return value && value > 0 ? Math.round(value) : null;
}

function stopDescription(item: RecommendationCardModel, index: number): string {
  const raw = stopRaw(item, index);
  return textField(raw, 'whyItFits', 'description', 'summary', 'reason', 'why') || 'This stop is part of the selected connected route. Detailed city recommendations are added only when Globevoy has evidence to support them.';
}

function flightLabel(fromName: string, fromCode: string, toName: string, toCode: string): string {
  const from = fromCode ? `${fromName} (${fromCode})` : fromName;
  const to = toCode ? `${toName} (${toCode})` : toName;
  return `${from} → ${to}`;
}

function currentParams(): URLSearchParams {
  return typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
}

function validTripId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,80}$/.test(clean(value));
}

function positive(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function savedSearchForTrip(trip: SavedTrip): ResultsSearch {
  const snapshot = trip.tripSnapshot;
  const price = trip.priceSnapshot || { currency: snapshot.currency || 'CAD' };
  const tour = record(snapshot.tour);
  const tourOrigin = record(tour.origin);
  const originCode = clean(snapshot.origin || tourOrigin.code || tourOrigin.airportCode).toUpperCase();
  const originCity = textField(tourOrigin, 'city', 'name') || (originCode === 'YYZ' ? 'Toronto' : originCode || 'Origin');
  const cityNights = (snapshot.cities || []).reduce((sum, city) => sum + positive(city.nights), 0);
  const nights = Math.max(1, Math.round(positive(snapshot.nights, cityNights || 1)));
  const passengers = Math.max(1, Math.round(positive(snapshot.travellers, 1)));
  const estimate = positive(price.tripEstimate);
  const budget = positive(price.totalBudget, estimate || 1);
  return {
    rawOrigin: originCode || originCity,
    originCode,
    originCity,
    budget,
    currency: clean(price.currency || snapshot.currency || 'CAD').toUpperCase() || 'CAD',
    adults: passengers,
    children: 0,
    passengers,
    nights,
    tripLength: `${nights} nights`,
    interests: [],
    hotelStyle: '',
    region: '',
    month: ''
  };
}

function savedRouteForTrip(trip: SavedTrip, search: ResultsSearch): RecommendationCardModel | null {
  const snapshot = trip.tripSnapshot;
  if (snapshot.kind !== 'multi') return null;

  const sourceTour = record(snapshot.tour);
  const raw: JsonObject = { ...sourceTour };
  const existingStops = rows(sourceTour.stops).length ? rows(sourceTour.stops) : rows(sourceTour.cities);
  const fallbackStops = (snapshot.cities || []).map((city) => ({
    id: city.id,
    city: city.city,
    country: city.country,
    code: city.code,
    airportCode: city.code,
    nights: city.nights
  }));
  const stops = existingStops.length ? existingStops : fallbackStops;
  if (!stops.length) return null;

  const price = trip.priceSnapshot || { currency: search.currency };
  const savedTotal = positive(price.tripEstimate);
  const sourceBudget = record(sourceTour.displayBudget);
  const routeTotal = positive(sourceBudget.tripEstimate) || savedTotal;
  if (!(routeTotal > 0)) return null;

  const sourceOrigin = record(sourceTour.origin);
  raw.title = clean(trip.name || sourceTour.title) || stops.map((stop) => textField(stop, 'city')).filter(Boolean).join(' + ');
  raw.tourId = clean(snapshot.routeId || sourceTour.tourId || sourceTour.routeId || trip.tripId);
  raw.routeId = raw.tourId;
  raw.totalNights = search.nights;
  raw.origin = {
    ...sourceOrigin,
    city: textField(sourceOrigin, 'city', 'name') || search.originCity,
    code: textField(sourceOrigin, 'code', 'airportCode') || search.originCode,
    airportCode: textField(sourceOrigin, 'airportCode', 'code') || search.originCode
  };
  raw.stops = stops;
  if (!rows(sourceTour.cities).length) raw.cities = stops;
  const savedRemaining = finite(sourceBudget.amountLeft) ?? finite(price.remaining);
  const reserveAmount = finite(sourceBudget.reserveAmount) ?? positive(price.reserve);
  raw.displayBudget = {
    ...sourceBudget,
    totalBudget: search.budget,
    tripEstimate: routeTotal,
    amountLeft: savedRemaining ?? (search.budget - reserveAmount - routeTotal),
    reserveAmount
  };
  raw.pricingStatus = 'ESTIMATED';
  raw.priceEvidence = { ...record(sourceTour.priceEvidence), evidenceClass: 'ESTIMATED' };

  const adapted = adaptMultiCityTours({ tours: [raw] }, search)[0];
  if (!adapted) return null;
  return {
    ...adapted,
    title: clean(trip.name) || adapted.title,
    total: routeTotal,
    remaining: savedRemaining ?? adapted.remaining,
    reserveAmount,
    sourceBudgetTotal: search.budget,
    routeId: clean(snapshot.routeId || adapted.routeId || trip.tripId),
    raw,
    selectionPayload: raw,
    evidence: {
      state: 'estimate',
      label: 'Saved snapshot · price check needed',
      note: 'Saved prices are historical snapshots. Check current provider evidence before continuing to a travel partner.'
    }
  };
}

function JourneyStopMedia({ image, city, index }: { image: string; city: ResultsCity; index: number }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(image) && !failed;
  return (
    <div className={`gv-journey-stop__image${showImage ? ' has-image' : ' is-fallback'}`}>
      {showImage ? (
        <img src={image} alt={`${city.city} destination`} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <div className="gv-journey-stop__fallback" aria-label={`${city.city} destination image unavailable`}>
          <strong>{city.code || city.city.slice(0, 3).toUpperCase()}</strong>
          <span>{city.city}</span>
          <small>{city.country || 'Destination'}</small>
        </div>
      )}
      <b>STOP {index + 1}</b>
    </div>
  );
}

export function JourneyClient710E() {
  const { session, loading: authLoading, signIn, clear } = useAuth();
  const [params, setParams] = useState<URLSearchParams>(() => new URLSearchParams());
  const [search, setSearch] = useState<ResultsSearch | null>(null);
  const [route, setRoute] = useState<RecommendationCardModel | null>(null);
  const [routeId, setRouteId] = useState('');
  const [tripId, setTripId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeStop, setActiveStop] = useState(-1);

  useEffect(() => {
    const next = currentParams();
    const requestedTripId = clean(next.get('tripId'));
    setParams(next);
    setTripId(requestedTripId);
    if (requestedTripId) {
      setRouteId('');
      setSearch(null);
    } else {
      setRouteId(clean(next.get('routeId')));
      setSearch(parseResultsSearch(next));
    }
  }, []);

  const loadSaved = useCallback(async () => {
    if (!tripId || authLoading) return;
    setLoading(true);
    setError('');
    setRoute(null);

    if (!validTripId(tripId)) {
      setError('This saved trip link is invalid.');
      setLoading(false);
      return;
    }
    if (!session) {
      setError('Sign in to open this private saved journey.');
      setLoading(false);
      return;
    }

    try {
      const trip = await getSavedTrip(session.accessToken, tripId);
      if (!trip || clean(trip.tripId) !== tripId) throw new Error('saved-trip-mismatch');
      if (trip.tripSnapshot.kind !== 'multi') {
        setError('This saved trip does not use the connected-journey view yet.');
        return;
      }
      const savedSearch = savedSearchForTrip(trip);
      const savedRoute = savedRouteForTrip(trip, savedSearch);
      if (!savedRoute) {
        setError('This saved journey snapshot is incomplete and cannot be reopened safely.');
        return;
      }
      setSearch(savedSearch);
      setRoute(savedRoute);
    } catch (err) {
      if (err instanceof GlobevoyApiError && err.status === 401) {
        clear();
        setError('Your session expired. Sign in again to open this private saved journey.');
      } else {
        setError('Globevoy could not load this private saved journey. Your saved trip is unchanged.');
      }
    } finally {
      setLoading(false);
    }
  }, [tripId, authLoading, session, clear]);

  const loadPublic = useCallback(async () => {
    if (!search || !routeId) return;
    setLoading(true);
    setError('');
    setRoute(null);
    try {
      const payload = await getPublicMultiCityTours(multiCityApiParams(search));
      const routes = adaptMultiCityTours(payload, search).filter((item) => item.kind === 'multi');
      const exact = routes.find((item) => item.routeId === routeId);
      if (!exact) {
        setError('This exact route is no longer in the current recommendation set. Globevoy will not silently replace it with a different journey.');
      } else {
        setRoute(exact);
      }
    } catch (err) {
      const message = err instanceof GlobevoyApiError ? err.message : 'The selected journey could not be loaded.';
      setError(message || 'The selected journey could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [search, routeId]);

  useEffect(() => {
    if (tripId) {
      if (!authLoading) void loadSaved();
      return;
    }
    if (search && routeId) void loadPublic();
  }, [tripId, authLoading, search, routeId, loadSaved, loadPublic]);

  useEffect(() => {
    if (!route) return;
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-gv-journey-stop]'));
    if (!cards.length || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const index = Number((visible.target as HTMLElement).dataset.gvJourneyStop);
      if (Number.isFinite(index)) setActiveStop(index);
    }, { rootMargin: '-24% 0px -48% 0px', threshold: [0.25, 0.55, 0.8] });
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, [route]);

  const savedMode = Boolean(tripId);
  const backUrl = useMemo(() => {
    if (tripId) return '/react/my-trips/';
    const next = new URLSearchParams(params);
    next.delete('routeId');
    return `/react/results/?${next.toString()}`;
  }, [params, tripId]);

  const retry = () => {
    if (savedMode) void loadSaved();
    else void loadPublic();
  };

  if (savedMode && (authLoading || loading)) return <main className="gv-journey-page"><section className="gv-journey-state"><div className="gv-journey-spinner" /><h1>Opening your saved journey…</h1><p>Loading the exact private snapshot from your account.</p></section></main>;
  if (savedMode && (error || !route || !search)) return <main className="gv-journey-page"><section className="gv-journey-state gv-journey-state--error"><p>SAVED TRIP STATUS</p><h1>We cannot open this saved journey right now</h1><span>{error}</span><div>{!session ? <button onClick={() => { void signIn(`/react/journey/?tripId=${encodeURIComponent(tripId)}`); }}>Sign in</button> : <button onClick={retry}>Try again</button>}<a href={backUrl}>Back to My Trips</a></div></section></main>;
  if (!savedMode && !search) return <main className="gv-journey-page"><section className="gv-journey-state">Preparing your journey…</section></main>;
  if (!savedMode && !routeId) return <main className="gv-journey-page"><section className="gv-journey-state"><h1>Choose a route first</h1><a href={backUrl}>Back to routes</a></section></main>;
  if (!savedMode && loading) return <main className="gv-journey-page"><section className="gv-journey-state"><div className="gv-journey-spinner" /><h1>Opening your journey…</h1><p>Matching the exact route you selected.</p></section></main>;
  if (!savedMode && (error || !route)) return <main className="gv-journey-page"><section className="gv-journey-state gv-journey-state--error"><p>ROUTE STATUS</p><h1>We cannot open this exact journey right now</h1><span>{error}</span><div><button onClick={retry}>Try again</button><a href={backUrl}>Back to routes</a></div></section></main>;
  if (!search || !route) return <main className="gv-journey-page"><section className="gv-journey-state gv-journey-state--error"><p>JOURNEY STATUS</p><h1>This journey is not ready to display</h1><a href={backUrl}>Go back</a></section></main>;

  const origin = originName(search);
  const originCode = search.originCode || search.rawOrigin;
  const stops = route.cities || [];
  const routeLine = [origin, ...stops.map((city) => city.city), origin].join(' → ');

  return (
    <main className="gv-journey-page">
      <nav className="gv-journey-back"><a href={backUrl}>{savedMode ? '← Back to My Trips' : '← Back to route choices'}</a><span>{savedMode ? GV_WEB_FE_R3_2_VERSION : GV_WEB_710E_VERSION}</span></nav>

      <header className="gv-journey-hero">
        <div>
          <p>{savedMode ? 'YOUR SAVED JOURNEY' : 'YOUR CONNECTED JOURNEY'}</p>
          <h1>{routeTitle(route)}</h1>
          <span>{routeLine}</span>
        </div>
        <div className="gv-journey-hero__numbers">
          <strong>{money(route.total, search.currency)}</strong>
          <span>{route.nights} nights · {stops.length} stops</span>
          <PriceEvidenceBadge evidence={route.evidence} />
          {savedMode ? <a className="gv-journey-check-prices" href={`/react/booking/?tripId=${encodeURIComponent(tripId)}`}>Check current prices</a> : null}
        </div>
      </header>

      <section className="gv-journey-layout">
        <div className="gv-journey-story">
          <article className="gv-journey-origin" data-gv-journey-stop="-1">
            <span>START</span><strong>{origin}</strong><small>{originCode}</small>
          </article>

          {stops.map((city, index) => {
            const previousName = index === 0 ? origin : stops[index - 1].city;
            const previousCode = index === 0 ? originCode : stops[index - 1].code;
            const image = stopImage(route, index, city);
            const nights = stopNights(route, index);
            return (
              <div className="gv-journey-segment" key={`${city.city}-${index}`}>
                <article className="gv-journey-flight">
                  <div className="gv-journey-flight__icon">✈</div>
                  <div>
                    <p>FLIGHT LEG {index + 1}</p>
                    <h2>{flightLabel(previousName, previousCode, city.city, city.code)}</h2>
                    <span>Carrier, schedule and current fare stay unclaimed until Globevoy has fresh flight evidence.</span>
                  </div>
                  <small>Flight details to verify</small>
                </article>

                <article className={`gv-journey-stop${activeStop === index ? ' is-active' : ''}`} data-gv-journey-stop={index}>
                  <JourneyStopMedia image={image} city={city} index={index} />
                  <div className="gv-journey-stop__body">
                    <div className="gv-journey-stop__title">
                      <div><p>{city.country || 'DESTINATION'}</p><h2>{city.city}</h2><span>{city.code || 'Airport to verify'}</span></div>
                      <strong>{nights ? `${nights} night${nights === 1 ? '' : 's'}` : 'Night allocation pending'}</strong>
                    </div>

                    <div className="gv-journey-stop__details">
                      <section>
                        <p>STAY</p>
                        <h3>Hotel details need current verification</h3>
                        <span>Hotel name, room, availability, fees and current price appear only when the existing provider-check flow has evidence. Globevoy does not turn a planning estimate into a fake hotel.</span>
                      </section>
                      <section>
                        <p>PRICE EVIDENCE</p>
                        <h3>{route.evidence.label}</h3>
                        <span>{route.evidence.note}</span>
                      </section>
                    </div>

                    <details className="gv-journey-explore">
                      <summary>Explore this stop</summary>
                      <p>{stopDescription(route, index)}</p>
                    </details>
                  </div>
                </article>
              </div>
            );
          })}

          <article className="gv-journey-flight gv-journey-flight--return">
            <div className="gv-journey-flight__icon">✈</div>
            <div>
              <p>RETURN FLIGHT</p>
              <h2>{flightLabel(stops[stops.length - 1]?.city || 'Last stop', stops[stops.length - 1]?.code || '', origin, originCode)}</h2>
              <span>Carrier, schedule and current fare stay unclaimed until the current-price step.</span>
            </div>
            <small>Flight details to verify</small>
          </article>

          <article className="gv-journey-origin gv-journey-origin--return"><span>RETURN HOME</span><strong>{origin}</strong><small>Journey loop complete</small></article>
        </div>

        <aside className="gv-journey-rail">
          <JourneyMap710E item={route} search={search} activeStopIndex={activeStop} />
          <section className="gv-journey-budget">
            <p>TRIP AT A GLANCE</p>
            <h2>{routeTitle(route)}</h2>
            <dl>
              <div><dt>Total budget</dt><dd>{money(search.budget, search.currency)}</dd></div>
              <div><dt>Route estimate</dt><dd>{money(route.total, search.currency)}</dd></div>
              <div><dt>Planning room</dt><dd>{route.remaining >= 0 ? money(route.remaining, search.currency) : 'Tight fit'}</dd></div>
              <div><dt>Nights</dt><dd>{route.nights}</dd></div>
              <div><dt>Stops</dt><dd>{stops.length}</dd></div>
            </dl>
            <div className="gv-journey-budget__evidence"><PriceEvidenceBadge evidence={route.evidence} /><small>Flight and hotel provider details stay separate until current evidence exists.</small></div>
          </section>
        </aside>
      </section>
    </main>
  );
}
