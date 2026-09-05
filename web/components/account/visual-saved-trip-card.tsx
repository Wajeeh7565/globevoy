'use client';

import { useMemo, useState } from 'react';
import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import { Button } from '@/components/ui/button';
import type { SavedTrip, SavedTripCity } from '@/lib/contracts';

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

function clean(value: unknown): string {
  return String(value == null ? '' : value).trim();
}

function destinationRows(trip: SavedTrip): SavedTripCity[] {
  const snapshot = trip.tripSnapshot;
  if (snapshot.kind === 'single') {
    return snapshot.city ? [{ city: snapshot.city, country: snapshot.country, code: snapshot.code, nights: snapshot.nights }] : [];
  }
  return Array.isArray(snapshot.cities) ? snapshot.cities : [];
}

function destinationImage(trip: SavedTrip): string {
  const city = destinationRows(trip)[0]?.city || trip.tripSnapshot.city || '';
  const file = CITY_IMAGES[clean(city).toLowerCase()];
  return file ? `${LEGACY_ASSET_BASE}/images/${file}` : '';
}

function routeStops(trip: SavedTrip): Array<{ label: string; code: string }> {
  const origin = clean(trip.tripSnapshot.origin) || 'Home';
  const destinations = destinationRows(trip);
  const stops = [{ label: origin, code: origin.slice(0, 3).toUpperCase() }];
  destinations.forEach((city) => {
    stops.push({ label: city.city, code: clean(city.code).toUpperCase() || city.city.slice(0, 3).toUpperCase() });
  });
  if (trip.tripSnapshot.kind === 'multi' && destinations.length) stops.push({ label: origin, code: origin.slice(0, 3).toUpperCase() });
  return stops.slice(0, 5);
}

function tripMeta(trip: SavedTrip): string {
  const snapshot = trip.tripSnapshot;
  const cities = destinationRows(trip);
  const nights = snapshot.nights || cities.reduce((sum, city) => sum + (Number(city.nights) || 0), 0);
  const travellers = Number(snapshot.travellers) || 1;
  const parts = [snapshot.kind === 'multi' ? `${cities.length} destinations` : 'Single destination'];
  if (nights > 0) parts.push(`${Math.round(nights)} nights`);
  parts.push(`${travellers} traveller${travellers === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function priceLabel(trip: SavedTrip): string {
  const amount = Number(trip.priceSnapshot?.tripEstimate);
  const currency = trip.priceSnapshot?.currency || trip.tripSnapshot.currency || 'CAD';
  if (!Number.isFinite(amount) || amount <= 0) return 'Price check needed';
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

export function VisualSavedTripCard({
  trip,
  updatedLabel,
  busy,
  onOpen,
  onCheckPrices,
  onDelete
}: {
  trip: SavedTrip;
  updatedLabel: string;
  busy: boolean;
  onOpen: () => void;
  onCheckPrices: () => void;
  onDelete: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = destinationImage(trip);
  const stops = useMemo(() => routeStops(trip), [trip]);
  const heroCity = destinationRows(trip)[0]?.city || trip.tripSnapshot.city || trip.name || 'Saved journey';

  return (
    <article className="gv-saved-visual-card">
      <div className={`gv-saved-visual-card__media${image && !imageFailed ? ' has-image' : ' is-fallback'}`}>
        {image && !imageFailed ? <img src={image} alt={`${heroCity} destination`} loading="lazy" onError={() => setImageFailed(true)} /> : null}
        <div className="gv-saved-visual-card__shade" />
        <span className="gv-saved-visual-card__type">{trip.tripSnapshot.kind === 'multi' ? 'Multi-city' : 'Single trip'}</span>
        <div className="gv-saved-visual-card__media-copy">
          <small>Saved journey</small>
          <strong>{heroCity}</strong>
        </div>
      </div>

      <div className="gv-saved-visual-card__body">
        <div className="gv-saved-visual-card__topline">
          <div>
            <p className="gv-kicker">{updatedLabel}</p>
            <h2>{trip.name || heroCity}</h2>
          </div>
          <strong className="gv-saved-visual-card__price">{priceLabel(trip)}</strong>
        </div>

        <div className="gv-saved-route" aria-label="Saved route">
          {stops.map((stop, index) => (
            <div className="gv-saved-route__stop" key={`${stop.code}-${index}`} title={stop.label}>
              <span>{stop.code}</span>
              {index < stops.length - 1 ? <i aria-hidden="true">✈</i> : null}
            </div>
          ))}
        </div>

        <p className="gv-saved-visual-card__meta">{tripMeta(trip)}</p>

        <div className="gv-saved-visual-card__trust">
          <PriceEvidenceBadge evidence={{
            state: 'estimate',
            label: 'Saved snapshot · price check needed',
            note: 'Saved prices are historical snapshots. Globevoy checks current provider evidence before partner handoff.'
          }} />
        </div>

        <div className="gv-saved-visual-card__actions">
          <Button variant="secondary" disabled={busy} onClick={onOpen}>Open trip</Button>
          <Button disabled={busy} onClick={onCheckPrices}>Check current prices</Button>
          <details className="gv-saved-visual-card__more">
            <summary aria-label={`More actions for ${trip.name || heroCity}`}>•••</summary>
            <button type="button" disabled={busy} onClick={onDelete}>Delete saved trip</button>
          </details>
        </div>
      </div>
    </article>
  );
}
