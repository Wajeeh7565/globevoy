# GV-LIVE-667B — Canonical Total and Evidence Integrity

## Purpose

Repair the live generated-tour total/evidence inconsistencies found after GV-LIVE-667A, without changing the approved map-first visual direction or route-generation architecture.

## Protected baseline

- Backend: `lambda-gv-live-667a-exact-provider-evidence-verification.zip`
- Frontend: `frontend-staging-gv-live-667a-exact-provider-evidence-verification.zip`

## Backend changes

### 1. One canonical pricing ledger

Added `services/canonical-total-evidence.js`.

After provider verification and passenger/room pricing, Globevoy now creates one final ledger containing every visible priced component:

- each flight leg;
- each ground-transfer leg;
- each stay;
- nearby-airport access when applicable.

The following are now derived from this same ledger:

- header estimated total;
- visible card totals;
- transport and accommodation subtotals;
- budget status;
- provider-evidence count.

The stale `displayBudget` is rebuilt after live evidence is applied. Per-component displayed amounts are rounded first and then summed, so the header amount equals the sum of the amounts shown on the cards.

### 2. Production-eligible evidence only

Exact-date evidence counts toward the provider-coverage badge only when it is production eligible.

Injected/mock-shaped provider responses are explicitly labelled test-only and do not count as production evidence unless the validation-only switch is deliberately enabled in the test process.

Agoda evidence status changed from `exact-stay-provider-rate-sample` to `exact-stay-provider-rate-evidence`.

The public UI no longer says `Exact-date Agoda sample`.

### 3. Partner-button integrity

`View provider fare` is now reserved for an exact-date, production-eligible verified result with a provider deep link.

Otherwise Globevoy displays `Compare this flight` and opens a prefilled Aviasales comparison search. Exact route, date and passenger data remain attached to the booking record.

Agoda links continue to include exact check-in/check-out dates, adults, children and rooms.

### 4. Paris airport policy

- A normal Paris city search now defaults to `CDG`.
- `ORY` remains valid when explicitly selected.
- `BVA` is retained only when deliberately selected by the user.
- Explicit BVA use includes a nearby-airport ground-access planning estimate.
- A Paris destination carrying a generic BVA fallback is normalized to CDG before route use.

## Frontend changes

- Header total prefers `canonicalPricing.canonicalDisplayTotal`.
- Flight and stay cards use their canonical component amounts.
- Exact Agoda evidence is labelled `Exact-date Agoda evidence`.
- Test-only/non-production evidence is shown as an estimate.
- Nearby-airport access is shown on the origin card when it contributes to the total.
- Cache version bumped to `667b`.

## Feature flag

Add:

```text
ENABLE_CANONICAL_TOTAL_EVIDENCE_INTEGRITY_667B=true
```

Keep:

```text
ENABLE_LIVE_PROVIDER_VERIFICATION_667A=true
ENABLE_PASSENGER_ROOM_PRICING_666A=true
ENABLE_CANONICAL_ITINERARY_DATE_SYNC_666B=true
```

Rollback is available by setting the new 667B flag to `false` and redeploying the 667A packages.

## Validation

Passed:

- GV-LIVE-667B: 19/19
- GV-LIVE-667A regression: 17/17
- GV-DATE-666B regression: 12/12
- GV-MVP-666A regression: 11/11
- JavaScript syntax scan: passed for all backend JavaScript files

Key validated cases:

- a deliberately stale header total is replaced by the final visible-card sum;
- evidence counts and budget claims use the same final ledger;
- injected Agoda/flight responses do not count as production evidence by default;
- exact route/date and hotel-date partner-link fields remain correct;
- Paris defaults to CDG;
- explicit BVA adds airport-access cost;
- frontend no longer contains the `Exact-date Agoda sample` production label.

## Live QA still required

Automated tests used deterministic provider-shaped responses and no production credentials. After deployment, verify:

1. the header total equals the sum of all visible route-card amounts;
2. Agoda/Aviasales landing pages carry the correct dates and party information;
3. provider coverage changes only when exact production API evidence is returned;
4. a normal Paris search displays CDG, not BVA;
5. an explicitly selected BVA origin displays the airport-access estimate.

Final inventory, availability and price remain confirmed on partner websites.
