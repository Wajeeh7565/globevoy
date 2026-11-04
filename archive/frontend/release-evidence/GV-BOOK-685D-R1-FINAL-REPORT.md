# GV-BOOK-685D-R1 — Final Report

Date: 2026-08-18  
Status: validated and packaged only; not deployed

## Baseline

- Authenticated package: `frontend-staging-gv-book-685d-complete-trip-booking-hub-v2-portable.zip`
- Baseline SHA-256: `d42522a0140a7ec646b5e1f7dffb7e94acce3407f6426342e2748882ce35bf58`
- The completed GV-BOOK-685D chronological booking hub remains the design baseline.

## Exact production runtime delta from GV-BOOK-685D

Only three frontend runtime files changed:

1. `scripts/booking-hub-685d.js`
   - reads the deployed 685C-R3/R3-R1 metro evidence shape;
   - displays confirmed requested-to-resolved airport changes and the inherited ground-access-not-repriced caveat;
   - keeps city-level flight titles and resolved airport route codes;
   - makes generated Aviasales fallbacks use resolved airports;
   - classifies `CACHED` before the generic Duffel branch and displays `Cached Duffel fare observation`;
   - preserves the four required evidence states: live Duffel, cached Duffel, unavailable and planning estimate.
2. `styles/booking-hub-685d.css`
   - adds one small wrapping disclosure style for confirmed metro changes.
3. `booking.html`
   - updates only the release marker and R1 CSS/JS cache-busting query strings so browsers load the repaired assets.

There is no design rewrite.

## Metro integration proof

The production-shape fixture represents requested JFK → YOW resolved as LGA → YOW with `airportMode683H = METRO_ORIGIN_ALTERNATE` and registry evidence.

- Card title: `New York → Ottawa`
- Displayed airport route: `LGA → YOW`
- Disclosure: `Same-city airport change: JFK → LGA`
- Caveat: `Ground-access cost for this airport change is not repriced.`
- Generated Aviasales handoff: `https://www.aviasales.com/search/LGA0509YOW1` in the one-traveller validator and `...LGA0509YOW2` in the two-traveller browser fixture
- The generated handoff contains `LGA`, not `JFK`.
- Existing Aviasales URLs and tracking parameters remain byte-for-byte intact.
- Exact-airport legs do not receive a substitution notice.
- Origin, destination and dual-endpoint substitutions are covered.

Same-city wording is emitted only when the `METRO_*` mode is accompanied by backend metro/registry evidence. The frontend does not maintain its own airport mapping.

## Cached Duffel proof

A Duffel component with `sourceType = CACHED` renders:

`Cached Duffel fare observation`

It does not receive the live label `Fare observed via Duffel`, and its explanatory note says the observation is not a current quote.

## Scope proof

- Frontend only; the package contains no backend or Lambda runtime.
- No provider adapter, FX, quota, concurrency, transaction, order, ticket or payment change.
- No `fetch`, XHR or WebSocket was added to the R1 booking-hub runtime.
- No provider call or live fare lookup was made during implementation or validation.
- No deployment was performed.
- Flights and hotels still open as separate external partner checkouts. This is not one-click booking.

## Validation

- GV-BOOK-685D-R1: 15/15 PASS
- GV-BOOK-685D: 17/17 PASS
- GV-TRUST-685B: 12/12 PASS
- GV-TRUST-681A-R1: 7/7 PASS
- GV-QUALITY-680B-R1: inherited PASS
- GV-BOOK-676A: 24/24 PASS
- GV-BOOK-676A-R1: 14/14 PASS
- GV-BOOK-676A browser fixture: 13/13 PASS
- Syntax/module checks: PASS
- Desktop rendered QA: PASS
- 375 × 844 rendered QA: PASS; document width 360px within a 375px viewport, no horizontal overflow
- Browser console: no errors
- Partner-link accessibility and `rel="noopener sponsored"`: PASS

The original complete-trip sequence, all flight and stay cards, Agoda/Aviasales parameters, whole-group budget semantics, GV-TRUST-685B confidence, mobile accessibility and separate checkout disclosure remain intact.
