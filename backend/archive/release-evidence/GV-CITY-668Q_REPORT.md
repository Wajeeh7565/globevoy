# GV-CITY-668Q — Final 155-City Coverage Audit

## Purpose

Prepare the final authenticated live-provider audit for every Expansion-500 city that remains unaudited after the verified GV-CITY-668P activation snapshot. This is a backend-only, read-only audit-planning milestone. It does not change the 420-city production allowlist.

## Baseline

- Registry: 1,000 cities
- Audited: 845
- Production-active: 420
- Reviewed inactive: 425
- Unaudited: 155
- Current-500: 500/500 audited
- Expansion-500: 345/500 audited, 111 active

## Final 155 plan

All 155 remaining cities are included; none are skipped.

- 50 cities have both static provider mappings and are audited first.
- 105 cities have accepted Travelpayouts mappings but unresolved Agoda mappings.
- All 155 have accepted Travelpayouts mappings.
- The unresolved Agoda lane is still audited. The verifier records `unresolved-static-mapping` and never invents, aliases, or substitutes a hotel market.
- Projected result after the completed Final155 run: 1,000/1,000 audited and 500/500 Expansion-500 audited.

The final plan order is deterministic. The 50 fully mapped cities are ranked first by the established readiness score. The 105 Agoda-unresolved cities follow in deterministic readiness order. Ordering affects audit sequence only; every city is included.

## New runtime endpoint

```text
GET /api/expansion-500-final-audit
```

Enable it with:

```text
ENABLE_EXPANSION_500_FINAL_AUDIT_668Q=true
```

The endpoint is read-only and exposes the final plan, filters, baseline state, and audit projection. It does not call providers.

## Audit runner

`Run-GV-CITY-668Q-Final155-Coverage-Audit.ps1` supports:

- `Smoke5`
- `Final155`
- resumable checkpoint files
- masked admin-token entry
- batches of two cities
- all-results, production-ready, review, live-results, and checkpoint outputs

The Smoke5 set deliberately covers both lanes:

- Ndjamena
- Alor Setar
- Liege
- Moscow
- Monrovia

## Production safety

- The GV-CITY-668P 420-city allowlist remains unchanged.
- The final audit output must be reviewed and imported by a later activation milestone.
- Only a later merge may activate records with production-provider evidence from both providers, quality-qualified Agoda evidence, and comfort-qualified flight evidence.
- Existing 668M and 668O audit endpoints remain packaged.
- Existing 668P, 668N, and 668L activation rollback snapshots remain packaged.
- No frontend changes are required.

## New artifacts

- `data/expansion-500-final-audit-155-668q.json`
- `data/expansion-500-final-audit-155-668q.csv`
- `build-gv-city-668q-final155-plan.js`
- `services/final-expansion-city-audit.js`
- `validate-gv-city-668q.js`
- `VALIDATION_GV_CITY_668Q.json`
- `Run-GV-CITY-668Q-Final155-Coverage-Audit.ps1`
- `MANIFEST_GV_CITY_668Q.txt`
- `GV-CITY-668Q_REPORT.md`

`server.js` and `lambda.js` were extended only to expose the new read-only plan endpoint.

## Deployment

Deploy the backend ZIP to the same Lambda and add:

```text
ENABLE_EXPANSION_500_FINAL_AUDIT_668Q=true
```

Keep the earlier flags and credentials, especially:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668P=true
ENABLE_EXPANSION_500_PRIORITY_AUDIT_668O=true
ENABLE_AGODA_QUALITY_CANDIDATE_RETRIEVAL_668E=true
```

Run Smoke5 first:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

$script = Get-ChildItem "$env:USERPROFILE\Downloads\*668Q*Final155*Audit*.ps1" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

& $script.FullName -Mode Smoke5
```

Then run the final wave:

```powershell
& $script.FullName -Mode Final155
```

## Rollback

Set:

```text
ENABLE_EXPANSION_500_FINAL_AUDIT_668Q=false
```

The audit-plan endpoint becomes disabled while GV-CITY-668P remains the active 420-city production snapshot. A full artifact rollback can redeploy the verified 668P ZIP.

## Validation

- GV-CITY-668Q: 67/67 passed
- GV-CITY-668P regression: 73/73 passed
- GV-CITY-668O regression: 53/53 passed
- GV-CITY-668N regression: 70/70 passed
- GV-CITY-668M regression: 50/50 passed
- GV-CITY-668E regression: 40/40 passed
- GV-CITY-668B regression: 30/30 passed
- GV-CONTROL-667D backend/frontend compatibility: 21/21 passed

Exact route dates, prices, inventory, and bookability must still be rechecked for each user itinerary.
- 81 JavaScript files passed syntax checks.
- Backend ZIP integrity passed.
- No private-key files, environment files, AWS access-key patterns, or private-key markers were found in the package.
