# GV-GUARD-664A — Route Feasibility and Airport Integrity

## Purpose

This backend-only release prevents the generated-tour/LLM pipeline from selecting routes that are technically under budget but operationally unrealistic, rushed, geographically incoherent, or mapped to the wrong airport.

It builds on GV-LINK-663A and preserves bookable partner handoff links, price provenance, budget guardrails, cheap-date logic, city-night date alignment, real-map frontend compatibility, and deterministic/LLM route curation.

## Changes

### Trip-length stop guardrail

- 5–6 nights: maximum 2 destination stops.
- 7–10 nights: maximum 3 destination stops.
- 11–14 nights: maximum 4 destination stops.
- Every destination must receive at least 2 nights.
- Generated-tour controls cannot add a city beyond the trip-length/budget cap.

### Geographic feasibility

Candidates are rejected before the LLM curator can rank them when they contain:

- excessive geographic backtracking;
- more than two macro-regions in a trip of 10 nights or less;
- an isolated long-haul outlier after multiple regional stops;
- duplicate cities;
- a route that is too rushed for its stop count.

This specifically blocks the observed pattern similar to:

`Toronto → Denver → Quebec City → Montreal → Ottawa → Lucca → Toronto`

for an 8-night trip.

### Airport integrity

- Toronto city searches default to Toronto Pearson (YYZ), unless the user explicitly selects YHM or YTZ.
- Tehran international generated tours default to Imam Khomeini International (IKA); THR remains available only for an explicit domestic-airport context.
- Lucca is represented through Pisa (PSA) with ground-transfer metadata instead of pretending Lucca has an ordinary flight airport.
- Leg endpoints are synchronized with the normalized origin/destination airport codes before provider scans and partner links are built.

### LLM safety boundary

The feasibility guard runs before deterministic/Gemini route ranking. The LLM can only rank candidates that already pass:

- budget safety;
- trip-length rules;
- geographic checks;
- airport integrity.

The selected final tour is validated again after provider-date enrichment.

## Feature flag

Enabled by default in this package. Explicit rollback:

```text
ENABLE_ROUTE_FEASIBILITY_GUARD_664A=false
```

Recommended explicit production setting:

```text
ENABLE_ROUTE_FEASIBILITY_GUARD_664A=true
```

## Validation

Offline/provider-unavailable validation passed for:

- Toronto / CAD 3,000 / 8 nights / requested 5 stops
- Toronto / CAD 2,000 / 6 nights
- Montreal / CAD 1,500 / 6 nights
- Tehran / CAD 1,500 / 5 nights
- London / GBP 1,500 / 6 nights

Additional tests passed:

- synthetic 5-stop Toronto/Denver/Quebec/Montreal/Ottawa/Lucca route was rejected;
- Toronto was normalized from YHM to YYZ for a Toronto city search;
- Tehran international origin resolved to IKA;
- Lucca resolved through PSA with ground-transfer metadata;
- Add Destination was blocked after a 6-night route already had 2 stops;
- all JavaScript syntax checks and JSON parsing passed.

## Important limitation

This validation was performed without making live provider calls. Travelpayouts/Aviasales and Agoda availability, exact prices, deep links, and schedules must still be confirmed in staging with the production API credentials. This release validates route structure and airport integrity; it does not make estimated prices live or guaranteed.

## Deployment

Deploy the backend ZIP only. Keep the current GV-CALENDAR-663B frontend.

After deployment, hard-refresh and test:

- Toronto / CAD 3,000 / 8 nights
- Toronto / CAD 2,000 / 6 nights
- Montreal / CAD 1,500 / 6 nights
- Tehran / CAD 1,500 / 5 nights
- London / GBP 1,500 / 6 nights

Confirm that the route has no more than the allowed stops, every destination has at least 2 nights, Toronto shows YYZ, Tehran shows IKA, and partner links remain functional.
