# GV-FLIGHT-658B Backend Report

## Scope
Chronological date-window guardrail for automatic cheap-date tour builder.

## Problem fixed
GV-ORIGIN/RANK-658A could select cheap provider observations that were chronological but too far apart for the user-visible trip length. Example: a 6-night Montreal route could show Jul 8, Aug 9, and Jan 1 dates because later legs picked cheap provider dates months after the planned stay window.

## Changes
- Added `automaticLegWindowDays()` with default 3-day tolerance after each planned stop window.
- Added `maxAllowedDepartureDate()` and date-window filtering for later legs.
- First flight leg may still scan the next 6 months to choose the trip start.
- Subsequent legs must stay inside the planned trip window after each stop.
- If no provider observation exists inside that window, the backend falls back to an automatic estimated date instead of using a far-future cheap provider date.
- Preserved budget guardrail, YUL display normalization, ground-transfer wording, and automatic cheap-date builder.

## Expected behavior
For a 6-night route, dates should stay close to the route cadence. A cheap fare in August/January should not be used for a July 6-night tour leg.

## Files changed
- `generated-tour.js`

## Deploy notes
Deploy backend only. Current 658A frontend can stay live.

Recommended flags remain:

```text
ENABLE_GENERATED_TOUR_651A=true
ENABLE_MULTICITY_ROUTE_610B=true
ENABLE_BUDGET_ADAPTIVE_ROUTES_620A=true
ENABLE_CHEAP_ONE_WAY_SCANNER_650A=true
ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A=true
ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B=true
TRAVELPAYOUTS_TOKEN=<secure env var>
```

Optional tuning:

```text
GV_FLIGHT_658B_LEG_WINDOW_DAYS=3
```
