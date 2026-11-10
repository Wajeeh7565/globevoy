/* GV-ACCOUNT-705C — secure saved-trip browser client for staging. */
(function () {
  'use strict';

  if (window.GlobevoySavedTrips705C) return;

  const VERSION = 'GV-ACCOUNT-705C';
  const ROUTE = '/api/saved-trips';
  const MULTI_STORAGE = 'globevoy.multi.selected.v1';
  const MULTI_SNAPSHOT_PREFIX = 'globevoy.generated.snapshot.v1.';
  const SINGLE_STORAGE = 'gv-selected-offer';
  const pageCloudState = { loaded: false, saving: false, tripId: null, version: null, clientSaveKey: null };

  function config() { return window.GLOBEVOY_AUTH_CONFIG || null; }
  function session() { return window.GlobevoyAuth705B?.getSession?.() || null; }
  function enabled() {
    const cfg = config();
    return Boolean(cfg?.enabled === true && cfg?.apiBaseUrl && window.GlobevoyAuth705B);
  }
  function safeJson(raw, fallback = null) {
    try { return raw ? JSON.parse(raw) : fallback; } catch (_) { return fallback; }
  }
  function stored(key, area = window.sessionStorage) {
    try { return safeJson(area.getItem(key), null); } catch (_) { return null; }
  }
  function clean(value) { return String(value == null ? '' : value).trim(); }
  function number(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  function localPath() { return `${location.pathname.split('/').pop() || 'index.html'}${location.search}`; }
  function statusNode() { return document.getElementById('gv-saved-trips-status') || document.getElementById('gv-account-status'); }
  function announce(message, kind = '') {
    const node = statusNode();
    if (!node) return;
    node.textContent = message || '';
    node.dataset.kind = kind;
  }

  async function parseResponse(response) {
    let body = null;
    try { body = await response.json(); } catch (_) {}
    if (!response.ok) {
      const error = new Error(body?.error || `saved-trips-http-${response.status}`);
      error.status = response.status;
      error.payload = body;
      throw error;
    }
    return body || {};
  }

  async function request(method = 'GET', options = {}) {
    const current = session();
    if (!enabled() || !current?.accessToken) {
      const error = new Error('sign-in-required');
      error.status = 401;
      throw error;
    }
    const cfg = config();
    const url = new URL(`${cfg.apiBaseUrl}${ROUTE}`);
    if (options.tripId) url.searchParams.set('tripId', options.tripId);
    const fetchOptions = {
      method,
      headers: { Authorization: `Bearer ${current.accessToken}` },
      cache: 'no-store',
      credentials: 'omit'
    };
    if (options.body !== undefined) {
      fetchOptions.headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(options.body);
    }
    const response = await fetch(url.toString(), fetchOptions);
    if (response.status === 401) {
      window.GlobevoyAuth705B?.clearSession?.();
    }
    return parseResponse(response);
  }

  const api = Object.freeze({
    list: async () => (await request('GET')).trips || [],
    get: async (tripId) => (await request('GET', { tripId })).trip || null,
    create: async (payload) => (await request('POST', { body: payload })).trip || null,
    update: async (tripId, payload) => (await request('PUT', { tripId, body: payload })).trip || null,
    remove: async (tripId) => request('DELETE', { tripId })
  });

  function singleSnapshot() {
    const q = new URLSearchParams(location.search);
    const offer = stored(SINGLE_STORAGE) || {};
    const city = clean(q.get('city') || offer.city);
    const country = clean(q.get('country') || offer.country);
    if (!city) return null;
    const origin = clean(q.get('origin'));
    const code = clean(q.get('code') || offer.code).toUpperCase();
    const nights = Math.max(1, number(q.get('nights') || offer.nights, 5));
    const currency = clean(q.get('currency') || 'CAD').toUpperCase();
    const clientSaveKey = ['single', origin.toLowerCase(), code || city.toLowerCase(), nights, currency, clean(q.get('departureDate')), clean(q.get('returnDate'))].join('|');
    return {
      clientSaveKey,
      name: [city, country].filter(Boolean).join(', '),
      body: {
        name: [city, country].filter(Boolean).join(', '),
        status: 'planned',
        tripSnapshot: {
          schemaVersion: 1,
          kind: 'single',
          clientSaveKey,
          sourceUrl: localPath(),
          origin,
          city,
          country,
          code,
          nights,
          travellers: Math.max(1, number(q.get('passengers'), 1)),
          currency,
          label: clean(q.get('label') || offer._label || 'Recommended trip'),
          offer: {
            city,
            country,
            code,
            lat: number(offer.lat, null),
            lng: number(offer.lng, null),
            img: clean(offer.img),
            themes: Array.isArray(offer.themes) ? offer.themes.slice(0, 12) : [],
            why: clean(offer.why || offer.whyItFits)
          }
        },
        providerRefs: {},
        priceSnapshot: {
          currency,
          totalBudget: number(q.get('budget')),
          reserve: number(q.get('reserve')),
          flightEstimate: number(q.get('flight') || offer.flight),
          stayEstimate: number(q.get('stay') || offer.stay),
          tripEstimate: number(q.get('total') || offer.total),
          remaining: number(q.get('remaining') || offer.remaining),
          capturedAt: new Date().toISOString()
        },
        travelerProfileRef: null
      }
    };
  }

  function readMultiEnvelopeFromLocation() {
    const q = new URLSearchParams(location.search);
    const snapshotId = clean(q.get('snapshot'));
    if (snapshotId) {
      const envelope = stored(`${MULTI_SNAPSHOT_PREFIX}${snapshotId}`, window.localStorage);
      if (envelope?.tour) return { snapshotId, tour: envelope.tour };
    }
    const tour = stored(MULTI_STORAGE);
    return tour ? { snapshotId, tour } : null;
  }

  function multiSnapshot() {
    const envelope = readMultiEnvelopeFromLocation();
    const tour = envelope?.tour;
    if (!tour || !Array.isArray(tour.cities) || !tour.cities.length) return null;
    const q = new URLSearchParams(location.search);
    const cities = tour.cities.map((city) => ({
      id: clean(city.id || city.cityId),
      city: clean(city.city),
      country: clean(city.country),
      code: clean(city.code || city.airportCode).toUpperCase(),
      nights: number(city.nights)
    }));
    const origin = clean(tour.origin?.city || q.get('origin'));
    const currency = clean(tour.budget?.total?.currency || q.get('currency') || 'CAD').toUpperCase();
    const routeId = clean(tour.routeId || tour.tourId || q.get('routeId'));
    const clientSaveKey = ['multi', routeId || origin.toLowerCase(), cities.map(c => c.id || c.code || c.city.toLowerCase()).join('>'), clean(q.get('departureDate') || tour.departureDate), currency].join('|');
    const title = clean(tour.title) || cities.map(c => c.city).filter(Boolean).join(' + ') || 'Multi-city trip';
    return {
      clientSaveKey,
      name: title,
      body: {
        name: title,
        status: 'planned',
        tripSnapshot: {
          schemaVersion: 1,
          kind: 'multi',
          clientSaveKey,
          sourceUrl: localPath(),
          snapshotId: envelope.snapshotId || null,
          routeId: routeId || null,
          origin,
          cities,
          tour
        },
        providerRefs: {},
        priceSnapshot: {
          currency,
          totalBudget: number(tour.budget?.total?.amount || q.get('budget')),
          tripEstimate: number(tour.budget?.estimatedCoreTotal?.amount || tour.displayBudget?.tripEstimate || tour.estimatedTotalUsd),
          capturedAt: new Date().toISOString()
        },
        travelerProfileRef: null
      }
    };
  }

  function currentPageSnapshot() {
    if (document.getElementById('gv-save-trip') || document.body?.classList.contains('gv-trip-page')) return singleSnapshot();
    if (document.getElementById('mcv-save-trip') || document.body?.classList.contains('gv-mcv-page')) return multiSnapshot();
    return null;
  }

  function pageButtons() {
    return [document.getElementById('gv-save-trip'), document.getElementById('gv-summary-save'), document.getElementById('mcv-save-trip')].filter(Boolean);
  }

  function setButtonState(saved, busy = false) {
    pageButtons().forEach((button) => {
      button.disabled = Boolean(busy);
      button.setAttribute('aria-busy', String(Boolean(busy)));
      button.setAttribute('aria-pressed', String(Boolean(saved)));
      if (button.id === 'gv-save-trip') button.textContent = saved ? '♥ Saved to account' : '♡ Save trip';
      else if (button.id === 'gv-summary-save') button.textContent = saved ? 'Saved to account' : 'Save trip';
      else if (button.id === 'mcv-save-trip') button.textContent = saved ? 'Saved to account ✓' : 'Save';
    });
  }

  async function findCloudMatch(snapshot) {
    if (!snapshot || !session()) return null;
    const trips = await api.list();
    return trips.find((trip) => trip?.tripSnapshot?.clientSaveKey === snapshot.clientSaveKey) || null;
  }

  async function refreshPageSaveState() {
    if (!pageButtons().length || !session()) return null;
    const snapshot = currentPageSnapshot();
    if (!snapshot) return null;
    try {
      const match = await findCloudMatch(snapshot);
      pageCloudState.loaded = true;
      pageCloudState.tripId = match?.tripId || null;
      pageCloudState.version = match?.version || null;
      pageCloudState.clientSaveKey = snapshot.clientSaveKey;
      setButtonState(Boolean(match));
      return match;
    } catch (_) {
      return null;
    }
  }

  async function toggleCurrentPageCloudSave(options = {}) {
    if (pageCloudState.saving) return;
    if (!session()) return;
    pageCloudState.saving = true;
    setButtonState(Boolean(pageCloudState.tripId), true);
    try {
      // Multi-city's pre-existing explicit save builds the authoritative local
      // snapshot first. Read it on the next task before persisting to the account.
      if (options.afterExistingLocalSave) await new Promise(resolve => setTimeout(resolve, 0));
      const snapshot = currentPageSnapshot();
      if (!snapshot) throw new Error('trip-snapshot-unavailable');
      let match = null;
      if (pageCloudState.clientSaveKey === snapshot.clientSaveKey && pageCloudState.tripId) {
        match = { tripId: pageCloudState.tripId };
      } else {
        match = await findCloudMatch(snapshot);
      }
      if (match?.tripId) {
        await api.remove(match.tripId);
        pageCloudState.tripId = null;
        pageCloudState.version = null;
        pageCloudState.clientSaveKey = snapshot.clientSaveKey;
        setButtonState(false);
        announce('Removed from your Globevoy account.', 'success');
      } else {
        const created = await api.create(snapshot.body);
        pageCloudState.tripId = created?.tripId || null;
        pageCloudState.version = created?.version || 1;
        pageCloudState.clientSaveKey = snapshot.clientSaveKey;
        setButtonState(true);
        announce('Saved privately to your Globevoy account. Prices will be checked again before booking.', 'success');
      }
    } catch (error) {
      setButtonState(Boolean(pageCloudState.tripId));
      if (error?.message === 'sign-in-required' || error?.status === 401) announce('Sign in again to save this trip to your account.', 'error');
      else announce('We could not update your saved trips right now. Your trip itself is unchanged.', 'error');
    } finally {
      pageCloudState.saving = false;
      pageButtons().forEach(button => { button.disabled = false; button.setAttribute('aria-busy', 'false'); });
    }
  }

  function installSaveInterception() {
    // Single-trip legacy save is localStorage-only. When signed in, intercept it
    // and use the secure owner-private API instead. Signed-out behavior remains
    // unchanged, preserving guest planning without silently uploading anything.
    document.addEventListener('click', (event) => {
      const button = event.target.closest('#gv-save-trip, #gv-summary-save, #mcv-save-trip');
      if (!button || !session()) return;
      if (button.id === 'mcv-save-trip') {
        // Allow the existing explicit multi-city save to serialize the currently
        // active route, then copy that user-requested snapshot to the private API.
        setTimeout(() => toggleCurrentPageCloudSave({ afterExistingLocalSave: true }), 0);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleCurrentPageCloudSave();
    }, true);
  }

  function sameOriginTripPath(value) {
    const raw = clean(value);
    if (!raw) return '';
    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return '';
      const name = url.pathname.split('/').pop();
      if (!['trip.html', 'multicity-visualizer.html', 'multi-city-trip.html'].includes(name)) return '';
      return `${name}${url.search}`;
    } catch (_) { return ''; }
  }

  function seedTripForOpen(trip) {
    const snapshot = trip?.tripSnapshot || {};
    if (snapshot.kind === 'single' && snapshot.offer) {
      try { sessionStorage.setItem(SINGLE_STORAGE, JSON.stringify(snapshot.offer)); } catch (_) {}
    }
    if (snapshot.kind === 'multi' && snapshot.tour) {
      try { sessionStorage.setItem(MULTI_STORAGE, JSON.stringify(snapshot.tour)); } catch (_) {}
      if (snapshot.snapshotId) {
        try {
          localStorage.setItem(`${MULTI_SNAPSHOT_PREFIX}${snapshot.snapshotId}`, JSON.stringify({
            version: VERSION,
            savedAt: new Date().toISOString(),
            tour: snapshot.tour
          }));
        } catch (_) {}
      }
    }
    return sameOriginTripPath(snapshot.sourceUrl);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  }
  function formatDate(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return 'Saved trip';
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
  }
  function tripSummary(trip) {
    const snapshot = trip?.tripSnapshot || {};
    if (snapshot.kind === 'single') return [snapshot.origin, snapshot.city].filter(Boolean).join(' → ') || trip.name;
    if (snapshot.kind === 'multi') return [snapshot.origin, ...(snapshot.cities || []).map(city => city.city).filter(Boolean), snapshot.origin].filter(Boolean).join(' → ') || trip.name;
    return trip.name || 'Saved trip';
  }
  function priceSummary(trip) {
    const price = trip?.priceSnapshot || {};
    const amount = number(price.tripEstimate, 0);
    const currency = clean(price.currency || 'CAD');
    if (!amount) return 'Price needs verification';
    try { return new Intl.NumberFormat('en-CA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount); }
    catch (_) { return `${currency} ${Math.round(amount)}`; }
  }

  async function renderMyTrips() {
    const root = document.getElementById('gv-my-trips-list');
    const signedOut = document.getElementById('gv-my-trips-signed-out');
    const loading = document.getElementById('gv-my-trips-loading');
    if (!root) return;
    if (!session()) {
      if (loading) loading.hidden = true;
      if (signedOut) signedOut.hidden = false;
      root.hidden = true;
      return;
    }
    if (signedOut) signedOut.hidden = true;
    try {
      const trips = await api.list();
      if (loading) loading.hidden = true;
      root.hidden = false;
      if (!trips.length) {
        root.innerHTML = '<div class="gv-my-trips-empty"><h2>No saved trips yet</h2><p>Open a trip and choose Save trip. It will appear here under your signed-in account.</p><a href="index.html">Plan a trip</a></div>';
        return;
      }
      root.innerHTML = trips.map((trip) => `
        <article class="gv-saved-trip-card" data-trip-id="${escapeHtml(trip.tripId)}">
          <div class="gv-saved-trip-card__main">
            <span class="gv-saved-trip-card__type">${escapeHtml(trip.tripSnapshot?.kind === 'multi' ? 'Multi-city trip' : 'Single destination')}</span>
            <h2>${escapeHtml(trip.name || 'Saved trip')}</h2>
            <p>${escapeHtml(tripSummary(trip))}</p>
            <div class="gv-saved-trip-card__meta"><span>${escapeHtml(priceSummary(trip))}</span><span>Updated ${escapeHtml(formatDate(trip.updatedAt))}</span></div>
            <p class="gv-saved-trip-card__trust">Saved prices are snapshots. Globevoy will require fresh provider verification before booking.</p>
          </div>
          <div class="gv-saved-trip-card__actions">
            <button type="button" data-gv-open-saved>Open trip</button>
            <button type="button" data-gv-delete-saved>Delete</button>
          </div>
        </article>`).join('');
      root.querySelectorAll('[data-gv-open-saved]').forEach(button => button.addEventListener('click', () => {
        const card = button.closest('[data-trip-id]');
        const trip = trips.find(item => item.tripId === card?.dataset.tripId);
        const path = seedTripForOpen(trip);
        if (path) location.assign(path);
        else announce('This saved trip cannot be reopened safely from this page.', 'error');
      }));
      root.querySelectorAll('[data-gv-delete-saved]').forEach(button => button.addEventListener('click', async () => {
        const card = button.closest('[data-trip-id]');
        const tripId = card?.dataset.tripId;
        if (!tripId) return;
        button.disabled = true;
        try {
          await api.remove(tripId);
          card.remove();
          announce('Saved trip deleted from your account.', 'success');
          if (!root.querySelector('[data-trip-id]')) await renderMyTrips();
        } catch (_) {
          button.disabled = false;
          announce('We could not delete that saved trip right now.', 'error');
        }
      }));
    } catch (error) {
      if (loading) loading.hidden = true;
      root.hidden = false;
      root.innerHTML = '<div class="gv-my-trips-empty"><h2>Saved trips are temporarily unavailable</h2><p>Your account is unchanged. Try again in a moment.</p></div>';
      announce(error?.status === 401 ? 'Sign in again to view your saved trips.' : 'Saved trips could not be loaded.', 'error');
    }
  }

  async function initialize() {
    if (!enabled()) return;
    installSaveInterception();
    if (document.getElementById('gv-my-trips-list')) await renderMyTrips();
    else if (pageButtons().length && session()) setTimeout(refreshPageSaveState, 100);
  }

  window.GlobevoySavedTrips705C = Object.freeze({
    version: VERSION,
    enabled,
    api,
    currentPageSnapshot,
    refreshPageSaveState,
    renderMyTrips,
    seedTripForOpen,
    _internal: Object.freeze({ singleSnapshot, multiSnapshot, sameOriginTripPath })
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
