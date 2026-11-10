# GV-CITY-668O — Expansion-500 Priority Audit Wave 2

## Purpose

GV-CITY-668O continues the Expansion-500 verification phase after GV-CITY-668N established a reviewed 393-city production allowlist. It selects the strongest 150 unaudited Expansion-500 cities that still have both static provider mappings and exposes a public read-only audit plan.

Packaging makes no provider calls and does not modify the 393-city production allowlist.

## Baseline preserved

- Registry cities: 1,000
- Audited before this wave: 695
- Production-active before this wave: 393
- Current-500 audited: 500/500
- Expansion-500 audited before this wave: 195/500
- Expansion-500 active before this wave: 84
- Expansion-500 remaining before this wave: 305

The GV-CITY-668N activation snapshot remains authoritative until completed 668O results are reviewed and imported by a later merge milestone.

## Selected audit cohort

- Selected: 150 unique Expansion-500 cities
- Remaining candidates with both static mappings: 200
- Not selected from the mapped candidate pool: 50
- Remaining cities lacking both complete static mappings: 105
- Both providers statically mapped in selected cohort: 150
- International-airport signal: 63
- Product-review-required: 150
- Preapproved gateway transfers: 0
- Projected total audited after the run: 845/1,000
- Projected Expansion-500 audited after the run: 345/500
- Projected unaudited after the run: 155

The cohort is the global top 150 by the established deterministic readiness score. No artificial regional quota was applied in Wave 2 because the remaining mapped pool is much less evenly distributed than Wave 1.

World-region distribution:

- Asia: 58
- Americas: 37
- Africa: 26
- Europe: 22
- Oceania: 7

Agoda mapping mix:

- Exact city/country: 115
- Coordinate-confirmed market: 21
- Alias city/country: 7
- Fuzzy city/country: 6
- Explicit nearby/regional market: 1

## Runtime changes

Added:

- `services/expansion-priority-city-audit-wave2.js`
- `data/expansion-500-priority-audit-150-668o.json`
- `data/expansion-500-priority-audit-150-668o.csv`
- `build-gv-city-668o-expansion-priority-plan.js`
- `validate-gv-city-668o.js`
- `validate-gv-city-668o-results.js`
- `Run-GV-CITY-668O-Expansion500-Priority-Audit.ps1`

Modified only to register the new read-only endpoint:

- `lambda.js`
- `server.js`

Public endpoint:

- `/api/expansion-500-priority-audit-wave2`

The Wave 1 endpoint remains preserved:

- `/api/expansion-500-priority-audit`

Feature flag:

```text
ENABLE_EXPANSION_500_PRIORITY_AUDIT_668O=true
```

No city registry, provider mapping, hotel-quality, flight-comfort, recommendation, pricing, frontend, or activation rule was loosened.

## Audit policy

The runner inherits the proven GV-CITY-668E policy:

- three flight months;
- three stay windows;
- regional origin anchors;
- approved gateway handling;
- maximum 1,080-minute sampled flight duration;
- maximum one transfer;
- diversified Agoda candidate retrieval;
- up to 30 Agoda candidates per strategy;
- two-city batches;
- checkpoint and resume support.

Smoke5 cities:

- Bhubaneswar
- Belem
- Belgrade
- Yaounde
- Noumea

## Trust behavior

- Selected cities remain estimate-only until completed results are reviewed and imported.
- The 393-city GV-CITY-668N allowlist remains unchanged.
- Audit capability evidence never guarantees a current price or a bookable itinerary.
- Exact user origin, dates, route, price, and bookability still require final live itinerary checks.
- The runner prompts for the admin token securely and does not save it.
- No credentials or provider tokens are bundled.

## Deployment

Deploy the backend ZIP and add:

```text
ENABLE_EXPANSION_500_PRIORITY_AUDIT_668O=true
```

Keep all existing provider credentials and earlier feature flags, especially:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668N=true
ENABLE_EXPANSION_500_PRIORITY_AUDIT_668M=true
```

Run Smoke5:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668O-Expansion500-Priority-Audit.ps1" -Mode Smoke5
```

After Smoke5 passes, run all 150:

```powershell
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668O-Expansion500-Priority-Audit.ps1" -Mode Expansion150
```

Resume an interrupted run:

```powershell
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668O-Expansion500-Priority-Audit.ps1" -Mode Expansion150 -Resume
```

## Next milestone

After the completed 668O results are reviewed, the next merge milestone should import only records with `productionActivation.eligible=true` into a new activation snapshot. All other results must remain reviewed inactive.

## Validation

Deterministic local validation made no provider calls.

- GV-CITY-668O: 53/53 passed.
- GV-CITY-668N regression: 70/70 passed.
- GV-CITY-668M regression: 50/50 passed.
- GV-CITY-668E regression: 40/40 passed.
- GV-CITY-668B regression: 30/30 passed.
- GV-CONTROL-667D backend/frontend compatibility: 21/21 passed.
- All shipped JavaScript files passed `node --check`.
- ZIP integrity and sensitive-key scans are performed after package creation.
