# GV-CITY-668K — Complete Current-500 Audit

## Status

Complete and ready for deployment.

This is a bounded backend audit-planning package. It does **not** change the currently deployed GV-CITY-668J activation snapshot, does not activate any additional city, and does not call Travelpayouts or Agoda during packaging.

## Purpose

Finish the original Current-500 audit foundation by selecting every Current-500 city not yet present in the merged 668J snapshot.

The 668J baseline contains:

- 400 total audited cities
- 259 production-active cities
- 355 audited Current-500 cities
- 145 Current-500 cities still unaudited

The 668K plan contains exactly those 145 remaining Current-500 cities. A completed Final145 run will therefore classify all 500 Current-500 cities and raise the total audited population to 545, while the production-active baseline stays at 259 until the results are reviewed and imported in a later merge.

## Plan summary

- Selected: 145/145 remaining Current-500 cities
- Both static provider mappings present: 145
- Group 2 discoveries: 141
- REVIEW_REQUIRED records included for completion: 4
- Approved gateway-transfer records: 42
- International-airport signal: 25
- Product-review-required: 70

### Region distribution

- Europe: 57
- Americas: 54
- Other: 16
- Asia: 9
- Africa: 9
- Oceania: 0 remaining; all Current-500 Oceania cities were already audited

### REVIEW_REQUIRED records included

- Edmonton
- Moncton
- Orlando
- Tbilisi

They remain ordinary audit targets. Their static mappings do not authorize activation; only successful live-provider evidence under the existing 668E policy can do that.

## Backend additions

- `services/current-500-completion-audit.js`
- `data/current-500-completion-audit-145-668k.json`
- `data/current-500-completion-audit-145-668k.csv`
- `build-gv-city-668k-current500-completion-plan.js`
- `Run-GV-CITY-668K-Complete-Current500-Audit.ps1`
- `validate-gv-city-668k.js`
- `validate-gv-city-668k-results.js`
- `GV-CITY-668K_REPORT.md`
- `MANIFEST_GV_CITY_668K.txt`
- `VALIDATION_GV_CITY_668K.json`

Modified inherited files:

- `lambda.js`
- `server.js`

No frontend files were changed.

## New read-only API

`GET /api/current-500-completion-audit`

The summary response reports the 668J baseline, the 145-city completion plan, and the projected 500/500 Current-500 audited state.

Supported list filters:

- `q`
- `region` or `worldRegion`
- `group`
- `productReviewRequired`
- `internationalAirport`
- `gateway` or `requiresGatewayTransfer`
- `offset`
- `limit`

The endpoint never calls providers and never changes activation.

## Feature flag

`ENABLE_CURRENT_500_COMPLETION_AUDIT_668K=true`

Flag-off disables only the 668K planning endpoint. The 668J 259-city production allowlist remains unchanged.

## Audit runner

`Run-GV-CITY-668K-Complete-Current500-Audit.ps1`

Modes:

- `Smoke5`
- `Priority50`
- `Final145`

Smoke5 cities:

- Sapporo
- Orlando
- Kyoto
- Copenhagen
- Sharm el Sheikh

The smoke set covers direct mappings, one REVIEW_REQUIRED city, an approved gateway case, and multiple regions.

The runner:

- fetches the canonical plan from the deployed 668K endpoint;
- prompts for the private admin token using a masked secure input;
- does not save or embed the token;
- calls the existing authenticated provider-verification endpoint;
- uses two-city batches and concurrency 2;
- uses checkpoint/resume support;
- preserves the strict 668E policy:
  - three flight months;
  - three stay windows;
  - regional origin anchors;
  - approved gateway repair;
  - maximum 1,080-minute sampled flight duration;
  - maximum one transfer;
  - quality-qualified Agoda candidates;
  - two Agoda retrieval strategies with up to 30 candidates.

A completed Final145 result sets:

- `projectedCurrent500AuditedCount: 500`
- `projectedTotalAuditedCount: 545`
- `activationImportRequired: true`

The runner does not activate cities.

## Post-run validation

Use:

```powershell
node validate-gv-city-668k-results.js "C:\path\to\GV-CITY-668K-Final145-...-LIVE-RESULTS.json"
```

The validator checks:

- exactly 145 completed, unique, planned cities;
- all records completed successfully with engine GV-CITY-668E;
- all records are Current-500;
- result totals match record-level evidence;
- active records contain production-provider evidence, quality-qualified stays, and comfort-qualified flights;
- the result projects 500/500 Current-500 audited and 545 total audited;
- activation import remains required;
- no failed batches are present.

## Validation completed during packaging

- GV-CITY-668K: 56/56 passed
- GV-CITY-668J regression: 82/82 passed
- GV-CITY-668E regression: 40/40 passed
- GV-CITY-668B regression: 30/30 passed
- GV-MVP-666A regression: 11/11 passed
- 64 JavaScript files passed syntax checks
- No provider calls were made
- No credentials were embedded

## Deployment

1. Deploy the 668K backend ZIP over the current Lambda code.
2. Add or set:

   `ENABLE_CURRENT_500_COMPLETION_AUDIT_668K=true`

3. Keep the existing provider credentials, admin token, and prior enabled flags.
4. Run Smoke5.
5. If Smoke5 completes without request failures, run Final145.
6. Upload the Final145 `LIVE-RESULTS.json` for review and the next activation merge.

## Important boundary

Completing the audit means all Current-500 cities are classified. It does not mean all 500 will become production-active. Any city without qualifying provider evidence remains reviewed estimate-only.
