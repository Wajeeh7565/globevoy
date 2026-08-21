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
Status: implemented by this milestone.

Deliverables:
- Next.js/React/TypeScript app builds independently.
- strict TypeScript.
- reusable shell, button, price-evidence, and trip-card primitives.
- typed Saved Trips / price snapshot contracts.
- typed existing-Lambda adapter.
- static export.
- deterministic CI.
- zero routing replacement.

### Phase R1 — account shell + My Trips
Migrate account navigation and My Trips first because 705B/705C have explicit API and privacy contracts. Keep the existing page as rollback until browser acceptance passes.

### Phase R2 — Booking Workspace
Migrate 706A/706B booking state into React. Preserve snapshot-vs-current-price boundaries, external partner separation, and fail-closed revalidation.

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

## Non-goals for 706R

- no full rewrite;
- no production cutover;
- no change to `main`;
- no replacement of Lambda with Next.js API routes;
- no new payment implementation;
- no changes to provider credentials or provider eligibility;
- no migration of Cognito tokens into localStorage;
- no weakening of saved-price or provider-evidence trust labels.

## Definition of done for each migrated page

A page is not considered migrated merely because it renders in React. It must preserve its current business/security behavior, pass deterministic CI, pass staging browser acceptance, preserve an explicit rollback path, and avoid exposing secrets or claiming stale prices are current.
