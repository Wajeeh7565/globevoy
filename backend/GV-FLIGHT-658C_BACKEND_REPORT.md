# GV-FLIGHT-658C — City-night date alignment

## Scope
Backend-only follow-up to GV-FLIGHT-658B.

## Reason
GV-FLIGHT-658B fixed the severe far-future provider-date bug, but a 6-night / 3-stop route could still drift inside the trip window. Example: a route with 2 nights per city could show Jul 8, Jul 13, and Jul 15, which does not match the displayed city-night structure.

## Changes
- Updated generated-tour version to `1.5.4-gv-flight-658c-city-night-date-alignment`.
- Replaced loose later-leg default window with strict city-night alignment.
- First useful departure may still scan up to the next 6 months.
- After the first leg, each next leg defaults to the exact planned date based on the previous city stay nights.
- Provider observations after the aligned planned date are rejected by default and replaced with an automatic estimated date.
- Added optional override `GV_FLIGHT_658C_LEG_ALIGNMENT_DAYS` for future experimentation, capped at 3 days. Default is 0.
- Added `automaticAlignedLegDate()` to prevent fallback/original leg dates from drifting outside the city-night plan.
- Preserved budget guardrail, YUL normalization, ground-transfer wording, and Figma-style generated-tour output.

## Expected behavior
For a 6-night / 3-stop tour with 2 nights per city:

- Day 1: origin → city 1
- Day 3: city 1 → city 2
- Day 5: city 2 → city 3
- Day 7: city 3 → origin

For example, if the first leg starts Jul 8, the aligned route should be approximately:

- Jul 8
- Jul 10
- Jul 12
- Jul 14

Provider-backed dates can be used only when they match the aligned itinerary date by default.

## Validation performed
- Node syntax check passed for `generated-tour.js`.
- Helper validation confirmed default later-leg window is 0 days.
- Helper validation confirmed a provider date of Jul 13 is rejected when the aligned planned date is Jul 10.
- Helper validation confirmed optional one-day tolerance includes Jul 11 but not Jul 13.

## Deployment
Deploy this backend over GV-FLIGHT-658B / GV-ORIGIN-RANK-658A backend.

No frontend deployment is required.

Recommended flag:

```text
ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B=true
```

Do not set `GV_FLIGHT_658C_LEG_ALIGNMENT_DAYS` unless intentionally testing relaxed alignment.
