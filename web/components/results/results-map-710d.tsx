'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveOrigin } from '@/lib/origin-options-710c';
import { normalizeLegacyImage, type RecommendationCardModel, type ResultsSearch } from '@/lib/recommendations-708a';

type LatLng = [number, number];
type PlayerState = 'idle' | 'playing' | 'paused' | 'complete';
type RawRow = Record<string, unknown>;

type LeafletMap = {
  remove: () => void;
  fitBounds: (bounds: unknown, options?: Record<string, unknown>) => void;
  setView: (center: LatLng, zoom: number, options?: Record<string, unknown>) => void;
};

type LeafletLayerGroup = {
  addTo: (map: LeafletMap) => LeafletLayerGroup;
  clearLayers: () => void;
};

type LeafletLayer = {
  addTo: (target: LeafletLayerGroup | LeafletMap) => LeafletLayer;
  bindTooltip?: (content: string, options?: Record<string, unknown>) => LeafletLayer;
};

type LeafletMarker = {
  addTo: (target: LeafletLayerGroup | LeafletMap) => LeafletMarker;
  setLatLng: (position: LatLng) => LeafletMarker;
  remove: () => void;
  bindTooltip?: (content: string, options?: Record<string, unknown>) => LeafletMarker;
  on?: (event: string, handler: () => void) => LeafletMarker;
};

type LeafletNamespace = {
  map: (element: HTMLElement, options?: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, options?: Record<string, unknown>) => LeafletLayer;
  layerGroup: () => LeafletLayerGroup;
  polyline: (positions: LatLng[], options?: Record<string, unknown>) => LeafletLayer;
  marker: (position: LatLng, options?: Record<string, unknown>) => LeafletMarker;
  divIcon: (options: Record<string, unknown>) => unknown;
  latLngBounds: (positions: LatLng[]) => unknown;
  control: { zoom: (options?: Record<string, unknown>) => { addTo: (map: LeafletMap) => unknown } };
};

declare global {
  interface Window {
    L?: LeafletNamespace;
    __gvLeafletPromise?: Promise<LeafletNamespace>;
  }
}

