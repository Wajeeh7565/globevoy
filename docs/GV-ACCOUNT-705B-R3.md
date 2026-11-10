# GV-ACCOUNT-705B-R3 — Secure staging sign-up/sign-in runtime

## Purpose

Connect the already-created **staging** Cognito user pool to the Globevoy browser and staging API without changing production and without adding saved-trip storage yet.

## Verified AWS staging resources

- Region: `us-east-2`
- User pool: `us-east-2_MSd9RRHD8`
- Public browser client: `o2ohbv50253hjli5s34rbvv79`
- Managed Login domain: `https://globevoy-stg-76bf9b233a.auth.us-east-2.amazoncognito.com`
- Callback: `https://staging.dy4fw8gx1ccie.amplifyapp.com/auth-callback.html`
- Logout URL: `https://staging.dy4fw8gx1ccie.amplifyapp.com/index.html`
- Required API scope: `globevoy/trips.write`
- Client secret: **none**

These identifiers are public OAuth/OIDC configuration, not credentials.

## Browser flow

1. User selects **Sign in** or **Sign in or create account**.
2. Browser creates a cryptographically random PKCE verifier and state.
3. Only the verifier/state/return path are placed in `sessionStorage` for the pending request.
4. Browser navigates to Cognito `/oauth2/authorize` with `response_type=code`, the exact callback URL, requested scopes and `code_challenge_method=S256`.
5. Cognito Managed Login handles sign-in, account creation, email verification, password reset and password entry. Globevoy does not receive the password.
6. Cognito redirects to `auth-callback.html?code=...&state=...`.
7. The callback checks state and pending-request age, then exchanges the code at `/oauth2/token` with the original PKCE verifier.
8. The browser sends the returned **access token** to `GET /api/account/session`.
9. The staging Lambda verifies the JWT signature against the fixed Cognito JWKS and checks issuer, app client, `token_use=access`, expiry and `globevoy/trips.write` scope.
10. Only after that backend verification succeeds does the browser store the access token in `sessionStorage` and mark the session signed in.
11. `userInfo` is used only for display profile fields such as email.

## Token storage boundary

705B-R3 intentionally keeps the first browser session simple:

- access token: `sessionStorage` only;
- refresh token: discarded / never persisted;
- ID token: discarded / never persisted;
- no Cognito token in `localStorage`;
- no client secret in the browser;
- session is cleared when expired, verification fails or the user signs out.

The user must reauthenticate after the tab/session is gone or after the access token expires. A later reviewed iteration can add a stronger refresh/session strategy if needed.

## Staging API boundary

`backend/services/staging-cognito-auth-705b-r3.js` is imported only by `staging-lambda-702d.js`.

`GET /api/account/session` is therefore available only through the staging QA handler and only when `CORS_ORIGIN` resolves to the exact staging origin. It returns a minimal verified identity (`sub`, optional Cognito username, scopes, expiry) and never echoes the bearer token.

`OPTIONS` remains handled by the existing staging CORS path, which already allows the `Authorization` header.

## What 705B-R3 does not do

- no production/main deployment;
- no DynamoDB table;
- no saved-trip CRUD;
- no payment/booking/order/ticketing capability;
- no AWS credentials in the browser;
- no passport number/scan storage;
- no provider credentials;
- no Cognito password handling by Globevoy.

Guest discovery remains available.

## 705B CloudShell compatibility evidence

The real CloudShell run proved that this account's Cognito CLI accepts:

```bash
aws cognito-idp list-user-pools --max-results 60 --region us-east-2 --output json
```

and rejects the combination of `--max-results` with the CLI paginator `--max-items` in that environment. The operator source must be normalized to the working command before it is used again.

## Validation before staging release

- deterministic RSA/JWKS JWT tests, with no network;
- invalid signature rejected;
- wrong issuer/client/token-use/scope rejected;
- expired token rejected;
- wrong browser origin rejected;
- production handler has no 705B-R3 route;
- PKCE S256 markers present;
- no client secret or token `localStorage` persistence;
- guest path preserved;
- syntax and prior 703E/704A/705A/705B regressions pass.

## Next after live sign-in QA

**GV-ACCOUNT-705C** can add owner-private DynamoDB saved trips using the verified Cognito `sub` as the ownership key, followed by explicit local travel-profile migration and price revalidation when a saved trip is reopened.
