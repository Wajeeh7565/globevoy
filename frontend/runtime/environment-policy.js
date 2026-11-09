/* Shared public configuration for the classic and React GlobeVoy frontends.
 * Production feature switches are injected ONLY into the approved deployment artifact.
 * These are presentation controls, not authorization; the backend must enforce access.
 */
(function (root, factory) {
  const policy = factory();
  if (typeof module === 'object' && module.exports) module.exports = policy;
  else root.GLOBEVOY_ENVIRONMENT_POLICY = policy;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const productionApi = 'https://7pibv4zp7tzx7qcyrymwsh44ta0wtrei.lambda-url.us-east-2.on.aws';
  const stagingApi = 'https://mirksnjcjim4iowstuda4lesrm0ghmfw.lambda-url.us-east-2.on.aws';
  const stagingOrigin = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
  const productionOrigins = ['https://globevoy.com', 'https://www.globevoy.com', 'https://main.dttux5e6ddtzb.amplifyapp.com'];
  const stagingAuth = Object.freeze({
    region: 'us-east-2', userPoolId: 'us-east-2_MSd9RRHD8', clientId: 'o2ohbv50253hjli5s34rbvv79',
    issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_MSd9RRHD8',
    domainBaseUrl: 'https://globevoy-stg-76bf9b233a.auth.us-east-2.amazoncognito.com'
  });

  function validProductionApi(value) {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' &&
        /^[a-z0-9-]+\.lambda-url\.us-east-2\.on\.aws$/.test(url.hostname) &&
        (url.pathname === '/' || url.pathname === '') &&
        !url.username && !url.password && !url.search && !url.hash &&
        url.origin !== stagingApi;
    } catch (_) { return false; }
  }

  function validProductionAuth(auth) {
    if (!auth || typeof auth !== 'object') return false;
    if (!/^us-east-2_[A-Za-z0-9]+$/.test(String(auth.userPoolId || '')) ||
        !/^[a-z0-9]{12,64}$/.test(String(auth.clientId || ''))) return false;
    const issuer = 'https://cognito-idp.us-east-2.amazonaws.com/' + auth.userPoolId;
    if (auth.issuer !== issuer || auth.region !== 'us-east-2') return false;
    try {
      const url = new URL(auth.domainBaseUrl);
      return url.protocol === 'https:' &&
        /^[a-z0-9-]+\.auth\.us-east-2\.amazoncognito\.com$/.test(url.hostname) &&
        url.origin === url.href.replace(/\/$/, '') &&
        url.origin !== stagingAuth.domainBaseUrl;
    } catch (_) { return false; }
  }

  function productionRelease() {
    const candidate = typeof window === 'undefined' ? null : window.GLOBEVOY_PRODUCTION_RELEASE;
    if (!candidate || candidate.environment !== 'production' || candidate.target !== 'globevoy.com') return null;
    if (!validProductionApi(candidate.apiBaseUrl)) return null;
    const reactEnabled = candidate.reactEnabled === true;
    const accountsEnabled = reactEnabled && candidate.accountsEnabled === true && validProductionAuth(candidate.auth);
    return Object.freeze({
      apiBaseUrl: new URL(candidate.apiBaseUrl).origin,
      reactEnabled,
      accountsEnabled,
      auth: accountsEnabled ? Object.freeze({ ...candidate.auth }) : null
    });
  }

  function resolve(origin, developmentApi) {
    const staging = origin === stagingOrigin;
    const production = productionOrigins.includes(origin);
    const approved = production ? productionRelease() : null;
    let apiBaseUrl = production ? (approved?.apiBaseUrl || productionApi) : staging ? stagingApi : '';
    let local = false;
    try {
      const url = new URL(origin);
      local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol);
      if (local && developmentApi) {
        const api = new URL(developmentApi);
        if (['localhost', '127.0.0.1', '[::1]'].includes(api.hostname) && ['http:', 'https:'].includes(api.protocol)) {
          apiBaseUrl = api.origin;
        }
      }
    } catch (_) { /* Unknown origins stay disabled. */ }
    return Object.freeze({
      environment: production ? 'production' : staging ? 'staging' : local ? 'development' : 'unknown',
      apiBaseUrl,
      accountsEnabled: staging || (production && Boolean(approved?.accountsEnabled)),
      worldwideRegistryEnabled: staging,
      automaticDatesEnabled: staging || (local && Boolean(apiBaseUrl)),
      reactEnabled: staging || local || (production && Boolean(approved?.reactEnabled)),
      auth: staging ? stagingAuth : production && approved?.accountsEnabled ? approved.auth : null
    });
  }
  return Object.freeze({ productionApi, stagingApi, stagingOrigin, stagingAuth, resolve });
});
