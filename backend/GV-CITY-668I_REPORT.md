# GV-CITY-668I — Remaining Current-500 Priority Audit

## Purpose

GV-CITY-668I prepares the next bounded live-provider audit after the successful 668H merge. It selects 150 high-readiness, unaudited Current-500 cities and exposes the plan through a public read-only endpoint. It does not call providers during packaging and does not change the 176-city production activation allowlist.

## Baseline preserved

- Registry cities: 1,000
- Audited before this run: 250
- Production-active before this run: 176
- Current-500 audited before this run: 205
- Current-500 remaining before this run: 295

The existing GV-CITY-668H activation service remains authoritative until completed 668I results are reviewed and imported by a later merge milestone.

## Selected audit cohort

- Selected: 150 unique Current-500 cities
- Candidate pool: 291
- REVIEW_REQUIRED cities excluded: 4
- Group 2 discoveries: 150
- Both providers statically mapped: 150
- International-airport signal: 83
- Product-review-required: 61
- Approved gateway candidates: 4

World-region allocation:

- Americas: 60
- Europe: 45
- Asia: 25
- Africa: 10
- Oceania: 5
- Other: 5

The four selected gateway candidates preserve their transfer evidence:

- Hoi An → DAD
- Hakone → NRT
- Como → BGY
- Gyeongju → KPO

## Runtime changes

Added:

- `services/remaining-current-city-audit.js`
- `data/remaining-current-500-audit-150-668i.json`
- `data/remaining-current-500-audit-150-668i.csv`
- `build-gv-city-668i-priority-plan.js`
- `validate-gv-city-668i.js`
- `Run-GV-CITY-668I-Remaining-Current500-Audit.ps1`

Modified only to register the read-only endpoint:

- `lambda.js`
- `server.js`

Public endpoint:

- `/api/remaining-current-city-audit`

Feature flag:

```text
ENABLE_REMAINING_CURRENT_500_AUDIT_668I=true
```

No city registry, provider mapping, hotel-quality, flight-comfort, recommendation, pricing, or activation policy was loosened.

## Audit policy

The runner inherits the proven GV-CITY-668E policy:

- three flight months;
- three stay windows;
- regional origin anchors;
- approved gateway fallback;
- maximum 1,080-minute sampled flight duration;
- maximum one transfer;
- diversified Agoda candidate retrieval;
- up to 30 Agoda candidates per strategy;
- two-city batches;
- checkpoint and resume support.

Smoke5 cities:

- Philadelphia
- Bologna
- Da Nang
- Durban
- Melbourne

## Trust behavior

- The selected cities remain estimate-only until their completed audit is reviewed and imported.
- The current 176-city 668H allowlist remains unchanged.
- Audit capability evidence never guarantees a current price or bookable itinerary.
- Exact user origin, dates, route, price, and bookability still require GV-LIVE-667A/GV-LIVE-667B checks.
- The runner prompts for the admin token securely and does not save it.
- No credentials or provider tokens are bundled.

## Validation

Deterministic local validation made no provider calls.

- GV-CITY-668I: 51/51 passed.
- GV-CITY-668H regression: 78/78 passed.
- GV-CITY-668E regression: 40/40 passed.
- GV-CITY-668B regression: 30/30 passed.
- GV-MVP-666A regression: 11/11 passed.
- Modified JavaScript files passed `node --check`.
- Package integrity and credential scans are performed after ZIP creation.

Frontend-dependent 668A, 667C, 667D, and 667E validators were not rerun because their separate frontend working directories are not part of this backend-only task. No frontend files were changed.

## Deployment

Deploy the backend ZIP and add:

```text
ENABLE_REMAINING_CURRENT_500_AUDIT_668I=true
```

Keep existing provider credentials and 668A–668H flags.

Run the smoke test:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668I-Remaining-Current500-Audit.ps1" -Mode Smoke5
```

After Smoke5 passes, run all 150:

```powershell
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668I-Remaining-Current500-Audit.ps1" -Mode Remaining150
```

Resume an interrupted run:

```powershell
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668I-Remaining-Current500-Audit.ps1" -Mode Remaining150 -Resume
```
