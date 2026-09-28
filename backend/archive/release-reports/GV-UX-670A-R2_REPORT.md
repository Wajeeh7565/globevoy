# GV-UX-670A-R2 — Three-Pick Role Assignment Repair

## Outcome

Repairs the deployed GV-UX-670A backend when a safe candidate route survives graph/legacy merging without an explicit `tourRole`. The original release fell back to an unscoped candidate and honestly returned `roleMatched=false`, which caused the frontend to omit the requested pick.

## Root cause

`roleScopedCandidatePool670a()` only selected an explicitly labelled role. When no labelled candidate survived route deduplication, it returned the entire candidate list. The final tour could therefore have a different role from the requested `lowest-cost`, `best-balance`, or `most-memorable` role.

## Repair

- Preserves explicit planner roles when available.
- Deterministically assigns missing roles from the already budget-safe and route-feasible candidate pool.
- Keeps route structures distinct across the three roles when at least three unique candidates exist.
- Lowest cost uses the lowest safe total.
- Best balance uses budget utilisation, route variety, stop count, and distance.
- Most memorable uses country variety, international reach, distance, and hidden-gem signals.
- Records derived role assignment metadata with `thresholdsRelaxed=false`.
- Does not invent cities, prices, dates, provider evidence, or routes.

## Protected baseline

- Frontend remains GV-UX-670A complete AWS-ready frontend.
- Backend baseline: GV-PROD-669F plus GV-UX-670A.
- City activation remains GV-CITY-668T: 1,000 audited, 439 active, 0 unaudited.

## Version

`2.7.1-gv-ux-670a-r2-role-assignment`

## Feature flag

Continue using:

`ENABLE_MAP_FIRST_THREE_PICKS_670A=true`

No new environment variable is required.

## Validation

- GV-UX-670A-R2 focused checks: 30/30 passed.
- GV-PROD-669B behavioural regression: 16/16 passed.
- GV-CITY-668T regression: 76/76 passed.
- GV-PROD-669F behavioural checks: 24/24 passed; its one legacy version-string assertion is intentionally superseded.
- GV-PROD-669D behavioural checks: 34/34 passed; its one legacy version-string assertion is intentionally superseded.
- GV-PROD-669C behavioural checks: 21/21 passed; its one legacy version-string assertion is intentionally superseded.
- JavaScript syntax: 96/96 passed.

## Frontend deployment note

The frontend ZIP must be extracted before using `aws s3 sync`. `YOUR_BUCKET_NAME` and `YOUR_DISTRIBUTION_ID` are placeholders and must be replaced. AWS CLI deployment also requires an authenticated AWS CLI session. AWS Console upload is the simplest path when CLI credentials are not configured.
