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
    if (!isConfigured()) {
      throw new Error('Live API is not configured.');
    }
    const timeoutMs = Number(config().apiTimeoutMs || 9000);
    const url = buildUrl('/api/recommendations', params);
    return fetchJson(url, timeoutMs);
  }


  async function getGeneratedTour(params) {
    if (!isConfigured()) {
      throw new Error('Live API is not configured.');
    }
    const timeoutMs = Number(config().apiTimeoutMs || 12000);
    const url = buildUrl('/api/generated-tour', params);
    return fetchJson(url, timeoutMs);
  }

  async function getGeneratedTourControl(params) {
    if (!isConfigured()) {
      throw new Error('Live API is not configured.');
    }
    const timeoutMs = Number(config().apiTimeoutMs || 12000);
    const url = buildUrl('/api/generated-tour-control', params);
    return fetchJson(url, timeoutMs);
  }

  async function recalculateGeneratedTourDate(payload) {
    if (!isConfigured()) {
      throw new Error('Live API is not configured.');
    }
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
    if (!isConfigured()) {
      throw new Error('Live API is not configured.');
    }
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
    if (!isConfigured()) {
      throw new Error('Live API is not configured.');
    }
    const timeoutMs = Number(config().apiTimeoutMs || 12000);
    return fetchJson(buildUrl('/api/duffel-sandbox-proof'), timeoutMs);
  }

  async function runDuffelSandboxProof(payload) {
    if (!isConfigured()) {
      throw new Error('Live API is not configured.');
    }
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
    if (!isConfigured()) {
      throw new Error('Live API is not configured.');
    }
    const timeoutMs = Number(config().apiTimeoutMs || 9000);
    const url = buildUrl('/api/multicity-tours', params);
    return fetchJson(url, timeoutMs);
  }

  window.GlobevoyApi = {
    isConfigured,
    getRecommendations,
    getGeneratedTour,
    getGeneratedTourControl,
    recalculateGeneratedTourDate,
    checkTravelEntry,
    getDuffelSandboxStatus,
    runDuffelSandboxProof,
    getMultiCityTours
  };
})();
