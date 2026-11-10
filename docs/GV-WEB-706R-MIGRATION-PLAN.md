# GV-WEB-706R — incremental frontend migration plan

## Goal

Move Globevoy toward React + Next.js + TypeScript without pausing MVP delivery or rewriting proven account, recommendation, booking, provider, and trust behavior all at once.

## Architecture boundary

Existing system stays authoritative during migration:

- `frontend/` — current proven HTML/CSS/vanilla-JS application.
- AWS Lambda — existing API/provider orchestration.
- Cognito — existing authentication authority.
- DynamoDB — existing owner-private Saved Trips storage.
- Amplify staging/production — existing release path.

New migration target:

- `web/` — Next.js App Router + React + TypeScript.
- Static-export first; no second backend.
- Typed adapters call existing APIs.
- No provider credential is ever exposed to the browser.

## Migration sequence

### Phase R0 — foundation — GV-WEB-706R
Status: complete.

Deliverables:
- Next.js/React/TypeScript app builds independently.
- strict TypeScript.
- reusable shell, button, price-evidence, and trip-card primitives.
- typed Saved Trips / price snapshot contracts.
- typed existing-Lambda adapter.
- static export.
- deterministic CI.
- zero routing replacement.

### Phase R1 — account shell + My Trips — GV-WEB-707A
Status: complete after same-origin staging deployment, browser acceptance, composite Amplify packaging, and R2 saved-origin preservation.

Deliverables:
- React account navigation and `/react/account/` route.
- React `/react/my-trips/` route backed by the existing owner-private 705C Saved Trips API.
- exact compatibility with the 705B-R3 Cognito sessionStorage and PKCE contract; the existing `/auth-callback.html` remains authoritative.
- signed-out privacy, authenticated list/delete, legacy-safe Open Trip, and 401 fail-closed behavior.
- saved multi-city Open Trip preserves the owner-private saved origin even when an older source URL contains a stale origin query parameter.
- existing `frontend/my-trips.html` and account pages remain the rollback path.
- no Cognito pool/client, DynamoDB, provider credential, or production-route replacement.

### Phase R2 — Booking Workspace — GV-WEB-707B
Status: implementation in progress; staging deployment and browser acceptance required before completion.

Scope:
- React `/react/booking/` owner-private Saved Trip workspace.
- Continue booking from React My Trips carries only a Saved Trip ID; no route/provider payload is trusted from the browser.
- staging-only authenticated Lambda route verifies Cognito, derives owner from token `sub`, reads the exact 705C DynamoDB record, and reconstructs the compact saved tour server-side.
- reuse the existing 684A/685C Duffel LIVE exact-date search, quality selection, whole-trip reconciliation, quota controls, metro fallback and 703 staging limits; do not create a second flight engine.
- live revalidation is explicit user action rather than an automatic page-load provider call.
- compare fresh flight evidence with the saved flight snapshot and show verified/changed/unavailable states.
- require complete LIVE coverage for every saved flight leg before enabling generated Aviasales comparison handoffs.
- hotel rows remain planning estimates; modern Agoda live availability is not claimed. Generated Agoda search handoffs may be shown with final partner confirmation required.
- fail closed on unsupported cohort, missing exact route/date, provider failure, quota protection, partial coverage, invalid session, wrong origin, or missing owner-private trip.
- no Duffel order, payment, booking, ticketing, or combined checkout capability.
- legacy `frontend/booking.html` and 706A remain rollback paths during stabilization.

### Phase R3 — recommendation results
Migrate recommendation cards, evidence badges, loading/error states, and portfolio roles. Preserve deterministic recommendation and diversity behavior in the existing Lambda backend.

### Phase R4 — interactive multi-city + map
Move route editing, synchronized map/cards, city-night changes, add/remove/replace-city interactions, and journey state into React components. This is the phase with the largest UI-state payoff.

### Phase R5 — public/support pages
Migrate remaining public pages and destination/route content surfaces. Evaluate Next.js prerendering/SEO here rather than adding SSR to authenticated workflows prematurely.

### Phase R6 — route cutover
Only after equivalent tests and staging browser acceptance:
- route migrated pages to `web/`;
- preserve rollback to the old page during the stabilization window;
- remove legacy page code only after production evidence shows the replacement is stable.

## Non-goals during migration

- no full rewrite;
- no production cutover before staging acceptance;
- no change to `main` during ordinary staging work;
- no replacement of Lambda with Next.js API routes;
- no new payment implementation;
- no changes to provider credentials or provider eligibility;
- no migration of Cognito tokens into localStorage;
- no weakening of saved-price or provider-evidence trust labels.

## Definition of done for each migrated page

A page is not considered migrated merely because it renders in React. It must preserve its current business/security behavior, pass deterministic CI, pass staging browser acceptance, preserve an explicit rollback path, and avoid exposing secrets or claiming stale prices are current.