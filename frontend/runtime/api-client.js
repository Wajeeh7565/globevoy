// Globevoy frontend API client.
// This file never stores private provider keys. It only calls Globevoy's own backend.
(function () {
  function config() {
    return (typeof window.GLOBEVOY_CONFIG === 'object' && window.GLOBEVOY_CONFIG) || {};
  }

  function baseUrl() {
    return String(config().apiBaseUrl || '').trim().replace(/\/+$/, '');
  }

  function isConfigured() {
    return Boolean(config().enableLiveApi && baseUrl());
  }

  function buildUrl(path, params) {
    const url = new URL(baseUrl() + path);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
    return url.toString();
  }

  async function fetchJson(url, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (error) {
        throw new Error('Backend returned non-JSON response.');
      }
      if (!response.ok || payload.ok === false) {
        let message = 'Backend recommendation request failed.';
        if (payload && payload.error) {
          if (typeof payload.error === 'string') message = payload.error;
          else if (payload.error.message) message = payload.error.message;
          else if (payload.error.code) message = payload.error.code;
        } else if (payload && payload.message) {
          message = String(payload.message);
        } else if (payload && payload.reason) {
          message = String(payload.reason);
        }
        throw new Error(message);
      }
      return payload;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function getRecommendations(params) {
    if (!isConfigured()) throw new Error('Live API is not configured.');
    const timeoutMs = Number(config().apiTimeoutMs || 9000);
    return fetchJson(buildUrl('/api/recommendations', params), timeoutMs);
  }

  // Demo preview of the fare-map optimizer: only when the page URL itself has
  // farePreview=1 (the backend also needs ENABLE_FARE_MAP_OPTIMIZER_PREVIEW).
  function withFarePreview(params) {
    try {
      const flag = new URLSearchParams(window.location.search).get('farePreview');
      if (flag === '1') return { ...(params || {}), farePreview: '1' };
    } catch (_) {}
    return params;
  }

  async function getGeneratedTour(params) {
    if (!isConfigured()) throw new Error('Live API is not configured.');
    // Trip searches price flights and hotels live and can take 20-50 s; the general
    // API timeout (20 s) cut them off and the page showed no trips.
    const timeoutMs = Number(config().generatedTourTimeoutMs || 55000);
    return fetchJson(buildUrl('/api/generated-tour', withFarePreview(params)), timeoutMs);
  }

  async function getGeneratedTourControl(params) {
    if (!isConfigured()) throw new Error('Live API is not configured.');
    const timeoutMs = Number(config().apiTimeoutMs || 12000);
    return fetchJson(buildUrl('/api/generated-tour-control', params), timeoutMs);
  }

  // GV-DATA-701C — read-only worldwide-registry frontend contract.
  // This does not change autocomplete, destination activation, ranking, pricing,
  // or generated-tour behavior. It only exposes the staging-backed 701B data
  // surface to future frontend consumers.
  async function getWorldwideCityRegistry(params) {
    if (config().worldwideRegistryEnabled === false) throw new Error('Worldwide city search is unavailable on this website.');
    if (!isConfigured()) throw new Error('Live API is not configured.');
    const timeoutMs = Number(config().apiTimeoutMs || 9000);
    return fetchJson(buildUrl('/api/worldwide-city-registry', params), timeoutMs);
  }

  async function searchWorldwideCities(params) {
    return getWorldwideCityRegistry(params || {});
  }

  async function resolveWorldwideCity(input, countryCode) {
    const value = String(input || '').trim();
    if (!value) throw new Error('Worldwide city resolution requires a city or airport.');
    return getWorldwideCityRegistry({ resolve: value, countryCode: String(countryCode || '').trim().toUpperCase() });
  }

  async function recalculateGeneratedTourDate(payload) {
    if (!isConfigured()) throw new Error('Live API is not configured.');
    const timeoutMs = Number(config().apiTimeoutMs || 18000);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(baseUrl() + '/api/generated-tour-date', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error('Backend returned non-JSON response.'); }
      if (!response.ok || data.ok === false) throw new Error(typeof data.error === 'string' ? data.error : (data.message || data.reason || 'Date recalculation failed.'));
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function checkTravelEntry(payload) {
    if (!isConfigured()) throw new Error('Live API is not configured.');
    const timeoutMs = Number(config().apiTimeoutMs || 12000);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(baseUrl() + '/api/travel-entry-eligibility', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error('Backend returned non-JSON response.'); }
      if (!response.ok || data.ok === false) throw new Error(typeof data.error === 'string' ? data.error : (data.message || data.reason || 'Travel entry check failed.'));
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function getDuffelSandboxStatus() {
    if (!isConfigured()) throw new Error('Live API is not configured.');
    const timeoutMs = Number(config().apiTimeoutMs || 12000);
    return fetchJson(buildUrl('/api/duffel-sandbox-proof'), timeoutMs);
  }

  async function runDuffelSandboxProof(payload) {
    if (!isConfigured()) throw new Error('Live API is not configured.');
    const timeoutMs = Number(config().apiTimeoutMs || 30000);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(baseUrl() + '/api/duffel-sandbox-proof', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch (_) { throw new Error('Backend returned non-JSON response.'); }
      if (!response.ok || data.ok === false) throw new Error(typeof data.error === 'string' ? data.error : (data.message || data.reason || 'Duffel sandbox proof failed.'));
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function getMultiCityTours(params) {
    if (!isConfigured()) throw new Error('Live API is not configured.');
    const timeoutMs = Number(config().apiTimeoutMs || 9000);
    return fetchJson(buildUrl('/api/multicity-tours', params), timeoutMs);
  }

  // GV-ANALYTICS-9A: recommendation feedback. A beacon with a plain-text body (no
  // preflight), fire and forget: it never blocks, slows or breaks the page.
  function sendTripFeedback(payload) {
    try {
      if (!isConfigured() || !payload) return false;
      const url = baseUrl() + '/api/trip-feedback';
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return true;
      fetch(url, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } }).catch(() => {});
      return true;
    } catch (_) { return false; }
  }

  window.GlobevoyApi = {
    isConfigured,
    sendTripFeedback,
    getRecommendations,
    getGeneratedTour,
    getGeneratedTourControl,
    getWorldwideCityRegistry,
    searchWorldwideCities,
    resolveWorldwideCity,
    recalculateGeneratedTourDate,
    checkTravelEntry,
    getDuffelSandboxStatus,
    runDuffelSandboxProof,
    getMultiCityTours,
    worldwideRegistryContractVersion: 'GV-DATA-701C'
  };
})();
