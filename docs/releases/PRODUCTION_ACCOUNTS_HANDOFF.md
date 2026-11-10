# GlobeVoy production accounts release handoff

## Product target
Keep the classic HTML/CSS/JavaScript homepage and tour/search pages on globevoy.com. Enable the existing React account, My Trips, and Travel Profile screens under /react/ after production backend and Cognito are verified. Do not rebuild the whole site in React.

## Code prepared on PR #121
- `backend/services/accounts/auth/production-cognito-auth.js` verifies production RS256 access tokens with exact Cognito issuer, client, verified signature, expiry and `globevoy/trips.write` scope. Staging pool and staging app client are rejected.
- `backend/production-account-lambda.js` routes only `/api/account/session`, `/api/saved-trips`, and `/api/account/travel-profile` to isolated production account handlers. Existing public production API stays with `backend/lambda.js`.
- Saved Trips supports GET/list, GET/one, POST, PUT, and DELETE; Travel Profile supports GET and PUT. The gateway reuses staging business validation/serialization routines, not staging-only HTTP authentication.
- `backend/validation/validate-gv-production-account.js` runs offline tests for tokens, staging rejection, ownership, data filtering, CORS, and CRUD. CI runs this without AWS resources.
- The existing React/classic production release policy remains off by default until release approval.

## AWS setup required later — NOT performed
**Cost restriction:** The AWS account belongs to Deaf AI and the owner allowed usage subject to no charges. Do not run infrastructure creation or deployment without the owner's express permission and verified cost controls. AWS free tiers do not guarantee a zero bill.

1. Dedicated production Cognito user pool and public authorization-code/PKCE client. Use the preview-first `ops/release/provision-production-cognito.ps1` only after explicit permission. Production browser callback should be https://globevoy.com/auth-callback.html; logout https://globevoy.com/index.html. Scope: `globevoy/trips.write`. No staging user/data mixing.
2. Separate production DynamoDB table with String partition key `PK` and String sort key `SK`. Authorize only production table operations GetItem, Query, PutItem, UpdateItem, DeleteItem. The user key is derived from verified token sub; Saved Trips use TRIP# item keys and Travel Profile uses PROFILE#TRAVEL. Storage can incur charges.
3. Package the organized backend and dependency `@aws-sdk/client-dynamodb`. If ZIP root contains backend files, handler is `production-account-lambda.handler`. If ZIP contains a backend folder, handler is `backend/production-account-lambda.handler`. Verify ZIP structure and resolve existing production handler/package mismatch before changing the live function.
4. Required production Lambda environment: `CORS_ORIGIN=https://globevoy.com`, `GLOBEVOY_PRODUCTION_ACCOUNTS_ENABLED=true`, `GLOBEVOY_PRODUCTION_USER_POOL_ID`, `GLOBEVOY_PRODUCTION_COGNITO_CLIENT_ID`, `GLOBEVOY_PRODUCTION_SAVED_TRIPS_TABLE`. These are not public browser secrets; configure backend access only after authorization.
5. Production artifact flags and public production Cognito identifiers are described in `MAIN_CONSOLIDATION.md`. Do not enable frontend React/accounts until backend and browser acceptance pass. Never point production browsers at staging Cognito or staging Lambda.

## Acceptance before site release
- [ ] Owner authorizes potential AWS charges; cost and permissions reviewed.
- [ ] Production Cognito signup, email verification, sign-in, session validation, password reset and sign-out work on canonical domain.
- [ ] Production Lambda ZIP entrypoint/dependencies and IAM verified, with rollback snapshot.
- [ ] Two separate production test accounts cannot read or change each other's saved trips or profile.
- [ ] Saved Trip GET/POST/PUT/DELETE and Travel Profile GET/PUT work from React pages.
- [ ] Classic homepage, trip search, recommendations, maps and nested assets still work.
- [ ] No staging backend, Cognito, or user table is contacted from globevoy.com.
- [ ] Existing booking revalidation, worldwide registry and automatic-date staging routes remain a separately gated migration; current account gateway does NOT claim those are production-ready.
- [ ] Static website and production Lambda tested, explicit deployment approval obtained.

Current readiness: CODE PREPARED, LIVE PRODUCTION BLOCKED. No AWS resources were created or changed by PR #121.
