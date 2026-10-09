'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/account/auth-provider';
import { Button } from '@/components/ui/button';
import { getTravelProfile, GlobevoyApiError, saveTravelProfile } from '@/lib/api';
import type { TravelProfile } from '@/lib/contracts';

const INTERESTS = ['Food', 'Beaches', 'Nature', 'History & culture', 'Nightlife', 'Family', 'Relaxation', 'Adventure'];

const EMPTY_PROFILE: TravelProfile = {
  schemaVersion: 'GV-TRAVEL-PROFILE-V1',
  homeAirport: '',
  homeCity: '',
  residenceCountry: '',
  citizenshipCountries: [],
  interests: [],
  hotelStyle: 'Best balance',
  pace: 'Balanced',
  defaultCurrency: 'CAD',
  visitedPlaces: [],
  wishListPlaces: [],
  updatedAt: null
};

function listText(values: string[]): string {
  return values.join(', ');
}

function textList(value: string): string[] {
  const seen = new Set<string>();
  return value.split(/[,\n]/).map((item) => item.trim()).filter((item) => {
    const key = item.toLowerCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function TravelProfileClient() {
  const { session, loading: authLoading, status: authStatus, signIn } = useAuth();
  const [profile, setProfile] = useState<TravelProfile>(EMPTY_PROFILE);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!session?.accessToken) {
      setProfile(EMPTY_PROFILE);
      setExists(false);
      return;
    }
    setLoading(true);
    setError('');
    void getTravelProfile(session.accessToken)
      .then((response) => {
        if (cancelled) return;
        setProfile(response.profile);
        setExists(response.exists);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof GlobevoyApiError ? err.message : 'Travel Profile could not be loaded.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session?.accessToken]);

  const completion = useMemo(() => {
    const checks = [profile.homeAirport, profile.homeCity, profile.residenceCountry, profile.citizenshipCountries.length, profile.interests.length, profile.visitedPlaces.length || profile.wishListPlaces.length];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }, [profile]);

  function update<K extends keyof TravelProfile>(key: K, value: TravelProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setMessage('');
  }

  function toggleInterest(value: string) {
    const has = profile.interests.includes(value);
    update('interests', has ? profile.interests.filter((item) => item !== value) : [...profile.interests, value]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.accessToken || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await saveTravelProfile(session.accessToken, {
        ...profile,
        homeAirport: profile.homeAirport.trim().toUpperCase()
      });
      setProfile(response.profile);
      setExists(true);
      setMessage('Travel Profile saved. Globevoy can use these preferences for signed-in personalization as that ranking layer is connected.');
    } catch (err) {
      setError(err instanceof GlobevoyApiError ? err.message : 'Travel Profile could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return <section className="gv-profile-state"><div className="gv-story-spinner" /><h1>Opening your Travel Profile…</h1></section>;
  }

  if (!session) {
    return (
      <section className="gv-profile-guest">
        <div className="gv-profile-guest__copy">
          <p className="gv-kicker">TRAVEL PROFILE</p>
          <h1>Travel your way.</h1>
          <p>Save your airport, travel style and dream destinations. Or keep exploring as a guest.</p>
          <div className="gv-account-actions">
            <Button onClick={() => { void signIn('/react/travel-profile/'); }}>Sign in or create account</Button>
            <a className="gv-button gv-button--secondary" href="/">Continue as guest</a>
          </div>
          {authStatus ? <p className="gv-account-status" role="status">{authStatus}</p> : null}
        </div>
        <div className="gv-profile-benefits" aria-label="Travel Profile benefits">
          <span><b>01</b><strong>Start faster</strong><small>Your favourite departure airport.</small></span>
          <span><b>02</b><strong>Trips that fit</strong><small>Your interests and travel style.</small></span>
          <span><b>03</b><strong>Keep your plans</strong><small>Trips saved to your account.</small></span>
        </div>
      </section>
    );
  }

  return (
    <div className="gv-profile-shell">
      <header className="gv-profile-hero">
        <div>
          <p className="gv-kicker">YOUR TRAVEL PROFILE</p>
          <h1>Your travel preferences.</h1>
          <p>Save how you like to travel. Never enter passport, visa or payment numbers.</p>
        </div>
        <aside className="gv-profile-progress">
          <span>PROFILE SIGNALS</span>
          <strong>{completion}%</strong>
          <div><i style={{ width: `${completion}%` }} /></div>
          <small>{exists ? 'Saved to your private account' : 'Ready for your first save'}</small>
        </aside>
      </header>

      {loading ? <section className="gv-profile-state"><div className="gv-story-spinner" /><h2>Loading your preferences…</h2></section> : null}

      {!loading ? (
        <form className="gv-profile-form" onSubmit={submit}>
          <section className="gv-profile-card">
            <div className="gv-profile-card__head"><span>01</span><div><h2>Your home base</h2><p>Where trips usually begin.</p></div></div>
            <div className="gv-profile-grid gv-profile-grid--3">
              <label><span>Home airport</span><input value={profile.homeAirport} maxLength={3} placeholder="YYZ" onChange={(e) => update('homeAirport', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))} /></label>
              <label><span>Home city</span><input value={profile.homeCity} placeholder="Toronto" onChange={(e) => update('homeCity', e.target.value)} /></label>
              <label><span>Default currency</span><select value={profile.defaultCurrency} onChange={(e) => update('defaultCurrency', e.target.value as TravelProfile['defaultCurrency'])}><option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option><option>AUD</option></select></label>
            </div>
          </section>

          <section className="gv-profile-card">
            <div className="gv-profile-card__head"><span>02</span><div><h2>Country context</h2><p>Useful later for relevant entry-information checks. Country names only.</p></div></div>
            <div className="gv-profile-grid gv-profile-grid--2">
              <label><span>Country of residence</span><input value={profile.residenceCountry} placeholder="Canada" onChange={(e) => update('residenceCountry', e.target.value)} /></label>
              <label><span>Citizenship country or countries</span><input value={listText(profile.citizenshipCountries)} placeholder="Canada, Pakistan" onChange={(e) => update('citizenshipCountries', textList(e.target.value))} /><small>Do not enter passport or document numbers.</small></label>
            </div>
          </section>

          <section className="gv-profile-card">
            <div className="gv-profile-card__head"><span>03</span><div><h2>Your travel style</h2><p>Signals Globevoy can use when ranking otherwise-feasible trips.</p></div></div>
            <fieldset className="gv-profile-interest-fieldset"><legend>What usually sounds good?</legend><div className="gv-profile-interest-grid">{INTERESTS.map((interest) => <label key={interest} className={profile.interests.includes(interest) ? 'is-selected' : ''}><input type="checkbox" checked={profile.interests.includes(interest)} onChange={() => toggleInterest(interest)} /><span>{interest}</span></label>)}</div></fieldset>
            <div className="gv-profile-grid gv-profile-grid--2">
              <label><span>Hotel style</span><select value={profile.hotelStyle} onChange={(e) => update('hotelStyle', e.target.value as TravelProfile['hotelStyle'])}><option>Best balance</option><option>Budget</option><option>Comfort</option><option>Boutique</option><option>Luxury</option></select></label>
              <label><span>Trip pace</span><select value={profile.pace} onChange={(e) => update('pace', e.target.value as TravelProfile['pace'])}><option>Relaxed</option><option>Balanced</option><option>Fast</option></select></label>
            </div>
          </section>

          <section className="gv-profile-card">
            <div className="gv-profile-card__head"><span>04</span><div><h2>Your travel history</h2><p>Help us suggest new places over time.</p></div></div>
            <div className="gv-profile-grid gv-profile-grid--2">
              <label><span>Places you have visited</span><textarea rows={4} value={listText(profile.visitedPlaces)} placeholder="Niagara Falls, Istanbul, Lahore" onChange={(e) => update('visitedPlaces', textList(e.target.value))} /></label>
              <label><span>Places on your wish list</span><textarea rows={4} value={listText(profile.wishListPlaces)} placeholder="Tokyo, Lisbon, Cape Town" onChange={(e) => update('wishListPlaces', textList(e.target.value))} /></label>
            </div>
          </section>

          {error ? <p className="gv-account-status gv-account-status--error" role="alert">{error}</p> : null}
          {message ? <p className="gv-account-status gv-account-status--success" role="status">{message}</p> : null}

          <div className="gv-profile-savebar">
            <div><strong>{session.user.email || session.user.username || 'Signed-in Globevoy account'}</strong><span>{profile.updatedAt ? `Last saved ${new Date(profile.updatedAt).toLocaleString()}` : 'Not saved yet'}</span></div>
            <div className="gv-account-actions"><Link className="gv-button gv-button--secondary" href="/my-trips/">My Trips</Link><Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Travel Profile'}</Button></div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
