'use client';

import { useMemo, useState } from 'react';
import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import { normalizeLegacyImage, type RecommendationCardModel, type ResultsCity, type ResultsSearch } from '@/lib/recommendations-708a';
import type { JsonObject } from '@/lib/contracts';

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
function positive(value: unknown): number | null { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }

function money(value: number, currency: string): string {
  try { return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${currency} ${Math.round(value).toLocaleString()}`; }
}

function originName(search: ResultsSearch): string {
  if ((search.originCode || search.rawOrigin).toUpperCase() === 'YYZ') return 'Toronto';
  return search.originCity || search.rawOrigin || search.originCode || 'Origin';
}

function curatedImage(city: string): string {
  const file = LEGACY_CITY_IMAGES[clean(city).toLowerCase()];
  return file ? `${LEGACY_ASSET_BASE}/images/${file}` : '';
}

function stopRaw(item: RecommendationCardModel, index: number): JsonObject {
  const source = rows(item.raw.stops).length ? rows(item.raw.stops) : rows(item.raw.cities);
  return source[index] || {};
}

function legRaw(item: RecommendationCardModel, index: number): JsonObject {
  return rows(item.raw.legs)[index] || {};
}

function stopImage(item: RecommendationCardModel, index: number, city: ResultsCity): string {
  const raw = stopRaw(item, index);
  const routeImage = normalizeLegacyImage(clean(raw.image ?? raw.img ?? raw.imageUrl ?? raw.photoUrl ?? raw.heroImage));
  return routeImage || curatedImage(city.city);
}

function stopNights(item: RecommendationCardModel, index: number): number | null {
  const raw = stopRaw(item, index);
  return positive(raw.nights ?? raw.stayNights ?? raw.allocatedNights);
}

function exchangeRate(item: RecommendationCardModel): number {
  return positive(record(item.raw.displayBudget).exchangeRateFromUsd) || 1;
}

function incomingFlightEstimate(item: RecommendationCardModel, index: number): number | null {
  const raw = legRaw(item, index);
  const usd = positive(raw.estimatedFlightUsd);
  return usd ? Math.round(usd * exchangeRate(item)) : null;
}

function stayEstimate(item: RecommendationCardModel, index: number): number | null {
  const raw = stopRaw(item, index);
  const hotel = record(raw.hotel);
  const usd = positive(hotel.estimatedStayUsd ?? raw.estimatedStayUsd);
  return usd ? Math.round(usd * exchangeRate(item)) : null;
}

function StopMedia({ image, city, code, badge }: { image: string; city: string; code: string; badge: string }) {
  const [failed, setFailed] = useState(false);
  const show = Boolean(image) && !failed;
  return (
    <div className={`gv-story-docked-card__media${show ? ' has-image' : ' is-fallback'}`}>
      {show ? <img src={image} alt={`${city} destination`} loading="lazy" onError={() => setFailed(true)} /> : (
        <div><strong>{code || city.slice(0, 3).toUpperCase()}</strong><span>{city}</span></div>
      )}
      <small>{badge}</small>
    </div>
  );
}

export function JourneyStoryDeck710DR4({
  item,
  search,
  revealed,
  activeStop,
  latestRevealed,
  candidateCities,
  busy,
  actionMessage,
  onShuffleStop,
  onAddDestination
}: {
  item: RecommendationCardModel;
  search: ResultsSearch;
  revealed: number[];
  activeStop: number | null;
  latestRevealed: number | null;
  candidateCities: ResultsCity[];
  busy: boolean;
  actionMessage: string;
  onShuffleStop: (index: number) => void;
  onAddDestination: (city: ResultsCity) => void;
}) {
  const stops = item.cities || [];
  const origin = originName(search);
  const originCode = search.originCode || search.rawOrigin;
  const originImage = curatedImage(origin);
  const revealSet = useMemo(() => new Set(revealed), [revealed]);
  const canAdd = stops.length < 3 && candidateCities.length > 0;

  return (
    <section className="gv-story-deck" id="gv-story-trip" aria-labelledby="gv-story-deck-title">
      <div className="gv-story-deck__head">
        <div><p>YOUR TRIP · BUILT AS YOU WATCH</p><h2 id="gv-story-deck-title">Your journey story</h2></div>
        <div className="gv-story-deck__actions">
          {canAdd ? <details><summary>+ Add destination</summary><div className="gv-story-add-menu">
            {candidateCities.slice(0, 4).map((city) => <button key={city.id || city.city} type="button" disabled={busy || !city.id} onClick={() => onAddDestination(city)}><strong>{city.city}</strong><span>{city.country || 'Suggested stop'}</span></button>)}
          </div></details> : null}
          <span>{stops.length} stop{stops.length === 1 ? '' : 's'} · {item.nights} nights</span>
        </div>
      </div>

      {actionMessage ? <div className="gv-story-action-message" role="status">{actionMessage}</div> : null}

      <div className="gv-story-docked-track">
        {revealSet.has(-1) ? (
          <article className={`gv-story-docked-card is-origin${latestRevealed === -1 ? ' is-new' : ''}${activeStop === -1 ? ' is-active' : ''}`}>
            <StopMedia image={originImage} city={origin} code={originCode} badge="START" />
            <div className="gv-story-docked-card__body"><div><p>STARTING POINT</p><h3>{origin}</h3><span>{originCode}</span></div><div className="gv-story-docked-facts"><span><b>Route</b>Journey begins</span><span><b>Dates</b>Chosen automatically</span></div></div>
          </article>
        ) : null}

        {stops.map((city, index) => {
          if (!revealSet.has(index)) return null;
          const nights = stopNights(item, index);
          const flightEstimate = incomingFlightEstimate(item, index);
          const hotelEstimate = stayEstimate(item, index);
          return (
            <article key={`${city.id || city.city}-${index}`} className={`gv-story-docked-card${latestRevealed === index ? ' is-new' : ''}${activeStop === index ? ' is-active' : ''}`}>
              <StopMedia image={stopImage(item, index, city)} city={city.city} code={city.code} badge={`STOP ${index + 1}`} />
              <button type="button" className="gv-story-card-shuffle" disabled={busy || !city.id || candidateCities.length === 0} onClick={() => onShuffleStop(index)} aria-label={`Shuffle ${city.city}`}>↻ <span>Shuffle</span></button>
              <div className="gv-story-docked-card__body">
                <div><p>{city.country || 'DESTINATION'}</p><h3>{city.city}</h3><span>{city.code || 'Airport'}</span></div>
                <div className="gv-story-docked-facts">
                  <span><b>Stay</b>{nights ? `${Math.round(nights)} night${Math.round(nights) === 1 ? '' : 's'}` : 'Allocated by Globevoy'}</span>
                  <span><b>Flight</b>{flightEstimate ? `${money(flightEstimate, search.currency)} planning` : 'Automatic fare date'}</span>
                  <span><b>Hotel</b>{hotelEstimate ? `${money(hotelEstimate, search.currency)} planning` : 'Stay evidence later'}</span>
                </div>
                <div className="gv-story-docked-evidence"><PriceEvidenceBadge evidence={item.evidence} /></div>
              </div>
            </article>
          );
        })}

        {revealSet.has(stops.length) ? (
          <article className={`gv-story-docked-card is-return${latestRevealed === stops.length ? ' is-new' : ''}${activeStop === stops.length ? ' is-active' : ''}`}>
            <StopMedia image={originImage} city={origin} code={originCode} badge="RETURN" />
            <div className="gv-story-docked-card__body"><div><p>RETURN HOME</p><h3>{origin}</h3><span>{originCode}</span></div><div className="gv-story-docked-facts"><span><b>Journey</b>Complete</span><span><b>Total</b>{money(item.total, search.currency)}</span></div></div>
          </article>
        ) : null}
      </div>

      {!revealed.length ? <div className="gv-story-deck__waiting"><span>✈</span><strong>Your trip cards will land here.</strong><small>Watch the map. Each stop docks into the journey as the plane arrives.</small></div> : null}
    </section>
  );
}
