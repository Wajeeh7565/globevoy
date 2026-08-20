# GV-CITY-668F — Verified Activation Snapshot

## Status

Complete. This release imports the completed **GV-CITY-668E Pilot100** production-provider audit into the backend as a reviewed activation snapshot.

No new Travelpayouts or Agoda requests were made while packaging 668F. The source audit was the user-run 668E result completed at `2026-07-18T00:49:02.3048654Z`.

Source audit SHA-256:

```text
7f5a836e1b003ae12df60198902f92d49ad3e4c9613d4fc38a3915f5022deab6
```

## Imported result

- Registry cities: **1,000**
- Audited in the consistent 668E pilot: **100**
- Verified production-active capability: **56**
- Reviewed inactive: **44**
- Unaudited: **900**
- Estimate-only total: **944**
- Provider-covered in the audit: **58**
- Direct/metro activation: **51**
- Gateway-supported activation: **5**

Tier split:

- Current 500 sample: 55 audited, 43 active, 12 reviewed inactive
- Expansion 500 sample: 45 audited, 13 active, 32 reviewed inactive

Gateway-supported active cities:

- Suwon via ICN
- Tulum via CUN
- Lucca via PSA/Pisa
- Antigua Guatemala via GUA
- Ayutthaya via BKK

## Activation policy

All 1,000 registry cities remain discoverable.

When `ENABLE_VERIFIED_CITY_ACTIVATION_668F=true`:

- the 56 imported active cities are eligible for live provider-capability recommendation flows;
- the 44 reviewed inactive cities remain discoverable as estimate-only;
- the 900 unaudited cities remain discoverable as estimate-only;
- provider-driven global route discovery accepts only destinations in the 56-city allowlist;
- fallback route planning may still surface other destinations, but their output is explicitly marked estimate-only;
- exact route, date, price and bookability claims still require the existing GV-LIVE-667A/GV-LIVE-667B itinerary verification layers.

The snapshot does not guarantee that a price remains available today. It proves that the sampled provider path, mapping, quality and comfort checks passed during the imported audit.

## Data artifacts

The release adds:

- `data/provider-live-pilot-100-668e-source.json` — normalized source audit used for provenance.
- `data/verified-city-activation-100-668f.json` — complete 100-city activation snapshot.
- `data/verified-city-production-active-56-668f.json` — active allowlist with evidence.
- `data/verified-city-production-active-56-668f.csv` — operational active allowlist.
- `data/verified-city-review-44-668f.json` — reviewed inactive records.
- `data/verified-city-review-44-668f.csv` — operational review list.
- `data/verified-city-retry-queues-668f.json` — overlapping repair/retry queues.

Retry queue counts:

- Missing flight observations: **35**
- Unresolved Agoda mapping: **25**
- No live hotel rate: **4**
- Hotel quality failure: **2**
- Flight comfort failure: **3**

A city can appear in more than one retry queue.

## Backend integration

### New service

`services/verified-city-activation.js` provides:

- activation summary;
- registry-wide activation search;
- city status resolution;
- retry queue access;
- city-registry and route-graph annotations;
- live-recommendation gating with flag-off rollback.

### City registry

`services/city-registry.js` now:

- adds `verifiedActivation` to public registry records;
- supports `live=true` / `productionActive=true`;
- supports `activation=active|review|unaudited|estimate-only`;
- supports `queue=<retry-queue>`;
- keeps all 1,000 cities discoverable;
- annotates route-graph catalogue rows as:
  - `verified-live-provider-capability-668f`
  - `audited-estimate-only-668f`
  - `unaudited-estimate-only-668f`

A narrow search repair also prevents short country or airport codes from matching inside unrelated longer words. For example, searching `Tehran` no longer incorrectly promotes a city merely because its two-letter country code appears inside the word.

### Provider-driven route discovery

`services/global-route-graph.js` now:

- gives verified active cities a ranking bonus;
- blocks reviewed or unaudited cities from provider-driven live candidate selection;
- preserves them in estimate-only fallback discovery;
- exposes activation status on each destination;
- records verified-active versus estimate-only stop counts;
- keeps exact itinerary verification mandatory.

## API

### Summary

```text
GET /api/verified-city-activation
```

### Search

```text
GET /api/verified-city-activation?status=active&limit=100
GET /api/verified-city-activation?status=review&limit=100
GET /api/verified-city-activation?status=unaudited&limit=100
GET /api/verified-city-activation?queue=unresolved-agoda-mapping&limit=100
GET /api/verified-city-activation?q=Toronto&includeEvidence=true
```

### Retry queues

```text
GET /api/verified-city-activation/retry-queues
```

### Registry integration

```text
GET /api/city-registry?live=true&limit=100
GET /api/city-registry?activation=estimate-only&limit=100
GET /api/city-registry?queue=missing-flight-observations&limit=100
```

These endpoints are read-only and do not require the private provider audit token.

## Feature flag and rollback

Add:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668F=true
```

Keep the existing 668A–668E flags and provider credentials.

Rollback is immediate:

```text
ENABLE_VERIFIED_CITY_ACTIVATION_668F=false
```

Flag-off preserves the earlier route-selection behavior and disables allowlist enforcement without deleting the imported snapshot.

## Validation

Focused GV-CITY-668F validation: **63/63 passed**.

Validated behavior includes:

- exact source audit provenance and SHA;
- 100 unique audited records;
- 56 active / 44 reviewed inactive;
- 51 direct/metro / 5 gateway-supported;
- 43 Current-500 and 13 Expansion-500 active;
- production evidence requirement for every active city;
- retry queue counts and overlapping membership;
- active, reviewed and unaudited city resolution;
- city registry annotations and filters;
- provider-driven route gating;
- destination estimate-only labels;
- read-only Lambda endpoints;
- flag-off rollback.

Inherited validations also passed:

- GV-CITY-668E: 40/40
- GV-CITY-668B: 30/30
- GV-CITY-668A: 46/46
- GV-EVIDENCE-667E: 12/12
- GV-CONTROL-667D: 21/21
- GV-CONTROL-667C: 20/20
- GV-MVP-666A: 11/11

## Files changed

Changed:

- `lambda.js`
- `server.js`
- `services/city-registry.js`
- `services/global-route-graph.js`

Added:

- `services/verified-city-activation.js`
- `build-gv-city-668f-activation.js`
- `data/provider-live-pilot-100-668e-source.json`
- `data/verified-city-activation-100-668f.json`
- `data/verified-city-production-active-56-668f.json`
- `data/verified-city-production-active-56-668f.csv`
- `data/verified-city-review-44-668f.json`
- `data/verified-city-review-44-668f.csv`
- `data/verified-city-retry-queues-668f.json`
- `Run-GV-CITY-668F-Activation-Smoke.ps1`
- `validate-gv-city-668f.js`
- `VALIDATION_GV_CITY_668F.json`
- `GV-CITY-668F_REPORT.md`
- `MANIFEST_GV_CITY_668F.txt`

No frontend files changed. No credentials were included.
