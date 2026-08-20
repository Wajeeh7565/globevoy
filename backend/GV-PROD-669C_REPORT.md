# GV-PROD-669C - Budget-Safe Route Recovery

## Purpose

GV-PROD-669C repairs the final remaining Smoke6 blocker discovered after GV-PROD-669B. Montreal with a CAD 1,500 budget was correctly resolving to YUL and no longer returning inactive Havana, but live provider verification could raise the selected two-city route above the entered budget. The backend then rejected the entire request with `provider-verified-route-over-budget`.

## Repair

When the final provider-verified route exceeds the user's budget, the generated-tour service now performs a bounded recovery attempt with one fewer destination stop. For a six-night request, this changes the route cap from two destinations to one destination. The lower-stop candidate is regenerated, enriched, re-verified with live providers, checked against the unchanged production-active allowlist, date-synchronized, and tested against the same budget and quality guardrails.

The deterministic global route graph also now obeys an explicit one-stop cap. Previously it always continued building two-stop candidates after creating single-destination fallbacks, which prevented the recovery request from actually narrowing the route.

## Safety properties

- No budget tolerance, provider-quality threshold, flight-comfort threshold, hotel-quality threshold, or city-activation threshold is relaxed.
- GV-CITY-668T remains the activation baseline: 1,000 audited, 439 production-active, 561 reviewed inactive, zero unaudited.
- GV-PROD-669B remains active, so inactive destinations such as Havana are blocked and `New York (JFK)` continues resolving to New York/JFK.
- Recovery is bounded and stops at one destination. If a one-destination route is still over budget, the honest unsupported response remains.
- The response diagnostics report when 669C recovery was used and explicitly record `thresholdsRelaxed: false`.
- No frontend changes are required.

## Deployment

Deploy `lambda-gv-prod-669c-budget-safe-route-recovery.zip` to the existing Lambda and set:

`ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C=true`

Keep these enabled:

- `ENABLE_MVP_VALIDATION_REPAIRS_669B=true`
- `ENABLE_VERIFIED_CITY_ACTIVATION_668T=true`

## Validation performed

- GV-PROD-669C targeted validation: 22/22
- GV-PROD-669B regression: 16/16
- GV-CITY-668T regression: 76/76
- GV-CITY-668S regression: 52/52
- GV-CITY-668R regression: 73/73
- GV-CITY-668Q regression: 67/67
- GV-CITY-668P regression: 73/73
- GV-CITY-668O regression: 53/53
- GV-CITY-668N regression: 70/70
- GV-CITY-668M regression: 50/50
- GV-CITY-668E regression: 40/40
- GV-CITY-668B regression: 30/30
- JavaScript syntax checks: 92/92
- ZIP integrity and secret-pattern scans passed.

The live Montreal provider outcome can only be confirmed after deployment because provider observations are time-sensitive. The included PowerShell smoke test validates Montreal CAD 1,500, active destinations, visible budget fit, date-prefilled hotel links, and the New York origin regression.
