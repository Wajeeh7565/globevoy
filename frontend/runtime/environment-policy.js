/* Public environment policy shared by the classic website and React bundle. */
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
  function resolve(origin, developmentApi) {
    const staging = origin === stagingOrigin;
    const production = productionOrigins.includes(origin);
    let apiBaseUrl = production ? productionApi : staging ? stagingApi : '';
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
      apiBaseUrl, accountsEnabled: staging, worldwideRegistryEnabled: staging,
      automaticDatesEnabled: staging || (local && Boolean(apiBaseUrl)),
      // The newer React workflows require backend services not verified in production.
      reactEnabled: staging || local,
      auth: staging ? stagingAuth : null
    });
  }
  return Object.freeze({ productionApi, stagingApi, stagingOrigin, stagingAuth, resolve });
});
