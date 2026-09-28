# GV-CITY-668D — Multi-Window Verification and Gateway Repair

## Status

Backend implementation complete and packaged from the verified GV-CITY-668C backend baseline.

No frontend files, route-card layout, generated-tour pricing logic, authentication flow, or provider credentials were changed.

## Why this task was required

The first live 100-city pilot completed successfully but activated only 34 cities. The pilot exposed several false-negative risks:

- each flight mapping was checked against only one future month;
- each stay mapping was checked against only one check-in window;
- only two broad origin anchors were tried;
- Tulum was checked as TQO instead of the approved CUN gateway strategy;
- Caye Caulker was checked as CUK instead of the approved BZE gateway strategy;
- raw Agoda inventory, quality-qualified Agoda rates, provider coverage, and route comfort were collapsed into one status;
- very long provider samples could still count toward production activation.

## Changes

### 1. Multi-window flight verification

- Scans three future months by default; configurable from one to four.
- Uses up to four country-aware and regional anchor origins.
- Interleaves months per origin so one empty month cannot consume the bounded attempt budget.
- Stops early when a comfort-qualified observation is found.
- Keeps a hard bounded attempt limit.

Examples of new country-aware anchors:

- Pakistan: DXB, DOH, IST, LON
- Iran: IST, DXB, DOH, BKK
- North Africa: PAR/LON/IST/DXB variants
- Caribbean and Central America: MIA, NYC, YTO, MEX
- Pacific islands: AKL/LAX/SYD/HNL variants

### 2. Approved gateway repair

The verifier now reads the existing route-feasibility gateway policy and tests practical gateway airports without changing the destination identity.

- Tulum remains `tulum-mx`; flight verification prefers CUN and retains TQO as an alternate.
- Caye Caulker remains `caye-caulker-bz`; flight verification prefers BZE and retains CUK as an alternate.
- Lucca and existing gateway cities continue using their approved gateway metadata.
- Gateway airports are evidence metadata, not additional tour stops.

### 3. Multi-window Agoda verification

- Scans three check-in windows by default; configurable from one to four.
- Tries all dates for the requested occupancy first.
- Uses a one-adult/one-room fallback only for coverage diagnosis when the requested occupancy returns no inventory.
- Records every attempted date and occupancy.

### 4. Raw inventory separated from quality-qualified rates

A new audit-only Agoda probe separates:

- provider inventory observed;
- priced inventory observed;
- quality-qualified hotel inventory;
- Globevoy production-eligible stay evidence.

The customer-facing Agoda estimator was not replaced.

### 5. Provider coverage separated from recommendation readiness

Each live record now exposes separate objects:

- `providerCoverage`
- `recommendationReadiness`
- `productionActivation`

A city may have a verified provider mapping but remain inactive for recommendations when:

- no quality-qualified stay rate was observed;
- the sampled flight exceeded the comfort duration threshold;
- the sampled flight used too many transfers;
- required gateway transfer metadata failed its limit.

### 6. Flight comfort evidence

Default audit threshold:

- maximum duration: 1,080 minutes;
- maximum transfers: 1;
- maximum gateway transfer: 180 minutes.

These are audit evidence thresholds. Actual generated tours remain subject to the existing route-feasibility guard and exact-origin itinerary checks.

### 7. Review-66 rerun support

Added a deterministic list of the 66 cities that did not activate in the first 668C pilot and supplied runners for:

- five-city 668D smoke test;
- 66-city repair audit;
- full 100-city comparison audit;
- local checkpointed range/full registry audits.

## Runtime protection

The existing protected endpoint remains:

- `GET /api/provider-live-coverage`
- `POST /api/provider-live-coverage/verify`

POST verification still requires `GV_PROVIDER_COVERAGE_ADMIN_TOKEN`. Provider credentials are read only from environment variables and are never returned.

## Feature flag

Add:

```text
ENABLE_MULTI_WINDOW_PROVIDER_COVERAGE_668D=true
```

The inherited `ENABLE_LIVE_PROVIDER_COVERAGE_668C=true` remains supported for rollback compatibility.

## Validation

Focused GV-CITY-668D validation:

- 47/47 passed.

Provider mapping regression:

- GV-CITY-668B: 30/30 passed.

Additional checks:

- all JavaScript files passed `node --check`;
- Tulum → CUN gateway regression passed;
- Caye Caulker → BZE gateway regression passed;
- multi-month flight retry passed;
- multi-window Agoda retry passed;
- raw Agoda inventory versus quality rate separation passed;
- injected/mock evidence cannot activate production;
- admin endpoint authorization remains enforced;
- batch hard cap remains 10.

Some inherited validators require separate frontend sibling folders that are not part of this backend ZIP, so those frontend-coupled scripts were not rerun here. Their backend source files were not changed by this task.

## Live-run limitation

No production provider calls were made while packaging this artifact. The real 668D result will be produced after deployment using the credentials already stored in the Lambda environment.

Recommended live sequence:

1. Deploy backend and add the 668D flag.
2. Run `Smoke5` using Tulum, Caye Caulker, Bangkok, Algiers, and Islamabad.
3. Run `Review66`.
4. Compare recovered provider coverage and production activation against the original 34/100 pilot.
5. Only then decide whether to run the full 1,000-city audit.
