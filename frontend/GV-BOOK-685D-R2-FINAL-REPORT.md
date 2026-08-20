# GV-BOOK-685D-R2 — Immediate Trust Repair

## Outcome

Completed a narrow frontend-only repair on the authenticated GV-BOOK-685D-R1 baseline. The patch corrects four customer-trust issues without changing providers, backend behavior, trip generation, price calculation, metro-airport evidence, payments, orders or deployment configuration.

## Repairs

### 1. Ground transport no longer inherits a flight handoff

- A ground, rail, bus, train or transfer leg no longer calls the Aviasales flight URL builder.
- An Aviasales, Agoda or Duffel URL attached to a ground leg is rejected.
- An explicit non-flight transport URL may be preserved when one already exists; R2 does not generate or introduce a provider URL.
- Without a valid ground provider, the card says `Ground transfer estimate`, `Rail or bus partner search is not yet connected` and `Transport partner pending`.

### 2. Hotel evidence is conservative

- A selected Agoda property no longer implies that the displayed amount was observed as a corresponding current Agoda rate.
- The standard label is `Estimated stay cost — selected property on Agoda`.
- Cached evidence is labelled `Cached stay estimate — selected property on Agoda`.
- Agoda remains responsible for confirming current room availability, taxes, fees and final price.

### 3. Partially verified totals are visibly estimated

- The summary label becomes `Estimated trip total` whenever the 685B confidence result is not `provider-backed-fit`.
- Partial-evidence messaging explicitly says the current trip total remains an estimate.
- Over-budget messaging refers to the estimated whole-group total.
- A fully provider-backed confidence result may use `Provider-backed trip total`, still with the existing recheck-before-purchase caveat.

### 4. Partner terminology is honest

- `Partner checkout` and `Separate partner checkouts` were replaced with `Book with partners`.
- The page continues to state that flights and stays are booked separately with their respective partners.
- No payment, confirmation, ticket or combined-booking claim was added.

## Exact production runtime delta from R1

Changed:

- `booking.html`
- `scripts/booking-hub-685d.js`

Unchanged runtime assets include:

- `styles/booking-hub-685d.css`
- `scripts/booking-live-673d.js`
- `scripts/budget-confidence-685b.js`
- `runtime/api-client.js`
- `runtime/config.js`
- all backend/Lambda/provider code

## Validation

- GV-BOOK-685D-R2: 18/18 PASS
- GV-BOOK-685D: 17/17 PASS
- GV-TRUST-685B: 12/12 PASS
- GV-TRUST-681A-R1: 7/7 PASS
- GV-QUALITY-680B-R1 inherited: PASS
- GV-BOOK-676A: 24/24 PASS
- GV-BOOK-676A-R1: 14/14 PASS
- GV-BOOK-676A browser fixture: 13/13 PASS
- Syntax/module checks: PASS
- Desktop rendered QA: PASS
- 375 × 844 mobile rendered QA: PASS; no horizontal overflow
- Browser console/dev errors: none

## Scope boundary

No live provider call was made. No provider was added. No backend, Lambda, environment variable, payment, order, ticket, authentication or transaction capability changed. No deployment was performed.
