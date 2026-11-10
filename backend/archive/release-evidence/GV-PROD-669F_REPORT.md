# GV-PROD-669F — Origin Display Integrity Repair

## Purpose

Repair the remaining Vancouver/Whistler origin-label failure discovered by the deployed GV-PROD-669E smoke test.

## Root cause

GV-PROD-669E correctly repaired the adaptive-route, legacy multi-city, and route-control origin resolvers. The live generated-tour flow, however, evaluates provider-driven candidates from `services/global-route-graph.js` first.

That route graph still resolved explicit airport codes before the requested city name. In the unified registry, both Vancouver and Whistler can reference YVR, but Whistler uses YVR as a gateway. A shared-code collision allowed the Whistler record to overwrite Vancouver as the YVR owner. Therefore `Vancouver (YVR)` became `Whistler (YVR)` even though the deployed package version was 669E.

## Production-code changes

- `services/global-route-graph.js`
  - Prefer an explicit requested city identity before a shared airport/metro code.
  - Preserve an explicitly requested airport when it belongs to the requested city, such as Paris `(BVA)` or New York `(JFK)`.
  - Rank shared airport-code ownership so a direct airport city wins over a gateway city.
  - `YVR` now resolves to Vancouver, while explicit `Whistler` remains Whistler using YVR as its practical airport.
  - Added `ENABLE_ORIGIN_DISPLAY_INTEGRITY_669F=true`.
  - The repair also activates when the existing `ENABLE_STAKEHOLDER_READINESS_669E=true` flag is already enabled.
- `generated-tour.js`
  - Version updated to `2.6.1-gv-prod-669f-origin-display-integrity`.

## Protected behavior

- Vancouver `(YVR)` → Vancouver `(YVR)`.
- Code-only `YVR` → Vancouver `(YVR)`.
- Whistler or Whistler `(YVR)` → Whistler `(YVR)`.
- New York `(JFK)` → New York `(JFK)`.
- Paris `(BVA)` preserves BVA instead of silently reverting to CDG.
- Suwon remains Suwon using ICN.
- The 668T activation baseline remains 1,000 audited, 439 production-active, and 0 unaudited.
- No activation, budget, provider, hotel-quality, flight-comfort, or date threshold was relaxed.
- No frontend change is required for 669F.

## Validation

- GV-PROD-669F targeted checks: 25/25 passed.
- GV-PROD-669E regression: 19/19 passed.
- GV-PROD-669D regression: 35/35 passed.
- GV-PROD-669C regression: 22/22 passed.
- GV-PROD-669B regression: 16/16 passed.
- GV-CITY-668T regression: 76/76 passed.
- JavaScript syntax: 95/95 files passed.
- ZIP integrity and secret-pattern scans passed.

## Deployment

Upload `lambda-gv-prod-669f-origin-display-integrity.zip` to the same Lambda function and add:

`ENABLE_ORIGIN_DISPLAY_INTEGRITY_669F=true`

Keep all existing 668T–669E flags enabled. Then run `Run-GV-PROD-669F-Origin-Display-Smoke.ps1`. After it passes, rerun the complete 669E stakeholder-readiness smoke to continue into the frontend checks.
