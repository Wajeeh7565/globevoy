# GV-REC-702C — Bounded Provider Recovery Smoke

## Purpose

GV-REC-702B identified 143 mapped, reviewed-inactive cities that are due now for a first recovery check and were not already re-run in July's GV-CITY-668S Recovery150 wave.

702C does **not** re-run all 143. It defines a first Smoke10 cohort so provider behavior, quota consumption, runtime, and evidence quality can be checked before scaling.

## Smoke10 selection

The deterministic plan uses the 702B ordering at the fixed August 20, 2026 validation time and then applies these requirements:

- lane: `due-now-first-recovery`;
- primary blocker: `retry-queue:missing-flight-observations`;
- `previousRecovery668S: false`;
- `reviewDue: true`;
- hard maximum: 10 cities.

The validated Smoke10 cohort is:

1. Adrar, Algeria
2. Ahe, French Polynesia
3. Alotau, Papua New Guinea
4. Aasiaat, Greenland
5. Abymes, Guadeloupe
6. Acapulco, Mexico
7. Anjouan, Comoros
8. Antsiranana, Madagascar
9. Aalborg, Denmark
10. Aalesund, Norway

This deliberately samples under-covered regions while keeping the common missing-flight-observation blocker.

## Reused July recovery limits

702C preserves the proven 668S flight-search policy:

- 4 flight months;
- 6 regional anchors;
- maximum 20 flight attempts per city;
- maximum comfort duration 1,080 minutes;
- maximum 1 transfer;
- maximum gateway transfer 180 minutes;
- thresholds are not relaxed.

The existing `provider-live-coverage.js` verifier already contains these hard caps and the 668S recovery anchor behavior.

## Flight-only execution

The existing batch verifier checks Travelpayouts and Agoda together. That is appropriate for general coverage auditing but wasteful for this Smoke10 because all selected cities are blocked primarily by missing flight observations and already have accepted static stay mappings.

For the live smoke, the operator should therefore call the existing internal `verifyTravelpayouts` verifier directly from a temporary CloudShell workspace. This reuses the production-tested provider logic while avoiding unnecessary Agoda calls.

No live-provider execution code or credential handling is committed to GitHub by 702C.

## Credential boundary

The live Smoke10 should:

- obtain the existing Travelpayouts token at runtime from the authorized AWS environment without printing it;
- keep the token only in the temporary CloudShell process environment;
- never copy the token into GitHub, Amplify, frontend code, or the public staging Lambda;
- unset the token after the smoke completes.

Reading the existing production Lambda configuration for the credential does not modify production, but the Smoke10 does consume the shared Travelpayouts provider quota. This must be stated explicitly before execution.

## Evidence boundary

A successful provider observation is only a **recovery candidate**. It does not automatically activate the city.

After the smoke:

- save the raw/sanitized provider evidence locally;
- review route, duration, transfers, freshness, and provider eligibility;
- do not modify the 668T activation snapshot automatically;
- preserve exact-itinerary verification for any later user-facing recommendation.

## Safety

702C planning code:

- makes no provider calls;
- contains no credentials;
- exposes no new HTTP endpoint;
- adds no Lambda environment variables;
- does not call Agoda;
- does not modify generated-tour ranking or candidate selection;
- does not activate or deactivate any city;
- does not change `backend/lambda.js`;
- does not touch production or `main`.

The live CloudShell smoke is a separate explicit operator action performed only after CI validates the Smoke10 plan.
