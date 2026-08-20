# GV-FLIGHT-657B Backend Report

## Task
Automatic cheap-date generated-tour builder.

## Goal
Move cheap-date logic from a user-triggered calendar into the generated-tour intelligence flow. Users still see the Figma-style final tour, while the backend automatically scans one-way legs, chooses useful cheap dates when provider observations are available, and creates a chronological route plan.

## What changed
- Updated `generated-tour.js`.
- Added `automaticCheapDateTourBuilderEnabled()`.
- GV-FLIGHT-657B is enabled automatically when `ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A=true`, unless explicitly disabled.
- The generated tour now builds dates sequentially:
  1. Choose origin → first stop date.
  2. Add the planned nights for the first stop.
  3. Choose the next leg date after that stay.
  4. Continue through return leg.
- Provider observations are filtered so later legs cannot select dates before the previous city stay is complete.
- If provider observations are unavailable, the backend still builds a chronological estimated plan, with honest labels.
- Raw flight-search details remain hidden from the user.
- Budget guardrail is preserved: provider fares are not applied if they would push the route over the user budget.

## New metadata returned
`tour.cheapFlightScanner` now includes:
- `version: GV-FLIGHT-657B`
- `automaticTourBuilder: true`
- `chronologicalDatePlan: true`
- `selectedProviderDateCount`
- `estimatedDateFallbackCount`
- `scannedLegs[].minDepartureDate`
- `scannedLegs[].automaticTourDate`

Each leg can include:
- `automaticTourDate`
- `dateSource`
- `providerDateEvidence`
- `cheapestOneWay`

## Important honesty note
This does not magically guarantee live fares for every route. If Travelpayouts/Aviasales data is not available for a leg, Globevoy uses a chronological planning estimate and labels it honestly. When provider-backed observations are available, they can be applied automatically to the tour.

## Validation run
- Syntax check passed: `node --check generated-tour.js`.
- Local no-token generated-tour test passed:
  - route remains supported;
  - dates are chronological;
  - scanner reports provider unavailable instead of pretending live data exists.
- Stubbed provider test passed:
  - first leg selected provider-backed cheap date automatically;
  - next ground leg departed after the planned stop nights;
  - return leg did not choose an invalid earlier date;
  - budget guardrail preserved.

## Deployment
Deploy this backend over GV-FLIGHT-657A backend. Keep the current frontend unless further UI changes are requested.

## Recommended flags
Required/current:
```
ENABLE_GENERATED_TOUR_651A=true
ENABLE_MULTICITY_ROUTE_610B=true
ENABLE_BUDGET_ADAPTIVE_ROUTES_620A=true
ENABLE_CHEAP_ONE_WAY_SCANNER_650A=true
ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A=true
TRAVELPAYOUTS_TOKEN=<secure env var>
```

Optional explicit flag:
```
ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B=true
```

Optional later after smoke test:
```
ENABLE_PROVIDER_CHEAP_DATE_ROUTE_RANKING_657A=true
```
