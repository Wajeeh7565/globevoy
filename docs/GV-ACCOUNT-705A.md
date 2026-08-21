# GV-ACCOUNT-705A — Cognito Account + Saved Trip Architecture

## Scope

705A is an architecture and deterministic-contract task only. It does **not** create a Cognito user pool, app client, domain, DynamoDB table, IAM role, Lambda route, login page, password flow or production deployment.

The goal is to define the secure boundary before 705B/705C implement signup/sign-in and persistent saved trips.

## Current Globevoy state audited

Globevoy already has a useful **travel profile**, but it is intentionally not authentication:

- `frontend/create-account.html` explicitly says the MVP profile is stored only in the browser and “is not a secure Globevoy account.”
- `frontend/scripts/travel-profile-675a.js` stores the profile in `localStorage` under `globevoy.travel.profile.v1`.
- the local profile contains display name, unverified email, passport/residence country choices and usual travel-group preferences, but no password/passport number/scan/payment details.
- the home page deliberately supports “Continue as guest.”
- `frontend/scripts/shell-670f.js` links to “Travel profile”, not a real account dashboard.
- the current Lambda has no saved-trip persistence route or DynamoDB integration.
- the current Lambda CORS preflight already permits the `Authorization` request header, which is compatible with a later bearer-access-token API.

**705B must not rename the current local profile into “secure account” and pretend authentication exists.** It must add a real auth boundary.

## Official AWS Cognito research (reviewed 2026-08-21)

Authoritative references:

- User-pool managed login: `https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html`
- Authorization endpoint: `https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html`
- Authorization Code + PKCE: `https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html`
- App-client security: `https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html`
- JWT verification: `https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html`
- User-pool security best practices: `https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-security-best-practices.html`

Important findings:

1. Cognito Managed Login provides the authorization server plus ready-to-use signup, sign-in, sign-out and password-management UI.
2. For a browser/public client, AWS recommends the **Authorization Code grant with PKCE** and recommends activating only the code grant rather than implicit grant.
3. PKCE must use a new random verifier for each authorization request; Globevoy will use `S256`.
4. A public browser client must not contain an app-client secret or AWS credentials.
5. For Node.js API processing, AWS recommends `aws-jwt-verify`. The API must verify signature, expiry, issuer, app client, `token_use` and any required scope. Decoding a JWT is not verification.
6. Globevoy APIs should authorize with the **access token**, not an ID token.
7. Managed Login also gives a path to passwordless/passkey support later without making 705B build custom password-handling forms.

## Architecture decision

### Identity

Use **Amazon Cognito User Pools**, with separate staging and production identity resources.

For the browser client:

- public app client
- no client secret
- Managed Login
- OAuth 2.0 Authorization Code grant only
- PKCE required, `S256`
- explicit HTTPS callback URLs only; no wildcard callback
- scopes start with `openid email profile`
- a dedicated saved-trip API scope can be added when 705C wires persistence
- no Cognito Identity Pool is needed for the MVP because the browser must not receive AWS credentials

Staging callback:

`https://staging.dy4fw8gx1ccie.amplifyapp.com/auth-callback.html`

Production callback (future, not activated by 705A):

`https://globevoy.com/auth-callback.html`

### Browser session boundary

Globevoy is currently a static multi-page frontend. For 705B MVP:

- authorization redirect begins at Cognito `/oauth2/authorize`
- callback exchanges code + PKCE verifier at `/oauth2/token`
- access/ID token session state may use **sessionStorage** so navigation between static pages works in one tab
- do **not** put Cognito tokens in `localStorage`
- do not persist a refresh token in browser storage for the first secure MVP
- if the browser session is gone, start a fresh PKCE authorization request; Cognito's managed-login session can reduce repeat-login friction
- a later BFF/HttpOnly-cookie design can be evaluated if the product needs longer-lived sessions with stronger XSS isolation

### API authorization

Future protected routes use:

`Authorization: Bearer <access token>`

The backend must cryptographically verify the access token before trusting claims. Minimum checks:

- signature/JWKS key
- expiration
- issuer (`iss`)
- app client (`client_id`)
- `token_use=access`
- required OAuth scope for the protected operation

The stable account owner key is Cognito `sub`.

