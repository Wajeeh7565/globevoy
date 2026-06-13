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
        throw new Error(payload.error || 'Backend recommendation request failed.');
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

  window.GlobevoyApi = {
    isConfigured,
    getRecommendations
  };
})();
