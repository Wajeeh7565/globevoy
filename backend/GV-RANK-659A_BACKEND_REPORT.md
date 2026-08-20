# GV-RANK-659A — Route Ambition Ranking

## Scope
Backend-only update built on `GV-FLIGHT-658C`.

## Goal
Improve generated-tour selection so medium/higher budgets do not default to overly local/regional routes when a more memorable international value route fits the same budget.

## Key changes
- Added route ambition ranking for medium/high protected-budget searches.
- Introduced an `ambitious-value` budget band for suitable budgets.
- For ambitious-value budgets, candidate generation now considers farther international city pairs/triples instead of only the nearest regional cities.
- Ranking now rewards:
  - international/cross-country variety;
  - meaningful distance from origin when budget supports it;
  - Group 1/Group 2 mix;
  - hotel/provider readiness;
  - budget fit.
- Preserved:
  - budget guardrail;
  - city-night date alignment from GV-FLIGHT-658C;
  - YUL/YYZ airport clarity;
  - ground-transfer labels;
  - automatic cheap-date final-tour flow.
- Added rollback-safe environment control:
  - `ENABLE_ROUTE_AMBITION_RANKING_659A=false` disables the ambition behavior and returns to the previous regional behavior for this budget range.

## Local validation examples
Environment used:
- `ENABLE_GENERATED_TOUR_651A=true`
- `ENABLE_MULTICITY_ROUTE_610B=true`
- `ENABLE_BUDGET_ADAPTIVE_ROUTES_620A=true`
- `ENABLE_CHEAP_ONE_WAY_SCANNER_650A=true`
- `ENABLE_CHEAP_ONE_WAY_MONTH_SCAN_657A=true`
- `ENABLE_AUTOMATIC_CHEAP_DATE_TOUR_BUILDER_657B=true`

Results without provider token:
- Toronto / CAD 2000 -> Panama City + Cartagena, 6 nights, 2 stops, estimated C$1748, dates Jul 8 -> Jul 11 -> Jul 14.
- Toronto / CAD 1500 -> Buffalo + Pittsburgh, 6 nights, 2 stops, estimated C$1347, dates Jul 8 -> Jul 11 -> Jul 14.
- Montreal / CAD 2000 -> Queretaro + San Miguel de Allende, 6 nights, 2 stops, estimated C$1728, dates Jul 8 -> Jul 12 -> Jul 14.

## Notes
This does not claim live final prices. Provider-backed fare observations are still used when available; otherwise Globevoy keeps honest planning estimates and partner confirmation wording.
