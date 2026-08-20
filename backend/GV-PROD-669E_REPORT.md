# GV-PROD-669E — Stakeholder-Readiness Repair

## Purpose

This release converts the technically validated 669D generated-tour MVP into a cleaner stakeholder-review build. It is a narrow repair over the current 668T/669D production baseline.

## Backend changes

- Added `ENABLE_STAKEHOLDER_READINESS_669E=true`.
- The adaptive-route, legacy multi-city and route-control origin resolvers now prefer the exact requested city/country record before a shared metro or airport-code match.
- `Vancouver (YVR)` therefore remains Vancouver instead of inheriting another city that shares YVR coverage.
- Explicit Whistler searches still remain Whistler.
- Added a `restore` route-control action for saved links.
- Saved one-stop routes can be restored without being forced back to two stops.
- Saved routes remain subject to the 439-city production-active allowlist, budget checks, provider verification and date consistency.
- Saved-route departure dates are preserved through the existing 667D date-integrity path.
- No city activation, hotel-quality, flight-comfort, budget or provider-evidence threshold was relaxed.

## Frontend changes

- Visible origin labels are anchored to the user’s requested origin as a defensive presentation layer.
- Suwon now displays as `Suwon — via Seoul Incheon (ICN)` and the origin card explains the gateway.
- Exact-date requests now say `Exact trip dates` and `Requested dates: …` rather than claiming the date was automatically selected.
- The Save button stores an exact same-browser route snapshot and creates a shareable URL.
- A shared saved URL restores the same destination identities and departure date through the backend when local browser storage is unavailable. Live price evidence may refresh.
- Full Globevoy navigation is enabled on the visualizer.
- Two-stop routes no longer append a clipped empty add card. A compact add card remains available for one-stop routes.
- City photography now prioritizes stable local/Wikimedia sources and discovery data before unstable search URLs; generated artwork remains the safe fallback.
- Frontend assets use `?v=669e` cache-busting.

## Validation

- GV-PROD-669E backend targeted validation: **19/19 passed**.
- GV-PROD-669E frontend static validation: **15/15 passed**.
- GV-PROD-669D regression: **35/35 passed**.
- GV-PROD-669C regression: **22/22 passed**.
- GV-PROD-669B regression: **16/16 passed**.
- GV-CITY-668T regression: **76/76 passed**.
- JavaScript syntax: **94 backend files and 41 frontend files passed**.

## Deployment

### Backend

Deploy `lambda-gv-prod-669e-stakeholder-readiness.zip` to the existing Lambda and add:

```text
ENABLE_STAKEHOLDER_READINESS_669E=true
```

Keep the current production flags, including:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668T=true
ENABLE_MVP_VALIDATION_REPAIRS_669B=true
ENABLE_BUDGET_SAFE_ROUTE_RECOVERY_669C=true
ENABLE_EXACT_DATE_FAMILY_OCCUPANCY_669D=true
ENABLE_STABLE_ROUTE_CONTROLS_667C=true
ENABLE_ROUTE_CONTROL_DATE_GATEWAY_INTEGRITY_667D=true
```

### Frontend

Apply `frontend-gv-prod-669e-stakeholder-readiness-overlay.zip` over the current 667D frontend. The overlay contains only the four changed visualizer files and preserves all existing assets. This release requires both backend and frontend deployment.

### Verification

Run `Run-GV-PROD-669E-Stakeholder-Readiness-Smoke.ps1`, then complete `GV-PROD-669E_MANUAL_STAKEHOLDER_CHECKLIST.md`.

## Rollback

- Backend rollback: `lambda-gv-prod-669d-exact-date-family-occupancy.zip`.
- Frontend rollback: `frontend-staging-gv-control-667d-date-preservation-gateway-transfers(1).zip`.
- Disabling `ENABLE_STAKEHOLDER_READINESS_669E` disables the new backend city-first/restore behavior, but a full frontend rollback is still required to remove 669E presentation and saved-link behavior.

## Important scope note

A saved link preserves route identities and dates, not a guaranteed frozen commercial quote. Partner inventory and prices remain live and may change when the link is reopened.
