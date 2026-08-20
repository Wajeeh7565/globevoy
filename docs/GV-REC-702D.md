# GV-REC-702D — Staging-Only Reviewed Recovery QA

## Goal

Exercise the two freshly reviewed recovery candidates from GV-REC-702C-R2 inside the real generated-tour eligibility gate on the isolated staging Lambda before any production activation snapshot is changed.

Reviewed QA cities:

- Acapulco, MX (`acapulco-mx`)
- Aalesund, NO (`aalesund-no`)

## Historical baseline

GV-CITY-668T remains immutable and still reports 439 production-active cities. Both reviewed QA cities remain inactive in 668T.

GV-REC-702C-R2 records two fresh recovery candidates and projects 441 only if a later reviewed promotion is performed.

## Staging QA architecture

702D adds:

- `backend/services/staging-reviewed-recovery-702d.js`
- `backend/staging-lambda-702d.js`
- `backend/validate-gv-rec-702d.js`

The 702D Lambda wrapper installs the reviewed eligibility overlay before the ordinary staging Lambda loads `backend/lambda.js`. This allows `generated-tour.js` to capture the staging-only `liveRecommendationEligible` function at module-load time while leaving the production handler source unchanged.

## Fail-closed requirements

The overlay is enabled only when all of these are true:

1. `CORS_ORIGIN` normalizes exactly to `https://staging.dy4fw8gx1ccie.amplifyapp.com`
2. `ENABLE_VERIFIED_CITY_ACTIVATION_668T=true`
3. `ENABLE_STAGING_REVIEWED_RECOVERY_702D=true`

Generated-tour enforcement also requires the existing:

`ENABLE_MVP_VALIDATION_REPAIRS_669B=true`

The dedicated QA handler is:

`staging-lambda-702d.handler`

## Effective QA state

With all QA conditions enabled:

- historical 668T active count: 439
- reviewed staging QA additions: 2
- effective staging QA eligibility: 441

The effective 441 count is a staging QA state only. It is not a new production activation snapshot.

## What becomes eligible

Only the two GV-REC-702C-R2 records that satisfy the reviewed evidence contract are overlaid:

- Acapulco
- Aalesund

Aalborg remains blocked because its fresh flight evidence failed the existing comfort qualification.

All unrelated 668T-inactive cities remain blocked.

## Trust boundary

702D does not:

- modify `verified-city-activation-1000-668t.json`;
- modify `backend/lambda.js`;
- relax flight or hotel quality thresholds;
- change provider credentials;
- make provider calls by itself;
- change ranking, pricing, or route logic;
- remove exact itinerary verification requirements;
- activate anything in production.

Every overlaid record includes `stagingQaOnly: true`, `actualProductionActivationWritten: false`, and `requiresExactItineraryVerification: true`.

## Rollback

Rollback is intentionally simple:

1. restore the staging Lambda handler to `staging-lambda.handler`;
2. remove or set `ENABLE_STAGING_REVIEWED_RECOVERY_702D=false`.

The historical 668T snapshot never changes, so rollback does not require rebuilding activation data.

## Acceptance

Before live staging QA, CI must prove:

- 668T still reports exactly 439 active;
- Acapulco/Aalesund are inactive before the overlay;
- they become eligible only with exact staging + 668T + 702D conditions;
- Aalborg remains blocked;
- generated-tour's production-active gate accepts the two reviewed QA recoveries;
- turning the 702D flag off restores the original 668T decisions immediately;
- the production handler source remains unchanged and CI remains deployment-free.
