# GV-PROD-669B — Targeted MVP validation repairs

## Purpose

GV-PROD-669B repairs the three real blockers discovered by the GV-PROD-669A Smoke6 run while preserving the verified GV-CITY-668T activation baseline.

## Observed blockers

1. Montreal generated a route containing Havana, which is reviewed inactive under GV-CITY-668T.
2. The same Havana stop did not expose a valid date-prefilled Agoda link.
3. `New York (JFK)` resolved to New Orleans (`MSY`) because the origin parser interpreted the ordinary word `New` as airport code `NEW` before reading the explicit `(JFK)` code.

## Repairs

- Added `ENABLE_MVP_VALIDATION_REPAIRS_669B` as a narrow rollback flag.
- Origin parsing now accepts explicit parenthesized IATA codes, exact three-letter inputs, and explicit uppercase IATA tokens; ordinary title-case city words are no longer treated as airport codes.
- New York `(JFK)` resolves to New York/JFK in both route-graph and global-fallback origin resolvers.
- Deterministic route-graph anchor, second-stop, third-stop, and global-fallback pools are filtered through the current verified production-active allowlist when the 669B flag is enabled.
- The final generated-tour candidate merge and final response include an additional production-active destination safety gate.
- Existing hotel link construction remains unchanged; active destinations retain date-prefilled Agoda search or hotel links. The Montreal hotel-link blocker was downstream of the inactive Havana selection.

## Baseline preserved

- Activation version: GV-CITY-668T
- Audited: 1,000/1,000
- Production-active: 439
- Reviewed inactive: 561
- Unaudited: 0

No activation threshold, provider policy, hotel-quality rule, flight-comfort rule, frontend file, or city count was changed.

## Validation

- GV-PROD-669B targeted validation: 16/16 passed
- GV-CITY-668T: 76/76 passed
- GV-CITY-668S: 52/52 passed
- GV-CITY-668R: 73/73 passed
- GV-CITY-668Q: 67/67 passed
- GV-CITY-668P: 73/73 passed
- GV-CITY-668O: 53/53 passed
- GV-CITY-668N: 70/70 passed
- GV-CITY-668M: 50/50 passed
- GV-CITY-668E: 40/40 passed
- GV-CITY-668B: 30/30 passed
- GV-CONTROL-667D frontend compatibility: 21/21 passed
- JavaScript syntax: 91/91 passed

## Deployment

Upload the 669B backend ZIP to the existing Lambda and add:

`ENABLE_MVP_VALIDATION_REPAIRS_669B=true`

Keep:

- `ENABLE_VERIFIED_CITY_ACTIVATION_668T=true`
- existing provider credentials and feature flags

No frontend deployment is required.

After deployment, run `Run-GV-PROD-669B-Repair-Smoke.ps1`, then rerun the GV-PROD-669A R4 Smoke6 validator.
