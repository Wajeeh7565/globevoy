export const GV_WEB_707A_VERSION = 'GV-WEB-707A';
export const GV_AUTH_VERSION = 'GV-ACCOUNT-705B-R3';
export const STAGING_ORIGIN = 'https://staging.dy4fw8gx1ccie.amplifyapp.com';
export const STAGING_API_BASE_URL = 'https://mirksnjcjim4iowstuda4lesrm0ghmfw.lambda-url.us-east-2.on.aws';
export const COGNITO_DOMAIN = 'https://globevoy-stg-76bf9b233a.auth.us-east-2.amazoncognito.com';
export const COGNITO_CLIENT_ID = 'o2ohbv50253hjli5s34rbvv79';
export const COGNITO_CALLBACK_URL = `${STAGING_ORIGIN}/auth-callback.html`;
export const COGNITO_LOGOUT_URL = `${STAGING_ORIGIN}/index.html`;
export const COGNITO_SCOPES = ['openid', 'email', 'profile', 'globevoy/trips.write'] as const;

export function browserIsStagingOrigin(): boolean {
  return typeof window !== 'undefined' && window.location.origin === STAGING_ORIGIN;
}

export function browserApiBaseUrl(): string {
  const configured = String(process.env.NEXT_PUBLIC_GLOBEVOY_API_BASE_URL || '').replace(/\/$/, '');
  if (configured) return configured;
  return browserIsStagingOrigin() ? STAGING_API_BASE_URL : '';
}
