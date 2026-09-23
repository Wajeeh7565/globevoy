'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { getSavedTrip, getTravelProfile, GlobevoyApiError, revalidateSavedTripForBooking } from '@/lib/api';
import { browserIsStagingOrigin } from '@/lib/public-config';
import { formatReviewMoney as money, isSandboxHotel, reviewPricing, flightComparisonLabel } from '@/lib/trip-review-pricing-712c';
import type { BookingRevalidationHotel, BookingRevalidationResponse, SavedTrip, SavedTripCity } from '@/lib/contracts';

export const GV_WEB_710G_VERSION = 'GV-WEB-710G-R1';

const LEGACY_ASSET_BASE = String(process.env.NEXT_PUBLIC_GLOBEVOY_LEGACY_ASSET_BASE_URL || '/assets').replace(/\/+$/, '');
const CITY_IMAGES: Record<string, string> = {
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
function validTripId(value: string): boolean { return /^[A-Za-z0-9_-]{8,80}$/.test(value); }

const HOTEL_NATIONALITY_STORAGE_KEY = 'globevoy-hotel-guest-nationality-v2';

type CountryOption = { code: string; label: string };
let COUNTRY_OPTIONS_CACHE: CountryOption[] | null = null;

function normalizedCountryText(value: string): string {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function countryOptions(): CountryOption[] {
  if (COUNTRY_OPTIONS_CACHE) return COUNTRY_OPTIONS_CACHE;
  const options: CountryOption[] = [];
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        const label = display.of(code);
        if (!label || label === code || /unknown region/i.test(label) || ['EU', 'UN', 'ZZ'].includes(code)) continue;
        options.push({ code, label });
      }
    }
  } catch (_) {
    options.push(
      { code: 'CA', label: 'Canada' },
      { code: 'PK', label: 'Pakistan' },
      { code: 'US', label: 'United States' },
      { code: 'GB', label: 'United Kingdom' },
      { code: 'IN', label: 'India' },
      { code: 'AU', label: 'Australia' }
    );
  }
  COUNTRY_OPTIONS_CACHE = options.sort((a, b) => a.label.localeCompare(b.label));
  return COUNTRY_OPTIONS_CACHE;
}

function countryCodeForProfileValue(value: string): string {
  const direct = clean(value).toUpperCase();
  if (/^[A-Z]{2}$/.test(direct)) return direct;
  const wanted = normalizedCountryText(value);
  return countryOptions().find((option) => normalizedCountryText(option.label) === wanted)?.code || '';
}

