'use client';

import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAuth } from '@/components/account/auth-provider';
import { getTravelProfile, GlobevoyApiError, saveTravelProfile } from '@/lib/api';
import type { TravelProfile } from '@/lib/contracts';

// GV-WEB-4 — Travel Profile (Cinematic Explorer design). Same private profile API as before.
const INTERESTS: Array<[string, string]> = [
  ['Food', 'food-ramen'], ['Beaches', 'beach-maldives'], ['Nature', 'nature-waterfall'], ['History & culture', 'culture-petra'],
  ['Nightlife', 'nightlife-neon'], ['Family', 'family-seashore'], ['Relaxation', 'relaxation-hammock'], ['Adventure', 'adventure-trail']
];

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

type ListKey = 'citizenshipCountries' | 'visitedPlaces' | 'wishListPlaces';

function TagField({ id, label, placeholder, values, onChange }: { id: string; label: string; placeholder: string; values: string[]; onChange: (next: string[]) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  function add() {
    const value = text.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!value) return;
    if (values.some(item => item.toLowerCase() === value.toLowerCase())) { setError(`${value} is already in the list.`); return; }
    onChange([...values, value]);
    setText('');
    setError('');
  }
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); add(); }
  }
  return (
    <div className="cx-tag">
      <label htmlFor={id}>{label}</label>
      <div className="cx-tag-entry">
        <input id={id} value={text} maxLength={120} placeholder={placeholder} autoComplete="off" onChange={e => { setText(e.target.value); setError(''); }} onKeyDown={key} />
        <button type="button" className="cx-button" onClick={add}>Add</button>
      </div>
      {values.length ? (
        <div className="cx-chips">
          {values.map((value, index) => (
            <span className="cx-chip" key={value}>
              <button type="button" aria-label={`Edit ${value}`} onClick={() => { setText(value); onChange(values.filter((_, i) => i !== index)); }}>{value}</button>
              <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((_, i) => i !== index))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
      {values.length ? <p className="cx-fine" style={{ marginTop: 4 }}>Select a saved name to edit it.</p> : null}
      {error ? <p className="cx-error" role="status">{error}</p> : null}
    </div>
  );
}

export function TravelProfileClient() {
  const { session, loading: authLoading, status: authStatus, signIn } = useAuth();
  const [profile, setProfile] = useState<TravelProfile>(EMPTY_PROFILE);
  const [exists, setExists] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  const groups = useMemo(() => [
    ['Home airport', Boolean(profile.homeAirport)],
    ['Home city', Boolean(profile.homeCity)],
    ['Country of residence', Boolean(profile.residenceCountry)],
    ['Citizenship countries', profile.citizenshipCountries.length > 0],
    ['Interests', profile.interests.length > 0],
    ['Places visited or on your wish list', profile.visitedPlaces.length > 0 || profile.wishListPlaces.length > 0]
  ] as Array<[string, boolean]>, [profile]);
  const done = groups.filter(([, ok]) => ok).length;
  const completion = Math.round(done / groups.length * 100);

  function update<K extends keyof TravelProfile>(key: K, value: TravelProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }));
    setMessage('');
    setDirty(true);
  }
  const setList = (key: ListKey) => (next: string[]) => update(key, next);

  function toggleInterest(value: string) {
    const has = profile.interests.includes(value);
    update('interests', has ? profile.interests.filter((item) => item !== value) : [...profile.interests, value]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session?.accessToken || saving) return;
    if (profile.homeAirport && !/^[A-Z]{3}$/.test(profile.homeAirport.trim().toUpperCase())) {
      setError('Enter a three-letter airport code, such as YYZ.');
      return;
    }
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
      setDirty(false);
      setMessage('Travel Profile saved.');
    } catch (err) {
      setError(err instanceof GlobevoyApiError ? err.message : 'Travel Profile could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  if (authLoading) {
    return <section className="cx-wrap cx-state" aria-live="polite"><span className="cx-spinner" aria-hidden="true" /><h1>Opening your Travel Profile…</h1></section>;
  }

  const hero = (
    <header className="cx-hero profile">
      <img src="/assets/images/cinematic/profile-lofoten.jpg" alt="" />
      <div><h1>Travel Profile</h1><p>Make each trip feel like yours.</p></div>
    </header>
  );

  if (!session) {
    return (
      <div className="cx-wrap">
        {hero}
        <section className="cx-guest">
          <p>Sign in to save your home airport, travel style and dream destinations. Planning as a guest still works.</p>
          <div className="cx-actions">
            <button className="cx-button primary" type="button" onClick={() => { void signIn('/react/travel-profile/'); }}>Sign in <span aria-hidden="true">→</span></button>
            <a className="cx-button" href="/">Keep searching as a guest</a>
          </div>
          {authStatus ? <p className="cx-fine" role="status">{authStatus}</p> : null}
        </section>
      </div>
    );
  }

  return (
    <div className="cx-wrap">
      {hero}
      {loading ? <section className="cx-state"><span className="cx-spinner" aria-hidden="true" /><h2>Loading your preferences…</h2></section> : (
        <form id="profile-form" onSubmit={submit} noValidate>
          <section className="cx-section" aria-labelledby="sec-base">
            <header><h2 id="sec-base">Your home base</h2><p>Where your trips usually begin.</p></header>
            <div className="cx-fields three">
              <label className="cx-field">Home airport<input value={profile.homeAirport} maxLength={3} placeholder="YYZ" aria-describedby="airport-note" onChange={(e) => update('homeAirport', e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3))} /></label>
              <label className="cx-field">Home city<input value={profile.homeCity} placeholder="Toronto" onChange={(e) => update('homeCity', e.target.value)} /></label>
              <label className="cx-field">Default currency<select value={profile.defaultCurrency} onChange={(e) => update('defaultCurrency', e.target.value as TravelProfile['defaultCurrency'])}><option>CAD</option><option>USD</option><option>EUR</option><option>GBP</option><option>AUD</option></select></label>
            </div>
            <p id="airport-note" className="cx-fine" style={{ marginTop: 8 }}>Enter a three-letter airport code.</p>
          </section>

          <section className="cx-section" aria-labelledby="sec-countries">
            <header><h2 id="sec-countries">Country context</h2><p>Optional. Country names help tailor travel entry information. Never enter passport or document numbers.</p></header>
            <div className="cx-fields">
              <label className="cx-field">Country of residence<input value={profile.residenceCountry} placeholder="Canada" onChange={(e) => update('residenceCountry', e.target.value)} /></label>
              <TagField id="add-citizenship" label="Citizenship countries" placeholder="Search or enter a country" values={profile.citizenshipCountries} onChange={setList('citizenshipCountries')} />
            </div>
          </section>

          <section className="cx-section" aria-labelledby="sec-style">
            <header><h2 id="sec-style">Your travel style</h2><p>Choose the experiences and pace you enjoy.</p></header>
            <fieldset>
              <legend>Interests</legend>
              <div className="cx-interests">
                {INTERESTS.map(([name, photo]) => (
                  <label className="cx-interest" key={name}>
                    <img src={`/assets/images/cinematic/${photo}.jpg`} alt="" loading="lazy" />
                    <span><input type="checkbox" checked={profile.interests.includes(name)} onChange={() => toggleInterest(name)} />{name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="cx-fields">
              <label className="cx-field">Hotel style<select value={profile.hotelStyle} onChange={(e) => update('hotelStyle', e.target.value as TravelProfile['hotelStyle'])}><option>Best balance</option><option>Budget</option><option>Comfort</option><option>Boutique</option><option>Luxury</option></select></label>
              <label className="cx-field">Trip pace<select value={profile.pace} onChange={(e) => update('pace', e.target.value as TravelProfile['pace'])}><option>Relaxed</option><option>Balanced</option><option>Fast</option></select></label>
            </div>
          </section>

          <section className="cx-section" aria-labelledby="sec-history">
            <header><h2 id="sec-history">Your travel history</h2><p>Keep places you’ve visited and places you hope to see in separate lists.</p></header>
            <div className="cx-fields">
              <TagField id="add-visited" label="Places you have visited" placeholder="Search or enter a place" values={profile.visitedPlaces} onChange={setList('visitedPlaces')} />
              <TagField id="add-wish" label="Places on your wish list" placeholder="Search or enter a place" values={profile.wishListPlaces} onChange={setList('wishListPlaces')} />
            </div>
          </section>

          <details className="cx-complete">
            <summary>Profile completeness · {completion}% ({done} of {groups.length} groups)</summary>
            <ul>{groups.map(([label, ok]) => <li key={label}>{ok ? '✓' : '○'} {label}</li>)}</ul>
          </details>

          {error ? <p className="cx-error" role="alert">{error}</p> : null}

          <div className="cx-savebar">
            <p role="status">{message || (dirty ? 'Unsaved changes' : profile.updatedAt ? `Last saved ${new Date(profile.updatedAt).toLocaleString()}` : exists ? 'Saved to your account' : 'Not saved yet')}</p>
            <button className="cx-button primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Travel Profile'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
