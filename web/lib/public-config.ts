import policy from '../../frontend/runtime/environment-policy.js';
export const GV_WEB_707A_VERSION = 'GV-WEB-707A';
export const GV_AUTH_VERSION = 'GV-ACCOUNT-705B-R3';
export const STAGING_ORIGIN = policy.stagingOrigin;
export const STAGING_API_BASE_URL = policy.stagingApi;
export const COGNITO_DOMAIN = policy.stagingAuth.domainBaseUrl;
export const COGNITO_CLIENT_ID = policy.stagingAuth.clientId;
export const COGNITO_CALLBACK_URL = `${STAGING_ORIGIN}/auth-callback.html`;
export const COGNITO_LOGOUT_URL = `${STAGING_ORIGIN}/index.html`;
export const COGNITO_SCOPES = ['openid', 'email', 'profile', 'globevoy/trips.write'] as const;

export function browserIsStagingOrigin(): boolean {
  return Boolean(STAGING_ORIGIN) && typeof window !== 'undefined' && window.location.origin === STAGING_ORIGIN;
}

export function browserEnvironment() {
  return policy.resolve(typeof window === 'undefined' ? '' : window.location.origin, process.env.NEXT_PUBLIC_GLOBEVOY_API_BASE_URL);
}

export function browserApiBaseUrl(): string {
  return browserEnvironment().apiBaseUrl;
}
