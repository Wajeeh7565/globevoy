# GV-LIVE-667A — Exact-Date Provider Evidence and Bookable Partner Verification

## Scope

Protected baseline:

- Backend: GV-DATE-666B
- Frontend: GV-DATE-666B

This task strengthens the selected generated tour after route generation. It does **not** claim that a comparison link is an exact ticket, and it does not expose provider credentials to the browser.

## Backend changes

### Exact-date flight verification

For each selected flight leg, the backend now:

1. Uses the route's canonical airport codes and official departure date.
2. queries the Travelpayouts/Aviasales date endpoint for that route and month;
3. looks for an observation matching the exact selected date;
4. records provider, route, date, timestamp, cache status, endpoint and evidence freshness;
5. applies the observed per-passenger fare to the full party using GV-MVP-666A pricing;
6. retains a planning estimate when no exact-date observation exists.

Provider evidence is still a fare observation, not guaranteed inventory. Final price and availability remain confirmed on the partner website.

### Exact-stay Agoda verification

For each selected stay, the backend now:

1. uses the itinerary's exact check-in and check-out dates;
2. sends adult/child occupancy to Agoda using per-room occupancy assumptions;
3. preserves the room count calculated by GV-MVP-666A;
4. records the returned rate sample, sample size, exact dates and evidence timestamp;
5. retains the existing planning estimate when Agoda coverage is missing or fails.

The default Agoda endpoint was changed from HTTP to HTTPS.

### Budget claim rules

The generated tour now receives one of three claims:

- `provider-backed-fit` — every critical flight and stay has exact-date provider evidence and the recalculated total fits;
- `estimated-to-fit-budget` — one or more critical prices remain estimates;
- `over-budget-after-provider-verification` — provider evidence raises the route above the entered budget.

A route that becomes over budget after verification is rejected rather than silently showing the old estimate.

### Reverification after route changes

Exact provider verification is rerun after:

- initial tour selection;
- departure-date adjustment;
- route-control edits such as add, replace, shuffle or refresh.

## Partner links

- Provider ticket/deep links are used when supplied by the provider.
- Otherwise Globevoy creates a prefilled Aviasales comparison search using the exact route, date and traveller seat count.
- Agoda links carry exact stay dates, adults, children and room count where supported.
- Ground-transfer legs do not receive misleading flight links.

## Frontend changes

The visualizer now distinguishes:

- `Exact-date provider evidence`
- `Cached exact-date evidence`
- `Exact-date Agoda sample`
- `Planning estimate`
- `Transfer estimate`

The budget pill shows **Provider-backed fit** only when every critical price is verified. Otherwise it remains **Estimated to fit budget**.

The route summary states how many critical prices have exact-date evidence and continues to explain that final inventory and price are confirmed by partners.

## Feature flag

Required to enable this task:

```text
ENABLE_LIVE_PROVIDER_VERIFICATION_667A=true
```

Optional call caps:

```text
GV_LIVE_667A_MAX_FLIGHT_LEGS=4
GV_LIVE_667A_MAX_STAYS=3
```

No new API credential is required. Existing Travelpayouts and Agoda credentials remain server-side.

## Validation

Deterministic provider-shaped tests: **17/17 passed**.

Coverage includes:

- exact route/date fare matching;
- evidence timestamps and cache metadata;
- party-aware flight pricing;
- exact stay dates and room/guest metadata;
- Aviasales and Agoda link payloads;
- provider-backed versus estimated budget claims;
- provider-driven over-budget rejection;
- frontend evidence labels and cache version.

Inherited regressions:

- GV-MVP-666A: **11/11 passed**;
- GV-DATE-666B: **12/12 passed**.

No production provider credential was used during local validation. Live API response shape, access permissions, quotas and partner landing pages must be confirmed after staging deployment.

## Deployment order

1. Deploy the backend ZIP.
2. Add `ENABLE_LIVE_PROVIDER_VERIFICATION_667A=true`.
3. Keep the existing Travelpayouts, Agoda, pricing, date-sync and feasibility flags enabled.
4. Deploy the frontend ZIP.
5. Hard refresh the browser.

## Live QA

Test at minimum:

```text
Toronto / CAD 2000 / 2 adults
Faisalabad / CAD 2000 / 1 adult
Paris / EUR 2000 / 2 adults
Algiers / CAD 1000 / 1 adult
Rabat / CAD 1500 / 1 adult
```

For each route confirm:

- official card dates match the partner search dates;
- passenger and room counts are correct;
- airport codes are correct;
- provider evidence and estimates are clearly separated;
- partner links open useful route/date-aware pages;
- a provider-verified over-budget route is not displayed as fitting the budget.

## Rollback

Set:

```text
ENABLE_LIVE_PROVIDER_VERIFICATION_667A=false
```

This returns the backend to the inherited GV-DATE-666B behavior without removing the package.
