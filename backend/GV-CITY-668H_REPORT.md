# GV-CITY-668H — Merged 176-City Verified Activation Snapshot

## Purpose

GV-CITY-668H imports the completed GV-CITY-668G Priority150 audit into the existing verified activation layer. It does not call providers and does not change the city registry, provider mappings, hotel quality rules, flight comfort rules, or itinerary-level verification.

## Imported evidence

- GV-CITY-668E Pilot100: 100 audited, 56 production-active, 44 reviewed inactive.
- GV-CITY-668G Priority150: 150 audited, 120 production-active, 30 reviewed inactive.
- Source city sets are disjoint.
- All 176 active cities retain production-provider evidence for both Travelpayouts and Agoda.

## Merged snapshot

- Registry cities: 1,000
- Audited: 250
- Production-active: 176
- Direct/metro active: 170
- Gateway-supported active: 6
- Reviewed inactive: 74
- Unaudited: 750
- Estimate-only total: 824
- Provider-covered among audited: 186

Current-500:
- 205 audited
- 163 production-active
- 42 reviewed inactive

Expansion-500:
- 45 audited
- 13 production-active
- 32 reviewed inactive

## Gateway-supported active cities

- Suwon → ICN
- Tulum → CUN
- Lucca → PSA
- Antigua Guatemala → GUA
- Ayutthaya → BKK
- Kampala → EBB

Gateway evidence and transfer labels remain attached to the activation records.

## Retry queues

Queue membership can overlap.

- Missing flight observations: 57
- Unresolved Agoda mapping: 25
- No live hotel rate: 4
- Hotel quality failure: 2
- Flight comfort failure: 11

Reviewed and unaudited cities remain discoverable, but they are estimate-only and cannot enter provider-driven live recommendation selection while 668H is enabled.

## Runtime changes

- `services/verified-city-activation.js` now loads the 250-city 668H snapshot.
- The feature flag is `ENABLE_VERIFIED_CITY_ACTIVATION_668H=true`.
- `services/city-registry.js` reports the dynamic 668H activation total.
- `services/global-route-graph.js` identifies the 668H allowlist and continues filtering provider observations through the activation service.
- Existing public read-only endpoints are reused:
  - `/api/verified-city-activation`
  - `/api/verified-city-activation/retry-queues`
  - `/api/city-registry?live=true`

No endpoint contract was removed.

## Safety and trust behavior

- All 1,000 cities remain available for discovery.
- Only the 176 imported active records are approved for provider-backed live recommendation capability.
- Activation is capability evidence, not a current-price cache.
- Exact user dates, route, price and bookability still require GV-LIVE-667A/GV-LIVE-667B verification.
- Flag-off preserves the prior unfiltered provider-observation behavior.
- No credentials, provider tokens or admin tokens are included or logged.

## Validation

Local deterministic validation made no provider calls.

- GV-CITY-668H: 78/78 passed.
- GV-CITY-668E regression: 40/40 passed.
- GV-CITY-668B regression: 30/30 passed.
- Modified JavaScript files passed `node --check`.
- The final ZIP is scanned for credential-like filenames and validated after packaging.

Older validators that require separate frontend working directories were not rerun because those frontend directories are not part of this backend-only artifact. No frontend files were changed.

## Deployment

Deploy the backend ZIP and set:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668H=true
```

The existing 668F flag may remain present, but the 668H service is controlled by the new 668H flag.

Then run the public read-only smoke test:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668H-Activation-Smoke.ps1"
```
