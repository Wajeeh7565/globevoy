'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { JourneyMap710E } from '@/components/journey/journey-map-710e';
import { PriceEvidenceBadge } from '@/components/price-evidence-badge';
import { getPublicMultiCityTours, GlobevoyApiError } from '@/lib/api';
import type { JsonObject } from '@/lib/contracts';
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
  const [params, setParams] = useState<URLSearchParams>(() => new URLSearchParams());
  const [search, setSearch] = useState<ResultsSearch | null>(null);
  const [route, setRoute] = useState<RecommendationCardModel | null>(null);
  const [routeId, setRouteId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeStop, setActiveStop] = useState(-1);

  useEffect(() => {
    const next = currentParams();
    setParams(next);
    setRouteId(clean(next.get('routeId')));
    setSearch(parseResultsSearch(next));
  }, []);

  const load = useCallback(async () => {
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

  useEffect(() => { if (search && routeId) void load(); }, [search, routeId, load]);

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

  const backUrl = useMemo(() => {
    const next = new URLSearchParams(params);
    next.delete('routeId');
    return `/react/results/?${next.toString()}`;
  }, [params]);

  if (!search) return <main className="gv-journey-page"><section className="gv-journey-state">Preparing your journey…</section></main>;
  if (!routeId) return <main className="gv-journey-page"><section className="gv-journey-state"><h1>Choose a route first</h1><a href={backUrl}>Back to routes</a></section></main>;
  if (loading) return <main className="gv-journey-page"><section className="gv-journey-state"><div className="gv-journey-spinner" /><h1>Opening your journey…</h1><p>Matching the exact route you selected.</p></section></main>;
  if (error || !route) return <main className="gv-journey-page"><section className="gv-journey-state gv-journey-state--error"><p>ROUTE STATUS</p><h1>We cannot open this exact journey right now</h1><span>{error}</span><div><button onClick={() => void load()}>Try again</button><a href={backUrl}>Back to routes</a></div></section></main>;

  const origin = originName(search);
  const originCode = search.originCode || search.rawOrigin;
  const stops = route.cities || [];
  const routeLine = [origin, ...stops.map((city) => city.city), origin].join(' → ');

  return (
    <main className="gv-journey-page">
      <nav className="gv-journey-back"><a href={backUrl}>← Back to route choices</a><span>{GV_WEB_710E_VERSION}</span></nav>

      <header className="gv-journey-hero">
        <div>
          <p>YOUR CONNECTED JOURNEY</p>
          <h1>{routeTitle(route)}</h1>
          <span>{routeLine}</span>
        </div>
        <div className="gv-journey-hero__numbers">
          <strong>{money(route.total, search.currency)}</strong>
          <span>{route.nights} nights · {stops.length} stops</span>
          <PriceEvidenceBadge evidence={route.evidence} />
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
