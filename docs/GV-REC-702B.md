# GV-REC-702B — Freshness-Aware Global Recovery Priority

## Why 702B changed scope

GV-REC-702A found 431 curated cities that already have route identity plus both static provider mappings but remain reviewed-inactive.

Those 431 are **not unaudited cities**. The GV-CITY-668T snapshot shows that the full 1,000-city curated registry was audited by July 22, 2026. Re-running all 431 as if they had never been checked would repeat expensive provider work and discard useful evidence.

702B therefore ranks re-check work using the existing audit history instead of triggering provider calls.

## July audit history preserved

The reviewed GV-CITY-668T snapshot was generated on July 22, 2026 after the 668E/668G/668I/668K/668M/668O/668Q audit waves covered all 1,000 curated cities.

Before the final 668T import, GV-CITY-668S selected 150 reviewed-inactive cities for a bounded Recovery150 pass. That pass:

- kept the original production qualification thresholds;
- used additional flight months and regional anchors;
- used additional stay windows and hotel-quality strategies;
- recovered 18 cities into the later 439-city active snapshot;
- left 132 Recovery150 cities reviewed-inactive;
- deliberately excluded 130 unresolved Agoda mappings for separate mapping repair.

The 668T policy sets `reviewAfterDays` to 30. Evidence remains sampled capability evidence and exact itinerary verification is still mandatory.

## 702B candidate accounting

702B starts only from the 702A `mapped-reviewed-inactive` tier:

- 431 mapped reviewed-inactive cities total;
- 132 are surviving members of the July Recovery150 selection;
- 299 were not selected for that Recovery150 pass.

The 132/299 split is validated directly from repository IDs rather than inferred from city names.

## Priority lanes

Each of the 431 candidates is assigned one freshness-aware lane:

- `due-now-first-recovery` — review horizon reached and the city was not already in Recovery150;
- `due-now-repeat-recovery` — review horizon reached even after Recovery150;
- `defer-recent-recovery` — Recovery150 already spent the larger bounded search budget and the evidence has not yet crossed the review horizon;
- `approaching-review` — within five days of the review horizon;
- `due-now-missing-verification-date` — reviewed record has no usable verification timestamp;
- `defer-not-due` — evidence is still inside the review window.

This prevents a blanket repeat of July work.

## Priority score

The deterministic score favors work that can improve global coverage efficiently:

- missing flight observations receive the largest blocker weight;
- under-covered regions receive a bonus;
- `expansion-500` cities receive a bonus because their active coverage trails `current-500`;
- `GROUP_1` cities receive a modest importance bonus;
- gateway-dependent routes receive a small complexity penalty;
- stale evidence receives an age bonus;
- recent Recovery150 survivors receive a penalty until they are actually due.

The score is an operational prioritization tool. It is not a probability of activation and it is not a user-facing recommendation score.

## Staging API

The isolated staging Lambda exposes:

`GET /api/global-recovery-priority`

Feature flag:

`ENABLE_GLOBAL_RECOVERY_PRIORITY_702B=true`

Supported filters include:

- `lane=<priority lane>`;
- `region=<world region>`;
- `gap=<702A gap code>`;
- `previousRecovery=true|false`;
- `due=true|false`;
- `tier=current-500|expansion-500`;
- optional `asOf=<ISO timestamp>` for deterministic audit replay;
- bounded `offset` and `limit`;
- `resolve=<city, cityId, or location code>` with optional `countryCode=<CC>`.

The endpoint is GET-only and retains the exact staging-origin guard.

## Safety boundary

702B does **not**:

- call Duffel, Travelpayouts, Agoda, Stay22, or another provider;
- change the generated-tour candidate pool;
- change recommendation ranking, routing, or pricing;
- activate or deactivate a city;
- relax flight-comfort or stay-quality thresholds;
- claim current inventory or bookability;
- alter `backend/lambda.js`;
- deploy to production.

Every priority record has:

- `requiresExactItineraryVerification: true`
- `activationAllowedByThisPlan: false`

## Intended next step

After 702B is live-validated on staging, a later controlled phase may run a **small provider re-check wave** from `due-now-first-recovery` first. Results must be reviewed before any activation snapshot changes.

Recent Recovery150 survivors should not be repeated merely because they appear in the 431-city pool. The 30-day evidence horizon and actual blocker type should determine when they return to the work queue.
