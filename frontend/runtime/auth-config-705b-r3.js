/* GV-ACCOUNT-705B-R3 — public staging Cognito configuration.
 * This file intentionally contains only public OAuth/OIDC identifiers.
 * It must never contain a client secret, AWS credential, password or provider key.
 */
(function () {
  'use strict';

  const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
  const DOMAIN = 'https://globevoy-stg-76bf9b233a.auth.us-east-2.amazoncognito.com';

  window.GLOBEVOY_AUTH_CONFIG = Object.freeze({
    version: 'GV-ACCOUNT-705B-R3',
    environment: 'staging',
    enabled: window.location.origin === STAGING_ORIGIN,
    stagingOrigin: STAGING_ORIGIN,
    region: 'us-east-2',
    userPoolId: 'us-east-2_MSd9RRHD8',
    clientId: 'o2ohbv50253hjli5s34rbvv79',
    clientSecretPresent: false,
    issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_MSd9RRHD8',
    domainBaseUrl: DOMAIN,
    authorizeEndpoint: `${DOMAIN}/oauth2/authorize`,
    tokenEndpoint: `${DOMAIN}/oauth2/token`,
    userInfoEndpoint: `${DOMAIN}/oauth2/userInfo`,
    logoutEndpoint: `${DOMAIN}/logout`,
    callbackUrl: `${STAGING_ORIGIN}/auth-callback.html`,
    logoutUrl: `${STAGING_ORIGIN}/index.html`,
    apiBaseUrl: 'https://mirksnjcjim4iowstuda4lesrm0ghmfw.lambda-url.us-east-2.on.aws',
    sessionEndpoint: '/api/account/session',
    oauth: Object.freeze({
      flow: 'authorization-code-pkce',
      pkceMethod: 'S256',
      scopes: Object.freeze(['openid', 'email', 'profile', 'globevoy/trips.write']),
      accessTokenUse: 'access'
    }),
    storage: Object.freeze({
      sessionOnly: true,
      persistRefreshToken: false,
      persistIdToken: false,
      localStorageTokensAllowed: false
    })
  });
})();
