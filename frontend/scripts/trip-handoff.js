// GV-WEB-3 — reads the trip the results page handed over, for the itinerary and booking pages.
//
// Order: the same-tab window.name handoff, the snapshot saved in this browser, the
// tab's current trip, then (for shared links) the backend's restore of the saved
// stops. Signed quote checks stay in GlobevoyJourneyQuote; nothing here prices a trip.
(function (root) {
  'use strict';
  const SNAPSHOT_PREFIX = 'globevoy.generated.snapshot.v1.';
  const SESSION_KEY = 'globevoy.multi.selected.v1';
  const WINDOW_PREFIX = 'globevoy.trip.handoff.v1:';

  const params = () => new URLSearchParams(root.location?.search || '');
  const hasCities = t => Boolean(t && Array.isArray(t.cities) && t.cities.length);
  const safeDate = v => { const s = String(v || '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; };

  function fromWindow(wanted) {
    try {
      const raw = String(root.name || '');
      if (!raw.startsWith(WINDOW_PREFIX)) return null;
      const parsed = JSON.parse(raw.slice(WINDOW_PREFIX.length));
      if (wanted && parsed?.id && String(parsed.id) !== wanted) return null;
      root.name = '';
      return hasCities(parsed?.tour) ? parsed.tour : null;
    } catch (_) { return null; }
  }
  function fromSnapshot(id) {
    if (!id) return null;
    try { const parsed = JSON.parse(root.localStorage.getItem(SNAPSHOT_PREFIX + id) || 'null'); return hasCities(parsed?.tour) ? parsed.tour : null; } catch (_) { return null; }
  }
  function fromSession() {
    try { const parsed = JSON.parse(root.sessionStorage.getItem(SESSION_KEY) || 'null'); return hasCities(parsed) ? parsed : null; } catch (_) { return null; }
  }

  function readTour(q = params()) {
    const id = String(q.get('snapshot') || '').trim();
    return fromWindow(id) || fromSnapshot(id) || fromSession();
  }

  async function restoreTour(q = params()) {
    const api = root.GlobevoyApi;
    if (!q.get('savedStops') && !q.get('savedStopRefs')) return null;
    if (!api?.getGeneratedTourControl || !api.isConfigured?.()) return null;
    const p = {};
    q.forEach((value, key) => { if (key !== 'generated' && key !== 'multi') p[key] = value; });
    p.action = 'restore';
    p.currentStops = q.get('savedStops') || '';
    p.currentStopRefs = q.get('savedStopRefs') || '';
    p.variant = q.get('snapshot') || q.get('variant') || 'saved-route';
    const departure = safeDate(q.get('savedDepartureDate') || q.get('departureDate'));
    if (departure) { p.departureDate = departure; p.currentDepartureDate = departure; p.preserveDates = 'true'; }
    const payload = await api.getGeneratedTourControl(p);
    if (!payload || payload.supported === false) return null;
    const tour = payload.tour || (Array.isArray(payload.tours) ? payload.tours[0] : null);
    return hasCities(tour) ? tour : null;
  }

  function remember(tour) {
    try { root.sessionStorage.setItem(SESSION_KEY, JSON.stringify(tour)); } catch (_) { /* storage full or blocked */ }
  }

  async function load(q = params()) {
    let tour = readTour(q);
    if (!tour) { try { tour = await restoreTour(q); } catch (_) { tour = null; } }
    if (tour) remember(tour);
    return tour;
  }

  const api = { SNAPSHOT_PREFIX, SESSION_KEY, readTour, restoreTour, load, remember, safeDate };
  root.GlobevoyTripHandoff = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
