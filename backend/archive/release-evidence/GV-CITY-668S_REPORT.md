# GV-CITY-668S — Inactive City Recovery Wave 1

## Status

Package built and locally validated. No live provider audit has been run from this environment, and the production activation allowlist has not been changed.

## Baseline

GV-CITY-668R remains authoritative:

- Registry: 1,000 cities
- Audited: 1,000
- Production-active: 421
- Reviewed inactive: 579
- Unaudited: 0

## Recovery target

668S selects 150 reviewed-inactive cities with the strongest safe recovery potential:

- 64 `readiness-recovery` targets: both providers were verified, but flight comfort and/or hotel quality blocked activation
- 6 `stay-recovery` targets: flight capability is live and the Agoda mapping is resolved, but the stay side is not production-qualified
- 80 `flight-recovery` targets: a quality-qualified stay is live, but no acceptable flight observation was found

Selection composition:

- Current-500: 53
- Expansion-500: 97
- Group 1 anchors: 25
- International-airport signal: 114
- Gateway-transfer targets: 2

All 130 unresolved Agoda mappings are excluded from Wave 1. They require a separate mapping-repair workflow and are not safely recoverable by substituting another hotel market.

## Recovery policy

The authenticated provider verifier gains an additive recovery mode:

- Four flight months
- Six country/regional origin anchors
- Up to 20 bounded flight attempts
- Up to 12 flight observations per request
- Four hotel date windows
- Three Agoda quality retrieval strategies
- Up to 30 Agoda candidates per strategy
- Existing maximum flight duration remains 1,080 minutes
- Existing maximum transfer count remains one
- Existing gateway-transfer limit remains 180 minutes
- No production qualification threshold is relaxed

Normal 668E verification behavior remains unchanged unless recovery mode or the 668S feature flag is active.

## API

Read-only plan endpoint:

`GET /api/inactive-city-recovery-wave1`

Supported filters include recovery lane, retry queue, region, tier, group, airport signal and gateway status.

Authenticated provider auditing continues through:

`POST /api/provider-live-coverage/verify`

## Feature flag

Set:

`ENABLE_INACTIVE_CITY_RECOVERY_668S=true`

Keep:

`ENABLE_VERIFIED_CITY_ACTIVATION_668R=true`

The 421-city allowlist stays unchanged until audit results are reviewed and merged into a later activation snapshot.

## Audit runner

`Run-GV-CITY-668S-Inactive-Recovery-Wave1.ps1`

Modes:

- `Smoke5`
- `Recovery150`

The Smoke5 set covers comfort, hotel quality, stay recovery, flight recovery and gateway recovery behavior.

## Validation

- GV-CITY-668S: 52/52
- GV-CITY-668R regression: 73/73
- GV-CITY-668Q regression: 67/67
- GV-CITY-668P regression: 73/73
- GV-CITY-668O regression: 53/53
- GV-CITY-668N regression: 70/70
- GV-CITY-668M regression: 50/50
- GV-CITY-668E regression: 40/40
- GV-CITY-668B regression: 30/30
- GV-CONTROL-667D frontend/backend compatibility: 21/21

## Expected next milestone

After the Recovery150 result is uploaded and reviewed, build the next activation snapshot using only newly production-qualified cities. Cities that still fail remain estimate-only.
