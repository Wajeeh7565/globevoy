# GV-REC-702D-R1 — Curated 1,000-city route-surface QA

## Purpose

GV-REC-702D proved that Acapulco and Aalesund can be overlaid as staging-only reviewed recovery candidates while GV-CITY-668T remains the immutable 439-city historical activation snapshot.

R1 closes the route-surface gap discovered during live staging QA: the generated-tour global route graph only uses the curated 1,000-city registry when `ENABLE_UNIFIED_CITY_REGISTRY_668A=true`. Without that flag, the reviewed recoveries can pass the eligibility function but still remain outside the generated-tour destination surface.

## Required staging QA settings

The 702D QA handler remains `staging-lambda-702d.handler`.

For the generated-tour route graph to exercise the reviewed 1,000-city surface, staging QA requires:

- `CORS_ORIGIN=https://staging.dy4fw8gx1ccie.amplifyapp.com/`
- `ENABLE_VERIFIED_CITY_ACTIVATION_668T=true`
- `ENABLE_MVP_VALIDATION_REPAIRS_669B=true`
- `ENABLE_STAGING_REVIEWED_RECOVERY_702D=true`
- `ENABLE_UNIFIED_CITY_REGISTRY_668A=true`
- `ENABLE_PROVIDER_MAPPING_COMPLETION_668B=true`

The last two settings select the curated 1,000-city registry and its reviewed provider-mapping completion data. They do not make all 1,000 cities live. The verified activation gate still filters destinations through 668T, with 702D adding only the two reviewed recovery candidates in staging QA.

## Expected state

- curated route-surface rows: 1,000
- historical GV-CITY-668T production-active count: 439
- staging-only reviewed recoveries: 2
- effective staging QA verified-active route surface: 441
- Acapulco: eligible under 702D QA
- Aalesund: eligible under 702D QA
- Aalborg: still blocked
- production activation written: false
- thresholds relaxed: false

## CI proof

`backend/validate-gv-rec-702d-r1.js` validates the full route-surface combination without provider credentials or network calls. It checks the actual global route graph diagnostics and requires `verifiedActiveDestinationCount === 441`.

It also flips `ENABLE_STAGING_REVIEWED_RECOVERY_702D=false` in-process and requires the same curated route surface to return immediately to 439.

## Rollback

For a full 702D QA rollback:

1. restore Lambda handler to `staging-lambda.handler`;
2. remove/disable `ENABLE_STAGING_REVIEWED_RECOVERY_702D`;
3. optionally remove the two route-surface QA flags (`ENABLE_UNIFIED_CITY_REGISTRY_668A`, `ENABLE_PROVIDER_MAPPING_COMPLETION_668B`) if staging should return to the earlier route-candidate surface.

No production/main change is part of this task.
