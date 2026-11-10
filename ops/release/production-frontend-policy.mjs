import policy from '../../frontend/runtime/environment-policy.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const account = require('./production-account-config.json');

// Nonsecret deployment identifiers. Pool/client must match the approved backend.
export const approvedFrontend = Object.freeze({
  apiBaseUrl: policy.productionApi,
  auth: Object.freeze({
    region: 'us-east-2', userPoolId: account.pool, clientId: account.client,
    issuer: `https://cognito-idp.us-east-2.amazonaws.com/${account.pool}`,
    domainBaseUrl: 'https://globevoy-prod-083409.auth.us-east-2.amazoncognito.com'
  })
});

export function productionPolicySource(release) {
  if (release.environment !== 'production' || release.target !== 'globevoy.com' ||
      release.apiBaseUrl !== approvedFrontend.apiBaseUrl ||
      typeof release.reactEnabled !== 'boolean' || typeof release.accountsEnabled !== 'boolean' ||
      Object.keys(release).some(key => !['environment','target','apiBaseUrl','reactEnabled','accountsEnabled','auth'].includes(key))) {
    throw Error('Production release configuration must use the approved destination and closed schema.');
  }
  if (release.auth && ['userPoolId','clientId','issuer','domainBaseUrl'].some(key => release.auth[key] === policy.stagingAuth[key])) {
    throw Error('Production Cognito configuration cannot select a staging identity.');
  }
  if (release.accountsEnabled) {
    if (!release.reactEnabled || !release.auth ||
        Object.keys(release.auth).length !== Object.keys(approvedFrontend.auth).length ||
        Object.keys(approvedFrontend.auth).some(key => release.auth[key] !== approvedFrontend.auth[key])) {
      throw Error('Production Cognito configuration does not match the approved production identifiers.');
    }
  } else if (release.auth !== null) throw Error('Disabled accounts must not include authentication configuration.');
  const configuration = {
    productionOnly: true, productionApi: approvedFrontend.apiBaseUrl,
    productionOrigins: ['https://globevoy.com','https://www.globevoy.com','https://main.dttux5e6ddtzb.amplifyapp.com'],
    productionAuth: release.auth, reactEnabled: release.reactEnabled, accountsEnabled: release.accountsEnabled,
    stagingApi: '', stagingOrigin: '',
    stagingAuth: { region:'', userPoolId:'', clientId:'', issuer:'', domainBaseUrl:'' }
  };
  // One maintained factory and the same trusted configuration for classic and React.
  // No post-build string scrubbing or removal of authentication checks.
  return `if (typeof window !== 'undefined') window.GLOBEVOY_PRODUCTION_RELEASE = Object.freeze(${JSON.stringify(release)});\n` +
    `(function(root,factory){const policy=factory(${JSON.stringify(configuration)});\n` +
    `if(typeof module==='object'&&module.exports)module.exports=policy;else root.GLOBEVOY_ENVIRONMENT_POLICY=policy;\n` +
    `})(typeof window==='undefined'?globalThis:window,${policy.createPolicy.toString()});\n`;
}

// Exact destinations and identities, rather than descriptive text such as "staging".
export function stagingDestinations() {
  const entries = { api:policy.stagingApi, hosting:policy.stagingOrigin,
    pool:policy.stagingAuth.userPoolId, client:policy.stagingAuth.clientId,
    issuer:policy.stagingAuth.issuer, login:policy.stagingAuth.domainBaseUrl };
  return Object.fromEntries(Object.entries(entries).flatMap(([key,value]) => {
    const variants = [[key,value]];
    if (['api','hosting','login'].includes(key)) variants.push([key+'Host',new URL(value).hostname]);
    return variants;
  }));
}
