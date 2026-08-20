# GV-CITY-668T — Recovery Wave 1 Merged Activation Snapshot

## Purpose

Import the completed GV-CITY-668S Recovery150 audit into the verified GV-CITY-668R full-registry activation baseline. This milestone promotes only cities that passed both live provider checks, Agoda quality requirements, and flight-comfort requirements. No production threshold was relaxed.

## Reviewed 668S result

- Requested and completed: 150/150
- Provider-covered: 71
- Production-ready recoveries: 18
- Still reviewed inactive: 132
- Recovery policy: four flight months, six regional/country anchors, up to 20 flight attempts, four stay windows, and three Agoda quality strategies
- Thresholds relaxed: no

Lane results:

- Flight recovery: 80 checked, 14 provider-covered, 9 production-ready
- Readiness recovery: 64 checked, 57 provider-covered, 9 production-ready
- Stay recovery: 6 checked, 0 provider-covered, 0 production-ready

Recovered cities:

- Honolulu
- Luxor
- Lagos
- Abuja
- Asuncion
- Granada
- Aswan
- Luxembourg
- Karaganda
- Cusco
- Innsbruck
- Cork
- Luanda
- Semarang
- Santiago, Dominican Republic
- Fort Myers
- Kingston
- Guwahati

The recovered set is evenly split: 9 Current-500 and 9 Expansion-500 cities.

## Resulting activation snapshot

- Registry: 1,000
- Audited: 1,000/1,000
- Production-active: 439
- Reviewed inactive: 561
- Unaudited: 0
- Estimate-only: 561
- Direct/metro active: 412
- Gateway-supported active: 27
- Provider-covered audited records: 492

Tier split:

- Current-500: 500 audited, 318 active, 182 inactive
- Expansion-500: 500 audited, 121 active, 379 inactive

## Updated retry queues

Queue membership can overlap.

- Missing flight observations: 423
- Unresolved Agoda mappings: 130
- No live hotel rate: 51
- Hotel quality failure: 50
- Flight comfort failure: 54

The missing-flight queue fell by 40 and the flight-comfort queue fell by 12 compared with GV-CITY-668R. The no-live-hotel-rate count increased by one because the newest provider evidence supersedes the earlier snapshot for all 150 rechecked cities.

## Production safety

- The GV-CITY-668R baseline is pinned by SHA-256.
- The uploaded GV-CITY-668S Recovery150 result is pinned by SHA-256.
- All 150 recovery cities were reviewed inactive in the 668R baseline before import.
- All active recovery records contain production-provider evidence from both providers and passed recommendation readiness.
- The existing stay-quality, duration, transfer, and gateway-transfer thresholds were not relaxed.
- Cities such as Brasilia and Recife remain inactive because their observed itineraries still exceeded the flight-comfort limits.
- Exact itinerary dates, prices, inventory, and bookability still require GV-LIVE-667A/667B verification.
- All 1,000 registry cities remain discoverable; inactive cities remain estimate-only.
- No frontend change is required.

## Deployment

Deploy the backend ZIP to the same Lambda and add:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668T=true
```

Keep the earlier flags and provider credentials. The 668T flag takes priority over 668R, 668P, 668N, and 668L.

Run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

$script = Get-ChildItem "$env:USERPROFILE\Downloads\*668T*Activation*Smoke*.ps1" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

& $script.FullName
```

Expected core result:

```text
Version: GV-CITY-668T
Audited: 1000/1000
Production-active: 439
Recovered active in Wave 1: 18
Reviewed inactive: 561
Unaudited: 0
GV-CITY-668T smoke test passed.
```

## Rollback

Disable or remove:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668T
```

After a Lambda cold start, the packaged fallback is GV-CITY-668R when its flag remains enabled. A full artifact rollback can redeploy the verified 668R backend package.

## Validation

- GV-CITY-668T: 76/76 passed
- Uploaded GV-CITY-668S results: 31/31 passed
- GV-CITY-668S regression: 52/52 passed
- GV-CITY-668R regression: 73/73 passed
- GV-CITY-668Q regression: 67/67 passed
- GV-CITY-668P regression: 73/73 passed
- GV-CITY-668O regression: 53/53 passed
- GV-CITY-668N regression: 70/70 passed
- GV-CITY-668M regression: 50/50 passed
- GV-CITY-668E regression: 40/40 passed
- GV-CITY-668B regression: 30/30 passed
- GV-CONTROL-667D compatibility: 21/21 passed
- 90 JavaScript files passed syntax checks
- Full 1,000-city partition, source pinning, rollback, API endpoint, registry, route-graph, and retry-queue checks passed