function shortDate(value?: string | null): string {
  if (!value) return '';
  const raw = value.slice(0, 10);
  const date = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

function dateTimeLabel(value?: string | null): string {
  if (!value) return 'Not checked yet';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function imageForCity(city: string): string {
  const file = CITY_IMAGES[clean(city).toLowerCase()];
  return file ? `${LEGACY_ASSET_BASE}/images/${file}` : '';
}

function tripStops(trip: SavedTrip | null): SavedTripCity[] {
  if (!trip) return [];
  const snapshot = trip.tripSnapshot;
  if (snapshot.kind === 'single') {
    return snapshot.city ? [{ city: snapshot.city, country: snapshot.country, code: snapshot.code, nights: snapshot.nights }] : [];
  }
  return Array.isArray(snapshot.cities) ? snapshot.cities : [];
}

function totalNights(trip: SavedTrip | null): number | null {
  if (!trip) return null;
  const direct = Number(trip.tripSnapshot.nights);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const sum = tripStops(trip).reduce((total, city) => total + (Number.isFinite(Number(city.nights)) ? Number(city.nights) : 0), 0);
  return sum > 0 ? Math.round(sum) : null;
}

function routeLabel(trip: SavedTrip | null): string {
  if (!trip) return '';
  const origin = clean(trip.tripSnapshot.origin) || 'Origin';
  const stops = tripStops(trip).map((city) => city.city).filter(Boolean);
  return [origin, ...stops, ...(trip.tripSnapshot.kind === 'multi' ? [origin] : [])].join(' → ');
}

function reasonLabel(reason?: string | null): string {
  const value = clean(reason);
  const known: Record<string, string> = {
    '684a-pilot-flag-off': 'Fresh flight checking is not enabled for this request.',
    '684a-live-provider-dependencies-not-ready': 'The fresh fare provider is not ready right now.',
    '684a-one-or-two-adults-staging-pilot-only': 'This provider pilot currently supports one or two adults only.',
    '684a-single-adult-pilot-only': 'This provider pilot currently supports one adult only.',
    '684a-flight-leg-cap-exceeded': 'This route has more flight legs than the current live pilot supports.',
    '684a-missing-exact-route-or-date': 'One or more saved flight legs is missing an exact airport or travel date.',
    '684a-origin-outside-pilot-allowlist': 'This origin is outside the current fresh-fare pilot.',
    '684a-incomplete-live-flight-coverage-fail-closed': 'Not every flight leg returned acceptable fresh evidence, so Globevoy kept the saved snapshot.',
    '684a-provider-quota-fail-closed': 'The provider request budget was reached, so Globevoy stopped instead of showing partial evidence.',
    '707b-multi-city-live-revalidation-pilot-only': 'Fresh flight checking is currently enabled for saved multi-city trips in this pilot.'
  };
  return known[value] || (value ? `Fresh verification is unavailable (${value}).` : 'Fresh verification is unavailable right now.');
}

function statusCopy(result: BookingRevalidationResponse | null, pricing: ReturnType<typeof reviewPricing>) {
  if (!result) return { tone: 'pending', eyebrow: 'CURRENT-PRICE CHECK', title: 'Check prices before you leave Globevoy', body: 'Your saved total is a snapshot. Check current prices before comparing with a partner.' };
  if (pricing.complete) return {
    tone: 'verified', eyebrow: pricing.label, title: 'Flights and stays rechecked',
    body: 'The current checked total covers flights and hotels for all travellers. The external partner confirms its own final price and availability.'
  };
  if (pricing.expired) return {
    tone: 'unavailable', eyebrow: 'NEEDS VERIFICATION', title: 'Check prices again',
    body: 'The current-price evidence has expired. Earlier quotes below are for reference until you run another check.'
  };
  if (pricing.label === 'Partially live') return {
    tone: 'changed', eyebrow: pricing.label, title: 'Some prices are checked; the full total is unavailable',
    body: pricing.sandboxCount ? 'Flight evidence is separate from sandbox hotel test rates. Test rates do not count toward a live trip total.' : 'Some trip components still need current verification. Saved estimates do not count toward a live trip total.'
  };
  return { tone: 'unavailable', eyebrow: 'NEEDS VERIFICATION', title: 'Full current total unavailable', body: result.revalidation.reason ? reasonLabel(result.revalidation.reason) : 'The available evidence does not establish a complete current trip price. Check again before comparing with partners.' };
}

function HotelCard({ hotel, currency, expired }: { hotel: BookingRevalidationHotel; currency: string; expired: boolean }) {
  const sandbox = isSandboxHotel(hotel);
  const verified = !sandbox && hotel.environment === 'production' && hotel.productionEligible === true && hotel.state === 'verified' && hotel.availabilityVerified;
  const providerBacked = hotel.state === 'provider';
  const quoted = sandbox || hotel.state === 'verified' || providerBacked;
  const amount = quoted ? hotel.freshAmount : hotel.savedEstimate;
  const dates = hotel.checkin && hotel.checkout ? `${shortDate(hotel.checkin)} – ${shortDate(hotel.checkout)}` : '';
  return (
    <article className={`gv-710g-hotel-card ${verified ? 'is-verified' : providerBacked ? 'is-provider' : 'is-estimate'}`}>
      <div className="gv-710g-hotel-card__media">
        {hotel.photoUrl ? <img src={hotel.photoUrl} alt={`${hotel.hotelName || hotel.city} stay`} loading="lazy" /> : <div className="gv-710g-photo-fallback"><span>▣</span><strong>{hotel.city}</strong></div>}
        <span className="gv-710g-media-badge">{sandbox ? 'Sandbox test rate' : expired ? 'Earlier hotel quote' : verified ? 'Availability checked' : quoted ? 'Provider rate · verification required' : 'Planning estimate'}</span>
      </div>
      <div className="gv-710g-hotel-card__body">
        <div>
          <small>{hotel.city}{hotel.country ? ` · ${hotel.country}` : ''}</small>
          <h3>{hotel.hotelName || `Stay in ${hotel.city}`}</h3>
          <p>{hotel.nights} night{hotel.nights === 1 ? '' : 's'}{dates ? ` · ${dates}` : ''}</p>
        </div>
        <strong className="gv-710g-card-price">{money(amount, hotel.currency || currency)}</strong>
        {sandbox ? <p>Test data only. This is not a bookable production rate.</p> : null}
        <div className="gv-710g-hotel-meta">
          {hotel.roomName ? <span>Room · {hotel.roomName}</span> : null}
          {hotel.boardName ? <span>Board · {hotel.boardName}</span> : null}
          {hotel.refundableTag ? <span>{hotel.refundableTag}</span> : null}
          {hotel.excludedFeesPresent ? <span>Some fees may be separate</span> : null}
        </div>
        {!expired && !sandbox && hotel.handoffUrl ? <a className="gv-710g-partner-button" href={hotel.handoffUrl} target="_blank" rel="noopener noreferrer">{hotel.handoffLabel || 'Compare this stay'} <span>↗</span></a> : <span className="gv-710g-locked">{sandbox ? 'Test rate — partner booking unavailable' : expired ? 'Check price again' : 'Partner link not available yet'}</span>}
      </div>
    </article>
  );
}

export function TripReviewClient710G() {
  const { session, loading: authLoading, signIn, clear } = useAuth();
  const [tripId, setTripId] = useState('');
  const [trip, setTrip] = useState<SavedTrip | null>(null);
  const [loadingTrip, setLoadingTrip] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<BookingRevalidationResponse | null>(null);
  const [error, setError] = useState('');
  const [stagingOrigin, setStagingOrigin] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [nationalityOpen, setNationalityOpen] = useState(false);
  const [nationalityCode, setNationalityCode] = useState('');
  const [profileNationalityChoices, setProfileNationalityChoices] = useState<CountryOption[]>([]);
  const nationalityOptions = useMemo(() => countryOptions(), []);

  useEffect(() => {
    if (!result) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [result]);

  useEffect(() => {
    setStagingOrigin(browserIsStagingOrigin());
    if (typeof window === 'undefined') return;
    const id = clean(new URLSearchParams(window.location.search).get('tripId'));
    setTripId(validTripId(id) ? id : '');
  }, []);

  useEffect(() => {
    let active = true;
    if (!session) {
      setProfileNationalityChoices([]);
      return () => { active = false; };
    }
    void getTravelProfile(session.accessToken)
      .then((response) => {
        if (!active || !response.exists) return;
        const seen = new Set<string>();
        const choices = (response.profile.citizenshipCountries || [])
          .map((value) => {
            const code = countryCodeForProfileValue(value);
            const option = nationalityOptions.find((item) => item.code === code);
            return code && option ? option : null;
          })
          .filter((item): item is CountryOption => Boolean(item))
          .filter((item) => {
            if (seen.has(item.code)) return false;
            seen.add(item.code);
            return true;
          });
        setProfileNationalityChoices(choices);
      })
      .catch(() => {
        if (active) setProfileNationalityChoices([]);
      });
    return () => { active = false; };
  }, [session, nationalityOptions]);

  useEffect(() => {
    if (!nationalityOpen || nationalityCode || profileNationalityChoices.length === 0) return;
    setNationalityCode(profileNationalityChoices[0].code);
  }, [nationalityOpen, nationalityCode, profileNationalityChoices]);

  useEffect(() => {
    if (!nationalityOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !checking) setNationalityOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nationalityOpen, checking]);

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

  function cachedHotelGuestNationality(): string {
    if (typeof window === 'undefined') return '';
    const cached = clean(window.sessionStorage.getItem(HOTEL_NATIONALITY_STORAGE_KEY)).toUpperCase();
    return /^[A-Z]{2}$/.test(cached) ? cached : '';
  }

  function storeHotelGuestNationality(code: string) {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem(HOTEL_NATIONALITY_STORAGE_KEY, code);
  }

  async function runRevalidation(guestNationality: string | null) {
    if (!session || !tripId || checking) return;
    setChecking(true);
    setResult(null);
    setError('');
    try {
      setResult(await revalidateSavedTripForBooking(
        session.accessToken,
        tripId,
        guestNationality ? { guestNationality } : undefined
      ));
    } catch (err) {
      if (err instanceof GlobevoyApiError && err.status === 401) {
        clear();
        setError('Your session expired. Sign in again before checking current prices.');
      } else {
        setError('Globevoy could not complete a fresh provider check. Saved prices remain snapshots and unverified partner handoffs stay locked.');
      }
    } finally {
      setChecking(false);
    }
  }

  function revalidate() {
    if (!session || !tripId || checking) return;
    const needsHotelContext = trip?.tripSnapshot.kind === 'multi' && tripStops(trip).length > 0;
    if (!needsHotelContext) {
      void runRevalidation(null);
      return;
    }

    const cached = cachedHotelGuestNationality();
    if (cached) {
      void runRevalidation(cached);
      return;
    }

    if (profileNationalityChoices.length === 1) {
      const profileCode = profileNationalityChoices[0].code;
      storeHotelGuestNationality(profileCode);
      void runRevalidation(profileCode);
      return;
    }

    setError('');
    setNationalityCode(profileNationalityChoices[0]?.code || '');
    setNationalityOpen(true);
  }

  function confirmNationalityAndCheck() {
    const normalized = clean(nationalityCode).toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) {
      setError('Choose a traveller nationality before checking current hotel rates.');
      return;
    }
    storeHotelGuestNationality(normalized);
    setNationalityOpen(false);
    void runRevalidation(normalized);
  }

  const stops = useMemo(() => tripStops(trip), [trip]);
  const route = useMemo(() => routeLabel(trip), [trip]);
  const nights = useMemo(() => totalNights(trip), [trip]);
  const currency = result?.snapshot.currency || trip?.priceSnapshot?.currency || trip?.tripSnapshot.currency || 'CAD';
  const savedTotal = result?.snapshot.savedTripTotal ?? trip?.priceSnapshot?.tripEstimate;
  const pricing = reviewPricing(result, now);
  const status = statusCopy(result, pricing);
  const flightHandoffs = !pricing.expired && result?.revalidation.handoffEnabled ? result.flights.filter((flight) => flight.handoffEnabled && flight.handoffUrl) : [];
  const hotelHandoffs = !pricing.expired ? result?.hotels.filter((hotel) => !isSandboxHotel(hotel) && hotel.handoffUrl) || [] : [];
  const partnerReady = flightHandoffs.length + hotelHandoffs.length > 0;
  const heroImages = stops.map((stop) => ({ stop, url: imageForCity(stop.city) })).filter((row) => row.url).slice(0, 3);

  if (authLoading) {
    return <main className="gv-710g-page"><section className="gv-710g-state"><div className="gv-story-spinner" /><h1>Loading your trip review…</h1></section></main>;
  }

  if (!session) {
    return (
      <main className="gv-710g-page">
        <section className="gv-710g-gate">
          <div className="gv-710g-gate__visual"><span>✈</span><strong>My Trip</strong><small>Private review</small></div>
          <div><p className="gv-710g-kicker">TRIP REVIEW</p><h1>Sign in to review this saved trip</h1><p>Globevoy loads the owner-private Saved Trip, checks current evidence only when you ask, and hands you off to external partners for final confirmation.</p>{!stagingOrigin ? <small>Secure account sign-in is disabled on localhost. Use the Globevoy staging site for the signed-in Trip Review test.</small> : null}</div>
          <div className="gv-710g-gate__actions">
            <button type="button" className="gv-710g-primary" disabled={!stagingOrigin} title={!stagingOrigin ? 'Secure sign-in is available only on the Globevoy staging site.' : undefined} onClick={() => { if (stagingOrigin) void signIn(`/react/booking/${tripId ? `?tripId=${encodeURIComponent(tripId)}` : ''}`); }}>{stagingOrigin ? 'Sign in' : 'Sign in on staging'}</button>
            <Link className="gv-710g-secondary" href="/my-trips/">Back to My Trips</Link>
          </div>
        </section>
      </main>
    );
  }

  if (!tripId) {
    return (
      <main className="gv-710g-page"><section className="gv-710g-state"><span className="gv-710g-state__icon">♡</span><p className="gv-710g-kicker">TRIP REVIEW</p><h1>Choose a saved trip first</h1><p>Open My Trips and select <strong>Check current prices</strong> on the journey you want to review.</p><Link className="gv-710g-primary" href="/my-trips/">Open My Trips</Link></section></main>
    );
  }

  return (
    <main className="gv-710g-page">
      <section className="gv-710g-hero">
        <div className="gv-710g-hero__media" aria-label="Trip destinations">
          {heroImages.length ? heroImages.map(({ stop, url }, index) => <figure key={`${stop.city}-${index}`} className={`gv-710g-hero-image is-${index + 1}`}><img src={url} alt={`${stop.city} destination`} /><figcaption>{stop.city}</figcaption></figure>) : <div className="gv-710g-hero-fallback"><span>✈</span><strong>{stops.map((stop) => stop.city).join(' + ') || 'Your saved journey'}</strong></div>}
        </div>
        <div className="gv-710g-hero__copy">
          <div className="gv-710g-hero__top"><p className="gv-710g-kicker">TRIP REVIEW</p><Link href="/my-trips/">← My Trips</Link></div>
          <h1>{trip?.name || (loadingTrip ? 'Loading saved trip…' : 'Saved trip')}</h1>
          <p className="gv-710g-route">{route || 'Your saved route will appear here.'}</p>
          <div className="gv-710g-trip-pills">
            {nights ? <span>{nights} nights</span> : null}
            {trip?.tripSnapshot.travellers ? <span>{trip.tripSnapshot.travellers} traveller{trip.tripSnapshot.travellers === 1 ? '' : 's'}</span> : null}
            <span>{trip?.tripSnapshot.kind === 'multi' ? `${stops.length} stops` : 'Single destination'}</span>
            <span>{currency}</span>
          </div>
          <div className="gv-710g-hero__actions">
            <button type="button" className="gv-710g-primary" disabled={!trip || checking || loadingTrip} aria-busy={checking} onClick={() => { void revalidate(); }}>{checking ? 'Checking current prices…' : result ? 'Check prices again' : 'Check current prices'}</button>
            <span>Nothing is purchased or reserved by this check.</span>
          </div>
        </div>
      </section>

      {error ? <div className="gv-710g-error" role="status">{error}</div> : null}

      {nationalityOpen ? (
        <div className="gv-710g-nationality-overlay" role="presentation">
          <section className="gv-710g-nationality-modal" role="dialog" aria-modal="true" aria-labelledby="gv-nationality-title" aria-describedby="gv-nationality-copy">
            <button className="gv-710g-nationality-close" type="button" aria-label="Close nationality selection" disabled={checking} onClick={() => setNationalityOpen(false)}>×</button>
            <p className="gv-710g-kicker">HOTEL RATE CHECK</p>
            <h2 id="gv-nationality-title">Traveller nationality</h2>
            <p id="gv-nationality-copy">Hotel providers require the traveller nationality to check current rates. Choose the country that applies to this rate request.</p>
            {profileNationalityChoices.length > 1 ? <p className="gv-710g-nationality-profile-note">Your Travel Profile lists more than one citizenship, so choose the one to use for this hotel check.</p> : null}
            <label className="gv-710g-nationality-field">
              <span>Nationality</span>
              <select autoFocus value={nationalityCode} onChange={(event) => setNationalityCode(event.target.value)}>
                <option value="">Choose nationality</option>
                {nationalityOptions.map((option) => <option key={option.code} value={option.code}>{option.label} ({option.code})</option>)}
              </select>
            </label>
            <p className="gv-710g-nationality-privacy">Country only. Do not enter a passport number, document number or payment information.</p>
            <div className="gv-710g-nationality-actions">
              <button className="gv-710g-secondary" type="button" disabled={checking} onClick={() => setNationalityOpen(false)}>Cancel</button>
              <button className="gv-710g-primary" type="button" disabled={!nationalityCode || checking} onClick={confirmNationalityAndCheck}>{checking ? 'Checking…' : 'Continue price check'}</button>
            </div>
          </section>
        </div>
      ) : null}

      <section className="gv-710g-progress" aria-label="Trip review progress">
        <div className="is-done"><i>1</i><span><b>Saved</b><small>Trip snapshot</small></span></div>
        <div className={result ? 'is-done' : 'is-current'}><i>2</i><span><b>Check prices</b><small>Fresh provider evidence</small></span></div>
        <div className={result ? 'is-current' : ''}><i>3</i><span><b>Review</b><small>Flights, stays & changes</small></span></div>
        <div className={partnerReady ? 'is-ready' : ''}><i>4</i><span><b>Continue</b><small>External partners</small></span></div>
      </section>

      <section className={`gv-710g-trust is-${status.tone}`}>
        <div className="gv-710g-trust__icon" aria-hidden="true">{status.tone === 'verified' ? '✓' : status.tone === 'changed' ? '↕' : status.tone === 'unavailable' ? '!' : '↻'}</div>
        <div><p className="gv-710g-kicker">{status.eyebrow}</p><h2>{status.title}</h2><p>{status.body}</p></div>
        <div className="gv-710g-trust__meta">
          <span><b>Flights</b>{result ? `${result.revalidation.liveFlightLegCount || 0}/${result.revalidation.requiredFlightLegCount || result.flights.length} checked` : 'Not checked'}</span>
          <span><b>Hotels</b>{result?.hotelRevalidation ? `${result.hotelRevalidation.liveCount ?? 0}/${result.hotelRevalidation.totalCount} live${pricing.sandboxCount ? ` · ${pricing.sandboxCount} sandbox` : ''}` : 'Not checked'}</span>
        </div>
      </section>

      <section className="gv-710g-metrics" aria-label="Trip price summary">
        <article><span>Saved snapshot</span><strong>{money(savedTotal, currency)}</strong><small>{dateTimeLabel(result?.snapshot.capturedAt || trip?.priceSnapshot?.capturedAt || trip?.updatedAt)}</small></article>
        <article className={pricing.complete ? 'is-highlight' : ''}><span>Current checked total</span><strong>{!result ? 'Check required' : pricing.complete ? money(pricing.currentTotal, pricing.currency) : 'Full current total unavailable'}</strong><small>{!result ? 'Check flights and hotels' : pricing.complete ? 'Flights + hotels · all travellers' : pricing.label}</small></article>
        <article><span>Current checked flights</span><strong>{money(pricing.flightsTotal, pricing.currency)}</strong><small>Flight subtotal only · hotels excluded</small></article>
        <article><span>Budget status</span><strong>{pricing.withinBudget === true ? 'Within saved budget' : pricing.withinBudget === false ? 'Over saved budget' : 'Not fully checked'}</strong><small>Based on a complete current trip total</small></article>
      </section>

      <section className="gv-710g-itinerary">
        <div className="gv-710g-section-head"><div><p className="gv-710g-kicker">YOUR JOURNEY</p><h2>One trip, laid out clearly</h2></div><span>{route}</span></div>
        <div className="gv-710g-route-track">
          <div className="gv-710g-route-node is-origin"><i>⌂</i><strong>{trip?.tripSnapshot.origin || 'Origin'}</strong><small>Start</small></div>
          {stops.map((stop, index) => <div className="gv-710g-route-segment" key={`${stop.city}-${index}`}><span className="gv-710g-route-flight">✈</span><div className="gv-710g-route-node"><i>{index + 1}</i><strong>{stop.city}</strong><small>{stop.nights ? `${stop.nights} nights` : stop.code || 'Stop'}</small></div></div>)}
          {trip?.tripSnapshot.kind === 'multi' ? <div className="gv-710g-route-segment"><span className="gv-710g-route-flight">✈</span><div className="gv-710g-route-node is-origin"><i>⌂</i><strong>{trip.tripSnapshot.origin || 'Origin'}</strong><small>Return</small></div></div> : null}
        </div>
      </section>

      <section className="gv-710g-section">
        <div className="gv-710g-section-head"><div><p className="gv-710g-kicker">FLIGHTS</p><h2>Flight prices by leg</h2></div><span>{result?.revalidation.applied ? 'Fresh exact-date evidence shown below.' : 'Run the current-price check to unlock fresh flight evidence.'}</span></div>
        <p>Duffel provides the fare check shown here. Aviasales is a separate comparison search; its flights and prices may differ. A comparison link does not reserve the Duffel fare.</p>
        {result?.revalidation.applied && result.flights.length ? <div className="gv-710g-flight-list">{result.flights.map((flight, index) => <article className="gv-710g-flight-row" key={`${flight.index}-${flight.origin}-${flight.destination}`}><div className="gv-710g-flight-index">{index + 1}</div><div className="gv-710g-flight-route"><small>{shortDate(flight.departureDate)} · {flight.sourceType === 'LIVE' ? 'Duffel fare check' : 'Verification required'}</small><h3>{flight.origin} <span>→</span> {flight.destination}</h3>{flight.resolvedOrigin && (flight.resolvedOrigin !== flight.origin || flight.resolvedDestination !== flight.destination) ? <p>Same-city airport substitution: {flight.resolvedOrigin} → {flight.resolvedDestination}</p> : null}</div><div className="gv-710g-flight-price"><strong>{money(flight.freshAmount, flight.currency || currency)}</strong>{!pricing.expired && flight.handoffEnabled && flight.handoffUrl && result.revalidation.handoffEnabled ? <a href={flight.handoffUrl} target="_blank" rel="noopener noreferrer">{flightComparisonLabel(flight.handoffUrl)} ↗</a> : <span>Handoff locked</span>}</div></article>)}</div> : <div className="gv-710g-empty"><span>✈</span><strong>Fresh flight evidence will appear here.</strong><p>No stale flight handoff is shown before the explicit provider check.</p></div>}
      </section>

      <section className="gv-710g-section">
        <div className="gv-710g-section-head"><div><p className="gv-710g-kicker">STAYS</p><h2>Stay evidence, visually</h2></div><span>{result?.hotelRevalidation?.attempted ? (pricing.sandboxCount ? 'Sandbox hotel rates are test data and are excluded from the live trip total.' : 'Hotel quotes remain separate from saved planning estimates.') : 'Run the current-price check to look for provider-backed hotel evidence.'}</span></div>
        {result?.hotels?.length ? <div className="gv-710g-hotel-grid">{result.hotels.map((hotel) => <HotelCard key={`${hotel.index}-${hotel.city}`} hotel={hotel} currency={currency} expired={pricing.expired} />)}</div> : <div className="gv-710g-empty"><span>▣</span><strong>Hotel evidence will appear after the check.</strong><p>Until then, the saved trip remains a planning snapshot.</p></div>}
      </section>

      <section className={`gv-710g-handoff ${partnerReady ? 'is-ready' : ''}`}>
        <div className="gv-710g-handoff__intro"><p className="gv-710g-kicker">PARTNER HANDOFF</p><h2>{partnerReady ? 'Ready to compare with partners' : 'Partner links unlock only when supported'}</h2><p>Globevoy helps you plan and verify. The external seller confirms the final itinerary, taxes, fees, availability and price before any purchase.</p></div>
        <div className="gv-710g-handoff__actions">
          {flightHandoffs.slice(0, 3).map((flight) => <a key={`flight-${flight.index}`} href={flight.handoffUrl || '#'} target="_blank" rel="noopener noreferrer"><span className="gv-710g-handoff-icon">✈</span><span><small>FLIGHT PARTNER</small><strong>{`${flight.origin} → ${flight.destination} · ${flightComparisonLabel(flight.handoffUrl)}`}</strong></span><b>↗</b></a>)}
          {hotelHandoffs.slice(0, 3).map((hotel) => <a key={`hotel-${hotel.index}-${hotel.city}`} href={hotel.handoffUrl || '#'} target="_blank" rel="noopener noreferrer"><span className="gv-710g-handoff-icon">▣</span><span><small>STAY PARTNER</small><strong>{hotel.handoffLabel || hotel.hotelName || hotel.city}</strong></span><b>↗</b></a>)}
          {!partnerReady ? <div className="gv-710g-handoff-locked"><span>🔒</span><strong>Run or complete the current-price check first.</strong></div> : null}
        </div>
      </section>

      <aside className="gv-710g-boundary"><span>✓</span><div><strong>Globevoy is the planning and comparison layer.</strong><p>No payment, Duffel order, ticket, hotel reservation or booking is created here. Final confirmation happens with the external partner.</p></div></aside>
    </main>
  );
}
