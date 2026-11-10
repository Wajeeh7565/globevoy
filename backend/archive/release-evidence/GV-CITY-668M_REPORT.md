# GV-CITY-668M — Expansion-500 Priority Audit Wave 1

## Purpose

GV-CITY-668M starts the Expansion-500 verification phase after the Current-500 foundation reached 500/500 audited cities. It selects 150 high-readiness, unaudited Expansion-500 cities and exposes a public read-only audit plan. Packaging makes no provider calls and does not change the 322-city GV-CITY-668L production allowlist.

## Baseline preserved

- Registry cities: 1,000
- Audited before this wave: 545
- Production-active before this wave: 322
- Current-500 audited: 500/500
- Expansion-500 audited before this wave: 45
- Expansion-500 active before this wave: 13
- Expansion-500 remaining before this wave: 455

The existing GV-CITY-668L activation snapshot remains authoritative until completed 668M results are reviewed and imported by the next merge milestone.

## Selected audit cohort

- Selected: 150 unique Expansion-500 cities
- Candidate pool with both static mappings: 350
- Both providers statically mapped: 150
- International-airport signal: 146
- Product-review-required: 150
- Gateway transfers: 0
- Projected total audited after the run: 695
- Projected Expansion-500 audited after the run: 195/500

World-region allocation:

- Asia: 45
- Americas: 35
- Europe: 25
- Africa: 20
- Oceania: 15
- Other: 10

Agoda mapping mix:

- Exact city/country: 122
- Coordinate-confirmed market: 21
- Nearby/regional market: 4
- Fuzzy city/country: 2
- Alias city/country: 1

## Runtime changes

Added:

- `services/expansion-priority-city-audit.js`
- `data/expansion-500-priority-audit-150-668m.json`
- `data/expansion-500-priority-audit-150-668m.csv`
- `build-gv-city-668m-expansion-priority-plan.js`
- `validate-gv-city-668m.js`
- `validate-gv-city-668m-results.js`
- `Run-GV-CITY-668M-Expansion500-Priority-Audit.ps1`

Modified only to register the read-only endpoint:

- `lambda.js`
- `server.js`

Public endpoint:

- `/api/expansion-500-priority-audit`

Feature flag:

```text
ENABLE_EXPANSION_500_PRIORITY_AUDIT_668M=true
```

No city registry, provider mapping, hotel-quality, flight-comfort, recommendation, pricing, or activation rule was loosened.

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

- Baku
- Santo Domingo
- Bucharest
- Lagos
- Nadi

## Trust behavior

- Selected cities remain estimate-only until completed results are reviewed and imported.
- The 322-city 668L allowlist remains unchanged.
- Audit capability evidence never guarantees a current price or a bookable itinerary.
- Exact user origin, dates, route, price and bookability still require final live itinerary checks.
- The runner prompts for the admin token securely and does not save it.
- No credentials or provider tokens are bundled.

## Deployment

Deploy the backend ZIP and add:

```text
ENABLE_EXPANSION_500_PRIORITY_AUDIT_668M=true
```

Run Smoke5:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668M-Expansion500-Priority-Audit.ps1" -Mode Smoke5
```

After Smoke5 passes, run all 150:

```powershell
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668M-Expansion500-Priority-Audit.ps1" -Mode Expansion150
```

Resume an interrupted run:

```powershell
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668M-Expansion500-Priority-Audit.ps1" -Mode Expansion150 -Resume
```

## Validation

Deterministic local validation made no provider calls.

- GV-CITY-668M: 50/50 passed.
- GV-CITY-668L regression: 68/68 passed.
- GV-CITY-668E regression: 40/40 passed.
- GV-CITY-668B regression: 30/30 passed.
- Passenger/room pricing regression: 11/11 passed.
- All shipped JavaScript files passed `node --check`.
- ZIP integrity and credential scans are performed after package creation.

Older audit-plan validators pinned to pre-668L activation totals were not rerun as current regressions because their expected baselines are intentionally obsolete. Their previously generated validation artifacts remain unchanged in the package.
