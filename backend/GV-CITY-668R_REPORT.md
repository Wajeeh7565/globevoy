# GV-CITY-668R — Complete 1,000-City Activation Snapshot

## Purpose

Merge the completed GV-CITY-668Q Final155 production-provider audit into the verified GV-CITY-668P activation baseline. This milestone completes audited coverage for the full 1,000-city registry while preserving strict provider, hotel-quality, and flight-comfort rules.

## Reviewed 668Q result

- Requested and completed: 155/155
- Provider-covered: 4
- Production-ready: 1
- Reviewed inactive: 154
- Newly active city: Eindhoven
- Live-both but held: Hargeisa, Ivalo, and Guernsey
- Final audit classifications:
  - 4 live-both
  - 27 live-stays-only
  - 15 live-flights-only
  - 18 estimate-only
  - 91 unresolved

Only Eindhoven passed both providers, Agoda quality, and flight-comfort requirements. The other 154 records remain estimate-only.

## Resulting activation snapshot

- Registry: 1,000
- Audited: 1,000/1,000
- Production-active: 421
- Reviewed inactive: 579
- Unaudited: 0
- Estimate-only: 579
- Direct/metro active: 394
- Gateway-supported active: 27
- Provider-covered audited records: 485

Tier split:

- Current-500: 500 audited, 309 active, 191 inactive
- Expansion-500: 500 audited, 112 active, 388 inactive

## Retry queues

Queue membership can overlap.

- Missing flight observations: 463
- Unresolved Agoda mappings: 130
- No live hotel rate: 50
- Hotel quality failure: 52
- Flight comfort failure: 66

These are operational repair queues, not production activation lists.

## Production safety

- The source Final155 audit is pinned by SHA-256 inside the activation snapshot.
- The 845-city GV-CITY-668P baseline is pinned by SHA-256.
- The 155 imported city IDs do not overlap the 668P audited set.
- All 1,000 registry city IDs are present exactly once.
- Only records with production-provider evidence from both providers, quality-qualified Agoda evidence, and comfort-qualified flight evidence can be active.
- Exact itinerary dates, prices, inventory, and bookability still require the existing GV-LIVE-667A/667B checks.
- Existing 668M, 668O, and 668Q audit-plan endpoints remain packaged.
- No frontend change is required.

## Deployment

Deploy the backend ZIP to the same Lambda and add:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668R=true
```

Keep earlier flags and provider credentials. The 668R flag takes priority over the 668P, 668N, and 668L activation snapshots.

Run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass

$script = Get-ChildItem "$env:USERPROFILE\Downloads\*668R*Activation*Smoke*.ps1" |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

& $script.FullName
```

Expected core result:

```text
Version: GV-CITY-668R
Audited: 1000/1000
Production-active: 421
Reviewed inactive: 579
Unaudited: 0
Expansion-500 active: 112
GV-CITY-668R smoke test passed.
```

## Rollback

Disable or remove:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668R
```

After a Lambda cold start, the packaged fallback is GV-CITY-668P when its flag remains enabled. A full artifact rollback can redeploy the verified 668P ZIP.

## Validation

- GV-CITY-668R: 73/73 passed
- Uploaded GV-CITY-668Q results: 28/28 passed
- GV-CITY-668Q regression: 67/67 passed
- GV-CITY-668P regression: 73/73 passed
- GV-CITY-668O regression: 53/53 passed
- GV-CITY-668N regression: 70/70 passed
- GV-CITY-668M regression: 50/50 passed
- GV-CITY-668E regression: 40/40 passed
- GV-CITY-668B regression: 30/30 passed
- GV-CONTROL-667D compatibility: 21/21 passed
- 84 JavaScript files passed syntax checks
- Full 1,000-city partition and uniqueness checks passed
- Source and baseline SHA pinning passed
- Activation, retry-queue, city-registry, route-graph, Lambda endpoint, flag-off, and rollback checks passed
