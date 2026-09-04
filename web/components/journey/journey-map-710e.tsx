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

type LeafletLayer = { addTo: (target: LeafletLayerGroup | LeafletMap) => LeafletLayer };
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
    __gvJourneyLeafletPromise?: Promise<LeafletNamespace>;
  }
}

const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

function loadLeaflet(): Promise<LeafletNamespace> {
  if (window.L) return Promise.resolve(window.L);
  if (window.__gvJourneyLeafletPromise) return window.__gvJourneyLeafletPromise;
  window.__gvJourneyLeafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${LEAFLET_JS}"]`);
    if (existing) {
      if (window.L) return resolve(window.L);
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
  return window.__gvJourneyLeafletPromise;
}

function routePoints(item: RecommendationCardModel, search: ResultsSearch): LatLng[] {
  const origin = resolveOrigin(search.originCode || search.rawOrigin);
  const start = origin ? [origin.latitude, origin.longitude] as LatLng : null;
  const stops = (item.cities || [])
    .map((city) => Number.isFinite(city.lat) && Number.isFinite(city.lng) ? [Number(city.lat), Number(city.lng)] as LatLng : null)
    .filter(Boolean) as LatLng[];
  return start ? [start, ...stops, start] : stops;
}

function pinIcon(L: LeafletNamespace, label: string, active: boolean): unknown {
  return L.divIcon({
    className: 'gv-journey-map-pin-wrap',
    html: `<span class="gv-journey-map-pin${active ? ' is-active' : ''}">${label}</span>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

export function JourneyMap710E({ item, search, activeStopIndex }: {
  item: RecommendationCardModel;
  search: ResultsSearch;
  activeStopIndex: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LeafletLayerGroup | null>(null);
  const leafletRef = useRef<LeafletNamespace | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const points = useMemo(() => routePoints(item, search), [item, search]);

  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;
    void loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current) return;
      const fallback: LatLng = points[0] || [30, 0];
      const map = L.map(containerRef.current, { zoomControl: false, minZoom: 2, worldCopyJump: true, scrollWheelZoom: false });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO', subdomains: 'abcd', maxZoom: 19
      }).addTo(map);
      L.control.zoom({ position: 'bottomright' }).addTo(map);
      map.setView(fallback, 3);
      mapRef.current = map;
      leafletRef.current = L;
      layerRef.current = L.layerGroup().addTo(map);
      setStatus('ready');
    }).catch(() => { if (!cancelled) setStatus('error'); });
    return () => {
      cancelled = true;
      layerRef.current = null;
      leafletRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (status !== 'ready' || !mapRef.current || !leafletRef.current || !layerRef.current || points.length < 2) return;
    const L = leafletRef.current;
    const map = mapRef.current;
    const layer = layerRef.current;
    layer.clearLayers();
    L.polyline(points, { color: '#0aa79d', weight: 4, opacity: 0.82 }).addTo(layer);
    points.slice(0, -1).forEach((point, index) => {
      const activePoint = activeStopIndex < 0 ? 0 : activeStopIndex + 1;
      const label = index === 0 ? '⌂' : String(index);
      L.marker(point, { icon: pinIcon(L, label, index === activePoint) }).addTo(layer);
    });
    if (activeStopIndex >= 0 && points[activeStopIndex + 1]) {
      map.setView(points[activeStopIndex + 1], 6, { animate: true });
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [34, 34], maxZoom: 5, animate: true });
    }
  }, [status, points, activeStopIndex]);

  return (
    <div className="gv-journey-map-wrap">
      <div ref={containerRef} className="gv-journey-map" />
      {status === 'loading' ? <div className="gv-journey-map-state">Loading route map…</div> : null}
      {status === 'error' ? <div className="gv-journey-map-state"><strong>Map unavailable</strong><span>Your route details are still available below.</span></div> : null}
    </div>
  );
}