**Never accept `ownerSub`, user ID, email or account ownership from a request body/query string.** The server derives ownership from the verified access token.

## Saved-trip persistence

Recommended first store: **Amazon DynamoDB**.

Single-user partition pattern:

- `PK = USER#<verified-cognito-sub>`
- `SK = TRIP#<trip-id>`

This gives a simple `Query` for “My trips” without a global scan.

705C should initially support only owner-private trips. Public sharing/collaboration is a separate future security design.

### What a saved trip should contain

Save a compact user-facing/canonical trip snapshot:

- title
- origin airport
- selected cities/airports and nights
- requested date mode/dates
- total budget + currency
- traveller counts
- recommendation role/preferences needed to reproduce the plan
- engine/schema version

Do **not** store:

- provider credentials
- raw provider API responses
- payment/card data
- passport numbers/scans
- a stale provider price labelled as live forever

When a saved trip is reopened, provider-backed prices must be **revalidated**. The stored plan is a snapshot of the trip decision, not a permanent live-price guarantee.

## Existing browser-profile migration

The existing local profile is useful and should not be thrown away, but migration must be deliberate:

- do not automatically upload `globevoy.travel.profile.v1` at first sign-in
- ask the traveller whether to carry their travel preferences into the secure account
- Cognito's verified account email becomes the account email source; the old unverified local email must not overwrite it
- country/travel-group preferences can be copied only after explicit confirmation
- keep passport numbers, scans and payment data prohibited
- guest planning remains available

This preserves the current low-friction product while making “Save trip” the natural point where persistent sign-in becomes valuable.

## GitHub travel-app references

These are architecture/product references, not security authorities and not code to copy blindly.

- `papercri/triptailor`: authenticated planning redirects back to the original destination/page and saves itineraries per authenticated user. The return-to flow is useful for Globevoy: ask for sign-in when the user chooses Save, then return them to the trip they were viewing.
- `kaushik0010/TripGenie`: separates frontend authentication from server-side token verification and persistence. The useful lesson is to keep authorization enforcement on the server rather than trusting browser state.
- other AI travel planners commonly use Firebase Auth + Firestore; Globevoy will use Cognito + DynamoDB because the current platform is already AWS/Lambda/Amplify.

## Reddit/user-reference findings

Reddit is anecdotal, not authoritative, but current travel-planner discussions reinforce several product decisions:

- travellers often dislike moving among maps, spreadsheets, notes, booking tabs and documents;
- multi-city users want the whole route, hotels and transport kept together and editable;
- some users strongly prefer planning without mandatory accounts;
- people value being able to revisit/share a coherent itinerary more than being forced through signup before they can explore.

Therefore Globevoy should preserve **guest discovery**, and introduce secure sign-in when it provides obvious value: saving/reopening trips, syncing preferences and later collaboration.

## 705A code contract

`backend/services/account-architecture-705a.js` is pure and deployment-free. It defines:

- exact staging/production callback + logout allowlists
- public-client/code+PKCE security requirements
- access-token principal rules
- saved-trip ownership derived only from verified `sub`
- DynamoDB key/schema contract
- provider-price revalidation policy
- local-profile migration policy

`backend/validate-gv-account-705a.js` validates the contract and audits the current browser-only profile boundary.

## Implementation split after 705A

### 705B — Secure Sign-in Foundation

- create **staging-only** Cognito user pool/domain/public app client
- Managed Login
- Authorization Code + PKCE callback/logout frontend
- server JWT verification boundary
- account session UI in shared shell
- preserve guest mode
- no saved-trip database writes yet
- deterministic CI + staging browser QA before production consideration

### 705C — Saved Trips

- DynamoDB table/IAM least privilege
- protected `GET/POST/PUT/DELETE /api/saved-trips` routes
- server-derived owner `sub`
- “Save trip” action and “My trips” page
- explicit migration of existing browser travel preferences
- provider-price revalidation when a trip is reopened
- no public sharing/collaboration yet

## 705A conclusion

The existing travel profile is a good personalization prototype, but it is deliberately **not an account**. The safest next step is not a custom password page. It is a staging-only Cognito Managed Login + Authorization Code/PKCE foundation, followed by server-owned saved-trip persistence.
