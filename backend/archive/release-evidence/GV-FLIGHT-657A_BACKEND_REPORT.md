# GV-FLIGHT-657A Backend Report

Task: Cheap one-way flight/date scanner for generated multi-city tours.

Baseline:
- Backend: `lambda-gv-budget-656a-r2-min-two-stop-guardrail.zip`
- Frontend baseline remains: `frontend-staging-gv-budget-656a-r2-min-two-stop-guardrail-flag-on.zip`

Scope:
- Backend only.
- No UI redesign.
- No login, booking/payment, city expansion, or hotel-scoring work.

Changes:
- Added `fetchCheapestOneWayAcrossMonths()` to `services/cheap-one-way-flights.js`.
- Month-window scanner checks up to the next 6 months for a one-way leg.
- It deduplicates by departure date, sorts by price/timing/date, and selects the best usable cheap date.
- Generated-tour enrichment can now attach six-month cheap-date evidence to route legs.
- Generated-tour summary now reports GV-FLIGHT-657A scan policy and scanned month metadata.
- Optional provider-backed route ranking added behind `ENABLE_PROVIDER_CHEAP_DATE_ROUTE_RANKING_657A=true`.
- `/api/cheap-one-way-flights` can return a month-window scan when `months` is passed or `ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A=true`.
- Fixed a pre-existing over-budget global fallback branch that referenced an undefined `base` variable.

Recommended environment flags:
- Required existing generated-tour flags:
  - `ENABLE_GENERATED_TOUR_651A=true`
  - `ENABLE_MULTICITY_ROUTE_610B=true`
  - `ENABLE_BUDGET_ADAPTIVE_ROUTES_620A=true`
- Flight scanner:
  - `ENABLE_CHEAP_ONE_WAY_SCANNER_650A=true`
  - `ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A=true`
  - `TRAVELPAYOUTS_TOKEN=<secure env var>`
- Optional route reranking:
  - `ENABLE_PROVIDER_CHEAP_DATE_ROUTE_RANKING_657A=true`

Important honesty:
- If `TRAVELPAYOUTS_TOKEN` is not present, the scanner returns provider-unavailable and keeps planning estimates.
- The user still sees only the final generated tour, not raw flight-search charts.
- Provider fares are not applied if they would break the budget guardrail.

Validation run:
- `node -c services/cheap-one-way-flights.js`
- `node -c generated-tour.js`
- `node -c lambda.js`
- `node -c server.js`
- Mock provider test: 3-month scan selected the cheapest August observation.
- Local generated-tour smoke test without provider token: Toronto C$1500 returned a 2-stop budget-fit tour and reported GV-FLIGHT-657A scanner metadata with provider-unavailable month rows.

Changed backend files:
- `services/cheap-one-way-flights.js`
- `generated-tour.js`
- `lambda.js`
- `server.js`
- `GV-FLIGHT-657A_BACKEND_REPORT.md`
