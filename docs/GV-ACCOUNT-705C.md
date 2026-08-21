# GV-ACCOUNT-705C — Owner-private saved trips (staging)

## Scope

GV-ACCOUNT-705C turns the verified GV-ACCOUNT-705B Cognito session into a small, owner-private saved-trip feature on staging. It does not change production/main, payment handling, provider authentication, or the browser-only travel profile contract.

## Security and ownership contract

- Every `/api/saved-trips` request requires the existing `GV-ACCOUNT-705B-R3` Cognito access token.
- The DynamoDB partition key is derived only from the cryptographically verified access-token `sub`: `PK=USER#<sub>`.
- The browser cannot supply `ownerSub`, `PK`, `SK`, or `createdAt`.
- Create IDs are server-generated UUIDs; `SK=TRIP#<tripId>`.
- The service never scans the table. List uses `Query` on the caller's own partition; get/update/delete use exact composite keys.
- Saved payloads reject password/token/credential/passport/payment/raw-provider fields and sensitive URL query parameters.
- No provider access tokens, raw provider responses, payment/card data, or passport data are stored.
- Responses use `Cache-Control: no-store` and exact staging-origin CORS.

## DynamoDB

Staging table: `globevoy-staging-saved-trips`

- Partition key: `PK` (String)
- Sort key: `SK` (String)
- Billing: `PAY_PER_REQUEST`
- Encryption at rest: DynamoDB server-side encryption
- Point-in-time recovery: enabled
- Lambda environment variable: `GLOBEVOY_SAVED_TRIPS_TABLE`

The staging Lambda role receives only these actions on this exact table ARN: `Query`, `GetItem`, `PutItem`, `UpdateItem`, `DeleteItem`.

## API

All routes are staging-only and authenticated.

- `GET /api/saved-trips` — list up to 50 trips owned by the verified user.
- `GET /api/saved-trips?tripId=<id>` — get one owned trip.
- `POST /api/saved-trips` — create a saved trip with a server-generated trip ID.
- `PUT /api/saved-trips?tripId=<id>` — replace editable snapshot fields using optimistic `version` checking.
- `DELETE /api/saved-trips?tripId=<id>` — delete one owned trip.

## Saved record contract

Public fields:

- `tripId`
- `name`
- `status` (`planned` or `archived`)
- `createdAt`
- `updatedAt`
- `version`
- `tripSnapshot`
- `providerRefs`
- `priceSnapshot`
- `travelerProfileRef`

The storage item also carries `ownerSub` internally, but API ownership is never accepted from the client.

`priceSnapshot` is always marked `snapshotOnly=true` and `requiresRevalidation=true`. A saved amount is planning memory, not a current provider quote. Provider prices must be revalidated before provider handoff or booking.

## Browser behavior

- `account.html` exposes **My Trips** only as part of the signed-in account experience.
- `my-trips.html` lists, opens and deletes secure saved trips.
- Existing guest trip planning continues to work.
- Single-destination Save buttons use the owner-private API when signed in. Signed-out legacy browser-only save behavior remains local.
- Multi-city's existing explicit local route serialization is allowed to complete first so the currently selected route is captured; when the user is signed in, that explicit Save action then persists the same route to the private API.
- Old browser-only saves and the local travel profile are **not silently migrated**. Any future migration must require explicit user consent.

## Runtime dependency note

The 705C staging service lazily uses `@aws-sdk/client-dynamodb`. AWS documents that supported Node.js Lambda runtimes include AWS SDK for JavaScript v3; the current staging runtime is Node.js 24. AWS recommends vendoring SDK clients for stronger dependency control, so a production release should package a pinned DynamoDB client rather than relying on the runtime copy.

## Rollback

Code rollback: redeploy the previously verified staging backend artifact / prior staging commit. Infrastructure rollback can remove `GLOBEVOY_SAVED_TRIPS_TABLE` while preserving all other Lambda environment variables and delete the `GlobevoyStagingSavedTrips705C` inline role policy. Retain the DynamoDB table by default to avoid deleting user data; delete it only as an explicit destructive staging operation.