const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const MAP_TILE_URL = String(process.env.NEXT_PUBLIC_GLOBEVOY_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png').trim();
const MAP_TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
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

function loadLeaflet(): Promise<LeafletNamespace> {
  if (window.L) return Promise.resolve(window.L);
  if (window.__gvLeafletPromise) return window.__gvLeafletPromise;

  window.__gvLeafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      existing.addEventListener('load', () => window.L ? resolve(window.L) : reject(new Error('Leaflet did not initialize.')), { once: true });
      existing.addEventListener('error', () => reject(new Error('Leaflet failed to load.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => window.L ? resolve(window.L) : reject(new Error('Leaflet did not initialize.'));
    script.onerror = () => reject(new Error('Leaflet failed to load.'));
    document.head.appendChild(script);
  });

  return window.__gvLeafletPromise;
}

function originPoint(search: ResultsSearch): LatLng | null {
  const origin = resolveOrigin(search.originCode || search.rawOrigin);
  return origin ? [origin.latitude, origin.longitude] : null;
}

function routePoints(item: RecommendationCardModel, search: ResultsSearch): LatLng[] {
  const origin = originPoint(search);
  const stops = (item.cities || [])
    .map((city) => Number.isFinite(city.lat) && Number.isFinite(city.lng)
      ? [Number(city.lat), Number(city.lng)] as LatLng
      : null)
    .filter(Boolean) as LatLng[];
  return origin ? [origin, ...stops, origin] : stops;
}

function routeNames(item: RecommendationCardModel, search: ResultsSearch): string[] {
  const origin = resolveOrigin(search.originCode || search.rawOrigin)?.city || search.rawOrigin || search.originCode || 'Origin';
  return [origin, ...(item.cities || []).map((city) => city.city), origin];
}

function curatedImage(city: string): string | null {
  const file = LEGACY_CITY_IMAGES[String(city || '').trim().toLowerCase()];
  return file ? `${LEGACY_ASSET_BASE}/images/${file}` : null;
}

function markerIcon(L: LeafletNamespace, label: string, active = false): unknown {
  return L.divIcon({
    className: 'gv-story-map-pin-wrap',
    html: `<span class="gv-story-map-pin${active ? ' is-active' : ''}"><strong>${label}</strong></span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function interpolate(a: LatLng, b: LatLng, progress: number): LatLng {
  return [
    a[0] + (b[0] - a[0]) * progress,
    a[1] + (b[1] - a[1]) * progress
  ];
}

function rawRows(value: unknown): RawRow[] {
  return Array.isArray(value)
    ? value.filter((row): row is RawRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row))
    : [];
}

function rawStops(item: RecommendationCardModel): RawRow[] {
  const raw = item.raw as RawRow;
  const stops = rawRows(raw.stops);
  return stops.length ? stops : rawRows(raw.cities);
}

function firstString(row: RawRow | undefined, keys: string[]): string {
  if (!row) return '';
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function positiveNumber(row: RawRow | undefined, keys: string[]): number | undefined {
  if (!row) return undefined;
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return undefined;
}

function destinationMeta(item: RecommendationCardModel, index: number): {
  city: string;
  country: string;
  image: string | null;
  nights?: number;
} {
  const city = (item.cities || [])[index];
  const raw = rawStops(item)[index];
  const providerImage = normalizeLegacyImage(firstString(raw, ['image', 'img', 'imageUrl', 'heroImage', 'photo', 'photoUrl']));
  const cityName = city?.city || firstString(raw, ['city', 'name']) || `Stop ${index + 1}`;
  return {
    city: cityName,
    country: city?.country || firstString(raw, ['country', 'countryName']),
    image: providerImage || curatedImage(cityName),
    nights: positiveNumber(raw, ['nights', 'nightCount', 'stayNights'])
  };
}

export function ResultsMap710D({
  item,
  search,
  onStoryStop,
  replaySignal
}: {
  item: RecommendationCardModel;
  search: ResultsSearch;
  onStoryStop: (index: number | null) => void;
  replaySignal: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const routeLayerRef = useRef<LeafletLayerGroup | null>(null);
  const leafletRef = useRef<LeafletNamespace | null>(null);
  const planeRef = useRef<LeafletMarker | null>(null);
  const animationRef = useRef<number | null>(null);
  const waitRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [playerState, setPlayerState] = useState<PlayerState>('idle');
  const [legIndex, setLegIndex] = useState(0);
  const [arrivalIndex, setArrivalIndex] = useState<number | null>(null);
  const [fitNonce, setFitNonce] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);

  const points = useMemo(() => routePoints(item, search), [item, search]);
  const names = useMemo(() => routeNames(item, search), [item, search]);
  const cityCount = (item.cities || []).length;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const element = containerRef.current;
    if (!element) return;

    void loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current) return;
      leafletRef.current = L;
      const initial = originPoint(search) || [30, 0] as LatLng;
      const map = L.map(containerRef.current, {
        zoomControl: false,
        scrollWheelZoom: true,
        minZoom: 2,
        worldCopyJump: true
      });
      L.tileLayer(MAP_TILE_URL, {
        attribution: MAP_TILE_ATTRIBUTION,
        maxZoom: 19
      }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      routeLayerRef.current = L.layerGroup().addTo(map);
      map.setView(initial, 3);
      mapRef.current = map;
      setStatus('ready');
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });

    return () => {
      cancelled = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (waitRef.current) window.clearTimeout(waitRef.current);
      planeRef.current?.remove();
      planeRef.current = null;
      routeLayerRef.current = null;
      leafletRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [search]);

  function cancelMotion() {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (waitRef.current) window.clearTimeout(waitRef.current);
    animationRef.current = null;
    waitRef.current = null;
  }

  function resetPlane(autoPlay: boolean) {
    if (!points.length || !leafletRef.current || !mapRef.current) return;
    cancelMotion();
    setLegIndex(0);
    setArrivalIndex(-1);
    progressRef.current = 0;
    onStoryStop(-1);
    planeRef.current?.remove();
    planeRef.current = leafletRef.current.marker(points[0], {
      icon: leafletRef.current.divIcon({
        className: 'gv-story-plane-wrap',
        html: '<span class="gv-story-plane" aria-hidden="true">✈</span>',
        iconSize: [42, 42],
        iconAnchor: [21, 21]
      }),
      interactive: false
    }).addTo(mapRef.current);
    mapRef.current.fitBounds(leafletRef.current.latLngBounds(points), { padding: [46, 46], maxZoom: 5, animate: true });
    setPlayerState('idle');
    if (autoPlay) {
      waitRef.current = window.setTimeout(() => {
        setArrivalIndex(null);
        onStoryStop(null);
        setPlayerState('playing');
      }, reduceMotion ? 850 : 1550);
    }
  }

  useEffect(() => {
    if (status !== 'ready' || !points.length) return;
    resetPlane(true);
    return () => cancelMotion();
  }, [item.id, status, replaySignal, reduceMotion]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !routeLayerRef.current || !leafletRef.current || !points.length) return;
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    layer.clearLayers();

    for (let index = 0; index < points.length - 1; index += 1) {
      L.polyline([points[index], points[index + 1]], {
        color: index === legIndex && playerState === 'playing' ? '#08a99d' : '#1d6e84',
        weight: index === legIndex && playerState === 'playing' ? 5 : 3,
        opacity: index === legIndex && playerState === 'playing' ? 0.98 : 0.58,
        dashArray: index === legIndex && playerState === 'playing' ? null : '9 7'
      }).addTo(layer);
    }

    points.forEach((point, index) => {
      if (index === points.length - 1) return;
      const isOrigin = index === 0;
      const label = isOrigin ? '⌂' : String(index);
      const active = isOrigin ? arrivalIndex === -1 : arrivalIndex === index - 1;
      const marker = L.marker(point, { icon: markerIcon(L, label, active) }).addTo(layer);
      marker.bindTooltip?.(names[index] || `Stop ${index}`, { direction: 'top', offset: [0, -12], opacity: 0.96 });
      marker.on?.('click', () => {
        cancelMotion();
        setPlayerState('paused');
        planeRef.current?.setLatLng(point);
        if (index === 0) {
          setLegIndex(0);
          setArrivalIndex(-1);
          onStoryStop(-1);
        } else {
          setArrivalIndex(index - 1);
          onStoryStop(index - 1);
          setLegIndex(index);
        }
        map.setView(point, index === 0 ? 5 : 6, { animate: true });
      });
    });

    if (fitNonce > 0 || playerState === 'idle') {
      map.fitBounds(L.latLngBounds(points), { padding: [46, 46], maxZoom: 5, animate: true });
    }
  }, [status, item, points, names, legIndex, playerState, arrivalIndex, fitNonce, onStoryStop]);

  useEffect(() => {
    if (arrivalIndex == null || !mapRef.current) return;
    const pointIndex = arrivalIndex === -1 ? 0 : arrivalIndex >= cityCount ? points.length - 1 : arrivalIndex + 1;
    const target = points[pointIndex];
    if (target) mapRef.current.setView(target, arrivalIndex === -1 || arrivalIndex >= cityCount ? 5 : 6, { animate: true });
  }, [arrivalIndex, cityCount, points]);

  useEffect(() => {
    if (playerState !== 'playing' || status !== 'ready' || !planeRef.current || points.length < 2) return;
    if (legIndex >= points.length - 1) {
      setPlayerState('complete');
      return;
    }

    setArrivalIndex(null);
    onStoryStop(null);

    const from = points[legIndex];
    const to = points[legIndex + 1];
    const startProgress = progressRef.current;
    const duration = reduceMotion ? 1 : 3100;
    const startedAt = performance.now();
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled || !planeRef.current) return;
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const eased = reduceMotion ? 1 : 0.5 - Math.cos(elapsed * Math.PI) / 2;
      const progress = startProgress + (1 - startProgress) * eased;
      progressRef.current = progress;
      planeRef.current.setLatLng(interpolate(from, to, progress));

      if (elapsed < 1) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }

      progressRef.current = 0;
      const reachedFinalOrigin = legIndex + 1 === points.length - 1;
      const reachedStop = reachedFinalOrigin ? cityCount : legIndex;
      setArrivalIndex(reachedStop);
      onStoryStop(reachedStop);

      if (reachedFinalOrigin) {
        setPlayerState('complete');
        return;
      }

      waitRef.current = window.setTimeout(() => {
        if (cancelled) return;
        setArrivalIndex(null);
        onStoryStop(null);
        setLegIndex((value) => value + 1);
      }, reduceMotion ? 900 : 2300);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (waitRef.current) window.clearTimeout(waitRef.current);
    };
  }, [playerState, status, legIndex, points, cityCount, reduceMotion, onStoryStop]);

  function startOrResume() {
    if (!points.length || status !== 'ready') return;
    if (playerState === 'complete') {
      resetPlane(true);
      return;
    }
    setArrivalIndex(null);
    onStoryStop(null);
    setPlayerState('playing');
  }

  function pause() {
    cancelMotion();
    setPlayerState('paused');
  }

  function replay() {
    resetPlane(true);
  }

  function pointIndexFromArrival(): number {
    if (arrivalIndex === -1) return 0;
    if (arrivalIndex == null) return Math.max(0, Math.min(legIndex, points.length - 1));
    return arrivalIndex >= cityCount ? points.length - 1 : arrivalIndex + 1;
  }

  function moveToPoint(pointIndex: number) {
    if (!points.length || !mapRef.current) return;
    cancelMotion();
    const safeIndex = Math.max(0, Math.min(pointIndex, points.length - 1));
    const target = points[safeIndex];
    planeRef.current?.setLatLng(target);
    progressRef.current = 0;
    setPlayerState(safeIndex === points.length - 1 ? 'complete' : 'paused');

    if (safeIndex === 0) {
      setLegIndex(0);
      setArrivalIndex(-1);
      onStoryStop(-1);
    } else if (safeIndex === points.length - 1) {
      setLegIndex(points.length - 1);
      setArrivalIndex(cityCount);
      onStoryStop(cityCount);
    } else {
      setLegIndex(safeIndex);
      setArrivalIndex(safeIndex - 1);
      onStoryStop(safeIndex - 1);
    }
    mapRef.current.setView(target, safeIndex === 0 || safeIndex === points.length - 1 ? 5 : 6, { animate: true });
  }

  const currentPoint = pointIndexFromArrival();
  const canGoPrevious = currentPoint > 0;
  const canGoNext = currentPoint < points.length - 1;
  const isStart = arrivalIndex === -1;
  const isReturn = arrivalIndex != null && arrivalIndex >= cityCount;
  const arrivalMeta = arrivalIndex == null || isStart || isReturn ? null : destinationMeta(item, arrivalIndex);
  const arrivalName = arrivalIndex == null
    ? ''
    : isStart || isReturn
      ? names[0]
      : arrivalMeta?.city || names[arrivalIndex + 1];
  const storyImage = isStart || isReturn ? curatedImage(names[0]) : arrivalMeta?.image || null;

  return (
    <section className="gv-story-map-shell gv-story-map-shell--r4" aria-label="Animated multi-city route map">
      <div className="gv-story-map-head">
        <div>
          <p>JOURNEY MAP</p>
          <h2>{names.join(' → ')}</h2>
        </div>
        <div className="gv-story-map-controls">
          <button type="button" onClick={() => moveToPoint(currentPoint - 1)} disabled={!canGoPrevious}>← Previous</button>
          {playerState === 'playing' ? (
            <button type="button" className="is-primary" onClick={pause}>Pause</button>
          ) : (
            <button type="button" className="is-primary" onClick={startOrResume}>{playerState === 'complete' ? 'Play again' : 'Resume'}</button>
          )}
          <button type="button" onClick={() => moveToPoint(currentPoint + 1)} disabled={!canGoNext}>Next →</button>
          <button type="button" onClick={replay}>Replay</button>
          <button type="button" onClick={() => setFitNonce((value) => value + 1)}>Fit route</button>
        </div>
      </div>

      <div className="gv-story-map-wrap">
        <div ref={containerRef} className="gv-story-map-canvas" />
        {status === 'loading' ? <div className="gv-story-map-status">Loading journey map…</div> : null}
        {status === 'error' ? (
          <div className="gv-story-map-status gv-story-map-status--error">
            <strong>Map unavailable</strong>
            <span>The selected route and budget summary are still available.</span>
          </div>
        ) : null}

        {arrivalIndex != null ? (
          <article className={`gv-story-arrival-card${isStart ? ' is-start' : ''}${isReturn ? ' is-return' : ''}`} role="status" aria-live="polite">
            <div className={`gv-story-arrival-card__media${storyImage ? '' : ' is-fallback'}`}>
              {storyImage ? <img src={storyImage} alt={`${arrivalName} destination`} /> : <span>{arrivalName.slice(0, 1)}</span>}
              <small>{isStart ? 'STARTING POINT' : isReturn ? 'JOURNEY COMPLETE' : `ARRIVED · STOP ${arrivalIndex + 1}`}</small>
            </div>
            <div className="gv-story-arrival-card__body">
              <p>{isStart ? 'YOUR JOURNEY BEGINS' : isReturn ? 'RETURN HOME' : arrivalMeta?.country || 'DESTINATION'}</p>
              <h3>{arrivalName}</h3>
              {!isStart && !isReturn && arrivalMeta?.nights ? <strong>{arrivalMeta.nights} night{arrivalMeta.nights === 1 ? '' : 's'}</strong> : null}
              <span>{isStart ? 'Globevoy has your route ready.' : isReturn ? 'You are back where the journey began.' : item.evidence.label}</span>
            </div>
          </article>
        ) : null}

        <div className="gv-story-map-key" aria-hidden="true">
          <span><i />Route</span>
          <span><b>✈</b>{playerState === 'playing' ? 'Flying' : playerState === 'paused' ? 'Paused' : playerState === 'complete' ? 'Journey complete' : 'Starting shortly'}</span>
        </div>
      </div>
    </section>
  );
}
