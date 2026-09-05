'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { HomeTripPreviews } from '@/components/discovery/home-trip-previews';
import { getTravelProfile } from '@/lib/api';
import type { TravelProfile } from '@/lib/contracts';
import { filterOrigins, nearestOrigin, originDisplay, resolveOrigin, type OriginOption } from '@/lib/origin-options-710c';
import {
  currencyPrefix,
  profileHotelStyleForSearch,
  profilePrimaryInterest,
  profileSummary
} from '@/lib/profile-discovery-710f-r2';

const HERO_SLIDES = [
  {
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=2200&q=84',
    label: 'Tropical beach at sunrise'
  },
  {
    url: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1dfc?auto=format&fit=crop&w=2200&q=84',
    label: 'City skyline at dusk'
  },
  {
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=2200&q=84',
    label: 'Mountain landscape'
  },
  {
    url: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?auto=format&fit=crop&w=2200&q=84',
    label: 'Green valley from above'
  }
] as const;

function nextSixMonths(): Array<{ value: string; label: string }> {
  const formatter = new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric' });
  const now = new Date();
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() + index, 1);
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: formatter.format(date)
    };
  });
}

export function HomeDiscoveryClient() {
  const { session, loading: authLoading } = useAuth();
  const [activeSlide, setActiveSlide] = useState(0);
  const [origin, setOrigin] = useState('');
  const [originOpen, setOriginOpen] = useState(false);
  const [budget, setBudget] = useState('1000');
  const [currency, setCurrency] = useState('CAD');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [tripLength, setTripLength] = useState('auto');
  const [month, setMonth] = useState('');
  const [interest, setInterest] = useState('No preference');
  const [hotelStyle, setHotelStyle] = useState('Best balance');
  const [region, setRegion] = useState('All continents');
  const [status, setStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState('');
  const [accountProfile, setAccountProfile] = useState<TravelProfile | null>(null);
  const [profileState, setProfileState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  const months = useMemo(() => nextSixMonths(), []);
  const originOptions = useMemo(() => filterOrigins(origin).slice(0, 12), [origin]);
  const resolvedOrigin = useMemo(() => resolveOrigin(origin), [origin]);
  const requestOrigin = resolvedOrigin?.code || origin.trim();
  const travellerSummary = `${adults} adult${adults === 1 ? '' : 's'}${children ? `, ${children} child${children === 1 ? '' : 'ren'}` : ''}`;
  const connectedProfileSummary = useMemo(() => accountProfile ? profileSummary(accountProfile) : [], [accountProfile]);

  useEffect(() => {
    HERO_SLIDES.forEach((slide) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = slide.url;
    });

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number | undefined;

    const restart = () => {
      if (timer) window.clearInterval(timer);
      timer = undefined;
      if (reduceMotion.matches || document.hidden) return;
      timer = window.setInterval(() => {
        setActiveSlide((current) => (current + 1) % HERO_SLIDES.length);
      }, 8000);
    };

    document.addEventListener('visibilitychange', restart);
    if (typeof reduceMotion.addEventListener === 'function') reduceMotion.addEventListener('change', restart);
    else reduceMotion.addListener(restart);
    restart();

    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', restart);
      if (typeof reduceMotion.removeEventListener === 'function') reduceMotion.removeEventListener('change', restart);
      else reduceMotion.removeListener(restart);
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!session?.accessToken) {
      setAccountProfile(null);
      setProfileState('idle');
      return;
    }

    let active = true;
    setProfileState('loading');
    void getTravelProfile(session.accessToken)
      .then((payload) => {
        if (!active) return;
        const profile = payload.exists ? payload.profile : null;
        setAccountProfile(profile);
        setProfileState('ready');
        if (!profile) return;

        setOrigin((current) => {
          if (current.trim()) return current;
          const preferred = resolveOrigin(profile.homeAirport || profile.homeCity);
          if (preferred) return originDisplay(preferred);
          return profile.homeAirport || profile.homeCity || current;
        });
        setCurrency((current) => current === 'CAD' && profile.defaultCurrency ? profile.defaultCurrency : current);
        setInterest((current) => current === 'No preference' ? profilePrimaryInterest(profile) : current);
        setHotelStyle((current) => {
          if (current !== 'Best balance') return current;
          return profileHotelStyleForSearch(profile) || current;
        });
      })
      .catch(() => {
        if (!active) return;
        setAccountProfile(null);
        setProfileState('error');
      });

    return () => { active = false; };
  }, [authLoading, session?.accessToken]);

  function chooseOrigin(option: OriginOption) {
    setOrigin(originDisplay(option));
    setOriginOpen(false);
    setStatus('');
    setLocationNote('');
  }

  function useCurrentLocation() {
    setOriginOpen(false);
    setStatus('');

    if (!navigator.geolocation) {
      setLocationNote('Location is not available in this browser. Choose your city or airport instead.');
      return;
    }

    setLocating(true);
    setLocationNote('Finding your nearest supported airport…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const option = nearestOrigin(coords.latitude, coords.longitude);
        setOrigin(originDisplay(option));
        setOriginOpen(false);
        setLocationNote(`Nearest supported origin: ${originDisplay(option)}.`);
        setLocating(false);
      },
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        setLocationNote(denied
          ? 'Location permission was not granted. You can still choose your city or airport manually.'
          : 'We could not detect your location. Choose your city or airport manually.');
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanOrigin = requestOrigin;
    const numericBudget = Number(budget);

    if (!cleanOrigin) {
      setStatus('Choose your starting city or airport.');
      return;
    }
    if (!resolvedOrigin && cleanOrigin.length !== 3) {
      setStatus('Choose a city or airport from the suggestions so Globevoy can identify the correct airport.');
      setOriginOpen(true);
      return;
    }
    if (!Number.isFinite(numericBudget) || numericBudget < 300) {
      setStatus(`Enter a total trip budget of at least ${currencyPrefix(currency)}300.`);
      return;
    }

    const fixedNights = tripLength === 'auto' ? 5 : Number(tripLength);
    const params = new URLSearchParams({
      origin: cleanOrigin.toUpperCase(),
      budget: String(Math.round(numericBudget)),
      currency,
      adults: String(adults),
      children: String(children),
      passengers: String(adults + children),
      nights: String(fixedNights),
      tripLength,
      interests: interest,
      hotelStyle,
      region
    });
    if (month) params.set('preferredMonth', month);

    setStatus('');
    window.location.assign(`/react/results/?${params.toString()}`);
  }

  return (
    <main className="gv-home-next">
      <section className="gv-home-next__hero">
        <div className="gv-home-next__slides" aria-hidden="true">
          {HERO_SLIDES.map((slide, index) => (
            <div
              key={slide.url}
              className={`gv-home-next__slide${index === activeSlide ? ' is-active' : ''}`}
              style={{ backgroundImage: `url('${slide.url}')` }}
              data-slide-label={slide.label}
            />
          ))}
        </div>
        <div className="gv-home-next__overlay" aria-hidden="true" />

        <div className="gv-home-next__inner">
          <div className="gv-home-next__copy">
            <p className="gv-home-next__eyebrow">Budget-first travel discovery</p>
            <h1>Tell us your budget. We’ll unlock the possibilities.</h1>
            <p>Start with your origin and budget. Globevoy compares a small mix of single-destination and multi-city trips for you.</p>
          </div>

          <form className="gv-home-next__card" onSubmit={submit} noValidate>
            <div className="gv-home-next__card-head">
              <p>Start simple</p>
              <h2>Discover trips within your budget</h2>
            </div>

            <div className="gv-home-next__origin-wrap">
              <div className="gv-home-next__field gv-home-next__field--full">
                <label className="gv-home-next__field-label" htmlFor="gv-origin-input">Leaving from</label>
                <input
                  id="gv-origin-input"
                  value={origin}
                  onChange={(event) => {
                    setOrigin(event.target.value);
                    setOriginOpen(true);
                    setStatus('');
                    setLocationNote('');
                  }}
                  onFocus={() => setOriginOpen(true)}
                  onBlur={() => window.setTimeout(() => setOriginOpen(false), 120)}
                  placeholder="City or airport"
                  autoComplete="off"
                  aria-describedby={locationNote ? 'gv-origin-help gv-origin-location-note' : 'gv-origin-help'}
                  aria-expanded={originOpen}
                  aria-controls="gv-origin-options"
                />
                <div className="gv-home-next__origin-support">
                  <small id="gv-origin-help">
                    {resolvedOrigin ? `${resolvedOrigin.city}, ${resolvedOrigin.country} · ${resolvedOrigin.code}` : 'No destination needed — Globevoy finds the possibilities.'}
                  </small>
                  <button
                    type="button"
                    className="gv-home-next__location-button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={useCurrentLocation}
                    disabled={locating}
                  >
                    <span aria-hidden="true">⌖</span>
                    {locating ? 'Locating…' : 'Use my location'}
                  </button>
                </div>
                {locationNote ? <small className="gv-home-next__location-note" id="gv-origin-location-note" role="status">{locationNote}</small> : null}
              </div>

              {originOpen && originOptions.length ? (
                <div className="gv-home-next__origin-menu" id="gv-origin-options" role="listbox" aria-label="Starting city suggestions">
                  {originOptions.map((option) => (
                    <button
                      key={option.code}
                      type="button"
                      role="option"
                      aria-selected={resolvedOrigin?.code === option.code}
                      className={resolvedOrigin?.code === option.code ? 'is-selected' : ''}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseOrigin(option)}
                    >
                      <strong>{originDisplay(option)}</strong>
                      <span>{option.city}, {option.country} · {option.code}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="gv-home-next__row">
              <label className="gv-home-next__field">
                <span>Total trip budget</span>
                <div className="gv-home-next__money">
                  <span aria-hidden="true">{currencyPrefix(currency)}</span>
                  <input
                    type="number"
                    min="300"
                    step="50"
                    inputMode="numeric"
                    value={budget}
                    onChange={(event) => setBudget(event.target.value)}
                  />
                </div>
              </label>

              <div className="gv-home-next__field gv-home-next__traveller-field">
                <span>Travellers</span>
                <details className="gv-home-next__travellers">
                  <summary>
                    <strong>{travellerSummary}</strong>
                    <span aria-hidden="true">⌄</span>
                  </summary>
                  <div className="gv-home-next__traveller-panel">
                    <div className="gv-home-next__counter-row">
                      <div><strong>Adults</strong><small>Ages 18+</small></div>
                      <div className="gv-home-next__counter">
                        <button type="button" aria-label="Remove adult" onClick={() => setAdults((value) => Math.max(1, value - 1))}>−</button>
                        <output>{adults}</output>
                        <button type="button" aria-label="Add adult" onClick={() => setAdults((value) => Math.min(9, value + 1))}>+</button>
                      </div>
                    </div>
                    <div className="gv-home-next__counter-row">
                      <div><strong>Children</strong><small>Ages 0–17</small></div>
                      <div className="gv-home-next__counter">
                        <button type="button" aria-label="Remove child" onClick={() => setChildren((value) => Math.max(0, value - 1))}>−</button>
                        <output>{children}</output>
                        <button type="button" aria-label="Add child" onClick={() => setChildren((value) => Math.min(9, value + 1))}>+</button>
                      </div>
                    </div>
                  </div>
                </details>
              </div>
            </div>

            {session && profileState === 'loading' ? (
              <div className="gv-home-next__profile-context is-loading" role="status">Loading your signed-in travel profile…</div>
            ) : null}

            {session && profileState === 'ready' && accountProfile ? (
              <div className="gv-home-next__profile-context">
                <div>
                  <strong>Travel Profile connected</strong>
                  <span>{connectedProfileSummary.length ? connectedProfileSummary.join(' · ') : 'Your saved account preferences are available.'}</span>
                  <small>Saved home, currency and compatible preference defaults are applied automatically. You can still change this search.</small>
                </div>
                <Link href="/travel-profile/">Edit profile</Link>
              </div>
            ) : null}

            {session && profileState === 'ready' && !accountProfile ? (
              <div className="gv-home-next__profile-context is-empty">
                <div><strong>Complete your Travel Profile</strong><span>Save a home airport and preferences to make future searches faster.</span></div>
                <Link href="/travel-profile/">Set up profile</Link>
              </div>
            ) : null}

            {session && profileState === 'error' ? (
              <div className="gv-home-next__profile-context is-error">
                <div><strong>Profile temporarily unavailable</strong><span>Your search still works normally. No profile assumptions were added.</span></div>
                <Link href="/travel-profile/">Open profile</Link>
              </div>
            ) : null}

            <details className="gv-home-next__advanced">
              <summary>Advanced options <span aria-hidden="true">⌄</span></summary>
              <div className="gv-home-next__advanced-grid">
                <label className="gv-home-next__field">
                  <span>Preferred month</span>
                  <select value={month} onChange={(event) => setMonth(event.target.value)}>
                    <option value="">Anytime in the next 6 months</option>
                    {months.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="gv-home-next__field">
                  <span>Trip length</span>
                  <select value={tripLength} onChange={(event) => setTripLength(event.target.value)}>
                    <option value="auto">Let Globevoy decide</option>
                    <option value="5">Around 4–6 nights</option>
                    <option value="8">Around 7–9 nights</option>
                    <option value="12">Around 10–14 nights</option>
                  </select>
                </label>
                <label className="gv-home-next__field">
                  <span>Primary interest</span>
                  <select value={interest} onChange={(event) => setInterest(event.target.value)}>
                    <option>No preference</option>
                    <option>Food and culture</option>
                    <option>Beach and relaxation</option>
                    <option>Nature and outdoors</option>
                    <option>Nightlife</option>
                    <option>Family-friendly</option>
                  </select>
                </label>
                <label className="gv-home-next__field">
                  <span>Hotel style</span>
                  <select value={hotelStyle} onChange={(event) => setHotelStyle(event.target.value)}>
                    <option>Best balance</option>
                    <option>Best value</option>
                    <option>Best location</option>
                    <option>Higher guest rating</option>
                    <option>Luxury</option>
                  </select>
                </label>
                <label className="gv-home-next__field gv-home-next__field--full">
                  <span>Region</span>
                  <select value={region} onChange={(event) => setRegion(event.target.value)}>
                    <option>All continents</option>
                    <option>North America</option>
                    <option>Latin America & Caribbean</option>
                    <option>Europe</option>
                    <option>Asia</option>
                    <option>Middle East and North Africa</option>
                    <option>Sub-Saharan Africa</option>
                    <option>Oceania</option>
                  </select>
                </label>
              </div>
            </details>

            <button className="gv-home-next__submit" type="submit">Discover my trips</button>
            {status ? <p className="gv-home-next__status" role="alert">{status}</p> : null}
            <p className="gv-home-next__hint">Search as a guest. Sign in later to save trips and unlock more personalized options.</p>
          </form>
        </div>
      </section>

      <HomeTripPreviews
        origin={requestOrigin}
        budget={budget}
        currency={currency}
        adults={adults}
        children={children}
        tripLength={tripLength}
        month={month}
        interest={interest}
        hotelStyle={hotelStyle}
        region={region}
      />
    </main>
  );
}
