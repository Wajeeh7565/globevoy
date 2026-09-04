'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveOrigin } from '@/lib/origin-options-710c';
import type { RecommendationCardModel, ResultsSearch } from '@/lib/recommendations-708a';

type LatLng = [number, number];
type PlayerState = 'idle' | 'playing' | 'paused' | 'complete';

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

export function ResultsMap710D({
  item,
  search,
  focusStopIndex,
  onStoryStop
}: {
  item: RecommendationCardModel;
  search: ResultsSearch;
  focusStopIndex: number | null;
  onStoryStop: (index: number | null) => void;
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
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
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

  useEffect(() => {
    setPlayerState('idle');
    setLegIndex(0);
    setArrivalIndex(null);
    progressRef.current = 0;
    onStoryStop(null);
    if (status === 'ready' && points[0] && leafletRef.current && mapRef.current) {
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
    }
  }, [item.id, status]);

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
      const isOrigin = index === 0 || index === points.length - 1;
      if (index === points.length - 1) return;
      const label = isOrigin ? '⌂' : String(index);
      const marker = L.marker(point, { icon: markerIcon(L, label, arrivalIndex === index - 1) }).addTo(layer);
      marker.bindTooltip?.(names[index] || `Stop ${index}`, { direction: 'top', offset: [0, -12], opacity: 0.96 });
    });

    if (focusStopIndex != null && playerState !== 'playing') {
      const pointIndex = focusStopIndex < 0 ? 0 : focusStopIndex >= (item.cities || []).length ? points.length - 1 : focusStopIndex + 1;
      const target = points[pointIndex];
      if (target) map.setView(target, pointIndex === 0 || pointIndex === points.length - 1 ? 5 : 6, { animate: true });
    } else if (fitNonce > 0 || playerState === 'idle') {
      map.fitBounds(L.latLngBounds(points), { padding: [46, 46], maxZoom: 5, animate: true });
    }
  }, [status, item, points, names, legIndex, playerState, arrivalIndex, focusStopIndex, fitNonce]);

  useEffect(() => {
    if (playerState !== 'playing' || status !== 'ready' || !planeRef.current || points.length < 2) return;
    if (legIndex >= points.length - 1) {
      setPlayerState('complete');
      return;
    }

    const from = points[legIndex];
    const to = points[legIndex + 1];
    const startProgress = progressRef.current;
    const duration = reduceMotion ? 1 : 1750;
    const startedAt = performance.now();
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled || !planeRef.current) return;
      const elapsed = Math.min(1, (now - startedAt) / duration);
      const progress = startProgress + (1 - startProgress) * elapsed;
      progressRef.current = progress;
      planeRef.current.setLatLng(interpolate(from, to, progress));

      if (elapsed < 1) {
        animationRef.current = requestAnimationFrame(tick);
        return;
      }

      progressRef.current = 0;
      const reachedFinalOrigin = legIndex + 1 === points.length - 1;
      const reachedStop = reachedFinalOrigin ? (item.cities || []).length : legIndex;
      setArrivalIndex(reachedStop);
      onStoryStop(reachedStop);

      if (reachedFinalOrigin) {
        setPlayerState('complete');
        return;
      }

      waitRef.current = window.setTimeout(() => {
        if (!cancelled) setLegIndex((value) => value + 1);
      }, reduceMotion ? 320 : 720);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (waitRef.current) window.clearTimeout(waitRef.current);
    };
  }, [playerState, status, legIndex, points, item.cities, reduceMotion, onStoryStop]);

  useEffect(() => {
    if (playerState !== 'playing') return;
    if (legIndex > 0 && arrivalIndex != null) setArrivalIndex(null);
  }, [legIndex, playerState]);

  function startOrResume() {
    if (!points.length || status !== 'ready') return;
    if (playerState === 'complete') {
      replay();
      return;
    }
    setPlayerState('playing');
  }

  function pause() {
    setPlayerState('paused');
  }

  function replay() {
    if (!points.length || !leafletRef.current || !mapRef.current) return;
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    if (waitRef.current) window.clearTimeout(waitRef.current);
    setLegIndex(0);
    setArrivalIndex(null);
    progressRef.current = 0;
    onStoryStop(null);
    planeRef.current?.setLatLng(points[0]);
    setPlayerState('playing');
  }

  const arrivalName = arrivalIndex == null
    ? ''
    : arrivalIndex >= (item.cities || []).length
      ? names[names.length - 1]
      : names[arrivalIndex + 1];

  return (
    <section className="gv-story-map-shell" aria-label="Animated multi-city route map">
      <div className="gv-story-map-head">
        <div>
          <p>JOURNEY MAP</p>
          <h2>{routeNames(item, search).join(' → ')}</h2>
        </div>
        <div className="gv-story-map-controls">
          {playerState === 'playing' ? (
            <button type="button" onClick={pause}>Pause</button>
          ) : (
            <button type="button" className="is-primary" onClick={startOrResume}>{playerState === 'complete' ? 'Play again' : playerState === 'paused' ? 'Resume' : '▶ Play journey'}</button>
          )}
          {playerState !== 'idle' ? <button type="button" onClick={replay}>Replay</button> : null}
          <button type="button" onClick={() => setFitNonce((value) => value + 1)}>Fit route</button>
        </div>
      </div>

      <div className="gv-story-map-wrap">
        <div ref={containerRef} className="gv-story-map-canvas" />
        {status === 'loading' ? <div className="gv-story-map-status">Loading journey map…</div> : null}
        {status === 'error' ? (
          <div className="gv-story-map-status gv-story-map-status--error">
            <strong>Map unavailable</strong>
            <span>The route summary and journey cards still contain the recommendation.</span>
          </div>
        ) : null}

        {arrivalIndex != null ? (
          <div className="gv-story-arrival" role="status" aria-live="polite">
            <small>{arrivalIndex >= (item.cities || []).length ? 'JOURNEY COMPLETE' : `ARRIVING · STOP ${arrivalIndex + 1}`}</small>
            <strong>{arrivalName}</strong>
            <span>{arrivalIndex >= (item.cities || []).length ? 'Back where the journey began.' : 'This stop is now highlighted in your complete journey below.'}</span>
          </div>
        ) : null}

        <div className="gv-story-map-key" aria-hidden="true">
          <span><i />Route</span>
          <span><b>✈</b>Journey player</span>
        </div>
      </div>
    </section>
  );
}
