# GV-CITY-668N — Merge 393-City Activation Snapshot

## Purpose

Import the completed GV-CITY-668M Expansion150 production-provider audit into the reviewed GV-CITY-668L activation baseline. This is a deterministic backend-only merge. It makes no provider calls and does not weaken the GV-CITY-668E flight-comfort or Agoda-quality rules.

## Authoritative inputs

- `data/verified-city-activation-545-668l.json`
- `data/provider-live-expansion150-668m-source.json`
- `data/unified-city-registry-1000-668b.json`

The imported 668M source contains 150 unique Expansion-500 records: 71 production-ready and 79 reviewed inactive.

## Result

- Registry: 1,000 cities
- Audited: 695
- Production-active: 393
- Reviewed inactive: 302
- Unaudited: 305
- Estimate-only total: 607
- Direct/metro active: 366
- Gateway-supported active: 27
- Current-500: 500 audited, 309 active, 191 reviewed inactive
- Expansion-500: 195 audited, 84 active, 111 reviewed inactive

Only records with `productionActivation.eligible=true`, production-provider evidence from both providers, quality-qualified stay evidence, and comfort-qualified flight evidence were activated. Sixteen `live-both` cities from the 668M run remain inactive because they failed the stricter readiness rules.

## New backend artifacts

- `data/provider-live-expansion150-668m-source.json`
- `data/verified-city-activation-695-668n.json`
- `data/verified-city-retry-queues-668n.json`
- `data/verified-city-production-active-393-668n.json`
- `data/verified-city-production-active-393-668n.csv`
- `data/verified-city-review-302-668n.json`
- `data/verified-city-review-302-668n.csv`
- `build-gv-city-668n-activation.js`
- `validate-gv-city-668n.js`
- `VALIDATION_GV_CITY_668N.json`
- `Run-GV-CITY-668N-Activation-Smoke.ps1`

## Runtime change

`services/verified-city-activation.js` now loads the 668N snapshot when:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668N=true
```

The existing 668L snapshot remains packaged. With the 668N flag absent or false and the 668L flag still true, a fresh Lambda cold start returns to the 322-city 668L allowlist.

## Deployment

Deploy the backend ZIP and add:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668N=true
```

Keep all earlier feature flags and provider credentials, especially:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668L=true
ENABLE_EXPANSION_500_PRIORITY_AUDIT_668M=true
```

Then run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668N-Activation-Smoke.ps1"
```

## Rollback

Set:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668N=false
```

Keep `ENABLE_VERIFIED_CITY_ACTIVATION_668L=true`. Updating the Lambda configuration creates a fresh runtime that selects the packaged 668L snapshot. A full artifact rollback can also redeploy the verified 668M backend ZIP.

## Frontend compatibility

No frontend changes are required. The supplied GV-CONTROL-667D frontend already:

- points to the same Lambda URL;
- enables 500-city discovery;
- requests and displays up to 500 recommendation results;
- uses the backend activation layer through existing recommendation and route APIs;
- preserves date and gateway-transfer behavior.

Deploy backend first. Keep the GV-CONTROL-667D frontend unchanged.

## Validation

- GV-CITY-668N: 70/70 passed
- GV-CITY-668L regression: 68/68 passed
- GV-CITY-668M regression: 50/50 passed
- GV-CITY-668E regression: 40/40 passed
- GV-CITY-668B regression: 30/30 passed
- GV-CONTROL-667D backend/frontend compatibility: 21/21 passed
- JavaScript syntax checks passed
- ZIP integrity and sensitive-key scans passed

Exact route dates, prices, inventory, and bookability must still be rechecked for each user itinerary.
