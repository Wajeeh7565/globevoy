# GV-CITY-668J — Merged 259-City Verified Activation Snapshot

## Purpose

GV-CITY-668J imports the completed GV-CITY-668I Remaining150 audit into the deployed GV-CITY-668H activation baseline. It does not call providers and does not weaken city mapping, hotel quality, flight comfort, gateway, or itinerary-level verification rules.

## Imported evidence

- GV-CITY-668H baseline: 250 audited, 176 production-active, 74 reviewed inactive.
- GV-CITY-668I Remaining150: 150 audited, 83 production-active, 67 reviewed inactive.
- Source city sets are disjoint.
- All 259 active cities retain production-provider evidence for both Travelpayouts and Agoda.

## Merged snapshot

- Registry cities: 1,000
- Audited: 400
- Production-active: 259
- Direct/metro active: 250
- Gateway-supported active: 9
- Reviewed inactive: 141
- Unaudited: 600
- Estimate-only total: 741
- Provider-covered among audited: 281

Current-500:
- 355 audited
- 246 production-active
- 109 reviewed inactive

Expansion-500:
- 45 audited
- 13 production-active
- 32 reviewed inactive

## New 668I gateway activations

- Hoi An → DAD (Da Nang)
- Hakone → NRT (Tokyo)
- Como → BGY (Milan)

These join Suwon, Tulum, Lucca, Antigua Guatemala, Ayutthaya, and Kampala. Gateway evidence and transfer labels remain attached to the activation records.

## Retry queues

Queue membership can overlap.

- Missing flight observations: 112
- Unresolved Agoda mapping: 25
- No live hotel rate: 4
- Hotel quality failure: 2
- Flight comfort failure: 23

Reviewed and unaudited cities remain discoverable, but they are estimate-only and cannot enter provider-driven live recommendation selection while 668J is enabled.

## Runtime changes

- `services/verified-city-activation.js` loads the 400-city 668J snapshot.
- `services/global-route-graph.js` identifies the 668J allowlist.
- The existing 668I remaining-current audit endpoint and operator files are preserved for traceability.
- Feature flag: `ENABLE_VERIFIED_CITY_ACTIVATION_668J=true`.
- Existing public read-only endpoints are reused:
  - `/api/verified-city-activation`
  - `/api/verified-city-activation/retry-queues`
  - `/api/city-registry?live=true`

No endpoint contract was removed. No frontend files changed.

## Safety and trust behavior

- All 1,000 cities remain available for discovery.
- Only the 259 imported active records are approved for provider-backed live recommendation capability.
- Activation is sampled capability evidence, not a current-price cache.
- Exact user dates, route, price, and bookability still require GV-LIVE-667A/GV-LIVE-667B verification.
- Flag-off preserves the earlier unfiltered provider-observation behavior.
- No credentials, provider tokens, or admin tokens are included or logged.

## Validation

Local deterministic validation made no provider calls.

- GV-CITY-668J: 82/82 passed.
- GV-CITY-668E regression: 40/40 passed.
- GV-CITY-668B regression: 30/30 passed.
- GV-MVP-666A regression: 11/11 passed.
- 60 JavaScript files passed `node --check`.
- The final ZIP is scanned for credential-like filenames and validated after packaging.

Frontend-dependent legacy validators could not be rerun because their separate frontend working directories are not included in this backend-only artifact. No frontend files were changed.

## Deployment

Deploy the backend ZIP and set:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668J=true
```

The older 668H flag may remain present, but the current activation service is controlled by the new 668J flag.

Then run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& "$env:USERPROFILE\Downloads\Run-GV-CITY-668J-Activation-Smoke.ps1"
```
