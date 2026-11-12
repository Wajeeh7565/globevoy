/* Isolated demo build only. Never included in production or staging builds. */
(function(root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.GLOBEVOY_ENVIRONMENT_POLICY = policy;
})(typeof window === 'undefined' ? globalThis : window, function() {
  function resolve(origin) {
    const allowed = typeof window !== 'undefined' && origin === window.GLOBEVOY_DEMO_ORIGIN;
    return Object.freeze({ environment: allowed ? 'development' : 'unknown',
      apiBaseUrl: allowed ? origin : '', accountsEnabled: false, auth: null,
      worldwideRegistryEnabled: false, automaticDatesEnabled: Boolean(allowed), reactEnabled: Boolean(allowed) });
  }
  return Object.freeze({ productionApi: '', stagingApi: '', stagingOrigin: '',
    stagingAuth: Object.freeze({}), resolve });
});
