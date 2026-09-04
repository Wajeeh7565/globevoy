'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveOrigin } from '@/lib/origin-options-710c';
import type { RecommendationCardModel, ResultsSearch } from '@/lib/recommendations-708a';

type LatLng = [number, number];

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
  on?: (event: string, handler: () => void) => LeafletLayer;
};

type LeafletNamespace = {
  map: (element: HTMLElement, options?: Record<string, unknown>) => LeafletMap;
  tileLayer: (url: string, options?: Record<string, unknown>) => LeafletLayer;
  layerGroup: () => LeafletLayerGroup;
  polyline: (positions: LatLng[], options?: Record<string, unknown>) => LeafletLayer;
  marker: (position: LatLng, options?: Record<string, unknown>) => LeafletLayer;
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

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pointFromRaw(raw: RecommendationCardModel['raw']): LatLng | null {
  const lat = finite(raw.lat ?? raw.latitude);
  const lng = finite(raw.lng ?? raw.longitude);
  return lat == null || lng == null ? null : [lat, lng];
}

function originPoint(search: ResultsSearch): LatLng | null {
  const origin = resolveOrigin(search.originCode || search.rawOrigin);
  return origin ? [origin.latitude, origin.longitude] : null;
}

function routePoints(item: RecommendationCardModel, search: ResultsSearch): LatLng[] {
  const origin = originPoint(search);
  if (item.kind === 'single') {
    const destination = pointFromRaw(item.raw);
    return [origin, destination].filter(Boolean) as LatLng[];
  }

  const stops = (item.cities || [])
    .map((city) => Number.isFinite(city.lat) && Number.isFinite(city.lng) ? [Number(city.lat), Number(city.lng)] as LatLng : null)
    .filter(Boolean) as LatLng[];

  return origin ? [origin, ...stops, origin] : stops;
}

function markerHtml(item: RecommendationCardModel, active: boolean, index: number): string {
  return `<span class="gv-results-map-pin${active ? ' is-active' : ''}${item.kind === 'multi' ? ' is-multi' : ''}"><strong>${index + 1}</strong></span>`;
}

function destinationLabel(item: RecommendationCardModel): string {
  if (item.kind === 'single') return item.city || item.title;
  return (item.cities || []).map((city) => city.city).filter(Boolean).join(' → ') || item.title;
}

export function ResultsMap710D({
  items,
  search,
  activeId,
  onSelect
}: {
  items: RecommendationCardModel[];
  search: ResultsSearch;
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LeafletLayerGroup | null>(null);
  const leafletRef = useRef<LeafletNamespace | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const plottedItems = useMemo(() => items.filter((item) => routePoints(item, search).length > 0), [items, search]);

  useEffect(() => {
    let cancelled = false;
    const element = containerRef.current;
    if (!element) return;

    void loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current) return;
      leafletRef.current = L;
      const initial = originPoint(search) || [30, 0] as LatLng;
      const map = L.map(containerRef.current, { zoomControl: false, scrollWheelZoom: true, minZoom: 2, worldCopyJump: true });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      const layers = L.layerGroup().addTo(map);
      map.setView(initial, 3);
      mapRef.current = map;
      layerRef.current = layers;
      setStatus('ready');
    }).catch(() => {
      if (!cancelled) setStatus('error');
    });

    return () => {
      cancelled = true;
      layerRef.current = null;
      leafletRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [search]);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !layerRef.current || !leafletRef.current) return;
    const map = mapRef.current;
    const layer = layerRef.current;
    const L = leafletRef.current;
    layer.clearLayers();

    const allPoints: LatLng[] = [];
    const hasOrigin = Boolean(originPoint(search));

    plottedItems.forEach((item, index) => {
      const points = routePoints(item, search);
      if (!points.length) return;
      allPoints.push(...points);
      const active = item.id === activeId;

      if (points.length > 1) {
        L.polyline(points, {
          color: active ? '#089f93' : '#31556e',
          weight: active ? 5 : 3,
          opacity: active ? 0.92 : 0.35,
          dashArray: item.kind === 'multi' ? null : '7 8'
        }).addTo(layer);
      }

      const destinations = item.kind === 'single'
        ? points.slice(-1)
        : points.slice(hasOrigin ? 1 : 0, hasOrigin ? -1 : undefined);

      destinations.forEach((point, stopIndex) => {
        const icon = L.divIcon({
          className: 'gv-results-map-pin-wrap',
          html: markerHtml(item, active, item.kind === 'multi' ? stopIndex : index),
          iconSize: [36, 36],
          iconAnchor: [18, 18]
        });
        const marker = L.marker(point, { icon }).addTo(layer);
        marker.bindTooltip?.(destinationLabel(item), { direction: 'top', offset: [0, -14], opacity: 0.96 });
        marker.on?.('click', () => onSelect(item.id));
      });
    });

    const active = plottedItems.find((item) => item.id === activeId);
    const focusPoints = active ? routePoints(active, search) : [];
    const target = focusPoints.length ? focusPoints : allPoints;
    if (target.length === 1) map.setView(target[0], 6, { animate: true });
    else if (target.length > 1) map.fitBounds(L.latLngBounds(target), { padding: [48, 48], maxZoom: active ? 7 : 5, animate: true });
  }, [status, plottedItems, search, activeId, onSelect]);

  function fitAll() {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const points = plottedItems.flatMap((item) => routePoints(item, search));
    if (points.length === 1) map.setView(points[0], 5, { animate: true });
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 5, animate: true });
  }

  return (
    <section className="gv-results-map-shell" aria-label="Trip results map">
      <div className="gv-results-map-head">
        <div>
          <p>MAP VIEW</p>
          <h2>{activeId ? 'Explore the selected trip' : 'See your options geographically'}</h2>
        </div>
        <button type="button" onClick={fitAll}>Fit all</button>
      </div>
      <div className="gv-results-map-wrap">
        <div ref={containerRef} className="gv-results-map-canvas" />
        {status === 'loading' ? <div className="gv-results-map-status">Loading map…</div> : null}
        {status === 'error' ? (
          <div className="gv-results-map-status gv-results-map-status--error">
            <strong>Map unavailable</strong>
            <span>Your trip cards still contain the full recommendation data.</span>
          </div>
        ) : null}
        <div className="gv-results-map-legend" aria-hidden="true">
          <span><i className="is-selected" />Selected trip</span>
          <span><i />Other options</span>
        </div>
      </div>
    </section>
  );
}
