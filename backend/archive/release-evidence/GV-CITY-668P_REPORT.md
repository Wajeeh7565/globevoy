# GV-CITY-668P — Merge 420-City Activation Snapshot

## Purpose

Import the completed GV-CITY-668O Expansion150 Wave 2 production-provider audit into the reviewed GV-CITY-668N activation baseline. This is a deterministic backend-only merge. It makes no provider calls and does not weaken the GV-CITY-668E flight-comfort or Agoda-quality rules.

## Authoritative inputs

- `data/verified-city-activation-695-668n.json`
- `data/provider-live-expansion150-668o-source.json`
- `data/unified-city-registry-1000-668b.json`

The imported 668O source contains 150 unique Expansion-500 records: 27 production-ready and 123 reviewed inactive.

## Result

- Registry: 1,000 cities
- Audited: 845
- Production-active: 420
- Reviewed inactive: 425
- Unaudited: 155
- Estimate-only total: 580
- Direct/metro active: 393
- Gateway-supported active: 27
- Current-500: 500 audited, 309 active, 191 reviewed inactive
- Expansion-500: 345 audited, 111 active, 234 reviewed inactive

Only records with `productionActivation.eligible=true`, production-provider evidence from both providers, quality-qualified stay evidence, and comfort-qualified flight evidence were activated. Eighteen `live-both` cities from the 668O run remain inactive because they failed the stricter readiness rules. The single `provider-error` record, Grodno, also remains inactive.

## Imported Wave 2 results

- Provider-covered: 45
- Production-ready: 27
- Held for review: 123
- Live both: 45
- Live stays only: 82
- Live flights only: 4
- Estimate only: 18
- Provider error: 1

## New backend artifacts

- `data/provider-live-expansion150-668o-source.json`
- `data/provider-live-expansion150-668o-source-VALIDATION.json`
- `data/verified-city-activation-845-668p.json`
- `data/verified-city-retry-queues-668p.json`
- `data/verified-city-production-active-420-668p.json`
- `data/verified-city-production-active-420-668p.csv`
- `data/verified-city-review-425-668p.json`
- `data/verified-city-review-425-668p.csv`
- `build-gv-city-668p-activation.js`
- `validate-gv-city-668p.js`
- `VALIDATION_GV_CITY_668P.json`
- `Run-GV-CITY-668P-Activation-Smoke.ps1`

The 668O results validator was also repaired to accept the UTF-8 BOM produced by the PowerShell audit output.

## Runtime change

`services/verified-city-activation.js` now loads the 668P snapshot when:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668P=true
```

The existing 668N and 668L snapshots remain packaged. With the 668P flag absent or false and the 668N flag still true, a fresh Lambda cold start returns to the 393-city 668N allowlist.

## Deployment

Deploy the backend ZIP and add:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668P=true
```

Keep all earlier feature flags and provider credentials, especially:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668N=true
ENABLE_EXPANSION_500_PRIORITY_AUDIT_668O=true
```

Then run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

$script = Get-ChildItem "$env:USERPROFILE\Downloads\*668P*Activation*Smoke*.ps1" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

& $script.FullName
```

## Rollback

Set:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668P=false
```

Keep `ENABLE_VERIFIED_CITY_ACTIVATION_668N=true`. Updating the Lambda configuration creates a fresh runtime that selects the packaged 668N snapshot. A full artifact rollback can also redeploy the verified 668O backend ZIP.

## Frontend compatibility

No frontend changes are required. Continue using the supplied GV-CONTROL-667D frontend. It already consumes the backend activation layer through the existing recommendation and route APIs and preserves date and gateway-transfer behavior.

## Validation

- GV-CITY-668P: 73/73 passed
- 668O completed-result validation: 25/25 passed
- GV-CITY-668O regression: 53/53 passed
- GV-CITY-668N regression: 70/70 passed
- GV-CITY-668M regression: 50/50 passed
- GV-CITY-668E regression: 40/40 passed
- GV-CITY-668B regression: 30/30 passed
- GV-CONTROL-667D backend/frontend compatibility: 21/21 passed
- 78 JavaScript files passed syntax checks
- ZIP integrity and sensitive-file scans passed

Exact route dates, prices, inventory, and bookability must still be rechecked for each user itinerary.
